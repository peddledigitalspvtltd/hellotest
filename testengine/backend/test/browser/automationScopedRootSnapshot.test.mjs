import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Fastify from 'fastify';
import {chromium} from 'playwright';
import {captureAutomationBrowserSnapshot,assertAutomationBrowserCondition} from '../../dist/lib/automationMcp.js';
import {AutomationObservedSubjects} from '../../dist/lib/automationObservedSubjects.js';
const require=createRequire(import.meta.url);
const {projectModelSnapshot,resolveModelToolRequest,browserObservedTargetFeedback}=require('../../../../services/automation/backend/lib/automationBrowserModelTargets.js');
const {compileRecordedProgram}=require('../../../../services/automation/backend/lib/automationRecordedProgram.js');
const {deriveProgramTools}=require('../../../../services/automation/backend/lib/automationProgramTools.js');
const locator='getByText("Log Out", { exact: true })';
const observation=snapshot=>({tool:'browser_snapshot',result:{content:[{type:'text',text:JSON.stringify(snapshot)}]}});

test('an explicitly scoped plain root gains only normally grounded native target authority',{timeout:30000},async t=>{
 const app=Fastify();
 const shell='<header><span class="logout">Log Out</span></header><p>Workspace ready</p>';
 app.get('/plain',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Workspace</title>'+shell));
 app.get('/ambiguous',async(_req,reply)=>reply.type('text/html').send('<!doctype html>'+shell+'<span>Log Out</span>'));
 app.get('/shell',async(_req,reply)=>reply.type('text/html').send('<!doctype html>'+shell+'<iframe id="child" src="/plain"></iframe>'));
 const base=await app.listen({host:'127.0.0.1',port:0}),browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
 t.after(async()=>{await browser.close();await app.close();});const page=await browser.newPage();
 await t.test('plain span remains absent from full capture but its unique scoped snapshot creates a usable ref and compiled native assertion',async()=>{
  await page.goto(base+'/plain');const full=await captureAutomationBrowserSnapshot(page,undefined,Date.now()+5000);
  assert.equal(full.elements.some(row=>row.text==='Log Out'),false,'full-root selection rules remain unchanged');
  const subjects=new AutomationObservedSubjects();await subjects.beginSnapshot();
  const scoped=await captureAutomationBrowserSnapshot(page,locator,Date.now()+5000,subjects);
  assert.equal(scoped.partial,false);const root=scoped.elements.find(row=>row.text==='Log Out');assert.ok(root);
  assert.equal(root.evidence_kind,'page_content');assert.equal(root.locators_validated,true);assert.ok(root.locator_candidates.includes(locator));
  const host=observation(scoped),model=projectModelSnapshot(host),ref=model.targets.find(row=>row.text==='Log Out')?.ref;assert.ok(ref);
  const request=resolveModelToolRequest({name:'browser_assert',arguments:{assertion:'visible',locator:ref}},host);
  assert.equal(browserObservedTargetFeedback({request,snapshot:host,execution:{step_id:'logout'}}),null);
  assert.equal(await(await subjects.resolve(page,request.arguments.locator,Date.now()+1000)).isVisible(),true);
  const checked=await assertAutomationBrowserCondition(page,request.arguments,{deadline:Date.now()+1000,origin:base});assert.equal(checked.assertion_outcome,'satisfied');
  const source=compileRecordedProgram([request]).source;assert.match(source,/\.getByText\(/);assert.doesNotMatch(source,/locator\("getByText/);
  const lowered=deriveProgramTools({payload:{steps:[{step_id:'logout',automation_code:source}]},execution:{required:true,step_id:'logout'}});
  assert.equal(compileRecordedProgram(lowered).source,source);
  await subjects.clear();
 });
 await t.test('ambiguous explicit roots cannot acquire snapshot target authority',async()=>{
  await page.goto(base+'/ambiguous');await assert.rejects(captureAutomationBrowserSnapshot(page,locator,Date.now()+3000),/matches 2 elements/);
 });
 await t.test('replacing the observed scoped native node invalidates its prior subject authority',async()=>{
  await page.goto(base+'/plain');const subjects=new AutomationObservedSubjects();await subjects.beginSnapshot();
  const scoped=await captureAutomationBrowserSnapshot(page,locator,Date.now()+5000,subjects);assert.ok(scoped.elements[0].locator_candidates.length);
  await page.locator('.logout').evaluate(node=>node.replaceWith(node.cloneNode(true)));
  await assert.rejects(subjects.resolve(page,locator,Date.now()+1000),error=>error.code==='BROWSER_OBSERVED_SUBJECT_CHANGED');await subjects.clear();
 });
 await t.test('same-text replacement during grounding cannot inherit the held scope root or any aliases',async()=>{
  await page.goto(base+'/plain');const subjects=new AutomationObservedSubjects();await subjects.beginSnapshot();
  const originalLocator=page.locator.bind(page);let replaced=false;
  page.locator=(selector,...args)=>{const result=originalLocator(selector,...args),count=result.count.bind(result);
   if(selector.includes('span'))result.count=async()=>{if(!replaced){replaced=true;await page.evaluate(()=>{const node=document.querySelector('.logout');node.replaceWith(node.cloneNode(true));});}return count();};
   return result;};
  let scoped;try{scoped=await captureAutomationBrowserSnapshot(page,locator,Date.now()+5000,subjects);}finally{page.locator=originalLocator;}
  assert.equal(replaced,true);assert.equal(scoped.partial,true);assert.deepEqual(scoped.elements,[]);
  assert.match(scoped.warnings.join(' '),/native root changed/);
  assert.equal(projectModelSnapshot(observation(scoped)).targets.length,0);
  await assert.rejects(subjects.resolve(page,locator,Date.now()+1000),error=>error.code==='BROWSER_OBSERVED_SUBJECT_REQUIRED');await subjects.clear();
 });
 await t.test('framed plain root refs preserve exact frame scope and cannot authorize the matching parent node',async()=>{
  await page.goto(base+'/shell');const frame=page.frames().find(row=>row.url()===base+'/plain');assert.ok(frame);
  const subjects=new AutomationObservedSubjects();await subjects.beginSnapshot();
  const scoped=await captureAutomationBrowserSnapshot(page,locator,Date.now()+5000,subjects,frame);
  const host=observation({...scoped,frame_path:['#child'],frame_url:frame.url(),frame_document_id:'fixture-child-document'});
  const ref=projectModelSnapshot(host).targets.find(row=>row.text==='Log Out')?.ref;assert.ok(ref);
  const request=resolveModelToolRequest({name:'browser_assert',arguments:{assertion:'visible',locator:ref}},host);assert.deepEqual(request.arguments.frame,['#child']);
  const checked=await assertAutomationBrowserCondition(page,request.arguments,{deadline:Date.now()+1000,origin:base,root:frame});assert.equal(checked.assertion_outcome,'satisfied');
  assert.equal(await(await subjects.resolve(frame,request.arguments.locator,Date.now()+1000)).isVisible(),true);
  await assert.rejects(subjects.resolve(page,request.arguments.locator,Date.now()+1000),error=>error.code==='BROWSER_OBSERVED_SUBJECT_REQUIRED');
  const source=compileRecordedProgram([request]).source;assert.match(source,/frameLocator\("#child"\)/);
  const lowered=deriveProgramTools({payload:{steps:[{step_id:'logout',automation_code:source}]},execution:{required:true,step_id:'logout'}});
  assert.deepEqual(lowered[0].arguments.frame,['#child']);assert.equal(compileRecordedProgram(lowered).source,source);
  await subjects.clear();
 });
});
