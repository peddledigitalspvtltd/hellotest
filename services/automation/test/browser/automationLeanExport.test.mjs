import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {assertTypeScriptExportCompiles} from './playwrightExportFixture.mjs';

const require=createRequire(import.meta.url);
const engineRequire=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {compileRecordedProgram}=require('../../backend/lib/automationRecordedProgram');
const {createPortableAutomationArtifact}=require('../../backend/lib/automationPortableArtifact');

test('lean native export waits for field validation and still rejects a real error in a fresh Playwright runner',{timeout:90000},async t=>{
 const server=createServer((request,response)=>{
  response.setHeader('Content-Type','text/html');
  response.end(`<label>Email<input id="email" type="email" required aria-invalid="true" aria-describedby="hint"></label><p id="hint">Use your test address</p><script>document.querySelector('input').oninput=()=>{if(!location.pathname.includes('invalid'))setTimeout(()=>document.querySelector('input').setAttribute('aria-invalid','false'),100)}</script>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const directory=await mkdtemp(path.join(tmpdir(),'qaira-lean-export-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const program=compileRecordedProgram([
  {name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}},
  {name:'browser_assert',arguments:{assertion:'value',locator:'#email',value:'@t.email'}},
  {name:'browser_assert',arguments:{assertion:'field_valid',locator:'#email'}}
 ]);
 assert.ok(program);
 const source=await createPortableAutomationArtifact({testCase:{id:'lean',title:'Field validation'},updates:[{step:{id:'email',step_order:1,step_type:'web',action:'Enter a valid email without errors'},automation_code:program.source}],values:{'t.email':'fixture@example.test'},baseURL:origin,runtimeSettings:{assertion_timeout_ms:300}});
 assert.doesNotMatch(source,/const findTab|uploadRemoteFile:|lastResponse|request.fetch\(/);
 assert.match(source,/expect.poll/,'custom native validity still needs a bounded retrying predicate');
 const file=path.join(directory,'automation.spec.ts');await writeFile(file,source);assertTypeScriptExportCompiles([file]);
 const playwrightRoot=path.dirname(engineRequire.resolve('playwright/package.json'));
 await writeFile(file,source.replace("'@playwright/test'",JSON.stringify(path.join(playwrightRoot,'test.mjs'))));
 const config=path.join(directory,'playwright.config.cjs');
 await writeFile(config,'module.exports='+JSON.stringify({testDir:directory,testMatch:'*.spec.ts',outputDir:path.join(directory,'results'),workers:1,reporter:'json',use:{headless:true,launchOptions:{executablePath:process.env.CHROME_EXECUTABLE||engineRequire('playwright').chromium.executablePath()}}}));
 const run=base=>new Promise((resolve,reject)=>{
  let output='',errors='';const child=spawn(process.execPath,[path.join(playwrightRoot,'cli.js'),'test','--config',config],{env:{...process.env,QAIRA_BASE_URL:base}});
  child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);child.once('error',reject);child.once('close',code=>resolve({code,output,errors}));
 });
 const passed=await run(origin);assert.equal(passed.code,0,passed.output+passed.errors);assert.equal(JSON.parse(passed.output).stats.expected,1);
 const failed=await run(origin+'/invalid');assert.equal(failed.code,1,failed.output+failed.errors);assert.equal(JSON.parse(failed.output).stats.unexpected,1);
 const wrapped=await createPortableAutomationArtifact({testCase:{id:'wrapped',title:'Aliased compatibility bindings'},baseURL:origin,updates:[
  {step:{id:'positional',step_order:1,step_type:'web',action:'Fill through positional helper'},automation_code:'async function automate(current, ui, check) { await ui.fill("#email","fixture@example.test"); await check(current.locator("#email")).toHaveValue("fixture@example.test"); }'},
  {step:{id:'context',step_order:2,step_type:'web',action:'Use computed context binding'},automation_code:'async function automate(ctx) { await ctx["web"].expectValue("#email","fixture@example.test"); }'}
 ]});
 await writeFile(file,wrapped);assertTypeScriptExportCompiles([file]);
 await writeFile(file,wrapped.replace("'@playwright/test'",JSON.stringify(path.join(playwrightRoot,'test.mjs'))));
 const legacy=await run(origin);assert.equal(legacy.code,0,legacy.output+legacy.errors);assert.equal(JSON.parse(legacy.output).stats.expected,1);
});
