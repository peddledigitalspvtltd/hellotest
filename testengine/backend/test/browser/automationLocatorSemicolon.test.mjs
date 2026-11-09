import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';
import {compileRecordedProgram as engineCompile} from '../../dist/lib/automationVerificationProgram.js';
import {runAutomationVerification} from '../../dist/lib/automationVerification.js';
const require=createRequire(import.meta.url);
const {connectAutomationBrowser}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const {compileRecordedProgram,recordedLocatorSource}=require('../../../../services/automation/backend/lib/automationRecordedProgram.js');
const {projectModelSnapshot,resolveModelToolRequest}=require('../../../../services/automation/backend/lib/automationBrowserModelTargets.js');
const receipt=result=>JSON.parse(result.content.find(part=>part.type==='text').text);

test('real MCP scoped locator terminator survives observed alias, compilation and native Run while extra code never executes',{timeout:60000},async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const directory=await mkdtemp(path.join(tmpdir(),'qaira-locator-semicolon-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const app=Fastify();app.get('/page',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Locator fixture</title><span data-value="a;b" class="escaped;">Log Out</span>'));
 await registerAutomationMcp(app,async()=>{});const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:base+'/page',allowBrowserActions:false});t.after(()=>browser.close());
 assert.equal((await browser.call('browser_navigate',{url:base+'/page'})).isError,undefined);
 const expression='page.getByText("Log Out", {exact:true});';
 const scoped=await browser.call('browser_snapshot',{locator:expression});assert.equal(scoped.isError,undefined,JSON.stringify(receipt(scoped)));
 const page=receipt(scoped);assert.equal(page.elements.length,1);assert.ok(page.elements[0].locator_candidates.length);
 const observation={tool:'browser_snapshot',result:scoped},target=projectModelSnapshot(observation).targets[0];
 const request=resolveModelToolRequest({name:'browser_assert',arguments:{assertion:'visible',locator:target.ref}},observation);
 const checked=await browser.call(request.name,request.arguments);assert.equal(checked.isError,undefined);assert.equal(receipt(checked).assertion_outcome,'satisfied');
 const operations=[{name:'browser_navigate',arguments:{url:base+'/page'}},request],compiled=compileRecordedProgram(operations);
 assert.equal(compiled.source,engineCompile(operations).source);assert.equal(recordedLocatorSource(expression),'page.getByText("Log Out", {"exact":true})');
 for(const locator of ['getByText("Log Out");;','getByText("Log Out"); globalThis.sideEffect=true;',
  'getByText("Log Out").click();','getByText(variable);','page.locator("getByText(\\"Log Out\\")");']){
  const invalid=await browser.call('browser_snapshot',{locator});assert.equal(invalid.isError,true,locator);
 }
 for(const locator of ['[data-value="a;b"]','.escaped\\;','page.locator("[data-value=\\"a;b\\"]");']){
  const literal=await browser.call('browser_snapshot',{locator});assert.equal(literal.isError,undefined,locator);assert.equal(receipt(literal).elements.length,1);
 }
 await browser.close();
 const verified=await runAutomationVerification({schema_version:1,verification_id:randomUUID(),lease_token:randomUUID(),start_url:base+'/page',parameters:{},
  sections:[{step_id:'scoped',automation_code:compiled.source,operations}],replay_policy:{mode:'authorized_run',allow_mutations:false},timeout_ms:10000},{artifactRoot:directory});
 assert.equal(verified.status,'passed',JSON.stringify(verified));assert.equal(verified.assertion_count,1);assert.equal(verified.completed_operations,2);assert.equal(verified.completed_interactions,0);
});
