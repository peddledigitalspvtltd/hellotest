import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const expect=require('playwright/test').expect.configure({timeout:12000});
const root=new URL('../../../platform/frontend/',import.meta.url);

test('binding hardcoded inputs keeps Instructions, Source, Gherkin and saved parameter privacy aligned',{timeout:120000},async()=>{
  const template=await readFile(new URL('../../../testing/test/browser/testCaseDataSets.test.mjs',import.meta.url),'utf8');
  let fixture=runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture=fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';","import {AutomationPage} from '/services/automation/frontend/pages/AutomationPage';")
    .replace('element:<TestCasesPage/>','element:<AutomationPage/>');
  const source='// Complete login sequence\nawait page.locator("#user").fill("Alice");\nawait page.locator("#submit").click();\nawait expect(page.locator("#user")).toHaveValue("Alice");';
  fixture=fixture.replace('const client=new QueryClient',`
    item={...item,title:'Login',automated:'yes',automation_case_type:'web',automation_status:'ready',test_data_set_ids:[],test_data_sets:[],parameter_values:{'r.account':'Alice','r.toggle_a':'ToggleValue','r.toggle_b':'ToggleValue'},test_data_options:{}};
    const key=location.pathname;
    const savedCase=localStorage.getItem(key+':case');if(savedCase)item={...item,...JSON.parse(savedCase)};
    steps.splice(0,steps.length,{id:'s1',test_case_id:'case1',step_order:1,step_type:'web',action:'Login flow',expected_result:'Account value is retained',automation_code:${JSON.stringify(source)},api_request:null});
    const savedStep=localStorage.getItem(key+':step');if(savedStep)Object.assign(steps[0],JSON.parse(savedStep));
    const project=()=>({...item,inherited_parameter_values:{'r.shared':'Inherited tenant'}});
    api.testCases.get=async()=>structuredClone(project());api.testCases.list=async()=>[project()];api.testCases.listPage=async()=>({items:[project()],is_last:true,next_cursor:null});
    api.testSteps.list=async()=>structuredClone(steps);
    api.testCases.update=async(id,input)=>{window.updates.push(input);item={...item,...input,revision:item.revision+1};localStorage.setItem(key+':case',JSON.stringify(item));return {updated:true,revision:item.revision};};
    window.stepUpdates=[];api.testSteps.update=async(id,input)=>{window.stepUpdates.push(input);Object.assign(steps[0],input);localStorage.setItem(key+':step',JSON.stringify(steps[0]));return structuredClone(steps[0]);};
    api.testCases.automationAgentActivity=async()=>null;api.testCases.automationAgentActivities=async()=>({items:[],next_cursor:null});
    api.testCases.metrics=async()=>({catalog:{total:1}});api.testDataSets.list=async()=>[];
    const client=new QueryClient`);
  const name='automation-bind-inputs-'+randomUUID();let browser,page;
  try{
    await writeFile(new URL(name+'.tsx',root),fixture);await writeFile(new URL(name+'.html',root),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>{errors.push('Unexpected API: '+route.request().url());return route.abort();});
    const url=(process.env.VITE_TEST_URL||'http://127.0.0.1:5199')+'/'+name+'.html';
    await page.goto(url);await page.getByRole('tab',{name:/^Plan/}).click();
    await page.getByRole('button',{name:'Bind parameters for section 1',exact:true}).click();
    const binding=page.getByRole('dialog',{name:'Bind instruction inputs to parameters',exact:true});
    await expect(binding.getByLabel('Parameter for input 1',{exact:true})).toHaveValue('@r.account');
    await expect(binding.getByLabel('Parameter for input 2',{exact:true})).toHaveValue('@r.account');
    await binding.getByRole('button',{name:'Apply parameter bindings',exact:true}).click();
    await page.getByRole('button',{name:'Save section',exact:true}).click();await page.waitForFunction(()=>window.stepUpdates.length===1);await page.keyboard.press('Escape');
    await page.getByRole('tab',{name:'Source',exact:true}).click();
    const displayed=await page.locator('.automation-source-section-code').innerText();
    assert.match(displayed,/fill\(params\["r.account"\]\)/);assert.match(displayed,/toHaveValue\(params\["r.account"\]\)/);assert.match(displayed,/#submit"\)\.click/);assert.match(displayed,/Complete login sequence/);assert.doesNotMatch(displayed,/"Alice"/);
    await page.getByRole('tab',{name:'Gherkin',exact:true}).click();await expect(page.locator('.gherkin-editor')).toContainText('Alice');
    await page.getByRole('tab',{name:'Instructions',exact:true}).click();
    assert.match(await page.evaluate(()=>window.stepUpdates[0].automation_code),/#submit"\)\.click/);
    await page.getByRole('button',{name:'Parameters',exact:true}).click();
    const params=page.getByRole('dialog',{name:'Automation case parameter values',exact:true});
    const row=name=>params.locator('.step-parameter-row').filter({has:page.locator('code').filter({hasText:name})});
    await params.getByLabel('Secret for @r.toggle_a',{exact:true}).check();
    await expect(params.getByLabel('Secret for @r.toggle_b',{exact:true})).toBeChecked();await expect(params.getByLabel('Secret for @r.toggle_b',{exact:true})).toBeDisabled();
    await params.getByLabel('Secret for @r.toggle_a',{exact:true}).uncheck();await expect(params.getByLabel('Secret for @r.toggle_b',{exact:true})).not.toBeChecked();
    await row('@r.account').locator('textarea').fill('Bob');await params.getByLabel('Secret for @r.account',{exact:true}).check();
    await expect(row('@r.account').locator('input[type=password]')).toHaveValue('');
    await params.getByLabel('Secret for @r.shared',{exact:true}).check();
    await page.setViewportSize({width:390,height:844});assert.ok(await params.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await mkdir('/tmp/qaira-followup-binding',{recursive:true});await params.screenshot({path:'/tmp/qaira-followup-binding/secret-mobile.png'});
    await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1050});
    await page.getByRole('tab',{name:/^Details/}).click();await page.getByRole('button',{name:'Save details',exact:true}).click();
    await page.waitForFunction(()=>window.updates.some(input=>input.test_data_options?.private_parameter_names?.includes('r.shared')));
    const saved=await page.evaluate(()=>window.updates.at(-1));assert.equal(saved.parameter_values['r.account'],'Bob');assert.ok(!Object.hasOwn(saved.parameter_values,'r.shared'));assert.ok(saved.test_data_options.private_parameter_names.includes('r.account'));
    await page.reload();await page.getByRole('tab',{name:/^Plan/}).click();await page.getByRole('button',{name:'Parameters',exact:true}).click();
    await expect(params.getByLabel('Secret for @r.account',{exact:true})).toBeChecked();await expect(params.getByLabel('Secret for @r.shared',{exact:true})).toBeChecked();assert.doesNotMatch(await params.innerText(),/Bob|Inherited tenant/);
    await page.keyboard.press('Escape');await page.getByRole('tab',{name:'Gherkin',exact:true}).click();assert.doesNotMatch(await page.locator('.gherkin-editor').innerText(),/Alice|Bob/);
    assert.deepEqual(errors,[]);
  }catch(error){throw new Error(error.message+'\n'+await page?.locator('body').innerText().catch(()=>''),{cause:error});}
  finally{await browser?.close();await Promise.all([rm(new URL(name+'.tsx',root),{force:true}),rm(new URL(name+'.html',root),{force:true})]);}
});
