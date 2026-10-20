import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { automationStartUrlError, reviewedAutomationStartUrl } from '../../../automation/frontend/lib/automationStartUrl.ts';
import { getAutomationRuntimeTypes } from '../../../automation/frontend/lib/automationRuntime.ts';

const source = readFileSync(new URL('../../frontend/pages/TestCasesPage.tsx', import.meta.url), 'utf8');
function callable(start, end, context) {
  const body = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const compiled = ts.transpileModule(`${body}\nreturn ${start.match(/const (\w+)/)[1]};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), compiled)(...Object.values(context));
}
function cloneFixture({ runtime = 'web', startUrl = null } = {}) {
  const item = { id: 'source', app_type_id: 'app', title: 'Complete signup', automated: 'yes', automation_start_url: startUrl, parameter_values: { 't.email': 'reviewed@example.test' } };
  const steps = [{ id: 'step', step_order: 1, step_type: runtime, action: 'Submit the reviewed email', expected_result: 'Account created', automation_code: 'await page.getByRole("button", {name:"Sign up"}).click();' }];
  const calls = { created: [], source: [], urls: [], errors: [] };
  const context = {
    canCreateTestCases: true, canEditAutomationCode: true, automationCloneSubmitting: false, projectId: 'project', appTypeId: 'app', appTypes: [{ id: 'app', type: runtime }], defaultTestCaseAutomated: 'no', defaultTestCaseStatus: 'active',
    automationStartUrlError, reviewedAutomationStartUrl, getAutomationRuntimeTypes,
    ensureTestCaseDetail: async () => structuredClone(item), queryClient: { fetchQuery: async () => structuredClone(steps) },
    createTestCase: { mutateAsync: async input => { calls.created.push(input); return { id: 'clone' }; } },
    setAutomationCloneSubmitting: () => {}, setAutomationCloneSource: value => calls.source.push(value), setAutomationCloneStartUrl: value => calls.urls.push(value),
    syncTestCaseSearchParams: () => {}, setSelectedTestCaseId: () => {}, setIsCreating: () => {}, setDraftSteps: () => {}, showSuccess: () => {}, refreshCases: async () => {}, showError: error => calls.errors.push(error.message)
  };
  return { item, calls, clone: callable('  const handleCloneCase =', '\n\t  const handleDeleteCaseItem', context) };
}

test('automation clone carries the exact saved application URL together with its current steps and data', async () => {
  const url = 'https://customer.example.test/signup?workspace=reviewed#account';
  const { item, calls, clone } = cloneFixture({ startUrl: url });
  await clone(item);
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].automation_start_url, url);
  assert.equal(calls.created[0].automated, 'yes');
  assert.match(calls.created[0].steps[0].automation_code, /Sign up/);
  assert.deepEqual(calls.created[0].parameter_values, item.parameter_values);
  assert.deepEqual(calls.errors, []);
});

test('legacy browser automation clone waits for a reviewed URL and never infers an unrelated target', async () => {
  const { item, calls, clone } = cloneFixture();
  await clone(item);
  assert.equal(calls.created.length, 0);
  assert.equal(calls.source[0].id, item.id);
  assert.equal(calls.urls[0], '');
  await clone(item, 'https://name:secret@wrong.example.test');
  assert.equal(calls.created.length, 0);
  const exact = 'https://reviewed.example.test/signup?team=one';
  await clone(item, exact);
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].automation_start_url, exact);
  assert.equal(item.automation_start_url, null, 'cloning does not modify the source case');
});

test('native and API-only automation clones remain independent of browser Start URLs', async () => {
  for (const runtime of ['api', 'android', 'ios']) {
    const { item, calls, clone } = cloneFixture({ runtime });
    await clone(item);
    assert.equal(calls.created.length, 1, runtime);
    assert.equal(calls.created[0].automation_start_url, null, runtime);
  }
});

test('CSV export emits the saved automation application URL from the authoritative export record', async () => {
  const url = 'https://customer.example.test/signup?workspace=reviewed#account';
  let exported;
  const item = { id: 'case', title: 'Signup', automated: 'yes', automation_start_url: url, steps: [] };
  const context = {
    canExportTestCases: true, canUseAutomationWorkspace: true, canViewAutomationCode: true, canViewTestData: true, appTypeId: 'app', requirements: [], suites: [], testCaseModules: [], sharedStepGroups: [],
    api: { testCases: { exportCases: async () => ({ records: [item], transaction_id: 'transaction' }) } }, downloadCsvRecords: (_name, rows) => { exported = rows; }, showSuccess: () => {}, showError: error => { throw error; }
  };
  const exportCsv = callable('  const exportCasesToCsv =', '\n  const handleCloneCase', context);
  await exportCsv([{ id: 'case', title: 'Catalog title', automation_start_url: 'https://stale.example.test' }]);
  assert.equal(exported[0]['Automation Start URL'], url);
});
