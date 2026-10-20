import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionOutputRedactor } from '../dist/lib/executionOutputRedaction.js';
import { buildInitialContext } from '../dist/lib/runtimeContext.js';

const envelope = () => ({steps:[],case_parameters:{'t.custom':'CUSTOM_PRIVATE_VALUE','t.pin':1234},
 data_policy:{version:2,case:{private_parameter_names:['t.custom','t.pin']}},
 environment:{variables:[{key:'custom_env',value:'ENV_PRIVATE_VALUE',is_secret:true}]},manual_spec:{test_data:{}}});

test('public diagnostic aliases, application identity fields and numeric values are masked without changing host receipt identity',()=>{
 const redact=createExecutionOutputRedactor(envelope());
 const input={engine_run_id:'host-run',status:'failed',case_result:{status:'failed',duration_ms:1234,logs:{stepStatuses:{one:'failed'},stepNotes:{one:'CUSTOM_PRIVATE_VALUE'},
  stepCaptures:{one:{copy:'CUSTOM_PRIVATE_VALUE',pin:1234}},stepWebDetails:{one:{console:[{id:'CUSTOM_PRIVATE_VALUE',code:'ENV_PRIVATE_VALUE',status:1234}],network:[{response:{body:{id:'CUSTOM_PRIVATE_VALUE',code:1234}}}]}}}},
  artifact_bundle:{trace_path:'host/trace.zip',artifact_refs:[{attachment_id:'retained',kind:'trace'}]}};
 const out=redact(input);
 assert.doesNotMatch(JSON.stringify(out),/CUSTOM_PRIVATE_VALUE|ENV_PRIVATE_VALUE/);
 assert.equal(out.case_result.logs.stepWebDetails.one.network[0].response.body.code,'[REDACTED]');
 assert.equal(out.case_result.logs.stepCaptures.one.pin,'[REDACTED]');
 assert.equal(out.case_result.duration_ms,1234);assert.equal(out.engine_run_id,'host-run');assert.equal(out.status,'failed');
 assert.deepEqual(out.case_result.logs.stepStatuses,{one:'failed'});assert.deepEqual(out.artifact_bundle,input.artifact_bundle);
 assert.equal(input.case_result.logs.stepCaptures.one.copy,'CUSTOM_PRIVATE_VALUE');
});

test('unknown credentials in headers, entry arrays, userinfo and query strings are masked',()=>{
 const redact=createExecutionOutputRedactor({steps:[]});
 const out=redact({web_detail:{network:[{request:{headers:{Authorization:'Bearer unknown_auth',Cookie:'session=unknown_cookie'},url:'https://name:unknown_password@example.test/?token=unknown_token'},response:{headers:[{name:'Set-Cookie',value:'unknown_set_cookie'}]}}]}});
 assert.doesNotMatch(JSON.stringify(out),/unknown_auth|unknown_cookie|unknown_password|unknown_token|unknown_set_cookie/);
});

test('private values remain known after a captured token changes and no generated input is rematerialized',()=>{
 const context={values:{'t.token':'FIRST_CAPTURED_PRIVATE'}};
 const redact=createExecutionOutputRedactor({steps:[]},()=>[context]);
 assert.equal(redact({note:'FIRST_CAPTURED_PRIVATE'}).note,'[REDACTED]');
 context.values['t.token']='SECOND_CAPTURED_PRIVATE';
 assert.equal(redact({note:'FIRST_CAPTURED_PRIVATE SECOND_CAPTURED_PRIVATE'}).note,'[REDACTED] [REDACTED]');
 assert.equal(context.values['t.token'],'SECOND_CAPTURED_PRIVATE');
});

test('inventory saturation fails closed for diagnostic data while retaining host statuses and artifact references',()=>{
 const context={values:{}};const redact=createExecutionOutputRedactor({steps:[]},()=>[context]);
 for(let i=0;i<1026;i++){context.values['t.token']='capture-'+i;redact({note:'seen'});}
 const out=redact({status:'failed',note:'capture-0',case_result:{logs:{stepStatuses:{one:'failed'}}},artifact_bundle:{trace_path:'run/trace.zip'}});
 assert.equal(out.note,'[DIAGNOSTIC_REDACTED_LIMIT]');assert.equal(out.status,'failed');
 assert.equal(out.artifact_bundle.trace_path,'run/trace.zip');assert.deepEqual(out.case_result.logs.stepStatuses,{one:'failed'});
});

test('binary evidence remains unchanged and raw errors are copied as sanitized bounded diagnostic fields',()=>{
 const redact=createExecutionOutputRedactor(envelope());const data='data:image/png;base64,ZmFrZQ==';
 const out=redact({evidence:{dataUrl:data},error:new Error('CUSTOM_PRIVATE_VALUE')});
 assert.equal(out.evidence.dataUrl,data);assert.doesNotMatch(JSON.stringify(out.error),/CUSTOM_PRIVATE_VALUE/);assert.equal(out.error.name,'Error');
});

test('bare source-case parameter keys use the same test namespace as the canonical runtime resolver',()=>{
 const step={source_case_parameters:{custom:'SOURCE_CASE_PRIVATE'}};
 const frozen={steps:[step],parameters_frozen:true,case_parameters:{plain:'CASE_PRIVATE'},manual_spec:{test_data:{manual:'MANUAL_PRIVATE'}},
  data_policy:{version:2,case:{private_parameter_names:['t.custom','r.plain','r.manual']}}};
 const actual=buildInitialContext(frozen,{},step);
 assert.equal(actual.values['t.custom'],'SOURCE_CASE_PRIVATE');
 assert.equal(actual.values['r.plain'],'CASE_PRIVATE');assert.equal(actual.values['r.manual'],'MANUAL_PRIVATE');
 const out=createExecutionOutputRedactor(frozen)({note:'SOURCE_CASE_PRIVATE CASE_PRIVATE MANUAL_PRIVATE'});
 assert.equal(out.note,'[REDACTED] [REDACTED] [REDACTED]');
});

test('private application object keys are masked without collisions or changing typed host step identities',()=>{
 const redact=createExecutionOutputRedactor(envelope());
 const input={case_result:{logs:{stepStatuses:{'CUSTOM_PRIVATE_VALUE':'passed'}}},response:{body:{'CUSTOM_PRIVATE_VALUE':'one','prefix-CUSTOM_PRIVATE_VALUE':'two','[REDACTED_KEY_1]':'public'}}};
 const out=redact(input);
 assert.equal(out.case_result.logs.stepStatuses.CUSTOM_PRIVATE_VALUE,'passed');
 assert.equal(JSON.stringify(out.response).includes('CUSTOM_PRIVATE_VALUE'),false);
 assert.equal(Object.keys(out.response.body).length,3);
 assert.deepEqual(Object.values(out.response.body).sort(),['one','public','two']);
 assert.equal(out.response.body['[REDACTED_KEY_1]'],'public');
});
