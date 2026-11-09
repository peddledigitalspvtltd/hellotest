import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {captureAutomationBrowserSnapshot} from '../../dist/lib/automationMcp.js';
import {AutomationObservedSubjects} from '../../dist/lib/automationObservedSubjects.js';
import {resolveRepositoryLocator} from '../../dist/lib/repositoryLocator.js';

const privateValue='COOPERATIVE_COLLECTOR_PRIVATE_PASSWORD';
const background=()=>'<section id="background"><table id="employees"><tbody>'+Array.from({length:42},(_,row)=>
 `<tr data-row-id="employee-${row}"><td id="employee-name-${row}">Employee ${row}</td><td id="employee-controls-${row}">`
 +Array.from({length:24},(_,column)=>`<input id="employee-${row}-${column}" data-background-control aria-label="Employee ${row} detail ${column}">`).join('')+'</td></tr>'
).join('')+'</tbody></table>'+Array.from({length:2500},()=>'<div class="inert-layout"><span></span></div>').join('')+'</section>';
const activeForm=()=>`<form id="active-form" style="position:fixed;right:20px;top:20px;background:white;padding:12px"><h2 id="current-heading">Current employee</h2>
 <label for="joined-date">Joined Date</label><input id="joined-date" value="2026-11-07">
 <label for="location">Location</label><input id="location" readonly value="Head office">
 <label for="private-password">Private password</label><input id="private-password" type="password" value="${privateValue}">
 <button id="save-current" type="button">Save current employee</button></form>`;

async function installSlowBackground(page){
 await page.evaluate(()=>{
  window.collectorOriginalGeometry ||= Element.prototype.getBoundingClientRect;
  const original=window.collectorOriginalGeometry;
  window.slowGeometryCalls=0;
  Element.prototype.getBoundingClientRect=function(){
   if(this.hasAttribute('data-background-control')){
    window.slowGeometryCalls++;
    const until=performance.now()+6;
    while(performance.now()<until){} // Trusted fixture work, bounded per background control.
   }
   return original.call(this);
  };
  window.collectorHeartbeat=0;
  clearInterval(window.collectorHeartbeatTimer);
  window.collectorHeartbeatTimer=setInterval(()=>window.collectorHeartbeat++,10);
 });
}

async function responsive(page){
 const before=Date.now();
 const state=await page.evaluate(()=>({heartbeats:window.collectorHeartbeat,slowCalls:window.slowGeometryCalls}));
 assert.ok(Date.now()-before<=500,'a returned capture cannot leave its timed-out DOM inventory blocking browser reads');
 assert.ok(state.heartbeats>0);
 assert.ok(state.slowCalls<1008,'the cooperative collector must stop before scanning every slow background control');
 return state;
}

async function groundedCandidates(page,snapshot){
 for(const element of snapshot.elements){
  if(!element.locator_candidates?.length)continue;
  assert.equal(element.locators_validated,true);
  const first=resolveRepositoryLocator(page,element.locator_candidates[0]);
  assert.equal(await first.count(),1);
  const identity=await first.elementHandle();assert.ok(identity);
  try{
   if(element.attributes?.id)assert.equal(await first.evaluate((node,id)=>node.id===id,element.attributes.id),true);
   for(const candidate of element.locator_candidates){
    const locator=resolveRepositoryLocator(page,candidate);
    assert.equal(await locator.count(),1,candidate);
    assert.equal(await locator.evaluate((node,held)=>node===held,identity),true,candidate);
   }
  }finally{await identity.dispose();}
 }
}

test('cooperative DOM collection keeps a late focused native form grounded without zombie page work',{timeout:35_000},async t=>{
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:900}}),subjects=new AutomationObservedSubjects();
 t.after(()=>subjects.clear());
 await page.setContent('<!doctype html><title>Employee workspace</title><main>'+background()+activeForm()+'</main>');
 await page.locator('#joined-date').focus();await installSlowBackground(page);await subjects.beginSnapshot();
 const before=Date.now(),snapshot=await captureAutomationBrowserSnapshot(page,undefined,before+9000,subjects);
 assert.equal(snapshot.partial,true,JSON.stringify(snapshot.warnings));assert.equal(snapshot.truncated,true);
 assert.ok(snapshot.scanned_elements>0&&snapshot.scanned_elements<2000);
 for(const id of ['joined-date','location']){
  const element=snapshot.elements.find(row=>row.attributes?.id===id);assert.ok(element,id);
  assert.equal(element.tag,'input');assert.equal(element.locators_validated,true);assert.ok(element.locator_candidates.length,id);
  assert.equal(element.label_truncated,false);assert.equal(element.accessible_name_truncated,false);
 }
 assert.equal(snapshot.elements.find(row=>row.attributes?.id==='location').readonly,true);
 assert.doesNotMatch(JSON.stringify(snapshot),new RegExp(privateValue));
 await responsive(page);
 await groundedCandidates(page,snapshot);

 await t.test('an explicit native root cannot borrow the focused form outside that root',async()=>{
  await page.evaluate(()=>{window.slowGeometryCalls=0;});
  await subjects.beginSnapshot();
  const scoped=await captureAutomationBrowserSnapshot(page,'#background',Date.now()+8000,subjects);
  assert.equal(scoped.scope,'#background');assert.equal(scoped.partial,true);assert.equal(scoped.truncated,true);
  assert.ok(!scoped.elements.some(row=>['joined-date','location','private-password'].includes(row.attributes?.id)));
  assert.ok(!scoped.accessibility.includes('Current employee'));
  await responsive(page);
 });

 await t.test('hidden and inactive late native forms do not receive the active-form allowance',async()=>{
  await page.setContent('<!doctype html><title>Employee list</title><main>'+background()
   +'<form id="hidden-form" hidden><label>Hidden date<input id="hidden-date"></label></form>'
   +'<form id="inactive-form"><label>Inactive date<input id="inactive-date"></label></form></main>');
  await page.locator('#employee-0-0').focus();await installSlowBackground(page);await subjects.beginSnapshot();
  const snapshot=await captureAutomationBrowserSnapshot(page,undefined,Date.now()+8000,subjects);
  assert.equal(snapshot.partial,true);assert.equal(snapshot.truncated,true);
  assert.ok(!snapshot.elements.some(row=>['hidden-date','inactive-date'].includes(row.attributes?.id)));
  await responsive(page);
 });
});
