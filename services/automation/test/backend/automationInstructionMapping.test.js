const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {mapPlaywrightInstructions,prepareSteps,validateMappingResponse,validSavedInstructionMapping,RESPONSE_SCHEMA}=require('../../backend/lib/automationInstructionMapping');
const {sectionPreview}=require('../../backend/lib/automationWorkspacePreview');
const code='await page.getByLabel("Email", {exact:true}).fill(params["t.email"]);\nawait expect(page.getByRole("alert")).not.toContainText("Invalid", {timeout:1234});';
const steps=[{step_id:'login',automation_code:code,action:'Sign in',expected_result:'No invalid warning'}];
function responseFor(prepared){return {schema:RESPONSE_SCHEMA,steps:prepared.map(step=>({step_id:step.step_id,source_sha256:step.source_sha256,instructions:step.operations.map(operation=>({operation_id:operation.operation_id,kind:operation.kind,depth:operation.depth,label:operation.kind==='assertion'?'Verify warning':'Type',args:operation.kind==='assertion'?['does not contain Invalid','timeout 1234 ms']:['Email','@t.email']}))}))};}

test('a separate configured model call maps final source and never changes executable assertions or parameter references',async()=>{
  const original=JSON.stringify(steps);let calls=0;
  const mapped=await mapPlaywrightInstructions({steps,complete:async request=>{
    calls++;const payload=JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":')));
    assert.equal(payload.steps[0].automation_code,code);
    assert.match(request.systemPrompt,/display-only/);
    return JSON.stringify(responseFor(payload.steps));
  }});
  assert.equal(calls,1);assert.equal(JSON.stringify(steps),original);
  assert.equal(mapped.steps[0].source_sha256,createHash('sha256').update(code).digest('hex'));
  assert.equal(mapped.steps[0].instructions[1].kind,'assertion');
  assert.equal(validSavedInstructionMapping(mapped.steps[0],{source:code,stepId:'login'}).step_id,'login');
  const preview=sectionPreview({testCaseId:'case',step:{id:'login',step_order:1},update:{automation_code:code,automation_instructions:mapped.steps[0]}});
  assert.equal(preview.automation_code,code);assert.deepEqual(preview.automation_instructions,mapped.steps[0]);
  const edited=sectionPreview({testCaseId:'case',step:{id:'login',step_order:1},update:{automation_code:code.replace('1234','4321'),automation_instructions:mapped.steps[0]}});
  assert.equal(edited.automation_instructions,undefined);
});

test('mapper rejects forged step identities, altered hashes, executable rewrites and incomplete/reordered operation links',()=>{
  const prepared=prepareSteps(steps);
  const mutations=[
    response=>{response.steps[0].step_id='foreign';},
    response=>{response.steps[0].source_sha256='0'.repeat(64);},
    response=>{response.steps[0].automation_code='await page.click("#other");';},
    response=>{response.steps[0].instructions.reverse();},
    response=>{response.steps[0].instructions.pop();},
    response=>{response.steps[0].instructions[0].operation_id='forged';},
    response=>{response.steps[0].instructions[1].kind='action';}
  ];
  for(const mutate of mutations){const response=responseFor(prepared);mutate(response);assert.throws(()=>validateMappingResponse(response,prepared),error=>error.code==='AUTOMATION_INSTRUCTION_MAPPING_INVALID');}
});

test('mapping repair includes the exact flat output contract and host operation metadata without echoing invalid labels',async()=>{
  const prepared=prepareSteps(steps),invalid=responseFor(prepared);
  invalid.steps[0].instructions[0].label='PRIVATE_INVALID_LABEL_'.repeat(20);
  let rejected;try{validateMappingResponse(invalid,prepared);}catch(error){rejected=error;}
  assert.equal(rejected.code,'AUTOMATION_INSTRUCTION_MAPPING_INVALID');assert.equal(rejected.validation_feedback.rule,'instruction_contract');
  await mapPlaywrightInstructions({steps,validationFeedback:{code:rejected.code,validation_feedback:rejected.validation_feedback},complete:async request=>{
    const blocks=request.prompt.split('\n\n'),example=JSON.parse(blocks[1]),packet=JSON.parse(blocks.at(-1));
    assert.deepEqual(Object.keys(example),['schema','steps']);assert.equal(example.schema,RESPONSE_SCHEMA);
    assert.equal(packet.response,undefined);assert.equal(packet.validation_feedback.expected_schema,RESPONSE_SCHEMA);
    assert.deepEqual(packet.validation_feedback.allowed_root_keys,['schema','steps']);
    assert.deepEqual(packet.validation_feedback.required_steps[0].operations,prepared[0].operations.map(({operation_id,kind,depth})=>({operation_id,kind,depth})));
    assert.equal(packet.validation_feedback.failed_rule.required_kind,prepared[0].operations[0].kind);
    assert.equal(packet.validation_feedback.failed_rule.required_depth,prepared[0].operations[0].depth);
    assert.doesNotMatch(request.prompt,/PRIVATE_INVALID_LABEL/);
    return responseFor(packet.steps);
  }});
});

test('mapped control flow and source links are invalidated by source edits and forged operation ranges',async()=>{
  const source='if (params["t.enabled"]) { await page.getByRole("button", {name:"Save"}).click(); }';
  const prepared=prepareSteps([{step_id:'save',automation_code:source}]);
  const result=validateMappingResponse(responseFor(prepared),prepared).steps[0];
  assert.deepEqual(result.operations.map(op=>[op.kind,op.depth]),[['control',0],['action',1]]);
  assert.equal(validSavedInstructionMapping(result,{source:source+'\n',stepId:'save'}),null);
  assert.equal(validSavedInstructionMapping({...result,operations:[{...result.operations[0],end:1},result.operations[1]]},{source,stepId:'save'}),null);
  const controller=new AbortController();controller.abort();let called=false;
  await assert.rejects(mapPlaywrightInstructions({steps,signal:controller.signal,complete:async()=>{called=true;}}),error=>error.name==='AbortError');
  assert.equal(called,false);
});

test('browser source digest matches the server for Unicode and padding boundaries',async()=>{
  const {automationSourceSha256}=await import('../../shared/automationInstructionMapping.mjs');
  for(const source of ['',code,'😀 नमस्ते café','a'.repeat(55),'a'.repeat(56),'a'.repeat(64),'x'.repeat(20000)])assert.equal(automationSourceSha256(source),createHash('sha256').update(source).digest('hex'));
});

test('saved Plan projections use exact retained source, exclude quarantined or foreign-step mappings, and scope artifact lookup',async()=>{
  const {createInstructionMappingService}=require('../../backend/services/automationInstructionMapping.service');
  const prepared=prepareSteps(steps),mapping=validateMappingResponse(responseFor(prepared),prepared).steps[0];
  const preview={schema_version:1,kind:'section_preview',test_case_id:'case',step_id:'login',automation_code:code,automation_instructions:mapping};
  let rows=[],calls=0;
  const obsDb={prepare:sql=>({all:async(...args)=>{calls++;assert.match(sql,/activity\.project_id=\?/);assert.match(sql,/activity\.app_type_id=\?/);assert.equal(args[0],'project');assert.equal(args[1],'app');assert.equal(args[4],'case');assert.equal(args[5],mapping.source_sha256);return rows;}})};
  const service=createInstructionMappingService({obsDb});
  const input={steps:[{id:'login',test_case_id:'case',automation_code:code}],projectId:'project',appTypeId:'app',testCaseId:'case'};
  rows=[{id:'quarantined',transaction_metadata:{artifact_quarantine:{quarantined:{quarantined:true}}},content:JSON.stringify({...preview,automation_instructions:{...mapping,instructions:mapping.instructions.map(row=>({...row,label:'Do not expose'}))}})},
    {id:'foreign-step',content:JSON.stringify({...preview,step_id:'foreign'})},
    {id:'stale-source',content:JSON.stringify({...preview,automation_code:code+'\n'})},
    {id:'valid',content:JSON.stringify(preview)}];
  const projected=await service.attachInstructionMappings(input);
  assert.deepEqual(projected[0].automation_instructions,mapping);assert.equal(input.steps[0].automation_instructions,undefined);
  assert.doesNotMatch(JSON.stringify(projected),/Do not expose/);
  rows=rows.slice(0,3);assert.equal((await service.attachInstructionMappings(input))[0].automation_instructions,undefined);
  const before=calls;await service.attachInstructionMappings({...input,projectId:null});assert.equal(calls,before,'a missing authorized project must not query artifacts');
});
