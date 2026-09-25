import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../../testengine/backend/package.json", import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = new URL("../../../platform/frontend/", import.meta.url);
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider} from '/src/auth/AuthContext';
import {LocalizationProvider} from '/src/context/LocalizationContext';
import {SharedStepsPage} from '/services/testing/frontend/pages/SharedStepsPage';
import {api,sessionStorage} from '/src/lib/api';
import {setCurrentScope} from '/src/platform/hooks/useCurrentProject';
import policy from '/src/platform/lib/featurePolicy.generated.json';
import '/src/styles.css';import '/src/modal-system.css';import '/src/workspace-layout.css';
const mode=new URLSearchParams(location.search).get('mode');
const session={token:'shared-datasets',user:{id:'author',name:'Author',role:mode==='permissions'?'member':'admin',workspace_permissions:['workspace.view'],project_permissions:{project:['shared_step.view','shared_step.manage']}}};
sessionStorage.write(session);setCurrentScope('project','app');window.writes=[];window.calls=[];window.created=[];
function stub(object,prefix=''){for(const [key,value]of Object.entries(object)){const path=prefix?prefix+'.'+key:key;if(typeof value==='function')object[key]=async()=>[];else if(value&&typeof value==='object')stub(value,path)}}stub(api);
const flags={flags:Object.fromEntries(policy.feature_keys.map(key=>[key,true])),permission_features:policy.permission_features,dependencies:policy.dependencies};
api.featureFlags.snapshot=async()=>flags;api.auth.session=async()=>session;
api.settings.getLocalization=async()=>({strings:{}});api.settings.getWorkspacePreferences=async()=>({preferences:{}});
api.metadata.domain=async()=>({test_data_sets:{modes:[{value:'table',label:'Table'},{value:'key_value',label:'Key/value'}]}});
api.metadata.workspaceScopes=async()=>({projects:[{id:'project',name:'Project'}]});
api.appTypes.list=async()=>[{id:'app',project_id:'project',name:'Web',type:'web'}];
let groups=[{id:'group-1',display_id:'SSG_1',app_type_id:'app',name:'Reusable login',description:'Login once',authoring_mode:'structured',gherkin_document:'@smoke\\n# @unused\\nWhen Sign in as @t.user with @r.password\\nThen @s.home is shown',steps:[{id:'step-1',step_order:1,action:'Sign in as @t.user with @r.password',expected_result:'@s.home is shown',step_type:'web'}],parameter_values:{'t.user':'fallback'},test_data_set_id:mode==='legacy'?'data-1':null,test_data_row_index:mode==='legacy'?1:0,usage_count:0}];
let sets=[{id:'data-1',project_id:'project',app_type_id:'app',name:'Login variants',description:'Two saved accounts',mode:'table',columns:['t.user','r.password','s.home'],rows:[{'t.user':'alice','r.password':'first','s.home':'Dashboard'},{'t.user':'bob','r.password':'second','s.home':'Home'}]},{id:'data-single',project_id:'project',app_type_id:'app',name:'Group account',description:'One account for every linked case',mode:'table',columns:['t.user','r.password','s.home'],rows:[{'t.user':'alice','r.password':'first','s.home':'Dashboard'}]}];
api.sharedStepGroups.create=async(input)=>{const item={...input,id:'group-created',display_id:'SSG_2',usage_count:0};window.writes.push({id:item.id,input});groups.push(item);return {id:item.id}};
api.sharedStepGroups.list=async()=>structuredClone(groups);
api.sharedStepGroups.get=async(id)=>({...structuredClone(groups.find(group=>group.id===id)),test_data_set:structuredClone(sets.find(data=>data.id===groups.find(group=>group.id===id).test_data_set_id)||null)});
api.sharedStepGroups.update=async(id,input)=>{window.writes.push({id,input});groups=groups.map(group=>group.id===id?{...group,...input}:group);return structuredClone(groups.find(group=>group.id===id))};
api.testDataSets.list=async()=>{window.calls.push('datasets');return structuredClone(sets)};
api.testDataSets.create=async(input)=>{const item={...input,id:'data-created'};window.created.push(input);sets.push(item);return {id:item.id}};
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});client.setQueryData(['feature-flags'],flags);
const router=createMemoryRouter([{path:'/shared-steps',element:<SharedStepsPage/>}],{initialEntries:['/shared-steps?group=group-1']});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId='author'><main style={{padding:24}}><RouterProvider router={router}/></main></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;


test("Shared Steps save structured edits and pending insertions and convert on the first switch", { timeout: 120000 }, async () => {
  const name = `shared-step-save-${randomUUID()}`;
  const html = new URL(`${name}.html`, root), tsx = new URL(`${name}.tsx`, root);
  let browser;
  try {
    await writeFile(html, `<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, fixture);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/api/**", route => { errors.push("Unexpected live API request"); return route.abort(); });
    page.setDefaultTimeout(15000);
    await page.goto(`${process.env.VITE_TEST_URL || "http://127.0.0.1:5189"}/${name}.html`);
    await page.getByLabel("Group name").waitFor();
    const save = page.getByRole("button", { name: "Save Shared Step Group", exact: true });
    const composer = page.getByRole("group", { name: "New shared step", exact: true });
    const fillPending = async (action, result) => {
      await page.getByRole("button", { name: "Add step", exact: true }).click();
      await composer.locator('[contenteditable="true"]').nth(0).fill(action);
      await composer.locator('[contenteditable="true"]').nth(1).fill(result);
    };
    const writes = () => page.evaluate(() => window.writes);
    const saved = async (count) => {
      await page.waitForFunction(count => window.writes.length === count, count);
      await save.waitFor();
      await page.waitForFunction(() => !document.querySelector('.step-create--inline'));
      return (await writes())[count - 1].input;
    };

    // Saving a step only updates the group draft. It must not bubble to group save.
    await fillPending("Open account settings", "Account settings are displayed");
    await composer.getByRole("button", { name: "Save step", exact: true }).click();
    await page.getByRole("button", { name: "Show step 2 details", exact: true }).waitFor();
    assert.equal((await writes()).length, 0);
    await save.click();
    let input = await saved(1);
    assert.equal(input.authoring_mode, "structured");
    assert.equal(input.steps.length, 2);
    assert.match(input.steps[1].action, /Open account settings/);
    assert.match(input.gherkin_document, /When Open account settings\nThen Account settings are displayed/);

    // The group save includes an unfinished insertion, without visiting Gherkin.
    await fillPending("Choose @t.theme", "Theme is applied");
    await save.click();
    input = await saved(2);
    assert.equal(input.steps.length, 3);
    assert.match(input.steps[2].action, /Choose @t.theme/);
    assert.match(input.gherkin_document, /When Choose @t.theme\nThen Theme is applied/);
    await page.getByRole("button", { name: "Back to Shared Step Group list", exact: true }).click();
    await page.locator(".shared-step-group-tile-card .tile-card-open-button").click();
    await page.getByRole("button", { name: "Show step 3 details", exact: true }).waitFor();

    // First mode switch includes the pending insertion and preserves the step order.
    await fillPending("Sign out", "Sign in page appears");
    await page.getByRole("tab", { name: "Gherkin", exact: true }).click();
    assert.equal(await page.getByRole("combobox", { name: "Shared Gherkin step 7", exact: true }).inputValue(), "Sign out");
    await save.click();
    input = await saved(3);
    assert.equal(input.authoring_mode, "gherkin");
    assert.equal(input.steps.length, 4);
    assert.equal(input.steps[3].action, "Sign out");
    assert.match(input.gherkin_document, /When Sign out\nThen Sign in page appears/);
    await page.getByRole("tab", { name: "Structured", exact: true }).click();
    await page.getByRole("button", { name: "Show step 4 details", exact: true }).click();
    await page.locator(".step-card").nth(3).locator('[contenteditable="true"]').nth(0).fill("Sign out completely");
    await save.click();
    input = await saved(4);
    assert.match(input.steps[3].action, /Sign out completely/);
    assert.match(input.gherkin_document, /When Sign out completely/);

    // New groups can be created directly from structured authoring.
    await page.getByRole("button", { name: "Back to Shared Step Group list", exact: true }).click();
    await page.getByRole("button", { name: "New Shared Step Group", exact: true }).click();
    await page.getByLabel("Group name").fill("Fresh structured group");
    await page.getByRole("button", { name: "Show step 1 details", exact: true }).click();
    await page.locator(".step-card").nth(0).locator('[contenteditable="true"]').nth(0).fill("Open landing page");
    await page.locator(".step-card").nth(0).locator('[contenteditable="true"]').nth(1).fill("Welcome is displayed");
    await page.getByRole("button", { name: "Create Shared Step Group", exact: true }).click();
    input = await saved(5);
    assert.equal(input.authoring_mode, "structured");
    assert.equal(input.steps.length, 1);
    assert.match(input.gherkin_document, /When Open landing page\nThen Welcome is displayed/);
    await page.getByRole("tab", { name: "Gherkin", exact: true }).click();
    assert.equal(await page.getByRole("combobox", { name: "Shared Gherkin step 1", exact: true }).inputValue(), "Open landing page");
    assert.deepEqual(errors, []);
  } catch (error) {
    const page = browser?.contexts()[0]?.pages()[0];
    if (page) {
      await writeFile("/tmp/shared-step-save-failure.txt", await page.locator("body").innerText());
      await page.screenshot({ path: "/tmp/shared-step-save-failure.png", fullPage: true });
      console.error(await page.evaluate(() => window.writes));
    }
    throw error;
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
});
