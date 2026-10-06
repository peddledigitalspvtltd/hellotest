const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const settings = require("../../backend/workflows/connectionSettings");
const connections = require("../../backend/workflows/connections");
const operations = require("../../backend/workflows/nodeOperations");
const db = require("@hellotest/platform/backend/src/db");
const mcp = require("../../backend/workflows/mcpClient");

function setup(t) {
  const rows = new Map();
  t.mock.method(settings._internals.store,"list",async()=>[...rows.values()]);
  t.mock.method(settings._internals.store,"get",async id=>rows.get(id));
  t.mock.method(settings._internals.store,"save",async row=>rows.set(row.id,structuredClone(row)));
  t.mock.method(settings._internals.store,"remove",async id=>rows.delete(id));
  const prepare = db.prepare;
  t.mock.method(db,"prepare",sql=>sql === "SELECT id FROM projects WHERE id = ?" ? {get:async id=>id==='p'?{id}:null} : prepare.call(db,sql));
  const prior = process.env.WORKFLOW_CREDENTIAL_KEY;
  process.env.WORKFLOW_CREDENTIAL_KEY = 'a-32-character-test-only-encryption-key';
  t.after(()=>{if(prior===undefined)delete process.env.WORKFLOW_CREDENTIAL_KEY;else process.env.WORKFLOW_CREDENTIAL_KEY=prior;});
  return rows;
}
const input = () => ({name:'Project tools',kind:'mcp',url:'https://example.test/mcp',project_id:'p',tools:['read_status'],authType:'bearer',secret:'a-test-token',enabled:true});

test('admin connections persist encrypted credentials, mask responses, preserve and replace credentials, and enforce project scope',async t=>{
  const rows=setup(t);
  const saved=await settings.save(input(),null,'admin');
  assert.equal(saved.authenticated,true);
  assert.doesNotMatch(JSON.stringify(saved),/a-test-token|ciphertext|encryptedSecret/);
  assert.doesNotMatch(JSON.stringify(rows.get(saved.id)),/a-test-token/);
  assert.equal(settings.credential(rows.get(saved.id)),'a-test-token');
  assert.equal((await connections.list('p')).filter(row=>row.id!=="hellotest").length,1);
  assert.equal((await settings.list('p'))[0].project_id,'p');
  assert.deepEqual(await settings.list('other'),[]);
  assert.deepEqual(rows.get(saved.id).projectIds,['p']);
  await assert.rejects(settings.list(),{statusCode:400});
  await assert.rejects(settings.get(saved.id,'other'),{statusCode:404});
  await assert.rejects(settings.save({...saved,project_id:'other'},saved.id,'admin'),{statusCode:404});
  await assert.rejects(settings.remove(saved.id,'other'),{statusCode:404});
  assert.deepEqual((await connections.list('other')).filter(row=>row.id!=="hellotest"),[]);
  await assert.rejects(connections.resolve(saved.id,'other',null,'mcp'),{statusCode:403});
  await settings.save({...saved,secret:''},saved.id,'admin');
  assert.equal(settings.credential(rows.get(saved.id)),'a-test-token');
  await settings.save({...saved,secret:'new-test-token'},saved.id,'admin');
  assert.equal(settings.credential(rows.get(saved.id)),'new-test-token');
  await settings.save({...saved,enabled:false},saved.id,'admin');
  assert.deepEqual((await connections.list('p')).filter(row=>row.id!=="hellotest"),[]);
  await settings.remove(saved.id,'p');
  assert.equal(rows.size,0);
});

test('connection policy rejects malformed endpoints, project scope, tools, credentials and unsafe headers',async t=>{
  setup(t);
  for (const patch of [{url:'file:///tmp/tool'},{url:'https://user:pass@example.test'},{url:'https://example.test?token=secret'},{project_id:''},{project_id:'missing'},{projectIds:['p','other']},{tools:['*']},{authType:'oauth'},{header:'Host'},{secret:'token\nextra'},{secretEnv:'PATH'}]) {
    await assert.rejects(settings.save({...input(),...patch},null,'admin'),patch.url || JSON.stringify(patch));
  }
  const row=await settings.save({...input(),authType:'none',secret:''},null,'admin');
  assert.equal(row.authenticated,false);
});

test('Basic authentication username edits require a matching replacement credential',async t=>{
  const rows=setup(t);
  const saved=await settings.save({...input(),authType:'basic',username:'alice',secret:'alice:test-password'},null,'admin');
  await settings.save({...saved,secret:''},saved.id,'admin');
  assert.equal(settings.credential(rows.get(saved.id)),'alice:test-password');
  await assert.rejects(settings.preview({...saved,username:'bob',secret:''},saved.id),/password again/);
  await assert.rejects(settings.save({...saved,username:'bob',secret:''},saved.id,'admin'),/password again/);
  await settings.save({...saved,username:'bob',secret:'bob:new-password'},saved.id,'admin');
  assert.equal(settings.credential(rows.get(saved.id)),'bob:new-password');
  assert.equal((await settings.list('p'))[0].username,'bob');
});

test('switching authentication methods sends credentials under the correct header',async t=>{
  const rows=setup(t);
  const saved=await settings.save({...input(),authType:'header',header:'X-API-Key'},null,'admin');
  assert.deepEqual(connections._internals.authHeaders(rows.get(saved.id)),{'X-API-Key':'a-test-token'});
  await settings.save({...saved,authType:'bearer',secret:'replacement-token'},saved.id,'admin');
  assert.deepEqual(connections._internals.authHeaders(rows.get(saved.id)),{Authorization:'Bearer replacement-token'});
  await settings.save({...saved,authType:'basic',username:'alice',secret:'alice:password'},saved.id,'admin');
  assert.deepEqual(connections._internals.authHeaders(rows.get(saved.id)),{Authorization:`Basic ${Buffer.from('alice:password').toString('base64')}`});
  for(const header of ['Accept','Content-Type','MCP-Session-Id']) await assert.rejects(settings.preview({...saved,header},saved.id),/credential header/);
});

test('HTTP nodes resolve typed bodies and encoded URL values from connected input using a saved admin connection',async t=>{
  setup(t);
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    requests.push({url:req.url,body:JSON.parse(body),auth:req.headers.authorization});
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({accepted:true,quantity:JSON.parse(body).quantity}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const saved=await settings.save({...input(),kind:'http',url:`http://127.0.0.1:${server.address().port}/api`,methods:['POST'],allowPrivateNetwork:true},null,'admin');
  const result=await operations.execute({run:{project_id:'p',input_payload:{release:'r1'}},node:{data:{kind:'apiTool',connectionId:saved.id,apiMethod:'POST',apiUrl:saved.url+'/{{ $input.id }}',apiBody:'{"quantity":"$input.quantity","release":"$request.release"}'}},sources:[{node_id:'prior',output:{data:{id:'A B/2',quantity:3}}}],signal:new AbortController().signal});
  assert.deepEqual(requests,[{url:'/api/A%20B%2F2',body:{quantity:3,release:'r1'},auth:'Bearer a-test-token'}]);
  assert.deepEqual(result.data,{accepted:true,quantity:3});
});

test('admin connection routes enforce integration permissions before reading or changing settings',async t=>{
  const fastify=require('fastify')();
  t.after(()=>fastify.close());
  fastify.decorate('authenticate',async req=>{req.user={id:'viewer'};});
  fastify.decorate('requirePermission',permission=>async()=>{throw Object.assign(new Error(permission),{statusCode:403});});
  fastify.decorate('validate',()=>{});
  const list=t.mock.method(settings,'list',async()=>{throw Error('Should not read');});
  const save=t.mock.method(settings,'save',async()=>{throw Error('Should not write');});
  await fastify.register(require('../../backend/routes/agenticWorkflows.routes'));
  for(const [method,path] of [['GET',''],['POST',''],['PUT','/id'],['DELETE','/id'],['POST','/id/discover'],['POST','/discover']]) {
    const response=await fastify.inject({method,url:'/agentic-workflows/admin/connections'+path});
    assert.equal(response.statusCode,403);
    assert.match(response.json().message,/integration\.(view|manage)/);
  }
  assert.equal(list.mock.callCount(),0);assert.equal(save.mock.callCount(),0);
});

test('saved MCP settings discover tools without granting them, then execute the enabled tool with mapped input', async t => {
  const rows=setup(t);
  const calls=[];
  const server=http.createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,'Bearer a-test-token');
    let body='';for await(const chunk of req)body+=chunk;
    const message=JSON.parse(body);
    if(message.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
    const result=message.method==='initialize'?{protocolVersion:'2025-11-25',serverInfo:{name:'QA tools',version:'2.0'},capabilities:{tools:{}}}
      :message.method==='tools/list'?{tools:[{name:'read_status',inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'}}}},{name:'delete_all',inputSchema:{type:'object'}}]}
      :{structuredContent:{id:message.params.arguments.id,status:'ready'},content:[]};
    if(message.method==='tools/call')calls.push(message.params);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const draft={...input(),url:`http://127.0.0.1:${server.address().port}/mcp`,allowPrivateNetwork:true,tools:[]};
  const preview=await settings.preview(draft);
  const discovered=await mcp.inspect({projectId:'p',draftConnection:preview});
  assert.equal(rows.size,0,'Discovery must not persist a draft or grant tools');
  assert.equal(calls.length,0,'Discovery must not invoke tools');
  assert.equal(discovered.serverInfo.name,'QA tools');
  assert.equal(discovered.protocolVersion,'2025-11-25');
  assert.equal(discovered.tools[0].inputSchema.required[0],'id');
  const saved=await settings.save({...draft,toolDefinitions:discovered.tools,serverInfo:discovered.serverInfo,protocolVersion:discovered.protocolVersion,discovered_at:discovered.discovered_at},null,'admin');
  const binding={projectId:'p',connectionId:saved.id};
  assert.deepEqual(await mcp.discover(binding),[]);
  assert.deepEqual((await mcp.discover({...binding,discoverAll:true})).map(tool=>tool.name),['read_status','delete_all']);
  await settings.save({...saved,tools:['read_status']},saved.id,'admin');
  const cached=(await connections.list('p')).find(row=>row.id!=="hellotest");
  assert.deepEqual(cached.toolDefinitions.map(tool=>tool.name),['read_status']);
  assert.equal(cached.toolDefinitions[0].inputSchema.required[0],'id');
  const result=await operations.execute({run:{project_id:'p',input_payload:{}},node:{data:{kind:'mcpTool',connectionId:saved.id,mcpTool:'read_status',mcpArguments:'{"id":"$input.id"}'}},sources:[{node_id:'request',output:{data:{id:'case-A'}}}],signal:new AbortController().signal});
  assert.deepEqual(result.data,{id:'case-A',status:'ready'});
  assert.deepEqual(calls,[{name:'read_status',arguments:{id:'case-A'}}]);
  const runtime=require('../../backend/services/agenticWorkflowExecution.service');
  const graph={project_id:'p',nodes:[{id:'start',data:{kind:'trigger'}},{id:'mcp',data:{kind:'mcpTool',connectionId:saved.id,mcpTool:'read_status'}},{id:'end',data:{kind:'output'}}],edges:[{source:'start',target:'mcp'},{source:'mcp',target:'end'}]};
  assert.equal((await runtime.checkReadiness(graph)).ready,true);
  await settings.save({...saved,enabled:false},saved.id,'admin');
  assert.equal((await runtime.checkReadiness(graph)).ready,false);
  assert.equal(calls.length,1,'Readiness does not call tools');
});

test('connection management routes bind CRUD and discovery to an accessible current project',async t=>{
  setup(t);
  const fastify=require('fastify')();
  t.after(()=>fastify.close());
  fastify.decorate('authenticate',async req=>{req.user={id:'admin'};});
  fastify.decorate('requirePermission',()=>async()=>{});
  fastify.decorate('validate',()=>{});
  t.mock.method(require('@hellotest/platform/backend/public/projectAccess'),'getProject',async projectId=>{
    if(projectId==='forbidden')throw Object.assign(new Error('Project access denied'),{statusCode:403});
    return {id:projectId};
  });
  const discover=t.mock.method(mcp,'discover',async binding=>[{name:'read_status',project:binding.projectId}]);
  await fastify.register(require('../../backend/routes/agenticWorkflows.routes'));
  const base='/agentic-workflows/admin/connections';
  assert.equal((await fastify.inject({method:'GET',url:base})).statusCode,400);
  assert.equal((await fastify.inject({method:'POST',url:base,payload:{...input(),project_id:'forbidden'}})).statusCode,403);
  const created=await fastify.inject({method:'POST',url:base,payload:input()});
  assert.equal(created.statusCode,200);
  const row=created.json();
  assert.equal(row.project_id,'p');assert.equal(row.projectIds,undefined);
  assert.deepEqual((await fastify.inject({method:'GET',url:base+'?project_id=other'})).json(),[]);
  assert.equal((await fastify.inject({method:'GET',url:base+'?project_id=p'})).json()[0].id,row.id);
  assert.equal((await fastify.inject({method:'GET',url:base+'?project_id=forbidden'})).statusCode,403);
  const path=base+'/'+row.id;
  assert.equal((await fastify.inject({method:'PUT',url:path,payload:{...row,project_id:'other'}})).statusCode,404);
  assert.equal((await fastify.inject({method:'DELETE',url:path+'?project_id=other'})).statusCode,404);
  assert.equal((await fastify.inject({method:'POST',url:path+'/discover?project_id=other'})).statusCode,404);
  assert.equal(discover.mock.callCount(),0);
  const tools=await fastify.inject({method:'POST',url:path+'/discover?project_id=p'});
  assert.equal(tools.statusCode,200);assert.equal(tools.json()[0].project,'p');
  const available=await fastify.inject({method:'GET',url:'/agentic-workflows/connections?project_id=p'});
  assert.equal(available.statusCode,200);assert.equal(available.json().find(item=>item.id!=="hellotest").id,row.id);
  assert.equal((await fastify.inject({method:'PUT',url:path,payload:{...row,enabled:false}})).statusCode,200);
  assert.deepEqual((await fastify.inject({method:'GET',url:'/agentic-workflows/connections?project_id=p'})).json().filter(item=>item.id!=="hellotest"),[]);
  assert.equal((await fastify.inject({method:'DELETE',url:path+'?project_id=p'})).statusCode,200);
});


test('custom request headers are encrypted, masked, preserved on edit, transmitted and redacted',async t=>{
  const rows=setup(t);const received=[];
  const server=http.createServer((req,res)=>{received.push(req.headers['x-tenant']);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({tenant:req.headers['x-tenant'],authorization:req.headers.authorization}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const saved=await settings.save({...input(),kind:'http',url:`http://127.0.0.1:${server.address().port}/api`,methods:['GET'],headers:{'X-Tenant':'private-tenant-value'},allowPrivateNetwork:true},null,'admin');
  assert.deepEqual(saved.headers,{'X-Tenant':''});
  assert.doesNotMatch(JSON.stringify(saved),/private-tenant-value|encryptedHeaders|ciphertext/);
  assert.doesNotMatch(JSON.stringify(rows.get(saved.id)),/private-tenant-value/);
  await settings.save({...saved,headers:{'X-Tenant':''}},saved.id,'admin');
  const preview=await settings.preview({...saved,headers:{'X-Tenant':''}},saved.id);
  assert.equal(settings.headers(preview)['X-Tenant'],'private-tenant-value');
  const result=await connections.callHttp({projectId:'p',data:{connectionId:saved.id,apiMethod:'GET'}});
  assert.deepEqual(received,['private-tenant-value']);
  assert.equal(result.data.tenant,'[REDACTED]');
  assert.equal(result.data.authorization,'[REDACTED]');
  await assert.rejects(settings.preview({...saved,project_id:'other'},saved.id),{statusCode:404});
  for (const patch of [{headers:{Host:'evil'}},{headers:{Authorization:'secret'}},{headers:{'X-Extra':'bad\nheader'}},{headers:{'X-Extra':''}},{timeoutMs:0},{timeoutMs:70001},{kind:'mcp',transport:'stdio'},{authType:'basic',secret:''}]) await assert.rejects(settings.save({...saved,...patch},saved.id,'admin'));
  await settings.save({...saved,headers:{}},saved.id,'admin');
  assert.deepEqual(settings.headers(rows.get(saved.id)),{});
});

test('draft discovery requires integration management and project access before using saved credentials',async t=>{
  const rows=setup(t);const fastify=require('fastify')();t.after(()=>fastify.close());
  fastify.decorate('authenticate',async req=>{req.user={id:'admin'};});
  fastify.decorate('requirePermission',()=>async()=>{});fastify.decorate('validate',()=>{});
  t.mock.method(require('@hellotest/platform/backend/public/projectAccess'),'getProject',async id=>{if(id!=='p')throw Object.assign(new Error('Project denied'),{statusCode:403});return{id};});
  const inspect=t.mock.method(mcp,'inspect',async({projectId,draftConnection})=>{assert.equal(projectId,'p');assert.equal(settings.credential(draftConnection),'a-test-token');return{tools:[{name:'read_status',inputSchema:{type:'object'}}],protocolVersion:'2025-11-25'};});
  await fastify.register(require('../../backend/routes/agenticWorkflows.routes'));
  const url='/agentic-workflows/admin/connections/discover';
  const discovered=await fastify.inject({method:'POST',url,payload:input()});
  assert.equal(discovered.statusCode,200);assert.equal(rows.size,0);
  assert.equal((await fastify.inject({method:'POST',url,payload:{...input(),project_id:'other'}})).statusCode,403);
  assert.equal((await fastify.inject({method:'POST',url,payload:{...input(),connection_id:'missing'}})).statusCode,404);
  assert.equal(inspect.mock.callCount(),1);
});
