import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);
const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AiPromptContextPanel} from '/src/components/AiPromptContextPanel';
import {api,sessionStorage} from '/src/lib/api';
import {AuthProvider} from '/src/auth/AuthContext';
import {LocalizationProvider} from '/src/context/LocalizationContext';
import policy from '/src/lib/featurePolicy.generated.json';
import '/src/styles.css';
import '/src/modal-system.css';
const session={token:'fixture',user:{id:'reviewer',role:'admin',name:'Reviewer',email:'reviewer@example.test'}};
sessionStorage.write(session);
api.auth.session=async()=>session;
api.settings.getLocalization=async()=>({strings:{}});
api.settings.getWorkspacePreferences=async()=>({preferences:{}});
api.featureFlags.snapshot=async()=>({flags:Object.fromEntries(policy.feature_keys.map(key=>[key,true]))});
api.aiPromptTemplates.list=async()=>[];
window.searches=[];
const hit=(id,extra={})=>({id,chunk_id:id,source_id:'source-'+id,source_kind:'requirement',title:'Relevant checkout '+id,content:'Unique checkout evidence '+id+' '+('Payment validation. '.repeat(80)),...extra});
api.knowledgeRepo.search=async input=>{
 window.searches.push(input);
 return {results:[hit('out-of-scope',{source_kind:'execution',title:'Unrelated run'}),hit('current',{source_ref_id:'selected-story',title:'Duplicate selected story'}),hit('duplicate'),hit('duplicate'),...Array.from({length:16},(_,i)=>hit('source-'+i))]};
};
const story={id:'selected-story',project_id:'project',title:'Selected checkout story',description:'Customers must verify payment before confirming checkout.',status:'open'};
function Fixture(){
 const [context,setContext]=useState('Manual checkout instructions');
 window.appliedContext=context;
 return <AiPromptContextPanel additionalContext={context} onAdditionalContextChange={setContext} appTypeId="app" projectId="project" promptScope="requirement_completion" requirements={[story]} includeArtifactContextInPack={false} externalLinksText="" onExternalLinksTextChange={()=>{}} referenceImages={[]} onAddImages={()=>{}} onRemoveImage={()=>{}}/>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AuthProvider><LocalizationProvider userId="reviewer"><Fixture/></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;

test('Smart Context applies the exact reviewed artifact/file evidence with scoped, deduplicated, bounded sources', { timeout: 30000 }, async () => {
  const name = 'smart-context-review-' + randomUUID();
  const html = new URL(name + '.html', root), tsx = new URL(name + '.tsx', root);
  let browser;
  try {
    await writeFile(html, '<!doctype html><html><body><div id="root"></div><script type="module" src="/' + name + '.tsx"></script></body></html>');
    await writeFile(tsx, fixture);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto((process.env.VITE_TEST_URL || 'http://127.0.0.1:5189') + '/' + name + '.html');
    await page.getByRole('tab', { name: 'Files', exact: true }).click();
    await page.locator('.ai-context-file-button input').setInputFiles({ name: 'checkout-rules.txt', mimeType: 'text/plain', buffer: Buffer.from('File checkout rule: customers must receive one confirmation after successful payment.') });
    await page.getByRole('button', { name: 'Smart Context', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Smart Context workbench' });
    await dialog.getByRole('button', { name: 'Retrieve', exact: true }).click();
    const preview = dialog.getByRole('textbox', { name: 'Editable Smart Context' });
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="Editable Smart Context"]')?.value.endsWith('[HELLOTEST_SMART_CONTEXT_END]'));
    const firstPack = await preview.inputValue();
    assert.ok(firstPack.length <= 12000);
    assert.doesNotMatch(firstPack, /Selected stories \(/, 'the artifact already sent in the primary request is not repeated in additional context');
    assert.match(firstPack, /File checkout rule/);
    assert.doesNotMatch(firstPack, /Unrelated run|Duplicate selected story/);
    assert.equal((firstPack.match(/\[duplicate\]/g) || []).length, 1);
    assert.equal(await dialog.locator('.smart-context-result').count(), 16, 'wrong-domain, current-artifact and duplicate hits are removed');
    const request = await page.evaluate(() => window.searches[0]);
    assert.match(request.query, /Selected checkout story/);
    assert.equal(request.project_id, 'project'); assert.equal(request.filters.app_type_id, 'app');
    assert.ok(request.filters.source_kinds.includes('requirement'));
    assert.equal(request.filters.source_kinds.includes('execution'), false);
    const edited = firstPack.replace('Unique checkout evidence duplicate', 'Reviewer edit:\n  Preserve   spacing.');
    await preview.fill(edited);
    await dialog.getByRole('button', { name: /^Apply \d+ source/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    const applied = await page.evaluate(() => window.appliedContext);
    assert.equal(applied, 'Manual checkout instructions\n\n---\n\n' + edited);
    await page.getByRole('button', { name: 'Smart Context', exact: true }).click();
    await dialog.getByRole('button', { name: 'Retrieve', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="Editable Smart Context"]')?.value.endsWith('[HELLOTEST_SMART_CONTEXT_END]'));
    const rebuilt = await preview.inputValue();
    await dialog.getByRole('button', { name: /^Apply \d+ source/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.appliedContext), 'Manual checkout instructions\n\n---\n\n' + rebuilt, 'a subsequent pack replaces all old reviewed evidence without duplicate separators');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all([unlink(html).catch(() => {}), unlink(tsx).catch(() => {})]);
  }
});
