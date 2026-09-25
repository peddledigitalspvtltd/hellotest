import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url))('playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);

test('suite transfer preserves scope selection and prevents cross-application Add', { timeout: 90000 }, async () => {
  const name = `suite-transfer-${randomUUID()}`;
  const html = new URL(`${name}.html`, root), tsx = new URL(`${name}.tsx`, root);
  let browser;
  try {
    await writeFile(html, `<html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider} from '/src/auth/AuthContext';
import {TestCaseSuiteTransferModal} from '/services/testing/frontend/components/TestCaseSuiteTransferModal';
import {api,sessionStorage} from '/src/lib/api';
import {testingApi} from '/services/testing/frontend/api.client';
import '/src/styles.css';import '/src/modal-system.css';
const session={token:'fixture',user:{id:'reviewer',name:'Reviewer',email:'reviewer@example.test',role:'admin'}};
sessionStorage.write(session);api.auth.session=async()=>session;
const flags={flags:{'hellotest.manual.suites':true}};
api.featureFlags.snapshot=async()=>flags;
window.reads=[];window.submits=[];
testingApi.testSuites.list=async input=>{window.reads.push(input.app_type_id);return[{id:input.app_type_id+'-suite',name:input.app_type_id+' suite'}]};
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});client.setQueryData(['feature-flags'],flags);
function Fixture(){const[action,setAction]=useState('add'),[project,setProject]=useState('p1'),[app,setApp]=useState('a1'),[suites,setSuites]=useState([]);
return <TestCaseSuiteTransferModal action={action} caseCount={2} projects={[{id:'p1',name:'Project One'},{id:'p2',name:'Project Two'}]} appTypes={[{id:'a1',project_id:'p1',name:'App One'},{id:'a2',project_id:'p2',name:'App Two'}]} currentAppTypeId='a1' targetProjectId={project} targetAppTypeId={app} selectedSuiteIds={suites} isSaving={false} onActionChange={setAction} onProjectChange={setProject} onAppTypeChange={setApp} onSuiteIdsChange={setSuites} onClose={()=>{}} onSubmit={()=>window.submits.push({action,project,app,suites})}/>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><Fixture/></AuthProvider></QueryClientProvider>);
`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5192'}/${name}.html`);
    await page.getByRole('button', { name: 'Select a1 suite', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Add suite links', exact: true }).isEnabled(), true);
    await page.getByLabel('Target project', { exact: true }).selectOption('p2');
    await page.getByRole('button', { name: 'Select a2 suite', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Add suite links', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await page.getByRole('button', { name: 'Copy cases', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.submits), [{ action: 'copy', project: 'p2', app: 'a2', suites: ['a2-suite'] }]);
    assert.deepEqual(await page.evaluate(() => [...new Set(window.reads)]), ['a1', 'a2']);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all([html, tsx].map(file => unlink(file).catch(() => {})));
  }
});
