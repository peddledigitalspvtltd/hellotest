import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url);

test('Defect AI shares Story workbench and preserves provider, evidence, edits and explicit acceptance', { timeout: 90000 }, async () => {
  const catalog = await readFile(new URL('./catalogPages.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(catalog.match(/const fixture = (`[\s\S]*?`);/)[1]);
  fixture = fixture.replace('const client=new QueryClient', `
api.issues.createMetadata=async()=>({fields:[],core_fields:[],required_fields:[],current_values:{}});
api.integrations.list=async()=>[{id:'llm-a',name:'Draft LLM',type:'llm',is_active:true},{id:'llm-b',name:'Review LLM',type:'llm',is_active:true}];
api.issues.previewDraft=async(input)=>{window.calls.draft=input;return {
draft:{title:'Checkout submission fails',message:'A customer cannot complete checkout.',steps_to_reproduce:'Open checkout and submit the order.',expected_result:'The order is confirmed.',actual_result:'An error appears.',severity:'high',priority:'High',environment:'Staging',build:'v2',labels:['checkout'],linked_test_run_id:'',linked_test_case_ids:[],linked_requirement_ids:[],rationale:'Reporter evidence describes a failed submission.'},
citations:[],evidence_sources:[{ref:'E1',type:'reporter',id:'intent',title:'Reporter evidence',excerpt:'Checkout reports an error.'}],field_evidence:{title:['E1'],message:['E1']},gaps:[],assumptions:[],fallback_fields:[],
boundaries:{limits:{},requested:{notes:1},included:{notes:1},omitted:{},content_limits:{},content_omissions:[],partial_sources:false},processing:{stages:[],active_stage_id:'review',completed_stage_count:4,total_stage_count:4,status_label:'Ready for review'},provenance:{generation_mode:'llm',fallback_used:false,requires_human_review:true,evidence:[]}
}};
const client=new QueryClient`);
  // Confirm the production API method remains the one wired to the fixture.
  fixture = fixture.replace('api.issues.previewDraft=', 'api.issues.previewAiDraft=');
  const name = `defect-studio-${randomUUID()}`;
  let browser;
  try {
    await writeFile(new URL(`${name}.tsx`, root), fixture);
    await writeFile(new URL(`${name}.html`, root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await mkdir('/tmp/qaira-defect-studio', { recursive: true });
    browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    for (const [theme, width] of [['light', 1440], ['dark', 390]]) {
      const page = await browser.newPage({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => { errors.push(`Unexpected API ${route.request().url()}`); return route.abort(); });
      await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5189'}/${name}.html`);
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.getByRole('button', { name: 'Choose defect reporting method', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Report Defect using AI', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Report Defect using AI', exact: true });
      await dialog.getByRole('heading', { name: 'Defect Drafts', exact: true }).waitFor();
      assert.equal(await dialog.getByRole('radio').count(), 0, 'Defects have no irrelevant Gherkin mode');
      await dialog.getByLabel('What failed?', { exact: false }).fill('Checkout fails after submitting an order.');
      await dialog.locator('.ai-llm-select select').selectOption('llm-b');
      await dialog.getByRole('button', { name: /Review evidence setup/ }).click();
      await page.getByLabel('Observed evidence', { exact: true }).fill('The checkout request reports HTTP 500.');
      await page.getByRole('button', { name: 'Close Evidence and impacted scope', exact: true }).click();
      await dialog.getByRole('button', { name: 'Generate draft', exact: true }).click();
      await dialog.getByLabel('Title', { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => window.calls.draft.integration_id), 'llm-b');
      assert.match(await page.evaluate(() => window.calls.draft.evidence), /HTTP 500/);
      await dialog.getByLabel('Title', { exact: false }).fill('Reviewed checkout failure');
      await dialog.getByLabel('Actual result', { exact: true }).fill('The cart remains and the service returns HTTP 500.');
      await dialog.getByText('Human-edited content is unverified.', { exact: true }).waitFor();
      await dialog.locator('.ai-test-generator-workspace').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/qaira-defect-studio/${theme}-${width}.png`, animations: 'disabled' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await dialog.getByRole('button', { name: 'Show intelligence status' }).click();
      await dialog.getByText('Intelligence Status', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Hide intelligence status' }).click();
      await dialog.getByRole('button', { name: 'Accept into Defect form', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByLabel('Defect Title', { exact: false }).waitFor({timeout:5000}).catch(async error=>{throw new Error(error.message+'\n'+JSON.stringify(errors)+'\n'+(await page.locator('body').innerText()).slice(0,1800))});
      assert.equal(await page.getByLabel('Defect Title', { exact: false }).inputValue(), 'Reviewed checkout failure');
      assert.equal(await page.evaluate(() => window.calls.all.some(call => call.path === 'issues.create')), false, 'Acceptance only populates the human-reviewed form');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser?.close();
    await Promise.all([rm(new URL(`${name}.tsx`, root), { force: true }), rm(new URL(`${name}.html`, root), { force: true })]);
  }
});
