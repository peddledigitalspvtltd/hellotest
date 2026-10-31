const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const service=require('../../backend/services/qualityAgents.service');
const routes=require('../../backend/routes/qualityAgents.routes');
async function fixture(t, states, options={}) {
  const handlers=new Map(), schemas=new Map();let reads=0,authenticated=0;
  t.mock.method(service,'getRun',async()=>{const value=states[Math.min(reads++,states.length-1)];if(value instanceof Error)throw value;return value;});
  t.mock.method(service,'listStreamEvents',options.listEvents||(async()=>({items:[],next_cursor:0,last_sequence:0,has_more:false})));
  await routes({authenticate:async()=>{authenticated++;},get:(path,handler)=>handlers.set(path,handler),post:(path,options,handler)=>{if(handler)schemas.set(path,options.schema);handlers.set(path,handler||options);}});
  const raw=new EventEmitter();let stream;const reply={raw,header(){return this;},type(){return this;},send(value){stream=value;return value;}};
  await handlers.get('/agentic-quality/runs/:id/events')({params:{id:'run-0001'},user:{id:'actor'},headers:options.headers||{},query:options.query||{}},reply);
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
  for(const key of ['llm_integration_id','smart_context','evidence_scope','context_scopes','execution_mode','ai_configuration','instructions','guardrails','review_criteria'])assert.ok(properties[key],key);
  assert.equal(properties.smart_context.additionalProperties,false);
  assert.deepEqual(properties.context_scopes.items.enum,['stories','test-cases','automation','runs','bugs','knowledge']);
});

test('the real HTTP launch validator preserves saved model settings and instructions for every Quality Agent',async t=>{
  const app=require('fastify')({logger:false});
  app.decorate('authenticate',async req=>{req.user={id:'actor'};});
  let captured;
  t.mock.method(service,'createRun',async input=>{captured=input;return {id:'run-config-fixture',status:'queued'};});
  try {
    await app.register(routes);
    for(const kind of ['web','security','performance','accessibility','visual']) {
      const payload={project_id:'project',kind,target_url:'https://example.test',execution_mode:'agent',
        ai_configuration:{temperature:0.2,max_output_tokens:2048,context:{mode:'none',token_budget:2000,max_items:8,required:false,focus:''}},
        instructions:'Review the selected surface.',guardrails:'Stay on the approved origin.',review_criteria:'Explain observed evidence.'};
      const response=await app.inject({method:'POST',url:'/agentic-quality/runs',payload});
      assert.equal(response.statusCode,202,response.body);
      for(const key of ['ai_configuration','instructions','guardrails','review_criteria','execution_mode'])assert.deepEqual(captured[key],payload[key],`${kind}: ${key} must survive HTTP schema validation`);
    }
  }finally{await app.close();}
});

test('completed runs replay durable events after a cursor, drain every page and then publish the authoritative result',async t=>{
  const entries=Array.from({length:5},(_,index)=>({id:String(index+1),seq:index+1,run_id:'run-0001',project_id:'project-a',app_type_id:null,type:index===4?'done':'text',data:{text:`chunk${index}`}}));
  const cursors=[];
  const f=await fixture(t,[{id:'run-0001',project_id:'project-a',status:'completed'}],{query:{after:'2'},headers:{'last-event-id':'2'},listEvents:async(id,user,{after})=>{
    assert.equal(id,'run-0001');assert.equal(user.id,'actor');cursors.push(after);
    const items=entries.filter(item=>item.seq>after).slice(0,2);
    return {items,has_more:items.at(-1)?.seq<5,last_sequence:5,next_cursor:items.at(-1)?.seq??after};
  }});
  let output='';for await(const part of f.stream)output+=part;
  assert.deepEqual(cursors,[2,4]);assert.deepEqual([...output.matchAll(/^id: (\d+)/gm)].map(item=>Number(item[1])),[3,4,5]);
  assert.ok(output.indexOf('event: agent')<output.indexOf('event: progress'));
  assert.ok(output.indexOf('"type":"done"')<output.indexOf('event: complete'));
});

test('revocation during event pagination stops replay and never exposes another project envelope',async t=>{
  let calls=0;
  const f=await fixture(t,[{id:'run-0001',project_id:'project-a',status:'running'}],{listEvents:async()=>{
    if(calls++)throw Object.assign(new Error('private revoked detail'),{statusCode:403});
    return {items:[{seq:1,run_id:'run-0001',project_id:'project-a',app_type_id:null,type:'text',data:{text:'authorized'}}],has_more:true};
  }});
  let output='';for await(const part of f.stream)output+=part;
  assert.equal((output.match(/event: agent/g)||[]).length,1);assert.match(output,/event: unavailable/);assert.doesNotMatch(output,/private revoked detail/);
});

test('invalid or conflicting resume cursors are rejected before starting a stream',async t=>{
  for(const options of [{query:{after:'-1'}},{query:{after:'1.5'}},{query:{after:'1'},headers:{'last-event-id':'2'}}])await assert.rejects(fixture(t,[{id:'run-0001',status:'completed'}],options),error=>error.statusCode===400);
});

test('closing a progress subscription removes listeners without cancelling the durable agent',async t=>{
  let cancellations=0;t.mock.method(service,'cancelRun',async()=>{cancellations++;});
  const f=await fixture(t,[{id:'run-0001',status:'running'}]);
  const iterator=f.stream[Symbol.asyncIterator]();await iterator.next();f.raw.emit('close');await iterator.return();
  assert.equal(cancellations,0);assert.equal(f.raw.listenerCount('close'),0);
});
