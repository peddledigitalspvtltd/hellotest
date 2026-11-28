const test=require('node:test');
const assert=require('node:assert/strict');
const assistant=require('../../backend/services/knowledgeAssistant.service');
const {mergeAssistantContextFilters}=assistant._internals;

test('Smart Context intersects explicit source selections without replacing scope or historical constraints',()=>{
 const merged=mergeAssistantContextFilters({base:{source_ids:['a','b'],collection_ids:['collection'],as_of:'2026-01-01T00:00:00Z'},
  override:{source_kinds:['requirement','test_case'],evidence_scope:{story_id:'story'}},
  smartContext:{source_ids:['b','c'],source_kinds:['test_case','file']}});
 assert.deepEqual(merged,{source_ids:['b'],source_kinds:['test_case'],collection_ids:['collection'],as_of:'2026-01-01T00:00:00Z',evidence_scope:{story_id:'story'}});
 assert.deepEqual(mergeAssistantContextFilters({override:{source_kinds:['file']},smartContext:{source_ids:['file-source'],source_kinds:[]}}),{source_kinds:['file'],source_ids:['file-source']});
});

test('disjoint Smart Context sources fail explicitly instead of expanding retrieval to all sources',()=>{
 for(const key of ['source_ids','source_kinds'])assert.throws(()=>mergeAssistantContextFilters({override:{[key]:['one']},smartContext:{[key]:['two']}}),{statusCode:422,code:'KNOWLEDGE_SOURCE_SELECTION_CONFLICT'});
});

test('available models distinguish the preferred workspace connection from the authorized automatic selection',async t=>{
 const integrationService=require('@hellotest/integration/backend/services/integration.service');
 const selection=require('@hellotest/integration/backend/services/aiLlmSelection.service');
 const base={type:'llm',is_active:true,model:'model-test',api_key:'sk-chat-default-test-01234567890'};
 const custom={...base,id:'custom',name:'Project assistant',config:{project_id:'project'}};
 const preferred={...base,id:'preferred',name:'Workspace preferred',is_default:true,config:{}};
 const foreign={...base,id:'foreign',name:'Other project',config:{project_id:'other-project'}};
 t.mock.method(integrationService,'getIntegrations',async()=>[foreign,preferred,custom]);
 t.mock.method(selection,'resolveLlmIntegrationForUsage',async()=>custom);
 const rows=await assistant.listAvailableLlmIntegrations({projectId:'project',userId:'user'});
 assert.deepEqual(rows.map(({id,is_default,is_automatic_selection})=>({id,is_default,is_automatic_selection})),[
  {id:'custom',is_default:false,is_automatic_selection:true},{id:'preferred',is_default:true,is_automatic_selection:false}
 ]);
 assert.ok(rows.every(row=>!Object.hasOwn(row,'api_key')));
});
