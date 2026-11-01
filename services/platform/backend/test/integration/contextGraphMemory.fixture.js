const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex');

// Runs inside the existing disposable MCP/PostgreSQL harness. All source,
// index, fragment and per-user ACL checks below use actual domain SQL.
exports.verify = async ({ app, db, user = {id:'mcp-a'}, headers, createToken }) => {
  const memory = require('@hellotest/knowledge/backend/services/knowledgeContextGraph.service');
  const graph = require('@hellotest/knowledge/backend/services/knowledgeGraph.service');
  const projectId='mcp-p-a',appTypeId='mcp-app-a',sourceId='cg-memory-source',documentId='cg-memory-document-v1',chunkId='cg-memory-fragment-selected';
  const featureId='ai.context_graph.fixture',body='The reviewed release policy requires recorded passing checks.',versionHash=digest(body);
  await db.prepare(`INSERT INTO ai_knowledge_sources(id,project_id,app_type_id,source_kind,title,extraction_status,revision_token,checksum_sha256)
    VALUES (?,?,?,'text','Reviewed context policy','ready','context-memory-v1',?)`).run(sourceId,projectId,appTypeId,versionHash);
  await db.prepare('INSERT INTO ai_knowledge_documents(id,project_id,source_id,title,content,checksum_sha256) VALUES(?,?,?,?,?,?)')
    .run(documentId,projectId,sourceId,'Reviewed context policy',body,versionHash);
  for(const [id,index,content] of [[chunkId,0,body],['cg-memory-fragment-other',1,'This independently readable fragment remains available.']]) await db.prepare(`INSERT INTO ai_knowledge_chunks(id,project_id,document_id,source_id,chunk_index,content,search_vector)
    VALUES(?,?,?,?,?,?,to_tsvector('simple',?))`).run(id,projectId,documentId,sourceId,index,content,content);
  await db.prepare(`INSERT INTO ai_knowledge_index_states(document_id,project_id,source_id,document_version,is_current,lexical_state,dense_state,required_indexes_ready)
    VALUES(?,?,?,1,TRUE,'ready','not_configured',TRUE)`).run(documentId,projectId,sourceId);
  await db.prepare(`INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,principal_type,principal_id,effect,inherited)
    VALUES('cg-memory-source-allow',?,?,'PROJECT',?,'ALLOW',TRUE)`).run(projectId,sourceId,projectId);
  await db.transaction(()=>graph.syncDocument({projectId,source:{id:sourceId,project_id:projectId,source_kind:'text',title:'Reviewed context policy'},
    document:{id:documentId,version:1,checksum_sha256:versionHash},chunks:[{id:chunkId,source_id:sourceId,document_id:documentId,content:body}]}))();
  // A source rename is visible immediately even while projection backfill has
  // not refreshed its copied title. Curated aliases remain independently valid.
  await db.prepare('UPDATE ai_knowledge_sources SET title=? WHERE id=?').run('Current release policy',sourceId);
  await db.prepare('UPDATE ai_knowledge_graph_nodes SET aliases=? WHERE id=?').run(['Release policy alias'],sourceId);
  assert.equal((await db.prepare('SELECT title FROM ai_knowledge_graph_nodes WHERE id=?').get(sourceId)).title,'Reviewed context policy');
  const currentName=await graph.resolveNodes({projectId,user,query:'Current release policy'});
  assert.equal(currentName.nodes[0]?.id,sourceId);assert.equal(currentName.nodes[0].title,'Current release policy');
  assert.deepEqual((await graph.resolveNodes({projectId,user,query:'Reviewed context policy'})).nodes,[]);
  assert.equal((await graph.resolveNodes({projectId,user,query:'Release policy alias'})).nodes[0]?.title,'Current release policy');
  const currentNames=await app.inject({method:'POST',url:`/projects/${projectId}/knowledge/graph/resolve`,headers,payload:{identifiers:[sourceId]}});
  assert.equal(currentNames.statusCode,200,currentNames.body);
  assert.equal(currentNames.json().nodes[0].title,'Current release policy');assert.deepEqual(currentNames.json().nodes[0].aliases,['Release policy alias']);
  const packet={contract_type:'ContextPacket',context_packet_id:'cg-memory-packet-1',project_id:projectId,
    query:{original:'PRIVATE_CONTEXT_QUERY_MUST_NOT_BE_RETAINED'},applied_filters:{app_type_id:appTypeId},
    interpreted_request:{query_category:'project_analysis',effective_scopes:['knowledge'],retrieval_focus:'PRIVATE_RETRIEVAL_FOCUS'},
    retrieval:{chain_strategy:'authorized-hybrid+bounded-expansion',termination_reason:'evidence_sufficient'},
    authorization:{project_scope_enforced:true,source_acl_enforced:true},limitations:{retrieval_status:'COMPLETE'},evidence:[{
      evidence_id:'cg-memory-selected-evidence',source_id:sourceId,source_kind:'text',document_id:documentId,chunk_id:chunkId,
      title:'PRIVATE_CAPTURED_SOURCE_TITLE',content:body,integrity:{version_hash:versionHash,chunk_hash:digest(body)},freshness:{source_version:'1',status:'CURRENT'}
    }]};
  const input={projectId,user,packet,featureId,appTypeId,taskRef:'cg-memory-task',sessionId:'cg-memory-session'};
  const first=await memory.recordContext(input),repeat=await memory.recordContext(input);
  assert.equal(first.trace_id,repeat.trace_id);
  assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM ai_context_graph_traces WHERE project_id=? AND actor_id=? AND context_packet_id=?').get(projectId,user.id,packet.context_packet_id)).count,1);
  await assert.rejects(memory.recordContext({...input,packet:{...packet,evidence:[{...packet.evidence[0],chunk_id:'cg-memory-fragment-other'}]}}),error=>error.code==='CONTEXT_GRAPH_SELECTION_CONFLICT');
  await assert.rejects(memory.recordContext({...input,packet:{...packet,applied_filters:{...packet.applied_filters,collection_ids:['another-private-collection']}}}),error=>error.code==='CONTEXT_GRAPH_SELECTION_CONFLICT');
  const stored=await db.prepare('SELECT * FROM ai_context_graph_traces WHERE id=?').get(first.trace_id);
  assert.doesNotMatch(JSON.stringify(stored),/PRIVATE_CONTEXT_QUERY|PRIVATE_RETRIEVAL_FOCUS|PRIVATE_CAPTURED_SOURCE_TITLE|passing checks/);
  assert.equal(stored.evidence_refs[0].version_hash,versionHash);
  let view=await memory.explore({projectId,user,traceId:first.trace_id});
  assert.equal(view.stats.current_evidence_count,1);assert.ok(view.nodes.some(node=>node.id===sourceId));assert.equal(view.limitations.model_input_verified,false);
  assert.equal(view.nodes.find(node=>node.id===sourceId).title,'Current release policy');
  assert.ok(view.edges.some(edge=>edge.type==='RETRIEVED_EVIDENCE'));
  assert.ok(view.nodes.filter(node=>node.id!==sourceId).every(node=>/^[a-f0-9-]{36}$/.test(node.id)),'Synthetic structural IDs stay opaque transport-safe UUIDs');
  const api=await app.inject({method:'POST',url:`/projects/${projectId}/knowledge/context-graph/explore`,headers,payload:{trace_id:first.trace_id,app_type_id:appTypeId}});
  assert.equal(api.statusCode,200,api.body);assert.equal(api.headers['cache-control'],'no-store');assert.equal(api.json().project_id,projectId);
  assert.equal((await app.inject({method:'POST',url:`/projects/${projectId}/knowledge/context-graph/explore`,headers,payload:{trace_id:first.trace_id,actor_id:'other'}})).statusCode,400);
  const list=await app.inject({method:'GET',url:`/projects/${projectId}/knowledge/context-graph?app_type_id=${appTypeId}&feature_id=${featureId}&limit=1`,headers});
  assert.equal(list.statusCode,200,list.body);assert.equal(list.json().items[0].trace_id,first.trace_id);
  assert.equal((await app.inject({method:'GET',url:`/projects/${projectId}/knowledge/context-graph?app_type_id=mcp-app-b`,headers})).statusCode,403);

  // A peer in the same project has the same domain grants but cannot see the
  // originating user's private context history or guess a trace by ID.
  await db.query("INSERT INTO users(id,email,password_hash,name,default_role_id) VALUES('cg-memory-peer','cg-memory-peer@example.test','unused','Context peer','mcp-fixture-role')");
  await db.query("INSERT INTO project_members(id,project_id,user_id,role_id) VALUES('cg-memory-peer-member','mcp-p-a','cg-memory-peer','mcp-fixture-role')");
  try {
    assert.deepEqual((await memory.list({projectId,user:{id:'cg-memory-peer'}})).items,[]);
    await assert.rejects(memory.explore({projectId,user:{id:'cg-memory-peer'},traceId:first.trace_id}),error=>error.statusCode===404);
    if(createToken){const peerHeaders={authorization:'Bearer '+createToken({id:'cg-memory-peer'})};const hidden=await app.inject({method:'POST',url:`/projects/${projectId}/knowledge/context-graph/explore`,headers:peerHeaders,payload:{trace_id:first.trace_id}});assert.equal(hidden.statusCode,404,hidden.body);}
  } finally {await db.query("DELETE FROM project_members WHERE id='cg-memory-peer-member'");await db.query("DELETE FROM users WHERE id='cg-memory-peer'");}

  // The selected fragment is denied; another fragment keeps its source node
  // visible. Neither its selected evidence ID nor its version may leak as stale.
  await db.prepare(`INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,document_id,chunk_id,principal_type,principal_id,effect,inherited)
    VALUES('cg-memory-selected-deny',?,?,?,?,'USER',?,'DENY',FALSE)`).run(projectId,sourceId,documentId,chunkId,user.id);
  try {
    const stillVisible=await graph.resolveNodes({projectId,user,identifiers:[sourceId]});assert.equal(stillVisible.nodes.length,1);
    const denied=await memory.explore({projectId,user,traceId:first.trace_id});assert.equal(denied.stats.unavailable_evidence_count,1);assert.equal(denied.stats.stale_evidence_count,0);
    for(const forbidden of [sourceId,documentId,chunkId,'cg-memory-selected-evidence',versionHash])assert.ok(!JSON.stringify(denied).includes(forbidden),forbidden);
  } finally {await db.query("DELETE FROM ai_knowledge_security_bindings WHERE id='cg-memory-selected-deny'");}

  const event={id:'assistant-message:cg-memory-result',type:'OUTCOME_RECORDED',status:'needs_input',rationale:'The saved assistant outcome records missing execution input.',reference_id:'cg-memory-result',occurred_at:'2026-01-01T00:00:00.000Z'};
  const recorded=await memory.recordDecision({projectId,user,contextTraceId:first.trace_id,event});
  assert.equal((await memory.recordDecision({projectId,user,contextTraceId:first.trace_id,event})).event_id,recorded.event_id);
  await assert.rejects(memory.recordDecision({projectId,user,contextTraceId:first.trace_id,event:{...event,status:'answered'}}),error=>error.code==='CONTEXT_GRAPH_EVENT_CONFLICT');
  view=await memory.explore({projectId,user,traceId:first.trace_id});const outcome=view.timeline.find(item=>item.type==='OUTCOME_RECORDED');
  assert.equal(outcome.occurred_at,event.occurred_at);assert.ok(outcome.recorded_at>outcome.occurred_at);assert.equal(view.nodes.find(node=>node.id===outcome.node_id).observed_at,outcome.recorded_at);
  assert.ok(!view.edges.some(edge=>edge.type==='APPROVED_BY'||edge.type==='CAUSED_BY'));

  // Promotion of a new immutable source version marks the retained old
  // selection stale, while an exact-fragment denial above remained unavailable.
  const replacement='The updated policy also requires the configured environment.',nextHash=digest(replacement),nextDoc='cg-memory-document-v2',nextChunk='cg-memory-fragment-v2';
  await db.prepare('UPDATE ai_knowledge_documents SET is_active=FALSE,effective_to=CURRENT_TIMESTAMP WHERE id=?').run(documentId);
  await db.prepare('UPDATE ai_knowledge_index_states SET is_current=FALSE WHERE document_id=?').run(documentId);
  await db.prepare('INSERT INTO ai_knowledge_documents(id,project_id,source_id,title,content,checksum_sha256,version) VALUES(?,?,?,?,?,?,2)')
    .run(nextDoc,projectId,sourceId,'Reviewed context policy',replacement,nextHash);
  await db.prepare(`INSERT INTO ai_knowledge_chunks(id,project_id,document_id,source_id,chunk_index,content,search_vector)
    VALUES(?,?,?,?,0,?,to_tsvector('simple',?))`).run(nextChunk,projectId,nextDoc,sourceId,replacement,replacement);
  await db.prepare(`INSERT INTO ai_knowledge_index_states(document_id,project_id,source_id,document_version,is_current,lexical_state,dense_state,required_indexes_ready)
    VALUES(?,?,?,2,TRUE,'ready','not_configured',TRUE)`).run(nextDoc,projectId,sourceId);
  const stale=await memory.explore({projectId,user,traceId:first.trace_id});assert.equal(stale.stats.stale_evidence_count,1);assert.equal(stale.stats.current_evidence_count,0);assert.equal(stale.stats.unavailable_evidence_count,0);
  assert.ok(['STALE','EXPIRED'].includes(stale.nodes.find(node=>node.id===sourceId).metadata.source_status));

  const livePacket={...packet,context_packet_id:'cg-memory-live-packet',evidence:[{...packet.evidence[0],source_kind:'live_project',source_id:`live-project-${projectId}-stories`,source_ref_id:projectId,
    document_id:`live-project-${projectId}`,content:JSON.stringify({evidence_type:'authoritative_live_story_snapshot',evidence_permissions:['requirement.view'],records:[{id:'unretained-record'}]})}]};
  const live=await memory.recordContext({...input,packet:livePacket});const liveView=await memory.explore({projectId,user,traceId:live.trace_id});assert.equal(liveView.stats.recorded_snapshot_count,1);assert.equal(liveView.stats.current_evidence_count,0);
  assert.equal(liveView.nodes.find(node=>node.kind==='live_snapshot').metadata.current_content_verified,false);
  assert.ok(!JSON.stringify(liveView).includes('unretained-record'));
  await db.query("DELETE FROM role_permissions WHERE role_id='mcp-fixture-role' AND permission_id IN(SELECT id FROM permissions WHERE code='requirement.view')");
  try {const revoked=await memory.explore({projectId,user,traceId:live.trace_id});assert.equal(revoked.stats.unavailable_evidence_count,1);assert.ok(!revoked.nodes.some(node=>node.kind==='live_snapshot'));}
  finally {await db.query("INSERT INTO role_permissions(role_id,permission_id) SELECT 'mcp-fixture-role',id FROM permissions WHERE code='requirement.view' ON CONFLICT DO NOTHING");}
  return {traceId:first.trace_id,liveTraceId:live.trace_id,sourceId,featureId};
};
