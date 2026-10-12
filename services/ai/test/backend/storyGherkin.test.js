const test = require('node:test');
const assert = require('node:assert/strict');
const review = require('../../backend/services/structuredReview.service');
const service = require('../../backend/services/storyGherkin.service');
const input = { project_id:'project',user:{id:'reviewer'},additional_context:'Use a concise refund boundary scenario.',requirements:[
  {client_id:'refund',title:'Refund',description:'Only settled funds may be refunded.',acceptance_criteria:['Reject a refund larger than the settled amount.']},
  {client_id:'unknown',title:'Unspecified behavior'}
] };
const valid = () => ({ requirements:[{client_id:'refund',scenarios:[{gherkin:'Scenario: Reject an excessive refund\nGiven a settled payment\nWhen a refund exceeds the settled amount\nThen the refund is rejected',criterion_refs:['refund:AC1']}]}] });
test('Gherkin uses its managed profile, exact Story criteria and guidance in full and reduced context',async t=>{
 let captured;
 t.mock.method(review,'review',async args=>{captured=args;return {result:args.validate(valid()),integration:{id:'model'},model_execution:{model_calls:1},context_reduced:true};});
 const result=await service.preview(input);
 assert.equal(captured.usageKey,'ai.requirement.gherkin');assert.equal(captured.userId,'reviewer');assert.equal(captured.projectId,'project');
 assert.equal(captured.evidence.stories.length,1);assert.match(JSON.stringify(captured.fallbackEvidence),/settled amount/);assert.match(JSON.stringify(captured.fallbackEvidence),/concise refund boundary/);
 assert.equal(result.generation_mode,'llm');assert.equal(result.requires_human_review,true);assert.equal(result.context_reduced,true);
 assert.deepEqual(result.requirements[1].gherkin_scenarios,[]);assert.equal(result.validation.skipped_story_count,1);
});
test('Gherkin rejects another Story’s references, duplicate mappings and malformed or placeholder scenarios',async t=>{
 for(const mutate of [value=>value.requirements[0].scenarios[0].criterion_refs=['other:AC1'],value=>value.requirements[0].scenarios[0].gherkin='Scenario: Missing outcome\nGiven a payment\nWhen refunded',value=>value.requirements[0].scenarios[0].gherkin='Scenario: Generic\nGiven the documented Story context applies\nWhen the reviewed behavior is exercised\nThen an outcome']){
  t.mock.method(review,'review',async args=>{const value=valid();mutate(value);return {result:args.validate(value)};});
  await assert.rejects(service.preview(input),{code:'AI_REVIEW_INVALID'});
  t.mock.restoreAll();
 }
 await assert.rejects(service.preview({...input,requirements:[input.requirements[0],input.requirements[0]]}),{statusCode:400});
});
test('missing acceptance criteria stops Gherkin before a model call',async t=>{
 const model=t.mock.method(review,'review',async()=>assert.fail('No evidence to generate from'));
 await assert.rejects(service.preview({...input,requirements:[input.requirements[1]]}),{code:'AI_EVIDENCE_REQUIRED'});
 assert.equal(model.mock.callCount(),0);
});
