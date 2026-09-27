const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMobileRecorderPlan, resolveMobileRecorderPlatform } = require("../../backend/domain/mobileRecorderPlan");
const { persistMobileRecorderPlan } = require("../../backend/services/mobileRecorderPersistence.service");

function storageFixture({ failAt = 0 } = {}) {
  let rows = [
    { id: "first", step_order: 1, step_type: "ios", action: "Manual sign in", expected_result: "Welcome", automation_code: "original first", group_id: "shared-instance", reusable_group_id: "shared" },
    { id: "second", step_order: 2, step_type: "ios", action: "Manual checkout", expected_result: "Confirmation", automation_code: "original second" }
  ];
  const original = structuredClone(rows);
  const events = [];
  let active = false;
  let writes = 0;
  const input = { caseId: "case", applicationPlatform: "unified", platform: "ios", capturedActions: [{ type: "tap", locator: "~Sign in" }, { type: "tap", locator: "~Checkout" }] };
  const ports = {
    transaction: async (callback) => {
      assert.equal(active, false); active = true; events.push("begin");
      const before = structuredClone(rows);
      try { const result = await callback(); events.push("commit"); return result; }
      catch (error) { rows = before; events.push("rollback"); throw error; }
      finally { active = false; }
    },
    lockCase: async (id) => { assert.equal(active, true); assert.equal(id, "case"); events.push("lock"); return { id }; },
    readSteps: async () => { assert.equal(active, true); events.push("read"); return structuredClone(rows); },
    updateStep: async (id, update, options) => {
      assert.equal(active, true); assert.equal(options.syncSharedGroup, false); writes++; events.push(`update:${id}`);
      if (writes === failAt) throw new Error("Storage write failed");
      Object.assign(rows.find((row) => row.id === id), update);
    },
    createStep: async (input, options) => { assert.equal(active, true); assert.equal(options.syncSharedGroup, false); rows.push({ ...input, id: "new" }); return { id: "new" }; },
    updateCaseReadiness: async (id) => { assert.equal(active, true); assert.equal(id, "case"); events.push("readiness"); }
  };
  return { input, ports, events, original, get rows() { return rows; } };
}

test("native mappings commit atomically and preserve manual prose and shared-group identity", async () => {
  const f = storageFixture();
  const result = await persistMobileRecorderPlan(f.input, f.ports);
  assert.deepEqual(f.events, ["begin", "lock", "read", "update:first", "update:second", "readiness", "commit"]);
  assert.equal(result.length, 2);
  assert.equal(f.rows[0].action, "Manual sign in");
  assert.equal(f.rows[0].expected_result, "Welcome");
  assert.equal(f.rows[0].reusable_group_id, "shared");
});

test("a later storage failure rolls back earlier native step writes", async () => {
  const f = storageFixture({ failAt: 2 });
  await assert.rejects(persistMobileRecorderPlan(f.input, f.ports), /Storage write failed/);
  assert.deepEqual(f.rows, f.original);
  assert.equal(f.events.at(-1), "rollback");
});

test("case readiness failures roll back the same step transaction", async () => {
  const f = storageFixture();
  await assert.rejects(persistMobileRecorderPlan(f.input, { ...f.ports, updateCaseReadiness: async () => { throw new Error("Readiness update failed"); } }), /Readiness update failed/);
  assert.deepEqual(f.rows, f.original);
  assert.equal(f.events.at(-1), "rollback");
});

test("a deleted target is rejected after the case lock instead of creating a replacement step", async () => {
  const f = storageFixture();
  await assert.rejects(persistMobileRecorderPlan({ ...f.input, targetStepId: "deleted" }, f.ports), { code: "AUTOMATION_RECORDER_TARGET_CHANGED", statusCode: 409 });
  assert.deepEqual(f.rows, f.original);
  assert.deepEqual(f.events, ["begin", "lock", "read", "rollback"]);
});

test("unsupported actions are rejected before any step can be changed", async () => {
  const f = storageFixture();
  for (const action of [{ type: "swipe" }, { type: "pressBack" }]) {
    await assert.rejects(persistMobileRecorderPlan({ ...f.input, capturedActions: [f.input.capturedActions[0], action] }, f.ports), { code: "AUTOMATION_RECORDER_INPUT_INVALID" });
  }
  assert.deepEqual(f.rows, f.original);
  assert.equal(f.events.some((event) => event.startsWith("update:")), false);
});

test("invalid or absent coordinates never compile into an unintended origin tap", () => {
  for (const action of [{ type: "tap" }, { type: "tap", locator: "point:NaN,3" }, { type: "tap", locator: "point:-1,3" }, { type: "tap", locator: "point:,3" }, { type: "tap", x: Infinity, y: 3 }]) {
    assert.throws(() => buildMobileRecorderPlan({ caseId: "case", applicationPlatform: "android", capturedActions: [action] }), { code: "AUTOMATION_RECORDER_INPUT_INVALID" });
  }
});

test("repository references are compiled as literal data and targeted actions keep their sequence", async () => {
  const dangerousLocator = '~button"); throw new Error("injected"); //';
  const expectedValue = 'line 1\nline 2"; throw new Error("injected")';
  const plan = buildMobileRecorderPlan({ caseId: "case", targetStepId: "target", existingSteps: [{ id: "target", step_type: "ios", step_order: 1 }], capturedActions: [
    { index: 1, type: "tap", locator: "~original" }, { index: 2, type: "type", value: expectedValue }
  ], repositoryReferences: new Map([[1, { reference: dangerousLocator, locator: "~recorded" }]]) });
  const calls = [];
  const driver = { $: async (selector) => { calls.push(selector); return { waitForDisplayed: async () => {}, click: async () => calls.push("click") }; }, keys: async (value) => calls.push(value) };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction("driver", plan[0].input.automation_code)(driver);
  assert.deepEqual(calls, [dangerousLocator, "click", expectedValue]);
  assert.equal(plan.length, 1);
});

test("malformed stored configuration targets do not throw a provider-independent TypeError", () => {
  assert.equal(resolveMobileRecorderPlatform({ configuration: { targets: {}, mobile_os: "iOS" } }), "ios");
});
