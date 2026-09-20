import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
const require=createRequire(new URL('../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('../../',import.meta.url);
const fixture=`
import React from 'react';import {createRoot} from 'react-dom/client';import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {AuthProvider} from '/src/auth/AuthContext';import {LocalizationProvider} from '/src/context/LocalizationContext';
import {TestCasesPage} from '/src/pages/TestCasesPage';import {api,sessionStorage} from '/src/lib/api';import {setCurrentScope} from '/src/hooks/useCurrentProject';
import '/src/styles.css';import '/src/dark-theme.css';import '/src/modal-system.css';import '/src/workspace-layout.css';import '/src/catalog-list.css';
const mode=new URLSearchParams(location.search).get('mode')||'structured';
const session={token:'dataset-fixture',user:{id:'author',name:'Author',role:'admin'}};sessionStorage.write(session);setCurrentScope('p','a');
for(const methods of Object.values(api))if(methods&&typeof methods==='object')for(const [key,value] of Object.entries(methods))if(typeof value==='function')methods[key]=async()=>[];
api.auth.session=async()=>session;api.settings.getLocalization=async()=>({strings:{}});api.settings.getWorkspacePreferences=async()=>({preferences:{}});
const flags={flags:new Proxy({},{get:()=>true})};api.featureFlags.snapshot=async()=>flags;
api.metadata.domain=async()=>({test_cases:{default_status:'active',default_automated:'no',statuses:[{value:'active',label:'Active'}]},jira:{sprints:[],versions:[]}});
api.metadata.workspaceScopes=async()=>({projects:[{id:'p',name:'Project',has_access:true}]});api.appTypes.list=async()=>[{id:'a',project_id:'p',name:'Web',type:'web'}];
const data={id:'data',project_id:'p',app_type_id:'a',name:'Checkout data',description:'Reusable customer inputs.',mode:'table',columns:['t.user','r.tenant'],rows:[{'t.user':'Alice','r.tenant':'West'},{'t.user':'Bob','r.tenant':'East'}]};
let item={id:'case1',display_id:'TC-1',app_type_id:'a',title:'Checkout @r.title',description:'Verify checkout',suite_ids:[],module_ids:[],requirement_ids:[],labels:[],external_references:[],automated:'no',authoring_mode:mode,test_case_type:'functional',priority:3,status:'active',review_status:'not_requested',revision:1,author_id:'author',parameter_values:{},test_data_set_ids:['data'],test_data_sets:[data],test_data_options:{override_shared_steps:true},detail_complete:true,step_count:2,gherkin_document:mode==='gherkin'?'@smoke\\n# @unused\\nFeature: Checkout\\nScenario Outline: A purchase\\n Given customer <customer>\\n When selecting @s.region\\n Then amount <amount> is shown':''};
const steps=[{id:'s1',test_case_id:'case1',step_order:1,action:'Sign in @t.user',expected_result:'Welcome @r.tenant',step_type:'web',automation_code:'',api_request:null},{id:'s2',test_case_id:'case1',step_order:2,action:'Use @r.shared',expected_result:'Done',group_id:'g',group_name:'Login',group_kind:'reusable',reusable_group_id:'g',step_type:'web',automation_code:'',api_request:null}];
api.testCases.listPage=async()=>({items:[item],next_cursor:null,is_last:true});api.testCases.list=async()=>[item];api.testCases.get=async()=>item;api.testSteps.list=async()=>steps;
api.testDataSets.list=async()=>[data];window.updates=[];api.testCases.update=async(id,input)=>{window.updates.push(input);item={...item,...input,revision:item.revision+1};return item};
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});client.setQueryData(['feature-flags'],flags);
const router=createMemoryRouter([{path:'/test-cases',element:<TestCasesPage/>}],{initialEntries:['/test-cases?case=case1']});window.navigate=to=>router.navigate(to);
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId='author'><main style={{height:'100vh',overflowY:'auto',padding:24,boxSizing:'border-box'}}><RouterProvider router={router}/></main></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;
test('Test Case datasets keep compact actions, persist the override, and download complete templates in both modes',{timeout:90000},async()=>{
 const name='case-data-'+randomUUID();let browser;
 try{
  await writeFile(new URL(name+'.tsx',root),fixture);await writeFile(new URL(name+'.html',root),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',route=>{errors.push('Unexpected API request');return route.abort()});
  await mkdir('/tmp/qaira-authoring-data',{recursive:true});
  for(const mode of ['structured','gherkin']){
   await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5189'}/${name}.html?mode=${mode}`);
   const section=page.locator('.editor-accordion-section').filter({has:page.locator('.editor-accordion-toggle-copy>strong',{hasText:mode==='gherkin'?'Examples · Linked Test Data':'Data Sets'})});
   await section.waitFor();if(await section.locator('.editor-accordion-toggle').getAttribute('aria-expanded')==='false')await section.locator('.editor-accordion-toggle').click();
   const panel=section.locator('.authoring-data-set-panel');await panel.getByText('Checkout data',{exact:true}).waitFor();
   assert.equal(await panel.locator('.test-case-data-set-columns,table').count(),0);
   const checkbox=panel.getByRole('checkbox',{name:'Override Shared Groups Test Data'});assert.equal(await checkbox.isChecked(),true);
   const order=await checkbox.evaluate(input=>Boolean(input.compareDocumentPosition(input.closest('header').querySelector('button')) & Node.DOCUMENT_POSITION_FOLLOWING));assert.equal(order,true);
   const [download]=await Promise.all([page.waitForEvent('download'),panel.getByRole('button',{name:'Download Test Params Template'}).click()]);
   const csv=await readFile(await download.path(),'utf8');for(const name of mode==='structured'?['r.title','t.user','r.tenant','r.shared']:['r.title','r.customer','r.amount','s.region'])assert.ok(csv.includes('"'+name+'"'),name+' is in '+mode+' template');assert.ok(!csv.includes('Alice')&&!csv.includes('West'));assert.ok(!csv.includes('r.smoke')&&!csv.includes('r.unused'));
   await checkbox.uncheck();await page.getByRole('button',{name:'Save test case',exact:true}).click();await page.waitForFunction(()=>window.updates.some(input=>input.test_data_options?.override_shared_steps===false));
   assert.equal(await checkbox.isChecked(),false);
   await panel.scrollIntoViewIfNeeded();await panel.screenshot({path:'/tmp/qaira-authoring-data/case-'+mode+'.png'});
   await panel.getByRole('button',{name:'Change',exact:true}).click();const picker=page.getByRole('dialog',{name:'Link Existing Data Set'});await picker.waitFor();await page.keyboard.press('Escape');await picker.waitFor({state:'hidden'});
   await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await panel.screenshot({path:'/tmp/qaira-authoring-data/case-'+mode+'-mobile.png'});await page.setViewportSize({width:1440,height:1000});
  }
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all([rm(new URL(name+'.html',root),{force:true}),rm(new URL(name+'.tsx',root),{force:true})]);}
});
