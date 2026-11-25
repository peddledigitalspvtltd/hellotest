import assert from "node:assert/strict";
import test from "node:test";
import { handoverAutomationRun } from "../../frontend/lib/automationExecution.ts";
import { AutomationStartError, confirmReviewedAutomationRun, retrySavedAutomationRun } from "../../frontend/lib/automationRunDispatch.ts";
const input = { project_id: "project", app_type_id: "web", test_case_ids: ["case", "case"], created_by: "author", test_environment_id: "environment", test_configuration_id: "configuration", test_data_set_id: "data", execution_hooks: [{ test_case_id: "setup", phase: "before" }] };
for (const mode of ["local", "remote"]) test(`${mode} hands its scope and context to the execution API exactly once`, async () => {
  const calls = [];
  const client = { createLocalRun: async payload => { calls.push(["local", payload]); return { id: "local-run" }; }, create: async payload => { calls.push(["remote", payload]); return { id: "remote-run" }; }, start: () => assert.fail("Execution creation already dispatches; a second start is invalid") };
  const result = await handoverAutomationRun(client, mode, input);
  assert.equal(result.id, `${mode}-run`);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [mode, { ...input, test_case_ids: ["case"], ...(mode === "remote" ? { execution_mode: "remote" } : {}) }]);
  assert.equal("engine_base_url" in calls[0][1], false);
});

test("handoff keeps API failures visible and never starts an empty selection", async () => {
  const failure = new Error("Test Engine unavailable");
  const client = { create: async () => { throw failure; }, createLocalRun: async () => { throw failure; } };
  await assert.rejects(handoverAutomationRun(client, "remote", input), error => error === failure);
  await assert.rejects(handoverAutomationRun(client, "local", { ...input, test_case_ids: [] }), /Select at least one/);
});

test("reviewed remote dispatch retains its request ID and presents saved-run recovery instead of reporting success", async () => {
  const attempts = [];
  const response = await handoverAutomationRun({
    create: async (payload, options) => {
      attempts.push({ payload, options });
      return { id: "saved", dispatch_notice: "Connect the Test Engine." };
    }
  }, "remote", input, "request-1234");
  assert.deepEqual(attempts[0].options, { idempotencyKey: "request-1234" });
  const scope = { projectId: "project", appTypeId: "web", caseIds: ["case"], mode: "remote" };
  await assert.rejects(confirmReviewedAutomationRun(response, scope, async id => ({
    id, project_id: "project", app_type_id: "web", status: "queued"
  })), error => error instanceof AutomationStartError && error.receipt.id === "saved" && /Connect the Test Engine/.test(error.message));
  await assert.rejects(confirmReviewedAutomationRun({ id: "saved", started: true, queued_for_engine_count: 0 }, scope, async () =>
    assert.fail("An explicit rejected dispatch must not be concealed by Run status")
  ), error => error instanceof AutomationStartError && error.receipt.retryAllowed === false);
});

test("a transient saved-run lookup failure keeps same-run recovery available", async () => {
  const scope = { projectId: "project", appTypeId: "web", caseIds: ["case"], mode: "remote" };
  let receipt;
  await assert.rejects(confirmReviewedAutomationRun({ id: "saved" }, scope, async () => {
    throw new Error("Connection interrupted");
  }), error => {
    receipt = error.receipt;
    return error instanceof AutomationStartError && receipt.id === "saved" && receipt.retryAllowed !== false;
  });

  const started = [];
  const start = async id => {
    started.push(id);
    return { id, started: true, queued_for_engine_count: 1 };
  };
  const read = status => async id => ({ id, project_id: "project", app_type_id: "web", status });
  assert.equal((await retrySavedAutomationRun(receipt, read("queued"), start)).alreadyStarted, false);
  assert.equal((await retrySavedAutomationRun(receipt, read("running"), start)).alreadyStarted, true);
  assert.deepEqual(started, ["saved"]);
});

test("saved-run retry respects app scope and explicit dispatch restrictions", async () => {
  const receipt = { id: "saved", projectId: "project", appTypeId: "web", caseIds: ["case"], mode: "remote" };
  const wrongScope = async id => ({ id, project_id: "project", app_type_id: "api", status: "queued" });
  const unexpectedCall = () => assert.fail("Dispatch is restricted for this run");
  const isRestricted = error => error instanceof AutomationStartError && error.receipt.retryAllowed === false;
  await assert.rejects(retrySavedAutomationRun(receipt, wrongScope, unexpectedCall), isRestricted);
  await assert.rejects(retrySavedAutomationRun({ ...receipt, retryAllowed: false }, unexpectedCall, unexpectedCall), isRestricted);
});
