import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import Fastify from 'fastify';
import {parse} from 'acorn';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';
import {runAutomationVerification} from '../../dist/lib/automationVerification.js';
import {runAutomationVerificationCli} from '../../dist/lib/automationVerificationCli.js';
import {compileRecordedProgram as engineCompile} from '../../dist/lib/automationVerificationProgram.js';
const require=createRequire(import.meta.url);
const {compileRecordedProgram}=require('../../../../services/automation/backend/lib/automationRecordedProgram.js');
const {deriveProgramTools}=require('../../../../services/automation/backend/lib/automationProgramTools.js');
const {connectAutomationBrowser}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const op=(name,args)=>({name,arguments:args});
const receipt=result=>JSON.parse(result.content.find(part=>part.type==='text').text);
const syntax=value=>Array.isArray(value)?value.map(syntax):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['start','end','raw'].includes(key)).map(([key,item])=>[key,syntax(item)])):value;
const sourceSyntax=source=>syntax(parse(source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true}));

test('observed nested-frame MCP operations round-trip unchanged through host source and real native/CLI verification', {timeout:90000},async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const directory=await mkdtemp(path.join(tmpdir(),'qaira-frames-program-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const app=Fastify();let intended=0,wrong=0;
 const form=which=>`<!doctype html><title>${which} form</title><label>Full name<input id="name" required></label><button onclick="fetch('/submit?frame=${which}',{method:'POST'}).then(()=>document.querySelector('#status').textContent='Saved')">Save</button><p id="status">Ready</p>`;
 app.get('/shell',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Top shell</title><label>Full name<input id="name"></label><iframe id="outer" src="/outer" style="width:600px;height:350px"></iframe><iframe id="sibling" src="/sibling" style="width:600px;height:350px"></iframe>'));
 app.get('/outer',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Outer shell</title><iframe id="inner" src="/inner" style="width:500px;height:300px"></iframe>'));
 app.get('/inner',async(_req,reply)=>reply.type('text/html').send(form('intended')));
 app.get('/sibling',async(_req,reply)=>reply.type('text/html').send(form('wrong')));
 app.post('/submit',async req=>{if(req.query.frame==='intended')intended++;else wrong++;return{ok:true};});
 await registerAutomationMcp(app,async()=>{});const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:base+'/shell',allowBrowserActions:true});t.after(()=>browser.close());
 const nav=op('browser_navigate',{url:base+'/shell'});assert.equal((await browser.call(nav.name,nav.arguments)).isError,undefined);
 const top=receipt(await browser.call('browser_snapshot',{})),frame=top.frames.find(row=>row.url===base+'/inner')?.path;
 assert.deepEqual(frame,['#outer','#inner']);assert.equal(top.url,base+'/shell');
 const scoped=receipt(await browser.call('browser_snapshot',{frame}));assert.deepEqual(scoped.frame_path,frame);assert.equal(scoped.frame_url,base+'/inner');assert.equal(scoped.url,base+'/shell');
 const rows=[op('browser_fill',{frame,locator:'getByLabel("Full name", {"exact":true})',value:'@r.name'}),
  op('browser_assert',{frame,assertion:'editable',locator:'#name'}),op('browser_assert',{frame,assertion:'input_type',locator:'#name',value:'text'}),
  op('browser_assert',{frame,assertion:'value',locator:'#name',value:'@r.name'}),op('browser_assert',{frame,assertion:'field_valid',locator:'#name'}),
  op('browser_click',{frame,locator:'getByRole("button", {"name":"Save","exact":true})'}),
  op('browser_assert',{frame,assertion:'text_content',locator:'#status',value:'Saved'}),
  op('browser_assert',{assertion:'url',value:base+'/shell'}),op('browser_assert',{assertion:'title_normalized',value:'Top shell'})];
 const value='Private literal @r.not_recursive " name';
 for(const row of rows){const args={...row.arguments,...(row.arguments.value==='@r.name'?{value}:{})};const result=await browser.call(row.name,args);assert.ok(!result.isError,JSON.stringify({name:row.name,assertion:args.assertion,result}));}
 assert.equal(intended,1);assert.equal(wrong,0);await browser.close();
 const operations=[nav,...rows],compiled=compileRecordedProgram(operations);assert.ok(compiled);assert.deepEqual(sourceSyntax(compiled.source),sourceSyntax(engineCompile(operations).source));assert.doesNotMatch(compiled.source,/Private literal/);
 const lowered=deriveProgramTools({payload:{steps:[{step_id:'framed',automation_code:compiled.source}]},execution:{required:true,step_id:'framed'}});
 assert.deepEqual(lowered,operations);
 const request=()=>({schema_version:1,verification_id:randomUUID(),lease_token:randomUUID(),start_url:base+'/shell',parameters:{'r.name':value},sections:[{step_id:'framed',automation_code:compiled.source,operations}],replay_policy:{mode:'authorized_run',allow_mutations:true},timeout_ms:15000});
 for(const [driver,run]of [['native',runAutomationVerification],['playwright_test_cli',runAutomationVerificationCli]]){
  const result=await run({...request(),execution_driver:driver},{artifactRoot:directory,temporaryRoot:directory});
  assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.verification_status,'verified');assert.equal(result.completed_interactions,2);assert.equal(result.assertion_count,7);
 }
 assert.equal(intended,3,'one reviewed submission in each independent session');assert.equal(wrong,0,'same-named page and sibling controls never receive a framed submission');
 const missing=[op('browser_click',{frame:['#missing'],locator:'getByRole("button",{"name":"Save","exact":true})'}),op('browser_assert',{assertion:'url',value:base+'/shell'})];
 const failed=await runAutomationVerification({...request(),sections:[{step_id:'framed',automation_code:compileRecordedProgram(missing).source,operations:missing}]},{artifactRoot:directory});
 assert.equal(failed.status,'failed');assert.equal(failed.completed_interactions,0);assert.equal(failed.failure.code,'AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED');assert.equal(intended,3);assert.equal(wrong,0);
});
