import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const {expect}=require('playwright/test');
const root=new URL('../../../platform/frontend/',import.meta.url);

test('automation platform selection is mandatory, constrains steps and recording, and preserves mode drafts', {timeout:90000}, async()=>{
  const template=await readFile(new URL('../../../testing/test/browser/testCaseDataSets.test.mjs',import.meta.url),'utf8');
  let fixture=runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture=fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';", "import {AutomationPage} from '/services/automation/frontend/pages/AutomationPage';").replace('element:<TestCasesPage/>','element:<AutomationPage/>');
  fixture=fixture.replace(/import '\/src\/[^']+\.css';/g,'');
  fixture="import '/src/styles.css';import '/src/dark-theme.css';import '/src/modal-system.css';import '/src/workspace-layout.css';import '/src/catalog-list.css';import '/src/product-experience.css';\n"+fixture;
  fixture=fixture.replace('const client=new QueryClient', `
    item.automated='yes';item.automation_status='ready';item.automation_case_type='web';item.parameter_values={'t.user':'Saved customer'};item.test_data_options.parameter_overrides=['t.user'];item.suite_ids=['suite'];api.testSuites.list=async()=>[{id:'suite',app_type_id:'a',name:'Contact suite',parameter_values:{'s.region':'north'}}];
    steps[0].automation_code='await web.fill("#name", "@t.user");';steps[1].automation_code='await web.expectVisible("#success");';
    window.recorderStarts=[];api.testCases.startRecorderSession=async(id,input)=>{window.recorderStarts.push({id,input,parameters:structuredClone(item.parameter_values)});return {id:'record-session',status:'running',recorder_mode:'remote'};};
    window.creates=[];api.testCases.create=async input=>{window.creates.push(structuredClone(input));return {id:'new-case'};};
    const client=new QueryClient`);
  const name='automation-platform-'+randomUUID(), html=new URL(name+'.html',root), tsx=new URL(name+'.tsx',root);
  let browser,page;
  try {
    await writeFile(tsx,fixture);await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',route=>{errors.push('Unexpected API '+route.request().url());return route.abort();});
    await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`);
    await page.getByRole('tab',{name:/^Details/}).click();
    const savedType=page.getByLabel('Automation case type',{exact:true});await expect(savedType).toHaveValue('web');
    await savedType.selectOption('api');await expect(page.getByRole('button',{name:'Save details',exact:true})).toBeDisabled();await expect(page.getByRole('alert')).toContainText('contains web steps');
    await savedType.selectOption('unified');await expect(page.getByRole('button',{name:'Save details',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Save details',exact:true}).click();
    await page.waitForFunction(()=>window.updates.length===1);const update=await page.evaluate(()=>window.updates[0]);assert.equal(update.automation_case_type,'unified');assert.equal(update.parameter_values['t.user'],'Saved customer');
    await page.getByRole('tab',{name:/^Plan/}).click();await page.getByRole('button',{name:'Parameters',exact:true}).click();
    const parameterDialog=page.getByRole('dialog',{name:'Automation case parameter values'});
    const userRow=parameterDialog.locator('.step-parameter-row').filter({has:page.locator('code').filter({hasText:/^@t\.user$/})});
    await userRow.locator('textarea').first().fill('Recorded customer');await page.keyboard.press('Escape');
    await page.getByRole('tab',{name:/^Build tools/}).click();await page.getByRole('button',{name:/Record & playback/}).click();await page.getByLabel('Start URL (required)',{exact:true}).fill('https://fixture.example.test');
    await page.getByRole('button',{name:'Remote browser',exact:true}).click();await page.waitForFunction(()=>window.recorderStarts.length===1);
    const recorded=await page.evaluate(()=>window.recorderStarts[0]);assert.equal(recorded.parameters['t.user'],'Recorded customer','edited parameters are saved before the recorder snapshots them');assert.equal(recorded.input.test_suite_id,'suite');
    await page.reload();await page.getByRole('button',{name:'Back to automation case tiles',exact:true}).click();await page.getByRole('button',{name:'Create automation case',exact:true}).click();
    const create=page.getByRole('dialog',{name:'Create automation case',exact:true}), type=create.getByLabel('Automation case type',{exact:true});
    await create.getByLabel('Automation case name',{exact:true}).fill('Create API contact');await create.getByRole('button',{name:'Author steps',exact:true}).click();
    await expect(type).toHaveValue('');await expect(type).toHaveAttribute('required','');await expect(create.getByRole('button',{name:'Create case',exact:true})).toBeDisabled();await expect(create.getByRole('button',{name:'Add step',exact:true})).toBeDisabled();
    assert.deepEqual(await type.locator('option:not([value=""])').evaluateAll(options=>options.map(option=>option.value)),['web','api','android','ios','unified']);
    await type.selectOption('api');assert.equal(await create.getByRole('button',{name:'Record flow',exact:true}).count(),0);
    await create.getByRole('button',{name:'Add step',exact:true}).click();
    await expect(create.getByLabel('Draft step 1 type',{exact:true})).toHaveValue('api');assert.deepEqual(await create.getByLabel('Draft step 1 type',{exact:true}).locator('option').evaluateAll(options=>options.map(option=>option.value)),['api']);
    await create.getByLabel('Draft step 1 action',{exact:true}).fill('POST @r.api_base/contacts with @t.user');await create.getByLabel('Draft step 1 expected result',{exact:true}).fill('Status 201 and the created contact name equals @t.user');
    await create.getByRole('button',{name:'AI agent',exact:true}).click();await create.getByLabel('Build instructions (optional)',{exact:true}).fill('Assert the response and reuse the supplied parameters.');
    await type.selectOption('web');await expect(create.getByRole('button',{name:'Record flow',exact:true})).toBeVisible();await expect(create.locator('.automation-draft-behavior').first().locator('summary')).toContainText('POST');await create.locator('.automation-draft-behavior').first().locator('summary').click();
    await create.getByRole('button',{name:'Record flow',exact:true}).click();await create.getByRole('button',{name:'Author steps',exact:true}).click();await create.getByRole('button',{name:'AI agent',exact:true}).click();
    await expect(create.getByLabel('Build instructions (optional)',{exact:true})).toHaveValue('Assert the response and reuse the supplied parameters.');await expect(create.getByLabel('Draft step 1 type',{exact:true})).toHaveValue('api');
    await type.selectOption('ios');await create.getByRole('button',{name:'Author steps',exact:true}).click();await create.getByRole('button',{name:'Add step',exact:true}).click();await expect(create.getByLabel('Draft step 2 type',{exact:true})).toHaveValue('ios');
    await create.getByLabel('Draft step 2 action',{exact:true}).fill('Tap the contact');await type.selectOption('api');await expect(create.getByRole('alert')).toContainText('does not support ios steps');await expect(create.getByRole('button',{name:'Create case',exact:true})).toBeDisabled();
    await create.getByRole('button',{name:'Remove draft step 2',exact:true}).click();await expect(create.getByRole('button',{name:'Create case',exact:true})).toBeEnabled();
    await mkdir('/tmp/qaira-automation-platform',{recursive:true});await create.screenshot({path:'/tmp/qaira-automation-platform/create-api.png'});await page.setViewportSize({width:390,height:844});assert.ok(await create.evaluate(element=>element.scrollWidth<=element.clientWidth+1));await create.screenshot({path:'/tmp/qaira-automation-platform/create-api-mobile.png'});await page.setViewportSize({width:1440,height:1000});
    await create.getByRole('button',{name:'Create case',exact:true}).click();await page.waitForFunction(()=>window.creates.length===1);const created=await page.evaluate(()=>window.creates[0]);assert.equal(created.automation_case_type,'api');assert.equal(created.test_case_type,'functional');assert.equal(created.steps[0].step_type,'api');assert.match(created.steps[0].action,/@t\.user/);assert.match(created.steps[0].expected_result,/Status 201/);
    assert.deepEqual(errors,[]);
  } catch(error){await page?.screenshot({path:'/tmp/qaira-automation-platform-failure.png',fullPage:true});throw new Error(`${error.message}\n${JSON.stringify(await page?.locator('textarea').evaluateAll(elements=>elements.map(element=>({label:element.closest('label')?.textContent,aria:element.getAttribute('aria-label'),value:element.value}))).catch(()=> []))}\n${await page?.locator('body').innerText().catch(()=> '')}`,{cause:error});}
  finally{await browser?.close();await Promise.all([rm(html,{force:true}),rm(tsx,{force:true})]);}
});
