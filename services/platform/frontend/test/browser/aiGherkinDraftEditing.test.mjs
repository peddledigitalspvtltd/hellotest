import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);
const generatedDocument = `@checkout
# Preserve the author-reviewed examples and request body.
Feature: Checkout receipt

Background:
  Given the customer is signed in

Scenario Outline: Buy a supported item
  Given the cart contains <item>
  When the customer completes checkout
  Then the receipt shows <total>
  And the receipt payload is
    """
    { "status": "paid" }
    """

Examples:
  | item | total |
  | Book | 100 |

Scenario: Empty cart
  Given the cart is empty
  When the customer opens checkout
  Then the purchase action is unavailable`;

for (const route of ['/test-cases','/requirements']) for (const theme of ['light','dark']) test(`AI generator keeps Gherkin visible and editable, then accepts the reviewed document (${route}, ${theme})`, { timeout: 90000 }, async () => {
  const source = await readFile(new URL('../../../../testing/test/browser/testCaseDataSets.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace("initialEntries:['/test-cases?case=case1']", "initialEntries:['/test-cases']");
  // The real workspace route styles previously hid the source behind an opaque
  // textarea. A standalone modal fixture cannot reproduce that regression.
  fixture = fixture.replace('<TestCasesPage/>', `<div className="workspace-main" data-route="${route}"><TestCasesPage/></div>`);
  fixture = fixture.replace('const client=new QueryClient', `
api.requirements.list=async()=>[];
api.integrations.list=async()=>[{id:'llm',name:'Author LLM',type:'llm',is_active:true}];
window.generationRequests=[];window.accepted=[];
api.testCases.previewDesignedCases=async input=>{window.generationRequests.push(structuredClone(input));return {cases:[{client_id:'gherkin-draft',title:'Checkout receipt',description:'Verify checkout receipts and the empty cart boundary.',priority:3,test_case_type:'functional',authoring_mode:'gherkin',gherkin_document:${JSON.stringify(generatedDocument)},requirement_ids:[],requirement_titles:[],steps:[],step_count:8,parameter_values:{}}],generated:1}};
api.testCases.acceptDesignedCases=async input=>{window.accepted.push(structuredClone(input));return {created:[]}};
const client=new QueryClient`);
  fixture += "\nimport '/src/execution-run-builder.css';\nimport '/src/product-experience.css';";
  const name = 'gherkin-draft-editing-' + randomUUID();
  const screenshotDir = (process.env.BROWSER_SCREENSHOT_DIR || '/tmp/qaira-gherkin-draft-editing') + route + '-' + theme;
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<!doctype html><html data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await mkdir(screenshotDir, { recursive:true });
    browser = await chromium.launch({ headless:true, executablePath:process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport:{width:1440,height:1100} });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push(`Unexpected API ${route.request().url()}`); return route.abort(); });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`);
    await page.getByRole('button', {name:'Open create test case options',exact:true}).click();
    await page.getByRole('menuitem', {name:'AI Test Cases Generation',exact:true}).click();
    const dialog = page.getByRole('dialog', {name:'AI Test Case Generator',exact:true});
    await dialog.getByRole('radio', {name:'Gherkin',exact:true}).click();
    await dialog.getByRole('textbox', {name:'Additional instructions',exact:true}).fill('Generate checkout receipt coverage with an outline and empty cart scenario.');
    await dialog.getByRole('button', {name:'Generate drafts',exact:true}).click();
    await dialog.getByRole('heading', {name:'Checkout receipt',exact:true}).waitFor();
    const editor = dialog.getByRole('region', {name:'Gherkin test authoring',exact:true});
    await editor.getByRole('region', {name:'Scenario Outline Gherkin',exact:true}).waitFor();
    assert.match(await editor.innerText(), /Buy a supported item/);
    await editor.scrollIntoViewIfNeeded();
    await editor.screenshot({path:screenshotDir+'/generator-read.png',animations:'disabled'});
    await dialog.getByRole('button', {name:'Edit draft',exact:true}).click();
    const outline = editor.getByRole('combobox', {name:'Scenario Outline Gherkin',exact:true});
    await outline.waitFor();
    assert.match(await outline.inputValue(), /When the customer completes checkout/);
    await outline.scrollIntoViewIfNeeded();
    await outline.click();
    await editor.screenshot({path:screenshotDir+'/generator-edit.png',animations:'disabled'});
    const paint = await outline.evaluate(input => {
      const highlight = input.parentElement.querySelector('.gherkin-highlight');
      const glyph = highlight.querySelector('.is-description');
      const inputStyle = getComputedStyle(input);
      const highlightStyle = getComputedStyle(highlight);
      const glyphStyle = getComputedStyle(glyph);
      const bounds = glyph.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + Math.min(8,bounds.width / 2), bounds.y + Math.min(8,bounds.height / 2));
      return {input:{background:inputStyle.backgroundColor,color:inputStyle.color,textFill:inputStyle.webkitTextFillColor,zIndex:inputStyle.zIndex},highlight:{display:highlightStyle.display,visibility:highlightStyle.visibility,opacity:highlightStyle.opacity,zIndex:highlightStyle.zIndex,color:highlightStyle.color},glyph:{color:glyphStyle.color,textFill:glyphStyle.webkitTextFillColor,width:bounds.width,height:bounds.height},hit:hit?.tagName};
    });
    await writeFile(screenshotDir+'/generator-edit-paint.json',JSON.stringify(paint,null,2));
    assert.notEqual(paint.highlight.display,'none','Highlighted source is painted while editing');
    assert.equal(paint.highlight.visibility,'visible');
    assert.equal(paint.highlight.opacity,'1');
    assert.ok(paint.glyph.width > 0 && paint.glyph.height > 0,'Scenario text has visible geometry');
    assert.notEqual(paint.glyph.textFill,'rgba(0, 0, 0, 0)','The visible glyph layer has readable text');
    assert.equal(paint.input.background,'rgba(0, 0, 0, 0)','The input layer cannot obscure the highlighted source');
    await page.setViewportSize({width:390,height:844});
    await outline.scrollIntoViewIfNeeded();
    assert.equal(await outline.evaluate(input => getComputedStyle(input).backgroundColor),'rgba(0, 0, 0, 0)','The source remains visible at mobile width');
    await page.screenshot({path:screenshotDir+'/generator-edit-mobile.png',animations:'disabled'});
    await page.setViewportSize({width:1440,height:1100});
    await editor.getByRole('textbox', {name:'Feature name',exact:true}).fill('Reviewed checkout receipts');
    await editor.getByRole('combobox', {name:'Background Gherkin',exact:true}).fill('Background:\n  Given the customer is signed in and has an active cart');
    const revisedOutline = 'Scenario Outline: Buy and receive the selected item\n  Given the cart contains <item>\n  When the customer confirms checkout\n  Then the receipt shows <total>\n  And the receipt payload is\n    """\n    { "status": "paid" }\n    """';
    await outline.fill(revisedOutline);
    await editor.getByRole('combobox', {name:'Examples Gherkin',exact:true}).fill('Examples:\n  | item | total |\n  | Book | 120 |\n  | Pen | 20 |');
    await editor.getByRole('combobox', {name:'Scenario Gherkin',exact:true}).fill('Scenario: Empty cart\n  Given the cart is empty\n  When the customer opens checkout\n  Then the purchase action remains disabled');
    await dialog.getByRole('button', {name:'Finish editing draft',exact:true}).click();
    assert.match(await editor.getByRole('region', {name:'Scenario Outline Gherkin',exact:true}).innerText(), /customer confirms checkout/);
    assert.match(await editor.getByRole('region', {name:'Examples Gherkin',exact:true}).innerText(), /Pen/);
    await dialog.getByRole('button', {name:'Accept Into Test Case Library (1)',exact:true}).click();
    await page.waitForFunction(() => window.accepted.length === 1);
    const accepted = await page.evaluate(() => window.accepted[0]);
    const saved = accepted.cases[0];
    assert.equal(saved.authoring_mode,'gherkin');
    for (const expected of ['@checkout','# Preserve the author-reviewed examples and request body.','Feature: Reviewed checkout receipts','Given the customer is signed in and has an active cart',revisedOutline,'| Book | 120 |','| Pen | 20 |','Then the purchase action remains disabled']) assert.ok(saved.gherkin_document.includes(expected),`Acceptance retains ${expected}`);
    assert.deepEqual(saved.steps,[],'Gherkin edits remain in the authored document');
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();
    await Promise.all(['tsx','html'].map(extension => rm(new URL(name+'.'+extension,root),{force:true})));
  }
});
