const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const Fastify=require('fastify');
const filename=path.resolve(__dirname,'../../backend/plugin.js');
const original=createRequire(filename);
function plugin(authenticate){
 const module={exports:{}};
 const mocks={
  '@hellotest/platform/backend/src/db':{},
  './registry':{register:()=>{}},
  './auth':{authenticate},
  './backplane':{configure:()=>{}},
  './mcpServer':{tools:{},handler:{fetch:async()=>new Response('{}',{headers:{'Content-Type':'application/json'}}),close:async()=>{}}},
  './readDatabase':{close:async()=>{}}
 };
 new Function('require','module','exports',fs.readFileSync(filename,'utf8'))(id=>Object.hasOwn(mocks,id)?mocks[id]:original(id),module,module.exports);
 return module.exports;
}
const payload={jsonrpc:'2.0',id:1,method:'tools/list'};
const actor={user:{id:'user'},projectId:'project',clientId:'host'};

test('MCP Host and Origin checks reject requests before credential validation',async t=>{
 let checks=0;const app=Fastify();app.register(plugin(async()=>{checks++;return actor;}));await app.ready();t.after(()=>app.close());
 for(const headers of [{host:'evil.example'},{host:'localhost',origin:'https://evil.example'}]){
  assert.equal((await app.inject({method:'POST',url:'/mcp',headers,payload})).statusCode,403);
 }
 assert.equal(checks,0);
 assert.equal((await app.inject({method:'GET',url:'/mcp',headers:{host:'localhost'}})).statusCode,405);
});

test('MCP request capacity includes authentication in flight and releases after success',async t=>{
 const previous=process.env.HELLOTEST_MCP_MAX_CONCURRENT;process.env.HELLOTEST_MCP_MAX_CONCURRENT='1';
 t.after(()=>{if(previous===undefined)delete process.env.HELLOTEST_MCP_MAX_CONCURRENT;else process.env.HELLOTEST_MCP_MAX_CONCURRENT=previous;});
 let entered,release;const started=new Promise(resolve=>entered=resolve),pending=new Promise(resolve=>release=resolve);
 let checks=0;const app=Fastify();app.register(plugin(async()=>{checks++;entered();await pending;return actor;}));await app.ready();t.after(()=>app.close());
 const first=app.inject({method:'POST',url:'/mcp',headers:{host:'localhost'},payload});await started;
 const crowded=await app.inject({method:'POST',url:'/mcp',headers:{host:'localhost'},payload});assert.equal(crowded.statusCode,429);assert.equal(checks,1);
 release();assert.equal((await first).statusCode,200);
 assert.equal((await app.inject({method:'POST',url:'/mcp',headers:{host:'localhost'},payload})).statusCode,200);
});

test('MCP authentication failures carry safe error codes and release capacity',async t=>{
 const app=Fastify();app.register(plugin(async()=>{throw Object.assign(new Error('private-signing-details'),{statusCode:401,code:'MCP_UNAUTHORIZED',publicMessage:'Invalid MCP credential.'});}));await app.ready();t.after(()=>app.close());
 for(let i=0;i<2;i++){
  const result=await app.inject({method:'POST',url:'/mcp',headers:{host:'localhost'},payload});assert.equal(result.statusCode,401);assert.equal(result.json().code,'MCP_UNAUTHORIZED');assert.ok(!result.body.includes('private-signing-details'));assert.match(result.headers['www-authenticate'],/Bearer/);
 }
});
