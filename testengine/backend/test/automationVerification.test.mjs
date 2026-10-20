import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import Fastify from 'fastify';
import {parse} from 'acorn';
import {compileRecordedProgram as compile} from '../dist/lib/automationVerificationProgram.js';
import {validateAutomationVerificationRequest,registerAutomationVerification} from '../dist/lib/automationVerification.js';
const require=createRequire(import.meta.url),{compileRecordedProgram:hostCompile}=require('../../../services/automation/backend/lib/automationRecordedProgram.js');
const op=(name,args)=>({name,arguments:args});
const operations=[op('browser_fill',{locator:'#name',value:'@r.name'}),op('browser_assert',{assertion:'field_valid',locator:'#name'}),op('browser_assert',{assertion:'value',locator:'#name',value:'@r.name'})];
const input=()=>({schema_version:1,verification_id:randomUUID(),lease_token:randomUUID(),start_url:'https://fixture.test/form',parameters:{'r.name':''},sections:[{step_id:'one',automation_code:compile(operations).source,operations}],replay_policy:{mode:'authorized_run',allow_mutations:true}});

test('engine and host compile the identical closed program, including validation predicates and parameter binding',()=>{
 const cases=[operations,[op('browser_navigate',{url:'https://fixture.test/form'}),op('browser_assert',{assertion:'title_normalized',value:'Form'})],...['visible','hidden','enabled','disabled','checked','unchecked','valid','invalid','field_valid','editable'].map(assertion=>[op('browser_assert',{assertion,locator:'getByLabel("Name")'})]),...['value','text_content','text_content_contains','text','text_contains','count'].map(assertion=>[op('browser_assert',{assertion,locator:'#result',value:assertion==='count'?'0':'@r.name'})])];
 const syntax=value=>Array.isArray(value)?value.map(syntax):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['start','end','raw'].includes(key)).map(([key,item])=>[key,syntax(item)])):value;
 for(const rows of cases){const a=compile(rows),b=hostCompile(rows);assert.equal(Boolean(a),Boolean(b));if(a)assert.deepEqual(syntax(parse(a.source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true})),syntax(parse(b.source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true})));}
});
test('shared readers and locators match the independently packaged compiler and both shipped source layouts verify exactly',()=>{
 const rows=['#name','#email'].flatMap(locator=>[op('browser_fill',{locator,value:'@r.name'}),op('browser_assert',{assertion:'value',locator,value:'@r.name'}),op('browser_assert',{assertion:'field_valid',locator})]);
 const syntax=value=>Array.isArray(value)?value.map(syntax):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['start','end','raw'].includes(key)).map(([key,item])=>[key,syntax(item)])):value;
 for(const layout of ['compact','inline']){
  const engine=compile(rows,{layout}),host=hostCompile(rows,{layout});
  assert.deepEqual(syntax(parse(engine.source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true})),syntax(parse(host.source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true})));
  const request=input();request.sections[0]={step_id:'one',automation_code:engine.source,operations:rows};
  assert.doesNotThrow(()=>validateAutomationVerificationRequest(request));
 }
 const compact=compile(rows).source;
 assert.equal(compact.split('function readFieldValidationState').length-1,1);
 for(const source of [compact.replace('return true;','return false;'),compact.replace('evaluate(readFieldValidity)','evaluate(()=>true)'),compact+'\nawait object1.click();']){
  const request=input();request.sections[0]={step_id:'one',automation_code:source,operations:rows};
  assert.throws(()=>validateAutomationVerificationRequest(request),{code:'AUTOMATION_VERIFICATION_CONTRACT_INVALID'});
 }
});
test('atomic contract validation accepts empty frozen data and sections without an initial navigate',()=>{
 const request=input(),result=validateAutomationVerificationRequest(request);assert.deepEqual(result,request);assert.notEqual(result,request);
 for(const mutate of [row=>row.sections[0].automation_code+=';process.exit()',row=>delete row.parameters['r.name'],row=>row.sections[0].operations[0].arguments.value='tampered',row=>row.replay_policy.mode='model_authorized',row=>row.start_url='file:///tmp/private',row=>row.parameters['r.name']=42]){
  const invalid=input();mutate(invalid);assert.throws(()=>validateAutomationVerificationRequest(invalid),{code:'AUTOMATION_VERIFICATION_CONTRACT_INVALID'});
 }
});
test('verification endpoint enforces host authentication and closed contract before launching',async t=>{
 let launches=0;const app=Fastify();await registerAutomationVerification(app,async(request,reply)=>{if(request.headers.authorization!=='host')return reply.code(401).send({code:'UNAUTHORIZED'});},{launchBrowser:async()=>{launches++;throw Error('unexpected launch');}});t.after(()=>app.close());
 assert.equal((await app.inject({method:'POST',url:'/api/v1/automation/verify',payload:input()})).statusCode,401);
 const invalid=input();invalid.sections[0].automation_code+=';process.exit()';assert.equal((await app.inject({method:'POST',url:'/api/v1/automation/verify',headers:{authorization:'host'},payload:invalid})).statusCode,400);assert.equal(launches,0);
});
