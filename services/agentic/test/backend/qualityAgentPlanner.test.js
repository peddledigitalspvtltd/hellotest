const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {createRequire}=require('node:module');
const input={project_id:'project-a',app_type_id:'app-a',target_url:'https://qa.example.test/search',goal:'Search products with #search'},user={id:'actor-a'};
function planner(options={}) {
  const requests=[],selected=[],repositoryReads=[];
  const integration={id:'llm-a',type:'llm',is_active:true,base_url:'https://model.example.test/v1',model:'configured-model',api_key:'transport-only-key',config:{project_id:'project-a'}};
  const stubs={
    '@hellotest/platform/backend/services/permission.service':{hasPermission:async(u,p)=>options.permissions?.[p]??true},
    '@hellotest/integration/backend/services/aiLlmSelection.service':{resolveLlmIntegrationForUsage:async args=>{selected.push(args);return Object.hasOwn(options,'integration')?options.integration:integration;}},
    '@hellotest/automation/backend/services/aiAutomationBuilder.service':{listLearningCache:async scope=>{repositoryReads.push(scope);return options.rows||[];}},
    '@hellotest/platform/backend/services/settings.service':{getWorkspacePreferences:async()=>({ai_prompt_registry_overrides:{'ai.agentic.quality_plan':'Use concise observable assertions.'}})},
    '@hellotest/platform/backend/src/utils/llmHttpClient':{fetchLlmWithRetry:async(url,init,policy)=>{requests.push({url,body:JSON.parse(init.body),policy});return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({steps:[{action:'click',selector:'#search'}]})},...(options.choices?.[requests.length-1]||options.choice)}]});}}
  };
  const filename=path.resolve(__dirname,'../../backend/services/qualityAgentPlanner.js'),loaded=new Module(filename);loaded.filename=filename;const actual=createRequire(filename);loaded.require=name=>stubs[name]||actual(name);loaded._compile(fs.readFileSync(filename,'utf8'),filename);
  return {propose:loaded.exports.proposePlan,requests,selected,repositoryReads};
}
test('actual planner honors feature model/default guidance and bounded single-attempt output',async()=>{
  const p=planner(),proposal=await p.propose(input,user);assert.equal(proposal.steps[0].selector,'#search');assert.equal(p.selected[0].usageKey,'ai.agentic.quality_plan');assert.equal(p.selected[0].fallback,'project-scoped');assert.ok(p.requests[0].policy.timeoutMs<=20000&&p.requests[0].policy.timeoutMs>0);assert.equal(p.requests[0].policy.maxAttempts,1);assert.equal(p.requests[0].policy.contextFallback,false);assert.match(p.requests[0].body.messages[1].content,/concise observable assertions/);
});
test('planner corrects invalid typed output once against the same full goal and authorized locator context',async()=>{
 const p=planner({choices:[{message:{content:JSON.stringify({steps:[{action:'click',selector:'#unobserved'}]})}},{}]});
 const result=await p.propose({...input,smart_context:{reviewed_context:'Search the catalogue without submitting an order.'}},user);
 assert.equal(result.steps[0].selector,'#search');assert.equal(p.requests.length,2);
 const second=p.requests[1].body,packet=JSON.parse(second.messages.at(-1).content);
 assert.equal(packet.goal,input.goal);assert.equal(packet.reviewed_context,'Search the catalogue without submitting an order.');assert.equal(packet.task_brief.agent_id,'browser-web');
 assert.match(packet.validation_feedback.message,/outside its authorized/);assert.equal(packet.validation_feedback.steps_executed,0);assert.match(second.messages.at(-2).content,/qualityAgentPlanner.revision/);assert.ok(!JSON.stringify(second).includes('#unobserved'));
});
test('saved locator context is project/app scoped, same-origin, CSS-only and explicit in grounding',async()=>{
  const row={id:'locator-a',page_url:'https://qa.example.test/search',locator:'#repository-search',locator_kind:'css',metadata:{object_name:'Search',screen_name:'Catalog'}};
  const p=planner({rows:[row,{...row,id:'foreign',page_url:'https://foreign.example.test/'},{...row,id:'deprecated',metadata:{deprecated:true}},{...row,id:'xpath',locator_kind:'xpath'}],choice:{message:{content:JSON.stringify({steps:[{action:'click',selector:row.locator}]})}}});
  const proposal=await p.propose({...input,goal:'Click the saved search field'},user);assert.equal(proposal.grounding[0].id,'locator-a');assert.deepEqual(p.repositoryReads[0],{project_id:'project-a',app_type_id:'app-a',limit:100});const context=JSON.parse(p.requests[0].body.messages.at(-1).content).authorized_locator_context;assert.equal(context.length,1);
});
test('missing automation permission excludes saved locators and fabricated selectors are rejected',async()=>{
  const p=planner({permissions:{'automation.view':false},choice:{message:{content:JSON.stringify({steps:[{action:'click',selector:'#invented'}]})}}});
  await assert.rejects(()=>p.propose(input,user),/outside its authorized/);assert.equal(p.repositoryReads.length,0);
});
test('missing model avoids repository/provider work and cross-project model is rejected before transport',async()=>{
  const missing=planner({integration:null});assert.equal(await missing.propose(input,user),null);assert.equal(missing.requests.length,0);assert.equal(missing.repositoryReads.length,0);
  const foreign=planner({integration:{config:{project_id:'project-b'}}});await assert.rejects(()=>foreign.propose(input,user),e=>e.statusCode===403);assert.equal(foreign.requests.length,0);
  const denied=planner({permissions:{'integration.view':false}});await assert.rejects(()=>denied.propose({...input,llm_integration_id:'llm-a'},user),e=>e.statusCode===403);assert.equal(denied.selected.length,0);
});
test('truncation, provider refusal, unexpected tool calls and malformed JSON never become valid proposals',async()=>{
  for(const choice of [{finish_reason:'length'},{message:{refusal:'No',content:'{}'}},{message:{tool_calls:[{name:'run_code'}],content:'{}'}},{message:{content:'{"steps":'}}]){
    const p=planner({choice});await assert.rejects(()=>p.propose(input,user));
  }
});
