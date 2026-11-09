const test=require('node:test');
const assert=require('node:assert/strict');
const {assertExactRecordAssertions}=require('../../backend/lib/automationExactRecordAssertions');
const {generateUpstreamSectionSource}=require('../../backend/lib/automationUpstreamSectionSource');
const {createUpstreamPrivateBindingScope}=require('../../backend/lib/automationUpstreamPrivateBindings');
const {inspectExecutablePlan}=require('../../backend/services/automationReadiness.service');
const {validSavedInstructionMapping}=require('../../backend/lib/automationInstructionMapping');
const step={id:'record-result',step_order:14,action:'Search the configured event records',expected_result:'The row with exact name @r.template for @r.first @r.last has the expected type and status',parameter_references:['r.template','r.first','r.last']};

test('exact composite record assertions reject positional ambiguity directly and through locator aliases',()=>{
 for(const source of [
  'await expect(page.getByRole("cell",{name:"Activated"}).first()).toBeVisible();',
  'await expect.soft(page.getByRole("row").last()).toContainText("Activated");',
  'await expect(page.getByRole("row").nth(2)).toHaveText("Record");',
  'const status=page.getByRole("cell").first(); const alias=status; await expect(alias).toBeVisible();',
  'const status=page.getByRole("cell")["last"](); await expect(status).not.toBeHidden();'
 ])assert.throws(()=>assertExactRecordAssertions(source,step),error=>error.code==='AUTOMATION_UPSTREAM_EXACT_RECORD_ASSERTION'&&/after the final action/.test(error.message)&&/same row/.test(error.message)&&/without replaying/.test(error.message));
});

test('the bounded exact-record guard leaves unique record checks and unrelated indexed actions unchanged',()=>{
 const allowed='const row=page.getByRole("row").filter({hasText:params["r.first"]+" "+params["r.last"]}); await expect(row).toHaveCount(1); await expect(row.getByRole("cell",{name:"Activated",exact:true})).toBeVisible();';
 assert.doesNotThrow(()=>assertExactRecordAssertions(allowed,step));
 assert.doesNotThrow(()=>assertExactRecordAssertions('await page.getByRole("button").first().click(); await expect(page.getByRole("row")).toHaveCount(1);',step));
 assert.doesNotThrow(()=>assertExactRecordAssertions('await page.getByRole("cell",{name:"Onboarding"}).nth(0).click(); await expect(page.getByRole("row")).toHaveCount(1);',step));
 assert.doesNotThrow(()=>assertExactRecordAssertions('// .first()\nawait expect(page.getByText(".first()")).toBeVisible();',step));
 for(const expected_result of ['An exact name @r.first is visible','A record for @r.first @r.last appears','The exact row @r.first @r.first appears'])assert.doesNotThrow(()=>assertExactRecordAssertions('await expect(page.getByRole("row").first()).toBeVisible();',{...step,expected_result}));
});

test('source-only retries correct indexed assertions and misplaced locator filters while retaining all five native mutations',async()=>{
 const frame='const frame=page.frameLocator("#records");';
 const writes=[
  'await frame.getByLabel("Template").fill("Joining");',
  'await frame.getByLabel("First name").fill("BuildFirst");',
  'await frame.getByLabel("Last name").fill("BuildLast");',
  'await frame.getByRole("combobox",{name:"Status"}).selectOption("Activated");',
  'await frame.getByRole("button",{name:"Search",exact:true}).click();'
 ];
 const native=[frame,...writes.slice(0,4),'await expect(frame.getByRole("cell",{name:"Activated"}).first()).toBeVisible();',writes[4]].join('\n');
 const good=[frame,...writes,'const identity=params["r.template"]+" for "+params["r.first"]+" "+params["r.last"];','const record=frame.getByRole("row").filter({hasText:identity});','await expect(record).toHaveCount(1);','await expect(record.getByRole("cell",{name:"Onboarding",exact:true})).toBeVisible();','await expect(record.getByRole("cell",{name:"Activated",exact:true})).toBeVisible();'].join('\n');
 const bindings={parameterValues:{'r.template':'Joining','r.first':'BuildFirst','r.last':'BuildLast'},secretBindings:{},references:{},secrets:{},parameterExpressions:true};
 const privateScope=createUpstreamPrivateBindingScope({step,bindings}),phases=[];let attempts=0;
 const update=await generateUpstreamSectionSource({step,emitted:native,sourceContext:{latest_observation:{tool:'browser_snapshot',result:{text:'Observed one configured event record in its frame'}},observations:[]},sourceBindings:bindings,privateScope,validate:inspectExecutablePlan,
  complete:async request=>{phases.push(request.phase);if(request.phase==='upstream_source'){
   const packet=JSON.parse(request.prompt);
   assert.match(packet.task,/mutations/i);assert.match(packet.expected_result_contract,/same.*row|row.*same/i);assert.match(JSON.stringify(packet),/intermediate/i);
   if(++attempts===1)return {automation_code:native};
   if(attempts===2){assert.match(packet.feedback,/exact named-record expectation/);assert.match(packet.feedback,/after the final action/);assert.match(packet.feedback,/type and status within that same row/);assert.match(packet.feedback,/without replaying browser actions/);return {automation_code:good.replace('getByRole("row").filter({hasText:identity})','getByRole("row",{hasText:identity})')};}
   assert.match(packet.feedback,/getByRole\(\) does not support/);assert.match(packet.feedback,/getByRole\("row"\)\.filter/);assert.match(packet.native_locator_contract,/append \.filter/);assert.match(packet.feedback,/without replaying browser actions/);
   return {automation_code:good};
  }
  const packet=JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":'))),mapped=packet.steps[0];return {schema:'hellotest.playwrightInstructionMapping.v1',steps:[{step_id:step.id,source_sha256:mapped.source_sha256,instructions:mapped.operations.map(op=>({operation_id:op.operation_id,kind:op.kind,depth:op.depth,label:'Perform observed operation',args:[]}))}]};}});
 assert.deepEqual(phases,['upstream_source','upstream_source','upstream_source','upstream_instruction_mapping']);
 assert.equal((update.automation_code.match(/\.(?:fill|selectOption|click)\(/g)||[]).length,5);
 assert.doesNotMatch(update.automation_code,/\.(?:first|last|nth)\(/);
 assert.ok(update.automation_code.indexOf('name:"Search"')<update.automation_code.indexOf('await expect(record)'));
 assert.ok(validSavedInstructionMapping(update.automation_instructions,{source:update.automation_code,stepId:step.id}));
});


test('exact record metadata rejects partial named roles and aliases while exact names and anchored expressions remain valid',()=>{
 for(const role of ['cell','link','row','listitem','option']){
  for(const options of ['{name:"Onboarding"}','{name:"Onboarding",exact:false}','{name:/Onboarding/}']){
   const named=`page.getByRole("${role}",${options})`;
   for(const source of [`await expect(${named}).toBeVisible();`,`const target=${named}; const alias=target; await expect(alias).toBeVisible();`])assert.throws(()=>assertExactRecordAssertions(source,step),error=>error.code==='AUTOMATION_UPSTREAM_EXACT_RECORD_ASSERTION'&&/exact:true/.test(error.message)&&/Partial cell names/.test(error.message));
  }
  for(const options of ['{name:"Onboarding",exact:true}','{name:/^Onboarding$/}'])assert.doesNotThrow(()=>assertExactRecordAssertions(`const target=page.getByRole("${role}",${options}); await expect(target).toBeVisible();`,step));
 }
 // Identical aliases for the observed frame are valid; the guard does not
 // invent a prohibition on same-frame row/metadata filters.
 const sameFrame='const first=page.frameLocator("#records"); const second=page.frameLocator("#records"); const metadata=second.getByRole("cell",{name:"Activated",exact:true}); const row=first.getByRole("row",{name:params["r.first"]+" "+params["r.last"],exact:true}).filter({has:metadata}); await expect(row).toHaveCount(1);';
 assert.doesNotThrow(()=>assertExactRecordAssertions(sameFrame,step));
});


test('getByRole rejects all four misplaced filter options before the exact-record gate and accepts native filter chains',()=>{
 for(const [option,value] of [['has','page.getByRole("cell",{name:"Activated",exact:true})'],['hasNot','page.getByRole("cell",{name:"Archived",exact:true})'],['hasText','params["r.first"]'],['hasNotText','"Archived"']]){
  const invalid=`const row=page.getByRole("row",{${option}:${value}}); await expect(row).toHaveCount(1);`;
  for(const currentStep of [step,{expected_result:'A record is visible'}])assert.throws(()=>assertExactRecordAssertions(invalid,currentStep),error=>error.code==='AUTOMATION_UPSTREAM_LOCATOR_OPTION_INVALID'&&/silently ignore/.test(error.message)&&/\.filter/.test(error.message)&&/without replaying/.test(error.message));
  const valid=`const row=page.getByRole("row").filter({${option}:${value}}); await expect(row).toHaveCount(1);`;
  assert.doesNotThrow(()=>assertExactRecordAssertions(valid,step));
 }
});
