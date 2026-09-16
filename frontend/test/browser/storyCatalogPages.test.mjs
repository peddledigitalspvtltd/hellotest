// Production Stories and Backlog pages with isolated API responses.
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
import { RequirementsPage } from '/src/pages/RequirementsPage';
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
const mode = new URLSearchParams(location.search).get('mode') === 'backlog' ? 'backlog' : 'stories';
const session = {token:'story-catalog-browser-fixture',user:{id:'reviewer',name:'QA Reviewer',email:'reviewer@example.test',role:'admin'}};
sessionStorage.write(session);
setCurrentScope('story-project','story-app');
localStorage.setItem('hellotest.default_catalog_view_mode','tile');
window.calls = {all:[],catalog:[],metrics:[]};
window.pauseContinuation = true;
window.pauseSearch = true;
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
api.projects.list=async()=>[{id:'story-project',name:'Story catalog fixture',display_id:'PRJ-1'}];
api.appTypes.list=async()=>[{id:'story-app',project_id:'story-project',name:'Web',type:'web'}];
api.metadata.domain=async()=>({requirements:{default_status:'open',statuses:[{value:'open',label:'Open',category_key:'new'}]},jira:{sprints:[],versions:[]}});
const stories=Array.from({length:60},(_,index)=>{
 const n=index+1;
 return {id:'story-'+n,display_id:'ST-'+n,project_id:'story-project',app_type_id:'story-app',
  title:n===60?'Boundary scenario beyond the first pages':'Checkout Story '+String(n).padStart(2,'0'),description:'As a shopper I complete checkout for fixture '+n,
  status:'open',priority:2,gherkin_scenarios:['Given a basket When I checkout Then the order completes'],
  specification_format:'gherkin',specification_content:'Scenario: checkout completes',
  iteration_id:null,sprint_id:null,sprint:'',release:'',fix_version:'',scrum_team_id:null,
  labels:[],test_case_ids:[],linked_test_case_ids:[],external_references:[],test_case_count:0,defect_count:0,
  created_at:'2026-09-15T10:00:00Z',updated_at:'2026-09-15T10:00:00Z'};
});
function matching(input) {
 return stories.filter(item=>(!input.search||[item.title,item.description,item.display_id].join(' ').toLowerCase().includes(input.search.toLowerCase()))
  &&(!input.status||item.status===input.status)&&(!input.priority||item.priority===input.priority));
}
api.requirements.listPage=async(input)=>{
 window.calls.catalog.push(structuredClone(input));
 if(input.search&&window.pauseSearch) await new Promise(resolve=>{window.releaseSearch=resolve});
 else if(input.cursor&&window.pauseContinuation) await new Promise(resolve=>{window.releaseContinuation=resolve});
 else await new Promise(resolve=>setTimeout(resolve,35));
 const found=matching(input),offset=Number(input.cursor||0),items=found.slice(offset,offset+input.page_size),next=offset+items.length;
 return {items,next_cursor:next<found.length?String(next):null,is_last:next>=found.length};
};
function metricValues(total) {
 return {total,mapped:0,highPriority:total,open:total,completed:0,qaTotal:0,totalDefects:0,completionPercent:0,coveragePercent:0,defectDensity:0,
  groomed:total,notGroomed:0,described:total,specified:total,teamAssigned:0,slipped:0,onCourse:0,sprintCommitted:0,releaseScoped:0,backlog:total};
}
api.requirements.metrics=async(input)=>{
 window.calls.metrics.push(structuredClone(input));
 const total=matching(input).length;
 return {all:metricValues(total),backlog:metricValues(total),sprints:metricValues(0),sprint_health:[],
  filter_options:{statuses:['open'],labels:[],sprints:[],fix_versions:[],releases:[]},generated_at:'2026-09-15T10:00:00Z'};
};
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
const router=createMemoryRouter([{path:'/requirements',element:<RequirementsPage workspaceMode={mode}/>}],{initialEntries:['/requirements']});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId="reviewer"><main className="story-catalog-test-scroll" style={{height:'100vh',overflowY:'auto',padding:24,boxSizing:'border-box'}}><RouterProvider router={router}/></main></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;

// Follow the same nearest scroll ancestor as the production sentinel.
const scrollCatalogToEnd = async page => page.locator('.requirement-card-list').evaluate(node => {
  let scroller = node.querySelector('.tile-browser-pane-scroll');
  while (scroller && scroller !== document.body) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight + 1) {
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
      scroller.dataset.catalogTestScroller = 'true';
      return;
    }
    scroller = scroller.parentElement;
  }
  throw new Error('The Story catalog has no scrolling ancestor');
});

test('Stories and Backlog load independent metrics and scroll pages without stale filter continuation', { timeout:120000 }, async () => {
  const name = 'story-catalog-pages-' + randomUUID();
  const html = new URL(name + '.html', root);
  const tsx = new URL(name + '.tsx', root);
  const artifacts = process.env.BROWSER_SCREENSHOT_DIR || '/tmp/qaira-catalog-pages';
  let browser;
  try {
    await writeFile(html, `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, fixture);
    await mkdir(artifacts, {recursive:true});
    browser = await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {})});
    for (const mode of ['stories','backlog']) {
      const context = await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
      const unexpectedRequests = [];
      await context.route('**/api/**', route => {
        unexpectedRequests.push(route.request().method()+' '+new URL(route.request().url()).pathname);
        return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Unexpected fixture request'})});
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(10000);
      await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5173'}/${name}.html?mode=${mode}`);
      await page.waitForFunction(()=>document.querySelectorAll('.requirement-catalog-card').length===25);
      const metricLabel = mode === 'stories' ? 'Backlog inventory' : 'Specification ready';
      const metric = page.getByRole('group',{name:'Story health metrics'}).getByRole('button',{name:'View evidence for '+metricLabel}).locator('strong');
      assert.equal(await metric.innerText(),'60',mode+': metrics cover the full catalog');
      await page.waitForTimeout(250);
      let calls = await page.evaluate(()=>window.calls);
      await page.screenshot({path:artifacts+'/'+mode+'-first-25.png'});
      assert.equal(calls.catalog.length,1,mode+': only the first page loads before scrolling');
      assert.equal(calls.catalog[0].page_size,25);
      assert.equal(calls.catalog[0].cursor,undefined);
      assert.equal(calls.catalog[0].unassigned,mode==='backlog');
      assert.equal(calls.catalog[0].include_total,false);
      assert.equal(calls.catalog[0].projection,'summary');
      assert.equal(calls.metrics.length,1);
      assert.equal(calls.metrics[0].include_sprints,false);
      assert.equal(calls.all.some(call=>/^requirements\.list$|^requirementIterations\.listRequirements$|^(testCases|executionResults)\.list$/.test(call.path)),false,'Initial catalogs avoid unbounded Stories, Sprint children, test cases and execution results');
      assert.equal(await page.getByRole('button',{name:/load more/i}).count(),0);

      await scrollCatalogToEnd(page);
      await page.waitForFunction(()=>window.calls.catalog.length===2&&typeof window.releaseContinuation==='function');
      await page.waitForTimeout(220);
      assert.equal(await page.locator('.requirement-catalog-card').count(),25);
      assert.equal(await page.locator('.screen-loading-overlay').count(),0,'Continuation keeps the screen loader hidden');
      const pendingLabel = mode==='stories' ? 'Loading more Stories…' : 'Loading more backlog Stories…';
      assert.equal(await page.getByText(pendingLabel,{exact:true}).isVisible(),true);
      const scrollRoot=page.locator('[data-catalog-test-scroller="true"]');
      const beforeAppend=await scrollRoot.evaluate(node=>node.scrollTop);
      await page.screenshot({path:artifacts+'/'+mode+'-next-page-pending.png'});
      await page.evaluate(()=>{window.pauseContinuation=false;window.releaseContinuation()});
      await page.waitForFunction(()=>document.querySelectorAll('.requirement-catalog-card').length===50);
      const afterAppend=await scrollRoot.evaluate(node=>node.scrollTop);
      assert.ok(Math.abs(afterAppend-beforeAppend)<=1,mode+': appending preserves scroll position');
      assert.equal(await page.locator('.requirement-catalog-card').first().getAttribute('aria-label'),'Open Story ST-1: Checkout Story 01');
      await page.waitForTimeout(150);
      calls=await page.evaluate(()=>window.calls);
      assert.equal(calls.catalog.length,2,'Appending a page does not drain all remaining pages');
      assert.equal(calls.catalog[1].cursor,'25');
      assert.equal(calls.metrics.length,1,'Appending records does not refetch metrics');

      await page.getByRole('textbox',{name:'Search Stories'}).fill('boundary');
      await page.waitForFunction(()=>window.calls.catalog.some(call=>call.search==='boundary')&&typeof window.releaseSearch==='function');
      await page.waitForTimeout(220);
      assert.equal(await page.locator('.requirement-catalog-card').count(),50,'Existing cards remain during a server filter request');
      assert.equal(await page.locator('.hierarchy-auto-load-sentinel').count(),0,'Placeholder pages have no continuation sentinel');
      assert.equal(await page.locator('.screen-loading-overlay').count(),0,'Filtering keeps the screen loader hidden');
      await scrollCatalogToEnd(page);
      await page.waitForTimeout(250);
      calls=await page.evaluate(()=>window.calls);
      assert.equal(calls.catalog.length,3,'Scrolling placeholder records cannot request a stale cursor');
      assert.equal(calls.catalog.at(-1).search,'boundary');
      assert.equal(calls.catalog.at(-1).cursor,undefined,'The changed filter starts at page one');
      assert.equal(calls.metrics.at(-1).search,'boundary');
      await page.screenshot({path:artifacts+'/'+mode+'-filter-pending.png'});
      await page.evaluate(()=>{window.pauseSearch=false;window.releaseSearch()});
      await page.waitForFunction(()=>document.querySelectorAll('.requirement-catalog-card').length===1);
      assert.match(await page.locator('.requirement-catalog-card').innerText(),/Boundary scenario beyond the first pages/);
      assert.equal(await metric.innerText(),'1');
      assert.equal(await page.locator('.hierarchy-auto-load-sentinel').count(),0);
      await page.screenshot({path:artifacts+'/'+mode+'-server-search.png'});
      assert.deepEqual(errors,[],mode+': no browser errors');
      assert.deepEqual(unexpectedRequests,[],mode+': all responses are isolated from the backend');
      await context.close();
    }
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html),unlink(tsx)]);
  }
});
