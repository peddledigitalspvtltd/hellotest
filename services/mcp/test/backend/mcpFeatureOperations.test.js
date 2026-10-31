const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const file=require.resolve('../../backend/featureOperations'),local=createRequire(file);
function fixture({foreign=[]}={}){
 const calls=[],permissions=[],module={exports:{}};
 const fail=(message,statusCode=403,code='MCP_ACCESS_DENIED')=>Object.assign(new Error(message),{statusCode,code});
 new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>{
  if(id==='@hellotest/platform/backend/src/db')return {prepare:sql=>({get:async value=>{calls.push({sql,value});return {id:value,project_id:foreign.includes(value)?'project-b':'project-a'};},all:async(...values)=>{calls.push({sql,values});return sql.includes('sprint_ids')?[{sprint_ids:['sprint-1']}]:[{id:'child-a'}];}})};
  if(id==='@hellotest/platform/backend/src/obsDb')return {prepare:sql=>({get:async value=>{calls.push({database:'observability',sql,value});return {id:value,project_id:foreign.includes(value)?'project-b':'project-a'};}})};
  if(id==='@hellotest/platform/backend/services/entityScope.service')return {resolveEntityScope:async({entityType,entityId,projectId})=>{calls.push({entityType,entityId,projectId});if(foreign.includes(entityId))throw fail('Foreign record.');return {entityId:entityId==='TC_12'?'canonical-case':entityId,projectId};}};
  if(id==='@hellotest/knowledge/backend/services/knowledgeSourceLifecycle.service')return {get:async id=>({id,project_id:'project-a',extraction_status:'ready'}),assertSourceRead:async source=>{calls.push({sourceAcl:source.id});if(foreign.includes(source.id))throw fail('Source is private.');}};
  if(id==='@hellotest/knowledge/backend/services/aiKnowledge.service')return {assertLegacyKnowledgeRead:async(project,item,user)=>{calls.push({legacyAcl:item.id,project,user:user.id});if(foreign.includes(item.id))throw fail('Legacy source is private.');}};
  if(id==='./auth')return {fail,permit:async(actor,permission)=>permissions.push({project:actor.projectId,permission})};
  return local(id);
 },module,module.exports);
 return {features:module.exports,calls,permissions};
}
const actor={projectId:'project-a',user:{id:'member'}};
const op=(features,method,path)=>({method,path,policy:features.policyFor(method,path)});

test('new feature wrappers enforce exact owner and every referenced child before dispatch',async()=>{
 const {features,calls}=fixture({foreign:['foreign-case','foreign-module']});
 await assert.rejects(features.assertScope(op(features,'PUT','/test-case-modules/:id'),actor,{path:{id:'foreign-module'},body:{name:'Changed'}}),{code:'MCP_PROJECT_SCOPE_DENIED'});
 await assert.rejects(features.assertScope(op(features,'POST','/test-suites/:id/assign-test-cases'),actor,{path:{id:'suite-a'},body:{test_case_ids:['foreign-case']}}),/Foreign record/);
 assert.ok(calls.some(item=>item.entityType==='test_case'&&item.entityId==='foreign-case'));
 await assert.rejects(features.assertScope(op(features,'POST','/test-data-sets'),actor,{body:{project_id:'project-b',name:'Other'}}),{code:'MCP_PROJECT_SCOPE_DENIED'});
});

test('resource display aliases normalize only after project validation and foreign response rows are rejected',async()=>{
 const {features}=fixture({foreign:['foreign-app']});
 const input={path:{id:'TC_12'}};
 await features.assertScope(op(features,'GET','/test-cases/:id'),actor,input);
 assert.equal(input.path.id,'canonical-case');
 const mutation={path:{id:'TC_12'},body:{title:'Changed'}};
 await features.assertScope(op(features,'PUT','/test-cases/:id'),actor,mutation);
 assert.equal(mutation.path.id,'canonical-case');
 const membership={path:{id:'suite'},body:{test_case_ids:['TC_12']}};
 await features.assertScope(op(features,'POST','/test-suites/:id/assign-test-cases'),actor,membership);
 assert.deepEqual(membership.body.test_case_ids,['canonical-case']);
 await assert.rejects(features.assertResponseScope(op(features,'GET','/test-suites'),actor,[{id:'suite',app_type_id:'foreign-app'}]),/Foreign record/);
 await assert.rejects(features.assertResponseScope(op(features,'GET','/analytics/overview'),actor,{project_id:'project-b',counts:{total:2}}),{code:'MCP_PROJECT_SCOPE_DENIED'});
});

test('membership verification is a fresh permission-checked project projection and release scope excludes inherited Stories',async()=>{
 const {features,calls,permissions}=fixture();
 assert.deepEqual(await features.readMembership('suite_cases','suite-a',actor),['child-a']);
 assert.ok(permissions.some(item=>item.permission==='suite.view'));
 assert.ok(permissions.some(item=>item.permission==='testcase.view'));
 assert.deepEqual(calls.at(-1).values,['suite-a','project-a']);
 assert.match(calls.at(-1).sql,/JOIN app_types/);
 await features.readMembership('release_requirements','release-a',actor);
 assert.match(calls.at(-1).sql,/source='manual'/);
 await features.readMembership('related_stories','story-a',actor);
 assert.deepEqual(calls.at(-1).values,['story-a','story-a','story-a','project-a','project-a']);
 assert.match(calls.at(-1).sql,/OR m\.related_requirement_id/);
 await assert.rejects(features.readMembership('caller_sql','target',actor),{code:'MCP_WRAPPER_REQUIRED'});
});

test('comments and attachments require the native polymorphic entity, not a project identifier alone',async()=>{
 const {features,calls}=fixture();
 await assert.rejects(features.assertScope(op(features,'GET','/comments'),actor,{query:{}}),{code:'MCP_INVALID_ARGUMENT'});
 await features.assertScope(op(features,'GET','/attachments'),actor,{query:{entity_type:'test_case',entity_id:'case-a'}});
 assert.ok(calls.some(item=>item.entityType==='test_case'&&item.entityId==='case-a'));
});

test('object repository identity comes from the authoritative observability store',async()=>{
 const {features,calls}=fixture();
 await features.assertEntity('learning_object','object-a',actor);
 assert.equal(calls.at(-1).database,'observability');
 assert.match(calls.at(-1).sql,/automation_learning_cache/);
});

test('every delegated write has a native scope and a reviewable verifiable result contract',()=>{
 const {features}=fixture();
 for(const item of features.policies().filter(item=>item.effect!=='read')){
  assert.ok(item.scope,item.route);assert.ok(item.verification,item.route);
  assert.ok(item.verification.path||item.verification.response==='proposal',item.route);
  for(const membership of item.verification.memberships||[])assert.ok(membership.storage?features.memberships[membership.storage]:membership.listPath,item.route);
 }
 for(const item of features.policies().filter(item=>/ \/issues(?:\/|$)/.test(item.route)))assert.equal(item.alias_of,item.route.replace(' /issues',' /feedback'));
 const generation=features.policyFor('POST','/test-cases/ai-authoring-preview');
 assert.equal(generation.effect,'generate');assert.equal(generation.verification.response,'proposal');
 assert.equal(features.policyFor('POST','/settings/api-keys'),null);
 assert.equal(features.policyFor('POST','/agentic-workflows/connections/http-test'),null);
});

test('browser identities use durable related IDs and stream-only endpoints are not JSON tools',async()=>{
 const {features,calls}=fixture();
 await features.assertScope(op(features,'POST','/agentic-quality/runs/:id/cancel'),actor,{path:{id:'mission-a'},body:{}});
 assert.equal(calls.at(-1).database,'observability');
 assert.match(calls.at(-1).sql,/related_kind='quality_agent_run'.*related_id=\?/);
 assert.equal(features.policyFor('GET','/agentic-quality/runs/:id/events'),null);
 for(const route of ['/test-cases/automation/learning-cache/:id','/agentic-workflows/agents/:agentId'])assert.ok(features.policyFor('GET',route));
});

test('knowledge collection receipts check source ACL and scalar release verification preserves selected release identity',async()=>{
 const {features,calls}=fixture();
 assert.deepEqual(await features.readMembership('collection_sources','collection-a',actor),['child-a']);
 assert.ok(calls.some(item=>item.sourceAcl==='child-a'));
 await features.readMembership('selected_story_release','story-a',actor);
 assert.match(calls.at(-1).sql,/rel\.name=r\.release AND rel\.fix_version IS NOT DISTINCT FROM r\.fix_version/);
 assert.match(calls.at(-1).sql,/m\.source='manual'/);
 const source=features.policyFor('DELETE','/knowledge/sources/:id');
 assert.deepEqual(source.verification.expectedValues,[{path:'source.extraction_status',value:'archived'}]);
 assert.equal(source.verification.deleteAbsence,undefined);
});

test('native normalization controls and arbitrary engine addresses are rejected before submitting a mutation',async()=>{
 const {features}=fixture();
 await assert.rejects(features.assertScope(op(features,'POST','/executions'),actor,{body:{engine_base_url:'http://unreviewed-host'}}),{code:'MCP_UNSUPPORTED_FIELD'});
 await assert.rejects(features.assertScope(op(features,'POST','/test-suites'),actor,{body:{parallel_count:4}}),{code:'MCP_INVALID_ARGUMENT'});
 await assert.rejects(features.assertScope(op(features,'POST','/execution-results'),actor,{body:{status:'pending',duration_ms:10}}),{code:'MCP_UNSUPPORTED_FIELD'});
 await assert.rejects(features.assertScope(op(features,'POST','/requirements'),actor,{body:{ai_review:{accepted_by:'other'}}}),{code:'MCP_UNSUPPORTED_FIELD'});
 const cases=features.policyFor('PUT','/test-cases/:id');
 assert.equal(cases.verification.relatedReads[0].bodyField,'steps');
 assert.equal(cases.verification.matchFields.includes('steps'),false);
 assert.deepEqual(features.policyFor('PUT','/app-types/:id').verification.matchFields,['name','is_unified']);
 const activity=features.policyFor('GET','/workspace-transactions');
 assert.ok(activity.response_fields.includes('status'));
 assert.equal(activity.response_fields.includes('metadata'),false);
 assert.deepEqual(features.policyFor('GET','/workspace-transactions/:id/events').omit_fields,['details']);
 for(const route of ['/executions/:id','/execution-results/:id']){
  const hidden=features.policyFor('GET',route).omit_fields;
  for(const key of ['data_set_row_snapshot','variables','template_variables','headers','cookies','rows','template_rows'])assert.ok(hidden.includes(key),route+':'+key);
  for(const key of ['case_snapshots','metrics','status','steps'])assert.equal(hidden.includes(key),false,route+':'+key);
 }
});

test('raw legacy Knowledge items recheck their indexed source ACL after native project selection',async()=>{
 const {features,calls}=fixture();
 await features.assertEntity('knowledge_item','text-item',actor);
 assert.ok(calls.some(item=>item.legacyAcl==='text-item'&&item.project==='project-a'));
 assert.equal(features.policyFor('GET','/projects/:project_id/knowledge').scope.entity,'knowledge_item');
 assert.equal(features.policyFor('GET','/projects/:project_id/knowledge/search').scope.collection,true);
});
