const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../backend');
function load(name,mocks){const file=path.join(root,name+'.js');const original=createRequire(file);const module={exports:{}};new Function('require','module','exports','__filename','__dirname',fs.readFileSync(file,'utf8'))(id=>Object.hasOwn(mocks,id)?mocks[id]:original(id),module,module.exports,file,root);return module.exports;}
const actor={user:{id:'user-a',role:'member'},projectId:'project-a',clientId:'host'};
const permit=async(a)=>{if(a.projectId!=='project-a')throw Object.assign(new Error('Denied'),{statusCode:403,code:'DENIED'});};
const fakeDb={prepare:()=>({run:async()=>{},get:async()=>undefined,all:async()=>[]})};
const backplane={catalog:async a=>({owner:a.user.id,project:a.projectId}),describe:async()=>({}),read:async()=>({}),context:async a=>({packet:{evidence:[]},owner:a.user.id}),graph:async()=>({}),prepare:async()=>({state:'requires_authorization'}),execute:async()=>({state:'requires_authorization'}),status:async()=>({state:'requires_authorization'}),bounded:value=>value,auditFailure:()=>{}};
const server=load('mcpServer',{'./backplane':backplane,'./projections':{entities:{projects:{}},schema:async()=>({}),query:async()=>({})},'./auth':{permit,fail:(message,statusCode=403,code='DENIED')=>Object.assign(new Error(message),{statusCode,code,publicMessage:message})},'@hellotest/platform/backend/src/db':fakeDb});
const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
function request(body,headers={}){return new Request('http://localhost/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...headers},body:JSON.stringify(body)});}
const auth={authInfo:{token:'test',clientId:'host',scopes:[],extra:{actor}}};
test.after(()=>server.handler.close());
test('real SDK serves the modern stateless tool catalog and caller-bound results',async()=>{
 const response=await server.handler.fetch(request({jsonrpc:'2.0',id:1,method:'tools/list',params:{_meta:meta}},{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/list'}),auth);
 assert.equal(response.status,200);const catalog=await response.json();assert.equal(catalog.result.tools.length,11);assert.ok(catalog.result.tools.every(tool=>tool.inputSchema.additionalProperties===false));
 const result=await server.callLocal(actor,'hellotest_capabilities',{});assert.equal(result.owner,'user-a');assert.equal(result.project,'project-a');
});
test('legacy initialize remains compatible without protocol session authority',async()=>{
 for(const version of ['2025-11-25','2025-06-18','2025-03-26']){
 const response=await server.handler.fetch(request({jsonrpc:'2.0',id:2,method:'initialize',params:{protocolVersion:version,capabilities:{},clientInfo:{name:'legacy',version:'1'}}}),auth);
 const text=await response.text();const result=JSON.parse(response.headers.get('content-type').includes('text/event-stream')?text.split('\n').find(line=>line.startsWith('data:')).slice(5):text);assert.equal(response.status,200);assert.equal(result.result.protocolVersion,version);assert.equal(response.headers.get('mcp-session-id'),null);
 }
});
test('tool schemas reject model-supplied identity, approval and raw SQL',async()=>{
 for(const [name,args] of [['hellotest_context_build',{question:'help',user_id:'admin'}],['hellotest_operation_execute',{plan_id:'plan',approved:true}],['hellotest_database_query',{entity:'projects',sql:'SELECT * FROM users'}]])await assert.rejects(server.invoke(actor,name,args),{code:'MCP_INVALID_ARGUMENT'});
 await assert.rejects(server.invoke({...actor,projectId:'project-b'},'hellotest_capabilities',{}),{code:'DENIED'});
});
test('modern transport validates mismatched method metadata',async()=>{
 const response=await server.handler.fetch(request({jsonrpc:'2.0',id:3,method:'tools/list',params:{_meta:meta}},{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call'}),auth);
 assert.equal(response.status,400);
});
test('resource-specific credentials cannot be mistaken for an app session and tampering fails',async()=>{
 const rows=new Map();const db={prepare:sql=>({run:async(...values)=>{rows.set(values[0],values);},get:async(id,user,project,client)=>{const row=rows.get(id);return row&&row[1]===user&&row[2]===project&&row[3]===client?{id}:undefined;}})};
 const real=load('auth',{'@hellotest/platform/backend/src/db':db,'@hellotest/platform/backend/src/security/runtimeSecrets':{resolveSessionSecret:()=> 'test-mcp-secret-32-characters-long-only'},'@hellotest/platform/backend/public/projectAccess':{getProject:async()=>({id:'project-a'})},'@hellotest/platform/backend/services/permission.service':{hasPermission:async()=>true},'@hellotest/platform/backend/services/featureFlag.service':{getFeatureKeysForPermission:()=>[],areEnabled:async()=>true},'@hellotest/platform/backend/services/user.service':{getUser:async id=>({id,status:'active',role:'member'})}});
 const issued=await real.issue(actor.user,actor.projectId);assert.equal(real.decode(issued.token).aud,'hellotest:mcp');assert.equal(issued.token.split('.').length,3);
 assert.equal((await real.authenticate(issued.token)).projectId,actor.projectId);
 await assert.rejects(real.authenticate(issued.token.slice(0,-1)+'!'),{code:'MCP_UNAUTHORIZED'});
 assert.throws(()=>real.decode('api-session.signature'),{code:'MCP_UNAUTHORIZED'});
 rows.clear();await assert.rejects(real.authenticate(issued.token),{code:'MCP_UNAUTHORIZED'});
});

test('bounded context preserves token budgets and provenance while removing credentials',()=>{
 const real=load('backplane',{'@hellotest/platform/backend/src/db':fakeDb,'./auth':{permit,fail:(message,statusCode,code)=>Object.assign(new Error(message),{statusCode,code})}});
 const result=real.bounded({max_context_tokens:2000,token_count:24,citation:{source_id:'source-a',observed_at:new Date('2026-10-06T00:00:00Z')},access_token:'private',token:'private',password:'private',headers:{Authorization:'Bearer private'},items:[{id:'a'}]});
 assert.equal(result.max_context_tokens,2000);assert.equal(result.token_count,24);assert.equal(result.citation.source_id,'source-a');assert.equal(result.citation.observed_at,'2026-10-06T00:00:00.000Z');assert.ok(!JSON.stringify(result).includes('private'));
 assert.throws(()=>real.bounded(Array.from({length:100},()=>({content:'a'.repeat(12000)}))),{code:'MCP_RESULT_TOO_LARGE'});
});

test('MCP redaction retains ContextPacket ACL provenance without retaining credential headers',()=>{
 const real=load('backplane',{'@hellotest/platform/backend/src/db':fakeDb,'./auth':{permit,fail:(message,statusCode,code)=>Object.assign(new Error(message),{statusCode,code})}});
 const safe=real.bounded({authorization:{project_scope_enforced:true,source_acl_enforced:true,allowed_record_permissions:['testcase.view'],token:'private',headers:{Authorization:'private'}},authorization_coverage:{fully_visible_objects:2,partially_visible_objects:0,unavailable_objects:1,secret:'private'},headers:{authorization:'Bearer private'}});
 assert.deepEqual(safe.authorization,{project_scope_enforced:true,source_acl_enforced:true,allowed_record_permissions:['testcase.view']});assert.equal(safe.authorization_coverage.fully_visible_objects,2);assert.ok(!JSON.stringify(safe).includes('private'));
});

test('catalog discovery avoids repeated permission queries and rechecks permissions on the next request',async()=>{
 let checks=0,allowed=true;const operations=[{id:'a',method:'GET',path:'/test-cases',permission:'testcase.view'},{id:'b',method:'GET',path:'/test-cases/:id',permission:'testcase.view'}];
 const real=load('backplane',{'@hellotest/platform/backend/src/db':fakeDb,'./auth':{permit:async(a,permission)=>{await permit(a);if(permission==='testcase.view'){checks++;if(!allowed)throw Object.assign(new Error('Denied'),{statusCode:403});}},fail:(message,statusCode,code)=>Object.assign(new Error(message),{statusCode,code})},'./registry':{all:()=>operations,revision:()=> 'revision'}});
 assert.equal((await real.catalog(actor,{query:'test-cases'})).operations.length,2);assert.equal(checks,1);allowed=false;assert.equal((await real.catalog(actor,{query:'test-cases'})).operations.length,0);assert.equal(checks,2);
});

test('built-in status inspects the real SDK without executing the full capability catalog',async()=>{
 const prior=server.tools.hellotest_capabilities.run;let calls=0;server.tools.hellotest_capabilities.run=async()=>{calls++;throw new Error('Status should not execute catalog scans');};
 try{const tools=await server.inspectLocal(actor);assert.ok(tools.some(tool=>tool.name==='hellotest_context_build'));assert.equal(calls,0);}
 finally{server.tools.hellotest_capabilities.run=prior;}
});

test('the real SDK carries internal request cancellation into context retrieval',{timeout:3000},async()=>{
 const tool=server.tools.hellotest_context_build,prior=tool.run;let entered,observed;
 const started=new Promise(resolve=>entered=resolve);
 tool.run=async(_actor,_args,signal)=>{observed=signal;entered();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
 const controller=new AbortController();
 try{
  const pending=server.callLocal(actor,'hellotest_context_build',{question:'Read project context'},controller.signal);
  await started;controller.abort();await assert.rejects(pending);assert.equal(observed.aborted,true);
 }finally{tool.run=prior;}
});
