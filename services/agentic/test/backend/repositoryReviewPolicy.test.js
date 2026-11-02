const test=require('node:test'),assert=require('node:assert/strict');
const configuration=require('@hellotest/platform/backend/services/aiConfiguration.service');
const execution=require('@hellotest/platform/backend/src/utils/aiExecutionConfiguration');
const catalog=require('@hellotest/platform/shared/aiFeatureCatalog.json');
for(const kind of ['api_tests','component_tests','repository_knowledge'])test(`${kind}: current source defaults apply while saved task instructions remain owned by their execution`,async()=>{
 const item=catalog.find(profile=>profile.id===`ai.agentic.repository.${kind}`);
 const resolved=await configuration.resolve(item.id);assert.equal(resolved.config.prompt,item.defaults.prompt);
 const prompt='Our reviewed source-only task instructions.';
 const custom=await execution.run({source:'agent_definition',id:'reviewed-source-agent',feature_id:item.id,config:{prompt,temperature:0.35}},()=>configuration.resolve(item.id));
 assert.equal(custom.config.prompt,prompt);assert.equal(custom.config.temperature,0.35);
 assert.equal((await configuration.resolve(item.id)).config.prompt,item.defaults.prompt);
});
