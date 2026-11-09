import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {captureAutomationBrowserSnapshot} from '../../dist/lib/automationMcp.js';
import {resolveRepositoryLocator} from '../../dist/lib/repositoryLocator.js';

const scope='.select-wrapper:has(select#eventTemplate) > ul.dropdown-content';
const label='Onboarding - India';
const candidate=`locator(${JSON.stringify(scope)}).getByText(${JSON.stringify(label)}, {exact:true})`;
const html=({trigger='menu-volatile',nativeLabel=label,duplicate=false,disabled=false,hidden=false}={})=>`<!doctype html><title>Native proxy fixture</title>
<div class="select-wrapper"><input readonly data-activates="${trigger}" value="-- Select --">
<ul id="menu-volatile" class="dropdown-content select-dropdown" style="${hidden?'display:none':''}"><li class="${disabled?'disabled':''}"><span>${label}</span></li></ul>
<select id="eventTemplate" style="display:none"><option value="old" selected>-- Select --</option><option value="india">${nativeLabel}</option>${duplicate?`<option>${nativeLabel}</option>`:''}</select></div>
<script>window.events=0;document.addEventListener('input',()=>window.events++);document.addEventListener('change',()=>window.events++);</script>`;

test('native linked-select capture grounds exact scoped text without inventing option roles or changing state',{timeout:30000},async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();await page.setContent(html());
 const captured=await captureAutomationBrowserSnapshot(page,scope,Date.now()+15000);
 const row=captured.elements.find(e=>e.tag==='span'&&e.text===label);
 assert.ok(row);assert.notEqual(row.accessible_role,'option');
 assert.deepEqual(row.selection_option,{kind:'native_select_proxy',menu_scope:scope,option_label:label});
 assert.equal(row.locators_validated,true);assert.ok(row.locator_candidates.includes(candidate));
 assert.equal(await resolveRepositoryLocator(page,candidate).count(),1);
 assert.equal(await resolveRepositoryLocator(page,candidate).isVisible(),true);
 assert.equal(await page.locator('#eventTemplate').inputValue(),'old');assert.equal(await page.evaluate(()=>window.events),0);
 assert.doesNotMatch(JSON.stringify(row.selection_option),/menu-volatile/);
});

test('proxy attestation rejects unlinked, mismatched, duplicate, disabled and hidden menu entries',{timeout:30000},async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 for(const options of [{trigger:'unrelated'},{nativeLabel:'Different label'},{duplicate:true},{disabled:true},{hidden:true}]){
  await page.setContent(html(options));const captured=await captureAutomationBrowserSnapshot(page,scope,Date.now()+10000);
  assert.equal(captured.elements.some(e=>e.selection_option),false,JSON.stringify(options));
  assert.equal(await page.evaluate(()=>window.events),0);
 }
});

test('scoped text repository support remains a closed exact linked-menu expression',()=>{
 const calls=[];const root={locator:s=>({getByText:(name,options)=>{calls.push({s,name,options});return {native:true};}})};
 assert.deepEqual(resolveRepositoryLocator(root,candidate),{native:true});
 assert.deepEqual(calls,[{s:scope,name:label,options:{exact:true}}]);
 for(const invalid of [
  'locator("body").getByText("x",{exact:true})',
  `locator(${JSON.stringify(scope)}).getByText("x",{exact:false})`,
  `locator(${JSON.stringify(scope)}).getByText(/x/,{exact:true})`,
  `locator(${JSON.stringify(scope)}).getByText("x",{exact:true}).first()`,
  `locator(${JSON.stringify(scope)}).getByText("x",{exact:true});page.click("#save")`
 ])assert.throws(()=>resolveRepositoryLocator(root,invalid));
 assert.equal(calls.length,1,'Unsupported chains never reach native locator resolution');
});
