import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as acorn from 'acorn';
import { sourceFile } from './helpers/sourceFile.mjs';
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const exports = {};modules.set(name, exports);
  const code = ts.transpileModule(readFileSync(sourceFile(`${name}.ts`, 'lib'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new Function('require','exports',code)(id => id === 'acorn' ? acorn : load(id.split('/').at(-1)), exports);return exports;
}
const { automationBuildParameterReview, automationBuildParameterOverrides } = load('automationBuildParameters');
const plan = () => ({ test_case_id: 'case', parameter_plan_key: 'opaque',
  parameter_values: { 't.name': 'Manual default', 'r.literal': 'exact @r.name literal', 's.blank': '' },
  parameter_references: ['t.name','r.literal','s.blank','r.missing','r.password','r.generator','r.private'],
  missing_parameter_references: ['r.missing','r.password'],private_parameter_references: ['r.private'],deferred_parameter_references: ['r.generator'] });

test('review keeps inherited defaults and token-looking literals exact without resolving generators or private values', () => {
  const input = plan(), before = structuredClone(input), result = automationBuildParameterReview(input);
  assert.deepEqual(result.values, input.parameter_values);
  assert.equal(result.definitions.find(row => row.name === 'r.private').sensitive, true);
  assert.equal(result.definitions.find(row => row.name === 'r.password').sensitive, false, 'unset private-named data can be authored locally');
  assert.deepEqual(input, before);
});

test('continuing blank preserves untouched defaults and includes only explicit private replacements', () => {
  assert.deepEqual(automationBuildParameterOverrides(plan(), {}), { 'r.missing': '', 'r.password': '' });
  assert.deepEqual(automationBuildParameterOverrides(plan(), { 't.name': 'Manual default', 'r.private': 'replacement-secret', 'r.generator': 'flattened', unknown: 'ignore' }),
    { 'r.missing': '', 'r.password': '', 'r.private': 'replacement-secret' });
  assert.deepEqual(automationBuildParameterOverrides(plan(), { 'r.private': '' }), { 'r.missing': '', 'r.password': '', 'r.private': '' });
});

test('authored scoped overrides preserve blanks and whitespace independently of existing inherited values', () => {
  assert.deepEqual(automationBuildParameterOverrides(plan(), { 't.name': '', 'r.missing': '  exact  ', 'r.password': 'local-secret', 's.blank': 'Edited suite for this build' }),
    { 't.name': '', 's.blank': 'Edited suite for this build', 'r.missing': '  exact  ', 'r.password': 'local-secret' });
});

test('configured private data is never projected even when a malformed plan also includes a public value', () => {
  const input = plan();input.parameter_values['r.private'] = 'server-secret';input.parameter_values['r.password'] = 'another-secret';
  const review = automationBuildParameterReview(input);
  assert.doesNotMatch(JSON.stringify(review.values), /server-secret|another-secret/);
  assert.deepEqual(automationBuildParameterOverrides(input, {}), { 'r.missing': '', 'r.password': '' });
});

test('bracketed names retain canonical identity and invalid aliases cannot introduce an unauthorized override', () => {
  const input = { ...plan(),parameter_references:['r.full name','r.name','@r.alias'],parameter_values:{'r.full name':'Existing'},missing_parameter_references:['r.name'],private_parameter_references:[],deferred_parameter_references:[] };
  assert.equal(automationBuildParameterReview(input).definitions[0].token, '@r.[full name]');
  assert.deepEqual(automationBuildParameterOverrides(input, {'r.full name':'Changed','@r.alias':'not authorized'}), {'r.full name':'Changed','r.name':''});
});

test('already-bound empty public and private inputs remain distinct from missing and can be reviewed without exposing private defaults', () => {
  const input = plan();input.parameter_values['s.blank'] = '';input.empty_parameter_references = ['s.blank','r.private'];
  const result = automationBuildParameterReview(input);
  assert.equal(result.missingNames.has('s.blank'), false);assert.equal(result.emptyNames.has('s.blank'), true);
  assert.equal(result.definitions.find(row => row.name === 'r.private').sensitive, false, 'known-empty private bindings are editable');
  assert.deepEqual(automationBuildParameterOverrides(input, {}), { 's.blank':'','r.missing':'','r.password':'','r.private':'' });
  assert.deepEqual(automationBuildParameterOverrides(input, { 'r.private':'new-private','s.blank':'' }), { 's.blank':'','r.missing':'','r.password':'','r.private':'new-private' });
});
