// Production IssuesPage with isolated API responses; no backend reads or writes.
import assert from 'node:assert/strict';
import {assertCountSegments} from './metricStatusBarAssertions.mjs';
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
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/hanken-grotesk/500.css';
const session = {token:'catalog-browser-fixture',user:{id:'reviewer',name:'QA Reviewer',email:'reviewer@example.test',role:'admin'}};
sessionStorage.write(session);
setCurrentScope('catalog-project','catalog-app');
localStorage.setItem('hellotest.default_catalog_view_mode','tile');
window.calls = {all:[],catalog:[],metrics:[],detail:[]};
window.pauseContinuation = true;
function stub(object, prefix='') {
 for (const [key,value] of Object.entries(object)) {
  const path = prefix ? prefix+'.'+key : key;
  if (typeof value === 'function') object[key] = async(...args) => { window.calls.all.push({path,args}); return []; };
  else if (value && typeof value === 'object') stub(value,path);
 }
}
stub(api);
api.auth.session=async()=>session;
api.settings.getLocalization=async()=>({strings:{}});
api.settings.getWorkspacePreferences=async()=>({preferences:{}});
api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});
const statuses=[{value:'open',label:'Open',category_key:'new'},{value:'closed',label:'Closed',category_key:'done'}];
api.metadata.domain=async()=>({issues:{default_status:'open',statuses},jira:{sprints:[],versions:[]}});
const bugs=Array.from({length:60},(_,index)=>{
 const n=index+1;
 return {id:'bug-'+n,display_id:'BUG-'+n,jira_bug_key:'EXT-'+n,project_id:'catalog-project',user_id:'reviewer',user_name:'QA Reviewer',user_email:'reviewer@example.test',
  title:n===60?'Boundary failure beyond the first pages':'Checkout bug '+String(n).padStart(2,'0'),message:'Observed checkout behavior for fixture '+n,
  status:n%4===0?'closed':'open',priority:n%3===0?'High':'Medium',severity:'medium',assignee_id:n%2===0?null:'reviewer',assignee_name:n%2===0?null:'QA Reviewer',
  steps_to_reproduce:'Open checkout and submit',expected_result:'Order completes',actual_result:'An error appears',
  linked_test_case_ids:[],linked_test_suite_ids:[],linked_module_ids:[],linked_requirement_ids:[],labels:[],has_converted_test_cases:n===60,
  created_at:'2026-09-15T10:00:00Z',updated_at:'2026-09-15T10:00:00Z'};
});
function matching(input){
 return bugs.filter(item=>(!input.q||[item.title,item.message,item.display_id].join(' ').toLowerCase().includes(input.q.toLowerCase()))
  &&(!input.status||item.status===input.status)&&(!input.priority||item.priority===input.priority)
  &&(!input.assignee_id||(input.assignee_id==='__unassigned__'?!item.assignee_id:item.assignee_id===input.assignee_id)));
}
api.issues.catalogPage=async(input)=>{
 window.calls.catalog.push(structuredClone(input));
 if(input.cursor&&window.pauseContinuation) await new Promise(resolve=>{window.releaseContinuation=resolve});
 else await new Promise(resolve=>setTimeout(resolve,35));
 const found=matching(input),offset=Number(input.cursor||0),items=found.slice(offset,offset+input.page_size),next=offset+items.length;
 return {items,next_cursor:next<found.length?String(next):null,is_last:next>=found.length};
};
api.issues.metrics=async(input)=>{
 window.calls.metrics.push(structuredClone(input));
 const found=matching(input),open=found.filter(item=>item.status!=='closed'),counts={};
 for(const item of found)counts[item.status]=(counts[item.status]||0)+1;
 return {total:found.length,open:open.length,priority_risks:open.filter(item=>item.priority==='High').length,unassigned:open.filter(item=>!item.assignee_id).length,converted:found.filter(item=>item.has_converted_test_cases).length,statuses:counts};
};
api.issues.get=async(id,input)=>{
 window.calls.detail.push({id,input});
 await new Promise(resolve=>setTimeout(resolve,35));
 const item=bugs.find(item=>[item.id,item.display_id,item.jira_bug_key].includes(id));
 if(!item)throw new Error('Bug not found');
 return structuredClone(item);
};
api.issues.editMetadata=async()=>({fields:[],core_fields:[],required_fields:[],current_values:{},workflow_statuses:{statuses,default_status:'open'}});
api.issues.history=async()=>[];
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
const router=createMemoryRouter([{path:'/issues',element:<IssuesPage/>},{path:'/away',element:<h1>Away from Bugs</h1>}],{initialEntries:['/issues']});
window.fixtureNavigate=to=>router.navigate(to);
window.fixtureRoute=()=>router.state.location.pathname+router.state.location.search;
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId="reviewer"><main className="catalog-test-scroll" style={{height:'100vh',overflowY:'auto',padding:24,boxSizing:'border-box'}}><RouterProvider router={router}/></main></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;

test('Bugs fetch 25 records independently from complete metrics, append on scroll, cache and resolve deep links', { timeout:90000 }, async () => {
  const name = 'catalog-pages-' + randomUUID();
  const html = new URL(name + '.html', root);
  const tsx = new URL(name + '.tsx', root);
  const artifacts = process.env.BROWSER_SCREENSHOT_DIR || '/tmp/qaira-catalog-pages';
  let browser;
  try {
    await writeFile(html, `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, fixture);
    await mkdir(artifacts, { recursive:true });
    browser = await chromium.launch({ headless:true, ...(process.env.CHROME_EXECUTABLE ? { executablePath:process.env.CHROME_EXECUTABLE } : {}) });
    const context = await browser.newContext({ viewport:{width:1440,height:900}, reducedMotion:'reduce' });
    const unexpectedRequests = [];
    await context.route('**/api/**', route => {
      unexpectedRequests.push(route.request().method()+' '+new URL(route.request().url()).pathname);
      return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Unexpected fixture request'})});
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5173'}/${name}.html`);
    await page.waitForFunction(()=>document.querySelectorAll('.issue-catalog-card').length===25);
    const secondTile = page.locator('.issue-catalog-card').nth(1);
    await assertCountSegments(secondTile.locator('.tile-card-progress').nth(0).locator('.metric-status-bar'),4,[{key:'covered',label:'Completed evidence fields',count:4}]);
    await assertCountSegments(secondTile.locator('.tile-card-progress').nth(1).locator('.metric-status-bar'),3,[{key:'covered',label:'Completed triage fields',count:2},{key:'uncovered',label:'Missing triage fields',count:1}]);
    const total = page.getByRole('group',{name:'Defect catalog quality metrics'}).getByRole('button',{name:/View evidence for Total defects/i}).locator('strong');
    assert.equal(await total.innerText(), '60', 'Metrics cover the full catalog beyond the 25 loaded rows');
    await page.waitForTimeout(250);
    let calls = await page.evaluate(()=>window.calls);
    assert.equal(calls.catalog.length,1);
    assert.equal(calls.catalog[0].page_size,25);
    assert.equal(calls.catalog[0].cursor,undefined);
    assert.equal(calls.metrics.length,1);
    assert.equal(calls.all.some(call=>/^(issues|users|executions|testCases|testSuites|requirements|testCaseModules|testEnvironments|requirementIterations|requirementReleases)\.list$/.test(call.path)),false,'Catalog entry does not load supporting catalogs or the unbounded Bugs API');
    assert.equal(await page.getByRole('button',{name:/load more/i}).count(),0);
    await page.screenshot({path:artifacts+'/bugs-first-25.png'});

    await page.locator('.catalog-test-scroll').evaluate(node=>node.scrollTop=node.scrollHeight-node.clientHeight);
    await page.waitForFunction(()=>window.calls.catalog.length===2&&typeof window.releaseContinuation==='function');
    await page.waitForTimeout(220);
    assert.equal(await page.locator('.issue-catalog-card').count(),25,'Existing cards remain while the next page is pending');
    assert.equal(await page.locator('.screen-loading-overlay').count(),0,'Continuation does not show the screen loader');
    assert.equal(await page.getByText('Loading more bugs…',{exact:true}).isVisible(),true);
    const beforeAppend=await page.locator('.catalog-test-scroll').evaluate(node=>node.scrollTop);
    await page.screenshot({path:artifacts+'/bugs-next-page-pending.png'});
    await page.evaluate(()=>{window.pauseContinuation=false;window.releaseContinuation()});
    await page.waitForFunction(()=>document.querySelectorAll('.issue-catalog-card').length===50);
    const afterAppend=await page.locator('.catalog-test-scroll').evaluate(node=>node.scrollTop);
    assert.ok(Math.abs(afterAppend-beforeAppend)<=1,`Appending retains the scroll position (${beforeAppend} -> ${afterAppend})`);
    calls=await page.evaluate(()=>window.calls);
    assert.equal(calls.catalog[1].cursor,'25');
    assert.equal(calls.catalog[1].page_size,25);
    assert.equal(calls.metrics.length,1,'Appending records does not refetch metrics');
    assert.equal(await page.locator('.issue-catalog-card').first().getAttribute('aria-label'),'Open Defect BUG-1: Checkout bug 01');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>window.calls.catalog.length),2,'The catalog stops fetching after filling the viewport');

    const beforeRemount=await page.evaluate(()=>({catalog:window.calls.catalog.length,metrics:window.calls.metrics.length}));
    await page.evaluate(()=>window.fixtureNavigate('/away'));
    await page.getByRole('heading',{name:'Away from Bugs'}).waitFor();
    await page.evaluate(()=>{document.querySelector('.catalog-test-scroll').scrollTop=0;return window.fixtureNavigate('/issues')});
    await page.waitForFunction(()=>document.querySelectorAll('.issue-catalog-card').length===50);
    await page.waitForTimeout(180);
    assert.deepEqual(await page.evaluate(()=>({catalog:window.calls.catalog.length,metrics:window.calls.metrics.length})),beforeRemount,'A recent remount reuses cached pages and metrics');

    await page.getByRole('searchbox',{name:'Search defects'}).fill('boundary');
    await page.waitForFunction(()=>window.calls.catalog.some(call=>call.q==='boundary')&&document.querySelectorAll('.issue-catalog-card').length===1);
    assert.match(await page.locator('.issue-catalog-card').innerText(), /Boundary failure beyond the first pages/);
    assert.equal(await total.innerText(),'1');
    calls=await page.evaluate(()=>window.calls);
    assert.equal(calls.catalog.at(-1).q,'boundary');
    assert.equal(calls.catalog.at(-1).cursor,undefined,'Search starts from the first page');
    assert.equal(calls.metrics.at(-1).q,'boundary');
    await page.screenshot({path:artifacts+'/bugs-server-search.png'});

    await page.getByRole('searchbox',{name:'Search defects'}).fill('');
    await page.waitForFunction(()=>document.querySelectorAll('.issue-catalog-card').length===50);
    const beforeDetail=await page.evaluate(()=>({catalog:window.calls.catalog.length,metrics:window.calls.metrics.length}));
    await page.evaluate(()=>window.fixtureNavigate('/away'));
    await page.getByRole('heading',{name:'Away from Bugs'}).waitFor();
    await page.evaluate(()=>window.fixtureNavigate('/issues?issue=EXT-60'));
    const title=page.getByRole('textbox',{name:'Defect Title'});
    await title.waitFor();
    assert.equal(await title.inputValue(),'Boundary failure beyond the first pages');
    assert.equal(await page.evaluate(()=>window.fixtureRoute()),'/issues?issue=bug-60','External keys canonicalize to the resolved Bug');
    calls=await page.evaluate(()=>window.calls);
    assert.deepEqual({catalog:calls.catalog.length,metrics:calls.metrics.length},beforeDetail,'Deep links do not drain or refetch the catalog');
    assert.deepEqual(calls.detail.map(call=>call.id),['EXT-60']);
    await page.screenshot({path:artifacts+'/bugs-off-page-detail.png'});
    assert.deepEqual(errors,[]);
    assert.deepEqual(unexpectedRequests,[],'All requests are isolated from the real backend');
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html),unlink(tsx)]);
  }
});
