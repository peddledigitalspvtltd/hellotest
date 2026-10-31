const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const G=require('../../backend/graphContext');
const actor={user:{id:'reader'},projectId:'project-a',clientId:'host-a'};
const fail=(message,statusCode=403,code='MCP_ACCESS_DENIED')=>Object.assign(new Error(message),{publicMessage:message,statusCode,code});
function fixture(options={}) {
 const calls=[];
 const graph=options.graph||{contract_type:'KnowledgeGraph',project_id:'project-a',nodes:[{id:'source-a',kind:'requirement',key:'story-a'},{id:'source-b',kind:'test_case',key:'case-a'}],edges:[{id:'edge-a',source:'source-a',target:'source-b',type:'TESTS',evidence_ids:['chunk-a']}],evidence:[{id:'chunk-a',source_id:'source-a',document_id:'version-a',content:'Approved observed requirement'}],limitations:[],stats:{}};
 const traverse=async input=>{calls.push(input);return options.expand?options.expand(input):graph;};
 const service={describe:()=>({node_kinds:G.kinds,provenance_types:['domain_link','source_passage']}),expand:traverse,trace:traverse,
  resolveNodes:async input=>{calls.push(input);return{nodes:[{id:'source-a',kind:'requirement',ref_id:'story-a'}],ambiguous:false,unresolved:[],partial:false};}};
 const boundary=G.createGraphContext({permit:async(a,p)=>{assert.equal(p,'knowledge.view');if(options.denied)throw fail('Denied');},fail,db:{prepare:()=>({get:async()=>({project_id:options.foreignApp?'foreign':'project-a'})})},bounded:options.bounded|| (value=>value),service:()=>service});
 return {calls,boundary,graph};
}
test('graph schemas keep typed exact identity and bounded traversal controls without raw graph queries or grants',()=>{
 const value=G.graphSchema.parse({seeds:[{kind:'requirement',ref_id:'story-a'}],max_edges:0,max_evidence:0});assert.equal(value.max_edges,0);assert.equal(value.max_evidence,0);
 for(const input of [{seeds:[{kind:'user',ref_id:'admin'}]},{seeds:[{kind:'requirement',ref_id:'story'}],project_id:'foreign'},{seeds:[{kind:'file',ref_id:'source'}],cypher:'MATCH (n) RETURN n'},{seeds:[{kind:'file',ref_id:'source',approved:true}]},{seeds:[{kind:'file',ref_id:'source'}],hops:4},{seeds:[{kind:'file',ref_id:'source'}],max_nodes:101},{seeds:[{kind:'file',ref_id:'source'}],max_edges:101},{seeds:[{kind:'file',ref_id:'source'}],token_budget:255},{seeds:[{kind:'file',ref_id:'source'}],token_budget:8001}])assert.equal(G.graphSchema.safeParse(input).success,false);
});
test('the graph boundary passes verified identity, exact selectors and zero evidence budget into native services',async()=>{
 const f=fixture({graph:{contract_type:'KnowledgeGraph',project_id:'project-a',nodes:[],edges:[],evidence:[]}}),input=G.graphSchema.parse({seeds:[{kind:'test_case',ref_id:'case-a'}],app_type_id:'app-a',max_edges:0,max_evidence:0,hops:0});
 const result=await f.boundary.expand(actor,input);assert.equal(result.project_id,'project-a');assert.equal(f.calls.length,1);const passed=f.calls[0];assert.equal(passed.user,actor.user);assert.equal(passed.projectId,actor.projectId);assert.equal(passed.app_type_id,'app-a');assert.deepEqual(passed.seeds,input.seeds);assert.equal(passed.maxEdges,0);assert.equal(passed.maxEvidence,0);assert.equal(passed.maxTokens,4000);assert.equal(passed.hops,0);assert.ok(passed.signal instanceof AbortSignal);
});
test('graph resolver reuses authorized native exact IDs and curated aliases without permitting model-selected scope',async()=>{
 const f=fixture(),args=G.resolveSchema.parse({query:'Checkout',identifiers:[{kind:'requirement',ref_id:'story-a'}],app_type_id:'app-a'});
 const result=await f.boundary.resolve(actor,args);assert.equal(result.project_id,'project-a');assert.equal(result.nodes[0].id,'source-a');assert.equal(f.calls[0].user,actor.user);assert.equal(f.calls[0].appTypeId,'app-a');assert.deepEqual(f.calls[0].identifiers,args.identifiers);
 assert.equal(G.resolveSchema.safeParse({...args,project_id:'foreign'}).success,false);
 await assert.rejects(fixture({foreignApp:true}).boundary.resolve(actor,args),{code:'MCP_GRAPH_SCOPE'});
});
test('revoked access, foreign application and malformed native endpoints stop before exposing graph data',async()=>{
 for(const config of [{denied:true},{foreignApp:true}]){const f=fixture(config);await assert.rejects(f.boundary.expand(actor,G.graphSchema.parse({seeds:[{kind:'file',ref_id:'source'}],app_type_id:'app-a'})),error=>error.statusCode===403);assert.equal(f.calls.length,0);}
 for(const graph of [{project_id:'foreign',nodes:[],edges:[],evidence:[]},{project_id:'project-a',nodes:[],edges:[{source:'missing',target:'hidden'}],evidence:[]}]){const f=fixture({graph});await assert.rejects(f.boundary.expand(actor,G.graphSchema.parse({seeds:[{kind:'file',ref_id:'source'}]})),error=>error.code==='MCP_GRAPH_CONTRACT');}
});
test('bounded graph work aborts a stuck dependency and trace reuses exact native traversal',async()=>{
 const f=fixture({expand:input=>new Promise((_,reject)=>input.signal.addEventListener('abort',()=>reject(input.signal.reason),{once:true}))});
 await assert.rejects(f.boundary.expand(actor,G.graphSchema.parse({seeds:[{kind:'file',ref_id:'source'}],timeout_ms:10})),error=>error.code==='MCP_CONTEXT_TIMEOUT');
 assert.equal(f.calls[0].signal.aborted,true);
 const trace=fixture();await trace.boundary.trace(actor,G.traceSchema.parse({source:{kind:'requirement',ref_id:'story-a'},target:{kind:'test_case',ref_id:'case-a'}}));assert.deepEqual(trace.calls[0].source,{kind:'requirement',ref_id:'story-a'});assert.deepEqual(trace.calls[0].target,{kind:'test_case',ref_id:'case-a'});assert.equal(trace.calls[0].maxPaths,3);
});

test('MCP redaction discloses immutable source offsets and includes its metadata in the complete delivery budget',async()=>{
 const graph={contract_type:'KnowledgeGraph',project_id:'project-a',nodes:[{id:'source-a'},{id:'source-b'}],edges:[{id:'edge-a',source:'source-a',target:'source-b',evidence_ids:['K-a'],witness_span:{start:12,end:29,offset_unit:'unicode_codepoint',offset_basis:'source_chunk'}}],evidence:[{citation:{id:'K-a',version_hash:'immutable'},content:'private-data requirement passage'}],limitations:{gaps:[]},budget:{max_tokens:4000,estimated_tokens:0}};
 const f=fixture({graph,bounded:value=>JSON.parse(JSON.stringify(value).replace('private-data','[Redacted]'))});
 const safe=await f.boundary.expand(actor,G.graphSchema.parse({seeds:[{kind:'text',ref_id:'source-a'}]}));
 assert.ok(!JSON.stringify(safe).includes('private-data'));assert.equal(safe.edges[0].witness_span.rendered_content_redacted,true);assert.equal(safe.edges[0].witness_span.offset_basis,'source_chunk');assert.equal(safe.edges[0].witness_span.start,12);assert.equal(safe.evidence[0].citation.version_hash,'immutable');assert.match(safe.limitations.gaps[0],/immutable source chunk/);assert.equal(safe.budget.estimated_tokens,Buffer.byteLength(JSON.stringify(safe),'utf8'));
 await assert.rejects(f.boundary.expand(actor,G.graphSchema.parse({seeds:[{kind:'text',ref_id:'source-a'}],token_budget:256})),error=>error.code==='MCP_GRAPH_BUDGET');
});

test('graph delivery rejects foreign nested records and edges whose evidence witness is absent',async()=>{
 const valid=fixture().graph;
 for(const graph of [{...valid,nodes:[{...valid.nodes[0],project_id:'foreign'},valid.nodes[1]]},
  {...valid,evidence:[{...valid.evidence[0],project_id:'foreign'}]},
  {...valid,edges:[{...valid.edges[0],evidence_ids:['not-returned']}]}]){
  await assert.rejects(fixture({graph}).boundary.expand(actor,G.graphSchema.parse({seeds:[{kind:'requirement',ref_id:'story-a'}]})),{code:'MCP_GRAPH_CONTRACT'});
 }
 const boundary=fixture({bounded:graph=>({...graph,nodes:graph.nodes.slice(0,1)})}).boundary;
 await assert.rejects(boundary.expand(actor,G.graphSchema.parse({seeds:[{kind:'requirement',ref_id:'story-a'}]})),{code:'MCP_GRAPH_BUDGET'});
});

test('real SDK serves graph tools, exact traced evidence and project-scoped ontology resources',async t=>{
 const f=fixture(),filename=path.resolve(__dirname,'../../backend/mcpServer.js'),native=createRequire(filename),module={exports:{}};
 const mocks={'./graphContext':{...G,...f.boundary},'./backplane':{auditFailure:()=>{}},'./auth':{permit:async()=>{},fail},'./projections':{entities:{projects:{}}},'./gateway':{installTransport:()=>{}},'@hellotest/platform/backend/src/db':{prepare:()=>({run:async()=>{}})}};
 new Function('require','module','exports',fs.readFileSync(filename,'utf8'))(name=>mocks[name]||native(name),module,module.exports);
 const server=module.exports;t.after(()=>server.handler.close());
 const result=await server.callLocal(actor,'hellotest_graph_trace',{source:{kind:'requirement',ref_id:'story-a'},target:{kind:'test_case',ref_id:'case-a'}});assert.equal(result.edges[0].id,'edge-a');assert.equal(result.evidence[0].document_id,'version-a');
 const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
 const resource=async uri=>{const response=await server.handler.fetch(new Request('http://localhost/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'resources/read','Mcp-Name':uri},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'resources/read',params:{uri,_meta:meta}})}),{authInfo:{token:'verified',clientId:actor.clientId,scopes:[],extra:{actor}}});return response.json();};
 const own=await resource('hellotest://projects/project-a/graph/ontology');assert.ok(own.result,JSON.stringify(own));const data=JSON.parse(own.result.contents[0].text);assert.equal(data.scope.project_id,'project-a');assert.equal(data.data.mcp_limits.max_nodes,100);assert.ok(data.data.ontology.node_kinds.includes('requirement'));
 const denied=await resource('hellotest://projects/foreign/graph/ontology');assert.ok(denied.error);assert.ok(!JSON.stringify(denied).includes('node_kinds'));
});
