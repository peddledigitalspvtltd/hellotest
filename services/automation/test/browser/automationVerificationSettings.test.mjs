import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright'),{expect}=require('playwright/test');
const root=new URL('../../../platform/frontend/',import.meta.url);
test('verification choice supports native and Playwright Test CLI runs with permission-aware MCP authoring',{timeout:60000},async()=>{
 const name='verification-settings-'+randomUUID();let browser;
 try{
  await writeFile(new URL(name+'.tsx',root),`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {AutomationBuildVerificationSettings} from '/services/automation/frontend/components/AutomationBuildVerificationSettings';import {automationBuildPipelineRequest} from '/services/automation/frontend/lib/automationBuildPipeline';import '/src/product-experience.css';function App(){const[mode,setMode]=useState('generate_only');const query=new URLSearchParams(location.search),canVerify=!query.has('denied'),interactive=!query.has('inspect');return <main style={{padding:24,maxWidth:600}}><AutomationBuildVerificationSettings mode={mode} onModeChange={setMode} canVerify={canVerify} interactive={interactive}/><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}} aria-label="Queued options">{JSON.stringify(automationBuildPipelineRequest({mode,driver:'mcp',canVerify,interactive}))}</pre></main>};createRoot(document.getElementById('root')).render(<App/>);`);
  await writeFile(new URL(name+'.html',root),`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/${name}.tsx"></script></html>`);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844}}),base=(process.env.VITE_TEST_URL||'http://127.0.0.1:5197')+'/'+name+'.html';
  await page.goto(base);const choice=page.getByRole('combobox',{name:'After generating'});await expect(choice).toHaveValue('generate_only');
  await choice.selectOption('verify_repair');await expect(page.getByLabel('Queued options')).toContainText('"verification_mode":"verify_repair"');await expect(page.getByLabel('Queued options')).toContainText('"verification_driver":"native"');await expect(page.getByText(/Data, actions and expected results stay fixed/)).toBeVisible();
  assert.equal(await page.getByRole('option',{name:/CLI/}).count(),2);
  await choice.selectOption('verify_cli');await expect(page.getByLabel('Queued options')).toContainText('"verification_mode":"verify"');await expect(page.getByLabel('Queued options')).toContainText('"verification_driver":"playwright_test_cli"');await expect(page.getByLabel('Queued options')).toContainText('"browser_driver":"mcp"');await expect(page.getByText(/This performs application actions again/)).toBeVisible();
  await choice.selectOption('verify_repair_cli');await expect(page.getByLabel('Queued options')).toContainText('"verification_mode":"verify_repair"');await expect(page.getByText(/through Playwright Test CLI/)).toBeVisible();await expect(page.getByText(/Data, actions and expected results stay fixed/)).toBeVisible();
  assert.ok(await page.locator('body').evaluate(element=>element.scrollWidth<=window.innerWidth));
  await mkdir('/tmp/qaira-verification-ui',{recursive:true});await page.screenshot({path:'/tmp/qaira-verification-ui/mobile.png'});
  for(const suffix of ['?denied','?inspect']){await page.goto(base+suffix);for(const mode of ['verify','verify_repair','verify_cli','verify_repair_cli'])await expect(choice.locator(`option[value="${mode}"]`)).toHaveAttribute('disabled','');await expect(page.getByLabel('Queued options')).toContainText('"verification_mode":"generate_only"');await expect(page.getByLabel('Queued options')).toContainText('"verification_driver":"native"');}
 }finally{await browser?.close();await Promise.all(['tsx','html'].map(extension=>rm(new URL(name+'.'+extension,root),{force:true})));}
});
