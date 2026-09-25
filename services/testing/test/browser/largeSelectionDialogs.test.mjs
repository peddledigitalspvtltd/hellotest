import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);

// Actual dialogs inside the actual workspace shell; every API is isolated.
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {createMemoryRouter,RouterProvider} from 'react-router-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider} from '/src/auth/AuthContext';import {LocalizationProvider} from '/src/context/LocalizationContext';import {AppShell} from '/src/platform/components/AppShell';import {SuiteCreateModal} from '/services/testing/frontend/components/SuiteCreateModal';import {ExecutionsPage} from '/services/testing/frontend/pages/ExecutionsPage';import {api,sessionStorage} from '/src/lib/api';import {setCurrentScope} from '/src/platform/hooks/useCurrentProject';
import '@fontsource/inter/400.css';import '@fontsource/inter/500.css';import '@fontsource/inter/600.css';import '@fontsource/inter/700.css';import '@fontsource/hanken-grotesk/400.css';import '@fontsource/hanken-grotesk/500.css';import '@fontsource/hanken-grotesk/600.css';import '@fontsource/hanken-grotesk/700.css';
import '/src/styles.css';import '/src/dark-theme.css';import '/src/catalog-list.css';import '/src/modal-system.css';import '/src/execution-run-builder.css';import '/src/workspace-layout.css';
const session={token:'large-selection-fixture',user:{id:'reviewer',name:'Reviewer',email:'reviewer@example.test',role:'admin'}};sessionStorage.write(session);setCurrentScope('project','app');
function stub(value){for(const [key,entry] of Object.entries(value)){if(typeof entry==='function')value[key]=async()=>[];else if(entry&&typeof entry==='object')stub(entry)}}stub(api);
const cases=Array.from({length:450},(_,index)=>({id:'case-'+(index+1),display_id:'TC-'+(index+1),title:'Case '+(index+1)+' validates customer checkout and the persistence of a long parameter '+('VeryLongUnbrokenReference'.repeat(5)),description:'A saved test case',project_id:'project',app_type_id:'app',status:'approved',priority:2,automated:'yes',requirement_ids:[],suite_ids:[],module_ids:[],steps:[]}));
const suites=Array.from({length:120},(_,index)=>({id:'suite-'+(index+1),name:'Suite '+(index+1)+' covering customer checkout and payment persistence with an extensive suite title',project_id:'project',app_type_id:'app',parent_id:null,test_case_ids:cases.slice(index,index+8).map(item=>item.id),test_case_count:8}));
const project={id:'project',name:'Commerce platform',app_type_ids:['app']},app={id:'app',name:'Web app',project_id:'project',type:'web'};
api.auth.session=async()=>session;api.settings.getLocalization=async()=>({strings:{}});api.settings.getWorkspacePreferences=async()=>({preferences:{}});api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});api.projects.list=async()=>[project];api.appTypes.list=async()=>[app];api.metadata.workspaceScopes=async()=>({projects:[project]});api.notifications.unreadCount=async()=>({total:0,by_preference:{}});api.metadata.domain=async()=>({});
window.releaseCases=()=>{};let hold=false,gate=Promise.resolve();window.pauseCases=()=>{hold=true;gate=new Promise(resolve=>window.releaseCases=()=>{hold=false;resolve()})};
const casePage=async(query={})=>{if(hold)await gate;let items=cases;if(query.ids){const ids=new Set(query.ids.split(','));items=items.filter(item=>ids.has(item.id))}if(query.search)items=items.filter(item=>item.title.toLowerCase().includes(query.search.toLowerCase()));const offset=Number(query.cursor||0),size=query.page_size||25;return {items:items.slice(offset,offset+size),next_cursor:offset+size<items.length?String(offset+size):null,is_last:offset+size>=items.length}};
api.testCases.listPicker=casePage;api.testCases.listPage=casePage;api.testCases.list=async()=>cases;api.testSuites.list=async()=>suites;api.testSuites.get=async id=>suites.find(item=>item.id===id);api.testCaseModules.list=async()=>[];
api.executions.list=async()=>[];api.executions.parameterPlan=async input=>({case_count:input.test_case_ids?.length||0,suite_count:input.suite_ids?.length||0,expected_instance_count:input.test_case_ids?.length||0,parameters:[]});
window.saved=[];api.executions.create=async input=>{window.saved.push(input);return {id:'created-run'}};api.executions.get=async id=>({id,name:'Created run',project_id:'project',app_type_id:'app',status:'queued',test_case_ids:[],suite_ids:[],case_snapshots:[],step_snapshots:[]});
function SuiteScreen(){const [open,setOpen]=useState(false);window.openSuite=()=>setOpen(true);return <section className='page-content'><h1>Test Case library</h1><button type='button' onClick={()=>setOpen(true)}>Open large suite</button><div aria-label='Background library'>{cases.map(item=><p key={item.id}>{item.title}</p>)}</div>{open&&<SuiteCreateModal mode='create' projectId='project' appTypeId='app' suite={null} childSuites={suites} appTypeCases={[]} availableLabels={[]} canConfigureParallelAutomation selectedCaseIds={cases.slice(0,400).map(item=>item.id)} onClose={()=>setOpen(false)} onSubmit={input=>window.saved.push(input)} isSaving={false}/>}</section>}
const router=createMemoryRouter([{path:'/',element:<AppShell/>,children:[{path:'test-cases',element:<SuiteScreen/>},{path:'executions',element:<ExecutionsPage/>}]}],{initialEntries:['/test-cases']});
window.openRun=()=>router.navigate('/executions?create=1&project=project',{state:{createRun:{projectId:'project',appTypeId:'app',testCaseIds:cases.slice(0,400).map(item=>item.id),release:'',sprint:''}}});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AuthProvider><LocalizationProvider userId='reviewer'><RouterProvider router={router}/></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;

async function geometry(dialog) {
  return dialog.evaluate(node => {
    const read = element => element && ({...element.getBoundingClientRect().toJSON(), scrollTop:element.scrollTop, scrollWidth:element.scrollWidth, clientWidth:element.clientWidth, scrollHeight:element.scrollHeight, clientHeight:element.clientHeight, overflow:getComputedStyle(element).overflow});
    return {viewport:{width:innerWidth,height:innerHeight},frame:read(node),backdrop:read(node.parentElement),header:read(node.querySelector('.suite-create-header,.execution-create-header')),footer:read(node.querySelector('.suite-modal-actions,.execution-run-builder-footer')),body:read(node.querySelector('.suite-modal-body,.execution-create-body')),list:read(node.querySelector('.test-case-picker-results')),documentWidth:document.documentElement.scrollWidth,documentTop:document.scrollingElement.scrollTop,ancestors:[...function*(element){while(element){yield element;element=element.parentElement}}(node.parentElement)].map(el=>({class:el.className,transform:getComputedStyle(el).transform,contain:getComputedStyle(el).contain,overflow:getComputedStyle(el).overflow,rect:el.getBoundingClientRect().toJSON()}))};
  });
}

async function assertContained(dialog,label) {
  const bounds=await geometry(dialog),size=bounds.viewport;
  assert.ok(bounds.frame.top>=-1&&bounds.frame.bottom<=size.height+1,label+': dialog stays in viewport');
  assert.ok(bounds.header.top>=bounds.frame.top&&bounds.header.bottom<=bounds.frame.bottom,label+': header stays visible');
  assert.ok(bounds.footer.top>=bounds.header.bottom&&bounds.footer.bottom<=bounds.frame.bottom+1,label+': footer stays visible');
  assert.ok(bounds.frame.scrollWidth<=bounds.frame.clientWidth+1,label+': dialog has no horizontal overflow');
  assert.ok(bounds.documentWidth<=size.width+1,label+': background has no horizontal overflow');
  assert.equal(bounds.frame.scrollTop,0,label+': outer dialog never scrolls');
  assert.deepEqual([bounds.backdrop.left,bounds.backdrop.top,bounds.backdrop.width,bounds.backdrop.height],[0,0,size.width,size.height],label+': backdrop covers the entire workspace');
}

async function backgroundPosition(page) {
  return page.evaluate(()=>[document.scrollingElement,document.getElementById('root'),document.querySelector('.workspace-main'),document.querySelector('.nav-list')].map(el=>el?.scrollTop||0));
}

test('large case selections remain contained in real workspace Suite and Run dialogs', {timeout:180000}, async () => {
  const name='large-selection-dialogs-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
  const artifacts=process.env.BROWSER_SCREENSHOT_DIR||'/tmp/qaira-large-selection-dialogs';
  try {
    await writeFile(tsx,fixture);await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);await mkdir(artifacts,{recursive:true});
    browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'no-preference'});page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>{errors.push('Unexpected API '+route.request().url());return route.abort()});
    await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5186'}/${name}.html`,{waitUntil:'domcontentloaded',timeout:60000});await page.getByRole('button',{name:'Open large suite',exact:true}).waitFor();
    await page.evaluate(()=>{window.scrollTo(0,400);window.pauseCases();window.openSuite()});
    await page.locator('.suite-authoring-modal').waitFor();
    await assertContained(page.locator('.suite-authoring-modal'),'loading selected names');
    await page.evaluate(()=>window.releaseCases());
    for(const kind of ['suite','run']){
      if(kind==='run')await page.evaluate(()=>window.openRun());
      const dialog=page.locator(kind==='suite'?'.suite-authoring-modal':'.execution-run-builder-modal');await dialog.waitFor();
      await page.waitForFunction(()=>document.querySelectorAll('[role=dialog] .test-case-picker-row.is-selected').length===400);
      if(kind==='run'){
        await dialog.locator('.suite-scope-picker').getByRole('button',{name:'Select all',exact:true}).click();
        assert.equal(await dialog.locator('.suite-case-picker-option.is-selected').count(),120,'all 120 suites are included in the stress selection');
      }
      for(const size of [{width:1440,height:900},{width:1024,height:650},{width:768,height:600},{width:390,height:700},{width:320,height:480},{width:900,height:400}]){
        await page.setViewportSize(size);
        const label=kind+' '+size.width+'×'+size.height;
        await assertContained(dialog,label);
        const before=await backgroundPosition(page);await page.mouse.move(2,2);await page.mouse.wheel(0,550);await page.waitForTimeout(100);
        assert.deepEqual(await backgroundPosition(page),before,label+': wheel over the backdrop cannot move the background');
        const lowerUp=dialog.getByRole('button',{name:/^Move Case 400 .* up$/});
        await lowerUp.click();
        assert.equal(await lowerUp.evaluate(el=>el===document.activeElement),true,label+': reordering the last selected case preserves focus');
        await dialog.getByRole('button',{name:/^Move Case 400 .* down$/}).click();
        await assertContained(dialog,label+' after reordering');
        const nestedScroll=await dialog.evaluate(node=>[...node.querySelectorAll('.suite-modal-picker-shell,.test-case-picker--inline')].map(el=>el.scrollTop));
        assert.ok(nestedScroll.every(top=>top===0),label+': clipping wrappers do not scroll to conceal picker controls');
        const list=dialog.locator('.test-case-picker-results').first();
        await list.evaluate(el=>el.scrollTop=0);await list.hover();await page.mouse.wheel(0,350);await page.waitForFunction(()=>document.querySelector('[role=dialog] .test-case-picker-results').scrollTop>0);
        assert.deepEqual(await backgroundPosition(page),before,label+': picker wheel only moves dialog content');
        await assertContained(dialog,label+' after wheel');
        for(const theme of size.width===390?['light','dark']:['light']){
          await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
          await page.screenshot({path:artifacts+'/'+kind+'-'+size.width+'x'+size.height+'-'+theme+'.png'});
        }
        await page.evaluate(()=>document.documentElement.dataset.theme='light');
        if(process.env.DIALOG_DIAGNOSTIC)console.log(label,JSON.stringify(await geometry(dialog)));
      }
      await dialog.locator('.test-case-picker--inline').getByRole('button',{name:'Clear',exact:true}).click();
      assert.equal(await dialog.locator('.test-case-picker-row.is-selected').count(),0,'clearing a large selection removes selected rows');
      await assertContained(dialog,kind+' after clearing');
      if(kind==='suite')await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    }
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await Promise.all([unlink(html).catch(()=>{}),unlink(tsx).catch(()=>{})]);}
});
