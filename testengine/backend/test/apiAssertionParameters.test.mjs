import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const runtime=process.env.HELLOTEST_RUNTIME_TEST_BUILD?pathToFileURL(path.join(process.env.HELLOTEST_RUNTIME_TEST_BUILD,'lib/apiEngine.js')):new URL('../dist/lib/apiEngine.js',import.meta.url);
const {executeApiStepInEngine}=await import(runtime.href);

test('Test Engine honors parameterized API status, duration and schema expectations without defaulting invalid values',async t=>{
  const server=http.createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end('{"count":3}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const step={id:'read',order:1,step_type:'api',api_request:{method:'GET',url:`http://127.0.0.1:${server.address().port}/data`,validations:[{kind:'status',expected:'@t.expected_status'},{kind:'response_time',expected:'@s.[Maximum response ms]'},{kind:'json_schema',expected:'@r.response_schema'}]}};
  const base={case_parameters:{'t.expected_status':'200'},suite_parameters:{'maximum response ms':'5000'},run_parameters:{response_schema:'{"type":"object","required":["count"],"properties":{"count":{"type":"integer"}}}'}};
  assert.equal((await executeApiStepInEngine(base,step)).status,'passed');
  assert.equal((await executeApiStepInEngine({...base,case_parameters:{'t.expected_status':'201'}},step)).status,'failed');
  for(const expected_status of ['', 'invalid','200.0','600']){
    const result=await executeApiStepInEngine({...base,case_parameters:{'t.expected_status':expected_status}},step);
    assert.equal(result.status,'failed');assert.match(result.note,/expected HTTP status is missing or invalid/);
  }
  assert.equal((await executeApiStepInEngine({...base,case_parameters:{}},step)).status,'failed');
  for(const duration of ['', '0','Infinity']){
    const result=await executeApiStepInEngine({...base,suite_parameters:{'maximum response ms':duration}},step);
    assert.equal(result.status,'failed');assert.match(result.note,/expected response duration is missing or invalid/);
  }
  assert.equal((await executeApiStepInEngine({...base,run_parameters:{response_schema:'{}'}},step)).status,'failed');
});
