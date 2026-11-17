const graphContract=require('@hellotest/platform/backend/src/utils/agenticWorkflowGraph');
const scheduling=require('../workflowScheduling');
const mergeOperations=require('../mergeOperations');
const {contextFor,appendInputs,mergeInputs}=require('./shared/values');
const {collectReviews,reviewSource}=require('./shared/reviewContext');
const error=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode,publicMessage:message});
async function execute({run,node,sources}){const kind="aggregator";
const ancestors = new Set();
    const bodies = graphContract.loopBodies(run.workflow_snapshot.nodes, run.workflow_snapshot.edges);
    const visit = id => {
      for (const edge of run.workflow_snapshot.edges.filter(item => item.target === id && !scheduling.isReturn(item))) {
        if (!ancestors.has(edge.source)) { ancestors.add(edge.source); visit(edge.source); }
      }
      for (const child of bodies[id] || []) if (!ancestors.has(child)) { ancestors.add(child); visit(child); }
    };
    visit(node.id);
    if (kind === 'aggregator' && ['combinePosition', 'combineMatching', 'combineAll'].includes(node.data?.mergeMode) && sources.some(source => source.execution_context)) throw error('Generic field joins cannot combine revision-bound native artifact checkpoints. Use Append, Combine fields or Choose input for native Story branches.', 422);
    const mergeSources = kind === 'output' ? sources : scheduling.orderedEdges(run.workflow_snapshot.edges, node.id).map(edge => sources.find(source => source.node_id === edge.source && (!source.output?.routes || source.output.data === source.output.routes[edge.sourceHandle])) || { node_id: edge.source, status: 'skipped', output: { data: [] } });
    return { reviews: collectReviews(run.node_results.filter(item => ancestors.has(item.node_id) && reviewSource(item))), ...(kind === 'output' ? { data: contextFor(run, sources).input } : mergeOperations.execute(node.data || {}, mergeSources, { appendInputs, mergeInputs })), sources: mergeSources.map(source => ({ node_id: source.node_id, node_name: source.node_name, output_key: source.output_key, status: source.status })), requires_human_review: true };
  
}
module.exports=require("./definition")("aggregator",{acceptsMergePolicy:true,validate:(node,context={})=>mergeOperations.validate(node.data||{},context.incomingCount||0),execute});
