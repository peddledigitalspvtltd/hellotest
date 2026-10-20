const test=require('node:test');
const assert=require('node:assert/strict');
const {mergeAssistantContextFilters}=require('../../backend/services/knowledgeAssistant.service')._internals;

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
