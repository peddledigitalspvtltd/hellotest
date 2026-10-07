import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);

test('Defect AI shares Story workbench and preserves provider, evidence, edits and explicit acceptance', { timeout: 90000 }, async () => {
  const catalog = await readFile(new URL('../../../../testing/test/browser/catalogPages.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(catalog.match(/const fixture = (`[\s\S]*?`);/)[1]);
  fixture = fixture.replace('const client=new QueryClient', `
api.issues.createMetadata=async()=>({fields:[],core_fields:[],required_fields:[],current_values:{}});
api.integrations.list=async()=>[{id:'llm-a',name:'Draft LLM',type:'llm',is_active:true},{id:'llm-b',name:'Review LLM',type:'llm',is_active:true}];
api.issues.previewDraft=async(input)=>{window.calls.draft=input;return {
draft:{title:'Checkout submission fails',message:'A customer cannot complete checkout.',steps_to_reproduce:'Open checkout and submit the order.',expected_result:'The order is confirmed.',actual_result:'An error appears.',severity:'high',priority:'High',environment:'Staging',build:'v2',labels:['checkout'],linked_test_run_id:'',linked_test_case_ids:['case-context'],linked_requirement_ids:[],rationale:'Reporter evidence describes a failed submission.'},
citations:[],evidence_sources:[{ref:'E1',type:'reporter',id:'intent',title:'Reporter evidence',excerpt:'Checkout reports an error.'}],field_evidence:{title:['E1'],message:['E1']},gaps:[],assumptions:[],fallback_fields:[],
boundaries:{limits:{},requested:{notes:1},included:{notes:1},omitted:{},content_limits:{},content_omissions:[],partial_sources:false},processing:{stages:[],active_stage_id:'review',completed_stage_count:4,total_stage_count:4,status_label:'Ready for review'},provenance:{generation_mode:'llm',fallback_used:false,requires_human_review:true,evidence:[]}
}};
const client=new QueryClient`);
  fixture += `\nimport '/src/product-experience.css';`;
  // Confirm the production API method remains the one wired to the fixture.
  fixture = fixture.replace('api.issues.previewDraft=', 'api.issues.previewAiDraft=');
  fixture += `
const contextCase={id:'case-context',project_id:'catalog-project',app_type_id:'catalog-app',title:'Checkout confirmation',display_id:'TC-1',requirement_ids:[],steps:[]};
api.testCases.get=async()=>contextCase;api.testCases.list=async()=>[contextCase];api.testCases.listPage=async()=>({items:[contextCase],total:1,page:1,page_size:25,has_more:false,is_last:true});
api.issues.previewAiImprove=async(input)=>{window.calls.improve=input;const response=await api.issues.previewAiDraft(input);return {...response,draft:{...response.draft,title:'Improved checkout reproduction',message:'Improved observed failure description.'}};};
`;
  const name = `defect-studio-${randomUUID()}`;
  let browser;
  try {
    await writeFile(new URL(`${name}.tsx`, root), fixture);
    await writeFile(new URL(`${name}.html`, root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await mkdir('/tmp/qaira-v2-defect-studio', { recursive: true });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
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
      await dialog.getByRole('heading', { name: 'What happened?', exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog', {name:'Context & options',exact:true}).isVisible(), false, 'Evidence settings stay out of the intent canvas');
      assert.equal(await dialog.getByRole('radio').count(), 0, 'Defects have no irrelevant Gherkin mode');
      await dialog.getByRole('textbox', {name:'Instructions for Defect Reporter',exact:true}).fill('Checkout fails after submitting an order.');
      await dialog.getByRole('button', {name:'Show context',exact:true}).click();
      const context=page.getByRole('dialog', {name:'Context & options',exact:true});
      await context.locator('.ai-llm-select select').selectOption('llm-b');
      await context.getByRole('button', { name: /Review evidence setup/ }).click();
      await page.getByLabel('Observed evidence', { exact: true }).fill('The checkout request reports HTTP 500.');
      await page.getByRole('button', { name: 'Close Evidence and impacted scope', exact: true }).click();
      await page.keyboard.press('Escape');
      assert.equal(await context.isVisible(),false);
      await dialog.getByRole('textbox', {name:'Instructions for Defect Reporter',exact:true}).focus();
      await page.keyboard.press('Control+Enter');
      await dialog.getByLabel('Title', { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => window.calls.draft.integration_id), 'llm-b');
      assert.match(await page.evaluate(() => window.calls.draft.evidence), /HTTP 500/);
      await dialog.getByLabel('Title', { exact: false }).fill('Reviewed checkout failure');
      await dialog.getByLabel('Actual result', { exact: true }).fill('The cart remains and the service returns HTTP 500.');
      await dialog.getByText('Human-edited content is unverified.', { exact: true }).waitFor();
      const titleColors=await dialog.getByLabel('Title', {exact:false}).evaluate(element=>({foreground:getComputedStyle(element).color,background:getComputedStyle(element).backgroundColor}));const luminance=value=>value.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);const lum=[luminance(titleColors.foreground),luminance(titleColors.background)].sort((a,b)=>b-a);assert.ok((lum[0]+.05)/(lum[1]+.05)>=4.5,JSON.stringify(titleColors));const noticeColors=await dialog.locator('.ai-bug-human-edit-notice').evaluate(element=>({foreground:getComputedStyle(element).color,background:getComputedStyle(element).backgroundColor}));const noticeLum=[luminance(noticeColors.foreground),luminance(noticeColors.background)].sort((a,b)=>b-a);assert.ok((noticeLum[0]+.05)/(noticeLum[1]+.05)>=4.5,JSON.stringify(noticeColors));
      await dialog.locator('.ai-test-generator-workspace').evaluate(element=>element.scrollTop=0);
      await page.screenshot({ path: `/tmp/qaira-v2-defect-studio/${theme}-${width}.png`, animations: 'disabled' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await dialog.getByRole('button', { name: 'Show intelligence status' }).count(),0);
      await dialog.getByRole('button', { name: 'Accept into Defect form', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByLabel('Defect Title', { exact: false }).waitFor({timeout:5000}).catch(async error=>{throw new Error(error.message+'\n'+JSON.stringify(errors)+'\n'+(await page.locator('body').innerText()).slice(0,1800))});
      assert.equal(await page.getByLabel('Defect Title', { exact: false }).inputValue(), 'Reviewed checkout failure');
      assert.equal(await page.evaluate(() => window.calls.all.some(call => call.path === 'issues.create')), false, 'Acceptance only populates the human-reviewed form');
      await page.getByRole('button',{name:'AI Defect Improve',exact:true}).click();
      const improve=page.getByRole('dialog',{name:'AI Defect Improve',exact:true});await improve.waitFor();
      await improve.getByRole('button',{name:'Show context',exact:true}).click();
      const settings=page.getByRole('dialog',{name:'Context & options',exact:true});await settings.getByRole('button',{name:/Review evidence setup/}).click();
      const evidence=page.getByRole('dialog',{name:'Evidence and impacted scope',exact:true});await evidence.waitFor();assert.equal(await evidence.getByLabel('Impacted Test Run').count(),0);assert.equal(await evidence.getByText('Impacted Stories',{exact:true}).count(),0);
      await page.keyboard.press('Escape');await page.keyboard.press('Escape');
      await improve.getByRole('button',{name:'Generate draft',exact:true}).click();await improve.getByRole('button',{name:'Apply selected fields',exact:true}).waitFor();
      assert.deepEqual(await page.evaluate(()=>window.calls.improve.linked_test_case_ids),['case-context']);
      await improve.locator('.ai-defect-field-review').getByRole('checkbox',{name:'Title',exact:true}).uncheck();
      await improve.getByRole('button',{name:'Apply selected fields',exact:true}).click();await improve.waitFor({state:'hidden'});
      assert.equal(await page.getByLabel('Defect Title',{exact:false}).inputValue(),'Reviewed checkout failure','Unselected title stays unchanged');
      assert.equal(await page.evaluate(()=>window.calls.all.some(call=>['issues.create','issues.update'].includes(call.path))),false);
      await page.getByRole('button',{name:'Close Report Defect',exact:true}).click();
      await page.locator('.issue-catalog-card').first().click();
      await page.getByRole('button',{name:'AI Defect Improve',exact:true}).waitFor();await page.getByRole('button',{name:'AI Defect Triage',exact:true}).waitFor();
      const actionBoxes = await Promise.all(['AI Defect Improve','AI Defect Triage','Convert to Test Case'].map(name => page.getByRole('button',{name,exact:true}).boundingBox()));
      assert.ok(actionBoxes.every(Boolean));
      assert.ok(Math.max(...actionBoxes.map(box=>box.y+box.height/2))-Math.min(...actionBoxes.map(box=>box.y+box.height/2))<2, 'Defect actions share one line');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser?.close();
    await Promise.all([rm(new URL(`${name}.tsx`, root), { force: true }), rm(new URL(`${name}.html`, root), { force: true })]);
  }
});
