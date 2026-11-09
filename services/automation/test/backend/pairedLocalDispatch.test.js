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
  assert.ok(!f.queries.some(sql => /FROM test_cases/.test(sql)), 'Frozen case identities need no per-case authoring reads.');
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

test('local and remote case and suite dispatch retain authoritative Playwright source and every frozen data row',async t=>{
  for(const mode of ['individual','suite'])for(const includeAssertion of [true,false])await t.test(`${mode} / ${includeAssertion?'saved assertion':'actions only'}`,async t=>{
    const f=fixture(t),queued=[],boundaries=[];
    const source='// Automation Engineer source from upstream Playwright MCP\nawait page.getByRole("textbox", { name: "Email", exact: true }).fill(params["t.email"]);'
      +(includeAssertion?'\nawait expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveValue(params["t.email"]);':'');
    for(const step of f.execution.step_snapshots)step.automation_code=source;
    f.execution.parameter_values={'r.browser':'reviewed-run-input'};
    if(mode==='individual'){
      f.execution.case_snapshots=f.execution.case_snapshots.slice(0,1);
      f.execution.case_snapshots[0].suite_id=null;
      f.execution.case_snapshots[0].test_data_options.execution_policy={suite_parallel_override:false};
    }
    const authoritative=structuredClone(f.execution);
    t.mock.method(obs.pool,'connect',async()=>({release(){},query:async(statement,params)=>{
      const sql=typeof statement==='string'?statement:statement.text,values=typeof statement==='string'?params||[]:statement.values||[];
      if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)){boundaries.push(sql);return {rows:[]};}
      assert.match(sql,/INSERT INTO test_engine_jobs/);
      queued.push(JSON.parse(values[13]));return {rows:[],rowCount:1};
    }}));
    const plan=await dispatch.planExecutionDispatch(f.execution);
    assert.deepEqual(plan.warnings,[]);
    const local=await dispatch.preparePairedLocalDispatch({plan,pairedDispatchId:'paired',callbackFor:()=>({url:'https://api.test/api/testengine/callbacks/runs',signing_secret:'scoped'})});
    const remote=await dispatch.queueExecutionDispatch({plan,integration:{id:'engine',base_url:'https://engine.test',config:{}},initiatedBy:'actor'});
    assert.equal(remote.queued_for_engine_count,mode==='individual'?2:6);
    assert.equal(queued.length,local.envelopes.length);
    assert.deepEqual(boundaries,['BEGIN','COMMIT'],'Remote suite publication remains atomic.');
    for(let index=0;index<queued.length;index++){
      const localEnvelope=JSON.parse(JSON.stringify(local.envelopes[index])),remoteEnvelope=queued[index];
      assert.equal(remoteEnvelope.steps[0].automation_code,source);
      assert.equal(localEnvelope.steps[0].automation_code,source);
      assert.deepEqual(remoteEnvelope.steps,localEnvelope.steps);
      for(const key of ['case_parameters','suite_parameters','run_parameters','data_set','execution_policy','parameters_frozen'])assert.deepEqual(remoteEnvelope[key],localEnvelope[key],key);
      assert.equal(remoteEnvelope.case_parameters['t.email'],'saved@example.test');
      assert.equal(remoteEnvelope.run_parameters['r.browser'],'reviewed-run-input');
      assert.equal(remoteEnvelope.data_set.rows[0]['t.email'],index%2?'':'first@example.test','An intentionally empty row cannot fall back to a case default.');
    }
    assert.deepEqual(f.execution,authoritative,'Transport preparation never edits the authoritative snapshots.');
    assert.ok(!f.queries.some(sql=>/FROM test_cases|FROM test_suites/.test(sql)),'Later authoring must not replace frozen source or suite data.');
  });
});

test('paired dispatch rejects nonloopback origins, embedded credentials and URL suffixes before touching execution', async () => {
  for (const liveBaseUrl of ['https://remote.test', 'http://user:secret@localhost:4311', 'http://127.0.0.1:4311/path', 'http://127.0.0.1:4311/?secret=x', 'http://127.0.0.1:4311/#x', 'invalid']) {
    await assert.rejects(dispatch.preparePairedLocalDispatch({ liveBaseUrl, pairedDispatchId: 'dispatch', callbackFor: () => ({}) }), /loopback runner origin/);
  }
});

test('direct local marked programs require advertised runtime support before transaction publication or action dispatch',async t=>{
 for(const [marked,capability] of [[true,undefined],[true,false],[true,true],[false,undefined]])await t.test(`${marked?'marked':'legacy'} / ${String(capability)}`,async t=>{
  const f=fixture(t),requests=[];
  f.execution.case_snapshots=f.execution.case_snapshots.slice(0,1);
  Object.assign(f.execution.case_snapshots[0],{test_data_set_id:null,test_data_set_name:null,test_data_set_snapshot:null});
  f.execution.step_snapshots=f.execution.step_snapshots.slice(0,1);
  if(marked)f.execution.step_snapshots[0].automation_code='// @hellotest-parameter-bindings expressions-v1\nawait page.locator("#email").fill(params["t.email"]);await expect(page.locator("#email")).toHaveValue(params["t.email"]);';
  const before=process.env.HELLOTEST_TESTENGINE_SECRET;process.env.HELLOTEST_TESTENGINE_SECRET='expression-runtime-fixture-secret';
  t.after(()=>{if(before===undefined)delete process.env.HELLOTEST_TESTENGINE_SECRET;else process.env.HELLOTEST_TESTENGINE_SECRET=before;});
  t.mock.method(globalThis,'fetch',async(url,options)=>{
   requests.push({url:String(url),method:options.method});
   return new Response(JSON.stringify(String(url).endsWith('/health')?{ready:true,capabilities:{parameter_expressions_v1:capability}}:{accepted:true}),{status:200,headers:{'content-type':'application/json'}});
  });
  const plan=await dispatch.planExecutionDispatch(f.execution);
  const run=()=>dispatch.runExecutionDirectLocal({plan,integration:{base_url:'http://127.0.0.1:4313',config:{}},engineBaseUrl:'http://127.0.0.1:4313',initiatedBy:'actor'});
  if(marked&&capability!==true){
   await assert.rejects(run(),{code:'LOCAL_AGENT_UPGRADE_REQUIRED'});
   assert.equal(f.transactions.length,0);assert.deepEqual(requests,[{url:'http://127.0.0.1:4313/health',method:'GET'}]);
  }else{
   assert.equal((await run()).local_run_count,1);
   assert.equal(f.transactions.length,1);assert.equal(requests.filter(request=>request.method==='POST').length,1);
   assert.equal(requests.filter(request=>request.method==='GET').length,marked?1:0);
  }
 });
});
