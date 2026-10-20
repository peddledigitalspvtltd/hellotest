import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {assertTypeScriptExportCompiles} from './playwrightExportFixture.mjs';
import {registerAutomationMcp} from '../../../../testengine/backend/dist/lib/automationMcp.js';
import {createPrivilegedRunGuard,resolveTestEngineSharedSecret} from '../../../../testengine/backend/dist/lib/testEngineSecurity.js';

const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const localRequire=createRequire(import.meta.url);
const Fastify=require('fastify');
const {connectAutomationBrowser,runAutomationBrowserAgent}=localRequire('../../backend/lib/automationBrowserAgent.js');
const {createAutomationActorContext}=localRequire('../../backend/lib/automationActorContext.js');
const {buildAutomationGoalObligations}=localRequire('../../backend/lib/automationGoalObligations.js');
const {createBrowserParameterResolver}=localRequire('../../backend/lib/automationBrowserParameters.js');

test('real MCP work becomes a backend-issued Playwright Test spec that replays in a fresh runner with private inputs, repository aliases and API captures',{timeout:90000},async t=>{
 const prior=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
 process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(prior===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=prior;});
 const app=Fastify();let submissions=0,savedEmail='';
 app.get('/entry',async(_request,reply)=>reply.type('text/html').send(`<!doctype html><title>Portable account</title>
  <label>Email<input id="email"></label><label>Password<input type="password" id="password"></label><button id="save">Save account</button><p id="status" role="status"></p>
  <script>document.querySelector('#save').onclick=async()=>{const email=document.querySelector('#email').value;const response=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:document.querySelector('#password').value})});if(response.ok)document.querySelector('#status').textContent=email;};</script>`));
 app.post('/save',async(request,reply)=>{assert.equal(request.body.password,'private-fixture-pass');submissions++;savedEmail=request.body.email;return reply.send({saved:true});});
 app.get('/recorded',async(request,reply)=>{assert.equal(request.headers.authorization,'Bearer fixture-api-key');return reply.send({email:savedEmail});});
 await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
 const origin=await app.listen({host:'127.0.0.1',port:0});
 t.after(()=>app.close());
 const session=await connectAutomationBrowser({integration:{base_url:origin},startUrl:`${origin}/entry`,allowBrowserActions:true});
 t.after(()=>session.close());
 const params=createBrowserParameterResolver({caseValues:{'t.email':'portable@example.test','t.password':'private-fixture-pass'}});
 const operations=[
  {name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}},
  {name:'browser_fill',arguments:{locator:'#password',value:'@t.password'}},
  {name:'browser_click',arguments:{locator:'getByRole("button",{name:"Save account"})'}},
  {name:'browser_assert',arguments:{assertion:'text',locator:'#status',value:'@t.email'}}
 ];
 const section={id:'save',step_order:1,step_type:'web',action:'Enter the supplied email and password and save the account',expected_result:'The status shows the supplied email'};
 const manualCases=[{id:'manual',title:'Save account',steps:[{...section,id:'manual-save'}]}];
 const obligations=buildAutomationGoalObligations({section,manualCases,activeManualStepIds:['manual-save']});
 const taskContext=createAutomationActorContext({task:{start_url:`${origin}/entry`,case:{id:'portable-account',title:'Portable account'},current_section:section,build_context:{parameter_data:{values:params.promptValues},linked_manual_cases:manualCases,generation_scope:{mode:'sequential',active_step_id:'save',active_manual_step_ids:['manual-save']}}},obligations,projectText:params.projectText});
 const callBrowser=session.call;
 session.projectPromptText=params.projectText;
 session.call=async(name,args)=>params.redactResult(await callBrowser(name,params.resolve(name,args)));
 let actors=0,reviews=0,saves=0;
 const generated=await runAutomationBrowserAgent({browser:session,startUrl:`${origin}/entry`,prompt:taskContext.prompt,taskContext,actorMode:true,generationMode:'sequential',parse:JSON.parse,
  execution:{required:true,step_id:section.id,action:section.action,expected_result:section.expected_result,semantic_review_required:true,obligations},
  onPartialBuild:async()=>{assert.equal(reviews,1,'semantic review precedes the saved-source receipt');saves++;return {generation_complete:true};},
  complete:async prompt=>{
   if(prompt.includes('"phase":"semantic_review"')){
    const packet=JSON.parse(prompt.split('\n').at(-1));reviews++;assert.equal(packet.obligations.length,2);
    return JSON.stringify({decision:'accept',obligations:packet.obligations.map(goal=>({id:goal.id,action_operations:packet.confirmed_operations.filter(item=>item.name!=='browser_assert').map(item=>item.index),assertion_operations:packet.confirmed_operations.filter(item=>item.name==='browser_assert').map(item=>item.index)})),issues:[]});
   }
   actors++;
   if(actors===1)return JSON.stringify({actor_context_request:{parameter_names:['t.email']},stage:'act',step_id:'save',tool_calls:[operations[2]]});
   if(actors===2){assert.equal(submissions,0,'a context selection cannot execute the accompanying submission');assert.equal(taskContext.additionalContext().length,1);return JSON.stringify({stage:'act',step_id:'save',section_complete:true,tool_calls:operations});}
   const current=JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
   return JSON.stringify({stage:'act',step_id:'save',section_complete:true,tool_calls:current.recorded_section.completion_available?[]:[operations.at(-1)]});
  }});
 assert.equal(submissions,1);
 assert.equal(saves,1);assert.equal(reviews,1);
 const compiled={source:generated.steps[0].automation_code};assert.ok(compiled.source);
 await session.close();

 // Invoke the actual builder's artifact boundary without loading its database
 // services. It delegates to the same shared emitter used by UI downloads.
 const builderFile=localRequire.resolve('../../backend/services/aiAutomationBuilder.service.js');
 const builderSource=await readFile(builderFile,'utf8');
 const declaration=builderSource.match(/^const createArtifactContent = .+;$/m)?.[0];assert.ok(declaration);
 const createArtifactContent=new Function('require',`${declaration}\nreturn createArtifactContent;`)(createRequire(builderFile));
 const source=await createArtifactContent({testCase:{id:'portable-account',title:'Portable account from real MCP',automation_start_url:`${origin}/entry`},
  values:{...params.publicParameterValues,'t.other':'different@example.test','t.password':'private-fixture-pass'},sensitiveNames:params.privateParameterNames,
  repositoryRows:[{id:'status',page_key:'Account',locator_intent:'Status',locator:'#status',metadata:{screen_name:'Account',object_name:'Status',reference_aliases:['Profile.Status']}}],updates:[
   {step:{id:'save',step_order:1,step_type:'web',action:'Enter account data and save'},automation_code:compiled.source},
   {step:{id:'api',step_order:2,step_type:'api',action:'Verify the persisted account'},api_request:{method:'GET',url:'/recorded',auth:{type:'bearer',credential_reference:'FIXTURE_API_TOKEN'},validations:[{kind:'status',expected:'200'},{kind:'json_path',target:'$.email',expected:'@t.email'}],captures:[{path:'$.email',parameter:'@r.saved_email'}]}},
   {step:{id:'capture',step_order:3,step_type:'web',action:'Compare the saved result'},automation_code:'await expect(page.locator("Profile.Status")).toHaveText("@r.saved_email"); await expect(page.locator("Profile.Status")).not.toHaveText("@t.other"); await expect.soft(page.locator("#email")).toHaveValue("@t.email"); await expect.poll(() => page.locator("#email").inputValue()).toBe("@t.email");'}
  ]});
 assert.doesNotMatch(source,/private-fixture-pass|Bearer fixture-api-key/);assert.match(source,/QAIRA_DATA_JSON/);assert.match(source,/import \{ test, expect as playwrightExpect/);
 const directory=await mkdtemp(path.join(tmpdir(),'qaira-backend-portable-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const spec=path.join(directory,'automation.spec.ts');
 await writeFile(spec,source);assertTypeScriptExportCompiles([spec]);
 const playwrightRoot=path.dirname(require.resolve('playwright/package.json'));
 await writeFile(spec,source.replace("'@playwright/test'",JSON.stringify(path.join(playwrightRoot,'test.mjs'))).replace("'jsonpath-plus'",JSON.stringify(require.resolve('jsonpath-plus'))));
 const executablePath=process.env.CHROME_EXECUTABLE||require('playwright').chromium.executablePath();
 const config=path.join(directory,'playwright.config.cjs');
 await writeFile(config,'module.exports='+JSON.stringify({testDir:directory,testMatch:'*.spec.ts',outputDir:path.join(directory,'results'),workers:1,reporter:'json',use:{headless:true,launchOptions:{executablePath}}}));
 const result=await new Promise((resolve,reject)=>{let stdout='',stderr='';const child=spawn(process.execPath,[path.join(playwrightRoot,'cli.js'),'test','--config',config],{env:{...process.env,QAIRA_DATA_JSON:JSON.stringify({'t.password':'private-fixture-pass'}),FIXTURE_API_TOKEN:'fixture-api-key'}});child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));});
 assert.equal(result.code,0,result.stdout+'\n'+result.stderr);
 const report=JSON.parse(result.stdout);assert.equal(report.stats.expected,1);assert.equal(report.stats.unexpected,0);
 assert.equal(submissions,2,'development and the explicit fresh test each submit exactly once');
});
