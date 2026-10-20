import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/',import.meta.url);
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '/src/auth/AuthContext';
import { api, sessionStorage } from '/src/lib/api';
import { setCurrentScope } from '/src/platform/hooks/useCurrentProject';
import { KnowledgeRepoPage } from '/services/knowledge/frontend/pages/KnowledgeRepoPage';
import { knowledgeApi } from '/services/knowledge/frontend/api.client';
import '/src/styles.css';import '/src/dark-theme.css';import '/src/modal-system.css';import '/src/workspace-layout.css';import '/src/catalog-list.css';import '/src/product-experience.css';
const readonly = new URLSearchParams(location.search).has('readonly');
const session={token:'fixture',user:{id:'u',role:readonly?'member':'admin',name:'Reviewer',permissions:['knowledge.view'],project_permissions:{p:['knowledge.view']}}};
sessionStorage.write(session);setCurrentScope('p','app');
api.auth.session=async()=>session;
api.featureFlags.snapshot=async()=>({flags:new Proxy({}, {get:()=>true})});
api.settings.getWorkspacePreferences=async()=>({preferences:{}});
api.projects.list=async()=>[{id:'p',name:'Checkout'}];api.appTypes.list=async()=>[{id:'app',project_id:'p',name:'Web'}];
knowledgeApi.knowledgeRepo.list=async()=>[{id:'k1',title:'Release approval rules',description:'Evidence for release sign-off',is_active:true,content_type:'text',content:'Use current run results.'}];
api.knowledgeRepo.overview=async()=>({counts:{sources:248,documents:241,chunks:1840,collections:3,processing_sources:0},capabilities:{hybrid_search:true},recent_jobs:[]});
api.knowledgeRepo.collections.list=async()=>[];
api.knowledgeRepo.sources=async()=>[];
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
createRoot(document.getElementById('root')).render(<MemoryRouter><QueryClientProvider client={client}><AuthProvider><KnowledgeRepoPage /></AuthProvider></QueryClientProvider></MemoryRouter>);
`;
test('knowledge workspace configures incremental refresh, reports errors and hides management for readers', {timeout:60000}, async()=>{
 const name='knowledge-refresh-'+randomUUID();const html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
 try{
  await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);await writeFile(tsx,fixture);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const errors=[];context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
  await context.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Unexpected fixture API request'})}));
  let state={project_id:'p',enabled:false,interval_ms:300000,status:'idle',requested:false,last_result:{scanned:248,queued:12,unchanged:236}};let writes=0;
  await context.route('**/projects/p/knowledge/refresh**',async route=>{
   const method=route.request().method();if(method==='PUT'){writes++;state={...state,...route.request().postDataJSON()};}if(method==='POST'){writes++;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Refresh worker is unavailable. Try again.'})});}
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(state)});
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);const url=`${process.env.VITE_TEST_URL||'http://127.0.0.1:5294'}/${name}.html`;
  await page.goto(url);await page.getByRole('heading',{name:'AI Knowledge Base',exact:true}).waitFor();await page.getByText('Last refresh',{exact:true}).click();await page.getByText(/Last scan: 248 checked/).waitFor();await page.getByRole('button',{name:/Notes & rules/}).click();await page.getByText('Release approval rules',{exact:true}).waitFor();
  await mkdir('/tmp/hellotest-knowledge-refresh',{recursive:true});await page.screenshot({path:'/tmp/hellotest-knowledge-refresh/01-workspace.png',fullPage:true});
  await page.getByRole('button',{name:'Configure automatic knowledge refresh'}).click();await page.getByRole('dialog',{name:'Automatic context refresh'}).waitFor();
  await page.getByLabel('Refresh automatically').check();await page.getByLabel('Automatic refresh frequency').selectOption('60000');await page.getByRole('button',{name:'Save settings'}).click();await page.getByText('Every minute').waitFor();assert.equal(writes,1);
  await page.getByRole('button',{name:'Refresh now',exact:true}).click();await page.getByRole('alert').filter({hasText:'Refresh worker is unavailable'}).waitFor();assert.equal(writes,2);
  state={...state,status:'failed',requested:true,last_error:'Refresh could not complete. Retry the scan.'};
  await page.getByRole('button',{name:'Retry status'}).click();
  await page.getByRole('button',{name:'Refresh now',exact:true}).click();
  assert.equal(writes,3,'a failed queued scan can be retried immediately');
  await page.setViewportSize({width:390,height:900});await page.evaluate(()=>{document.documentElement.dataset.theme='dark';getComputedStyle(document.body).backgroundColor;document.getAnimations().forEach(a=>{try{a.finish()}catch{}});});await page.getByRole('button',{name:'Configure automatic knowledge refresh'}).click();await page.getByRole('dialog',{name:'Automatic context refresh'}).waitFor();await page.screenshot({path:'/tmp/hellotest-knowledge-refresh/02-settings-dark.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true, JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).map(el=>({tag:el.tagName,class:el.className,width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right})).filter(el=>el.right>innerWidth+1).slice(0,16))));await page.keyboard.press('Escape');
  const reader=await context.newPage();await reader.goto(url+'?readonly=true');await reader.getByRole('heading',{name:'AI Knowledge Base',exact:true}).waitFor();await reader.getByText('Last refresh',{exact:true}).click();await reader.getByText(/Last scan/).waitFor();assert.equal(await reader.getByRole('button',{name:'Refresh now',exact:true}).count(),0);assert.equal(await reader.getByRole('button',{name:'Configure automatic knowledge refresh'}).count(),0);assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)]);}
});
