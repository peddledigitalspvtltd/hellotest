const test=require('node:test');
const assert=require('node:assert/strict');
const {createGraph}=require('../../backend/services/knowledgeGraph.service');
const {extractReferences,proofFor,createProjection}=require('../../backend/services/knowledgeGraphProjection.service');
const {reachableGraph,packGraph}=require('../../backend/services/knowledgeGraphPacking');
const {witnessVisible}=require('../../backend/services/knowledgeGraphEvidence');

const node=id=>({id,entity_type:'text',entity_key:`native-${id}`,title:`Source ${id}`,aliases:[]});
function fixture({ids=['source-A','source-B','source-C','source-D'],links=[['source-A','source-B'],['source-B','source-C'],['source-C','source-D']],revokeFinal=[],content='A recorded relationship.'}={}){
  const nodes=ids.map(node),calls=[];let reads=0;
  const edges=links.map(([source,target],index)=>({id:`edge-${index}`,source_node_id:source,target_node_id:target,relation_type:'RELATED_TO',provenance_type:'HUMAN_VERIFIED',source_kind:'text',source_key:`native-${source}`,source_title:source,source_aliases:[],target_kind:'text',target_key:`native-${target}`,target_title:target,target_aliases:[],chunk_id:`chunk-${index}`,document_id:`document-${index}`,evidence_source_id:source,document_version:1,version_hash:'version-hash',span_start:0,span_end:Array.from(content).length,content,heading:'Related context',char_start:0,char_end:content.length,evidence_source_kind:'text',evidence_source_ref_id:`native-${source}`,evidence_title:source,source_hash:'source-hash',effective_from:'2026-01-01T00:00:00Z',effective_to:null}));
  const store={prepare(sql){return {get:async(...args)=>{calls.push({sql,args});if(sql.includes('FROM users'))return{id:'actor'};throw Error(`Unexpected get ${sql}`);},all:async(...args)=>{calls.push({sql,args});if(sql.includes('SELECT nodes.id')){reads++;const requested=new Set(args.filter(arg=>typeof arg==='string'&&(ids.includes(arg)||arg.startsWith('native-'))));return nodes.filter(row=>(!requested.size||requested.has(row.id)||requested.has(row.entity_key))&&!(reads>1&&revokeFinal.includes(row.id)));}if(sql.includes('JOIN LATERAL')){const id=args.find(arg=>ids.includes(arg));return edges.filter(edge=>(edge.source_node_id===id||edge.target_node_id===id)&&!args.includes(edge.id)).slice(0,args.at(-1));}throw Error(`Unexpected all ${sql}`);}};}};
  const auth={predicate:()=>({sql:'TRUE /* source document fragment ACL */',params:[]}),applicationContextPredicate:()=>"TRUE /* immutable permission profile */",getEvidenceAccess:async({evidence})=>({allowed:evidence,partial:false})};
  const graph=createGraph({db:store,authorization:auth,permissions:{hasPermission:async()=>true},features:{getFeatureKeysForPermission:()=>[],areEnabled:async()=>true},projectAccess:{getProject:async()=>({id:'project'})}});
  return {graph,calls,edges,nodes};
}
const request={projectId:'project',user:{id:'actor'},seeds:['source-A'],maxTokens:8000};

test('bounded graph expands each node once and applies endpoint/proof ACL and current-version gates before fanout LIMIT',async()=>{
  const {graph,calls}=fixture();const result=await graph.expand({...request,hops:3,fanout:2,maxEdges:3});
  assert.equal(result.edges.length,3);assert.equal(result.nodes.length,4);assert.ok(result.stats.frontier_queries<=3);
  const queries=calls.filter(call=>call.sql.includes('JOIN LATERAL'));
  assert.equal(new Set(queries.map(call=>call.args.find(arg=>String(arg).startsWith('source-')))).size,queries.length);
  for(const {sql,args}of queries){assert.match(sql,/proof_documents\.is_active=TRUE/);assert.match(sql,/proof_indexes\.is_current=TRUE/);assert.match(sql,/origins\.required_permission IS NULL/);assert.match(sql,/targets\.required_permission IS NULL/);assert.match(sql,/source document fragment ACL/);assert.match(sql,/provenance_type IN\('DETERMINISTIC','SOURCE_EXPLICIT','HUMAN_VERIFIED'\)/);assert.ok(sql.indexOf('targets.required_permission')<sql.lastIndexOf('LIMIT ?'));assert.ok(args.at(-1)<=2);assert.ok(args.includes('knowledge.view'));}
  assert.ok(result.edges.every(edge=>edge.path.every(id=>result.nodes.some(node=>node.id===id))));
  assert.ok(result.edges.every(edge=>edge.evidence_ids.every(id=>result.evidence.some(hit=>hit.citation.id===id))));
});
test('a revoked intermediate removes descendants and all path IDs even when their own witnesses remain readable',async()=>{
  const {graph}=fixture({revokeFinal:['source-B']});const result=await graph.expand({...request,hops:3});
  assert.deepEqual(result.nodes.map(node=>node.id),['source-A']);assert.deepEqual(result.edges,[]);assert.deepEqual(result.evidence,[]);assert.equal(result.limitations.authorization_partial,true);assert.ok(!JSON.stringify(result).includes('source-B'));
});
test('zero edge or proof budgets perform no adjacency work, seed overflow is rejected, app alias and lexical ranking are explicit',async()=>{
  for(const budget of[{maxEdges:0},{maxEvidence:0}]){const{graph,calls}=fixture();const result=await graph.expand({...request,...budget});assert.equal(result.edges.length,0);assert.equal(calls.some(call=>call.sql.includes('JOIN LATERAL')),false);}
  const{graph,calls}=fixture();await assert.rejects(graph.expand({...request,seeds:Array(7).fill('source-A')}),/six/);await graph.expand({...request,hops:1,appTypeId:'application',query:'recorded relationship'});
  assert.ok(calls.filter(call=>call.sql.includes('SELECT nodes.id')).every(call=>call.args.includes('application')));assert.match(calls.find(call=>call.sql.includes('JOIN LATERAL')).sql,/ORDER BY ts_rank_cd/);
});
test('canonical IDs do not silently fall back to a different native key and typed resolution stays explicit',async()=>{
  const{graph,calls}=fixture();const result=await graph.resolveNodes({projectId:'project',user:{id:'actor'},identifiers:['source-A']});assert.equal(result.nodes[0].id,'source-A');
  const sql=calls.find(call=>call.sql.includes('SELECT nodes.id')).sql;assert.match(sql,/nodes\.id=\?/);assert.ok(!sql.includes('(nodes.id=? OR nodes.entity_key=?)'));
});
test('token packing counts the entire UTF8 JSON and never leaves downstream edges without their path witnesses',async()=>{
  const{graph}=fixture({content:'😀'.repeat(600)});const result=await graph.expand({...request,maxTokens:1600});
  const bytes=Buffer.byteLength(JSON.stringify(result),'utf8');assert.ok(bytes<=1600);assert.equal(result.budget.estimated_tokens,bytes);assert.equal(result.budget.estimator,'utf8_bytes_upper_bound');assert.equal(result.budget.truncated,true);
  assert.equal(result.edges.length,0);assert.equal(result.evidence.length,0);assert.ok(result.nodes.every(node=>result.seeds.includes(node.id)));
  await assert.rejects(graph.expand({...request,maxTokens:256}),error=>error.code==='KNOWLEDGE_GRAPH_BUDGET_TOO_SMALL');
});
test('trace paths include only returned edges and exact evidence; no-path results state their bounded scope',async()=>{
  const{graph}=fixture();const result=await graph.trace({...request,source:{kind:'text',ref_id:'native-source-A'},target:{kind:'text',ref_id:'native-source-D'},hops:3,maxPaths:2});
  assert.equal(result.paths.length,1);assert.deepEqual(result.paths[0].nodes,['source-A','source-B','source-C','source-D']);assert.ok(result.paths[0].edges.every(id=>result.edges.some(edge=>edge.id===id)));assert.ok(result.paths[0].evidence_ids.every(id=>result.evidence.some(hit=>hit.citation.id===id)));
  const short=await graph.trace({...request,source:{kind:'text',ref_id:'native-source-A'},target:{kind:'text',ref_id:'native-source-D'},hops:1});assert.equal(short.paths.length,0);assert.match(short.limitations.gaps.join(' '),/within the requested bounds/);
});
test('shared chunk witnesses preserve the complete immutable chunk and edge-specific Unicode codepoint spans',async()=>{
  const{graph,edges}=fixture({links:[['source-A','source-B'],['source-A','source-C']],content:'😀 first relation. Second relation.'});
  edges[1].chunk_id=edges[0].chunk_id;edges[1].document_id=edges[0].document_id;edges[1].span_start=18;
  const result=await graph.expand({...request,hops:1});assert.equal(result.evidence.length,1);assert.equal(result.evidence[0].content,'😀 first relation. Second relation.');assert.equal(new Set(result.edges.map(edge=>edge.witness_span.start)).size,2);assert.ok(result.edges.every(edge=>edge.witness_span.offset_unit==='unicode_codepoint'));
});
test('projection uses native structured references, explicit serializer lines and Unicode-safe witness spans',()=>{
  assert.deepEqual(extractReferences({source_kind:'file',metadata:{requirement_ids:['req']}}),[]);
  const [reference]=extractReferences({source_kind:'test_case',metadata:{requirement_ids:['req']}});
  assert.equal(proofFor([{content:'A user description mentions req.'}],reference),null);
  assert.equal(proofFor([{content:'Requirement IDs: req-other'}],reference),null);
  assert.equal(proofFor([{content:'Untrusted prose says Requirement IDs: req'}],reference),null);
  const content='😀 header\nRequirement IDs: req\nExpected outcome';const proof=proofFor([{id:'chunk',content}],reference);
  assert.equal(proof.span_start,9);assert.equal(Array.from(content).slice(proof.span_start,proof.span_end).join(''),'Requirement IDs: req');
});
test('large document graph projection is bounded and cannot cancel valid canonical ingestion or overwrite curated aliases',async()=>{
  const writes=[];const store={prepare(sql){return{run:async(...args)=>{writes.push({sql,args});return{changes:1};},get:async()=>{throw Error('No native references should be queried');}};}};
  const source={id:'source',project_id:'project',source_kind:'file',source_ref_id:'file-id',title:'Large document',metadata:{}};
  const chunks=Array.from({length:3001},(_,index)=>({id:`chunk-${index}`,source_id:source.id,document_id:'document',content:'A permitted document passage.'}));
  const result=await createProjection({db:store}).syncDocument({projectId:'project',source,document:{id:'document',version:1,checksum_sha256:'hash'},chunks});
  assert.equal(result.partial,true);assert.equal(result.omitted_chunk_count,1);assert.equal(writes.filter(write=>write.sql.includes('INSERT INTO ai_knowledge_graph_chunk_entities')).length,1);assert.equal(writes.find(write=>write.sql.includes('jsonb_to_recordset')).args[2].length,3000);assert.ok(!writes[0].sql.includes('aliases='));
});

test('backfill reports the full omitted fragment count while loading at most 3001 bodies and skips counting small documents',async()=>{
  for(const total of[24,9001]){
    const queries=[],writes=[];
    const source={id:'source',project_id:'project',source_kind:'file',source_ref_id:'file-id',title:'Large document',metadata:{}};
    const chunks=Array.from({length:Math.min(total,3001)},(_,index)=>({id:`chunk-${index}`,source_id:'source',document_id:'document',content:'A permitted document passage.'}));
    const store={prepare(sql){return{
      get:async(...args)=>{queries.push({sql,args});if(sql.includes('COUNT(*)'))return{count:total};if(sql.includes('graph_document_version'))return{...source,document_id:'document',graph_document_version:1,graph_version_hash:'hash'};throw Error(`Unexpected graph get: ${sql}`);},
      all:async(...args)=>{queries.push({sql,args});if(sql.includes('SELECT documents.id'))return[{id:'document'}];if(sql.includes('FROM ai_knowledge_chunks'))return chunks;throw Error(`Unexpected graph all: ${sql}`);},
      run:async(...args)=>{writes.push({sql,args});return{changes:1};}
    };},transaction:task=>()=>task()};
    const result=await createProjection({db:store}).reconcilePage({projectId:'project',limit:1});
    const omitted=Math.max(0,total-3000),projection=result.results[0];
    assert.equal(projection.omitted_chunk_count,omitted);assert.equal(projection.partial,omitted>0);
    assert.equal(writes.find(write=>write.sql.includes('SET metadata=metadata')).args[0].projection_omitted_fragments,omitted);
    const bodyReads=queries.filter(query=>query.sql.includes('SELECT id,document_id,source_id,content'));
    assert.equal(bodyReads.length,1);assert.match(bodyReads[0].sql,/LIMIT 3001/);
    const counts=queries.filter(query=>query.sql.includes('COUNT(*)'));
    assert.equal(counts.length,total>3000?1:0);assert.ok(counts.every(query=>!query.sql.includes('content')));
    assert.equal(writes.find(write=>write.sql.includes('jsonb_to_recordset')).args[2].length,Math.min(3000,total));
  }
});

test('a near-end witness in a 4000-character chunk fits the default packet budget with exact source offsets',async()=>{
  const content='x'.repeat(3900)+'\nThe checkout depends on the payment service.';
  const {graph,edges}=fixture({links:[['source-A','source-B']],content});
  edges[0].span_start=3901;
  const result=await graph.expand({...request,maxTokens:undefined,hops:1});
  assert.equal(result.edges.length,1);assert.equal(result.evidence.length,1);assert.ok(Buffer.byteLength(JSON.stringify(result))<=4000);
  const hit=result.evidence[0],span=result.edges[0].witness_span;
  assert.ok(hit.content.length<200);assert.ok(hit.content.includes('depends on the payment service'));assert.ok(hit.content_scope.omitted_codepoints>3800);assert.equal(witnessVisible(hit,span),true);
  const part=hit.content_scope.segments[0];assert.equal(Array.from(hit.content).slice(part.content_start,part.content_end).join(''),Array.from(content).slice(part.source_start,part.source_end).join(''));
});

test('two distant edges sharing one chunk keep disjoint mapped witnesses without pretending omitted content is contiguous',async()=>{
  const first='Source A uses source B.',last='Source A depends on source C.';
  const content='😀 '+first+'\n'+'private irrelevant prose '.repeat(160)+'\n'+last;
  const {graph,edges}=fixture({links:[['source-A','source-B'],['source-A','source-C']],content});
  edges[0].span_start=2;edges[0].span_end=2+Array.from(first).length;
  edges[1].chunk_id=edges[0].chunk_id;edges[1].document_id=edges[0].document_id;
  edges[1].span_start=Array.from(content.slice(0,content.indexOf(last))).length;edges[1].span_end=Array.from(content).length;
  const result=await graph.expand({...request,hops:1}),hit=result.evidence[0];
  assert.equal(result.edges.length,2);assert.equal(result.evidence.length,1);assert.equal(hit.content_scope.segments.length,2);assert.ok(hit.content.includes('\n[…]\n'));
  for(const span of result.edges.map(edge=>edge.witness_span))assert.equal(witnessVisible(hit,span),true);
  for(const part of hit.content_scope.segments)assert.equal(Array.from(hit.content).slice(part.content_start,part.content_end).join(''),Array.from(content).slice(part.source_start,part.source_end).join(''));
  assert.ok(hit.content_scope.segments[1].source_start>hit.content_scope.segments[0].source_end);
});

test('graph cancellation rolls back reconciliation instead of continuing to the next document',async()=>{
  const controller=new AbortController();let transactions=0,committed=0,rolledBack=0;
  const store={prepare(sql){return{all:async()=>[{id:'document-1'},{id:'document-2'}],get:async()=>{controller.abort();return{document_id:'document-1',graph_document_version:1,graph_version_hash:'hash',id:'source',project_id:'project',source_kind:'text'};}};},transaction(task){return async()=>{transactions++;try{const value=await task();committed++;return value;}catch(error){rolledBack++;throw error;}};}};
  await assert.rejects(createProjection({db:store}).reconcilePage({projectId:'project',signal:controller.signal}),{name:'AbortError'});
  assert.equal(transactions,1);assert.equal(committed,0);assert.equal(rolledBack,1);
});

test('explicit selected source kinds also constrain third-party proof sources before the fanout limit',async()=>{
  const {graph,calls}=fixture();await graph.expand({...request,hops:1,sourceKinds:['text'],appTypeId:'app-scope'});
  const query=calls.find(call=>call.sql.includes('JOIN LATERAL'));
  assert.match(query.sql,/proof_sources\.source_kind IN\(\?\)/);assert.match(query.sql,/proof_sources\.app_type_id=\?/);assert.match(query.sql,/CASE proof_sources\.source_kind/);
  assert.match(query.sql,/graph_apps\.project_id=proof_sources\.project_id/);assert.ok(query.sql.indexOf('proof_sources.source_kind IN')<query.sql.indexOf('LIMIT 1'));
  await assert.rejects(graph.expand({...request,sourceKinds:['unknown-kind']}),/source kinds/);
});
