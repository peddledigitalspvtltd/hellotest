const assert=require('node:assert/strict');
exports.verify=async()=>{
 const actor=await require('@hellotest/mcp/backend/auth').principal('mcp-a','mcp-p-a','scope-fixture');
 const context=require('@hellotest/ai/backend/services/aiContextOrchestrator.service');
 const route=context.planContext({prompt:'Review the exact selected Test Case',agentId:'test-designer',requestedScopes:['test-cases']});
 const scoped=await context.buildLiveProjectEvidence({projectId:'mcp-p-a',appTypeId:'mcp-app-a',user:actor.user,prompt:'Review the exact selected Test Case',route,evidenceScope:{test_case_id:'mcp-case-a'}});
 assert.equal(scoped.counts.test_cases,1,'The current native reader must apply exact case scope to counts');
 const snapshot=JSON.parse(scoped.hits.find(hit=>hit.source_id.endsWith('-test-cases')).content);
 assert.deepEqual(snapshot.records.map(item=>item.id),['mcp-case-a']);
 const foreign=await context.buildLiveProjectEvidence({projectId:'mcp-p-a',appTypeId:'mcp-app-a',user:actor.user,prompt:'Review the exact selected Test Case',route,evidenceScope:{test_case_id:'mcp-case-b'}});
 assert.equal(foreign.counts.test_cases,0,'An identifier cannot escape the current project/application');
 const result=await require('@hellotest/knowledge/backend/services/knowledgeRetrieval.service').retrieveSearch({projectId:'mcp-p-a',appTypeId:'mcp-app-a',user:actor.user,query:'A visible case',filters:{agent_id:'test-designer',requested_scopes:['test-cases'],evidence_scope:{test_case_id:'mcp-case-a'},source_kinds:['test_case']},budgets:{max_context_tokens:5000,deadline_ms:12000}});
 assert.equal(result.retrieval.context_transport,'mcp');
 assert.equal(result.retrieval.live_context_counts.test_cases,1,'Typed evidence scope must survive MCP, normalization, contract validation and retrieval');
};

exports.verifyIntersections=async({app,db,headers})=>{
 const scoped=require('../../src/utils/agentEvidenceScopeSql');
 const rollback=Symbol('scope-fixture-rollback');
 try { await db.transaction(async()=>{
  await db.query("INSERT INTO role_permissions(role_id,permission_id) SELECT 'mcp-fixture-role',id FROM permissions WHERE code IN ('requirement_iteration.view','result.view') ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO requirement_iterations(id,project_id,name) VALUES ('scope-sprint-a','mcp-p-a','Scope Sprint A'),('scope-sprint-b','mcp-p-a','Scope Sprint B')");
  await db.query("INSERT INTO requirement_releases(id,project_id,name,fix_version) VALUES ('scope-release-a','mcp-p-a','Scope Release A','scope-a'),('scope-release-b','mcp-p-a','Scope Release B','scope-b')");
  await db.query("INSERT INTO requirement_release_sprints(release_id,iteration_id) VALUES ('scope-release-a','scope-sprint-a'),('scope-release-b','scope-sprint-b')");
  await db.query("INSERT INTO requirements(id,project_id,title,iteration_id) VALUES ('scope-story-a','mcp-p-a','Checkout retry','scope-sprint-a'),('scope-story-b','mcp-p-a','Unrelated profile','scope-sprint-b')");
  await db.query("UPDATE test_cases SET requirement_id='scope-story-a' WHERE id='mcp-case-a'");
  await db.query("INSERT INTO test_cases(id,app_type_id,title,requirement_id) VALUES ('scope-case-b','mcp-app-a','Unrelated profile case','scope-story-b')");
  await db.query("INSERT INTO requirement_test_cases(requirement_id,test_case_id) VALUES ('scope-story-b','mcp-case-a')");
  await db.query("INSERT INTO executions(id,project_id,app_type_id,name,release_id,iteration_id,status) VALUES ('scope-run-a','mcp-p-a','mcp-app-a','Checkout regression','scope-release-a','scope-sprint-a','failed'),('scope-run-b','mcp-p-a','mcp-app-a','Profile regression','scope-release-b','scope-sprint-b','failed')");
  await db.query("INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title) VALUES ('scope-run-a','mcp-case-a','Checkout'),('scope-run-a','scope-case-b','Profile'),('scope-run-b','scope-case-b','Profile')");
  await db.query("INSERT INTO feedback(id,project_id,title,user_id,message,linked_test_run_id,linked_requirement_ids,linked_test_case_ids) VALUES ('scope-defect-a','mcp-p-a','Checkout retry failed','mcp-a','Checkout failure','scope-run-a','[\"scope-story-a\"]','[\"mcp-case-a\"]'),('scope-defect-b','mcp-p-a','Profile failed','mcp-a','Profile failure','scope-run-b','[\"scope-story-b\"]','[\"scope-case-b\"]')");
  const read=async(kind,table,scope)=>{const predicate=scoped.predicate(kind,'record',scope);return (await db.prepare(`SELECT record.id FROM ${table} record WHERE TRUE ${predicate.sql} ORDER BY record.id`).all(...predicate.params)).map(row=>row.id);};
  const scope={story_id:'scope-story-a',test_case_id:'mcp-case-a',execution_id:'scope-run-a',release_id:'scope-release-a',sprint_id:'scope-sprint-a'};
  for(const [kind,table,id] of [['story','requirements','scope-story-a'],['test_case','test_cases','mcp-case-a'],['run','executions','scope-run-a'],['bug','feedback','scope-defect-a']]){
   assert.deepEqual(await read(kind,table,scope),[id],`${kind} honors all selected dimensions`);
   assert.deepEqual(await read(kind,table,{...scope,sprint_id:'scope-sprint-b'}),[],`${kind} cannot OR unrelated sprint evidence into the selection`);
  }
  assert.deepEqual(await read('test_case','test_cases',{execution_id:'scope-run-a',story_id:'scope-story-a'}),['mcp-case-a'],'Legacy direct Story links are included');
  assert.deepEqual(await read('test_case','test_cases',{story_id:'scope-story-a',release_id:'scope-release-b',sprint_id:'scope-sprint-b'}),[],'A second linked Story must not satisfy a conflicting delivery scope');
  await db.query("INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status) VALUES ('scope-result-a','scope-run-a','mcp-case-a','mcp-app-a','passed'),('scope-result-b','scope-run-a','scope-case-b','mcp-app-a','failed')");
  const actor=(await require('@hellotest/mcp/backend/auth').principal('mcp-a','mcp-p-a','scope-fixture')).user;
  const context=require('@hellotest/ai/backend/services/aiContextOrchestrator.service');
  const live=await context.buildLiveProjectEvidence({projectId:'mcp-p-a',appTypeId:'mcp-app-a',user:actor,prompt:'Review selected delivery scope',route:{live_scopes:['stories','test-cases','runs','bugs']},evidenceScope:scope});
  assert.deepEqual(live.counts,{stories:1,test_cases:1,runs:1,bugs:1},'Live queries preserve conjunctive scope through aggregate and support joins');
  const snapshots=live.hits.map(hit=>JSON.parse(hit.content));
  assert.ok(!snapshots.some(snapshot=>snapshot.evidence_type==='authoritative_live_project_record'),'Project metadata must not become task evidence when an exact scope is selected');
  assert.equal(snapshots.find(snapshot=>snapshot.evidence_type==='authoritative_live_story_snapshot').records[0].linked_test_case_count,1);
  assert.deepEqual(snapshots.find(snapshot=>snapshot.evidence_type==='authoritative_live_test_case_snapshot').records[0].requirement_ids,['scope-story-a'],'Unselected Story links are omitted from scoped Test Case evidence');
  const runSnapshot=snapshots.find(snapshot=>snapshot.evidence_type==='authoritative_live_execution_snapshot');
  assert.equal(runSnapshot.records[0].passed_count,1);assert.equal(runSnapshot.records[0].failed_count,0);assert.equal(runSnapshot.failed_runs,0,'A failure on an unrelated case cannot mark selected coverage as failed');
  const sourceFilter=scoped.sourcePredicate('sources',scope,'mcp-app-a');
  await db.query("INSERT INTO ai_knowledge_sources(id,project_id,source_kind,source_ref_id,title,extraction_status,revision_token) VALUES ('scope-source-case','mcp-p-a','test_case','mcp-case-a','Checkout context','ready','scope-fixture'),('scope-source-other','mcp-p-a','test_case','scope-case-b','Profile context','ready','scope-fixture')");
  await db.query("INSERT INTO ai_knowledge_repo(id,project_id,title,content) VALUES ('scope-knowledge-a','mcp-p-a','Retry rules','An existing checkout must remain unique'),('scope-knowledge-b','mcp-p-a','Profile rules','An unrelated profile rule')");
  await db.query("INSERT INTO ai_knowledge_relations(id,project_id,source_id,source_type,target_id,target_type,relation_type) VALUES ('scope-knowledge-link-a','mcp-p-a','scope-knowledge-a','knowledge_item','scope-story-a','requirement','documents'),('scope-knowledge-link-b','mcp-p-a','scope-story-b','requirement','scope-knowledge-b','knowledge_item','documents')");
  await db.query("INSERT INTO ai_knowledge_sources(id,project_id,source_kind,source_ref_id,title,extraction_status,revision_token) VALUES ('scope-source-linked-a','mcp-p-a','knowledge_item','scope-knowledge-a','Retry rules','ready','scope-fixture'),('scope-source-linked-b','mcp-p-a','knowledge_item','scope-knowledge-b','Profile rules','ready','scope-fixture')");
  assert.deepEqual((await db.prepare(`SELECT sources.id FROM ai_knowledge_sources sources WHERE sources.project_id=? ${sourceFilter.sql} ORDER BY sources.id`).all('mcp-p-a',...sourceFilter.params)).map(row=>row.id),['scope-source-case','scope-source-linked-a'],'Indexed scope accepts explicit related Knowledge and excludes unrelated project or linked sources');
  const rag=require('@hellotest/knowledge/backend/services/knowledgeRag.service');
  const pinned=await rag.search({projectId:'mcp-p-a',user:actor,query:'Release requires passing tests',mode:'keyword',filters:{evidence_scope:scope,source_ids:['mcp-source','hellotest-product-help']}});
  assert.deepEqual(pinned.results,[],'Pinned unrelated sources and product help cannot override exact evidence scope');
  // Direct service reads share project authorization with the HTTP route; its
  // query executes against the same transaction so fixture rows stay isolated.
  const options=require('../../../../agentic/backend/services/agentEvidenceScopeOptions.service');
  assert.deepEqual((await options.options({project_id:'mcp-p-a',app_type_id:'mcp-app-a',field:'story_id',search:'Checkout',sprint_id:'scope-sprint-a'},actor)).items.map(item=>item.id),['scope-story-a']);
  assert.deepEqual((await options.options({project_id:'mcp-p-a',field:'story_id',test_case_id:'mcp-case-b'},actor)).items,[],'Foreign IDs never produce current-project choices');
  throw rollback;
 })(); } catch(error) { if(error!==rollback)throw error; }
 if(app&&headers){
  const response=await app.inject({url:'/agentic-workflows/evidence-scope/options?project_id=mcp-p-a&app_type_id=mcp-app-b&field=test_case_id',headers});
  assert.equal(response.statusCode,400,'Lookup rejects an application owned by another project');
 }
};
