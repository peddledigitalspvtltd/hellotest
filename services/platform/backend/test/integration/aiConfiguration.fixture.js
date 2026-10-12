const assert=require('node:assert/strict');
exports.verify=async({app,db,obsDb,createToken})=>{
 const member={authorization:'Bearer '+createToken({id:'mcp-b'})};
 const headers={authorization:'Bearer '+createToken({id:'mcp-a'})};
 const root='/admin-portal/ai-configuration';
 assert.equal((await app.inject({url:root,headers:member})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:`${root}/ai.test_case.design/preview`,headers:member,payload:{user_request:'NFR only'}})).statusCode,403);
 await db.prepare("UPDATE users SET is_workspace_admin = TRUE WHERE id = ?").run('mcp-a');
 try{
  const listed=await app.inject({url:root,headers});assert.equal(listed.statusCode,200,listed.body);
  const caseId='ai.case_authoring.full_case',caseDefinition=require('../../../shared/aiFeatureCatalog.json').find(item=>item.id===caseId);
  const historical={...caseDefinition.defaults,instruction_format_version:2,prompt:caseDefinition.prompt_default_migrations[0],guardrails:caseDefinition.guardrail_migration.default,instruction_blocks:{...caseDefinition.legacy_instruction_blocks,'platform.requestPolicy':caseDefinition.guardrail_migration.request_policy,'aiCaseAuthoring.buildPrompt.30':'Reviewed NFR measurement guidance.'}};
  const oldVersion={config:historical,version:1,actor_id:'mcp-a',at:new Date().toISOString()};
  await db.prepare('INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value').run('ai_feature_configuration:'+caseId,{revision:1,published:oldVersion,history:[oldVersion]});
  const migrated=await app.inject({url:`${root}/${caseId}`,headers});assert.equal(migrated.statusCode,200,migrated.body);assert.equal(migrated.json().config.instruction_format_version,3);assert.match(migrated.json().config.instruction_blocks['legacy.reviewed'],/Reviewed NFR measurement guidance/);
  const inspect=await app.inject({method:'POST',url:`${root}/${caseId}/preview`,headers,payload:{config:migrated.json().config,user_request:'Only NFR performance cases using the supplied p95 threshold.'}});
  assert.equal(inspect.statusCode,200,inspect.body);assert.equal(inspect.headers['cache-control'],'no-store');assert.match(inspect.json().messages[0].content,/Reviewed NFR measurement guidance/);
  assert.match(JSON.parse(inspect.json().messages.at(-1).content).generation_request.user_request,/Only NFR/);
  assert.equal((await db.prepare('SELECT value FROM app_settings WHERE key=?').get('ai_feature_configuration:'+caseId)).value.published.config.instruction_format_version,2,'Inspection does not publish or rewrite stored history');
  const reviewed=await app.inject({method:'POST',url:`${root}/${caseId}/publish`,headers,payload:{expected_revision:1,config:migrated.json().config}});assert.equal(reviewed.statusCode,200,reviewed.body);
  const restored=await app.inject({method:'POST',url:`${root}/${caseId}/rollback`,headers,payload:{expected_revision:2,version:1}});assert.equal(restored.statusCode,200,restored.body);assert.match(restored.json().config.instruction_blocks['legacy.reviewed'],/Reviewed NFR measurement guidance/);
  const feature=listed.json().features.find(item=>item.id==='ai.requirement.creation'),id=feature.id;
  const config={...feature.config,prompt:'A published Story instruction from administration.',temperature:0.35,max_output_tokens:1024,output_schema:{type:'object',required:['title'],properties:{title:{type:'string'}}}};
  const edit=(mode,body)=>app.inject({method:'POST',url:`${root}/${id}/${mode}`,headers,payload:body});
  const draft=await edit('draft',{expected_revision:0,config});assert.equal(draft.statusCode,200,draft.body);assert.equal(draft.json().published_version,0);
  assert.notEqual((await require('../../services/aiConfiguration.service').resolve(id)).config.prompt,config.prompt);
  const competing=await Promise.all([edit('publish',{expected_revision:1,config}),edit('publish',{expected_revision:1,config:{...config,prompt:'Competing edit'}})]);
  assert.deepEqual(competing.map(row=>row.statusCode).sort(),[200,409]);
  const published=competing.find(row=>row.statusCode===200).json();assert.equal(published.published_version,1);
  const stored=(await require('../../services/settings.service').getWorkspacePreferences('mcp-b')).ai_prompt_registry_overrides[id];assert.equal(stored,published.config.prompt,'Native feature guidance follows published controls');
  const retired=await app.inject({method:'PUT',url:'/settings/workspace-preferences',headers,payload:{preferences:{ai_prompt_registry_overrides:{[id]:'Bypass audit'}}}});assert.equal(retired.statusCode,409,retired.body);
  const badSchema=await edit('publish',{expected_revision:2,config:{...config,output_schema:{type:'object',properties:{payload:{$ref:'https://outside.test/schema'}}}}});assert.equal(badSchema.statusCode,400,badSchema.body);
  const second=await edit('publish',{expected_revision:2,config:{...config,prompt:'Version two instruction.'}});assert.equal(second.statusCode,200,second.body);
  const rollback=await edit('rollback',{expected_revision:3,version:1});assert.equal(rollback.statusCode,200,rollback.body);assert.equal(rollback.json().published_version,3);assert.equal(rollback.json().config.prompt,published.config.prompt);
  const originalFetch=global.fetch;let dispatched;
  global.fetch=async(url,init)=>{if(!String(url).startsWith('https://ai-configuration-fixture.invalid/'))return originalFetch(url,init);dispatched=JSON.parse(init.body);return new Response(JSON.stringify({model:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify({title:'Native Story proposal'})}}],usage:{total_tokens:42}}),{headers:{'Content-Type':'application/json'}});};
  try{
   const response=await require('../../src/utils/llmTraceContext').run({project_id:'mcp-p-a',actor_id:'mcp-a'},()=>require('../../src/utils/llmHttpClient').fetchLlmWithRetry('https://ai-configuration-fixture.invalid/chat/completions',{method:'POST',body:JSON.stringify({model:'fixture',temperature:1.8,messages:[{role:'user',content:'Create a Story about viewing recorded test runs.'}]})},{operation:'requirement.generate',maxAttempts:1,timeoutMs:15000}));
   assert.match(dispatched.messages[0].content,new RegExp(published.config.prompt.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.equal(dispatched.temperature,0.35);assert.equal(dispatched.max_tokens,1024);
   const trace=await obsDb.prepare('SELECT feature,capture,status FROM llm_request_traces WHERE id = ?').get(response.headers.get('x-hellotest-llm-trace-id'));assert.equal(trace.feature,id);assert.equal(trace.capture.configuration_version,3);assert.equal(trace.status,'succeeded');
   const provider=await app.inject({method:'POST',url:'/admin-portal/integrations',headers,payload:{name:'AI configuration fixture',type:'llm',base_url:'https://ai-configuration-fixture.invalid/v1',model:'fixture',api_key:'fixture-key-no-real-credential',is_active:true}});assert.equal(provider.statusCode,200,provider.body);
   const optimization={summary:'Clarified grounding.',changes:['Preserved intent and made uncertainty explicit.'],proposal:Object.fromEntries(['role','domain','task','prompt','guardrails'].map(key=>[key,key==='prompt'?'Optimized draft guidance.':config[key]]))};
   global.fetch=async(url,init)=>{if(!String(url).startsWith('https://ai-configuration-fixture.invalid/'))return originalFetch(url,init);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(optimization)}}]}),{headers:{'Content-Type':'application/json'}});};
   const optimized=await app.inject({method:'POST',url:`${root}/${id}/optimize`,headers,payload:{config,integration_id:provider.json().id}});assert.equal(optimized.statusCode,200,optimized.body);assert.equal(optimized.json().published,false);assert.equal((await require('../../services/aiConfiguration.service').resolve(id)).published_version,3);
   const instanceTrace=await obsDb.prepare('SELECT project_id,feature,capture FROM llm_request_traces WHERE id = ?').get(optimized.json().trace_id);assert.equal(instanceTrace.project_id,null);assert.equal(instanceTrace.feature,'ai.admin.prompt_optimization');assert.equal(instanceTrace.capture.scope,'instance');
  }finally{global.fetch=originalFetch;}
  const metrics=await app.inject({url:root+'/metrics',headers});assert.equal(metrics.statusCode,200,metrics.body);assert.ok(metrics.json().items.some(item=>item.feature===id));assert.ok(!JSON.stringify(metrics.json()).includes('Native Story proposal'));
 }finally{await db.prepare("UPDATE users SET is_workspace_admin = FALSE WHERE id = ?").run('mcp-a');}
};
