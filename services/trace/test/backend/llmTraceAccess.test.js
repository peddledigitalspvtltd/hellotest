const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Fastify = require('fastify');
const { ROUTE_PERMISSIONS } = require('../../../platform/backend/src/security/permissions.catalog');

test('AI call routes require ops permission and project access; only administrators receive payloads',async()=>{
  const app=Fastify(),file=require.resolve('../../backend/routes/llmTraces.routes'),module={exports:{}};
  const calls=[];
  new Function('require','module',fs.readFileSync(file,'utf8'))(id=>{
    if(id.endsWith('/projectAccess')) return {getProject:async(project,user)=>{if(project!=='permitted'||!user)throw Object.assign(new Error('Project access denied'),{statusCode:403});}};
    if(id==='../services/llmTraceQuery.service') return {
      list:async project=>{calls.push(project);return{items:[]};},
      detail:async(project,id,{includeContent})=>{calls.push(project);return{id,content_access:includeContent,...includeContent?{request_payload:{prompt:'Private source'},response_payload:{content:'Review'}}:{}};}
    };
    throw new Error(`Unexpected dependency ${id}`);
  },module);
  app.addHook('preHandler',async req=>{
    if(!req.headers['x-test-role']) throw Object.assign(new Error('Authentication required'),{statusCode:401});
    req.user={id:'user',role:req.headers['x-test-role']};
    assert.equal(ROUTE_PERMISSIONS.get(`${req.method} ${req.routeOptions.url}`),'ops.view');
    if(req.headers['x-test-ops']!=='true') throw Object.assign(new Error('Permission required: ops.view'),{statusCode:403});
  });
  await app.register(module.exports);
  try {
    const url='/ops-telemetry/llm-traces/call?project_id=permitted';
    assert.equal((await app.inject({url})).statusCode,401);
    assert.equal((await app.inject({url,headers:{'x-test-role':'member'}})).statusCode,403);
    const member=await app.inject({url,headers:{'x-test-role':'member','x-test-ops':'true'}});
    assert.equal(member.statusCode,200);assert.equal(member.json().content_access,false);assert.equal(member.json().request_payload,undefined);assert.equal(member.headers['cache-control'],'no-store');
    const admin=await app.inject({url,headers:{'x-test-role':'admin','x-test-ops':'true'}});
    assert.equal(admin.json().request_payload.prompt,'Private source');assert.equal(admin.json().content_access,true);
    const before=calls.length;
    assert.equal((await app.inject({url:'/ops-telemetry/llm-traces/call?project_id=foreign',headers:{'x-test-role':'admin','x-test-ops':'true'}})).statusCode,403);
    assert.equal(calls.length,before,'A rejected project must not query trace storage');
    assert.equal((await app.inject({url:'/ops-telemetry/llm-traces',headers:{'x-test-role':'admin','x-test-ops':'true'}})).statusCode,400);
  } finally {await app.close();}
});
