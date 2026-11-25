import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const ts = require('typescript'), React = require('react');
function load(path, modules = {}) {
  const exports = {};
  new Function('exports', 'require', ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText)(exports, name => modules[name] || require(name));
  return exports;
}
const results = load('../../frontend/workflows/sprintDraftResults.ts');
const dataView = { WorkflowDataView: ({ value }) => React.createElement('pre', null, JSON.stringify(value)) };
const automationSections = load('../../frontend/workflows/WorkflowAutomationSections.tsx', {
  './WorkflowCodeView': { WorkflowCodeView: ({ code }) => React.createElement('pre', null, code) },
  './WorkflowDataView': dataView,
});
const { WorkflowSprintDrafts } = load('../../frontend/workflows/WorkflowSprintDrafts.tsx', {
  './sprintDraftResults': results,
  '@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess': { useCapabilityAccess: () => ({ can: () => true }) },
  '@hellotest/ai/frontend/components/ArtifactAssuranceWorkspace': { ArtifactAssuranceWorkspace: () => null },
  '../api.client': { agenticApi: {} },
  './WorkflowLibraryReviewActions': { WorkflowLibraryReviewActions: () => null },
  './WorkflowFailureDetails': { WorkflowFailureResolution: () => null },
  './WorkflowDataView': dataView,
  './WorkflowAutomationSections': automationSections,
});
const { WorkflowAutomationResult } = load('../../frontend/workflows/WorkflowAutomationResult.tsx', {
  './sprintDraftResults': results,
  '@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess': { useCapabilityAccess: () => ({ can: () => true }) },
  '../api.client': { agenticApi: {} },
  './WorkflowFailureDetails': { WorkflowFailureResolution: () => null },
  './WorkflowAutomationSections': automationSections,
});
const { renderToStaticMarkup } = require('react-dom/server');

test('direct workflow results distinguish isolated verification and show the input a case needs', () => {
  const renderResult = output => renderToStaticMarkup(React.createElement(WorkflowAutomationResult, {
    projectId: 'project', runId: 'workflow-run', nodeId: 'build', canAccept: true,
    value: { manual_case: { id: 'case', title: 'Check catalog' }, ...output }
  }));
  const verified = renderResult({ automation: { validation: { status: 'passed' }, verification_status: 'verified',
    verification: { status: 'passed', verification_id: 'check-1' } } });
  assert.match(verified, /Verified in an isolated browser check/);
  assert.match(verified, /Verification receipt check-1/);
  assert.match(verified, /Save automation draft/);
  const saved = renderResult({ saved_automation_case_id: 'saved-automation', automation: { validation: { status: 'passed' } } });
  assert.match(saved, /Saved for review/);
  assert.match(saved, /href="\/automation\?case=saved-automation"/);
  assert.doesNotMatch(saved, /Save automation draft/);
  const blocked = renderResult({ automation_input_required: { message: 'Provide missing test inputs.',
    required_context: ['A test product'], required_parameters: ['@t.itemId'],
    blocked_steps: [{ reason: 'The request needs an item ID.' }], review_prior_actions: true } });
  assert.match(blocked, /The request needs an item ID/);
  assert.match(blocked, /A test product/);
  assert.match(blocked, /@t.itemId/);
  assert.match(blocked, /Review the browser actions and reset the test data/);
  assert.doesNotMatch(blocked, /Save automation draft/);
});

test('a completed draft with blocked live validation explains the blocker without claiming generation or execution passed', () => {
  const row = { story_id: 'story', story_revision: 'r' }, draft = { client_id: 'case', title: 'Check the fixed product price' };
  const automation = { client_id: draft.client_id, case_index: 0, validation: { status: 'passed' }, verification_status: 'unverified',
    live_validation: { status: 'blocked', reason: 'The application returned HTTP 503 during search.', stopped_at_step_order: 2 },
    steps: [{ action: 'Read the requested product', automation_instructions: {
      instructions: [{ operation_id: 'assert-1', label: 'Price equals 353', args: [] }]
    } }] };
  const run = { id: 'run', project_id: 'project', status: 'completed', node_results: [
    { node_id: 'generate', node_type: 'artifactTask', status: 'completed', output: { data: [{ ...row, cases: [draft] }] } },
    { node_id: 'build', node_type: 'artifactTask', status: 'completed', output: { data: [{ ...row, case_index: 0, client_id: draft.client_id, automation: [automation] }] } }
  ] };
  const packet = results.collectSprintDrafts(run)[0].packet;
  assert.deepEqual(packet.automation_progress, { completed: 1, failed: 0, needs_input: 0, processed: 1, total: 1 });
  assert.deepEqual(packet.automation[0].live_validation, automation.live_validation);
  const markup = renderToStaticMarkup(React.createElement(WorkflowSprintDrafts, { run }));
  assert.match(markup, /Draft generated · Live validation blocked.*unverified/);
  assert.match(markup, /application returned HTTP 503/);
  assert.match(markup, /Live validation stopped at section 2/);
  assert.match(markup, /A Test Engine run is required to establish its result/);
  assert.match(markup, /Price equals 353/);
  assert.doesNotMatch(markup, /Automation generation failed|Execution passed|Test passed/);
});

test('automation artifacts render mapped web instructions and source, or native API requests without diagnostics', () => {
  const renderArtifact = draft => renderToStaticMarkup(React.createElement(automationSections.WorkflowAutomationSections, { draft }));
  const web = renderArtifact({
    executable: { code: 'playwright testcase' }, browser_evidence: { screenshot: 'SCREENSHOT_MARKER' },
    steps: [{ step_order: 1, step_type: 'web', action: 'Sign in with the test account', automation_instructions: {
      instructions: [{ operation_id: 'action', label: 'Fill username', args: ['@r.username'] }]
    }, evidence: 'STEP_DEBUG_MARKER' }]
  });
  assert.match(web, /HelloTest instructions/);
  assert.match(web, /Fill username/);
  assert.match(web, /@r.username/);
  assert.match(web, /playwright testcase/);
  assert.doesNotMatch(web, /SCREENSHOT_MARKER|STEP_DEBUG_MARKER/);
  const api = renderArtifact({ executable: { framework: 'playwright', filename: 'catalog.spec.ts', code: 'EXECUTABLE_API_SOURCE' }, steps: [{ step_order: 1, runtime: 'api',
    api_request: { method: 'GET', url: 'https://catalog.example/items', validations: [{ kind: 'status', expected: '200' }] } }] });
  assert.match(api, /GET https:\/\/catalog.example\/items/);
  assert.match(api, /validations.*200/);
  assert.match(api, /EXECUTABLE_API_SOURCE/);
  assert.doesNotMatch(api, /HelloTest instructions/);
});
