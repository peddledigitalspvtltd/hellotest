const test=require('node:test'),assert=require('node:assert/strict');
const {createExecutionDiagnosticRedactor}=require("../../backend/lib/build/automationExecutionDiagnostics");

test('frozen private declarations and alias echoes are masked in application JSON without corrupting machine receipt fields',()=>{
 const frozen={case_snapshots:[{parameter_values:{'t.account':'PRIVATE_ACCOUNT','t.pin':1234},test_data_options:{private_parameter_names:['t.account','t.pin']}}],
  test_environment:{snapshot:{variables:[{key:'custom',value:'PRIVATE_ENV',is_secret:true}]}}};
 const captures={'t.copy':'PRIVATE_ACCOUNT'};const redact=createExecutionDiagnosticRedactor(frozen,captures);
 const payload={engine_run_id:'host-id',status:'failed',case_result:{status:'failed',duration_ms:1234,logs:{stepStatuses:{one:'failed'},stepCaptures:{one:captures},stepAutomationDetails:{one:{code:'await field.fill("PRIVATE_ACCOUNT")',status:'failed'}},
  stepWebDetails:{one:{network:[{response:{body:{id:'PRIVATE_ACCOUNT',code:'PRIVATE_ENV',other:1234}}}],console:[{id:'PRIVATE_ACCOUNT',status:1234}]}}}},artifact_bundle:{trace_path:'run/trace.zip'}};
 const out=redact(payload);assert.doesNotMatch(JSON.stringify(out),/PRIVATE_ACCOUNT|PRIVATE_ENV/);
 assert.equal(out.case_result.logs.stepWebDetails.one.network[0].response.body.other,'[REDACTED]');
 assert.equal(out.case_result.logs.stepWebDetails.one.console[0].status,'[REDACTED]');
 assert.deepEqual(out.case_result.logs.stepStatuses,{one:'failed'});assert.equal(out.case_result.duration_ms,1234);
 assert.equal(out.engine_run_id,'host-id');assert.equal(out.artifact_bundle.trace_path,'run/trace.zip');
 assert.equal(captures['t.copy'],'PRIVATE_ACCOUNT');
});

test('unknown auth header and credential entry shapes are masked while inline binary evidence stays intact',()=>{
 const redact=createExecutionDiagnosticRedactor({});const data='data:image/png;base64,cG5n';
 const out=redact({network:[{headers:{authorization:'Bearer privateauth',Cookie:'privatecookie'},response:{headers:[{key:'Set-Cookie',value:'privatesetcookie'}]},url:'https://user:privateuserpass@example.test/?token=privatequery'}],evidence:{dataUrl:data}});
 assert.doesNotMatch(JSON.stringify(out),/privateauth|privatecookie|privatesetcookie|privateuserpass|privatequery/);assert.equal(out.evidence.dataUrl,data);
});

test('private application object keys are collision-safe while host step-map keys are retained',()=>{
 const redact=createExecutionDiagnosticRedactor({parameter_values:{'t.private':'FROZEN_CUSTOM_VALUE'},private_parameter_names:['t.private']});
 const out=redact({stepStatuses:{FROZEN_CUSTOM_VALUE:'passed'},response:{body:{FROZEN_CUSTOM_VALUE:'one','prefix-FROZEN_CUSTOM_VALUE':'two','[REDACTED_KEY_1]':'public'}}});
 assert.equal(out.stepStatuses.FROZEN_CUSTOM_VALUE,'passed');assert.equal(JSON.stringify(out.response).includes('FROZEN_CUSTOM_VALUE'),false);
 assert.equal(Object.keys(out.response.body).length,3);assert.deepEqual(Object.values(out.response.body).sort(),['one','public','two']);
});

test('public privacy metadata never contaminates unrelated boolean diagnostics', () => {
 const redact = createExecutionDiagnosticRedactor({variables:[{key:'r.api_base_url',value:'http://api:3000',is_secret:false}]});
 const input = {request:{follow_redirects:false},response:{json:{success:false,retryable:false},body_truncated:false},variables:[{key:'r.api_base_url',is_secret:false}]};
 assert.deepEqual(redact(input),input);
});

test('private boolean entries and captures remain private without masking unrelated false values', () => {
 const redact = createExecutionDiagnosticRedactor({variables:[{key:'r.custom',value:false,is_secret:true}],private_parameter_names:['t.choice']});
 const out = redact({variables:[{key:'r.custom',value:false,is_secret:true}],captures:{'t.choice':false},response:{json:{success:false,retryable:false}}});
 assert.equal(out.variables[0].value,'[REDACTED]');
 assert.equal(out.variables[0].is_secret,true);
 assert.equal(out.captures['t.choice'],'[REDACTED]');
 assert.deepEqual(out.response.json,{success:false,retryable:false});
});
