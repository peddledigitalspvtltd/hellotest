import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url);
const name = `project-navigation-${randomUUID()}`;
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AppShell} from '/src/components/AppShell';
import {ProjectsPage} from '/src/pages/ProjectsPage';
import {AuthProvider} from '/src/auth/AuthContext';
import {LocalizationProvider} from '/src/context/LocalizationContext';
import {api,sessionStorage} from '/src/lib/api';
import {setCurrentScope} from '/src/hooks/useCurrentProject';
import '/src/styles.css';import '/src/dark-theme.css';import '/src/modal-system.css';import '/src/workspace-layout.css';import '/src/catalog-list.css';
const session={token:'isolated-project-navigation',user:{id:'project-reviewer',name:'Reviewer',role:'admin',email:'reviewer@example.test'}};
sessionStorage.write(session);setCurrentScope('commerce','web');
function stub(value){for(const [key,entry] of Object.entries(value)){if(typeof entry==='function')value[key]=async()=>[];else if(entry&&typeof entry==='object')stub(entry)}}stub(api);
api.auth.session=async()=>session;api.settings.getLocalization=async()=>({strings:{}});api.settings.getWorkspacePreferences=async()=>({preferences:{}});api.metadata.domain=async()=>({});api.notifications.unreadCount=async()=>({total:0,by_preference:{}});
const projects=[{id:'commerce',name:'Commerce platform',description:'Commerce project',has_access:true},{id:'payments',name:'Payments experience',description:'Payments project',has_access:true},{id:'reports',name:'Reports workspace',description:'Reports project',has_access:true},{id:'private',name:'Private project',has_access:false}];
api.metadata.workspaceScopes=async()=>({projects:await api.projects.list()});api.projects.list=async()=>projects.filter(p=>p.has_access);api.projects.catalog=async()=>projects;
window.detailRequests=[];window.collectionRequests=[];window.metricsPending=false;
api.projects.get=async(id)=>{window.detailRequests.push(id);return projects.find(project=>project.id===id)};
api.projects.portfolioAnalytics=async()=>{window.metricsPending=true;return new Promise((resolve,reject)=>{window.finishMetrics=()=>{window.metricsPending=false;resolve({projects:[],configuration:{}})};window.failMetrics=()=>{window.metricsPending=false;reject(new Error('Metrics unavailable'))}})};
for(const resource of ['requirements','testSuites','testCases','executions','executionResults','projectMembers'])api[resource].list=async()=>{window.collectionRequests.push(resource);return []};
api.appTypes.list=async({project_id})=>[{id:project_id==='commerce'?'web':project_id+'-app',project_id,name:'Web app',type:'web'}];
window.flagRequests=0;let available=true;
api.featureFlags.snapshot=async()=>{window.flagRequests++;if(window.flagRequests>1)await new Promise(resolve=>setTimeout(resolve,500));return {flags:new Proxy({'hellotest.ops.projects':available},{get:(target,key)=>key in target?target[key]:true})}};
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
window.refreshFlags=async(value)=>{available=value;await client.invalidateQueries({queryKey:['feature-flags']})};
const router=createMemoryRouter([{path:'/',element:<AppShell/>,children:[{path:'projects',element:<ProjectsPage/>}]}],{initialEntries:['/projects']});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId={session.user.id}><RouterProvider router={router}/></LocalizationProvider></AuthProvider></QueryClientProvider>);`;

test('project tiles open on the first click without unmounting the page or flashing a scope loader', {timeout:60000}, async()=>{
 let browser;
 try {
  await writeFile(new URL(`${name}.tsx`,root),fixture);
  await writeFile(new URL(`${name}.html`,root),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(5000);
  const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)});
  await page.route('**/api/**',route=>{errors.push('Unexpected API request: '+route.request().url());return route.abort()});
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5173'}/${name}.html`,{waitUntil:'domcontentloaded',timeout:20000});
  const tile=title=>page.locator('article.project-catalog-card').filter({has:page.getByRole('heading',{name:title,exact:true})});
  await tile('Payments experience').waitFor();
  await page.waitForFunction(()=>window.metricsPending);
  assert.deepEqual(await page.evaluate(()=>window.detailRequests),[],'browsing never requests full project details');
  assert.deepEqual(await page.evaluate(()=>window.collectionRequests),[],'portfolio metrics replace full scope collection downloads');
  assert.equal(await tile('Payments experience').getByText('Metrics pending',{exact:true}).count(),1,'unavailable metrics are not shown as zero or healthy');
  await page.evaluate(()=>{
    window.projectRoot=document.querySelector('.projects-page');window.removedProjectRoots=0;window.capabilityLoaders=0;
    window.projectObserver=new MutationObserver(records=>{
      for(const record of records){
        for(const node of record.removedNodes)if(node===window.projectRoot||node.contains?.(window.projectRoot))window.removedProjectRoots++;
        for(const node of record.addedNodes)if(node instanceof Element&&(node.getAttribute('aria-label')==='Loading project capabilities'||node.querySelector('[aria-label="Loading project capabilities"]')))window.capabilityLoaders++;
      }
    });window.projectObserver.observe(document.getElementById('root'),{subtree:true,childList:true});
  });
  const originalRequests=await page.evaluate(()=>window.flagRequests);
  // Switching to an uncached project previously replaced Outlet and lost this click.
  await tile('Payments experience').click();
  await page.getByRole('tablist',{name:'Project detail sections'}).waitFor();
  await page.waitForFunction(()=>localStorage.getItem('hellotest.current_project_id')==='payments');
  await page.waitForFunction(()=>window.detailRequests.includes('payments'));
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,650)));
  assert.equal(await page.getByRole('tablist',{name:'Project detail sections'}).count(),1,'first click keeps project details open after scope requests settle');
  assert.equal(await page.getByRole('textbox',{name:'Project name',exact:true}).inputValue(),'Payments experience');
  assert.deepEqual(await page.evaluate(()=>window.detailRequests),['payments'],'opening only fetches the selected project');
  assert.equal(await page.evaluate(()=>window.metricsPending),true,'slow metrics do not delay project navigation');
  assert.deepEqual(await page.evaluate(()=>window.collectionRequests),[],'project details do not preload unrelated collection tabs');
  await page.getByRole('tab',{name:/Members/}).click();
  await page.waitForFunction(()=>window.collectionRequests.includes('projectMembers'));
  assert.deepEqual(await page.evaluate(()=>window.collectionRequests),['projectMembers'],'member data loads only after its tab opens');
  await page.evaluate(()=>window.failMetrics());
  await page.getByRole('button',{name:'Retry metrics',exact:true}).waitFor();
  assert.equal(await page.getByRole('tablist',{name:'Project detail sections'}).count(),1,'metrics failure preserves the open project');
  await page.getByRole('button',{name:'Retry metrics',exact:true}).click();
  await page.waitForFunction(()=>window.metricsPending);
  await page.evaluate(()=>window.finishMetrics());
  assert.deepEqual(await page.evaluate(()=>({removed:window.removedProjectRoots,loaders:window.capabilityLoaders,requests:window.flagRequests})),{removed:0,loaders:0,requests:originalRequests});
  await page.getByRole('button',{name:'Back to projects list',exact:true}).click();
  await page.getByRole('checkbox',{name:'Select Reports workspace',exact:true}).check();
  assert.equal(await page.getByRole('tablist',{name:'Project detail sections'}).count(),0,'selection control does not open details');
  await tile('Reports workspace').focus();await page.keyboard.press('Enter');
  await page.getByRole('tablist',{name:'Project detail sections'}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Project name',exact:true}).inputValue(),'Reports workspace');
  await page.getByRole('button',{name:'Back to projects list',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await tile('Commerce platform').click();await page.getByRole('tablist',{name:'Project detail sections'}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Project name',exact:true}).inputValue(),'Commerce platform');
  assert.equal(await page.evaluate(()=>window.removedProjectRoots),0,'desktop, keyboard and mobile switches preserve the same page instance');
  await mkdir('/tmp/qaira-project-navigation',{recursive:true});
  await page.screenshot({path:'/tmp/qaira-project-navigation/mobile-details.png'});
  // A real workspace policy update still reaches the route gate after refresh.
  await page.evaluate(()=>{window.flagRefresh=window.refreshFlags(false)});
  assert.equal(await page.getByRole('tablist',{name:'Project detail sections'}).count(),1,'existing content remains during background policy refresh');
  await page.getByRole('heading',{name:'This capability is turned off',exact:true}).waitFor();
  assert.equal(await page.getByRole('tablist',{name:'Project detail sections'}).count(),0,'disabled workspace capability remains enforced');
  assert.deepEqual(errors,[]);
 } finally {
  await browser?.close();
  await rm(new URL(`${name}.tsx`,root),{force:true});await rm(new URL(`${name}.html`,root),{force:true});
 }
});
