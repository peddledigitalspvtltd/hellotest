const test = require('node:test');
const assert = require('node:assert/strict');
const { upgradeSprintWorkflow } = require('../../backend/workflows/sprintWorkflowMigration');
const { loopBodies, validateWorkflowGraph } = require('@hellotest/platform/backend/src/utils/agenticWorkflowGraph');
function legacy() {
  const tasks = ['story-assurance', 'test-case-generation', 'test-case-assurance', 'automation-engineer'];
  const nodes = [
    { id: 'request', data: { kind: 'trigger' } },
    { id: 'read', data: { kind: 'apiTool', apiResource: 'sprintStories', connectionId: 'saved-connection' } },
    { id: 'each', data: { kind: 'loop', loopAction: 'storyPackets', loopSourceKey: 'input.items', loopMaxIterations: '100', timeoutMs: '70000' } },
    ...tasks.map(task => ({ id: task, data: { kind: 'artifactTask', artifactTask: task, instructions: `Saved guidance: ${task}` } })),
    { id: 'done', data: { kind: 'output' } },
  ];
  return { nodes, edges: nodes.slice(1).map((node, index) => ({ id: `edge-${index}`, source: nodes[index].id, target: node.id })), settings: { template_id: 'sprint-automator', maxDurationMs: 3600000, sprint_input_defaults: { sprint_id: 'saved-sprint' }, customized: 'retain' } };
}
test('canonical legacy Sprint becomes an isolated connected foreach and retains node guidance, scope and connections', () => {
  const original = legacy(), before = structuredClone(original);
  const next = upgradeSprintWorkflow(original);
  assert.deepEqual(original, before);
  assert.equal(next.nodes[2].data.loopAction, 'workflow');
  assert.equal(next.nodes[2].data.loopBatchSize, '1');
  assert.equal(next.nodes[2].data.timeoutMs, '3600000');
  assert.equal(next.settings.library_publication_mode, 'automatic');
  assert.equal(next.settings.customized, 'retain');
  assert.deepEqual(next.settings.sprint_input_defaults, original.settings.sprint_input_defaults);
  assert.deepEqual(next.nodes.filter(node => node.data.kind !== 'loop'), original.nodes.filter(node => node.data.kind !== 'loop'));
  assert.equal(validateWorkflowGraph(next.nodes, next.edges, { requireNodes: true }).length, 8);
  assert.deepEqual(loopBodies(next.nodes, next.edges).each, original.nodes.slice(3, 7).map(node => node.id));
  assert.ok(next.edges.some(edge => edge.source === 'each' && edge.target === 'done' && edge.sourceHandle === 'done'));
  assert.equal(upgradeSprintWorkflow(next), next, 'Upgrade is idempotent');
});
test('customized graphs and explicit publication settings are preserved', () => {
  const explicit = legacy(); explicit.settings.library_publication_mode = 'manual';
  assert.equal(upgradeSprintWorkflow(explicit).settings.library_publication_mode, 'manual');
  for (const change of [
    definition => { definition.settings.template_id = 'another'; },
    definition => { definition.nodes.push({ id: 'custom', data: { kind: 'wait' } }); },
    definition => { definition.edges[2].sourceHandle = 'custom'; },
    definition => { definition.nodes[4].data.artifactTask = 'story-assurance'; },
    definition => { definition.edges[4].target = 'done'; },
  ]) {
    const definition = legacy(); change(definition);
    assert.equal(upgradeSprintWorkflow(definition), definition);
  }
});
