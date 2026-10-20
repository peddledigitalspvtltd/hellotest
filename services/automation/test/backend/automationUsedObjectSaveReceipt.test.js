const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');

function savedSectionFixture(sync){
 const source=readFileSync(join(__dirname,'../../backend/services/aiAutomationBuilder.service.js'),'utf8');
 const start=source.indexOf('onSaveSection:async(')+'onSaveSection:'.length;
 const end=source.indexOf('\n      onValidatedSection:',start);
 const callbackSource=source.slice(start,end).trim().replace(/,$/,'');
 const state={planWrites:0,source:null,syncCalls:0,events:[],browserCalls:0,modelCalls:0};
 const context={
  assertBuildContextAccess:async()=>{},
  applyBuild:async({build})=>{state.planWrites++;state.source=build.updates[0].automation_code;},
  buildIdentity:{},execution_guard:{},created_by:'user',progressiveState:{},savedSectionIds:new Set(),usedObjectManifests:new Map([[1,{artifact_id:'pending-manifest'}]]),
  testCase:{id:'case',project_id:'project',app_type_id:'app'},
  require:id=>{assert.equal(id,'./automationUsedObjects.service');return {sync:async()=>{state.syncCalls++;return sync();}};},
  progress:async event=>state.events.push(event)
 };
 const callback=new Function(...Object.keys(context),`let confirmedObjectsSaved=0;return (${callbackSource});`)(...Object.values(context));
 return {state,callback,saved:context.savedSectionIds};
}

test('a repository failure after the Plan commit retains saved status and never repeats browser/model work',async()=>{
 const {state,callback,saved}=savedSectionFixture(async()=>{throw new Error('repository is temporarily unavailable');});
 const receipt=await callback({step:{id:'step',step_order:2},attempt:1,normalized:{updates:[{step:{id:'step'},automation_code:'await page.locator("#email").fill("@r.email");'}]}});
 assert.equal(receipt.instruction_status,'saved');assert.equal(receipt.object_status,'pending');assert.equal(receipt.objects_saved,0);
 assert.equal(state.planWrites,1);assert.equal(state.syncCalls,1);assert.equal(saved.has('step'),true);
 assert.equal(state.source,'await page.locator("#email").fill("@r.email");');
 assert.equal(state.browserCalls,0);assert.equal(state.modelCalls,0);
 assert.ok(state.events.some(event=>event.phase==='automation.agent.objects.pending'));
 assert.ok(state.events.some(event=>event.phase==='automation.agent.section.saved'&&event.details.instruction_status==='saved'));
});

test('an unavailable optional repository permission retains the exact saved section and pending receipt',async()=>{
 const {state,callback}=savedSectionFixture(async()=>({status:'pending',object_count:1,error_code:'AUTOMATION_OBJECT_SYNC_PERMISSION_REQUIRED'}));
 const receipt=await callback({step:{id:'step',step_order:1},attempt:1,normalized:{updates:[{step:{id:'step'},automation_code:'await expect(page.locator("#result")).toBeVisible();'}]}});
 assert.equal(receipt.instruction_status,'saved');assert.equal(receipt.object_status,'pending');assert.equal(state.planWrites,1);
 assert.equal(state.events.find(event=>event.phase==='automation.agent.objects.saved').level,'warning');
});
