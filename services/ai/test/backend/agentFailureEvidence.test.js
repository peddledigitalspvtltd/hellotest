const assert = require("node:assert/strict");
const test = require("node:test");
const { collect, observedDetails } = require("../../backend/services/agentFailureEvidence");

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
  assert.match(reads[0].sql, /r\.test_case_id IN \(\?,\?\)/);
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

test('structured failure observations retain failed assertions and network errors without raw payloads or captures', () => {
  const observed = observedDetails({
    request: { method: 'POST', url: 'https://example.test/save', headers: { Authorization: 'private-header' }, body: 'private-body' },
    response: { status: 500, status_text: 'Server error', headers: { Cookie: 'private-cookie' }, body: 'private-response' },
    captures: { password: 'private-capture' },
    assertions: [...Array.from({ length: 12 }, () => ({ kind: 'status', passed: true, expected: '200', actual: '200' })),
      { kind: 'json-path', passed: false, target: '$.saved', expected: 'true', actual: 'false', response: 'private-assertion-payload' }],
    network: [{ method: 'GET', url: '/ready', status: 200 }, { method: 'POST', url: '/save', status: 500, error: 'Server rejected save', body: 'private-network-body' }],
    console: [{ type: 'log', text: 'private-debug' }, { type: 'error', text: 'Save failed', extra: 'private-extra' }]
  });
  assert.deepEqual(observed.request, { method: 'POST', url: 'https://example.test/save' });
  assert.deepEqual(observed.response, { status: 500, status_text: 'Server error' });
  assert.equal(observed.assertions.length, 10);
  assert.deepEqual(observed.assertions[0], { kind: 'json-path', passed: false, target: '$.saved', expected: 'true', actual: 'false' });
  assert.deepEqual(observed.network_issues, [{ method: 'POST', url: '/save', status: 500, error: 'Server rejected save' }]);
  assert.deepEqual(observed.console_errors, [{ type: 'error', text: 'Save failed' }]);
  assert.doesNotMatch(JSON.stringify(observed), /private-/);
});

test('selected observation strings redact URL credentials, signed queries and nested secrets before reaching model evidence', () => {
  const observed = observedDetails({
    url: 'https://private-user:PRIVATE_URL_PASSWORD@example.test/login?next=dashboard&token=PRIVATE_URL_TOKEN&view_token=PRIVATE_VIEW_TOKEN',
    request: { method: 'POST', url: 'https://example.test/save?search=invoice&access_token=PRIVATE_ACCESS_TOKEN&key=PRIVATE_QUERY_KEY' },
    response: { status: 503, status_text: 'Temporarily unavailable' },
    assertions: [{ kind: 'value', passed: false, expected: 'password=PRIVATE_EXPECTED_PASSWORD', actual: 'api_key=PRIVATE_ACTUAL_KEY' }],
    network: [{ method: 'GET', status: 503, url: '/save?sort=name&x-amz-signature=PRIVATE_SIGNED_URL', error: 'Request failed using Basic PRIVATE_BASIC_TOKEN' }],
    console: [{ type: 'error', text: 'Save failed using Bearer PRIVATE_BEARER_TOKEN; email=private.person@example.test' }]
  });
  const serialized = JSON.stringify(observed);
  assert.doesNotMatch(serialized, /PRIVATE_|private-user|private\.person@example\.test/);
  assert.match(observed.url, /next=dashboard/);
  assert.match(observed.request.url, /search=invoice/);
  assert.match(observed.network_issues[0].url, /sort=name/);
  assert.equal(observed.request.method, 'POST');
  assert.equal(observed.response.status, 503);
  assert.equal(observed.response.status_text, 'Temporarily unavailable');
  assert.equal(observed.assertions[0].passed, false);
  assert.match(observed.console_errors[0].text, /Save failed/);
  const bounded = observedDetails({ error: 'x'.repeat(980) + ' password=PRIVATE_BOUNDARY_SECRET' });
  assert.equal(bounded.error.length, 1000);
  assert.doesNotMatch(bounded.error, /PRIVATE/);
});

test('missing or unavailable frozen snapshots preserve authorized failure comments and disclose the missing actions', async () => {
  for (const unavailable of [false, true]) {
    const [packet] = await collect({ projectId: 'project', runIds: ['run'], canView: async () => true,
      read: async sql => {
        if (/WITH latest/.test(sql)) {
          assert.match(sql, /LEFT JOIN execution_case_snapshots/);
          return [{ id: 'result', execution_id: 'run', test_case_id: 'case', status: 'failed', error: 'Observed failure', logs: '{}', total_failed_cases: 1 }];
        }
        if (/FROM execution_step_snapshots/.test(sql) && unavailable) throw new Error('Snapshot store unavailable');
        if (/FROM entity_comments/.test(sql)) return [{ body: 'Failed when saving in staging.' }];
        return [];
      }
    });
    assert.equal(packet.error, 'Observed failure');
    assert.equal(packet.comments[0].body, 'Failed when saving in staging.');
    assert.deepEqual(packet.steps, []);
    assert.ok(packet.limitations.some(item => /frozen step details/i.test(item) && /unknown/.test(item)));
    assert.deepEqual(packet.coverage.unavailable_sources, unavailable ? ['Frozen step details'] : []);
  }
});
