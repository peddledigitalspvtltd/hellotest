import test from 'node:test';import assert from 'node:assert/strict';import {readFile,writeFile,rm} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {runInNewContext} from 'node:vm';import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));const {chromium}=require('playwright');const {expect}=require('playwright/test');const root=new URL('../../../platform/frontend/',import.meta.url);
test('the Engineer restores one simplified workspace with honest partial status and no diagnostic disclosures',{timeout:90000},async()=>{
 const template=await readFile(new URL('../../../testing/test/browser/testCaseDataSets.test.mjs',import.meta.url),'utf8');let fixture=runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
 fixture=fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';","import {AutomationAgentActivity} from '/services/automation/frontend/components/AutomationAgentActivity';import {traceApi} from '/services/trace/frontend/api.client';import '/src/product-experience.css';").replace('element:<TestCasesPage/>','element:<AutomationAgentActivity projectId="p" appTypeId="a" caseId="case1"/>');
 fixture=fixture.replace('const client=new QueryClient',`window.currentActivity={id:'agent-build',project_id:'p',app_type_id:'a',category:'automation_build',status:'running',description:'Developing the complete checkout case.',metadata:{agent_activity:true,total_items:2,generated:0,input_test_case_ids:['case1','case2'],phase_message:'Attempt 2: completing section two.'},events:[{id:'event1',level:'info',phase:'automation.agent.attempt',message:'Generating instructions: attempt 2 of 3, 1 section remaining.',details:{attempt:2,test_case_id:'case1'},created_at:'2026-10-15T10:00:00Z'},{id:'event2',level:'info',phase:'automation.agent.section.ready',message:'Validated instructions for section 1: Open checkout.',details:{step_id:'one',test_case_id:'case1'},created_at:'2026-10-15T10:00:01Z'}]};
 window.traceDetails=[];traceApi.llmTraces.list=async()=>({items:[{id:'call2',effective_model:'Model two',feature:'automation-engineer',attempt:2,status:'succeeded',http_status:200},{id:'call1',effective_model:'Model one',feature:'automation-engineer',attempt:1,status:'failed',http_status:422}],next_cursor:null});traceApi.llmTraces.detail=async(project,id)=>{window.traceDetails.push(id);return {id,status:id==='call1'?'failed':'succeeded',http_status:id==='call1'?422:200,content_access:true,capture:{redacted:true},request_payload:{messages:[{role:'user',content:'Build checkout with scoped evidence'}]},response_payload:id==='call1'?{error:'Published prompt configuration is incomplete'}:{choices:[{message:{content:'Validated checkout sections'}}]}}};
 window.currentActivity=JSON.parse(globalThis.sessionStorage.getItem('activity-server-fixture')||'null')||window.currentActivity;
 api.testCases.automationAgentActivity=async()=>structuredClone(window.currentActivity);api.testCases.automationBuildStatus=async()=>structuredClone(window.currentActivity);
 api.testCases.automationAgentActivities=async()=>({items:[{...structuredClone(window.currentActivity),status:'running'}],next_cursor:null});
 api.testCases.automationAgentPreview=async()=>({schema_version:1,kind:'section_preview',test_case_id:'case1',step_id:'api-step',step_type:'api',api_request:{method:'GET',url:'/orders',validations:[{kind:'status',expected:'200'}]}});
 api.testCases.automationAgentScreenshot=async()=>({data_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKD8AAAAASUVORK5CYII='});
 const client=new QueryClient`);
 const name='automation-agent-activity-'+randomUUID();let browser;
 try{await writeFile(new URL(name+'.tsx',root),fixture);await writeFile(new URL(name+'.html',root),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(url.pathname.endsWith('/test-cases/automation/jobs/agent-build/events')){const activity=await page.evaluate(()=>window.currentActivity);return route.fulfill({status:200,contentType:'text/event-stream',body:'event: activity\nid: 0\ndata: '+JSON.stringify({...activity,events_next_offset:0})+'\n\nevent: complete\ndata: {}\n\n'});}if(url.pathname.endsWith('/test-cases/automation/jobs/agent-build'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(await page.evaluate(()=>window.currentActivity))});errors.push('Unexpected API '+url);return route.abort();});
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`);
  const activity=page.locator('.automation-agent-activity');await expect(activity).toHaveCount(1);await expect(activity.getByRole('region',{name:'Automation Build Agent workspace',exact:true})).toBeVisible();assert.equal(await page.locator('a[href="/testops"]').count(),0);
  assert.equal(await activity.locator('.automation-agent-activity-overview,.automation-agent-activity-phase,.automation-agent-activity-events,.automation-agent-activity-cases,.automation-agent-model-calls').count(),0);
  await expect(activity.getByText('Attempt 2: completing section two.',{exact:true})).toBeVisible();
  assert.equal(await activity.getByText('Activity log',{exact:true}).count(),0);
  assert.equal(await activity.getByText('Case outcomes',{exact:true}).count(),0);
  await expect(activity.getByRole('tab',{name:'Model request',exact:true})).toBeVisible();
  await expect(activity.getByRole('tab',{name:'Model response',exact:true})).toBeVisible();
  await page.evaluate(()=>{const record=window.currentActivity;record.status='completed';Object.assign(record.metadata,{outcome_status:'partial',generated:1,failed:1,output_test_case_ids:['case1'],retry_test_case_ids:['case2'],phase_message:'One case generated; one case remains incomplete.',case_outcomes:[{test_case_id:'case1',title:'Checkout',status:'generated',generated_step_count:2,completion_attempts:2},{test_case_id:'case2',title:'Orders',status:'incomplete',completed_sections:1,total_sections:2,message:'Completion attempts exhausted.'}]});record.events.push({id:'event3',level:'warning',phase:'automation.agent.finished',message:'Generated instructions require a test run for verification.',details:{}});globalThis.sessionStorage.setItem('activity-server-fixture',JSON.stringify(record));});
  await expect(activity.locator('.automation-agent-activity-status')).toHaveText('Partially generated');
  await expect(page.getByRole('combobox',{name:'Activity history',exact:true}).locator('option:checked')).toHaveText(/completed$/);
  assert.equal(await activity.locator('table,.automation-agent-activity-events,.automation-agent-model-calls').count(),0);
  assert.deepEqual(await page.evaluate(()=>window.traceDetails),[],'Model payloads remain lazy until their dedicated tab is selected');
  await page.setViewportSize({width:390,height:844});assert.ok(await activity.evaluate(element=>element.scrollWidth<=element.clientWidth+1),'activity fits narrow screens');await page.screenshot({path:'/tmp/qaira-agent-activity-mobile.png',fullPage:true});
  await page.reload();await expect(page.locator('.automation-agent-activity')).toHaveCount(1);await expect(page.locator('.automation-agent-activity').locator('.automation-agent-activity-status')).toHaveText('Partially generated');await expect(page.getByRole('region',{name:'Automation Build Agent workspace',exact:true})).toBeVisible();
  await page.evaluate(()=>Object.assign(window.currentActivity.metadata, {
    step_progress:[
      {test_case_id:'case1',step_id:'web-step',step_order:1,step_type:'web',action:'Open the storefront',status:'completed',instruction_status:'saved'},
      {test_case_id:'case1',step_id:'api-step',step_order:2,step_type:'api',action:'Fetch saved orders',status:'completed',instruction_status:'saved',preview_artifact_id:'api-preview'}
    ],
    workspace_application:{test_case_id:'case1',active_step_id:'web-step',url:'https://fixture.example.test/',screenshot_artifact_id:'storefront-capture'}
  }));
  await activity.getByRole('button',{name:'Refresh activity',exact:true}).click();
  await activity.getByRole('button',{name:/Open the storefront/}).click();
  await expect(activity.getByAltText(/Captured application for Checkout/)).toBeVisible();
  await activity.getByRole('tab',{name:'Browser activity',exact:true}).click();
  await activity.getByRole('button',{name:/Fetch saved orders/}).click();
  const api = activity.getByRole('region',{name:'API evidence',exact:true});
  await expect(api).toContainText('/orders');
  await expect(api).toContainText('Generated request · Not run');
  assert.equal(await activity.getByRole('region',{name:'Application evidence',exact:true}).count(),0);
  await activity.getByRole('tab',{name:'Request JSON',exact:true}).click();
  await expect(activity.getByRole('tabpanel',{name:'Request JSON',exact:true})).toContainText('"url": "/orders"');
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all([rm(new URL(name+'.tsx',root),{force:true}),rm(new URL(name+'.html',root),{force:true})]);}
});
