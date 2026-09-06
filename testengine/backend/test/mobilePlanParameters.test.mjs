import assert from "node:assert/strict";
import test from "node:test";

test("queued API and mobile blocks execute in plan order and exchange captured parameters", async (t) => {
  const environment = {
    HELLOTEST_API_BASE_URL: "http://control-plane.test",
    TESTENGINE_SHARED_SECRET: "hellotest-testengine-dev-secret",
    MOBILE_ENGINE_URL: "http://mobile-engine.test",
    MOBILE_ENGINE_SHARED_SECRET: "hellotest-mobile-engine-dev-secret",
    NODE_ENV: "development"
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const { startQueueWorker } = await import("../dist/lib/queueWorker.js");
  const order = [];
  const reports = [];
  let completed;
  const json = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const body = options.body ? JSON.parse(options.body) : {};
    if (url.hostname === "app.test") {
      order.push(url.pathname);
      if (url.pathname === "/login") return json({ token: "api-session" });
      assert.equal(url.pathname, "/verify/mobile-result");
      return json({ next: "api-next" });
    }
    if (url.hostname === "mobile-engine.test") {
      const ids = body.steps.map((step) => step.id);
      order.push(ids.join("+"));
      assert.equal(body.parameter_values["s.tenant"], "team");
      if (ids[0] === "mobile-1") {
        assert.deepEqual(ids, ["mobile-1", "mobile-2"]);
        assert.equal(body.parameter_values["t.session_token"], "api-session");
        return json({ status: "passed", results: [
          { step_id: "mobile-1", status: "passed", captures: { "t.mobile_token": "mobile-result" } },
          { step_id: "mobile-2", status: "passed", captures: {} }
        ] });
      }
      assert.deepEqual(ids, ["mobile-3"]);
      assert.equal(body.parameter_values["t.next_token"], "api-next");
      assert.equal(body.parameter_values["t.mobile_token"], "mobile-result");
      return json({ status: "passed", results: [{ step_id: "mobile-3", status: "passed", captures: {} }] });
    }
    assert.equal(url.hostname, "control-plane.test");
    if (url.pathname.endsWith("/report")) reports.push({ path: url.pathname, ...body });
    if (url.pathname.endsWith("/complete")) completed = body;
    return json({ status: "running", captures: body.captures || {} });
  };
  const steps = [
    { id: "api-1", order: 1, step_type: "api", api_request: { url: "http://app.test/login", captures: [{ path: "$.token", parameter: "session_token" }] } },
    { id: "mobile-1", order: 2, step_type: "android", automation_code: "await android.tap('Login.Submit');" },
    { id: "mobile-2", order: 3, step_type: "android", automation_code: "await android.pause(0);" },
    { id: "api-2", order: 4, step_type: "api", api_request: { url: "http://app.test/verify/@t.mobile_token", captures: [{ path: "$.next", parameter: "next_token" }] } },
    { id: "mobile-3", order: 5, step_type: "android", automation_code: "await android.pause(0);" }
  ];
  const job = {
    id: "job-order", test_case_id: "case-order", test_case_title: "Mixed plan", runtime_state: {},
    payload: {
      engine_run_id: "run-order", hellotest_test_case_id: "case-order", steps,
      artifact_policy: { video_mode: "off" }, suite_parameters: { tenant: "team" }
    }
  };
  let leased = false;
  const errors = [];
  const worker = startQueueWorker({ info() {}, error: (...args) => errors.push(args) }, undefined, {
    isConfigured: () => true,
    pollIntervalMs: 60_000,
    pollConcurrency: 1,
    leaseNextJob: async () => {
      if (leased) return null;
      leased = true;
      return job;
    }
  });
  t.after(() => worker.stop({ timeoutMs: 2_000 }));
  await worker.pollNow();
  await worker.stop({ timeoutMs: 2_000 });
  assert.deepEqual(errors, []);
  assert.equal(completed?.status, "passed", completed?.error);
  assert.deepEqual(order, ["/login", "mobile-1+mobile-2", "/verify/mobile-result", "mobile-3"]);
  assert.equal(reports.length, steps.length);
  assert.equal(reports.find((report) => report.path.includes("/mobile-1/")).captures["t.mobile_token"], "mobile-result");
});
