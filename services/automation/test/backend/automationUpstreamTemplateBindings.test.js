const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {buildWithUpstreamPlaywright}=require('../../backend/lib/automationUpstreamEngineer');
const {inspectExecutablePlan}=require('../../backend/services/automationReadiness.service');
const {validSavedInstructionMapping}=require('../../backend/lib/automationInstructionMapping');

test('mixed full-record templates bind before the mapped source is hashed and saved without another browser action',async()=>{
 const startUrl='https://app.test/events',goto=`await page.goto(${JSON.stringify(startUrl)});`;
 const assertion='await expect(page.locator("#noncoreIframe").contentFrame().getByRole("link",{name:`Onboarding - India for ${params["r.employee_first_name"]} ${params["r.employee_last_name"]}`,exact:true})).toBeVisible();';
 const proposal=goto+'\n'+assertion,expected='// @hellotest-parameter-bindings expressions-v1\n'+proposal.replace('Onboarding - India','${params["r.onboarding_template"]}');
 const calls=[],saved=[];let mappedHash;
 const step={id:'verify-record',step_order:1,step_type:'web',action:'Verify the full @r.onboarding_template record for @r.employee_first_name @r.employee_last_name',expected_result:'That exact full record is visible',parameter_references:['r.onboarding_template','r.employee_first_name','r.employee_last_name']};
 const result=await buildWithUpstreamPlaywright({steps:[step],startUrl,interactive:true,validate:inspectExecutablePlan,
  parameterBindings:{parameterValues:{'r.onboarding_template':'Onboarding - India','r.employee_first_name':'GeneratedFirst','r.employee_last_name':'GeneratedLast'}},
  browser:{tools:[],call:async(name,args)=>{calls.push({name,args});return {content:[{type:'text',text:'### Ran Playwright code\n```js\n'+goto+'\n```'}]};},close:async()=>{}},
  complete:async request=>{
   if(request.phase==='upstream_browser_actor')return {done:true};
   if(request.phase==='upstream_source')return {automation_code:proposal};
   const packet=JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":'))),mapped=packet.steps[0];mappedHash=mapped.source_sha256;
   return {schema:'hellotest.playwrightInstructionMapping.v1',steps:[{step_id:step.id,source_sha256:mapped.source_sha256,instructions:mapped.operations.map(op=>({operation_id:op.operation_id,kind:op.kind,depth:op.depth,label:'Verify full record identity',args:[]}))}]};
  },onSection:async update=>saved.push(update)});
 assert.deepEqual(calls,[{name:'browser_navigate',args:{url:startUrl}}]);assert.equal(saved.length,1);assert.equal(result.updates[0].automation_code,expected);
 assert.equal(mappedHash,createHash('sha256').update(expected).digest('hex'));assert.notEqual(mappedHash,createHash('sha256').update(proposal).digest('hex'));
 assert.ok(validSavedInstructionMapping(saved[0].automation_instructions,{source:expected,stepId:step.id}));assert.equal(validSavedInstructionMapping(saved[0].automation_instructions,{source:proposal,stepId:step.id}),null);
});

test('URL references inside JavaScript concatenation become params before source hashing and persistence',async()=>{
 const startUrl='https://app.test/',goto=`await page.goto(${JSON.stringify(startUrl)});`;
 const proposal=goto+'\nawait expect(page).toHaveURL("@r.orangehrm_url"+"client/#/dashboard");';
 const expected='// @hellotest-parameter-bindings expressions-v1\nawait page.goto(params["r.orangehrm_url"]);\nawait expect(page).toHaveURL(params["r.orangehrm_url"]+"client/#/dashboard");';
 const step={id:'dashboard',step_order:1,step_type:'web',action:'Verify the Dashboard path of @r.orangehrm_url',expected_result:'The Dashboard URL is current',parameter_references:['r.orangehrm_url']};
 let calls=0,mappedHash,saved;
 await buildWithUpstreamPlaywright({steps:[step],startUrl,interactive:true,validate:inspectExecutablePlan,parameterBindings:{parameterValues:{'r.orangehrm_url':startUrl}},
  browser:{tools:[],call:async()=>{calls++;return {content:[{type:'text',text:'### Ran Playwright code\n```js\n'+goto+'\n```'}]};},close:async()=>{}},
  complete:async request=>{
   if(request.phase==='upstream_browser_actor')return {done:true};
   if(request.phase==='upstream_source')return {automation_code:proposal};
   const packet=JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":'))),mapped=packet.steps[0];mappedHash=mapped.source_sha256;
   return {schema:'hellotest.playwrightInstructionMapping.v1',steps:[{step_id:step.id,source_sha256:mapped.source_sha256,instructions:mapped.operations.map(op=>({operation_id:op.operation_id,kind:op.kind,depth:op.depth,label:'Verify Dashboard path',args:[]}))}]};
  },onSection:async update=>{saved=update;}});
 assert.equal(calls,1);assert.equal(saved.automation_code,expected);assert.doesNotMatch(saved.automation_code,/@r\./);
 assert.equal(mappedHash,createHash('sha256').update(expected).digest('hex'));assert.ok(validSavedInstructionMapping(saved.automation_instructions,{source:expected,stepId:step.id}));
});
