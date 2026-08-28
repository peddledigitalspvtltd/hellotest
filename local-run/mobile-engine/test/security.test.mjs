import assert from "node:assert/strict";
import test from "node:test";

import {
  constantTimeSecretEqual,
  DEVELOPMENT_MOBILE_ENGINE_SECRET,
  MOBILE_ENGINE_SECRET_HEADER,
  MOBILE_SESSION_TOKEN_HEADER,
  resolveMobileEngineSecurity
} from "../src/security.js";
import { app, sessions } from "../src/server.js";

const PRODUCTION_SECRET = "production-mobile-engine-secret-with-more-than-32-characters";

test("production Mobile Engine security rejects missing, default, and short credentials", () => {
  for (const environment of [
    { NODE_ENV: "production" },
    { NODE_ENV: "production", MOBILE_ENGINE_SHARED_SECRET: DEVELOPMENT_MOBILE_ENGINE_SECRET },
    { NODE_ENV: "production", HELLOTEST_MOBILE_ENGINE_SECRET: "too-short" }
  ]) {
    assert.throws(
      () => resolveMobileEngineSecurity(environment),
      /MOBILE_ENGINE_SHARED_SECRET/
    );
  }

  const valid = resolveMobileEngineSecurity({
    NODE_ENV: "production",
    MOBILE_ENGINE_SHARED_SECRET: PRODUCTION_SECRET
  });
  assert.equal(valid.secret, PRODUCTION_SECRET);
  assert.equal(valid.source, "MOBILE_ENGINE_SHARED_SECRET");
  assert.equal(valid.production, true);
});

test("secret comparison uses fixed-length digests and preserves exact matching", () => {
  assert.equal(constantTimeSecretEqual(PRODUCTION_SECRET, PRODUCTION_SECRET), true);
  assert.equal(constantTimeSecretEqual("wrong", PRODUCTION_SECRET), false);
  assert.equal(constantTimeSecretEqual(`${PRODUCTION_SECRET} `, PRODUCTION_SECRET), false);
});

test("health and capabilities stay public while every mobile route requires a credential", async () => {
  assert.equal((await app.inject({ method: "GET", url: "/health/live" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/capabilities" })).statusCode, 200);

  assert.equal((await app.inject({
    method: "GET",
    url: "/api/v1/mobile/recorder/sessions/missing"
  })).statusCode, 401);
  assert.equal((await app.inject({
    method: "GET",
    url: "/api/v1/mobile/recorder/sessions/missing",
    headers: { [MOBILE_ENGINE_SECRET_HEADER]: "wrong" }
  })).statusCode, 401);
  assert.equal((await app.inject({
    method: "GET",
    url: "/api/v1/mobile/recorder/sessions/missing",
    headers: { [MOBILE_ENGINE_SECRET_HEADER]: DEVELOPMENT_MOBILE_ENGINE_SECRET }
  })).statusCode, 404);
});

test("recorder tokens are scoped to one session and cannot authorize execution", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/mobile/recorder/sessions",
    headers: { [MOBILE_ENGINE_SECRET_HEADER]: DEVELOPMENT_MOBILE_ENGINE_SECRET },
    payload: { recorder_mode: "local", appium_server_url: "http://127.0.0.1:9" }
  });
  assert.equal(created.statusCode, 200);
  const session = created.json();
  const statusUrl = new URL(session.status_url, "http://mobile-engine.local");
  const sessionToken = statusUrl.searchParams.get("session_token");
  assert.ok(sessionToken);

  try {
    assert.equal((await app.inject({ method: "GET", url: session.status_url })).statusCode, 200);
    assert.equal((await app.inject({
      method: "GET",
      url: `/api/v1/mobile/recorder/sessions/not-${session.id}`,
      headers: { [MOBILE_SESSION_TOKEN_HEADER]: sessionToken }
    })).statusCode, 401);
    assert.equal((await app.inject({
      method: "POST",
      url: "/api/v1/mobile/execute",
      headers: { [MOBILE_SESSION_TOKEN_HEADER]: sessionToken },
      payload: { steps: [] }
    })).statusCode, 401);
  } finally {
    const retained = sessions.get(session.id);
    await retained?.driver?.deleteSession().catch(() => undefined);
    sessions.delete(session.id);
  }
});

