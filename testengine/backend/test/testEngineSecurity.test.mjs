import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import {
  constantTimeSecretMatches,
  createCorsHook,
  createPrivilegedRunGuard,
  resolveCorsPolicy,
  resolveTestEngineSharedSecret
} from "../dist/lib/testEngineSecurity.js";

const PRODUCTION_SECRET = "production-testengine-secret-with-more-than-32-characters";

const createGuardedApp = async (configuration) => {
  const app = Fastify({ logger: false });
  app.get("/privileged", { preHandler: createPrivilegedRunGuard(configuration) }, async () => ({ ok: true }));
  await app.ready();
  return app;
};

test("production shared-secret configuration fails closed for missing, default, and short values", () => {
  for (const environment of [
    { NODE_ENV: "production" },
    { NODE_ENV: "production", TESTENGINE_SHARED_SECRET: "hellotest-testengine-dev-secret" },
    { NODE_ENV: "production", HELLOTEST_TESTENGINE_SECRET: "too-short" }
  ]) {
    const configuration = resolveTestEngineSharedSecret(environment);
    assert.equal(configuration.ready, false);
    assert.equal(configuration.secret, null);
    assert.match(configuration.reason || "", /shared secret|shared-secret/i);
  }

  const valid = resolveTestEngineSharedSecret({
    NODE_ENV: "production",
    TESTENGINE_SHARED_SECRET: PRODUCTION_SECRET
  });
  assert.equal(valid.ready, true);
  assert.equal(valid.secret, PRODUCTION_SECRET);
  assert.equal(valid.source, "TESTENGINE_SHARED_SECRET");

  const development = resolveTestEngineSharedSecret({ NODE_ENV: "development" });
  assert.equal(development.ready, true);
  assert.equal(development.source, "development-fallback");
});

test("privileged guard accepts both direct-dispatch and Bearer contracts and rejects missing or wrong credentials", async () => {
  const configuration = resolveTestEngineSharedSecret({
    NODE_ENV: "production",
    TESTENGINE_SHARED_SECRET: PRODUCTION_SECRET
  });
  const app = await createGuardedApp(configuration);

  try {
    assert.equal((await app.inject({ method: "GET", url: "/privileged" })).statusCode, 401);
    assert.equal((await app.inject({
      method: "GET",
      url: "/privileged",
      headers: { "x-hellotest-testengine-secret": "wrong" }
    })).statusCode, 401);

    const directDispatch = await app.inject({
      method: "GET",
      url: "/privileged",
      headers: { "x-hellotest-testengine-secret": PRODUCTION_SECRET }
    });
    assert.equal(directDispatch.statusCode, 200);

    const bearer = await app.inject({
      method: "GET",
      url: "/privileged",
      headers: { authorization: `Bearer ${PRODUCTION_SECRET}` }
    });
    assert.equal(bearer.statusCode, 200);
    assert.equal(constantTimeSecretMatches(PRODUCTION_SECRET, PRODUCTION_SECRET), true);
    assert.equal(constantTimeSecretMatches("not-the-secret", PRODUCTION_SECRET), false);
  } finally {
    await app.close();
  }
});

test("a production guard with invalid configuration returns service unavailable instead of falling open", async () => {
  const app = await createGuardedApp(resolveTestEngineSharedSecret({ NODE_ENV: "production" }));

  try {
    const response = await app.inject({
      method: "GET",
      url: "/privileged",
      headers: { authorization: `Bearer ${PRODUCTION_SECRET}` }
    });
    assert.equal(response.statusCode, 503);
    assert.match(response.body, /not configured securely/);
  } finally {
    await app.close();
  }
});

const createCorsApp = async (environment) => {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", createCorsHook(resolveCorsPolicy(environment)));
  app.options("/*", async (_request, reply) => reply.code(204).send());
  app.get("/resource", async () => ({ ok: true }));
  await app.ready();
  return app;
};

test("production CORS denies unconfigured and wildcard browser origins while preserving server-to-server calls", async () => {
  for (const environment of [
    { NODE_ENV: "production" },
    { NODE_ENV: "production", TESTENGINE_CORS_ORIGINS: "*" }
  ]) {
    const app = await createCorsApp(environment);
    try {
      assert.equal((await app.inject({ method: "GET", url: "/resource" })).statusCode, 200);
      assert.equal((await app.inject({
        method: "GET",
        url: "/resource",
        headers: { origin: "https://attacker.example" }
      })).statusCode, 403);
    } finally {
      await app.close();
    }
  }
});

test("CORS emits an exact configured origin and local development permits loopback ports", async () => {
  const production = await createCorsApp({
    NODE_ENV: "production",
    TESTENGINE_CORS_ORIGINS: "https://hellotest.example"
  });
  try {
    const allowed = await production.inject({
      method: "OPTIONS",
      url: "/resource",
      headers: { origin: "https://hellotest.example" }
    });
    assert.equal(allowed.statusCode, 204);
    assert.equal(allowed.headers["access-control-allow-origin"], "https://hellotest.example");
    assert.equal(allowed.headers.vary, "Origin");

    assert.equal((await production.inject({
      method: "GET",
      url: "/resource",
      headers: { origin: "https://other.example" }
    })).statusCode, 403);
  } finally {
    await production.close();
  }

  const development = await createCorsApp({ NODE_ENV: "development" });
  try {
    assert.equal((await development.inject({
      method: "GET",
      url: "/resource",
      headers: { origin: "http://localhost:9876" }
    })).statusCode, 200);
  } finally {
    await development.close();
  }
});
