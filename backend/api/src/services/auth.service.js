const crypto = require("crypto");
const db = require("../db");
const integrationService = require("./integration.service");
const { getEmailSenderProfile, sendMail } = require("./email.service");
const { DEFAULT_ROLE_PERMISSIONS } = require("../security/permissions.catalog");
const { hashPassword, verifyPassword, createToken, verifyToken } = require("../utils/token");

const VERIFICATION_CODE_TTL_MINUTES = 15;
const VERIFICATION_MAX_ATTEMPTS = 5;
const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const VERIFICATION_SECRET =
  process.env.VERIFICATION_CODE_SECRET ||
  process.env.SESSION_SECRET ||
  "hellotest-verification-secret";

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

const getSessionRole = async (id) => {
  const row = await db.prepare(`
    SELECT
      COALESCE(users.is_workspace_admin, FALSE) AS is_workspace_admin,
      EXISTS (
        SELECT 1
        FROM project_members
        JOIN roles ON roles.id = project_members.role_id
        WHERE project_members.user_id = users.id
          AND LOWER(roles.name) = 'admin'
      ) AS has_admin_membership
    FROM users
    WHERE users.id = ?
  `).get(id);

  return row?.is_workspace_admin || row?.has_admin_membership ? "admin" : "member";
};

const getSessionPermissions = async (id, role) => {
  if (role === "admin") {
    return DEFAULT_ROLE_PERMISSIONS.admin || [];
  }

  const rows = await db.prepare(`
    SELECT DISTINCT permissions.code
    FROM project_members
    JOIN role_permissions ON role_permissions.role_id = project_members.role_id
    JOIN permissions ON permissions.id = role_permissions.permission_id
    WHERE project_members.user_id = ?
    ORDER BY permissions.code ASC
  `).all(id);

  if (rows.length) {
    return rows.map((row) => row.code);
  }

  return DEFAULT_ROLE_PERMISSIONS.member || [];
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

  const { is_workspace_admin, ...rest } = user;
  const role = await getSessionRole(id);

  return {
    ...rest,
    role,
    permissions: await getSessionPermissions(id, role)
  };
};

const ensureMemberRole = async () => {
  const existing = await db.prepare(`
    SELECT id
    FROM roles
    WHERE name = 'member'
  `).get();

  const roleId = existing?.id || crypto.randomUUID();

  if (!existing) {
    await db.prepare(`
      INSERT INTO roles (id, name)
      VALUES (?, 'member')
    `).run(roleId);
  }

  const memberPermissionCodes = DEFAULT_ROLE_PERMISSIONS.member || [];

  if (memberPermissionCodes.length) {
    const placeholders = memberPermissionCodes.map(() => "?").join(", ");

    await db.prepare(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT ?, permissions.id
      FROM permissions
      WHERE permissions.code IN (${placeholders})
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `).run(roleId, ...memberPermissionCodes);
  }

  return roleId;
};

const assignDefaultProjectMemberships = async (userId) => {
  const memberRoleId = await ensureMemberRole();
  const defaultProject = await db.prepare(`
    SELECT id
    FROM projects
    WHERE id = 'project-16'
       OR LOWER(COALESCE(display_id, '')) = 'project-16'
       OR LOWER(name) = 'hellotest'
    ORDER BY
      CASE
        WHEN id = 'project-16' THEN 0
        WHEN LOWER(COALESCE(display_id, '')) = 'project-16' THEN 1
        WHEN LOWER(name) = 'hellotest' THEN 2
        ELSE 3
      END,
      created_at ASC
    LIMIT 1
  `).get();

  if (!defaultProject) {
    return;
  }

  const existing = db.prepare(`
    SELECT id
    FROM project_members
    WHERE project_id = ? AND user_id = ?
  `);
  const insertMembership = db.prepare(`
    INSERT INTO project_members (id, project_id, user_id, role_id)
    VALUES (?, ?, ?, ?)
  `);

  if (!await existing.get(defaultProject.id, userId)) {
    await insertMembership.run(crypto.randomUUID(), defaultProject.id, userId, memberRoleId);
  }
};

const getPendingVerification = async ({ email, purpose }) => {
  return db.prepare(`
    SELECT *
    FROM auth_verification_codes
    WHERE email = ? AND purpose = ? AND consumed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
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
    throw createError("No verification code is pending. Request a new code to continue.", 400);
  }

  if (verification.expires_at && new Date(verification.expires_at) < new Date()) {
    await clearPendingVerification({ email, purpose });
    throw createError("This verification code has expired. Request a new code to continue.", 401);
  }

  if (verification.attempt_count >= VERIFICATION_MAX_ATTEMPTS) {
    await clearPendingVerification({ email, purpose });
    throw createError("Too many incorrect attempts. Request a new verification code and try again.", 429);
  }

  if (hashVerificationCode(code) !== verification.code_hash) {
    const nextAttemptCount = verification.attempt_count + 1;

    await db.prepare(`
      UPDATE auth_verification_codes
      SET attempt_count = ?
      WHERE id = ?
    `).run(nextAttemptCount, verification.id);

    if (nextAttemptCount >= VERIFICATION_MAX_ATTEMPTS) {
      throw createError("Too many incorrect attempts. Request a new verification code and try again.", 429);
    }

    throw createError("Invalid verification code. Double-check the 6-digit code and try again.", 401);
  }

  await db.prepare(`
    UPDATE auth_verification_codes
    SET consumed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(verification.id);

  return verification.payload || {};
};

const verifyGoogleIdentityToken = async (idToken, expectedClientId) => {
  if (!idToken) {
    throw createError("Google sign-in token is required", 400);
  }

  if (typeof fetch !== "function") {
    throw createError("Google sign-in is not supported on this server runtime.", 500);
  }

  let response;

  try {
    response = await fetch(`${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`, {
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    throw createError("Unable to verify Google sign-in right now. Please try again.", 502);
  }

  if (!response.ok) {
    throw createError("Google sign-in could not be verified. Please try again.", 401);
  }

  const payload = await response.json();

  if (payload.aud !== expectedClientId) {
    throw createError("This Google sign-in request was issued for a different client.", 401);
  }

  if (!payload.email || payload.email_verified !== "true" || !payload.sub) {
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
      password_hash: hashPassword(password)
    }
  });
};

exports.verifySignupCode = db.transaction(async ({ email, code }) => {
  if (!email || !code) {
    throw createError("Email and verification code are required", 400);
  }

  const normalizedEmail = normalizeEmail(email);
  const verificationPayload = await consumeVerificationPayload({
    email: normalizedEmail,
    purpose: "signup",
    code: code.trim()
  });

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

  await assignDefaultProjectMemberships(id);

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

  const isPasswordValid = verifyPassword(password, user.password_hash);

  if (!isPasswordValid) {
    throw createError("Invalid credentials", 401);
  }

  const sessionUser = await selectUserForSession(user.id);

  await db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);

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

    const sessionUser = await selectUserForSession(existing.id);

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
    hashPassword(generatePlaceholderPassword()),
    googleProfile.name,
    googleProfile.sub
  );

  await assignDefaultProjectMemberships(id);

  const sessionUser = await selectUserForSession(id);

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
      password_hash: hashPassword(newPassword)
    }
  });
};

exports.verifyPasswordResetCode = db.transaction(async ({ email, code }) => {
  if (!email || !code) {
    throw createError("Email and verification code are required", 400);
  }

  const normalizedEmail = normalizeEmail(email);
  const verificationPayload = await consumeVerificationPayload({
    email: normalizedEmail,
    purpose: "password_reset",
    code: code.trim()
  });
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
