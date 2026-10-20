import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";

const require = createRequire(new URL("../../../../testengine/backend/package.json", import.meta.url));
const { chromium } = require("playwright");
const { expect } = require("playwright/test");
const root = new URL("../../../platform/frontend/", import.meta.url);

test("Gherkin presents readable behavior and code-line copy stays in its project", { timeout: 60000 }, async () => {
  const name = `automation-source-${randomUUID()}`;
  const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {AutomationCodeLines} from '/services/automation/frontend/components/AutomationCodeLines';
import {buildAutomationGherkin} from '/services/automation/frontend/lib/automationGherkin';
import {setCurrentScope} from '/services/platform/frontend/src/platform/hooks/useCurrentProject';
window.switchProject=(id)=>setCurrentScope(id);
setCurrentScope('source-a');
window.gherkin=buildAutomationGherkin('Checkout',[
 {id:'empty',step_order:1,action:'',expected_result:'',step_type:'web',automation_code:''},
 {id:'precondition',step_order:2,group_name:'Preconditions',action:'',expected_result:'Account exists',step_type:'web',automation_code:'await web.expectVisible("#account");'},
 {id:'result',step_order:3,action:'',expected_result:'Receipt is available',step_type:'web',automation_code:'await web.expectVisible("#receipt");'},
 {id:'fill',step_order:4,group_id:'checkout',group_name:'Checkout flow',action:'Enter @t.[Display Name] for @r.tenant.name',expected_result:'@t.USER is visible',step_type:'web',automation_code:'await web.fill("#name", "@t.[Display Name]");'}
],{id:'data',mode:'table',columns:['t.[Display Name]','t.user','r.tenant.name'],rows:[{'t.[Display Name]':'Alice Example','t.user':'Alice','r.tenant.name':'West'}]});
function App(){const [value,setValue]=React.useState('first\\nsecond');return <AutomationCodeLines value={value} onChange={next=>{window.codeDraft=next;setValue(next)}}/>;}
createRoot(document.getElementById('root')).render(<App/>);`;
  let browser;
  try {
    await writeFile(new URL(`${name}.tsx`, root), fixture);
    await writeFile(new URL(`${name}.html`, root), `<html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL || "http://127.0.0.1:5197"}/${name}.html`);
    await page.waitForFunction(() => Boolean(window.gherkin));
    const gherkin = await page.evaluate(() => window.gherkin);
    assert.match(gherkin, /Given Verify visible #account/);
    assert.match(gherkin, /Then Receipt is available/);
    assert.match(gherkin,/Then Verify visible #receipt/);
    assert.match(gherkin, /When Type <t\.\[Display Name\]> into #name/);
    assert.match(gherkin, /Then <t\.user> is visible/);
    assert.match(gherkin, /# Shared Step Group \[checkout\]: Checkout flow/);
    assert.doesNotMatch(gherkin,/"""javascript|await web\./);
    await page.getByRole("button", { name: "Copy code line 1", exact: true }).click();
    await expect(page.getByRole("button", { name: "Paste lines", exact: true })).toBeEnabled();
    await page.evaluate(() => window.switchProject("source-b"));
    await expect(page.getByRole("button", { name: "Paste lines", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Copy code line 2", exact: true }).click();
    await page.evaluate(() => window.switchProject("source-a"));
    await page.getByRole("button", { name: "Paste lines", exact: true }).click();
    assert.equal(await page.evaluate(() => window.codeDraft), "first\nsecond\nfirst");
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all([rm(new URL(`${name}.tsx`, root), { force: true }), rm(new URL(`${name}.html`, root), { force: true })]);
  }
});
