import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright'),expect=require('playwright/test').expect.configure({timeout:15000});
const root=new URL('../../../platform/frontend/',import.meta.url);
const source=await readFile(new URL('../../../testing/test/browser/testCaseDataSets.test.mjs',import.meta.url),'utf8');
let fixture=runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
fixture=fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';","import {AutomationPage} from '/services/automation/frontend/pages/AutomationPage';import {automationApi} from '/services/automation/frontend/api.client';");
fixture=fixture.replace('element:<TestCasesPage/>','element:<AutomationPage/>').replaceAll('/test-cases?case=case1','/automation?case=case1').replace("path:'/test-cases'","path:'/automation'");
fixture=fixture.replace('const client=new QueryClient',`item.automated='yes';item.automation_status='ready';item.automation_start_url='https://fixture.test';item.suite_ids=['suite-a','suite-b'];item.parameter_values={'t.user':'saved-user'};item.test_data_set_ids=[];item.test_data_sets=[];
const other={...item,id:'case2',display_id:'TC-2',title:'Another automation case',parameter_values:{'t.user':'other-user'}};
steps.splice(0,steps.length,{...steps[0],action:'Sign in @t.user',automation_code:'await page.locator("#user").fill(params["t.user"]);'});
window.recorderCalls={starts:[],finishes:[]};window.recording=false;
automationApi.authoringState=async id=>({case_id:id,state:id==='case1'&&window.recording?'recording':'idle',build:null,recording:id==='case1'&&window.recording?{activity_id:'capture',status:'running'}:null,can_build:!window.recording,can_record:!window.recording});
api.testCases.list=async()=>[item,other];api.testCases.get=async id=>id==='case2'?other:item;
api.testSteps.list=async({test_case_id})=>steps.map(step=>({...step,test_case_id}));
api.testSuites.list=async()=>[{id:'suite-a',app_type_id:'a',name:'Suite A',parameter_values:{'s.region':'A'}},{id:'suite-b',app_type_id:'a',name:'Suite B',parameter_values:{'s.region':'B'}}];
api.testCases.list=async()=>[item,other];api.testCases.get=async id=>id==='case2'?other:item;api.testCases.update=async(id,input)=>{Object.assign(item,input);return{...item,revision:++item.revision};};
api.testCases.startRecorderSession=async(id,input)=>{window.recorderCalls.starts.push({id,input});window.recording=true;return{id:'capture',test_case_id:id,status:'running',recorder_mode:'remote',actions:[],network:[],transaction_id:'capture-activity'};};
api.testCases.finishRecorderSession=async(id,sessionId,input)=>{window.recorderCalls.finishes.push({id,sessionId,input});window.recording=false;return{test_case_id:id,generated_step_count:0,learned_locator_count:0,warnings:[]};};
const client=new QueryClient`);
fixture=fixture.replace("path:'/test-cases',element:<TestCasesPage/>","path:'/automation',element:<AutomationPage/>").replace("initialEntries:['/test-cases?case=case1']","initialEntries:['/automation?case=case1']");
fixture=fixture.replace("createRoot(document.getElementById('root'))","window.navigateFixture=path=>router.navigate(path);createRoot(document.getElementById('root'))");

test('the actual lazy route host preserves recording suite and dirty parameters and isolates another case',{timeout:180000},async()=>{
 const name='recording-routes-'+randomUUID(),errors=[];let browser;
 try{
  await writeFile(new URL(name+'.tsx',root),fixture);await writeFile(new URL(name+'.html',root),`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{errors.push('Unexpected API request '+route.request().url());return route.abort();});
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`,{timeout:60000});
  await page.getByRole('button',{name:'Parameters',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Automation case parameter values'});await dialog.getByRole('button',{name:'Suite B',exact:true}).click();await dialog.getByRole('button',{name:'Close Automation case parameter values',exact:true}).click();
  await page.getByRole('tab',{name:/^Build/}).click();await page.getByRole('button',{name:/^Record & playback/}).click();await page.getByRole('button',{name:'Remote browser',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save recording to plan',exact:true})).toBeVisible();
  assert.equal((await page.evaluate(()=>window.recorderCalls.starts))[0].input.test_suite_id,'suite-b');
  await page.evaluate(()=>window.navigateFixture('/automation?case=TC-1&tab=build&build_method=record'));
  await expect(page.getByRole('button',{name:'Save recording to plan',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Return to recording',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Manage recording parameters',exact:true}).click();dialog=page.getByRole('dialog',{name:'Automation case parameter values'});await dialog.getByPlaceholder('Value for @t.user',{exact:true}).fill('unsaved-recording-user');await dialog.getByRole('button',{name:'Close Automation case parameter values',exact:true}).click();
  // Reuse the same Detail component across a direct case change before testing
  // the complete Cases unmount/remount route boundary.
  await page.evaluate(()=>window.navigateFixture('/automation?case=case2&tab=build&build_method=record'));
  await expect(page.getByRole('button',{name:'Remote browser',exact:true})).toBeDisabled();
  assert.equal(await page.getByRole('button',{name:'Save recording to plan',exact:true}).count(),0);
  await page.getByRole('link',{name:'Return to recording',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save recording to plan',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Manage recording parameters',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Automation case parameter values'});
  await expect(dialog.getByRole('button',{name:'Suite B',exact:true})).toHaveClass(/is-selected/);
  await expect(dialog.getByPlaceholder('Value for @t.user',{exact:true})).toHaveValue('unsaved-recording-user');
  await dialog.getByRole('button',{name:'Close Automation case parameter values',exact:true}).click();
  await page.getByRole('button',{name:'Back to automation case tiles',exact:true}).click();await expect(page.getByRole('link',{name:'Return to recording',exact:true})).toBeVisible();
  await page.evaluate(()=>window.navigateFixture('/automation?case=case2&tab=build&build_method=record'));await expect(page.getByRole('button',{name:'Remote browser',exact:true})).toBeDisabled();assert.equal(await page.getByRole('button',{name:'Save recording to plan',exact:true}).count(),0);
  await page.getByRole('link',{name:'Return to recording',exact:true}).click();await expect(page.getByRole('button',{name:'Save recording to plan',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Manage recording parameters',exact:true}).click();dialog=page.getByRole('dialog',{name:'Automation case parameter values'});await expect(dialog.getByRole('button',{name:'Suite B',exact:true})).toHaveClass(/is-selected/);await expect(dialog.getByPlaceholder('Value for @t.user',{exact:true})).toHaveValue('unsaved-recording-user');await dialog.getByRole('button',{name:'Close Automation case parameter values',exact:true}).click();
  await page.getByRole('button',{name:'Save recording to plan',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.recorderCalls.finishes.length)).toBe(1);assert.equal((await page.evaluate(()=>window.recorderCalls.finishes))[0].id,'case1');assert.deepEqual(errors,[]);
 }catch(error){error.message+='\nBrowser errors: '+JSON.stringify(errors);throw error;}
 finally{await browser?.close();await Promise.all([rm(new URL(name+'.tsx',root),{force:true}),rm(new URL(name+'.html',root),{force:true})]);}
});
