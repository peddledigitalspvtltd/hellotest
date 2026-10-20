const test=require('node:test'),assert=require('node:assert/strict');
const {prepareVerificationSections,applyLocatorRepair,runVerificationPipeline,fingerprint,validateVerificationReceipt}=require('../../backend/lib/automationVerificationPipeline');
const {compileRecordedProgram}=require('../../backend/lib/automationRecordedProgram');
const {normalizeBuildPipelineOptions}=require('../../backend/lib/automationBuildPipelineOptions');
const op=(name,args)=>({name,arguments:args});
const section=(operations=[op('browser_fill',{locator:'#old',value:'@r.name'}),op('browser_assert',{assertion:'value',locator:'#old',value:'@r.name'})])=>({step_id:'one',action:'Enter the full name',expected_result:'Name is entered',automation_code:compileRecordedProgram(operations).source,operations});
const snapshot={elements:[{locators_validated:true,locator_candidates:['#full-name']}]};
const failure={step_id:'one',operation_index:1,operation_kind:'browser_fill',code:'AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED',action_outcome:'not_attempted'};
const proposal={step_id:'one',operation_index:1,locator:'#full-name'};
const failed={status:'failed',verification_status:'unverified',failure,snapshot,replay_safe:true,completed_operations:0,completed_interactions:0,assertion_count:0};
const passed={status:'passed',verification_status:'verified',replay_safe:false,completed_operations:2,completed_interactions:1,assertion_count:1};
const receipt=(request,result)=>({schema_version:1,verification_id:request.verification_id,...(request.execution_driver?{execution_driver:request.execution_driver}:{}),browser:'chromium',duration_ms:10,...result});

test('legacy requests save only; MCP is required and verification needs explicit interaction authorization',()=>{
 assert.deepEqual(normalizeBuildPipelineOptions(),{verification_mode:'generate_only',browser_driver:'mcp',verification_driver:'native'});
 assert.throws(()=>normalizeBuildPipelineOptions({browser_driver:'cli'}),{code:'AUTOMATION_BUILD_OPTIONS_INVALID'});
 assert.throws(()=>normalizeBuildPipelineOptions({verification_mode:'verify'}),{code:'AUTOMATION_VERIFICATION_REQUIRES_BROWSER_ACTIONS'});
 assert.deepEqual(normalizeBuildPipelineOptions({verification_mode:'verify',verification_driver:'playwright_test_cli',allow_browser_actions:true}),{verification_mode:'verify',verification_driver:'playwright_test_cli',browser_driver:'mcp'});
 assert.throws(()=>normalizeBuildPipelineOptions({verification_mode:'verify',verification_driver:'cli',allow_browser_actions:true}),{code:'AUTOMATION_BUILD_OPTIONS_INVALID'});
 assert.equal(normalizeBuildPipelineOptions({verification_driver:'playwright_test_cli'}).verification_driver,'native','save-only cannot select an executable lane');
});
test('preparation freezes referenced values once, including empty data, and rejects unsupported source atomically',()=>{
 const row=section(),calls=[];const result=prepareVerificationSections([{id:'one',step_type:'web',...row}],{resolve:(name,args)=>{calls.push(name);return {...args,value:''};}});
 assert.equal(result.parameters['r.name'],'');assert.equal(calls.length,2);assert.equal(result.sections[0].automation_code,row.automation_code);
 for(const code of ['await page.locator("#old").fill("x"); process.exit();','// @hellotest-options skip\n'+row.automation_code,'// @HELLOTEST-OPTIONS optional\n'+row.automation_code])assert.throws(()=>prepareVerificationSections([{id:'one',step_type:'web',automation_code:code}],{}));
});
test('repair changes only matching interactive actions and preserves every assertion and navigation operation',()=>{
 const original=[section()],before=JSON.stringify(original),candidate=applyLocatorRepair(original,failure,proposal,snapshot);
 assert.ok(candidate);assert.equal(JSON.stringify(original),before);assert.equal(candidate[0].operations.length,2);
 assert.deepEqual(candidate[0].operations[0],op('browser_fill',{locator:'#full-name',value:'@r.name'}));assert.deepEqual(candidate[0].operations[1],original[0].operations[1]);
 const operations=[op('browser_fill',{locator:'#old',value:'@r.name'}),op('browser_assert',{assertion:'value',locator:'#old',value:'@r.name'}),
  op('browser_assert',{assertion:'field_valid',locator:'#old'}),op('browser_navigate',{url:'https://app.test/review'}),op('browser_click',{locator:'#old'}),op('browser_assert',{assertion:'text',locator:'#result',value:'Ready'})];
 const rows=[section(operations)],repaired=applyLocatorRepair(rows,failure,proposal,snapshot);assert.ok(repaired);
 assert.deepEqual(repaired[0].operations.filter(operation=>operation.name==='browser_assert'||operation.name==='browser_navigate'),operations.filter(operation=>operation.name==='browser_assert'||operation.name==='browser_navigate'));
 assert.equal(repaired[0].operations[4].arguments.locator,'#full-name');
 for(const input of [{...proposal,value:'different'},{...proposal,operation_index:2},{...proposal,step_id:'other'},{...proposal,locator:'#invented'}])assert.equal(applyLocatorRepair(original,failure,input,snapshot),null);
 assert.equal(applyLocatorRepair(original,failure,proposal,{elements:[...snapshot.elements,...snapshot.elements]}),null);
});
test('a failed assertion subject cannot be replaced by an unrelated validated visible heading',async()=>{
 const unrelated={elements:[{tag:'h1',accessible_role:'heading',accessible_name:'Unrelated header',displayed:true,locators_validated:true,locator_candidates:['#unrelated-header']}]};
 for(const assertion of ['visible','enabled','text','value','field_valid']){
  const operations=[op('browser_assert',{assertion,locator:'#required-receipt',...(['text','value'].includes(assertion)?{value:'Required receipt'}:{})})];
  const original=[section(operations)],before=JSON.stringify(original),assertionFailure={...failure,operation_kind:'browser_assert'};
  assert.equal(applyLocatorRepair(original,assertionFailure,{...proposal,locator:'#unrelated-header'},unrelated),null);
  assert.equal(JSON.stringify(original),before);
 }
 for(const executionDriver of ['native','playwright_test_cli'])for(const navigated of [false,true]){
  const operations=[...(navigated?[op('browser_navigate',{url:'https://app.test/receipt'})]:[]),op('browser_assert',{assertion:'visible',locator:'#required-receipt'})];
  const original=[section(operations)],before=JSON.stringify(original),phases=[];let runs=0,diagnoses=0,writes=0;
  const result=await runVerificationPipeline({mode:'verify_repair',executionDriver,sections:original,parameters:{},startUrl:'https://app.test/receipt',onProgress:summary=>phases.push(summary.phase),
   run:async request=>{runs++;return receipt(request,{...failed,snapshot:unrelated,completed_operations:navigated?1:0,failure:{...failure,operation_index:operations.length,operation_kind:'browser_assert'}});},
   diagnose:async()=>{diagnoses++;return{...proposal,operation_index:operations.length,locator:'#unrelated-header'};},commitRepair:async()=>{writes++;}});
  assert.equal(result.status,'blocked');assert.equal(result.attempts,1);assert.equal(result.repair_count,0);assert.equal(result.source_fingerprint,fingerprint(original));
  assert.equal(runs,1);assert.equal(diagnoses,0);assert.equal(writes,0);assert.ok(!phases.includes('diagnose'));assert.ok(!phases.includes('rerun'));assert.equal(JSON.stringify(original),before);
 }
});
test('an unresolved click can be repaired only after unchanged independent business checks pass',async()=>{
 const operations=[op('browser_click',{locator:'#old'}),op('browser_assert',{assertion:'text',locator:'#review-result',value:'Review ready'})];
 const original=[section(operations)],before=JSON.stringify(original),observed={elements:[{tag:'button',accessible_role:'button',accessible_name:'Review',locators_validated:true,locator_candidates:['#review']}]};
 let runs=0,diagnoses=0,writes=0;
 const result=await runVerificationPipeline({mode:'verify_repair',sections:original,parameters:{'r.fixture':'fixed'},run:async request=>{
  runs++;assert.equal(request.parameters['r.fixture'],'fixed');
  if(runs===1)return receipt(request,{...failed,failure:{...failure,operation_kind:'browser_click'},snapshot:observed});
  assert.deepEqual(request.sections[0].operations,[op('browser_click',{locator:'#review'}),operations[1]]);
  return receipt(request,passed);
 },diagnose:async()=>{diagnoses++;return{...proposal,locator:'#review'};},commitRepair:async({before:old,after})=>{
  writes++;assert.equal(JSON.stringify(old),before);assert.equal(after[0].operations[0].arguments.locator,'#review');assert.deepEqual(after[0].operations[1],operations[1]);
 }});
 assert.equal(result.status,'passed');assert.equal(runs,2);assert.equal(diagnoses,1);assert.equal(writes,1);assert.equal(JSON.stringify(original),before);
});
test('an unrelated field repair cannot retarget the original value assertion or commit its failing rerun',async()=>{
 const original=[section()],before=JSON.stringify(original),unrelated={elements:[{tag:'input',locators_validated:true,locator_candidates:['#unrelated-field']}]};let runs=0,diagnoses=0,writes=0;
 const result=await runVerificationPipeline({mode:'verify_repair',sections:original,parameters:{'r.name':'fixed input'},run:async request=>{
  runs++;assert.equal(request.parameters['r.name'],'fixed input');
  if(runs===1)return receipt(request,{...failed,snapshot:unrelated});
  assert.deepEqual(request.sections[0].operations[0],op('browser_fill',{locator:'#unrelated-field',value:'@r.name'}));
  assert.equal(JSON.stringify(request.sections[0].operations[1]),JSON.stringify(original[0].operations[1]),'the original value predicate, input and subject are unchanged');
  return receipt(request,{...failed,replay_safe:false,completed_operations:1,completed_interactions:1,failure:{...failure,operation_index:2,operation_kind:'browser_assert'}});
 },diagnose:async()=>{diagnoses++;return{...proposal,locator:'#unrelated-field'};},commitRepair:async()=>{writes++;}});
 assert.equal(result.status,'failed');assert.equal(result.attempts,2);assert.equal(result.source_fingerprint,fingerprint(original));assert.equal(runs,2);assert.equal(diagnoses,1);assert.equal(writes,0);assert.equal(JSON.stringify(original),before);
});
test('a passing exact saved run needs no model request or source write',async()=>{
 let calls=0;const result=await runVerificationPipeline({mode:'verify_repair',sections:[section()],parameters:{'r.name':''},startUrl:'https://app.test',run:async request=>{calls++;assert.equal(request.parameters['r.name'],'');return receipt(request,passed);},diagnose:()=>assert.fail('model called'),commitRepair:()=>assert.fail('source rewritten')});
 assert.equal(result.status,'passed');assert.equal(calls,1);assert.equal(result.repair_count,0);
});
test('the explicitly selected execution driver reaches the worker and summary without changing browser transport',async()=>{
 for(const executionDriver of ['native','playwright_test_cli']){
  let runs=0;
  const result=await runVerificationPipeline({mode:'verify',executionDriver,sections:[section()],parameters:{},run:async request=>{runs++;assert.equal(request.execution_driver,executionDriver);return receipt(request,passed);}});
  assert.equal(result.status,'passed');assert.equal(result.execution_driver,executionDriver);assert.equal(result.driver,'mcp');assert.equal(runs,1);
 }
 await assert.rejects(()=>runVerificationPipeline({executionDriver:'unknown',sections:[section()],run:()=>assert.fail('unknown driver dispatched')}),{code:'AUTOMATION_VERIFICATION_DRIVER_INVALID'});
});
test('CLI verification requires the matching worker driver echo while legacy native receipts stay supported',async()=>{
 for(const [executionDriver,echo]of [['playwright_test_cli',undefined],['playwright_test_cli','native'],['native','playwright_test_cli'],['native','unknown']]){
  let runs=0;
  const result=await runVerificationPipeline({mode:'verify_repair',executionDriver,sections:[section()],parameters:{},run:async request=>{runs++;return receipt(request,{...passed,execution_driver:echo});},diagnose:()=>assert.fail('driver mismatch reached a model'),commitRepair:()=>assert.fail('driver mismatch saved source')});
  assert.equal(result.status,'blocked');assert.equal(result.error_code,'AUTOMATION_VERIFICATION_INVALID_RECEIPT');assert.equal(runs,1);
 }
 const result=await runVerificationPipeline({mode:'verify',sections:[section()],parameters:{},run:async request=>receipt(request,{...passed,execution_driver:undefined})});
 assert.equal(result.status,'passed');assert.equal(result.execution_driver,'native');
});
test('bounded repair is verified before its optimistic save, using identical frozen data',async()=>{
 let calls=0,diagnoses=0,writes=0;const progress=[];const rows=[section()],hash=fingerprint(rows);
 const result=await runVerificationPipeline({mode:'verify_repair',sections:rows,parameters:{'r.name':'fixed'},startUrl:'https://app.test',onProgress:value=>progress.push(value.phase),run:async request=>{calls++;assert.equal(request.parameters['r.name'],'fixed');return receipt(request,calls===1?failed:passed);},diagnose:async()=>{diagnoses++;return proposal;},commitRepair:async({before,after})=>{assert.equal(calls,2);assert.equal(fingerprint(before),hash);assert.notEqual(fingerprint(after),hash);writes++;}});
 assert.equal(result.status,'passed');assert.equal(result.attempts,2);assert.equal(result.repair_count,1);assert.equal(diagnoses,1);assert.equal(writes,1);assert.ok(progress.includes('rerun'));
});
for(const [label,change] of [['unknown acknowledgement',{status:'unknown',replay_safe:false,failure:{...failure,code:'AUTOMATION_VERIFICATION_OUTCOME_UNKNOWN',action_outcome:'unknown'}}],['completed interaction',{replay_safe:false,completed_operations:1,completed_interactions:1,failure:{...failure,operation_index:2,operation_kind:'browser_assert'}}],['assertion mismatch',{replay_safe:false,completed_operations:1,completed_interactions:1,failure:{...failure,operation_index:2,operation_kind:'browser_assert',code:'AUTOMATION_VERIFICATION_ASSERTION_FAILED'}}]])test(`${label} cannot trigger model repair, source write or replay`,async()=>{
 let calls=0;const progress=[];const result=await runVerificationPipeline({mode:'verify_repair',sections:[section()],parameters:{},startUrl:'https://app.test',onProgress:summary=>progress.push(summary.phase),run:async request=>{calls++;return receipt(request,{...failed,...change});},diagnose:()=>assert.fail('unsafe diagnosis'),commitRepair:()=>assert.fail('unsafe write')});assert.notEqual(result.status,'passed');assert.equal(calls,1);assert.ok(!progress.includes('diagnose'));
});
test('failed repair retains original source and stops after two runs',async()=>{
 let calls=0;const rows=[section()];const result=await runVerificationPipeline({mode:'verify_repair',sections:rows,parameters:{},run:async request=>{calls++;return receipt(request,failed);},diagnose:async()=>proposal,commitRepair:()=>assert.fail('failed repair saved')});assert.equal(calls,2);assert.equal(result.status,'failed');assert.equal(result.source_fingerprint,fingerprint(rows));
});
test('changed source invalidates a passing receipt; access revocation propagates',async()=>{
 let completed=false,runs=0;const common={mode:'verify',sections:[section()],parameters:{},run:async request=>{runs++;completed=true;return receipt(request,passed);}};
 const result=await runVerificationPipeline({...common,assertCurrent:async()=>{if(completed)throw Object.assign(new Error(),{code:'AUTOMATION_VERIFICATION_SOURCE_CHANGED'});}});assert.equal(result.status,'blocked');assert.equal(result.error_code,'AUTOMATION_VERIFICATION_SOURCE_CHANGED');assert.equal(runs,1);
 await assert.rejects(()=>runVerificationPipeline({...common,assertCurrent:async()=>{throw Object.assign(new Error(),{statusCode:403});}}),{statusCode:403});
});
test('a lost response is not dispatched again and generate-only does not open a browser',async()=>{
 let calls=0;const common={sections:[section()],parameters:{},run:async()=>{calls++;throw Error('lost');}};
 assert.equal((await runVerificationPipeline({...common,mode:'verify_repair'})).status,'blocked');assert.equal(calls,1);
 assert.equal((await runVerificationPipeline({...common,mode:'generate_only'})).status,'not_requested');assert.equal(calls,1);
});

test('saved params expressions remain expressions and use the same fixed binding',()=>{
 const row=section([op('browser_fill',{locator:'#name',value:'params["r.name"]'}),op('browser_assert',{assertion:'value',locator:'#name',value:'params["r.name"]'})]);
 const result=prepareVerificationSections([{id:'one',step_type:'web',...row}],{resolve:(name,args)=>({...args,value:'frozen'})});
 assert.equal(result.parameters['r.name'],'frozen');assert.equal(result.sections[0].automation_code,row.automation_code);assert.equal(result.sections[0].operations[0].arguments.value,'params["r.name"]');
});

test('only a complete worker receipt can establish exact saved-program execution',()=>{
 const id='receipt-attempt',rows=[section()],valid=receipt({verification_id:id},passed);
 assert.equal(validateVerificationReceipt(valid,id,rows),valid);
 for(const change of [
  {verification_id:'other-attempt'},{browser:'firefox'},{verification_status:'unverified'},
  {completed_operations:undefined},{completed_operations:'2'},{completed_operations:1},{completed_operations:3},
  {assertion_count:0},{assertion_count:2},{completed_interactions:0},{completed_interactions:2},
  {replay_safe:true},{duration_ms:-1},{duration_ms:NaN},{failure}
 ])assert.throws(()=>validateVerificationReceipt({...valid,...change},id,rows),{code:'AUTOMATION_VERIFICATION_INVALID_RECEIPT'});
 const stopped=receipt({verification_id:id},failed);
 assert.equal(validateVerificationReceipt(stopped,id,rows),stopped);
 for(const change of [
  {failure:undefined},{verification_status:'verified'},{completed_operations:1},
  {failure:{...failure,step_id:'other'}},{failure:{...failure,operation_index:2}},
  {failure:{...failure,operation_kind:'browser_click'}},{failure:{...failure,action_outcome:'unknown'}}
 ])assert.throws(()=>validateVerificationReceipt({...stopped,...change},id,rows),{code:'AUTOMATION_VERIFICATION_INVALID_RECEIPT'});
});

test('malformed worker success stops without another dispatch, diagnosis or source write',async()=>{
 let runs=0;const phases=[];
 const result=await runVerificationPipeline({mode:'verify_repair',sections:[section()],parameters:{},onProgress:value=>phases.push(value.phase),
  run:async request=>{runs++;return {schema_version:1,verification_id:request.verification_id,status:'passed',verification_status:'verified'};},
  diagnose:()=>assert.fail('malformed receipt reached a model'),commitRepair:()=>assert.fail('malformed receipt changed source')});
 assert.equal(result.status,'blocked');assert.equal(result.error_code,'AUTOMATION_VERIFICATION_INVALID_RECEIPT');assert.equal(runs,1);assert.ok(!phases.includes('diagnose'));
});

test('an explicit unsafe replay receipt blocks before requesting a repair model',async()=>{
 let runs=0;const phases=[];
 const result=await runVerificationPipeline({mode:'verify_repair',sections:[section()],parameters:{},onProgress:value=>phases.push(value.phase),
  run:async request=>{runs++;return receipt(request,{...failed,replay_safe:false});},diagnose:()=>assert.fail('unsafe replay reached model'),commitRepair:()=>assert.fail('unsafe replay saved')});
 assert.equal(result.status,'blocked');assert.equal(runs,1);assert.ok(!phases.includes('diagnose'));
});

test('provider JSON and unsupported repair proposals consume one diagnosis without replay or source edits',async()=>{
 for(const diagnosis of [()=>{throw new SyntaxError('PRIVATE_PROVIDER_TEXT');},()=>{throw Object.assign(new Error('PRIVATE_PROVIDER_TEXT'),{code:'AI_INVALID_JSON'});},()=>({...proposal,value:'different data'}),()=>null]){
  let runs=0,models=0;
  const result=await runVerificationPipeline({mode:'verify_repair',sections:[section()],parameters:{},run:async request=>{runs++;return receipt(request,failed);},
   diagnose:()=>{models++;return diagnosis();},commitRepair:()=>assert.fail('invalid diagnosis saved')});
  assert.equal(result.status,'blocked');assert.equal(result.error_code,'AUTOMATION_VERIFICATION_REPAIR_INVALID');assert.equal(runs,1);assert.equal(models,1);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_PROVIDER_TEXT|different data/);
 }
});

test('diagnosis receives copies and cannot replace the sealed operation ledger or its observed locator evidence',async()=>{
 const rows=[section()],original=JSON.stringify(rows);let runs=0;
 const result=await runVerificationPipeline({mode:'verify_repair',sections:rows,parameters:{'r.name':'frozen'},run:async request=>{runs++;return receipt(request,failed);},
  diagnose:({sections,snapshot,failure})=>{sections[0].operations[0].arguments.value='changed';snapshot.elements[0].locator_candidates.push('#invented');failure.operation_index=2;return {...proposal,locator:'#invented'};},
  commitRepair:()=>assert.fail('model mutated authoritative data')});
 assert.equal(result.status,'blocked');assert.equal(result.error_code,'AUTOMATION_VERIFICATION_REPAIR_INVALID');assert.equal(runs,1);assert.equal(JSON.stringify(rows),original);
});
