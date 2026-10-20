import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const loaded = new Map();
function load(url) {
  if (loaded.has(url.href)) return loaded.get(url.href);
  const exports = {}; loaded.set(url.href, exports);
  const source = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', source)(exports, id => id.startsWith('.') ? load(new URL(id + '.ts', url)) : require(id));
  return exports;
}
const { parseTestCaseCsv, buildTestCaseImportTemplate, buildImportedStepPreview } = load(new URL('../../frontend/lib/testCaseImport.ts', import.meta.url));
const csv = records => { const headers = Object.keys(records[0]); const cell = value => '"' + (typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')).replaceAll('"', '""') + '"'; return [headers.map(cell).join(','), ...records.map(row => headers.map(key => cell(row[key])).join(','))].join('\n'); };
test('download template roundtrips metadata, grouped steps, shared definitions and parameter data', () => {
  const rows = parseTestCaseCsv(csv(buildTestCaseImportTemplate())).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].steps.length, 3);
  assert.equal(rows[0].action, undefined, 'Steps JSON must not be parsed as the legacy Action column');
  assert.deepEqual(rows[0].labels, ['smoke', 'authentication']);
  assert.equal(rows[0].test_case_type, 'functional');
  assert.equal(rows[0].shared_groups[0].steps.length, 1);
  assert.equal(rows[0].parameter_values.base_url, 'https://example.test');
  assert.deepEqual(rows[0].test_data_options, { override_shared_steps: true });
  assert.equal(rows[0].shared_groups[0].test_data_row_index, 0);
  const preview = buildImportedStepPreview(rows[0]);
  assert.equal(preview[0].step_group_kind, 'reusable');
  assert.equal(preview[1].step_group_name, 'Credentials');
});

test('dataset override policy and selected shared group row roundtrip without string coercion', () => {
  const record = { Title: 'Use selected data', 'Test Data Options': { override_shared_steps: false, override_shared_sections: true, shared_data_kind: 'sections' },
    'Shared Step Groups': [{ name: 'Login', test_data_set_id: 'dataset-2', test_data_row_index: 3 }] };
  const row = parseTestCaseCsv(csv([record])).rows[0];
  assert.equal(row.test_data_options.override_shared_steps, false);assert.equal(row.test_data_options.override_shared_sections,true);assert.equal(row.test_data_options.shared_data_kind,'sections');
  assert.equal(row.shared_groups[0].test_data_set_id, 'dataset-2');
  assert.equal(row.shared_groups[0].test_data_row_index, 3);
  for (const invalid of [{ override_shared_steps: 'false' }, [], { unsupported: false }]) {
    assert.throws(() => parseTestCaseCsv(csv([{ ...record, 'Test Data Options': invalid }])), /Test Data Options must/);
  }
});

test('private name-only provenance survives import with bounded names and no control characters', () => {
  const options = {parameter_overrides:['r.opaque_input'],private_parameter_names:['r.opaque_input','t.[Display Name]']};
  const row = parseTestCaseCsv(csv([{Title:'Private reviewed data','Test Data Options':options}])).rows[0];
  assert.deepEqual(row.test_data_options, options);
  for (const entry of [null, 'r.opaque_input', [''], [42], ['r.a\nmalformed'], ['r.a\u007f'], ['x'.repeat(221)], Array(257).fill('r.a')]) {
    assert.throws(() => parseTestCaseCsv(csv([{Title:'Invalid private names','Test Data Options':{private_parameter_names:entry}}])), /Test Data Options must/);
  }
  assert.equal(parseTestCaseCsv(csv([{Title:'Maximum list','Test Data Options':{private_parameter_names:Array(256).fill('r.a')}}])).rows.length,1);
});
test('exported automation Start URLs and their canonical alias survive CSV import unchanged', () => {
  const url = 'https://customer.example.test/signup?workspace=reviewed#account';
  for (const header of ['Automation Start URL', 'automation_start_url', 'Start URL']) {
    const row = parseTestCaseCsv(csv([{ Title: 'Signup automation', Automated: 'yes', [header]: url }])).rows[0];
    assert.equal(row.automation_start_url, url);
  }
});
test('malformed JSON, missing titles and shifted CSV fail before any row queues', () => {
  for (const [text, pattern] of [
    ['Title,Steps\nGood,"[{broken]"', /Row 2.*valid JSON/],
    ['Title,Priority\nGood,9', /Priority/],
    ['Title,Description\n,Missing title', /Row 2.*Title/],
    ['Title,Description\nGood,one,two', /Expected 2 columns/],
    ['Title,Name\nA,B', /same field/],
    ['Title,Unknown\nA,B', /Unsupported column/],
    ['Title,Description\nA,"unfinished', /closing quote/]
  ]) assert.throws(() => parseTestCaseCsv(text), pattern);
});
test('multiline CSV, member identities, Gherkin, scoped references and legacy steps are preserved', () => {
  const value = { Title: 'Unicode 🧪', Description: 'Line one\nLine two, value', 'Authoring Mode': 'gherkin', 'Gherkin Document': 'Feature: Sign-in\nScenario: valid\n Given login', Author: 'author@example.test', Reviewer: 'reviewer@example.test', Stories: 'STORY-42', Suites: 'TS-20', Modules: 'TCM-2', 'Test Data References': 'dataset-1', 'Parameter Values': { number: 7, truth: false }, Steps: 'Open login|Submit' };
  const row = parseTestCaseCsv('\uFEFF' + csv([value])).rows[0];
  assert.equal(row.description, value.Description); assert.equal(row.requirements, 'STORY-42');
  assert.equal(row.reviewer, 'reviewer@example.test'); assert.equal(row.modules, 'TCM-2');
  assert.equal(row.gherkin_document, value['Gherkin Document']);
  assert.deepEqual(row.parameter_values, { number: '7', truth: 'false' });
  assert.equal(buildImportedStepPreview(row).length, 2);
});
