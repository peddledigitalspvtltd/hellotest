const test=require('node:test');
const assert=require('node:assert/strict');
const {generateUpstreamSectionSource}=require('../../backend/lib/automationUpstreamSectionSource');
const {createUpstreamPrivateBindingScope}=require('../../backend/lib/automationUpstreamPrivateBindings');
const {inspectExecutablePlan}=require('../../backend/services/automationReadiness.service');
const {validSavedInstructionMapping}=require('../../backend/lib/automationInstructionMapping');

test('source-only correction gets precise runner and iframe feedback and preserves completed native actions without another browser call',async()=>{
 const step={id:'manage-events',step_order:13,action:'Open Manage Events/Templates',expected_result:'Owner(s), Is Template and Rows per page are visible in the embedded document',parameter_references:[]};
 const actions='await page.getByRole("link",{name:"Onboarding",exact:true}).click();\nawait page.locator(".top-level-menu-item").filter({hasText:"On/Offboarding oxd_menu_down"}).click();\nawait page.getByRole("link",{name:"Manage Events/Templates",exact:true}).click();';
 const emitted=actions+'\nawait expect(page.locator("body")).toMatchAriaSnapshot(`- list:\n  - listitem: Rows per page`);';
 const supported=actions+'\nawait expect(page.locator("#noncoreIframe").contentFrame().getByRole("columnheader",{name:"Owner(s)",exact:true})).toBeVisible();\nawait expect(page.locator("#noncoreIframe").contentFrame().getByRole("columnheader",{name:"Is Template",exact:true})).toBeVisible();\nawait expect(page.locator("#noncoreIframe").contentFrame().getByRole("listitem")).toHaveText(["Rows per page"]);';
 const bindings={parameterValues:{},secretBindings:{},references:{},secrets:{},parameterExpressions:true},privateScope=createUpstreamPrivateBindingScope({step,bindings});
 const calls=[];let attempts=0;
 const update=await generateUpstreamSectionSource({step,emitted,sourceContext:{latest_observation:{tool:'browser_verify_list_visible',arguments:JSON.stringify({target:'f1e5',items:['Rows per page']})},observations:[]},sourceBindings:bindings,privateScope,validate:inspectExecutablePlan,
  complete:async request=>{calls.push(request.phase);if(request.phase==='upstream_source'){
   const packet=JSON.parse(request.prompt);assert.match(packet.runner_assertion_contract,/without Playwright Test testInfo/);assert.match(packet.runner_assertion_contract,/actual observed iframe\/locator/);
   if(++attempts===1)return {automation_code:emitted};
   assert.match(packet.feedback,/toMatchAriaSnapshot requires Playwright Test testInfo/);assert.match(packet.feedback,/observed iframe target/);assert.doesNotMatch(packet.feedback,/expected result needs an executable assertion/);
   return {automation_code:supported};
  }const packet=JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":'))),mapped=packet.steps[0];return {schema:'hellotest.playwrightInstructionMapping.v1',steps:[{step_id:step.id,source_sha256:mapped.source_sha256,instructions:mapped.operations.map(op=>({operation_id:op.operation_id,kind:op.kind,depth:op.depth,label:'Perform observed operation',args:[]}))}]};}});
 assert.deepEqual(calls,['upstream_source','upstream_source','upstream_instruction_mapping']);assert.equal(attempts,2);
 assert.equal(update.automation_code,'// @hellotest-parameter-bindings expressions-v1\n'+supported);assert.doesNotMatch(update.automation_code,/toMatchAriaSnapshot|locator\("body"\)/);
 assert.ok(validSavedInstructionMapping(update.automation_instructions,{source:update.automation_code,stepId:step.id}));
});
