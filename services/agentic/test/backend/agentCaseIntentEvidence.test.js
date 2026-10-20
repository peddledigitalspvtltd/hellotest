const test=require('node:test');
const assert=require('node:assert/strict');
const {createAgentCaseIntentEvidenceLoader,projectCaseIntent}=require('../../backend/services/agentCaseIntentEvidence');
const saved=()=>({id:'case-1',app_type_id:'app-1',revision:7,title:'Check the original negative outcome',description:'Retain all manual clauses.',authoring_mode:'structured',automated:'no',priority:2,test_case_type:'functional',parameter_values:{'t.category':'Original category','t.password':'private-fixture-849'},test_data_options:{private_parameter_names:['t.password']},test_data_set_ids:['data-1']});
const steps=(count=8)=>Array.from({length:count},(_,index)=>({id:`step-${index+1}`,test_case_id:'case-1',step_order:index+1,step_type:'manual',action:`Original action ${index+1} with @t.category and @t.password`,expected_result:`Original negative outcome ${index+1}`}));
const input={agentId:'test-improvement',featureId:'F06',inputs:{test_case_id:'TC_12'},user:{id:'actor'},projectId:'project-1',appTypeId:'app-1'};
function fixture(extra={}) {
 const calls=[];
 const loader=createAgentCaseIntentEvidenceLoader({db:{transaction:fn=>async()=>{calls.push('transaction');return fn();},query:async sql=>calls.push(sql)},requireEntityPermission:async scope=>{calls.push(scope);if(extra.denied)throw Object.assign(new Error('Denied'),{statusCode:403});return {entityId:'case-1',projectId:'project-1'};},getTestCase:async id=>{calls.push(`case:${id}`);return extra.saved||saved();},getTestSteps:async scope=>{calls.push(scope);return extra.steps||steps();},hasPermission:async(user,permission,project)=>{calls.push({permission,project});return extra.storyPermission===true;}});
 return {loader,calls};
}

test('selected improvement loads the full source in a scoped read-only snapshot, including steps after the sixth',async()=>{
 const f=fixture(),result=await f.loader(input),data=JSON.parse(result.contextItem.content);
 assert.deepEqual(result.evidence_permissions,['testcase.view']);assert.equal(data.source_revision,7);assert.equal(data.records[0].steps.length,8);assert.equal(data.records[0].steps[7].expected_result,'Original negative outcome 8');
 assert.equal(data.completeness.manual_clauses_complete,true);assert.equal(data.completeness.omitted_manual_clauses,0);assert.equal(result.contextItem.source_kind,'live_project');assert.match(result.contextItem.citation.id,/^K-case-intent-/);
 assert.match(f.calls[1],/REPEATABLE READ READ ONLY/);assert.equal(f.calls[2].permissionCode,'testcase.view');assert.equal(f.calls[2].projectId,'project-1');assert.equal(f.calls[2].appTypeId,'app-1');assert.equal(f.calls[2].allowDisplayId,true);
 assert.deepEqual(data.records[0].parameter_values,{'t.category':'Original category'});assert.deepEqual(data.records[0].private_parameter_references,['@t.password']);assert.ok(!result.contextItem.content.includes('private-fixture-849'));assert.equal(data.completeness.dataset_rows_included,false);
});
test('irrelevant agents or absent case selectors perform no database or permission work',async()=>{
 const f=fixture();assert.equal(await f.loader({...input,agentId:'story-architect',featureId:'F01'}),null);assert.equal(await f.loader({...input,inputs:{}}),null);assert.deepEqual(f.calls,[]);
});
test('project permissions and application scope fail before step content is exposed',async()=>{
 const denied=fixture({denied:true});await assert.rejects(denied.loader(input),error=>error.statusCode===403);assert.equal(denied.calls.some(value=>typeof value==='string'&&value.startsWith('case:')),false);
 const foreign=fixture({saved:{...saved(),app_type_id:'foreign'}});await assert.rejects(foreign.loader(input),error=>error.code==='AGENT_CASE_INTENT_SCOPE');assert.equal(foreign.calls.filter(value=>value?.test_case_id).length,0);
});
test('thirty complete steps are retained; extra or oversized clauses never become excerpts',()=>{
 assert.equal(projectCaseIntent(saved(),steps(30)).records[0].steps.length,30);
 assert.throws(()=>projectCaseIntent(saved(),steps(31)),error=>error.code==='AGENT_CASE_INTENT_LIMIT');
 assert.throws(()=>projectCaseIntent(saved(),[{...steps(1)[0],action:'x'.repeat(4001)}]),error=>error.code==='AGENT_CASE_INTENT_INCOMPLETE');
 assert.throws(()=>projectCaseIntent(saved(),steps(20).map(step=>({...step,action:'x'.repeat(3000)}))),error=>error.code==='AGENT_CASE_INTENT_LIMIT');
});
test('private aliases and explicit private bindings stay out of the model, while literal private clauses block safely',()=>{
 const data=saved();data.parameter_values={'t.alias':'private-fixture-849',...data.parameter_values,'t.customer_ref':'private-custom-753'};data.test_data_options.private_parameter_names.push('t.customer_ref');
 const result=projectCaseIntent(data,steps());assert.deepEqual(result.records[0].parameter_values,{'t.category':'Original category'});assert.ok(result.records[0].private_parameter_references.includes('@t.alias'));assert.ok(!JSON.stringify(result).includes('private-custom-753'));
 assert.throws(()=>projectCaseIntent(saved(),[{...steps(1)[0],action:'Enter private-fixture-849'}]),error=>error.code==='AGENT_CASE_INTENT_PRIVATE_LITERAL'&&!error.message.includes('private-fixture-849'));
 assert.throws(()=>projectCaseIntent(saved(),[{...steps(1)[0],expected_result:'Token Bearer hidden-fixture-value'}]),error=>error.code==='AGENT_CASE_INTENT_PRIVATE_LITERAL');
 const encoded=saved();encoded.parameter_values['t.password']='private/value-849';assert.throws(()=>projectCaseIntent(encoded,[{...steps(1)[0],action:'Open https://app.test/?input=private%2Fvalue-849'}]),error=>error.code==='AGENT_CASE_INTENT_PRIVATE_LITERAL');
});
test('canonical Gherkin remains complete without cached duplicate steps; executable payloads are unsupported',()=>{
 const doc='Feature: Original\nScenario: Negative outcome\nGiven the initial state\nWhen I enter @t.password\nThen the original error remains';
 const result=projectCaseIntent({...saved(),authoring_mode:'gherkin',gherkin_document:doc},steps(40));assert.equal(result.records[0].gherkin_document,doc);assert.deepEqual(result.records[0].steps,[]);
 assert.throws(()=>projectCaseIntent({...saved(),authoring_mode:'gherkin',gherkin_document:'Feature: Incomplete'},[]),error=>error.code==='AGENT_CASE_INTENT_INCOMPLETE');
 assert.throws(()=>projectCaseIntent(saved(),[{...steps(1)[0],automation_code:'await web.click("target")'}]),error=>error.code==='AGENT_CASE_INTENT_UNSUPPORTED');
});
test('Story links require both selected scope and explicit view permission; omitted links remain disclosed',async()=>{
 const data={...saved(),requirement_ids:['story-1','story-2']};
 for(const settings of [{includeStoryLinks:false,storyPermission:true},{includeStoryLinks:true,storyPermission:false}]) {
  const f=fixture({saved:data,storyPermission:settings.storyPermission}),result=await f.loader({...input,includeStoryLinks:settings.includeStoryLinks}),projection=JSON.parse(result.contextItem.content);
  assert.equal(projection.completeness.story_traceability_included,false);assert.equal(projection.completeness.omitted_story_link_count,2);assert.equal(projection.records[0].requirement_ids,undefined);assert.ok(!result.contextItem.content.includes('story-1'));assert.match(projection.limitations.join(' '),/does not mean the source case is unlinked/);assert.deepEqual(result.evidence_permissions,['testcase.view']);
 }
 const f=fixture({saved:data,storyPermission:true}),result=await f.loader({...input,includeStoryLinks:true}),projection=JSON.parse(result.contextItem.content);
 assert.deepEqual(projection.records[0].requirement_ids,['story-1','story-2']);assert.equal(projection.completeness.story_traceability_included,true);assert.deepEqual(result.evidence_permissions,['testcase.view','requirement.view']);assert.deepEqual(f.calls.at(-1),{permission:'requirement.view',project:'project-1'});
});
