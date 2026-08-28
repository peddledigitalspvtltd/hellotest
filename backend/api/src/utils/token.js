const crypto = require("crypto");
const { resolveSessionSecret } = require("../security/runtimeSecrets");

const TOKEN_TTL_SECONDS = 60 * 60 * 12;
const PASSWORD_ALGORITHM = "pbkdf2_sha256";
const PASSWORD_ITERATIONS = 600_000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_SALT_BYTES = 16;
const LEGACY_PASSWORD_ITERATIONS = 100_000;
const LEGACY_PASSWORD_KEY_LENGTH = 64;
const secret = resolveSessionSecret();

const base64url = (value) => Buffer.from(value).toString("base64url");

const signValue = (value) => {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
};

const validatePassword = (password) => {
  if (!password || typeof password !== "string") {
    throw new Error("Password must be a non-empty string");
  }
  if (Buffer.byteLength(password, "utf8") > 1024) {
    throw new Error("Password is too long");
  }
};

const derivePassword = ({ password, salt, iterations, keyLength }) => crypto
  .pbkdf2Sync(password, salt, iterations, keyLength, "sha256");

exports.hashPassword = (password) => {
  validatePassword(password);
  const salt = crypto.randomBytes(PASSWORD_SALT_BYTES);
  const derived = derivePassword({
    password,
    salt,
    iterations: PASSWORD_ITERATIONS,
    keyLength: PASSWORD_KEY_LENGTH
  });

  return [
    PASSWORD_ALGORITHM,
    PASSWORD_ITERATIONS,
    salt.toString("base64url"),
    derived.toString("base64url")
  ].join("$");
};

const verifyModernPassword = (password, hash) => {
  const [algorithm, iterationsValue, saltValue, digestValue] = String(hash || "").split("$");
  if (algorithm !== PASSWORD_ALGORITHM || !iterationsValue || !saltValue || !digestValue) return false;

  const iterations = Number(iterationsValue);
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) return false;

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(digestValue, "base64url");
    if (salt.length < 16 || expected.length < 16) return false;
    const computed = derivePassword({ password, salt, iterations, keyLength: expected.length });
    return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
};

const verifyLegacyPassword = (password, hash) => {
  if (!/^[0-9a-f]{128}$/i.test(String(hash || ""))) return false;
  const legacySalt = process.env.PASSWORD_SALT || "hellotest-dev-salt";
  const computed = derivePassword({
    password,
    salt: legacySalt,
    iterations: LEGACY_PASSWORD_ITERATIONS,
    keyLength: LEGACY_PASSWORD_KEY_LENGTH
  }).toString("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
};

exports.verifyPassword = (password, hash) => {
  try {
    validatePassword(password);
  } catch {
    return false;
  }

  return String(hash || "").startsWith(`${PASSWORD_ALGORITHM}$`)
    ? verifyModernPassword(password, hash)
    : verifyLegacyPassword(password, hash);
};

exports.passwordNeedsRehash = (hash) => {
  const [algorithm, iterationsValue] = String(hash || "").split("$");
  return algorithm !== PASSWORD_ALGORITHM || Number(iterationsValue) < PASSWORD_ITERATIONS;
};

exports.createToken = (user) => {
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name || null,
    role: user.role || "member",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    jti: crypto.randomUUID()
  };

  const encoded = base64url(JSON.stringify(payload));
  const signature = signValue(encoded);

  return `${encoded}.${signature}`;
};

exports.verifyToken = (token) => {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    throw new Error("Invalid token format");
  }

  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) {
    throw new Error("Invalid token structure");
  }

  try {
    const expected = signValue(encoded);
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
      throw new Error("Invalid token signature");
    }

    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error("Token expired");
    }

    return payload;
  } catch (error) {
    throw new Error(error.message || "Token verification failed");
  }
};

exports.generateRequestId = () => crypto.randomUUID();
