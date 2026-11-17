'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {aggregateContextHealth,refKey}=require('../../backend/services/knowledgeContextHealth');

const rows=Array.from({length:5},(_,index)=>({id:`trace-${index}`,actor_id:`private-actor-${index}`,selection:{query_category:'project_analysis'},
  coverage:{retrieval_status:'COMPLETE'},evidence_refs:[{evidence_id:`private-evidence-${index}`,source_id:'source-1',source_kind:'text'}]}));
const events=rows.flatMap(row=>[{trace_id:row.id,event_type:'CONTEXT_SENT',status:'submitted',metadata:{evidence_ids:[row.evidence_refs[0].evidence_id]}},
  {trace_id:row.id,event_type:'CITATIONS_RECORDED',status:'recorded',metadata:{evidence_ids:[row.evidence_refs[0].evidence_id]}}]);

test('context health aggregates visible evidence and events without actor, question, prompt or passage data',()=>{
  const visibleEvidence=new Set(rows.map(row=>refKey(row.id,row.evidence_refs[0].evidence_id)));
  const value=aggregateContextHealth({projectId:'project',rows,events,visibleEvidence,sourceDetails:new Map([['source-1',{id:'source-1',title:'Authorized Source'}]]),days:30,truncated:false,generatedAt:new Date('2026-11-16T00:00:00.000Z')});
  assert.equal(value.observations.trace_count,5);assert.equal(value.observations.selected_evidence_count,5);
  assert.equal(value.observations.submitted_evidence_count,5);assert.equal(value.observations.cited_evidence_count,5);
  assert.equal(value.query_classes[0].query_class,'project_analysis');assert.equal(value.sources[0].source_id,'source-1');
  assert.doesNotMatch(JSON.stringify(value),/private-actor|private-evidence|question text|source passage/);
});

test('context health suppresses aggregates below the distinct actor threshold and flags bounded scans',()=>{
  const small=rows.slice(0,4),value=aggregateContextHealth({projectId:'project',rows:small,events:[],visibleEvidence:new Set(small.map(row=>refKey(row.id,row.evidence_refs[0].evidence_id))),
    sourceDetails:new Map([['source-1',{id:'source-1',title:'Authorized Source'}]]),days:30,truncated:true});
  assert.equal(value.observations.cohort_available,false);assert.equal(value.observations.trace_count,undefined);
  assert.deepEqual(value.query_classes,[]);assert.deepEqual(value.sources,[]);assert.equal(value.observations.partial,true);
  assert.match(value.limitations[0],/bounded trace scan/);
});

test('context health excludes sources that fail current authorization and ignores unsupported class labels',()=>{
  const altered=rows.map(row=>({...row,selection:{query_category:'PRIVATE_RAW_CATEGORY'}}));
  const value=aggregateContextHealth({projectId:'project',rows:altered,events,visibleEvidence:new Set(),sourceDetails:new Map(),days:30,truncated:false});
  assert.equal(value.query_classes[0].query_class,'other');assert.equal(value.query_classes[0].selected_evidence_count,0);
  assert.deepEqual(value.sources,[]);
});
