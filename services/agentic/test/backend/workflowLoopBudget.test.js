const test = require('node:test');
const assert = require('node:assert/strict');
const budget = require('../../backend/workflows/workflowLoopBudget');
const runtime = require('../../backend/services/agenticWorkflowExecution.service');
const tasks = require('../../backend/workflows/artifactTasks');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const flags = require('@hellotest/platform/backend/services/featureFlag.service');
const node = (id, kind, data = {}) => ({ id, data: { label: id, kind, ...data } });
const edge = (source, target, sourceHandle, targetHandle) => ({ source, target, ...(sourceHandle ? { sourceHandle } : {}), ...(targetHandle ? { targetHandle } : {}) });
function sprint(maxCases = 5) {
  const nodes = [node('source', 'apiTool'), node('stories', 'loop', { loopAction: 'workflow', loopSourceKey: 'input.items', loopMaxIterations: 100, loopBatchSize: 1 }),
    node('story-review', 'artifactTask', { artifactTask: 'story-assurance' }), node('generate', 'artifactTask', { artifactTask: 'test-case-generation', maxCasesPerStory: maxCases }),
    node('cases', 'loop', { loopAction: 'workflow', loopSourceKey: 'input.0.cases', loopMaxIterations: 10, loopBatchSize: 1 }),
    node('case-review', 'artifactTask', { artifactTask: 'test-case-assurance' }), node('data', 'artifactTask', { artifactTask: 'test-data-generator' }),
    node('automation', 'artifactTask', { artifactTask: 'automation-engineer' }), node('finish', 'output')];
  return { nodes, execution_order: nodes.map(step => step.id), settings: { template_id: 'sprint-automator', library_publication_mode: 'manual' },
    edges: [edge('source', 'stories'), edge('stories', 'story-review', 'loop'), edge('story-review', 'generate'), edge('generate', 'cases'),
      edge('cases', 'case-review', 'loop'), edge('case-review', 'data'), edge('data', 'automation'), edge('automation', 'cases', null, 'continue'),
      edge('cases', 'stories', 'done', 'continue'), edge('stories', 'finish', 'done')] };
}

test('Sprint capacity reserves the configured case count and retains shared batch and body-node ceilings', () => {
  for (const [cases, stories] of [[1, 50], [5, 16], [10, 9]]) {
    const workflow = sprint(cases), node = workflow.nodes[1], context = { request: {} };
    assert.equal(budget.sprintCapacity(workflow), stories);
    const plan = budget.estimate({ workflow, node, items: Array(stories).fill({}), context });
    assert.equal(plan.batches, stories * (cases + 1));
    assert.equal(plan.node_executions, stories * (3 + cases * 3));
    assert.throws(() => budget.estimate({ workflow, node, items: Array(stories + 1).fill({}), context }), { code: 'WORKFLOW_LOOP_BUDGET_EXCEEDED' });
  }
  const workflow = sprint(1), outer = workflow.nodes[1];
  const report = runtime.readiness(sprint(5));
  assert.ok(report.warnings.some(message => /at most 16 Stories/.test(message)));
  assert.equal(report.limits.max_loop_batches, 100);
  assert.equal(report.limits.max_loop_node_executions, 1000);
  assert.throws(() => budget.estimate({ workflow, node: outer, items: Array(50).fill({}), context: { request: {} },
    used: { batches: 1, node_executions: 0 } }), { code: 'WORKFLOW_LOOP_BUDGET_EXCEEDED' });
  const steps = Array.from({ length: 11 }, (_, i) => node(`step-${i}`, 'transform'));
  const dense = { nodes: [node('source', 'trigger'), outer, ...steps, node('finish', 'output')], edges: [edge('source', outer.id), edge(outer.id, steps[0].id, 'loop'),
    ...steps.slice(1).map((step, index) => edge(steps[index].id, step.id)), edge(steps.at(-1).id, outer.id, null, 'continue'), edge(outer.id, 'finish', 'done')] };
  assert.throws(() => budget.estimate({ workflow: dense, node: outer, items: Array(91).fill({}), context: {} }), /1000 body step executions/);
});

test('a configured case count exceeding its inner loop limit is rejected before generation', () => {
  const workflow = sprint(5); workflow.nodes.find(step => step.id === 'cases').data.loopMaxIterations = 4;
  assert.throws(() => budget.estimate({ workflow, node: workflow.nodes[1], items: [{}], context: { request: {} } }), /received 5 items.*limit is 4/);
});

test('Sprint runtime checks the full scope before model work and completes the exact admitted boundary', async t => {
  t.mock.method(permissions, 'hasPermission', async () => true);
  t.mock.method(flags, 'areEnabled', async () => true);
  const dispatched = [];
  t.mock.method(tasks, 'execute', async ({ node, context }) => {
    const task = node.data.artifactTask, prior = context.input[0];
    dispatched.push(task);
    let packet;
    if (task === 'story-assurance') packet = { story_id: prior.id, story_revision: 'r', story: { title: prior.id } };
    else if (task === 'test-case-generation') packet = { ...prior, cases: Array.from({ length: 5 }, (_, i) => ({ client_id: `${prior.story_id}-${i}`, title: `Case ${i}` })) };
    else {
      const draft = context.item, index = prior.cases.findIndex(item => item.client_id === draft.client_id);
      const key = task === 'test-case-assurance' ? 'case_assurance' : task === 'test-data-generator' ? 'test_data_by_case' : 'automation_by_case';
      packet = { ...prior, [key]: key === 'case_assurance' ? Object.assign([...(prior.case_assurance || [])], { [index]: { verification: { status: 'passed' } } })
        : { ...(prior[key] || {}), [draft.client_id]: { status: 'ready' } } };
    }
    return { __workflow_result: { output: { data: [{ story_id: packet.story_id, result: task,
      ...(task === 'test-case-generation' ? { cases: packet.cases } : {}) }] }, context: { data: [packet] } } };
  });
  const run = count => {
    const workflow = sprint(), items = Array.from({ length: count }, (_, i) => ({ id: `story-${i}` }));
    return { id: `budget-${count}`, project_id: 'project', input_payload: {}, output_payload: {}, workflow_snapshot: workflow,
      node_results: workflow.nodes.map(step => ({ node_id: step.id, node_type: step.data.kind, node_name: step.id, status: step.id === 'source' ? 'completed' : 'queued',
        attempts: 0, logs: [], ...(step.id === 'source' ? { output: { items } } : {}) })) };
  };
  const oversized = run(17);
  await assert.rejects(runtime._internals.runStep(oversized, oversized.workflow_snapshot.nodes[1], { id: 'actor' }, new AbortController().signal, async () => {}),
    { code: 'WORKFLOW_LOOP_BUDGET_EXCEEDED' });
  assert.deepEqual(dispatched, []);
  assert.deepEqual(oversized.loop_budget, { batches: 0, node_executions: 0 });
  const admitted = run(16);
  await runtime._internals.runStep(admitted, admitted.workflow_snapshot.nodes[1], { id: 'actor' }, new AbortController().signal, async () => {});
  assert.equal(dispatched.filter(task => task === 'test-case-generation').length, 16);
  assert.equal(dispatched.filter(task => task === 'automation-engineer').length, 80);
  assert.deepEqual(admitted.loop_budget, { batches: 96, node_executions: 288 });
  assert.deepEqual(admitted.node_results[1].output.execution_usage, admitted.loop_budget);
});
