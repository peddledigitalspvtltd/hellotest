const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const Fastify=require('fastify');
const filename=path.resolve(__dirname,'../../backend/plugin.js');
const original=createRequire(filename);
function plugin(authenticate,options={}){
 const module={exports:{}};
 const mocks={
  '@hellotest/platform/backend/src/db':{},
  './registry':{register:()=>{}},
  './auth':{authenticate},
  './backplane':{configure:()=>{}},
  './mcpServer':{tools:{},handler:{fetch:async()=>new Response('{}',{headers:{'Content-Type':'application/json'}}),close:async()=>{}}},
  './readDatabase':{close:async()=>{}}
 };
 if(options.timeoutMs)mocks['./contextRequest']={requestTimeoutMs:()=>options.timeoutMs};
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

test('the complete MCP request deadline includes stuck authentication and releases capacity',async t=>{
 let checks=0;const app=Fastify();app.register(plugin(async()=>{checks++;return new Promise(()=>{});},{timeoutMs:15}));await app.ready();t.after(()=>app.close());
 for(let index=0;index<2;index++) {
  const result=await app.inject({method:'POST',url:'/mcp',headers:{host:'localhost'},payload});assert.equal(result.statusCode,504);assert.equal(result.json().error.data.code,'MCP_REQUEST_TIMEOUT');assert.ok(!result.body.includes('credential'));
 }
 assert.equal(checks,2);
});

test('late authentication rejection cannot write a second response after the request deadline',async t=>{
 let rejectAuth;const pending=new Promise((_,reject)=>{rejectAuth=reject;}),statuses=[];
 const app=Fastify();app.addHook('onRequest',async(_req,reply)=>{const original=reply.code;reply.code=function(status){statuses.push(status);return original.call(this,status);};});
 app.register(plugin(()=>pending,{timeoutMs:15}));await app.ready();t.after(()=>app.close());
 const result=await app.inject({method:'POST',url:'/mcp',headers:{host:'localhost'},payload});assert.equal(result.statusCode,504);
 rejectAuth(Object.assign(new Error('late private authentication detail'),{statusCode:401}));
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(statuses,[504]);
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

test('public MCP authority accepts normalized hosts but requires explicit external browser origins',async t=>{
 const previous={public:process.env.HELLOTEST_MCP_PUBLIC_URL,cors:process.env.CORS_ORIGIN};process.env.HELLOTEST_MCP_PUBLIC_URL='https://app.hellotest.ai/api/mcp';process.env.CORS_ORIGIN='https://trusted-client.example';
 t.after(()=>{for(const[key,value]of [['HELLOTEST_MCP_PUBLIC_URL',previous.public],['CORS_ORIGIN',previous.cors]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 const app=Fastify();app.register(plugin(async()=>{throw Object.assign(new Error('Missing credential'),{statusCode:401});}));await app.ready();t.after(()=>app.close());
 for(const headers of [{host:'app.hellotest.ai'},{host:'APP.HELLOTEST.AI:443'},{host:'app.hellotest.ai',origin:'https://app.hellotest.ai'},{host:'app.hellotest.ai',origin:'https://trusted-client.example'}])assert.equal((await app.inject({method:'POST',url:'/mcp',headers,payload})).statusCode,401,'Allowed transport must reach authentication');
 const origin=await app.inject({method:'POST',url:'/mcp',headers:{host:'app.hellotest.ai',origin:'https://untrusted.example'},payload});assert.equal(origin.statusCode,403);assert.equal(origin.json().code,'MCP_ORIGIN_DENIED');
 const host=await app.inject({method:'POST',url:'/mcp',headers:{host:'app.hellotest.ai.evil.example'},payload});assert.equal(host.statusCode,403);assert.equal(host.json().code,'MCP_HOST_DENIED');
});

test('configured public application/API URLs supply an exact external MCP authority without trusting arbitrary hosts',async t=>{
 const names=['HELLOTEST_MCP_PUBLIC_URL','HELLOTEST_PUBLIC_URL','HELLOTEST_API_PUBLIC_URL'];const previous=Object.fromEntries(names.map(key=>[key,process.env[key]]));
 t.after(()=>{for(const key of names)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];});
 for(const settings of [{HELLOTEST_PUBLIC_URL:'https://app.hellotest.ai'},{HELLOTEST_API_PUBLIC_URL:'https://api.example.test/api'}]){
  for(const key of names)delete process.env[key];Object.assign(process.env,settings);
  const authority=new URL(Object.values(settings)[0]).host;
  const app=Fastify();app.register(plugin(async()=>{throw Object.assign(new Error('credential required'),{statusCode:401});}));await app.ready();
  try{
   const own=await app.inject({method:'POST',url:'/mcp',headers:{host:authority},payload});assert.equal(own.statusCode,401,own.body);
   const wrong=await app.inject({method:'POST',url:'/mcp',headers:{host:'invented.example.test'},payload});assert.equal(wrong.statusCode,403);assert.equal(wrong.json().code,'MCP_HOST_DENIED');assert.match(wrong.json().message,/HELLOTEST_MCP_PUBLIC_URL/);
   const origin=await app.inject({method:'POST',url:'/mcp',headers:{host:authority,origin:'https://invented.example.test'},payload});assert.equal(origin.statusCode,403);assert.equal(origin.json().code,'MCP_ORIGIN_DENIED');assert.match(origin.json().message,/CORS_ORIGIN/);
  }finally{await app.close();}
 }
});
