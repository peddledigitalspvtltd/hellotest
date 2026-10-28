import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);
const fixture = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AgentEvidenceScope}from'/services/agentic/frontend/components/AgentEvidenceScope';import{AiTestCaseDraftFields}from'/services/ai/frontend/components/AiTestCaseDraftFields';import{AiTestCaseStepTable}from'/services/ai/frontend/components/AiTestCaseStepTable';import'/src/styles.css';import'/services/agentic/frontend/components/AgenticExperience.css';
function App(){const[scope,setScope]=useState({});const[pinned,setPinned]=useState(false);const[draft,setDraft]=useState({title:'Retry checkout safely',description:'Verify one order after retry',priority:2});const[steps,setSteps]=useState([{action:'Retry checkout with the same key',expected_result:'Exactly one order remains'}]);return <main style={{padding:24}}><h1>Agent review</h1><div className='scope-fixture-anchor' style={{display:'flex',justifyContent:'flex-end',height:40,overflow:'hidden'}}><AgentEvidenceScope projectId='project-1' appTypeId='application-1' scopes={['stories','test-cases','runs','knowledge']} values={{...scope,...(pinned?{test_case_id:'case-pinned'}:{})}} readOnlyFields={pinned?['test_case_id']:[]} onChange={(key,value)=>setScope({...scope,[key]:value})}/></div><button type='button'>Outside scope</button><button type='button' onClick={()=>setPinned(value=>!value)}>Toggle linked case</button><article className='ai-artifact-detail' style={{marginTop:24}}>{['title','fields'].map(section=><AiTestCaseDraftFields key={section} section={section} {...draft} editing onChange={patch=>setDraft({...draft,...patch})}/>)}<AiTestCaseStepTable steps={steps} editing onChange={setSteps} newStep={()=>({action:'',expected_result:''})}/></article></main>}createRoot(document.getElementById('root')).render(<App/>);`;

test('evidence selectors preload ten records, search with intersecting filters, recover from errors and fit the viewport', { timeout: 45000 }, async () => {
  const name = 'agent-scope-' + randomUUID(); let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body><div id='root'></div><script type='module' src='/${name}.tsx'></script></body></html>`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    const errors = [], requests = []; let failNext = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/agentic-workflows/evidence-scope/options?**', async route => {
      const query = new URL(route.request().url()).searchParams; requests.push(Object.fromEntries(query));
      if (failNext) { failNext = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Records are temporarily unavailable.' }) }); }
      const field = query.get('field'), search = query.get('search');
      const items = search === 'missing' ? [] : search ? [{ id: `${field}-match`, label: `${field}-MATCH`, description: `Matching ${search}` }] : Array.from({ length: 10 }, (_, i) => ({ id: `${field}-${i + 1}`, label: `${field}-${i + 1}`, description: `Available ${field} record ${i + 1}` }));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items, has_more: !search }) });
    });
    await page.goto((process.env.VITE_TEST_URL || 'http://127.0.0.1:5197') + '/' + name + '.html');
    const menu = page.locator('.agent-command-evidence-scope');
    const dialog = page.getByRole('dialog', { name: 'Evidence scope', exact: true });
    await menu.locator('summary').click();
    await dialog.waitFor();
    assert.equal(requests.length, 0, 'opening the menu does not fetch unrelated collections');
    assert.deepEqual(await dialog.locator('.agent-evidence-scope-field-trigger').allTextContents(), ['Story IDAny', 'Test Case IDAny', 'Run IDAny', 'Release IDAny', 'Sprint IDAny']);
    assert.equal(await dialog.getByText(/build|environment/i).count(), 0);
    await dialog.getByRole('button', { name: 'Story ID: Any', exact: true }).click();
    await dialog.getByRole('option').nth(9).waitFor();
    assert.equal(await dialog.getByRole('option').count(), 10);
    assert.equal(requests[0].project_id, 'project-1'); assert.equal(requests[0].app_type_id, 'application-1'); assert.equal(requests[0].limit, '10');
    assert.match(await dialog.textContent(), /Showing the first 10 records/);
    await dialog.getByRole('option').filter({ hasText: 'story_id-1' }).first().click();
    await dialog.getByRole('button', { name: 'Story ID: story_id-1', exact: true }).waitFor();
    assert.match(await menu.locator('summary').textContent(), /\(1\)/);
    await dialog.getByRole('button', { name: 'Sprint ID: Any', exact: true }).click();
    await dialog.getByRole('option').nth(9).waitFor();
    assert.equal(requests.at(-1).story_id, 'story_id-1');
    await dialog.getByRole('combobox', { name: 'Search Sprint ID' }).fill('checkout');
    await dialog.getByRole('option', { name: /Matching checkout/ }).waitFor();
    assert.equal(requests.at(-1).search, 'checkout'); assert.equal(requests.at(-1).story_id, 'story_id-1');
    await dialog.getByRole('combobox', { name: 'Search Sprint ID' }).press('Enter');
    await dialog.getByRole('button', { name: 'Sprint ID: sprint_id-match', exact: true }).waitFor();
    assert.match(await menu.locator('summary').textContent(), /\(2\)/);
    await dialog.getByRole('button', { name: 'Clear Story ID', exact: true }).click();
    await dialog.getByRole('button', { name: 'Story ID: Any', exact: true }).waitFor();
    failNext = true;
    await dialog.getByRole('button', { name: 'Release ID: Any', exact: true }).click();
    await dialog.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
    await dialog.getByRole('option').nth(9).waitFor();
    assert.equal(requests.at(-1).sprint_id, 'sprint_id-match');
    await dialog.getByRole('combobox', { name: 'Search Release ID' }).fill('missing');
    await dialog.getByText('No matching records in this scope. Try another ID or name.').waitFor();
    await dialog.getByRole('combobox', { name: 'Search Release ID' }).press('Escape');
    assert.equal(await dialog.count(), 0); assert.equal(await menu.locator('summary').evaluate(element => element === document.activeElement), true);
    await menu.locator('summary').click(); await page.getByRole('heading', { name: 'Agent review' }).click(); assert.equal(await dialog.count(), 0);
    await page.getByRole('button', { name: 'Toggle linked case' }).click();
    await menu.locator('summary').click();
    assert.equal(await dialog.getByRole('button', { name: 'Test Case ID: case-pinned' }).isDisabled(), true);
    assert.equal(await dialog.getByRole('button', { name: 'Clear Test Case ID' }).count(), 0);
    await dialog.getByRole('button', { name: 'Close evidence scope' }).click();
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await page.locator('.scope-fixture-anchor').evaluate(element => { element.style.position = 'fixed'; element.style.bottom = '12px'; element.style.right = '12px'; element.style.width = '200px'; });
      await menu.locator('summary').click();
      await dialog.getByRole('button', { name: 'Story ID: Any', exact: true }).click();
      await dialog.getByRole('option').nth(9).waitFor();
      const box = await dialog.boundingBox(); const anchor = await menu.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'menu stays within horizontal viewport');
      assert.ok(box.y >= 0 && box.y + box.height <= 850, 'menu stays within vertical viewport ' + JSON.stringify({ box, anchor }));
      assert.ok(box.y + box.height < anchor.y, 'menu opens above a bottom-edge trigger');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await mkdir('/tmp/qaira-studio-review', { recursive: true });
      await page.screenshot({ path: `/tmp/qaira-studio-review/evidence-scope-${width}.png` });
      await dialog.getByRole('button', { name: 'Close evidence scope' }).click();
    }
    assert.equal(await page.getByLabel('Test case title', { exact: true }).inputValue(), 'Retry checkout safely');
    assert.equal(await page.getByLabel('Step 1 expected result', { exact: true }).inputValue(), 'Exactly one order remains');
    await page.getByRole('button', { name: 'Add step', exact: true }).click();
    await page.getByLabel('Step 2 action', { exact: true }).fill('Open the order history');
    await page.getByLabel('Step 2 expected result', { exact: true }).fill('One order is listed');
    assert.equal(await page.locator('.ai-test-generator-step-row').count(), 2);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all([rm(new URL(name + '.tsx', root), { force: true }), rm(new URL(name + '.html', root), { force: true })]);
  }
});
