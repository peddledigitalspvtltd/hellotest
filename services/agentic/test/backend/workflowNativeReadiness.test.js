const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../../backend/services/agenticWorkflowExecution.service');
const tasks = require('../../backend/workflows/artifactTasks');
const registry = require('../../backend/agents/agentRegistry.service');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const flags = require('@hellotest/platform/backend/services/featureFlag.service');
const user = { id: 'readiness-user' };
const graph = () => {
  const nodes = [{ id: 'start', data: { kind: 'trigger' } },
    ...['story-assurance', 'test-case-generation', 'test-case-assurance', 'automation-engineer'].map(task => ({ id: task, data: { kind: 'artifactTask', artifactTask: task, timeoutMs: 1800000 } })),
    { id: 'output', data: { kind: 'output' } }];
  return { id: 'native-workflow', project_id: 'project', app_type_id: 'app', trigger_kind: 'manual', nodes, edges: nodes.slice(1).map((node, index) => ({ source: nodes[index].id, target: node.id })) };
};
function allow(t) {
  t.mock.method(permissions, 'hasPermission', async () => true);
  t.mock.method(flags, 'areEnabled', async () => true);
}

test('native readiness resolves the exact feature defaults with trigger and node model precedence', async t => {
  allow(t);
  const calls = [];
  t.mock.method(registry, 'resolveModel', async (...args) => { calls.push(args); return { id: args[2] || args[3] }; });
  const workflow = graph(); workflow.nodes[2].data.llmIntegrationId = 'node-model';
  const report = await runtime.checkReadiness(workflow, '', user, { sprint_id: 'sprint', integration_id: 'trigger-model' });
  assert.equal(report.ready, true);
  assert.deepEqual(calls.map(call => call.slice(2)), [
    ['trigger-model', tasks.taskUsageKey('story-assurance')],
    ['node-model', tasks.taskUsageKey('test-case-generation')],
    ['trigger-model', tasks.taskUsageKey('test-case-assurance')],
    ['trigger-model', tasks.taskUsageKey('automation-engineer')],
  ]);
  calls.length = 0;
  await runtime.checkReadiness(graph(), '', user, { sprint_id: 'sprint' });
  assert.ok(calls.every(call => call[2] === undefined && call[3].startsWith('ai.')));
});

test('invalid native input fails before model resolution and input changes cannot reuse readiness', async t => {
  allow(t);
  const model = t.mock.method(registry, 'resolveModel', async () => ({ id: 'model' }));
  for (const input of [{}, { sprint_id: 'sprint', max_cases_per_story: 11 }, { sprint_id: 'sprint', project_id: 'foreign' }, [], null]) {
    const report = await runtime.checkReadiness(graph(), '', user, input);
    assert.equal(report.ready, false);
    assert.ok(report.blockers.some(item => item.node_id === 'start' && item.message));
  }
  assert.equal(model.mock.callCount(), 0);
  assert.equal((await runtime.checkReadiness(graph(), '', user, { sprint_id: 'sprint', max_cases_per_story: 1 })).ready, true);
});

test('unconfigured feature model and denied native capability produce specific blockers', async t => {
  allow(t);
  t.mock.method(registry, 'resolveModel', async (_project, _user, _model, usage) => {
    if (usage === tasks.taskUsageKey('test-case-generation')) throw new Error('Configure the Test Case design model.');
    return { id: 'model' };
  });
  let report = await runtime.checkReadiness(graph(), '', user, { sprint_id: 'sprint' });
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some(item => item.node_id === 'test-case-generation' && /design model/.test(item.message)));
  t.mock.method(permissions, 'hasPermission', async (_user, code) => code !== 'automation.build');
  report = await runtime.checkReadiness(graph(), '', user, { sprint_id: 'sprint' });
  assert.ok(report.blockers.some(item => item.node_id === 'automation-engineer' && /automation.build/.test(item.message)));
});

test('automatic publication checks Library write grants before any native task starts', async t => {
  allow(t);
  t.mock.method(registry, 'resolveModel', async () => ({id:'model'}));
  t.mock.method(permissions, 'hasPermission', async (_user, code) => !['testcase.create', 'automation.view'].includes(code));
  const workflow = graph();
  workflow.settings = {template_id:'sprint-automator',library_publication_mode:'automatic'};
  const report = await runtime.checkReadiness(workflow,'',user,{sprint_id:'sprint'});
  assert.equal(report.ready,false);
  assert.ok(report.blockers.some(item=>item.node_id==='test-case-generation'&&/testcase.create/.test(item.message)));
  assert.ok(report.blockers.some(item=>item.node_id==='automation-engineer'&&/testcase.create/.test(item.message)));
  workflow.settings.library_publication_mode='manual';
  assert.equal((await runtime.checkReadiness(workflow,'',user,{sprint_id:'sprint'})).ready,true);
});
