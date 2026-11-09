import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const expect=require('playwright/test').expect.configure({timeout:15000});
const root=new URL('../../../platform/frontend/',import.meta.url);

async function withCaseFixture(run) {
  const name='case-param-scope-'+randomUUID(); let browser;
  try {
    const source=await readFile(new URL('./testCaseDataSets.test.mjs',import.meta.url),'utf8');
    const template=runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
    const fixture=template.replace('const client=new QueryClient',`
      const stored=JSON.parse(localStorage.getItem('scope-case')||'null');
      item=stored?.item||{...item,title:'AI sign in @t.email',description:'Enter @t.email',review_status:'accepted',ai_generation_source:'interactive',ai_generation_review_status:'accepted',status:'ready',suite_ids:['suite'],parameter_values:{'t.email':'customer@example.test','t.tenant':'West'},test_data_set_ids:[],test_data_sets:[]};
      steps.splice(0,steps.length,...(stored?.steps||[{id:'s1',test_case_id:'case1',step_order:1,action:'Enter @t.email for @t.tenant',expected_result:'Welcome @t.email',step_type:'web',automation_code:'await page.fill("#email", params["t.email"]);',api_request:null},{id:'s2',test_case_id:'case1',step_order:2,action:'Lookup @t.email using @s.currency',expected_result:'Found @t.email',step_type:'api',automation_code:'',api_request:{method:'GET',url:'https://fixture.invalid/user?email=@t.email',headers:[],body:'',validations:[],captures:[{path:'$.email',parameter:'t.email'}]}}]));
      if(!stored&&new URLSearchParams(location.search).get('initial')==='run'){
        item={...item,title:'AI sign in @r.email',description:'Enter @r.email',parameter_values:{'r.email':'customer@example.test','t.tenant':'West'}};
        steps.forEach(step=>{step.action=step.action.replaceAll('@t.email','@r.email');step.expected_result=step.expected_result.replaceAll('@t.email','@r.email');step.automation_code=step.automation_code.replaceAll('t.email','r.email');if(step.api_request){step.api_request.url=step.api_request.url.replaceAll('@t.email','@r.email');step.api_request.captures[0].parameter='r.email';}});
      }
      let suite=stored?.suite||{id:'suite',display_id:'TS_1',app_type_id:'a',name:'Login suite',parameter_values:{'s.other':'Keep','s.currency':'USD'}};
      api.testSuites.list=async()=>[structuredClone(suite)];api.testDataSets.list=async()=>[];
      const persist=()=>localStorage.setItem('scope-case',JSON.stringify({item,steps,suite}));
      api.testCases.get=async()=>structuredClone(item);
      api.testCases.update=async(id,input)=>{window.updates.push(structuredClone(input));item={...item,...input,revision:item.revision+1};if(input.steps)steps.splice(0,steps.length,...structuredClone(input.steps));persist();return {updated:true,revision:item.revision};};
      window.holdSuiteSave=false;window.suiteSavePending=false;
      api.testSuites.update=async(id,input)=>{if(window.holdSuiteSave){window.suiteSavePending=true;await new Promise(resolve=>window.releaseSuiteSave=resolve);}suite={...suite,...input};persist();window.suiteSavePending=false;return {updated:true};};
      const restricted=new URLSearchParams(location.search).get('restricted');
      if(restricted){Object.assign(session.user,{role:'member',workspace_permissions:['workspace.view'],project_permissions:{p:['testcase.view','testcase.update','data.view','suite.view','suite.update','automation.code.view']}});sessionStorage.write(session);}
      if(restricted==='plain')steps.forEach(step=>{step.automation_code='';step.api_request=null;});
      if(restricted==='hidden')steps.forEach(step=>{step.automation_code='';step.api_request=null;step.automation_source_hidden=true;});
      window.currentScopeCase=()=>({item,steps,suite});
      window.saved=()=>JSON.parse(localStorage.getItem('scope-case')||'null');
      const client=new QueryClient`).replace("client.setQueryData(['feature-flags'],flags);", "client.setQueryData(['feature-flags'],flags);window.refreshSuiteQuery=parameter_values=>client.setQueryData(['test-case-suites','a'],[{...suite,parameter_values}]);");
    await writeFile(new URL(name+'.tsx',root),fixture);
    await writeFile(new URL(name+'.html',root),`<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',route=>{errors.push('Unexpected real API request');return route.abort();});
    const url=`${process.env.VITE_TEST_URL||'http://127.0.0.1:5199'}/${name}.html`;
    const open=async()=>{await page.getByRole('button',{name:/^Test Params/}).click();return page.getByRole('dialog',{name:'Test Params',exact:true});};
    try { await run({page,open,url,errors}); }
    catch(error){throw new Error(`${error.message}\nBrowser errors: ${JSON.stringify(errors)}\n${await page.locator('body').innerText().catch(()=> '')}`,{cause:error});}
  } finally {
    await browser?.close();await Promise.all([rm(new URL(name+'.tsx',root),{force:true}),rm(new URL(name+'.html',root),{force:true})]);
  }
}

test('accepted generated cases persist run/suite scope choices, defaults and rewritten steps across reloads',{timeout:120000},async()=>withCaseFixture(async({page,open,url,errors})=>{
    await page.goto(url);
    let dialog=await open();
    await dialog.getByRole('combobox',{name:'Scope for @t.email',exact:true}).selectOption('r');
    await expect(dialog.getByRole('combobox',{name:'Scope for @r.email',exact:true})).toHaveValue('r');
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(()=>window.updates.length),0,'a value-only autosave cannot separate the value migration from its step references');
    await dialog.getByRole('button',{name:'Save test case',exact:true}).click();
    await page.waitForFunction(()=>window.saved()?.item.parameter_values['r.email']==='customer@example.test');
    let saved=await page.evaluate(()=>window.saved());
    assert.equal(saved.item.parameter_values['t.email'],undefined);assert.equal(saved.item.title,'AI sign in @r.email');
    assert.equal(saved.steps[0].action,'Enter @r.email for @t.tenant');assert.equal(saved.steps[0].expected_result,'Welcome @r.email');
    assert.match(saved.steps[0].automation_code,/params\["r.email"\]/);assert.equal(saved.steps[1].api_request.url,'https://fixture.invalid/user?email=@r.email');
    assert.equal(saved.steps[1].api_request.captures[0].parameter,'r.email');
    assert.equal(saved.item.review_status,'accepted');
    await page.reload(); dialog=await open();
    await expect(dialog.getByRole('combobox',{name:'Scope for @r.email',exact:true})).toHaveValue('r');
    await expect(dialog.getByRole('combobox',{name:'Scope for @t.email',exact:true})).toHaveCount(0);
    await dialog.getByRole('combobox',{name:'Scope for @t.tenant',exact:true}).selectOption('s');
    await dialog.getByRole('button',{name:'Save test case',exact:true}).click();
    await page.waitForFunction(()=>window.saved()?.steps[0].action.includes('@s.tenant'));
    saved=await page.evaluate(()=>window.saved());
    assert.equal(saved.suite.parameter_values['s.tenant'],'West');assert.equal(saved.suite.parameter_values['s.other'],'Keep');
    assert.equal(saved.item.parameter_values['t.tenant'],undefined);assert.equal(saved.item.parameter_values['s.tenant'],undefined);
    await page.reload();dialog=await open();
    await expect(dialog.getByRole('combobox',{name:'Scope for @s.tenant',exact:true})).toHaveValue('s');
    await expect(dialog.getByRole('combobox',{name:'Scope for @t.tenant',exact:true})).toHaveCount(0);
    await page.setViewportSize({width:390,height:844});assert.equal(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true,'scope and value controls fit the mobile dialog');
    assert.deepEqual(errors,[]);
}));

test('accepted Run-default AI cases can move Run to Test and back while every binding survives reload',{timeout:120000},async()=>withCaseFixture(async({page,open,url,errors})=>{
  await page.goto(url+'?initial=run');
  let previous='r';
  for(const scope of ['t','r']){
    const dialog=await open();
    await expect(dialog.getByRole('combobox',{name:`Scope for @${previous}.email`,exact:true})).toHaveValue(previous);
    await dialog.getByRole('combobox',{name:`Scope for @${previous}.email`,exact:true}).selectOption(scope);
    await dialog.getByRole('button',{name:'Save test case',exact:true}).click();
    await page.waitForFunction(scope=>window.saved()?.item.parameter_values[scope+'.email']==='customer@example.test',scope);
    const saved=await page.evaluate(()=>window.saved());
    assert.equal(saved.item.parameter_values[previous+'.email'],undefined);
    assert.equal(saved.item.title,`AI sign in @${scope}.email`);
    assert.equal(saved.steps[0].action,`Enter @${scope}.email for @t.tenant`);
    assert.equal(saved.steps[0].expected_result,`Welcome @${scope}.email`);
    assert.ok(saved.steps[0].automation_code.includes(`params["${scope}.email"]`));
    assert.equal(saved.steps[1].api_request.url,`https://fixture.invalid/user?email=@${scope}.email`);
    assert.equal(saved.steps[1].api_request.captures[0].parameter,scope+'.email');
    await page.reload();previous=scope;
  }
  const dialog=await open();await expect(dialog.getByRole('combobox',{name:'Scope for @r.email',exact:true})).toHaveValue('r');
  assert.deepEqual(errors,[]);
}));

test('scope changes require automation build access whenever the case contains visible or hidden automation',{timeout:120000},async()=>withCaseFixture(async({page,open,url,errors})=>{
  for(const mode of ['visible','hidden']) {
    await page.goto(url+'?restricted='+mode);
    const dialog=await open();
    for(const name of ['email','tenant']) await expect(dialog.getByRole('combobox',{name:`Scope for @t.${name}`,exact:true})).toBeDisabled();
    // Even a synthetic change event must not bypass the persistence guard.
    await dialog.getByRole('combobox',{name:'Scope for @t.tenant',exact:true}).evaluate(select=>{select.value='r';select.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(()=>window.updates.length),0);
    assert.deepEqual(await page.evaluate(()=>window.currentScopeCase().item.parameter_values),{'t.email':'customer@example.test','t.tenant':'West'});
    if(mode==='visible')assert.match(await page.evaluate(()=>window.currentScopeCase().steps[0].automation_code),/params\["t.email"\]/);
  }
  await page.goto(url+'?restricted=plain');
  const dialog=await open();
  await expect(dialog.getByRole('combobox',{name:'Scope for @t.email',exact:true})).toBeEnabled();
  assert.deepEqual(errors,[]);
}));

test('an in-flight Suite save gates scope changes and a later Suite refresh preserves staged migrated defaults',{timeout:120000},async()=>withCaseFixture(async({page,open,url,errors})=>{
  await page.goto(url);
  let dialog=await open();
  await page.evaluate(()=>window.holdSuiteSave=true);
  const currency=dialog.locator('.step-parameter-row').filter({has:page.locator('code').filter({hasText:/^@s\.currency$/})});
  await currency.locator('textarea').fill('INR');
  await page.waitForFunction(()=>window.suiteSavePending);
  await expect(dialog.getByRole('combobox',{name:'Scope for @t.tenant',exact:true})).toBeDisabled();
  await page.evaluate(()=>{window.holdSuiteSave=false;window.releaseSuiteSave();});
  await page.waitForFunction(()=>!window.suiteSavePending);
  // The existing save can close the dialog while its cache revision settles.
  if(!await dialog.isVisible())dialog=await open();
  await expect(dialog.getByRole('combobox',{name:'Scope for @t.tenant',exact:true})).toBeEnabled();
  await dialog.getByRole('combobox',{name:'Scope for @t.tenant',exact:true}).selectOption('s');
  await page.evaluate(()=>window.refreshSuiteQuery({'s.other':'Keep','s.currency':'STALE'}));
  const tenant=dialog.locator('.step-parameter-row').filter({has:page.locator('code').filter({hasText:/^@s\.tenant$/})});
  await expect(tenant.locator('textarea')).toHaveValue('West');
  await dialog.getByRole('button',{name:'Save test case',exact:true}).click();
  await page.waitForFunction(()=>window.saved()?.steps[0].action.includes('@s.tenant'));
  const saved=await page.evaluate(()=>window.saved());
  assert.equal(saved.suite.parameter_values['s.tenant'],'West');
  assert.equal(saved.suite.parameter_values['s.currency'],'INR');
  assert.equal(saved.item.parameter_values['t.tenant'],undefined);
  await page.reload();dialog=await open();
  await expect(dialog.getByRole('combobox',{name:'Scope for @s.tenant',exact:true})).toHaveValue('s');
  assert.deepEqual(errors,[]);
}));
