const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const frontendRequire = createRequire(resolve(__dirname, '../../../platform/frontend/package.json'));
const ts = frontendRequire('typescript');
const frontend = {};
new Function('exports', ts.transpileModule(readFileSync(require.resolve('../../frontend/workflows/sprintDraftResults.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(frontend);
const publication = require('../../backend/workflows/acceptDraft');
const tasks = require('../../backend/workflows/artifactTasks');
const db = require('@hellotest/platform/backend/src/db');

test('each nested case acceptance selects its own recorded assessment and automation across Story iterations', async t => {
  const user = { id: 'actor', role: 'member' }, receipts = new Map(), requests = [];
  t.mock.method(tasks, 'access', async () => {});
  t.mock.method(tasks, 'loadStory', async (_run, _user, packet) => ({ id: packet.story_id, project_id: 'project' }));
  t.mock.method(require('@hellotest/platform/backend/public/applicationAccess'), 'getAppType', async () => ({ id: 'app', project_id: 'project', type: 'api' }));
  t.mock.method(db, 'transaction', operation => async () => operation());
  t.mock.method(db, 'prepare', sql => ({
    get: async (...args) => sql.startsWith('SELECT request_hash,receipt FROM workflow_draft_acceptances')
      ? receipts.get(JSON.stringify([args[0], args[1], args[2], args[3]])) : null,
    run: async (...args) => {
      if (sql.startsWith('INSERT INTO workflow_draft_acceptances')) receipts.set(JSON.stringify([args[0], args[2], args[3], args[4]]), { request_hash: args[7], receipt: args[8] });
    }
  }));
  const app = { inject: async request => {
    requests.push(request);
    return { statusCode: 201, json: () => ({ id: `saved-${requests.length}` }) };
  } };
  const packets = ['first', 'second'].map(storyId => {
    const cases = [0, 1].map(index => ({ client_id: `${storyId}-${index}`, title: `${storyId} case ${index + 1}`, description: 'Read this case contract.',
      requirement_ids: [storyId], parameter_values: {}, steps: [{ action: `GET https://fixture.example/${storyId}/${index}`, expected_result: 'Status is 200', step_type: 'api' }] }));
    return { story_id: storyId, story_revision: 'revision', cases };
  });
  const generate = packets.map((packet, storyIndex) => ({ status: 'completed', iteration_path: ['each-story', storyIndex], output: { data: [packet] } }));
  const assess = [], automate = [];
  for (const [storyIndex, packet] of packets.entries()) for (const [caseIndex, draft] of packet.cases.entries()) {
    const iteration_path = ['each-story', storyIndex, 'each-case', caseIndex];
    const review = { client_id: draft.client_id, case_fingerprint: tasks.fingerprint(draft), verification: { status: 'passed' }, analysis: {} };
    const assessment = []; assessment[caseIndex] = review;
    const automated = { client_id: draft.client_id, case_index: caseIndex, case_fingerprint: tasks.fingerprint(draft),
      steps: draft.steps, validation: { status: 'passed' }, verification_status: 'unverified' };
    const row = { story_id: packet.story_id, story_revision: packet.story_revision, case_index: caseIndex, client_id: draft.client_id };
    assess.push({ status: 'completed', iteration_path, output: { data: [{ ...row, case_assurance: review }] },
      execution_context: { data: [{ ...packet, case_assurance: assessment }] } });
    automate.push({ status: 'completed', iteration_path, output: { data: [{ ...row, automation: [automated] }] },
      execution_context: { data: [{ ...packet, case_assurance: assessment, automation_by_case: { [draft.client_id]: automated } }] } });
  }
  const record = (node_id, iterations) => {
    const { iteration_path, ...latest } = iterations.at(-1);
    return { node_id, node_type: 'artifactTask', ...latest, iterations };
  };
  const run = { id: 'run', project_id: 'project', app_type_id: 'app', status: 'completed', execution_mode: 'review',
    node_results: [record('generate', generate), record('assess', assess), record('automate', automate)] };
  const results = frontend.collectSprintDrafts(run);
  for (const [storyIndex, result] of results.entries()) for (const [caseIndex, draft] of result.packet.cases.entries()) {
    for (const kind of ['manual', 'automation']) {
      const target = (kind === 'manual' ? result.manualTargets : result.automationTargets)[caseIndex];
      assert.ok(target, `${draft.client_id} needs its own ${kind} target`);
      const receipt = await publication.accept(app, { user, body: { node_id: target.nodeId, story_index: target.storyIndex,
        case_index: caseIndex, kind, ...(target.iterationPath ? { iteration_path: target.iterationPath } : {}) } }, run);
      assert.equal(receipt.story_id, packets[storyIndex].story_id);
      const payload = requests.at(-1).payload;
      assert.equal(payload.title, draft.title);
      assert.deepEqual(payload.steps, draft.steps);
      if (kind === 'automation') assert.deepEqual(payload.manual_test_case_ids, [`saved-${requests.length - 1}`]);
    }
  }
  assert.equal(requests.length, 8);
  assert.deepEqual(results[0].automationTargets.map(target => target.iterationPath), [['each-story', 0, 'each-case', 0], ['each-story', 0, 'each-case', 1]]);
  assert.deepEqual(results[1].automationTargets[0].iterationPath, ['each-story', 1, 'each-case', 0]);
  assert.equal(results[1].automationTargets[1].iterationPath, undefined, 'The latest current record remains an eligible target too.');
  const legacyPackets = packets.map(packet => ({ ...packet,
    case_assurance: packet.cases.map(draft => ({ case_fingerprint: tasks.fingerprint(draft), verification: { status: 'passed' } })),
    automation: packet.cases.map(draft => ({ case_fingerprint: tasks.fingerprint(draft), steps: draft.steps, validation: { status: 'passed' } })) }));
  const legacy = { ...run, id: 'legacy-run', node_results: [{ node_id: 'legacy', node_type: 'artifactTask', status: 'completed', output: { data: legacyPackets } }] };
  for (const result of frontend.collectSprintDrafts(legacy)) for (const [caseIndex, draft] of result.packet.cases.entries()) {
    for (const kind of ['manual', 'automation']) {
      const target = (kind === 'manual' ? result.manualTargets : result.automationTargets)[caseIndex];
      assert.equal(target.nodeId, 'legacy');
      await publication.accept(app, { user, body: { node_id: target.nodeId, story_index: target.storyIndex, case_index: caseIndex, kind } }, legacy);
      assert.equal(requests.at(-1).payload.title, draft.title);
    }
  }
  assert.equal(requests.length, 16, 'Every legacy cumulative packet case remains independently acceptable.');
});
