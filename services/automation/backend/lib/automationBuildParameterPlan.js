const {createHmac,timingSafeEqual}=require('node:crypto');
const {resolveSessionSecret}=require('@hellotest/platform/backend/src/security/runtimeSecrets');
const {normalizeParameterKey}=require('@hellotest/platform/backend/src/utils/stepParameterResolution');

function buildParameterValues(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>256)throw invalidValues();
 const values={};
 for(const [name,value]of Object.entries(input)){
  const key=normalizeParameterKey(name,'r');
  if(!key||key.length>200||/[\u0000-\u001f\u007f]/.test(key)||typeof value!=='string'||value.length>20000)throw invalidValues();
  if(Object.hasOwn(values,key)&&values[key]!==value)throw invalidValues();
  values[key]=value;
 }
 return values;
}
function invalidValues(){return Object.assign(new Error('Build parameters must contain at most 256 named text values within the supported input limits.'),{statusCode:400,code:'AUTOMATION_BUILD_PARAMETERS_INVALID',nonRetryable:true});}
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
// Receipts expose no source values. A changed private binding also invalidates
// a reviewed plan because the resolver hashes authorized source snapshots.
function parameterPlanKey({testCase,steps=[],manualCases=[],parameterSourceKey,inputSourceKey}){
 return createHmac('sha256',resolveSessionSecret()).update('hellotest.automation-parameter-plan.v1\0').update(JSON.stringify(canonical({version:1,case:{id:testCase.id,app_type_id:testCase.app_type_id,project_id:testCase.project_id,parameter_values:testCase.parameter_values,test_data_options:testCase.test_data_options},steps:steps.map(({id,step_order,action,expected_result,step_type,automation_code,api_request,group_id,reusable_group_id})=>({id,step_order,action,expected_result,step_type,automation_code,api_request,group_id,reusable_group_id})),manualCases,parameterSourceKey,inputSourceKey}))).digest('hex');
}
function assertParameterPlanKey(expected,actual){
 if(expected!==undefined&&expected!==null&&(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)||!timingSafeEqual(Buffer.from(expected),Buffer.from(actual))))throw Object.assign(new Error('The reviewed test parameters or manual specification changed. Review the current parameter dialog before building again.'),{statusCode:409,code:'AUTOMATION_PARAMETER_PLAN_CHANGED',nonRetryable:true,failure_stage:'context',automation_stage:'context',generation_provider_requests:0,browser_actions:0});
}
module.exports={buildParameterValues,parameterPlanKey,assertParameterPlanKey};
