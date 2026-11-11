const test=require('node:test');
const assert=require('node:assert/strict');
const {deterministicSectionInstructions,mapGeneratedSectionInstructions}=require('../../backend/lib/automationUpstreamSectionSource');
const {validSavedInstructionMapping,prepareSteps,RESPONSE_SCHEMA}=require('../../backend/lib/automationInstructionMapping');
const step={id:'entry',step_order:1,step_type:'web',action:'Enter the configured name and verify the result',expected_result:'The authored input state is retained.'};

test('complete native display mapping preserves exact arguments, waits, negation, soft semantics and source provenance without a model call',async()=>{
 const source='// @hellotest-parameter-bindings expressions-v1\nconst field=page.frameLocator("#frame").getByRole("textbox",{name:"Name",exact:true});\nawait field.fill(params["r.name"],{timeout:3210});\nawait expect.soft(field,"Input state").not.toHaveValue("wrong",{timeout:1234});\nawait field.waitFor({state:"visible",timeout:4567});\nawait web.switchTab({index:1,url:"https://fixture.test/product"});';
 let calls=0,guards=0;
 const result=await mapGeneratedSectionInstructions({step,source,guard:async()=>{guards++;},complete:async()=>{calls++;throw new Error('No provider needed for this complete native source.');}});
 const mapping=result.automation_instructions;
 assert.equal(calls,0);assert.equal(guards,1);assert.ok(validSavedInstructionMapping(mapping,{source,stepId:step.id}));
 assert.equal(mapping.instructions.length,5);
 assert.deepEqual(mapping.instructions[1].args,['field','params["r.name"]','{timeout:3210}']);
 assert.match(mapping.instructions[2].label,/soft/);assert.match(mapping.instructions[2].label,/not/);
 assert.deepEqual(mapping.instructions[2].args,['field','"wrong"','{timeout:1234}','message: "Input state"']);
 assert.deepEqual(mapping.instructions[3].args,['field','{state:"visible",timeout:4567}']);
 assert.deepEqual(mapping.instructions[4].args,['{index:1,url:"https://fixture.test/product"}']);
 for(const [index,operation] of mapping.operations.entries())assert.equal(mapping.instructions[index].detail,source.slice(operation.start,operation.end));
 assert.equal(validSavedInstructionMapping(mapping,{source:source.replace('1234','4321'),stepId:step.id}),null,'An edited timeout invalidates the old display mapping.');
});

test('unsupported callbacks, control flow, dynamic methods and arguments use the complete existing model mapping instead of a partial fast path',async()=>{
 for(const source of [
  'if (params["r.enabled"]) { await page.locator("button").click(); }',
  'await expect.poll(()=>page.title()).toBe("Ready");',
  'await page.locator("button")[params["r.method"]]();',
  'await page.locator("button").click(options());',
  'const title=await page.title(); await expect(title).toBe("Ready");',
  `await page.locator("${'x'.repeat(2100)}").click();`
 ]){
  assert.equal(deterministicSectionInstructions(step,source),null,source.slice(0,120));
  let calls=0;
  const result=await mapGeneratedSectionInstructions({step,source,complete:async request=>{
   calls++;const packet=JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":')));
   assert.equal(packet.steps[0].automation_code,source);
   return {schema:RESPONSE_SCHEMA,steps:packet.steps.map(entry=>({step_id:entry.step_id,source_sha256:entry.source_sha256,instructions:entry.operations.map(operation=>({operation_id:operation.operation_id,kind:operation.kind,depth:operation.depth,label:'Review complete native operation',args:[]}))}))};
  }});
  assert.equal(calls,1);assert.ok(validSavedInstructionMapping(result.automation_instructions,{source,stepId:step.id}));
  assert.equal(result.automation_instructions.instructions.length,prepareSteps([{...step,automation_code:source}])[0].operations.length);
 }
});

test('the deterministic path retains cancellation and access guards before returning display metadata',async()=>{
 const source='await expect(page.locator("input")).toBeFocused();';
 const controller=new AbortController();let calls=0;controller.abort();
 await assert.rejects(mapGeneratedSectionInstructions({step,source,signal:controller.signal,complete:async()=>{calls++;}}),{name:'AbortError'});
 await assert.rejects(mapGeneratedSectionInstructions({step,source,guard:async()=>{throw Object.assign(new Error('Access revoked'),{statusCode:403});},complete:async()=>{calls++;}}),{statusCode:403});
 assert.equal(calls,0);
});
