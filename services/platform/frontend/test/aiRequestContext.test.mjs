import assert from 'node:assert/strict';
import test from 'node:test';
import { compactAiRequestBody, requestAiWithShorterContext } from '../src/lib/aiRequestContext.ts';

test('AI body reduction preserves Story, project, model, output scope and the full explicit instructions',()=>{
 const compact=JSON.parse(compactAiRequestBody(JSON.stringify({project_id:'project',requirement_ids:['story'],requirement_id:'story',integration_id:'provider',authoring_mode:'gherkin',max_cases:3,external_links:['https://pointer.test/spec'],additional_context:'x'.repeat(9000),requirement_context:{description:'Unsaved Story detail'}})));
 assert.deepEqual(compact.requirement_ids,['story']);assert.equal(compact.requirement_id,'story');assert.equal(compact.project_id,'project');assert.equal(compact.integration_id,'provider');assert.equal(compact.authoring_mode,'gherkin');assert.equal(compact.max_cases,3);
 assert.equal(compact.additional_context.length,9000);assert.deepEqual(compact.requirement_context,{description:'Unsaved Story detail'});assert.equal(compact.external_links,undefined);
});
test('only rejected inbound 413 requests can remove optional URL pointers once, with a disclosed result',async()=>{
 const bodies=[];
 const response=await requestAiWithShorterContext(async init=>{bodies.push(JSON.parse(init.body));if(bodies.length===1)throw Object.assign(new Error('too large'),{status:413});return{cases:[{title:'Draft'}]};},{method:'POST',body:JSON.stringify({requirement_ids:['story'],external_links:['https://pointer.test/spec']})});
 assert.equal(bodies.length,2);assert.deepEqual(bodies[1].requirement_ids,['story']);assert.equal(response.context_reduced,true);assert.match(response.context_reduction_reason,/external URL pointers were omitted/);
 for(const status of [400,401,403,429,500]){let calls=0;await assert.rejects(requestAiWithShorterContext(async()=>{calls++;throw Object.assign(new Error('failure'),{status});},{body:JSON.stringify({external_links:['https://pointer.test/spec']})}));assert.equal(calls,1);}
 let upstreamCalls=0;await assert.rejects(requestAiWithShorterContext(async()=>{upstreamCalls++;throw Object.assign(new Error('LLM request failed with status 413'),{status:413});},{body:JSON.stringify({external_links:['https://pointer.test/spec']})}));assert.equal(upstreamCalls,1);
});
test('size reduction preserves the full authored source, Examples and data declarations for improvement',()=>{
 const source={id:'case-identity',title:'Checkout',description:'Preserve existing flow',authoring_mode:'gherkin',gherkin_document:'Feature: Checkout\nScenario Outline: Pay\nWhen I pay <amount>\nThen a receipt appears\nExamples:\n| amount |\n| 10 |',parameter_values:{amount:'10'},steps:[{action:'Pay',expected_result:'Receipt'}],automation_status:'automated',test_data_set_ids:['existing-data']};
 const compact=JSON.parse(compactAiRequestBody(JSON.stringify({test_case:source,external_links:['https://pointer.test/spec'],additional_context:'x'.repeat(3000)})));
 assert.deepEqual(compact.test_case,source);assert.equal(compact.additional_context.length,3000);assert.equal(compactAiRequestBody(JSON.stringify({test_case:source})),null);
});
test('inbound image rejection never retries after dropping screenshots or their supporting written context',async()=>{
 for(const field of ['images','reference_photos']){
  const input={requirement_context:{description:'Unsaved Story'},additional_context:'Inspect the error screenshot',external_links:['https://pointer.test/spec'],[field]:[{url:'data:image/png;base64,AAAA'}]};
  assert.equal(compactAiRequestBody(JSON.stringify(input)),null);
  let calls=0;await assert.rejects(requestAiWithShorterContext(async()=>{calls++;throw Object.assign(new Error('Request too large: crop a screenshot'),{status:413});},{body:JSON.stringify(input)}),/crop/);assert.equal(calls,1);
 }
});
