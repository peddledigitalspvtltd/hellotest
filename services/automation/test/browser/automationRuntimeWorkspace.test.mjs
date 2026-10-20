import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {expect}=createRequire(require.resolve(process.env.PLAYWRIGHT_MODULE||'playwright'))('playwright/test');
const root=new URL('../../../platform/frontend/',import.meta.url);
test('actual automation workspace presents runtime-specific authoring and recording for all four platforms',{timeout:90000},async()=>{
 const template=await readFile(new URL('../../../testing/test/browser/testCaseDataSets.test.mjs',import.meta.url),'utf8');
 let fixture=runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
 fixture=fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';", "import {AutomationPage} from '/services/automation/frontend/pages/AutomationPage';").replace('element:<TestCasesPage/>','element:<AutomationPage/>');
 fixture=fixture.replace("import '/src/catalog-list.css';", "import '/src/catalog-list.css';import '/src/product-experience.css';");
 fixture=fixture.replace('const client=new QueryClient',`const runtime=new URLSearchParams(location.search).get('runtime')||'web';
 api.appTypes.list=async()=>[{id:'a',project_id:'p',name:runtime,type:runtime}];item.automated='yes';item.automation_status='ready';
 steps.forEach(step=>{step.step_type=runtime;step.automation_code=runtime==='api'?'':runtime==='web'?'await page.goto("https://app.test");':'await '+runtime+'.tap("~login");';step.api_request=runtime==='api'?{method:'GET',url:'https://app.test/status',validations:[{kind:'status',expected:'200'}]}:null;});
 window.stepUpdates=[];api.testSteps.update=async(id,input)=>{window.stepUpdates.push(input);const target=steps.find(step=>step.id===id);Object.assign(target,input);return {...target};};
 const client=new QueryClient`);
  fixture=fixture.replace(/import '\/src\/[^']+\.css';/g,'');
  fixture="import '/src/styles.css';import '/src/dark-theme.css';import '/src/modal-system.css';import '/src/workspace-layout.css';import '/src/catalog-list.css';import '/src/product-experience.css';\n"+fixture;
 const name='automation-runtimes-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser,page;
 try{
  await writeFile(tsx,fixture);await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>{errors.push('Unexpected API: '+route.request().url());return route.abort();});
  for(const runtime of ['web','api','android','ios']){
    await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html?runtime=${runtime}`);
    assert.equal(await page.locator('.automation-runtime-guide').count(),0,'Informational setup panel is removed');
    await page.getByRole('tab',{name:/^Plan/}).click();
    await page.getByRole('button',{name:'Add section',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Add section',exact:true}).getByLabel('New step type',{exact:true})).toHaveValue(runtime);
    await page.keyboard.press('Escape');
    if(runtime==='api'){
      await page.getByRole('tab',{name:'Source',exact:true}).click();await expect(page.locator('.automation-source-section').first()).toContainText('https://app.test/status');await page.getByRole('tab',{name:'Instructions',exact:true}).click();
      const section=page.locator('.automation-program-section').first();
      await section.getByRole('button',{name:'Edit',exact:true}).click();
      const editor=page.getByRole('dialog',{name:'Edit section',exact:true});
      await editor.getByLabel('API request JSON').fill(JSON.stringify({method:'POST',url:'https://app.test/orders',body_mode:'json',body:'{"name":"Test"}',validations:[{kind:'status',expected:'201'}]}));
      await editor.getByText('Execution options',{exact:true}).click();
      await editor.getByRole('checkbox',{name:'Optional step',exact:true}).check();
      await editor.getByRole('button',{name:'Save section',exact:true}).click();
      await page.waitForFunction(()=>window.stepUpdates.some(input=>input.api_request?.url==='https://app.test/orders'));
      const saved=await page.evaluate(()=>window.stepUpdates.at(-1));assert.equal(saved.api_request.validations[0].expected,'201');assert.match(saved.automation_code,/@hellotest-options optional/);
      await page.keyboard.press('Escape');
    }
    await page.getByRole('tab',{name:/Build tools/}).click();
    await expect(page.getByRole('button',{name:'Build plan',exact:true})).toBeEnabled();
    await expect(page.getByLabel('Build instructions (optional)')).toHaveValue('');
    if(runtime==='api')assert.equal(await page.getByRole('button',{name:/Record & playback/}).count(),0);
    else {
      await page.getByRole('button',{name:/Record & playback/}).click();
      if(runtime==='ios'||runtime==='android'){
        await page.getByRole('button',{name:runtime==='ios'?'Record on iOS device':'Record on Android device',exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:'Local Playwright',exact:true}).count(),0);
      }else await page.getByRole('button',{name:'Local Playwright',exact:true}).waitFor();
    }
    await mkdir('/tmp/hellotest-automation-screenshots',{recursive:true});await page.screenshot({animations:'disabled',path:`/tmp/hellotest-automation-screenshots/runtime-${runtime}.png`,fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.waitForFunction(()=>{const active=document.querySelector('.automation-detail-navigation [aria-selected="true"]');const box=active.getBoundingClientRect(),parent=active.parentElement.getBoundingClientRect();return box.left>=parent.left-1&&box.right<=parent.right+1;});await page.screenshot({animations:'disabled',path:`/tmp/hellotest-automation-screenshots/runtime-${runtime}-mobile.png`,fullPage:true});await page.setViewportSize({width:1440,height:1000});
  }
  assert.deepEqual(errors,[]);
 }catch(error){throw new Error(`${error.message}\n${await page?.locator('body').innerText().catch(()=> '')}`,{cause:error});}
 finally{await browser?.close();await rm(html,{force:true});await rm(tsx,{force:true});}
});
