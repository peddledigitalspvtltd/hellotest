import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';import {createMemoryRouter,RouterProvider} from 'react-router-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {RequirementsPage} from '/services/manual/frontend/pages/RequirementsPage';import {AuthProvider} from '/src/auth/AuthContext';import {LocalizationProvider} from '/src/context/LocalizationContext';import {api,sessionStorage} from '/src/lib/api';import {setCurrentScope} from '/src/platform/hooks/useCurrentProject';import {stageAgentProposal} from '/src/lib/agentProposalDraft';
import '/src/styles.css';import '/src/modal-system.css';import '/src/workspace-layout.css';import '/src/catalog-list.css';import '/src/product-experience.css';
const session={token:'isolated-agent-draft',user:{id:'reviewer',name:'Reviewer',role:'admin',email:'reviewer@example.test'}};sessionStorage.write(session);setCurrentScope('project','app');window.writes=[];
function stub(value){for(const[key,entry]of Object.entries(value)){if(typeof entry==='function')value[key]=async()=>[];else if(entry&&typeof entry==='object')stub(entry)}}stub(api);
api.auth.session=async()=>session;api.settings.getLocalization=async()=>({strings:{}});api.settings.getWorkspacePreferences=async()=>({preferences:{}});api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});
api.projects.list=async()=>[{id:'project',name:'Project'}];api.appTypes.list=async()=>[{id:'app',project_id:'project',name:'Web',type:'web'}];api.metadata.domain=async()=>({requirements:{default_status:'open',statuses:[{value:'open',label:'Open'}]},jira:{sprints:[],versions:[]}});
let story={id:'story-1',display_id:'ST-1',project_id:'project',title:'Original checkout',description:'The shopper completes checkout.',acceptance_criteria:['One order is created.'],status:'open',priority:2,revision:3,labels:['checkout'],external_references:[],test_case_ids:[],defect_ids:[],gherkin_scenarios:[],additional_fields:{acceptance_criteria:['One order is created.']}};
api.requirements.listPage=async()=>({items:[story],is_last:true,next_cursor:null});api.requirements.get=async()=>structuredClone(story);api.requirements.createMetadata=api.requirements.editMetadata=async()=>({fields:[],core_fields:[],custom_fields:[],workflow_statuses:{default_status:'open',statuses:[{value:'open',label:'Open'}]}});
const metrics={total:1,mapped:0,highPriority:1,open:1,completed:0,qaTotal:0,totalDefects:0,completionPercent:0,coveragePercent:0,defectDensity:0,groomed:1,notGroomed:0,described:1,specified:1,teamAssigned:0,slipped:0,onCourse:0,sprintCommitted:0,releaseScoped:0,backlog:1};api.requirements.metrics=async()=>({all:metrics,backlog:metrics,sprints:metrics,sprint_health:[],filter_options:{statuses:['open'],labels:[],sprints:[],fix_versions:[],releases:[]}});
api.requirements.update=async(id,input)=>{window.writes.push({id,input});story={...story,...input,revision:4};return{updated:true,revision:4}};
const stale=new URLSearchParams(location.search).get('stale')==='1';const route=stageAgentProposal({kind:'story',target_id:story.id,target_revision:stale?2:3,title:'Completed checkout retry',description:'The shopper completes checkout with safe retries.',acceptance_criteria:['Given a checkout, when a request is retried, then exactly one order is retained.'],priority:'P1',citation_ids:['K-story-snapshot']},'project','app');
const router=createMemoryRouter([{path:'/stories',element:<RequirementsPage/>}],{initialEntries:[route]});createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><AuthProvider><LocalizationProvider userId='reviewer'><main style={{height:'100vh',overflowY:'auto',padding:24}}><RouterProvider router={router}/></main></LocalizationProvider></AuthProvider></QueryClientProvider>);`;
test('accepted existing Story drafts open native completion and apply only reviewed fields; stale drafts are rejected', {timeout:90000}, async()=>{
 const name=`agent-native-${randomUUID()}`;let browser;
 try {
  await writeFile(new URL(`${name}.tsx`,root),fixture);await writeFile(new URL(`${name}.html`,root),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  for(const stale of [false,true]) {
   const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',route=>{errors.push('Unexpected live API request');return route.abort()});
   await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5178'}/${name}.html${stale?'?stale=1':''}`);
   if(stale){await page.getByText('The Story changed since the agent review. Run the review again before applying this proposal.',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.writes),[]);}
   else {
    const dialog=page.getByRole('dialog',{name:'AI Complete Story',exact:true});await dialog.waitFor();assert.equal(await dialog.getByLabel('Story title',{exact:true}).inputValue(),'Completed checkout retry');
    assert.deepEqual(await page.evaluate(()=>window.writes),[],'Opening the populated review does not save');
    await mkdir('/tmp/qaira-agent-native-review',{recursive:true});await dialog.screenshot({path:'/tmp/qaira-agent-native-review/story-completion.png'});
    await dialog.getByRole('button',{name:/Apply.*Story|Apply.*changes|Apply.*fields/i}).click();
    await page.waitForFunction(()=>window.writes.length===1);const write=await page.evaluate(()=>window.writes[0]);assert.equal(write.id,'story-1');assert.equal(write.input.expected_revision,3);assert.equal(write.input.title,'Completed checkout retry');assert.equal(write.input.priority,2);assert.deepEqual(write.input.labels,['checkout']);assert.match(write.input.acceptance_criteria[0],/exactly one order/);
   }
   assert.deepEqual(errors,[]);await page.close();
  }
 } finally {await browser?.close();await Promise.all([rm(new URL(`${name}.tsx`,root),{force:true}),rm(new URL(`${name}.html`,root),{force:true})]);}
});

test('native Test Case handoff retains type, parameters, test data and structured or Gherkin actions until human save', {timeout:120000}, async()=>{
 const source=await readFile(new URL('../../../testing/test/browser/aiTestCaseReviewOrder.test.mjs',import.meta.url),'utf8');
 const base=source.match(/const fixture = `([\s\S]*?)`;\n\nasync function/)[1];
 const common={kind:'test_case',title:'Reviewed account parameter intent',description:'Verify the reviewed account.',priority:'P2',test_case_type:'regression',parameter_values:{'t.account':'account-reviewed','t.optional':''},prerequisites:['An account exists.'],test_data:['Use the case account parameter.'],cleanup:['Keep the account.'],citation_ids:['source-1']};
 const cases=[{...common,authoring_mode:'structured',steps:[{action:'Request account @t.account.',expected_result:'The account exists.',step_type:'api'}]},{...common,authoring_mode:'gherkin',gherkin_document:'Feature: Reviewed account parameter intent\nScenario: Existing account\n Given the account @t.account\n When I inspect the account\n Then the account exists',steps:[]}];
 const name='agent-native-case-'+randomUUID();let browser;
 try {
  let native=base.replace("import {TestCasesPage}","import {stageAgentProposal} from '/src/lib/agentProposalDraft';import {TestCasesPage}");
  native=native.replace("const initial=new URLSearchParams(location.search).get('flow')==='improve'?'/test-cases?case=case1':'/test-cases';",`window.created=[];const proposal=${JSON.stringify(cases)}[Number(new URLSearchParams(location.search).get('mode')||0)];const initial=stageAgentProposal(proposal,'p','a');api.testCases.create=async input=>{window.created.push(structuredClone(input));return{id:'new-case',display_id:'TC-NEW'}};`);
  await writeFile(new URL(name+'.tsx',root),native);await writeFile(new URL(name+'.html',root),`<html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true});
  for(let index=0;index<cases.length;index++){
   const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',route=>{errors.push('Unexpected live API');return route.abort()});
   await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html?mode=${index}`);await page.getByRole('textbox',{name:'Title',exact:true}).waitFor();await page.waitForFunction(title=>document.querySelector('#test-case-authoring-form input[data-autofocus]')?.value===title,common.title);assert.equal(await page.getByRole('textbox',{name:'Title',exact:true}).inputValue(),common.title);assert.equal(await page.evaluate(()=>window.created.length),0);
   await page.getByRole('button',{name:'Create test case',exact:true}).click();await page.waitForFunction(()=>window.created.length===1);const saved=await page.evaluate(()=>window.created[0]);assert.equal(saved.test_case_type,'regression');assert.equal(saved.authoring_mode,cases[index].authoring_mode);assert.deepEqual(saved.parameter_values,common.parameter_values);assert.match(saved.description,/Test data:\nUse the case account parameter/);assert.match(saved.description,/Cleanup:\nKeep the account/);if(index===0)assert.equal(saved.steps[0].step_type,'api');else assert.match(saved.gherkin_document,/When I inspect the account/);assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser?.close();await Promise.all(['tsx','html'].map(ext=>rm(new URL(name+'.'+ext,root),{force:true})));}
});
