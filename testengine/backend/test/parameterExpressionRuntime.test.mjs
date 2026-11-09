import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {createWebRunSession} from '../dist/lib/webEngine.js';
import {runAutomationVerification,validateAutomationVerificationRequest} from '../dist/lib/automationVerification.js';
import {runAutomationVerificationCli} from '../dist/lib/automationVerificationCli.js';
import {compileRecordedProgram} from '../dist/lib/automationVerificationProgram.js';
import {PARAMETER_EXPRESSIONS_MARKER} from '../dist/lib/playwrightBindings.js';

function fakeBrowser() {
 const calls=[],fields=new Map();
 let currentUrl='https://fixture.test/form',closed=false;
 const page={
  url:()=>currentUrl,isClosed:()=>closed,video:()=>null,on(){},setDefaultTimeout(){},setDefaultNavigationTimeout(){},
  async goto(url){calls.push(['goto',url]);currentUrl=url;},async close(){closed=true;},
  locator(selector){
   if(!fields.has(selector))fields.set(selector,{count:async()=>1,waitFor:async()=>{},click:async()=>{calls.push(['click',selector]);},
    value:'',async fill(value){calls.push(['fill',selector,value]);this.value=value;},async inputValue(){return this.value;}});
   return fields.get(selector);
  }
 };
 const context={pages:()=>[page],newPage:async()=>page,on(){},off(){},setDefaultTimeout(){},setDefaultNavigationTimeout(){},
  route:async()=>{calls.push(['route']);},tracing:{start:async()=>{},stop:async()=>{}},close:async()=>{closed=true;}};
 const browser={newContext:async()=>context,close:async()=>{closed=true;}};
 return {page,browser,calls};
}

test('saved native Web Run detects each original section marker and preserves token-looking frozen data',async t=>{
 const fake=fakeBrowser();
 t.mock.method(chromium,'launch',async()=>fake.browser);
 const run=createWebRunSession({
  engine_run_id:randomUUID(),hellotest_execution_id:randomUUID(),hellotest_test_case_id:'case',browser:'chromium',headless:true,
  run_timeout_seconds:30,max_repair_attempts:0,parameters_frozen:true,run_parameters:{'r.value':'@r.other','r.other':'LEGACY_RESOLVED'},
  manual_spec:{test_data:{}},web_engine:{active:'playwright'},
  artifact_policy:{trace_mode:'off',video_mode:'off',screenshot_on_failure:false,capture_console:false,capture_network:false}
 });
 t.after(()=>run.stop('passed'));
 await run.start();
 for(const [order,id,code] of [
  [1,'marked',`// ordinary comment\n${PARAMETER_EXPRESSIONS_MARKER}\nawait page.locator("#marked").fill(params["r.value"]);if(await page.locator("#marked").inputValue()!==params["r.value"])throw Error("Inserted data was reparsed");`],
  [2,'legacy','await page.locator("#legacy").fill("@r.value");if(await page.locator("#legacy").inputValue()!==params["r.value"])throw Error("Legacy interpolation changed");'],
  [3,'legacy-reference','await page.locator("#legacy-reference").fill("@r.other");if(await page.locator("#legacy-reference").inputValue()!==params["r.other"])throw Error("Legacy mode did not resume");']
 ]){
  const result=await run.runStep({id,order,step_type:'web',action:'Use frozen data',expected_result:'Its literal value is retained',automation_code:code});
  assert.equal(result.status,'passed',result.note);
 }
 assert.deepEqual(fake.calls.filter(call=>['fill','click','goto'].includes(call[0])),[
  ['fill','#marked','@r.other'],['fill','#legacy','@r.other'],['fill','#legacy-reference','LEGACY_RESOLVED']
 ]);
});

function verificationRequest() {
 const op=(name,args)=>({name,arguments:args});
 const marked=[op('browser_fill',{locator:'#marked',value:'params["r.value"]'}),op('browser_assert',{assertion:'url',value:'params["r.url"]'})];
 const legacy=[op('browser_fill',{locator:'#legacy',value:'@r.other'}),op('browser_assert',{assertion:'url',value:'params["r.url"]'})];
 return {schema_version:1,verification_id:randomUUID(),lease_token:randomUUID(),start_url:'https://fixture.test/form?return=@r.other',
  parameters:{'r.value':'@r.other','r.other':'LEGACY_RESOLVED','r.url':'https://fixture.test/form?return=@r.other'},
  sections:[{step_id:'marked',automation_code:PARAMETER_EXPRESSIONS_MARKER+'\n'+compileRecordedProgram(marked).source,operations:marked},
   {step_id:'legacy',automation_code:compileRecordedProgram(legacy).source,operations:legacy}],
  replay_policy:{mode:'authorized_run',allow_mutations:true},timeout_ms:2000};
}

test('isolated verification detects original section mode while preserving closed-ledger and origin checks',async()=>{
 const fake=fakeBrowser(),request=verificationRequest(),before=structuredClone(request);
 const result=await runAutomationVerification(request,{validateTarget:async()=>{},createProxy:async()=>({server:'http://unused.fixture',close:async()=>{}}),launchBrowser:async()=>fake.browser});
 assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.completed_operations,4);assert.equal(result.completed_interactions,2);
 assert.deepEqual(fake.calls.filter(call=>['goto','fill'].includes(call[0])),[
  ['goto',request.start_url],['fill','#marked','@r.other'],['fill','#legacy','LEGACY_RESOLVED']
 ]);
 assert.ok(fake.calls.some(call=>call[0]==='route'),'The existing owned-context network boundary remains installed');
 assert.deepEqual(request,before);
 const tampered=verificationRequest();tampered.sections[0].automation_code+='\nprocess.exit(0);';
 assert.throws(()=>validateAutomationVerificationRequest(tampered),{code:'AUTOMATION_VERIFICATION_CONTRACT_INVALID'});
 const foreign=verificationRequest();foreign.parameters['r.url']='https://foreign.test/';
 assert.throws(()=>validateAutomationVerificationRequest(foreign),{code:'AUTOMATION_VERIFICATION_CONTRACT_INVALID'});
});

test('CLI verification preserves marked source and literal serialized values before any child starts',async()=>{
 const request=verificationRequest();request.execution_driver='playwright_test_cli';
 request.parameters['r.value']='reader+@r.other.test';
 const before=structuredClone(request),controller=new AbortController();controller.abort();
 const result=await runAutomationVerificationCli(request,{signal:controller.signal});
 assert.equal(result.status,'cancelled');assert.equal(result.completed_operations,0);assert.deepEqual(request,before);
});
