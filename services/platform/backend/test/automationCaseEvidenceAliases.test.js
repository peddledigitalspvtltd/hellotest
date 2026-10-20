const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const contracts=require('../../../knowledge/backend/services/knowledgeContracts.service');
const retrieval=require('../../../knowledge/backend/services/knowledgeRetrieval.service');
const orchestrator=require('../../../ai/backend/services/aiContextOrchestrator.service');
const db=require('../src/db'),permissions=require('../services/permission.service'),flags=require('../services/featureFlag.service');
test('automation references route as exact case lookups without matching ordinary words',()=>{
 for(const id of ['AT_00042','at-42']){
  assert.equal(contracts.classifyQuery(`Inspect ${id}`),'LOOKUP');
  assert.ok(orchestrator.planContext({prompt:`Inspect ${id}`,agentId:'automation-engineer'}).identifiers.includes(id));
  assert.ok(retrieval.buildDeterministicRetrievalQueries(`Inspect ${id}`).some(query=>query.includes(`${id} linked evidence`)));
 }
 for(const text of ['Inspect attributes','Inspect attempt','Inspect atomic behavior']){
  assert.notEqual(contracts.classifyQuery(text),'LOOKUP');assert.ok(!orchestrator.planContext({prompt:text}).identifiers.some(id=>/^at/i.test(id)));assert.ok(!retrieval.buildDeterministicRetrievalQueries(text).some(query=>/linked evidence/.test(query)));
 }
});
test('read-only aliases are project/application scoped while write scope accepts canonical IDs only',async()=>{
 const source=fs.readFileSync(require.resolve('../services/entityScope.service'),'utf8'),reads=[],module={exports:{}};
 vm.runInNewContext(source,{module,require:id=>id.endsWith('/db')?{prepare:sql=>({get:async(...params)=>{reads.push({sql,params});if(sql.includes('UPPER(test_cases.display_id)'))return params[0]==='project'&&params[1]==='app'?{id:'canonical',app_type_id:'app',project_id:'project'}:undefined;return params[0]==='canonical'?{id:'canonical',app_type_id:'app',project_id:'project'}:undefined;}})}:{}});
 const service=module.exports;
 assert.equal((await service.resolveEntityScope({entityType:'test_case',entityId:'AT_0042',projectId:'project',appTypeId:'app',allowDisplayId:true})).entityId,'canonical');assert.deepEqual(JSON.parse(JSON.stringify(reads[0].params)),['project','app','AT_0042',['AT_0042']]);
 await assert.rejects(service.resolveEntityScope({entityType:'test_case',entityId:'AT_0042',projectId:'project',appTypeId:'app'}),error=>error.statusCode===404);
 await assert.rejects(service.resolveEntityScope({entityType:'test_case',entityId:'AT_0042',projectId:'outside',appTypeId:'app',allowDisplayId:true}),error=>error.statusCode===404);
 assert.equal((await service.resolveEntityScope({entityType:'test_case',entityId:'canonical',projectId:'project'})).entityId,'canonical');
});
test('explicit evidence aliases become canonical before live case filters, only after current permission checks',async t=>{
 let allowed=true;const reads=[];
 t.mock.method(permissions,'hasPermission',async(_user,code)=>code==='testcase.view'?allowed:false);t.mock.method(flags,'areEnabled',async()=>true);
 t.mock.method(db,'prepare',sql=>({get:async(...params)=>{reads.push({sql,params});if(sql.includes('FROM projects'))return {id:'project',name:'Project'};if(sql.includes('UPPER(test_cases.display_id)'))return {id:'canonical'};return {total:0};},all:async(...params)=>{reads.push({sql,params});return [];}}));
 const input={projectId:'project',appTypeId:'app',prompt:'Inspect AT_0042',user:{id:'reader'},evidenceScope:{test_case_id:'AT_0042'},route:{live_scopes:['test-cases'],priority_scopes:['test-cases']},sourceKinds:['test_case']};
 const result=await orchestrator.buildLiveProjectEvidence(input);
 assert.deepEqual(reads.find(read=>read.sql.includes('UPPER(test_cases.display_id)')).params,['project','app','AT_0042',['AT_0042']]);assert.ok(reads.some(read=>read.sql.includes('FROM test_cases')&&read.params.includes('canonical')));
 assert.equal(JSON.parse(result.hits.find(hit=>hit.title.startsWith('Live project')).content).evidence_scope.test_case_id,'canonical');
 reads.length=0;allowed=false;await orchestrator.buildLiveProjectEvidence(input);assert.ok(!reads.some(read=>read.sql.includes('UPPER(test_cases.display_id)')));
});
test('agent inputs canonicalize display references before specialist context loading and retain user scope',async t=>{
 const assistant=require('../../../agentic/backend/services/agenticAssistant.service'),scope=require('../services/entityScope.service');let allowed=true,resolved=[];
 t.mock.method(permissions,'hasPermission',async()=>allowed);t.mock.method(flags,'getDisabledPermissionCodes',async()=>[]);t.mock.method(scope,'resolveEntityScope',async input=>{resolved.push(input);return {entityId:'canonical',projectId:'project'};});
 const inputs={test_case_id:'AT_0042',execution_id:'failed-run',build:'202610150001'};
 const result=await assistant._internals.resolveCaseEvidenceInput({inputs,user:{id:'reviewer'},projectId:'project',appTypeId:'app'});
 assert.deepEqual(result,{...inputs,test_case_id:'canonical'});assert.equal(inputs.test_case_id,'AT_0042');assert.deepEqual(resolved[0],{entityType:'test_case',entityId:'AT_0042',projectId:'project',appTypeId:'app',allowDisplayId:true});
 allowed=false;await assert.rejects(assistant._internals.resolveCaseEvidenceInput({inputs,user:{id:'reviewer'},projectId:'project',appTypeId:'app'}),error=>error.statusCode===403);assert.equal(resolved.length,1);
});
