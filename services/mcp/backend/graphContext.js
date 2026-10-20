const z = require('zod');
const { withDeadline } = require('./mcpDeadline');

const kinds = ['requirement','test_case','execution','bug','knowledge_item','text','chat','file','url'];
const id = z.string().min(1).max(255);
const seed = z.object({kind:z.enum(kinds),ref_id:id}).strict();
const options = {
 app_type_id:id.optional(),hops:z.number().int().min(0).max(3).default(2),
 fanout:z.number().int().min(1).max(12).default(8),
 // The generic MCP projection preserves arrays of up to 100 items. Keep the
 // graph below that boundary so no edge or node can be silently disconnected.
 max_nodes:z.number().int().min(1).max(100).default(60),
 max_edges:z.number().int().min(0).max(100).default(80),
 max_evidence:z.number().int().min(0).max(30).default(20),
 token_budget:z.number().int().min(256).max(8000).default(4000),
 direction:z.enum(['both','outbound','inbound']).default('both'),
 relation_types:z.array(z.string().min(1).max(100)).max(8).optional(),
 timeout_ms:z.number().int().min(1).max(20000).default(10000)
};
const graphSchema=z.object({seeds:z.array(seed).min(1).max(6),...options}).strict();
const traceSchema=z.object({source:seed,target:seed,max_paths:z.number().int().min(1).max(5).default(3),...options}).strict();

function createGraphContext({permit,fail,db,bounded,service}) {
 async function traverse(actor,args,signal,mode='expand') {
  return withDeadline(async boundedSignal=>{
   await permit(actor,'knowledge.view');boundedSignal.throwIfAborted();
   if(args.app_type_id) {
    const app=await db.prepare('SELECT project_id FROM app_types WHERE id=?').get(args.app_type_id);
    if(!app||app.project_id!==actor.projectId)throw fail('Application is outside this MCP project.',403,'MCP_GRAPH_SCOPE');
   }
   const graph=await service()[mode]({projectId:actor.projectId,user:actor.user,...(mode==='trace'?{source:args.source,target:args.target,maxPaths:args.max_paths}:{seeds:args.seeds}),
    app_type_id:args.app_type_id,hops:args.hops,fanout:args.fanout,maxNodes:args.max_nodes,maxEdges:args.max_edges,maxEvidence:args.max_evidence,maxTokens:args.token_budget,
    direction:args.direction,relationTypes:args.relation_types,signal:boundedSignal,timeoutMs:args.timeout_ms});
   boundedSignal.throwIfAborted();
   if(!graph||graph.project_id!==actor.projectId||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges)||!Array.isArray(graph.evidence)
    ||graph.nodes.length>args.max_nodes||graph.edges.length>args.max_edges||graph.evidence.length>args.max_evidence)throw fail('The graph service returned an invalid or incorrectly scoped projection.',502,'MCP_GRAPH_CONTRACT');
   const ids=new Set(graph.nodes.map(node=>node.id));
   if(ids.size!==graph.nodes.length||graph.nodes.some(node=>typeof node.id!=='string')||graph.edges.some(edge=>!ids.has(edge.source)||!ids.has(edge.target)))throw fail('The graph service returned incomplete relationship endpoints.',502,'MCP_GRAPH_CONTRACT');
   const result=bounded(graph),originalEvidence=new Map(graph.evidence.map(hit=>[hit.citation?.id,hit.content]));
   const redacted=new Set(result.evidence.filter(hit=>typeof hit.citation?.id==='string'&&originalEvidence.get(hit.citation.id)!==hit.content).map(hit=>hit.citation.id));
   if(redacted.size){
    for(const edge of result.edges)if(edge.witness_span&&edge.evidence_ids?.some(id=>redacted.has(id)))edge.witness_span={...edge.witness_span,offset_basis:'source_chunk',rendered_content_redacted:true};
    result.limitations={...result.limitations,gaps:[...(result.limitations?.gaps||[]),'Some evidence passages were redacted for MCP delivery. Witness spans identify the immutable source chunk, not the redacted display text.']};
   }
   // Native packing budgets the complete graph. Account for any redaction
   // metadata added at this boundary rather than silently exceeding that cap.
   if(result.budget){
    for(let index=0;index<6;index++){const bytes=Buffer.byteLength(JSON.stringify(result),'utf8');if(result.budget.estimated_tokens===bytes)break;result.budget.estimated_tokens=bytes;}
    if(result.budget.estimated_tokens>args.token_budget)throw fail('The graph response cannot fit its safe delivery budget. Increase token_budget or narrow the traversal.',413,'MCP_GRAPH_BUDGET');
   }
   return result;
  },{signal,timeoutMs:args.timeout_ms,timeoutMessage:'The graph read exceeded its bounded request time.'});
 }
 async function ontology(actor,_args,signal) {
  await permit(actor,'knowledge.view');signal?.throwIfAborted();
  const value=await service().describe({projectId:actor.projectId,user:actor.user,signal});
  if(!value||typeof value!=='object')throw fail('The graph ontology is unavailable.',503,'MCP_GRAPH_UNAVAILABLE');
  return bounded({ontology:value,mcp_limits:{max_hops:3,max_seeds:6,max_nodes:100,max_edges:100,max_evidence:30,max_tokens:8000,max_timeout_ms:20000}});
 }
 return {expand:(actor,args,signal)=>traverse(actor,args,signal),trace:(actor,args,signal)=>traverse(actor,args,signal,'trace'),ontology};
}
let instance;
function current() {
 if(!instance) {
  const auth=require('./auth'),backplane=require('./backplane');
  instance=createGraphContext({permit:auth.permit,fail:auth.fail,db:require('@hellotest/platform/backend/src/db'),bounded:backplane.bounded,
   service:()=>require('@hellotest/knowledge/backend/services/knowledgeGraph.service')});
 }
 return instance;
}
module.exports={kinds,graphSchema,traceSchema,createGraphContext,
 expand:(...args)=>current().expand(...args),trace:(...args)=>current().trace(...args),ontology:(...args)=>current().ontology(...args)};
