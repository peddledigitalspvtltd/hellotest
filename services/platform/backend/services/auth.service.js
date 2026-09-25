const crypto = require("crypto");
const { OAuth2Client } = require("../src/providers/googleIdentity");
const db = require("../src/db");
const defaultProjectMembership = require("./defaultProjectMembership.service");
const integrationService = require("@hellotest/integration/backend/services/integration.service");
const { getEmailSenderProfile, sendMail } = require("../src/services/email.service");
const { DEFAULT_ROLE_PERMISSIONS } = require("../src/security/permissions.catalog");
const { WORKSPACE_ONLY_PERMISSION_CODES } = require("./permission.service");
const { hashPasswordAsync, passwordNeedsRehash, verifyPasswordAsync, createToken, verifyToken } = require("../src/utils/token");
const { resolveSecret } = require("../src/security/runtimeSecrets");

const VERIFICATION_CODE_TTL_MINUTES = 15;
const VERIFICATION_MAX_ATTEMPTS = 5;
const VERIFICATION_REJECTION = Symbol("verification-rejection");
const googleIdentityVerifier = new OAuth2Client();
const VERIFICATION_SECRET = resolveSecret({
  names: ["VERIFICATION_CODE_SECRET", "SESSION_SECRET"],
  label: "Verification-code signing secret",
  developmentFallback: "hellotest-verification-secret"
});

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeEmail = (email) => {
  return email.toLowerCase().trim();
};

const normalizeName = (name) => {
  if (typeof name !== "string") {
    return null;
  }

  const normalized = name.trim();
  return normalized ? normalized : null;
};

const hashVerificationCode = (code) => {
  return crypto.createHmac("sha256", VERIFICATION_SECRET).update(code).digest("hex");
};

const generateVerificationCode = () => {
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
};

const generatePlaceholderPassword = () => {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
};

const getSessionPermissionProfile = async (id, role) => {
  if (role === "admin") {
    const permissions = DEFAULT_ROLE_PERMISSIONS.admin || [];
    return { permissions, workspacePermissions: permissions, projectPermissions: {} };
  }

  // Read the live grants together. No session-level cache is used, so revoking a
  // role or project membership takes effect on the next session refresh.
  const permissionRows = await db.prepare(`
    SELECT DISTINCT NULL::TEXT AS project_id, permissions.code
    FROM users
    JOIN role_permissions ON role_permissions.role_id = users.default_role_id
    JOIN permissions ON permissions.id = role_permissions.permission_id
    WHERE users.id = ?
    UNION ALL
    SELECT project_members.project_id, permissions.code
    FROM project_members
    JOIN role_permissions ON role_permissions.role_id = project_members.role_id
    JOIN permissions ON permissions.id = role_permissions.permission_id
    WHERE project_members.user_id = ?
    ORDER BY project_id ASC, code ASC
  `).all(id, id);
  const workspaceRows = permissionRows.filter((row) => row.project_id === null);
  const projectRows = permissionRows.filter((row) => row.project_id !== null);
  const workspacePermissions = workspaceRows
    .map((row) => row.code)
    .filter((code) => WORKSPACE_ONLY_PERMISSION_CODES.has(code));
  if (!workspacePermissions.length) {
    workspacePermissions.push("workspace.view", "settings.view");
  }
  const projectPermissions = {};
  for (const row of projectRows) {
    projectPermissions[row.project_id] = projectPermissions[row.project_id] || [];
    projectPermissions[row.project_id].push(row.code);
  }

  return {
    permissions: [...new Set([...workspacePermissions, ...projectRows.map((row) => row.code)])].sort(),
    workspacePermissions: [...new Set(workspacePermissions)].sort(),
    projectPermissions
  };
};

const selectUserForSession = async (id) => {
  const user = await db.prepare(`
    SELECT id, email, name, username, avatar_data_url, auth_provider, email_verified, status,
      must_change_password, last_login_at, created_at, is_workspace_admin
    FROM users
    WHERE id = ?
  `).get(id);

  if (!user) {
    return null;
  }

  if (user.status === "suspended") {
    throw createError("This account is suspended. Contact a workspace administrator.", 403);
  }

  const { is_workspace_admin, ...rest } = user;
  const role = is_workspace_admin ? "admin" : "member";
  const permissionProfile = await getSessionPermissionProfile(id, role);

  return {
    ...rest,
    role,
    permissions: permissionProfile.permissions,
    workspace_permissions: permissionProfile.workspacePermissions,
    project_permissions: permissionProfile.projectPermissions
  };
};

const getPendingVerification = async ({ email, purpose }) => {
  return db.prepare(`
    SELECT *
    FROM auth_verification_codes
    WHERE email = ? AND purpose = ? AND consumed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE
  `).get(email, purpose);
};

const clearPendingVerification = async ({ email, purpose }) => {
  await db.prepare(`
    DELETE FROM auth_verification_codes
    WHERE email = ? AND purpose = ? AND consumed_at IS NULL
  `).run(email, purpose);
};

const createVerificationEmail = ({ code, purpose, senderName, expiresInMinutes }) => {
  const actionLabel = purpose === "signup" ? "finish creating your HelloTest account" : "reset your HelloTest password";
  const subject = purpose === "signup" ? "Your HelloTest signup verification code" : "Your HelloTest password reset code";
  const text = [
    `Use this verification code to ${actionLabel}: ${code}`,
    "",
    `The code expires in ${expiresInMinutes} minutes.`,
    "",
    `If you did not request this, you can ignore this email.`,
    "",
    `${senderName}`
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; color: #16324f; line-height: 1.5;">
      <p>Use this verification code to ${actionLabel}:</p>
      <p style="margin: 24px 0;">
        <strong style="display: inline-block; padding: 12px 18px; font-size: 24px; letter-spacing: 6px; border-radius: 12px; background: #e9f1ff; color: #0f4aa3;">
          ${code}
        </strong>
      </p>
      <p>The code expires in ${expiresInMinutes} minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
      <p style="margin-top: 24px;">${senderName}</p>
    </div>
  `;

  return { subject, text, html };
};

const sendVerificationCode = async ({ email, purpose, payload }) => {
  const senderProfile = await getEmailSenderProfile();

  if (!senderProfile.enabled) {
    throw createError(
      "Email verification is not configured yet. Add an active Email Sender integration in Administration > Integrations.",
      503
    );
  }

  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000).toISOString();

  await clearPendingVerification({ email, purpose });

  await db.prepare(`
    INSERT INTO auth_verification_codes (id, email, purpose, code_hash, payload, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    email,
    purpose,
    hashVerificationCode(code),
    payload,
    expiresAt
  );

  const emailContent = createVerificationEmail({
    code,
    purpose,
    senderName: senderProfile.senderName || "HelloTest Support",
    expiresInMinutes: VERIFICATION_CODE_TTL_MINUTES
  });

  await sendMail({
    to: email,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html
  });

  return {
    success: true,
    expiresAt
  };
};

const consumeVerificationPayload = async ({ email, purpose, code }) => {
  const verification = await getPendingVerification({ email, purpose });

  if (!verification) {
    return { [VERIFICATION_REJECTION]: createError("No verification code is pending. Request a new code to continue.", 400) };
  }

  if (verification.expires_at && new Date(verification.expires_at) < new Date()) {
    await clearPendingVerification({ email, purpose });
    return { [VERIFICATION_REJECTION]: createError("This verification code has expired. Request a new code to continue.", 401) };
  }

  if (verification.attempt_count >= VERIFICATION_MAX_ATTEMPTS) {
    await clearPendingVerification({ email, purpose });
    return { [VERIFICATION_REJECTION]: createError("Too many incorrect attempts. Request a new verification code and try again.", 429) };
  }

  if (hashVerificationCode(code) !== verification.code_hash) {
    const nextAttemptCount = verification.attempt_count + 1;

    await db.prepare(`
      UPDATE auth_verification_codes
      SET attempt_count = ?
      WHERE id = ?
    `).run(nextAttemptCount, verification.id);

    if (nextAttemptCount >= VERIFICATION_MAX_ATTEMPTS) {
      return { [VERIFICATION_REJECTION]: createError("Too many incorrect attempts. Request a new verification code and try again.", 429) };
    }

    return { [VERIFICATION_REJECTION]: createError("Invalid verification code. Double-check the 6-digit code and try again.", 401) };
  }

  await db.prepare(`
    UPDATE auth_verification_codes
    SET consumed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(verification.id);

  return verification.payload || {};
};

// Failed attempts and expiry cleanup are durable changes, even though the HTTP
// request is rejected. Successful consumption and its account mutation still
// commit together; unexpected failures still roll back the entire operation.
const verificationTransaction = (work) => async (input) => {
  const result = await db.transaction(work)(input);
  if (result?.[VERIFICATION_REJECTION]) throw result[VERIFICATION_REJECTION];
  return result;
};

const verifyGoogleIdentityToken = async (idToken, expectedClientId) => {
  if (!idToken) {
    throw createError("Google sign-in token is required", 400);
  }

  let ticket;

  try {
    ticket = await googleIdentityVerifier.verifyIdToken({
      idToken,
      audience: expectedClientId
    });
  } catch (error) {
    const upstreamStatus = Number(error?.response?.status || 0);
    const transient = upstreamStatus >= 500
      || ["ECONNRESET", "ENOTFOUND", "ETIMEDOUT"].includes(error?.code || error?.cause?.code);
    throw createError(
      transient
        ? "Unable to verify Google sign-in right now. Please try again."
        : "Google sign-in could not be verified. Please try again.",
      transient ? 502 : 401
    );
  }

  const payload = ticket.getPayload();

  if (!payload || payload.aud !== expectedClientId) {
    throw createError("This Google sign-in request was issued for a different client.", 401);
  }

  if (!payload.email || payload.email_verified !== true || !payload.sub) {
    throw createError("Google sign-in requires a verified email address.", 401);
  }

  return {
    email: payload.email,
    name: normalizeName(payload.name),
    sub: payload.sub
  };
};

const getGoogleSetup = async () => {
  const integration = await integrationService.getActiveIntegrationByType("google_auth");
  const clientId = integration?.config?.client_id || null;

  return {
    enabled: Boolean(clientId),
    clientId
  };
};

exports.getAuthSetup = async () => {
  const [google, emailVerification] = await Promise.all([
    getGoogleSetup(),
    getEmailSenderProfile()
  ]);

  return {
    google,
    emailVerification
  };
};

exports.requestSignupCode = async ({ email, password, name }) => {
  if (!email || !password) {
    throw createError("Email and password are required", 400);
  }

  if (password.length < 6) {
    throw createError("Password must be at least 6 characters", 400);
  }

  const normalizedEmail = normalizeEmail(email);
  const existing = await db.prepare(`
    SELECT id
    FROM users
    WHERE LOWER(email) = ?
  `).get(normalizedEmail);

  if (existing) {
    throw createError("An account already exists for that email. Sign in or use forgot password instead.", 409);
  }

  return sendVerificationCode({
    email: normalizedEmail,
    purpose: "signup",
    payload: {
      name: normalizeName(name),
      password_hash: await hashPasswordAsync(password)
    }
  });
};

exports.verifySignupCode = verificationTransaction(async ({ email, code }) => {
  if (!email || !code) {
    throw createError("Email and verification code are required", 400);
  }

  const normalizedEmail = normalizeEmail(email);
  const verificationPayload = await consumeVerificationPayload({
    email: normalizedEmail,
    purpose: "signup",
    code: code.trim()
  });
  if (verificationPayload[VERIFICATION_REJECTION]) return verificationPayload;

  const existing = await db.prepare(`
    SELECT id
    FROM users
    WHERE LOWER(email) = ?
  `).get(normalizedEmail);

  if (existing) {
    throw createError("An account already exists for that email. Sign in instead.", 409);
  }

  if (!verificationPayload.password_hash) {
    throw createError("This signup request is incomplete. Request a new code and try again.", 400);
  }

  const id = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO users (id, email, password_hash, name, auth_provider, email_verified)
    VALUES (?, ?, ?, ?, 'local', TRUE)
  `).run(
    id,
    normalizedEmail,
    verificationPayload.password_hash,
    normalizeName(verificationPayload.name)
  );

  await defaultProjectMembership.assign(id);

  return { success: true };
});

exports.login = async ({ email, password }) => {
  if (!email || !password) {
    throw createError("Missing required fields", 400);
  }

  const normalizedEmail = normalizeEmail(email);

  const user = await db.prepare(`
    SELECT id, email, name, password_hash, status, created_at
    FROM users
    WHERE LOWER(email) = ?
  `).get(normalizedEmail);

  if (!user) {
    throw createError("Invalid credentials", 401);
  }

  if (user.status === "suspended") {
    throw createError("This account is suspended. Contact a workspace administrator.", 403);
  }

  const isPasswordValid = await verifyPasswordAsync(password, user.password_hash);

  if (!isPasswordValid) {
    throw createError("Invalid credentials", 401);
  }

  // Expensive password work finishes before acquiring a connection or row lock.
  const upgradedHash = passwordNeedsRehash(user.password_hash) ? await hashPasswordAsync(password) : null;
  const sessionUser = await db.transaction(async () => {
    let freshUser = await selectUserForSession(user.id);
    if (!freshUser) throw createError("Invalid credentials", 401);

    // Compare the verified credential and fresh status in the write itself: a
    // reset or suspension may commit while asynchronous password work runs.
    const loginUpdate = upgradedHash
      ? await db.prepare("UPDATE users SET password_hash = ?, last_login_at = CURRENT_TIMESTAMP WHERE id = ? AND password_hash = ? AND status IS DISTINCT FROM 'suspended'").run(upgradedHash, user.id, user.password_hash)
      : await db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ? AND password_hash = ? AND status IS DISTINCT FROM 'suspended'").run(user.id, user.password_hash);
    if (!loginUpdate.changes) throw createError("Invalid credentials", 401);

    // The first-login timestamp and project grant commit together. A failed
    // assignment remains retryable, and parallel logins cannot see a completed
    // first login before its membership is available.
    if (!freshUser.last_login_at) {
      await defaultProjectMembership.assign(user.id);
      freshUser = await selectUserForSession(user.id);
      if (!freshUser) throw createError("Invalid credentials", 401);
    }
    return freshUser;
  })();

  return {
    token: createToken(sessionUser),
    user: sessionUser
  };
};

exports.loginWithGoogle = db.transaction(async ({ idToken }) => {
  const googleSetup = await getGoogleSetup();

  if (!googleSetup.enabled || !googleSetup.clientId) {
    throw createError(
      "Google sign-in is not configured yet. Add an active Google Sign-In integration in Administration > Integrations.",
      503
    );
  }

  const googleProfile = await verifyGoogleIdentityToken(idToken, googleSetup.clientId);
  const normalizedEmail = normalizeEmail(googleProfile.email);
  const existing = await db.prepare(`
    SELECT id, name, auth_provider, google_sub
    FROM users
    WHERE LOWER(email) = ?
  `).get(normalizedEmail);

  if (existing) {
    if (existing.google_sub && existing.google_sub !== googleProfile.sub) {
      throw createError("This email is already linked to a different Google account.", 409);
    }

    await db.prepare(`
      UPDATE users
      SET google_sub = ?,
          email_verified = TRUE,
          name = COALESCE(name, ?)
      WHERE id = ?
    `).run(googleProfile.sub, googleProfile.name, existing.id);

    let sessionUser = await selectUserForSession(existing.id);
    if (!sessionUser) throw createError("Invalid credentials", 401);
    if (!sessionUser.last_login_at) {
      await defaultProjectMembership.assign(existing.id);
      sessionUser = await selectUserForSession(existing.id);
    }
    await db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(existing.id);

    return {
      token: createToken(sessionUser),
      user: sessionUser
    };
  }

  const id = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO users (id, email, password_hash, name, auth_provider, google_sub, email_verified)
    VALUES (?, ?, ?, ?, 'google', ?, TRUE)
  `).run(
    id,
    normalizedEmail,
    await hashPasswordAsync(generatePlaceholderPassword()),
    googleProfile.name,
    googleProfile.sub
  );

  await defaultProjectMembership.assign(id);

  const sessionUser = await selectUserForSession(id);
  await db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);

  return {
    token: createToken(sessionUser),
    user: sessionUser
  };
});

exports.requestPasswordResetCode = async ({ email, newPassword }) => {
  if (!email || !newPassword) {
    throw createError("Email and new password are required", 400);
  }

  if (newPassword.length < 6) {
    throw createError("Password must be at least 6 characters", 400);
  }

  const normalizedEmail = normalizeEmail(email);
  const user = await db.prepare(`
    SELECT id
    FROM users
    WHERE LOWER(email) = ?
  `).get(normalizedEmail);

  if (!user) {
    return { success: true };
  }

  return sendVerificationCode({
    email: normalizedEmail,
    purpose: "password_reset",
    payload: {
      password_hash: await hashPasswordAsync(newPassword)
    }
  });
};

exports.verifyPasswordResetCode = verificationTransaction(async ({ email, code }) => {
  if (!email || !code) {
    throw createError("Email and verification code are required", 400);
  }

  const normalizedEmail = normalizeEmail(email);
  const verificationPayload = await consumeVerificationPayload({
    email: normalizedEmail,
    purpose: "password_reset",
    code: code.trim()
  });
  if (verificationPayload[VERIFICATION_REJECTION]) return verificationPayload;
  const user = await db.prepare(`
    SELECT id
    FROM users
    WHERE LOWER(email) = ?
  `).get(normalizedEmail);

  if (!user) {
    throw createError("No account matches that email. Sign up instead.", 404);
  }

  if (!verificationPayload.password_hash) {
    throw createError("This password reset request is incomplete. Request a new code and try again.", 400);
  }

  await db.prepare(`
    UPDATE users
    SET password_hash = ?, email_verified = TRUE
    WHERE id = ?
  `).run(verificationPayload.password_hash, user.id);

  await db.prepare(`
    DELETE FROM password_reset_tokens
    WHERE user_id = ?
  `).run(user.id);

  return { success: true };
});

exports.getSession = async (token) => {
  let payload;

  try {
    payload = verifyToken(token);
  } catch (error) {
    throw createError(error.message || "Invalid token", 401);
  }

  const user = await selectUserForSession(payload.sub);

  if (!user) {
    throw createError("User not found", 404);
  }

  return {
    token,
    user
  };
};
