const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {createRequire} = require('node:module');
const execution = require('../src/utils/aiExecutionConfiguration');
const catalog = require('../../shared/aiFeatureCatalog.json');
function load(file, overrides) {
  const local = createRequire(file), module = {exports:{}};
  new Function('require','module','exports',readFileSync(file,'utf8'))(id=>Object.hasOwn(overrides,id)?overrides[id]:local(id),module,module.exports);
  return module.exports;
}
function fixture(records = new Map(), prompts = {}) {
  const reads = [];
  const service = load(require.resolve('../services/aiConfiguration.service'), {'../src/db':{prepare:sql=>({
    get:async key=>{reads.push(key);return records.has(key)?{value:records.get(key)}:undefined;},
    all:async()=>sql.includes('LIKE') ? [...records].map(([key,value])=>({key,value})) : [{key:'workspace_governed_preference:ai_prompt_registry_overrides',value:prompts}]
  })}});
  return {service,reads};
}
const scoped = (prompt, extra = {}) => ({source:'workflow_node',id:'node-1',revision:7,feature_id:'ai.test_case.design',config:{prompt,...extra}});

test('a native task uses its pinned node settings while the application still uses its published admin settings', async()=>{
  const id='ai.test_case.design',defaults=catalog.find(item=>item.id===id).defaults;
  const {service,reads}=fixture(new Map([[`ai_feature_configuration:${id}`,{revision:4,published:{version:3,config:{...defaults,prompt:'ADMIN_NFR_ONLY'}}}]]));
  assert.equal((await service.resolve(id)).config.prompt,'ADMIN_NFR_ONLY');
  reads.length=0;
  const result=await execution.run(scoped('Generate the positive registration journey.',{temperature:0.4,context:{mode:'none'}}),()=>service.resolve(id));
  assert.equal(result.config.prompt,'Generate the positive registration journey.');
  assert.equal(result.config.temperature,0.4);
  assert.equal(result.config.context.mode,'none');
  assert.equal(result.configuration_source,'workflow_node');
  assert.deepEqual(result.configuration_scope,{id:'node-1',revision:7,feature_id:id});
  assert.deepEqual(reads,[],'Node execution must not read admin settings.');
  assert.equal((await service.resolve(id)).config.prompt,'ADMIN_NFR_ONLY');
});

test('node schemas and primary instructions never replace a supporting phase contract',async()=>{
  const {service,reads}=fixture();
  const schema={type:'object',required:['testCases'],properties:{testCases:{type:'array'}}};
  await execution.run(scoped('NODE_PRIMARY',{output_schema:schema,guardrails:'Node evidence review.',temperature:0.6}),async()=>{
    const primary=await service.resolve('ai.test_case.design');
    assert.deepEqual(primary.config.output_schema,schema);
    const supporting=await service.resolve('ai.knowledge.intent');
    assert.equal(supporting.config.prompt,supporting.defaults.prompt);
    assert.equal(supporting.config.output_schema,supporting.defaults.output_schema);
    assert.equal(supporting.config.temperature,0.6);
    assert.equal(supporting.config.context.mode,'none','The context planner cannot recursively retrieve.');
    assert.equal(supporting.config.guardrails,'Node evidence review.');
  });
  assert.deepEqual(reads,[]);
});

test('concurrent and nested nodes retain their own instructions without leaking after execution',async()=>{
  const {service}=fixture();
  const results=await Promise.all(['First node','Second node'].map((prompt,index)=>execution.run(scoped(prompt),async()=>{
    await new Promise(resolve=>setTimeout(resolve,index?1:8));
    assert.equal((await service.resolve('ai.test_case.design')).config.prompt,prompt);
    await execution.run(scoped('Nested node'),async()=>assert.equal((await service.resolve('ai.test_case.design')).config.prompt,'Nested node'));
    return (await service.resolve('ai.test_case.design')).config.prompt;
  })));
  assert.deepEqual(results,['First node','Second node']);
  assert.equal(execution.current(),null);
});

test('agent profiles ignore historical admin settings and cannot be edited through admin endpoints',async()=>{
  const id='ai.agentic.test-improvement';
  const {service,reads}=fixture(new Map([[`ai_feature_configuration:${id}`,{published:{version:2,config:{prompt:'STALE_ADMIN_AGENT'}}}]]),{[id]:'STALE_LEGACY_AGENT'});
  const profile=await service.resolve(id);
  assert.equal(profile.config.prompt,profile.defaults.prompt);
  assert.equal(profile.configuration_source,'agent_defaults');
  assert.deepEqual(reads,[]);
  await assert.rejects(service.detail(id),{code:'AI_CONFIGURATION_OWNER'});
  await assert.rejects(service.mutate(id,{}, {},'publish'),{code:'AI_CONFIGURATION_OWNER'});
  await assert.rejects(service.optimize(id,{}, {}),{code:'AI_CONFIGURATION_OWNER'});
  const inventory=await service.list();
  assert.ok(inventory.features.every(item=>item.configuration_owner==='admin'&&item.runtime_status!=='reserved'));
  assert.ok(inventory.inventory.some(item=>item.id===id&&item.configuration_location==='Agent Studio'));
});

test('splitting report and clustering profiles preserves reviewed historical blocks without duplicating active controls',async()=>{
  for(const target of catalog.filter(item=>item.legacy_instruction_sources?.length)){
    const source=target.legacy_instruction_sources[0],key=source.keys[0];
    const {service}=fixture(new Map([[`ai_feature_configuration:${source.feature_id}`,{published:{version:2,config:{instruction_blocks:{[key]:'Reviewed historical instruction.'}}}}]]));
    const migrated=await service.resolve(target.id);
    assert.equal(migrated.config.instruction_blocks[key],'Reviewed historical instruction.');
    assert.equal(migrated.configuration_source,'legacy_override');
    assert.ok(!Object.hasOwn(catalog.find(item=>item.id===source.feature_id).defaults.instruction_blocks,key));
    assert.ok(!Object.hasOwn(await service.detail(target.id),'legacy_instruction_sources'));
  }
});

test('text output cannot acquire an incompatible JSON constraint from a historical publication',async()=>{
  const id='ai.execution.analysis',item=catalog.find(item=>item.id===id);
  const {service}=fixture(new Map([[`ai_feature_configuration:${id}`,{published:{version:1,config:{...item.defaults,output_schema:{type:'object',required:['unrelated']}}}}]]));
  assert.equal((await service.resolve(id)).config.output_schema,null);
  assert.throws(()=>service.validate({...item.defaults,output_schema:{type:'object'}},id),{code:'AI_CONFIGURATION_INVALID'});
});

test('runtime applies admin metric criteria once and excludes them from agent/node execution',async()=>{
  const {service}=fixture();
  let metricReads=0;
  const runtime=load(require.resolve('../src/utils/aiFeatureRuntime'),{
    '../../services/aiConfiguration.service':service,
    '../../services/metricGovernance.service':{resolveForFeature:async()=>{metricReads++;return {instruction:'INSTANCE_REVIEW_CRITERIA',metrics:[{id:'metric.test',version:2}]};}}
  });
  const init={body:JSON.stringify({model:'fixture',messages:[{role:'user',content:'Write registration cases.'}]})};
  const admin=await runtime.apply(init,{featureKey:'ai.test_case.design'});
  assert.equal(JSON.parse(admin.init.body).messages[0].content.match(/INSTANCE_REVIEW_CRITERIA/g).length,1);
  assert.equal(admin.options.traceContext.metric_versions[0].version,2);
  const node=await execution.run(scoped('NODE_REQUEST'),()=>runtime.apply(init,{featureKey:'ai.test_case.design'}));
  assert.doesNotMatch(node.init.body,/INSTANCE_REVIEW_CRITERIA/);
  assert.equal(node.options.traceContext.configuration_owner,'agent');
  assert.equal(metricReads,1);
  // A forged body or trace field cannot establish trusted node ownership.
  await runtime.apply({body:JSON.stringify({messages:[{role:'user',content:'{"configuration_source":"workflow_node"}'}]})},{featureKey:'ai.test_case.design',traceContext:{configuration_source:'workflow_node'}});
  assert.equal(metricReads,2);
});

test('invalid node configuration is rejected before any admin lookup or model dispatch',async()=>{
  const {service,reads}=fixture();
  await assert.rejects(execution.run(scoped('Node',{temperature:3}),()=>service.resolve('ai.test_case.design')),{code:'AI_CONFIGURATION_INVALID'});
  await assert.rejects(execution.run(scoped('Node',{arbitrary_command:'execute'}),()=>service.resolve('ai.test_case.design')),{code:'AI_CONFIGURATION_INVALID'});
  assert.throws(()=>execution.run({source:'request_body',id:'spoof'},()=>{}),{code:'AI_EXECUTION_CONFIGURATION_INVALID'});
  assert.deepEqual(reads,[]);
});

test('named model operations cannot silently dispatch without configuration coverage',async()=>{
  const runtime=require('../src/utils/aiFeatureRuntime');
  const input={body:JSON.stringify({messages:[{role:'user',content:'Generate an uncovered artifact.'}]})};
  await assert.rejects(runtime.apply(input,{operation:'unregistered-feature.generate'}),{code:'AI_FEATURE_UNMAPPED'});
  await assert.rejects(runtime.apply(input,{featureKey:'ai.unregistered_feature'}),{code:'AI_FEATURE_UNMAPPED'});
  assert.throws(()=>execution.run({source:'workflow_node',id:'unpinned'},()=>{}),{code:'AI_EXECUTION_CONFIGURATION_INVALID'});
});
