const assert=require('node:assert/strict');
exports.verify=async({app,db,createToken})=>{
 const headers={authorization:'Bearer '+createToken({id:'mcp-a'})};
 await db.prepare('UPDATE users SET is_workspace_admin = TRUE WHERE id = ?').run('mcp-a');
 try {
  const root='/admin-portal/ai-configuration',parentId='ai.agentic.quality-evaluator',childId='ai.agentic.repository.object_repository';
  const detail=async id=>{const response=await app.inject({url:`${root}/${id}`,headers});assert.equal(response.statusCode,200,response.body);return response.json();};
  const mutate=async(id,mode,revision,config)=>{const response=await app.inject({method:'POST',url:`${root}/${id}/${mode}`,headers,payload:{expected_revision:revision,config}});assert.equal(response.statusCode,200,response.body);return response.json();};
  const parent=await detail(parentId);const parentConfig={...parent.config,temperature:0.55,prompt:'Review the legacy shared source evidence.'};
  await mutate(parentId,'publish',0,parentConfig);
  const child=await detail(childId);assert.equal(child.inherited_from.id,parentId);assert.equal(child.inherited_from.version,1);assert.equal(child.config.temperature,0.55);assert.match(child.config.prompt,/legacy shared source evidence/);
  const ownConfig={...child.config,temperature:0.25};await mutate(childId,'draft',0,ownConfig);
  assert.equal((await detail(childId)).config.temperature,0.55,'Drafts must not change runtime inheritance');
  const owned=await mutate(childId,'publish',1,ownConfig);assert.equal(owned.inherited_from,null);assert.equal(owned.published_version,1);
  await mutate(parentId,'publish',1,{...parentConfig,temperature:0.65});
  assert.equal((await detail(childId)).config.temperature,0.25,'A published child is independent of later shared edits');
  const inherited=await detail('ai.agentic.repository.api_tests');assert.equal(inherited.config.temperature,0.65);assert.equal(inherited.inherited_from.version,2);
 } finally {await db.prepare('UPDATE users SET is_workspace_admin = FALSE WHERE id = ?').run('mcp-a');}
};
