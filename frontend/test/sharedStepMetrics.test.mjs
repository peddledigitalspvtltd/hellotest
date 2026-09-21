import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import ts from 'typescript';
const exports={};new Function('exports',ts.transpileModule(readFileSync(new URL('../src/lib/sharedStepMetrics.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exports);
const {sharedStepMetricCards}=exports;
test('Shared Step cards distinguish execution/repository ratios, missing evidence and source access',()=>{
  const data={reused_case_count:1,shared_step_references:2,total_repository_steps:3,shared_steps_executed:5,reusability_index:166.7,window_days:90,open_defect_count:3,execution_visible:true,failure_cluster_count:1,mtti_ms:null,mtti_unavailable_reason:'No recorded failure-to-isolation timestamp pairs are available.'};
  const cards=sharedStepMetricCards(data);assert.equal(cards[0].value,1);assert.equal(cards[1].value,'166.7%');assert.match(cards[1].methodology,/more than 100%/);assert.match(cards[1].detail,/5 shared step execution instances ÷ 3/);assert.equal(cards[2].label,'Open Defects');assert.equal(cards[2].value,3);assert.match(cards[2].methodology,/does not establish root cause/);assert.equal(cards.length,4);assert.equal(cards.some(card=>/isolation/i.test(card.label)),false);assert.match(cards[3].methodology,/not proof/);
  const absent=sharedStepMetricCards(undefined,'Access required');assert.ok(absent.every(card=>card.value==='Unavailable'));assert.equal(absent[0].detail,'Access required');
  assert.equal(sharedStepMetricCards({...data,reusability_index:null,total_repository_steps:0})[1].value,'Unavailable');
});

test('missing data-row identity is explained separately from source permissions or loading',()=>{
 const cards=sharedStepMetricCards({execution_visible:true,execution_evidence_reason:'Native outcomes have no data-row identity.',shared_steps_executed:null,reusability_index:null,reused_case_count:2,total_repository_steps:9,window_days:90});
 assert.equal(cards[0].value,2);for(const index of [1]){assert.equal(cards[index].value,'Unavailable');assert.equal(cards[index].detail,'Native outcomes have no data-row identity.');assert.doesNotMatch(cards[index].detail,/loading|access is required/i);}
});

test('Open defect availability is independent of ambiguous execution totals',()=>{
 const data={execution_visible:true,shared_steps_executed:null,execution_evidence_reason:'Unknown row identity',open_defect_count:2};
 assert.equal(sharedStepMetricCards(data)[2].value,2);
 const hidden=sharedStepMetricCards({...data,open_defect_count:null,defect_evidence_reason:'Defect access is required.'})[2];
 assert.equal(hidden.value,'Unavailable');assert.equal(hidden.detail,'Defect access is required.');
});
