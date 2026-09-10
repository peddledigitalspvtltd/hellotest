import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);
const fixture = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider,useLocation} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider} from '/src/auth/AuthContext'; import {LocalizationProvider} from '/src/context/LocalizationContext';
import {AppShell} from '/src/components/AppShell'; import {SettingsPage} from '/src/pages/SettingsPage'; import {api,sessionStorage} from '/src/lib/api'; import {setCurrentScope} from '/src/hooks/useCurrentProject';
import '/src/styles.css'; import '/src/dark-theme.css'; import '/src/modal-system.css'; import '/src/workspace-layout.css';
const params=new URLSearchParams(location.search); const viewer=params.has('viewer');
const session={token:'workspace-experience-fixture',user:{id:params.get('user')||'reviewer',role:viewer?'member':'admin',name:'QA Reviewer',email:'reviewer@example.test',permissions:['workspace.view','testcase.view','automation.view','project.view']}};
sessionStorage.write(session); setCurrentScope(params.has('no-project')?'':'project','app');
for(const group of Object.values(api)) if(group&&typeof group==='object') for(const [key,value] of Object.entries(group)) if(typeof value==='function') group[key]=async()=>[];
api.auth.session=async()=>session; api.projects.list=async()=>params.has('no-project')?[]:[{id:'project',name:'Commerce quality'}];
api.featureFlags.snapshot=async()=>{if(window.failFlagRefresh || (params.has('flags-error')&&!window.retrySucceeded)) throw new Error('Connection interrupted');return {flags:new Proxy({}, {get:(_,key)=>key==='hellotest.automation.object_repository'?false:true})}};
api.notifications.unreadCount=async()=>({total:0,by_preference:{}});api.settings.getLocalization=async()=>({strings:params.has('rtl')?{'meta.language':'ar','meta.direction':'rtl'}:{}});api.settings.getWorkspacePreferences=async()=>({preferences:{}});
window.languagePublications=[];api.settings.updateLocalization=async input=>{window.languagePublications.push(input);return {strings:input.strings}};
function Screen(){const location=useLocation();if(location.pathname==='/settings')return <SettingsPage/>;return <section style={{padding:24}}><h1>Workspace destination</h1><input aria-label="Unsaved draft" /><p data-testid="destination">{location.pathname+location.search}</p></section>}
const router=createMemoryRouter([{path:'/',element:<AppShell/>,children:[{path:'*',element:<Screen/>}]}],{initialEntries:[params.get('route')||'/automation']});
const client = new QueryClient({defaultOptions:{queries:{retry:false}}}); window.refreshPolicy=()=>client.invalidateQueries({predicate:query=>query.queryKey.includes('feature-flags')});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId={session.user.id}><RouterProvider router={router}/></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;
test('workspace navigation, capability recovery and personal locale remain usable across roles and viewports', {timeout:120000}, async()=>{
 const name='workspace-experience-'+randomUUID(), html=new URL(name+'.html',root), tsx=new URL(name+'.tsx',root);let browser;
 try {
 await writeFile(html,`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);await writeFile(tsx,fixture);
 await mkdir('/tmp/qaira-product-experience-after',{recursive:true});
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let data=[];if(path.includes('metadata'))data={};else if(path.includes('unread'))data={total:0,by_preference:{}};route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
 const base=(process.env.VITE_TEST_URL||'http://127.0.0.1:5179')+'/'+name+'.html';
 await page.goto(base);await page.locator('.workspace-context-actions').getByRole('button',{name:'Find a capability'}).click();await page.getByRole('dialog').waitFor();
 assert.equal(await page.getByRole('searchbox').evaluate(el=>el===document.activeElement),true);
 await page.getByRole('searchbox').fill('locator');assert.equal(await page.getByRole('link',{name:'Object repository'}).count(),0);await page.getByText('Feature disabled',{exact:true}).waitFor();
 await page.getByRole('searchbox').fill('api');await page.getByRole('link',{name:'AI agents'}).waitFor();
 await page.getByRole('searchbox').fill('no-matching-xyz');await page.getByText('No matching capabilities').waitFor();await page.getByRole('button',{name:'Reset',exact:true}).click();
 await page.screenshot({path:'/tmp/qaira-product-experience-after/01-navigator-desktop.png'});
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Language & region',exact:true}).click();await page.getByLabel('Interface language',{exact:true}).selectOption('es');await page.getByLabel('Regional format',{exact:true}).selectOption('en-IN');await page.getByLabel('Time zone',{exact:true}).selectOption('Asia/Kolkata');await page.getByRole('button',{name:'Save preferences'}).click();assert.equal(await page.locator('html').getAttribute('lang'),'es');await page.getByRole('button',{name:'Idioma y región'}).waitFor();
 await page.reload();await page.getByRole('button',{name:'Idioma y región'}).click();assert.equal(await page.getByLabel('Formato regional',{exact:true}).inputValue(),'en-IN');await page.keyboard.press('Escape');
 await page.goto(base+'?user=another');await page.getByRole('button',{name:'Language & region',exact:true}).waitFor();
 await page.getByLabel('Unsaved draft').fill('keep my edits');await page.evaluate(()=>{window.failFlagRefresh=true;window.refreshPolicy()});await page.getByText('Availability couldn’t be refreshed. Your current work is still here.').waitFor();assert.equal(await page.getByLabel('Unsaved draft').inputValue(),'keep my edits');await page.evaluate(()=>{window.failFlagRefresh=false;window.refreshPolicy()});
 await page.getByRole('button',{name:'Language & region',exact:true}).click();await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:'/tmp/qaira-product-experience-after/02-regional-mobile.png'});await page.keyboard.press('Escape');
 await page.locator('.workspace-context-actions').getByRole('button',{name:'Find a capability'}).click();await page.evaluate(()=>{document.documentElement.dataset.theme='dark'});await page.screenshot({path:'/tmp/qaira-product-experience-after/03-navigator-mobile-dark.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.keyboard.press('Escape');
 await page.goto(base+'?viewer=true&user=viewer');await page.locator('.workspace-context-actions').getByRole('button',{name:'Find a capability'}).click();await page.getByRole('searchbox').fill('roles');await page.getByText('Permission required',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'People and roles'}).count(),0);await page.keyboard.press('Escape');
 await page.goto(base+'?flags-error=true&user=error');await page.getByText('We couldn’t verify availability').waitFor();await page.evaluate(()=>{window.retrySucceeded=true});await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByText('Workspace destination',{exact:true}).waitFor();
 await page.goto(base+'?no-project=true&user=new&route=/projects');await page.getByText('Workspace destination',{exact:true}).waitFor();assert.equal(await page.locator('[aria-label="Loading project capabilities"]').count(),0);
 await page.goto(base+'?rtl=true&user=rtl');await page.getByRole('button',{name:'Language & region',exact:true}).click();assert.equal(await page.locator('html').getAttribute('dir'),'rtl');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:'/tmp/qaira-product-experience-after/04-regional-rtl.png'});
 await page.goto(base+'?user=pack-admin&route=/settings');await page.getByRole('button',{name:'Workspace language strings',exact:true}).click();
 await page.locator('input[type=file][accept="application/json"]').setInputFiles({name:'es.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({'nav.dashboard':'Inicio','meta.language':'es'}))});
 await page.getByRole('button',{name:'Publish workspace pack'}).waitFor();assert.equal(await page.evaluate(()=>window.languagePublications.length),0);await page.getByRole('button',{name:'Publish workspace pack'}).click();assert.equal(await page.evaluate(()=>window.languagePublications.length),1);await page.getByText('Workspace language pack published.',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 } finally {if(browser)await browser.close();await Promise.allSettled([unlink(html),unlink(tsx)]);}
});
