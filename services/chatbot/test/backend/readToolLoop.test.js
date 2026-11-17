'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const loop=require('../../backend/services/assistant/readToolLoop');
const catalog=require('@hellotest/mcp/backend/server').tools;

test('only analytical questions enter the model-directed read path',()=>{
  assert.equal(loop.classifyIntent({},'Compare failed runs across releases'),'comparison');
  assert.equal(loop.classifyIntent({},'Which tests cover STORY-12?'),'traceability');
  assert.equal(loop.classifyIntent({},'How many open defects are there?'),'aggregate');
  assert.equal(loop.classifyIntent({},'How do I configure a project?'),'lookup');
  assert.equal(loop.classifyIntent({intent_class:'product_help'},'Which tests cover STORY-12?'),'product_help');
});

test('read plan validation drops writes, unknown tools, malformed arguments and duplicates',()=>{
  const result=loop.normalizeCalls([
    {name:'hellotest_graph_resolve',arguments:{query:'STORY-12'}},
    {name:'hellotest_graph_resolve',arguments:{query:'STORY-12'}},
    {name:'hellotest_operation_execute',arguments:{plan_id:'plan-1'}},
    {name:'hellotest_graph_trace',arguments:{source:{kind:'requirement',ref_id:'story-1'}}},
    {name:'hellotest_graph_context',arguments:{seeds:[]}},
    {name:'unlisted_tool',arguments:{query:'anything'}}
  ],catalog);
  assert.equal(result.calls.length,1);
  assert.equal(result.calls[0].name,'hellotest_graph_resolve');
  assert.equal(result.rejected,4);
});

test('read loop runs in parallel rounds and charges continuation planning against the same budget',async()=>{
  const invoked=[];let active=0,maxActive=0;
  const result=await loop.run({intentClass:'traceability',maxCalls:5,deadlineAt:Date.now()+10_000,
    proposedCalls:[
      {name:'hellotest_graph_resolve',arguments:{query:'STORY-12'}},
      {name:'hellotest_graph_context',arguments:{seeds:[{kind:'requirement',ref_id:'story-12'}]}},
      {name:'hellotest_database_query',arguments:{entity:'test_cases'}}
    ],
    dispatch:async(name)=>{invoked.push(name);active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,5));active--;
      return name==='hellotest_graph_context'?{nodes:[{id:'src-story-12',source_id:'src-story-12'}],edges:[{id:'e1',source:'src-story-12',target:'src-tc-1',type:'TESTS',provenance_type:'DETERMINISTIC',evidence_ids:['K-proof']}],
        evidence:[{evidence_id:'K-proof',source_id:'src-tc-1',content:'The test verifies STORY-12.',citation:{id:'K-proof',source_id:'src-tc-1'}}]}:{nodes:[]};},
    continuePlan:async()=>({read_tools:[{name:'hellotest_graph_trace',arguments:{source:{kind:'requirement',ref_id:'story-12'},target:{kind:'test_case',ref_id:'tc-1'}}},
      {name:'hellotest_context_graph_list',arguments:{limit:5}}]})
  });
  assert.equal(maxActive,3,'independent reads execute concurrently');
  assert.equal(invoked.length,4,'one continuation model call consumes the fifth shared slot');
  assert.equal(result.tool_calls_used,4);
  assert.equal(result.planner_calls,1);
  assert.equal(result.calls.length,5);
  assert.deepEqual(result.source_ids,['src-tc-1','src-story-12']);
  assert.equal(result.evidence.length,1);
  assert.equal(result.relationships.length,1);
});

test('tool failure becomes a visible gap and does not fail the assistant turn',async()=>{
  const result=await loop.run({intentClass:'investigation',maxCalls:1,deadlineAt:Date.now()+1000,
    proposedCalls:[{name:'hellotest_graph_resolve',arguments:{query:'RUN-3'}}],
    dispatch:async()=>{throw Object.assign(new Error('hidden detail'),{code:'MCP_ACCESS_DENIED'});}});
  assert.equal(result.status,'failed');
  assert.deepEqual(result.gaps,['hellotest_graph_resolve did not return a verified read result.']);
  assert.ok(!JSON.stringify(result).includes('hidden detail'));
});
