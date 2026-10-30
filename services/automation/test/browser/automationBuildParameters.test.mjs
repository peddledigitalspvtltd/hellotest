import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const expect=require('playwright/test').expect.configure({timeout:15000});
const root=new URL('../../../platform/frontend/',import.meta.url);

test('build data review keeps inherited defaults, accepts deliberate blanks, protects private bindings and queues only reviewed scoped changes', {timeout:180000}, async()=>{
 const template=await readFile(new URL('../../../testing/test/browser/testCaseDataSets.test.mjs',import.meta.url),'utf8');
 let fixture=runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
 fixture=fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';","import {AutomationPage} from '/services/automation/frontend/pages/AutomationPage';import '/src/product-experience.css';")
  .replace("{path:'/test-cases',element:<TestCasesPage/>}","{path:'/automation',element:<AutomationPage/>}")
  .replace("initialEntries:['/test-cases?case=case1']","initialEntries:[new URLSearchParams(location.search).has('create')?'/automation?create=1&manual=manual1':new URLSearchParams(location.search).has('batch')?'/automation':'/automation?case=case1']");
 fixture=fixture.replace('const client=new QueryClient',`
 const manual={...item,id:'manual1',display_id:'TC_12',title:'Manual registration',automated:'no',test_data_set_ids:[],test_data_sets:[],parameter_values:{'t.account':'Manual Alice','t.defaultOnly':'Inherited only'}};
 item={...item,display_id:'AT_12',title:'Automation registration',automated:'yes',automation_status:'incomplete',automation_start_url:'https://fixture.example.test/start',manual_test_case_id:'manual1',manual_test_case_ids:['manual1'],test_data_set_ids:[],test_data_sets:[],parameter_values:{},inherited_parameter_values:{...manual.parameter_values}};
 steps.splice(0,steps.length,{id:'s1',test_case_id:'case1',step_order:1,step_type:'web',action:'Enter @r.name and @r.email',expected_result:'Configured account is displayed',automation_code:'',api_request:null});
 const manualSteps=steps.map(step=>({...step,id:'manual-s1',test_case_id:'manual1'}));const other={...item,id:'case2',display_id:'AT_14',title:'Second registration',manual_test_case_id:null,manual_test_case_ids:[]};let created=null;
 window.builds=[];window.creates=[];window.planReads=[];
 api.testCases.list=async()=>[item,other,manual,...(created?[created]:[])];api.testCases.listPage=async()=>({items:await api.testCases.list(),is_last:true,next_cursor:null});
 api.testCases.get=async id=>structuredClone(id==='manual1'?manual:id==='created1'?created:id==='case2'?other:item);
 api.testSteps.list=async input=>structuredClone(input.test_case_id==='manual1'?manualSteps:input.test_case_id==='created1'?created.steps:input.test_case_id==='case2'?steps.map(step=>({...step,id:'other-s1',test_case_id:'case2'})):steps);
 api.testCases.create=async input=>{window.creates.push(input);created={...item,...input,id:'created1',display_id:'AT_13',inherited_parameter_values:{...manual.parameter_values},parameter_values:{},revision:1};created.steps=input.steps.map((step,index)=>({...step,id:'created-step-'+index,test_case_id:'created1'}));return{id:'created1'};};
 api.testCases.automationParameterPlan=async(id,input)=>{window.planReads.push({id,input});const empty=new URLSearchParams(location.search).has('empty'),complete=empty||new URLSearchParams(location.search).has('complete');return{
  test_case_id:id,parameter_plan_key:'reviewed:'+id,parameter_values:{'t.account':'Manual Alice','t.defaultonly':'Inherited only','r.literal':'exact @r.name literal','s.region':'West',...(complete?{'r.name':'Configured name','r.email':empty?'':'configured@example.test'}:{})},
  parameter_references:['t.account','t.defaultonly','s.region','r.literal','r.name','r.email','r.password','r.credential','r.opaque_input','r.generator'],private_parameter_references:['r.credential','r.opaque_input',...(complete?['r.password']:[])],deferred_parameter_references:['r.generator'],missing_parameter_references:complete?[]:['r.name','r.email','r.password'],empty_parameter_references:empty?['r.email','r.password','r.opaque_input']:[]};};
 api.testCases.buildAutomationBatch=async input=>{window.builds.push(input);if(window.rejectNextBuild)throw new Error('The build queue is unavailable. Retry this saved case.');return{transaction_id:'queued-fixture'};};
 api.testCases.automationAgentActivity=async()=>null;api.testCases.automationAgentActivities=async()=>({items:[],next_cursor:null});
 api.testCases.automationBuildStatus=async()=>({id:'queued-fixture',project_id:'p',app_type_id:'a',status:'completed',metadata:{input_test_case_ids:['case1'],generated:0},events:[]});
 api.testCases.metrics=async()=>({catalog:{total:1}});api.testDataSets.list=async()=>[];
 const client=new QueryClient`);
 const name='automation-build-data-'+randomUUID();let browser,page;let phase='initial review';
 try{
  await writeFile(new URL(name+'.tsx',root),fixture);
  await writeFile(new URL(name+'.html',root),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
  page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultNavigationTimeout(60000);page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{errors.push('Unexpected API: '+route.request().url());return route.abort();});
  const url=`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`;
  const start=async query=>{await page.goto(url+(query||''));await page.getByRole('tab',{name:/^Build tools/}).click();await page.getByRole('button',{name:'Build plan',exact:true}).click();};
  const dialog=()=>page.getByRole('dialog',{name:'Review automation test data',exact:true});
  const row=(name)=>dialog().locator('.step-parameter-row').filter({has:page.locator('code').filter({hasText:new RegExp('^@'+name.replace('.','\\.')+'$')})});
  await start();await expect(dialog()).toBeVisible();
  await expect(page.locator('.automation-engineer-brief')).not.toHaveAttribute('open', '');
  await expect(row('t.account').locator('textarea')).toHaveValue('Manual Alice');await expect(row('r.literal').locator('textarea')).toHaveValue('exact @r.name literal');
  await expect(row('r.credential').locator('input[type="password"]')).toBeEnabled();await expect(row('r.credential').locator('input[type="password"]')).toHaveValue('');await expect(row('r.generator').locator('textarea')).toBeDisabled();
  await expect(row('r.password').locator('input[type="password"]')).toBeEnabled();
  assert.equal(await page.evaluate(()=>window.builds.length),0);
  await row('t.account').locator('textarea').fill('');await row('r.name').locator('textarea').fill('  Reviewed Name  ');await row('r.password').locator('input').fill('local-private-value');
  await expect(dialog()).not.toContainText('local-private-value');
  await page.setViewportSize({width:390,height:844});assert.ok(await dialog().evaluate(element=>element.scrollWidth<=element.clientWidth+1));
  await mkdir('/tmp/qaira-build-parameters',{recursive:true});await dialog().screenshot({path:'/tmp/qaira-build-parameters/review-mobile.png'});await page.setViewportSize({width:1440,height:1050});
  await dialog().getByRole('button',{name:'Continue with 1 blank value',exact:true}).click();
  await page.waitForFunction(()=>window.builds.length===1);
  let request=await page.evaluate(()=>window.builds[0]);assert.deepEqual(request.parameter_values_by_case,{case1:{'t.account':'','r.name':'  Reviewed Name  ','r.email':'','r.password':'local-private-value'}});
  assert.deepEqual(request.parameter_plan_keys_by_case,{case1:'reviewed:case1'});assert.equal(await page.evaluate(()=>window.updates.length),0,'review never saves inherited/default/private values through case update');
  await start();await expect(dialog()).toBeVisible();await dialog().getByRole('button',{name:'Cancel build',exact:true}).click();await expect(dialog()).toBeHidden();
  await expect(page.locator('.automation-engineer-brief')).toHaveAttribute('open', '');
  assert.equal(await page.evaluate(()=>window.builds.length),0);await expect(page.getByRole('button',{name:'Build plan',exact:true})).toBeEnabled();
  await start('?complete=1');await page.waitForFunction(()=>window.builds.length===1);assert.equal(await dialog().count(),0);
  await expect(page.locator('.automation-engineer-brief')).not.toHaveAttribute('open', '');
  await page.locator('.automation-engineer-brief > summary').click();
  await expect(page.locator('.automation-engineer-brief')).toHaveAttribute('open', '');
  request=await page.evaluate(()=>window.builds[0]);assert.deepEqual(request.parameter_values_by_case,{});assert.deepEqual(request.parameter_plan_keys_by_case,{case1:'reviewed:case1'});
  await page.goto(url+'?complete=1');await page.getByRole('tab',{name:/^Build tools/}).click();const explicitReview=page.getByRole('button',{name:'Review data & build',exact:true});await explicitReview.click();
  await expect(dialog()).toBeVisible();await expect(row('r.name').locator('textarea')).toHaveValue('Configured name');await expect(row('r.password').locator('input[type="password"]')).toBeEnabled();await expect(row('r.password').locator('input[type="password"]')).toHaveValue('');assert.equal(await page.evaluate(()=>window.builds.length),0);
  await row('r.name').locator('textarea').fill('Cancelled change');await dialog().getByRole('button',{name:'Cancel build',exact:true}).click();assert.equal(await page.evaluate(()=>window.builds.length),0);
  await explicitReview.click();await row('r.name').locator('textarea').fill('Automation name');await row('s.region').locator('textarea').fill('South');
  await row('r.credential').locator('input[type="password"]').fill('discarded-private-replacement');await row('r.credential').getByRole('button',{name:'Restore configured value',exact:true}).click();await expect(row('r.credential').locator('input[type="password"]')).toHaveValue('');
  await row('r.password').locator('input[type="password"]').fill('replacement-private-value');await expect(dialog()).not.toContainText('replacement-private-value');await row('r.opaque_input').getByRole('button',{name:'Use empty value',exact:true}).click();
  await dialog().getByRole('button',{name:'Continue build',exact:true}).click();await page.waitForFunction(()=>window.builds.length===1);
  request=await page.evaluate(()=>window.builds[0]);assert.deepEqual(request.parameter_values_by_case,{case1:{'r.name':'Automation name','s.region':'South','r.password':'replacement-private-value','r.opaque_input':''}});assert.equal(Object.hasOwn(request.parameter_values_by_case.case1,'r.credential'),false,'reset private input retains the configured value without copying it');assert.deepEqual(request.parameter_plan_keys_by_case,{case1:'reviewed:case1'});assert.equal(await page.evaluate(()=>window.updates.length),0);
  await start('?empty=1');await expect(dialog()).toBeVisible();await expect(row('r.email').locator('textarea')).toHaveValue('');await expect(row('r.password').locator('input[type="password"]')).toBeEnabled();
  await expect(row('r.password')).toContainText('The configured value is empty');await row('r.password').locator('input').fill('new-private-value');await expect(row('r.opaque_input').locator('input[type="password"]')).toBeEnabled();await row('r.opaque_input').locator('input').fill('another-private-value');await expect(dialog()).not.toContainText('another-private-value');await dialog().getByRole('button',{name:'Continue with 1 blank value',exact:true}).click();await page.waitForFunction(()=>window.builds.length===1);
  request=await page.evaluate(()=>window.builds[0]);assert.deepEqual(request.parameter_values_by_case,{case1:{'r.email':'','r.password':'new-private-value','r.opaque_input':'another-private-value'}});assert.equal(Object.hasOwn(request.parameter_values_by_case.case1,'r.credential'),false);
  phase='queue failure';await page.goto(url+'?complete=1');await page.getByRole('tab',{name:/^Build tools/}).click();await page.evaluate(()=>window.rejectNextBuild=true);await page.getByRole('button',{name:'Build plan',exact:true}).click();
  await expect(page.locator('.automation-engineer-brief')).toHaveAttribute('open','');await expect(page.locator('.automation-engineer-brief').getByRole('alert')).toContainText('The build queue is unavailable. Retry this saved case.');
  phase='batch selection';await page.goto(url+'?batch=1');await page.getByRole('checkbox',{name:'Select Automation registration',exact:true}).check();await page.getByRole('checkbox',{name:'Select Second registration',exact:true}).check();
  await page.getByRole('button',{name:'Build with automation agent',exact:true}).click();const batch=page.getByRole('dialog',{name:'Build with automation agent',exact:true});await batch.getByLabel('Build start URL',{exact:true}).fill('https://fixture.example.test/start');
  phase='first batch case review';await batch.getByRole('button',{name:'Build selected cases',exact:true}).click();await expect(dialog()).toContainText('Automation registration');await row('r.name').locator('textarea').fill('First case');await dialog().getByRole('button',{name:'Continue with 2 blank values',exact:true}).click();
  phase='second batch case review';await expect(dialog()).toContainText('Second registration');assert.equal(await page.evaluate(()=>window.builds.length),0);await row('r.name').locator('textarea').fill('Second case');await dialog().getByRole('button',{name:'Continue with 2 blank values',exact:true}).click();await page.waitForFunction(()=>window.builds.length===1);
  request=await page.evaluate(()=>window.builds[0]);assert.deepEqual(request.parameter_values_by_case,{case1:{'r.name':'First case','r.email':'','r.password':''},case2:{'r.name':'Second case','r.email':'','r.password':''}});assert.deepEqual(request.parameter_plan_keys_by_case,{case1:'reviewed:case1',case2:'reviewed:case2'});
  await expect(batch).toBeHidden();await expect(page.locator('.automation-engineer-brief')).not.toHaveAttribute('open', '');
  phase='create and build';await page.goto(url+'?create=1');const create=page.getByRole('dialog',{name:'Create automation case',exact:true});await expect(create.getByRole('textbox',{name:'Automation case name',exact:true})).not.toHaveValue('');
  await create.getByLabel('Automation case type',{exact:true}).selectOption('web');await create.getByLabel('Automation case start URL',{exact:true}).fill('https://fixture.example.test/start');await create.getByRole('button',{name:'Create & build',exact:true}).click();
  await expect(dialog()).toBeVisible();assert.equal(await page.evaluate(()=>window.creates.length),1);assert.deepEqual(await page.evaluate(()=>window.creates[0].parameter_values),{});assert.deepEqual(await page.evaluate(()=>window.creates[0].manual_test_case_ids),['manual1']);
  await dialog().getByRole('button',{name:'Continue with 3 blank values',exact:true}).click();await page.waitForFunction(()=>window.builds.length===1);
  request=await page.evaluate(()=>window.builds[0]);assert.deepEqual(request.parameter_values_by_case,{created1:{'r.name':'','r.email':'','r.password':''}});assert.deepEqual(request.parameter_plan_keys_by_case,{created1:'reviewed:created1'});
  await expect(create).toBeHidden();await expect(page.locator('.automation-engineer-brief')).not.toHaveAttribute('open', '');
  assert.equal(await page.evaluate(()=>window.creates.length),1);assert.deepEqual(errors,[]);
 }catch(error){throw new Error(`${phase}: ${error.message}\n${await page?.locator('body').innerText().catch(()=> '')}`,{cause:error});}
 finally{await browser?.close();await Promise.all([rm(new URL(name+'.tsx',root),{force:true}),rm(new URL(name+'.html',root),{force:true})]);}
});
