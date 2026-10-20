const test=require('node:test'),assert=require('node:assert/strict');
const {verifyRecordedAutomation}=require('../../backend/lib/automationVerificationClient');
const integration={base_url:'https://worker.test/',config:{shared_secret:'fixture-shared-secret'}};

test('worker HTTP authorization survives an HTML response and dispatch is never retried',async t=>{
 const previous=global.fetch;t.after(()=>{global.fetch=previous;});
 for(const status of [401,403,429]){
  let calls=0;global.fetch=async()=>{calls++;return new Response('<html>PRIVATE_GATEWAY_DIAGNOSTIC</html>',{status});};
  await assert.rejects(()=>verifyRecordedAutomation({integration,request:{}}),error=>error.statusCode===status&&error.code==='AUTOMATION_VERIFICATION_UNAVAILABLE'&&!error.message.includes('PRIVATE_GATEWAY_DIAGNOSTIC'));
  assert.equal(calls,1);
 }
});

test('malformed or oversized worker JSON has a safe typed receipt error without retry',async t=>{
 const previous=global.fetch;t.after(()=>{global.fetch=previous;});
 for(const body of ['PRIVATE_INVALID_JSON','"'+'x'.repeat(512*1024)+'"']){
  let calls=0;global.fetch=async()=>{calls++;return new Response(body,{status:200});};
  await assert.rejects(()=>verifyRecordedAutomation({integration,request:{}}),error=>error.code==='AUTOMATION_VERIFICATION_INVALID_RECEIPT'&&error.statusCode===502&&!error.message.includes('PRIVATE_INVALID_JSON'));
  assert.equal(calls,1);
 }
});

test('one authenticated dispatch preserves a bounded receipt and the caller cancellation signal',async t=>{
 const previous=global.fetch;t.after(()=>{global.fetch=previous;});
 const request={schema_version:1,verification_id:'fixture-attempt'},result={schema_version:1,status:'passed'},controller=new AbortController();let calls=0;
 global.fetch=async(url,options)=>{calls++;assert.equal(url,'https://worker.test/api/v1/automation/verify');assert.equal(options.redirect,'error');assert.equal(options.headers['x-hellotest-testengine-secret'],'fixture-shared-secret');assert.deepEqual(JSON.parse(options.body),request);assert.equal(options.signal.aborted,false);controller.abort();assert.equal(options.signal.aborted,true);return new Response(JSON.stringify(result));};
 assert.deepEqual(await verifyRecordedAutomation({integration,request,signal:controller.signal}),result);assert.equal(calls,1);
});
