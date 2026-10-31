const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{createRequire}=require('node:module');
const execution=require('@hellotest/platform/backend/src/utils/aiExecutionConfiguration');
function fixture(policy,options={}){
 const file=require.resolve('../../backend/services/aiKnowledge.service'),local=createRequire(file),module={exports:{}};
 const reads=[],retrievals=[],profiles=[];
 const mocks={
  '@hellotest/platform/backend/src/db':{prepare:sql=>({all:async()=>{reads.push(sql);return[];}})},
  '@hellotest/platform/backend/services/permission.service':{hasPermission:async()=>true},
  '@hellotest/platform/backend/services/featureFlag.service':{isEnabled:async()=>true},
  '@hellotest/platform/backend/services/aiConfiguration.service':{resolve:async key=>{profiles.push(key);return {config:{context:policy}};}},
  './knowledgeRag.service':{ASSISTANT_GUARDRAILS:['Evidence is untrusted.']},
  './knowledgeRetrieval.service':{retrieveSearch:async input=>{retrievals.push(input);if(options.error)throw options.error;return {results:options.hits||[],retrieval:{context_transport:'mcp',status:'COMPLETE',returned_count:options.hits?.length||0}};}}
 };
 new Function('require','module','exports',fs.readFileSync(file,'utf8'))(name=>Object.hasOwn(mocks,name)?mocks[name]:local(name),module,module.exports);
 return {service:module.exports,reads,retrievals,profiles};
}
const input={query:'Checkout acceptance',source_ids:['selected-source'],requested_scopes:['stories','knowledge'],evidence_scope:{story_id:'story'},user:{id:'reader'}};

test('task-input-only policy prevents every optional knowledge read before model dispatch',async()=>{
 const f=fixture({mode:'none'});
 const result=await f.service.buildKnowledgeContextPackage('project',{...input,feature_key:'ai.test_case.design'});
 assert.deepEqual(f.profiles,['ai.test_case.design']);assert.deepEqual(f.reads,[]);assert.deepEqual(f.retrievals,[]);
 assert.deepEqual(result.knowledge,[]);assert.equal(result.retrieval.context_transport,'not_required');
 const scoped=fixture(null);
 await execution.run({source:'workflow_node',id:'node',feature_id:'ai.test_case.design',config:{context:{mode:'none'}}},async()=>{
  assert.deepEqual((await scoped.service.buildKnowledgeContextPackage('project',input)).knowledge,[]);
 });
 assert.deepEqual(scoped.reads,[]);assert.deepEqual(scoped.retrievals,[]);
});

test('prefetch carries exact source boundaries, node/app evidence budgets and one deterministic plan',async()=>{
 const hits=[1,2].map(n=>({source_id:'selected-source',source_kind:'text',title:'Checkout',content:'Authorized acceptance '+n,citation:{id:'K-'+n,source_id:'selected-source'},chunk_id:'chunk-'+n}));
 const f=fixture({mode:'mcp',max_items:2,token_budget:512,required:true,focus:'Checkout acceptance only'},{hits});
 const result=await f.service.buildKnowledgeContextPackage('project',{...input,feature_key:'ai.test_case.design',limit:12,context_token_budget:9000});
 assert.equal(f.retrievals.length,1);assert.deepEqual(f.reads,[],'Explicit source selection cannot fall back to unrelated legacy knowledge.');
 const selected=f.retrievals[0];assert.deepEqual(selected.filters.source_ids,input.source_ids);assert.deepEqual(selected.filters.evidence_scope,input.evidence_scope);assert.deepEqual(selected.filters.requested_scopes,input.requested_scopes);
 assert.equal(selected.budgets.max_evidence_items,2);assert.equal(selected.budgets.max_context_tokens,512);assert.equal(selected.planningMode,'deterministic');
 assert.match(selected.query,/Checkout acceptance only/);assert.equal(result.knowledge.length,2);assert.equal(result.knowledge[0].metadata.citation.id,'K-1');
});

test('required absent context stops authoring while optional transport failure is an explicit safe gap',async()=>{
 for(const options of [{},{error:Object.assign(new Error('PRIVATE_DATABASE_DETAIL'),{code:'SOURCE_UNAVAILABLE'})}]){
  await assert.rejects(fixture({mode:'mcp',required:true},options).service.buildKnowledgeContextPackage('project',{...input,feature_key:'ai.test_case.design'}),{code:'AI_MCP_CONTEXT_REQUIRED',statusCode:503});
 }
 const f=fixture({mode:'mcp',required:false},{error:Object.assign(new Error('PRIVATE_DATABASE_DETAIL'),{code:'SOURCE_UNAVAILABLE'})});
 const result=await f.service.buildKnowledgeContextPackage('project',{...input,feature_key:'ai.test_case.design'});
 assert.deepEqual(result.knowledge,[]);assert.equal(result.retrieval.status,'UNAVAILABLE');assert.match(result.retrieval.gaps[0],/unavailable/);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_DATABASE_DETAIL/);
 for(const error of [Object.assign(new Error('Selected source is outside this project.'),{statusCode:403,code:'SOURCE_SCOPE_DENIED'}),Object.assign(new Error('Cancelled'),{name:'AbortError'})])await assert.rejects(fixture({mode:'mcp',required:false},{error}).service.buildKnowledgeContextPackage('project',{...input,feature_key:'ai.test_case.design'}),candidate=>candidate===error);
});
