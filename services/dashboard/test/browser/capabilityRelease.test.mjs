import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const frontend=new URL('../../../platform/frontend/',import.meta.url);
const repo=new URL('../../../../',import.meta.url);

test('the released Dashboard mounts all three views in the host, retries loading and enforces access', {timeout:90000}, async()=>{
 const original=await readFile(new URL('./qualityAnalytics.test.mjs',import.meta.url),'utf8');
 let fixture=original.match(/const fixture=`([\s\S]*?)`;\ntest/)[1];
 fixture=fixture.replace("import {OverviewPage} from '/services/dashboard/frontend/pages/OverviewPage';", "import {capabilityView} from '/src/platform/capabilities/CapabilityView'; import {installCapabilityHost} from '/src/platform/capabilities/host'; installCapabilityHost(); window.__HELLOTEST_CONFIG__={CAPABILITY_UI_URLS:{dashboard:'/capability-releases/dashboard/manifest.json'}}; const OverviewPage=capabilityView('dashboard','OverviewPage',()=>{throw new Error('Local fallback is forbidden in this test')},'Dashboard');");
 fixture=fixture.replace("MemoryRouter,useLocation", "MemoryRouter,useLocation,useNavigate");
 fixture=fixture.replace("function Screen(){", "window.remoteTestApi=api; window.invalidateAccess=()=>client.invalidateQueries(); const realFlagSnapshot=api.featureFlags.snapshot; api.featureFlags.snapshot=async()=>{const policy=(await import('/src/platform/lib/featurePolicy.generated.json')).default; return {...policy,flags:Object.fromEntries(policy.feature_keys.map(key=>[key,!window.disableDashboards||key!=='hellotest.analytics.dashboards']))}}; function Screen(){window.openDashboard=useNavigate();");
 fixture=fixture.replace("<OverviewPage/>","<input aria-label='Host draft' defaultValue='Unsaved host value'/><OverviewPage/>");
 const name='capability-release-'+randomUUID(); const html=new URL(name+'.html',frontend),tsx=new URL(name+'.tsx',frontend);
 let browser;
 try {
  await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx,fixture);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let unavailable=true, brokenView=true, manifests=0;
  await page.route('**/capability-releases/dashboard/**',async route=>{
   const asset=new URL(route.request().url()).pathname.split('/capability-releases/dashboard/')[1];
   if(asset==='manifest.json'){
    manifests++;
    if(unavailable)return route.fulfill({status:503,body:'Unavailable'});
    if(brokenView)return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({protocol:1,capability:'dashboard',version:'old-release',entry:'missing-view-entry.js',styles:[]})});
   }
   if(asset==='missing-view-entry.js')return route.fulfill({status:200,contentType:'text/javascript',body:"export const views={OverviewPage:()=>Promise.reject(new Error('A previous release chunk is unavailable'))};"});
   assert.ok(!asset.includes('..'));
   return route.fulfill({status:200,contentType:asset.endsWith('.json')?'application/json':asset.endsWith('.css')?'text/css':'text/javascript',body:await readFile(new URL('services/dashboard/dist/ui/'+asset,repo))});
  });
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());
   const data=await page.evaluate(async({path,query})=>{
    const api=window.remoteTestApi;
    if(path==='/api/feature-flags')return api.featureFlags.snapshot();
    if(path==='/api/analytics/overview')return api.analytics.overview({project_id:query.project_id,days:Number(query.days)||30});
    if(path.includes('workspace-preferences'))return {preferences:{}};
    if(path.includes('/settings'))return {};
    if(query.include_page==='true')return {items:[],total:0,is_last:true,next_cursor:null};
    if(path==='/api/execution-results/release-readiness')return {executions:[],results:[],complete:true,limits:{},counts:{}};
    if(path==='/api/quality-dashboards')return [];
    return [];
   },{path:url.pathname,query:Object.fromEntries(url.searchParams)});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5294'}/${name}.html`);
  try { await page.getByRole('heading',{name:'Unable to load Dashboard'}).waitFor(); }
  catch (error) { console.log('Dashboard load diagnostics:', await page.locator('body').innerText(), errors); throw error; }
  await page.getByRole('textbox',{name:'Host draft'}).fill('Retain this draft');
  unavailable=false;await page.getByRole('button',{name:'Try again',exact:true}).click();
  await page.getByText('A previous release chunk is unavailable',{exact:true}).waitFor({state:'attached'});
  brokenView=false;await page.getByRole('button',{name:'Try again',exact:true}).click();
  await page.getByText('Commerce platform',{exact:true}).waitFor();
  assert.equal(manifests,3);
  assert.equal(await page.getByRole('textbox',{name:'Host draft'}).inputValue(),'Retain this draft');
  await mkdir('/tmp/hellotest-capability-browser',{recursive:true});
  await page.screenshot({path:'/tmp/hellotest-capability-browser/dashboard-analytics.png',fullPage:true});
  await page.evaluate(()=>window.openDashboard('/?view=readiness'));
  try { await page.getByRole('heading',{name:'Release readiness',exact:true}).waitFor(); } catch(error) { console.log('Readiness UI:', await page.locator('body').innerText(), errors); throw error; }
  await page.screenshot({path:'/tmp/hellotest-capability-browser/dashboard-readiness.png',fullPage:true});
  await page.evaluate(()=>window.openDashboard('/?view=custom'));
  await page.getByRole('button',{name:'Create dashboard',exact:true}).first().waitFor();
  await page.screenshot({path:'/tmp/hellotest-capability-browser/dashboard-custom.png',fullPage:true});
  assert.equal(manifests,3,'All views share the same loaded Dashboard release');
  await page.evaluate(async()=>{window.disableDashboards=true;await window.invalidateAccess()});
  await page.getByRole('heading',{name:'This capability is turned off',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Create dashboard',exact:true}).count(),0);
  await page.evaluate(async()=>{window.disableDashboards=false;await window.invalidateAccess()});
  await page.getByRole('button',{name:'Create dashboard',exact:true}).first().waitFor();
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)]);}
});
