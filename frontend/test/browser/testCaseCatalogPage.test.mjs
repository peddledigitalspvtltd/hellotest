// Production TestCasesPage with isolated API responses; no backend reads or writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { assertHealthAtRibbonEnd } from './healthRibbonAssertions.mjs';
import { assertCountSegments } from './metricStatusBarAssertions.mjs';
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
import { ExecutionsPage } from '/src/pages/ExecutionsPage';
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
window.pauseContinuation=true;window.pauseAuthoring=true;window.suiteCreates=[];window.suiteAssignments=[];window.runCreates=[];
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
api.metadata.workspaceScopes=async()=>({projects:[{id:'case-project',name:'Catalog project',has_access:true}]});
api.appTypes.list=async()=>[{id:'case-app',project_id:'case-project',name:'Web application',type:'web'}];
const cases=Array.from({length:95},(_,index)=>{
 const n=index+1;
 return {id:'case-'+n,display_id:'TC-'+n,app_type_id:'case-app',title:n===60?'Distant boundary coverage':'Checkout coverage '+String(n).padStart(2,'0'),description:'Fixture case description '+n,
  suite_id:null,suite_ids:[],requirement_id:(n===1||n===60)?'story-run':null,requirement_ids:(n===1||n===60)?['story-run']:[],linked_requirements:n===1?[{id:'story-run',display_id:'STORY-123456',title:'A deliberately long Story title that must remain separate from the Story identity and truncate gracefully in narrow Test Case tiles'}]:[],module_ids:n>60?['case-module']:[],defect_ids:[],labels:[],external_references:[],
  automated:'no',automation_status:'not_automated',authoring_mode:'structured',test_case_type:'functional',priority:3,status:'active',review_status:'not_requested',step_count:3,run_count:0,recent_results:[],detail_complete:false,summary_complete:true,
  created_at:'2026-09-15T10:00:00Z',updated_at:'2026-09-15T10:00:00Z'};
});
function matching(input){return cases.filter(item=>(!input.ids||input.ids.split(',').includes(item.id))&&(!input.module_id||item.module_ids.includes(input.module_id))&&(!input.status||item.status===input.status)&&(!input.unassigned_module||!item.module_ids.length)&&(!input.search||[item.title,item.description,item.display_id].join(' ').toLowerCase().includes(input.search.toLowerCase())))}
function paginate(items,input){const offset=Number(input.cursor||0),page=items.slice(offset,offset+input.page_size),next=offset+page.length;return {items:page,next_cursor:next<items.length?String(next):null,is_last:next>=items.length}}
api.testCases.listPage=async(input)=>{
 window.calls.catalog.push(structuredClone(input));
 if(input.cursor&&window.pauseContinuation)await new Promise(resolve=>{window.releaseContinuation=resolve});
 else await new Promise(resolve=>setTimeout(resolve,35));
 return paginate(matching(input),input);
};
const health=count=>({count,traceabilityPercent:0,executablePercent:100,automationPercent:0,summaryComplete:true,unknownSummaryCount:0,executionPercent:0,passRatePercent:null,latestPassRatePercent:null,stabilityPercent:null,averageExecutionMs:null,executionDurationSampleCount:0,pendingReviewCount:0,defectCount:0,defectDensity:0,riskCount:0});
api.testCases.listPicker=async input=>api.testCases.listPage({...input,projection:"picker"});
api.testCases.metrics=async(input)=>{window.calls.metrics.push(structuredClone(input));return {coverage:{total:95,covered:2,automated:0,automationKnown:95,withHistory:0,withSuites:0},catalog:{total:95,automationPercent:0,blocked:0,failed:0,critical:0,averageExecutionMs:null,executionDurationSampleCount:0,finalizedResults:0,passedResults:0,recentPassRate:null},modules:{'case-module':health(35)},unassigned:health(60)}};
api.testCaseModules.list=async(input)=>{window.calls.headers.push(structuredClone(input));return [{id:'case-module',app_type_id:'case-app',name:'Payments module',test_case_count:35,test_case_ids:[],requirement_ids:[]}]};
api.testCaseModules.listCases=async(id,input)=>{window.calls.moduleChildren.push({id,...structuredClone(input)});return paginate(cases.filter(item=>item.module_ids.includes(id)),input)};
api.requirements.list=async(input)=>{window.calls.authoring.push({path:'requirements.list',input});if(window.pauseAuthoring)await new Promise(resolve=>{window.releaseAuthoring=resolve});return [{id:'story-run',project_id:'case-project',title:'Checkout Story',priority:3,status:'active',iteration_id:'sprint-run',sprint:'Sprint Alpha',fix_version:'Release Alpha',labels:[],gherkin_scenarios:[],test_case_ids:['case-60']}]};
api.requirementReleases.list=async(input)=>{window.calls.authoring.push({path:'requirementReleases.list',input});return [{id:'release-run',project_id:'case-project',name:'Release Alpha',fix_version:'Release Alpha',requirement_ids:['story-run'],sprint_ids:['sprint-run']}]};
api.requirementIterations.list=async(input)=>{window.calls.authoring.push({path:'requirementIterations.list',input});return [{id:'sprint-run',project_id:'case-project',name:'Sprint Alpha',requirement_ids:['story-run']}]};
api.testSuites.list=async()=>[{id:'scope-suite',project_id:'case-project',app_type_id:'case-app',name:'Related Suite',test_case_ids:['case-60'],test_case_count:1}];
api.testSuites.create=async input=>{window.suiteCreates.push(input);return{id:'created-suite'}};
api.testSuites.assignTestCases=async(id,ids)=>{window.suiteAssignments.push({id,ids});return{updated:true}};
api.executions.get=async id=>({id,name:'Created run',status:'queued',project_id:'case-project',app_type_id:'case-app',test_case_ids:[],case_snapshots:[],step_snapshots:[],suite_ids:[]});
api.executions.create=async input=>{window.runCreates.push(input);return{id:'created-run'}};
api.executions.parameterPlan=async input=>({case_count:input.test_case_ids?.length||0,suite_count:input.suite_ids?.length||0,expected_instance_count:input.test_case_ids?.length||0,parameters:[]});
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
// AppShell resolves workspace features before opening a catalog route.
client.setQueryData(['feature-flags'],flags);
const router=createMemoryRouter([{path:'/test-cases',element:<TestCasesPage/>},{path:'/executions',element:<ExecutionsPage/>},{path:'/away',element:<h1>Away from Test Cases</h1>}],{initialEntries:['/test-cases']});
window.fixtureNavigate=to=>router.navigate(to);window.fixtureLocation=()=>router.state.location;
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId="reviewer"><main style={{height:'100vh',overflowY:'auto',padding:24,boxSizing:'border-box'}}><RouterProvider router={router}/></main></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;

test('Test Case tile bars show outcome counts, score units, and no-data states', { timeout:60000 }, async()=>{
 const name='test-case-progress-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
 const progressFixture=fixture.replace('const client=new QueryClient', `
 cases[0].recent_results=['passed','passed','failed','blocked','running','skipped'].map((status,index)=>({id:'outcome-'+index,execution_id:'run-'+index,test_case_id:'case-1',status,created_at:'2026-09-15T10:0'+index+':00Z'}));
 cases[0].run_count=6;delete cases[1].step_count;
 const client=new QueryClient`);
 try{
  await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx,progressFixture);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{errors.push('Unexpected live API request');return route.abort()});
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5189'}/${name}.html`);
  const cards=page.locator('.test-case-library-scroll .test-case-catalog-card');
  await cards.nth(1).waitFor();
  const stability=cards.first().locator('.tile-card-progress').filter({hasText:'Stability'});
  const readiness=cards.first().locator('.tile-card-progress').filter({hasText:'Automation Readiness'});
  for(const theme of ['light','dark'])for(const width of [1440,390]){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.setViewportSize({width,height:900});
    await assertCountSegments(stability.locator('.metric-status-bar'),6,[
      {key:'passed',label:'Passed',count:2,color:'rgb(34, 160, 107)'},
      {key:'failed',label:'Failed',count:1,color:'rgb(227, 73, 53)'},
      {key:'blocked',label:'Blocked',count:1,color:'rgb(226, 178, 3)'},
      {key:'running',label:'Running',count:1,color:'rgb(12, 102, 228)'},
      {key:'skipped',label:'Skipped',count:1,color:'rgb(107, 119, 140)'}
    ]);
    assert.equal(await stability.locator('.tile-card-progress-head strong').innerText(),'33%');
    const bounds=await stability.locator('.metric-status-bar').evaluate(node=>({height:node.getBoundingClientRect().height,within:node.getBoundingClientRect().right<=node.parentElement.getBoundingClientRect().right+1}));
    assert.equal(bounds.height,14);assert.equal(bounds.within,true);
  }
  assert.deepEqual(await readiness.locator('.metric-status-segment').evaluateAll(nodes=>nodes.map(node=>({title:node.title,text:node.textContent}))),[
    {title:'Readiness score: 58%',text:'58%'},{title:'Remaining score: 42%',text:'42%'}
  ]);
  const unavailable=cards.nth(1).locator('.tile-card-progress').filter({hasText:'Automation Readiness'});
  assert.match(await unavailable.innerText(),/On open/);
  assert.equal(await unavailable.locator('.metric-status-segment').count(),0);
  const empty=cards.nth(1).locator('.tile-card-progress').filter({hasText:'Stability'});
  assert.match(await empty.innerText(),/No runs/);
  assert.equal(await empty.locator('.metric-status-segment').count(),0);
  assert.equal(await empty.locator('.metric-status-bar').getAttribute('role'),null);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)])}
});

test('Test Cases load 25 independently from metrics, fetch expanded modules, scroll and lazily prepare run scopes', { timeout:90000 }, async()=>{
 const name='test-case-catalog-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);
const artifacts=process.env.BROWSER_SCREENSHOT_DIR||'/tmp/qaira-test-case-catalog';
 let browser;
 try{
  await writeFile(html,`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>.test-case-library-scroll{height:560px!important;max-height:560px!important;flex:none!important}.test-case-library-scroll>.tile-browser-pane-scroll{height:100%;overflow-y:auto}</style></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx,fixture);await mkdir(artifacts,{recursive:true});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
  const unexpectedRequests=[];await context.route('**/api/**',route=>{unexpectedRequests.push(route.request().method()+' '+new URL(route.request().url()).pathname);return route.fulfill({status:500,contentType:'application/json',body:'{"message":"Unexpected fixture request"}'})});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(60000);
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5173'}/${name}.html`);
  const cards=page.locator('.test-case-library-scroll .test-case-catalog-card'),scroll=page.locator('.test-case-library-scroll>.tile-browser-pane-scroll');
  await page.waitForFunction(()=>document.querySelectorAll('.test-case-library-scroll .test-case-catalog-card').length===25);
  const total=page.getByRole('group',{name:'Test case library quality metrics'}).getByRole('button',{name:'View evidence for Total Cases'}).locator('strong');
  assert.equal(await total.innerText(),'95');await page.waitForTimeout(180);
  let calls=await page.evaluate(()=>window.calls);
  assert.equal(calls.catalog.length,1);assert.equal(calls.catalog[0].page_size,25);assert.equal(calls.catalog[0].include_total,false);assert.equal(calls.catalog[0].unassigned_module,true);
  assert.equal(calls.metrics.length,1);assert.equal(calls.headers.length,1);assert.equal(calls.moduleChildren.length,0,'Collapsed modules never fetch their children');
  assert.deepEqual(calls.authoring,[],'Library entry does not load all Stories or delivery catalogs');
  assert.equal(calls.all.some(call=>/^(requirements|requirementIterations|requirementReleases|executionResults|testSuites|testDataSets|testCases)\.list$/.test(call.path)),false);
  assert.equal(await page.getByRole('button',{name:/load more/i}).count(),0);
  const story=cards.first().locator('.test-case-requirement-block p');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    const layout=await story.evaluate(node=>{const id=node.querySelector('.test-case-linked-story-id').getBoundingClientRect(),title=node.querySelector('strong'),bounds=title.getBoundingClientRect();return {gap:bounds.left-id.right,trim:getComputedStyle(title).textOverflow,nowrap:getComputedStyle(title).whiteSpace,title:title.title,within:bounds.right<=node.getBoundingClientRect().right+1}});
    assert.ok(layout.gap>=8,'Story ID and title retain spacing at '+width);assert.equal(layout.trim,'ellipsis');assert.equal(layout.nowrap,'nowrap');assert.ok(layout.within);assert.match(layout.title,/deliberately long Story/);
  }
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:artifacts+'/test-cases-first-25.png'});
  const collapsedModule=page.locator('.test-case-module-header').filter({hasText:'Payments module'});
  await assertHealthAtRibbonEnd(collapsedModule.getByRole('button',{name:'Module Health: Payments module'}));
  await assertHealthAtRibbonEnd(page.getByRole('button',{name:'Module Health: Ungrouped',exact:true}));
  assert.deepEqual(await collapsedModule.locator('.hierarchy-quick-insight-label-row > span:first-child').allTextContents(),['Latest Pass Rate','At Risk']);
  await collapsedModule.getByRole('button',{name:'Module Health: Payments module'}).click();
  const moduleHealth=page.getByRole('dialog',{name:'Payments module',exact:true});
  await moduleHealth.waitFor();
  assert.equal(await moduleHealth.getByRole('button',{name:'View evidence for Test Cases',exact:true}).locator('strong').innerText(),'35','Health covers the entire collapsed module, without loading its cases');
  assert.equal(await page.evaluate(()=>window.calls.moduleChildren.length),0,'Health reuses exact aggregate evidence; no module child fan-out');
  await moduleHealth.getByRole('button',{name:'View evidence for Pending Review',exact:true}).click();
  assert.match(await moduleHealth.getByRole('list',{name:'Pending Review evidence'}).innerText(),/0\/35 Test Cases await review/);
  await page.waitForTimeout(320);
  await page.screenshot({path:artifacts+'/module-health.png'});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await moduleHealth.evaluate(node=>node.getBoundingClientRect().right <= innerWidth && node.scrollWidth <= node.clientWidth+1),true,'Module Health fits a narrow viewport');
  await page.screenshot({path:artifacts+'/module-health-mobile.png'});
  await page.keyboard.press('Escape');
  await moduleHealth.waitFor({state:'hidden'});
  await assertHealthAtRibbonEnd(collapsedModule.getByRole('button',{name:'Module Health: Payments module'}));
  await assertHealthAtRibbonEnd(page.getByRole('button',{name:'Module Health: Ungrouped',exact:true}));
  assert.equal(await collapsedModule.getByRole('button',{name:'Module Health: Payments module'}).evaluate(node=>node===document.activeElement),true,'Closing health restores the ribbon control focus');
  await page.setViewportSize({width:1440,height:900});


  await scroll.evaluate(node=>node.scrollTop=node.scrollHeight-node.clientHeight);
  await page.waitForFunction(()=>window.calls.catalog.length===2&&typeof window.releaseContinuation==='function');
  assert.equal(await cards.count(),25);assert.equal(await page.locator('.screen-loading-overlay').count(),0);
  const before=await scroll.evaluate(node=>node.scrollTop);
  await page.screenshot({path:artifacts+'/test-cases-next-page-pending.png'});
  await page.evaluate(()=>{window.pauseContinuation=false;window.releaseContinuation()});
  await page.waitForFunction(()=>document.querySelectorAll('.test-case-library-scroll .test-case-catalog-card').length===50);
  assert.ok(Math.abs((await scroll.evaluate(node=>node.scrollTop))-before)<=1,'Scroll position is stable while appending');
  await page.waitForTimeout(150);calls=await page.evaluate(()=>window.calls);assert.equal(calls.catalog.length,2);assert.equal(calls.metrics.length,1);assert.equal(calls.catalog[1].cursor,'25');assert.equal(calls.catalog[1].page_size,25);

  await scroll.evaluate(node=>node.scrollTop=0);
  const moduleHeader=page.locator('.test-case-module-header').filter({hasText:'Payments module'});
  await moduleHeader.getByRole('button',{name:'Expand module',exact:true}).click();
  await page.waitForFunction(()=>window.calls.moduleChildren.length===1&&document.querySelectorAll('.test-case-library-scroll .test-case-catalog-card').length===75);
  await assertHealthAtRibbonEnd(moduleHeader.getByRole('button',{name:'Module Health: Payments module'}));
  calls=await page.evaluate(()=>window.calls);assert.equal(calls.moduleChildren[0].page_size,25);assert.equal(calls.moduleChildren[0].include_total,false);assert.equal(calls.metrics.length,1);
  await moduleHeader.getByRole('button',{name:'Collapse module',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.test-case-library-scroll .test-case-catalog-card').length===50);

  await page.getByRole('textbox',{name:'Search test cases'}).fill('distant boundary');
  await page.waitForFunction(()=>window.calls.catalog.some(call=>call.search==='distant boundary')&&document.querySelectorAll('.test-case-library-scroll .test-case-catalog-card').length===1);
  assert.match(await cards.innerText(),/Distant boundary coverage/);calls=await page.evaluate(()=>window.calls);
  assert.equal(calls.catalog.at(-1).search,'distant boundary');assert.equal(calls.catalog.at(-1).cursor,undefined);assert.equal(calls.catalog.at(-1).unassigned_module,false,'Search covers every module through one bounded catalog query');assert.equal(calls.moduleChildren.length,1,'Search does not fan out across modules');assert.equal(calls.metrics.length,1,'Complete metrics stay stable while searching');assert.deepEqual(calls.authoring,[]);
  await page.screenshot({path:artifacts+'/test-cases-server-search.png'});

  await cards.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Create Suite',exact:true}).click();
  const suite=page.getByRole('dialog',{name:'Create Suite',exact:true});
  await suite.getByRole('textbox',{name:'Suite name'}).fill('Shared suite from Test Cases');
  assert.equal(await suite.locator('.test-case-picker--inline').count(),1);
  assert.equal(await suite.locator('.test-case-picker-filters, .test-case-picker-selection').count(),0);
  const suitePicker=suite.locator('.test-case-picker');
  await suitePicker.getByRole('checkbox',{name:'Remove TC-60 from the new suite',exact:true}).waitFor();
  await suitePicker.getByRole('checkbox',{name:'Add TC-1 to the new suite',exact:true}).check();
  await suitePicker.getByRole('button',{name:'Move Checkout coverage 01 up',exact:true}).click();
  await suite.getByRole('button',{name:'Create Suite',exact:true}).click();
  await suite.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>window.suiteCreates[0].name),'Shared suite from Test Cases');
  assert.deepEqual(await page.evaluate(()=>window.suiteCreates[0].test_case_ids),['case-1','case-60']);assert.equal(await page.evaluate(()=>window.suiteAssignments.length),0,'Suite membership is saved atomically');
  await cards.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Run manually',exact:true}).click();
  await page.waitForFunction(()=>typeof window.releaseAuthoring==='function');
  const run=page.getByRole('dialog',{name:'Create new run',exact:true});
  await run.waitFor();
  assert.equal(await page.evaluate(()=>window.fixtureLocation().pathname),'/executions','Manual action invokes the canonical execution route');
  assert.equal(await run.locator('.test-case-picker--inline').count(),1);
  await run.getByRole('checkbox',{name:'Remove TC-60 from the new run',exact:true}).waitFor();
  assert.equal(await run.getByText('Preparing Release and Sprint options… You can continue configuring this run.',{exact:true}).isVisible(),true);
  await run.getByLabel('Run Name',{exact:true}).fill('Edited while options load');
  assert.equal(await run.getByRole('button',{name:'Create Manual Run',exact:true}).isDisabled(),true);
  await run.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(await page.evaluate(()=>window.runCreates.length),0);
  calls=await page.evaluate(()=>window.calls);assert.equal(calls.authoring.filter(call=>call.path==='requirements.list').length,1);assert.equal(calls.authoring.filter(call=>call.path==='requirementReleases.list').length,1);assert.equal(calls.authoring.filter(call=>call.path==='requirementIterations.list').length,1);
  await page.evaluate(()=>{window.pauseAuthoring=false;window.releaseAuthoring()});
  await page.waitForFunction(()=>document.querySelector('.execution-create-modal select') && !document.body.innerText.includes('Preparing Release and Sprint options…'));
  assert.equal(await run.getByLabel('Run Name',{exact:true}).inputValue(),'Edited while options load');assert.equal(await run.getByLabel('Release',{exact:true}).inputValue(),'Release Alpha');assert.equal(await run.getByLabel('Sprint',{exact:true}).inputValue(),'Sprint Alpha');
  await page.screenshot({path:artifacts+'/test-cases-lazy-run-prefill.png'});
  assert.equal(await page.evaluate(()=>window.fixtureLocation().state?.createRun),undefined,'Consumed navigation selection cannot reopen a cancelled or saved dialog');
  const runPicker=run.locator('.test-case-picker--inline');
  await runPicker.getByRole('checkbox',{name:'Add TC-1 to the new run',exact:true}).check();
  await runPicker.getByRole('button',{name:'Move Checkout coverage 01 up',exact:true}).click();
  await run.getByRole('button',{name:'Create Manual Run',exact:true}).click();
  await page.waitForFunction(()=>window.runCreates.length===1);
  assert.deepEqual(await page.evaluate(()=>{const input=window.runCreates[0];return {cases:input.test_case_ids,suites:input.suite_ids,name:input.name,release:input.release,sprint:input.sprint,mode:input.execution_mode}}),{cases:['case-1','case-60'],suites:[],name:'Edited while options load',release:'Release Alpha',sprint:'Sprint Alpha',mode:'manual'});
  assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
 }finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)])}
});

test('Module Health remains at the ribbon end in list, expanded and mobile layouts', {timeout:60000}, async()=>{
 const name='module-health-layout-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
 try{
  await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx,fixture);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:500,body:'Unexpected fixture request'}));
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5173'}/${name}.html`);
  const module=page.getByRole('button',{name:'Module Health: Payments module',exact:true});
  const ungrouped=page.getByRole('button',{name:'Module Health: Ungrouped',exact:true});
  await module.waitFor();
  await page.getByRole('button',{name:'List view',exact:true}).click();
  await page.locator('.test-case-module-list-header').first().waitFor();
  await assertHealthAtRibbonEnd(module);await assertHealthAtRibbonEnd(ungrouped);
  const header=page.locator('.test-case-module-header').filter({has:module});
  await header.getByRole('button',{name:'Expand module',exact:true}).click();
  await header.getByRole('button',{name:'Collapse module',exact:true}).waitFor();
  await assertHealthAtRibbonEnd(module);
  await page.setViewportSize({width:390,height:844});
  await page.locator('.test-case-module-header:not(.test-case-module-list-header)').first().waitFor();
  await assertHealthAtRibbonEnd(module);await assertHealthAtRibbonEnd(ungrouped);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)])}
});
