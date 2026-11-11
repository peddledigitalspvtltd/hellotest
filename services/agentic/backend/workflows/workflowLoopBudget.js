const graph = require('@hellotest/platform/backend/src/utils/agenticWorkflowGraph');
const { readPath } = require('./nodeOperations')._internals;
const { generationOptions } = require('./generationNodeOptions');

const LIMITS = Object.freeze({ batches: 100, node_executions: 1000 });
const isLoop = node => node?.data?.kind === 'loop' && node.data.loopAction === 'workflow';
const sourcePath = node => String(node.data.loopSourceKey || 'input.items').replace(/^\$/, '');

// The native generator bounds its case collection before the case loop exists.
// Only an unchanged native generator/assurance chain can establish that bound.
function generatedCaseCount(loop, nodes, edges, input) {
  if (sourcePath(loop) !== 'input.0.cases') return null;
  let current = loop;
  const visited = new Set();
  while (!visited.has(current.id)) {
    visited.add(current.id);
    const incoming = edges.filter(edge => edge.target === current.id && edge.targetHandle !== 'continue');
    if (incoming.length !== 1) return null;
    current = nodes.find(node => node.id === incoming[0].source);
    if (current?.data?.kind !== 'artifactTask') return null;
    if (current.data.artifactTask === 'test-case-generation') return generationOptions(current.data, input).maxCases;
    if (current.data.artifactTask !== 'test-case-assurance') return null;
  }
  return null;
}

function failure(message) {
  return Object.assign(new Error(message), { code: 'WORKFLOW_LOOP_BUDGET_EXCEEDED', statusCode: 422,
    publicMessage: message, retryable: false, nonRetryable: true });
}

// Reserve known input sizes and configured native case counts before dispatch.
// Other data-dependent inner loops are checked once their actual input exists.
function estimate({ workflow, node, items, context, used = { batches: 0, node_executions: 0 } }) {
  const { nodes, edges } = workflow, bodies = graph.loopBodies(nodes, edges);
  const total = { batches: 0, node_executions: 0, complete: true };
  const measure = (loop, values, parent) => {
    const size = Number(loop.data.loopBatchSize || 1), batches = Math.ceil(values.length / size);
    if (values.length > Number(loop.data.loopMaxIterations)) throw failure(`Loop Over Items received ${values.length} items; its configured limit is ${loop.data.loopMaxIterations}. Reduce the input or cases per Story before running.`);
    const ids = bodies[loop.id], nested = new Set(Object.entries(bodies).filter(([id]) => ids.includes(id)).flatMap(([, children]) => children));
    const direct = nodes.filter(step => ids.includes(step.id) && !nested.has(step.id));
    total.batches += batches;
    total.node_executions += batches * direct.length;
    if (used.batches + total.batches > LIMITS.batches || used.node_executions + total.node_executions > LIMITS.node_executions) {
      throw failure(`This loop's input and configured case count exceed the shared limit of ${LIMITS.batches} total batches or ${LIMITS.node_executions} body step executions. Reduce the input or cases per Story before running.`);
    }
    for (let index = 0; index < batches; index++) {
      const batch = values.slice(index * size, (index + 1) * size);
      const child = { ...parent, item: size === 1 ? batch[0] : batch };
      for (const inner of direct.filter(isLoop)) {
        const path = sourcePath(inner), nativeCount = generatedCaseCount(inner, nodes, edges, context.request);
        const known = /^(?:item|request)(?:\.|$)/.test(path) ? readPath(child, path)
          : nativeCount != null && size === 1 ? Array(nativeCount).fill(null) : undefined;
        if (Array.isArray(known)) measure(inner, known, child);
        else total.complete = false;
      }
    }
  };
  measure(node, items, context);
  return total;
}

function sprintCapacity(workflow, input = {}) {
  if (workflow.settings?.template_id !== 'sprint-automator') return null;
  const bodies = graph.loopBodies(workflow.nodes, workflow.edges);
  const bodyIds = new Set(Object.values(bodies).flat());
  const outer = workflow.nodes.find(node => isLoop(node) && !bodyIds.has(node.id)
    && bodies[node.id].some(id => workflow.nodes.find(step => step.id === id)?.data?.artifactTask === 'test-case-generation'));
  if (!outer) return null;
  const perStory = estimate({ workflow, node: outer, items: [{}], context: { request: input } });
  if (!perStory.complete || Number(outer.data.loopBatchSize || 1) !== 1) return null;
  return Math.min(Number(outer.data.loopMaxIterations), Math.floor(LIMITS.batches / perStory.batches),
    perStory.node_executions ? Math.floor(LIMITS.node_executions / perStory.node_executions) : LIMITS.batches);
}

module.exports = { LIMITS, estimate, sprintCapacity };
