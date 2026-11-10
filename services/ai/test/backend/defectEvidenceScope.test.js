const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { Readable } = require('node:stream');
const Fastify = require('fastify');

function load(filename, overrides) {
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(id => {
    const name = path.basename(id).replace(/\.js$/, '');
    return Object.hasOwn(overrides, name) ? overrides[name] : nativeRequire(id);
  }, module, module.exports);
  return module.exports;
}

const run = { id: 'run', project_id: 'project', name: 'Regression run', status: 'failed' };
const failure = { id: 'result', test_case_id: 'case', test_case_title: 'Frozen login', status: 'failed', error: 'Login rejected', logs: '{}', total_results: 1 };
const packet = { result_id: 'result', test_case_id: 'case', title: 'Frozen login', description: 'Original scenario', error: 'Login rejected',
  steps: [{ id: 'snap', order: 1, action: 'Submit original credentials', expected_result: 'Dashboard appears', observed_status: 'failed', note: 'Login stayed visible' }],
  comments: [{ body: 'Reproduced in staging' }], coverage: { total_steps: 1, omitted_steps: 0, unavailable_sources: [] } };

function fixture({ scopes = { suites: ['suite'], modules: ['module'] }, failures = [failure], packets = [packet],
  frozen = [{ id: 'case', title: 'Frozen login', description: 'Original scenario' }], selectedRun = run, query, liveCases = [], liveSteps = [], attachments = [], caseAccess = true } = {}) {
  const reads = [], packetCalls = [], downloads = [], modelCalls = [];
  const database = { prepare(sql) {
    const read = async (...params) => {
      reads.push({ sql, params });
      if (query) {
        const result = await query(sql, params);
        if (result !== undefined) return result;
      }
      if (/FROM projects/.test(sql)) return { id: 'project' };
      if (/FROM executions WHERE/.test(sql)) return selectedRun;
      if (/FROM test_suites scope/.test(sql)) return scopes.suites.map(id => ({ id, name: 'Selected suite' }));
      if (/FROM test_case_modules scope/.test(sql)) return scopes.modules.map(id => ({ id, name: 'Selected module' }));
      if (/FROM attachments/.test(sql)) return attachments.filter(row => row.entity_type === 'execution_result' || /entity_type = 'execution' AND/.test(sql));
      if (/FROM execution_results/.test(sql)) return failures;
      if (/FROM execution_case_snapshots snapshot/.test(sql)) return frozen;
      if (/FROM test_cases tc/.test(sql)) return liveCases;
      if (/FROM test_steps/.test(sql)) return liveSteps;
      return [];
    };
    return { get: read, all: read, run: () => assert.fail('Evidence collection cannot mutate records') };
  } };
  const reproduction = load(path.resolve(__dirname, '../../../testing/backend/services/defectReproduction.service.js'), { db: database });
  const service = load(path.resolve(__dirname, '../../backend/services/aiBugDraft.service.js'), {
    db: database, 'defectReproduction.service': reproduction,
    'permission.service': { hasPermission: async (_user, permission) => permission !== 'testcase.view' || caseAccess },
    'attachment.service': { download: async ({ id }) => {
      downloads.push(id);
      return { row: attachments.find(item => item.id === id), stream: Readable.from([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')]) };
    } },
    agentFailureEvidence: { collect: async input => { packetCalls.push(input); return packets; } },
    'aiLlmSelection.service': { resolveLlmIntegrationForUsage: async () => ({ id: 'model', model: 'fixture', is_active: true, base_url: 'https://provider.invalid/v1' }) },
    llmHttpClient: { fetchLlmWithRetry: async (_url, options) => {
      modelCalls.push(JSON.parse(options.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify({
      draft: { title: 'Login fails', message: 'The reporter observed a failed login.' }, field_evidence: { title: ['reporter:intent'], message: ['reporter:intent'] }
    }) } }] });
    } }
  });
  return { reads, packetCalls, downloads, modelCalls, service, collect: input => service._private.loadEvidence({ user: { id: 'reporter' }, projectId: 'project',
    testCaseIds: [], requirementIds: [], ...input }) };
}

test('run-only defect evidence hydrates failed frozen cases and comments even after the live case was deleted', async () => {
  const f = fixture();
  const result = await f.collect({ runId: 'run' });
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].title, 'Frozen login');
  assert.deepEqual(result.cases[0].reproduction_steps, ['Submit original credentials']);
  assert.equal(result.cases[0].source, 'execution_snapshot');
  assert.equal(result.failures[0].comments[0].body, 'Reproduced in staging');
  assert.deepEqual(f.packetCalls[0].testCaseIds, ['case']);
  assert.deepEqual(f.packetCalls[0].resultIds, ['result']);
  assert.ok(f.reads.every(item => !/FROM test_cases tc|FROM test_steps/.test(item.sql)), 'A run draft cannot replace history with mutable library steps');
  const frozenRead = f.reads.find(item => /FROM execution_case_snapshots snapshot/.test(item.sql));
  assert.match(frozenRead.sql, /owner\.project_id = \?/);
  assert.deepEqual(frozenRead.params, ['run', 'project', 'case']);
});

test('run suite and module scope intersect using frozen membership and never use live scope mappings', async () => {
  const f = fixture();
  const result = await f.collect({ runId: 'run', suiteIds: ['suite'], moduleIds: ['module'] });
  const read = f.reads.find(item => /FROM execution_results/.test(item.sql));
  assert.match(read.sql, /scoped_case\.suite_id IN \(\?\)/);
  assert.match(read.sql, /AND scoped_case\.module_id IN \(\?\)/);
  assert.deepEqual(read.params, ['run', 'suite', 'module']);
  assert.doesNotMatch(read.sql, /suite_test_cases|test_case_effective_module_cases/);
  assert.deepEqual(result.linked_test_suite_ids, ['suite']);
  assert.deepEqual(result.linked_module_ids, ['module']);
  const imageRead = f.reads.find(item => /FROM attachments/.test(item.sql));
  assert.doesNotMatch(imageRead.sql, /entity_type = 'execution' AND/);
});

test('explicit case and exact result selections stay authoritative when scope hints are also present', async () => {
  const f = fixture();
  await f.collect({ runId: 'run', resultId: 'result', testCaseIds: ['case'], suiteIds: ['suite'], moduleIds: ['module'] });
  const read = f.reads.find(item => /FROM execution_results/.test(item.sql));
  assert.match(read.sql, /execution_results\.test_case_id IN \(\?\)/);
  assert.match(read.sql, /execution_results\.id = \?/);
  assert.doesNotMatch(read.sql, /scoped_case|suite_test_cases/);
  assert.deepEqual(read.params, ['run', 'case', 'result']);
  assert.deepEqual(f.packetCalls[0].testCaseIds, ['case']);
});

test('case, suite and module selections exclude unrelated run-level screenshots even without an exact result selection', async () => {
  for (const selection of [{ testCaseIds: ['case'] }, { suiteIds: ['suite'] }, { moduleIds: ['module'] }]) {
    const f = fixture({ attachments: [{ id: 'unrelated-shot', project_id: 'project', entity_type: 'execution', entity_id: 'run',
      file_name: 'another-case.png', mime_type: 'image/png', size_bytes: 70 }] });
    const result = await f.collect({ runId: 'run', ...selection });
    assert.deepEqual(result.execution_images, []);
    assert.deepEqual(f.downloads, []);
    const imageRead = f.reads.find(item => /FROM attachments/.test(item.sql));
    assert.doesNotMatch(imageRead.sql, /entity_type = 'execution' AND/);
    assert.deepEqual(imageRead.params, ['project', 'result']);
  }
});

test('unknown or cross-project scope cannot widen a run draft to every failed case or run screenshot', async () => {
  const f = fixture({ scopes: { suites: [], modules: ['module'] }, query: (sql, params) => {
    if (/FROM test_suites scope/.test(sql)) {
      assert.match(sql, /app\.project_id = \?/);
      assert.deepEqual(params, ['project', 'foreign-suite']);
      return [];
    }
    if (/FROM execution_results/.test(sql)) { assert.match(sql, /AND FALSE/); return []; }
  } });
  const result = await f.collect({ runId: 'run', suiteIds: ['foreign-suite'], moduleIds: ['module'] });
  assert.deepEqual(result.cases, []);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.linked_test_suite_ids, []);
  assert.equal(result.boundaries.omitted.suites, 1);
  assert.equal(f.packetCalls.length, 0);
  assert.ok(!f.reads.some(item => /FROM attachments/.test(item.sql)));
});

test('standalone suite and module scope resolves bounded live specifications with project fences and disclosed omissions', async () => {
  const f = fixture({ liveCases: [{ id: 'case', title: 'Current login', authoring_mode: 'structured' }],
    liveSteps: [{ id: 'live-step', test_case_id: 'case', step_order: 1, action: 'Submit current credentials', expected_result: 'Dashboard appears', total_case_steps: 1 }],
    query: (sql, params) => {
      if (/total_scope_cases/.test(sql)) {
        assert.match(sql, /app\.project_id = \?/);
        assert.match(sql, /suite_test_cases/);
        assert.match(sql, /AND EXISTS \(SELECT 1 FROM test_case_effective_module_cases/);
        assert.deepEqual(params, ['project', 'suite', 'suite', 'module']);
        return [{ id: 'case', total_scope_cases: 12 }];
      }
    } });
  const result = await f.collect({ suiteIds: ['suite'], moduleIds: ['module'] });
  assert.deepEqual(result.cases[0].reproduction_steps, ['Submit current credentials']);
  assert.equal(result.boundaries.requested.test_cases, 12);
  assert.equal(result.boundaries.omitted.test_cases, 11);
  assert.equal(result.boundaries.partial_sources, true);
  assert.ok(!f.reads.some(item => /FROM execution_results/.test(item.sql)));
});

test('legacy run results retain recorded errors and titles without inventing frozen or current actions', async () => {
  const f = fixture({ frozen: [], packets: [{ ...packet, steps: [], title: 'Legacy login', coverage: { unavailable_sources: ['Frozen step details'] } }] });
  const result = await f.collect({ runId: 'run' });
  assert.equal(result.cases[0].source, 'execution_result');
  assert.equal(result.cases[0].title, 'Legacy login');
  assert.deepEqual(result.cases[0].reproduction_steps, []);
  assert.equal(result.failures[0].error, 'Login rejected');
  assert.equal(result.boundaries.omitted.execution_failure_sources_unavailable, 1);
  assert.equal(result.boundaries.partial_sources, true);
  assert.ok(f.reads.every(item => !/FROM test_steps/.test(item.sql)));
});

test('run and result viewers can draft from failure facts without case permission or frozen action disclosure', async () => {
  const f = fixture({ caseAccess: false });
  const result = await f.service.preview({ user: { id: 'reporter' }, project_id: 'project', intent: 'Login fails', linked_test_run_id: 'run' });
  assert.equal(result.draft.title, 'Login fails');
  assert.equal(result.draft.linked_test_run_id, 'run');
  assert.deepEqual(result.draft.linked_test_case_ids, []);
  assert.equal(result.boundaries.omitted.execution_case_context_access, 1);
  assert.equal(result.boundaries.partial_sources, true);
  assert.equal(f.packetCalls.length, 0);
  assert.ok(f.reads.every(item => !/FROM execution_case_snapshots snapshot|FROM execution_step_snapshots snapshot/.test(item.sql)));
  assert.equal(f.modelCalls.length, 1);
  const prompt = JSON.stringify(f.modelCalls[0].messages);
  assert.match(prompt, /Login rejected/);
  assert.doesNotMatch(prompt, /Submit original credentials|Original scenario/);
});

test('unavailable optional context does not block drafting with reporter evidence or bypass authorization failures', async () => {
  const f = fixture({ query: sql => {
    if (/FROM executions WHERE/.test(sql)) throw new Error('Run storage unavailable');
  } });
  const result = await f.service.preview({ user: { id: 'reporter' }, project_id: 'project', linked_test_run_id: 'run', intent: 'Login fails' });
  assert.equal(result.draft.title, 'Login fails');
  assert.equal(result.draft.linked_test_run_id, '');
  assert.equal(result.boundaries.omitted.context_sources_unavailable, 1);
  const forbidden = fixture({ query: sql => {
    if (/FROM executions WHERE/.test(sql)) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
  } });
  await assert.rejects(forbidden.collect({ runId: 'run' }), { statusCode: 403 });
});

test('defect preview returns only project-validated suite and module links', async () => {
  const f = fixture({ scopes: { suites: ['suite'], modules: [] } });
  const result = await f.service.preview({ user: { id: 'reporter' }, project_id: 'project', intent: 'Login fails',
    linked_test_case_ids: ['case'], linked_test_suite_ids: ['suite', 'foreign-suite'], linked_module_ids: ['foreign-module'] });
  assert.deepEqual(result.draft.linked_test_suite_ids, ['suite']);
  assert.deepEqual(result.draft.linked_module_ids, []);
  assert.equal(result.boundaries.omitted.suites, 1);
  assert.equal(result.boundaries.omitted.modules, 1);
});

test('scope-aware draft routes enforce native case/suite permissions before calling the model path', async t => {
  const checks = [];
  let denied, previews = 0;
  const routes = load(path.resolve(__dirname, '../../../testing/backend/routes/issues.routes.js'), {
    'aiBugDraft.service': { preview: async input => { previews++; return { suites: input.linked_test_suite_ids, modules: input.linked_module_ids }; } },
    'projectAccess': { getProject: async () => ({ id: 'project' }) },
    'featureFlag.service': { isEnabled: async () => true }
  });
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  await app.register(require('../../../platform/backend/src/plugins/validator'));
  app.decorate('authenticate', async req => { req.user = { id: 'reporter' }; });
  app.decorate('requirePermission', permission => async () => {
    checks.push(permission);
    if (permission === denied) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
  });
  await app.register(routes);
  for (const base of ['/feedback', '/issues']) {
    const response = await app.inject({ method: 'POST', url: `${base}/ai-draft-preview`, payload: {
      project_id: 'project', intent: 'Login fails', linked_test_suite_ids: ['suite'], linked_module_ids: ['module']
    } });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { suites: ['suite'], modules: ['module'] });
    assert.ok(checks.includes('testcase.view'));
    assert.ok(checks.includes('suite.view'));
    denied = 'testcase.view';
    const start = checks.length;
    const allowedRun = await app.inject({ method: 'POST', url: `${base}/ai-draft-preview`, payload: { project_id: 'project', linked_test_run_id: 'run', intent: 'Login fails' } });
    assert.equal(allowedRun.statusCode, 200);
    assert.ok(!checks.slice(start).includes('testcase.view'));
    const blockedCase = await app.inject({ method: 'POST', url: `${base}/ai-draft-preview`, payload: { project_id: 'project', linked_test_case_ids: ['case'] } });
    assert.equal(blockedCase.statusCode, 403);
    const blocked = await app.inject({ method: 'POST', url: `${base}/ai-draft-preview`, payload: { project_id: 'project', linked_module_ids: ['module'] } });
    assert.equal(blocked.statusCode, 403);
    denied = 'suite.view';
    const blockedSuite = await app.inject({ method: 'POST', url: `${base}/ai-draft-preview`, payload: { project_id: 'project', linked_test_suite_ids: ['suite'] } });
    assert.equal(blockedSuite.statusCode, 403);
    denied = undefined;
  }
  assert.equal(previews, 4, 'Denied requests cannot reach evidence or model collection');
});
