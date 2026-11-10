const test = require('node:test');
const assert = require('node:assert/strict');
const publication = require('../../backend/workflows/acceptDraft');
const tasks = require('../../backend/workflows/artifactTasks');
const db = require('@hellotest/platform/backend/src/db');
const testCases = require('@hellotest/testing/backend/services/testCase.service');

function fixture(t, { draftOptions, automationOptions, dataSetIds } = {}) {
  const user = { id: 'actor', role: 'member' }, permissionCalls = [], writes = [];
  const draft = { client_id: 'draft', title: 'Read the saved invoice', description: 'Read the supplied invoice contract.', priority: 2,
    test_case_type: 'functional', authoring_mode: 'structured', requirement_ids: ['story'], parameter_values: {},
    steps: [{ action: 'GET https://fixture.example.test/invoice', expected_result: 'Response status equals 200', step_type: 'api' }],
    ...(draftOptions ? { test_data_options: draftOptions } : {}) };
  const automated = { client_id: draft.client_id, case_fingerprint: tasks.fingerprint(draft), validation: { status: 'passed' },
    verification_status: 'unverified', steps: draft.steps, ...(automationOptions ? { test_data_options: automationOptions } : {}),
    ...(dataSetIds ? { test_data_set_ids: dataSetIds } : {}) };
  const packet = { story_id: 'story', story_revision: 'revision', cases: [draft],
    test_case_generation: { cases: [draft], verification: { status: 'passed' } },
    case_assurance: [{ case_fingerprint: tasks.fingerprint(draft), verification: { status: 'passed' } }], automation: [automated] };
  const run = { id: 'run', created_by: user.id, project_id: 'project', app_type_id: 'app', status: 'completed', execution_mode: 'review',
    input_payload: { sprint_id: 'sprint' }, workflow_snapshot: { execution_mode: 'review',
      settings: { template_id: 'sprint-automator', library_publication_mode: 'automatic' },
      nodes: [{ id: 'automation', data: { kind: 'artifactTask', artifactTask: 'automation-engineer' } }] },
    node_results: [{ node_id: 'automation', node_type: 'artifactTask', status: 'completed', output: {
      artifact_task: 'automation-engineer', generation_mode: 'native', verification: { status: 'passed' }, data: [packet] } }] };
  t.mock.method(tasks, 'access', async (_user, _project, codes) => {
    permissionCalls.push(...codes);
    if (codes.includes('data.view')) throw Object.assign(new Error('Missing required permission: data.view'), { statusCode: 403 });
  });
  t.mock.method(tasks, 'loadStory', async () => ({ id: 'story', project_id: 'project' }));
  t.mock.method(db, 'transaction', operation => async () => operation());
  t.mock.method(db, 'prepare', sql => ({
    get: async () => sql.startsWith('SELECT * FROM agentic_workflow_runs') ? run
      : sql.startsWith('SELECT status FROM agentic_workflow_runs') ? { status: 'running' }
        : sql.startsWith('SELECT id,status,is_workspace_admin FROM users') ? { id: user.id, status: 'active', is_workspace_admin: false }
          : sql.startsWith('SELECT receipt FROM workflow_draft_acceptances') ? { receipt: { id: 'saved-manual' } } : null,
    run: async (...args) => { writes.push({ sql, args }); }
  }));
  t.mock.method(require('@hellotest/platform/backend/public/projectAccess'), 'getProject', async () => ({ id: 'project' }));
  t.mock.method(require('@hellotest/platform/backend/public/applicationAccess'), 'getAppType', async () => ({ id: 'app', project_id: 'project', type: 'api' }));
  const create = t.mock.method(testCases, 'createTestCase', async () => ({ id: 'unexpected-case' }));
  return { user, run, permissionCalls, writes, create };
}

for (const [label, draftOptions] of [['absent metadata', undefined], ['empty generated flags', { private_parameter_names: [] }]]) {
  test(`manual acceptance with ${label} does not request or send data options`, async t => {
    const { user, run, permissionCalls } = fixture(t, { draftOptions });
    const requests = [], app = { inject: async input => { requests.push(input); return { statusCode: 201, json: () => ({ id: 'manual-case' }) }; } };
    const receipt = await publication.accept(app, { user, body: { node_id: 'automation', story_index: 0, case_index: 0, kind: 'manual' } }, run);
    assert.equal(receipt.id, 'manual-case');
    assert.equal(Object.hasOwn(requests[0].payload, 'test_data_options'), false);
    assert.equal(permissionCalls.includes('data.view'), false);
  });
}

for (const [label, options] of [
  ['environment and private parameter metadata', { automationOptions: { test_environment_id: 'environment', private_parameter_names: ['r.password'] } }],
  ['a dataset mapping without data options', { dataSetIds: ['dataset'] }]
]) {
  test(`automatic publication cannot persist ${label} without current data access`, async t => {
    const { user, run, permissionCalls, writes, create } = fixture(t, options);
    await assert.rejects(publication.publishNodeArtifacts({ run, node: { id: 'automation' }, user }), error =>
      error.statusCode === 403 && /data.view/.test(error.message) && error.library_publication.receipts.length === 0);
    assert.equal(permissionCalls.includes('data.view'), true);
    assert.equal(create.mock.callCount(), 0);
    assert.equal(writes.length, 0);
  });
}
