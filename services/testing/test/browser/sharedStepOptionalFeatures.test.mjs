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
import {LinkedTestCaseModal} from '/services/testing/frontend/components/LinkedTestCaseModal';
import {api,sessionStorage} from '/src/lib/api';
import {setCurrentScope} from '/src/platform/hooks/useCurrentProject';
import policy from '/src/platform/lib/featurePolicy.generated.json';
import '/src/styles.css';import '/src/modal-system.css';import '/src/workspace-layout.css';
const mode=new URLSearchParams(location.search).get('mode');
const limited=mode==='permissions'||mode==='modal-results';
const session={token:'shared-optional',user:{id:'author',name:'Author',role:limited?'member':'admin',workspace_permissions:['workspace.view'],project_permissions:{project:['shared_step.view','shared_step.manage',...(mode==='modal-results'?['testcase.view','result.view']:[])]}}};
sessionStorage.write(session);setCurrentScope('project','app');
window.calls=[];window.writes=[];window.aborts=[];
function stub(object,prefix=''){for(const [key,value]of Object.entries(object)){const path=prefix?prefix+'.'+key:key;if(typeof value==='function')object[key]=async(...args)=>{window.calls.push(path);return []};else if(value&&typeof value==='object')stub(value,path)}}stub(api);
let flags={flags:Object.fromEntries(policy.feature_keys.map(key=>[key,true])),permission_features:policy.permission_features,dependencies:policy.dependencies};
if(mode==='flags'||mode==='modal')for(const key of ['hellotest.ops.projects','hellotest.ops.admin','hellotest.manual.requirements','hellotest.manual.runs','hellotest.ai.test_authoring','hellotest.ai.content_rephrase','hellotest.api.integrations'])flags.flags[key]=false;
if(mode==='flags')flags.flags['hellotest.manual.test_cases']=false;
api.featureFlags.snapshot=async()=>{if(mode==='flags')await new Promise(resolve=>setTimeout(resolve,100));return structuredClone(flags)};api.auth.session=async()=>session;
api.settings.getLocalization=async()=>({strings:{}});api.settings.getWorkspacePreferences=async()=>({preferences:{}});
api.metadata.workspaceScopes=async()=>{window.calls.push('metadata.workspaceScopes');return {projects:[{id:'project',name:'Project'}]}};
api.appTypes.list=async()=>{window.calls.push('appTypes.list');return [{id:'app',project_id:'project',name:'Web',type:'web'}]};
let group={id:'group-1',display_id:'SSG_1',app_type_id:'app',name:'Checkout reusable steps',description:'Saved description',authoring_mode:'structured',steps:[{id:'step-1',step_order:1,action:'Open checkout',expected_result:'Checkout is shown',step_type:'web'}],used_test_cases:[{id:'case-1',title:'Checkout case'}],usage_count:1};
api.sharedStepGroups.list=async()=>{window.calls.push('sharedStepGroups.list');return [group]};
api.sharedStepGroups.update=async(id,input)=>{window.writes.push({id,input});group={...group,...input};return group};
let firstMetricsRequest=true;
api.sharedStepGroups.metrics=async(query,options)=>{window.calls.push('sharedStepGroups.metrics');if(mode==='slow'&&firstMetricsRequest){firstMetricsRequest=false;await new Promise((resolve,reject)=>{window.releaseHistory=resolve;options?.signal?.addEventListener('abort',()=>{window.aborts.push('history');reject(new DOMException('Cancelled','AbortError'))},{once:true})})}return {groups:[],execution_visible:mode!=='flags'};};
api.executionResults.list=async(query,options)=>{window.calls.push('executionResults.list');if(mode==='slow')await new Promise((resolve,reject)=>{window.releaseHistory=resolve;options?.signal?.addEventListener('abort',()=>{window.aborts.push('history');reject(new DOMException('Cancelled','AbortError'))},{once:true})});return mode==='modal-results'?[{id:'result-1',execution_id:'run-1',test_case_id:'case-1',status:'passed',created_at:'2026-09-16T00:00:00Z'}]:[]};
const testCase={id:'case-1',title:'Checkout case',description:'Manual checkout instructions',detail_complete:true,app_type_id:'app',status:'active',automated:'no',requirement_ids:[],suite_ids:[]};
api.testCases.get=async()=>{window.calls.push('testCases.get');return testCase};
api.testSteps.list=async()=>{window.calls.push('testSteps.list');return [{id:'step-1',test_case_id:'case-1',step_order:1,action:'Open checkout',expected_result:'Checkout is shown'}]};
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});if(mode!=='flags')client.setQueryData(['feature-flags'],flags);
window.setFeature=(key,value)=>{flags={...flags,flags:{...flags.flags,[key]:value}};client.setQueryData(['feature-flags'],flags)};
window.openCatalog=()=>router.navigate('/shared-steps');
const router=createMemoryRouter([{path:'/shared-steps',element:<SharedStepsPage/>}],{initialEntries:['/shared-steps?group=group-1']});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId='author'><main style={{padding:24}}>{mode.startsWith('modal')?<LinkedTestCaseModal projectName='Project' appTypeName='Web' testCase={testCase} requirements={[]} suites={[]} onClose={()=>{}}/>:<RouterProvider router={router}/>}</main></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;

test("Shared Step authoring survives unavailable optional features, partial grants, and pending history", { timeout: 120000 }, async () => {
  const name = `shared-step-optional-${randomUUID()}`;
  const html = new URL(`${name}.html`, root), tsx = new URL(`${name}.tsx`, root);
  let browser;
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, fixture);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    for (const mode of ["flags", "permissions", "slow"]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
      const errors = []; page.on("pageerror", error => errors.push(error.stack)); page.setDefaultTimeout(15000);
      await page.goto(`${process.env.VITE_TEST_URL || "http://127.0.0.1:5186"}/${name}.html?mode=${mode}`);
      const nameField = page.getByLabel("Group name");
      await nameField.fill(`Preserved ${mode} draft`);
      if (mode === "slow") {
        await page.waitForFunction(() => typeof window.releaseHistory === "function");
        await page.evaluate(() => window.setFeature("hellotest.manual.runs", false));
        await page.waitForFunction(() => window.aborts.includes("history"));
        assert.equal(await nameField.inputValue(), "Preserved slow draft");
        await page.evaluate(() => window.releaseHistory());
      } else {
        assert.equal(await page.getByRole("button", { name: /Linked cases/ }).count(), 0);
        assert.equal(await page.getByRole("button", { name: /AI Improve/ }).count(), 0);
      }
      await page.getByRole("button", { name: "Save Shared Step Group", exact: true }).click();
      await page.waitForFunction(() => window.writes.length === 1);
      const write = await page.evaluate(() => window.writes[0]);
      assert.equal(write.input.name, `Preserved ${mode} draft`);
      assert.equal(write.input.app_type_id, "app", "unavailable scope metadata must retain the selected application");
      assert.equal(write.input.steps[0].action, "Open checkout");
      const calls = await page.evaluate(() => window.calls);
      const forbidden = ["projects.list", "requirements.list", "testCases.list", "testSuites.list", "integrations.list"];
      if (mode !== "slow") forbidden.push("executionResults.list", "users.list", "sharedStepGroups.metrics");
      if (mode === "permissions") forbidden.push("appTypes.list");
      assert.deepEqual(calls.filter(call => forbidden.includes(call)), [], `${mode}: optional APIs stay idle`);
      assert.deepEqual(errors, []);
      await page.close();
    }

    for (const mode of ["modal", "modal-results"]) {
      const page = await browser.newPage();
      const errors = []; page.on("pageerror", error => errors.push(error.stack));
      await page.goto(`${process.env.VITE_TEST_URL || "http://127.0.0.1:5186"}/${name}.html?mode=${mode}`);
      await page.getByRole("dialog", { name: "Test case workspace for Checkout case", exact: true }).waitFor();
      await page.waitForFunction(() => window.calls.includes("testSteps.list"));
      if (mode === "modal-results") await page.waitForFunction(() => window.calls.includes("executionResults.list"));
      assert.equal(await page.getByRole("button", { name: "Expand Run history", exact: true }).count(), mode === "modal" ? 0 : 1);
      assert.equal(await page.evaluate(() => window.calls.includes("executionResults.list")), mode !== "modal");
      if (mode === "modal-results") {
        await page.getByRole("button", { name: "Expand Run history", exact: true }).click();
        await page.getByText("Passed in this run snapshot.", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Collapse Run history", exact: true }).click();
        const historySection = page.locator(".editor-accordion-section").filter({ has: page.getByRole("button", { name: "Expand Run history", exact: true }) });
        assert.equal(await historySection.locator(".editor-accordion-toggle-count").innerText(), "1 record", "collapsing history retains the authorized result count");
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
});
