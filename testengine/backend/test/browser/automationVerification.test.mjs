import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {createRequire} from 'node:module';
import {runAutomationVerification,registerAutomationVerification} from '../../dist/lib/automationVerification.js';
import {compileRecordedProgram} from '../../dist/lib/automationVerificationProgram.js';
const require=createRequire(import.meta.url),{runVerificationPipeline}=require('../../../../services/automation/backend/lib/automationVerificationPipeline.js');
const op=(name,args)=>({name,arguments:args});
const section=operations=>({step_id:'one',action:'Enter the full name',expected_result:'Full name is entered without errors',operations,automation_code:compileRecordedProgram(operations).source});
const request=(start_url,sections,parameters={})=>({schema_version:1,verification_id:randomUUID(),lease_token:randomUUID(),start_url,sections:sections.map(({action,expected_result,...row})=>row),parameters,replay_policy:{mode:'authorized_run',allow_mutations:true},timeout_ms:15000});
async function fixture(t,register=false){
 const before=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 const directory=await mkdtemp(path.join(tmpdir(),'qaira-verifier-'));const app=Fastify();let submissions=0;
 app.get('/form',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Name form</title><label>Full name<input id="name" required></label><label>Literal<input id="literal"></label><button id="review" onclick="document.getElementById(\'status\').textContent=\'Review ready\'">Review</button><button id="submit" onclick="fetch(\'/submit\',{method:\'POST\'})">Save</button><p id="status">Ready</p>'));
 app.post('/submit',async()=>{submissions++;return {ok:true};});if(register)await registerAutomationVerification(app,async()=>{},{artifactRoot:directory});const base=await app.listen({host:'127.0.0.1',port:0});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});if(before===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=before;});
 return {url:base+'/form',directory,app,submissions:()=>submissions};
}
test('fresh Chromium runs exact saved sections with fixed, empty and literal inputs', {timeout:60000},async t=>{
 const f=await fixture(t),rows=[section([op('browser_fill',{locator:'#name',value:'@r.name'}),op('browser_assert',{assertion:'value',locator:'#name',value:'@r.name'}),op('browser_assert',{assertion:'field_valid',locator:'#name'}),op('browser_fill',{locator:'#literal',value:'Contact @not_a_binding'}),op('browser_assert',{assertion:'value',locator:'#literal',value:'Contact @not_a_binding'})])];
 const result=await runAutomationVerification(request(f.url,rows,{'r.name':'Fixed name'}),{artifactRoot:f.directory});assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.completed_interactions,2);assert.equal(result.assertion_count,3);assert.equal(f.submissions(),0);
 const empty=[section([op('browser_fill',{locator:'#name',value:'@r.name'}),op('browser_assert',{assertion:'value',locator:'#name',value:'@r.name'})])];assert.equal((await runAutomationVerification(request(f.url,empty,{'r.name':''}),{artifactRoot:f.directory})).status,'passed');
});
test('real click lookup repair saves only after the unchanged independent business assertion passes', {timeout:60000},async t=>{
 const f=await fixture(t),rows=[{...section([op('browser_click',{locator:'#old-review'}),op('browser_assert',{assertion:'text',locator:'#status',value:'Review ready'})]),action:'Open the review',expected_result:'The review result reads Review ready'}];let calls=0,diagnoses=0,writes=0;
 const originalAssertion=JSON.stringify(rows[0].operations[1]);
 const result=await runVerificationPipeline({mode:'verify_repair',sections:rows,parameters:{'r.name':'One frozen value'},startUrl:f.url,run:async input=>{calls++;assert.equal(JSON.stringify(input.sections[0].operations[1]),originalAssertion);return runAutomationVerification(input,{artifactRoot:f.directory});},diagnose:async({snapshot,failure})=>{diagnoses++;assert.equal(failure.code,'AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED');const button=snapshot.elements.find(row=>row.attributes?.id==='review');assert.equal(button.locators_validated,true);assert.ok(button.locator_candidates.includes('#review'));return {step_id:'one',operation_index:1,locator:'#review'};},commitRepair:async({before,after})=>{assert.equal(calls,2);assert.equal(JSON.stringify(before[0].operations[1]),originalAssertion);assert.equal(JSON.stringify(after[0].operations[1]),originalAssertion);writes++;}});
 assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(diagnoses,1);assert.equal(writes,1);assert.equal(f.submissions(),0);
});
test('real unrelated-field repair cannot change a shared original value oracle or save its failing rerun', {timeout:60000},async t=>{
 const f=await fixture(t),rows=[section([op('browser_fill',{locator:'#old-name',value:'@r.name'}),op('browser_assert',{assertion:'value',locator:'#old-name',value:'@r.name'})])],original=JSON.stringify(rows),originalAssertion=JSON.stringify(rows[0].operations[1]);let calls=0,diagnoses=0,writes=0;
 const result=await runVerificationPipeline({mode:'verify_repair',sections:rows,parameters:{'r.name':'One frozen value'},startUrl:f.url,run:async input=>{
  calls++;assert.equal(input.parameters['r.name'],'One frozen value');assert.equal(JSON.stringify(input.sections[0].operations[1]),originalAssertion);
  if(calls===2)assert.equal(input.sections[0].operations[0].arguments.locator,'#literal');
  const receipt=await runAutomationVerification(input,{artifactRoot:f.directory});
  if(calls===2){assert.equal(receipt.status,'failed');assert.equal(receipt.completed_interactions,1);assert.equal(receipt.assertion_count,0);assert.equal(receipt.failure.operation_index,2);assert.equal(receipt.failure.operation_kind,'browser_assert');assert.equal(receipt.failure.code,'AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED');}
  return receipt;
 },diagnose:async({snapshot})=>{diagnoses++;assert.ok(snapshot.elements.find(row=>row.attributes?.id==='literal')?.locator_candidates.includes('#literal'));return{step_id:'one',operation_index:1,locator:'#literal'};},commitRepair:async()=>{writes++;}});
 assert.equal(result.status,'failed');assert.equal(calls,2);assert.equal(diagnoses,1);assert.equal(writes,0);assert.equal(JSON.stringify(rows),original);assert.equal(f.submissions(),0);
});
test('assertion failure after submission stops without another run or model repair', {timeout:60000},async t=>{
 const f=await fixture(t),rows=[section([op('browser_click',{locator:'#submit'}),op('browser_assert',{assertion:'text_content',locator:'#status',value:'Saved'})])];let calls=0;
 const result=await runVerificationPipeline({mode:'verify_repair',sections:rows,parameters:{},startUrl:f.url,run:async input=>{calls++;return runAutomationVerification(input,{artifactRoot:f.directory});},diagnose:()=>assert.fail('oracle repair'),commitRepair:()=>assert.fail('source changed')});assert.equal(calls,1);assert.notEqual(result.status,'passed');assert.equal(f.submissions(),1);
});
test('same immutable endpoint request returns a cached receipt without executing its submission twice', {timeout:60000},async t=>{
 const f=await fixture(t,true);
 const input=request(f.url,[section([op('browser_click',{locator:'#submit'}),op('browser_assert',{assertion:'visible',locator:'#status'})])]);const first=await f.app.inject({method:'POST',url:'/api/v1/automation/verify',payload:input});assert.equal(first.statusCode,200);assert.equal(first.json().status,'passed');
 const second=await f.app.inject({method:'POST',url:'/api/v1/automation/verify',payload:input});assert.deepEqual(second.json(),first.json());assert.equal(f.submissions(),1);
 const conflict=structuredClone(input);conflict.lease_token=randomUUID();assert.equal((await f.app.inject({method:'POST',url:'/api/v1/automation/verify',payload:conflict})).statusCode,409);
});
