// Real split actions with isolated API responses; no backend reads or writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '/src/auth/AuthContext';
import { LocalizationProvider } from '/src/context/LocalizationContext';
import { TestCasesPage } from '/services/testing/frontend/pages/TestCasesPage';
import { RequirementsPage } from '/services/manual/frontend/pages/RequirementsPage';
import { CreateRunActionButton } from '/services/testing/frontend/components/CreateRunActionButton';
import { ReportBugSplitActionButton } from '/services/testing/frontend/components/ReportBugSplitActionButton';
import { api, sessionStorage } from '/src/lib/api';
import { setCurrentScope } from '/src/platform/hooks/useCurrentProject';
import '/src/styles.css';
import '/src/dark-theme.css';
import '/src/modal-system.css';
import '/src/workspace-layout.css';
import '/src/catalog-list.css';
import '/src/execution-run-builder.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/hanken-grotesk/500.css';
const session={token:'split-actions-browser',user:{id:'reviewer',name:'QA Reviewer',email:'reviewer@example.test',role:'admin'}};
sessionStorage.write(session);setCurrentScope('split-project','split-app');
localStorage.setItem('hellotest.default_catalog_view_mode','tile');
window.actionCalls=[];
function stub(object){for(const [key,value] of Object.entries(object)){if(typeof value==='function')object[key]=async()=>[];else if(value&&typeof value==='object')stub(value)}}
stub(api);
api.auth.session=async()=>session;
api.settings.getLocalization=async()=>({strings:{}});
api.settings.getWorkspacePreferences=async()=>({preferences:{}});
const flags={flags:new Proxy({},{get:()=>true})};api.featureFlags.snapshot=async()=>flags;
api.projects.list=async()=>[{id:'split-project',name:'Split action project'}];
api.appTypes.list=async()=>[{id:'split-app',project_id:'split-project',name:'Web application',type:'web'}];
api.metadata.domain=async()=>({test_cases:{default_status:'active',default_automated:'no',statuses:[{value:'active',label:'Active'}]},requirements:{default_status:'open',statuses:[{value:'open',label:'Open',category_key:'new'}]},jira:{sprints:[],versions:[]}});
const cases=[{id:'case-one',display_id:'TC_7001',app_type_id:'split-app',title:'Checkout coverage',description:'Verify checkout',suite_id:null,suite_ids:[],requirement_id:null,requirement_ids:[],module_ids:[],defect_ids:[],labels:[],external_references:[],automated:'no',automation_status:'not_automated',authoring_mode:'structured',test_case_type:'functional',priority:3,status:'active',review_status:'not_requested',step_count:1,run_count:0,recent_results:[],detail_complete:false,summary_complete:true,created_at:'2026-09-15T10:00:00Z',updated_at:'2026-09-15T10:00:00Z'}];
api.testCases.listPage=async()=>({items:cases,next_cursor:null,is_last:true});
const health={count:1,traceabilityPercent:0,executablePercent:100,automationPercent:0,summaryComplete:true,unknownSummaryCount:0,executionPercent:0,passRatePercent:null,latestPassRatePercent:null,stabilityPercent:null,averageExecutionMs:null,executionDurationSampleCount:0,pendingReviewCount:0,defectCount:0,defectDensity:0,riskCount:0};
api.testCases.metrics=async()=>({coverage:{total:1,covered:0,automated:0,automationKnown:1,withHistory:0,withSuites:0},catalog:{total:1,automationPercent:0,blocked:0,failed:0,critical:0,averageExecutionMs:null,executionDurationSampleCount:0,finalizedResults:0,passedResults:0,recentPassRate:null},modules:{},unassigned:health});
const stories=[{id:'story-one',display_id:'ST-1',project_id:'split-project',app_type_id:'split-app',title:'Checkout Story',description:'As a shopper I complete checkout',status:'open',priority:2,gherkin_scenarios:[],specification_format:'structured',specification_content:'',iteration_id:null,sprint_id:null,sprint:'',release:'',fix_version:'',scrum_team_id:null,labels:[],test_case_ids:[],linked_test_case_ids:[],external_references:[],test_case_count:0,defect_count:0,created_at:'2026-09-15T10:00:00Z',updated_at:'2026-09-15T10:00:00Z'}];
api.requirements.list=async()=>stories;
api.requirements.listPage=async()=>({items:stories,next_cursor:null,is_last:true});
const metric={total:1,mapped:0,highPriority:1,open:1,completed:0,qaTotal:0,totalDefects:0,completionPercent:0,coveragePercent:0,defectDensity:0,groomed:1,notGroomed:0,described:1,specified:1,teamAssigned:0,slipped:0,onCourse:0,sprintCommitted:0,releaseScoped:0,backlog:1};
api.requirements.metrics=async()=>({all:metric,backlog:metric,sprints:{...metric,total:0},sprint_health:[],filter_options:{statuses:['open'],labels:[],sprints:[],fix_versions:[],releases:[]}});
api.requirements.createMetadata=async()=>({});
function SharedActions(){return <section style={{display:'grid',gap:24,justifyItems:'start'}}><h1>Shared split actions</h1>{['TEST_SUITES','TEST_RUNS'].map(source=><div key={source} data-fixture-source={source}><CreateRunActionButton source={source} projectId="split-project" onCreateManualRun={()=>window.actionCalls.push(source+':manual')} onCreateLocalRun={()=>window.actionCalls.push(source+':local')} onCreateRemoteRun={()=>window.actionCalls.push(source+':remote')}/></div>)}<div data-fixture-source="BUG"><ReportBugSplitActionButton canUseAi onReportBug={()=>window.actionCalls.push('bug:manual')} onReportBugWithAi={()=>window.actionCalls.push('bug:ai')}/></div><div data-fixture-source="DISABLED"><CreateRunActionButton source="TEST_CASES" disabled onCreateManualRun={()=>window.actionCalls.push('unexpected')} onCreateLocalRun={()=>window.actionCalls.push('unexpected')} onCreateRemoteRun={()=>window.actionCalls.push('unexpected')}/></div><div data-fixture-source="NO_AI"><ReportBugSplitActionButton onReportBug={()=>window.actionCalls.push('bug:manual')}/></div></section>}
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});client.setQueryData(['feature-flags'],flags);
const router=createMemoryRouter([{path:'/test-cases',element:<TestCasesPage/>},{path:'/requirements',element:<RequirementsPage workspaceMode="stories"/>},{path:'/shared',element:<SharedActions/>}],{initialEntries:['/test-cases']});
window.fixtureNavigate=to=>router.navigate(to);
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId="reviewer"><main style={{height:'100vh',overflowY:'auto',padding:16,boxSizing:'border-box'}}><RouterProvider router={router}/></main></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;

// Compare rendered values rather than implementation classes or hardcoded themes.
async function inspectMenu(page, toggle, label) {
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
  const menu = page.locator('[data-split-action-menu]');
  await menu.waitFor({state:'visible'});
  await page.mouse.move(1,1);
  await page.waitForTimeout(120);
  const actual = await toggle.evaluate(button=>{
    const parent=button.parentElement,main=parent.querySelector('button'),label=main.querySelector('span')||main;
    const root=getComputedStyle(parent),primary=getComputedStyle(main),text=getComputedStyle(label);
    const hasPaint=primary.backgroundImage!=='none'||!['transparent','rgba(0, 0, 0, 0)'].includes(primary.backgroundColor);
    const paint=hasPaint?primary:root;
    const menu=document.querySelector('[data-split-action-menu]'),bounds=menu.getBoundingClientRect();
    return {parent:{backgroundImage:paint.backgroundImage,backgroundColor:paint.backgroundColor,color:text.color,fontSize:text.fontSize,fontWeight:text.fontWeight,fontFamily:text.fontFamily,radius:parseFloat(root.borderTopLeftRadius),height:parent.getBoundingClientRect().height},
      bounds:{x:bounds.x,y:bounds.y,right:bounds.right,bottom:bounds.bottom,width:bounds.width},viewport:{width:innerWidth,height:innerHeight},
      rows:[...menu.querySelectorAll(':scope > [role="menuitem"]')].map(row=>{
        const style=getComputedStyle(row),strong=row.querySelector('strong'),text=getComputedStyle(strong),rect=row.getBoundingClientRect(),icon=row.querySelector('svg')?.getBoundingClientRect(),copy=strong.getBoundingClientRect(),iconWrapper=row.querySelector('.run-action-option-icon');
        return {label:strong.textContent,backgroundImage:style.backgroundImage,backgroundColor:style.backgroundColor,color:text.color,fontSize:text.fontSize,fontWeight:text.fontWeight,fontFamily:text.fontFamily,radius:parseFloat(style.borderTopLeftRadius),height:rect.height,scrollWidth:row.scrollWidth,clientWidth:row.clientWidth,textWidth:strong.scrollWidth,textClientWidth:strong.clientWidth,iconGap:icon?copy.x-icon.right:null,iconCenter:icon?Math.abs(icon.y+icon.height/2-(rect.y+rect.height/2)):null,iconWrapperBackground:iconWrapper?getComputedStyle(iconWrapper).backgroundColor:null,textInside:copy.x>=rect.x&&copy.right<=rect.right+.5};
      })};
  });
  assert.ok(actual.rows.length>0,label+': menu has options');
  assert.ok(actual.bounds.x>=9.5&&actual.bounds.right<=actual.viewport.width-9.5,label+': menu stays inside the viewport horizontally');
  assert.ok(actual.bounds.y>=9.5&&actual.bounds.bottom<=actual.viewport.height-9.5,label+': menu stays inside the viewport vertically');
  for(const row of actual.rows){
    for(const property of ['backgroundImage','backgroundColor','color','fontSize','fontWeight','fontFamily'])assert.equal(row[property],actual.parent[property],label+' / '+row.label+': '+property+' matches its parent');
    assert.ok(Math.abs(row.radius-actual.parent.radius)<=.5,label+' / '+row.label+': corner radius matches its parent');
    assert.ok(row.height>=actual.parent.height-.5,label+' / '+row.label+': at least the parent button height');
    assert.ok(row.scrollWidth<=row.clientWidth+1&&row.textInside&&(!row.textClientWidth||row.textWidth<=row.textClientWidth+1),label+' / '+row.label+': text fits without clipping or horizontal overflow');
    assert.ok(row.iconGap>=3&&row.iconCenter<=1,label+' / '+row.label+': icon and text have a gap and are vertically centered');
    if(row.iconWrapperBackground!==null)assert.equal(row.iconWrapperBackground,'rgba(0, 0, 0, 0)',label+' / '+row.label+': icon has no separate background bubble');
  }
  return menu;
}

test('split action menus inherit parent appearance, remain usable at mobile widths, and preserve actions', {timeout:180000}, async()=>{
  const name='split-action-menus-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);
  const artifacts=process.env.BROWSER_SCREENSHOT_DIR||'/tmp/qaira-split-action-menus';let browser;
  try{
    await writeFile(html,`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx,fixture);await mkdir(artifacts,{recursive:true});
    browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const requests=[];await context.route('**/api/**',route=>{requests.push(route.request().url());return route.fulfill({status:500,contentType:'application/json',body:'{}'})});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
    await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5186'}/${name}.html`);
    await page.locator('.test-case-catalog-card').waitFor();
    const testCaseToggle=()=>page.getByRole('button',{name:'Open create test case options',exact:true});
    let menu=await inspectMenu(page,testCaseToggle(),'Create Test Case');
    assert.deepEqual(await menu.getByRole('menuitem').allTextContents(),['Bulk Import','AI Test Cases Generation']);
    // The portal must follow its still-open parent when theme or viewport changes.
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    await inspectMenu(page,testCaseToggle(),'Create Test Case after live dark-theme switch');
    await page.setViewportSize({width:320,height:1000});
    await inspectMenu(page,testCaseToggle(),'Create Test Case after live resize to 320px');
    await page.screenshot({path:artifacts+'/test-cases-live-resize-dark-320.png'});
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(()=>document.documentElement.dataset.theme='light');
    menu=await inspectMenu(page,testCaseToggle(),'Create Test Case after live resize back to desktop');
    await menu.getByRole('menuitem',{name:'Bulk Import',exact:true}).click();
    await page.getByRole('dialog',{name:'Import test cases from external sources'}).waitFor();
    assert.equal(await page.locator('[data-split-action-menu]').count(),0,'Import selection closes the menu');
    await page.getByRole('button',{name:'Close bulk import',exact:true}).click();
    await testCaseToggle().click();await page.getByRole('menuitem',{name:'AI Test Cases Generation',exact:true}).click();
    await page.getByRole('button',{name:'Close AI Test Case Generator',exact:true}).waitFor();
    await page.getByRole('button',{name:'Close AI Test Case Generator',exact:true}).click();
    for(const width of [1440,390,320]){
      await page.setViewportSize({width,height:1000});
      for(const theme of ['light','dark']){
        await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        await page.evaluate(()=>window.fixtureNavigate('/test-cases'));
        menu=await inspectMenu(page,testCaseToggle(),`Test Cases ${theme} ${width}`);
        await page.screenshot({path:artifacts+`/test-cases-${theme}-${width}.png`});
        await page.keyboard.press('Escape');assert.equal(await page.locator('[data-split-action-menu]').count(),0,'Escape dismisses Test Case options');
        await page.evaluate(()=>window.fixtureNavigate('/requirements'));
        menu=await inspectMenu(page,page.getByRole('button',{name:'Open create Story options',exact:true}),`Stories ${theme} ${width}`);
        await page.screenshot({path:artifacts+`/stories-${theme}-${width}.png`});
        if(width===1440&&theme==='light'){
          await page.keyboard.press('End');
          const focused=await menu.getByRole('menuitem').last().evaluate(item=>({active:document.activeElement===item,outline:getComputedStyle(item).outlineStyle,width:parseFloat(getComputedStyle(item).outlineWidth)}));
          assert.equal(focused.active,true,'Stories retain keyboard navigation to the final action');
          assert.ok(focused.outline!=='none'&&focused.width>0,'Keyboard focus remains visible on matched menu rows');
          await menu.getByRole('menuitem',{name:'Bulk Import Stories',exact:false}).click();
          await page.getByRole('dialog',{name:'Bulk import Stories'}).waitFor();
          await page.keyboard.press('Escape');
        }else{await page.keyboard.press('Escape')}
        await page.evaluate(()=>window.fixtureNavigate('/shared'));
        for(const source of ['TEST_SUITES','TEST_RUNS','BUG']){
          const container=page.locator(`[data-fixture-source="${source}"]`),toggle=container.getByRole('button',{name:source==='BUG'?'Choose bug reporting method':'Open create run options',exact:true});
          menu=await inspectMenu(page,toggle,`${source} ${theme} ${width}`);
          if(source==='BUG'&&width===1440){
            await container.getByRole('button',{name:'Report Bug',exact:true}).hover();
            await page.waitForTimeout(220);
            const paint=await toggle.evaluate(toggle=>{
              const parent=getComputedStyle(toggle.parentElement),row=getComputedStyle(document.querySelector('[data-split-action-menu] > [role="menuitem"]'));
              return {parentImage:parent.backgroundImage,rowImage:row.backgroundImage,rowColor:row.color,expanded:toggle.getAttribute('aria-expanded')};
            });
            assert.equal(paint.expanded,'true','Hovering the primary action leaves the menu open');
            assert.notEqual(paint.parentImage,'none','Report Bug retains its blue gradient');
            assert.equal(paint.rowImage,paint.parentImage,'A translucent primary hover overlay does not replace the dropdown blue gradient');
            assert.equal(paint.rowColor,'rgb(255, 255, 255)','Report Bug options retain white labels during primary hover');
          }
          await page.screenshot({path:artifacts+`/${source.toLowerCase()}-${theme}-${width}.png`});
          if(width===1440&&theme==='light'){
            await menu.getByRole('menuitem',{name:source==='BUG'?'Report Bug using AI':'Local Run',exact:true}).click();
            assert.equal(await page.locator('[data-split-action-menu]').count(),0,'Action selection dismisses the menu');
          }else{await page.mouse.click(1,1);assert.equal(await page.locator('[data-split-action-menu]').count(),0,'Outside clicks dismiss the menu')}
        }
        assert.equal(await page.locator('[data-fixture-source="DISABLED"] [aria-haspopup="menu"]').isDisabled(),true,'Disabled Run preserves its disabled menu');
        assert.equal(await page.locator('[data-fixture-source="NO_AI"] [aria-haspopup="menu"]').count(),0,'AI bug option stays hidden when permission is absent');
      }
    }
    assert.deepEqual(await page.evaluate(()=>window.actionCalls),['TEST_SUITES:local','TEST_RUNS:local','bug:ai']);
    assert.deepEqual(errors,[],'No browser exceptions');assert.deepEqual(requests,[],'Fixtures make no backend requests');
  }finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)])}
});
