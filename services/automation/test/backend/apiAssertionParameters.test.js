const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { validateGeneratedApiRequest } = require('../../../platform/backend/src/utils/testStepAutomation');
const { executeApiRequestStep } = require('../../backend/services/apiRequestExecution.service');
const { validateJsonSchema } = require('../../backend/lib/automationApiAssertions');
const { createPortableAutomationArtifact } = require('../../backend/lib/automationPortableArtifact');

const validations = () => [{kind:'status',expected:'@t.expected_status'},{kind:'response_time',expected:'@s.[Maximum response ms]'},{kind:'json_schema',expected:'@r.response_schema'}];
const values = () => ({'t.expected_status':'200','s.maximum response ms':'5000','r.response_schema':'{"type":"object","required":["count"],"properties":{"count":{"type":"integer"}}}'});

test('draft API contracts retain exact scoped assertion references and reject invalid concrete formats', () => {
  const input = {method:'GET',url:'https://fixture.test/data',validations:validations()};
  assert.deepEqual(validateGeneratedApiRequest(input,{expectedResult:'The configured response contract matches'}).validations.map(row=>row.expected),validations().map(row=>row.expected));
  for (const expected of ['OK','20[0-9]','2e2','200.0','@t.expected_status extra','@status']) {
    assert.throws(()=>validateGeneratedApiRequest({...input,validations:[{kind:'status',expected}]}),/HTTP status/);
  }
  for (const expected of ['0','-1','Infinity','not-a-number']) assert.throws(()=>validateGeneratedApiRequest({...input,validations:[{kind:'response_time',expected}]}),/positive response duration/);
  assert.throws(()=>validateGeneratedApiRequest({...input,validations:[{kind:'json_schema',expected:'{}'}]}),/nonempty JSON Schema/);
});

test('backend API assertions honor edited scoped values and fail closed for missing or invalid resolved expectations', async t => {
  const server=http.createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end('{"count":3}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const request={method:'GET',url:`http://127.0.0.1:${server.address().port}/data`,validations:validations()};
  assert.equal((await executeApiRequestStep({api_request:request,parameter_values:values()})).status,'passed');
  assert.equal((await executeApiRequestStep({api_request:request,parameter_values:{...values(),'t.expected_status':'201'}})).status,'failed');
  for (const bad of ['', 'bad','200.0','600']) {
    const result=await executeApiRequestStep({api_request:request,parameter_values:{...values(),'t.expected_status':bad}});
    assert.equal(result.status,'failed');assert.match(result.note,/expected HTTP status is missing or invalid/);
  }
  const missing=values();delete missing['t.expected_status'];
  assert.equal((await executeApiRequestStep({api_request:request,parameter_values:missing})).status,'failed');
  for (const bad of ['', '0','Infinity']) {
    const result=await executeApiRequestStep({api_request:request,parameter_values:{...values(),'s.maximum response ms':bad}});
    assert.equal(result.status,'failed');assert.match(result.note,/expected response duration is missing or invalid/);
  }
  assert.equal((await executeApiRequestStep({api_request:request,parameter_values:{...values(),'r.response_schema':'{}'}})).status,'failed');
  assert.deepEqual(request.validations,validations(),'Runtime data changes never rewrite saved assertion references.');
});

test('generated assertion source reads live params instead of compiling status and duration defaults', async () => {
  const {buildApiValidationAssertionCode}=await import('../../shared/apiValidation.mjs');
  const code=validations().map(row=>buildApiValidationAssertionCode(row,'response')).join('\n');
  const expect=value=>({toBe:expected=>assert.equal(value,expected),toBeLessThanOrEqual:expected=>assert.ok(value<=expected),toEqual:expected=>assert.deepEqual(value,expected)});
  const run=new Function('params','response','expect','validateJsonSchema',code);
  const validate=(body,schema)=>({valid:validateJsonSchema(body,JSON.stringify(schema)).passed});
  run(values(),{status:200,durationMs:15,body:{count:3}},expect,validate);
  assert.throws(()=>run({...values(),'t.expected_status':'201'},{status:200,durationMs:15,body:{count:3}},expect,validate));
  assert.throws(()=>run({...values(),'t.expected_status':'200.0'},{status:200,durationMs:15,body:{count:3}},expect,validate));
  assert.throws(()=>run({...values(),'s.maximum response ms':''},{status:200,durationMs:0,body:{count:3}},expect,validate));
  assert.match(code,/Number\(params\["t.expected_status"\]\)/);
  assert.match(code,/JSON\.parse\(params\["r.response_schema"\]\)/);
});

test('portable Playwright source preserves assertion bindings and parses parameterized JSON-path values', async () => {
  const api_request={method:'GET',url:'https://fixture.test/data',validations:[...validations(),{kind:'json_path',target:'$.count',expected:'@t.expected_count'}]};
  const source=await createPortableAutomationArtifact({testCase:{id:'case',title:'Parameterized API contract'},updates:[{step:{id:'step',step_order:1,step_type:'api',action:'Read data'},step_type:'api',api_request}],values:{...values(),'t.expected_count':'3'}});
  assert.match(source,/expect\(response.status\).toBe\(Number\(params\["t.expected_status"\]\)\)/);
  assert.match(source,/JSON\.parse\(params\["r.response_schema"\]\)/);
  assert.match(source,/parseApiExpected\(params\["t.expected_count"\]\)/);
  assert.doesNotMatch(source,/durationMs\)\.toBeLessThanOrEqual\(2000\)/);
});
