const test = require("node:test");
const assert = require("node:assert/strict");
const { createRecoverableRemoteExecution } = require("../../backend/services/recoverableRemoteExecution");

const input = { project_id: "project", app_type_id: "app", suite_ids: ["suite"], execution_mode: "remote" };

test("remote launch returns a saved Run after connection failure and replays its receipt without another dispatch", async () => {
  const keys = new Map();
  const errors = [];
  const starts = [];
  const ports = {
    actorId: "actor", requestId: "request-1234", input,
    create: async ({ source_idempotency_key, ...snapshot }) => {
      assert.deepEqual(snapshot, { ...input, created_by: "actor", execution_mode: "manual" });
      if (keys.has(source_idempotency_key)) return { id: keys.get(source_idempotency_key), idempotent_replay: true, status: "queued" };
      keys.set(source_idempotency_key, "saved-run");
      return { id: "saved-run", idempotent_replay: false };
    },
    start: async (...args) => {
      starts.push(args);
      throw Object.assign(new Error("Private provider configuration"), { code: "TESTENGINE_REQUIRED" });
    },
    onDispatchError: (error, id) => errors.push([error.code, id])
  };
  const first = await createRecoverableRemoteExecution(ports);
  assert.equal(first.id, "saved-run");
  assert.match(first.dispatch_notice, /Configure an active Test Engine integration/);
  assert.doesNotMatch(JSON.stringify(first), /Private provider/);
  const replay = await createRecoverableRemoteExecution({ ...ports, input: Object.fromEntries(Object.entries(input).reverse()) });
  assert.deepEqual(replay, { id: "saved-run", idempotent_replay: true, status: "queued" });
  assert.deepEqual(starts, [["saved-run", { initiated_by: "actor", execution_mode: "remote", engine_base_url: undefined }]]);
  assert.deepEqual(errors, [["TESTENGINE_REQUIRED", "saved-run"]]);
  assert.equal(keys.size, 1);
});

test("remote launch reports real dispatch counts, and invalid identifiers never create a Run", async () => {
  const ports = {
    input, actorId: "actor", requestId: "request-1234",
    create: async () => ({ id: "run", idempotent_replay: false }),
    start: async () => ({ started: true, queued_for_engine_count: 1, unsupported_automated_case_count: 1 })
  };
  assert.deepEqual(await createRecoverableRemoteExecution(ports),
    { id: "run", idempotent_replay: false, started: true, queued_for_engine_count: 1, unsupported_automated_case_count: 1 });
  await assert.rejects(createRecoverableRemoteExecution({ ...ports, requestId: " /run", create: async () => assert.fail("Unexpected write") }),
    { statusCode: 400, code: "EXECUTION_REQUEST_INVALID" });
});
