const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../platform/backend/src/db');
const executions = require('../../backend/services/execution.service');
const mobile = require('../../../platform/backend/services/mobileFeature.service');
const serviceSource = require('node:fs').readFileSync(require.resolve('../../backend/services/execution.service'), 'utf8');
const startModeDeclaration = serviceSource.slice(serviceSource.indexOf('const resolveExecutionStartMode ='), serviceSource.indexOf('const assertExecutableDispatchPlan ='));
const implicitStartMode = new Function(`${startModeDeclaration}; return resolveExecutionStartMode;`)();

const parsed = value => typeof value === 'string' && /^[\[{]/.test(value) ? JSON.parse(value) : value;
function insertedRows(statements, table) {
  return statements.filter(entry => new RegExp(`INSERT INTO ${table}\\s*\\(`).test(entry.sql)).flatMap(entry => {
    const columns = entry.sql.match(new RegExp(`INSERT INTO ${table}\\s*\\(([^)]+)\\)`))[1].split(',').map(column => column.trim());
    const values = entry.sql.match(/VALUES\s*\(([^)]+)\)/)[1].split(',').map(value => value.trim());
    let offset = 0;
    return Array.from({length: entry.values.length / values.filter(value => !/^'/.test(value)).length}, () => Object.fromEntries(columns.map((column, index) =>
      [column, /^'/.test(values[index]) ? values[index].slice(1, -1) : parsed(entry.values[offset++])])));
  });
}
function fixture(context, {mode, trigger, execution_mode}) {
  const cases = ['failed-case', 'passed-case'].map(test_case_id => ({test_case_id, test_case_title: test_case_id,
    automated: 'yes', suite_id: 'frozen-suite', suite_name: 'Frozen suite',
    parameter_values: {'r.name': 'old case sample', 'r.private': 'fixture-frozen-private'},
    parameter_template_values: {'r.name': '{{randomString:16}}', 'r.private': 'fixture-frozen-private'},
    suite_parameter_values: {'s.reference': 'old suite sample'}, suite_parameter_template_values: {'s.reference': '{{randomString:16}}'},
    test_data_options: {private_parameter_names: ['r.private']}}));
  const steps = cases.map(row => ({test_case_id: row.test_case_id, snapshot_step_id: `old-${row.test_case_id}`, step_order: 1,
    action: 'Enter @r.name', expected_result: 'Name is retained', step_type: 'web',
    automation_code: 'await page.getByLabel("Name").fill("@r.name"); await expect(page.getByLabel("Name")).toHaveValue("@r.name");'}));
  const source = {id: 'parent', name: 'Frozen parent', project_id: 'project', app_type_id: 'app', status: 'completed', mode, run_mode: mode, trigger, execution_mode,
    assigned_to: 'actor', direct_test_case_ids: cases.map(row => row.test_case_id), case_snapshots: cases, step_snapshots: steps,
    suite_snapshots: [{id: 'frozen-suite', name: 'Frozen suite'}],
    test_environment: {id: 'env', name: 'Frozen environment', snapshot: {variables: [{key: 'reference', value: 'old env sample'}], template_variables: [{key: 'reference', value: '{{randomString:16}}'}]}},
    test_configuration: {id: 'config', name: 'Frozen config', snapshot: {variables: [{key: 'reference', value: 'old config sample'}], template_variables: [{key: 'reference', value: '{{randomString:16}}'}]}},
    test_data_set: {id: 'dataset', name: 'Frozen dataset', snapshot: {mode: 'table', rows: [{'r.row': 'old row sample'}], template_rows: [{'r.row': '{{randomString:16}}'}]}},
    parallel_enabled: true, parallel_count: 3, execution_hooks: []};
  const original = structuredClone(source), statements = [];
  const query = async statement => {
    const sql = typeof statement === 'string' ? statement : statement.text, values = statement.values || [];
    statements.push({sql, values});
    let rows = [];
    if (/SELECT \*\s+FROM executions/.test(sql)) rows = [{...source, test_environment_snapshot: source.test_environment.snapshot,
      test_configuration_snapshot: source.test_configuration.snapshot, test_data_set_snapshot: source.test_data_set.snapshot}];
    else if (/FROM execution_case_snapshots/.test(sql)) rows = cases;
    else if (/FROM execution_step_snapshots/.test(sql)) rows = steps;
    else if (/FROM execution_results/.test(sql)) rows = [{test_case_id: 'failed-case', status: 'failed'}, {test_case_id: 'passed-case', status: 'passed'}, {test_case_id: 'passed-case', status: 'failed'}];
    else if (/FROM users|FROM project_members/.test(sql)) rows = [{id: 'actor'}];
    else if (/FROM (?:test_cases|test_steps|test_suites|test_data_sets|test_environments|test_configurations)\b/.test(sql)) assert.fail('A rerun must consume frozen scope and source instead of current authoring records.');
    return {rows, rowCount: 1};
  };
  context.mock.method(db.pool, 'query', query);
  context.mock.method(db.pool, 'connect', async () => ({query, release() {}}));
  context.mock.method(executions, 'getExecution', async () => structuredClone(source));
  context.mock.method(executions, 'startExecution', async () => assert.fail('Rerun preparation must retain the explicit Start execution boundary.'));
  context.mock.method(mobile, 'assertExecutionMobileFeatureEnabled', async () => {});
  return {source, original, statements};
}

for (const parent of [
  {mode: 'manual', trigger: 'manual', execution_mode: 'remote'},
  {mode: 'local', trigger: 'local', execution_mode: 'local'},
  {mode: 'remote', trigger: 'ci', execution_mode: 'remote'}
]) for (const failed_only of [false, true]) test(`${failed_only ? 'failed-only' : 'full'} ${parent.mode} reruns retain dispatch mode, fresh scoped data and frozen executable snapshots`, async context => {
  const f = fixture(context, parent);
  const created = await executions.rerunExecution('parent', {failed_only, created_by: 'actor'});
  const [run] = insertedRows(f.statements, 'executions');
  assert.equal(run.id, created.id); assert.notEqual(run.id, f.source.id);
  assert.equal(run.trigger, parent.trigger); assert.equal(run.execution_mode, parent.execution_mode); assert.equal(run.status, 'queued');
  assert.equal(implicitStartMode(run), parent.mode, 'implicit API Start uses the same mode as the rerun UI');
  const expectedIds = failed_only ? ['failed-case'] : ['failed-case','passed-case'];
  assert.deepEqual(run.direct_test_case_ids, expectedIds);
  const cases = insertedRows(f.statements, 'execution_case_snapshots'), steps = insertedRows(f.statements, 'execution_step_snapshots');
  assert.deepEqual(cases.map(row => row.test_case_id), expectedIds); assert.deepEqual(steps.map(row => row.test_case_id), expectedIds);
  for (const row of cases) {
    assert.equal(row.execution_id, created.id); assert.equal(row.parameter_template_values['r.name'], '{{randomString:16}}');
    assert.notEqual(row.parameter_values['r.name'], 'old case sample'); assert.equal(row.parameter_values['r.private'], 'fixture-frozen-private');
    assert.equal(row.test_data_options.private_parameter_names[0], 'r.private');
    assert.notEqual(row.suite_parameter_values['s.reference'], 'old suite sample');
    assert.equal(row.suite_parameter_values['s.reference'], cases[0].suite_parameter_values['s.reference'], 'one new suite sample is shared within this rerun');
    assert.equal(row.test_data_set_snapshot.rows[0]['r.row'], run.test_data_set_snapshot.rows[0]['r.row']);
  }
  for (const row of steps) {
    const original = f.original.step_snapshots.find(step => step.test_case_id === row.test_case_id);
    assert.equal(row.automation_code, original.automation_code); assert.equal(row.action, original.action); assert.equal(row.expected_result, original.expected_result);
    assert.notEqual(row.snapshot_step_id, original.snapshot_step_id); assert.equal(row.execution_id, created.id);
  }
  assert.notEqual(run.test_environment_snapshot.variables[0].value, 'old env sample');
  assert.notEqual(run.test_configuration_snapshot.variables[0].value, 'old config sample');
  assert.notEqual(run.test_data_set_snapshot.rows[0]['r.row'], 'old row sample');
  assert.deepEqual(f.source, f.original, 'rerun preparation leaves the original frozen run unchanged');
});

test('contradictory legacy storage canonicalizes the trigger so UI and implicit API Start retain the parent effective mode', async context => {
  for (const parent of [{mode: 'local', trigger: 'local', execution_mode: 'remote'}, {mode: 'local', trigger: 'ci', execution_mode: 'local'}, {mode: 'manual', trigger: 'manual', execution_mode: 'local'}]) {
    const f = fixture(context, parent);
    await executions.rerunExecution('parent', {created_by: 'actor'});
    const [run] = insertedRows(f.statements, 'executions');
    assert.equal(run.trigger, parent.mode); assert.equal(run.execution_mode, parent.mode === 'local' ? 'local' : 'remote');
    assert.equal(implicitStartMode(run), parent.mode);
    context.mock.restoreAll();
  }
});
