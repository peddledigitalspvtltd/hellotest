import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFile, rm, mkdir } from 'node:fs/promises';
const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);

// Boot the actual main entry and createBrowserRouter after installing isolated
// clients. AppShell is intentionally absent from this fixture's imports.
const fixture = `
import {api,sessionStorage as appSession} from '/src/lib/api';
import {setCurrentScope} from '/src/platform/hooks/useCurrentProject';
const mode=new URLSearchParams(location.search).get('mode')||'guest';
localStorage.clear();sessionStorage.clear();
localStorage.setItem('app_theme','light');localStorage.setItem('sidebar_collapsed','false');
const session={token:'isolated-app-boot',user:{id:'boot-user',name:'QA Architect',role:'admin',email:'architect@example.test'}};
window.bootCalls=[];
function stub(value,prefix=''){for(const[key,entry]of Object.entries(value)){const path=prefix?prefix+'.'+key:key;if(typeof entry==='function')value[key]=async(...args)=>{window.bootCalls.push({path,args});return []};else if(entry&&typeof entry==='object')stub(entry,path)}}stub(api);
api.auth.setup=async()=>({google:{enabled:false,clientId:null},emailVerification:{enabled:false,senderEmail:null,senderName:null}});
api.auth.session=async()=>{window.bootCalls.push({path:'auth.session'});await new Promise(resolve=>setTimeout(resolve,30));return session};
api.auth.login=async input=>{window.bootCalls.push({path:'auth.login',input});return session};
api.settings.getLocalization=async()=>({strings:{}});
api.settings.getWorkspacePreferences=async()=>({preferences:{}});
api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:(_,key)=>key!=='hellotest.ai.chatbot'})});
api.metadata.domain=async()=>({});
api.metadata.workspaceScopes=async()=>({projects:[{id:'boot-project',name:'Checkout Quality',has_access:true}]});
api.projects.list=async()=>[{id:'boot-project',name:'Checkout Quality'}];
api.appTypes.list=async()=>[{id:'boot-app',project_id:'boot-project',name:'Web application',type:'web'}];
api.notifications.unreadCount=async()=>({count:0,by_preference:{}});
setCurrentScope('boot-project','boot-app');
if(mode==='signedin')appSession.write(session);else appSession.clear();
sessionStorage.setItem('hellotest.auth_redirect_route','/support');
history.replaceState(null,'',mode==='signedin'?'/support':'/auth');
await import('/src/main.tsx');
`;

async function assertNoOverflow(page,label) {
  const dimensions=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  assert.ok(dimensions.document<=dimensions.width+1&&dimensions.body<=dimensions.width+1,label+': '+JSON.stringify(dimensions));
}
async function assertSidebarTheme(page,theme) {
  const style=await page.locator('#app-sidebar').evaluate(node=>({background:getComputedStyle(node).backgroundColor,image:getComputedStyle(node).backgroundImage,color:getComputedStyle(node).color}));
  assert.equal(style.image,'none','Late-loaded shell styles must not restore the legacy gradient');
  assert.equal(style.background,theme==='light'?'rgb(255, 255, 255)':'rgb(23, 38, 48)');
  assert.notEqual(style.color,style.background,'Sidebar text has visible contrast');
}

test('actual App boot defers shell at sign-in and preserves light/dark/mobile chrome after lazy loading', {timeout:90000}, async()=>{
  const name='app-startup-'+randomUUID();let browser;
  const artifacts=process.env.BROWSER_SCREENSHOT_DIR||'/tmp/qaira-app-startup';
  try {
    await writeFile(new URL(name+'.tsx',root),fixture);
    await writeFile(new URL(name+'.html',root),`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await mkdir(artifacts,{recursive:true});
    browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    page.setDefaultTimeout(15000);
    const errors=[],apiRequests=[],shellRequests=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/AppShell.tsx'))shellRequests.push(request.url())});
    await page.route('**/api/**',route=>{apiRequests.push(route.request().url());return route.abort()});
    const url=`${process.env.VITE_TEST_URL||'http://127.0.0.1:5173'}/${name}.html`;
    await page.goto(url+'?mode=guest');
    await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor();
    assert.equal(await page.locator('#app-sidebar').count(),0);
    assert.equal(shellRequests.length,0,'Unauthenticated startup never imports AppShell');
    await assertNoOverflow(page,'desktop sign-in');
    await page.screenshot({path:artifacts+'/auth-desktop.png'});
    await page.setViewportSize({width:390,height:844});
    await assertNoOverflow(page,'mobile sign-in');
    await page.screenshot({path:artifacts+'/auth-mobile.png'});
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#email-input').fill('architect@example.test');
    await page.locator('#password-input').fill('fixture-password');
    await page.getByRole('button',{name:'Sign in to HelloTest',exact:true}).click();
    await page.getByRole('heading',{name:'Support Center',exact:true}).waitFor();
    await page.locator('#app-sidebar').waitFor();
    assert.ok(shellRequests.length>0,'Authentication loads the actual lazy shell');
    assert.equal(new URL(page.url()).pathname,'/support','The actual router restores the authenticated destination');
    await assertSidebarTheme(page,'light');
    await assertNoOverflow(page,'authenticated desktop');
    await page.screenshot({path:artifacts+'/app-shell-light.png'});
    await page.getByRole('button',{name:'Workspace options',exact:true}).click();
    await page.getByRole('menuitem',{name:'Switch to dark theme',exact:true}).click();
    await assertSidebarTheme(page,'dark');
    await page.screenshot({path:artifacts+'/app-shell-dark.png'});
    await page.setViewportSize({width:390,height:844});
    await assertNoOverflow(page,'authenticated mobile');
    await page.screenshot({path:artifacts+'/app-shell-mobile.png'});
    await page.getByRole('button',{name:'Open navigation',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#app-sidebar')?.contains(document.activeElement));
    await assertSidebarTheme(page,'dark');
    await assertNoOverflow(page,'open mobile navigation');
    await page.screenshot({path:artifacts+'/app-shell-mobile-navigation.png'});
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor();
    assert.equal(await page.locator('#app-sidebar').count(),0,'Sign out returns to the real auth route');
    await page.goto(url+'?mode=signedin');
    await page.getByRole('heading',{name:'Support Center',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.bootCalls.filter(call=>call.path==='auth.session').length),1,'Stored-session startup verifies once under StrictMode');
    await assertSidebarTheme(page,'light');
    await assertNoOverflow(page,'stored-session startup');
    assert.equal(await page.locator('.app-error-state').count(),0);
    assert.deepEqual(errors,[]);assert.deepEqual(apiRequests,[],'All boot clients are isolated; no backend request escapes');
  } finally {
    await browser?.close();await Promise.all(['html','tsx'].map(extension=>rm(new URL(name+'.'+extension,root),{force:true})));
  }
});
