// Production TestCasesPage with isolated API responses; no backend reads or writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);

const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '/src/auth/AuthContext';
import { LocalizationProvider } from '/src/context/LocalizationContext';
import { TestCasesPage } from '/src/pages/TestCasesPage';
import { IssuesPage } from '/src/pages/IssuesPage';
import { api, sessionStorage } from '/src/lib/api';
import { setCurrentScope } from '/src/hooks/useCurrentProject';
import '/src/styles.css';
import '/src/dark-theme.css';
import '/src/modal-system.css';
import '/src/workspace-layout.css';
import '/src/catalog-list.css';
import '/src/execution-run-builder.css';
const session={token:'test-case-catalog-browser',user:{id:'reviewer',name:'QA Reviewer',email:'reviewer@example.test',role:'admin'}};
sessionStorage.write(session);setCurrentScope('case-project','case-app');
localStorage.setItem('hellotest.default_catalog_view_mode','tile');
window.calls={all:[],catalog:[],metrics:[],headers:[],moduleChildren:[],authoring:[]};
window.pauseContinuation=false;window.pauseAuthoring=false;window.pausePicker=true;window.pickerCalls=[];window.created=[];window.assigned=[];window.failAssignment=true;
function stub(object,prefix=''){
 for(const [key,value] of Object.entries(object)){
  const path=prefix?prefix+'.'+key:key;
  if(typeof value==='function')object[key]=async(...args)=>{window.calls.all.push({path,args});return []};
  else if(value&&typeof value==='object')stub(value,path);
 }
}
stub(api);
api.auth.session=async()=>session;
api.settings.getLocalization=async()=>({strings:{}});
api.settings.getWorkspacePreferences=async()=>({preferences:{}});
const flags={flags:new Proxy({},{get:()=>true})};
api.featureFlags.snapshot=async()=>flags;
api.metadata.domain=async()=>({test_cases:{default_status:'active',default_automated:'no',statuses:[{value:'active',label:'Active'}]},jira:{sprints:[],versions:[]}});
api.projects.list=async()=>[{id:'case-project',name:'Catalog project'}];
api.appTypes.list=async()=>[{id:'case-app',project_id:'case-project',name:'Web application',type:'web'}];
const cases=Array.from({length:95},(_,index)=>{
 const n=index+1;
 return {id:'case-'+n,display_id:'TC-'+n,app_type_id:'case-app',title:n===60?'Distant boundary coverage':'Checkout coverage '+String(n).padStart(2,'0'),description:'Fixture case description '+n,
  suite_id:n===60?'scope-suite':null,suite_ids:n===60?['scope-suite']:[],requirement_id:n===60?'story-run':null,requirement_ids:n===60?['story-run']:[],module_ids:n>=60?['case-module']:[],defect_ids:[],labels:[],external_references:[],
  automated:'no',automation_status:'not_automated',authoring_mode:'structured',test_case_type:'functional',priority:3,status:'active',review_status:'not_requested',step_count:3,run_count:0,recent_results:[],detail_complete:false,summary_complete:true,
  created_at:'2026-09-15T10:00:00Z',updated_at:'2026-09-15T10:00:00Z'};
});
function matching(input){return cases.filter(item=>(!input.unassigned_module||!item.module_ids.length)&&(!input.module_id||item.module_ids.includes(input.module_id))&&(!input.status||item.status===input.status)&&(!input.search||[item.title,item.description,item.display_id].join(' ').toLowerCase().includes(input.search.toLowerCase())))}
function paginate(items,input){const offset=Number(input.cursor||0),page=items.slice(offset,offset+input.page_size),next=offset+page.length;return {items:page,next_cursor:next<items.length?String(next):null,is_last:next>=items.length}}
api.testCases.listPage=async(input)=>{
 if(input.projection==="picker"){
  window.pickerCalls.push(structuredClone(input));
  if(window.pausePicker)await new Promise(resolve=>{window.releasePicker=resolve});
  return paginate(matching(input).filter(item=>!input.ids||input.ids.split(",").includes(item.id)),input);
 }
 window.calls.catalog.push(structuredClone(input));
 if(input.cursor&&window.pauseContinuation)await new Promise(resolve=>{window.releaseContinuation=resolve});
 else await new Promise(resolve=>setTimeout(resolve,35));
 return paginate(matching(input),input);
};
const health=count=>({count,traceabilityPercent:0,executablePercent:100,automationPercent:0,summaryComplete:true,unknownSummaryCount:0,executionPercent:0,passRatePercent:null,latestPassRatePercent:null,stabilityPercent:null,averageExecutionMs:null,executionDurationSampleCount:0,pendingReviewCount:0,defectCount:0,defectDensity:0,riskCount:0});
api.testCases.metrics=async(input)=>{window.calls.metrics.push(structuredClone(input));return {coverage:{total:95,covered:1,automated:0,automationKnown:95,withHistory:0,withSuites:0},catalog:{total:95,automationPercent:0,blocked:0,failed:0,critical:0,averageExecutionMs:null,executionDurationSampleCount:0,finalizedResults:0,passedResults:0,recentPassRate:null},modules:{'case-module':health(35)},unassigned:health(60)}};
api.testCaseModules.list=async(input)=>{window.calls.headers.push(structuredClone(input));return [{id:'case-module',app_type_id:'case-app',name:'Payments module',test_case_count:35,test_case_ids:[],requirement_ids:[]}]};
api.testCaseModules.listCases=async(id,input)=>{window.calls.moduleChildren.push({id,...structuredClone(input)});return paginate(cases.filter(item=>item.module_ids.includes(id)),input)};
api.requirements.list=async(input)=>{window.calls.authoring.push({path:'requirements.list',input});if(window.pauseAuthoring)await new Promise(resolve=>{window.releaseAuthoring=resolve});return [{id:'story-run',project_id:'case-project',title:'Checkout Story',priority:3,status:'active',iteration_id:'sprint-run',sprint:'Sprint Alpha',fix_version:'Release Alpha',labels:[],gherkin_scenarios:[],test_case_ids:['case-60']}]};
api.requirementReleases.list=async(input)=>{window.calls.authoring.push({path:'requirementReleases.list',input});return [{id:'release-run',project_id:'case-project',name:'Release Alpha',fix_version:'Release Alpha',requirement_ids:['story-run'],sprint_ids:['sprint-run']}]};
api.requirementIterations.list=async(input)=>{window.calls.authoring.push({path:'requirementIterations.list',input});return [{id:'sprint-run',project_id:'case-project',name:'Sprint Alpha',requirement_ids:['story-run']}]};

api.testCases.listPicker=async input=>api.testCases.listPage({...input,projection:'picker'});
api.requirements.listPage=async()=>({items:[{id:'story-run',display_id:'STORY-1',project_id:'case-project',title:'Checkout Story',priority:3,status:'active'}],is_last:true,next_cursor:null});
api.testCases.resolveRequirementCases=async()=>[cases[59]];
api.testCaseModules.create=async input=>{window.created.push(input);return {id:'created-module'}};
api.testCaseModules.assignCases=async(id,ids)=>{window.assigned.push({id,ids});if(window.failAssignment){window.failAssignment=false;throw new Error('Assignment temporarily unavailable')}return {updated:true,assigned:ids.length}};
api.testSuites.list=async()=>[{id:'scope-suite',app_type_id:'case-app',name:'Related Suite',test_case_ids:['case-60']}];
api.issues.createMetadata=async()=>({fields:[],core_fields:[],required_fields:[],current_values:{},workflow_statuses:{statuses:['open'],default_status:'open'}});
api.issues.editMetadata=api.issues.createMetadata;
api.issues.get=async id=>({id,...window.created.at(-1),created_at:'2026-09-16T00:00:00Z'});
api.issues.create=async input=>{window.created.push(input);return {id:'created-bug'}};
window.previewInputs=[];api.issues.previewAiDraft=async input=>{window.previewInputs.push(input);await new Promise(resolve=>{window.releaseAiPreview=resolve});throw new Error('Fixture provider temporarily unavailable')};
api.issues.catalogPage=async()=>({items:[],is_last:true,next_cursor:null});
api.issues.metrics=async()=>({total:0,converted:0,statuses:{}});

const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
window.clearCasePickerQueries=()=>{client.removeQueries({queryKey:['test-case-picker']});client.removeQueries({queryKey:['test-case-picker-selected']})};
// AppShell resolves workspace features before opening a catalog route.
client.setQueryData(['feature-flags'],flags);
const router=createMemoryRouter([{path:'/test-cases',element:<TestCasesPage/>},{path:'/issues',element:<IssuesPage/>},{path:'/away',element:<h1>Away from Test Cases</h1>}],{initialEntries:['/test-cases']});
window.fixtureNavigate=to=>router.navigate(to);
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId="reviewer"><main style={{height:'100vh',overflowY:'auto',padding:24,boxSizing:'border-box'}}><RouterProvider router={router}/></main></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;

test('Module and Bug forms stay editable during picker loading and preserve remotely selected links', {timeout:90000}, async()=>{
 const name='create-picker-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);
 const artifacts=process.env.BROWSER_SCREENSHOT_DIR||'/tmp/qaira-create-pickers';let browser;
 try{
  await writeFile(html,`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx,fixture);await mkdir(artifacts,{recursive:true});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.stack));page.setDefaultTimeout(10000);
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5186'}/${name}.html`);
  await page.getByRole('button',{name:'Create Module',exact:true}).click();
  const module=page.getByRole('dialog',{name:'Create module',exact:true});
  await module.getByLabel('Module name').fill('Responsive module');
  await page.waitForFunction(()=>typeof window.releasePicker==='function');
  assert.equal(await module.getByLabel('Module name').inputValue(),'Responsive module');
  assert.equal(await module.getByRole('button',{name:'Create module',exact:true}).isEnabled(),true);
  assert.equal(await page.locator('.screen-loading-overlay').count(),0);
  assert.equal((await page.evaluate(()=>window.pickerCalls))[0].page_size,25);
  await page.screenshot({path:artifacts+'/module-form-loading-picker.png'});
  await page.evaluate(()=>{window.pausePicker=false;window.releasePicker()});
  const picker=module.locator('.test-case-picker');
  assert.equal(await picker.locator('.test-case-picker-filters, .test-case-picker-selection').count(),0,'filters and selections live in the unified selection panel');
  const headingLayout=await module.locator('.test-case-create-module-title').evaluate(node=>{
    const icon=node.querySelector('.test-case-create-module-title-icon').getBoundingClientRect();
    const title=node.querySelector('h2').getBoundingClientRect();
    return {inline:icon.right<=title.left,aligned:Math.abs((icon.top+icon.height/2)-(title.top+title.height/2))<1};
  });
  assert.deepEqual(headingLayout,{inline:true,aligned:true});
  await picker.locator('.test-case-picker-row').first().getByRole('checkbox').check();
  await module.getByRole('checkbox',{name:'Add STORY-1 to the new module',exact:true}).check();
  await picker.getByRole('button',{name:'Move Distant boundary coverage up',exact:true}).waitFor();
  await picker.getByRole('searchbox',{name:'Search test cases'}).fill('distant boundary');
  await page.waitForFunction(()=>document.querySelectorAll('.test-case-picker-row').length===1);
  await picker.getByRole('button',{name:'Move Distant boundary coverage up',exact:true}).click();
  assert.equal(await picker.getByRole('button',{name:'Move Distant boundary coverage up',exact:true}).isDisabled(),true,'reorder uses the whole retained selection across search');
  await module.getByRole('checkbox',{name:'Remove STORY-1 from the new module',exact:true}).uncheck();
  assert.match(await picker.locator('.test-case-picker-heading').innerText(),/1 selected/,'reordering an automatic selection does not convert it into a manual choice');
  await module.getByRole('checkbox',{name:'Add STORY-1 to the new module',exact:true}).check();
  assert.match(await picker.locator('.test-case-picker-heading').innerText(),/2 selected/);
  await picker.getByRole('searchbox',{name:'Search test cases'}).fill('');
  await page.waitForFunction(()=>document.querySelectorAll('.test-case-picker-row').length>1&&!document.querySelector('.test-case-picker-inline-header input').disabled);
  const selectVisible=picker.getByRole('checkbox',{name:'Select all visible Test Cases',exact:true});
  await selectVisible.check();
  await page.setViewportSize({width:1280,height:800});
  const moduleFrame=await module.boundingBox();
  const moduleMovement=module.evaluate(node=>new Promise(resolve=>{
    const samples=[],started=performance.now();
    const frame=()=>{
      const bounds=node.getBoundingClientRect(),header=node.querySelector('.test-case-create-module-header').getBoundingClientRect();
      samples.push({top:bounds.top,bottom:bounds.bottom,scroll:node.scrollTop,headerTop:header.top});
      if(performance.now()-started<800)requestAnimationFrame(frame);else resolve(samples);
    };frame();
  }));
  await picker.getByRole('button',{name:'Move Checkout coverage 20 down',exact:true}).click();
  for(const sample of await moduleMovement){
    assert.ok(Math.abs(sample.top-moduleFrame.y)<1,'Module frame stays fixed while navigating a lower reorder arrow');
    assert.equal(sample.scroll,0,'Module focus navigation never scrolls its fixed frame');
    assert.ok(sample.headerTop>=sample.top&&sample.bottom<=800,'Module title remains inside its visible dialog');
  }
  assert.equal(await picker.getByRole('button',{name:'Move Checkout coverage 20 down',exact:true}).evaluate(node=>node===document.activeElement),true,'Module reordering retains focus on the same case');
  await page.setViewportSize({width:1440,height:1000});
  await selectVisible.check();
  await selectVisible.uncheck();
  assert.match(await picker.locator('.test-case-picker-heading').innerText(),/0 selected/,'header uncheck removes every visible row including selected cases from another page');
  assert.equal(await picker.getByRole('button',{name:'Clear',exact:true}).isDisabled(),true);
  await picker.getByRole('searchbox',{name:'Search test cases'}).fill('distant boundary');
  await picker.getByRole('checkbox',{name:'Add TC-60 to the new module',exact:true}).check();
  await picker.getByRole('searchbox',{name:'Search test cases'}).fill('');
  await picker.getByRole('checkbox',{name:'Add TC-1 to the new module',exact:true}).check();
  await picker.getByRole('button',{name:'Open filters',exact:true}).click();
  const filters=page.getByRole('dialog',{name:'Filter Test Cases',exact:true});
  await filters.getByRole('combobox',{name:'Filter test cases by module',exact:true}).selectOption('case-module');
  await page.keyboard.press('Escape');
  assert.equal(await module.count(),1,'closing nested filters keeps Create module open');
  const inlineLayout=await picker.locator('.test-case-picker-toolbar').evaluate(node=>{
    const search=node.querySelector('input').getBoundingClientRect();
    return [...node.children].filter(child=>child.tagName==='BUTTON').every(child=>Math.abs(child.getBoundingClientRect().top-search.top)<15);
  });
  assert.equal(inlineLayout,true,'Select and Clear remain next to search');
  await page.screenshot({path:artifacts+'/module-unified-selection.png'});
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    await picker.getByRole('searchbox',{name:'Search test cases'}).scrollIntoViewIfNeeded();
    const bounds=await module.boundingBox();
    assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,'module dialog fits narrow viewports');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'module has no horizontal page overflow');
    await page.screenshot({path:artifacts+'/module-unified-selection-'+width+'.png'});
  }
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
  await page.screenshot({path:artifacts+'/module-unified-selection-320-dark.png'});
  await page.evaluate(()=>document.documentElement.removeAttribute('data-theme'));
  await page.setViewportSize({width:1440,height:1000});
  await module.getByRole('button',{name:'Create module',exact:true}).click();
  await page.waitForFunction(()=>window.assigned.length===1);
  await module.getByRole('button',{name:'Retry assignment',exact:true}).waitFor();
  assert.deepEqual((await page.evaluate(()=>window.assigned))[0].ids,['case-60','case-1']);
  await module.getByRole('button',{name:'Retry assignment',exact:true}).click();
  await page.waitForFunction(()=>window.assigned.length===2);
  assert.deepEqual((await page.evaluate(()=>window.assigned))[1].ids,['case-60','case-1'],'retry retains the exact selection order');
  assert.equal((await page.evaluate(()=>window.created)).length,1,'assignment retry never duplicates the module');
  assert.equal((await page.evaluate(()=>window.calls.all)).some(c=>c.path==='testCases.list'),false);

  await page.evaluate(()=>{window.pausePicker=true;window.releasePicker=undefined;window.fixtureNavigate('/issues?create=1')});
  const bug=page.getByRole('dialog',{name:'Report Bug',exact:true});
  await bug.getByLabel('Bug Title').fill('Search keeps related context');
  const bugPicker=bug.locator('.test-case-picker--impact');
  await bugPicker.locator('summary').waitFor();
  assert.equal(await bugPicker.getAttribute('open'),null,'Impacted cases begin compact, matching the other impact selectors');
  assert.equal(await page.evaluate(()=>typeof window.releasePicker),'undefined','Closed impact picker does not request the case catalog');
  const impactSummaryGeometry=await bug.locator('.issue-form-impact-grid .impact-select-summary').evaluateAll(nodes=>nodes.map(node=>({height:node.getBoundingClientRect().height,width:node.getBoundingClientRect().width})));
  assert.equal(impactSummaryGeometry.length,4);
  assert.ok(impactSummaryGeometry.every(rect=>Math.abs(rect.height-impactSummaryGeometry[0].height)<1&&Math.abs(rect.width-impactSummaryGeometry[0].width)<1),'Case selector matches the compact Suite, Module and Story controls');
  await bugPicker.locator('summary').click();
  await page.waitForFunction(()=>typeof window.releasePicker==='function');
  assert.equal(await bug.getByLabel('Bug Title').inputValue(),'Search keeps related context');
  assert.equal(await page.locator('.screen-loading-overlay').count(),0);
  await page.screenshot({path:artifacts+'/bug-form-loading-picker.png'});
  await page.evaluate(()=>{window.pausePicker=false;window.releasePicker()});
  await page.waitForFunction(()=>document.querySelectorAll('.test-case-picker--impact .impact-checkbox-option').length===25);
  assert.equal(await bugPicker.getByText('Filters',{exact:true}).count(),0);
  assert.equal(await bugPicker.locator('details').count(),0,'Impacted cases have no separate Filters or selected-case disclosures');
  await bugPicker.getByRole('button',{name:'Select all',exact:true}).click();
  assert.equal(await bugPicker.locator('.impact-checkbox-option.is-selected').count(),25);
  await bugPicker.getByRole('button',{name:'Clear',exact:true}).click();
  assert.equal(await bugPicker.locator('.impact-checkbox-option.is-selected').count(),0);
  await bugPicker.locator('.impact-checkbox-list').evaluate(node=>node.scrollTop=node.scrollHeight);
  await page.waitForFunction(()=>document.querySelectorAll('.test-case-picker--impact .impact-checkbox-option').length===50);
  await bugPicker.getByRole('checkbox',{name:'Checkout coverage 26 TC-26',exact:true}).check();
  const impactSearch=bugPicker.getByRole('searchbox',{name:'Search impacted test cases'});
  await impactSearch.fill('distant boundary');
  await bugPicker.getByRole('checkbox',{name:'Distant boundary coverage TC-60',exact:true}).check();
  assert.match(await bugPicker.locator('summary').innerText(),/2 selected/,'Server search retains the off-page impacted selection');
  await impactSearch.fill('');
  await bugPicker.getByRole('checkbox',{name:'Checkout coverage 26 TC-26',exact:true}).uncheck();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:width===390?844:1000});
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
      await bugPicker.locator('summary').scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Impact selector has no horizontal overflow');
      await page.screenshot({path:`${artifacts}/bug-impact-${width}-${theme}.png`});
    }
  }
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.documentElement.removeAttribute('data-theme'));
  await page.screenshot({path:artifacts+'/bug-linked-case-context.png'});
  await bug.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await page.waitForFunction(()=>window.created.length===2);
  const created=(await page.evaluate(()=>window.created))[1];
  assert.deepEqual(created.linked_test_case_ids,['case-60']);
  assert.deepEqual(created.linked_test_suite_ids,['scope-suite']);
  assert.deepEqual(created.linked_module_ids,['case-module']);
  assert.deepEqual(created.linked_requirement_ids,['story-run']);
  assert.equal((await page.evaluate(()=>window.calls.all)).some(c=>c.path==='testCases.list'),false);

  await page.evaluate(()=>window.fixtureNavigate('/away'));
  await page.getByRole('heading',{name:'Away from Test Cases',exact:true}).waitFor();
  await page.evaluate(()=>window.clearCasePickerQueries());
  const callsBeforeHydration=await page.evaluate(()=>window.pickerCalls.length);
  await page.evaluate(()=>window.fixtureNavigate('/issues?create=1&testCase=case-80'));
  await bug.waitFor();
  const hydratedPicker=bug.locator('.test-case-picker--impact');
  await page.waitForFunction(()=>window.pickerCalls.some(input=>input.ids==='case-80'));
  assert.equal((await page.evaluate(start=>window.pickerCalls.slice(start),callsBeforeHydration)).every(input=>input.ids==='case-80'),true,'A closed prefilled picker hydrates exact IDs without loading surrounding cases');
  await hydratedPicker.locator('summary').click();
  await hydratedPicker.getByRole('checkbox',{name:'Checkout coverage 80 TC-80',exact:true}).waitFor();
  assert.equal(await hydratedPicker.getByRole('checkbox',{name:'Checkout coverage 80 TC-80',exact:true}).isChecked(),true);

  await page.evaluate(()=>window.fixtureNavigate('/away'));
  await page.getByRole('heading',{name:'Away from Test Cases',exact:true}).waitFor();
  await page.evaluate(()=>window.fixtureNavigate('/issues?ai=1&title=Investigate%20checkout%20failure'));
  await page.getByRole('button',{name:/Review evidence setup/}).click();
  const evidence=page.getByRole('dialog',{name:'Evidence and impacted scope',exact:true});await evidence.waitFor();
  const aiPicker=evidence.locator('.test-case-picker--impact');await aiPicker.locator('summary').click();
  assert.equal(await aiPicker.getByText('Filters',{exact:true}).count(),0);
  await aiPicker.getByRole('searchbox',{name:'Search impacted test cases'}).fill('distant boundary');
  await aiPicker.getByRole('checkbox',{name:'Distant boundary coverage TC-60',exact:true}).check();
  const aiStories=evidence.locator('.impact-select-dropdown').filter({has:page.locator('summary').filter({hasText:'Impacted Stories'})});
  assert.match(await aiStories.locator('summary').innerText(),/1 selected/,'AI evidence still automatically includes the selected case Story');
  await evidence.getByRole('button',{name:'Close Evidence and impacted scope',exact:true}).click();
  await page.getByRole('button',{name:'Generate draft',exact:true}).click();
  await page.waitForFunction(()=>window.previewInputs.length===1);
  assert.deepEqual(await page.evaluate(()=>window.previewInputs[0].linked_test_case_ids),['case-60']);
  assert.deepEqual(await page.evaluate(()=>window.previewInputs[0].linked_requirement_ids),['story-run']);
  await page.getByRole('button',{name:/Review evidence setup/}).click();
  await aiPicker.locator('summary').click();
  assert.equal(await aiPicker.getByRole('searchbox',{name:'Search impacted test cases'}).isDisabled(),true,'AI mutation disables impacted-case edits');
  await page.evaluate(()=>window.releaseAiPreview());
  await page.waitForFunction(()=>document.querySelector('.test-case-picker--impact input[type="search"]')?.disabled===false);
  assert.match(await aiPicker.locator('summary').innerText(),/1 selected/,'A failed AI request retains impacted selection');
  assert.equal((await page.evaluate(()=>window.pickerCalls)).every(input=>input.page_size===25&&input.projection==='picker'),true,'Impact catalogs and selected hydration remain bounded');
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)])}
});
