// Production AppShell + switcher + nested mobile focus behavior; isolated API/storage.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const require=createRequire(new URL('../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('../../',import.meta.url);
const name=`switcher-shell-${randomUUID()}`;
const output='/tmp/qaira-workspace-design/switcher';
const fixture=`import React from 'react';import {createRoot} from 'react-dom/client';import {createMemoryRouter,RouterProvider} from 'react-router-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {AppShell} from '/src/components/AppShell';import {AuthProvider} from '/src/auth/AuthContext';import {LocalizationProvider} from '/src/context/LocalizationContext';import {api,sessionStorage} from '/src/lib/api';import {setCurrentScope} from '/src/hooks/useCurrentProject';
import '/src/styles.css';import '/src/dark-theme.css';import '/src/modal-system.css';import '/src/workspace-layout.css';import '@fontsource/inter/400.css';import '@fontsource/inter/500.css';import '@fontsource/inter/600.css';
const session={token:'isolated-switcher',user:{id:'switcher-reviewer',name:'QA Lead',role:'admin',email:'qa@example.test'}};sessionStorage.write(session);setCurrentScope('commerce','web');
function stub(value){for(const [key,entry] of Object.entries(value)){if(typeof entry==='function')value[key]=async()=>[];else if(entry&&typeof entry==='object')stub(entry)}}stub(api);
api.auth.session=async()=>session;api.settings.getLocalization=async()=>({strings:{}});api.settings.getWorkspacePreferences=async()=>({preferences:{}});api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});api.metadata.domain=async()=>({});api.notifications.unreadCount=async()=>({total:0,by_preference:{}});
api.projects.list=async()=>[{id:'commerce',name:'Commerce platform'},{id:'payments',name:'Payments experience'}];api.appTypes.list=async({project_id})=>project_id==='commerce'?[{id:'web',project_id:'commerce',name:'Web storefront',type:'web'},{id:'api',project_id:'commerce',name:'Checkout API',type:'api'}]:[{id:'merchant',project_id:'payments',name:'Merchant services',type:'api'}];
const router=createMemoryRouter([{path:'/',element:<AppShell/>,children:[{index:true,element:<section className='page'><h1>Workspace overview</h1><p>Project and application selection remain available across the workspace.</p><button type='button'>Page action</button></section>}]}]);
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AuthProvider><LocalizationProvider userId={session.user.id}><RouterProvider router={router}/></LocalizationProvider></AuthProvider></QueryClientProvider>);`;
let browser;
try {
  await mkdir(output,{recursive:true});
  await writeFile(new URL(`${name}.tsx`,root),fixture);
  await writeFile(new URL(`${name}.html`,root),`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{errors.push('Unexpected API request: '+route.request().url());return route.abort();});
  await page.goto(`${process.env.BROWSER_TEST_BASE_URL||'http://127.0.0.1:5179'}/${name}.html`);
  await page.getByRole('button',{name:'Application: Web storefront',exact:true}).waitFor();
  const projectTrigger=page.getByRole('button',{name:'Project: Commerce platform',exact:true});
  const appTrigger=page.getByRole('button',{name:/^Application:/});
  const ensureBounds=async(width,height)=>{
    const rect=await page.locator('.workspace-scope-menu').boundingBox();
    assert.ok(rect.x>=0&&rect.x+rect.width<=width+1&&rect.y>=0&&rect.y+rect.height<=height+1,'portalled menu fits actual shell viewport');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'shell does not overflow horizontally');
  };
  await projectTrigger.click();await page.getByRole('option',{name:'Commerce platform',exact:true}).waitFor();await ensureBounds(1440,960);
  await page.screenshot({path:output+'/shell-expanded.png'});await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();await appTrigger.click();await page.getByRole('option',{name:/Checkout API/}).waitFor();await ensureBounds(1440,960);
  await page.screenshot({path:output+'/shell-collapsed.png'});await page.keyboard.press('Escape');
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    const navigation=page.getByRole('button',{name:'Open navigation',exact:true});
    await navigation.click();
    const drawer=page.locator('#app-sidebar');
    await page.getByRole('button',{name:'Close navigation',exact:true}).first().waitFor();
    await projectTrigger.click();await page.getByRole('option',{name:'Commerce platform',exact:true}).waitFor();await ensureBounds(width,844);
    await page.screenshot({path:output+'/shell-mobile-'+width+'.png'});
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.workspace-scope-menu').count(),0,'Escape closes the nested menu');
    assert.equal(await navigation.getAttribute('aria-expanded'),'true','first Escape keeps the containing drawer open');
    assert.equal(await projectTrigger.evaluate(el=>el===document.activeElement),true,'nested Escape restores trigger focus');
    await appTrigger.click();await page.getByRole('option',{name:/Checkout API/}).waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.workspace-scope-menu').count(),0,'Tab closes the nested menu');
    assert.equal(await drawer.evaluate(el=>el.contains(document.activeElement)),true,'Tab returns to the drawer focus sequence');
    await projectTrigger.click();await page.getByRole('option',{name:'Commerce platform',exact:true}).waitFor();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await drawer.evaluate(el=>el.contains(document.activeElement)),true,'reverse Tab stays in the drawer');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.querySelector('[aria-controls="app-sidebar"]')?.getAttribute('aria-expanded')==='false');
  }
  // An unrelated popover cannot suppress the drawer's own Escape behavior.
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.evaluate(()=>{const owner=document.createElement('button');owner.id='foreign-popover-owner';owner.setAttribute('aria-expanded','true');owner.setAttribute('aria-haspopup','listbox');document.body.append(owner);const menu=document.createElement('div');menu.dataset.dialogPopoverOwner=owner.id;menu.tabIndex=-1;document.body.append(menu);menu.focus();});
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button',{name:'Open navigation',exact:true}).getAttribute('aria-expanded'),'false','foreign popover does not bypass drawer keyboard handling');
  assert.deepEqual(errors,[]);
  console.log('PASS: actual AppShell expanded/collapsed/mobile menus fit; nested Escape and forward/reverse Tab preserve drawer focus; foreign popovers retain dialog protection.');
} finally {
  await browser?.close();
  await rm(new URL(`${name}.tsx`,root),{force:true});await rm(new URL(`${name}.html`,root),{force:true});
}
