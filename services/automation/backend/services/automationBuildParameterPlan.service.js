const db=require('@hellotest/platform/backend/src/db');
const {getOptionalEvidenceAccess}=require('@hellotest/platform/backend/services/optionalEvidenceAccess.service');
const {loadAutomationManualContext,loadAutomationParameterContext}=require('../lib/automationBuildContext');
const {buildParameterValues,parameterPlanKey,assertParameterPlanKey}=require('../lib/automationBuildParameterPlan');

async function loadState({testCase,caseId=testCase?.id,projectId=testCase?.project_id,userId,test_environment_id,test_configuration_id,test_data_set_id,test_suite_id,parameter_values={},expectedKey}={}){
 if(!testCase)testCase=await db.prepare('SELECT tc.id,tc.app_type_id,tc.automated,app.project_id FROM test_cases tc JOIN app_types app ON app.id=tc.app_type_id WHERE tc.id=?').get(caseId);
 if(!testCase||projectId&&projectId!==testCase.project_id)throw Object.assign(new Error('The automation case is unavailable in this project.'),{statusCode:404});
 projectId=testCase.project_id;
 const permissions=['automation.build','data.view','testcase.view'];
 const access=await getOptionalEvidenceAccess({id:userId},projectId,permissions);
 if(!access['automation.build'])throw Object.assign(new Error('Reviewing build parameters requires automation build access.'),{statusCode:403});
 if(test_suite_id&&!access['data.view'])throw Object.assign(new Error('Test data access is required to use selected suite inputs.'),{statusCode:403,code:'AUTOMATION_BUILD_DATA_ACCESS_REQUIRED',nonRetryable:true,failure_stage:'context',automation_stage:'context',generation_provider_requests:0,browser_actions:0});
 if(access['data.view'])testCase=await db.prepare('SELECT tc.*,app.project_id FROM test_cases tc JOIN app_types app ON app.id=tc.app_type_id WHERE tc.id=? AND app.project_id=?').get(testCase.id,projectId);
 else testCase={id:testCase.id,app_type_id:testCase.app_type_id,automated:testCase.automated,project_id:projectId};
 if(!testCase)throw Object.assign(new Error('The automation case is unavailable in this project.'),{statusCode:404});
 const requestedCaseId=testCase.id;
 if(testCase.automated!=='yes'){
  const target=await db.prepare(`SELECT ${access['data.view']?'tc.*':'tc.id,tc.app_type_id,tc.automated'},app.project_id FROM test_cases tc JOIN app_types app ON app.id=tc.app_type_id WHERE tc.app_type_id=? AND tc.source_idempotency_key=? AND tc.automated='yes'`).get(testCase.app_type_id,`automation-builder:${testCase.id}`);
  if(target)testCase=target;
 }
 const steps=await db.prepare('SELECT id,step_order,step_type,action,expected_result,automation_code,api_request,group_id,reusable_group_id FROM test_steps WHERE test_case_id=? ORDER BY step_order,id').all(testCase.id);
 const ownAuthored=steps.map(({id,action,expected_result,api_request})=>({id,action,expected_result,api_request}));
 if(access['data.view']&&!access['testcase.view']&&require('../lib/automationBrowserParameters').referencedParameterNames(ownAuthored).length){
  const linked=await db.prepare(`SELECT link.manual_test_case_id FROM automation_case_links link
    JOIN test_cases target ON target.id=link.automation_test_case_id AND target.automated='yes'
    JOIN test_cases source ON source.id=link.manual_test_case_id AND source.app_type_id=target.app_type_id AND COALESCE(source.automated,'no')='no'
    JOIN app_types app ON app.id=target.app_type_id
    WHERE target.id=? AND app.project_id=? LIMIT 1`).get(testCase.id,projectId);
  if(linked)throw Object.assign(new Error('Test case access (testcase.view) is required to use the linked manual defaults advertised by this parameterized automation case.'),{statusCode:403,code:'AUTOMATION_LINKED_PARAMETER_ACCESS_REQUIRED'});
 }
 const manualCases=await loadAutomationManualContext({caseId:testCase.id,projectId,userId});
 const authoredSteps=[...steps,...manualCases.flatMap(item=>item.steps||[])].map(({id,action,expected_result,api_request})=>({id,action,expected_result,api_request}));
 const overrides=buildParameterValues(parameter_values);
 if(!access['data.view']&&(Object.keys(overrides).length||require('../lib/automationBrowserParameters').referencedParameterNames(authoredSteps).length))throw Object.assign(new Error('Test data access (data.view) is required to review or set the parameters referenced by this case.'),{statusCode:403,code:'AUTOMATION_BUILD_DATA_ACCESS_REQUIRED'});
 const parameters=await loadAutomationParameterContext({testCase,projectId,userId});
 let resolverCase=testCase;
 if(testCase.automated!=='yes'){
  const {parameter_overrides:sourcePriority,private_parameter_names:sourcePrivacy,...options}=require('@hellotest/platform/backend/src/utils/automationCaseBlueprint').buildAutomationCaseBlueprint({source:testCase,steps:[]}).test_data_options;
  // A new target has no authored own keys. Match createTestCase's removal of
  // stale own-priority markers while its source values remain live defaults.
  resolverCase={...testCase,automated:'yes',test_data_options:options};
 }
 const resolver=await require('../lib/automationBrowserParameters').loadBrowserParameterResolver({testCase:resolverCase,projectId,userId,caseValues:parameters.runtime_parameter_values,privateParameterNames:parameters.private_parameter_names,parameterOverrides:parameters.parameter_overrides,steps:authoredSteps,test_suite_id,test_environment_id:access['data.view']?test_environment_id:undefined,test_configuration_id:access['data.view']?test_configuration_id:undefined,test_data_set_id:access['data.view']?test_data_set_id:undefined,buildParameterValues:overrides,materialize:false});
 const key=parameterPlanKey({testCase,steps,manualCases,parameterSourceKey:parameters.source_key,inputSourceKey:resolver.inputSourceKey});
 assertParameterPlanKey(expectedKey,key);
 const data=resolver.buildData({testCaseId:testCase.id,steps:steps.map(({id,action,expected_result,api_request})=>({id,action,expected_result,api_request})),manualCases});
 const authoredNames=new Set(resolver.referencedParameterNames(authoredSteps));
 const emptyNames=(resolver.emptyParameterNames||[]).filter(name=>authoredNames.has(name));
 return {plan:{test_case_id:requestedCaseId,resolved_test_case_id:testCase.id,...(resolver.test_suite_id?{test_suite_id:resolver.test_suite_id}:{}),parameter_values:data.parameter_values,parameter_references:data.parameter_references,private_parameter_references:data.private_parameter_references,missing_parameter_references:data.missing_parameter_references,empty_parameter_references:emptyNames,deferred_parameter_references:resolver.deferredParameterNames||[],parameter_plan_key:key},inputSourceKey:resolver.inputSourceKey,sourceSteps:steps,dataAccess:access['data.view']===true};
}
async function load(input){return (await loadState(input)).plan;}
module.exports={load,loadState,buildParameterValues};
