const test = require('node:test');
const assert = require('node:assert/strict');
const { upgradeSprintWorkflow, upgradeLegacySprintWorkflow, upgradeSprintCaseLoop, upgradeSprintPerCaseAssurance } = require('../../backend/workflows/sprintWorkflowMigration');
const { loopBodies, validateWorkflowGraph } = require('@hellotest/platform/backend/src/utils/agenticWorkflowGraph');
function legacy() {
  const tasks = ['story-assurance', 'test-case-generation', 'test-case-assurance', 'automation-engineer'];
  const nodes = [
    { id: 'request', data: { kind: 'trigger' } },
    { id: 'sprint-stories', data: { kind: 'apiTool', apiResource: 'sprintStories', connectionId: 'saved-connection' } },
    { id: 'each-story', data: { kind: 'loop', loopAction: 'storyPackets', loopSourceKey: 'input.items', loopMaxIterations: '100', timeoutMs: '70000' } },
    ...tasks.map(task => ({ id: task, data: { kind: 'artifactTask', artifactTask: task, instructions: `Saved guidance: ${task}` } })),
    { id: 'sprint-output', data: { kind: 'output' } },
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
  assert.equal(next.settings.template_version, 4);
  assert.equal(next.settings.library_publication_mode, 'automatic');
  assert.equal(next.settings.customized, 'retain');
  assert.deepEqual(next.settings.sprint_input_defaults, original.settings.sprint_input_defaults);
  for (const originalNode of original.nodes) {
    const expected = originalNode.id === 'each-story'
      ? { ...originalNode.data, loopAction: 'workflow', loopBatchSize: '1', timeoutMs: String(original.settings.maxDurationMs) }
      : originalNode.data;
    assert.deepEqual(next.nodes.find(node => node.id === originalNode.id).data, expected);
  }
  assert.equal(validateWorkflowGraph(next.nodes, next.edges, { requireNodes: true }).length, 10);
  assert.deepEqual(loopBodies(next.nodes, next.edges)['each-story'], ['story-assurance','test-case-generation','each-test-case','test-case-assurance','test-data-generator','automation-engineer']);
  assert.deepEqual(loopBodies(next.nodes, next.edges)['each-test-case'], ['test-case-assurance','test-data-generator','automation-engineer']);
  assert.ok(next.edges.some(edge => edge.source === 'each-story' && edge.target === 'sprint-output' && edge.sourceHandle === 'done'));
  assert.ok(next.edges.some(edge => edge.source === 'each-test-case' && edge.target === 'each-story' && edge.sourceHandle === 'done' && edge.targetHandle === 'continue'));
  assert.equal(upgradeSprintWorkflow(next), next, 'Upgrade is idempotent');
});
test('canonical v2 Sprint gets the nested case loop while custom topology stays untouched', () => {
  const v2 = upgradeLegacySprintWorkflow(legacy());
  assert.equal(v2.settings.template_version, 2);
  assert.equal(v2.nodes.length, 8);
  const v3 = upgradeSprintCaseLoop(v2);
  assert.equal(v3.settings.template_version, 3);
  assert.equal(validateWorkflowGraph(v3.nodes, v3.edges, { requireNodes: true }).length, 10);
  const v4 = upgradeSprintPerCaseAssurance(v3);
  assert.equal(v4.settings.template_version, 4);
  assert.deepEqual(loopBodies(v4.nodes, v4.edges)['each-test-case'], ['test-case-assurance','test-data-generator','automation-engineer']);
  assert.equal(upgradeSprintWorkflow(v4), v4, 'Per-case assurance upgrade is idempotent');
});
test('customized graphs and explicit publication settings are preserved', () => {
  const explicit = legacy(); explicit.settings.library_publication_mode = 'manual';
  assert.equal(upgradeSprintWorkflow(explicit).settings.library_publication_mode, 'manual');
  const customizedV3 = upgradeSprintCaseLoop(upgradeLegacySprintWorkflow(legacy()));
  customizedV3.edges.push({ id: 'custom-side-path', source: 'story-assurance', target: 'sprint-output' });
  assert.equal(upgradeSprintPerCaseAssurance(customizedV3), customizedV3, 'custom v3 side paths stay untouched');
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
