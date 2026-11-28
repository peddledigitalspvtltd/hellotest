const test = require('node:test');
const assert = require('node:assert/strict');
const operations = require('../../backend/workflows/nodeOperations');
const registry = require('../../backend/workflows/nodeRegistry');
const native = require('../../backend/workflows/artifactTasks');
const pipeline = require('../../backend/workflows/sprintPipeline');
const requirements = require('@hellotest/manual/backend/services/requirement.service');
const sprints = require('@hellotest/manual/backend/services/requirementIteration.service');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const flags = require('@hellotest/platform/backend/services/featureFlag.service');
const user = { id: 'fixture-user' };
const sprintStory = (id, title) => ({ id, title, revision: 1, iteration_id: 'sprint', project_id: 'project' });

test('workspace Sprint reader authorizes the selected Sprint, pins revisions and rejects partial scope', async t => {
  const access = t.mock.method(native, 'access', async () => {});
  t.mock.method(sprints, 'getIterationSummary', async id => ({ id, project_id: id === 'foreign' ? 'other-project' : 'project' }));
  const story = sprintStory('orders', 'Order placement');
  let last = true;
  const catalog = t.mock.method(requirements, 'getRequirementsPage', async () => ({ items: [story], is_last: last }));
  const run = { project_id: 'project', input_payload: { sprint_id: 'sprint' }, workflow_snapshot: {} };
  const node = { id: 'stories', data: { kind: 'apiTool', apiResource: pipeline.WORKSPACE_SPRINT_STORIES } };
  const result = await operations.execute({ run, node, sources: [], user });
  assert.deepEqual(result.data.items, [{ story_id: story.id, title: story.title, story_revision: native.revision(story), display_id: undefined }]);
  assert.deepEqual(access.mock.calls[0].arguments, [user, 'project', ['requirement_iteration.view', 'requirement.view']]);
  assert.deepEqual(catalog.mock.calls[0].arguments[0], { project_id: 'project', sprint_id: 'sprint', page_size: 100, include_total: false });
  last = false;
  await assert.rejects(operations.execute({ run, node, sources: [], user }), /100-Story capacity/);
  await assert.rejects(operations.execute({ run: { ...run, input_payload: { sprint_id: 'foreign' } }, node, sources: [], user }), { statusCode: 404 });
  assert.equal(catalog.mock.callCount(), 2, 'The foreign Sprint never reaches the Story catalog');
});

test('native Story lineage accepts a legacy Sprint label only when the scoped catalog confirms membership', async t => {
  t.mock.method(permissions, 'hasPermission', async () => true);
  t.mock.method(flags, 'areEnabled', async () => true);
  const story = { ...sprintStory('legacy-story', 'Check coverage'), iteration_id: null, sprint: 'Backfilled Sprint' };
  t.mock.method(requirements, 'getRequirement', async () => story);
  let matched = true;
  const membership = t.mock.method(require('@hellotest/manual/backend/services/requirementCatalog.service'), 'containsSprintStory', async target => {
    assert.deepEqual(target, { projectId: 'project', sprintId: 'sprint', storyId: 'legacy-story' });
    return matched;
  });
  const run = { project_id: 'project', input_payload: { sprint_id: 'sprint' } };
  assert.equal(await native.loadStory(run, user, { story_id: story.id, story_revision: native.revision(story) }), story);
  matched = false;
  await assert.rejects(native.loadStory(run, user, { story_id: story.id }), { statusCode: 403 });
  await assert.rejects(native.loadStory({ ...run, project_id: 'foreign' }, user, { story_id: story.id }), { statusCode: 403 });
  assert.equal(membership.mock.callCount(), 2, 'A foreign project does not reach the membership query');
});

test('one source agent receipt supplies each Story only its relevant source and attachment evidence', async t => {
  t.mock.method(permissions, 'hasPermission', async () => true);
  t.mock.method(flags, 'areEnabled', async () => true);
  const evidenceAccess = require('@hellotest/platform/backend/services/optionalEvidenceAccess.service');
  t.mock.method(evidenceAccess, 'getOptionalEvidenceAccess', async (_user, _project, codes) => Object.fromEntries(codes.map(code => [code, true])));
  const sources = require('../../backend/agents/repositoryAgents.service');
  const create = t.mock.method(sources, 'createRun', async () => ({ id: 'durable-api-source' }));
  t.mock.method(sources, 'getRun', async () => ({ status: 'completed', result: { findings: { test_cases: [
    { id: 'orders-result', title: 'Order placement API', method: 'POST', path: '/orders', body: { secret: 'raw body excluded' }, expected_status: 201, evidence: [{ path: 'orders.ts', line: 3 }] },
    { id: 'profile-result', title: 'Profile preferences API', method: 'GET', path: '/preferences', expected_status: 200, evidence: [{ path: 'profile.ts', line: 6 }] }
  ] } } }));
  const apiNode = { id: 'repo-api', data: { kind: 'repositoryAgent', repositoryAgentType: 'api_tests', repositoryOptional: true } };
  const generation = { id: 'generate', data: { kind: 'artifactTask', artifactTask: 'test-case-generation' } };
  const run = {
    id: 'run', project_id: 'project', app_type_id: 'app', input_payload: {
      sprint_id: 'sprint', source: { type: 'github', repository_url: 'https://github.com/example/ordinary-qa-fixture' }
    },
    workflow_snapshot: {
      settings: { template_id: 'spec-to-script', source_evidence_nodes: { api: apiNode.id } },
      nodes: [apiNode, generation], edges: [
        { source: apiNode.id, target: 'source-barrier' }, { source: 'source-barrier', target: 'each-story' },
        { source: 'each-story', target: 'story-assurance', sourceHandle: 'loop' }, { source: 'story-assurance', target: generation.id }
      ]
    }
  };
  const sourceOutput = await registry.get('repositoryAgent').execute({ run, node: apiNode, sources: [], user, signal: new AbortController().signal,
    onAttempt: async () => {}, onProgress: () => assert.fail('Source diagnostics reached the workflow'), requireRunAccess: async () => {} });
  assert.equal(create.mock.calls[0].arguments[2].requestKey, 'workflow-run-repo-api');
  assert.doesNotMatch(JSON.stringify(sourceOutput), /raw body excluded/);
  run.node_results = [{ node_id: apiNode.id, status: 'completed', output: sourceOutput }];
  const stories = [
    { ...sprintStory('orders', 'Order placement API'), description: 'See https://fixture.example.test/orders.' },
    { ...sprintStory('profile', 'Profile preferences API'), description: 'See https://fixture.example.test/preferences.' }
  ];
  t.mock.method(requirements, 'getRequirement', async id => stories.find(story => story.id === id));
  t.mock.method(require('@hellotest/platform/backend/public/applicationAccess'), 'getAppType', async () => ({ id: 'app', project_id: 'project' }));
  t.mock.method(require('@hellotest/ai/services/storyAttachmentContext'), 'readStoryAttachments', async ({ storyId, projectId }) => {
    assert.equal(projectId, 'project');
    return [{ id: `${storyId}-attachment`, story_id: storyId, status: 'excerpt', excerpt: `Contract for ${storyId}` }];
  });
  const design = t.mock.method(require('@hellotest/manual/backend/services/requirementDesign.service'), 'previewRequirementsTestCases', async input => ({ cases: [{
    client_id: 'case-1', requirement_ids: [input.requirements[0].id], title: 'Verify behavior', description: 'A scoped case',
    steps: [{ action: 'Exercise requested action', expected_result: 'Expected result' }]
  }] }));
  for (const story of stories) {
    const review = { assurance_review: { summary: 'Ready' }, verification: { status: 'passed' } };
    const result = await native.execute({ run, node: generation, user, onProgress: async () => {},
      context: { input: [{ story_id: story.id, story_revision: native.revision(story), story_assurance: review }] } });
    assert.equal(result.__workflow_result.output.data[0].cases[0].requirement_ids[0], story.id);
  }
  assert.equal(create.mock.callCount(), 1);
  assert.deepEqual(design.mock.calls.map(call => {
    const context = call.arguments[0].supporting_evidence;
    return [context.workflow_sources.api.attachment.id, context.workflow_sources.api.candidates.map(item => item.path), context.story_attachments[0].id];
  }), [
    ['durable-api-source', ['/orders'], 'orders-attachment'],
    ['durable-api-source', ['/preferences'], 'profile-attachment']
  ]);
});

test('optional repository workers and curator complete without a model or job when GitHub source was omitted', async t => {
  const sources = require('../../backend/agents/repositoryAgents.service');
  const create = t.mock.method(sources, 'createRun', async () => assert.fail('No source should be dispatched'));
  const run = { input_payload: { sprint_id: 'sprint' } };
  const objectNode = { id: 'objects', data: { kind: 'repositoryAgent', repositoryAgentType: 'object_repository', repositoryOptional: true } };
  const curatorNode = { id: 'curator', data: { kind: 'agent', agentId: 'repository-curator', repositoryOptional: true } };
  const output = await registry.get('repositoryAgent').execute({ run, node: objectNode, sources: [], user });
  assert.equal(output.status, 'not_supplied');
  assert.deepEqual(await registry.get('agent').execute({ run, node: curatorNode, sources: [{ status: 'completed', output }], user }),
    { specialist_id: 'repository-curator', status: 'not_supplied' });
  assert.equal(create.mock.callCount(), 0);
});

test('an acknowledged source-analysis failure remains inspectable without blocking Story work', async t => {
  const sources = require('../../backend/agents/repositoryAgents.service');
  t.mock.method(sources, 'createRun', async () => ({ id: 'failed-source' }));
  t.mock.method(sources, 'getRun', async () => ({ status: 'failed' }));
  const run = { id: 'run', project_id: 'project', app_type_id: 'app', input_payload: {
    source: { type: 'github', repository_url: 'https://github.com/example/ordinary-qa-fixture' }
  } };
  const compute = require('../../backend/workflows/nodes/repositoryAgent').execute;
  const node = { id: 'source', data: { repositoryAgentType: 'object_repository', repositoryOptional: true } };
  const context = { run, node, sources: [], user, signal: new AbortController().signal, onAttempt: async () => {},
    requireRunAccess: async () => {} };
  const output = await compute(context);
  assert.equal(output.repository_run_id, 'failed-source');
  assert.equal(output.status, 'source_unavailable');
  assert.deepEqual(output.verification, { status: 'needs_input' });
  await assert.rejects(compute({ ...context, requireRunAccess: async () => {
    throw Object.assign(new Error('Permission was revoked'), { statusCode: 403 });
  } }), { statusCode: 403 });
});
