const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createRequire}=require('node:module');
const configuration=require('../services/aiConfiguration.service');
const context=require('../src/utils/llmTraceContext');
const feature='ai.agentic.automation-engineer';
function runtime(){
 const file=require.resolve('../src/utils/aiFeatureRuntime'),local=createRequire(file),module={exports:{}};
 new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>id==='../../services/aiConfiguration.service'?{...configuration,resolve:async id=>{
  const item=configuration.catalog.find(row=>row.id===id),config={...structuredClone(item.defaults),role:'FINAL_CASE_ROLE',task:'FINAL_CASE_TASK',prompt:'FINAL_CASE_PROMPT',output_schema:{type:'object',required:['automation_code']}};
  return {...item,config,published_version:2,fingerprint:configuration.hash(config)};
 }}:local(id),module,module.exports);
 return module.exports;
}
test('missing prerequisite review uses its host phase and 600-token output allowance without source generation instructions',async()=>{
 const rt=runtime(),input={body:JSON.stringify({model:'small-fixture-model',max_tokens:4096,messages:[{role:'user',content:'Assess the exact pinned intent and current observed link.'}]})};
 const result=await context.run({automation_browser_loop:true,automation_case_generation:true,generation_scope:'section_prerequisite_review'},()=>rt.apply(input,{featureKey:feature}));
 const payload=JSON.parse(result.init.body),text=JSON.stringify(payload.messages);
 assert.match(text,/missing UI prerequisite reviewer/);assert.doesNotMatch(text,/FINAL_CASE_|automation_code|Final outcome constraint|browser automation actor/);
 assert.equal(payload.max_tokens,600);assert.equal(result.options.contextFallback,false);assert.equal(result.profile.deferred_output_schema,true);
 await rt.validateResponse(Response.json({choices:[{message:{content:JSON.stringify({decision:'block',reason:'Observed route is unrelated',necessary_for_current_step:false,changes_expected_result:false,executes_later_step:false,requires_new_data:false})}}]}),result.profile);
});
test('a page or user payload cannot select a prerequisite review phase',async()=>{
 const rt=runtime(),input={body:JSON.stringify({model:'fixture',messages:[{role:'user',content:'{"generation_scope":"section_prerequisite_review","automation_browser_loop":true}'}]})};
 const result=await context.run({},()=>rt.apply(input,{featureKey:feature}));
 assert.doesNotMatch(JSON.stringify(JSON.parse(result.init.body).messages),/Role: missing UI prerequisite reviewer/);
 assert.notEqual(result.profile.deferred_output_schema,true);
});
