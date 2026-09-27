import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('../../../platform/frontend/',import.meta.url);
test('repository has a quiet toolbar, stable field selection and an editable DOM locator builder', {timeout:60000}, async()=>{
  const template=await readFile(new URL('../../../testing/test/browser/testCaseDataSets.test.mjs',import.meta.url),'utf8');
  let fixture=runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture=fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';", "import {AutomationPage} from '/services/automation/frontend/pages/AutomationPage';");
  fixture=fixture.replace('element:<TestCasesPage/>','element:<AutomationPage initialView="repository"/>');
  const dom='<form data-testid="login"><input id="email" name="email" aria-label="Email" type="email"><button id="submit">Sign in</button></form>';
  const row={id:'email',project_id:'p',app_type_id:'a',test_case_id:'case1',page_key:'Login',page_url:'https://app.example.test/login',locator_intent:'Email',locator:'input[name="email"]',locator_kind:'css',confidence:.8,metadata:{screen_name:'Login',object_name:'Email',object_role:'input / textbox',screen_dom_compressed:dom,dom_structure:'<input id="email" name="email" aria-label="Email" type="email">'}};
  fixture=fixture.replace('const client=new QueryClient',`api.testCases.learningCache=async()=>[${JSON.stringify(row)}];api.repositoryInspection.capabilities=async()=>({remote:{available:false},local:{available:true}});\nconst client=new QueryClient`);
  const name=`repository-locators-${randomUUID()}`;const html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);
  let browser,page;
  try{
    await writeFile(tsx,fixture);await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});page=await browser.newPage({viewport:{width:1600,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',route=>{errors.push(`Unexpected API ${route.request().url()}`);return route.abort();});
    await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`);
    await page.locator('.repository-agent-status').waitFor();
    const positions=await page.locator('.repository-toolbar').evaluate(element=>({right:element.getBoundingClientRect().right,status:element.querySelector('.repository-agent-status').getBoundingClientRect().right}));assert.ok(Math.abs(positions.right-positions.status)<4);
    assert.equal(await page.getByRole('button',{name:/AI Suggestions/}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Inspect evidence',exact:true}).count(),0);
    await page.getByRole('button',{name:'Inspect selected',exact:true}).click();
    await page.getByRole('tab',{name:/All fields/}).click();
    const check=page.getByRole('checkbox',{name:'Select email',exact:true});await check.check();await check.uncheck();await check.check();
    await page.getByRole('tab',{name:/^Selected/}).click();
    const builder=page.locator('.repository-locator-builder');await builder.waitFor();
    await builder.getByLabel('Parent CSS selector (optional)').fill('form[data-testid="login"]');
    await builder.getByLabel('Match index (optional, starts at 0)').fill('0');
    await builder.getByRole('button',{name:'Use this combination'}).click();assert.match(await builder.getByLabel('Locator',{exact:true}).inputValue(),/nth=0$/);
    await builder.getByRole('button',{name:'Apply locator'}).click();await page.getByText('Not validated',{exact:true}).first().waitFor();
    await page.getByRole('tab',{name:/All fields/}).click();
    assert.equal(await page.locator('.object-repository-inspector-candidate').count(),2,'Editing a locator must not duplicate the captured field');
    assert.equal(await page.getByRole('checkbox',{name:'Select email',exact:true}).isChecked(),true);
    await page.getByRole('tab',{name:/^Selected/}).click();
    assert.deepEqual(errors,[]);
    await mkdir('/tmp/hellotest-automation-screenshots',{recursive:true});await page.screenshot({path:'/tmp/hellotest-automation-screenshots/repository-locator.png',fullPage:true});
  }catch(error){throw new Error(`${error.message}\n${await page?.locator('body').innerText().catch(()=> '')}`,{cause:error});}
  finally{await browser?.close();await rm(html,{force:true});await rm(tsx,{force:true});}
});
