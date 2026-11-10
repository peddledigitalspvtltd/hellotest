const assert = require("node:assert/strict");
const test = require("node:test");
const { collect } = require("../../backend/services/agentFailureEvidence");

test("failure evidence is scoped to the selected run/cases and returns failed step notes plus authorized comments", async () => {
  const reads = [];
  const permissions = [];
  const resultRow = {
    id: "result-1", execution_id: "run-1", test_case_id: "case-1", status: "failed", revision: 2,
    created_at: "2026-11-08T10:00:00Z", error: "Full runner error: expected dashboard heading after login; received login form.", logs: JSON.stringify({ stepStatuses: { "snap-1": "failed" }, stepNotes: { "snap-1": "The form stayed open." }, stepWebDetails: { "snap-1": { error: "Validation banner rendered." } } }),
    data_set_iteration_index: 0, title: "Login", description: "Submit valid credentials.", total_failed_cases: 1
  };
  const packet = await collect({
    projectId: "project-1", runIds: ["run-1"], testCaseIds: ["case-1", "case-2"], resultIds: ["result-1"],
    canView: async permission => { permissions.push(permission); return true; },
    read: async (sql, params) => {
      reads.push({ sql, params });
      if (/WITH latest/.test(sql)) return [resultRow];
      if (/FROM execution_step_snapshots/.test(sql)) return [{ snapshot_step_id: "snap-1", step_order: 45, action: "Submit login", expected_result: "Dashboard opens", step_type: "web", total_steps: 45 }];
      if (/FROM entity_comments/.test(sql)) return [{ id: "comment-1", entity_type: "execution_result", body: "Reproduced in staging.", updated_at: "2026-11-08T10:02:00Z", total_comments: 2 }];
      if (/FROM attachments/.test(sql)) return [{ id: "shot-1", entity_type: "execution_result", file_name: "login.png", mime_type: "image/png", size_bytes: 128 }];
      return [];
    }
  });
  assert.match(reads[0].sql, /e\.project_id = \?/);
  assert.match(reads[0].sql, /tc\.id IN \(\?,\?\)/);
  assert.match(reads[0].sql, /r\.error/);
  assert.match(reads[0].sql, /r\.id IN \(\?\)/);
  assert.deepEqual(reads[0].params, ["project-1", "run-1", "case-1", "case-2", "result-1"]);
  assert.match(reads[1].sql, /CASE WHEN snapshot_step_id IN \(\?\) THEN 0 ELSE 1 END/);
  assert.deepEqual(reads[1].params, ["run-1", "case-1", "snap-1"]);
  assert.equal(packet.length, 1);
  assert.equal(packet[0].steps[0].action, "Submit login");
  assert.equal(packet[0].steps[0].observed_status, "failed");
  assert.equal(packet[0].steps[0].note, "The form stayed open.");
  assert.equal(packet[0].error, "Full runner error: expected dashboard heading after login; received login form.");
  assert.equal(packet[0].steps[0].browser_observation.error, "Validation banner rendered.");
  assert.equal(packet[0].comments[0].body, "Reproduced in staging.");
  assert.equal(packet[0].steps[0].order, 45);
  assert.equal(packet[0].coverage.omitted_steps, 44);
  assert.equal(packet[0].coverage.omitted_comments, 1);
  assert.ok(permissions.includes("comment.view"));
});

test("failure step evidence is not read without Test Case visibility", async () => {
  let reads = 0;
  const result = await collect({
    projectId: "project-1", runIds: ["run-1"],
    canView: async permission => permission === "result.view",
    read: async () => { reads++; return []; }
  });
  assert.deepEqual(result, []);
  assert.equal(reads, 0);
});

test("optional comment retrieval failures preserve step evidence while cancellation still stops collection", async () => {
  const collectWith = failure => collect({ projectId: 'project', runIds: ['run'], canView: async () => true,
    read: async sql => {
      if (/WITH latest/.test(sql)) return [{ id: 'result', execution_id: 'run', test_case_id: 'case', status: 'failed', logs: '{}', total_failed_cases: 1 }];
      if (/FROM execution_step_snapshots/.test(sql)) return [{ snapshot_step_id: 'step', step_order: 1, action: 'Save', expected_result: 'Saved', total_steps: 1 }];
      if (/FROM entity_comments/.test(sql)) throw failure;
      return [];
    } });
  const [packet] = await collectWith(new Error('Comment storage unavailable'));
  assert.equal(packet.steps[0].action, 'Save');
  assert.deepEqual(packet.comments, []);
  assert.ok(packet.limitations.some(item => /Comments could not be retrieved/.test(item)));
  await assert.rejects(collectWith(Object.assign(new Error('Cancelled'), { name: 'AbortError' })), { name: 'AbortError' });
});
