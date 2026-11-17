const test = require('node:test');
const assert = require('node:assert/strict');
const { executeApiRequestStep } = require('../../backend/services/apiRequestExecution.service');

test('a clipped manual API response retains HTTP diagnostics but cannot pass prefix assertions or produce captures', async t => {
  let requests=0,cancelled=0;
  t.mock.method(globalThis,'fetch',async()=>{
    requests++;
    return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"result":"visible-prefix"}'+ ' '.repeat(2*1024*1024)));},cancel(){cancelled++;}}),{status:201,headers:{'content-type':'application/json'}});
  });
  const result=await executeApiRequestStep({api_request:{method:'POST',url:'https://api.fixture/items',validations:[{kind:'status',expected:'201'},{kind:'body_contains',expected:'visible-prefix'}],captures:[{path:'$.result',parameter:'result'}]}});
  assert.equal(requests,1,'An executed mutation is not retried because response diagnostics are too large.');
  assert.equal(cancelled,1);
  assert.equal(result.status,'failed');
  assert.deepEqual(result.captures,{});
  assert.equal(result.detail.response.status,201);
  assert.equal(result.detail.response.body_truncated,true);
  assert.equal(result.detail.response.json,null,'A valid JSON prefix is not the complete response.');
  assert.match(result.note,/No assertions or captures/);
  assert.deepEqual(result.detail.assertions.map(row=>row.kind),['response_body']);
});

test('manual header comparisons require the header and preserve empty-but-present values', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { headers: { 'x-empty': '' } }));
  for (const validation of [{kind:'header',target:'x-missing',operator:'exists'}, {kind:'header',target:'x-missing',operator:'eq',expected:''}]) {
    const result = await executeApiRequestStep({ api_request: { url:'http://fixture.test/data', validations:[validation] } });
    assert.equal(result.status, 'failed');
    assert.equal(result.detail.assertions[0].actual, null);
    assert.match(result.note, /missing header/);
  }
  const empty = await executeApiRequestStep({ api_request: { url:'http://fixture.test/data', validations:[{kind:'header',target:'x-empty',operator:'exists'}] } });
  assert.equal(empty.status, 'passed');
});

test('manual API diagnostic SVG redacts private inputs and captures before encoding',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({token:'CAPTURED_PRIVATE_TOKEN'}));
  const result=await executeApiRequestStep({parameter_values:{'r.password':'PRIVATE_PASSWORD'},api_request:{method:'GET',url:'https://api.fixture/login?password=@r.password',captures:[{path:'$.token',parameter:'token'}]}});
  assert.equal(result.status,'passed');assert.equal(result.captures.token,'CAPTURED_PRIVATE_TOKEN');
  const svg=Buffer.from(result.evidence.dataUrl.split(',')[1],'base64').toString('utf8');
  assert.doesNotMatch(svg,/PRIVATE_PASSWORD|CAPTURED_PRIVATE_TOKEN/);assert.match(svg,/REDACTED/);
});
