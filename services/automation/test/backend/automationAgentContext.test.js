const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const {normalizeAgentContext,retrieveAgentContext}=require('../../backend/lib/automationAgentContext');
test('agent context keeps explicit source exclusions, bounds input and drops unknown authority fields',()=>{
 const value=normalizeAgentContext({context_scopes:[],inputs:{test_case_id:'case',user_id:'not-authority',project_id:'not-scope'},smart_context:{source_ids:['one','one'],query:'focus'}});
 assert.deepEqual(value.context_scopes,[]);assert.deepEqual(value.inputs,{test_case_id:'case'});assert.deepEqual(value.smart_context.source_ids,['one']);
 assert.throws(()=>normalizeAgentContext([]));assert.ok(normalizeAgentContext().context_scopes.includes('stories'));
});
test('evidence identifiers stay exact while cleared fields are omitted and malformed selectors fail early',()=>{
 const value=normalizeAgentContext({inputs:{sprint_id:'202610150001',story_id:' story ',execution_id:'  ',build:'obsolete',environment_id:' environment '},smart_context:{source_ids:[' source ','source',''],source_kinds:[' test_case ','']}});
 assert.deepEqual(value.inputs,{sprint_id:'202610150001',story_id:'story'});
 assert.deepEqual(value.smart_context.source_ids,['source']);assert.deepEqual(value.smart_context.source_kinds,['test_case']);
 for(const selection of [{inputs:[]},{inputs:{execution_id:{id:'run'}}},{inputs:{sprint_id:'a'.repeat(256)}},{inputs:{execution_id:'run\nother'}},{smart_context:[]},{smart_context:{source_kinds:['x'.repeat(81)]}}])assert.throws(()=>normalizeAgentContext(selection),{statusCode:400});
});
test('retrieval pins the current case, honors selected sources and uses the signed-in MCP bridge',async()=>{
 const original=Module._load;let input;
 Module._load=function(id,...args){if(id==='@hellotest/mcp/backend/gateway')return {retrievePacket:async args=>{input=args;return {evidence:[{id:'e',content:'Observed evidence'}],limitations:[]};}};return original.call(this,id,...args);};
 try {const context=await retrieveAgentContext({testCase:{id:'case',project_id:'project',app_type_id:'app',title:'Saved behavior'},userId:'reviewer',selection:{context_scopes:['automation','test-cases'],inputs:{test_case_id:'another',execution_id:'',sprint_id:'202610150001',story_id:'story',build:'obsolete',environment_id:'obsolete'},smart_context:{source_ids:['source'],source_kinds:['test_case']}},prompt:'Build exactly this scope'});
 assert.equal(input.user.id,'reviewer');assert.equal(input.projectId,'project');assert.equal(input.filters.evidence_scope.test_case_id,'case');assert.deepEqual(input.filters.requested_scopes,['automation','test-cases']);assert.deepEqual(input.filters.source_ids,['source']);assert.equal(context.context_transport,'mcp');
 assert.equal(input.filters.evidence_scope.sprint_id,'202610150001');assert.equal(input.filters.evidence_scope.story_id,'story');assert.ok(!Object.hasOwn(input.filters.evidence_scope,'execution_id'));assert.ok(!Object.hasOwn(input.filters.evidence_scope,'build'));assert.ok(!Object.hasOwn(input.filters.evidence_scope,'environment_id'));
 }finally{Module._load=original;}
});
test('MCP failures preserve explicit fallback, required evidence fails closed and caller cancellation stops retrieval',async()=>{
 const original=Module._load;let calls=0,captured;const controller=new AbortController();
 Module._load=function(id,...args){if(id==='@hellotest/mcp/backend/gateway')return {retrievePacket:async args=>{calls++;captured=args;if(args.signal)controller.abort(new Error('Cancelled automation build'));throw Object.assign(new Error('Unavailable'),{code:'MCP_UNAVAILABLE'});}};return original.call(this,id,...args);};
 const args={testCase:{id:'case',project_id:'project',app_type_id:'app',title:'Saved behavior'},userId:'reviewer',selection:{context_scopes:['test-cases']},prompt:'Build this case'};
 try {
  const fallback=await retrieveAgentContext(args);assert.deepEqual(fallback.knowledge,[]);assert.match(fallback.limitations[0],/MCP_UNAVAILABLE/);
  await assert.rejects(retrieveAgentContext({...args,policy:{mode:'mcp',required:true,max_items:12,token_budget:2000}}),{code:'AI_MCP_CONTEXT_REQUIRED',statusCode:503});
  await assert.rejects(retrieveAgentContext({...args,signal:controller.signal}),/Cancelled automation build/);assert.equal(captured.signal,controller.signal);
  const before=calls;await assert.rejects(retrieveAgentContext({...args,signal:controller.signal}),/Cancelled automation build/);assert.equal(calls,before);
  const disabled=await retrieveAgentContext({...args,policy:{mode:'none'}});assert.equal(disabled.context_transport,'not_required');assert.equal(calls,before);
 }finally{Module._load=original;}
});
