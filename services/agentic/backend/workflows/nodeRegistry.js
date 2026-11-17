const descriptors=require('./nodes/definition').descriptors;
const contract=require('@hellotest/contracts/workflow');
const registry = {
  wait: require("./nodes/flow/wait"),
  stop: require("./nodes/flow/stop"),
  artifactTask: require('./nodes/artifactTask'),
  customAI: require('./nodes/customAI'),
  mcpTool: require('./nodes/mcpTool'),
  repositoryAgent: require('./nodes/repositoryAgent'),
  trigger: require('./nodes/trigger'),
  agent: require('./nodes/agent'),
  llmAgent: require('./nodes/llmAgent'),
  webAgent: require('./nodes/webAgent'),
  apiAgent: require('./nodes/apiAgent'),
  apiTool: require('./nodes/apiTool'),
  knowledgeTool: require('./nodes/knowledgeTool'),
  repositoryTool: require('./nodes/repositoryTool'),
  testOpsTool: require('./nodes/testOpsTool'),
  condition: require('./nodes/condition'),
  loop: require('./nodes/loop'),
  aggregator: require('./nodes/aggregator'),
  transform: require('./nodes/transform'),
  dataOperation: require('./nodes/dataOperation'),
  errorHandler: require('./nodes/errorHandler'),
  log: require('./nodes/log'),
  output: require('./nodes/output'),
};
const kindsFor = executor => new Set(Object.values(registry).filter(item => item.executor === executor).map(item => item.kind));
const get = kind => Object.hasOwn(registry,kind) ? registry[kind] : undefined;
function validateDraft(nodes) {
  const errors=[];
  if(nodes.length>descriptors.limits.max_nodes)errors.push(`Workflows support at most ${descriptors.limits.max_nodes} nodes.`);
  if(nodes.filter(node=>get(node.data?.kind || 'agent')?.specialist).length>descriptors.limits.max_specialists)errors.push(`Workflows support at most ${descriptors.limits.max_specialists} specialist nodes.`);
  for(const node of nodes){const descriptor=get(node.data?.kind || 'agent');if(!descriptor)errors.push(`Unsupported node kind: ${node.data?.kind}.`);else errors.push(...contract.validateNodeEnvelope(descriptor,node.data || {}));}
  return errors;
}
module.exports = { registry, descriptors, kindsFor, get, validateDraft };
