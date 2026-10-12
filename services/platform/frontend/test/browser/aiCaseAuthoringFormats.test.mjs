import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);

test('AI improvement preserves current Gherkin when requesting structured output and retains edited step counts', { timeout: 90000 }, async () => {
  const source = await readFile(new URL('../../../../testing/test/browser/testCaseDataSets.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace('const client=new QueryClient', `
item.requirement_id=null;item.requirement_ids=[];
api.requirements.list=async()=>[{id:'story',project_id:'p',title:'Checkout Story',status:'open',priority:3,acceptance_criteria:['A purchase completes.']}];
api.integrations.list=async()=>[{id:'llm',name:'Author LLM',type:'llm',is_active:true}];
window.authoringRequests=[];
api.testCases.previewCaseAuthoring=async input=>{window.authoringRequests.push(structuredClone(input));return {case:{title:'Improved checkout',description:'A purchase completes',authoring_mode:input.authoring_mode,parameter_values:{},parameter_count:0,gherkin_document:input.authoring_mode==='gherkin'?'Feature: Checkout\\nScenario: Purchase\\nWhen the customer buys\\nThen a receipt appears':null,steps:input.authoring_mode==='gherkin'?[]:[{step_order:1,action:'Buy',expected_result:'Receipt appears'}],step_count:input.authoring_mode==='gherkin'?2:1}}};
const client=new QueryClient`);
  fixture += "\nimport '/src/product-experience.css';";
  const name = 'authoring-formats-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push(`Unexpected API ${route.request().url()}`); return route.abort(); });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5189'}/${name}.html?mode=gherkin`);
    await page.getByRole('button', { name: 'AI Improve Test Cases', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'AI Improve Test Case', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('radio', { name: 'Gherkin', exact: true }).getAttribute('aria-checked'), 'true');
    await dialog.getByRole('radio', { name: 'Structured', exact: true }).click();
    await dialog.getByRole('button', { name: 'Generate drafts', exact: true }).click();
    await dialog.getByRole('heading', {name: 'Improved checkout', exact: true}).waitFor();
    await dialog.getByRole('button',{name:'Compare',exact:true}).click();
    const comparison=dialog.getByRole('region',{name:'Current and proposed content',exact:true});
    await comparison.waitFor();assert.match(await comparison.innerText(), /Scenario Outline: A purchase/);assert.match(await comparison.innerText(), /Buy/);
    await dialog.getByRole('button',{name:'Hide comparison',exact:true}).click();
    const request = await page.evaluate(() => window.authoringRequests[0]);
    assert.equal(request.authoring_mode, 'structured');
    assert.equal(request.requirement_id, undefined);
    assert.equal(request.test_case.authoring_mode, 'gherkin');
    assert.match(request.test_case.gherkin_document, /Scenario Outline: A purchase/);
    await dialog.getByRole('radio', { name: 'Gherkin', exact: true }).click();
    await dialog.getByRole('button', { name: 'Generate drafts', exact: true }).click();
    await dialog.locator('.ai-artifact-item small').filter({hasText:'2 scenario lines'}).waitFor();
    await dialog.getByRole('button', { name: 'Edit draft', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Test case title', exact: true }).fill('Reviewed checkout');
    await dialog.getByRole('button', { name: 'Finish editing draft', exact: true }).click();
    assert.equal(await dialog.locator('.ai-artifact-item small').filter({hasText:'2 scenario lines'}).count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all(['tsx', 'html'].map(extension => rm(new URL(name + '.' + extension, root), { force: true })));
  }
});

test('AI generation accepts user instructions without any available Stories', { timeout: 90000 }, async () => {
  const source = await readFile(new URL('../../../../testing/test/browser/testCaseDataSets.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace("initialEntries:['/test-cases?case=case1']", "initialEntries:['/test-cases']");
  fixture = fixture.replace('const client=new QueryClient', `
api.requirements.list=async()=>[];
api.integrations.list=async()=>[{id:'llm',name:'Author LLM',type:'llm',is_active:true}];
window.generationRequests=[];
api.testCases.previewDesignedCases=async input=>{window.generationRequests.push(structuredClone(input));return {cases:[{client_id:'draft',title:'Measure latency',description:'Measure latency',priority:3,authoring_mode:'structured',requirement_ids:[],requirement_titles:[],steps:[{step_order:1,action:'Measure latency',expected_result:'Latency satisfies the supplied threshold'}],parameter_values:{}}],generated:1}};
const client=new QueryClient`);
  const name = 'optional-story-generation-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage();
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`);
    await page.getByRole('button', {name:'Open create test case options',exact:true}).click();
    await page.getByRole('menuitem', {name:/AI Test Cases Generation/}).click();
    const dialog = page.getByRole('dialog', {name:'AI Test Case Generator',exact:true});
    await dialog.waitFor();
    await dialog.locator('.ai-intent-canvas textarea').fill('Measure latency under 250 ms for 150 concurrent users.');
    await dialog.getByRole('button', {name:'Generate drafts',exact:true}).click();
    await page.waitForFunction(()=>window.generationRequests.length===1);
    const request=await page.evaluate(()=>window.generationRequests[0]);
    assert.deepEqual(request.requirement_ids, []);
    assert.match(request.additional_context,/250 ms/);
    await dialog.getByText('Measure latency',{exact:true}).first().waitFor();
  } finally {
    await browser?.close();
    await Promise.all(['tsx','html'].map(extension=>rm(new URL(name+'.'+extension,root),{force:true})));
  }
});
