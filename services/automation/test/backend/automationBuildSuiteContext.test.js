const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { loadAutomationBuildSuiteContext } = require('../../backend/lib/automationBuildSuiteContext');
const { createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');

const caseRow = { id: 'case', automated: 'yes', app_type_id: 'app', project_id: 'project', parameter_values: {}, test_data_options: {} };
const suiteRow = (id, extra = {}) => ({ id, app_type_id: 'app', project_id: 'project', parameter_values: {}, test_data_options: {}, ...extra });
function fixture({ suites = [], memberships = [], dataSets = [] } = {}) {
  const reads = [];
  const database = { prepare: sql => ({ all: async (...args) => {
    reads.push({ sql, args });
    if (sql.includes('SELECT membership.suite_id FROM suite_test_cases')) return memberships.map(suite_id => ({ suite_id }));
    if (sql.includes('WITH RECURSIVE ancestry')) {
      const selected = typeof args[0] === 'string' ? JSON.parse(args[0]) : args[0];
      const ids = new Set(selected);
      for (const id of ids) {
        const row = suites.find(item => item.id === id && item.app_type_id === args[1] && item.project_id === args[3]);
        if (row?.parent_id) ids.add(row.parent_id);
      }
      return suites.filter(row => ids.has(row.id) && row.app_type_id === args[1] && row.project_id === args[3]).map(row => structuredClone(row));
    }
    if (sql.includes('SELECT data.* FROM test_data_sets')) {
      const ids = typeof args[0] === 'string' ? JSON.parse(args[0]) : args[0];
      return dataSets.filter(row => ids.includes(row.id) && row.project_id === args[1] && (row.app_type_id == null || row.app_type_id === args[2])).map(row => structuredClone(row));
    }
    if (sql.includes('FROM test_suites suite JOIN app_types app')) return suites.filter(row => row.app_type_id === args[0] && row.project_id === args[1] && (row.id === args[2] || memberships.includes(row.id))).map(({ id, app_type_id, project_id }) => ({ id, app_type_id, project_id }));
    throw new Error(`Unexpected suite-context query: ${sql}`);
  } }) };
  return { reads, database, suites, memberships, dataSets, load: input => loadAutomationBuildSuiteContext({ testCase: caseRow, projectId: 'project', hasSuiteAccess: true, database, ...input }) };
}

test('suite selection rejects invalid or unauthorized explicit inputs before database reads and scopes membership to the current app/project', async () => {
  const f = fixture({ suites: [suiteRow('current'), suiteRow('foreign', { app_type_id: 'other-app' })], memberships: ['current', 'foreign'] });
  for (const testSuiteId of ['', ' ', {}, [], 42, 'x'.repeat(201)]) await assert.rejects(f.load({ testSuiteId }), { code: 'AUTOMATION_BUILD_SUITE_INVALID', generation_provider_requests: 0, browser_actions: 0 });
  await assert.rejects(f.load({ testSuiteId: 'current', hasSuiteAccess: false }), { code: 'AUTOMATION_BUILD_SUITE_ACCESS_REQUIRED', statusCode: 403 });
  assert.equal(f.reads.length, 0);
  await assert.rejects(f.load({ testSuiteId: 'foreign' }), { code: 'AUTOMATION_BUILD_SUITE_INVALID', statusCode: 404 });
  const absent = await fixture().load();
  assert.deepEqual(absent, { test_suite_id: null, suite_selection_required: false });
  assert.match(f.reads[0].sql, /suite\.app_type_id=\? AND app\.project_id=\?/);
});

test('unselected suite preview never invents a context, while equivalent implicit choices are deterministic and conflicting sources require a selection', async () => {
  const f = fixture({ suites: [suiteRow('b', { parameter_values: { region: 'East' } }), suiteRow('a', { parameter_values: { region: 'East' } })], memberships: ['b', 'a'] });
  assert.deepEqual(await f.load({ allowUnselectedSuite: true }), { test_suite_id: null, suite_selection_required: true });
  assert.equal(f.reads.length, 1, 'a read-only unselected preview does not read ancestor values');
  const equivalent = await f.load();
  assert.equal(equivalent.test_suite_id, 'a');
  assert.deepEqual(equivalent.parameters, { 's.region': 'East' });
  assert.deepEqual(equivalent.source_snapshot.linked_suite_ids, ['a', 'b']);
  f.suites[0].parameter_values.region = 'West';
  await assert.rejects(f.load(), { code: 'AUTOMATION_BUILD_SUITE_SELECTION_REQUIRED', generation_provider_requests: 0, browser_actions: 0 });
  assert.equal((await f.load({ testSuiteId: 'b' })).parameters['s.region'], 'West');
  f.suites[0].parameter_values.region = 'East';
  f.suites[0].test_data_options = { private_parameter_names: ['region'] };
  await assert.rejects(f.load(), { code: 'AUTOMATION_BUILD_SUITE_SELECTION_REQUIRED' });
  assert.deepEqual(await f.load({ hasSuiteAccess: false, allowUnselectedSuite: true }), { test_suite_id: null, suite_selection_required: true });
  await assert.rejects(f.load({ hasSuiteAccess: false }), { code: 'AUTOMATION_BUILD_SUITE_ACCESS_REQUIRED' });
});

test('suite ancestor defaults, dataset policy, intentional empty values and private source values use the normal execution resolver', async () => {
  const f = fixture({
    suites: [
      suiteRow('parent', { parameter_values: { region: 'Parent', private_input: 'parent-private-value', 't.account': 'Parent account' }, test_data_set_id: 'data', test_data_options: { private_parameter_names: ['private_input'] } }),
      suiteRow('child', { parent_id: 'parent', parameter_values: { region: '', private_input: 'child-private-value' }, test_data_options: { override_test_case_data: false, private_parameter_names: ['private_input'] } })
    ], memberships: ['child'],
    dataSets: [{ id: 'data', project_id: 'project', app_type_id: 'app', mode: 'table', rows: [{ 't.account': 'Dataset account', 's.region': 'Dataset region', 'r.trace': 'Dataset trace' }] }]
  });
  const context = await f.load({ testSuiteId: 'child', lock: true });
  assert.deepEqual(context.parameters, { 's.region': '', 's.private_input': 'child-private-value', 't.account': 'Parent account' });
  assert.equal(context.dataSet.id, 'data');
  assert.equal(context.dataOptions.override_test_case_data, false);
  assert.deepEqual(context.private_parameter_names, ['s.private_input']);
  assert.deepEqual(context.source_snapshot.ancestors.map(row => row.id), ['parent', 'child']);
  assert.match(f.reads[0].sql, /FOR SHARE OF membership/);
  assert.match(f.reads[0].sql, /membership\.test_case_id=\? AND suite\.app_type_id=\? AND app\.project_id=\?/);
  assert.ok(f.reads.some(row => /FOR SHARE OF suite,app/.test(row.sql) && row.sql.includes('WITH RECURSIVE')));
  assert.ok(f.reads.some(row => row.sql.includes('test_data_sets') && /FOR SHARE/.test(row.sql)));
  const input = { caseValues: { 't.account': 'Own account' }, suiteValues: context.parameters, suiteDataSet: context.dataSet, suiteOptions: context.dataOptions, suitePrivateParameterNames: context.private_parameter_names, suiteSourceSnapshot: context.source_snapshot, testSuiteId: context.test_suite_id, materialize: false };
  const resolver = createBrowserParameterResolver(input);
  assert.equal(resolver.resolve('browser_fill', { value: '@t.account' }).value, 'Own account');
  assert.equal(resolver.resolve('browser_fill', { value: '@s.region' }).value, 'Dataset region');
  assert.equal(resolver.resolve('browser_fill', { value: '@s.private_input' }).value, 'child-private-value');
  assert.equal(resolver.promptValues['s.private_input'], '@s.private_input');
  assert.equal(resolver.projectText('parent-private-value child-private-value'), '[private parameter value] [private parameter value]');
  assert.doesNotMatch(JSON.stringify(resolver.buildData({ testCaseId: 'case' })), /parent-private-value|child-private-value/);
  const reviewed = createBrowserParameterResolver({ ...input, buildParameterValues: { 's.region': '', 't.account': '' } });
  assert.equal(reviewed.resolve('browser_fill', { value: '@s.region' }).value, '');
  assert.equal(reviewed.resolve('browser_fill', { value: '@t.account' }).value, '');
  assert.equal(reviewed.inputSourceKey, resolver.inputSourceKey, 'review edits do not mutate the source receipt');
});

test('selected suite source receipts include hidden ancestor revisions, policy and membership changes without materializing generators', async () => {
  const f = fixture({ suites: [suiteRow('parent', { parameter_values: { hidden: 'private-parent' }, test_data_options: { private_parameter_names: ['hidden'] } }), suiteRow('child', { parent_id: 'parent', parameter_values: { email: '{{yopmail}}' } })], memberships: ['child'] });
  const resolve = async () => {
    const c = await f.load({ testSuiteId: 'child' });
    return createBrowserParameterResolver({ suiteValues: c.parameters, suiteDataSet: c.dataSet, suiteOptions: c.dataOptions, suitePrivateParameterNames: c.private_parameter_names, suiteSourceSnapshot: c.source_snapshot, testSuiteId: c.test_suite_id, materialize: false });
  };
  const first = await resolve();
  assert.equal(first.resolve('browser_fill', { value: '@s.email' }).value, '{{yopmail}}');
  assert.deepEqual(first.deferredParameterNames, ['s.email']);
  const key = first.inputSourceKey;
  assert.equal((await resolve()).inputSourceKey, key);
  f.suites[0].parameter_values.hidden = 'changed-parent';
  assert.notEqual((await resolve()).inputSourceKey, key);
  const changed = (await resolve()).inputSourceKey;
  f.suites[0].test_data_options.override_suite_data = false;
  assert.notEqual((await resolve()).inputSourceKey, changed);
  const policy = (await resolve()).inputSourceKey;
  f.suites.push(suiteRow('other')); f.memberships.push('other');
  assert.notEqual((await resolve()).inputSourceKey, policy);
  const unavailable = fixture({ suites: [suiteRow('child', { test_data_set_id: 'foreign-data' })], memberships: ['child'], dataSets: [{ id: 'foreign-data', project_id: 'other-project', app_type_id: 'app' }] });
  await assert.rejects(unavailable.load(), { code: 'AUTOMATION_BUILD_SUITE_DATA_UNAVAILABLE', statusCode: 404 });
});

test('the authorized browser-input adapter loads the selected suite and rechecks permissions without returning private literals to its prompt', async () => {
  const f = fixture({ suites: [suiteRow('suite', { parameter_values: { region: 'East', password: 'suite-private-value' } })], memberships: ['suite'] });
  const local = createRequire(require.resolve('../../backend/lib/automationBrowserParameters'));
  const exported = { exports: {} }, checks = [];
  let dataAllowed = true, suiteAllowed = true;
  new Function('require', 'module', fs.readFileSync(require.resolve('../../backend/lib/automationBrowserParameters'), 'utf8'))(name => {
    if (name.endsWith('/db')) return f.database;
    if (name.endsWith('optionalEvidenceAccess.service')) return { getOptionalEvidenceAccess: async (user, projectId, permissions) => {
      checks.push({ user, projectId, permissions });
      return { 'data.view': dataAllowed, 'suite.view': suiteAllowed, 'testcase.view': true };
    } };
    if (name.endsWith('effectiveCaseDataSets.service')) return { loadEffectiveCaseDataSets: async () => [] };
    return local(name);
  }, exported);
  const input = { testCase: caseRow, projectId: 'project', userId: 'author', test_suite_id: 'suite', materialize: false, caseValues: { 't.name': 'Own name' } };
  const resolver = await exported.exports.loadBrowserParameterResolver(input);
  assert.equal(resolver.test_suite_id, 'suite');
  assert.ok(resolver.required_permissions.includes('suite.view'));
  assert.equal(resolver.resolve('browser_fill', { value: '@s.region' }).value, 'East');
  assert.equal(resolver.resolve('browser_fill', { value: '@s.password' }).value, 'suite-private-value');
  assert.equal(resolver.promptValues['s.password'], '@s.password');
  assert.equal(checks[0].projectId, 'project'); assert.equal(checks[0].user.id, 'author');
  assert.ok(checks[0].permissions.includes('data.view') && checks[0].permissions.includes('suite.view'));
  const reads = f.reads.length;
  suiteAllowed = false;
  await assert.rejects(exported.exports.loadBrowserParameterResolver(input), { code: 'AUTOMATION_BUILD_SUITE_ACCESS_REQUIRED', statusCode: 403 });
  dataAllowed = false;
  await assert.rejects(exported.exports.loadBrowserParameterResolver(input), { code: 'AUTOMATION_BUILD_DATA_ACCESS_REQUIRED', statusCode: 403 });
  assert.equal(f.reads.length, reads, 'revoked permissions stop selected-suite data reads');
});

test('source-save receipt checks reject changed suite defaults, policy and membership before any Plan write', async () => {
  const f = fixture({ suites: [suiteRow('parent', { parameter_values: { region: 'East' } }), suiteRow('child', { parent_id: 'parent' })], memberships: ['child'] });
  const source = fs.readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'), 'utf8');
  const body = source.slice(source.indexOf('const applyBuild ='), source.indexOf('const buildCaseCore ='));
  const current = { ...caseRow }, step = { id: 'step', test_case_id: 'case', step_order: 1, step_type: 'web', action: 'Use @s.region', expected_result: 'Region shown', automation_code: '' };
  const rows = [structuredClone(step)]; let writes = 0;
  const resolve = async input => {
    assert.equal(input.materialize, false);
    const context = await f.load({ testCase: input.testCase, testSuiteId: input.test_suite_id, lock: input.lock });
    return createBrowserParameterResolver({ caseValues: input.caseValues, suiteValues: context.parameters, suiteDataSet: context.dataSet, suiteOptions: context.dataOptions, suiteSourceSnapshot: context.source_snapshot, testSuiteId: context.test_suite_id, materialize: false });
  };
  const initial = await resolve({ testCase: current, test_suite_id: 'child', materialize: false });
  const apply = new Function('db', 'loadAutomationParameterContext', 'require', 'testStepService', 'markTestCaseAutomationIncomplete', 'markTestCaseAutomationReady', 'normalizeText', `${body}; return applyBuild;`)(
    { transaction: callback => callback, prepare: () => ({ get: async () => structuredClone(current), all: async () => structuredClone(rows) }) },
    async () => ({ source_key: 'own-case-unchanged', runtime_parameter_values: {} }),
    name => { if (name.endsWith('automationBrowserParameters')) return { loadBrowserParameterResolver: async input => { assert.equal(input.lock, true); return resolve(input); } }; throw new Error(`Unexpected save module ${name}`); },
    { updateTestStep: async (id, update) => { writes++; Object.assign(rows.find(row => row.id === id), update); } }, { run: async () => {} }, { run: async () => {} }, value => value
  );
  const build = { app_type_id: 'app', project_id: 'project', updates: [{ step, step_type: 'web', automation_code: 'await page.getByLabel("Region").fill("@s.region");' }] };
  const state = { steps: structuredClone(rows), parameter_context_key: 'own-case-unchanged', input_context: { selection: { test_suite_id: 'child' }, source_key: initial.inputSourceKey } };
  f.suites[0].parameter_values.region = 'West';
  await assert.rejects(apply({ build, progressiveState: state, createdBy: 'author', partial: true }), { code: 'AUTOMATION_PARAMETERS_CHANGED' });
  f.suites[0].parameter_values.region = 'East'; f.suites[0].test_data_options = { override_test_case_data: false };
  await assert.rejects(apply({ build, progressiveState: state, createdBy: 'author', partial: true }), { code: 'AUTOMATION_PARAMETERS_CHANGED' });
  f.suites[0].test_data_options = {}; f.memberships.length = 0;
  await assert.rejects(apply({ build, progressiveState: state, createdBy: 'author', partial: true }), { code: 'AUTOMATION_BUILD_SUITE_INVALID' });
  assert.equal(writes, 0);
  f.memberships.push('child');
  await apply({ build, progressiveState: state, createdBy: 'author', partial: true });
  assert.equal(writes, 1);
  assert.equal(state.input_context.selection.test_suite_id, 'child');
  assert.ok(f.reads.filter(row => row.sql.includes('SELECT membership.suite_id')).every(row => /FOR SHARE OF membership/.test(row.sql)));
});

test('batch builder respects an explicit case-specific empty suite instead of adopting the active scalar suite', async () => {
  const source = fs.readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'), 'utf8');
  const body = source.slice(source.indexOf('exports.buildAutomationBatch ='), source.indexOf('exports.listLearningCache ='));
  const received = [], module = { exports: {} };
  const local = createRequire(require.resolve('../../backend/services/aiAutomationBuilder.service'));
  new Function('exports', 'normalizeText', 'normalizeIdList', 'buildFeature', 'DEFAULT_BATCH_FAILURE_THRESHOLD', 'selectCaseWithScope', 'selectCasesForBatch', 'appendEvent', 'updateTransaction', 'buildCaseCore', 'workspaceTransactionService', 'require', body)(
    module.exports, value => value || null, values => values, value => value || 'ai.agentic.automation-engineer', 5,
    { get: async id => ({ id, app_type_id: 'app', project_id: 'project' }) }, { all: async () => [] }, async () => {}, async () => {},
    async input => { received.push(input); return { test_case_id: input.test_case_id, generated_step_count: 1 }; }, {}, local
  );
  const result = await module.exports.buildAutomationBatch({ app_type_id: 'app', test_case_ids: ['first', 'second', 'third'], test_suite_id: 'active-suite', test_suite_ids_by_case: { first: 'own-suite', second: null } });
  assert.equal(result.generated, 3); assert.equal(result.failed, 0);
  assert.deepEqual(received.map(row => [row.test_case_id, row.test_suite_id]), [['first', 'own-suite'], ['second', null], ['third', 'active-suite']]);
});
