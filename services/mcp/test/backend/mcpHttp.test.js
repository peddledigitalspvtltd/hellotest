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
  '@hellotest/platform/backend/src/db':options.db||{},
  './registry':{register:()=>{},revision:()=>'revision',all:()=>[]},
  // The plugin verifies the credential's signature (decode) before it takes a capacity slot, then authenticates it.
  './auth':{authenticate,decode:options.decode||(token=>({jti:'credential-'+(token||'none'),project_id:'project',int:false})),fail,...options.auth},
  './backplane':{configure:()=>{}},
  './mcpServer':options.server||{tools:{},handler:{fetch:async()=>new Response('{}',{headers:{'Content-Type':'application/json'}}),close:async()=>{}}},
  './readDatabase':{close:async()=>{}}
 };
 if(options.timeoutMs)mocks['./contextRequest']={requestTimeoutMs:()=>options.timeoutMs};
 new Function('require','module','exports',fs.readFileSync(filename,'utf8'))(id=>Object.hasOwn(mocks,id)?mocks[id]:original(id),module,module.exports);
 return module.exports;
}
const payload={jsonrpc:'2.0',id:1,method:'tools/list'};
const fail=(message,statusCode=403,code='MCP_ACCESS_DENIED')=>Object.assign(new Error(message),{statusCode,code,publicMessage:message});
// An authenticated caller always carries the tool sets of its credential.
const actor={user:{id:'user'},projectId:'project',clientId:'host',scopes:['knowledge','records']};

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

// --- admission, tool sets and credential issuance -------------------------------------------------------------

const withEnv=(t,values)=>{
 const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
 Object.assign(process.env,values);
 t.after(()=>{for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
};
const post=(app,token)=>app.inject({method:'POST',url:'/mcp',headers:{host:'localhost',...(token?{authorization:'Bearer '+token}:{})},payload});
const until=async condition=>{for(let index=0;index<400&&!condition();index++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(condition(),'condition was not reached');};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const byToken=token=>({jti:token,project_id:'project-'+token,int:token.startsWith('internal')});

test('a request without a valid credential signature never takes capacity or reaches authentication',async t=>{
 withEnv(t,{HELLOTEST_MCP_MAX_CONCURRENT:'1'});
 let authenticated=0;
 const decode=token=>{if(token!=='valid')throw fail('Invalid MCP credential.',401,'MCP_UNAUTHORIZED');return {jti:'credential',project_id:'project'};};
 const app=Fastify();app.register(plugin(async()=>{authenticated++;return actor;},{decode}));await app.ready();t.after(()=>app.close());
 for(let index=0;index<5;index++){
  const result=await post(app,'forged');
  assert.equal(result.statusCode,401);assert.equal(result.json().code,'MCP_UNAUTHORIZED');assert.match(result.headers['www-authenticate'],/Bearer/);
 }
 assert.equal((await post(app)).statusCode,401,'no credential at all');
 assert.equal(authenticated,0,'nothing unauthenticated reaches the database');
 // Capacity is one, and the forged requests left it free.
 assert.equal((await post(app,'valid')).statusCode,200);
 assert.equal(authenticated,1);
});

test('capacity is reserved for the platform\'s own calls so an external burst cannot starve a chat turn',async t=>{
 withEnv(t,{HELLOTEST_MCP_MAX_CONCURRENT:'4',HELLOTEST_MCP_INTERNAL_RESERVE:'1',HELLOTEST_MCP_PROJECT_SHARE:'1',HELLOTEST_MCP_RATE_BURST:'100'});
 const gate=deferred();let entered=0;
 const app=Fastify();app.register(plugin(async()=>{entered++;await gate.promise;return actor;},{decode:byToken}));await app.ready();t.after(()=>app.close());
 const external=['ext-1','ext-2','ext-3'].map(token=>post(app,token));
 await until(()=>entered===3);
 const refused=await post(app,'ext-4');
 assert.equal(refused.statusCode,429);assert.equal(refused.json().code,'MCP_CAPACITY');assert.ok(Number(refused.headers['retry-after'])>=1);
 const internal=post(app,'internal-1');
 await until(()=>entered===4);
 const full=await post(app,'internal-2');
 assert.equal(full.statusCode,429,'the reserve is a share of the total, not extra capacity');
 gate.resolve();
 for(const response of await Promise.all([...external,internal]))assert.equal(response.statusCode,200);
 assert.equal((await post(app,'ext-4')).statusCode,200,'slots are free again once the burst finishes');
});

test('one project cannot take more than its share of the external capacity',async t=>{
 withEnv(t,{HELLOTEST_MCP_MAX_CONCURRENT:'8',HELLOTEST_MCP_INTERNAL_RESERVE:'0',HELLOTEST_MCP_PROJECT_SHARE:'0.5',HELLOTEST_MCP_RATE_BURST:'100'});
 const gate=deferred();let entered=0;
 const decode=token=>({jti:token,project_id:token.startsWith('other')?'other-project':'shared-project',int:false});
 const app=Fastify();app.register(plugin(async()=>{entered++;await gate.promise;return actor;},{decode}));await app.ready();t.after(()=>app.close());
 const held=['a','b','c','d'].map(token=>post(app,token));
 await until(()=>entered===4);
 const crowded=await post(app,'e');
 assert.equal(crowded.statusCode,429);assert.equal(crowded.json().code,'MCP_PROJECT_BUSY');
 const neighbour=post(app,'other-1');
 await until(()=>entered===5);
 gate.resolve();
 for(const response of await Promise.all([...held,neighbour]))assert.equal(response.statusCode,200);
});

test('each credential has its own request rate, and the platform\'s own calls are not rate limited',async t=>{
 // One token every ten seconds: slow enough that the test cannot be saved by the clock.
 withEnv(t,{HELLOTEST_MCP_RATE_PER_SECOND:'0.1',HELLOTEST_MCP_RATE_BURST:'2',HELLOTEST_MCP_MAX_CONCURRENT:'32'});
 const app=Fastify();app.register(plugin(async()=>actor,{decode:byToken}));await app.ready();t.after(()=>app.close());
 assert.equal((await post(app,'hot')).statusCode,200);
 assert.equal((await post(app,'hot')).statusCode,200);
 const limited=await post(app,'hot');
 assert.equal(limited.statusCode,429);assert.equal(limited.json().code,'MCP_RATE_LIMITED');
 assert.ok(Number(limited.headers['retry-after'])>=1);assert.equal(limited.json().retry_after_seconds,Number(limited.headers['retry-after']));
 assert.equal((await post(app,'cool')).statusCode,200,'another credential is unaffected');
 for(let index=0;index<6;index++)assert.equal((await post(app,'internal-chat')).statusCode,200);
});

test('an authenticated caller without tool sets is refused instead of being served every tool',async t=>{
 let served=0;
 const server={tools:{},handler:{fetch:async()=>{served++;return new Response('{}');},close:async()=>{}}};
 const app=Fastify();app.register(plugin(async()=>({user:{id:'user'},projectId:'project',clientId:'host'}),{server}));await app.ready();t.after(()=>app.close());
 const result=await post(app,'token');
 assert.equal(result.statusCode,500);assert.equal(result.json().code,'MCP_SCOPE_UNAVAILABLE');assert.equal(served,0);
});

test('the SDK receives the authenticated actor and its tool sets',async t=>{
 let seen;
 const server={tools:{},handler:{fetch:async(_request,context)=>{seen=context;return new Response('{}',{headers:{'Content-Type':'application/json'}});},close:async()=>{}}};
 const scoped={...actor,scopes:['knowledge']};
 const app=Fastify();app.register(plugin(async()=>scoped,{server}));await app.ready();t.after(()=>app.close());
 assert.equal((await post(app,'token')).statusCode,200);
 assert.equal(seen.authInfo.extra.actor,scoped);assert.deepEqual(seen.authInfo.scopes,['knowledge']);
});

test('host credentials are issued with the requested tool sets and can never be marked internal',async t=>{
 withEnv(t,{NODE_ENV:'test'});
 const issued=[];
 const auth={
  principal:async(id,project)=>({user:{id},projectId:project,clientId:'hellotest-internal'}),permit:async()=>{},clientKeyFor:()=> 'a'.repeat(64),
  issue:async(user,project,client,options)=>{issued.push({user,project,client,options});return {id:'credential',token:'secret',expires_at:'2030-01-01T00:00:00.000Z',scopes:options.scopes||['knowledge','records']};}
 };
 const app=Fastify();app.decorate('authenticate',async req=>{req.user={id:'user'};});app.register(plugin(async()=>actor,{auth}));await app.ready();t.after(()=>app.close());
 const create=body=>app.inject({method:'POST',url:'/agentic-workflows/mcp/credentials',headers:{host:'localhost'},payload:{project_id:'project',client_id:'my-host',...body}});
 assert.equal((await create({scopes:['actions']})).statusCode,200);
 assert.deepEqual(issued[0].options,{scopes:['actions'],clientKey:'a'.repeat(64)});assert.match(issued[0].client,/^my-host-[0-9a-f-]{36}$/);
 // A caller that asks for the platform's marker gets an ordinary credential: the option cannot be reached from HTTP.
 assert.equal((await create({internal:true,ttlSeconds:99999})).statusCode,200);
 assert.deepEqual(Object.keys(issued[1].options),['scopes','clientKey']);assert.equal(issued[1].options.scopes,undefined,'no scopes asked for means the read-only default is applied by issue()');
});

test('discovery publishes the tool sets, each tool\'s set, and the credential contract without claiming OAuth',async t=>{
 withEnv(t,{NODE_ENV:'test'});
 const definition=(name,readOnly)=>({name,title:name,description:name,inputSchema:{},outputSchema:{},annotations:{readOnlyHint:readOnly}});
 const server={
  tools:{hellotest_context_build:{},hellotest_capabilities:{},hellotest_operation_prepare:{write:true},hellotest_automation_engineer_prepare:{write:true}},
  toolDefinitions:()=>[definition('hellotest_context_build',true),definition('hellotest_capabilities',true),definition('hellotest_operation_prepare',false),definition('hellotest_automation_engineer_prepare',false)],
  handler:{fetch:async()=>new Response('{}'),close:async()=>{}}
 };
 const auth={principal:async(id,project)=>({user:{id},projectId:project,clientId:'hellotest-internal'}),permit:async()=>{}};
 const app=Fastify();app.decorate('authenticate',async req=>{req.user={id:'user'};});app.register(plugin(async()=>actor,{server,auth}));await app.ready();t.after(()=>app.close());
 const body=(await app.inject({method:'GET',url:'/agentic-workflows/mcp/server?project_id=project',headers:{host:'localhost'}})).json();
 assert.deepEqual(body.tool_sets.map(set=>set.id),['knowledge','records','actions','automation']);
 assert.deepEqual(body.tool_sets.map(set=>set.read_only),[true,true,false,false]);
 assert.deepEqual(body.tool_sets.map(set=>set.tool_count),[1,1,1,1]);
 assert.ok(body.tool_sets.every(set=>!('tools' in set)),'the listing names counts; the tools carry their own set');
 assert.deepEqual(Object.fromEntries(body.tools.map(tool=>[tool.name,tool.tool_set])),{hellotest_context_build:'knowledge',hellotest_capabilities:'records',hellotest_operation_prepare:'actions',hellotest_automation_engineer_prepare:'automation'});
 assert.deepEqual(body.client_contract.default_scopes,['knowledge','records']);assert.deepEqual(body.client_contract.scopes_supported,['knowledge','records','actions','automation']);
 assert.equal(body.client_contract.oauth_supported,false);
 assert.equal(body.client_contract.credential_issuance_enabled,true);
});

test('production refuses manual external credentials while preserving internal platform calls',async t=>{
 withEnv(t,{NODE_ENV:'production'});
 let authenticated=0;
 const server={tools:{},toolDefinitions:()=>[],handler:{fetch:async()=>new Response('{}',{headers:{'Content-Type':'application/json'}}),close:async()=>{}}};
 const auth={principal:async(id,project)=>({user:{id},projectId:project,clientId:'hellotest-internal'}),permit:async()=>{},issue:async()=>{assert.fail('manual credentials must not be issued')}};
 const app=Fastify();app.decorate('authenticate',async req=>{req.user={id:'user'};});
 app.register(plugin(async()=>{authenticated++;return actor;},{server,auth,decode:token=>({jti:token,project_id:'project',int:token==='internal'})}));
 await app.ready();t.after(()=>app.close());
 const create=await app.inject({method:'POST',url:'/agentic-workflows/mcp/credentials',headers:{host:'localhost'},payload:{project_id:'project',client_id:'host'}});
 assert.equal(create.statusCode,503);assert.equal(create.json().code,'MCP_OAUTH_REQUIRED');
 const metadata=(await app.inject({method:'GET',url:'/agentic-workflows/mcp/server?project_id=project',headers:{host:'localhost'}})).json();
 assert.equal(metadata.external_credentials_enabled,false);assert.equal(metadata.client_contract.credential_issuance_enabled,false);
 const external=await post(app,'external');assert.equal(external.statusCode,503);assert.equal(external.json().code,'MCP_OAUTH_REQUIRED');
 assert.equal(authenticated,0,'blocked external credentials never reach authentication or tools');
 assert.equal((await post(app,'internal')).statusCode,200,'platform credentials remain available');
 assert.equal(authenticated,1);
});

test('the credential list shows a person\'s own host credentials with their access, not the platform\'s internal ones',async t=>{
 const statements=[];
 const db={prepare:sql=>{statements.push(sql);return {all:async()=>[{id:'credential',client_id:'host',scopes:['knowledge','records']}],run:async()=>{}};}};
 const auth={principal:async(id,project)=>({user:{id},projectId:project,clientId:'hellotest-internal'}),permit:async()=>{}};
 const app=Fastify();app.decorate('authenticate',async req=>{req.user={id:'user'};});app.register(plugin(async()=>actor,{db,auth}));await app.ready();t.after(()=>app.close());
 const rows=(await app.inject({method:'GET',url:'/agentic-workflows/mcp/credentials?project_id=project',headers:{host:'localhost'}})).json();
 assert.deepEqual(rows[0].scopes,['knowledge','records']);
 const listing=statements.find(sql=>sql.includes('FROM mcp_credentials'));
 assert.match(listing,/\bscopes\b/);assert.match(listing,/internal=FALSE/);
});
