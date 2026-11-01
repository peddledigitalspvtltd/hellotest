// Upgrade only the original eight-step Sprint template. Custom graphs, explicit
// publication settings and accepted run snapshots keep their saved behavior.
function upgradeSprintWorkflow(workflow) {
  if (workflow?.settings?.template_id !== 'sprint-automator' || Number(workflow.settings.template_version) >= 2
    || !Array.isArray(workflow.nodes) || workflow.nodes.length !== 8 || !Array.isArray(workflow.edges) || workflow.edges.length !== 7) return workflow;
  const byId = new Map(workflow.nodes.map(node => [node.id, node]));
  const first = workflow.nodes.find(node => node.data?.kind === 'trigger');
  const chain = first ? [first] : [];
  while (chain.length && chain.length < 8) {
    const next = workflow.edges.filter(edge => edge.source === chain.at(-1).id);
    if (next.length !== 1 || next[0].sourceHandle || next[0].targetHandle || !byId.has(next[0].target) || chain.some(node => node.id === next[0].target)) return workflow;
    chain.push(byId.get(next[0].target));
  }
  const kinds = ['trigger', 'apiTool', 'loop', 'artifactTask', 'artifactTask', 'artifactTask', 'artifactTask', 'output'];
  const tasks = ['story-assurance', 'test-case-generation', 'test-case-assurance', 'automation-engineer'];
  if (chain.length !== 8 || chain.some((node, index) => node.data?.kind !== kinds[index])
    || chain[1].data.apiResource !== 'sprintStories' || chain[2].data.loopAction !== 'storyPackets'
    || chain.slice(3, 7).some((node, index) => node.data.artifactTask !== tasks[index])) return workflow;
  const loop = chain[2], last = chain[6], output = chain[7];
  const enter = workflow.edges.find(edge => edge.source === loop.id);
  const finish = workflow.edges.find(edge => edge.source === last.id);
  return { ...workflow,
    nodes: workflow.nodes.map(node => node.id === loop.id ? { ...node, data: { ...node.data,
      loopAction: 'workflow', loopBatchSize: '1', timeoutMs: String(workflow.settings.maxDurationMs || 3600000) } } : node),
    edges: workflow.edges.map(edge => edge === enter ? { ...edge, sourceHandle: 'loop' }
      : edge === finish ? { ...edge, target: loop.id, targetHandle: 'continue' } : edge)
      .concat({ id: `${loop.id}-done-${output.id}`, source: loop.id, target: output.id, sourceHandle: 'done' }),
    settings: { ...workflow.settings, template_version: 2,
      ...(workflow.settings.library_publication_mode == null ? { library_publication_mode: 'automatic' } : {}) },
  };
}
module.exports = { upgradeSprintWorkflow };
