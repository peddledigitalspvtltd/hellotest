import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const root = new URL('../../../platform/frontend/', import.meta.url);
test('Shared Section library edits instructions and retains executable assets through wording improvement', {timeout:90000}, async () => {
  const source=await readFile(new URL('./sharedStepAuthoringSave.test.mjs',import.meta.url),'utf8');
  let fixture=runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture=fixture.replace("initialEntries:['/shared-steps?group=group-1']","initialEntries:['/shared-steps?view=automation&group=group-1']");
  fixture=fixture.replace('const client=new QueryClient', `groups[0].steps[0].automation_code='await page.reload();';groups[0].steps[0].api_request={method:'GET',url:'https://fixture.example.test'};
    window.improves=0;api.testCases.rephraseStep=async()=>{window.improves++;return{step:{action:'Sign in with the reviewed fixture',expected_result:'Reviewed home is shown',step_type:'api'}};};
    const client=new QueryClient`);
  const name='shared-section-library-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
  try {
    await writeFile(tsx,fixture);await writeFile(html,`<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>{errors.push('Unexpected API');return route.abort();});page.setDefaultTimeout(10000);
    await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`);
    await page.getByLabel('Group name').waitFor();await page.getByRole('button',{name:'Step 1 actions',exact:true}).click();
    await page.getByRole('menuitem',{name:'Edit instructions',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Shared Section instructions',exact:true});await dialog.waitFor();
    assert.equal(await page.evaluate(()=>window.writes.length),0);await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    await page.getByRole('button',{name:'AI Improve Steps',exact:true}).click();await page.waitForFunction(()=>window.improves===1);await page.getByText('Sign in with the reviewed fixture',{exact:true}).first().waitFor();
    await page.getByRole('button',{name:'Save Shared Section Group',exact:true}).click();await page.waitForFunction(()=>window.writes.length===1);
    const step=await page.evaluate(()=>window.writes[0].input.steps[0]);assert.equal(step.step_type,'web');assert.equal(step.automation_code,'await page.reload();');assert.equal(step.api_request.url,'https://fixture.example.test');assert.equal(step.action,'Sign in with the reviewed fixture');
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await Promise.all([rm(html,{force:true}),rm(tsx,{force:true})]);}
});
