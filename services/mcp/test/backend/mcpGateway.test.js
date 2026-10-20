const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const filename=path.resolve(__dirname,'../../backend/gateway.js'),original=createRequire(filename),traces=original('@hellotest/platform/backend/src/utils/llmTraceContext');
function gateway(callLocal){const module={exports:{}};new Function('require','module','exports',fs.readFileSync(filename,'utf8'))(id=>id==='./auth'?{principal:async(userId,projectId)=>({user:{id:userId},projectId})}:id==='./server'?{callLocal}:original(id),module,module.exports);module.exports.installTransport(callLocal);return module.exports;}
const request=question=>({body:JSON.stringify({messages:[{role:'system',content:'Trusted system policy'},{role:'user',content:question}]})});
test('shared AI gateway keeps simultaneous actor/project contexts isolated and preserves provenance',async()=>{
 const instance=gateway(async(actor,name,args)=>{assert.equal(traces.current().mcp_context_depth,1);await new Promise(resolve=>setTimeout(resolve,5));return {packet:{project_id:actor.projectId,evidence:[{evidence_id:actor.projectId,content:args.question,citation:{source_id:actor.projectId}}]},observed_at:'2026-10-06'};});
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
 const instance=gateway(async actor=>actor.retrievalInput?{result:{packet:{project_id:actor.projectId,evidence:[]},hits:[],retrieval:{route:'hybrid'}}}:{packet:{project_id:actor.projectId,evidence:[],context_id:'packet'}});
 const result=await instance.retrieveContext({user:{id:'a'},request:{project_id:'p',query:'help'}});assert.deepEqual(result.hits,[]);assert.equal(result.retrieval.context_transport,'mcp');assert.equal(result.retrieval.route,'hybrid');assert.equal((await instance.retrievePacket({user:{id:'a'},projectId:'p',query:'help'})).context_id,'packet');
});

test('invalid or foreign-project MCP context fails closed for chatbot, Smart Context and shared AI',async()=>{
 const instance=gateway(async()=>({packet:{project_id:'foreign-project',evidence:[{content:'private foreign evidence'}]},result:{packet:{project_id:'foreign-project',evidence:[]}}}));
 await assert.rejects(instance.retrievePacket({user:{id:'a'},projectId:'p',query:'help'}),{code:'MCP_CONTEXT_SCOPE_MISMATCH'});
 await assert.rejects(instance.retrieveContext({user:{id:'a'},request:{project_id:'p',query:'help'}}),{code:'MCP_CONTEXT_SCOPE_MISMATCH'});
 const result=await traces.run({actor_id:'a',project_id:'p'},()=>instance.enrichChatRequest(request('help')));assert.ok(!result.body.includes('private foreign evidence'));assert.match(result.body,/missing evidence as a gap/);
});

test('project-bound AI feature operations always use authenticated MCP context with the selected model', async () => {
 const operations = ['ai.story.create','ai.story.complete','case-authoring.generate','case-authoring.step-rephrase','bug-draft.generate','bug-triage.refine-category','rich-text.rephrase','test-data.synthetic','automation.generate','execution-planning.generate','execution-analysis.generate','execution-report.generate','quality-dashboard.generate','quality-assurance.test_case','agentic-assistant.respond','agentic-quality.plan','agent.review','chat.assistance'];
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

test('image authoring requests retrieve MCP evidence from text while preserving images and message order',async()=>{
 let question;
 const instance=gateway(async(_actor,_name,args)=>{question=args.question;return {packet:{project_id:'p',evidence:[{content:'Authorized image authoring evidence'}]}};});
 const content=[{type:'text',text:'Generate checkout cases'},{type:'image_url',image_url:{url:'data:image/png;base64,private-image'}}];
 const init={body:JSON.stringify({messages:[{role:'system',content:'policy'},{role:'user',content},{role:'assistant',content:'Draft'}]})};
 const result=await traces.run({actor_id:'a',project_id:'p'},()=>instance.enrichChatRequest(init));
 assert.match(question,/Generate checkout cases/);assert.ok(!question.includes('private-image'));
 const messages=JSON.parse(result.body).messages;assert.match(messages[1].content,/Authorized image authoring evidence/);assert.deepEqual(messages[2].content,content);assert.equal(messages[3].content,'Draft');
});

test('a stalled MCP read returns a context gap within its budget and cancels the read',async()=>{
 let signal;
 const instance=gateway(async(_actor,_name,_args,activeSignal)=>{signal=activeSignal;return new Promise(()=>{});});
 const result=await traces.run({actor_id:'a',project_id:'p'},()=>instance.enrichChatRequest(request('help'),{mcpContextTimeoutMs:20}));
 assert.equal(signal.aborted,true);assert.match(JSON.parse(result.body).messages[1].content,/missing evidence as a gap/);
});
test('configured item and context budgets disclose omitted evidence and required empty evidence fails closed',async()=>{
 const instance=gateway(async()=>({packet:{project_id:'p',evidence:Array.from({length:6},(_,i)=>({evidence_id:'e'+i,content:'evidence '.repeat(30)}))}}));
 const result=await traces.run({actor_id:'a',project_id:'p'},()=>instance.enrichChatRequest(request('refunds'),{mcpContextPolicy:{mode:'mcp',max_items:2,token_budget:256}}));
 const text=JSON.parse(result.body).messages[1].content,packet=JSON.parse(text.slice(text.indexOf('\n')+1));
 assert.ok(packet.evidence.length<=2);assert.ok(packet.omitted_evidence_count>=4);assert.match(packet.limitations.join(' '),/omitted/);
 const empty=gateway(async()=>({packet:{project_id:'p',evidence:[]}}));
 await assert.rejects(traces.run({actor_id:'a',project_id:'p'},()=>empty.enrichChatRequest(request('refunds'),{mcpContextPolicy:{mode:'mcp',required:true}})),{code:'AI_MCP_CONTEXT_REQUIRED'});
});

test('user cancellation stops enrichment instead of proceeding to the model with a gap',async()=>{
 let entered;const started=new Promise(resolve=>entered=resolve);
 const instance=gateway(async()=>{entered();return new Promise(()=>{});});
 const controller=new AbortController();
 const result=traces.run({actor_id:'a',project_id:'p'},()=>instance.enrichChatRequest({...request('help'),signal:controller.signal}));
 await started;controller.abort();await assert.rejects(result,{name:'AbortError'});
});

test('background model integrations bind their verified identity without an ambient HTTP request or host token',async()=>{
 const integration={id:'model'};traces.bindIntegration(integration,{userId:'worker-user',projectId:'worker-project',usageKey:'execution-report.generate'});
 let called;
 const instance=gateway(async actor=>{called=actor;return {packet:{project_id:actor.projectId,evidence:[{content:'Verified worker evidence'}]}};});
 const result=await instance.enrichChatRequest(request('Explain this execution'),{integration});
 assert.equal(called.user.id,'worker-user');assert.equal(called.projectId,'worker-project');assert.match(result.body,/Verified worker evidence/);
});

test('MCP retrieval uses the normalized retrieval budget and remaining assistant turn',()=>{
 const instance=gateway(async()=>({}));
 assert.equal(instance.retrievalTimeout({request:{budgets:{deadline_ms:60000}}}),62000);
 assert.equal(instance.retrievalTimeout({request:{budgets:{deadline_ms:15000}}}),17000);
 assert.equal(instance.retrievalTimeout({request:{budgets:{deadline_ms:60000}},timeoutMs:8500}),8500);
 assert.equal(instance.retrievalTimeout({request:{budgets:{deadline_ms:Infinity}},timeoutMs:0}),1);
});

test('a context packet without its verified project cannot cross the MCP boundary',async()=>{
 const instance=gateway(async()=>({packet:{evidence:[]},result:{packet:{evidence:[]},hits:[],retrieval:{}}}));
 await assert.rejects(instance.retrievePacket({user:{id:'actor'},projectId:'project',query:'Review stories'}),{code:'MCP_CONTEXT_SCOPE_MISMATCH'});
 await assert.rejects(instance.retrieveContext({user:{id:'actor'},request:{project_id:'project',query:'Review stories'}}),{code:'MCP_CONTEXT_SCOPE_MISMATCH'});
});

test('packet context preserves selections and budgets on the public remote contract without private identity fields',async()=>{
 const previous=process.env.HELLOTEST_MCP_INTERNAL_URL;process.env.HELLOTEST_MCP_INTERNAL_URL='http://configured.example/mcp';
 let call;
 const instance=gateway(async(actor,name,args)=>{call={actor,name,args};return {packet:{project_id:actor.projectId,evidence:[]}};});
 try{
  await instance.retrievePacket({user:{id:'actor'},projectId:'project',appTypeId:'app',integrationId:'model',query:'Review checkout',
   filters:{requested_scopes:['test-cases','knowledge'],evidence_scope:{test_case_id:'case'},source_ids:['source'],source_kinds:['text'],app_type_id:'app'},
   budgets:{deadline_ms:60000,max_context_tokens:2000,max_evidence_items:40,max_query_cost_usd:0},onProgress:()=>{}});
  assert.equal(call.name,'hellotest_context_build');assert.equal(call.actor.packetInput,undefined);
  assert.equal(call.args.app_type_id,'app');assert.equal(call.args.integration_id,'model');assert.equal(call.args.token_budget,2000);
  assert.deepEqual(call.args.filters,{requested_scopes:['test-cases','knowledge'],evidence_scope:{test_case_id:'case'},source_ids:['source'],source_kinds:['text']});
  assert.equal(call.args.budgets.deadline_ms,60000);assert.equal(call.args.budgets.max_evidence_items,30);assert.equal(call.args.budgets.max_query_cost_usd,0);
  assert.equal(Object.hasOwn(call.args,'project_id'),false);assert.equal(Object.hasOwn(call.args,'user'),false);
 }finally{if(previous===undefined)delete process.env.HELLOTEST_MCP_INTERNAL_URL;else process.env.HELLOTEST_MCP_INTERNAL_URL=previous;}
});

test('packet requests honor their configured deadline and reject conflicting application selections',async()=>{
 const instance=gateway(async()=>({packet:{project_id:'project',evidence:[]}}));
 assert.equal(instance.retrievalTimeout({budgets:{deadline_ms:60000}}),62000);
 assert.equal(instance.retrievalTimeout({budgets:{deadline_ms:0}}),2000);
 await assert.rejects(instance.retrievePacket({user:{id:'actor'},projectId:'project',appTypeId:'app-a',filters:{app_type_id:'app-b'},query:'Inspect'}),{code:'MCP_CONTEXT_SCOPE_MISMATCH'});
});

test('filtered automatic enrichment sends the configured retrieval budget through MCP',async()=>{
 let call;
 const instance=gateway(async(actor,name,args)=>{call={actor,name,args};return {packet:{project_id:'project',evidence:[{content:'Authorized selected evidence'}]}};});
 await traces.run({actor_id:'actor',project_id:'project'},()=>instance.enrichChatRequest(request('Explain checkout'),{
  mcpContextFilters:{requested_scopes:['stories'],evidence_scope:{story_id:'story'}},
  mcpContextPolicy:{token_budget:512,max_items:2,mode:'mcp'},mcpContextTimeoutMs:1000}));
 assert.equal(call.args.token_budget,512);assert.equal(call.args.budgets.max_context_tokens,512);
 assert.equal(call.args.budgets.max_evidence_items,2);assert.ok(call.args.budgets.deadline_ms<=1000);
 assert.equal(call.actor.packetInput.budgets.max_context_tokens,512);
 assert.deepEqual(call.args.filters.evidence_scope,{story_id:'story'});
});
