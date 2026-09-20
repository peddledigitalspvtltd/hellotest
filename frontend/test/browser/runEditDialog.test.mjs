import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const frontendRoot = new URL("../../", import.meta.url);
const source = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "/src/auth/AuthContext";
import { api, HelloTestApiError, sessionStorage } from "/src/lib/api";
import { RunEditDialog } from "/src/components/RunEditDialog";
import "/src/styles.css";
import "/src/dark-theme.css";
import "/src/catalog-list.css";
import "/src/modal-system.css";
import "/src/execution-run-builder.css";
import "/src/workspace-layout.css";
const variant = new URLSearchParams(location.search).get("variant") || "queued";
const limited = variant === "limited";
const session = { token:"fixture", user:{id:"qa",role:limited ? "member" : "admin",permissions:["run.view","run.update"]} };
sessionStorage.write(session); localStorage.setItem("hellotest.current_project_id","project");
api.auth.session=async()=>session;
api.featureFlags.snapshot=async()=>({flags:new Proxy({}, {get:()=>true})});
api.executions.parameterPlan=async()=>({case_count:1,suite_count:1,expected_instance_count:1,parameters:[]});
window.saved=[]; window.sourceRequests=0; window.savedCallbacks=0;
let run = {id:"run",project_id:"project",app_type_id:"app",revision:7,name:"Saved run plan",run_mode:variant === "running-remote" || limited ? "remote" : "manual",trigger:variant === "running-remote" || limited ? "ci" : "manual",status:variant.startsWith("running") ? "running" : variant === "finished" ? "completed" : "queued",started_at:variant.startsWith("running") ? "2026-09-09T10:00:00Z" : null,ended_at:variant === "finished" ? "2026-09-09T11:00:00Z" : null,
suite_ids:["saved-suite"],test_case_ids:["pinned-case"],direct_test_case_ids:["pinned-case"],suite_snapshots:[{id:"saved-suite",name:"Saved suite"}],case_snapshots:[{test_case_id:"pinned-case",test_case_title:"Pinned case",test_case_description:"Captured source",suite_id:"saved-suite",priority:2,status:"ready"}],
assigned_to_ids:["missing-owner"],assigned_users:[{id:"missing-owner",name:"Original owner",email:"owner@example.test"}],start_date:"2026-09-09",end_date:"2026-09-10",release:"Release 1",sprint:"Sprint 1",build:"Build 1",parallel_enabled:false,parallel_count:1,
test_environment:{id:"missing-env",name:"Saved environment"},test_configuration:{id:"missing-config",name:"Saved configuration"},test_data_set:{id:"missing-data",name:"Saved data"}};
api.executions.get=async()=>{await new Promise(resolve=>setTimeout(resolve,30));return structuredClone(run);};
api.executions.update=async(id,payload)=>{
 window.saved.push(structuredClone(payload));
 if(window.saved.length===1 && variant === "stale") {run={...run,revision:8,name:"Other editor's plan"};throw new HelloTestApiError("This run changed. Reload its current revision.",409,{code:"REVISION_CONFLICT",current_revision:8});}
 if(window.saved.length===1 && variant === "failure") throw new HelloTestApiError("The data service is temporarily unavailable.",503,{code:"DATABASE_UNAVAILABLE"});
 if(variant === "finished-after-save") {run={...run,revision:8,status:"completed",ended_at:"2026-09-09T11:00:00Z"};throw new HelloTestApiError("This run has finished.",409,{code:"RUN_FINISHED"});}
 return {updated:true,revision:run.revision+1};
};
const resource = async()=>{window.sourceRequests++;return [];};
api.testEnvironments.list=async()=>{window.sourceRequests++;return [{id:"new-env",name:"New environment",app_type_id:"app"}];};
api.testConfigurations.list=resource;api.testDataSets.list=resource;
api.testSuites.list=async()=>{window.sourceRequests++;return [{id:"new-suite",name:"Additional suite",app_type_id:"app",parent_id:null,test_case_ids:["new-case"]}];};
api.testCases.list=async()=>{window.sourceRequests++;return [{id:"new-case",title:"Additional case",description:"Further coverage",suite_id:null,requirement_id:null,automated:"no",priority:2,status:"ready"}];};
function Fixture(){const [open,setOpen]=useState(false);return <main><button onClick={()=>setOpen(true)}>Edit fixture run</button>{open ? <RunEditDialog executionId="run" assigneeOptions={[]} canRunLocalAutomation={!limited} canRunRemoteAutomation={!limited} canConfigureParallelAutomation={!limited} onClose={()=>setOpen(false)} onSaved={()=>{window.savedCallbacks++;}} /> : null}</main>;}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><AuthProvider><Fixture /></AuthProvider></MemoryRouter></QueryClientProvider>);
`;

test("run edits preserve scope and attachments, enforce execution locks, recover conflicts and fit small screens", { timeout: 90000 }, async () => {
  const name = `run-edit-qa-${randomUUID()}`;
  const htmlPath = new URL(`${name}.html`, frontendRoot);
  const sourcePath = new URL(`${name}.tsx`, frontendRoot);
  let browser;
  try {
    await writeFile(htmlPath, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(sourcePath, source);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const url = `${process.env.VITE_TEST_URL || "http://127.0.0.1:5173"}/${name}.html`;
    const open = async (variant = "queued") => {
      await page.goto(`${url}?variant=${variant}`);
      await page.getByRole("button", { name: "Edit fixture run" }).click();
      await page.getByRole("textbox", { name: "Run Name" }).waitFor();
      await page.getByText("Saved suite (saved selection)", { exact: true }).waitFor();
      return page.getByRole("dialog");
    };
    for (const width of [1440, 760, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const dialog = await open();
      assert.equal(await dialog.getByRole("button", { name: "Save changes", exact: true }).isDisabled(), true);
      assert.equal(await dialog.getByRole("combobox", { name: "Test environment" }).inputValue(), "missing-env");
      assert.equal(await dialog.getByRole("combobox", { name: "Test configuration" }).inputValue(), "missing-config");
      assert.equal(await dialog.getByRole("combobox", { name: "Linked Data Set" }).inputValue(), "missing-data");
      assert.equal(await dialog.getByText("Original owner", { exact: true }).count(), 1);
      const bounds = await dialog.evaluate(element => ({left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,height:element.getBoundingClientRect().height,client:element.clientWidth,scroll:element.scrollWidth}));
      assert.ok(bounds.left >= 0 && bounds.right <= width + 1 && bounds.height <= 900 && bounds.scroll <= bounds.client + 1, JSON.stringify({width,bounds}));
      if(width === 1440) assert.ok(bounds.client >= 1000,"desktop editing must give both plan and scope useful width");
      await dialog.locator(".run-edit-fields").evaluate(element=>{element.scrollTop=element.scrollHeight;});
      assert.equal(await dialog.getByRole("checkbox",{name:"Select Additional case",exact:true}).isVisible(),true);
      await dialog.locator(".run-edit-fields").evaluate(element=>{element.scrollTop=0;});
      if (process.env.BROWSER_SCREENSHOT_DIR && [1440,390].includes(width)) await page.screenshot({path:join(process.env.BROWSER_SCREENSHOT_DIR,`run-edit-${width}.png`),animations:"disabled"});
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({state:"detached"});
      assert.equal(await page.getByRole("button", { name:"Edit fixture run" }).evaluate(element=>document.activeElement===element),true);
    }
    await page.setViewportSize({width:1440,height:1000});
    let dialog = await open();
    await dialog.getByRole("textbox", {name:"Run Name"}).fill("Edited queued plan");
    await dialog.getByLabel("End date",{exact:true}).fill("2026-09-08");
    assert.equal(await dialog.getByRole("button",{name:"Save changes",exact:true}).isDisabled(),true);
    await dialog.getByLabel("End date",{exact:true}).fill("2026-09-14");
    await dialog.getByLabel("Start date",{exact:true}).fill("2026-09-11");
    await dialog.getByRole("combobox",{name:"Test environment"}).selectOption("new-env");
    await dialog.getByRole("checkbox",{name:/Additional suite/}).check();
    await dialog.getByRole("checkbox",{name:"Select Additional case",exact:true}).check();
    await dialog.getByRole("button",{name:"Save changes",exact:true}).click();
    await page.getByRole("dialog").waitFor({state:"detached"});
    assert.deepEqual(await page.evaluate(()=>window.saved[0]),{name:"Edited queued plan",start_date:"2026-09-11",end_date:"2026-09-14",suite_ids:["saved-suite","new-suite"],test_case_ids:["pinned-case","new-case"],test_environment_id:"new-env",expected_revision:7});

    for (const variant of ["running-manual","running-remote"]) {
      dialog=await open(variant);
      assert.equal(await dialog.getByRole("combobox",{name:"Run mode"}).isDisabled(),true);
      assert.equal(await dialog.getByRole("combobox",{name:"Test environment"}).isDisabled(),true);
      const extraCase=dialog.getByRole("checkbox",{name:"Select Additional case",exact:true});
      assert.equal(await extraCase.isDisabled(),variant === "running-remote");
      if(variant === "running-manual") await extraCase.check();
      await dialog.getByRole("textbox",{name:"Run Name"}).fill("Edited active plan");
      await dialog.getByLabel("End date",{exact:true}).fill("2026-09-15");
      await dialog.getByRole("button",{name:"Save changes",exact:true}).click();
      await page.getByRole("dialog").waitFor({state:"detached"});
      assert.deepEqual(await page.evaluate(()=>window.saved[0]),{name:"Edited active plan",end_date:"2026-09-15",...(variant === "running-manual" ? {test_case_ids:["pinned-case","new-case"]} : {}),expected_revision:7});
    }
    dialog=await open("finished");
    assert.equal(await dialog.getByRole("button",{name:"Save changes",exact:true}).isDisabled(),true);
    assert.equal(await dialog.getByRole("textbox",{name:"Run Name"}).isDisabled(),true);
    assert.equal(await page.evaluate(()=>window.saved.length),0);

    dialog=await open("stale");
    await dialog.getByRole("textbox",{name:"Run Name"}).fill("My unsaved plan");
    await dialog.getByRole("button",{name:"Save changes",exact:true}).click();
    await dialog.getByRole("button",{name:"Reload current run"}).waitFor();
    assert.equal(await dialog.getByRole("textbox",{name:"Run Name"}).inputValue(),"My unsaved plan");
    assert.equal(await dialog.getByRole("button",{name:"Save changes",exact:true}).isDisabled(),true);
    await dialog.getByRole("button",{name:"Reload current run"}).click();
    await page.waitForFunction(()=>document.querySelector('input[id^="field-run-name"]')?.value === "Other editor's plan");
    await dialog.getByRole("textbox",{name:"Run Name"}).fill("Reviewed current plan");
    await dialog.getByRole("button",{name:"Save changes",exact:true}).click();
    await page.getByRole("dialog").waitFor({state:"detached"});
    assert.equal(await page.evaluate(()=>window.saved[1].expected_revision),8);

    dialog=await open("failure");
    await dialog.getByRole("textbox",{name:"Run Name"}).fill("Keep this draft");
    await dialog.getByRole("button",{name:"Save changes",exact:true}).click();
    await dialog.getByRole("alert").waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent === "Save changes" && !button.disabled));
    assert.equal(await dialog.getByRole("textbox",{name:"Run Name"}).inputValue(),"Keep this draft");
    await dialog.getByRole("button",{name:"Save changes",exact:true}).click();
    await page.getByRole("dialog").waitFor({state:"detached"});
    assert.equal(await page.evaluate(()=>window.savedCallbacks),1);

    dialog=await open("finished-after-save");
    await dialog.getByRole("textbox",{name:"Run Name"}).fill("Late draft");
    await dialog.getByRole("button",{name:"Save changes",exact:true}).click();
    await dialog.getByText("This run has finished. Its plan and captured results are locked.",{exact:true}).waitFor();
    assert.equal(await dialog.getByRole("button",{name:"Save changes",exact:true}).isDisabled(),true);

    dialog=await open("limited");
    assert.equal(await page.evaluate(()=>window.sourceRequests),0,"unavailable source permissions do not trigger protected catalog queries");
    const mode=dialog.getByRole("combobox",{name:"Run mode"});
    assert.equal(await mode.inputValue(),"remote");
    assert.equal(await mode.locator('option[value="remote"]').isDisabled(),true);
    assert.equal(await mode.locator('option[value="local"]').count(),0);
    assert.equal(await dialog.getByRole("checkbox",{name:/Pinned case/}).isDisabled(),true);
    await mode.selectOption("manual");
    await dialog.getByRole("button",{name:"Save changes",exact:true}).click();
    await page.getByRole("dialog").waitFor({state:"detached"});
    assert.deepEqual(await page.evaluate(()=>window.saved[0]),{execution_mode:"manual",expected_revision:7});
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(htmlPath),unlink(sourcePath)]);
  }
});
