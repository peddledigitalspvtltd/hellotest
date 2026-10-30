import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);
const name = `story-ai-required-fields-${randomUUID()}`;

test('edited AI Story creation and completion require title, description and criteria before writes', { timeout: 120000 }, async () => {
  const source = await readFile(new URL('./storyPlanningAssignments.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(source.match(/const fixture = (`[\s\S]*?`);/)[1]);
  fixture = fixture.replace('let story=null;', `let story={id:'saved-story',project_id:'project',display_id:'ST-1',title:'Saved delivery preferences',description:'The customer can restore a saved delivery address.',acceptance_criteria:['The saved delivery address appears when checkout reopens.'],status:'open',priority:3,labels:[],external_references:[],test_case_ids:[],defect_ids:[],gherkin_scenarios:[],specification_format:'speckit',specification_content:'Restore the saved address without changing it.',revision:1};`);
  fixture = fixture.replace("initialEntries:['/?create=1&sprint_id=native-sprint&release_id=open-release']", "initialEntries:['/']");
  fixture = fixture.replace('const mode=new URLSearchParams', `
api.integrations.list=async()=>[{id:'llm',name:'Fixture LLM',type:'llm',is_active:true,model:'fixture'}];
const proposal={client_id:'proposal-1',title:'Restore delivery preferences',description:'The customer can review the saved delivery address when returning to checkout.',acceptance_criteria:['Reopening checkout displays the saved delivery address.'],external_references:[],priority:3,status:'open',risks:[],open_questions:[],change_summary:['Clarified restoration behavior.'],evidence_refs:['story:saved-story']};
const receipt={request_id:'review-request',input_fingerprint:'review-fingerprint',fallback_used:false,preview_only:true};
const job={...receipt,id:'fixture-job',status:'completed',requirements:[proposal],suggestion:proposal};
api.requirements.createGenerationJob=async input=>{window.calls.push({kind:'generate',input});return job};
api.requirements.getGenerationJob=async()=>job;
api.requirements.previewOptimization=async(id,input)=>{window.calls.push({kind:'complete',id,input});return{...receipt,requirement:{id,title:story.title},suggestion:proposal}};
api.attachments.meta=async()=>({enabled:true,uploadLimit:1024*1024});
const mode=new URLSearchParams`);
  let browser;
  try {
    await writeFile(new URL(`${name}.tsx`, root), fixture);
    await writeFile(new URL(`${name}.html`, root), `<html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    for (const mode of ['create', 'improve']) {
      const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => { errors.push(`Unexpected API ${route.request().url()}`); return route.abort(); });
      await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5173'}/${name}.html`);
      await page.getByText('Saved delivery preferences', { exact: true }).waitFor();
      if (mode === 'improve') {
        await page.getByText('Saved delivery preferences', { exact: true }).click();
        await page.getByRole('heading', { name: 'Story details', exact: true }).waitFor();
      }
      const action = mode === 'create' ? 'Create Stories using AI' : 'AI Complete Story';
      for (const button of await page.getByRole('button', { name: action, exact: true }).all()) {
        if (await button.isVisible() && !await button.isDisabled()) { await button.click(); break; }
      }
      const dialog = page.getByRole('dialog', { name: action, exact: true });
      await dialog.waitFor();
      await dialog.getByRole('textbox', { name: 'Instructions for Story Architect', exact: true }).fill('Clarify restoration using the supplied Story facts.');
      await dialog.getByRole('button', { name: mode === 'create' ? 'Generate drafts' : 'Complete Story', exact: true }).click();
      await dialog.getByRole('textbox', { name: 'Story title', exact: true }).waitFor();
      if (mode === 'create') await dialog.getByLabel('Select Restore delivery preferences', { exact: true }).check();
      const accept = dialog.getByRole('button', { name: mode === 'create' ? 'Accept into Library' : 'Apply to Story', exact: true });
      await accept.waitFor();
      assert.equal(await accept.isDisabled(), false);
      const description = dialog.getByRole('textbox', { name: 'Story description', exact: true });
      await description.fill('');
      assert.equal(await accept.isDisabled(), true, 'An empty edited description must stop acceptance.');
      assert.equal(await description.getAttribute('aria-invalid'), 'true');
      await description.fill('The customer can review the saved delivery address when returning to checkout.');
      const criterion = dialog.getByRole('textbox', { name: 'Acceptance criterion 1', exact: true });
      await criterion.fill(' ');
      assert.equal(await accept.isDisabled(), true, 'Open questions or whitespace cannot replace acceptance criteria.');
      await criterion.fill('Reopening checkout displays the saved delivery address.');
      await dialog.getByRole('button', { name: 'Remove acceptance criterion 1', exact: true }).click();
      assert.equal(await accept.isDisabled(), true, 'Removing the last criterion must stop acceptance.');
      await dialog.getByRole('button', { name: 'Add criterion', exact: false }).click();
      await dialog.getByRole('textbox', { name: 'Acceptance criterion 1', exact: true }).fill('Reopening checkout displays the saved delivery address.');
      const title = dialog.getByRole('textbox', { name: 'Story title', exact: true });
      await title.fill('');
      assert.equal(await accept.isDisabled(), true);
      await title.fill('Restore delivery preferences');
      assert.equal(await page.evaluate(() => window.calls.filter(call => ['create', 'update'].includes(call.kind)).length), 0, 'Invalid edited previews never write.');
      assert.equal(await accept.isDisabled(), false);
      await accept.click();
      await page.waitForFunction(kind => window.calls.some(call => call.kind === kind), mode === 'create' ? 'create' : 'update');
      const writes = await page.evaluate(() => window.calls.filter(call => ['create', 'update'].includes(call.kind)));
      assert.equal(writes.length, 1);
      assert.equal(writes[0].input.ai_review.capability, mode === 'create' ? 'ai-story-create' : 'ai-story-complete');
      assert.equal(writes[0].input.ai_review.request_id, 'review-request');
      assert.equal(writes[0].input.ai_review.input_fingerprint, 'review-fingerprint');
      assert.equal(writes[0].input.acceptance_criteria.length, 1);
      assert.ok(writes[0].input.description.trim());
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser?.close();
    await Promise.all([rm(new URL(`${name}.tsx`, root), { force: true }), rm(new URL(`${name}.html`, root), { force: true })]);
  }
});
