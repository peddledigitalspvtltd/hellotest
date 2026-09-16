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
window.pauseContinuation=false;window.pauseAuthoring=false;window.holdDetails=true;window.holdSteps=true;
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
const cases=Array.from({length:3},(_,index)=>{
 const n=index+1;
 return {id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),display_id:n===1?'TC_7001':n===2?'DEMO2-T3':null,app_type_id:'case-app',title:n===60?'Distant boundary coverage':'Checkout coverage '+String(n).padStart(2,'0'),description:'Fixture case description '+n,
  suite_id:null,suite_ids:[],requirement_id:n===60?'story-run':null,requirement_ids:n===60?['story-run']:[],module_ids:n>60?['case-module']:[],defect_ids:[],labels:[],external_references:[],
  automated:'no',automation_status:'not_automated',authoring_mode:'structured',test_case_type:'functional',priority:3,status:'active',review_status:'not_requested',step_count:3,run_count:0,recent_results:[],detail_complete:false,summary_complete:true,
  created_at:'2026-09-15T10:00:00Z',updated_at:'2026-09-15T10:00:00Z'};
});
function matching(input){return cases.filter(item=>(!input.unassigned_module||!item.module_ids.length)&&(!input.search||[item.title,item.description,item.display_id].join(' ').toLowerCase().includes(input.search.toLowerCase())))}
function paginate(items,input){const offset=Number(input.cursor||0),page=items.slice(offset,offset+input.page_size),next=offset+page.length;return {items:page,next_cursor:next<items.length?String(next):null,is_last:next>=items.length}}
api.testCases.listPage=async(input)=>{
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

window.caseIds=cases.map(item=>item.id);
api.testCases.get=async id=>{
 if(window.holdDetails)await new Promise(resolve=>window.releaseDetails=resolve);
 return {...cases.find(item=>item.id===id||item.display_id===id),detail_complete:true,revision:1,parameter_values:{}};
};
api.testSteps.list=async input=>{
 if(window.holdSteps)await new Promise(resolve=>window.releaseSteps=resolve);
 return [];
};

const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
// AppShell resolves workspace features before opening a catalog route.
client.setQueryData(['feature-flags'],flags);
window.stepStatus=()=>client.getQueryState(['test-case-steps',cases[0].id,'case-project'])?.fetchStatus;
const router=createMemoryRouter([{path:'/test-cases',element:<TestCasesPage/>},{path:'/away',element:<h1>Away from Test Cases</h1>}],{initialEntries:['/test-cases']});
window.fixtureNavigate=to=>router.navigate(to);
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId="reviewer"><main style={{height:'100vh',overflowY:'auto',padding:24,boxSizing:'border-box'}}><RouterProvider router={router}/></main></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;

test('Test Case details retain readable IDs during loading and with no steps, and never fall back to UUIDs', { timeout:90000 }, async()=>{
 const name='case-display-id-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);
 const artifacts=process.env.BROWSER_SCREENSHOT_DIR||'/tmp/qaira-case-display-id';let browser;
 try{
  await writeFile(html,`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx,fixture);await mkdir(artifacts,{recursive:true});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5186'}/${name}.html`);
  await page.locator('.test-case-catalog-card').filter({hasText:'TC_7001'}).click();
  await page.waitForFunction(()=>typeof window.releaseDetails==='function'&&typeof window.releaseSteps==='function');
  const header=page.locator('.test-case-workspace-commandbar');
  assert.equal(await header.locator('.display-id-badge code').innerText(),'TC_7001');
  assert.doesNotMatch(await header.innerText(),/00000000-0000-4000-8000-/);
  await page.evaluate(()=>{window.holdDetails=false;window.releaseDetails()});
  await page.locator('.test-case-detail-navigation').waitFor();
  assert.equal(await header.locator('.display-id-badge code').innerText(),'TC_7001','Readable ID remains while steps are still loading');
  await page.evaluate(()=>{window.holdSteps=false;window.releaseSteps()});
  await page.waitForFunction(()=>window.stepStatus()==='idle');
  assert.equal(await header.locator('.display-id-badge code').innerText(),'TC_7001','Empty steps never select a database ID');
  const idBounds=await header.locator('.test-case-workspace-record-id').boundingBox();
  const titleBounds=await header.locator('.test-case-workspace-title').boundingBox();
  assert.ok(idBounds&&titleBounds&&idBounds.x+idBounds.width<=titleBounds.x,'The readable ID does not overlap the case title');
  await page.screenshot({path:artifacts+'/empty-steps-readable-id.png'});

  await page.evaluate(()=>window.fixtureNavigate('/away'));
  await page.getByRole('heading',{name:'Away from Test Cases'}).waitFor();
  await page.evaluate(()=>window.fixtureNavigate('/test-cases?case='+window.caseIds[1]));
  await page.waitForFunction(()=>document.querySelector('.test-case-workspace-record-id code')?.textContent==='DEMO2-T3');
  assert.equal(await header.locator('.display-id-badge code').innerText(),'DEMO2-T3','Existing readable legacy IDs are preserved');

  await page.evaluate(()=>window.fixtureNavigate('/away'));
  await page.getByRole('heading',{name:'Away from Test Cases'}).waitFor();
  await page.evaluate(()=>window.fixtureNavigate('/test-cases?case='+window.caseIds[2]));
  await page.locator('.test-case-detail-navigation').waitFor();
  assert.doesNotMatch(await header.innerText(),/00000000-0000-4000-8000-/);
  assert.equal(await header.locator('.display-id-badge').count(),0,'A missing readable ID never exposes the internal ID');
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)])}
});
