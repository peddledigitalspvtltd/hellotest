import assert from "node:assert/strict";
import test from "node:test";

import { executeAndroidSteps } from "../dist/lib/mobileEngine.js";
import {
  buildMobileEngineRequestHeaders,
  DEVELOPMENT_MOBILE_ENGINE_SECRET,
  MOBILE_ENGINE_SECRET_HEADER,
  resolveMobileEngineClientSecurity
} from "../dist/lib/mobileEngineSecurity.js";

const PRODUCTION_SECRET = "production-mobile-engine-secret-with-more-than-32-characters";

test("Mobile Engine client configuration is independently authenticated and production-safe", () => {
  assert.equal(resolveMobileEngineClientSecurity({ MOBILE_ENGINE_URL: "http://mobile:4312" }).ready, false);
  assert.equal(resolveMobileEngineClientSecurity({
    NODE_ENV: "production",
    MOBILE_ENGINE_URL: "http://mobile:4312",
    MOBILE_ENGINE_SHARED_SECRET: DEVELOPMENT_MOBILE_ENGINE_SECRET
  }).ready, false);

  const valid = resolveMobileEngineClientSecurity({
    NODE_ENV: "production",
    MOBILE_ENGINE_URL: "https://mobile.example",
    MOBILE_ENGINE_SHARED_SECRET: PRODUCTION_SECRET
  });
  assert.equal(valid.ready, true);
  assert.equal(valid.source, "MOBILE_ENGINE_SHARED_SECRET");
  assert.deepEqual(buildMobileEngineRequestHeaders(valid), {
    [MOBILE_ENGINE_SECRET_HEADER]: PRODUCTION_SECRET
  });
  for (const baseUrl of ["https://admin:password@mobile.example", "https://mobile.example?token=secret", "https://mobile.example#fragment"]) {
    assert.equal(resolveMobileEngineClientSecurity({ MOBILE_ENGINE_URL: baseUrl, MOBILE_ENGINE_SHARED_SECRET: PRODUCTION_SECRET }).ready, false);
  }
});

test("Android execution sends the dedicated Mobile Engine credential header", async () => {
  const previous = {
    MOBILE_ENGINE_URL: process.env.MOBILE_ENGINE_URL,
    MOBILE_ENGINE_SHARED_SECRET: process.env.MOBILE_ENGINE_SHARED_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    fetch: globalThis.fetch
  };
  process.env.MOBILE_ENGINE_URL = "http://mobile-engine:4312";
  process.env.MOBILE_ENGINE_SHARED_SECRET = DEVELOPMENT_MOBILE_ENGINE_SECRET;
  process.env.NODE_ENV = "development";

  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "http://mobile-engine:4312/api/v1/mobile/execute");
    assert.equal(init.headers[MOBILE_ENGINE_SECRET_HEADER], DEVELOPMENT_MOBILE_ENGINE_SECRET);
    assert.equal(init.headers["content-type"], "application/json");
    const payload = JSON.parse(init.body);
    assert.equal(payload.parameter_values["s.tenant"], "suite");
    assert.equal(payload.parameter_values["r.first name"], "row default");
    assert.equal(payload.parameter_values["r.amount"], "12");
    assert.equal(payload.parameter_values["r.token"], "resumed token");
    return new Response(JSON.stringify({ status: "passed", results: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await executeAndroidSteps({
      suite_parameters: { tenant: "suite" },
      case_parameters: { "first name": "case override" },
      data_set: { source: "test_case", mode: "table", rows: [{ "First Name": "row default", amount: 12 }] },
      environment: { variables: [{ key: "token", value: "environment token" }] }
    }, [{ id: "mobile", step_type: "android" }], { "r.token": "resumed token" });
    assert.deepEqual(result, { status: "passed", results: [] });
  } finally {
    globalThis.fetch = previous.fetch;
    for (const name of ["MOBILE_ENGINE_URL", "MOBILE_ENGINE_SHARED_SECRET", "NODE_ENV"]) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
