const assert = require('node:assert/strict');
const test = require('node:test');
process.env.NODE_ENV = 'test';
const {normalizeStoryImportRow} = require('../../../platform/backend/src/utils/storyImportRow');
const {storyAdditionalFields} = require('../../../platform/backend/src/utils/storyAcceptanceCriteria');
const {deriveStoryReadiness,contentHash} = require('../../../platform/backend/src/utils/storyReadiness');
const {__groomingInternals} = require('../../backend/services/requirementWorkspace.service');
test('Story import validates canonical metadata and explicit update revisions',()=>{
  assert.equal(normalizeStoryImportRow({title:'Story',status:'QA Done'}).status,'qa_done');
  for(const input of [{title:'Story',priority:0},{title:'Story',story_id:'id'},{title:'Story',status:'missing'},{title:'Story',dev_completion_target_date:'2026-02-30'},{title:'Story',additional_fields:{_story_readiness:{}}},{title:'Story',acceptance_criteria:[{}]},{title:'Story',linked_test_cases:[1]}]) assert.throws(()=>normalizeStoryImportRow(input));
});
test('Acceptance Criteria preserves custom fields and reviews, invalidates stale reviews and grounds grooming',()=>{
  const criteria=['Given a valid address, when I save it, then it appears at checkout.'];
  const saved={component:'Payments',_story_readiness:{checks:{}}};
  const fields=storyAdditionalFields({component:'Checkout',_story_readiness:{spoof:true}},criteria,saved);
  assert.deepEqual(fields,{...saved,component:'Checkout',acceptance_criteria:criteria});
  assert.equal(storyAdditionalFields({_story_import:{transaction_id:'spoofed'}})._story_import,undefined);
  const story={id:'story',title:'Save address',description:'As a buyer I want to save my address so that checkout is faster.',additional_fields:fields};
  assert.equal(deriveStoryReadiness(story).score,40);
  assert.notEqual(contentHash(story),contentHash({...story,additional_fields:{...fields,acceptance_criteria:['Different criterion']}}));
  const grooming=__groomingInternals.buildDeterministicGrooming({requirement:story});
  assert.deepEqual(grooming.walkthrough.validation.acceptance_criteria,criteria);
  assert.throws(()=>storyAdditionalFields({},['x'.repeat(2001)]),/2,000/);
  assert.throws(()=>storyAdditionalFields({large:'x'.repeat(50000)},criteria),/50,000/);
});
