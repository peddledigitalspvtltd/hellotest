import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const cwd=resolve(fileURLToPath(new URL('../../../../',import.meta.url))),r=createRequire(cwd+'/testengine/backend/package.json'),{chromium}=r('playwright'),expect=r('playwright/test').expect.configure({timeout:15000});
const root=cwd+'/services/platform/frontend/';
const template=await readFile(cwd+'/services/testing/test/browser/testCaseDataSets.test.mjs','utf8');
let fixture=runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
fixture=fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';","import {AutomationPage} from '/services/automation/frontend/pages/AutomationPage';").replace('element:<TestCasesPage/>','element:<AutomationPage/>');
fixture=fixture.replace('const client=new QueryClient',`item.automated='yes';item.automation_status='ready';item.automation_start_url='https://fixture.test';const base={...steps[0]};steps.splice(0,steps.length,...Array.from({length:50},(_,i)=>({...base,id:'step-'+(i+1),step_order:i+1,action:'Section '+(i+1),expected_result:'Expected state '+(i+1),automation_code:'await page.locator("#save").click();'})));window.profile={commits:[],renders:0,rows:{}};window.probeCalls=[];api.testCases.automationAgentActivity=async()=>null;api.testCases.automationBuildStatus=async()=>null;api.testSteps.list=async()=>steps.map(step=>({...step}));api.testSteps.update=async(id,input)=>{window.probeCalls.push({id,input});Object.assign(steps.find(step=>step.id===id),input);return {...steps.find(step=>step.id===id)};};const client=new QueryClient`);
fixture=fixture.replace('<RouterProvider router={router}/>','<React.Profiler id="automation" onRender={(id,phase,duration)=>window.profile.commits.push({phase,duration})}><RouterProvider router={router}/></React.Profiler>');
fixture+="\nimport '/src/product-experience.css';";
test('typing in a fifty-step case updates only its row and Save reads the latest draft before blur', {timeout:180000}, async()=>{
const name='automation-profile-'+randomUUID();let browser;const errors=[];
try{
 await writeFile(root+name+'.tsx',fixture);await writeFile(root+name+'.html',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());});page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname,match=path.match(/\/test-cases\/([^/]+)\/automation\/authoring-state$/);if(match)return route.fulfill({contentType:'application/json',body:JSON.stringify({case_id:decodeURIComponent(match[1]),state:'idle',build:null,recording:null,can_build:true,can_record:true})});errors.push('Unexpected request '+path);return route.abort();});
 await page.route('**/services/automation/frontend/routes/AutomationCaseDetailPage.tsx*',async route=>{const response=await route.fetch();let body=await response.text();body=body.replace(/(function AutomationCaseDetailPage[^\n]*\{\n)/,'$1  globalThis.profile && (globalThis.profile.renders++);\n');await route.fulfill({response,body});});
 await page.route('**/services/automation/frontend/workspaces/case/AutomationCaseSteps.tsx*',async route=>{const response=await route.fetch();let body=await response.text();body=body.replace(/(planRowRendererRef.current = \(\{ step, group, precondition \}\) => \{\n)/,'$1 globalThis.profile && (globalThis.profile.rows[step.id]=(globalThis.profile.rows[step.id]||0)+1);\n');await route.fulfill({response,body});});
 await page.goto((process.env.VITE_TEST_URL||'http://127.0.0.1:5197')+'/'+name+'.html',{timeout:60000});await page.getByRole('tab',{name:/^Plan/}).click();await expect(page.locator('.automation-program-section')).toHaveCount(50);
 await page.locator('.automation-program-section').first().getByRole('button',{name:'Edit',exact:true}).click();const field=page.getByRole('combobox',{name:'Step 1 expected result',exact:true});await field.click();await page.evaluate(()=>{window.profile={commits:[],renders:0,rows:{}};});await field.pressSequentially(' edited',{delay:35});
 await expect(field).toHaveValue('Expected state 1 edited');const profile=await page.evaluate(()=>window.profile);assert.deepEqual(errors,[]);assert.deepEqual(Object.keys(profile.rows),['step-1']);assert.ok(profile.renders<=1, "Ordinary typing must not repeatedly render the case workspace.");await page.getByRole('button',{name:'Save section',exact:true}).click();await page.waitForFunction(()=>window.probeCalls.some(call=>call.input.expected_result==='Expected state 1 edited'));
}catch(error){error.message+='\nBrowser errors: '+JSON.stringify(errors);throw error;}finally{await browser?.close();await rm(root+name+'.tsx',{force:true});await rm(root+name+'.html',{force:true});}

});
