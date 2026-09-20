import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { writeFile, unlink, mkdir } from "node:fs/promises";
const require = createRequire(new URL("../../../testengine/backend/package.json", import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = new URL("../../", import.meta.url);

test("admin indexing reports progress, resumes monitoring after reload, and offers safe retries", { timeout: 60000 }, async () => {
  const name = `admin-indexing-${randomUUID()}`;
  const html = new URL(`${name}.html`, root), tsx = new URL(`${name}.tsx`, root);
  let browser;
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, `import React from 'react';import {createRoot} from 'react-dom/client';import {SampleDataSetup} from '/src/admin/SampleDataSetup';import {adminApi} from '/src/admin/api';import '/src/admin/admin.css';
const catalog=[{name:'index-members',label:'Project membership lookup'},{name:'index-runs',label:'Recent project runs'}];
let state=JSON.parse(sessionStorage.getItem('${name}')||'null')||{running:false,job:null,catalog};window.starts=0;window.failStatus=false;window.failStart=false;
window.setIndexingState=value=>{state=value;sessionStorage.setItem('${name}',JSON.stringify(value))};
adminApi.sampleCatalog=async()=>({modules:[],roles:[],project_name:'Samples'});
adminApi.sampleSetupStatus=async()=>({running:false,job:null});
adminApi.performanceIndexing=async()=>{if(window.failStatus){window.failStatus=false;throw new Error('Temporary status failure')}return structuredClone(state)};
adminApi.startPerformanceIndexing=async()=>{if(window.failStart){window.failStart=false;throw new Error('Indexing could not be started')}window.starts++;window.setIndexingState({running:true,catalog,job:{id:'job-1',status:'running',started_at:new Date().toISOString(),finished_at:null,completed:0,indexes:catalog.map((index,i)=>({...index,status:i?'pending':'running'}))}});return structuredClone(state)};
window.completeIndexing=()=>window.setIndexingState({...state,running:false,job:{...state.job,status:'partial',completed:2,indexes:[{...catalog[0],status:'existing'},{...catalog[1],status:'failed',error:'Database is busy. Retry when the competing schema operation finishes.'}]}});
window.finishIndexing=()=>window.setIndexingState({...state,running:false,job:{...state.job,status:'completed',completed:2,indexes:catalog.map(index=>({...index,status:'existing'}))}});
createRoot(document.getElementById('root')).render(<main style={{maxWidth:1100,margin:'24px auto',padding:16}}><SampleDataSetup schema={{status:'ready',required_tables:16,available_tables:16,missing_tables:[]}} notify={()=>{}} refresh={()=>{}}/></main>);`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
    const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { errors.push("Unexpected live API call"); return route.abort(); });
    await page.goto(`${process.env.VITE_TEST_URL || "http://127.0.0.1:5173"}/${name}.html`);
    await page.evaluate(() => { window.failStart = true; });
    await page.getByRole("button", { name: "Run performance indexing", exact: true }).click();
    await page.getByText("Indexing could not be started", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Refresh status", exact: true }).click();
    assert.equal(await page.getByText("Indexing could not be started", { exact: true }).isVisible(), true);
    await page.getByRole("button", { name: "Run performance indexing", exact: true }).click();
    await page.getByRole("progressbar", { name: "Performance indexing progress" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Indexing…", exact: true }).isDisabled(), true);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].find(button => button.textContent.trim() === "Validate schema")?.disabled);
    assert.equal(await page.getByRole("button", { name: "Validate schema", exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.starts), 1);
    await page.reload();
    await page.getByRole("progressbar", { name: "Performance indexing progress" }).waitFor();
    assert.equal(await page.evaluate(() => window.starts), 0, "reloading observes the persisted job without starting another");
    await page.evaluate(() => { window.failStatus = true; });
    await page.getByText("Temporary status failure", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Indexing…", exact: true }).isDisabled(), true);
    await page.evaluate(() => window.completeIndexing());
    await page.getByRole("button", { name: "Refresh status", exact: true }).click();
    await page.getByText("1 of 2 indexes are ready. 1 need another attempt.", { exact: true }).waitFor();
    await page.getByText("View index results", { exact: true }).click();
    await page.getByText("Database is busy. Retry when the competing schema operation finishes.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Run performance indexing", exact: true }).click();
    await page.getByRole("progressbar", { name: "Performance indexing progress" }).waitFor();
    await page.evaluate(() => window.finishIndexing());
    await page.getByText("2 of 2 performance indexes are ready.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Validate schema", exact: true }).isEnabled(), true);
    await mkdir("/tmp/qaira-admin-indexing", { recursive: true });
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Overflow at ${width}px`);
      await page.locator(".sample-schema").screenshot({ path: `/tmp/qaira-admin-indexing/indexing-${width}.png` });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
});
