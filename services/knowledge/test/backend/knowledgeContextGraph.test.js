const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createContextGraph } = require('../../backend/services/knowledgeContextGraph.service');
const digest = value => createHash('sha256').update(value).digest('hex');
const user = { id:'owner' }, projectId = 'project';
function packet(extra = {}) {
  return { context_packet_id:'packet-1',project_id:projectId,query:{original:'PRIVATE_USER_QUESTION'},
    interpreted_request:{query_category:'project_analysis',input_type:'story_delivery',agent_id:'story-architect',effective_scopes:['stories','knowledge'],retrieval_focus:'PRIVATE_CONTEXT_FOCUS'},
    retrieval:{chain_strategy:'authorized-hybrid+bounded-expansion',termination_reason:'evidence_sufficient',raw_query:'PRIVATE_RETRIEVAL_QUERY'},
    authorization:{project_scope_enforced:true,source_acl_enforced:true},limitations:{retrieval_status:'COMPLETE'},evidence:[{
      evidence_id:'evidence-1',source_id:'source-1',source_kind:'text',document_id:'document-1',chunk_id:'chunk-1',source_version:'1',
      title:'PRIVATE_STORED_TITLE',content:'PRIVATE_SOURCE_CONTENT',integrity:{version_hash:digest('version-1'),source_hash:digest('source-1'),chunk_hash:digest('chunk-1')},freshness:{status:'CURRENT',source_version:'1'}
    }],...extra };
}
function fixture() {
  const traces = new Map(), events = new Map(), statements = [], writes = [], now='2026-11-02T00:00:00.000Z';
  const state = {active:true,view:true,enabled:true,denySource:false,denyFragment:false,current:true,readCount:0,revokeDuringRead:false,denyLive:false,denyPermissions:new Set(),revokeDuringList:false};
  const all = async (sql,args) => {
    statements.push({sql,args});
    if(sql.includes('FROM ai_context_graph_events'))return [...events.values()].filter(e=>e.trace_id===args[0]&&e.project_id===args[1]&&e.actor_id===args[2]).sort((a,b)=>b.occurred_at.localeCompare(a.occurred_at)).slice(0,31);
    if(sql.includes('FROM ai_context_graph_traces')){if(state.revokeDuringList)state.view=false;return [...traces.values()].filter(row=>row.project_id===args[0]&&row.actor_id===args[1]).sort((a,b)=>b.id.localeCompare(a.id)).slice(0,args.at(-1));}
    if(sql.includes('FROM ai_knowledge_chunks')) {
      assert.match(sql,/refs\.source_version = documents\.version::text/);assert.match(sql,/refs\.version_hash = documents\.checksum_sha256/);assert.match(sql,/fragment_acl/);
      return state.denyFragment?[]:args[0].map(ref=>({chunk_id:ref.chunk_id,document_id:ref.document_id,source_id:ref.source_id,version:Number(ref.source_version),checksum_sha256:ref.version_hash,is_current:state.current}));
    }
    if(sql.includes('FROM ai_knowledge_sources'))return [{id:'source-1'}];
    throw Error(`Unexpected all ${sql}`);
  };
  const get = async (sql,args) => {
    statements.push({sql,args});
    if(sql.includes('FROM users'))return state.active?{id:user.id}:undefined;
    if(sql.includes('FROM app_types'))return {project_id:args[0]==='foreign-app'?'foreign':projectId};
    if(sql.startsWith('INSERT INTO ai_context_graph_traces')) {
      const [id,project_id,actor_id,app_type_id,feature_id,context_packet_id,task_ref,session_id,trace_ref,query_hash,evidence_refs,coverage,selection_hash,selection]=args;
      if([...traces.values()].some(t=>t.project_id===project_id&&t.actor_id===actor_id&&t.context_packet_id===context_packet_id&&t.feature_id===feature_id))return undefined;
      const row={id,project_id,actor_id,app_type_id,feature_id,context_packet_id,task_ref,session_id,trace_ref,query_hash,evidence_refs,coverage,selection_hash,selection,recorded_at:now,cursor_recorded_at:now};traces.set(id,row);writes.push(row);return row;
    }
    if(sql.includes('FROM ai_context_graph_traces'))return [...traces.values()].find(t=>sql.includes('context_packet_id = ?')?t.project_id===args[0]&&t.actor_id===args[1]&&t.context_packet_id===args[2]&&t.feature_id===args[3]:t.id===args[0]&&t.project_id===args[1]&&t.actor_id===args[2]&&(!args[3]||!t.app_type_id||t.app_type_id===args[3]));
    if(sql.startsWith('INSERT INTO ai_context_graph_events')) {
      const [id,trace_id,project_id,actor_id,event_type,status,rationale,reference_id,occurred,payload_hash]=args,key=`${trace_id}:${id}`;
      if(events.has(key))return undefined;
      const row={id,trace_id,project_id,actor_id,event_type,status,rationale,reference_id,occurred_at:occurred||now,recorded_at:now,payload_hash};events.set(key,row);writes.push(row);return row;
    }
    if(sql.includes('FROM ai_context_graph_events'))return [...events.values()].find(e=>e.trace_id===args[0]&&e.id===args[1]&&e.project_id===args[2]&&e.actor_id===args[3]);
    throw Error(`Unexpected get ${sql}`);
  };
  const graph = createContextGraph({db:{prepare:sql=>({get:(...args)=>get(sql,args),all:(...args)=>all(sql,args)}),transaction:task=>task},
    projectAccess:{getProject:async p=>{if(p!==projectId)throw Object.assign(Error('Denied project'),{statusCode:403});}},
    permissions:{hasPermission:async(_actor,permission)=>permission==='knowledge.view'?state.view:!state.denyLive&&!state.denyPermissions.has(permission)},
    flags:{getFeatureKeysForPermission:()=>[],areEnabled:async()=>state.enabled},
    authorization:{predicate:()=>({sql:'TRUE /* fragment_acl */',params:[]}),applicationContextPredicate:()=>"TRUE /* version-profile */",applicationRecordPredicate:()=>"TRUE /* native-exists */"},
    management:{allowedPermissions:async()=>['knowledge.view'],getNodes:async(_project,_actor,ids)=>{state.readCount++;if(state.revokeDuringRead&&state.readCount>1)return[];return state.denySource?[]:ids.map(id=>({id,source_id:id,entity_type:'text',title:'Authorized current source'}));}}});
  return {graph,state,traces,events,statements,writes,record:extra=>graph.recordContext({projectId,user,packet:packet(),featureId:'ai.test_case.design',...extra})};
}

test('context memory retains exact evidence selection and safe intent metadata without storing prompts or passages',async()=>{
  const f=fixture(),receipt=await f.record({taskRef:'task-1',sessionId:'session-1'}),row=f.traces.get(receipt.trace_id);
  assert.equal(receipt.status,'recorded');assert.equal(row.evidence_refs[0].version_hash,digest('version-1'));assert.equal(row.evidence_refs[0].chunk_id,'chunk-1');
  assert.equal(row.selection.query_category,'project_analysis');assert.equal(row.selection.termination_reason,'evidence_sufficient');
  assert.doesNotMatch(JSON.stringify(row),/PRIVATE_USER_QUESTION|PRIVATE_SOURCE_CONTENT|PRIVATE_STORED_TITLE|PRIVATE_CONTEXT_FOCUS|PRIVATE_RETRIEVAL_QUERY/);
  assert.equal(row.query_hash,digest('PRIVATE_USER_QUESTION'));
  const same=await f.record({taskRef:'task-1',sessionId:'session-1'});assert.equal(same.trace_id,receipt.trace_id);assert.equal(f.traces.size,1);
  await assert.rejects(f.record({packet:packet({evidence:[{...packet().evidence[0],chunk_id:'changed-chunk'}]}),taskRef:'task-1',sessionId:'session-1'}),error=>error.code==='CONTEXT_GRAPH_SELECTION_CONFLICT');
  assert.equal(f.traces.size,1);
});
test('selection identity binds canonical applied filter metadata without retaining its private values',async()=>{
  const f=fixture(),filters={collection_ids:['PRIVATE_COLLECTION'],source_ids:['PRIVATE_SOURCE_FILTER'],evidence_scope:{run_ids:['PRIVATE_RUN_FILTER'],story_ids:['PRIVATE_STORY_FILTER']}};
  const first=await f.record({packet:packet({applied_filters:filters})});
  const same=await f.record({packet:packet({applied_filters:{evidence_scope:{story_ids:['PRIVATE_STORY_FILTER'],run_ids:['PRIVATE_RUN_FILTER']},source_ids:['PRIVATE_SOURCE_FILTER'],collection_ids:['PRIVATE_COLLECTION']}})});
  assert.equal(same.trace_id,first.trace_id);assert.match(f.traces.get(first.trace_id).selection.applied_filters_hash,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(f.traces.get(first.trace_id)),/PRIVATE_COLLECTION|PRIVATE_SOURCE_FILTER|PRIVATE_RUN_FILTER|PRIVATE_STORY_FILTER/);
  for(const applied_filters of [{...filters,collection_ids:['different-collection']},{...filters,source_ids:['different-source']},{...filters,evidence_scope:{run_ids:['different-run']}}])
    await assert.rejects(f.record({packet:packet({applied_filters})}),error=>error.code==='CONTEXT_GRAPH_SELECTION_CONFLICT');
  assert.equal(f.traces.size,1);
});
test('ledger capture rejects a foreign scope, application, disabled account and oversized evidence atomically',async()=>{
  const f=fixture();await assert.rejects(f.record({packet:packet({project_id:'foreign'})}),error=>error.statusCode===403);
  await assert.rejects(f.record({appTypeId:'foreign-app'}),error=>error.statusCode===403);
  f.state.active=false;await assert.rejects(f.record(),error=>error.statusCode===403);f.state.active=true;
  await assert.rejects(f.record({packet:packet({evidence:Array(31).fill(packet().evidence[0])})}),/thirty|30/);
  assert.equal(f.writes.length,0);
});
test('list and explore are owner-private, project-bound and respect revoked feature access',async()=>{
  const f=fixture(),receipt=await f.record();
  assert.equal((await f.graph.list({projectId,user})).items[0].trace_id,receipt.trace_id);
  assert.deepEqual((await f.graph.list({projectId,user:{id:'another'}})).items,[]);
  await assert.rejects(f.graph.explore({projectId,user:{id:'another'},traceId:receipt.trace_id}),error=>error.statusCode===404);
  await assert.rejects(f.graph.list({projectId:'foreign',user}),error=>error.statusCode===403);
  f.state.view=false;await assert.rejects(f.graph.explore({projectId,user,traceId:receipt.trace_id}),error=>error.statusCode===403);
  f.state.view=true;f.state.enabled=false;await assert.rejects(f.graph.list({projectId,user}),error=>error.statusCode===403);
  const query=f.statements.find(c=>c.sql.includes('ORDER BY recorded_at DESC,id DESC'));
  assert.match(query.sql,/project_id = \? AND actor_id = \?/);
});
test('bounded cursors bind all filters and preserve exact ordering timestamps',async()=>{
  const f=fixture();await f.record();await f.record({packet:packet({context_packet_id:'packet-2'})});
  const page=await f.graph.list({projectId,user,limit:1});assert.equal(page.items.length,1);assert.ok(page.next_cursor);
  await assert.rejects(f.graph.list({projectId,user,limit:1,featureId:'other',cursor:page.next_cursor}),/filters/);
  await assert.rejects(f.graph.list({projectId,user,cursor:'invalid'}),/cursor/);
  await assert.rejects(f.graph.list({projectId,user,limit:21}),/twenty/);
  await assert.rejects(f.graph.list({projectId,user,from:'2026-11-03T00:00:00Z',to:'2026-11-02T00:00:00Z'}),/precede/);
});
test('observed selection produces a linked graph with exact current source identity and honest policy boundary',async()=>{
  const f=fixture(),receipt=await f.record(),result=await f.graph.explore({projectId,user,traceId:receipt.trace_id});
  assert.equal(result.contract_type,'ContextGraph');assert.equal(result.stats.current_evidence_count,1);assert.equal(result.nodes.find(n=>n.id==='source-1').metadata.source_status,'CURRENT');
  assert.ok(result.nodes.some(n=>n.kind==='policy_check'));assert.ok(result.edges.some(e=>e.type==='RETRIEVED_EVIDENCE'&&e.target==='source-1'));
  assert.ok(result.edges.every(edge=>result.nodes.some(n=>n.id===edge.source)&&result.nodes.some(n=>n.id===edge.target)));
  assert.equal(result.nodes.find(n=>n.id==='source-1').metadata.confidence,null);
  assert.match(result.limitations.semantics,/do not expose private model reasoning/);
});
test('revoked selected-fragment access cannot leak its evidence ID, document ID or version through another readable source fragment',async()=>{
  const f=fixture(),receipt=await f.record();f.state.denyFragment=true;
  const result=await f.graph.explore({projectId,user,traceId:receipt.trace_id});
  assert.equal(result.stats.unavailable_evidence_count,1);assert.equal(result.stats.stale_evidence_count,0);assert.doesNotMatch(JSON.stringify(result),/evidence-1|document-1|chunk-1|Authorized current source/);
});
test('a still-authorized exact older revision is marked stale; source revocation during reads removes all identity and relationship fields',async()=>{
  const f=fixture(),receipt=await f.record();f.state.current=false;
  const old=await f.graph.explore({projectId,user,traceId:receipt.trace_id});assert.equal(old.stats.stale_evidence_count,1);assert.equal(old.nodes.find(n=>n.id==='source-1').metadata.source_status,'STALE');
  f.state.readCount=0;f.state.revokeDuringRead=true;
  const revoked=await f.graph.explore({projectId,user,traceId:receipt.trace_id});assert.equal(revoked.stats.unavailable_evidence_count,1);assert.doesNotMatch(JSON.stringify(revoked),/source-1|evidence-1|version-1/);
});
test('event recording is immutable, idempotent, owner-bound and records actual supplied outcomes rather than granting approval',async()=>{
  const f=fixture(),receipt=await f.record(),input={projectId,user,contextTraceId:receipt.trace_id,event:{id:'assistant-message:message-1',type:'OUTCOME_RECORDED',status:'answered',reference_id:'message-1',rationale:'A validated assistant answer was saved.'}};
  const first=await f.graph.recordDecision(input),same=await f.graph.recordDecision(input);assert.equal(same.event_id,first.event_id);assert.equal(f.events.size,1);
  await assert.rejects(f.graph.recordDecision({...input,event:{...input.event,status:'failed'}}),error=>error.code==='CONTEXT_GRAPH_EVENT_CONFLICT');
  await assert.rejects(f.graph.recordDecision({...input,user:{id:'another'}}),error=>error.statusCode===404);
  await assert.rejects(f.graph.recordDecision({...input,event:{...input.event,type:'GRANT_PERMISSION'}}),/observed event/);
  const result=await f.graph.explore({projectId,user,traceId:receipt.trace_id});assert.equal(result.timeline.find(item=>item.type==='OUTCOME_RECORDED').status,'answered');assert.ok(!result.edges.some(edge=>edge.type==='APPROVED_BY'));
});
test('live project snapshots retain observed lineage with fresh native permission checks and do not claim current content',async()=>{
  const f=fixture(),raw={...packet().evidence[0],source_id:`live-project-${projectId}-stories`,source_kind:'live_project',source_ref_id:projectId,document_id:`live-project-${projectId}`,content:JSON.stringify({evidence_type:'authoritative_live_story_snapshot',evidence_permissions:['requirement.view','testcase.view'],records:[{id:'private-story-id',title:'PRIVATE_STORY_TITLE'}]})};
  const receipt=await f.record({packet:packet({evidence:[raw]})}),result=await f.graph.explore({projectId,user,traceId:receipt.trace_id});
  const node=result.nodes.find(n=>n.kind==='live_snapshot');assert.ok(node);assert.equal(node.metadata.source_status,'RECORDED_SNAPSHOT');assert.equal(node.metadata.current_content_verified,false);assert.equal(result.stats.recorded_snapshot_count,1);assert.equal(result.stats.current_evidence_count,0);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_STORY_TITLE|private-story-id/);
  f.state.denyLive=true;const denied=await f.graph.explore({projectId,user,traceId:receipt.trace_id});assert.equal(denied.stats.unavailable_evidence_count,1);assert.ok(!denied.nodes.some(n=>n.kind==='live_snapshot'));
});
test('already-cancelled capture performs no persistence',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(f.record({signal:controller.signal}),error=>error.name==='AbortError');assert.equal(f.writes.length,0);
});
test('context history rechecks a grant revoked during its database read',async()=>{
  const f=fixture();await f.record();f.state.revokeDuringList=true;await assert.rejects(f.graph.list({projectId,user}),error=>error.statusCode===403);
});
test('backdated event occurrence and actual recording clocks remain distinct in timeline and graph',async()=>{
  const f=fixture(),receipt=await f.record();await f.graph.recordDecision({projectId,user,contextTraceId:receipt.trace_id,event:{id:'native-event',type:'OUTCOME_RECORDED',status:'needs_input',occurred_at:'2026-10-25T12:00:00.000Z'}});
  const graph=await f.graph.explore({projectId,user,traceId:receipt.trace_id}),event=graph.timeline.find(item=>item.type==='OUTCOME_RECORDED'),node=graph.nodes.find(item=>item.id===event.node_id);
  assert.equal(event.occurred_at,'2026-10-25T12:00:00.000Z');assert.equal(event.recorded_at,'2026-11-02T00:00:00.000Z');assert.equal(node.observed_at,event.recorded_at);assert.notEqual(node.observed_at,node.occurred_at);
});
test('truncated live snapshots cannot relax collaborators to only a core source permission',async()=>{
  const f=fixture(),raw={...packet().evidence[0],source_id:`live-project-${projectId}-stories`,source_kind:'live_project',source_ref_id:projectId,content:'{"evidence_permissions":["requirement.view",'};
  const receipt=await f.record({packet:packet({evidence:[raw]})});f.state.denyPermissions.add('attachment.view');
  const result=await f.graph.explore({projectId,user,traceId:receipt.trace_id});assert.equal(result.stats.unavailable_evidence_count,1);assert.ok(!result.nodes.some(node=>node.kind==='live_snapshot'));
});
test('retrieval memory never claims actual model consumption or source-based causality',async()=>{
  const f=fixture(),receipt=await f.record(),result=await f.graph.explore({projectId,user,traceId:receipt.trace_id});
  assert.equal(result.limitations.model_input_verified,false);assert.equal(result.limitations.stage,'retrieval_result');assert.ok(result.edges.some(edge=>edge.type==='RETRIEVED_EVIDENCE'));assert.ok(!result.edges.some(edge=>edge.type==='USED_EVIDENCE'||edge.type==='CAUSED_BY'));
});
test.after(()=>require('@hellotest/platform/backend/src/db').close());
