export const MOBILE_ENGINE_SECRET_HEADER = "x-hellotest-mobile-engine-secret";
export const DEVELOPMENT_MOBILE_ENGINE_SECRET = "hellotest-mobile-engine-dev-secret";
export const MOBILE_ENGINE_MINIMUM_SECRET_LENGTH = 32;

const INSECURE_SECRETS = new Set([
  "admin",
  "change-me",
  "hellotest",
  DEVELOPMENT_MOBILE_ENGINE_SECRET,
  "hellotest-testengine-dev-secret"
]);

const normalizeText = (value: unknown) => String(value || "").trim();

export type MobileEngineClientSecurity = {
  ready: boolean;
  baseUrl: string | null;
  secret: string | null;
  source: "MOBILE_ENGINE_SHARED_SECRET" | "HELLOTEST_MOBILE_ENGINE_SECRET" | null;
  reason: string | null;
};

export function resolveMobileEngineClientSecurity(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): MobileEngineClientSecurity {
  const configuredUrl = normalizeText(environment.MOBILE_ENGINE_URL).replace(/\/+$/, "");
  const canonicalSecret = normalizeText(environment.MOBILE_ENGINE_SHARED_SECRET);
  const legacySecret = normalizeText(environment.HELLOTEST_MOBILE_ENGINE_SECRET);
  const secret = canonicalSecret || legacySecret;
  const production = normalizeText(environment.NODE_ENV).toLowerCase() === "production";

  if (!configuredUrl) {
    return { ready: false, baseUrl: null, secret: null, source: null, reason: "MOBILE_ENGINE_URL is not configured" };
  }

  try {
    const parsed = new URL(configuredUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
  } catch {
    return { ready: false, baseUrl: null, secret: null, source: null, reason: "MOBILE_ENGINE_URL must be an HTTP or HTTPS URL" };
  }

  if (!secret) {
    return {
      ready: false,
      baseUrl: configuredUrl,
      secret: null,
      source: null,
      reason: "MOBILE_ENGINE_SHARED_SECRET is not configured"
    };
  }

  if (
    production
    && (secret.length < MOBILE_ENGINE_MINIMUM_SECRET_LENGTH || INSECURE_SECRETS.has(secret.toLowerCase()))
  ) {
    return {
      ready: false,
      baseUrl: configuredUrl,
      secret: null,
      source: canonicalSecret ? "MOBILE_ENGINE_SHARED_SECRET" : "HELLOTEST_MOBILE_ENGINE_SECRET",
      reason: `MOBILE_ENGINE_SHARED_SECRET must be a non-default secret of at least ${MOBILE_ENGINE_MINIMUM_SECRET_LENGTH} characters in production`
    };
  }

  return {
    ready: true,
    baseUrl: configuredUrl,
    secret,
    source: canonicalSecret ? "MOBILE_ENGINE_SHARED_SECRET" : "HELLOTEST_MOBILE_ENGINE_SECRET",
    reason: null
  };
}

export function buildMobileEngineRequestHeaders(configuration = resolveMobileEngineClientSecurity()) {
  if (!configuration.ready || !configuration.secret) {
    throw new Error(configuration.reason || "Mobile Engine client security is not configured");
  }
  return { [MOBILE_ENGINE_SECRET_HEADER]: configuration.secret };
}

