import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {compileRecordedProgram,recordedOptionNameParameter,recordedSelectionNameParameter} from '../../dist/lib/automationVerificationProgram.js';
import {runAutomationVerification,validateAutomationVerificationRequest} from '../../dist/lib/automationVerification.js';
import {runAutomationVerificationCli} from '../../dist/lib/automationVerificationCli.js';
import {createWebRunSession} from '../../dist/lib/webEngine.js';

const require=createRequire(import.meta.url);
const {compileRecordedProgram:compileSavedProgram}=require('../../../../services/automation/backend/lib/automationRecordedProgram.js');
const {prepareVerificationSections}=require('../../../../services/automation/backend/lib/automationVerificationSections.js');
const {createBrowserParameterResolver}=require('../../../../services/automation/backend/lib/automationBrowserParameters.js');
const {optionLocatorNameBinding,selectionLocatorNameBinding}=require('../../../../services/automation/backend/lib/automationOptionParameterBinding.js');
const op=(name,args)=>({name,arguments:args});
const option=reference=>`getByRole("option", ${JSON.stringify({name:reference,exact:true})})`;
const menuScope='.select-wrapper:has(select#eventTemplate) > ul.dropdown-content';
const menuOption=reference=>`locator(${JSON.stringify(menuScope)}).getByText(${JSON.stringify(reference)}, {"exact":true})`;
const request=(base,operations,parameters)=>({schema_version:1,verification_id:randomUUID(),lease_token:randomUUID(),start_url:base+'/shell',parameters,
 sections:[{step_id:'selection',automation_code:compileRecordedProgram(operations).source,operations}],replay_policy:{mode:'authorized_run',allow_mutations:true},timeout_ms:20_000});

test('only complete scoped names of exact unchained option queries gain frozen locator data',()=>{
 const accepted=[option('@r.location'),`page.getByRole('option', {exact:true,name:'@s.[Onboarding Template]'})`,option('@t.location')+';'];
 const rejected=[`getByRole('option',{name:'@r.location'})`,`getByRole('option',{name:'@r.location',exact:false})`,
  `getByRole('button',{name:'@r.location',exact:true})`,`getByRole('option',{name:'Region @r.location',exact:true})`,
  `getByRole('option',{name:'@location',exact:true})`,`getByRole('option',{name:params['r.location'],exact:true})`,
  `getByRole('option',{name:'@r.location',exact:true}).first()`,`getByRole('option',{name:'@r.location',exact:true}); doSomething()`,
  `getByRole('option',{name:'@r.location',exact:true,disabled:false})`,`[data-name="@r.location"]`];
 rejected.push('getByRole(`option`,{name:"@r.location",exact:true})','getByRole("option",{name:`@r.location`,exact:true})');
 for(const locator of accepted){const native=recordedOptionNameParameter(locator),host=optionLocatorNameBinding(locator);assert.ok(native,locator);assert.ok(host,locator);assert.equal(native.key,host.key);assert.equal(native.reference,host.reference);}
 for(const locator of rejected){assert.equal(recordedOptionNameParameter(locator),null,locator);assert.equal(optionLocatorNameBinding(locator),null,locator);}
 for(const locator of [menuOption('@r.template'),'page.'+menuOption('@s.[Onboarding Template]')+';']){
  const native=recordedSelectionNameParameter(locator),host=selectionLocatorNameBinding(locator);assert.ok(native);assert.ok(host);assert.equal(native.key,host.key);assert.equal(native.reference,host.reference);assert.equal(native.scope,host.scope);
 }
 for(const locator of [menuOption('Prefix @r.template'),menuOption('@r.template').replace('"exact":true','"exact":false'),
  `locator('body').getByText('@r.template',{exact:true})`,menuOption('@r.template').replace('select#eventTemplate','select#@r.selector'),menuOption('@r.template')+'.first()']){
  assert.equal(recordedSelectionNameParameter(locator),null,locator);assert.equal(selectionLocatorNameBinding(locator),null,locator);
 }
 const rows=[op('browser_click',{locator:option('@r.location')}),op('browser_assert',{assertion:'visible',locator:'#selected'})];
 const locatorOnly=prepareVerificationSections([{id:'selection',step_type:'web',automation_code:compileSavedProgram(rows).source}],{
  publicParameterValues:{'r.location':'Public location'},resolve:()=>assert.fail('An option-name binding is not an action value argument')
 });
 assert.deepEqual({...locatorOnly.parameters},{'r.location':'Public location'});assert.deepEqual(locatorOnly.sections[0].operations,rows);
 const menuRows=[op('browser_click',{locator:menuOption('@r.template')}),rows[1]],menuOnly=prepareVerificationSections([{id:'menu',step_type:'web',automation_code:compileSavedProgram(menuRows).source}],{publicParameterValues:{'r.template':'Public template'},resolve:()=>assert.fail('A scoped menu-name reference is not a value argument')});
 assert.deepEqual({...menuOnly.parameters},{'r.template':'Public template'});assert.deepEqual(menuOnly.sections[0].operations,menuRows);
 const inspected=prepareVerificationSections([{id:'selection',step_type:'web',automation_code:compileSavedProgram(rows).source}],{resolve:()=>assert.fail('Source-only contract inspection cannot read data')},{sourceOnly:true});
 assert.deepEqual({...inspected.parameters},{});assert.deepEqual(inspected.sections[0].operations,rows);
 const valid=request('https://fixture.test',rows,{'r.location':'Public location'});assert.doesNotThrow(()=>validateAutomationVerificationRequest(valid));
 const literalEmail=[op('browser_click',{locator:option('Person foo@r.com')}),rows[1]];
 assert.doesNotThrow(()=>validateAutomationVerificationRequest(request('https://fixture.test',literalEmail,{})),'An email inside a literal option name is not a parameter reference');
 for(const parameters of [{},{'r.location':''},{'r.location':'x'.repeat(2_001)}])assert.throws(()=>validateAutomationVerificationRequest({...valid,parameters}),{code:'AUTOMATION_VERIFICATION_CONTRACT_INVALID'});
 for(const locator of rejected.filter(value=>/@[tsr]\./.test(value))){
  const bad=[op('browser_click',{locator}),rows[1]],compiled=compileRecordedProgram(bad);if(!compiled)continue;
  assert.throws(()=>validateAutomationVerificationRequest(request('https://fixture.test',bad,{'r.location':'Public location'})),{code:'AUTOMATION_VERIFICATION_CONTRACT_INVALID'},locator);
 }
});

test('two exact public custom selections survive changed data, native verification, CLI and saved framed playback without source changes',{timeout:90_000},async t=>{
 const previousHosts=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS,previousRoot=process.env.ARTIFACT_ROOT;
 const directory=await mkdtemp(path.join(tmpdir(),'qaira-option-parameter-'));
 process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';process.env.ARTIFACT_ROOT=directory;
 const app=Fastify();let selected=0,wrong=0;
 const locations=['India & "West"','literal @r.other'],templates=['Onboarding - India','Template "Two" & More'];
 const escape=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
 app.get('/shell',async(_request,reply)=>reply.type('text/html').send(`<!doctype html><title>Scoped selection shell</title><div role="option" onclick="fetch('/wrong',{method:'POST'})">${escape(locations[0])}</div><iframe id="form" src="/form" style="width:800px;height:500px"></iframe><iframe id="sibling" src="/decoy" style="width:800px;height:500px"></iframe>`));
 app.get('/form',async(_request,reply)=>reply.type('text/html').send(`<!doctype html><title>Employee selectors</title>
  <button id="location-picker" onclick="document.querySelector('#locations').hidden=false">Location</button><input id="location" readonly>
  <div id="locations" role="listbox" hidden>${locations.map(name=>`<div role="option" onclick="choose(this,'location','locations')">${escape(name)}</div>`).join('')}</div>
  <button id="template-picker" onclick="document.querySelector('#templates').hidden=false">Onboarding template</button>
  <div class="select-wrapper"><select id="eventTemplate" hidden>${templates.map((name,index)=>`<option value="${index}">${escape(name)}</option>`).join('')}</select><input id="template" data-activates="templates" readonly>
  <ul id="templates" class="dropdown-content" hidden>${templates.map(name=>`<li><span onclick="choose(this,'template','templates')">${escape(name)}</span></li>`).join('')}</ul></div>
  <script>function choose(element,input,list){document.getElementById(input).value=element.textContent;document.getElementById(list).hidden=true;fetch('/selected',{method:'POST'})}</script>`));
 app.get('/decoy',async(_request,reply)=>reply.type('text/html').send(`<!doctype html><title>Wrong embedded form</title>${[...locations,...templates].map(name=>`<div role="option" onclick="fetch('/wrong',{method:'POST'})">${escape(name)}</div>`).join('')}`));
 app.post('/selected',async()=>{selected++;return {ok:true};});app.post('/wrong',async()=>{wrong++;return {ok:true};});
 const base=await app.listen({host:'127.0.0.1',port:0});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});if(previousHosts===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previousHosts;if(previousRoot===undefined)delete process.env.ARTIFACT_ROOT;else process.env.ARTIFACT_ROOT=previousRoot;});
 const frame=['#form'],rows=[op('browser_click',{frame,locator:'#location-picker'}),op('browser_click',{frame,locator:option('@r.location')}),op('browser_assert',{frame,assertion:'value',locator:'#location',value:'@r.location'}),
  op('browser_click',{frame,locator:'#template-picker'}),op('browser_click',{frame,locator:menuOption('@r.template')}),op('browser_assert',{frame,assertion:'value',locator:'#template',value:'@r.template'})];
 const source=compileSavedProgram(rows).source;assert.equal(compileRecordedProgram(rows).source,source,'Independent and saved canonical compilers keep the same symbolic names');
 assert.match(source,/@r\.location/);assert.match(source,/@r\.template/);assert.doesNotMatch(source,/India|Template \\"Two/);
 const savedStep={id:'selection',step_type:'web',action:'Select @r.location and choose @r.template',expected_result:'Both selected controls contain their exact referenced values',automation_code:source};
 for(const [version,location,template] of [[1,locations[0],templates[0]],[2,locations[1],templates[1]]]){
  const values={'r.location':location,'r.template':template,'r.other':'MUST NOT RESCAN INSERTED DATA'},resolver=createBrowserParameterResolver({caseValues:values,materialize:false});
  const prepared=prepareVerificationSections([savedStep],resolver);
  assert.deepEqual({...prepared.parameters},{'r.location':location,'r.template':template},'Whole option-name references join the frozen request even when they are not value arguments');
  assert.equal(prepared.sections[0].automation_code,source);assert.deepEqual(prepared.sections[0].operations,rows);
  const before=selected,verified=await runAutomationVerification(request(base,rows,prepared.parameters),{artifactRoot:directory});
  assert.equal(verified.status,'passed',JSON.stringify(verified));assert.equal(verified.completed_interactions,4);assert.equal(verified.assertion_count,2);assert.equal(selected-before,2);assert.equal(wrong,0);
  const session=createWebRunSession({engine_run_id:randomUUID(),browser:'chromium',headless:true,web_engine:{active:'playwright'},environment:{base_url:base+'/shell'},run_timeout_seconds:25,max_repair_attempts:2,parameters_frozen:true,case_parameters:values,
   artifact_policy:{video_mode:'off',trace_mode:'off',screenshot_on_success:false,screenshot_on_failure:false,capture_console:false,capture_network:false},steps:[]});
  try{await session.start();const before=selected,result=await session.runStep({...savedStep,order:version});assert.equal(result.status,'passed',result.note);assert.equal(result.recovery_attempted,false);assert.equal(selected-before,2);assert.equal(wrong,0);}finally{await session.stop();}
  if(version===2){
   const cliRoot=path.join(directory,'cli');await import('node:fs/promises').then(fs=>fs.mkdir(cliRoot));
   const before=selected,result=await runAutomationVerificationCli({...request(base,rows,prepared.parameters),execution_driver:'playwright_test_cli'},{artifactRoot:directory,temporaryRoot:cliRoot});
   assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.execution_driver,'playwright_test_cli');assert.equal(result.completed_interactions,4);assert.equal(result.assertion_count,2);assert.equal(selected-before,2);assert.equal(wrong,0);assert.deepEqual(await readdir(cliRoot),[],'CLI removes its private frozen request and source files');
  }
  assert.equal(savedStep.automation_code,source,'Edited input data never rewrites saved source');
 }
 const privateResolver=createBrowserParameterResolver({caseValues:{'r.location':locations[0],'r.template':templates[0]},privateParameterNames:['r.location'],materialize:false});
 assert.throws(()=>prepareVerificationSections([savedStep],privateResolver),{code:'AUTOMATION_VERIFICATION_DATA_MISSING'});
 const missingResolver=createBrowserParameterResolver({caseValues:{'r.template':templates[0]},materialize:false});
 assert.throws(()=>prepareVerificationSections([savedStep],missingResolver),{code:'AUTOMATION_VERIFICATION_DATA_MISSING'});
 assert.equal(wrong,0,'Parent and sibling options never receive a scoped selection');
});
