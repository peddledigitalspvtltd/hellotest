const test=require('node:test');
const assert=require('node:assert/strict');
const expressionProgram=source=>'// @hellotest-parameter-bindings expressions-v1\n'+source;
const {buildWithUpstreamPlaywright}=require('../../backend/lib/automationUpstreamEngineer');
const {inspectExecutablePlan}=require('../../backend/services/automationReadiness.service');
const {validateGeneratedApiRequest}=require('../../../platform/backend/src/utils/testStepAutomation');
const startUrl='https://application.test/';
const goto=`await page.goto(${JSON.stringify(startUrl)});`;
const click='await page.getByRole("button",{name:"Save",exact:true}).click();';
const assertion='await expect(page.getByRole("status")).toHaveText("Saved");';
const api=id=>({id,step_order:1,step_type:'api',action:'GET https://api.test/invoice',expected_result:'HTTP 200'});
const web=id=>({id,step_order:2,step_type:'web',action:id==='save'?'Click Save':'Verify the current status',expected_result:'Saved is visible'});
function fixture({failApi=false}={}){
 const calls=[],models=[],saved=[],normalized=[];let closes=0;
 const browser={tools:[{name:'browser_click',inputSchema:{type:'object',properties:{ref:{type:'string'}},required:['ref']}}],call:async(name,args)=>{calls.push({name,args});return {content:[{type:'text',text:'### Ran Playwright code\n```js\n'+(name==='browser_navigate'?goto:click)+'\n```'}]};},close:async()=>{closes++;}};
 const complete=async request=>{
  models.push(request);
  if(request.phase==='upstream_api_source')return {steps:[{step_id:request.step.id,step_type:'api',api_request:{method:'GET',url:'https://api.test/invoice',validations:[{kind:'status',expected:'200'}]}}]};
  if(request.phase==='upstream_browser_actor'){
   const payload=JSON.parse(request.prompt);
   for(const previous of payload.completed_sections.filter(step=>step.step_type==='api'))assert.equal(previous.execution_status,'not_executed');
   if(request.step.id==='save'&&!calls.some(call=>call.name==='browser_click'))return {tool:{name:'browser_click',arguments:{ref:'save-native'}}};
   return {done:true};
  }
  if(request.phase==='upstream_source')return {automation_code:request.step.id==='save'?[goto,click,assertion].join('\n'):assertion};
  const payload=JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":')));
  return {schema:'hellotest.playwrightInstructionMapping.v1',steps:payload.steps.map(step=>({step_id:step.step_id,source_sha256:step.source_sha256,instructions:step.operations.map(op=>({operation_id:op.operation_id,kind:op.kind,depth:op.depth,label:'Native instruction',args:[]}))}))};
 };
 const normalizeApiBuild=(payload,[step])=>{
  normalized.push(step.id);
  if(failApi)throw Object.assign(new Error('The API endpoint lacks its documented response contract.'),{code:'API_CONTRACT_MISSING'});
  const request=validateGeneratedApiRequest(payload.steps[0].api_request,{expectedResult:step.expected_result});
  return {updates:[{step,step_type:'api',automation_code:null,api_request:request}]};
 };
 return {calls,models,saved,normalized,get closes(){return closes;},run:steps=>buildWithUpstreamPlaywright({steps,startUrl,browser,complete,normalizeApiBuild,apiPrompt:step=>`Native API contract for ${step.id}`,interactive:true,validate:inspectExecutablePlan,onSection:async(update,evidence)=>saved.push({update,evidence})})};
}

test('mixed sections preserve authored order while only web source uses native actions and display mapping',async()=>{
 const f=fixture(),steps=[api('before'),web('save'),api('after'),web('verify')].map((step,index)=>({...step,step_order:index+1}));
 const result=await f.run(steps);
 assert.deepEqual(f.saved.map(item=>item.update.step.id),['before','save','after','verify']);
 assert.deepEqual(result.updates.map(update=>update.step_type),['api','web','api','web']);
 assert.deepEqual(f.calls.map(call=>call.name),['browser_navigate','browser_click']);
 assert.deepEqual(f.normalized,['before','after']);
 assert.deepEqual(f.models.filter(model=>model.phase==='upstream_instruction_mapping').map(model=>model.step.id),['save','verify']);
 assert.equal(result.updates[1].automation_code,expressionProgram([goto,click,assertion].join('\n')));assert.equal(result.updates[3].automation_code,expressionProgram(assertion));
 for(const saved of f.saved.filter(item=>item.update.step_type==='api')){assert.equal(saved.update.automation_instructions,undefined);assert.equal(saved.evidence.execution_status,'not_executed');assert.equal(saved.evidence.transport,'llm_api_contract');}
 assert.equal(result.side_effects.browser_actions,1);assert.equal(f.closes,1);
});

test('an invalid API after a saved browser section retries only API synthesis and retains the completed native action',async()=>{
 const f=fixture({failApi:true});
 await assert.rejects(f.run([web('save'),api('invalid'),web('later')]),error=>error.code==='API_CONTRACT_MISSING'&&error.saved_sections===1&&error.active_step_id==='invalid');
 assert.deepEqual(f.calls.map(call=>call.name),['browser_navigate','browser_click']);
 assert.deepEqual(f.saved.map(item=>item.update.step.id),['save']);
 assert.deepEqual(f.normalized,['invalid','invalid','invalid']);
 assert.equal(f.models.some(model=>model.step.id==='later'),false);assert.equal(f.closes,1);
});
