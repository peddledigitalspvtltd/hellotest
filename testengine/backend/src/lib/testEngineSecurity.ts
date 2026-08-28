import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

const DEVELOPMENT_SHARED_SECRET = "hellotest-testengine-dev-secret";
const MINIMUM_PRODUCTION_SECRET_LENGTH = 32;
const INSECURE_SHARED_SECRETS = new Set([
  "admin",
  "change-me",
  "hellotest-dev-secret",
  "hellotest-local-dev-secret",
  DEVELOPMENT_SHARED_SECRET,
  "hellotest-verification-secret"
]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const DEFAULT_LOCAL_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:4173",
  "http://localhost:4301",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:4301",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8080"
]);

export type SharedSecretConfig = {
  ready: boolean;
  production: boolean;
  secret: string | null;
  source: "TESTENGINE_SHARED_SECRET" | "HELLOTEST_TESTENGINE_SECRET" | "development-fallback" | null;
  reason: string | null;
};

export type CorsPolicy = {
  production: boolean;
  allowAnyOrigin: boolean;
  configuredOrigins: ReadonlySet<string>;
  allowLoopbackOrigins: boolean;
};

const normalizeText = (value: unknown) => String(value || "").trim();

const isProduction = (environment: NodeJS.ProcessEnv) =>
  normalizeText(environment.NODE_ENV).toLowerCase() === "production";

export function resolveTestEngineSharedSecret(environment: NodeJS.ProcessEnv = process.env): SharedSecretConfig {
  const production = isProduction(environment);
  const configuredSharedSecret = normalizeText(environment.TESTENGINE_SHARED_SECRET);
  const configuredHelloTestSecret = normalizeText(environment.HELLOTEST_TESTENGINE_SECRET);
  const secret = configuredSharedSecret || configuredHelloTestSecret || (production ? "" : DEVELOPMENT_SHARED_SECRET);
  const source = configuredSharedSecret
    ? "TESTENGINE_SHARED_SECRET"
    : configuredHelloTestSecret
      ? "HELLOTEST_TESTENGINE_SECRET"
      : production
        ? null
        : "development-fallback";

  if (!secret) {
    return {
      ready: false,
      production,
      secret: null,
      source,
      reason: "Test Engine shared-secret authentication is not configured"
    };
  }

  if (
    production
    && (
      INSECURE_SHARED_SECRETS.has(secret.toLowerCase())
      || secret.length < MINIMUM_PRODUCTION_SECRET_LENGTH
    )
  ) {
    return {
      ready: false,
      production,
      secret: null,
      source,
      reason: `Test Engine shared secret must be a non-default value of at least ${MINIMUM_PRODUCTION_SECRET_LENGTH} characters in production`
    };
  }

  return {
    ready: true,
    production,
    secret,
    source,
    reason: null
  };
}

const digestSecret = (value: string) => createHash("sha256").update(value, "utf8").digest();

export function constantTimeSecretMatches(provided: string, expected: string) {
  return timingSafeEqual(digestSecret(provided), digestSecret(expected));
}

const getHeaderValues = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean);
  }

  const normalized = normalizeText(value);
  return normalized ? [normalized] : [];
};

export function extractTestEngineSecrets(request: FastifyRequest) {
  const candidates = [
    ...getHeaderValues(request.headers["x-hellotest-testengine-secret"]),
    ...getHeaderValues(request.headers["x-testengine-secret"])
  ];

  for (const authorization of getHeaderValues(request.headers.authorization)) {
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization);

    if (bearerMatch) {
      const bearerSecret = normalizeText(bearerMatch[1]);
      if (bearerSecret) {
        candidates.push(bearerSecret);
      }
    }
  }

  return candidates;
}

export function createPrivilegedRunGuard(config: SharedSecretConfig) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("cache-control", "no-store");

    if (!config.ready || !config.secret) {
      reply.code(503).send({
        message: "Test Engine shared-secret authentication is not configured securely"
      });
      return;
    }

    const authorized = extractTestEngineSecrets(request)
      .some((providedSecret) => constantTimeSecretMatches(providedSecret, config.secret as string));

    if (!authorized) {
      reply
        .header("www-authenticate", 'Bearer realm="hellotest-testengine"')
        .code(401)
        .send({ message: "Unauthorized Test Engine request" });
    }
  };
}

const parseOrigins = (value: unknown) => normalizeText(value)
  .split(",")
  .map((entry) => entry.trim().replace(/\/$/, ""))
  .filter(Boolean);

export function resolveCorsPolicy(environment: NodeJS.ProcessEnv = process.env): CorsPolicy {
  const production = isProduction(environment);
  const configured = parseOrigins(
    environment.TESTENGINE_CORS_ORIGINS
    || environment.CORS_ORIGINS
    || environment.CORS_ORIGIN
  );
  const allowAnyOrigin = configured.includes("*") && !production;
  const configuredOrigins = new Set(configured.filter((origin) => origin !== "*"));

  if (!production) {
    for (const origin of DEFAULT_LOCAL_ORIGINS) {
      configuredOrigins.add(origin);
    }
  }

  return {
    production,
    allowAnyOrigin,
    configuredOrigins,
    allowLoopbackOrigins: !production
  };
}

const isLoopbackOrigin = (origin: string) => {
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
};

export function isCorsOriginAllowed(origin: string, policy: CorsPolicy) {
  const normalizedOrigin = normalizeText(origin).replace(/\/$/, "");
  return Boolean(
    normalizedOrigin
    && (
      policy.allowAnyOrigin
      || policy.configuredOrigins.has(normalizedOrigin)
      || (policy.allowLoopbackOrigins && isLoopbackOrigin(normalizedOrigin))
    )
  );
}

export function createCorsHook(policy: CorsPolicy) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = typeof request.headers.origin === "string"
      ? request.headers.origin
      : "";

    if (!origin) {
      return;
    }

    if (!isCorsOriginAllowed(origin, policy)) {
      reply.code(403).send({ message: "Origin is not allowed by the Test Engine CORS policy" });
      return;
    }

    reply.header("access-control-allow-origin", origin);
    reply.header("vary", "Origin");
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    reply.header(
      "access-control-allow-headers",
      "authorization,content-type,x-api-key,x-hellotest-recorder-token,x-hellotest-testengine-secret,x-testengine-secret"
    );
    reply.header("access-control-max-age", "600");

    if (request.method === "OPTIONS") {
      reply.code(204).send();
    }
  };
}
