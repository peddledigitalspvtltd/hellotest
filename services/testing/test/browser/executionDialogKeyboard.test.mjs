import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assertAccessibleControls } from '../../../platform/frontend/test/browser/axeControls.mjs';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const frontend = new URL('../../../platform/frontend/', import.meta.url);
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider} from '/src/auth/AuthContext';import {LocalizationProvider} from '/src/context/LocalizationContext';
import {api,sessionStorage} from '/src/lib/api';import {setCurrentScope} from '/src/platform/hooks/useCurrentProject';
import {ExecutionApiStepDialog,ReportEmailModal} from '/services/testing/frontend/pages/execution-workspace/ExecutionRunnerDialogs';
import '/src/styles.css';import '/src/dark-theme.css';import '/src/modal-system.css';import '/src/overlay-layers.css';
import '/services/testing/frontend/pages/ExecutionsPage.case-run.css';import '/src/product-experience.css';import '/src/walkthrough-overrides.css';
const session={token:'dialog-keyboard-fixture',user:{id:'qa',name:'QA Reviewer',role:'admin'}};sessionStorage.write(session);setCurrentScope('project','app');
for(const methods of Object.values(api))if(methods&&typeof methods==='object')for(const [key,value]of Object.entries(methods))if(typeof value==='function')methods[key]=async()=>[];
const flags={flags:new Proxy({},{get:()=>true})};api.auth.session=async()=>session;api.featureFlags.snapshot=async()=>flags;
api.metadata.workspaceScopes=async()=>({projects:[{id:'project',name:'Fixture project',has_access:true}]});api.settings.getWorkspacePreferences=async()=>({preferences:{}});
window.actions={apiRuns:0,emailSubmissions:0,apiCloses:0,emailCloses:0};
const step={id:'step',test_case_id:'case',step_order:3,step_type:'api',action:'Inspect a recorded false response',expected_result:'The boolean false remains visible',api_request:{method:'GET',url:'https://fixture.example.test/state',headers:[],body_mode:'none',body:'',validations:[]}};
const detail={request:{method:'GET',url:'https://fixture.example.test/state',headers:{Accept:'application/json'}},response:{status:200,status_text:'OK',headers:{'content-type':'application/json'},body:'false',json:false},assertions:[{kind:'json_path',target:'$',expected:'false',actual:false,passed:true}],captures:{'r.observed':'false'}};
function Fixture(){const [dialog,setDialog]=useState(''),[recipients,setRecipients]=useState('qa@example.test'),[busy,setBusy]=useState(false);window.setEmailBusy=setBusy;
 return <><main><h1>Execution dialog fixture</h1><button onClick={()=>setDialog('api')} type='button'>Open API response</button><button onClick={()=>{setBusy(false);setDialog('email')}} type='button'>Open email report</button><button onClick={()=>{setBusy(true);setDialog('email')}} type='button'>Open busy email report</button></main>
 {dialog==='api'?<ExecutionApiStepDialog step={step} detail={detail} captures={detail.captures} note='Recorded response only' status='passed' canRun isRunning={false} onClose={()=>{window.actions.apiCloses++;setDialog('')}} onRun={()=>window.actions.apiRuns++}/>:null}
 {dialog==='email'?<ReportEmailModal runName='Recorded execution report' recipients={recipients} isSubmitting={busy} onRecipientsChange={setRecipients} onClose={()=>{window.actions.emailCloses++;setDialog('')}} onSubmit={event=>{event.preventDefault();window.actions.emailSubmissions++}}/>:null}</>;
}
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});client.setQueryData(['feature-flags'],flags);
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId='qa'><Fixture/></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;
async function expectFocusInside(page, dialog) {
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement));
  assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
}
async function expectTabTrap(page, dialog) {
  const controls = dialog.locator('button:visible:not([disabled]),input:visible:not([disabled]),textarea:visible:not([disabled]),select:visible:not([disabled]),a[href]:visible');
  assert.ok(await controls.count());
  await controls.last().focus(); await page.keyboard.press('Tab');
  assert.equal(await controls.first().evaluate(element => element === document.activeElement), true, 'Tab wraps to the first dialog control');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await controls.last().evaluate(element => element === document.activeElement), true, 'Shift+Tab wraps to the last dialog control');
}

test('execution response and email dialogs trap keyboard focus, close safely and restore their opener', { timeout: 120000 }, async () => {
  const name = 'execution-dialog-qa-' + randomUUID();
  let browser;
  try {
    if (process.env.BROWSER_SCREENSHOT_DIR) await mkdir(process.env.BROWSER_SCREENSHOT_DIR,{recursive:true});
    await writeFile(new URL(name + '.tsx', frontend), fixture);
    await writeFile(new URL(name + '.html', frontend), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(45000);
      const errors = [];page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/api/**', route => { errors.push('Unexpected network request: ' + new URL(route.request().url()).pathname);return route.abort(); });
      await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5200'}/${name}.html`);
      const apiOpener = page.getByRole('button', { name: 'Open API response', exact: true });
      await apiOpener.focus();await page.keyboard.press('Enter');
      const response = page.getByRole('dialog', { name: 'Step 3 API execution details', exact: true });
      await response.waitFor();await expectFocusInside(page,response);
      assert.equal(await response.getByRole('button',{name:'Close',exact:true}).evaluate(element=>element===document.activeElement),true,'API response initially focuses its Close control');
      const tree = response.locator('.api-response-tree-select');
      await tree.getByText('false', { exact: true }).waitFor();await tree.click();
      assert.equal(await response.locator('.automation-response-selection pre code').innerText(), 'false');
      assert.match(await response.locator('.execution-api-assertion-list').innerText(), /Actual false/);
      await expectTabTrap(page,response);await assertAccessibleControls(page,'[role=dialog]');
      if(process.env.BROWSER_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.BROWSER_SCREENSHOT_DIR,'execution-api-dialog-'+width+'.png'),animations:'disabled'});
      await page.keyboard.press('Escape');await response.waitFor({state:'hidden'});
      assert.equal(await apiOpener.evaluate(element=>element===document.activeElement),true,'API response returns focus to its opener');

      const emailOpener = page.getByRole('button', { name: 'Open email report', exact: true });
      await emailOpener.focus();await page.keyboard.press('Enter');
      const email = page.getByRole('dialog', { name: 'Email run report', exact: true });
      await email.waitFor();await expectFocusInside(page,email);
      assert.equal(await email.getByRole('textbox',{name:'Recipients',exact:true}).evaluate(element=>element===document.activeElement),true,'Email report initially focuses Recipients');
      await expectTabTrap(page,email);await assertAccessibleControls(page,'[role=dialog]');
      if(process.env.BROWSER_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.BROWSER_SCREENSHOT_DIR,'execution-email-dialog-'+width+'.png'),animations:'disabled'});
      await page.keyboard.press('Escape');await email.waitFor({state:'hidden'});
      assert.equal(await emailOpener.evaluate(element=>element===document.activeElement),true,'Email report returns focus to its opener');

      const busyOpener = page.getByRole('button', { name: 'Open busy email report', exact: true });
      await busyOpener.focus();await page.keyboard.press('Enter');
      await email.waitFor();await expectFocusInside(page,email);
      assert.equal(await email.getByRole('textbox',{name:'Recipients',exact:true}).evaluate(element=>element===document.activeElement),true,'Busy email report initially focuses Recipients');
      await expectTabTrap(page,email);
      assert.equal(await email.getByRole('button',{name:'Close',exact:true}).isDisabled(),true);
      await page.keyboard.press('Escape');assert.equal(await email.isVisible(),true,'busy email report ignores Escape');
      await assertAccessibleControls(page,'[role=dialog]');
      if(process.env.BROWSER_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.BROWSER_SCREENSHOT_DIR,'execution-busy-email-dialog-'+width+'.png'),animations:'disabled'});
      assert.deepEqual(await page.evaluate(()=>window.actions),{apiRuns:0,emailSubmissions:0,apiCloses:1,emailCloses:1});
      await page.evaluate(()=>window.setEmailBusy(false));await email.getByRole('button',{name:'Close',exact:true}).waitFor({state:'visible'});
      await page.waitForFunction(()=>!document.querySelector('[role="dialog"] button').disabled);
      await page.keyboard.press('Escape');await email.waitFor({state:'hidden'});
      assert.equal(await busyOpener.evaluate(element=>element===document.activeElement),true,'busy report restores its own opener when closing becomes allowed');
      assert.equal(await page.evaluate(()=>window.actions.emailSubmissions),0,'fixture never sends email');
      assert.equal(await page.evaluate(()=>window.actions.apiRuns),0,'fixture never executes the recorded request');
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally {await browser?.close();await Promise.all([unlink(new URL(name+'.tsx',frontend)).catch(()=>{}),unlink(new URL(name+'.html',frontend)).catch(()=>{})]);}
});
