const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { normalizeParameterKey, resolveParameterLayers } = require('../../../platform/backend/src/utils/stepParameterResolution');
const { preserveFrozenRunParameters } = require('../../../platform/backend/src/utils/frozenRunParameterCompatibility');
const { redactTestDataSetRows } = require('../../backend/services/testDataSet.service');

function fixture(raw) {
  const source = fs.readFileSync(require.resolve('../../backend/services/execution.service'), 'utf8');
  const part = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
  const body = part('function normalizeParameterValues(values', 'function resolveExecutionCaseDataSet(')
    + part('function redactExecutionDataSetSnapshot(', 'function attachExecutionContext(')
    + part('async function loadExecutionRuntimeContext(', 'async function hydrateExecutionScopes(')
    + part('async function attachExecutionCaseAssignees(', 'async function validateExecutionAssignee(');
  let rawReads = 0;
  const parsed = (value, fallback) => value == null ? fallback : typeof value === 'string' ? JSON.parse(value) : value;
  const api = new Function('parseJsonValue', 'normalizeParameterKey', 'redactTestDataSetRows', 'normalizeTextList', 'normalizeStoredReferenceList', 'normalizeText', 'preserveFrozenRunParameters', 'selectExecutionRecord', 'getCaseSnapshotsForExecution', 'getStepSnapshotsForExecution', 'db', 'shapeAssignedUser',
    body+'return {attachExecutionCaseAssignees,loadExecutionRuntimeContext};')(
    parsed, normalizeParameterKey, redactTestDataSetRows, values => values || [], values => values || [], value => value || '', preserveFrozenRunParameters,
    { get: async () => ({ execution_hooks: [] }) }, { all: async () => { rawReads++;return [structuredClone(raw)]; } }, { all: async () => [] },
    { prepare: () => { throw new Error('No assignee database lookup expected'); } }, value => value);
  return { ...api, get rawReads() { return rawReads; } };
}

test('public frozen case parameters redact opaque values and aliases while internal execution restores exact stored bindings without live sources', async () => {
  const secret = 'Opaque persisted fixture value 729';
  const raw = { test_case_id: 'case', parameter_values: { 'r.opaque_input': secret, 'r.alias': secret, 'r.blank_private': '', 't.public': 'Visible' },
    parameter_template_values: { 'r.opaque_input': secret, 't.public': 'Visible' }, suite_parameter_values: { 's.alias': secret },
    test_data_options: { private_parameter_names: ['r.opaque_input', 'r.blank_private'] }, test_data_set_snapshot: null };
  const original = structuredClone(raw), f = fixture(raw);
  const [publicCase] = await f.attachExecutionCaseAssignees([raw]);
  assert.doesNotMatch(JSON.stringify(publicCase), new RegExp(secret));assert.equal(publicCase.parameter_values['t.public'], 'Visible');
  assert.equal(publicCase.parameter_values['r.blank_private'], '');assert.deepEqual(raw, original);
  const runtime = await f.loadExecutionRuntimeContext({ id: 'run', parameter_scope_default: 'r', case_snapshots: [publicCase] });
  assert.equal(f.rawReads, 1, 'case-only secrets must restore even when there is no dataset snapshot');
  assert.deepEqual(runtime.case_snapshots[0].parameter_values, original.parameter_values);
  const values = resolveParameterLayers({ caseValues: runtime.case_snapshots[0].parameter_values, dataPolicy: { version: 2, case: raw.test_data_options } });
  assert.equal(values['r.opaque_input'], secret);
});

test('case private metadata also protects frozen dataset/table/template layers and key-value reads', async () => {
  const secret = 'Opaque frozen dataset fixture 918', options = { private_parameter_names: ['r.opaque_input'] };
  for (const test_data_set_snapshot of [
    { mode: 'table', rows: [{ 'r.opaque_input': secret, 't.public': 'Visible' }], template_rows: [{ 'r.opaque_input': secret }],
      parameter_data_layers: { case: { rows: [{ 'r.opaque_input': secret }], template_rows: [{ 'r.opaque_input': secret }] } } },
    { mode: 'key_value', rows: [{ key: 'r.opaque_input', value: secret, is_secret: false }, { key: 't.public', value: 'Visible' }] }
  ]) {
    const raw = { test_case_id: 'case', parameter_values: { 'r.opaque_input': secret }, test_data_options: options, test_data_set_snapshot };
    const [visible] = await fixture(raw).attachExecutionCaseAssignees([raw]);
    assert.doesNotMatch(JSON.stringify(visible), new RegExp(secret));
    assert.match(JSON.stringify(visible), /Visible/);
  }
});
