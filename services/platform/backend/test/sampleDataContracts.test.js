const assert = require('node:assert/strict');
const test = require('node:test');
const { validateRecordContract } = require('../services/sampleData/contracts');
test('sample records use fixed native review, planning and transport contracts', () => {
  for (const [table,row] of [['test_cases',{review_status:'accepted',authoring_mode:'gherkin'}],['requirement_iterations',{state:'future'}],['requirement_release_items',{source:'manual'}],['executions',{execution_mode:'remote',trigger:'manual'}]]) assert.doesNotThrow(()=>validateRecordContract({table,path:'fixture.json'},row));
  for (const [table,row] of [['test_cases',{review_status:'approved'}],['requirement_iterations',{state:'planned'}],['requirement_release_items',{source:'direct'}],['executions',{execution_mode:'manual'}],['execution_schedules',{cadence:'every:30:minutes'}]]) assert.throws(()=>validateRecordContract({table,path:'fixture.json'},row),{code:'SETUP_RECORD_CONTRACT'});
});
test('native validation keeps configured unconstrained dropdown values and hides rejected input', () => {
 assert.doesNotThrow(()=>validateRecordContract({table:'test_cases',path:'fixture.json'},{status:'custom_status',test_case_type:'custom_smoke'}));
 assert.throws(()=>validateRecordContract({table:'test_cases',path:'fixture.json'},{review_status:'private-marker'}),error=>error.code==='SETUP_RECORD_CONTRACT'&&!error.message.includes('private-marker'));
});
