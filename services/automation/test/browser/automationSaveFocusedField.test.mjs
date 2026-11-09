import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

const engineRequire=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=engineRequire('playwright');
const {expect}=engineRequire('playwright/test');
const frontendRoot=new URL('../../../platform/frontend/',import.meta.url);
const frontendRequire=createRequire(new URL('package.json',frontendRoot));
const viteRoot=path.dirname(frontendRequire.resolve('vite/package.json'));
const {createServer}=await import(pathToFileURL(path.join(viteRoot,'dist/node/index.js')).href);

test('the first pointer Save from a focused parameter field saves the latest draft once, and keyboard Save remains available',{timeout:90_000},async()=>{
 const template=await readFile(new URL('../../../testing/test/browser/testCaseDataSets.test.mjs',import.meta.url),'utf8');
 let fixture=runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
 fixture=fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';","import {AutomationPage} from '/services/automation/frontend/pages/AutomationPage';")
  .replace('element:<TestCasesPage/>','element:<AutomationPage/>');
 const source='await page.locator("#employee").fill("@r.employee_first_name");\nawait expect(page.locator("#employee")).toHaveValue("@r.employee_first_name");';
 fixture=fixture.replace('const client=new QueryClient',`
 item.automated='yes';item.test_data_set_ids=[];item.test_data_sets=[];item.parameter_values={'r.employee_first_name':'A reviewed public fixture name whose mapping wraps in the editor'};item.test_data_options={automation_case_type:'web'};
 steps.splice(0,steps.length,{id:'s1',test_case_id:'case1',step_order:1,action:'Enter @r.employee_first_name into the named field',expected_result:'The field contains @r.employee_first_name',step_type:'web',automation_code:${JSON.stringify(source)},api_request:null});
 window.sectionSaves=[];
 api.testSteps.list=async()=>structuredClone(steps);
 api.testSteps.update=async(id,input)=>{window.sectionSaves.push(structuredClone(input));const index=steps.findIndex(step=>step.id===id);steps[index]={...steps[index],...input};return structuredClone(steps[index]);};
 api.testCases.automationParameterPlan=async id=>({test_case_id:id,parameter_plan_key:'fixture-plan:'+id,parameter_values:item.parameter_values,parameter_references:Object.keys(item.parameter_values),private_parameter_references:[],missing_parameter_references:[],deferred_parameter_references:[]});
 const client=new QueryClient`);
 const name='automation-focused-save-'+randomUUID();let vite,browser;
 try{
  await writeFile(new URL(name+'.tsx',frontendRoot),fixture);
  await writeFile(new URL(name+'.html',frontendRoot),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  vite=await createServer({root:fileURLToPath(frontendRoot),configFile:fileURLToPath(new URL('vite.config.ts',frontendRoot)),server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'});
  await vite.listen();const address=vite.httpServer.address();
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12_000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{errors.push('Unexpected application API request');return route.abort();});
  await page.goto(`http://127.0.0.1:${address.port}/${name}.html`);
  await page.getByRole('tab',{name:/^Plan/}).click();await page.locator('.automation-plan-row').first().getByRole('button',{name:'Edit',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Edit section',exact:true});
  await dialog.getByRole('button',{name:'Edit Step 1 action',exact:true}).click();
  await dialog.getByRole('combobox',{name:'Step 1 action',exact:true}).fill('Latest action @r.employee_first_name');
  await page.keyboard.press('Escape');
  await dialog.getByRole('button',{name:'Edit Step 1 expected result',exact:true}).click();
  const expected=dialog.getByRole('combobox',{name:'Step 1 expected result',exact:true}),latest='Latest outcome @r.employee_first_name';
  await expected.fill(latest);await page.keyboard.press('Escape');await expect(expected).toBeFocused();
  const mapping=expected.locator('..').locator('.gherkin-step-parameter-map');await expect(mapping).toBeVisible();
  const save=dialog.getByRole('button',{name:'Save section',exact:true});await save.scrollIntoViewIfNeeded();
  const before=await save.boundingBox();assert.ok(before);
  await page.mouse.move(before.x+before.width/2,before.y+before.height/2);await page.mouse.down();
  const during=await save.boundingBox();assert.ok(during);assert.equal(await page.evaluate(()=>window.sectionSaves.length),0,'Pointer press only preserves focus; it cannot issue a save mutation');
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>window.sectionSaves.length),{timeout:1500}).toBe(1);
  assert.ok(Math.abs(during.y-before.y)<1,'The Save target stays in place until the semantic click');
  const first=await page.evaluate(()=>window.sectionSaves[0]);assert.equal(first.action,'Latest action @r.employee_first_name');assert.equal(first.expected_result,latest);assert.equal(first.automation_code,source);
  await expect(save).toBeEnabled();
  const input=dialog.getByRole('combobox',{name:'Step 1 expected result',exact:true});
  await input.fill('Keyboard outcome @r.employee_first_name');await save.focus();await page.keyboard.press('Enter');
  await expect.poll(()=>page.evaluate(()=>window.sectionSaves.length),{timeout:1500}).toBe(2);
  const second=await page.evaluate(()=>window.sectionSaves[1]);assert.equal(second.expected_result,'Keyboard outcome @r.employee_first_name');assert.equal(second.action,'Latest action @r.employee_first_name');assert.equal(second.automation_code,source);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await vite?.close();await Promise.all(['tsx','html'].map(extension=>rm(new URL(name+'.'+extension,frontendRoot),{force:true})));}
});
