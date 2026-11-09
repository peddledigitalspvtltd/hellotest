const test=require('node:test');
const assert=require('node:assert/strict');
const {projectNativeModelContext:project,projectUpstreamTaskContext,buildWithUpstreamPlaywright}=require('../../backend/lib/automationUpstreamEngineer');
const {inspectExecutablePlan}=require('../../backend/services/automationReadiness.service');
const row=(tool,text,code='')=>({tool,arguments:'{"ref":"e16"}',code,step_id:'current',result:{isError:false,content:[{type:'text',text}]}});

test('actor context keeps one latest native page and exact historical requests/code without repeated old snapshot bodies',()=>{
 const history=Array.from({length:20},(_,index)=>row('browser_snapshot',`OLD_PAGE_${index} `+'x'.repeat(60000),`await expect(page).toHaveTitle("${index}");`));
 const latest=row('browser_snapshot','LATEST_NATIVE_PAGE'),input=[...history,latest],before=structuredClone(input);
 const result=project(input),serialized=JSON.stringify(result);
 assert.match(serialized,/LATEST_NATIVE_PAGE/);assert.doesNotMatch(serialized,/OLD_PAGE_/);
 assert.deepEqual(result.observations.at(-1).arguments,history.at(-1).arguments);assert.equal(result.observations.at(-1).code,history.at(-1).code);
 assert.equal(result.observations.at(-1).result.isError,false);assert.equal(result.delivery.omitted_observations,12);assert.ok(Buffer.byteLength(serialized)<10000);
 assert.deepEqual(input,before,'Full evidence used by artifacts is never edited.');
});

test('source context retains exact emitted assertions, locator evidence and prior native errors with a full final observation',()=>{
 const assertion='await expect(page.getByRole("status")).toHaveText("Saved");';
 const error={...row('browser_type','Unknown engine "ref" while parsing selector ref=e16'),result:{isError:true,content:[{type:'text',text:'Unknown engine "ref" while parsing selector ref=e16'}]}};
 const result=project([row('browser_snapshot','OLD_BODY'),row('browser_verify_text_visible','Native verification: Saved',assertion),row('browser_generate_locator','page.getByRole("status")'),error,row('browser_snapshot','FINAL_PAGE')],{phase:'source'});
 assert.equal(result.observations[1].code,assertion);assert.match(result.observations[1].result.content[0].text,/verification: Saved/);
 assert.match(result.observations[2].result.content[0].text,/getByRole/);assert.match(result.observations[3].result.content[0].text,/Unknown engine/);
 assert.equal(result.latest_observation.result.content[0].text,'FINAL_PAGE');assert.doesNotMatch(JSON.stringify(result),/OLD_BODY/);
});

test('model text truncation is explicit, recommends native find and bounds the projected native context',()=>{
 const input=[row('browser_snapshot','x'.repeat(150000))],result=project(input),text=result.latest_observation.result.content[0].text;
 assert.equal(text.length,60000);assert.match(text,/Native text truncated at the 60000-character model limit/);assert.match(text,/native browser_find/);
 assert.equal(result.latest_observation.result.text_truncated,true);assert.ok(Buffer.byteLength(JSON.stringify(result))<61000);assert.equal(input[0].result.content[0].text.length,150000);
 const oversized=[row('browser_type','small','x'.repeat(600000)),row('browser_snapshot','latest')];
 assert.throws(()=>project(oversized,{phase:'source'}),{code:'AUTOMATION_UPSTREAM_CONTEXT_BUDGET'});
});

function taskContext(){
 return {case_title:'Review invoices',assertion_timeout_ms:4500,navigation_timeout_ms:10000,
  case:{id:'case',title:'Invoice flow',description:'Review the saved invoice',preconditions:['An invoice exists'],priority:2,parameter_values:{password:'RAW_CASE_PARAMETER'},steps:[{automation_code:'RAW_SAVED_SOURCE'}]},
  build_context:{
   linked_manual_cases:[{id:'manual-case',steps:Array.from({length:4},(_,index)=>({id:`manual-${index+1}`,step_order:index+1,action:`Manual action ${index+1}`,expected_result:`Manual expected ${index+1}`,group_id:'review',group_name:'Invoice review',parameter_values:{value:'RAW_MANUAL_PARAMETER'},automation_code:'RAW_MANUAL_SOURCE'}))}],
   environment:{id:'env',name:'Reviewed environment',base_url:'https://app.test',browser:'chromium',notes:'Use the review tenant',variables:{secret:'RAW_ENVIRONMENT_VARIABLE'}},
   configuration:{id:'config',name:'Desktop',browser:'chromium',targets:['web'],variables:{secret:'RAW_CONFIGURATION_VARIABLE'}},
   data_set:{id:'data',name:'Invoice examples',mode:'rows',row_count:10,rows:[{password:'RAW_DATA_SET_ROW'}]},
   story_context:{stories:[{id:'story',display_id:'INV-7',title:'Read invoices',acceptance_criteria:['The selected invoice is visible'],description:'RAW_STORY_DESCRIPTION'}]},
   retrieval:{transport:'mcp',limitations:['No saved run evidence'],coverage:{stories:1},raw_packet:'RAW_RETRIEVAL_PACKET'}
  },repository:[{id:'object',name:'Invoice heading',locator:'getByRole("heading", {name:"Invoice"})'}],knowledge:[{source_id:'guide',content:'Use the reviewed invoice tenant'}]
 };
}

test('task context keeps the current linked manual goals and resource metadata without raw inputs or saved programs',()=>{
 const input=taskContext(),before=structuredClone(input),result=projectUpstreamTaskContext(input,{active_manual_step_ids:['manual-2']});
 assert.deepEqual(result.case,{id:'case',title:'Invoice flow',description:'Review the saved invoice',preconditions:['An invoice exists'],priority:2});
 assert.deepEqual(result.manual_steps,[{manual_test_case_id:'manual-case',id:'manual-2',step_order:2,action:'Manual action 2',expected_result:'Manual expected 2',group_id:'review',group_name:'Invoice review'}]);
 assert.deepEqual(result.environment,{id:'env',name:'Reviewed environment',base_url:'https://app.test',browser:'chromium',notes:'Use the review tenant'});
 assert.deepEqual(result.configuration,{id:'config',name:'Desktop',browser:'chromium',targets:['web']});
 assert.deepEqual(result.data_set,{id:'data',name:'Invoice examples',mode:'rows',row_count:10});
 assert.deepEqual(result.stories,[{id:'story',display_id:'INV-7',title:'Read invoices',acceptance_criteria:['The selected invoice is visible']}]);
 assert.deepEqual(result.repository_hints,input.repository);assert.deepEqual(result.knowledge,input.knowledge);
 assert.equal(result.retrieval.transport,'mcp');assert.deepEqual(result.retrieval.limitations,['No saved run evidence']);
 assert.doesNotMatch(JSON.stringify(result),/RAW_|Manual action [134]|Manual expected [134]/);
 assert.deepEqual(input,before,'The authorized evidence packet remains available unchanged outside the model projection.');
 assert.deepEqual(projectUpstreamTaskContext(input,{}).manual_steps,[],'An absent manual lineage cannot select every linked step.');
});

test('the native pipeline forwards the same current goals to actor and source while bounding prior-source context',async()=>{
 const requests=[],calls=[],steps=Array.from({length:4},(_,index)=>({id:`section-${index+1}`,step_order:index+1,step_type:'web',action:`Review invoice stage ${index+1}`,expected_result:`Authored outcome ${index+1} is visible`,active_manual_step_ids:[`manual-${index+1}`]}));
 const result=await buildWithUpstreamPlaywright({steps,startUrl:'https://app.test/start',context:taskContext(),interactive:false,validate:inspectExecutablePlan,
  browser:{tools:[],call:async(name)=>{calls.push(name);return {content:[{type:'text',text:'Observed the invoice heading'}]};},close:async()=>calls.push('close')},
  complete:async request=>{
   requests.push(request);
   if(request.phase==='upstream_browser_actor')return {done:true};
   if(request.phase==='upstream_source')return {automation_code:`// SOURCE_${request.step.id}\nawait expect(page.getByRole("heading", {name:"Invoice ${request.step.step_order}"})).toBeVisible();`};
   const packet=JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":')));
   return {schema:'hellotest.playwrightInstructionMapping.v1',steps:packet.steps.map(step=>({step_id:step.step_id,source_sha256:step.source_sha256,instructions:step.operations.map(op=>({operation_id:op.operation_id,kind:op.kind,depth:op.depth,label:'Verify invoice',args:[]}))}))};
  }});
 assert.deepEqual(calls,['browser_navigate','close']);
 const actors=requests.filter(request=>request.phase==='upstream_browser_actor').map(request=>JSON.parse(request.prompt));
 const sources=requests.filter(request=>request.phase==='upstream_source').map(request=>JSON.parse(request.prompt));
 for(let index=0;index<steps.length;index++){
  assert.deepEqual(actors[index].current_section,{id:steps[index].id,action:steps[index].action,expected_result:steps[index].expected_result});
  assert.deepEqual(actors[index].context.manual_steps.map(step=>step.id),[`manual-${index+1}`]);
  assert.deepEqual(sources[index].task_context,actors[index].context);
  assert.deepEqual(actors[index].authored_flow,steps.map(step=>({id:step.id,step_order:step.step_order,action:step.action})));
  assert.deepEqual(actors[index].completed_sections,steps.slice(0,index).map(step=>({step_id:step.id,step_type:'web',execution_status:'not_executed'})));
  assert.doesNotMatch(JSON.stringify({context:actors[index].context,completed:actors[index].completed_sections}),/RAW_|SOURCE_section/);
  assert.doesNotMatch(JSON.stringify(sources[index].task_context),/RAW_|SOURCE_section/);
 }
 assert.deepEqual(sources[3].previous_source,result.updates.slice(1,3).map(update=>update.automation_code));
 assert.doesNotMatch(JSON.stringify(sources[3]),/SOURCE_section-1/,'The source stage does not repeat the complete historical program.');
 assert.match(JSON.stringify(sources[3].previous_source),/SOURCE_section-2/);assert.match(JSON.stringify(sources[3].previous_source),/SOURCE_section-3/);
});

test('revoked metadata access stops the actual saved-case guards before native tools or model dispatch',async()=>{
 const source=require('node:fs').readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'),'utf8'),nodes=new Map();
 const visit=node=>{
  if(!node||typeof node!=='object')return;
  if(node.type==='VariableDeclarator'&&['assertAccess','assertBuildContextAccess','completeBuild'].includes(node.id?.name)&&node.init?.type==='ArrowFunctionExpression'){
   if(node.id.name!=='assertAccess'||source.slice(node.init.start,node.init.end).includes('resourcePermissions'))nodes.set(node.id.name,node.init);
  }
  for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
 };
 visit(require('acorn').parse(source,{ecmaVersion:'latest'}));
 const actual=(name,scope)=>{const node=nodes.get(name);assert.ok(node,`Use actual ${name} callback`);return new Function(...Object.keys(scope),`return (${source.slice(node.start,node.end)});`)(...Object.values(scope));};
 const scenarios=[
  {label:'selected environment',permission:'environment.view',resourcePermissions:['environment.view']},
  {label:'selected configuration',permission:'configuration.view',resourcePermissions:['configuration.view']},
  {label:'selected dataset',permission:'data.view',resourcePermissions:['data.view']},
  {label:'selected suite',permission:'suite.view',resourcePermissions:['suite.view']},
  {label:'repository hints',permission:'automation.view',cacheRows:[{id:'repository-object'}]},
  {label:'linked manual case',permission:'testcase.view',buildContext:{linked_manual_cases:[{id:'manual'}],story_context:{stories:[]}}},
  {label:'linked Story',permission:'requirement.view',buildContext:{linked_manual_cases:[],story_context:{stories:[{id:'story'}]}}},
  {label:'inherited browser data source',permission:'suite.view',browserParameters:{required_permissions:['suite.view'],availableParameterNames:[]}},
  {label:'resolved parameter values',permission:'data.view',browserParameters:{required_permissions:[],availableParameterNames:['t.invoice']}}
 ];
 for(const scenario of scenarios)for(const guardName of ['assertAccess','assertBuildContextAccess']){
  let revoked,ownershipChecks=0,modelCalls=0,toolCalls=0;
  const scope={execution_guard:{ensureOwnership:async()=>{ownershipChecks++;}},created_by:'actor',testCase:{project_id:'project'},resourcePermissions:[],cacheRows:[],buildContext:{linked_manual_cases:[],story_context:{stories:[]}},browserParameters:{required_permissions:[],availableParameterNames:[]},
   getOptionalEvidenceAccess:async(principal,projectId,permissions)=>{assert.deepEqual(principal,{id:'actor'});assert.equal(projectId,'project');return Object.fromEntries(permissions.map(permission=>[permission,permission!==revoked]));},...scenario};
  const guard=actual(guardName,scope);
  await guard();revoked=scenario.permission;
  if(guardName==='assertAccess'){
   await assert.rejects(buildWithUpstreamPlaywright({steps:[{id:'one',step_order:1,step_type:'web',action:'Read Invoice',expected_result:'Invoice is visible'}],startUrl:'https://app.test',assertAccess:guard,validate:inspectExecutablePlan,
    browser:{tools:[],call:async()=>{toolCalls++;return {content:[]};},close:async()=>{}},complete:async()=>{modelCalls++;return {done:true};}}),{statusCode:403},scenario.label);
  }else{
   const complete=actual('completeBuild',{assertBuildContextAccess:guard,LLM_TIMEOUT_MS:5000,requestChatCompletion:async()=>{modelCalls++;}});
   await assert.rejects(complete('Generate the current API or native section.'),{statusCode:403},scenario.label);
  }
  assert.equal(ownershipChecks,2);assert.equal(modelCalls,0,`${scenario.label} revocation must precede model dispatch`);assert.equal(toolCalls,0,`${scenario.label} revocation must precede native dispatch`);
 }
});
