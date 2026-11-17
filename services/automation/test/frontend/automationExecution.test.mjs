import assert from "node:assert/strict";
import test from "node:test";
import { handoverAutomationRun } from "../../frontend/lib/automationExecution.ts";
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
