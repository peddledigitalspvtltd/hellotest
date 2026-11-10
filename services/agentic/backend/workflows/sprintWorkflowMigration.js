// Upgrade only canonical Sprint Automator graphs. Explicitly customized
// topology and saved node guidance keep their recorded behavior.
const TASKS = require('../../shared/workflowNativeTasks.json');

function upgradeLegacySprintWorkflow(workflow) {
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

function upgradeSprintCaseLoop(workflow) {
  if (workflow?.settings?.template_id !== 'sprint-automator' || Number(workflow.settings.template_version) >= 3
    || Number(workflow.settings.template_version) < 2 || !Array.isArray(workflow.nodes) || workflow.nodes.length !== 8
    || !Array.isArray(workflow.edges) || workflow.edges.length !== 8) return workflow;
  const byId = new Map(workflow.nodes.map(node => [node.id, node]));
  const [trigger, stories, eachStory, storyAssurance, generation, caseAssurance, automation, output] =
    ['request', 'sprint-stories', 'each-story', 'story-assurance', 'test-case-generation', 'test-case-assurance', 'automation-engineer', 'sprint-output'].map(id => byId.get(id));
  const exact = (source, target, sourceHandle, targetHandle) => workflow.edges.some(edge => edge.source === source && edge.target === target
    && (edge.sourceHandle || null) === (sourceHandle || null) && (edge.targetHandle || null) === (targetHandle || null));
  if ([trigger, stories, eachStory, storyAssurance, generation, caseAssurance, automation, output].some(node => !node)
    || trigger.data?.kind !== 'trigger' || stories.data?.kind !== 'apiTool' || stories.data?.apiResource !== 'sprintStories'
    || eachStory.data?.kind !== 'loop' || eachStory.data?.loopAction !== 'workflow'
    || storyAssurance.data?.artifactTask !== 'story-assurance' || generation.data?.artifactTask !== 'test-case-generation'
    || caseAssurance.data?.artifactTask !== 'test-case-assurance' || automation.data?.artifactTask !== 'automation-engineer'
    || output.data?.kind !== 'output'
    || !exact(trigger.id, stories.id) || !exact(stories.id, eachStory.id)
    || !exact(eachStory.id, storyAssurance.id, 'loop') || !exact(storyAssurance.id, generation.id)
    || !exact(generation.id, caseAssurance.id) || !exact(caseAssurance.id, automation.id)
    || !exact(automation.id, eachStory.id, null, 'continue') || !exact(eachStory.id, output.id, 'done')) return workflow;

  const profile = TASKS['test-data-generator'];
  const caseLoop = { id: 'each-test-case', type: 'agenticStep', position: { x: 1740, y: 140 }, data: {
    kind: 'loop', label: 'For each Test Case', loopAction: 'workflow', loopSourceKey: 'input.0.cases',
    loopMaxIterations: '10', loopBatchSize: '1', timeoutMs: String(workflow.settings.maxDurationMs || 3600000), outputKey: 'case_automation'
  } };
  const dataNode = { id: 'test-data-generator', type: 'agenticStep', position: { x: 2050, y: 140 }, data: {
    kind: 'artifactTask', artifactTask: 'test-data-generator', label: profile.label, summary: profile.description,
    task: profile.task, instructions: profile.instructions, guardrails: profile.guardrails,
    testDataSource: 'synthetic', testDataSetId: '', outputKey: 'test_data'
  } };
  const edges = workflow.edges.filter(edge => !(edge.source === caseAssurance.id && edge.target === automation.id)
    && !(edge.source === automation.id && edge.target === eachStory.id && edge.targetHandle === 'continue'));
  edges.push(
    { id: `${caseAssurance.id}-each-test-case`, source: caseAssurance.id, target: caseLoop.id },
    { id: `${caseLoop.id}-test-data-loop`, source: caseLoop.id, target: dataNode.id, sourceHandle: 'loop' },
    { id: `${dataNode.id}-${automation.id}`, source: dataNode.id, target: automation.id },
    { id: `${automation.id}-${caseLoop.id}-continue`, source: automation.id, target: caseLoop.id, targetHandle: 'continue' },
    { id: `${caseLoop.id}-${eachStory.id}-continue`, source: caseLoop.id, target: eachStory.id, sourceHandle: 'done', targetHandle: 'continue' }
  );
  return { ...workflow, nodes: [...workflow.nodes, caseLoop, dataNode], edges,
    settings: { ...workflow.settings, template_version: 3 } };
}

function upgradeSprintWorkflow(workflow) {
  return upgradeSprintPerCaseAssurance(upgradeSprintCaseLoop(upgradeLegacySprintWorkflow(workflow)));
}

function upgradeSprintPerCaseAssurance(workflow) {
  if (workflow?.settings?.template_id !== 'sprint-automator' || Number(workflow.settings.template_version) !== 3
    || !Array.isArray(workflow.nodes) || workflow.nodes.length !== 10 || !Array.isArray(workflow.edges) || workflow.edges.length !== 11) return workflow;
  const byId = new Map(workflow.nodes.map(node => [node.id, node]));
  const request = byId.get('request'), stories = byId.get('sprint-stories'), storyLoop = byId.get('each-story');
  const storyAssurance = byId.get('story-assurance'), generation = byId.get('test-case-generation');
  const assurance = byId.get('test-case-assurance'), loop = byId.get('each-test-case'), data = byId.get('test-data-generator');
  const automation = byId.get('automation-engineer'), output = byId.get('sprint-output');
  const exact = (source, target, sourceHandle, targetHandle) => workflow.edges.some(edge => edge.source === source && edge.target === target
    && (edge.sourceHandle || null) === (sourceHandle || null) && (edge.targetHandle || null) === (targetHandle || null));
  const canonicalEdges = [
    ['request', 'sprint-stories'], ['sprint-stories', 'each-story'], ['each-story', 'story-assurance', 'loop'],
    ['story-assurance', 'test-case-generation'], ['test-case-generation', 'test-case-assurance'],
    ['test-case-assurance', 'each-test-case'], ['each-test-case', 'test-data-generator', 'loop'],
    ['test-data-generator', 'automation-engineer'], ['automation-engineer', 'each-test-case', null, 'continue'],
    ['each-test-case', 'each-story', 'done', 'continue'], ['each-story', 'sprint-output', 'done']
  ];
  if (request?.data?.kind !== 'trigger' || stories?.data?.kind !== 'apiTool' || stories.data.apiResource !== 'sprintStories'
    || storyLoop?.data?.kind !== 'loop' || storyLoop.data.loopAction !== 'workflow'
    || storyAssurance?.data?.artifactTask !== 'story-assurance' || generation?.data?.artifactTask !== 'test-case-generation'
    || assurance?.data?.artifactTask !== 'test-case-assurance' || loop?.data?.kind !== 'loop' || loop.data.loopAction !== 'workflow'
    || data?.data?.artifactTask !== 'test-data-generator' || automation?.data?.artifactTask !== 'automation-engineer'
    || output?.data?.kind !== 'output'
    || canonicalEdges.some(([source, target, sourceHandle, targetHandle]) => !exact(source, target, sourceHandle, targetHandle))) return workflow;
  const edges = workflow.edges.filter(edge => !(edge.source === generation.id && edge.target === assurance.id)
    && !(edge.source === assurance.id && edge.target === loop.id)
    && !(edge.source === loop.id && edge.target === 'test-data-generator' && edge.sourceHandle === 'loop'));
  edges.push(
    { id: `${generation.id}-${loop.id}`, source: generation.id, target: loop.id },
    { id: `${loop.id}-${assurance.id}-loop`, source: loop.id, target: assurance.id, sourceHandle: 'loop' },
    { id: `${assurance.id}-test-data-generator`, source: assurance.id, target: 'test-data-generator' }
  );
  return { ...workflow, edges, settings: { ...workflow.settings, template_version: 4 } };
}
module.exports = { upgradeSprintWorkflow, upgradeLegacySprintWorkflow, upgradeSprintCaseLoop, upgradeSprintPerCaseAssurance };
