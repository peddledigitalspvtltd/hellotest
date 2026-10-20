import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
const require=createRequire(new URL("../../../../testengine/backend/package.json",import.meta.url));
const {chromium}=require("playwright"),{expect}=require("playwright/test");
const root=new URL("../../../platform/frontend/",import.meta.url);

test("case Objects uses repository screens and editing while excluding unused captured fields",{timeout:90000},async()=>{
 const template=await readFile(new URL("../../../testing/test/browser/testCaseDataSets.test.mjs",import.meta.url),"utf8");
 let fixture=runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
 fixture=fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';","import {AutomationPage} from '/services/automation/frontend/pages/AutomationPage';import '/src/product-experience.css';").replace("element:<TestCasesPage/>","element:<AutomationPage/>");
 const entry=(id,screen,field,locator)=>({id,project_id:"p",app_type_id:"a",test_case_id:"case1",page_key:screen,page_url:"https://app.example.test/login",locator_intent:field,locator,locator_kind:"css",confidence:.8,metadata:{screen_name:screen,object_name:field,object_role:"input / textbox"}});
 const entries=[entry("email","Login","Email","#email"),entry("submit","Login","Submit","#submit"),entry("password","Login","Password","#password"),entry("address","Checkout","Address","#address"),{...entry("screen","Login","__screen__","__screen__"),metadata:{record_kind:"screen",screen_name:"Login",object_name:"__screen__",business_meaning:"Sign in"}}];
 fixture=fixture.replace("const client=new QueryClient",`item.automated='yes';item.automation_status='ready';item.parameter_values={'t.submitfield':'Login.Submit'};window.objectUpdates=[];
steps.splice(0,steps.length,{id:'s1',test_case_id:'case1',step_order:1,step_type:'web',action:'Enter email',expected_result:'Entered',automation_code:'await web.fill("Login.Email", "Checkout.Address");'},{id:'s2',test_case_id:'case1',step_order:2,step_type:'web',action:'Submit',expected_result:'Signed in',automation_code:'await web.click(params["t.submitfield"]);'});
const entries=${JSON.stringify(entries)};api.testCases.learningCache=async()=>structuredClone(entries);
api.testCases.updateLearningCacheEntry=async(id,input)=>{window.objectUpdates.push({id,input});const row=entries.find(entry=>entry.id===id);Object.assign(row,{...input,metadata:{...row.metadata,...input.metadata,...(input.object_name?{object_name:input.object_name}:{})},updated_at:new Date().toISOString()});return structuredClone(row);};
const role=new URLSearchParams(location.search).get('role');if(role){session.user.role='member';session.user.project_permissions={p:['automation.view','testcase.view','automation.repository.view',...(role==='readonly'?['automation.code.view']:[])]};sessionStorage.write(session);}
const client=new QueryClient`);
 const name="automation-case-objects-"+randomUUID();let browser;
 try {
  await writeFile(new URL(name+".tsx",root),fixture);await writeFile(new URL(name+".html",root),`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
  const page=await browser.newPage({viewport:{width:1500,height:1100}});page.setDefaultTimeout(15000);const errors=[];page.on("pageerror",error=>errors.push(error.message));await page.route("**/api/**",route=>{errors.push("Unexpected API "+route.request().url());return route.abort();});
  const url=`${process.env.VITE_TEST_URL||"http://127.0.0.1:5197"}/${name}.html`;
  await page.goto(url);await page.getByRole("tab",{name:/^Objects/}).click();let objects=page.getByRole("tabpanel",{name:"Automation object bindings"});
  await expect(objects.getByText("1 screen · 2 fields",{exact:true})).toBeVisible();await expect(objects.locator(".pom-page-select")).toHaveCount(1);await expect(objects.locator(".pom-page-select")).toContainText("Login");
  await expect(objects.locator(".pom-member-row:not(.is-head)")).toHaveCount(2);await expect(objects.getByText("Password",{exact:true})).toHaveCount(0);await expect(objects.getByText("Address",{exact:true})).toHaveCount(0);
  await objects.locator(".pom-member-row:not(.is-head)").filter({hasText:"Email"}).click();let config=objects.getByLabel("Object configuration",{exact:true});await config.getByLabel(/Primary locator/).fill("#reviewed-email");await config.getByRole("button",{name:"Save field",exact:true}).click();await page.waitForFunction(()=>window.objectUpdates.length===1);assert.equal(await page.evaluate(()=>window.objectUpdates[0].input.locator),"#reviewed-email");
  await expect(page.getByRole("tab",{name:/^Objects/})).toHaveAttribute("aria-selected","true");await expect(objects.locator(".pom-member-row:not(.is-head)").filter({hasText:"Email"})).toContainText("#reviewed-email");
  if(process.env.UI_REVIEW_ARTIFACT_DIR){await mkdir(process.env.UI_REVIEW_ARTIFACT_DIR,{recursive:true});await objects.screenshot({path:process.env.UI_REVIEW_ARTIFACT_DIR+"/objects-desktop.png"});}await config.getByRole("button",{name:"Close object configuration",exact:true}).click();await objects.getByRole("tab",{name:"Overview",exact:true}).click();await objects.getByLabel("Page URL",{exact:true}).fill("https://app.example.test/reviewed-login");await objects.getByRole("button",{name:"Save screen",exact:true}).click();await page.waitForFunction(()=>window.objectUpdates.some(update=>update.id==='screen'));assert.match(await page.evaluate(()=>window.objectUpdates.find(update=>update.id==='screen').input.page_url),/reviewed-login/);
  await page.setViewportSize({width:390,height:844});assert.ok(await objects.evaluate(element=>element.scrollWidth<=element.clientWidth+1),"scoped repository fits a narrow screen");if(process.env.UI_REVIEW_ARTIFACT_DIR)await objects.screenshot({path:process.env.UI_REVIEW_ARTIFACT_DIR+"/objects-mobile.png"});
  await page.goto(url+"?role=readonly");await page.getByRole("tab",{name:/^Objects/}).click();objects=page.getByRole("tabpanel",{name:"Automation object bindings"});await objects.locator(".pom-member-row:not(.is-head)").filter({hasText:"Email"}).click();config=objects.getByLabel("Object configuration",{exact:true});await expect(config.getByLabel(/Primary locator/)).toBeDisabled();await expect(config.getByRole("button",{name:"Save field",exact:true})).toBeDisabled();
  await page.goto(url+"?role=hidden");await page.getByRole("tab",{name:/^Objects/}).click();objects=page.getByRole("tabpanel",{name:"Automation object bindings"});await expect(objects.getByText("Bindings unavailable",{exact:true})).toBeVisible();await expect(objects.getByText(/Source access is required/)).toBeVisible();await expect(objects.getByText(/0 screens/)).toHaveCount(0);assert.deepEqual(errors,[]);
 } finally {await browser?.close();await Promise.all([rm(new URL(name+".tsx",root),{force:true}),rm(new URL(name+".html",root),{force:true})]);}
});
