const assert = require('node:assert/strict');
const test = require('node:test');
const db = require('../src/db');
const analytics = require('../src/services/qualityAnalytics.service');
const dashboards = require('../src/services/qualityDashboard.service');

const fixture = (overrides = {}) => ({
  project: { id: 'project-1', key: 'P1', name: 'Project one' },
  requirements: [
    { id: 'story-1', title: 'Covered story', status: 'ready', priority: 1, test_case_ids: ['case-1'], release: 'R1' },
    { id: 'story-2', title: 'Uncovered story', status: 'draft', priority: 2, test_case_ids: [], release: 'R2' }
  ],
  testCases: [
    { id: 'case-1', title: 'Automated checkout', status: 'active', automated: 'yes', requirement_ids: ['story-1'], module_ids: ['module-1'], created_at: '2026-01-12T00:00:00Z' },
    { id: 'case-2', title: 'Manual account', status: 'active', automated: 'no', requirement_ids: [], module_ids: ['module-2'], created_at: '2026-02-12T00:00:00Z' }
  ],
  suites: [{ id: 'suite-1', name: 'Checkout suite', test_case_ids: ['case-1'] }, { id: 'suite-2', name: 'Other suite', test_case_ids: ['case-2'] }],
  executions: [
    { id: 'run-1', name: 'Failed checkout', status: 'failed', release: 'R1', started_at: '2026-09-09T10:00:00Z', ended_at: '2026-09-09T12:00:00Z' },
    { id: 'run-2', name: 'Current work', status: 'running', release: 'R2' }
  ],
  results: [{ id: 'result-1', execution_id: 'run-1', test_case_id: 'case-1', status: 'failed' }],
  plannedCaseIds: new Set(['case-1', 'case-2']),
  issues: [{ id: 'issue-1', title: 'Open defect', status: 'open', priority: 'high', assignee_name: 'Asha', release: 'R1' }, { id: 'issue-2', title: 'Closed defect', status: 'closed', assignee_name: 'Ben', release: 'R2' }],
  modules: [{ id: 'module-1', name: 'Checkout' }, { id: 'module-2', name: 'Accounts' }],
  ...overrides
});
const evaluate = (metric, type = 'table', group_by = 'status', context = fixture()) => analytics.evaluateContextGadget({ context, metrics: analytics.calculateMetrics(context, Date.parse('2026-09-10T00:00:00Z')), gadget: { metric, type, group_by }, evaluatedAt: '2026-09-10T00:00:00Z' });

function mockEvidence(t, { failRelease } = {}) {
  const reads = [];
  const data = fixture();
  t.mock.method(db, 'prepare', (sql) => {
    const query = sql.replace(/\s+/g, ' ').trim();
    return {
      get: async (...args) => { reads.push({query,args}); return { id: args[0], name: args[0] }; },
      all: async (...args) => {
        reads.push({query,args});
        if (query.includes('FROM execution_results')) {
          if (args[1] === failRelease) throw new Error('Evidence scope unavailable');
          return data.results.filter(item => !args[1] || data.executions.some(run => run.id === item.execution_id && run.release.toLowerCase() === args[1]));
        }
        if (query.includes('FROM execution_case_snapshots')) return args[1] === 'r2' ? [] : [{ test_case_id: 'case-1', suite_id: 'suite-1' }];
        if (query.includes('FROM requirements WHERE')) return data.requirements;
        if (query.includes('FROM test_cases LEFT JOIN')) return data.testCases;
        if (query.includes('FROM test_suites JOIN')) return data.suites;
        if (query.includes('FROM executions LEFT')) return data.executions;
        if (query.includes('FROM feedback')) return data.issues;
        if (query.includes('FROM test_case_modules JOIN')) return data.modules;
        throw new Error(`Unexpected query: ${query}`);
      }
    };
  });
  return reads;
}

test('batch shares nine reads for all widgets in one normalized release, preserves order and refreshes next request', async (t) => {
  const reads = mockEvidence(t);
  const gadgets = Array.from({length: 12}, (_, index) => ({id: `widget-${index}`, metric: index % 2 ? 'testCases' : 'coverageGaps', release: index % 2 ? ' r1 ' : 'R1', type: 'metric'}));
  const response = await dashboards.evaluateBatch({projectId:'project-1',gadgets});
  assert.equal(reads.length, 9);
  assert.deepEqual(response.results.map(item=>item.gadget_id), gadgets.map(item=>item.id));
  assert.equal(response.results.some(item=>item.error), false);
  assert.equal(new Set(response.results.map(item=>item.result.evaluated_at)).size, 1);
  assert.ok(response.results.every(item=>item.result.rows.length === 0 && item.result.series.length === 0));
  await dashboards.evaluateBatch({projectId:'project-1',gadgets});
  assert.equal(reads.length, 18, 'refresh must not reuse cross-request evidence');
});

test('release-scoped batches isolate values and failed scopes without discarding healthy widgets', async (t) => {
  const reads = mockEvidence(t, {failRelease:'broken'});
  const response = await dashboards.evaluateBatch({projectId:'project-1',gadgets:[
    {id:'r1',metric:'testSuites',release:'R1'}, {id:'r2',metric:'testSuites',release:'R2'},
    {id:'bad1',metric:'testCases',release:'broken'}, {id:'bad2',metric:'passRate',release:'BROKEN'}
  ]});
  assert.equal(reads.length, 27);
  assert.equal(response.results[0].result.value, 1);
  assert.equal(response.results[1].result.value, 0);
  assert.equal(response.results[2].error.message, 'Evidence scope unavailable');
  assert.equal(response.results[3].error.message, 'Evidence scope unavailable');
});

test('request-local evidence cache includes the project identity', async (t) => {
  const reads = mockEvidence(t);
  const evaluationCache = new Map();
  const a = await analytics.evaluateGadget({projectId:'project-a',gadget:{metric:'testCases'},evaluationCache});
  const b = await analytics.evaluateGadget({projectId:'project-b',gadget:{metric:'testCases'},evaluationCache});
  assert.equal(a.project.id, 'project-a');
  assert.equal(b.project.id, 'project-b');
  assert.equal(reads.length, 18);
});

test('batch bounds independent scope work to two workers, retaining input order', async (t) => {
  const pending = [];
  t.mock.method(analytics, 'evaluateGadget', ({gadget}) => new Promise(resolve => pending.push({id:gadget.id,resolve})));
  const response = dashboards.evaluateBatch({projectId:'project-1',gadgets:[{id:'one'},{id:'two'},{id:'three'}]});
  assert.deepEqual(pending.map(item=>item.id), ['one','two']);
  pending[1].resolve({project:{id:'project-1'}});
  await Promise.resolve();
  assert.deepEqual(pending.map(item=>item.id), ['one','two','three']);
  pending[2].resolve({project:{id:'project-1'}});
  pending[0].resolve({project:{id:'project-1'}});
  assert.deepEqual((await response).results.map(item=>item.gadget_id), ['one','two','three']);
});

test('defect, story, run and suite tables use the actual metric evidence', () => {
  for (const [metric, id, target, type] of [
    ['openDefects','issue-1','/issues','issue'], ['coverageGaps','story-2','/requirements','story'],
    ['failedRuns','run-1','/executions','test-run'], ['testSuites','suite-1','/test-suites','test-suite']
  ]) {
    const result=evaluate(metric);
    assert.equal(result.rows[0].id,id);
    assert.equal(result.rows[0].type,type);
    assert.equal(result.drilldown_target,target);
  }
  assert.equal(evaluate('openDefects').rows.length,1);
  assert.equal(evaluate('completedRuns30d').value,1);
  assert.equal(evaluate('executionCycleHours').value,2);
});

test('coverage, automation, outcome and module charts provide meaningful matching distributions', () => {
  assert.deepEqual(evaluate('requirementCoverage','donut').series,[{label:'Covered',value:1},{label:'Uncovered',value:1}]);
  assert.deepEqual(evaluate('automationCoverage','donut').series,[{label:'Automated',value:1},{label:'Manual',value:1}]);
  assert.deepEqual(evaluate('passRate','bar').series,[{label:'failed',value:1}]);
  assert.deepEqual(evaluate('executionCompletion','bar').series,[{label:'failed',value:1},{label:'pending',value:1}]);
  assert.deepEqual(evaluate('moduleCaseCount','bar','module').series,[{label:'Accounts',value:1},{label:'Checkout',value:1}]);
  assert.deepEqual(evaluate('openDefects','bar','assignee').series,[{label:'Asha',value:1}]);
});

test('time groups use UTC calendar buckets in chronological order, not descending frequency', () => {
  const records = [{created_at:'2026-03-02T00:00:00Z'}, {created_at:'2026-03-03T00:00:00Z'}, {created_at:'2026-01-04T23:00:00Z'}, {created_at:'2026-02-01T00:00:00Z'}];
  assert.deepEqual(analytics.groupRecords(records,'createdMonth'),[{label:'2026-01',value:1},{label:'2026-02',value:1},{label:'2026-03',value:2}]);
  assert.deepEqual(analytics.groupRecords(records.slice(2),'createdWeek'),[{label:'2025-12-29',value:1},{label:'2026-01-26',value:1}]);
});

test('scalar/chart payloads omit unused rows while all records contribute; tables are capped with truthful truncation', () => {
  const context=fixture({testCases:Array.from({length:250},(_,index)=>({id:`case-${index}`,status:index<150?'active':'draft'}))});
  const scalar=evaluate('testCases','metric','status',context);
  assert.equal(scalar.value,250); assert.equal(scalar.returned,250); assert.equal(scalar.rows.length,0); assert.equal(scalar.truncated,false);
  const chart=evaluate('testCases','bar','status',context);
  assert.deepEqual(chart.series,[{label:'active',value:150},{label:'draft',value:100}]); assert.equal(chart.rows.length,0);
  const table=evaluate('testCases','table','status',context);
  assert.equal(table.value,250); assert.equal(table.rows.length,100); assert.equal(table.truncated,true);
});

test('manual N/A and aborted outcomes complete planned work without inflating pass rate', () => {
  const context=fixture({results:[{test_case_id:'case-1',status:'skipped'},{test_case_id:'case-2',status:'aborted'}]});
  const metrics=analytics.calculateMetrics(context);
  assert.equal(metrics.executionCompletion,100);
  assert.equal(metrics.passRate,0);
  assert.ok(metrics.releaseConfidence<=49);
});

test('unsupported Jira/JQL widgets return truthful individual errors without reading unauthorized source data', async (t) => {
  const reads=mockEvidence(t);
  const result=await dashboards.evaluateBatch({projectId:'project-1',gadgets:[{id:'native',metric:'testCases'},{id:'jira',data_source:'jira',jql:'project=OTHER'},{id:'query',jql:'status=open'}]});
  assert.equal(result.results[0].result.value,2);
  assert.equal(result.results[1].error.code,'DASHBOARD_QUERY_UNSUPPORTED');
  assert.equal(result.results[2].error.code,'DASHBOARD_QUERY_UNSUPPORTED');
  assert.equal(reads.length,9);
});

test('QA alias uses the existing quality template and unknown stakeholders normalize to executive', () => {
  assert.deepEqual(dashboards.designPreview({projectId:'p',stakeholder:'qa'}).dashboard.gadgets.map(item=>item.metric),dashboards.designPreview({projectId:'p',stakeholder:'quality'}).dashboard.gadgets.map(item=>item.metric));
  assert.equal(dashboards.designPreview({projectId:'p',stakeholder:'unknown'}).dashboard.name,'Executive overview');
});

test('deterministic stakeholder presets match native scalar, chart and action-table choices', () => {
  for (const [stakeholder, count, name] of [['executive',7,'Executive overview'],['product',8,'Product quality'],['quality',8,'QA workspace']]) {
    const {dashboard} = dashboards.designPreview({projectId:'p',stakeholder,release:'R1'});
    assert.equal(dashboard.name,name); assert.equal(dashboard.gadgets.length,count);
    assert.ok(dashboard.gadgets.some(item=>item.type==='table'));
    assert.ok(dashboard.gadgets.some(item=>item.type==='donut'));
    assert.ok(dashboard.gadgets.every(item=>item.data_source==='hellotest' && item.jql==='' && item.release==='R1'));
    for (const gadget of dashboard.gadgets) assert.doesNotThrow(()=>evaluate(gadget.metric,gadget.type,gadget.group_by));
  }
});

test('invalid native metrics fail saving and single-widget preview with the same error before evidence reads', async (t) => {
  let reads = 0;
  t.mock.method(db, 'prepare', () => { reads++; throw new Error('No database access expected'); });
  t.mock.method(db, 'transaction', () => { throw new Error('No write transaction expected'); });
  for (const metric of ['averageAgeDays', 'inventedSignal', 'constructor']) {
    const gadget = { id: 'invalid', data_source: 'hellotest', metric };
    const error = {code:'DASHBOARD_METRIC_UNSUPPORTED',statusCode:400};
    assert.throws(() => dashboards.normalizeGadgets([gadget]), error);
    await assert.rejects(dashboards.create({input:{project_id:'project-1',name:'Invalid signal',gadgets:[gadget]},userId:'user-1'}), error);
    await assert.rejects(analytics.evaluateGadget({projectId:'project-1',gadget}), error);
    assert.throws(() => evaluate(metric), error);
  }
  assert.equal(reads, 0);
});

test('saved unsupported signals remain readable and metadata-editable but cannot be newly submitted', async (t) => {
  const saved = { id:'saved-1',project_id:'project-1',name:'Legacy',layout:'two-column',gadgets:[{id:'legacy',data_source:'hellotest',metric:'averageAgeDays'}] };
  let writes = 0;
  t.mock.method(db,'transaction',fn=>fn);
  t.mock.method(db,'prepare',sql=>({
    get:async (...args)=>{
      if (sql.includes('SELECT * FROM quality_dashboards')) return saved;
      if (sql.includes('UPDATE quality_dashboards')) { writes++; return {...saved,name:args[0],gadgets:args[3]}; }
      throw new Error('Unexpected database operation');
    },
    all:async ()=>[saved]
  }));
  assert.equal((await dashboards.get(saved.id)).gadgets[0].metric,'averageAgeDays');
  assert.equal((await dashboards.list(saved.project_id))[0].gadgets[0].metric,'averageAgeDays');
  await assert.rejects(dashboards.update({id:saved.id,input:{gadgets:saved.gadgets},userId:'user-1'}),{code:'DASHBOARD_METRIC_UNSUPPORTED',statusCode:400});
  assert.equal(writes,0);
  const renamed = await dashboards.update({id:saved.id,input:{name:'Renamed legacy'},userId:'user-1'});
  assert.equal(renamed.name,'Renamed legacy');
  assert.equal(renamed.gadgets[0].metric,'averageAgeDays');
});

test('legacy unsupported metric errors stay individual and never become an issue-count signal', async (t) => {
  const reads = mockEvidence(t);
  const response = await dashboards.evaluateBatch({projectId:'project-1',gadgets:[
    {id:'legacy',data_source:'hellotest',metric:'averageAgeDays'},
    {id:'unknown',data_source:'hellotest',metric:'inventedSignal'},
    {id:'healthy',data_source:'hellotest',metric:'testCases',release:' R1 '}
  ]});
  for (const result of response.results.slice(0,2)) {
    assert.equal(result.error.code,'DASHBOARD_METRIC_UNSUPPORTED');
    assert.equal(result.error.status,400);
    assert.equal(result.result,undefined);
  }
  assert.equal(response.results[2].result.value,1);
  assert.equal(reads.length,9);
  assert.deepEqual(dashboards.normalizeGadgets([{}]).map(item=>item.metric),['count']);
});

test('confidence charts expose only the components used by their respective formulas', () => {
  const context = fixture();
  const metrics = analytics.calculateMetrics(context);
  assert.equal(metrics.defectContainment, 50);
  assert.equal(metrics.defectTraceability, 0);
  assert.deepEqual(evaluate('releaseConfidence', 'bar', 'status', context).series, [
    {label:'Requirement coverage',value:50}, {label:'Execution completion',value:50},
    {label:'Pass rate',value:0}, {label:'Defect containment',value:50}
  ]);
  assert.deepEqual(evaluate('evidenceConfidence', 'bar', 'status', context).series, [
    {label:'Requirement coverage',value:50}, {label:'Execution completion',value:50},
    {label:'Defect traceability',value:0}
  ]);
  assert.equal(metrics.releaseConfidence, 33);
  assert.equal(metrics.evidenceConfidence, 40);
});

test('story joins count unique stories, require every linked case outcome and retain uncovered scope', () => {
  const context = fixture({
    requirements: [
      {id:'s1',status:'Dev Done',test_case_ids:['c1','c1','c2']},
      {id:'s2',status:'QA_Done',test_case_ids:['c2']},
      {id:'s3',status:'QA Blocked',test_case_ids:['foreign-case']},
      {id:'s4',status:'draft',test_case_ids:[]}
    ],
    testCases: [{id:'c1',requirement_ids:['s1']},{id:'c2',requirement_ids:['s1','s2']},{id:'orphan',requirement_ids:[]}],
    results: [{test_case_id:'c1',status:'blocked'},{test_case_id:'c2',status:'passed'},{test_case_id:'foreign-case',status:'passed'}],
    issues: [{id:'d1',status:'open',linked_test_case_ids:['c1','c1']},{id:'d2',status:'resolved',linked_requirement_ids:['s2']},{id:'foreign',status:'open',linked_requirement_ids:['foreign-story']}]
  });
  assert.equal(evaluate('devStoryCompletion','metric','status',context).value,75);
  assert.equal(evaluate('qaStoryCompletion','metric','status',context).value,25);
  assert.equal(evaluate('storyTestPassRate','metric','status',context).value,25);
  assert.equal(evaluate('storyExecutionCoverage','metric','status',context).value,50);
  assert.deepEqual(evaluate('storyTestPassRate','donut','status',context).series,[{label:'All Tests Passed',value:1},{label:'Not All Passed',value:3}]);
  assert.equal(evaluate('linkedTestCases','metric','status',context).value,2);
  assert.equal(evaluate('storiesWithOpenDefects','table','status',context).rows[0].id,'s1');
  assert.equal(evaluate('linkedDefects','metric','status',context).value,2);
  assert.equal(evaluate('defectTraceability','metric','status',context).value,67);
  assert.equal(evaluate('unlinkedTestCases','metric','status',context).value,1);
  assert.equal(evaluate('unexecutedCases','metric','status',context).value,1);
  assert.equal(evaluate('blockedCases','table','status',context).rows[0].id,'c1');
});

test('release and story groupings use relational identities and explain repeated memberships', () => {
  const context=fixture({requirements:[{id:'s1',title:'Shared',test_case_ids:['case-1'],native_releases:[{id:'rel1',name:'Release One'},{id:'rel2',name:'Release Two'}]}]});
  assert.deepEqual(evaluate('stories','column','release',context).series,[{label:'Release One',value:1},{label:'Release Two',value:1}]);
  const cases=evaluate('linkedTestCases','bar','story',context);
  assert.deepEqual(cases.series,[{label:'s1: Shared',value:1}]);
  assert.match(cases.methodology,/grouped counts can exceed the distinct total/);
  for (const id of ['traceability','delivery','triage']) {
    const preset=dashboards.designPreview({projectId:'p',stakeholder:id}).dashboard;
    assert.equal(preset.gadgets.length,8);
    for (const gadget of preset.gadgets) assert.doesNotThrow(()=>evaluate(gadget.metric,gadget.type,gadget.group_by,context));
  }
  assert.equal(dashboards.normalizeGadgets([{type:'area',metric:'count'},{type:'column',metric:'stories',group_by:'release'}])[1].group_by,'release');
});

test('widget permission failures are isolated before evidence lookup and contain no hidden totals', async (t) => {
  let evaluations=0;
  t.mock.method(analytics,'evaluateGadget',async ({gadget})=>{ evaluations++; return {project:{id:'p'},value:gadget.metric==='stories'?3:99}; });
  const response=await dashboards.evaluateBatch({projectId:'p',gadgets:[{id:'denied',metric:'linkedDefects'},{id:'visible',metric:'stories'}],authorizeGadget:async gadget=>{
    if(gadget.metric==='linkedDefects') throw Object.assign(new Error('You do not have access to this source.'),{statusCode:403,code:'FORBIDDEN'});
  }});
  assert.equal(evaluations,1);
  assert.equal(response.results[0].error.status,403);
  assert.equal(response.results[0].result,undefined);
  assert.equal(response.results[1].result.value,3);
});
