// Render real Product Management cards from complete server evidence, with no support catalogs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../../',import.meta.url);
const fixture=`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider} from '/src/auth/AuthContext';
import {LocalizationProvider} from '/src/context/LocalizationContext';
import {RequirementsPage} from '/src/pages/RequirementsPage';
import {ReleasesPage} from '/src/pages/ReleasesPage';
import {api,sessionStorage} from '/src/lib/api';
import {setCurrentScope} from '/src/hooks/useCurrentProject';
import '/src/styles.css';
import '/src/dark-theme.css';
import '/src/modal-system.css';
import '/src/workspace-layout.css';
import '/src/catalog-list.css';
const mode=new URLSearchParams(location.search).get('mode')||'stories';
const hold=new URLSearchParams(location.search).has('hold');
const session={token:'metric-browser-fixture',user:{id:'reviewer',name:'Reviewer',email:'reviewer@example.test',role:'admin'}};
sessionStorage.write(session);setCurrentScope('metric-project','metric-app');
localStorage.setItem('hellotest.default_catalog_view_mode','tile');
window.calls=[];
function stub(object,prefix=''){for(const [key,value] of Object.entries(object)){const path=prefix?prefix+'.'+key:key;if(typeof value==='function')object[key]=async(...args)=>{window.calls.push({path,args});return []};else if(value&&typeof value==='object')stub(value,path)}}
stub(api);
api.auth.session=async()=>session;
api.settings.getLocalization=async()=>({strings:{}});
api.settings.getWorkspacePreferences=async()=>({preferences:{}});
api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});
api.projects.list=async()=>[{id:'metric-project',name:'Metrics project'}];
api.appTypes.list=async()=>[{id:'metric-app',project_id:'metric-project',name:'Web',type:'web'}];
api.metadata.domain=async()=>({requirements:{default_status:'open',statuses:[{value:'open',label:'Open',category_key:'new'}]},jira:{sprints:[],versions:[]}});
const storyFacts={linked_cases:4,automated_cases:3,executed_cases:3,passed_cases:2,total_bugs:2,open_bugs:1,closed_bugs:1,described:true,specified:true,groomed:true,slipped:false,completed:false,execution_complete:true};
const rows=Array.from({length:60},(_,i)=>({id:'metric-story-'+i,display_id:'ST-'+i,project_id:'metric-project',title:'Metric Story '+i,description:'Reviewable Story',status:'open',priority:2,iteration_id:i<30?'metric-sprint':null,sprint:i<30?'Metric Sprint':'',labels:[],test_case_ids:[],defect_ids:[],defects:[],gherkin_scenarios:['Scenario: verified'],specification_content:'Given a known context',external_references:[],created_at:'2026-09-01',updated_at:'2026-09-01',catalog_metrics:i===1?{...storyFacts,linked_cases:0,automated_cases:0,executed_cases:0,passed_cases:0,total_bugs:0,open_bugs:0,closed_bugs:0}:storyFacts}));
rows.forEach((row,i)=>{row.revision=1;row.catalog_metrics={...row.catalog_metrics,readiness:{mode:i<30?'release':'backlog',label:i<30?'Story Release Readiness':'Story Readiness',score:i===1?null:40,met:i===1?0:2,known:i===1?0:2,total:5,checks:(i<30?['acceptance_tests','code_review','automated_tests','critical_defects','product_owner']:['persona_value','acceptance_criteria','wireframe','dependencies','story_points']).map((key,index)=>({key,label:key,status:i===1?'unverified':index<2?'met':'unverified',source:'review',evidence:'Scoped readiness evidence'}))}};});
api.requirements.createMetadata=api.requirements.editMetadata=async()=>({fields:[],core_fields:[],custom_fields:[],statuses:[{id:'open',name:'Open'}]});
api.requirements.get=async id=>{window.calls.push({path:'requirements.get',args:[id]});return rows.find(row=>row.id===id||row.display_id===id)};
const base={total:30,mapped:12,highPriority:10,criticalPriority:3,highOnlyPriority:7,growth:{added:8,completed:4,removed:1,departures:5,net:3,partial:true,tracking_started_at:'2026-09-20T00:00:00Z',period_start:'2026-09-01T00:00:00Z'},open:15,completed:15,qaTotal:30,devCompleted:24,devTotal:30,devCompletionPercent:80,totalDefects:9,completionPercent:50,coveragePercent:40,defectDensity:0.3,groomed:18,notGroomed:12,described:25,specified:20,teamAssigned:22,slipped:4,onCourse:26,sprintCommitted:30,releaseScoped:25,backlog:0};
const health={iteration_id:'metric-sprint',jira_sprint_id:null,name:'Metric Sprint',state:'active',total_stories:30,completed_stories:15,completed_percent:50,covered_stories:12,coverage_percent:40,linked_cases:4,executed_linked_cases:3,passed_cases:2,pass_percent:66.7,at_risk_stories:4,slippage_stories:4,on_course_stories:26,open_p1_p2_bugs:1,total_bugs:9};
health.exact_fields=Object.keys(health);health.observed={...health,stories_scanned:30};health.completeness={complete:true,partial:false,reasons:[],exact_fields:health.exact_fields,stories:{state:'complete',scanned:30,limit:30},executions:{state:'complete',linked_cases_scoped:4,runs_scanned:0,results_scanned:3,case_limit:4,run_limit:0,result_limit:3},bugs:{state:'complete',bugs_scanned:9,limit:9}};
const metrics={all:{...base,total:60,backlog:30,sprintCommitted:30,releaseScoped:45},backlog:{...base,completed:0,qaTotal:0,devCompleted:0,devTotal:0,devCompletionPercent:0,completionPercent:0,sprintCommitted:0,backlog:30},sprints:base,sprint_health:[health],filter_options:{statuses:['open'],labels:[],sprints:['Metric Sprint'],fix_versions:[],releases:[]},generated_at:'2026-09-16T00:00:00Z'};
api.requirements.metrics=async input=>{window.calls.push({path:'requirements.metrics',args:[input]});if(hold)await new Promise(resolve=>window.releaseMetrics=resolve);if(new URLSearchParams(location.search).has('empty'))return {...metrics,all:{...metrics.all,devCompleted:0,devTotal:0,devCompletionPercent:0,completed:0,qaTotal:0,completionPercent:0}};return metrics};
api.requirements.listPage=async input=>{window.calls.push({path:'requirements.listPage',args:[input]});const scoped=input.unassigned?rows.filter(row=>!row.iteration_id):rows;const offset=Number(input.cursor||0),items=scoped.slice(offset,offset+25);return {items,is_last:offset+items.length>=scoped.length,next_cursor:offset+items.length<scoped.length?String(offset+items.length):null}};
api.requirementIterations.list=async()=>[{id:'metric-sprint',project_id:'metric-project',name:'Metric Sprint',state:'active',status:'active',requirement_count:30,requirement_ids:rows.slice(0,30).map(row=>row.id),start_date:'2026-09-01',end_date:'2026-09-30'}];
const completed={...rows[0],status:' QA--Done '};
const releases=[
 {id:'active-release',name:'Overdue launch',project_id:'metric-project',fix_version:'1.0',state:'overdue',persisted_state:'in_progress',sprint_ids:[],requirement_count:2,requirements:[completed,rows[1]]},
 {id:'planned-release',name:'Future launch',project_id:'metric-project',fix_version:'2.0',state:'planned',persisted_state:'planned',sprint_ids:[],requirement_count:0,requirements:[]},
 {id:'completed-release',name:'Completed launch',project_id:'metric-project',fix_version:'0.9',state:'released',persisted_state:'released',sprint_ids:[],requirement_count:2,requirements:[completed,{...rows[2],status:'done'}]}
];
api.requirementReleases.list=async()=>releases;
api.requirementReleases.listReadiness=async()=>releases.map((release,index)=>({release_id:release.id,total_stories:release.requirement_count,covered_stories:release.requirement_count?1:0,test_coverage_percent:release.requirement_count?50:null,linked_cases:4,executed_cases:3,passed_cases:2,pass_rate_percent:66.7,total_bugs:2,open_bugs:index===0?1:0,readiness_state:index===2?'ready':index===0?'at_risk':'not_ready',readiness_score:index===1?null:index===2?90:78,story_metrics:{
 [rows[0].id]:{...storyFacts,pass_rate_percent:66.7,automation_coverage_percent:75,readiness_score:78},
 [rows[1].id]:{linked_cases:0,executed_cases:0,passed_cases:0,pass_rate_percent:null,automated_cases:0,automation_coverage_percent:0,total_bugs:0,open_bugs:0,readiness_score:null}
}}));
const router=createMemoryRouter([{path:'/',element:mode==='releases'?<ReleasesPage/>:<RequirementsPage workspaceMode={mode}/>}],{initialEntries:['/']});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AuthProvider><LocalizationProvider userId="reviewer"><main style={{height:'100vh',overflowY:'auto',padding:24}}><RouterProvider router={router}/></main></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;
const metricValue=(page,label)=>page.getByRole('group',{name:'Story health metrics'}).getByRole('button',{name:'View evidence for '+label.replace(/(^|\s)\w/g,word=>word.toUpperCase()),exact:true}).locator('strong');

test('Stories Dev Completion matches QA scope and shows its evidence, loading and empty states', {timeout:60000}, async()=>{
 const name='dev-completion-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);
 let browser;
 try{
  await writeFile(html,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/'+name+'.tsx"></script></body></html>');
  await writeFile(tsx,fixture);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:950},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  const url=(process.env.VITE_TEST_URL||'http://127.0.0.1:5186')+'/'+name+'.html?mode=stories';
  await page.goto(url+'&hold=1');
  const group=page.getByRole('group',{name:'Story health metrics'});
  await metricValue(page,'Dev Completion').waitFor();
  assert.equal(await metricValue(page,'Dev Completion').innerText(),'—');
  assert.equal(await group.getByRole('button',{name:'View evidence for Release Scope',exact:true}).count(),0);
  await page.waitForFunction(()=>typeof window.releaseMetrics==='function');
  await page.evaluate(()=>window.releaseMetrics());
  await page.waitForFunction(()=>document.querySelector('[aria-label="View evidence for Dev Completion"] strong')?.textContent==='80%');
  assert.equal(await metricValue(page,'QA Completion').innerText(),'50%');
  await page.waitForFunction(()=>document.querySelectorAll('.requirement-catalog-card').length===25);
  assert.equal(await metricValue(page,'Dev Completion').innerText(),'80%','Complete server metrics include Stories beyond the visible page');
  await group.getByRole('button',{name:'View evidence for Dev Completion',exact:true}).click();
  const evidence=group.getByRole('list',{name:'Dev Completion evidence',exact:true});
  await evidence.waitFor();
  const detail=await evidence.innerText();
  assert.match(detail,/24 of 30 Sprint Stories have reached Dev Done/);
  assert.match(detail,/progressed into QA or Done remain included/);
  assert.match(detail,/Backlog Stories are excluded/);
  await group.getByRole('button',{name:'Back to Dev Completion metric',exact:true}).click();
  await mkdir('/tmp/qaira-dev-completion',{recursive:true});
  await page.screenshot({path:'/tmp/qaira-dev-completion/stories.png'});
  await page.goto(url+'&empty=1');
  await page.waitForFunction(()=>document.querySelector('[aria-label="View evidence for Backlog Inventory"] strong')?.textContent==='30');
  assert.equal(await metricValue(page,'Dev Completion').innerText(),'—','No Sprint Stories is unavailable completion, not 0%');
  assert.equal(await metricValue(page,'QA Completion').innerText(),'—');
  assert.deepEqual(errors,[]);
 }finally{
  if(browser)await browser.close();
  await Promise.all([unlink(html).catch(()=>{}),unlink(tsx).catch(()=>{})]);
 }
});

test('Product Management cards use complete record evidence and accurate scope denominators', {timeout:90000},async()=>{
 const name='product-metrics-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);
 let browser;
 try{
  await writeFile(html,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/'+name+'.tsx"></script></body></html>');await writeFile(tsx,fixture);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  await mkdir('/tmp/qaira-product-metrics',{recursive:true});
  for(const mode of ['stories','backlog','sprints']){
   const context=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'}),page=await context.newPage();
   const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(30000);
   await page.goto((process.env.VITE_TEST_URL||'http://127.0.0.1:5186')+'/'+name+'.html?mode='+mode);
   await page.getByRole('group',{name:'Story health metrics'}).waitFor();
   const expected=mode==='stories'?{'Backlog inventory':'30','Sprint commitment':'30','Dev Completion':'80%','QA completion':'50%'}:mode==='backlog'?{'Grooming readiness':'60%','Backlog Growth Rate':'8:5','Priority Distribution':'33%','Team ownership':'22'}:{'Completion Status':'50%','Test Coverage':'40%','Bug Density':'0.30','Slippage':'4'};
   for(const [label,value] of Object.entries(expected))assert.equal(await metricValue(page,label).innerText(),value,mode+': '+label);
   if(mode!=='sprints'){
    await page.waitForFunction(()=>document.querySelectorAll('.requirement-catalog-card').length===25);
    const card=page.locator('.requirement-catalog-card').filter({has:page.getByText(mode==='backlog'?'Metric Story 30':'Metric Story 0',{exact:true})});
    const linked=card.locator('.tile-card-metric').filter({has:page.getByText('Linked Cases',{exact:true})});
    assert.match(await linked.innerText(),/4/,'Complete row facts override empty suggestion/link arrays');
    if(mode==='stories'){
     assert.match(await card.innerText(),/67%/,'2 passed of3 finalized, rather than4 linked cases');
     assert.match(await card.innerText(),/75%/,'3 automated of4 linked cases');
    }
    const density=card.locator('.tile-card-metric').filter({has:page.getByText('Defect Density',{exact:true})});
    assert.match(await density.innerText(),/2\.00/,'Two Bugs per one Story');
    const readiness=card.locator('.tile-card-metric').filter({has:page.getByText(mode==='backlog'?'Story Readiness':'Story Release Readiness',{exact:true})});
    assert.match(await readiness.innerText(),/40%/,'Only the server checklist evidence defines readiness');
    if(mode==='stories'){
     const noRuns=page.locator('.requirement-catalog-card').filter({has:page.getByText('Metric Story 1',{exact:true})});
     assert.match(await noRuns.innerText(),/No runs/);
     assert.doesNotMatch(await noRuns.locator('.tile-card-metric').filter({has:page.getByText('Story Release Readiness',{exact:true})}).innerText(),/20%|50%|100%/);
    }
   }else{
    const insights=page.locator('.hierarchy-quick-insights');
    await insights.first().waitFor();
    assert.match(await insights.first().innerText(),/66\.7%/);
    assert.match(await insights.first().innerText(),/0\.30/);
   }
   assert.equal(await page.evaluate(()=>window.calls.filter(call=>['testCases.list','testCases.listPage','executionResults.list'].includes(call.path)).length),0,'Metrics cannot depend on deferred supporting catalogs');
   assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.path==='requirements.metrics').length),1);
   assert.deepEqual(errors,[]);
   await page.screenshot({path:'/tmp/qaira-product-metrics/'+mode+'.png'});
   if(mode!=='sprints'){await page.getByText(mode==='backlog'?'Metric Story 30':'Metric Story 0',{exact:true}).click();const checklist=page.locator('.story-readiness-checklist');await checklist.waitFor().catch(async error=>{await page.screenshot({path:'/tmp/qaira-product-metrics/detail-error.png'});console.log(JSON.stringify({mode,errors,text:(await page.locator('body').innerText()).slice(-4000),calls:await page.evaluate(()=>window.calls.slice(-10))}));throw error});assert.match(await checklist.locator('summary').innerText(),mode==='backlog'?/^Story Readiness: 2 of 5/:/^Story Release Readiness: 2 of 5/);await checklist.locator('summary').click();assert.equal(await checklist.locator('li').count(),5);}
   await context.close();
  }
  const pendingContext=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'});
  const pendingPage=await pendingContext.newPage();pendingPage.setDefaultTimeout(10000);
  await pendingPage.goto((process.env.VITE_TEST_URL||'http://127.0.0.1:5186')+'/'+name+'.html?mode=stories&hold=1');
  await metricValue(pendingPage,'QA completion').waitFor();
  assert.equal(await metricValue(pendingPage,'QA completion').innerText(),'—','A pending metric must not look like zero completion');
  assert.equal(await metricValue(pendingPage,'Backlog inventory').innerText(),'—','A pending count must not look empty');
  await pendingPage.waitForFunction(()=>typeof window.releaseMetrics==='function');
  await pendingPage.evaluate(()=>window.releaseMetrics());
  await pendingPage.waitForFunction(()=>[...document.querySelectorAll('.quality-metric-card strong')].some(node=>node.textContent==='50%'));
  assert.equal(await metricValue(pendingPage,'QA completion').innerText(),'50%');
  await pendingContext.close();

  const releaseContext=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'});
  const releasePage=await releaseContext.newPage();releasePage.setDefaultTimeout(10000);
  const releaseErrors=[];releasePage.on('pageerror',error=>releaseErrors.push(error.message));
  await releasePage.goto((process.env.VITE_TEST_URL||'http://127.0.0.1:5186')+'/'+name+'.html?mode=releases');
  const portfolio=releasePage.getByRole('group',{name:'Release portfolio health'});
  await portfolio.waitFor();
  assert.equal(await portfolio.locator('article').count(),4);
  const evidenceCopy=[];
  for(const [label,value] of Object.entries({'Total Releases':'3','Release Ready':'1','At Risk':'1','Overdue':'1'})){
   const front=portfolio.getByRole('button',{name:'View evidence for '+label.replace(/(^|\s)\w/g,word=>word.toUpperCase()),exact:true});
   assert.equal(await front.locator('strong').innerText(),value,label);
   await front.click();
   const evidence=portfolio.getByRole('list',{name:label+' evidence',exact:true});
   await evidence.waitFor();
   const text=await evidence.innerText();assert.match(text,/Release/);evidenceCopy.push(text);
   assert.equal(await front.isVisible(),false,'The front face is hidden after flipping');
   await portfolio.getByRole('button',{name:'Back to '+label+' metric',exact:true}).click();
  }
  assert.equal(new Set(evidenceCopy).size,4,'Each card shows its own scope and calculation evidence');
  await releasePage.getByRole('textbox',{name:'Search releases',exact:true}).fill('Future launch');
  assert.equal(await portfolio.getByRole('button',{name:'View evidence for Total Releases'}).locator('strong').innerText(),'3','Search only filters the plan below');
  await releasePage.getByRole('textbox',{name:'Search releases',exact:true}).fill('');
  await releasePage.getByRole('button',{name:'Expand release Overdue launch',exact:true}).click().catch(async error=>{console.log(JSON.stringify({releaseErrors,text:(await releasePage.locator('body').innerText()).slice(-5000)}));throw error});
  const releaseStory=releasePage.locator('.release-story-tile').filter({has:releasePage.getByText('Metric Story 0',{exact:true})});
  assert.equal(await releaseStory.locator('.release-story-context-facts').count(),0,'Release Story tiles omit Sprint and Fix Version facts');
  assert.equal(await releaseStory.locator('.tile-card-progress').filter({has:releasePage.getByText('Automation Coverage',{exact:true})}).locator('strong').innerText(),'75%');
  const emptyStory=releasePage.locator('.release-story-tile').filter({has:releasePage.getByText('Metric Story 1',{exact:true})});
  assert.equal(await emptyStory.locator('.tile-card-progress').filter({has:releasePage.getByText('Automation Coverage',{exact:true})}).locator('strong').innerText(),'—','No linked cases provides no automation denominator');
  assert.equal(await emptyStory.locator('.tile-card-progress').filter({has:releasePage.getByText('Pass Rate',{exact:true})}).locator('strong').innerText(),'No runs');
  assert.deepEqual(releaseErrors,[]);
  await releasePage.screenshot({path:'/tmp/qaira-product-metrics/releases.png'});
  await releaseContext.close();

 }finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)])}
});
