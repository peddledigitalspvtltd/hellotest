import test from 'node:test';
import assert from 'node:assert/strict';
import { getAutomationRuntimeTypes, getDefaultAutomationStepType, getRecorderPlatform } from '../../frontend/lib/automationRuntime.ts';
test('runtime identity and targeted recording preserve mixed plans and native platforms', () => {
  const steps = [{ id: 'api', step_type: 'api' }, { id: 'native', step_type: 'ios' }];
  assert.deepEqual(getAutomationRuntimeTypes(steps), ['api', 'ios']);
  assert.equal(getRecorderPlatform(steps, 'native'), 'ios');
  assert.equal(getRecorderPlatform(steps, 'api'), 'api');
  assert.equal(getRecorderPlatform(steps, ''), 'ios');
  assert.equal(getRecorderPlatform([{id:'api',step_type:'api'},{id:'web',step_type:'web'}], ''), 'web');
  assert.equal(getRecorderPlatform([{id:'native',step_type:'android'},{id:'web',step_type:'web'}], ''), 'unified');
  assert.deepEqual(getAutomationRuntimeTypes([], 'android'), ['android']);
  assert.deepEqual(getAutomationRuntimeTypes([], 'unified'), ['web']);
});
const { parseApiRequestSource } = await import('../../frontend/lib/apiRequestSource.ts');
test('API source edits produce executable requests and reject browser/code fragments',()=>{
 const request=parseApiRequestSource('{"method":"POST","url":"@r.base/orders","validations":[{"kind":"status","expected":"201"}]}');
 assert.equal(request.method,'POST');assert.equal(request.validations[0].expected,'201');
 assert.throws(()=>parseApiRequestSource('await api.request("GET /orders");'),/JSON request/);
 assert.throws(()=>parseApiRequestSource('{}'),/URL/);
 assert.throws(()=>parseApiRequestSource('{"url":{"path":"/orders"}}'),/URL/);
 assert.throws(()=>parseApiRequestSource('{"url":"/orders","headers":{"Authorization":"abc"}}'),/key\/value/);
 assert.throws(()=>parseApiRequestSource('{"url":"/orders","validations":[{"kind":"unknown"}]}'),/validation kind/);
});

test('new steps keep application runtime and ignore API setup in a unified native plan', () => {
  assert.equal(getDefaultAutomationStepType([], 'ios'), 'ios');
  assert.equal(getDefaultAutomationStepType([], 'api'), 'api');
  assert.equal(getDefaultAutomationStepType([{ step_type: 'api' }, { step_type: 'android' }], 'unified'), 'android');
  assert.equal(getDefaultAutomationStepType([{ step_type: 'api' }], 'unified'), 'api');
});
