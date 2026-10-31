const assert = require('node:assert/strict');
const configuration = require('../../services/aiConfiguration.service');
const executionConfiguration = require('../../src/utils/aiExecutionConfiguration');
const nodeConfiguration = require('../../../../agentic/backend/workflows/nodeAiConfiguration');
const registry = require('../../../../agentic/backend/agents/agentRegistry.service');
const contract = require('../../../../agentic/backend/agents/agentDefinition');

// Real persistence verifies the ownership change against legacy deployed rows.
// Model connection validation runs; no provider generation is performed.
exports.verify = async ({app, db, createToken}) => {
  const headers = {authorization: 'Bearer ' + createToken({id:'mcp-a'})};
  const member = {authorization: 'Bearer ' + createToken({id:'mcp-b'})};
  const root = '/admin-portal/ai-configuration';
  const parentId = 'ai.agentic.quality-evaluator', childId = 'ai.agentic.repository.object_repository', successorId = 'ai.agentic.story-completion';
  const previous = new Map();
  await db.prepare('UPDATE users SET is_workspace_admin = TRUE WHERE id = ?').run('mcp-a');
  try {
    assert.equal((await app.inject({url:`${root}/${parentId}`,headers:member})).statusCode,403);
    for (const id of [parentId, childId, successorId]) {
      const definition = configuration.catalog.find(item => item.id === id);
      const key = 'ai_feature_configuration:' + id;
      previous.set(key, (await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key))?.value);
      await db.prepare('INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value').run(key, {
        revision:6, published:{version:4,config:{...structuredClone(definition.defaults),prompt:`RETIRED_ADMIN_${id}`,temperature:0.95,
          output_schema:{type:'object',properties:{retired_admin_field:{type:'boolean'}},required:['retired_admin_field']}}}
      });
      const rejected = await app.inject({url:`${root}/${id}`,headers});
      assert.equal(rejected.statusCode,422,rejected.body);
      assert.equal(rejected.json().code,'AI_CONFIGURATION_OWNER');
      assert.equal((await app.inject({method:'POST',url:`${root}/${id}/publish`,headers,payload:{expected_revision:6,config:definition.defaults}})).statusCode,422);
      const resolved = await configuration.resolve(id);
      assert.equal(resolved.published_version,0);
      assert.equal(resolved.inherited_from,null);
      assert.equal(resolved.config.prompt,definition.defaults.prompt);
      assert.doesNotMatch(resolved.config.prompt,/RETIRED_ADMIN/);
    }
    const model = await app.inject({method:'POST',url:'/admin-portal/integrations',headers,payload:{name:'Node configuration fixture',type:'llm',base_url:'https://node-configuration-fixture.invalid/v1',model:'fixture',api_key:'fixture-not-a-live-key',is_active:true,config:{project_id:'mcp-p-a'}}});
    assert.equal(model.statusCode,200,model.body);
    const definition = {name:'Versioned evidence reviewer',objective:'SAVED_NODE_OBJECTIVE: review supplied Story evidence.',instructions:'Report specific missing expected behavior.',
      guardrails:'Keep unknown behavior explicit and cite supplied references.',integration_id:model.json().id,required_inputs:['story_id'],
      ai_configuration:{temperature:0.25,context:{mode:'none',token_budget:1200,max_items:4,required:false,focus:''},
        output_schema:{type:'object',properties:{response:{type:'string'}},required:['response']}},
      review_criteria:'Distinguish acceptance ambiguity from an observed failure.',limits:{timeout_ms:70000,max_model_calls:2,max_output_tokens:3000}};
    const created = await app.inject({method:'POST',url:'/agentic-workflows/agents',headers,payload:{project_id:'mcp-p-a',definition,activate:true}});
    assert.equal(created.statusCode,200,created.body);
    const saved = created.json(), pinned = await registry.resolve(saved.id,1,'mcp-p-a');
    assert.equal(pinned.definition.ai_configuration.temperature,0.25);
    assert.equal(pinned.definition_hash,contract.definitionHash(pinned.definition));
    await nodeConfiguration.runAgent({id:saved.id,registered:pinned},async () => {
      const primary = await configuration.resolve('ai.agentic.workflow');
      assert.equal(primary.configuration_source,'agent_definition');
      assert.equal(primary.config.temperature,0.25);assert.equal(primary.config.max_output_tokens,3000);
      assert.match(primary.config.prompt,/SAVED_NODE_OBJECTIVE/);assert.match(primary.config.prompt,/acceptance ambiguity/);
      assert.equal(primary.config.agent_execution.max_model_calls,2);
      assert.deepEqual(primary.config.output_schema,definition.ai_configuration.output_schema);
      const successor = await configuration.resolve(successorId);
      assert.equal(successor.config.prompt,configuration.catalog.find(item=>item.id===successorId).defaults.prompt);
      assert.equal(successor.config.output_schema,null,'The parent schema cannot constrain a supporting native phase.');
      assert.equal(successor.config.temperature,0.25);assert.doesNotMatch(successor.config.prompt,/RETIRED_ADMIN|SAVED_NODE_OBJECTIVE/);
      const nativeFrame = 'Native response_schema: {response:string,citation_ids:string[],findings:object[]}';
      const request = await require('../../src/utils/aiFeatureRuntime').apply({body:JSON.stringify({messages:[{role:'system',content:nativeFrame},{role:'user',content:'Review supplied Story story-1.'}]})},{featureKey:'ai.agentic.workflow'});
      assert.match(JSON.parse(request.init.body).messages[0].content,/Native response_schema/);
      assert.match(JSON.parse(request.init.body).messages[0].content,/SAVED_NODE_OBJECTIVE/);
    });
    const data = {...contract.toNodeData(pinned.definition),agentId:saved.id,agentSnapshot:pinned};
    await nodeConfiguration.runNode({id:'saved-agent-node',data},{revision:1},async () => {
      const profile = await configuration.resolve('ai.agentic.workflow');
      assert.equal(profile.configuration_source,'workflow_node');assert.equal(profile.config.max_output_tokens,3000);
      assert.equal(profile.config.agent_execution.timeout_ms,70000);assert.match(profile.config.prompt,/SAVED_NODE_OBJECTIVE/);
    });
    const next = await app.inject({method:'PUT',url:`/agentic-workflows/agents/${saved.id}`,headers,payload:{project_id:'mcp-p-a',expected_version:1,activate:false,definition:{...definition,objective:'UNACTIVATED_DRAFT: a different task.'}}});
    assert.equal(next.statusCode,200,next.body);
    assert.match((await registry.resolve(saved.id,1,'mcp-p-a')).definition.objective,/SAVED_NODE_OBJECTIVE/);
    await assert.rejects(registry.resolve(saved.id,2,'mcp-p-a'),{code:'AGENT_VERSION_INACTIVE'});
    assert.equal(executionConfiguration.current(),null);
  } finally {
    for (const [key,value] of previous) {
      if(value===undefined)await db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
      else await db.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(value,key);
    }
    await db.prepare('UPDATE users SET is_workspace_admin = FALSE WHERE id = ?').run('mcp-a');
  }
};
