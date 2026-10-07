const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const filename=path.resolve(__dirname,'../src/mcp/gateway.js'),original=createRequire(filename),traces=original('../utils/llmTraceContext');
function gateway(callLocal){const module={exports:{}};new Function('require','module','exports',fs.readFileSync(filename,'utf8'))(id=>id==='./auth'?{principal:async(userId,projectId)=>({user:{id:userId},projectId})}:id==='./server'?{callLocal}:original(id),module,module.exports);module.exports.installTransport(callLocal);return module.exports;}
const request=question=>({body:JSON.stringify({messages:[{role:'system',content:'Trusted system policy'},{role:'user',content:question}]})});
test('shared AI gateway keeps simultaneous actor/project contexts isolated and preserves provenance',async()=>{
 const instance=gateway(async(actor,name,args)=>{assert.equal(traces.current().mcp_context_depth,1);await new Promise(resolve=>setTimeout(resolve,5));return {packet:{evidence:[{evidence_id:actor.projectId,content:args.question,citation:{source_id:actor.projectId}}]},observed_at:'2026-10-06'};});
 const results=await Promise.all(['a','b'].map(id=>traces.run({actor_id:'user-'+id,project_id:'project-'+id},()=>instance.enrichChatRequest(request('Question '+id)))));
 results.forEach((result,index)=>{const id=['a','b'][index],messages=JSON.parse(result.body).messages;assert.equal(messages[0].content,'Trusted system policy');assert.equal(messages[2].content,'Question '+id);assert.match(messages[1].content,new RegExp('project-'+id));assert.ok(!messages[1].content.includes('project-'+(['b','a'][index])));assert.match(messages[1].content,/untrusted evidence/);});
});
test('gateway avoids recursive enrichment and identity guessing, and reports retrieval failure as a gap',async()=>{
 let calls=0;const instance=gateway(async()=>{calls++;throw Object.assign(new Error('private database details'),{code:'MCP_CONTEXT_UNAVAILABLE'});}),init=request('help');
 assert.equal(await instance.enrichChatRequest(init),init);
 assert.equal(await traces.run({actor_id:'a',project_id:'p',mcp_context_depth:1},()=>instance.enrichChatRequest(init)),init);
 assert.equal(await traces.run({actor_id:'a',project_id:'p'},()=>instance.enrichChatRequest(init,{operation:'knowledge.answer'})),init);assert.equal(calls,0);
 const result=await traces.run({actor_id:'a',project_id:'p'},()=>instance.enrichChatRequest(init));assert.equal(calls,1);assert.match(JSON.parse(result.body).messages[1].content,/missing evidence as a gap/);assert.ok(!result.body.includes('private database details'));
});
test('chatbot and Smart Context retain their existing packet shapes through the MCP gateway',async()=>{
 const instance=gateway(async actor=>actor.retrievalInput?{result:{packet:{evidence:[]},hits:[],retrieval:{route:'hybrid'}}}:{packet:{evidence:[],context_id:'packet'}});
 const result=await instance.retrieveContext({user:{id:'a'},request:{project_id:'p',query:'help'}});assert.deepEqual(result.hits,[]);assert.equal(result.retrieval.context_transport,'mcp');assert.equal(result.retrieval.route,'hybrid');assert.equal((await instance.retrievePacket({user:{id:'a'},projectId:'p',query:'help'})).context_id,'packet');
});

test('invalid or foreign-project MCP context fails closed for chatbot, Smart Context and shared AI',async()=>{
 const instance=gateway(async()=>({packet:{project_id:'foreign-project',evidence:[{content:'private foreign evidence'}]},result:{packet:{project_id:'foreign-project',evidence:[]}}}));
 await assert.rejects(instance.retrievePacket({user:{id:'a'},projectId:'p',query:'help'}),{code:'MCP_CONTEXT_SCOPE_MISMATCH'});
 await assert.rejects(instance.retrieveContext({user:{id:'a'},request:{project_id:'p',query:'help'}}),{code:'MCP_CONTEXT_SCOPE_MISMATCH'});
 const result=await traces.run({actor_id:'a',project_id:'p'},()=>instance.enrichChatRequest(request('help')));assert.ok(!result.body.includes('private foreign evidence'));assert.match(result.body,/missing evidence as a gap/);
});

test('project-bound AI feature operations always use authenticated MCP context with the selected model', async () => {
 const operations = ['ai.story.create','ai.story.complete','ai.case.generate','ai.case.improve','ai.defect.report','ai.defect.improve','ai.run.smart','ai.defect.triage','agent.review','chat.assistance'];
 const previous = process.env.HELLOTEST_MCP_AI_CONTEXT; process.env.HELLOTEST_MCP_AI_CONTEXT = 'false';
 const calls = [];
 const instance = gateway(async (actor, name, args) => {
  calls.push({actor, name, args});
  return {packet:{project_id:actor.projectId,evidence:[{evidence_id:'evidence-1',content:'Authorized source'}],retrieval:{intent_planning_mode:'llm',model_context_plan:{information_needs:['acceptance coverage']}}}};
 });
 try {
  for (const operation of operations) {
   const result = await traces.run({actor_id:'reviewer',project_id:'project'}, () => instance.enrichChatRequest(request('Review payment coverage'),{operation,integration:{id:'selected-model'}}));
   const messages = JSON.parse(result.body).messages;
   assert.match(messages[1].content,/Authorized source/); assert.match(messages[1].content,/intent_planning_mode/);
   assert.equal(messages[0].content,'Trusted system policy');
  }
  assert.equal(calls.length,operations.length);
  calls.forEach(call => {assert.equal(call.actor.user.id,'reviewer');assert.equal(call.actor.projectId,'project');assert.equal(call.name,'hellotest_context_build');assert.equal(call.args.integration_id,'selected-model');});
 } finally { if(previous === undefined) delete process.env.HELLOTEST_MCP_AI_CONTEXT; else process.env.HELLOTEST_MCP_AI_CONTEXT=previous; }
});
