import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const expect = require('playwright/test').expect.configure({timeout:15_000});
const root = new URL('../../../platform/frontend/', import.meta.url);

async function runFixture(mode, run) {
  const template = await readFile(new URL('../../../testing/test/browser/testCaseDataSets.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';", "import {AutomationAgentActivity} from '/services/automation/frontend/components/AutomationAgentActivity';import {traceApi} from '/services/trace/frontend/api.client';import '/src/product-experience.css';");
  fixture = fixture.replace('element:<TestCasesPage/>', `element:<AutomationAgentActivity projectId="p" appTypeId="a" caseId="${mode === 'manual' || mode.startsWith('sequence') ? 'manual-source' : 'at1'}" ${mode === 'pinned' ? 'transactionId="build-one"' : ''} caseTitle="Checkout journey" initialManualSteps={window.initialManualSteps || []} initialParameterValues={{'t.email':'saved.manual@example.test'}} onUpdate={value=>window.receipts.push(value.id)}/>`);
  fixture = fixture.replace('const client=new QueryClient', `
  session.user.role='member';session.user.project_permissions={p:['automation.view','automation.build','automation.ai','automation.code.view','ops.view',...(${mode !== 'sequence-denied'}?['data.view']:[])]};session.user.workspace_permissions=['workspace.view'];sessionStorage.write(session);
  const sequential=${mode.startsWith('sequence')},manual=${mode === 'manual' || mode.startsWith('sequence')};
  let sections=[{test_case_id:'at1',step_id:'one',step_order:1,step_type:'web',action:'Open checkout',expected_result:'Checkout is visible',status:'completed',instruction_status:'saved',preview_artifact_id:'preview-one'},{test_case_id:'at1',step_id:'two',step_order:2,step_type:'web',action:'Enter billing details',expected_result:'Billing details accepted',status:'queued',instruction_status:'requested'}];
  let manualRows=[{test_case_id:'at1',manual_step_id:'m1',manual_test_case_id:'manual-source',section_step_id:'one',step_order:1,action:'Open checkout',expected_result:'Checkout is visible',status:'completed',instruction_status:'saved'},{test_case_id:'at1',manual_step_id:'m2',manual_test_case_id:'manual-source',section_step_id:'two',step_order:2,action:'Enter billing details',expected_result:'Billing details accepted',status:'queued',instruction_status:'requested'},{test_case_id:'at1',manual_step_id:'m3',manual_test_case_id:'manual-source',step_order:3,action:'Verify confirmation',expected_result:'Order ID is displayed',status:'queued',instruction_status:'unmapped'}];
  if(sequential){sections=Array.from({length:8},(_,index)=>({test_case_id:'at1',step_id:index===0?'one':index===1?'two':'section-'+(index+1),step_order:index+1,step_type:'web',action:index===0?'Open checkout':'Complete checkout task '+(index+1),expected_result:'Checkout task '+(index+1)+' is ready',status:index===0?'in_progress':'queued',instruction_status:index===0?'requested':'pending'}));manualRows=sections.map((section,index)=>({test_case_id:'at1',manual_step_id:'m'+(index+1),manual_test_case_id:'manual-source',section_step_id:section.step_id,step_order:index+1,action:index===0?'Open checkout':index===1?'Enter @t.email':'Complete checkout task '+(index+1),expected_result:index===1?'@t.email is displayed':section.expected_result,status:section.status,instruction_status:section.instruction_status}));}
  window.initialManualSteps=manualRows.map(({manual_test_case_id,manual_step_id,step_order,action,expected_result,test_case_id,section_step_id})=>({manual_test_case_id,manual_step_id,manual_step_order:step_order,action,expected_result,test_case_id,section_step_id}));if(!manual && ${mode !== 'idle'})window.initialManualSteps=[];
  window.receipts=[];window.previewReads=[];window.evidenceReads=[];window.screenshotReads=[];window.activityReads=[];window.buildDataReads=[];window.fixtureApi=api;
  sections.forEach(row=>{if(row.instruction_status==='saved')row.development_status='completed'});manualRows.forEach(row=>{if(row.instruction_status==='saved')row.development_status='completed'});
  window.currentActivity={id:'build-one',project_id:'p',app_type_id:'a',status:'running',description:'Developing the checkout case with captured browser evidence.',metadata:{agent_activity:true,progression_policy:'performed_generated_saved',total_items:1,generated:0,phase_message:manual?'Developing billing details':'Planning the first generated section',step_progress:manual?sections:[],manual_step_progress:manual?sequential?manualRows:manualRows.slice(0,2):[],workspace_application:{test_case_id:'at1',...(sequential?{active_step_id:'one',active_manual_step_ids:['m1']}:{}),snapshot_artifact_id:'snapshot-latest',screenshot_artifact_id:'shot-latest',observed_at:'2026-10-17T10:00:03Z',url:'https://checkout.test/review?token=secret#private',title:'Latest checkout review',interaction_mode:'read_only',verification_status:'unverified'}},events:[]};
  if(${mode === 'idle'}){window.currentActivity=null;window.initialManualSteps[0].action='Open checkout for @t.email';window.initialManualSteps[1].action='Enter @t.email';}
  window.pinnedActivity=structuredClone(window.currentActivity);
  if(sequential||${mode === 'prompt'})window.currentActivity.metadata.build_data_artifacts={at1:'bound-test-data'};
  api.testCases.automationAgentBuildData=async(activity,id)=>{window.buildDataReads.push({activity,id});return {schema_version:1,kind:'automation_build_data',test_case_id:'at1',parameter_values:{'t.email':'generated.qa48274@example.test'},steps:[],manual_steps:manualRows.map(row=>({manual_test_case_id:row.manual_test_case_id,manual_step_id:row.manual_step_id,action:row.action.replaceAll('@t.email','generated.qa48274@example.test'),expected_result:row.expected_result.replaceAll('@t.email','generated.qa48274@example.test')})),verification_status:'unverified'}};
  const retainedCall={id:'model-fixture',project_id:'p',session_id:'build-one',feature:'automation_build',operation:'generation',status:'succeeded',effective_model:'Configured model',started_at:'2026-10-17T10:00:03Z',capture:{test_case_id:'at1',completion_attempt:1,generation_scope:'case_attempt'},content_access:true,request_payload:{model:'Configured model',messages:[{role:'user',content:'Develop the active checkout step using the supplied test data and observed page.'}]},response_payload:{steps:[{step_id:'section-8',automation_code:'await page.getByRole("button", { name: "Confirm" }).click();'}]}};
  traceApi.llmTraces.list=async()=>({items:[retainedCall],next_cursor:null});traceApi.llmTraces.detail=async()=>retainedCall;
  const preview=(id)=>({schema_version:1,kind:'section_preview',test_case_id:'at1',step_id:id==='preview-one'?'one':'two',step_order:id==='preview-one'?1:2,step_type:'web',action:id==='preview-one'?'Open checkout':'Enter billing details',expected_result:id==='preview-one'?'Checkout is visible':'Billing details accepted',automation_code:id==='preview-one'?'await page.goto("https://checkout.test/cart");':'await page.getByRole("textbox",{name:"Email"}).fill(params["t.user"]); await page.getByRole("button",{name:"Pay"}).click();',api_request:null,object_references:id==='preview-one'?[]:[{reference:'Account.Email',entry_id:'email',locator:'page.getByRole("textbox",{name:"Email"})'},{reference:'Account.Pay',entry_id:'pay',locator:'page.getByRole("button",{name:"Pay"})'}],parameter_references:id==='preview-one'?[]:['t.user'],manual_coverage:[],created_at:'2026-10-17T10:00:02Z',attempt:1,validation_status:'validated',save_status:'draft',verification_status:'unverified',evidence:{test_case_id:'at1',snapshot_artifact_id:id==='preview-one'?'snapshot-one':'snapshot-two',screenshot_artifact_id:id==='preview-one'?'shot-one':'shot-two',observed_at:'2026-10-17T10:00:01Z',url:id==='preview-one'?'https://checkout.test/cart':'https://checkout.test/payment',title:'Checkout payment',interaction_mode:'read_only',association:'generation_phase'}});
  api.testCases.automationAgentActivity=async input=>{window.activityReads.push(input);return structuredClone(window.currentActivity)};api.testCases.automationBuildStatus=async()=>structuredClone(${mode === 'pinned'}?window.pinnedActivity:window.currentActivity);api.testCases.automationAgentActivities=async()=>({items:[],next_cursor:null});
  window.previewApplicability={status:'current',reasons:[]};
  api.testCases.automationAgentPreview=async(activity,id)=>{window.previewReads.push({activity,id});return {...preview(id),applicability:window.previewApplicability}};
  window.setPreviewApplicability=value=>{window.previewApplicability=value;return client.invalidateQueries({queryKey:['automation-engineer-preview']})};
  api.testCases.automationAgentEvidence=async(activity,id)=>{window.evidenceReads.push({activity,id});return {schema_version:1,kind:'browser_evidence',test_case_id:'at1',accessibility:'- heading "Checkout payment"\\n- textbox "Email"\\n- button "Pay"',elements:[],partial:true,truncated:false,verification_status:'unverified'}};
  api.testCases.automationAgentScreenshot=async(activity,id)=>{window.screenshotReads.push({activity,id});return {id,mime_type:'image/png',data_url:window.fixtureCapture}};
  window.advance=()=>{if(manual){window.currentActivity.metadata.step_progress[1].preview_artifact_id='preview-two';window.currentActivity.metadata.step_progress[1].instruction_status='validated_not_saved';window.currentActivity.metadata.step_progress[1].status='completed';window.currentActivity.metadata.step_progress[1].preview_created_at='2026-10-17T10:00:05Z';window.currentActivity.metadata.manual_step_progress[1].instruction_status='validated_not_saved';window.currentActivity.metadata.manual_step_progress[1].status='completed'}else{window.currentActivity.metadata.step_progress=[{...sections[0],instruction_status:'validated_not_saved',status:'in_progress'}]};window.currentActivity.metadata.phase_message='Validated the generated section; execution remains unverified';return client.invalidateQueries({queryKey:['automation-agent-activity']})};
  window.advanceTo=number=>{const current=window.currentActivity.metadata;current.step_progress.forEach((row,index)=>{row.status=index<number-1?'completed':index===number-1?'in_progress':'queued';row.instruction_status=index<number-1?'saved':index===number-1?'requested':'pending';row.development_status=index<number-1?'completed':undefined;if(index<number-1){row.preview_artifact_id=index===0?'preview-one':index===1?'preview-two':'preview-'+(index+1);row.preview_created_at='2026-10-17T10:00:0'+(index+1)+'Z'}});current.manual_step_progress.forEach((row,index)=>{row.status=current.step_progress[index].status;row.instruction_status=current.step_progress[index].instruction_status;row.development_status=current.step_progress[index].development_status});Object.assign(current.workspace_application,{active_step_id:current.step_progress[number-1].step_id,active_manual_step_ids:['m'+number],url:'https://checkout.test/step-'+number,screenshot_artifact_id:'shot-step-'+number,snapshot_artifact_id:'snapshot-step-'+number});return client.invalidateQueries({queryKey:['automation-agent-activity']})};
  window.planPrompt=()=>{window.currentActivity.metadata.step_progress=[{test_case_id:'at1',step_id:'one',step_order:1,step_type:'web',action:'Enter @t.email',expected_result:'@t.email is entered',status:'in_progress',instruction_status:'requested'},{test_case_id:'at1',step_id:'two',step_order:2,step_type:'web',action:'Confirm account @t.email',expected_result:'Welcome @t.email',status:'queued',instruction_status:'pending'}]};
  window.revoke=permission=>{session.user.project_permissions.p=session.user.project_permissions.p.filter(value=>value!==permission);sessionStorage.write(session);window.dispatchEvent(new StorageEvent('storage',{key:'hellotest.session'}))};
  const client=new QueryClient`);
  const name = 'automation-engineer-workspace-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const capture = await browser.newPage({ viewport: { width: 1000, height: 560 } });
    await capture.setContent(`<html><body style="margin:0;font:16px system-ui;background:#f3f6fa;color:#1e293b"><header style="padding:20px 35px;background:#172554;color:white;font-weight:650">Commerce fixture <span style="float:right;font-weight:400">Checkout</span></header><main style="padding:32px 60px"><small style="color:#64748b">CART → DELIVERY → PAYMENT</small><h1>Complete your purchase</h1><div style="display:flex;gap:30px"><section style="width:55%;padding:25px;background:white;border:1px solid #dce3ed;border-radius:12px"><h3>Billing details</h3><label>Email</label><div style="padding:12px;border:1px solid #94a3b8;border-radius:6px;margin-top:8px">reviewer@example.test</div><p>Payment method</p><div style="padding:12px;border:1px solid #dce3ed;border-radius:6px">● Saved card ···· 4242</div><button style="margin-top:24px;background:#2563eb;color:white;padding:12px 30px;border:0;border-radius:6px;font-size:15px">Pay</button></section><aside style="padding:25px;background:white;border:1px solid #dce3ed;border-radius:12px;width:30%"><h3>Order summary</h3><p>One product <strong style="float:right">$49.00</strong></p><hr style="border:0;border-top:1px solid #e2e8f0"><p>Total <strong style="float:right">$49.00</strong></p><small>Captured test fixture evidence</small></aside></div></main></body></html>`);
    const capturedImage = 'data:image/png;base64,' + (await capture.screenshot()).toString('base64');
    await capture.close();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(15_000);page.setDefaultNavigationTimeout(60_000);
    await page.addInitScript(image => {window.fixtureCapture=image;window.copies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copies.push(text)}})}, capturedImage);
    const errors = [];page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {errors.push('Unexpected API ' + route.request().url());return route.abort()});
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`);
    await mkdir('/tmp/qaira-engineer-workspace', { recursive: true });
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all(['html','tsx'].map(extension => rm(new URL(name + '.' + extension, root), { force: true })));
  }
}

test('implementation keeps the four working tabs inline and expands to show long instruction lists', {timeout:90_000}, async()=>runFixture('manual', async page=>{
  const workspace=page.getByRole('region',{name:'Automation engineer workspace',exact:true});
  await expect(workspace).toBeVisible();
  await page.evaluate(()=>{
    const original=window.fixtureApi.testCases.automationAgentPreview;
    window.fixtureApi.testCases.automationAgentPreview=async(...args)=>({...await original(...args),automation_code:Array.from({length:35},(_,index)=>`await page.getByLabel("Field ${index + 1}").fill("Value ${index + 1}");`).join('\n')});
    return window.advance();
  });
  const tabs=workspace.getByRole('tablist',{name:'Generated implementation format',exact:true});
  const workingTabs=tabs.getByRole('tab').filter({hasText:/^(Instructions|Source|Build Error|Browser activity)$/});
  await expect(workingTabs).toHaveCount(4);
  const positions=await workingTabs.evaluateAll(elements=>elements.map(element=>{const rect=element.getBoundingClientRect();return {top:rect.top,width:rect.width,clientWidth:element.clientWidth,scrollWidth:element.scrollWidth};}));
  assert.ok(Math.max(...positions.map(item=>item.top))-Math.min(...positions.map(item=>item.top))<=1,'the four working tabs share one desktop row');
  assert.ok(positions.every(item=>item.scrollWidth<=item.clientWidth+1),'tab labels never shrink or clip');
  const instructions=workspace.locator('.automation-engineer-code-view');
  await expect(instructions.locator('.automation-instruction-line')).toHaveCount(35);
  const bounds=await instructions.evaluate(element=>({height:element.clientHeight,content:element.scrollHeight}));
  assert.ok(bounds.height>380 && bounds.content<=bounds.height+1,'all instructions expand in the page instead of a 380px nested viewport');
  const stepRail=await workspace.locator('.automation-engineer-commands').boundingBox();
  const output=await workspace.locator('.automation-engineer-output').boundingBox();
  assert.ok(output.width>stepRail.width*2,'the implementation receives most desktop workspace width');
  await page.screenshot({path:'/tmp/qaira-engineer-workspace/expanded-instructions-desktop.png'});
  await instructions.locator('.automation-instruction-line').last().scrollIntoViewIfNeeded();
  await expect(instructions.locator('.automation-instruction-line').last()).toBeInViewport();
  await page.screenshot({path:'/tmp/qaira-engineer-workspace/expanded-instructions-end-desktop.png'});
  for(const width of [768,390]){
    await page.setViewportSize({width,height:844});
    assert.ok(await workspace.evaluate(element=>element.scrollWidth<=element.clientWidth+1),'workspace fits '+width);
    assert.ok(await tabs.evaluate(element=>element.scrollWidth<=element.clientWidth+1),'all tabs wrap within '+width);
    for(const tab of ['Instructions','Source','Build Error','Browser activity'])await expect(tabs.getByRole('tab',{name:tab,exact:true})).toBeVisible();
  }
  await tabs.screenshot({path:'/tmp/qaira-engineer-workspace/expanded-tabs-mobile.png'});
}));

test('retained generation visibly becomes historical when the live Plan version changes while keeping its source available', {timeout:90_000}, async()=>runFixture('manual',async page=>{
  const workspace=page.getByRole('region',{name:'Automation engineer workspace',exact:true});
  await expect(workspace).toBeVisible();await page.evaluate(()=>window.advance());
  await workspace.getByRole('tab',{name:'Source',exact:true}).click();
  const source=workspace.locator('.automation-engineer-code-view pre');await expect(source).toContainText('params["t.user"]');
  const retained=await source.innerText();await expect(workspace.getByRole('note',{name:'Generation applicability'})).toHaveCount(0);
  await page.evaluate(()=>window.setPreviewApplicability({status:'historical',reasons:['source_changed','manual_specification_changed']}));
  await expect(workspace.getByRole('note',{name:'Generation applicability'})).toContainText('Historical generation');
  await expect(workspace.getByText('Historical generation · Not run',{exact:true})).toBeVisible();assert.equal(await source.innerText(),retained);
  await workspace.getByRole('button',{name:'Copy generated source',exact:true}).click();assert.equal(await page.evaluate(()=>window.copies[0]),retained);
  await page.evaluate(()=>window.setPreviewApplicability({status:'unknown',reasons:['current_plan_unavailable']}));
  await expect(workspace.getByRole('note',{name:'Generation applicability'})).toContainText('Generation version unavailable');
  assert.equal(await source.innerText(),retained);
}));

test('manual Engineer workspace follows actual previews and selected-phase evidence without exposing expired role access', { timeout: 90_000 }, async () => {
  await runFixture('manual', async page => {
    const activity = page.getByRole('region', { name: 'Automation engineer activity', exact: true });
    const workspace = page.getByRole('region', { name: 'Automation engineer workspace', exact: true });
    await expect(workspace).toBeVisible();assert.equal(await activity.count(), 1);
    await expect(workspace.getByRole('list', {name:'Manual steps to automate'}).locator(':scope > li')).toHaveCount(3);
    await expect(workspace.getByText('Billing details accepted', {exact:true})).toBeVisible();
    await expect(workspace.getByRole('button',{name:/Enter billing details/})).toHaveAttribute('aria-busy','true');
    await expect(workspace.getByText('Requested from model',{exact:true})).toBeVisible();
    assert.equal(await activity.locator('.automation-agent-activity-overview,.automation-agent-activity-phase,.automation-agent-activity-events,.automation-agent-activity-cases,.automation-agent-model-calls').count(),0);
    await expect(workspace.getByRole('tab',{name:'Model request',exact:true})).toBeVisible();
    await expect(workspace.getByRole('tab',{name:'Model response',exact:true})).toBeVisible();
    await expect(workspace.getByText('Order ID is displayed', {exact:true})).toHaveCount(0);
    await expect(workspace.locator('[data-agent-queued="true"]')).toHaveCount(1);
    await expect(workspace.getByText('Latest case observation', {exact:true})).toBeVisible();
    assert.doesNotMatch(await workspace.locator('.automation-engineer-browser-address').innerText(), /secret|private|token/);
    await expect(workspace.getByText('Implementation is being developed', {exact:true})).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.previewReads), []);
    await page.evaluate(() => window.advance());
    await expect(workspace.locator('.automation-instruction-readable').first()).toContainText('Account.Email');
    await expect(workspace.locator('.automation-instruction-readable').nth(1)).toContainText('Account.Pay');
    await expect(workspace.getByText('Generation phase observation', {exact:true})).toBeVisible();
    await expect(workspace.locator('.automation-engineer-browser-address')).toContainText('/payment');
    await expect(workspace.locator('.automation-engineer-application .automation-engineer-interaction-mode,.automation-engineer-application .automation-engineer-browser-actions,.automation-engineer-application .automation-engineer-page-title')).toHaveCount(0);
    await workspace.getByRole('tab',{name:'Browser activity',exact:true}).click();
    await expect(workspace.getByText('Read-only observation · Browser actions were not enabled.', {exact:true})).toBeVisible();
    await workspace.getByRole('tab',{name:'Instructions',exact:true}).click();
    assert.deepEqual(await page.evaluate(() => window.evidenceReads), []);
    await workspace.getByRole('tab', {name:'Page snapshot',exact:true}).click();
    await expect(workspace.getByRole('tabpanel').filter({has:page.locator('pre')}).first()).toContainText('textbox "Email"');
    await expect(workspace.getByText(/Partial page observation/)).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.evidenceReads), [{activity:'build-one',id:'snapshot-two'}]);
    await workspace.getByRole('tab', {name:'Source',exact:true}).click();
    await expect(workspace.locator('.automation-engineer-code-view pre')).toContainText('await page.getByRole');
    await workspace.getByRole('button',{name:'Copy generated source',exact:true}).click();
    assert.match(await page.evaluate(() => window.copies[0]), /; \nawait page.getByRole\("button"/);
    await expect(workspace.getByText('@t.user',{exact:true})).toBeVisible();
    await page.evaluate(() => Object.assign(window.currentActivity.metadata.workspace_application,{active_step_id:'two',active_manual_step_ids:['m2'],observed_at:'2026-10-17T10:00:10Z',url:'https://checkout.test/payment-current',snapshot_artifact_id:'snapshot-current',screenshot_artifact_id:'shot-current'}));
    await activity.getByRole('button',{name:'Refresh activity',exact:true}).click();
    await expect(workspace.locator('.automation-engineer-browser-address')).toContainText('/payment-current');
    await expect(workspace.getByText('Selected step observation',{exact:true})).toBeVisible();
    await workspace.getByRole('button',{name:/Open checkout/}).click();
    await expect(workspace.locator('.automation-engineer-code-view pre')).toContainText('page.goto');
    await expect(workspace.locator('.automation-engineer-browser-address')).toContainText('/cart');
    await expect(workspace.getByRole('button',{name:'Follow agent',exact:true})).toHaveCount(0);
    await workspace.getByRole('button',{name:/Enter billing details/}).click();
    await expect(workspace.locator('.automation-engineer-code-view pre')).toContainText('params["t.user"]');
    await workspace.getByRole('tab',{name:'Browser capture',exact:true}).click();
    await expect(workspace.getByRole('img')).toBeVisible();
    const left=await workspace.locator('.automation-engineer-commands').boundingBox(),right=await workspace.locator('.automation-engineer-output').boundingBox();assert.ok(right.x>left.x+left.width,'Desktop workspace has two real panes');
    await page.evaluate(() => document.documentElement.dataset.theme='light');await workspace.screenshot({path:'/tmp/qaira-engineer-workspace/manual-desktop-light.png'});
    await page.evaluate(() => document.documentElement.dataset.theme='dark');await workspace.screenshot({path:'/tmp/qaira-engineer-workspace/manual-desktop-dark.png'});
    await page.setViewportSize({width:390,height:844});assert.ok(await workspace.evaluate(element=>element.scrollWidth<=element.clientWidth+1));
    for (const theme of ['dark','light']) {
      await page.evaluate(value => document.documentElement.dataset.theme=value,theme);
      await workspace.locator('.automation-engineer-commands').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/qaira-engineer-workspace/manual-mobile-'+theme+'.png'});
      await workspace.locator('.automation-engineer-application').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/qaira-engineer-workspace/manual-mobile-'+theme+'-application.png'});
      await workspace.locator('.automation-engineer-implementation').scrollIntoViewIfNeeded();await expect(workspace.getByRole('button',{name:'Copy generated source',exact:true})).toBeInViewport();await expect(workspace.locator('.automation-engineer-code-view pre')).toBeInViewport();await page.screenshot({path:'/tmp/qaira-engineer-workspace/manual-mobile-'+theme+'-source.png'});
    }
    assert.ok((await page.evaluate(()=>window.receipts)).every(id=>id==='build-one'),'One authoritative build receipt survives preview selection');
    assert.ok((await page.evaluate(()=>window.activityReads)).every(query=>query.test_case_id==='manual-source'),'Prepared AT target does not mutate the source-case activity scope');
    await page.evaluate(() => window.revoke('automation.ai'));
    await expect(page.getByText('Automation view, build, AI and source permissions are required to view this Engineer workspace.',{exact:true})).toBeVisible();
    assert.equal(await page.getByRole('region',{name:'Automation engineer workspace',exact:true}).count(),0,'Revocation hides previously cached protected source/evidence');
  });
});

test('Browser activity follows the selected step without leaking the latest case receipts or removed summary text', {timeout:90_000}, async()=>runFixture('manual',async page=>{
  const activity=page.getByRole('region',{name:'Automation engineer activity',exact:true});
  const workspace=page.getByRole('region',{name:'Automation engineer workspace',exact:true});
  await page.evaluate(()=>{
    const metadata=window.currentActivity.metadata;
    metadata.step_progress[0].browser_actions=[{action_id:'open',tool:'browser_navigate',status:'completed',active_manual_step_ids:['m1']}];
    metadata.step_progress[1].browser_actions=[{action_id:'fill',tool:'browser_fill',status:'completed',active_manual_step_ids:['m2']},{action_id:'assert',tool:'browser_assert',status:'failed',assertion_outcome:'not_satisfied',active_manual_step_ids:['m2']}];
    Object.assign(metadata.workspace_application,{active_step_id:'two',active_manual_step_ids:['m2'],title:'Sign In · HelloTest',interaction_mode:'interactive'});
  });
  await activity.getByRole('button',{name:'Refresh activity',exact:true}).click();
  assert.doesNotMatch(await workspace.innerText(),/Generation evidence|Follow agent|Generated sections|sections saved|browser actions completed|step drafts validated/);
  await expect(workspace.getByRole('tablist',{name:'Engineer command view',exact:true})).toHaveCount(0);
  const activityTab=workspace.getByRole('tab',{name:'Browser activity',exact:true});
  const errorTab=workspace.getByRole('tab',{name:/^Build Error/});
  await activityTab.click();
  const details=workspace.getByRole('region',{name:'Browser activity for selected step',exact:true});
  await expect(details).toContainText('Sign In · HelloTest');
  await expect(details).toContainText('Interactive browser evidence · Browser actions were enabled.');
  await expect(details.getByRole('listitem')).toHaveCount(2);
  await expect(details.getByRole('listitem').nth(0)).toHaveText('fillCompleted');
  await expect(details.getByRole('listitem').nth(1)).toHaveText('assertFailed');
  await activityTab.focus();await page.keyboard.press('ArrowLeft');await expect(errorTab).toBeFocused();
  await page.keyboard.press('ArrowRight');await expect(activityTab).toBeFocused();
  await workspace.getByRole('button',{name:/Open checkout/}).click();
  await expect(details.getByRole('listitem')).toHaveCount(1);
  await expect(details.getByRole('listitem')).toHaveText('navigateCompleted');
  await expect(details).toContainText('Checkout payment');
  assert.doesNotMatch(await details.innerText(),/Sign In|Interactive browser evidence|fill|assert/);
  await workspace.getByRole('button',{name:/Enter billing details/}).click();
  await page.evaluate(()=>Object.assign(window.currentActivity.metadata.workspace_application,{active_step_id:'other',active_manual_step_ids:['other'],title:'Unrelated page',interaction_mode:'interactive'}));
  await activity.getByRole('button',{name:'Refresh activity',exact:true}).click();
  await expect(details.getByRole('listitem')).toHaveCount(2);
  await expect(details).not.toContainText('Interactive browser evidence');
  await expect(details).not.toContainText('Unrelated page');
  await page.evaluate(()=>{
    window.currentActivity.metadata.manual_step_progress[0].section_step_id='two';
    Object.assign(window.currentActivity.metadata.workspace_application,{active_step_id:'two',active_manual_step_ids:['m2'],title:'Second manual step page'});
  });
  await activity.getByRole('button',{name:'Refresh activity',exact:true}).click();
  await workspace.getByRole('button',{name:/Open checkout/}).click();
  await expect(details.getByRole('listitem')).toHaveCount(0);
  await expect(details).toContainText('No browser action confirmed for this step');
  assert.doesNotMatch(await details.innerText(),/Second manual step page|fill|assert/,'Manual steps sharing a section retain separate receipts and browser observations');
  await workspace.getByRole('button',{name:/Enter billing details/}).click();
  for(const theme of ['light','dark']){await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);await workspace.screenshot({path:'/tmp/qaira-engineer-workspace/browser-activity-'+theme+'.png'});}
  await page.setViewportSize({width:390,height:844});await workspace.locator('.automation-engineer-implementation').scrollIntoViewIfNeeded();
  assert.ok(await workspace.evaluate(element=>element.scrollWidth<=element.clientWidth+1));
  await page.screenshot({path:'/tmp/qaira-engineer-workspace/browser-activity-mobile.png'});
}));

test('the latest workspace shows a sanitized failure reason and discovers a newer build on refresh', {timeout:90_000}, async()=>runFixture('monitoring',async page=>{
  const activity=page.getByRole('region',{name:'Automation engineer activity',exact:true});
  await page.evaluate(()=>{window.currentActivity.status='failed';window.currentActivity.metadata.outcome_status='incomplete';window.currentActivity.metadata.case_outcomes=[{test_case_id:'at1',code:'AUTOMATION_BROWSER_STARTUP_FAILED',message:'The browser could not start. Retry after restoring the browser service.'}];});
  await activity.getByRole('button',{name:'Refresh activity',exact:true}).click();
  await expect(activity.getByRole('alert')).toContainText('Browser setup could not finish');
  await expect(activity.getByRole('alert')).toContainText('The browser could not start.');
  await activity.screenshot({path:'/tmp/qaira-engineer-browser-startup-failure.png'});
  await page.evaluate(()=>{window.currentActivity={...window.currentActivity,id:'newer-build',status:'running',metadata:{...window.currentActivity.metadata,outcome_status:undefined,case_outcomes:[],phase_message:'Opening the reviewed application for the next build.'}};});
  await activity.getByRole('button',{name:'Refresh activity',exact:true}).click();
  await expect(activity.getByText('Opening the reviewed application for the next build.',{exact:true})).toBeVisible();
  await activity.screenshot({path:'/tmp/qaira-engineer-live-monitoring.png'});
  assert.ok((await page.evaluate(()=>window.receipts)).includes('newer-build'));
}));

test('Build Error follows the selected manual step, retains resolved history and keeps step errors out of the case banner', {timeout:90_000}, async()=>runFixture('manual',async page=>{
  const activity=page.getByRole('region',{name:'Automation engineer activity',exact:true});
  const workspace=page.getByRole('region',{name:'Automation engineer workspace',exact:true});
  await expect(workspace.getByText('Billing details accepted',{exact:true})).toBeVisible();
  await page.evaluate(()=>{
    const metadata=window.currentActivity.metadata;
    const message='The email address input could not be found on this page.';
    const first={id:'earlier-open',code:'BROWSER_NOT_READY',message:'The page was not ready on the first attempt.',phase:'automation.agent.browser.failed',attempt:1,resolved_at:'2026-10-17T10:00:01Z'};
    const failed={id:'current-email',code:'BROWSER_TARGET_NOT_FOUND',message,phase:'automation.agent.action.failed',attempt:2,created_at:'2026-10-17T10:00:05Z',tool:'browser_fill'};
    metadata.step_progress[0].build_errors=[first];metadata.step_progress[1].build_errors=[failed,{id:'blocked-step',code:'AUTOMATION_BROWSER_SECTION_BLOCKED',message:'Sign in requires a configured account.',phase:'automation.agent.section.blocked',attempt:2},{id:'stalled-check',code:'AUTOMATION_BROWSER_CHECK_STALLED',message:'The same check remained unsatisfied after browser recovery.',phase:'automation.agent.action.failed',attempt:2}];metadata.step_progress[1].status='needs_attention';
    metadata.manual_step_progress[1].action='Enter params["r.email"] and @r.mobile';
    metadata.build_data_artifacts={at1:'error-test-data'};
    metadata.outcome_status='incomplete';metadata.error=message;
    metadata.case_outcomes=[{test_case_id:'at1',active_step_id:'two',code:failed.code,message,failure_stage:'browser',status:'failed'}];
    window.currentActivity.status='failed';
    window.currentActivity.events=[{id:'failure-event',level:'error',phase:failed.phase,message,details:{test_case_id:'at1',active_step_id:'two',error_code:failed.code}},{id:'unrelated-event',level:'error',phase:'automation.agent.action.failed',message:'Other case private diagnostic.',details:{test_case_id:'other-case',active_step_id:'other-section'}}];
    // The activity renders only values frozen for this build, including native params syntax.
    window.fixtureApi.testCases.automationAgentBuildData=async()=>({schema_version:1,kind:'automation_build_data',test_case_id:'at1',parameter_values:{'r.email':'manual.actual@example.test'},parameter_references:['r.email','r.mobile'],steps:[],manual_steps:[]});
  });
  await activity.getByRole('button',{name:'Refresh activity',exact:true}).click();
  await expect(workspace.getByRole('button',{name:/Enter manual.actual@example.test and @r.mobile/})).toBeVisible();
  await expect(workspace.getByLabel('Selected step test data')).toContainText('@r.mobile');
  await expect(workspace.getByLabel('Selected step test data')).toContainText('Configure these parameter values');
  await expect(activity.locator('.automation-agent-failure')).toHaveCount(0);
  await expect(workspace.getByText('The email address input could not be found on this page.',{exact:true})).toHaveCount(0);
  await page.evaluate(()=>{window.currentActivity.status='running';window.currentActivity.metadata.current_phase='automation.agent.action.failed';window.currentActivity.metadata.phase_message='The email address input could not be found on this page.'});
  await activity.getByRole('button',{name:'Refresh activity',exact:true}).click();
  await expect(activity.locator('.automation-agent-live-progress')).toHaveCount(0);
  await expect(activity.getByText('The email address input could not be found on this page.',{exact:true})).toHaveCount(0);
  await page.evaluate(()=>window.currentActivity.status='failed');await activity.getByRole('button',{name:'Refresh activity',exact:true}).click();
  const errorTab=workspace.getByRole('tab',{name:'Build Error (3)',exact:true});
  await expect(errorTab).toBeVisible();
  await workspace.getByRole('tab',{name:'Instructions',exact:true}).focus();await page.keyboard.press('End');
  await expect(workspace.getByRole('tab',{name:'Model response',exact:true})).toBeFocused();await page.keyboard.press('Home');
  await expect(workspace.getByRole('tab',{name:'Instructions',exact:true})).toBeFocused();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  await expect(errorTab).toBeFocused();await expect(errorTab).toHaveAttribute('aria-selected','true');
  const errors=workspace.getByRole('region',{name:'Build errors for selected step',exact:true});
  await expect(errors.getByText('The email address input could not be found on this page.',{exact:true})).toHaveCount(1);
  await expect(errors).toContainText('Attempt 2');await expect(errors).toContainText('BROWSER_TARGET_NOT_FOUND');
  await expect(errors).toContainText('Step needs review');await expect(errors).toContainText('AUTOMATION_BROWSER_SECTION_BLOCKED');await expect(errors).toContainText('AUTOMATION_BROWSER_CHECK_STALLED');
  assert.doesNotMatch(await workspace.innerText(),/Other case private diagnostic|The page was not ready/);
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await workspace.screenshot({path:'/tmp/qaira-engineer-workspace/build-error-'+theme+'.png'});}
  await workspace.getByRole('button',{name:/Open checkout/}).click();
  await expect(workspace.getByRole('tab',{name:'Build Error (1 earlier)',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(errors).toContainText('The page was not ready on the first attempt.');await expect(errors).toContainText('Resolved during generation');
  assert.doesNotMatch(await errors.innerText(),/email address input/);
  await workspace.getByRole('button',{name:/Enter manual.actual@example.test/}).click();
  await page.setViewportSize({width:390,height:844});assert.ok(await workspace.evaluate(element=>element.scrollWidth<=element.clientWidth+1));
  await workspace.locator('.automation-engineer-implementation').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/qaira-engineer-workspace/build-error-mobile-dark.png'});
  await page.evaluate(()=>window.revoke('data.view'));
  await expect(workspace.getByRole('button',{name:/Enter params\["r.email"\] and @r.mobile/})).toBeVisible();
  assert.doesNotMatch(await workspace.innerText(),/manual.actual@example.test/);
}));

test('semantic Build Error identifies the unmet manual requirement and renders an unchanged rejection once', {timeout:90_000}, async()=>runFixture('manual',async page=>{
  const activity=page.getByRole('region',{name:'Automation engineer activity',exact:true});
  const workspace=page.getByRole('region',{name:'Automation engineer workspace',exact:true});
  await expect(workspace.getByText('Billing details accepted',{exact:true})).toBeVisible();
  await page.evaluate(()=>{
    const metadata=window.currentActivity.metadata;
    const issue={code:'expected_result_not_covered',obligation_id:'manual:manual-source:m2',message:'private model rationale must remain hidden'};
    const shared={semantic_issues:[issue,{code:'unrelated_assertion',obligation_id:'manual:unrelated:secret'}],requirement:'independent_field_validation_predicate',attempt:2};
    metadata.step_progress[1].status='needs_attention';
    metadata.step_progress[1].build_errors=[{id:'review-gap',code:'AUTOMATION_SEMANTIC_REVIEW_REJECTED',message:'Review the unsupported requirement.',phase:'automation.agent.semantic.rejected',...shared},
      {id:'review-stopped',code:'AUTOMATION_SEMANTIC_REVIEW_STALLED',message:'The same rejected evidence was resubmitted. Correct the unsupported requirement before retrying.',phase:'automation.agent.browser.failed',...shared}];
    metadata.manual_step_progress[1].expected_result='Email @t.email is valid and has no validation errors';
    metadata.build_data_artifacts={at1:'semantic-test-data'};
    window.fixtureApi.testCases.automationAgentBuildData=async()=>({schema_version:1,kind:'automation_build_data',test_case_id:'at1',parameter_values:{'t.email':'reviewed@example.test'},manual_steps:[]});
    metadata.outcome_status='incomplete';window.currentActivity.status='failed';
  });
  await activity.getByRole('button',{name:'Refresh activity',exact:true}).click();
  await workspace.getByRole('tab',{name:'Build Error (1)',exact:true}).click();
  const errors=workspace.getByRole('region',{name:'Build errors for selected step',exact:true});
  await expect(errors.locator(':scope > ol > li')).toHaveCount(1);
  await expect(errors.getByRole('list',{name:'Unmet requirements'}).getByRole('listitem')).toHaveCount(1);
  await expect(errors).toContainText('Check the field’s validation status and any relevant validation errors.');
  await expect(errors).toContainText('Manual step 2 · Expected result');
  await expect(errors).toContainText('Email reviewed@example.test is valid and has no validation errors');
  await expect(errors).toContainText('AUTOMATION_SEMANTIC_REVIEW_STALLED');
  assert.doesNotMatch(await errors.innerText(),/private model rationale|unrelated:secret|Review the unsupported requirement\./);
  await workspace.locator('.automation-engineer-implementation').screenshot({path:'/tmp/qaira-engineer-workspace/semantic-unmet-requirement.png'});
  await page.setViewportSize({width:390,height:844});
  await workspace.locator('.automation-engineer-implementation').scrollIntoViewIfNeeded();
  assert.ok(await workspace.evaluate(element=>element.scrollWidth<=element.clientWidth+1));
  await page.screenshot({path:'/tmp/qaira-engineer-workspace/semantic-unmet-requirement-mobile.png'});
  await page.evaluate(()=>window.revoke('data.view'));
  await expect(errors).toContainText('Email @t.email is valid and has no validation errors');
  assert.doesNotMatch(await errors.innerText(),/reviewed@example.test/,'requirement labels respect test-data permission');
}));

test('an explicit activity view stays on its selected receipt when a newer build exists', {timeout:90_000}, async()=>runFixture('pinned',async page=>{
  const activity=page.getByRole('region',{name:'Automation engineer activity',exact:true});
  await page.evaluate(()=>{window.pinnedActivity.status='failed';window.pinnedActivity.metadata.outcome_status='incomplete';window.pinnedActivity.metadata.case_outcomes=[{test_case_id:'at1',code:'AI_INVALID_RESPONSE',message:'The selected model response omitted the active section.'}];window.currentActivity={id:'newer-build',project_id:'p',app_type_id:'a',status:'running',metadata:{phase_message:'This newer build was not selected.'}};});
  await activity.getByRole('button',{name:'Refresh activity',exact:true}).click();
  await expect(activity.getByRole('alert')).toContainText('The selected model response omitted the active section.');
  await expect(activity.getByText('This newer build was not selected.',{exact:true})).toHaveCount(0);
  assert.ok((await page.evaluate(()=>window.receipts)).every(id=>id==='build-one'));
  assert.equal((await page.evaluate(()=>window.activityReads)).length,0);
}));

test('stalled checks render two actual failures and one terminal cause while an earlier satisfied step stays completed', {timeout:90_000}, async()=>runFixture('manual',async page=>{
  const activity=page.getByRole('region',{name:'Automation engineer activity',exact:true});
  const workspace=page.getByRole('region',{name:'Automation engineer workspace',exact:true});
  await expect(workspace).toBeVisible();
  await page.evaluate(()=>{
    const metadata=window.currentActivity.metadata;
    const successful='11111111-1111-4111-8111-111111111111';
    const failures=['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
    const assertionMessage='The expected-result check did not pass. Review the current browser evidence and model response.';
    const code='AUTOMATION_BROWSER_CHECK_STALLED';
    const cause='The expected-result check remains unsatisfied on the same unchanged target. The step stopped after recovery without another browser operation.';
    // Retained activities from the old reducer have this contradictory status;
    // the original completed event below repairs presentation without a write.
    metadata.step_progress[0].browser_actions=[{action_id:successful,tool:'browser_assert',status:'failed',assertion_outcome:'satisfied',active_manual_step_ids:['m1']}];
    metadata.manual_step_progress[0].browser_actions=structuredClone(metadata.step_progress[0].browser_actions);
    metadata.step_progress[1].status='needs_attention';metadata.step_progress[1].instruction_status='not_saved';
    metadata.manual_step_progress[1].status='needs_attention';metadata.manual_step_progress[1].instruction_status='not_saved';
    metadata.step_progress[1].build_errors=[...failures.map((action_id,index)=>({id:`check-${index}`,action_id,code:'BROWSER_ASSERTION_NOT_SATISFIED',message:assertionMessage,phase:'automation.agent.action.failed',tool:'browser_assert',assertion:'text',attempt:2,created_at:`2026-10-17T11:03:${index?35:23}Z`})),
      {id:'terminal',code,message:'This section could not finish building. Review its browser evidence and model request and response.',phase:'automation.agent.browser.failed',created_at:'2026-10-17T11:03:40Z'}];
    metadata.case_outcomes=[{test_case_id:'at1',active_step_id:'two',code,message:cause}];metadata.outcome_status='incomplete';
    window.currentActivity.status='failed';
    window.currentActivity.events=[{id:'completed-check',phase:'automation.agent.action.completed',message:'Browser assert: completed.',details:{test_case_id:'at1',active_step_id:'one',action_id:successful,tool:'browser_assert',assertion_outcome:'satisfied'}},
      ...failures.map((action_id,index)=>({id:`failure-${index}`,phase:'automation.agent.action.failed',message:'Browser assert: failed.',created_at:`2026-10-17T11:03:${index?35:23}Z`,details:{test_case_id:'at1',active_step_id:'two',action_id,tool:'browser_assert',error_code:'BROWSER_ASSERTION_NOT_SATISFIED',attempt:2}})),
      {id:'progress',level:'error',phase:'automation.agent.browser.failed',message:'The expected-result check is still unsatisfied after recovery. This step stopped repeating checks; review its Browser activity, prerequisites and expected result.',details:{test_case_id:'at1',active_step_id:'two',error_code:code}},
      {id:'wrapper',level:'error',phase:'automation.case.failed',message:'Automation build failed for case at1.',details:{test_case_id:'at1',active_step_id:'two',error_code:code}}];
  });
  await activity.getByRole('button',{name:'Refresh activity',exact:true}).click();
  await workspace.getByRole('tab',{name:'Build Error (3)',exact:true}).click();
  const errors=workspace.getByRole('region',{name:'Build errors for selected step',exact:true});
  await expect(errors.locator(':scope > ol > li')).toHaveCount(3);
  await expect(errors.getByText('BROWSER_ASSERTION_NOT_SATISFIED',{exact:true})).toHaveCount(2);
  await expect(errors.getByText('AUTOMATION_BROWSER_CHECK_STALLED',{exact:true})).toHaveCount(1);
  await expect(errors).toContainText('without another browser operation.');
  await workspace.screenshot({path:'/tmp/qaira-engineer-workspace/stalled-terminal-dedup.png'});
  await workspace.getByRole('button',{name:/Open checkout/}).click();
  await expect(workspace.getByRole('tab',{name:'Build Error',exact:true})).toBeVisible();
  await expect(errors).toContainText('No build errors recorded for this step');
  await workspace.getByRole('tab',{name:'Browser activity',exact:true}).click();
  const browserActivity=workspace.getByRole('region',{name:'Browser activity for selected step',exact:true});
  await expect(browserActivity.getByText('Check satisfied',{exact:true})).toHaveCount(1);
  await expect(browserActivity.getByText('Failed',{exact:true})).toHaveCount(0);
  assert.equal(await page.evaluate(()=>window.currentActivity.metadata.step_progress[0].browser_actions[0].status),'failed',
    'correcting historical presentation does not rewrite retained activity metadata');
}));

test('an Engineer without a manual manifest progressively displays generated sections and their expected results', { timeout: 90_000 }, async () => {
  await runFixture('generated', async page => {
    const workspace=page.getByRole('region',{name:'Automation engineer workspace',exact:true});
    await expect(workspace.getByText('Planning the first step',{exact:true})).toBeVisible();
    await expect(workspace.getByRole('list',{name:'Planned automation steps'}).locator(':scope > li')).toHaveCount(3);
    await page.evaluate(()=>window.advance());
    await expect(workspace.getByRole('list',{name:'Automation sections'}).locator(':scope > li')).toHaveCount(1);
    await expect(workspace.getByText('Checkout is visible',{exact:true})).toBeVisible();
    await expect(workspace.getByText('Open URL',{exact:true})).toBeVisible();
    await expect(workspace.getByText('Validated draft · Not saved',{exact:true})).toBeVisible();
    assert.equal(await workspace.getByRole('list',{name:'Manual steps to automate'}).count(),0);
    assert.equal(await page.locator('.automation-agent-activity').count(),1);
    await workspace.screenshot({path:'/tmp/qaira-engineer-workspace/generated-desktop.png'});
  });
});


test('the first linked manual step shows actual data while future steps remain anonymous skeletons before the first job', { timeout: 90_000 }, async () => {
  await runFixture('idle', async page => {
    const workspace=page.getByRole('region',{name:'Automation engineer workspace',exact:true});
    const rows=workspace.getByRole('list',{name:'Manual steps to automate'}).locator(':scope > li');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).getByRole('button')).toBeEnabled();
    await expect(rows.nth(0).getByRole('button')).toHaveAttribute('aria-current','step');
    for (const row of (await rows.all()).slice(1)) await expect(row.getByRole('button')).toBeDisabled();
    await expect(workspace.getByText('Ready to automate',{exact:true})).toHaveCount(1);
    await expect(workspace.locator('[data-agent-queued="true"]')).toHaveCount(2);
    await expect(workspace.getByText('Checkout is visible',{exact:true})).toBeVisible();
    await expect(rows.nth(0)).toContainText('Open checkout for saved.manual@example.test');
    await expect(workspace.getByText('Billing details accepted',{exact:true})).toHaveCount(0);
    assert.doesNotMatch(await rows.nth(1).innerText(), /Enter|@t.email|saved.manual/);
    await expect(workspace.getByText('Order ID is displayed',{exact:true})).toHaveCount(0);
    await expect(workspace.getByRole('button',{name:'Follow agent',exact:true})).toHaveCount(0);
    await expect(page.locator('.automation-agent-activity-status')).toHaveText('Ready to develop');
    assert.deepEqual(await page.evaluate(()=>window.previewReads),[]);
    assert.deepEqual(await page.evaluate(()=>window.evidenceReads),[]);
    assert.deepEqual(await page.evaluate(()=>window.receipts),[]);
    await workspace.screenshot({path:'/tmp/qaira-engineer-workspace/idle-manual-desktop.png'});
  });
});

test('a sequential Engineer enables only the current draft, follows each active step and keeps actual evidence scoped', { timeout: 90_000 }, async () => {
  await runFixture('sequence', async page => {
    const workspace=page.getByRole('region',{name:'Automation engineer workspace',exact:true});
    const list=workspace.getByRole('list',{name:'Manual steps to automate'});
    const rows=list.locator(':scope > li');
    await expect(rows).toHaveCount(8);
    await expect(rows.nth(0).getByRole('button')).toBeEnabled();
    await expect(rows.nth(0).getByRole('button')).toHaveAttribute('aria-current','step');
    await expect(rows.nth(0).getByRole('button')).toHaveAttribute('aria-busy','true');
    for(const row of (await rows.all()).slice(1))await expect(row.getByRole('button')).toBeDisabled();
    await expect(list.locator('[aria-busy="true"]')).toHaveCount(1);
    await expect(workspace.getByText('Selected step observation',{exact:true})).toBeVisible();
    assert.doesNotMatch(await workspace.innerText(), /Enter generated|generated.qa48274@example.test is displayed/);
    await page.evaluate(()=>window.advanceTo(2));
    await expect(rows.nth(1).getByRole('button')).toHaveAttribute('aria-current','step');
    await expect(rows.nth(1).getByRole('button')).toHaveAttribute('aria-busy','true');
    await expect(rows.nth(0).getByRole('button')).toBeEnabled();
    await expect(rows.nth(0)).toContainText('Saved · Not run');
    await expect(rows.nth(1)).toContainText('Enter generated.qa48274@example.test');
    await expect(rows.nth(1)).toContainText('generated.qa48274@example.test is displayed');
    await expect(rows.nth(2).getByRole('button')).toBeDisabled();
    await expect(list.locator('[aria-busy="true"]')).toHaveCount(1);
    await expect(workspace.locator('.automation-engineer-browser-address')).toContainText('/step-2');
    await page.evaluate(()=>Object.assign(window.currentActivity.metadata.workspace_application,{active_step_id:'one',active_manual_step_ids:['m1'],url:'https://checkout.test/earlier-step'}));
    await expect(workspace.getByText('Another step observation',{exact:true})).toBeVisible();
    await expect(workspace.getByText('Selected step observation',{exact:true})).toHaveCount(0);
    await expect(rows.nth(1).getByRole('button')).toHaveAttribute('aria-current','step');
    await page.evaluate(()=>Object.assign(window.currentActivity.metadata.workspace_application,{active_step_id:'two',active_manual_step_ids:['m2'],url:'https://checkout.test/step-2'}));
    await expect(workspace.getByText('Selected step observation',{exact:true})).toBeVisible();
    await rows.nth(0).getByRole('button').click();
    await expect(workspace.locator('.automation-instruction-readable').first()).toContainText('Open URL');
    await expect(workspace.locator('.automation-engineer-browser-address')).toContainText('/cart');
    await rows.nth(1).getByRole('button').click();
    await expect(rows.nth(1).getByRole('button')).toHaveAttribute('aria-current','step');
    await expect(workspace.locator('.automation-engineer-browser-address')).toContainText('/step-2');
    await page.evaluate(()=>window.advanceTo(8));
    await expect(rows.nth(7).getByRole('button')).toHaveAttribute('aria-current','step');
    await expect(rows.nth(7).getByRole('button')).toHaveAttribute('aria-busy','true');
    await expect(list.locator('[aria-busy="true"]')).toHaveCount(1);
    await expect(workspace.locator('.automation-engineer-browser-address')).toContainText('/step-8');
    await expect.poll(()=>list.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
    const visible=await rows.nth(7).evaluate(element=>{const item=element.getBoundingClientRect(),viewport=element.parentElement.getBoundingClientRect();return item.top>=viewport.top-1&&item.bottom<=viewport.bottom+1});assert.ok(visible,'Automatic following scrolls the active row inside the command list');
    for(const theme of ['light','dark']){
      await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
      for(const tab of ['Instructions','Source','Model request','Model response']){
        await workspace.getByRole('tab',{name:tab,exact:true}).click();
        if(tab.startsWith('Model'))await expect(workspace.getByRole('region',{name:'Section model '+(tab==='Model request'?'request':'response'),exact:true})).toContainText(tab==='Model request'?'Develop the active checkout step':'section-8');
        await workspace.screenshot({path:'/tmp/qaira-engineer-workspace/sequential-desktop-'+theme+'-'+tab.toLowerCase().replaceAll(' ','-')+'.png'});
      }
    }
    await page.setViewportSize({width:390,height:844});assert.ok(await workspace.evaluate(element=>element.scrollWidth<=element.clientWidth+1));
    for(const theme of ['light','dark']){
      await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
      await workspace.locator('.automation-engineer-commands').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/qaira-engineer-workspace/sequential-mobile-'+theme+'.png'});
      for(const tab of ['Instructions','Source','Model request','Model response']){
        await workspace.getByRole('tab',{name:tab,exact:true}).click();await workspace.locator('.automation-engineer-implementation').scrollIntoViewIfNeeded();
        await page.screenshot({path:'/tmp/qaira-engineer-workspace/sequential-mobile-'+theme+'-'+tab.toLowerCase().replaceAll(' ','-')+'.png'});
      }
    }
    assert.deepEqual(await page.evaluate(()=>window.buildDataReads),[{activity:'build-one',id:'bound-test-data'}]);
    await page.evaluate(()=>window.revoke('data.view'));
    await expect(rows.nth(1)).toContainText('Enter @t.email');
    await expect(workspace.getByText('Test data fixed for this build',{exact:true})).toHaveCount(0);
    assert.doesNotMatch(await workspace.innerText(),/generated\.qa48274@example\.test/,'Revoking data.view hides previously cached resolved values');
  });
});

test('resolved build values are never fetched without data permission', { timeout: 90_000 }, async () => {
  await runFixture('sequence-denied', async page => {
    const workspace=page.getByRole('region',{name:'Automation engineer workspace',exact:true});
    const rows=workspace.getByRole('list',{name:'Manual steps to automate'}).locator(':scope > li');
    await expect(rows).toHaveCount(8);
    await expect(rows.nth(1).getByRole('button')).toBeDisabled();
    await page.evaluate(()=>window.advanceTo(2));
    await expect(rows.nth(1)).toContainText('Enter @t.email');
    assert.deepEqual(await page.evaluate(()=>window.buildDataReads),[]);
    assert.doesNotMatch(await workspace.innerText(),/generated\.qa48274@example\.test/);
    await expect(rows.nth(1).getByRole('button')).toHaveAttribute('aria-busy','true');
  });
});

test('prompt-planned steps reveal frozen actual values only after the prior step is performed, generated and saved', {timeout:90_000}, async()=>runFixture('prompt',async page=>{
  const activity=page.getByRole('region',{name:'Automation engineer activity',exact:true});
  const workspace=page.getByRole('region',{name:'Automation engineer workspace',exact:true});
  const refresh=()=>activity.getByRole('button',{name:'Refresh activity',exact:true}).click();
  await expect(workspace.getByText('Planning the first step',{exact:true})).toBeVisible();
  await expect(workspace.getByRole('list',{name:'Planned automation steps'}).locator('button:disabled')).toHaveCount(3);
  await page.evaluate(()=>window.planPrompt());await refresh();
  const rows=workspace.getByRole('list',{name:'Automation sections'}).locator(':scope > li');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Enter generated.qa48274@example.test');
  await expect(rows.nth(0)).toContainText('generated.qa48274@example.test is entered');
  await expect(rows.nth(0).getByRole('button')).toHaveAttribute('aria-current','step');
  await expect(rows.nth(1).getByRole('button')).toBeDisabled();
  assert.doesNotMatch(await workspace.innerText(),/Confirm account|Welcome/);
  assert.doesNotMatch(await rows.nth(1).getByRole('button').getAttribute('aria-label'),/email|Confirm|Welcome/);
  await rows.nth(0).getByRole('button').focus();await page.keyboard.press('ArrowDown');
  await expect(rows.nth(0).getByRole('button')).toHaveAttribute('aria-current','step');
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert.equal(await rows.nth(1).locator('.automation-engineer-wave').first().evaluate(el=>getComputedStyle(el).animationName),'automation-engineer-wave');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await rows.nth(1).locator('.automation-engineer-wave').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.evaluate(()=>{const rows=window.currentActivity.metadata.step_progress;rows[0].instruction_status='validated';rows[0].status='completed';rows[1].status='in_progress'});await refresh();
  await expect(rows.nth(1).getByRole('button')).toBeDisabled();
  await expect(rows.nth(0).getByRole('button')).toHaveAttribute('aria-current','step');
  await page.evaluate(()=>{window.currentActivity.metadata.step_progress[0].instruction_status='saved'});await refresh();
  await expect(rows.nth(1).getByRole('button')).toBeDisabled();
  assert.doesNotMatch(await workspace.innerText(),/Confirm account|Welcome/);
  await workspace.screenshot({path:'/tmp/qaira-engineer-workspace/prompt-pending-save-desktop.png'});
  await page.evaluate(()=>{window.currentActivity.metadata.step_progress[0].development_status='completed'});await refresh();
  await expect(rows.nth(1).getByRole('button')).toBeEnabled();
  await expect(rows.nth(1).getByRole('button')).toHaveAttribute('aria-current','step');
  await expect(rows.nth(1)).toContainText('Confirm account generated.qa48274@example.test');
  await expect(rows.nth(1)).toContainText('Welcome generated.qa48274@example.test');
  await expect(rows.nth(0)).toContainText('Saved · Not run');
  await workspace.screenshot({path:'/tmp/qaira-engineer-workspace/prompt-next-step-desktop.png'});
}));

test('isolated verification has its own source-bound result and step failure view',{timeout:90000},async()=>runFixture('manual',async page=>{
 const activity=page.getByRole('region',{name:'Automation engineer activity',exact:true}),workspace=page.getByRole('region',{name:'Automation engineer workspace',exact:true});
 await page.evaluate(()=>{window.currentActivity.metadata.verification_by_case={at1:{status:'blocked',phase:'complete',source_fingerprint:'a'.repeat(64),attempts:1,repair_count:0,message:'A locator lookup failed after an application interaction. Another run needs a verified fixture reset.',failure:{step_id:'two',operation_index:2,code:'AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED',action_outcome:'not_attempted'}}};});
 await activity.getByRole('button',{name:'Refresh activity',exact:true}).click();await expect(activity.getByRole('region',{name:'Generated test verification'})).toContainText('Verification needs review');
 await workspace.getByRole('tab',{name:'Verification',exact:true}).click();const pane=workspace.getByRole('region',{name:'Verification for selected step'});await expect(pane).toContainText('AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED');await expect(pane).toContainText('aaaaaaaaaaaa');await expect(pane).toContainText('Changes to Plan require a new run');
}));
