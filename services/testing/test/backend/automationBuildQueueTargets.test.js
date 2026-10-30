const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeAutomationStartUrl, requiresAutomationStartUrl } = require('../../../platform/backend/src/utils/automationStartUrl');
const { normalizeScheduledAt } = require('../../../platform/backend/src/utils/automationSchedule');
const { buildFeature } = require('../../../automation/backend/services/aiAutomationFeaturePolicy');
const { normalizeAgentContext } = require('../../../automation/backend/lib/automationAgentContext');
const { captureStartUrlReview, createQueuedStartUrlReviewGuard } = require('../../../automation/backend/services/automationQueuedStartUrl.service');
const {buildParameterValues}=require('../../../automation/backend/lib/automationBuildParameterPlan');
const {normalizeBuildPipelineOptions}=require('../../../automation/backend/lib/automationBuildPipelineOptions');

const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function fixture({ cases = [], steps = [], targets = {} } = {}) {
  const state = { cases: new Map(cases.map(row => [row.id, { app_type_id: 'app', project_id: 'project', app_type_kind: 'web', automated: 'yes', ...row }])), steps, targets, queued: [], transactions: [], jobs: new Map(), providerCalls: [], parameterReviewCalls:[],parameterPlans:{} };
  const database = {
    transaction: callback => callback,
    prepare: statement => {
      const sql = statement.replace(/\s+/g, ' ').trim();
      return {
        get: async (...args) => {
          if (/FROM app_types/.test(sql)) return { id: 'app', project_id: 'project', type: 'web' };
          if (/SELECT source.app_type_id,target.id/.test(sql)) {
            const row = state.cases.get(args[0]);
            return row && { app_type_id: row.app_type_id, target_id: state.targets[row.id]?.id };
          }
          if (/SELECT id,automation_start_url FROM test_cases/.test(sql)) return state.targets[String(args[1]).replace('automation-builder:', '')] || null;
          if (/FROM test_cases/.test(sql)) return copy(state.cases.get(args[0]));
          if (/FROM automation_generator_jobs/.test(sql)) return copy(state.jobs.get(args[0]));
          return null;
        },
        all: async (...args) => {
          if (/SELECT source.id, source.automated, source.automation_start_url/.test(sql)) {
            const ids = JSON.parse(args[1]);
            return [...state.cases.values()].filter(row => row.app_type_id === args[0] && (ids.length ? ids.includes(row.id) : row.automated !== 'yes')).map(row => ({ ...copy(row), linked_automation_test_case_id: state.targets[row.id]?.id, linked_automation_start_url: state.targets[row.id]?.automation_start_url }));
          }
          if (/SELECT source.id,app_types.type AS app_type_kind/.test(sql)) return [...state.cases.values()].filter(row => row.app_type_id === args[0] && JSON.parse(args[1]).includes(row.id)).map(copy);
          if (/SELECT id FROM test_cases WHERE app_type_id/.test(sql)) return [];
          if (/FROM test_steps/.test(sql)) {
            const ids = /jsonb_array_elements_text/.test(sql) ? JSON.parse(args[0]) : [args[0]];
            return copy(state.steps.filter(row => ids.includes(row.test_case_id)));
          }
          return [];
        },
        run: async (...args) => {
          if (/INSERT INTO automation_generator_jobs/.test(sql)) state.jobs.set(args[0], { id: args[0], transaction_id: args[1], test_case_id: args[4], payload: copy(args[5]), status: 'queued', created_by: args[6] });
          return { changes: 1 };
        }
      };
    }
  };
  const workspace = {
    createTransaction: async input => { state.transactions.push(copy(input)); return { id: 'activity' }; },
    appendTransactionEvent: async () => {}, updateTransaction: async () => {}, createTransactionNotification: async () => {}
  };
  const builder = { buildFeature, buildAutomationForCase: async input => { state.providerCalls.push(copy(input)); if (state.onBuild) return state.onBuild(input); return { generated_step_count: 1, learned_locator_count: 0 }; }, buildAutomationBatch: async input => { state.providerCalls.push(copy(input)); return { generated: 1 }; } };
  function load(relative) {
    const exported = {}, module = { exports: exported };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, relative), 'utf8') + (relative.includes('batchProcess') ? '\nmodule.exports._runAutomationBuild=runAutomationBuild;' : ''), {
      module, exports: exported, process, URL, Buffer, console, setTimeout, clearTimeout,
      require: name => {
        if (/\/(?:db|obsDb)$/.test(name)) return database;
        if (/automationStartUrl$/.test(name)) return { normalizeAutomationStartUrl, requiresAutomationStartUrl };
        if (/automationCaseType$/.test(name)) return require('../../../platform/backend/src/utils/automationCaseType');
        if (/automationSchedule$/.test(name)) return { normalizeScheduledAt };
        if (/aiAutomationFeaturePolicy$/.test(name)) return { buildFeature };
        if (/aiAutomationBuilder.service$/.test(name)) return builder;
        if (/automationAgentContext$/.test(name)) return { normalizeAgentContext };
        if (/automationBuildPipelineOptions$/.test(name)) return {normalizeBuildPipelineOptions,assertBuildVerificationAccess:async()=>{}};
        if (/automationBuildParameterPlan$/.test(name)) return {buildParameterValues};
        if (/automationBuildParameterPlan.service$/.test(name)) return {buildParameterValues,load:async input=>{
          state.parameterReviewCalls.push(copy(input));
          const id=input.caseId||input.testCase.id,key=state.parameterPlans[id]||`current-plan-${id}`;
          if(state.suiteMembership&&input.test_suite_id&&!state.suiteMembership[id]?.includes(input.test_suite_id))throw Object.assign(new Error('The selected suite does not contain this case.'),{code:'AUTOMATION_BUILD_SUITE_INVALID',statusCode:400});
          if(input.expectedKey!=null&&input.expectedKey!==key)throw Object.assign(new Error('Reviewed data changed'),{code:'AUTOMATION_PARAMETER_PLAN_CHANGED',statusCode:409});
          return{parameter_plan_key:key,test_suite_id:input.test_suite_id??state.defaultSuites?.[id]??null};
        }};
        if (/automationQueuedStartUrl.service$/.test(name)) return { captureStartUrlReview, assertQueuedStartUrlReview: createQueuedStartUrlReviewGuard(database) };
        if (/workspaceTransaction.service$/.test(name)) return workspace;
        if (/batchJobLease$/.test(name)) return { createBatchJobLease: () => ({ signal: new AbortController().signal, ensureOwnership: async () => {}, stop() {} }) };
        if (name === 'crypto') return require('node:crypto');
        return {};
      }
    });
    return module.exports;
  }
  const batch = load('../../backend/services/batchProcess.service.js');
  batch.queueBatchJob = async input => { state.queued.push(copy(input)); return input; };
  const generator = load('../../../automation/backend/services/automationGenerator.service.js');
  return { state, batch, generator };
}
const browserStep = id => ({ test_case_id: id, step_type: 'web' });

test('CLI verification selection survives both durable queues and their worker-to-builder handoff',async()=>{
 const {state,batch,generator}=fixture({cases:[{id:'case',automation_start_url:'https://selected.test/login'}],steps:[browserStep('case')]});
 const options={allow_browser_actions:true,verification_mode:'verify_repair',verification_driver:'playwright_test_cli',browser_driver:'mcp'};
 await batch.queueAutomationBuild({app_type_id:'app',test_case_ids:['case'],...options});
 const single=await generator.queueGeneratorJob({test_case_id:'case',...options});
 const job=state.jobs.get(single.job_id);job.status='leased';job.leased_by='worker';
 assert.equal(state.queued[0].payload.verification_driver,'playwright_test_cli');
 assert.equal(job.payload.verification_driver,'playwright_test_cli');
 assert.ok(state.transactions.every(row=>row.metadata.verification_driver==='playwright_test_cli'));
 await batch._runAutomationBuild({payload:state.queued[0].payload,transaction_id:'activity'});
 await generator.runLeasedJob({job_id:job.id,worker_id:'worker'});
 assert.equal(state.providerCalls.length,2);
 assert.ok(state.providerCalls.every(row=>row.verification_driver==='playwright_test_cli'&&row.verification_mode==='verify_repair'&&row.browser_driver==='mcp'));
 const count=state.transactions.length;
 await assert.rejects(generator.queueGeneratorJob({test_case_id:'case',...options,verification_driver:'shell'}),{code:'AUTOMATION_BUILD_OPTIONS_INVALID'});
 await assert.rejects(batch.queueAutomationBuild({app_type_id:'app',test_case_ids:['case'],...options,allow_browser_actions:false}),{code:'AUTOMATION_VERIFICATION_REQUIRES_BROWSER_ACTIONS'});
 assert.equal(state.transactions.length,count,'invalid lane or missing interaction authorization cannot enqueue work');
});

test('single and batch jobs freeze reviewed scoped choices per case and reject stale review before creating activity',async()=>{
 const {state,batch,generator}=fixture({cases:[{id:'first',automation_start_url:'https://first.test/'},{id:'second',automation_start_url:'https://second.test/'}],steps:[browserStep('first'),browserStep('second')]});
 const first={'@t.name':'First','r.optional':''},second={'t.name':'Second','s.region':'East'};
 state.parameterPlans={first:'review-first',second:'review-second'};
 await batch.queueAutomationBuild({app_type_id:'app',test_case_ids:['first','second'],parameter_values_by_case:{first,second},parameter_plan_keys_by_case:{first:'review-first',second:'review-second'}});
 first['@t.name']='Later edit';second['t.name']='Later second edit';
 assert.deepEqual(state.queued[0].payload.parameter_values_by_case,{first:{'t.name':'First','r.optional':''},second:{'t.name':'Second','s.region':'East'}});
 assert.deepEqual(state.queued[0].payload.parameter_plan_keys_by_case,{first:'review-first',second:'review-second'});
 const queued=await generator.queueGeneratorJob({test_case_id:'first',parameter_values:{'r.optional':''},parameter_plan_key:'review-first'});
 assert.equal(state.jobs.get(queued.job_id).payload.parameter_values['r.optional'],'');
 assert.equal(state.jobs.get(queued.job_id).payload.parameter_plan_key,'review-first');
 const activities=state.transactions.length,batches=state.queued.length;
 state.parameterPlans.first='changed-review';
 await assert.rejects(generator.queueGeneratorJob({test_case_id:'first',parameter_values:{'r.optional':''},parameter_plan_key:'review-first'}),{code:'AUTOMATION_PARAMETER_PLAN_CHANGED'});
  await assert.rejects(batch.queueAutomationBuild({app_type_id:'app',test_case_ids:['first'],parameter_plan_keys_by_case:{first:'review-first'}}),{code:'AUTOMATION_PARAMETER_PLAN_CHANGED'});
  await assert.rejects(batch.queueAutomationBuild({app_type_id:'app',test_case_ids:['first'],parameter_values_by_case:{second:{'r.name':'Unselected'}}}),{code:'AUTOMATION_BUILD_PARAMETERS_INVALID'});
  await assert.rejects(batch.queueAutomationBuild({app_type_id:'app',test_case_ids:['first'],parameter_values_by_case:[]}),{code:'AUTOMATION_BUILD_PARAMETERS_INVALID'});
  await assert.rejects(batch.queueAutomationBuild({app_type_id:'app',test_case_ids:['first'],parameter_plan_keys_by_case:{first:''}}),{code:'AUTOMATION_PARAMETER_PLAN_CHANGED'});
  await assert.rejects(generator.queueGeneratorJob({test_case_id:'first',parameter_plan_key:''}),{code:'AUTOMATION_PARAMETER_PLAN_CHANGED'});
 assert.equal(state.transactions.length,activities);assert.equal(state.queued.length,batches);
});

test('single selected suite is reviewed, pinned and forwarded through the durable generator worker',async()=>{
 const {state,generator}=fixture({cases:[{id:'case',automation_start_url:'https://selected.test/login'}],steps:[browserStep('case')]});
 state.suiteMembership={case:['suite']};
 const single=await generator.queueGeneratorJob({test_case_id:'case',test_suite_id:'suite'});
 const job=state.jobs.get(single.job_id);job.status='leased';job.leased_by='worker';
 assert.equal(state.parameterReviewCalls[0].test_suite_id,'suite');assert.equal(job.payload.test_suite_id,'suite');assert.equal(state.transactions[0].metadata.test_suite_id,'suite');
 await generator.runLeasedJob({job_id:job.id,worker_id:'worker'});assert.equal(state.providerCalls[0].test_suite_id,'suite');
 const activities=state.transactions.length;
 await assert.rejects(generator.queueGeneratorJob({test_case_id:'case',test_suite_id:'foreign-suite'}),{code:'AUTOMATION_BUILD_SUITE_INVALID'});
 await assert.rejects(generator.queueGeneratorJob({test_case_id:'case',test_suite_id:{invented:true}}),{code:'AUTOMATION_BUILD_SUITE_INVALID'});
 assert.equal(state.transactions.length,activities);
});

test('batch suite maps stay case-specific, explicit null overrides an active scalar and invalid membership blocks queue writes',async()=>{
 const {state,batch}=fixture({cases:[{id:'first',automation_start_url:'https://first.test/'},{id:'second',automation_start_url:'https://second.test/'}],steps:[browserStep('first'),browserStep('second')]});
 state.suiteMembership={first:['suite-first'],second:['suite-second']};
 await batch.queueAutomationBuild({app_type_id:'app',test_case_ids:['first','second'],test_suite_id:'suite-first',test_suite_ids_by_case:{first:'suite-first',second:'suite-second'}});
 assert.deepEqual(state.queued[0].payload.test_suite_ids_by_case,{first:'suite-first',second:'suite-second'});
 await batch._runAutomationBuild({payload:state.queued[0].payload,transaction_id:'activity'});
 assert.deepEqual(state.providerCalls[0].test_suite_ids_by_case,{first:'suite-first',second:'suite-second'});
 await batch.queueAutomationBuild({app_type_id:'app',test_case_ids:['first','second'],test_suite_id:'suite-first',test_suite_ids_by_case:{second:null}});
 assert.equal(state.parameterReviewCalls.at(-1).test_suite_id,null);assert.equal(state.queued[1].payload.test_suite_ids_by_case.second,null);
 const count=state.queued.length;
 await assert.rejects(batch.queueAutomationBuild({app_type_id:'app',test_case_ids:['first','second'],test_suite_id:'suite-first'}),{code:'AUTOMATION_BUILD_SUITE_INVALID'});
 await assert.rejects(batch.queueAutomationBuild({app_type_id:'app',test_case_ids:['first'],test_suite_ids_by_case:{second:'suite-second'}}),{code:'AUTOMATION_BUILD_PARAMETERS_INVALID'});
 await assert.rejects(batch.queueAutomationBuild({app_type_id:'app',test_case_ids:['first'],test_suite_ids_by_case:{first:42}}),{code:'AUTOMATION_BUILD_SUITE_INVALID'});
 assert.equal(state.queued.length,count);
});

test('reviewed fallback suite echo is frozen rather than adopting a later current-case choice',async()=>{
 const {state,batch,generator}=fixture({cases:[{id:'case',automation_start_url:'https://selected.test/login'}],steps:[browserStep('case')]});
 state.defaultSuites={case:'reviewed-fallback'};
 await batch.queueAutomationBuild({app_type_id:'app',test_case_ids:['case'],parameter_plan_keys_by_case:{case:'current-plan-case'}});
 const single=await generator.queueGeneratorJob({test_case_id:'case',parameter_plan_key:'current-plan-case'});
 state.defaultSuites.case='later-different-suite';
 assert.equal(state.queued[0].payload.test_suite_ids_by_case.case,'reviewed-fallback');assert.equal(state.jobs.get(single.job_id).payload.test_suite_id,'reviewed-fallback');
});

test('both queues reject a missing or invalid explicit browser URL before creating any activity', async () => {
  const { state, batch, generator } = fixture({ cases: [{ id: 'case', automation_start_url: null }], steps: [browserStep('case')] });
  for (const start_url of [undefined, '', 'javascript:alert(1)', 'https://user:secret@example.test', '@t.url']) {
    for (const run of [() => batch.queueAutomationBuild({ app_type_id: 'app', test_case_ids: ['case'], start_url }), () => generator.queueGeneratorJob({ test_case_id: 'case', start_url })]) {
      await assert.rejects(run(), error => /^AUTOMATION_START_URL_/.test(error.code));
    }
  }
  assert.equal(state.transactions.length, 0);
  assert.equal(state.queued.length, 0);
  assert.equal(state.jobs.size, 0);
  state.cases.get('case').automation_start_url = 'https://saved.example.test/';
  await assert.rejects(batch.queueAutomationBuild({ app_type_id: 'app', test_case_ids: ['case'], start_url: '' }), error => error.code === 'AUTOMATION_START_URL_REQUIRED');
  await assert.rejects(generator.queueGeneratorJob({ test_case_id: 'case', start_url: '' }), error => error.code === 'AUTOMATION_START_URL_REQUIRED');
});

test('batch URLs are resolved per case, frozen server-side and superseded only by an explicit URL', async () => {
  const { state, batch } = fixture({ cases: [{ id: 'first', automation_start_url: 'https://first.example.test/signup' }, { id: 'second', automation_start_url: 'https://second.example.test/path?mode=review' }], steps: [browserStep('first'), browserStep('second')] });
  await batch.queueAutomationBuild({ app_type_id: 'app', test_case_ids: ['first', 'second'], start_urls_by_case_id: { first: 'https://untrusted.example.test/' } });
  assert.deepEqual(state.queued[0].payload.start_urls_by_case_id, { first: 'https://first.example.test/signup', second: 'https://second.example.test/path?mode=review' });
  state.cases.get('first').automation_start_url = 'https://later.example.test/';
  assert.equal(state.queued[0].payload.start_urls_by_case_id.first, 'https://first.example.test/signup');
  await batch.queueAutomationBuild({ app_type_id: 'app', test_case_ids: ['first', 'second'], start_url: ' HTTPS://SELECTED.EXAMPLE.TEST/signup?source=manual ' });
  assert.deepEqual(state.queued[1].payload.start_urls_by_case_id, { first: 'https://selected.example.test/signup?source=manual', second: 'https://selected.example.test/signup?source=manual' });
  assert.equal(state.cases.get('first').automation_start_url, 'https://later.example.test/', 'Queuing must not edit the live case.');
});

test('manual-source queues use only their pinned prepared target and freeze an unselected batch scope', async () => {
  const { state, batch, generator } = fixture({ cases: [{ id: 'manual', automated: 'no' }], steps: [browserStep('manual')], targets: { manual: { id: 'automation', automation_start_url: 'https://linked.example.test/signup' } } });
  await batch.queueAutomationBuild({ app_type_id: 'app' });
  assert.deepEqual(state.queued[0].payload.test_case_ids, ['manual']);
  assert.equal(state.queued[0].payload.start_urls_by_case_id.manual, 'https://linked.example.test/signup');
  const job = await generator.queueGeneratorJob({ test_case_id: 'manual', scheduled_at: '2099-01-01T00:00:00.000Z' });
  assert.equal(state.jobs.get(job.job_id).payload.start_url, 'https://linked.example.test/signup');
  state.targets.manual.automation_start_url = 'https://changed.example.test/';
  assert.equal(state.jobs.get(job.job_id).payload.start_url, 'https://linked.example.test/signup');
});

test('API/native-only cases need no browser entry point while malformed explicit URLs still fail', async () => {
  const { state, batch, generator } = fixture({ cases: [{ id: 'api' }, { id: 'native' }], steps: [{ test_case_id: 'api', step_type: 'api' }, { test_case_id: 'native', step_type: 'android' }] });
  await batch.queueAutomationBuild({ app_type_id: 'app', test_case_ids: ['api', 'native'] });
  assert.deepEqual(state.queued[0].payload.start_urls_by_case_id, { api: null, native: null });
  const job = await generator.queueGeneratorJob({ test_case_id: 'api' });
  assert.equal(state.jobs.get(job.job_id).payload.start_url, null);
  await assert.rejects(generator.queueGeneratorJob({ test_case_id: 'api', start_url: 'javascript:alert(1)' }), error => error.code === 'AUTOMATION_START_URL_INVALID');
});

test('a legacy leased browser job cannot adopt a later target or call the provider without its queued URL', async () => {
  const { state, generator } = fixture({ cases: [{ id: 'case', automation_start_url: 'https://later.example.test/' }], steps: [browserStep('case')] });
  state.jobs.set('legacy', { id: 'legacy', transaction_id: 'activity', test_case_id: 'case', status: 'leased', leased_by: 'worker', payload: { test_case_id: 'case', app_type_kind: 'web' } });
  await assert.rejects(generator.runLeasedJob({ job_id: 'legacy', worker_id: 'worker' }), error => error.code === 'AUTOMATION_START_URL_REQUIRED');
  assert.equal(state.providerCalls.length, 0);
});

test('queued desired URLs cannot overwrite later reviewed targets, while unchanged baselines retain explicit unsaved requests', async () => {
  const { state, generator, batch } = fixture({ cases: [{ id: 'case', automation_start_url: 'https://original.example.test/' }], steps: [browserStep('case')] });
  const single = await generator.queueGeneratorJob({ test_case_id: 'case', start_url: 'https://requested.example.test/signup' });
  await batch.queueAutomationBuild({ app_type_id: 'app', test_case_ids: ['case'], start_url: 'https://requested.example.test/signup' });
  assert.deepEqual(state.jobs.get(single.job_id).payload.start_url_review, { source_test_case_id: 'case', automation_test_case_id: 'case', automation_start_url: 'https://original.example.test/' });
  state.cases.get('case').automation_start_url = 'https://newer-review.example.test/';
  state.jobs.get(single.job_id).status = 'leased';
  state.jobs.get(single.job_id).leased_by = 'worker';
  await assert.rejects(generator.runLeasedJob({ job_id: single.job_id, worker_id: 'worker' }), error => error.code === 'AUTOMATION_START_URL_CHANGED');
  await assert.rejects(batch._runAutomationBuild({ payload: state.queued[0].payload, transaction_id: 'activity' }), error => error.code === 'AUTOMATION_START_URL_CHANGED');
  assert.equal(state.providerCalls.length, 0);
  assert.equal(state.cases.get('case').automation_start_url, 'https://newer-review.example.test/');
  state.cases.get('case').automation_start_url = 'https://original.example.test/';
  const fresh = await generator.queueGeneratorJob({ test_case_id: 'case', start_url: 'https://requested.example.test/signup' });
  state.jobs.get(fresh.job_id).status = 'leased';
  state.jobs.get(fresh.job_id).leased_by = 'worker';
  await generator.runLeasedJob({ job_id: fresh.job_id, worker_id: 'worker' });
  assert.equal(state.providerCalls[0].start_url, 'https://requested.example.test/signup');
  assert.equal(state.providerCalls[0].start_url_review.automation_start_url, 'https://original.example.test/');
});

test('a prepared target appearing or changing identity after queue review is rejected before generation', async () => {
  const { state, generator } = fixture({ cases: [{ id: 'manual', automated: 'no' }], steps: [browserStep('manual')] });
  const queued = await generator.queueGeneratorJob({ test_case_id: 'manual', start_url: 'https://requested.example.test/' });
  assert.equal(state.jobs.get(queued.job_id).payload.start_url_review.automation_test_case_id, null);
  state.jobs.get(queued.job_id).status = 'leased';
  state.jobs.get(queued.job_id).leased_by = 'worker';
  state.targets.manual = { id: 'new-prepared-target', automation_start_url: 'https://another-review.example.test/' };
  await assert.rejects(generator.runLeasedJob({ job_id: queued.job_id, worker_id: 'worker' }), error => error.code === 'AUTOMATION_START_URL_CHANGED');
  assert.equal(state.providerCalls.length, 0);
});

test('a durable retry may reuse its already-saved desired URL without accepting a different reviewed target', async () => {
  const { state, generator } = fixture({ cases: [{ id: 'case', automation_start_url: 'https://original.example.test/' }], steps: [browserStep('case')] });
  const queued = await generator.queueGeneratorJob({ test_case_id: 'case', start_url: 'https://requested.example.test/' });
  const job = state.jobs.get(queued.job_id);
  job.status = 'leased'; job.leased_by = 'worker';
  state.onBuild = async () => {
    state.cases.get('case').automation_start_url = 'https://requested.example.test/';
    throw Object.assign(new Error('Transient provider outage'), { statusCode: 503 });
  };
  await assert.rejects(generator.runLeasedJob({ job_id: queued.job_id, worker_id: 'worker' }), /Transient provider outage/);
  state.onBuild = null;
  await generator.runLeasedJob({ job_id: queued.job_id, worker_id: 'worker' });
  assert.equal(state.providerCalls.length, 2);
  assert.ok(state.providerCalls.every(call => call.start_url === 'https://requested.example.test/'));
  assert.equal(job.payload.start_url_review.automation_start_url, 'https://original.example.test/');
});

test('equivalent new preparation may resume, but an existing prepared target identity cannot be replaced', async () => {
  const { state, generator } = fixture({ cases: [{ id: 'manual', automated: 'no' }], steps: [browserStep('manual')] });
  const first = await generator.queueGeneratorJob({ test_case_id: 'manual', start_url: 'https://requested.example.test/' });
  const firstJob = state.jobs.get(first.job_id); firstJob.status = 'leased'; firstJob.leased_by = 'worker';
  state.targets.manual = { id: 'prepared-one', automation_start_url: 'https://requested.example.test/' };
  await generator.runLeasedJob({ job_id: first.job_id, worker_id: 'worker' });
  assert.equal(state.providerCalls.length, 1);
  const second = await generator.queueGeneratorJob({ test_case_id: 'manual', start_url: 'https://requested.example.test/' });
  const secondJob = state.jobs.get(second.job_id); secondJob.status = 'leased'; secondJob.leased_by = 'worker';
  state.targets.manual = { id: 'replacement-target', automation_start_url: 'https://requested.example.test/' };
  await assert.rejects(generator.runLeasedJob({ job_id: second.job_id, worker_id: 'worker' }), error => error.code === 'AUTOMATION_START_URL_CHANGED');
  assert.equal(state.providerCalls.length, 1);
});
