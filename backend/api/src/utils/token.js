const crypto = require("crypto");

const TOKEN_TTL_SECONDS = 60 * 60 * 12;
const secret = process.env.SESSION_SECRET || "hellotest-dev-secret";

const base64url = (value) => Buffer.from(value).toString("base64url");

const signValue = (value) => {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
};

// Improved password hashing with salt
exports.hashPassword = (password) => {
  if (!password || typeof password !== "string") {
    throw new Error("Password must be a non-empty string");
  }
  
  // Use a fixed salt in dev mode, should use bcrypt in production
  const salt = process.env.PASSWORD_SALT || "hellotest-dev-salt";
  return crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha256")
    .toString("hex");
};

// Verify password with timing-safe comparison
exports.verifyPassword = (password, hash) => {
  const computed = exports.hashPassword(password);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed),
      Buffer.from(hash)
    );
  } catch {
    return false;
  }
};

exports.createToken = (user) => {
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name || null,
    role: user.role || "member",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    jti: crypto.randomUUID() // JWT ID for token revocation tracking
  };

  const encoded = base64url(JSON.stringify(payload));
  const signature = signValue(encoded);

  return `${encoded}.${signature}`;
};

exports.verifyToken = (token) => {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    throw new Error("Invalid token format");
  }

  const [encoded, signature] = token.split(".");
  
  if (!encoded || !signature) {
    throw new Error("Invalid token structure");
  }

  try {
    const expected = signValue(encoded);

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
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

exports.generateRequestId = () => {
  return crypto.randomUUID();
};
