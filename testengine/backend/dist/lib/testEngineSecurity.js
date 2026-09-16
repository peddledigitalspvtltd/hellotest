import { createHash, timingSafeEqual } from "node:crypto";
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
const normalizeText = (value) => String(value || "").trim();
const isProduction = (environment) => normalizeText(environment.NODE_ENV).toLowerCase() === "production";
export function resolveTestEngineSharedSecret(environment = process.env) {
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
    if (production
        && (INSECURE_SHARED_SECRETS.has(secret.toLowerCase())
            || secret.length < MINIMUM_PRODUCTION_SECRET_LENGTH)) {
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
const digestSecret = (value) => createHash("sha256").update(value, "utf8").digest();
export function constantTimeSecretMatches(provided, expected) {
    return timingSafeEqual(digestSecret(provided), digestSecret(expected));
}
const getHeaderValues = (value) => {
    if (Array.isArray(value)) {
        return value.map(normalizeText).filter(Boolean);
    }
    const normalized = normalizeText(value);
    return normalized ? [normalized] : [];
};
export function extractTestEngineSecrets(request) {
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
export function createPrivilegedRunGuard(config) {
    return async (request, reply) => {
        reply.header("cache-control", "no-store");
        if (!config.ready || !config.secret) {
            reply.code(503).send({
                message: "Test Engine shared-secret authentication is not configured securely"
            });
            return;
        }
        const authorized = extractTestEngineSecrets(request)
            .some((providedSecret) => constantTimeSecretMatches(providedSecret, config.secret));
        if (!authorized) {
            reply
                .header("www-authenticate", 'Bearer realm="hellotest-testengine"')
                .code(401)
                .send({ message: "Unauthorized Test Engine request" });
        }
    };
}
const normalizeOrigin = (value) => {
    const text = normalizeText(value);
    if (!/^https?:\/\/[^/?#\\]+\/?$/i.test(text))
        return null;
    try {
        const url = new URL(text);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
            || url.pathname !== "/" || url.search || url.hash)
            return null;
        return url.origin;
    }
    catch {
        return null;
    }
};
const parseOrigins = (value) => normalizeText(value)
    .split(",")
    .map((entry) => entry.trim() === "*" ? "*" : normalizeOrigin(entry))
    .filter((entry) => Boolean(entry));
export function resolveCorsPolicy(environment = process.env) {
    const production = isProduction(environment);
    const configured = parseOrigins(environment.TESTENGINE_CORS_ORIGINS
        || environment.CORS_ORIGINS
        || environment.CORS_ORIGIN);
    const allowAnyOrigin = configured.includes("*") && !production && !normalizeText(environment.HELLOTEST_INSPECTOR_TOKEN);
    const configuredOrigins = new Set(configured.filter((origin) => origin !== "*"));
    if (!production && !normalizeText(environment.HELLOTEST_INSPECTOR_TOKEN)) {
        for (const origin of DEFAULT_LOCAL_ORIGINS) {
            configuredOrigins.add(origin);
        }
    }
    return {
        production,
        allowAnyOrigin,
        configuredOrigins,
        allowLoopbackOrigins: !production && !normalizeText(environment.HELLOTEST_INSPECTOR_TOKEN),
        pairedLocalAgent: Boolean(normalizeText(environment.HELLOTEST_INSPECTOR_TOKEN))
    };
}
const isLoopbackOrigin = (origin) => {
    try {
        const parsed = new URL(origin);
        return (parsed.protocol === "http:" || parsed.protocol === "https:") && LOOPBACK_HOSTS.has(parsed.hostname);
    }
    catch {
        return false;
    }
};
export function isCorsOriginAllowed(origin, policy) {
    const normalizedOrigin = normalizeOrigin(origin);
    return Boolean(normalizedOrigin
        && (policy.allowAnyOrigin
            || policy.configuredOrigins.has(normalizedOrigin)
            || (policy.allowLoopbackOrigins && isLoopbackOrigin(normalizedOrigin))));
}
export function createCorsHook(policy) {
    return async (request, reply) => {
        const origin = typeof request.headers.origin === "string"
            ? request.headers.origin
            : "";
        if (!origin) {
            return;
        }
        if (!isCorsOriginAllowed(origin, policy)) {
            reply.code(403).send({ code: policy.pairedLocalAgent ? "INSPECTION_ORIGIN_NOT_PAIRED" : "TESTENGINE_ORIGIN_DENIED", message: policy.pairedLocalAgent
                    ? "This local agent is paired with another HelloTest origin. Stop it and run the setup downloaded from the HelloTest page you are using."
                    : "Origin is not allowed by the Test Engine CORS policy" });
            return;
        }
        reply.header("access-control-allow-origin", origin);
        reply.header("vary", "Origin");
        reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
        reply.header("access-control-allow-headers", "authorization,content-type,x-api-key,x-hellotest-recorder-token,x-hellotest-agent-token,x-hellotest-testengine-secret,x-testengine-secret");
        reply.header("access-control-max-age", "600");
        if (request.headers["access-control-request-private-network"] === "true") {
            reply.header("access-control-allow-private-network", "true");
        }
        if (request.method === "OPTIONS") {
            reply.code(204).send();
        }
    };
}
