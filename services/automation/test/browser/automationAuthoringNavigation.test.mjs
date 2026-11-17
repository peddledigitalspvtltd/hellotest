import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const expect = require('playwright/test').expect.configure({ timeout: 15000 });
const root = new URL('../../../platform/frontend/', import.meta.url);
const fixture = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,Routes,Route,useNavigate,useLocation} from 'react-router-dom';import {AuthProvider} from '/src/auth/AuthContext';import {api,sessionStorage} from '/src/lib/api';import {AutomationAuthoringProvider,useAutomationAuthoring,useAutomationSelection} from '/services/automation/frontend/hooks/AutomationAuthoringProvider';
let session={token:'authoring-fixture',user:{id:'first',role:'admin',name:'Reviewer',email:'reviewer@example.test'}};sessionStorage.write(session);api.auth.session=async()=>session;window.switchAuthoringAccount=()=>{session={...session,token:'next-authoring-fixture',user:{...session.user,id:'second'}};sessionStorage.write(session);window.dispatchEvent(new StorageEvent('storage',{key:'hellotest.session'}));};
function Probe(){const authoring=useAutomationAuthoring(),selection=useAutomationSelection(),navigate=useNavigate(),location=useLocation(),[notice,setNotice]=useState('');const current=authoring.caseState('case'),recording=authoring.activeRecording()?.recording;window.authoringProbe={phase:current.phase,origin:recording?.origin,options:recording?.options,privateCount:recording?.privateValues.length||0};window.selectionProbe=selection;
return <main><h1>{location.pathname==='/cases'?'Cases':'Case detail'}</h1><output aria-label="Authoring phase">{current.phase}</output><p>Protected parameters: {recording?.privateValues.length||0}</p><p data-testid="selection">{selection.state.caseIds.join(',')}</p><p role="status" aria-label="Authoring notice">{notice}</p>
<button onClick={()=>void authoring.syncAuthoringState('case').catch(error=>setNotice(error.message))}>Check state</button>
<button onClick={()=>{const op=authoring.beginRecording({caseId:'case',projectId:'project',appTypeId:'app',targetStepId:'target',environmentId:'env',configurationId:'config',dataSetId:'data',suiteId:'suite'},{recorder_mode:'remote',recorder_target:'web'},['private-fixture']);authoring.recordingStarted(op,{id:'recording-session',status:'running'});}}>Start recording</button>
<button onClick={()=>{try{authoring.beginBuild(['case']);}catch(error){setNotice(error.code);}}}>Try build</button>
<button onClick={()=>navigate(location.pathname==='/cases'?'/detail':'/cases')}>Navigate</button>
<button onClick={()=>authoring.beginRecordingSave('case')}>Save recording</button><button onClick={()=>authoring.recordingSaved('case','recording-session')}>Complete save</button></main>}
function CasesProbe(){return <Probe key="cases"/>}function DetailProbe(){return <Probe key="detail"/>}createRoot(document.getElementById('root')).render(<AuthProvider><MemoryRouter initialEntries={['/cases']}><AutomationAuthoringProvider projectId="project" appTypeId="app"><Routes><Route path="/cases" element={<CasesProbe/>}/><Route path="/detail" element={<DetailProbe/>}/></Routes></AutomationAuthoringProvider></MemoryRouter></AuthProvider>);`;

test('authoring context survives case navigation, rejects overlapping work and isolates a replacement account', { timeout: 120000 }, async () => {
  const name = 'authoring-navigation-' + randomUUID(), errors = [];
  let browser, stateRequested = false, release;
  const responseReady = new Promise(resolve => { release = resolve; });
  try {
    await writeFile(new URL(name + '.tsx', root), fixture); await writeFile(new URL(name + '.html', root), `<html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      if (!new URL(route.request().url()).pathname.endsWith('/test-cases/case/automation/authoring-state')) { errors.push('Unexpected API request'); return route.abort(); }
      stateRequested = true; await responseReady;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ case_id: 'case', state: 'idle', build: null, recording: null, can_build: true, can_record: true }) });
    });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`, { timeout: 60000 });
    await page.getByRole('button', { name: 'Check state', exact: true }).click(); await expect.poll(() => stateRequested).toBe(true);
    await page.getByRole('button', { name: 'Start recording', exact: true }).click(); await expect(page.getByLabel('Authoring phase', { exact: true })).toHaveText('recording');
    release(); await page.waitForTimeout(50); await expect(page.getByLabel('Authoring phase', { exact: true })).toHaveText('recording');
    await page.getByRole('button', { name: 'Navigate', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Case detail', exact: true })).toBeVisible();
    await expect(page.getByLabel('Authoring phase', { exact: true })).toHaveText('recording'); await expect(page.getByText('Protected parameters: 1', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.authoringProbe.origin.targetStepId), 'target'); assert.equal(await page.evaluate(() => window.authoringProbe.options.recorder_target), 'web');
    await page.getByRole('button', { name: 'Try build', exact: true }).click(); await expect(page.getByRole('status', { name: 'Authoring notice' })).toHaveText('AUTOMATION_AUTHORING_BUSY');
    await page.evaluate(() => { window.selectionProbe.toggleCase('first', true); window.selectionProbe.toggleCase('second', true); }); await expect(page.getByTestId('selection')).toHaveText('first,second');
    await page.getByRole('button', { name: 'Save recording', exact: true }).click(); await expect(page.getByLabel('Authoring phase', { exact: true })).toHaveText('record_saving');
    await page.getByRole('button', { name: 'Complete save', exact: true }).click(); await expect(page.getByLabel('Authoring phase', { exact: true })).toHaveText('idle');
    await expect(page.getByText('Protected parameters: 0', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start recording', exact: true }).click(); await page.evaluate(() => window.switchAuthoringAccount());
    await expect(page.getByLabel('Authoring phase', { exact: true })).toHaveText('idle'); await expect(page.getByText('Protected parameters: 0', { exact: true })).toBeVisible(); await expect(page.getByTestId('selection')).toHaveText('');
    assert.doesNotMatch(await page.locator('body').innerText(), /private-fixture/); assert.deepEqual(errors, []);
  } catch (error) { error.message += '\nBrowser errors: ' + JSON.stringify(errors); throw error; }
  finally { release(); await browser?.close(); await Promise.all([rm(new URL(name + '.tsx', root), { force: true }), rm(new URL(name + '.html', root), { force: true })]); }
});
