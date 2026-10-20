const test=require('node:test'),assert=require('node:assert/strict');
const {buildAutomationCaseBlueprint}=require('../../../platform/backend/src/utils/automationCaseBlueprint');
test('manual-to-automation creates an independent linked case and preserves effective data rules',()=>{
 const source={id:'manual',app_type_id:'app',title:'Manual behavior',automated:'no',parameter_values:{'t.customer':'customer'},test_data_options:{override_shared_steps:false,override_shared_sections:true,override_test_case_data:false,override_suite_data:true},test_data_set_ids:['data']};
 const before=structuredClone(source);const result=buildAutomationCaseBlueprint({source,steps:[{id:'source-step',action:'Check customer',expected_result:'Customer visible',group_id:'group',group_kind:'reusable',reusable_group_id:'library'}],createdBy:'user',createGroupId:()=> 'new-group'});
 assert.equal(result.automated,'yes');assert.equal(result.id,undefined);assert.equal(result.display_id,undefined);assert.deepEqual(result.manual_test_case_ids,['manual']);assert.equal(result.steps[0].id,undefined);assert.equal(result.steps[0].group_id,'new-group');
 assert.equal(result.test_data_options.shared_data_kind,'sections');assert.equal(result.test_data_options.override_shared_sections,false);assert.equal(result.test_data_options.override_test_case_data,false);assert.deepEqual(result.test_data_set_ids,['data']);assert.deepEqual(source,before);
});
