import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';
import {createPrivilegedRunGuard,resolveTestEngineSharedSecret} from '../../dist/lib/testEngineSecurity.js';
import {assertTypeScriptExportCompiles} from '../../../../services/automation/test/browser/playwrightExportFixture.mjs';
const require=createRequire(import.meta.url);
const {connectAutomationBrowser,runAutomationBrowserAgent}=require('../../../../services/automation/backend/lib/automationBrowserAgent');
const {createBrowserParameterResolver,referenceKey}=require('../../../../services/automation/backend/lib/automationBrowserParameters');
const {createAutomationActorContext}=require('../../../../services/automation/backend/lib/automationActorContext');
const {buildAutomationGoalObligations,goalSourceObligations}=require('../../../../services/automation/backend/lib/automationGoalObligations');
const {normalizeGeneratedProgram}=require('../../../../services/automation/backend/lib/automationGeneratedProgram');
const {deriveProgramTools}=require('../../../../services/automation/backend/lib/automationProgramTools');
const {exactLinearCoverage}=require('../../../../services/automation/backend/lib/automationActionReconciliation');
const {resolveLinkedManualParameters}=require('../../../../services/platform/backend/src/utils/linkedManualParameters');
const {createPortableAutomationArtifact}=require('../../../../services/automation/backend/lib/automationPortableArtifact');
const legacyBindingSource='await page.getByTestId("binding-name").fill("@name"); await expect(page.getByTestId("binding-name")).toHaveValue("@t.name"); '
 +'expect(() => page.getByTestId("binding-name").fill("@r.name")).toThrow(/Missing parameter @r\\.name/); '
 +'await page.getByTestId("binding-name").fill("@r.empty"); await expect(page.getByTestId("binding-name")).toHaveValue(""); await expect(page.getByTestId("binding-name")).not.toHaveValue("@t.empty");';

async function replay(t,artifact){
 const directory=await mkdtemp(path.join(tmpdir(),'qaira-build-data-binding-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const spec=path.join(directory,'bindings.spec.ts');await writeFile(spec,artifact);assertTypeScriptExportCompiles([spec]);
 // Forward the installed runner package. The exported specification bytes are
 // never edited to accommodate the local dependency layout.
 const forwarding=path.join(directory,'node_modules/@playwright/test');await mkdir(forwarding,{recursive:true});
 await writeFile(path.join(forwarding,'package.json'),JSON.stringify({name:'@playwright/test',type:'module',exports:'./index.mjs'}));
 await writeFile(path.join(forwarding,'index.mjs'),`export * from ${JSON.stringify(pathToFileURL(fileURLToPath(new URL('../../node_modules/playwright/test.mjs',import.meta.url))).href)};`);
 const config=path.join(directory,'playwright.config.cjs');await writeFile(config,'module.exports='+JSON.stringify({testDir:directory,testMatch:'bindings.spec.ts',workers:1,retries:0,
  reporter:'json',outputDir:path.join(directory,'results'),use:{headless:true,launchOptions:process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}}}));
 const output=await new Promise((resolve,reject)=>{
  let stdout='',stderr='';const child=spawn(process.execPath,[fileURLToPath(new URL('../../node_modules/playwright/cli.js',import.meta.url)),'test','--config',config],
   {env:{...process.env,QAIRA_DATA_JSON:'{}',QAIRA_BASE_URL:''}});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM');});
  child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));
 });
 assert.equal(output.code,0,output.stdout+'\n'+output.stderr);const report=JSON.parse(output.stdout);assert.equal(report.stats.expected,1);assert.equal(report.stats.unexpected,0);
}

test('inherited manual aliases, explicit missing blanks and reviewed overrides share exact bindings across real MCP, compiled sections and fresh standalone replay',{timeout:150000},async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const app=Fastify(),entered=[];let submissions=0;
 app.get('/form',async(_request,reply)=>reply.type('text/html').send(`<!doctype html><title>Optional field</title><main><h1>Optional field</h1>
  <label>Display name<input id="name" data-testid="binding-name"></label></main><script>
  document.querySelector('#name').addEventListener('input',event=>fetch('/observed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value:event.target.value})}));
  document.addEventListener('submit',event=>{event.preventDefault();fetch('/submit',{method:'POST'});});</script>`));
 app.post('/observed',async request=>{entered.push(request.body.value);return {};});app.post('/submit',async()=>{submissions++;return {};});
 await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()),{launchBrowser:options=>chromium.launch(options)});
 const origin=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const testCase={id:'binding-case',title:'Reusable field data',automated:'yes',parameter_values:{'t.empty':'Case scope must not replace the run blank'},automation_start_url:`${origin}/form`};
 const sections=[
  {id:'inherited',step_order:1,step_type:'web',action:'Enter @name in Display name',expected_result:'Display name equals @name'},
  {id:'empty',step_order:2,step_type:'web',action:'Enter @r.empty in Display name',expected_result:'Display name equals @r.empty'},
  {id:'reviewed',step_order:3,step_type:'web',action:'Enter @t.reviewed in Display name',expected_result:'Display name equals @t.reviewed'}
 ];
 const source={id:'manual',manual_test_case_id:'manual',is_primary:true,parameter_values:{name:'Inherited Person'},
  title:'Manual field data',steps:sections.map(section=>({...section,id:'manual-'+section.id}))};
 const linked=resolveLinkedManualParameters(testCase,[source]);assert.deepEqual(linked.effective_parameter_values,{'t.name':'Inherited Person','t.empty':'Case scope must not replace the run blank'});
 const resolver=createBrowserParameterResolver({testCase,caseValues:linked.effective_parameter_values,steps:[...sections,...source.steps],
  configuration:{id:'selected-config',variables:[{key:'t.reviewed',value:'Configuration default'}]},
  dataSet:{id:'selected-data',mode:'table',columns:['t.reviewed'],rows:[{'t.reviewed':'Dataset default'}]},
  buildParameterValues:{'t.reviewed':'Reviewed Person'},defaultMissingInputs:true});
 assert.deepEqual(resolver.defaultedCaseValues,{'r.empty':''});assert.deepEqual(resolver.reviewedCaseValues,{'t.reviewed':'Reviewed Person'});
 assert.equal(resolver.projectText('@name'),'Inherited Person');assert.equal(resolver.projectText('@r.empty'),'');assert.equal(resolver.projectText('@t.reviewed'),'Reviewed Person');
 assert.deepEqual(resolver.canonicalArguments('browser_fill',{locator:'#name',value:'@name'}),{locator:'#name',value:'@t.name'});
 assert.ok(resolver.availableParameterNames.includes('r.empty'),'an intentionally empty binding is available');
 const session=await connectAutomationBrowser({integration:{base_url:origin},startUrl:`${origin}/form`,allowBrowserActions:true});t.after(()=>session.close());
 // The exact production projector/canonicalizer/resolver seams keep the
 // protected operation ledger reusable while MCP receives frozen values.
 session.projectPromptText=value=>referenceKey(value)?resolver.projectText(value):resolver.projectPrivateText(value);
 session.projectPrivateText=resolver.projectPrivateText;session.canonicalizeParameterArguments=resolver.canonicalArguments;
  const call=session.call,mcpInputs=[];
  session.call=async(name,args)=>{const resolved=resolver.resolve(name,args);if(name==='browser_fill'||name==='browser_assert')mcpInputs.push({name,original:{...args},resolved:{...resolved}});
  try{return resolver.redactResult(await call(name,resolved));}catch(error){
   if(['browser_navigate','browser_snapshot'].includes(name))t.diagnostic(JSON.stringify({tool:name,phase:'mcp_client_error',name:error.name,code:error.code,
    message:String(error.message||'').slice(0,1200),...(error.cause?{cause:{name:error.cause.name,code:error.cause.code,message:String(error.cause.message||'').slice(0,1200)}}:{})}));
   throw resolver.redactError(error);
  }};
 const projectedSections=resolver.projectSteps(sections),manualCases=resolver.projectManualCases([source]);
 const observations=[],updates=[];let actorCalls=0,reviewCalls=0,saves=0;
 for(let index=0;index<sections.length;index++){
  const section=projectedSections[index],activeManualStepIds=[source.steps[index].id];
  const obligations=buildAutomationGoalObligations({section,manualCases,activeManualStepIds});
  const sourceObligations=goalSourceObligations({section:sections[index],manualCases:[source],obligations});
  const execution={required:true,step_id:section.id,action:section.action,expected_result:section.expected_result,semantic_review_required:true,obligations,
   source_obligations:sourceObligations,navigation_parameter_references:resolver.referencedParameterNames(sourceObligations)};
  const taskContext=createAutomationActorContext({canonicalGoals:true,projectText:resolver.projectPrivateText,obligations,task:{start_url:`${origin}/form`,case:resolver.projectCase(testCase),current_section:section,
   build_context:{parameter_data:{values:resolver.promptValues},linked_manual_cases:manualCases,generation_scope:{mode:'sequential',active_step_id:section.id,active_manual_step_ids:activeManualStepIds}}}});
  const reference=['@name','@r.empty','@t.reviewed'][index],canonical=['@t.name','@r.empty','@t.reviewed'][index];let turn=0,sectionReviews=0;
  const result=await runAutomationBrowserAgent({browser:session,startUrl:index===0?`${origin}/form`:undefined,initialObservations:observations,execution,taskContext,prompt:taskContext.prompt,
   actorMode:true,generationMode:'sequential',parse:JSON.parse,maxTurns:3,maxCalls:8,onObservation:async observation=>{
    observations.push(observation);
    if(observation.result?.isError){
     let receipt={};try{receipt=JSON.parse(observation.result.content?.find(part=>part.type==='text')?.text||'{}');}catch{}
     t.diagnostic(JSON.stringify({tool:observation.tool,code:receipt.code,message:String(receipt.message||'').slice(0,1000),action_outcome:receipt.action_outcome}));
    }
   },
   onPartialBuild:async payload=>{
    saves++;assert.equal(sectionReviews,1);const source=payload.steps[0].automation_code;assert.equal(normalizeGeneratedProgram(source),source);
    const coverage=exactLinearCoverage({payload,execution,observations});assert.equal(coverage.supported,true);assert.equal(coverage.missing_action_count,0);assert.ok(!coverage.missing_source_action_count);
    const tools=deriveProgramTools({payload,execution});assert.deepEqual(tools.filter(tool=>tool.name==='browser_fill'||tool.name==='browser_assert').map(tool=>tool.arguments.value),[canonical,canonical]);
    updates.push({step:sections[index],automation_code:source});return{generation_complete:true};
   },complete:async prompt=>{
    if(prompt.includes('"phase":"semantic_review"')){
     reviewCalls++;sectionReviews++;const packet=JSON.parse(prompt.split('\n').at(-1));assert.equal(packet.obligations.length,2);
     const assertions=packet.confirmed_operations.filter(operation=>operation.name==='browser_assert');assert.equal(assertions.length,1);assert.equal(assertions[0].arguments.assertion,'value');
     return JSON.stringify({decision:'accept',obligations:packet.obligations.map(goal=>({id:goal.id,action_operations:packet.confirmed_operations.filter(operation=>operation.name!=='browser_assert').map(operation=>operation.index),assertion_operations:assertions.map(operation=>operation.index)})),issues:[]});
    }
    actorCalls++;turn++;const current=JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
    const target=current.current_snapshot.targets.find(target=>target.name==='Display name');assert.ok(target?.ref);
    return JSON.stringify({stage:'act',step_id:section.id,section_complete:turn===2,tool_calls:turn===1
     ?[{name:'browser_fill',arguments:{locator:target.ref,value:reference}}]
     :[{name:'browser_assert',arguments:{assertion:'value',locator:target.ref,value:reference}}]});
   }});
  assert.equal(result.steps[0].automation_code,updates[index].automation_code);assert.equal(turn,2);
 }
 assert.equal(saves,3);assert.equal(actorCalls,6);assert.equal(reviewCalls,3);
 assert.deepEqual(mcpInputs.filter(item=>item.name==='browser_fill').map(item=>item.original.value),['@t.name','@r.empty','@t.reviewed']);
 assert.deepEqual(mcpInputs.filter(item=>item.name==='browser_fill').map(item=>item.resolved.value),['Inherited Person','','Reviewed Person']);
 assert.deepEqual(mcpInputs.filter(item=>item.name==='browser_assert').map(item=>item.resolved.value),['Inherited Person','','Reviewed Person']);
 assert.deepEqual(entered,['Inherited Person','','Reviewed Person']);assert.equal(submissions,0);
 const data=resolver.buildData({testCaseId:testCase.id,steps:sections,manualCases:[source]});assert.deepEqual(data.missing_parameter_references,[]);assert.deepEqual(data.defaulted_parameter_references,['r.empty']);
 assert.equal(data.parameter_values['t.name'],'Inherited Person');assert.equal(data.parameter_values['r.empty'],'');assert.equal(data.parameter_values['t.reviewed'],'Reviewed Person');
 await session.close();
 assert.equal(Object.hasOwn(resolver.publicParameterValues,'r.name'),false);
 // Existing portable source may still contain the historical raw @name token.
 // Exercise that runtime path separately without changing any of the three
 // host-compiled sections. An explicit run blank must retain its scope even
 // when the corresponding case key contains a nonempty value.
 const artifact=await createPortableAutomationArtifact({testCase,updates:[...updates,{step:{id:'portable-legacy',step_order:4,step_type:'web',action:'Verify existing portable aliases and explicit run scope'},automation_code:legacyBindingSource}],values:resolver.publicParameterValues,sensitiveNames:resolver.privateParameterNames});
 assert.doesNotMatch(artifact,/Standalone export blocked:|Export limitation:/);await replay(t,artifact);
 assert.deepEqual(entered,['Inherited Person','','Reviewed Person','Inherited Person','','Reviewed Person','Inherited Person',''],
  'each compiled input executes once in development and once in fresh replay; the separate raw-legacy portable section then checks alias fallback and explicit scoped emptiness');assert.equal(submissions,0);
});

test('portable raw legacy bindings fall back to case data while explicit missing and empty run keys retain their own scope',{timeout:90000},async t=>{
 const app=Fastify(),entered=[];app.get('/form',async(_request,reply)=>reply.type('text/html').send(`<!doctype html><title>Portable binding compatibility</title>
  <label>Display name<input data-testid="binding-name"></label><script>
  document.querySelector('input').addEventListener('input',event=>fetch('/observed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value:event.target.value})}));</script>`));
 app.post('/observed',async request=>{entered.push(request.body.value);return {};});
 const origin=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const values={'t.name':'Inherited Person','r.empty':'','t.empty':'Case scope must not replace the run blank'};assert.equal(Object.hasOwn(values,'r.name'),false);
 const artifact=await createPortableAutomationArtifact({testCase:{id:'portable-legacy',title:'Raw legacy binding compatibility',automation_start_url:`${origin}/form`},values,
  updates:[{step:{id:'portable-source',step_order:1,step_type:'web',action:'Verify existing raw legacy source'},automation_code:legacyBindingSource}]});
 assert.doesNotMatch(artifact,/Standalone export blocked:|Export limitation:/);await replay(t,artifact);
 assert.deepEqual(entered,['Inherited Person',''],'missing explicit run binding rejects before dispatch; only legacy fallback and the known empty key fill the optional field');
});
