// Reporter session on the production Bugs page; no backend reads or writes.
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
import { IssuesPage } from '/src/pages/IssuesPage';
import { api, sessionStorage } from '/src/lib/api';
import { setCurrentScope } from '/src/hooks/useCurrentProject';
import '/src/styles.css';
import '/src/dark-theme.css';
import '/src/modal-system.css';
import '/src/workspace-layout.css';
import '/src/catalog-list.css';
import '/src/execution-run-builder.css';
const session={token:'test-case-catalog-browser',user:{id:'reviewer',name:'QA Reviewer',email:'reviewer@example.test',role:'member',workspace_permissions:['workspace.view'],project_permissions:{'case-project':['feedback.view','feedback.create','attachment.view','attachment.create','comment.view','comment.create','project.view','project_member.view','app_type.view','testcase.view','suite.view','run.view','result.view','requirement.view','requirement_iteration.view','environment.view']}}};
sessionStorage.write(session);setCurrentScope('case-project','case-app');
localStorage.setItem('hellotest.default_catalog_view_mode','tile');
window.calls={all:[],catalog:[],metrics:[],headers:[],moduleChildren:[],authoring:[]};
window.pauseContinuation=false;window.pauseAuthoring=false;window.pausePicker=false;window.pickerCalls=[];window.created=[];window.assigned=[];
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
function matching(input){return cases.filter(item=>(!input.unassigned_module||!item.module_ids.length)&&(!input.search||[item.title,item.description,item.display_id].join(' ').toLowerCase().includes(input.search.toLowerCase())))}
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
api.requirements.listPage=async()=>({items:[],is_last:true,next_cursor:null});
api.testCaseModules.create=async input=>{window.created.push(input);return {id:'created-module'}};
api.testCaseModules.assignCases=async(id,ids)=>{window.assigned.push({id,ids});return {updated:true,assigned:ids.length}};
api.testSuites.list=async()=>[{id:'scope-suite',app_type_id:'case-app',name:'Related Suite',test_case_ids:['case-60']}];
api.issues.createMetadata=async()=>({fields:[],core_fields:[],required_fields:[],current_values:{},workflow_statuses:{statuses:['open'],default_status:'open'}});
api.issues.editMetadata=api.issues.createMetadata;
api.issues.get=async id=>({id,...window.created.at(-1),created_at:'2026-09-16T00:00:00Z'});
api.issues.create=async input=>{window.created.push(input);return {id:'created-bug'}};
api.issues.update=async input=>{window.updates.push(input);return {}};window.updates=[];
api.projectMembers.list=async input=>[{id:'membership',project_id:input.project_id,user_id:'qa-owner',user_name:'QA Owner',user_email:'owner@example.test',role_id:'qa-role'}];
api.attachments.meta=async()=>({enabled:true,uploadLimit:1000000});
api.comments.create=async (scope,body)=>{window.commentWrites.push({scope,body});return {id:'comment-a',body}};window.commentWrites=[];
api.issues.catalogPage=async()=>({items:[],is_last:true,next_cursor:null});
api.issues.metrics=async()=>({total:0,converted:0,statuses:{}});

const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
// AppShell resolves workspace features before opening a catalog route.
client.setQueryData(['feature-flags'],flags);
const router=createMemoryRouter([{path:'/issues',element:<IssuesPage/>},{path:'/away',element:<h1>Away from Test Cases</h1>}],{initialEntries:['/issues']});
window.fixtureNavigate=to=>router.navigate(to);
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId="reviewer"><main style={{height:'100vh',overflowY:'auto',padding:24,boxSizing:'border-box'}}><RouterProvider router={router}/></main></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;

test('Reporter can create and discuss Bugs with project assignees while saved records stay read-only', {timeout:90000}, async()=>{
 const name='reporter-bugs-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);
 const artifacts=process.env.BROWSER_SCREENSHOT_DIR||'/tmp/qaira-reporter-permissions';let browser;
 try{
  await writeFile(html,`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx,fixture);await mkdir(artifacts,{recursive:true});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.stack));page.setDefaultTimeout(10000);
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5186'}/${name}.html`);
  const report=page.getByRole('button',{name:'Report Bug',exact:true});
  await report.click();
  const bug=page.getByRole('dialog',{name:'Report Bug',exact:true});
  await bug.getByLabel('Bug Title').fill('Reporter-created checkout defect');
  await bug.getByLabel('Assignee',{exact:true}).selectOption('qa-owner');
  assert.equal(await bug.getByRole('button',{name:'Create',exact:true}).isEnabled(),true);
  await page.screenshot({path:artifacts+'/reporter-create-bug.png'});
  await bug.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await page.waitForFunction(()=>window.created.length===1);
  assert.equal((await page.evaluate(()=>window.created))[0].assignee_id,'qa-owner');
  await page.getByText('You have read-only access to this Bug.').waitFor();
  assert.equal(await page.getByLabel('Bug Title').isDisabled(),true);
  assert.equal(await page.getByLabel('Assignee',{exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Update Bug',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Delete Bug',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Convert to Test Case',exact:true}).count(),0);
  assert.equal(await page.locator('.issue-form-section--evidence [contenteditable="true"]').count(),0);
  assert.equal(await page.getByRole('combobox',{name:'Select or add labels',exact:true}).isDisabled(),true);
  await page.getByRole('textbox',{name:'Add a HelloTest comment'}).fill('I reproduced this in the checkout screen.');
  await page.getByRole('button',{name:'Comment',exact:true}).click();
  await page.waitForFunction(()=>window.commentWrites.length===1);
  assert.equal((await page.evaluate(()=>window.commentWrites))[0].scope.entity_id,'created-bug');
  assert.equal(await page.getByRole('button',{name:'Browse',exact:true}).isEnabled(),true);
  await page.locator('form.issue-detail-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  assert.deepEqual(await page.evaluate(()=>window.updates),[]);
  assert.equal((await page.evaluate(()=>window.calls.all)).some(call=>call.path==='users.list'),false);
  await page.screenshot({path:artifacts+'/reporter-bug-read-only-with-comments.png',fullPage:true});
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)])}
});
