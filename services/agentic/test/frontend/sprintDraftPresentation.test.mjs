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
const { WorkflowSprintDrafts } = load('../../frontend/workflows/WorkflowSprintDrafts.tsx', {
  './sprintDraftResults': results,
  '@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess': { useCapabilityAccess: () => ({ can: () => true }) },
  '@hellotest/ai/frontend/components/ArtifactAssuranceWorkspace': { ArtifactAssuranceWorkspace: () => null },
  '../api.client': { agenticApi: {} },
  './WorkflowLibraryReviewActions': { WorkflowLibraryReviewActions: () => null },
  './WorkflowDataView': { WorkflowDataView: ({ value }) => React.createElement('pre', null, JSON.stringify(value)) },
  './WorkflowCodeView': { WorkflowCodeView: ({ code }) => React.createElement('pre', null, code) }
});
const { renderToStaticMarkup } = require('react-dom/server');

test('a completed draft with blocked live validation explains the blocker without claiming generation or execution passed', () => {
  const row = { story_id: 'story', story_revision: 'r' }, draft = { client_id: 'case', title: 'Check the fixed product price' };
  const automation = { client_id: draft.client_id, case_index: 0, validation: { status: 'passed' }, verification_status: 'unverified',
    live_validation: { status: 'blocked', reason: 'The application returned HTTP 503 during search.', stopped_at_step_order: 2 },
    steps: [{ action: 'Read the requested product', expected_result: 'Price equals 353' }] };
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
