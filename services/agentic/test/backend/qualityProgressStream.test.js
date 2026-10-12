const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const service=require('../../backend/services/qualityAgents.service');
const routes=require('../../backend/routes/qualityAgents.routes');
async function fixture(t, states) {
  const handlers=new Map(), schemas=new Map();let reads=0,authenticated=0;
  t.mock.method(service,'getRun',async()=>{const value=states[Math.min(reads++,states.length-1)];if(value instanceof Error)throw value;return value;});
  await routes({authenticate:async()=>{authenticated++;},get:(path,handler)=>handlers.set(path,handler),post:(path,options,handler)=>{if(handler)schemas.set(path,options.schema);handlers.set(path,handler||options);}});
  const raw=new EventEmitter();let stream;const reply={raw,header(){return this;},type(){return this;},send(value){stream=value;return value;}};
  await handlers.get('/agentic-quality/runs/:id/events')({params:{id:'run-0001'},user:{id:'actor'}},reply);
  return {stream,raw,schemas,reads:()=>reads,authenticated:()=>authenticated};
}
test('progress stream authenticates once, rechecks scope for every snapshot and ends on completion',async t=>{
  const f=await fixture(t,[{id:'run-0001',status:'running',stages:[]},{id:'run-0001',status:'completed',stages:[{id:'observed'}]}]);
  let events='';for await(const part of f.stream)events+=part;
  assert.equal(f.authenticated(),1);assert.equal(f.reads(),2);assert.match(events,/event: progress/);assert.match(events,/"status":"completed"/);assert.match(events,/event: complete/);assert.equal(f.raw.listenerCount('close'),0);
});
test('revoked evidence access closes the progress feed without emitting another record',async t=>{
  const f=await fixture(t,[{id:'run-0001',status:'running'},Object.assign(new Error('Revoked'),{statusCode:403})]);
  let events='';for await(const part of f.stream)events+=part;
  assert.equal((events.match(/event: progress/g)||[]).length,1);assert.match(events,/event: unavailable/);assert.ok(!events.includes('Revoked'));
});
test('launch route schema retains every browser context and explicit model field',async t=>{
  const f=await fixture(t,[{id:'run-0001',status:'completed'}]);f.stream.destroy();
  const properties=f.schemas.get('/agentic-quality/runs').body.properties;
  for(const key of ['llm_integration_id','smart_context','evidence_scope','context_scopes'])assert.ok(properties[key],key);
  assert.equal(properties.smart_context.additionalProperties,false);
  assert.deepEqual(properties.context_scopes.items.enum,['stories','test-cases','automation','runs','bugs','knowledge']);
});
