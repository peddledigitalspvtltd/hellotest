import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../../../../testengine/backend/package.json", import.meta.url));
const { chromium } = require("playwright");
const frontendRoot = new URL("../../../platform/frontend/", import.meta.url);
const catalog = await readFile(new URL("./runCatalogDetails.test.mjs", import.meta.url), "utf8");
const base = catalog.match(/const fixtureSource = `([\s\S]*?)`;\n/)[1];
const customization = `
app.type = 'web';
const active = runs.find(run => run.id === 'running');
active.live_sessions = [];
active.test_data_set.snapshot = { ...data, mode: 'table', columns: ['customer'], rows: [{customer:'First customer'}, {customer:'Second customer'}] };
for (const snapshot of active.case_snapshots) {
 snapshot.test_data_set_id = 'data'; snapshot.test_data_set_name = 'Customer rows';
 snapshot.test_data_set_snapshot = active.test_data_set.snapshot; snapshot.data_set_source = 'run';
}
api.executions.get = async id => structuredClone(runs.find(run => run.id === id));
window.setLiveSessions = async (sessions, status = 'running') => {
 active.live_sessions = sessions; active.status = status;
 await fixtureQueryClient.invalidateQueries({queryKey:['execution','running']});
};
`;
const source = base.replace('createRoot(document.getElementById("root"))', customization + '\ncreateRoot(document.getElementById("root"))');

test("case header opens only its current browser and data row in a separate tab", { timeout: 90000 }, async () => {
 const name = `case-live-run-view-${randomUUID()}`;
 const html = new URL(`${name}.html`, frontendRoot);
 const tsx = new URL(`${name}.tsx`, frontendRoot);
 let browser;
 try {
  await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx, source);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: {width:1440,height:1000} });
  await context.route('http://127.0.0.1:4313/**', route => route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><h1>Case browser view</h1>'}));
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html?route=${encodeURIComponent('/executions?execution=running&testCase=case-1')}`);
  await page.getByRole('heading',{name:'Checkout scenario 1',exact:true}).waitFor();
  const actions = page.locator('.execution-case-run-header-actions');
  const unavailable = actions.getByRole('button',{name:'Live Run View',exact:true});
  assert.equal(await unavailable.isDisabled(),true);
  assert.match(await unavailable.getAttribute('title'),/this test case and data row/);
  assert.equal(await actions.locator(':scope > *').first().innerText(),'Live Run View');
  assert.match(await actions.innerText(),/Live Run View[\s\S]*Report (?:defect|bug)/i);
  const session = (test_case_id,engine_run_id,index,key) => ({test_case_id,engine_run_id,provider:'playwright',data_set_iteration_index:index,data_set_iteration_key:key,url:`http://127.0.0.1:4313/api/v1/live-session?provider=playwright&run_id=${engine_run_id}`});
  const sessions = [session('case-2','unrelated-browser',0,'data:1'),session('case-1','second-row-browser',1,'data:2'),session('case-1','first-row-browser',0,'data:1')];
  await page.evaluate(sessions=>window.setLiveSessions(sessions),sessions);
  const live = actions.getByRole('link',{name:'Live Run View',exact:true});
  await live.waitFor();
  assert.equal(new URL(await live.getAttribute('href')).searchParams.get('run_id'),'first-row-browser');
  const originalUrl = page.url();
  const popupEvent = page.waitForEvent('popup');
  await live.click();
  const popup = await popupEvent;
  await popup.waitForLoadState();
  assert.equal(new URL(popup.url()).searchParams.get('run_id'),'first-row-browser');
  assert.equal(page.url(),originalUrl,'The case run remains in its original tab');
  assert.equal(await popup.evaluate(()=>window.opener === null),true);
  await popup.close();
  await page.getByRole('combobox',{name:'Active data row',exact:true}).selectOption({index:1});
  await page.waitForFunction(()=>document.querySelector('.execution-case-run-header-actions a')?.href.includes('second-row-browser'));
  assert.equal(new URL(await live.getAttribute('href')).searchParams.get('run_id'),'second-row-browser');
  await page.evaluate(sessions=>window.setLiveSessions(sessions),[sessions[0],sessions[2]]);
  await unavailable.waitFor();
  assert.equal(await unavailable.isDisabled(),true,'An absent row session never falls back to another row or case');
  await page.evaluate(()=>window.setLiveSessions([], 'completed'));
  await page.waitForFunction(()=>document.querySelector('.execution-case-run-header-actions button')?.title.includes('while this test case'));
  assert.equal(await actions.getByRole('link',{name:'Live Run View',exact:true}).count(),0);
  for (const width of [1440,390,320]) {
   await page.setViewportSize({width,height:1000});
   const bounds = await unavailable.boundingBox();
   assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1,`Live action fits at ${width}`);
  }
  assert.deepEqual(errors,[]);
 } finally {
  await browser?.close();
  await Promise.all([unlink(html).catch(()=>{}),unlink(tsx).catch(()=>{})]);
 }
});
