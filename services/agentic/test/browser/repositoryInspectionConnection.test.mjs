import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../../testengine/backend/package.json", import.meta.url));
const { chromium } = require("playwright");
const root = new URL("../../../platform/frontend/", import.meta.url);
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {automationApi} from '/services/automation/frontend/api.client';
import { RepositoryAgentStatus, RepositoryAgentSetup, RepositoryInspectSessionControls } from '/services/agentic/frontend/components/RepositoryInspectControls';
import { useRepositoryInspectAgent } from '/services/agentic/frontend/hooks/useRepositoryInspectAgent';
import { useDialogFocus } from '/src/shared/hooks/useDialogFocus';
import { api } from '/src/lib/api';
import '/src/styles.css';
import '/src/modal-system.css';
import '/src/dark-theme.css';
automationApi.localAgent.status=async()=>({web:{ready:false},launch_supported:false});
window.inspectionCalls = { checks: [], setups: [], starts: [], copies: [] };
window.agentReady = false;
window.agentStatusCode = 200;
window.agentBlocked = false;
const fetchOriginal = window.fetch;
window.fetch = async (url, options) => {
  if (String(url).startsWith('http://127.0.0.1:4311')) {
    window.inspectionCalls.checks.push({ url: String(url), token: options.headers['X-HelloTest-Agent-Token'] });
    if (window.agentBlocked) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({ service:'hellotest-inspection-agent', protocol_version:1, ready:window.agentReady }), { status:window.agentStatusCode });
  }
  return fetchOriginal(url, options);
};
api.repositoryInspection.localAgentSetup = async input => { window.inspectionCalls.setups.push(input); return { download_url:'https://app.hellotest.ai/api/repository-inspection/local-agent/download?token=paired-installer', expires_at:new Date(Date.now()+600000).toISOString() }; };
Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText:async value=>window.inspectionCalls.copies.push(value) } });
function App(){
  const connection = useRepositoryInspectAgent(true, 'project');
  const [open,setOpen] = useState(false), [running,setRunning] = useState(false), [mode,setMode] = useState('remote');
  const ref=useDialogFocus({active:open,onClose:()=>setOpen(false)});
  return <main style={{padding:24}}><header style={{display:'flex',flexWrap:'wrap',justifyContent:'space-between',gap:12}}><h1>Object repository</h1><RepositoryAgentStatus connection={connection}/></header><button onClick={()=>setOpen(true)}>Inspect screen</button>
  {open?<div className="modal-backdrop"><div className="modal-card" ref={ref} role="dialog" aria-label="Object repository inspector" tabIndex={-1} style={{width:920,padding:24}}><h2>Inspect screen</h2><RepositoryInspectSessionControls mode={mode} recommendedMode={connection.state==='connected'?'local':'remote'} remoteAvailable={true} localConnected={connection.state==='connected'} running={running} busy={false} onSetup={connection.openSetup} onStart={next=>{window.inspectionCalls.starts.push(next);setMode(next);setRunning(true)}} onClose={()=>setRunning(false)}/><p>Browser inspection workspace</p><button onClick={()=>setOpen(false)}>Close inspector</button></div></div>:null}<RepositoryAgentSetup connection={connection} onUseRemote={()=>{window.inspectionCalls.starts.push('remote');setMode('remote');setRunning(true);setOpen(true)}}/></main>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><App/></QueryClientProvider>);
`;

test("inspection defaults to remote without loopback probes and verifies paired local setup before recommending local", { timeout: 90000 }, async () => {
  const name = `inspection-connection-${randomUUID()}`;
  const html = new URL(`${name}.html`, root), tsx = new URL(`${name}.tsx`, root);
  let browser;
  try {
    await writeFile(html, `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, fixture);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL || "http://127.0.0.1:5186"}/${name}.html`);
    await page.getByRole("heading", { name: "Object repository", exact: true }).waitFor();
    await page.getByRole("button", { name: "Inspect screen", exact: true }).click();
    await page.getByRole("button", { name: "Remote browser", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.inspectionCalls.starts), ["remote"]);
    assert.equal(await page.evaluate(() => window.inspectionCalls.checks.length), 0, "Cloud remote flow never probes localhost");
    await page.getByRole("button", { name: "Close browser", exact: true }).click();
    const toggle = page.getByRole("button", { name: "Choose inspection browser session" });
    await toggle.click();
    const menu = page.getByRole("listbox", { name: "Inspection browser sessions" });
    await menu.waitFor();
    assert.match(await menu.getByRole("option", { name: /Remote browser session/ }).innerText(), /Recommended/);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog", { name: "Object repository inspector" }).count(), 1, "Escape closes only the session menu");
    assert.equal(await toggle.evaluate(element => element === document.activeElement), true);
    await toggle.click();
    await menu.getByRole("option", { name: /Local session/ }).click();
    const setup = page.getByRole("dialog", { name: "Connect local agent" });
    await setup.waitFor();
    await setup.getByText("Agent not connected", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.inspectionCalls.checks.length), 1);
    const inputs = await page.evaluate(() => window.inspectionCalls);
    assert.match(inputs.setups[0].agent_token, /^[a-f0-9]{64}$/);
    assert.equal(inputs.checks[0].token, inputs.setups[0].agent_token);
    assert.equal(inputs.setups[0].origin, new URL(page.url()).origin);
    await setup.getByRole("button", { name: "Copy command" }).click();
    let command = await page.evaluate(() => window.inspectionCalls.copies.at(-1));
    assert.match(command, /curl --fail --location 'https:\/\/app\.hellotest\.ai\/api\/repository-inspection\/local-agent\/download\?token=paired-installer'/);
    assert.match(command, /\.mjs" && node/);
    assert.doesNotMatch(command, /local-run|localhost/);
    await setup.getByLabel("Terminal").selectOption("windows");
    await setup.getByRole("button", { name: "Copy command" }).click();
    command = await page.evaluate(() => window.inspectionCalls.copies.at(-1));
    assert.match(command, /Invoke-WebRequest/);
    assert.match(command, /hellotest-inspection-agent\.mjs/);
    await page.evaluate(() => { window.agentReady = true; window.agentStatusCode = 403; });
    await setup.getByRole("button", { name: "Check connection" }).click();
    await setup.getByText("The agent is not paired with this workspace. Restart it with the command below.").waitFor();
    assert.equal(await setup.getByText("Agent connected", { exact: true }).count(), 0, "Forbidden agent is never reported connected");
    await page.evaluate(() => { window.agentStatusCode = 200; });
    await setup.getByRole("button", { name: "Check connection" }).click();
    await setup.getByText("Agent connected", { exact: true }).waitFor();
    for (const width of [1360, 768, 390]) {
      await page.setViewportSize({ width, height: 860 });
      const bounds = await setup.boundingBox();
      assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `setup fits viewport ${width}`);
      assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= 861, `setup height fits ${width}`);
    }
    const directory = "/tmp/qaira-inspection-connection";
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: `${directory}/local-agent-mobile.png` });
    await setup.getByRole("button", { name: "Done", exact: true }).click();
    await page.setViewportSize({ width: 1360, height: 860 });
    await page.getByRole("button", { name: "Local session", exact: true }).waitFor();
    await toggle.click();
    assert.match(await menu.getByRole("option", { name: /Local session/ }).innerText(), /Recommended/);
    await page.screenshot({ path: `${directory}/session-options-desktop.png` });
    await menu.getByRole("option", { name: /Local session/ }).click();
    assert.deepEqual(await page.evaluate(() => window.inspectionCalls.starts), ["remote", "local"]);
    await page.getByRole("button", { name: "Close browser", exact: true }).click();
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await page.evaluate(() => { window.agentReady = false; });
    await page.getByRole("button", { name: /Local agent: Connected/ }).click();
    await setup.getByText("Agent not connected", { exact: true }).waitFor();
    await setup.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Inspect screen", exact: true }).click();
    await page.getByRole("button", { name: "Remote browser", exact: true }).waitFor();
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await page.evaluate(() => { window.agentBlocked = true; });
    await page.getByRole("button", { name: /Local agent: Not connected/ }).click();
    await setup.getByText(/The local agent is unavailable or this browser blocked the connection/).waitFor();
    await setup.getByRole("button", { name: "Use remote browser", exact: true }).click();
    await setup.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Close browser", exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.inspectionCalls.starts), ["remote", "local", "remote"], "Local network/CORS failure cannot block the explicit remote fallback");
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all([unlink(html).catch(() => {}), unlink(tsx).catch(() => {})]);
  }
});
