import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../platform/frontend/package.json',import.meta.url));
const ts=require('typescript'),module={exports:{}};
new Function('module','exports',ts.transpileModule(readFileSync(new URL('../../frontend/lib/knowledgeGraphView.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module,module.exports);
const {filterGraph,layoutGraph,graphKindLabel,graphProofLabel,graphDate,canOpenGraphSource}=module.exports;
const nodes=[{id:'story-1',kind:'requirement',title:'Checkout acceptance',aliases:['Payments flow']},{id:'case-1',kind:'test_case',title:'Retry returns one order',ref_id:'TC_7'},{id:'run-1',kind:'execution',title:'Recorded checkout result'}];
const edges=[{id:'tests',source:'case-1',target:'story-1',type:'TESTS',provenance_type:'DETERMINISTIC',evidence_ids:['proof-1']},{id:'executes',source:'run-1',target:'case-1',type:'EXECUTES',provenance_type:'HUMAN_VERIFIED',evidence_ids:['proof-2']}];
test('display projection preserves exact directed edges and witnesses without adding connections',()=>{
  const before=JSON.stringify({nodes,edges}),graph=filterGraph(nodes,[...edges,{...edges[0],id:'unreadable',target:'denied-source'}],{});
  assert.deepEqual(graph.nodes,nodes);assert.deepEqual(graph.edges,edges);assert.equal(graph.omitted_edges,1);
  assert.equal(JSON.stringify({nodes,edges}),before);
});
test('record identifiers, aliases and relation/provenance filters remain independent and clearable',()=>{
  assert.deepEqual(filterGraph(nodes,edges,{query:'TC_7'}).nodes.map(n=>n.id),['case-1']);
  assert.deepEqual(filterGraph(nodes,edges,{query:'payments'}).nodes.map(n=>n.id),['story-1']);
  assert.deepEqual(filterGraph(nodes,edges,{relation:'TESTS'}).edges.map(e=>e.id),['tests']);
  assert.deepEqual(filterGraph(nodes,edges,{provenance:'HUMAN_VERIFIED'}).edges.map(e=>e.id),['executes']);
  assert.equal(filterGraph(nodes,edges,{kind:'bug'}).nodes.length,0);
  assert.deepEqual(filterGraph(nodes,edges,{}).edges,edges);
});
test('stable layout preserves recorded direction and handles cycles, disconnected records and input order',()=>{
  const before=JSON.stringify({nodes,edges}),layout=layoutGraph(nodes,edges);
  assert.deepEqual(layoutGraph([...nodes].reverse(),[...edges].reverse()),layout);
  const pos=new Map(layout.map(item=>[item.id,item.position]));
  assert.ok(pos.get('run-1').x<pos.get('case-1').x&&pos.get('case-1').x<pos.get('story-1').x);
  const cycle=layoutGraph([...nodes,{id:'orphan',kind:'text',title:'Unconnected note'}],[...edges,{...edges[0],id:'cycle',source:'story-1',target:'run-1'}]);
  assert.equal(cycle.length,4);assert.equal(new Set(cycle.map(item=>JSON.stringify(item.position))).size,4);
  assert.equal(JSON.stringify({nodes,edges}),before);
});
test('labels distinguish native facts, human-reviewed extraction and observed events without invented confidence or dates',()=>{
  assert.equal(graphKindLabel('requirement'),'Story');assert.equal(graphProofLabel('DETERMINISTIC'),'Native relationship');
  assert.equal(graphProofLabel('HUMAN_VERIFIED'),'Reviewed relationship');assert.equal(graphProofLabel('SOURCE_EXPLICIT'),'Source assertion');assert.equal(graphKindLabel('policy_check'),'Access policy check');assert.equal(graphProofLabel('OBSERVED_EVENT'),'Recorded event');
  assert.notEqual(graphProofLabel('LLM_CANDIDATE'),'Reviewed relationship');
  assert.equal(graphDate(null),'Not recorded');assert.equal(graphDate('invalid-date'),'Not recorded');
});
test('built-in guides and task nodes cannot open an indexed source drawer',()=>{
  assert.equal(canOpenGraphSource({id:'task-1',kind:'task',title:'Task'}),false);
  assert.equal(canOpenGraphSource({id:'hellotest-product-help',source_id:'hellotest-product-help',kind:'product_help',title:'Guide'}),false);
  assert.equal(canOpenGraphSource({id:'live-project-p-stories',source_id:'live-project-p-stories',kind:'live_snapshot',title:'Recorded Stories'}),false);
  assert.equal(canOpenGraphSource({id:'unindexed',source_id:'unindexed',kind:'text',title:'Unindexed',metadata:{indexed:false}}),false);
  assert.equal(canOpenGraphSource({id:'source-1',source_id:'source-1',kind:'text',title:'Approved source'}),true);
});
