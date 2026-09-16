// Production Bug/Story forms: unavailable optional data must not block editing.
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
import {IssuesPage} from '/src/pages/IssuesPage';
import {RequirementsPage} from '/src/pages/RequirementsPage';
import {api,sessionStorage} from '/src/lib/api';
import {setCurrentScope} from '/src/hooks/useCurrentProject';
import featurePolicy from '/src/lib/featurePolicy.generated.json';
const permissionFeatures=featurePolicy.permission_features;
import '/src/styles.css';import '/src/dark-theme.css';import '/src/modal-system.css';import '/src/workspace-layout.css';
const mode=new URLSearchParams(location.search).get('mode')||'bug';
const session={token:'optional-fixture',user:{id:'reviewer',name:'QA',email:'qa@example.test',role:'admin'}};
sessionStorage.write(session);setCurrentScope('project','app');
window.calls=[];window.writes=[];
function stub(object,prefix=''){for(const [key,value] of Object.entries(object)){const path=prefix?prefix+'.'+key:key;if(typeof value==='function')object[key]=async(...args)=>{window.calls.push({path,args});return []};else if(value&&typeof value==='object')stub(value,path)}}stub(api);
const flags={flags:Object.fromEntries(Object.values(permissionFeatures).flat().map(key=>[key,true]))};
const disabled=['hellotest.manual.test_cases','hellotest.manual.suites','hellotest.manual.runs','hellotest.manual.environments','hellotest.manual.test_data','hellotest.ai.knowledge','hellotest.ai.test_authoring','hellotest.ai.bug_triage','hellotest.ai.requirement_design','hellotest.api.integrations',mode==='bug'?'hellotest.manual.requirements':'hellotest.manual.bugs'];
disabled.forEach(key=>flags.flags[key]=false);
api.featureFlags.snapshot=async()=>flags;api.auth.session=async()=>session;
api.settings.getLocalization=async()=>({strings:{}});api.settings.getWorkspacePreferences=async()=>({preferences:{}});
api.projects.list=async()=>[{id:'project',name:'Project',display_id:'PRJ_1'}];
api.appTypes.list=async()=>[{id:'app',project_id:'project',name:'Web',type:'web'}];
api.projectMembers.list=async()=>[];
api.metadata.domain=async()=>({requirements:{default_status:'open',statuses:[{value:'open',label:'Open',category_key:'new'}]},issues:{default_status:'open',statuses:[{value:'open',label:'Open'}]},jira:{sprints:[],versions:[]}});
const metadata={fields:[],core_fields:[],required_fields:[],workflow_statuses:{statuses:[{value:'open',label:'Open'}],default_status:'open'}};
api.issues.createMetadata=async()=>metadata;api.issues.editMetadata=async()=>metadata;
let bug={id:'bug-1',project_id:'project',user_id:'reviewer',title:'Saved checkout bug',message:'Observed failure',status:'open',priority:'3',revision:1,linked_requirement_ids:['story-linked'],linked_test_case_ids:['case-linked'],linked_test_suite_ids:['suite-linked'],linked_module_ids:['module-linked'],linked_test_run_id:'run-linked',labels:[],created_at:'2026-09-16T00:00:00Z'};
api.issues.get=async()=>bug;api.issues.catalogPage=async()=>({items:[bug],is_last:true});api.issues.metrics=async()=>({total:1,converted:0,statuses:{open:1}});
api.issues.update=async(id,input)=>{window.writes.push({kind:'bug',id,input});bug={...bug,...input,revision:2};return{updated:true}};
api.issues.create=async input=>{window.writes.push({kind:'new-bug',input});bug={...bug,...input,id:'new-bug'};return{id:'new-bug'}};
let story={id:'story-1',display_id:'ST_1',project_id:'project',app_type_id:'app',title:'Saved checkout Story',description:'As a shopper I complete checkout',status:'open',priority:3,gherkin_scenarios:[],labels:[],test_case_ids:['case-linked'],test_cases:[{id:'case-linked',title:'Linked case'}],defect_ids:['bug-linked'],defects:[{id:'bug-linked',title:'Linked bug',status:'open'}],external_references:[],iteration_id:null,sprint:'',release:'',fix_version:'',created_at:'2026-09-16T00:00:00Z',updated_at:'2026-09-16T00:00:00Z'};
api.requirements.get=async(id,input)=>{window.calls.push({path:'requirements.get',args:[id,input]});return story};
api.requirements.listPage=async input=>{window.calls.push({path:'requirements.listPage',args:[input]});return{items:[story],is_last:true}};
api.requirements.metrics=async input=>{window.calls.push({path:'requirements.metrics',args:[input]});return{all:{total:1,mapped:1,coveragePercent:100},backlog:{total:1,mapped:1},sprints:{total:0},filter_options:{},sprint_health:[]}};
api.requirements.createMetadata=async()=>metadata;api.requirements.editMetadata=async()=>metadata;
api.requirements.update=async(id,input)=>{window.writes.push({kind:'story',id,input});story={...story,...input};return{updated:true}};
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});client.setQueryData(['feature-flags'],flags);
window.toggleCases=enabled=>{flags.flags['hellotest.manual.test_cases']=enabled;client.setQueryData(['feature-flags'],{...flags,flags:{...flags.flags}})};
const router=createMemoryRouter([{path:'/issues',element:<IssuesPage/>},{path:'/requirements',element:<RequirementsPage workspaceMode='stories'/>}],{initialEntries:[mode==='bug'?'/issues?issue=bug-1':'/requirements?requirement=story-1']});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId='reviewer'><main style={{height:'100vh',overflowY:'auto',padding:24}}><RouterProvider router={router}/></main></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;

test('Bug and Story edits preserve unavailable relationships and avoid optional API requests', {timeout:120000},async()=>{
 const name='optional-hosts-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
 try{
  await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);await writeFile(tsx,fixture);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  await mkdir('/tmp/qaira-optional-hosts',{recursive:true});
  for(const mode of ['bug','story']){
   const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.stack));page.setDefaultTimeout(20000);
   await page.goto((process.env.VITE_TEST_URL||'http://127.0.0.1:5186')+'/'+name+'.html?mode='+mode);
   const title=page.getByLabel(mode==='bug'?'Bug Title':'Story Title');
   try { await title.fill('Edited '+mode+' with optional features disabled'); } catch(error) { console.error({errors,body:(await page.locator('body').innerText()).slice(0,6000)}); throw error; }
   await page.getByRole('button',{name:mode==='bug'?'Update Bug':'Save Story',exact:true}).click();
   await page.waitForFunction(()=>window.writes.length===1);
   const write=await page.evaluate(()=>window.writes[0]);
   if(mode==='bug')for(const key of ['linked_requirement_ids','linked_test_case_ids','linked_test_suite_ids','linked_module_ids','linked_test_run_id'])assert.equal(Object.hasOwn(write.input,key),false,key+' retained by omission');
   const calls=await page.evaluate(()=>window.calls);
   const forbidden=['testCases.','testCaseModules.','testSuites.','executions.','executionResults.','testEnvironments.','sharedStepGroups.','integrations.','knowledgeRepo.','requirementTestCases.','requirementDefects.','users.list'];
   if(mode==='bug')forbidden.push('requirements.','requirementIterations.','requirementReleases.');else forbidden.push('issues.');
   assert.deepEqual(calls.filter(call=>forbidden.some(prefix=>call.path.startsWith(prefix))),[],mode+' optional APIs remain idle');
   if(mode==='story')assert.equal(calls.filter(call=>['requirements.get','requirements.listPage','requirements.metrics'].includes(call.path)).some(call=>call.args.at(-1)?.include_execution===true),false,'No execution enrichment without Runs');
   assert.equal(await page.locator('.screen-loading-overlay').count(),0);
   await page.screenshot({path:'/tmp/qaira-optional-hosts/'+mode+'.png'});assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)])}
});
