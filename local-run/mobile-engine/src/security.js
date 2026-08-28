import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const MOBILE_ENGINE_SECRET_HEADER = "x-hellotest-mobile-engine-secret";
export const MOBILE_SESSION_TOKEN_HEADER = "x-hellotest-mobile-session-token";
export const DEVELOPMENT_MOBILE_ENGINE_SECRET = "hellotest-mobile-engine-dev-secret";
export const MOBILE_ENGINE_MINIMUM_SECRET_LENGTH = 32;

const INSECURE_MOBILE_ENGINE_SECRETS = new Set([
  "admin",
  "change-me",
  "hellotest",
  DEVELOPMENT_MOBILE_ENGINE_SECRET,
  "hellotest-testengine-dev-secret"
]);

const normalizeText = (value) => String(value || "").trim();
const digest = (value) => createHash("sha256").update(String(value || ""), "utf8").digest();

export const constantTimeSecretEqual = (candidate, expected) => {
  const candidateDigest = digest(candidate);
  const expectedDigest = digest(expected);
  return timingSafeEqual(candidateDigest, expectedDigest);
};

export function resolveMobileEngineSecurity(environment = process.env) {
  const production = normalizeText(environment.NODE_ENV).toLowerCase() === "production";
  const configured = normalizeText(
    environment.MOBILE_ENGINE_SHARED_SECRET
      || environment.HELLOTEST_MOBILE_ENGINE_SECRET
  );
  const secret = configured || (production ? "" : DEVELOPMENT_MOBILE_ENGINE_SECRET);

  if (production && !secret) {
    throw new Error("MOBILE_ENGINE_SHARED_SECRET is required when NODE_ENV=production");
  }

  if (
    production
    && (
      secret.length < MOBILE_ENGINE_MINIMUM_SECRET_LENGTH
      || INSECURE_MOBILE_ENGINE_SECRETS.has(secret.toLowerCase())
    )
  ) {
    throw new Error(
      `MOBILE_ENGINE_SHARED_SECRET must be a non-default secret of at least ${MOBILE_ENGINE_MINIMUM_SECRET_LENGTH} characters in production`
    );
  }

  return {
    secret,
    secretDigest: digest(secret),
    source: configured
      ? (normalizeText(environment.MOBILE_ENGINE_SHARED_SECRET) ? "MOBILE_ENGINE_SHARED_SECRET" : "HELLOTEST_MOBILE_ENGINE_SECRET")
      : "development-fallback",
    production
  };
}

export const generateRecorderSessionToken = () => randomBytes(32).toString("base64url");
export const digestRecorderSessionToken = (token) => digest(token);

const firstHeaderValue = (value) => Array.isArray(value) ? value[0] : value;

const matchesDigest = (candidate, expectedDigest) => {
  const candidateDigest = digest(candidate);
  const normalizedExpected = Buffer.isBuffer(expectedDigest)
    ? expectedDigest
    : Buffer.alloc(candidateDigest.length);
  return timingSafeEqual(candidateDigest, normalizedExpected);
};

export function createMobileEngineRouteGuard({ security, resolveSessionTokenDigest } = {}) {
  if (!security?.secretDigest) {
    throw new Error("A resolved Mobile Engine security contract is required");
  }

  return async function mobileEngineRouteGuard(request, reply) {
    const path = String(request.raw?.url || request.url || "").split("?", 1)[0];
    if (path !== "/api/v1/mobile" && !path.startsWith("/api/v1/mobile/")) return;

    const serviceSecret = normalizeText(firstHeaderValue(request.headers?.[MOBILE_ENGINE_SECRET_HEADER]));
    const serviceAuthorized = matchesDigest(serviceSecret, security.secretDigest);

    let sessionAuthorized = false;
    const sessionToken = normalizeText(
      firstHeaderValue(request.headers?.[MOBILE_SESSION_TOKEN_HEADER])
      || request.query?.session_token
    );
    if (sessionToken && typeof resolveSessionTokenDigest === "function") {
      const expectedSessionDigest = resolveSessionTokenDigest(request);
      sessionAuthorized = matchesDigest(sessionToken, expectedSessionDigest);
    } else {
      // Preserve a uniform digest comparison path when no scoped token is supplied.
      matchesDigest("", null);
    }

    if (serviceAuthorized || sessionAuthorized) return;

    return reply
      .code(401)
      .header("cache-control", "no-store")
      .send({
        code: "MOBILE_ENGINE_UNAUTHORIZED",
        message: "A valid Mobile Engine credential is required."
      });
  };
}
