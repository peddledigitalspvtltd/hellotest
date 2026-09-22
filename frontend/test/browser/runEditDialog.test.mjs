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
window.saved=[]; window.sourceRequests=0; window.savedCallbacks=0; window.deliveryRequests=[];
let run = {id:"run",project_id:"project",app_type_id:"app",revision:7,name:"Saved run plan",run_mode:variant === "running-remote" || limited ? "remote" : "manual",trigger:variant === "running-remote" || limited ? "ci" : "manual",status:variant.startsWith("running") ? "running" : variant === "finished" ? "completed" : "queued",started_at:variant.startsWith("running") ? "2026-09-09T10:00:00Z" : null,ended_at:variant === "finished" ? "2026-09-09T11:00:00Z" : null,
suite_ids:["saved-suite"],test_case_ids:["pinned-case"],direct_test_case_ids:["pinned-case"],suite_snapshots:[{id:"saved-suite",name:"Saved suite"}],case_snapshots:[{test_case_id:"pinned-case",test_case_title:"Pinned case",test_case_description:"Captured source",suite_id:"saved-suite",priority:2,status:"ready"}],
assigned_to_ids:["missing-owner"],assigned_users:[{id:"missing-owner",name:"Original owner",email:"owner@example.test"}],start_date:"2026-09-09",end_date:"2026-09-10",release:variant==="mapped" ? "Former release label" : "Release 1",sprint:variant==="mapped" ? "Former Sprint label" : "Sprint 1",release_id:variant==="mapped" ? "release-2" : "missing-release",iteration_id:variant==="mapped" ? "sprint-2" : "missing-sprint",build:"Build 1",parallel_enabled:false,parallel_count:1,
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
api.testSuites.list=async()=>{window.sourceRequests++;return [{id:"new-suite",name:"Additional suite",app_type_id:"app",parent_id:null,test_case_ids:["new-case"]},...Array.from({length:10},(_,i)=>({id:'extra-suite-'+i,name:'Coverage suite '+i,app_type_id:'app',parent_id:null,test_case_ids:[]}))];};
api.testCases.list=async()=>{window.sourceRequests++;return [{id:"new-case",title:"Additional case",description:"Further coverage",suite_id:null,requirement_id:null,automated:"no",priority:2,status:"ready"}];};
const deliveryAttempts={};
const delivery=(kind,result)=>async(query)=>{window.sourceRequests++;window.deliveryRequests.push({kind,query});deliveryAttempts[kind]=(deliveryAttempts[kind]||0)+1;if(variant==='delivery-failure'&&deliveryAttempts[kind]===1)throw new Error('Delivery catalog unavailable');return result;};
api.requirementReleases.list=delivery('releases',[{id:'release-2',project_id:'project',name:'September delivery',fix_version:'v2.0',state:'planned'}]);
api.requirementIterations.list=delivery('sprints',[{id:'sprint-2',project_id:'project',name:'Native Sprint name',jira_sprint_name:'Checkout Sprint',state:variant==='mapped'?'closed':'active'},{id:'closed-sprint',project_id:'project',name:'Old Sprint',state:'closed'}]);
api.metadata.domain=delivery('metadata',{jira:{versions:[{id:'connected-version',name:'Connected release',archived:false}],sprints:[{id:'connected-sprint',name:'Connected Sprint',state:'active'}]}});
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
      assert.match(await dialog.locator('.run-data-linked').innerText(), /Current Data Set[\s\S]*Saved execution data/,
        'The saved Data Set stays linked when its catalog record is unavailable');
      assert.equal(await dialog.getByText("Original owner", { exact: true }).count(), 1);
      await dialog.getByRole('combobox',{name:'Release',exact:true}).locator('option[value="v2.0"]').waitFor({state:'attached'});
      assert.equal(await dialog.getByRole('combobox',{name:'Release',exact:true}).inputValue(),'Release 1');
      assert.equal(await dialog.getByRole('combobox',{name:'Sprint',exact:true}).inputValue(),'Sprint 1');
      const bounds = await dialog.evaluate(element => ({left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,height:element.getBoundingClientRect().height,client:element.clientWidth,scroll:element.scrollWidth}));
      assert.ok(bounds.left >= 0 && bounds.right <= width + 1 && bounds.height <= 900 && bounds.scroll <= bounds.client + 1, JSON.stringify({width,bounds}));
      if(width === 1440) assert.ok(bounds.client >= 1000,"desktop editing must give both plan and scope useful width");
      const body=dialog.locator('.run-edit-fields');
      for(const region of ['configuration','scope','header','footer']) {
        await body.evaluate(element=>{element.scrollTop=0;});
        const target=region==='header'?dialog.locator('.run-edit-heading'):region==='footer'?dialog.locator('.run-edit-footer'):body;
        const rect=await target.boundingBox();
        const pointer={x:rect.x+rect.width*(region==='configuration'?.15:region==='scope'?.8:.5),y:rect.y+Math.min(rect.height/2,180)};
        await page.mouse.move(pointer.x,pointer.y);
        await page.mouse.wheel(0,240);
        await page.waitForFunction(()=>document.querySelector('.run-edit-fields').scrollTop>20,undefined,{timeout:3000}).catch(async()=>{
          throw new Error(`${region} wheel at ${width}px failed: ${JSON.stringify(await page.evaluate(point=>{const parents=[];for(let element=document.elementFromPoint(point.x,point.y);element; element=element.parentElement){const style=getComputedStyle(element);parents.push({tag:element.tagName,class:element.className,overflow:style.overflow,overscroll:style.overscrollBehavior,top:element.scrollTop,height:element.clientHeight,total:element.scrollHeight});}return parents;},pointer))}`);
        });
        assert.ok(await body.evaluate(element=>element.scrollTop)>20,`${region} wheel gestures scroll the complete form at ${width}px`);
      }
      const suiteRow=dialog.locator('.suite-case-picker-list--ordered').first().locator('label').first();
      await suiteRow.scrollIntoViewIfNeeded();
      const beforeListWheel=await body.evaluate(element=>element.scrollTop);
      await suiteRow.hover();
      await page.mouse.wheel(0,200);
      await page.waitForFunction(before=>document.querySelector('.run-edit-fields').scrollTop>before+20,beforeListWheel);
      assert.equal(await dialog.locator('.suite-case-picker-list--ordered').first().evaluate(element=>getComputedStyle(element).maxHeight),'none','Long suite lists do not trap the form wheel gesture in a second scrollbar');
      await dialog.locator(".run-edit-fields").evaluate(element=>{element.scrollTop=element.scrollHeight;});
      const scroll = await dialog.locator(".run-edit-fields").evaluate(element => ({
        top:element.scrollTop,max:element.scrollHeight-element.clientHeight,
        bodyBottom:element.getBoundingClientRect().bottom,
        contentBottom:element.querySelector('.run-edit-grid').getBoundingClientRect().bottom
      }));
      assert.ok(scroll.max > 0, 'The run editor owns a real scrollable body');
      assert.ok(Math.abs(scroll.top-scroll.max)<=2 && scroll.contentBottom<=scroll.bodyBottom+2,
        `The complete edit form can be reached at ${width}px: ${JSON.stringify(scroll)}`);
      const footer = await dialog.locator('.run-edit-footer').boundingBox();
      assert.ok(footer.y >= scroll.bodyBottom-2 && footer.y+footer.height<=902, 'Save and Cancel remain outside the scroll region and inside the viewport');
      assert.equal(await dialog.locator('.execution-run-config-rail').count(),1,'Edit reuses the Create Run configuration rail');
      assert.equal(await dialog.locator('.execution-run-selection-workspace').count(),1,'Edit reuses the Create Run scope workspace');
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
    await dialog.getByRole('combobox',{name:'Release',exact:true}).selectOption('v2.0');
    await dialog.getByRole('combobox',{name:'Sprint',exact:true}).selectOption('Checkout Sprint');
    await dialog.getByRole("combobox",{name:"Test environment"}).selectOption("new-env");
    await dialog.getByRole("checkbox",{name:/Additional suite/}).check();
    await dialog.getByRole("checkbox",{name:"Select Additional case",exact:true}).check();
    await dialog.getByRole("button",{name:"Save changes",exact:true}).click();
    await page.getByRole("dialog").waitFor({state:"detached"});
    assert.deepEqual(await page.evaluate(()=>window.saved[0]),{name:"Edited queued plan",start_date:"2026-09-11",end_date:"2026-09-14",release:'v2.0',sprint:'Checkout Sprint',release_id:'release-2',iteration_id:'sprint-2',suite_ids:["saved-suite","new-suite"],test_case_ids:["pinned-case","new-case"],test_environment_id:"new-env",expected_revision:7});
    assert.deepEqual(await page.evaluate(()=>window.deliveryRequests.filter(item=>item.kind!=='metadata').map(item=>item.query)),[{project_id:'project'},{project_id:'project'}]);

    dialog=await open('mapped');
    await page.waitForFunction(()=>document.querySelector('select[id^="field-release"]')?.value==='v2.0');
    assert.equal(await dialog.getByRole('combobox',{name:'Sprint',exact:true}).inputValue(),'Checkout Sprint','The saved native Sprint ID resolves its renamed closed option');
    assert.match(await dialog.getByRole('combobox',{name:'Sprint',exact:true}).locator('option:checked').innerText(),/closed/);
    assert.equal(await dialog.getByRole('combobox',{name:'Sprint',exact:true}).locator('option[value="Old Sprint"]').count(),0,'Unrelated closed Sprints stay out of the Create Run option list');
    assert.equal(await dialog.getByRole('button',{name:'Save changes',exact:true}).isDisabled(),true,'Loading renamed native labels does not mutate the saved plan');
    await dialog.getByRole('combobox',{name:'Release',exact:true}).selectOption('Connected release');
    await dialog.getByRole('combobox',{name:'Sprint',exact:true}).selectOption('');
    await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
    await dialog.waitFor({state:'detached'});
    assert.deepEqual(await page.evaluate(()=>window.saved[0]),{release:'Connected release',sprint:'',release_id:'',iteration_id:'',expected_revision:7},'Connected/unassigned scope clears the previous native mappings');

    dialog=await open('delivery-failure');
    await dialog.getByRole('button',{name:'Retry delivery options',exact:true}).waitFor();
    assert.equal(await dialog.getByRole('combobox',{name:'Release',exact:true}).inputValue(),'Release 1');
    await dialog.getByRole('button',{name:'Retry delivery options',exact:true}).click();
    await dialog.getByRole('combobox',{name:'Release',exact:true}).selectOption('v2.0');
    await dialog.getByRole('combobox',{name:'Release',exact:true}).selectOption('Release 1');
    assert.equal(await dialog.getByRole('button',{name:'Save changes',exact:true}).isDisabled(),true,'Returning to a retained unknown selection restores its saved mapping');

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
    assert.equal(await dialog.getByRole('combobox',{name:'Release',exact:true}).isDisabled(),true);
    assert.equal(await dialog.getByRole('combobox',{name:'Sprint',exact:true}).isDisabled(),true);
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
