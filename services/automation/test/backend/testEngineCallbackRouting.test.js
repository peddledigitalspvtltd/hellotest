const test=require('node:test');const assert=require('node:assert/strict');const Fastify=require('fastify');
const routes=require('../../backend/routes/testEngineCallbacks.routes');const service=require('../../backend/services/testEngineCallback.service');
test('signed callbacks have the same raw-body handling through the public gateway route and legacy direct API route',async t=>{
 const app=Fastify();app.decorate('validate',()=>{});const bodies=[];t.mock.method(service,'handleRunCallback',async input=>{bodies.push(input);return {accepted:true};});await app.register(routes);t.after(()=>app.close());
 const raw='{ "engine_run_id": "e", "hellotest_run_id": "r", "hellotest_test_case_id": "c", "summary": "résultat" }';
 for(const url of ['/testengine/callbacks/runs','/api/testengine/callbacks/runs']) {
  const response=await app.inject({method:'POST',url,headers:{'content-type':'application/json','x-testengine-signature':'fixture-signature'},payload:raw});assert.equal(response.statusCode,200);assert.equal(bodies.at(-1).rawPayload,raw);assert.equal(bodies.at(-1).headers['x-testengine-signature'],'fixture-signature');
 }
 assert.equal(bodies.length,2);
});
