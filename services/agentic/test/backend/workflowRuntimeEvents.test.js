const test = require('node:test');
const assert = require('node:assert/strict');
const { failureInfo, retryable, canRetry, withNode, withArtifact } = require('../../backend/workflows/runtimeEvents');
const { createLlmProviderError } = require('@hellotest/platform/backend/src/utils/upstreamLlmError');

test('native completion failures retain actionable bounded diagnostics without provider payloads or secrets', () => {
  const failure = {
    code: 'AUTOMATION_BUILD_INCOMPLETE', statusCode: 422, completed_sections: 0, total_sections: 2,
    publicMessage: 'Automation generation is incomplete. Review the validated API fields before retrying.',
    validation_feedback: Array.from({length: 9}, () => ({step_id: 'draft-step-1', code: 'API_REQUEST_INVALID',
      message: 'Omit auth.location for auth.type=none. password=fixture-private-password', provider_response: 'private-provider-body'})),
    response_payload: 'raw response must never reach the workflow UI',
  };
  const projected = failureInfo(failure);
  assert.equal(projected.code, 'AUTOMATION_BUILD_INCOMPLETE');
  assert.equal(projected.status_code, 422); assert.equal(projected.completed_sections, 0); assert.equal(projected.total_sections, 2);
  assert.match(projected.message, /Review the validated API fields/); assert.equal(projected.retryable, false);
  assert.equal(projected.validation_feedback.length, 5);
  assert.match(projected.validation_feedback[0].message, /Omit auth.location/);
  assert.doesNotMatch(JSON.stringify(projected), /fixture-private-password|private-provider-body|raw response/);
  assert.equal(projected.validation_feedback[0].step_id, 'draft-step-1');
});

test('model JSON mode failures keep actionable safe protocol diagnostics and never retry unchanged invalid requests', () => {
  const failure=createLlmProviderError({status:400,headers:new Headers({'x-request-id':'req-workflow-fixture'}),detail:JSON.stringify({error:{code:null,type:'invalid_request_error',param:'messages',message:"'messages' must contain the word 'json' in some form, to use 'response_format' of type 'json_object'. password=private-fixture-password",prompt:'PRIVATE_PROMPT'}})});
  const view=failureInfo(failure);
  assert.equal(view.code,'LLM_JSON_INSTRUCTION_REQUIRED');assert.equal(view.category,'provider_request');
  assert.equal(view.status_code,400);assert.equal(view.upstream_status_code,400);assert.equal(view.retryable,false);
  assert.deepEqual(view.provider_error,{code:null,type:'invalid_request_error',param:'messages',request_id:'req-workflow-fixture'});
  assert.match(view.message,/messages did not include a JSON instruction/);
  assert.doesNotMatch(JSON.stringify(view),/private-fixture-password|PRIVATE_PROMPT|response_format.*json_object/);
});

test('model authentication, quota, timeout and actual cancellation remain distinct', () => {
  const auth=failureInfo(createLlmProviderError({status:401,detail:'Bearer private-token'}));
  assert.equal(auth.code,'LLM_AUTHENTICATION_FAILED');assert.equal(auth.category,'authorization');assert.equal(auth.status_code,502);assert.equal(auth.upstream_status_code,401);assert.equal(auth.retryable,false);
  assert.equal(failureInfo(createLlmProviderError({status:429,detail:'insufficient_quota'})).code,'LLM_QUOTA_EXCEEDED');
  assert.equal(failureInfo({name:'AbortError',statusCode:499}).category,'cancelled');
  assert.equal(failureInfo({code:'NODE_TIMEOUT',statusCode:504}).category,'timeout');
  assert.equal(failureInfo({code:'DEADLINE_EXCEEDED',statusCode:504}).code,'WORKFLOW_DEADLINE');
  assert.equal(failureInfo({code:'WORKFLOW_DATA_INVALID',statusCode:422}).code,'WORKFLOW_DATA_INVALID');
});

test('retry decisions respect completed generation, explicit prohibition, and unknown side effects', () => {
  for(const marker of [{nonRetryable:true},{retryable:false},{outcome_unknown:true},{generation_received:true}])assert.equal(retryable({statusCode:503,...marker}),false);
  assert.equal(retryable({statusCode:429}),true);assert.equal(retryable({statusCode:400}),false);
  assert.equal(canRetry('apiTool',{apiMethod:' get '}),true);assert.equal(canRetry('apiTool',{apiMethod:'post'}),false);
  const unknown=failureInfo({statusCode:502,code:'AGENT_HTTP_OUTCOME_UNKNOWN',outcome_unknown:true,operation_id:'http-owned-operation'});
  assert.equal(unknown.category,'outcome_unknown');assert.equal(unknown.reconciliation_required,true);assert.equal(unknown.retryable,false);
});

test('error projection omits private candidates, payloads, causes and unrecognized provider fields', () => {
  const projected=failureInfo({code:'AI_NATIVE_CONTRACT_INVALID',statusCode:422,message:'PRIVATE_ERROR_MESSAGE',model_candidate:'PRIVATE_CANDIDATE',response_payload:'PRIVATE_BODY',cause:new Error('PRIVATE_CAUSE'),
    provider_error:{code:'invalid_value',type:'invalid_request_error',param:'messages[0].content',message:'PRIVATE_PROVIDER_MESSAGE',authorization:'Bearer PRIVATE_KEY'},
    validation_errors:[{path:'cases[0].title',issue:'required',value:'PRIVATE_VALUE'}]});
  assert.equal(projected.code,'AI_NATIVE_CONTRACT_INVALID');assert.equal(projected.provider_error.param,'messages[0].content');
  assert.deepEqual(projected.validation_errors,[{path:'cases[0].title',issue:'required'}]);assert.doesNotMatch(JSON.stringify(projected),/PRIVATE/);
  assert.equal(failureInfo(null).code,'NODE_EXECUTION_FAILED');
});

test('node attribution preserves private correction candidates on the original error without exposing them', () => {
  const failure=Object.assign(new Error('Private provider response'),{code:'AI_NATIVE_CONTRACT_INVALID',statusCode:422});
  Object.defineProperty(failure,'model_candidate',{value:'PRIVATE_REPAIR_CANDIDATE',enumerable:false});
  const same=withNode(failure,{loop_owner:'stories',iteration_index:2,iteration_path:['stories',2]},{id:'generate',data:{label:'Generate Test Cases'}});
  assert.equal(same,failure);assert.equal(same.model_candidate,'PRIVATE_REPAIR_CANDIDATE');assert.equal(Object.getOwnPropertyDescriptor(same,'model_candidate').enumerable,false);
  assert.deepEqual(failureInfo(same).origin,{node_id:'generate',node_name:'Generate Test Cases',loop_node_id:'stories',batch_index:2,iteration_path:['stories',2]});
  assert.doesNotMatch(JSON.stringify(failureInfo(same)),/PRIVATE|Private provider/);
});

test('terminal generated-output failures are validation issues rather than transient execution failures',()=>{
 for(const code of ['AI_OUTPUT_SCHEMA_VIOLATION','AI_OUTPUT_SCHEMA_INVALID','AI_MANAGED_SCHEMA_INVALID','AI_NATIVE_CONTRACT_INVALID',
   'AI_INVALID_JSON','AI_INVALID_TOOL_ARGUMENTS','AI_ASSURANCE_REVIEW_INVALID','AI_REVIEW_INVALID','AI_OUTPUT_TRUNCATED']){
  const info=failureInfo({code,statusCode:502,validation_errors:[{path:'automation_readiness.status',message:'must equal a supported status',candidate:'PRIVATE_PROVIDER_BODY'}]});
  assert.equal(info.category,'validation',code);assert.equal(info.retryable,false,code);
  assert.deepEqual(info.validation_errors,[{path:'automation_readiness.status',message:'must equal a supported status'}]);
  assert.doesNotMatch(JSON.stringify(info),/PRIVATE_PROVIDER_BODY/);
 }
 for(const code of ['AI_BUDGET_EXCEEDED','AGENT_BUDGET_EXCEEDED','AGENT_DEADLINE','DEADLINE_EXCEEDED','WORKFLOW_DEADLINE'])assert.equal(retryable({code,statusCode:504}),false,code);
 assert.equal(failureInfo({code:'AI_PROVIDER_REFUSAL',statusCode:502}).category,'provider_request');
 assert.equal(retryable({code:'AI_PROVIDER_REFUSAL',statusCode:502}),false);
 for(const statusCode of [408,429,500,502,503,504])assert.equal(retryable({code:'LLM_PROVIDER_UNAVAILABLE',statusCode}),true);
});

test('case attribution composes with loop origin while omitting untrusted fields and private identifiers',()=>{
 const error=Object.assign(new Error('PRIVATE_REVIEW_BODY'),{code:'AI_OUTPUT_SCHEMA_VIOLATION',statusCode:502});
 Object.defineProperty(error,'model_candidate',{value:'PRIVATE_CANDIDATE',enumerable:false});
 assert.equal(withArtifact(error,{artifact_task:'test-case-assurance',story_id:'story-1',case_index:1,case_client_id:'draft-2',title:'PRIVATE_TITLE'}),error);
 const projected=failureInfo(withNode(error,{loop_owner:'each-story',iteration_index:0,iteration_path:['each-story',0]},{id:'test-case-assurance',data:{label:'AI Test Case Quality Assurance'}}));
 assert.deepEqual(projected.artifact,{artifact_task:'test-case-assurance',story_id:'story-1',case_index:1,case_client_id:'draft-2'});
 assert.equal(projected.origin.batch_index,0);assert.equal(projected.retryable,false);
 assert.equal(error.model_candidate,'PRIVATE_CANDIDATE');assert.equal(Object.getOwnPropertyDescriptor(error,'workflow_artifact').enumerable,false);
 assert.doesNotMatch(JSON.stringify(projected),/PRIVATE/);
 assert.deepEqual(failureInfo(withArtifact({code:'AI_REVIEW_INVALID',statusCode:502},{artifact_task:'test-case-assurance',story_id:'story-1',case_index:1000,case_client_id:'password=PRIVATE'})).artifact,
  {artifact_task:'test-case-assurance',story_id:'story-1'});
 assert.equal(failureInfo(withArtifact({},{artifact_task:'unknown',story_id:'story-1'})).artifact,undefined);
});

test('schema diagnostics preserve bounded keyword and required field names without candidate or enum data',()=>{
 const result=failureInfo({code:'AI_OUTPUT_SCHEMA_VIOLATION',statusCode:502,validation_errors:[
  {path:'automation_readiness',keyword:'required',required_property:'status',candidate:'PRIVATE_CANDIDATE',allowed_values:['PRIVATE_ENUM']},
  {path:'dimensions[0].evidence_refs',keyword:'minItems',required_property:'x'.repeat(101)},
  {keyword:'password=PRIVATE_PASSWORD',required_property:'token=PRIVATE_TOKEN'}]});
 assert.deepEqual(result.validation_errors,[{path:'automation_readiness',keyword:'required',required_property:'status'},
  {path:'dimensions[0].evidence_refs',keyword:'minItems'}]);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});

test('terminal model-call diagnostics retain only bounded native execution counters',()=>{
 const model_execution={model_calls:2,max_model_calls:2,deadline_ms:120000,format_repair_attempted:true,prompt:'PRIVATE_PROMPT',candidate:'PRIVATE_BODY'};
 assert.deepEqual(failureInfo({model_execution}).model_execution,{model_calls:2,max_model_calls:2,deadline_ms:120000,format_repair_attempted:true});
 for(const value of [{model_calls:9,max_model_calls:0,deadline_ms:Infinity,format_repair_attempted:'true'},[],null])assert.equal(failureInfo({model_execution:value}).model_execution,undefined);
 assert.equal(failureInfo({model_execution:{model_calls:0,format_repair_attempted:false}}).model_execution.format_repair_attempted,false);
 assert.doesNotMatch(JSON.stringify(failureInfo({model_execution})),/PRIVATE/);
});
