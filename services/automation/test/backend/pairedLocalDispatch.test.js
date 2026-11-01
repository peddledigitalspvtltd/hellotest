const test = require('node:test');
const assert = require('node:assert/strict');
const dispatch = require('../../backend/services/testEngineDispatch.service');
const db = require('@hellotest/platform/backend/src/db');
const obs = require('@hellotest/platform/backend/src/obsDb');
const workspace = require('@hellotest/platform/backend/services/workspaceTransaction.service');

test.after(() => Promise.all([db.close(), obs.close()]));

function fixture(t) {
  const transactions = [], events = [], queries = [];
  t.mock.method(require('@hellotest/platform/backend/services/aiConfiguration.service'), 'resolve', async () => ({ config: { instruction_blocks: {
    'engineRepair.goal': 'Retain reviewed behavior', 'engineRepair.screen_selection': 'Observed screen', 'engineRepair.correction_policy': 'Retain assertions'
  } } }));
  t.mock.method(db.pool, 'query', async input => {
    const sql = typeof input === 'string' ? input : input.text;
    queries.push(sql);
    if (/FROM projects/.test(sql)) return { rows: [{ id: 'project', name: 'Project' }] };
    if (/FROM app_types/.test(sql)) return { rows: [{ id: 'app', name: 'Browser app', type: 'web' }] };
    if (/FROM test_cases/.test(sql)) return { rows: [{ id: 'current', automated: 'no', automation_status: 'incomplete' }] };
    throw new Error(`Frozen dispatch must not consult authoring: ${sql}`);
  });
  t.mock.method(obs.pool, 'query', async input => {
    const sql = typeof input === 'string' ? input : input.text;
    queries.push(sql);
    assert.match(sql, /FROM automation_learning_cache/);
    return { rows: [] };
  });
  t.mock.method(workspace, 'createTransaction', async input => { transactions.push(input); return { id: `tx-${transactions.length}` }; });
  t.mock.method(workspace, 'appendTransactionEvent', async (id, input) => { events.push({ id, ...input }); });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Preparing a paired grant must never contact a runner.'); });
  const snippets = [
    'await page.getByRole("button", { name: "Save" }).click(); await expect(page.getByText("Saved")).toBeVisible();',
    'await page.locator("#email").fill(params["t.email"]); await expect(page.locator("#email")).toHaveValue(params["t.email"]);',
    'await page.goto("https://fixture.test/"); await expect(page).toHaveTitle("Fixture");'
  ];
  const cases = ['recorded', 'built', 'instructions'].map((id, index) => ({
    test_case_id: id, test_case_title: id, automated: 'yes', suite_id: 'suite', sort_order: index + 1,
    parameter_values: { 't.email': 'saved@example.test' }, suite_parameter_values: { 's.region': 'saved' },
    test_data_options: { automation_case_type: 'web', execution_policy: { suite_parallel_override: true, parallel_enabled: false, parallel_count: 1 } },
    test_data_set_id: 'dataset', test_data_set_name: 'Customers', data_set_source: 'suite',
    test_data_set_snapshot: { mode: 'table', columns: ['t.email'], rows: [{ 't.email': 'first@example.test' }, { 't.email': '' }] }
  }));
  const execution = { id: 'execution', project_id: 'project', app_type_id: 'app', status: 'running', parameter_scope_default: 'r',
    parallel_enabled: true, parallel_count: 8, case_snapshots: cases,
    step_snapshots: cases.map((entry, index) => ({ test_case_id: entry.test_case_id, snapshot_step_id: `step-${entry.test_case_id}`, step_order: 1,
      step_type: 'web', action: 'Perform the saved action', expected_result: 'The saved assertion passes', automation_code: snippets[index] })) };
  return { execution, snippets, transactions, events, queries };
}

test('paired dispatch receipt binds the native no-dataset row rather than the planner placeholder',async t=>{
  const f=fixture(t);
  for(const item of f.execution.case_snapshots){item.test_data_set_id=null;item.test_data_set_name=null;item.test_data_set_snapshot=null;}
  const plan=await dispatch.planExecutionDispatch(f.execution);
  const prepared=await dispatch.preparePairedLocalDispatch({plan,pairedDispatchId:'dispatch',initiatedBy:'actor',callbackFor:()=>({url:'https://api.test/api/testengine/callbacks/runs',signing_secret:'scoped'})});
  assert.equal(prepared.envelopes.length,3);
  for(let index=0;index<3;index++){
    assert.equal(prepared.envelopes[index].data_set,null);
    assert.equal(f.transactions[index].metadata.data_set_iteration_index,null);
    assert.equal(f.transactions[index].metadata.data_set_iteration_key,null);
  }
});

test('paired dispatch freezes all three authored modes and each suite data row without runner access or global secrets', async t => {
  const f = fixture(t);
  const plan = await dispatch.planExecutionDispatch(f.execution);
  assert.equal(plan.eligibleCases.length, 6, 'Later authoring incompleteness cannot invalidate executable frozen steps.');
  const prepared = await dispatch.preparePairedLocalDispatch({ plan, integration: { base_url: 'https://remote.test', config: {
    active_web_engine: 'selenium', headless: false, web_session_mode: 'reuse', connect_over_cdp_endpoint: 'https://remote.test/cdp', callback_secret: 'GLOBAL_SECRET_MUST_NOT_ESCAPE'
  } }, pairedDispatchId: 'dispatch', initiatedBy: 'actor', callbackFor: item => ({
    url: 'https://api.test/api/testengine/callbacks/runs', signing_secret: `scoped-${item.engine_run_id}`
  }) });
  assert.equal(prepared.local_run_count, 6);
  assert.equal(prepared.queued_for_engine_count, 0);
  assert.equal(prepared.automated_case_count, 3);
  assert.equal(f.transactions.length, 6);
  assert.equal(f.events.length, 6);
  for (let index = 0; index < prepared.envelopes.length; index++) {
    const envelope = prepared.envelopes[index], metadata = f.transactions[index].metadata;
    assert.equal(envelope.engine_run_id, plan.eligibleCases[index].engine_run_id);
    assert.equal(envelope.steps[0].automation_code, f.snippets[Math.floor(index / 2)]);
    assert.equal(envelope.steps[0].id, `step-${envelope.hellotest_test_case_id}`);
    assert.equal(envelope.data_set.rows.length, 1);
    assert.equal(envelope.data_set.iteration.index, index % 2);
    assert.equal(envelope.data_set.rows[0]['t.email'], index % 2 ? '' : 'first@example.test');
    assert.equal(envelope.execution_policy.parallel_enabled, false, 'Frozen suite policy overrides current run parallel settings.');
    assert.equal(envelope.execution_policy.execution_order, Math.floor(index / 2) + 1);
    assert.equal(envelope.web_engine.active, 'playwright');
    assert.equal(envelope.headless, false);
    assert.equal(envelope.session_policy.web.mode, 'new');
    assert.equal(envelope.session_policy.web.connect_over_cdp_endpoint, null);
    assert.equal(envelope.artifact_policy.trace_mode, 'on');
    assert.equal(envelope.artifact_policy.video_mode, 'on');
    assert.equal(envelope.callback.signing_secret, `scoped-${envelope.engine_run_id}`);
    assert.equal(f.transactions[index].status, 'queued');
    assert.equal(metadata.source, 'hellotest.local-run');
    assert.equal(metadata.queue_mode, 'paired-local');
    assert.equal(metadata.paired_dispatch_id, 'dispatch');
    assert.equal(metadata.test_case_id, envelope.hellotest_test_case_id);
    assert.equal(metadata.data_set_iteration_index, envelope.data_set.iteration.index);
    assert.equal(metadata.data_set_iteration_key, envelope.data_set.iteration.key);
  }
  assert.doesNotMatch(JSON.stringify(prepared), /GLOBAL_SECRET_MUST_NOT_ESCAPE|remote\.test/);
  assert.doesNotMatch(JSON.stringify(f.transactions), /scoped-|signing_secret/);
  assert.equal(f.queries.filter(sql => /FROM automation_learning_cache/.test(sql)).length, 3, 'Repository bindings load once per case rather than once per row.');
  assert.ok(!f.queries.some(sql => /test_suites/.test(sql)), 'No live suite settings are read for frozen policies.');
});

test('paired individual case without a suite retains run scheduling and callback failure creates no partial receipts', async t => {
  const f = fixture(t), single = f.execution.case_snapshots[0];
  single.suite_id = null;
  single.test_data_options.execution_policy = { suite_parallel_override: false };
  f.execution.case_snapshots = [single];
  const plan = await dispatch.planExecutionDispatch(f.execution);
  const prepared = await dispatch.preparePairedLocalDispatch({ plan, pairedDispatchId: 'dispatch', callbackFor: () => ({ url: 'https://api.test/callback', signing_secret: 'scoped' }) });
  assert.equal(prepared.envelopes[0].execution_policy.parallel_enabled, true);
  assert.equal(prepared.envelopes[0].execution_policy.parallel_count, 8);
  const count = f.transactions.length;
  let callbacks = 0;
  await assert.rejects(dispatch.preparePairedLocalDispatch({ plan, pairedDispatchId: 'other', callbackFor: () => {
    if (++callbacks === 2) throw new Error('Scoped callback could not be authorized');
    return { url: 'https://api.test/callback', signing_secret: 'other' };
  } }), /could not be authorized/);
  assert.equal(f.transactions.length, count, 'Every callback is authorized before creating any transaction receipt.');
});

test('paired dispatch rejects nonloopback origins, embedded credentials and URL suffixes before touching execution', async () => {
  for (const liveBaseUrl of ['https://remote.test', 'http://user:secret@localhost:4311', 'http://127.0.0.1:4311/path', 'http://127.0.0.1:4311/?secret=x', 'http://127.0.0.1:4311/#x', 'invalid']) {
    await assert.rejects(dispatch.preparePairedLocalDispatch({ liveBaseUrl, pairedDispatchId: 'dispatch', callbackFor: () => ({}) }), /loopback runner origin/);
  }
});
