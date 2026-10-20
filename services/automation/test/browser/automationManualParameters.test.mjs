import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const expect=require('playwright/test').expect.configure({timeout:15000});
const root=new URL('../../../platform/frontend/',import.meta.url);

test('linked manual defaults stay live, explicit automation edits persist independently, and idle coverage shows the first source step', {timeout:90000}, async()=>{
 const template=await readFile(new URL('../../../testing/test/browser/testCaseDataSets.test.mjs',import.meta.url),'utf8');
 let fixture=runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
 fixture=fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';","import {AutomationPage} from '/services/automation/frontend/pages/AutomationPage';import '/src/product-experience.css';")
  .replace('element:<TestCasesPage/>','element:<AutomationPage/>');
 fixture=fixture.replace('const client=new QueryClient',`
 const manual={...item,id:'manual1',display_id:'TC_12',title:'Manual checkout',automated:'no',test_data_set_ids:[],test_data_sets:[],parameter_values:{'t.account':'Manual Alice','t.defaultOnly':'Manual default','t.blank':'Manual nonempty','t.shipping_address':'12 Example Street'}};
 item={...item,display_id:'AT_12',title:'Automation checkout',automated:'yes',automation_status:'ready',manual_test_case_id:'manual1',manual_test_case_ids:['manual1'],test_data_set_ids:[],test_data_sets:[],parameter_values:{'t.blank':''}};
 steps[0]={...steps[0],action:'Enter @t.account',expected_result:'Account accepted',automation_code:'await page.getByLabel("Account").fill(params["t.account"]);'};
 const manualSteps=[{id:'m1',test_case_id:'manual1',step_order:1,step_type:'web',action:'Enter @t.account',expected_result:'Account accepted'},{id:'m2',test_case_id:'manual1',step_order:2,step_type:'web',action:'Submit purchase',expected_result:'Order created'},{id:'m3',test_case_id:'manual1',step_order:3,step_type:'web',action:'Verify receipt for @t.shipping_address',expected_result:'Receipt number visible'}];
 const inheritedData={id:'manual-data',project_id:'p',app_type_id:'a',name:'Manual data',mode:'table',columns:['r.email'],rows:[{'r.email':'dataset.inherited@example.test'}]};
 const project=()=>({...item,effective_test_data_set_ids:['manual-data'],inherited_parameter_values:{...manual.parameter_values},effective_parameter_values:{...manual.parameter_values,...item.parameter_values},parameter_sources:Object.fromEntries(Object.keys(manual.parameter_values).map(name=>[name,{kind:Object.hasOwn(item.parameter_values,name)?'automation':'linked_manual',test_case_id:Object.hasOwn(item.parameter_values,name)?item.id:manual.id,display_id:'TC_12'}]))});
 api.testCases.list=async()=>[item,manual];api.testCases.listPage=async()=>({items:[item,manual],is_last:true,next_cursor:null});
 api.testCases.get=async id=>structuredClone(id==='manual1'?manual:project());api.testSteps.list=async input=>structuredClone(input.test_case_id==='manual1'?manualSteps:steps);
 api.testCases.update=async(id,input)=>{window.updates.push(input);item={...item,...input,revision:item.revision+1};return project();};
 api.testCases.automationAgentActivity=async()=>null;api.testCases.automationAgentActivities=async()=>({items:[],next_cursor:null});
 api.testCases.metrics=async()=>({catalog:{total:1}});api.testDataSets.list=async()=>[inheritedData];
 window.setManualDefault=value=>{manual.parameter_values['t.account']=value;return client.invalidateQueries({queryKey:['test-case-detail']});};
 const client=new QueryClient`);
 const name='automation-manual-params-'+randomUUID();let browser,page;
 try{
  await writeFile(new URL(name+'.tsx',root),fixture);
  await writeFile(new URL(name+'.html',root),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  page=await browser.newPage({viewport:{width:1440,height:1050}});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>{errors.push('Unexpected API: '+route.request().url());return route.abort();});
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`);
  const openParameters=async()=>{await page.getByRole('tab',{name:/^Plan/}).click();await page.getByRole('button',{name:'Parameters',exact:true}).click();return page.getByRole('dialog',{name:'Automation case parameter values'});};
  let dialog=await openParameters();
  const row=(dialog,name)=>dialog.locator('.step-parameter-row').filter({has:page.locator('code').filter({hasText:new RegExp('^@'+name.replace('.','\\.')+'$')})});
  await expect(row(dialog,'t.account').locator('textarea').first()).toHaveValue('Manual Alice');
  await expect(row(dialog,'t.account')).toContainText('Inherited from Manual case TC_12');
  await expect(row(dialog,'t.blank').locator('textarea').first()).toHaveValue('');
  await row(dialog,'t.account').locator('textarea').first().fill('Automation Bob');await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:/^Details/}).click();await page.getByRole('button',{name:'Save details',exact:true}).click();
  await page.waitForFunction(()=>window.updates.some(input=>input.parameter_values?.['t.account']==='Automation Bob'));
  let saved=await page.evaluate(()=>window.updates.at(-1).parameter_values);assert.equal(saved['t.account'],'Automation Bob');assert.equal(saved['t.blank'],'');assert.equal(Object.hasOwn(saved,'t.defaultOnly'),false);assert.deepEqual(await page.evaluate(()=>window.updates.at(-1).test_data_set_ids),[],'the inherited dataset is never copied into an own relationship');
  dialog=await openParameters();await row(dialog,'t.account').getByRole('button',{name:'Reset to Manual case value',exact:true}).click();await expect(row(dialog,'t.account').locator('textarea').first()).toHaveValue('Manual Alice');await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:/^Details/}).click();await page.getByRole('button',{name:'Save details',exact:true}).click();
  await page.waitForFunction(()=>window.updates.length>=2);saved=await page.evaluate(()=>window.updates.at(-1).parameter_values);assert.equal(Object.hasOwn(saved,'t.account'),false);assert.equal(saved['t.blank'],'');
  await page.evaluate(()=>window.setManualDefault('Manual Alice updated'));dialog=await openParameters();await expect(row(dialog,'t.account').locator('textarea').first()).toHaveValue('Manual Alice updated');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Full source',exact:true}).click();await expect(page.getByRole('dialog',{name:/automation code$/}).locator('pre')).toContainText('Manual Alice updated');await expect(page.getByRole('dialog',{name:/automation code$/}).locator('pre')).toContainText('dataset.inherited@example.test');await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:/^Build tools/}).click();const coverage=page.getByRole('list',{name:'Manual steps to automate'});await expect(coverage.locator(':scope > li')).toHaveCount(3);await expect(coverage.getByRole('button').first()).toBeEnabled();for(const button of (await coverage.getByRole('button').all()).slice(1))await expect(button).toBeDisabled();await expect(coverage.locator('[data-agent-queued="true"]')).toHaveCount(2);
  await expect(coverage).toContainText('Enter Manual Alice updated');assert.doesNotMatch(await coverage.innerText(),/Receipt number visible|12 Example Street|Submit purchase/);
  const brief=await page.locator('.automation-engineer-brief').boundingBox(),engineer=await page.getByRole('region',{name:'Automation engineer activity',exact:true}).boundingBox();assert.ok(brief.y<engineer.y,'brief stays above the Engineer workspace');
  assert.equal(await page.getByText('Activity log',{exact:true}).count(),0);assert.equal(await page.getByText('Case outcomes',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
 }catch(error){throw new Error(`${error.message}\n${await page?.locator('body').innerText().catch(()=> '')}`,{cause:error});}
 finally{await browser?.close();await Promise.all([rm(new URL(name+'.tsx',root),{force:true}),rm(new URL(name+'.html',root),{force:true})]);}
});
