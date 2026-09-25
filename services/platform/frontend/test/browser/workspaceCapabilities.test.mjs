import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../../../testengine/backend/package.json", import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = new URL("../../", import.meta.url);

const fixture = `
import { knowledgeApi } from "/services/knowledge/frontend/api.client";
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider,useAuth} from '/src/auth/AuthContext';
import {useWorkspaceData} from '/src/platform/hooks/useWorkspaceData';
import {SmartContextWorkbench} from '/services/ai/frontend/components/SmartContextWorkbench';
import {api,sessionStorage} from '/src/lib/api';
import {setCurrentScope} from '/src/platform/hooks/useCurrentProject';
import policy from '/src/platform/lib/featurePolicy.generated.json';
import '/src/styles.css';
import '/src/modal-system.css';
const project='capability-project';
let session={token:'capability-fixture',user:{id:'reporter',role:'member',name:'Reporter',workspace_permissions:['workspace.view'],project_permissions:{[project]:['requirement.view','feedback.view','knowledge.view']}}};
sessionStorage.write(session);setCurrentScope(project,'app');
window.calls=[];window.aborts=[];window.holdBugs=false;window.holdKnowledge=false;window.failSession=false;
function stub(object,prefix=''){for(const [key,value]of Object.entries(object)){const path=prefix?prefix+'.'+key:key;if(typeof value==='function')object[key]=async()=>{window.calls.push(path);return []};else if(value&&typeof value==='object')stub(value,path)}}
stub(api);
api.auth.session=async()=>{if(window.failSession)throw Object.assign(new Error('Temporarily unavailable'),{status:503});return structuredClone(session)};
let flags={flags:Object.fromEntries(policy.feature_keys.map(key=>[key,true])),permission_features:policy.permission_features,dependencies:policy.dependencies};
flags.flags['hellotest.manual.bugs']=false;flags.flags['hellotest.ai.knowledge']=false;
api.featureFlags.snapshot=async()=>structuredClone(flags);
const wait=(resource,signal)=>new Promise((resolve,reject)=>{window['release'+resource]=resolve;signal?.addEventListener('abort',()=>{window.aborts.push(resource);reject(new DOMException('Cancelled','AbortError'))},{once:true})});
api.requirements.list=async(query,options)=>{window.calls.push('requirements.list');return [{id:'story-a',title:'Visible Story',project_id:query.project_id}]};
api.issues.list=async(query,options)=>{window.calls.push('issues.list');if(window.holdBugs)await wait('Bugs',options?.signal);return [{id:'bug-a',title:'Visible Bug'}]};
api.knowledgeRepo.search= knowledgeApi.knowledgeRepo.search =async(input,options)=>{window.calls.push('knowledge.search');if(window.holdKnowledge)await wait('Knowledge',options?.signal);return {results:[{id:'source-a',chunk_id:'chunk-a',source_id:'source-a',title:'Retrieved source',content:'Scoped supporting evidence'}]}};
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
client.setQueryData(['feature-flags'],flags);
client.setQueryData(['users',project],[{id:'hidden-user',name:'Cached hidden user'}]);
client.setQueryData(['issues',project,'detail'],[{id:'hidden-bug',title:'Cached hidden Bug'}]);
window.setFeature=(key,value)=>{flags={...flags,flags:{...flags.flags,[key]:value}};client.setQueryData(['feature-flags'],flags)};
window.invalidateBugs=()=>client.invalidateQueries({queryKey:['issues',project,'detail'],refetchType:'none'});
window.setGrants=permissions=>{session={...session,user:{...session.user,project_permissions:{[project]:permissions}}};return window.refreshSession()};
window.cachedBugs=()=>client.getQueryData(['issues',project,'detail']);
function Harness(){
 const {session,isLoading,refreshSession}=useAuth();window.refreshSession=refreshSession;
 const data=useWorkspaceData();window.workspaceData=data;
 const [draft,setDraft]=useState('');const [busy,setBusy]=useState(false);
 return <main style={{padding:24,fontFamily:'sans-serif'}}><h1>Optional workspace context</h1><p>Signed in: {session?.user.id||'none'}; verifying: {String(isLoading)}</p><label>Manual draft<textarea aria-label="Manual draft" value={draft} onChange={event=>setDraft(event.target.value)}/></label><button disabled={busy}>Continue editing</button><SmartContextWorkbench projectId={project} initialQuery="Checkout risk" onApply={()=>{}} onBusyChange={setBusy}/><div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16}}>{Object.entries(data).map(([name,query])=><section key={name} data-resource={name} style={{border:'1px solid #ddd',padding:12}}><h2>{name}</h2><output data-state>{JSON.stringify({data:query.data,error:query.error?.message||null,isLoading:query.isLoading,isPending:query.isPending,isFetching:query.isFetching})}</output><button onClick={()=>void query.refetch()}>Refresh {name}</button></section>)}</div></main>
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><Harness/></AuthProvider></QueryClientProvider>);
`;

test("optional workspace queries track grants and live flags without erasing the host draft", { timeout: 90000 }, async () => {
  const name = `workspace-capabilities-${randomUUID()}`, html = new URL(`${name}.html`, root), tsx = new URL(`${name}.tsx`, root);
  const artifacts = process.env.BROWSER_SCREENSHOT_DIR || "/tmp/qaira-workspace-capabilities";
  let browser;
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, fixture); await mkdir(artifacts, { recursive: true });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, reducedMotion: "reduce" });
    const errors = []; page.on("pageerror", error => errors.push(error.stack)); page.setDefaultTimeout(10000);
    await page.goto(`${process.env.VITE_TEST_URL || "http://127.0.0.1:5186"}/${name}.html`);
    await page.waitForFunction(() => window.workspaceData?.requirements.data?.[0]?.id === "story-a");
    await page.getByRole("textbox", { name: "Manual draft" }).fill("Keep my typed report while optional context changes.");
    const state = async name => JSON.parse(await page.locator(`[data-resource="${name}"] [data-state]`).innerText());
    for (const resource of ["users", "roles", "projects", "projectMembers", "appTypes", "issues", "testSuites", "testCases", "executions", "executionResults"]) {
      assert.deepEqual(await state(resource), { data: [], error: null, isLoading: false, isPending: false, isFetching: false }, resource);
      await page.getByRole("button", { name: `Refresh ${resource}`, exact: true }).click();
    }
    assert.deepEqual(await page.evaluate(() => window.calls), ["requirements.list"]);
    assert.equal(await page.getByRole("button", { name: "Smart Context", exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.cachedBugs()[0].id), "hidden-bug");

    await page.evaluate(async () => { window.holdBugs = true; await window.invalidateBugs(); window.setFeature("hellotest.manual.bugs", true); });
    await page.waitForFunction(() => typeof window.releaseBugs === "function");
    await page.evaluate(() => window.setFeature("hellotest.manual.bugs", false));
    await page.waitForFunction(() => window.aborts.includes("Bugs"));
    assert.deepEqual((await state("issues")).data, []);
    assert.equal((await state("issues")).isPending, false);
    await page.evaluate(() => { window.releaseBugs(); window.holdBugs = false; window.setFeature("hellotest.manual.bugs", true); });
    await page.waitForFunction(() => window.workspaceData.issues.data?.[0]?.id === "bug-a");

    await page.evaluate(() => { window.holdKnowledge = true; window.setFeature("hellotest.ai.knowledge", true); });
    await page.getByRole("button", { name: "Smart Context", exact: true }).click();
    await page.getByRole("button", { name: "Retrieve", exact: true }).click();
    await page.waitForFunction(() => typeof window.releaseKnowledge === "function");
    await page.evaluate(() => window.setFeature("hellotest.ai.knowledge", false));
    await page.waitForFunction(() => window.aborts.includes("Knowledge"));
    assert.equal(await page.getByRole("dialog", { name: "Smart Context workbench" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Continue editing" }).isEnabled(), true);
    await page.evaluate(() => window.releaseKnowledge());

    await page.evaluate(() => window.setGrants(["requirement.view"]));
    await page.waitForFunction(() => window.workspaceData.issues.data?.length === 0);
    assert.equal((await state("requirements")).data[0].id, "story-a");
    const callsBefore = await page.evaluate(() => window.calls.length);
    await page.getByRole("button", { name: "Refresh issues", exact: true }).click();
    assert.equal(await page.evaluate(() => window.calls.length), callsBefore);
    await page.evaluate(async () => { window.failSession = true; await window.refreshSession(); window.failSession = false; });
    assert.match(await page.locator("main").innerText(), /Signed in: reporter/);
    assert.equal(await page.getByRole("textbox", { name: "Manual draft" }).inputValue(), "Keep my typed report while optional context changes.");
    await page.screenshot({ path: `${artifacts}/partial-features-preserve-draft.png`, fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
});
