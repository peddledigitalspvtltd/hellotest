import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../testengine/backend/package.json", import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = new URL("../../", import.meta.url);
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider} from '/src/auth/AuthContext';
import {LocalizationProvider} from '/src/context/LocalizationContext';
import {SharedStepsPage} from '/src/pages/SharedStepsPage';
import {api,sessionStorage} from '/src/lib/api';
import {setCurrentScope} from '/src/hooks/useCurrentProject';
import policy from '/src/lib/featurePolicy.generated.json';
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
api.sharedStepGroups.list=async()=>structuredClone(groups);
api.sharedStepGroups.get=async(id)=>({...structuredClone(groups.find(group=>group.id===id)),test_data_set:structuredClone(sets.find(data=>data.id===groups.find(group=>group.id===id).test_data_set_id)||null)});
api.sharedStepGroups.update=async(id,input)=>{window.writes.push({id,input});groups=groups.map(group=>group.id===id?{...group,...input}:group);return structuredClone(groups.find(group=>group.id===id))};
api.testDataSets.list=async()=>{window.calls.push('datasets');return structuredClone(sets)};
api.testDataSets.create=async(input)=>{const item={...input,id:'data-created'};window.created.push(input);sets.push(item);return {id:item.id}};
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});client.setQueryData(['feature-flags'],flags);
const router=createMemoryRouter([{path:'/shared-steps',element:<SharedStepsPage/>}],{initialEntries:['/shared-steps?group=group-1']});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId='author'><main style={{padding:24}}><RouterProvider router={router}/></main></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;

test("Shared Step datasets share one-row authoring across formats, export parameters, and persist links", { timeout: 120000 }, async () => {
  const name = `shared-step-data-${randomUUID()}`;
  const html = new URL(`${name}.html`, root), tsx = new URL(`${name}.tsx`, root);
  let browser;
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, fixture);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const errors = []; page.on("pageerror", error => errors.push(error.stack)); page.setDefaultTimeout(15000);
    const url = `${process.env.VITE_TEST_URL || "http://127.0.0.1:5189"}/${name}.html`;
    await page.goto(`${url}?mode=full`);
    await page.getByLabel("Group name").waitFor();
    const panel = page.locator(".authoring-data-set-panel");
    const download = await Promise.all([
      page.waitForEvent("download"), panel.getByRole("button", { name: "Download Test Params Template" }).click()
    ]).then(([file]) => file);
    const template = await readFile(await download.path(), "utf8");
    assert.match(template, /"r.password","s.home","t.user"/);
    assert.doesNotMatch(template, /fallback|alice|first/);

    await panel.getByRole("button", { name: "Link Existing Data Set", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Link Existing Data Set", exact: true });
    assert.equal(await picker.getByRole("radio", {name:/Login variants/}).isDisabled(), true);
    await picker.getByText("Shared Step Groups require exactly one table row. This data set has 2.").waitFor();
    await picker.getByRole("radio", {name:/Group account/}).check();
    await picker.getByRole("button", { name: "Link Data Set", exact: true }).click();
    assert.equal(await page.getByLabel("Shared group data row").count(), 0);
    assert.equal(await panel.locator(".test-case-iteration-badge").innerText(), "1 iteration");
    assert.equal(await panel.locator(".test-case-data-set-columns").count(), 0);
    await panel.screenshot({path:"/tmp/qaira-shared-dataset-desktop.png"});
    await page.getByRole("button", { name: "Save Shared Step Group", exact: true }).click();
    await page.waitForFunction(() => window.writes.length === 1);
    assert.deepEqual(await page.evaluate(() => ({ id:window.writes[0].input.test_data_set_id,row:window.writes[0].input.test_data_row_index })), { id:"data-single",row:0 });
    await panel.getByText("Group account", {exact:true}).waitFor();
    await page.getByRole("button", {name:"Back to Shared Step Group list",exact:true}).click();
    await page.locator(".shared-step-group-tile-card .tile-card-open-button").click();
    await panel.getByText("Group account", {exact:true}).waitFor();

    await page.getByRole("tab", { name: "Gherkin", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Manage parameter values", exact: true }).count(), 0, "Gherkin does not duplicate the Data Sets Manage Params action");
    assert.equal(await panel.getByRole("button", { name: "Manage Test Params", exact: true }).count(), 1);
    await page.getByRole("button", { name: "Edit Shared Gherkin step 1", exact: true }).click();
    await page.getByRole("combobox", { name: "Shared Gherkin step 1", exact: true }).fill("login as <t.user> with @r.password and <region>");
    const gherkinDownload = await Promise.all([
      page.waitForEvent("download"), panel.getByRole("button", { name: "Download Test Params Template" }).click()
    ]).then(([file]) => file);
    const gherkinTemplate = await readFile(await gherkinDownload.path(), "utf8");
    assert.match(gherkinTemplate, /"r.password"/); assert.match(gherkinTemplate, /"r.region"/); assert.match(gherkinTemplate, /"t.user"/);
    assert.doesNotMatch(gherkinTemplate, /smoke|unused/);
    assert.equal(await page.getByLabel("Shared group data row").count(), 0);
    await page.getByRole("button", { name: "Save Shared Step Group", exact: true }).click();
    await page.waitForFunction(() => window.writes.length === 2);
    assert.equal(await page.evaluate(() => window.writes[1].input.authoring_mode), "gherkin");
    assert.equal(await page.evaluate(() => window.writes[1].input.test_data_row_index), 0);

    await page.getByRole("tab", { name: "Structured", exact: true }).click();
    assert.equal(await panel.getByRole("button", {name:"Download Test Params Template"}).isEnabled(), true);
    const structuredDownload = await Promise.all([
      page.waitForEvent("download"), panel.getByRole("button", {name:"Download Test Params Template"}).click()
    ]).then(([file]) => file);
    assert.equal(await readFile(await structuredDownload.path(), "utf8"), gherkinTemplate, "Mode conversion preserves every exported parameter");
    await page.getByRole("button", { name:"Save Shared Step Group",exact:true }).click();
    await page.waitForFunction(() => window.writes.length === 3);
    const structuredSave = await page.evaluate(() => window.writes[2].input);
    assert.equal(structuredSave.authoring_mode, "structured");
    assert.match(structuredSave.steps[0].action, /@r.region/);
    assert.match(structuredSave.steps[0].action, /@t.user/);
    assert.doesNotMatch(structuredSave.steps[0].action, /<region>/);
    await page.getByRole("tab", { name: "Gherkin", exact: true }).click();
    await page.getByRole("tab", { name: "Structured", exact: true }).click();
    assert.equal(await panel.getByRole("button", {name:"Download Test Params Template"}).isEnabled(), true);
    await panel.getByRole("button", { name: "Unlink Group account", exact: true }).click();
    await page.getByRole("button", { name: "Save Shared Step Group", exact: true }).click();
    await page.waitForFunction(() => window.writes.length === 4);
    assert.equal(await page.evaluate(() => window.writes[3].input.test_data_set_id), null);
    assert.equal(await page.evaluate(() => window.writes[3].input.test_data_row_index), 0);

    await panel.getByRole("button", { name: "Create Data Set", exact: true }).click();
    const creator = page.getByRole("dialog", { name: "Create Test Data Set", exact: true });
    await creator.getByLabel("Data set name").fill("Single selected group row");
    await creator.getByLabel("Data file import", { exact:true }).setInputFiles({name:"params.csv",mimeType:"text/csv",buffer:Buffer.from('t.user,r.password\ncharlie,third\ndana,fourth\n')});
    await creator.getByText("Shared Step Group data sets require exactly one data row. This file contains 2.").waitFor();
    assert.equal(await page.evaluate(() => window.created.length), 0);
    await creator.getByLabel("Data file import", {exact:true}).setInputFiles({name:"single.csv",mimeType:"text/csv",buffer:Buffer.from('t.user,r.password\ncharlie,third\n')});
    await creator.getByText("Imported 1 row from single.csv.", {exact:true}).waitFor();
    assert.equal(await creator.getByRole("button", {name:"Add row",exact:true}).isDisabled(), true);
    await creator.getByLabel("Data format", {exact:true}).selectOption("key_value");
    await creator.getByLabel("Data format", {exact:true}).selectOption("table");
    assert.equal(await creator.getByRole("button", {name:"Add row",exact:true}).isDisabled(), true);
    await creator.getByRole("button", { name:"Create and Select",exact:true }).click();
    await page.waitForFunction(() => window.created.length === 1);
    await panel.getByText("Single selected group row", { exact:true }).waitFor();
    assert.equal(await page.getByLabel("Shared group data row").count(), 0);
    assert.equal(await page.evaluate(() => window.created[0].rows.length), 1);
    assert.deepEqual(await page.evaluate(() => window.created[0].rows[0]), {"t.user":"charlie","r.password":"third"});
    assert.equal(await panel.locator(".test-case-iteration-badge").innerText(), "1 iteration");
    await page.setViewportSize({width:390,height:844});
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({path:"/tmp/qaira-shared-dataset-mobile.png"});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    assert.deepEqual(errors, []);
    await page.close();

    const legacy = await browser.newPage();
    await legacy.goto(`${url}?mode=legacy`);
    await legacy.getByLabel("Group name").waitFor();
    await legacy.getByText("Existing link uses row 2 only. To replace it, link a data set with exactly one row.", {exact:true}).waitFor();
    assert.equal(await legacy.getByLabel("Shared group data row").count(), 0);
    await legacy.getByRole("button", {name:"Save Shared Step Group",exact:true}).click();
    await legacy.waitForFunction(() => window.writes.length === 1);
    assert.equal(await legacy.evaluate(() => window.writes[0].input.test_data_row_index), 1);
    await legacy.close();

    const limited = await browser.newPage();
    await limited.goto(`${url}?mode=permissions`);
    await limited.getByLabel("Group name").waitFor();
    await limited.getByText("Test Data Is Unavailable", {exact:true}).waitFor();
    assert.equal(await limited.getByRole("button", {name:"Link Existing Data Set",exact:true}).count(), 0);
    assert.deepEqual(await limited.evaluate(() => window.calls), []);
    await limited.getByRole("button", {name:"Save Shared Step Group",exact:true}).click();
    await limited.waitForFunction(() => window.writes.length === 1);
    assert.equal(await limited.evaluate(() => Object.hasOwn(window.writes[0].input,'test_data_set_id')), false);
    await limited.close();
  } catch (error) {
    const page = browser?.contexts()[0]?.pages()[0];
    if (page) {
      await writeFile("/tmp/qaira-shared-dataset-failure.txt", await page.locator("body").innerText());
      await page.screenshot({path:"/tmp/qaira-shared-dataset-failure.png",fullPage:true});
    }
    throw error;
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
});
