import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);

const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AiDesignStudioModal} from '/services/ai/frontend/components/AiDesignStudioModal';
import {api,sessionStorage} from '/src/lib/api';
import {AuthProvider} from '/src/auth/AuthContext';
import {LocalizationProvider} from '/src/context/LocalizationContext';
import '/src/styles.css';
import '/src/modal-system.css';
const allProviders=[{id:'first',name:'First provider',model:'model-a',type:'llm'},{id:'second',name:'Second provider',model:'model-b',type:'llm'}];
const scenario=new URLSearchParams(location.search).get('scenario');
const providers=scenario==='sole' ? [allProviders[0],{...allProviders[1],is_active:false}] : allProviders;
let preferences=scenario==='success' ? {ai_last_successful_llm:[{integration_id:'second',project_id:'project-1',usage_key:'ai.test_case.design',succeeded_at:'2026-09-22T12:00:00Z'}]} : {};
const session={token:'browser-fixture',user:{id:'reviewer',name:'Reviewer',email:'reviewer@example.test',role:'admin'}};
sessionStorage.write(session);
api.auth.session=async()=>session;
api.settings.getLocalization=async()=>({strings:{}});
api.settings.getWorkspacePreferences=async()=>({preferences});
api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});
api.aiPromptTemplates.list=async()=>[];
const story={id:'story-1',project_id:'project-1',title:'Verify customer checkout',description:'Review the customer checkout flow.',status:'open'};
function Fixture(){
 const [integrationId,setIntegrationId]=useState('');
 const [generation,setGeneration]=useState(0);
 window.remountAfterSuccess=()=>{preferences={ai_last_successful_llm:[{integration_id:'first',project_id:'project-1',usage_key:'ai.test_case.design',succeeded_at:'2026-09-22T13:00:00Z'}]};setIntegrationId('');setGeneration(value=>value+1);};
 const [integrations,setIntegrations]=useState(providers);
 const [busy,setBusy]=useState(false);
 const [context,setContext]=useState('Preserve checkout validation');
 const [links,setLinks]=useState('https://example.test/reference');
 window.removeSecondProvider=()=>setIntegrations(providers.slice(0,1));
 const preview=async authoring_mode=>{setBusy(true);try{await api.testCases.previewDesignedCases({app_type_id:'app-1',requirement_ids:['story-1'],integration_id:integrationId||undefined,max_cases:2,authoring_mode,additional_context:context,external_links:[],images:[]})}finally{setBusy(false)}};
 return <AiDesignStudioModal key={generation} eyebrow="AI Test Case Generation" requirementLabel="Stories" requirementHelpText="Choose Story scope" requirements={[story]} selectedRequirementIds={['story-1']} allowMultipleRequirements onRequirementSelectionChange={()=>{}} integrations={integrations} integrationId={integrationId} onIntegrationIdChange={setIntegrationId} maxCases={2} onMaxCasesChange={()=>{}} additionalContext={context} onAdditionalContextChange={setContext} externalLinksText={links} onExternalLinksTextChange={setLinks} referenceImages={[]} onAddImages={()=>{}} onRemoveImage={()=>{}} appTypeName="Checkout Web" existingCases={[]} existingCasesTitle="Existing cases" existingCasesSubtitle="Current coverage" previewCases={[]} onRemovePreviewCase={()=>{}} previewMessage="" previewTone="success" onPreviewMessageDismiss={()=>{}} isPreviewing={busy} isAccepting={false} onPreview={preview} onSchedule={()=>{}} onAccept={()=>{}} onClose={()=>{}} disablePreview={false} disableSchedule={false} disableAccept acceptLabel="Accept drafts" promptTemplateProjectId="project-1" promptTemplateAppTypeId="app-1"/>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AuthProvider><LocalizationProvider userId="reviewer"><Fixture/></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;

test('test generator LLM dropdown preserves explicit and configured payloads without provider calls', { timeout: 45000 }, async () => {
  const name = 'ai-llm-dropdown-' + randomUUID();
  const html = new URL(name + '.html', root), tsx = new URL(name + '.tsx', root);
  let browser;
  let page;
  let releasePreview;
  const requests = [], errors = [], unexpectedRequests = [];
  try {
    await writeFile(html, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script>window.__HELLOTEST_CONFIG__={API_BASE_URL:"/fixture-api"}</script><script type="module" src="/' + name + '.tsx"></script></body></html>');
    await writeFile(tsx, fixture);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/fixture-api/**', async route => {
      if (!route.request().url().endsWith('/test-cases/design-test-cases-preview')) {
        unexpectedRequests.push(route.request().url());
        return route.fulfill({ json: [] });
      }
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) await new Promise(resolve => { releasePreview = resolve; });
      await route.fulfill({ json: { cases: [], generated: 0 } });
    });
    await page.goto((process.env.VITE_TEST_URL || 'http://127.0.0.1:5188') + '/' + name + '.html');
    const select = page.getByRole('combobox', { name: 'LLM', exact: true });
    await select.waitFor();
    assert.equal(await page.getByLabel('LLM', { exact: true }).count(), 1);
    assert.equal(await select.inputValue(), '');
    assert.equal(await select.locator('option:checked').innerText(), 'Configured LLM');
    assert.match(await page.locator('.ai-test-generator-status-footer').innerText(), /Model: Configured LLM/);
    assert.equal(await page.getByRole('radiogroup', { name: 'Intelligence engine' }).count(), 0);

    const toolbar = page.locator('.ai-prompt-context-toolbar');
    const controls = [toolbar.getByRole('tab', { name: /^Text/ }), toolbar.getByRole('tab', { name: 'Files', exact: true }), toolbar.getByRole('tab', { name: 'Images', exact: true }), toolbar.getByRole('button', { name: /Templates/ })];
    const boxes = await Promise.all(controls.map(control => control.boundingBox()));
    assert.ok(boxes.every(Boolean), 'Text, Files, Images and Templates remain visible');
    assert.ok(Math.max(...boxes.map(box => box.y)) - Math.min(...boxes.map(box => box.y)) < 5, 'Context inputs and Templates share one line');

    await select.selectOption('second');
    assert.match(await page.locator('.ai-test-generator-status-footer').innerText(), /Model: model-b/);
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.locator('.ai-test-generator-footer').getByRole('button', { name: 'Generating…', exact: true }).waitFor();
    assert.equal(await select.isDisabled(), true, 'LLM cannot change during generation');
    assert.deepEqual(requests[0], { app_type_id: 'app-1', requirement_ids: ['story-1'], integration_id: 'second', max_cases: 2, authoring_mode: 'structured', additional_context: 'Preserve checkout validation', external_links: [], images: [] });
    releasePreview(); releasePreview = null;
    await page.getByRole('button', { name: 'Generate', exact: true }).waitFor();
    await page.evaluate(() => window.removeSecondProvider());
    await page.getByText('Choose an available LLM or Configured LLM to generate new drafts.', { exact: true }).waitFor();
    assert.equal(await select.inputValue(), 'second', 'Missing selection is retained rather than silently changed');
    assert.equal(await select.locator('option:checked').innerText(), 'second (unavailable)');
    assert.equal(await page.getByRole('button', { name: 'Generate', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Generate drafts', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Schedule', exact: true }).isDisabled(), true);

    await select.selectOption('');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.getByRole('button', { name: 'Generate', exact: true }).waitFor();
    assert.equal(requests.length, 2);
    assert.equal(Object.hasOwn(requests[1], 'integration_id'), false, 'Automatic selection is omitted from the API payload');
    assert.equal(requests[1].requirement_ids[0], 'story-1');
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpectedRequests, []);
    await mkdir('/tmp/qaira-ai-llm-dropdown', { recursive: true });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await toolbar.scrollIntoViewIfNeeded();
      const aligned = await Promise.all(controls.map(control => control.boundingBox()));
      assert.ok(aligned.every(Boolean));
      assert.ok(Math.max(...aligned.map(box => box.y)) - Math.min(...aligned.map(box => box.y)) < 5, width + 'px context toolbar stays on one line');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), width + 'px page does not overflow');
      await controls[0].focus();
      await controls[0].press('ArrowRight');
      assert.equal(await controls[1].getAttribute('aria-selected'), 'true', 'Arrow keys retain context tab navigation');
      await controls[1].press('Home');
      assert.equal(await controls[0].getAttribute('aria-selected'), 'true');
      await controls[3].scrollIntoViewIfNeeded();
      const templateBox = await controls[3].boundingBox();
      assert.ok(templateBox.x >= 0 && templateBox.x + templateBox.width <= width + 1, 'Templates can be viewed without page overflow');
      await controls[3].click();
      const templateDialog = page.locator('.ai-prompt-template-backdrop').getByRole('dialog');
      await templateDialog.waitFor();
      await templateDialog.getByRole('button', { name: /Close/ }).click();
      const toolbarBox = await toolbar.boundingBox();
      for (const control of controls) {
        const box = await control.boundingBox();
        assert.ok(box.x >= toolbarBox.x - 1 && box.x + box.width <= toolbarBox.x + toolbarBox.width + 1, width + 'px toolbar control stays fully visible with populated context');
      }
      const header = await page.locator('.ai-test-generator-header').boundingBox();
      const title = await page.locator('#ai-design-studio-title').boundingBox();
      assert.ok(title.y >= header.y && title.y + title.height <= header.y + header.height + 1, width + 'px title fits in its header');
      const workspace = page.locator('.ai-test-generator-workspace');
      await workspace.scrollIntoViewIfNeeded();
      const workspaceBox = await workspace.boundingBox();
      for (const selector of ['.ai-test-generator-workspace__identity', '.ai-test-generator-authoring-tabs', '.ai-test-generator-view-toggle', '.ai-test-generator-selection-bar']) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box.x >= workspaceBox.x - 1 && box.x + box.width <= workspaceBox.x + workspaceBox.width + 1, width + 'px ' + selector + ' fits in workspace');
      }
      if (width < 720) await page.screenshot({ path: '/tmp/qaira-ai-llm-dropdown/test-generator-workspace-' + width + '.png' });
      await page.locator('.ai-test-generator-context').scrollIntoViewIfNeeded();
      await page.screenshot({ path: '/tmp/qaira-ai-llm-dropdown/test-generator-' + width + '.png' });
    }
  } catch (error) {
    throw new Error(error.message + '\nBrowser state: ' + JSON.stringify({ errors, body: (await page?.locator('body').innerText())?.slice(0, 1000), selects: await page?.locator('select').allTextContents() }), { cause: error });
  } finally {
    releasePreview?.();
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
});


test('LLM defaults use the last working provider, refresh on reopening, and auto-select the sole active provider', { timeout: 30000 }, async () => {
  const name = 'ai-llm-defaults-' + randomUUID();
  const html = new URL(name + '.html', root), tsx = new URL(name + '.tsx', root);
  let browser;
  try {
    await writeFile(html, '<!doctype html><html><body><div id="root"></div><script type="module" src="/' + name + '.tsx"></script></body></html>');
    await writeFile(tsx, fixture);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const url = (process.env.VITE_TEST_URL || 'http://127.0.0.1:5188') + '/' + name + '.html';
    await page.goto(url + '?scenario=success');
    const select = page.getByRole('combobox', { name: 'LLM', exact: true });
    await page.waitForFunction(() => document.querySelector('.ai-llm-select select')?.value === 'second');
    await select.selectOption('first');
    assert.equal(await select.inputValue(), 'first', 'explicit user selection wins over the saved default');
    await page.evaluate(() => window.remountAfterSuccess());
    await page.waitForFunction(() => document.querySelector('.ai-llm-select select')?.value === 'first');
    await page.goto(url + '?scenario=sole');
    await page.waitForFunction(() => document.querySelector('.ai-llm-select select')?.value === 'first');
    assert.equal(await select.locator('option[value="second"]').count(), 0, 'inactive providers are excluded');
    await select.selectOption('');
    assert.equal(await select.inputValue(), '', 'choosing automatic explicitly is preserved');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all([unlink(html).catch(() => {}), unlink(tsx).catch(() => {})]);
  }
});
