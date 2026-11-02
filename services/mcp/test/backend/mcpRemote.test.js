const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../backend');
function load(name,mocks){
 const file=path.join(root,name+'.js'),original=createRequire(file),module={exports:{}};
 new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>Object.hasOwn(mocks,id)?mocks[id]:original(id),module,module.exports);
 return module.exports;
}
const actor={user:{id:'user'},projectId:'project',clientId:'worker'};
const fail=(message,statusCode=403,code='MCP_ACCESS_DENIED')=>Object.assign(new Error(message),{statusCode,code,publicMessage:message});

test('a remote context call uses the real SDK public schema over HTTP and revokes its delegated credential',async t=>{
 let incoming,revoked=0;
 const fakeDb={prepare:()=>({run:async()=>{},get:async()=>undefined,all:async()=>[]})};
 const sdk=load('mcpServer',{
  './backplane':{context:async(verified,args)=>{incoming={verified,args};return {packet:{project_id:verified.projectId,evidence:[]}};}},
  './projections':{entities:{projects:{}}},'./auth':{permit:async()=>{},fail},'./gateway':{installTransport:()=>{}},
  '@hellotest/platform/backend/src/db':fakeDb
 });
 const server=http.createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   assert.equal(req.headers.authorization,'Bearer fixture-resource-credential');
   const response=await sdk.handler.fetch(new Request('http://localhost/mcp',{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}),
    {authInfo:{token:'verified',clientId:'worker',scopes:[],extra:{actor}}});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  }catch(error){res.writeHead(500);res.end(String(error));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const previous=process.env.HELLOTEST_MCP_INTERNAL_URL;process.env.HELLOTEST_MCP_INTERNAL_URL=`http://127.0.0.1:${server.address().port}/mcp`;
 t.after(async()=>{if(previous===undefined)delete process.env.HELLOTEST_MCP_INTERNAL_URL;else process.env.HELLOTEST_MCP_INTERNAL_URL=previous;await new Promise(resolve=>server.close(resolve));await sdk.handler.close();});
 const remote=load('remote',{'./auth':{fail,issue:async(user,project,client)=>{assert.equal(user.id,'user');assert.equal(project,'project');assert.equal(client,'worker');return {id:'credential',token:'fixture-resource-credential'};}},
  '@hellotest/platform/backend/src/db':{prepare:()=>({run:async(id)=>{assert.equal(id,'credential');revoked++;}})}});
 const args={question:'Investigate checkout',app_type_id:'app',integration_id:'model',token_budget:1024,
  filters:{requested_scopes:['stories','runs'],evidence_scope:{execution_id:'run'},source_ids:['source']},
  budgets:{deadline_ms:60000,max_context_tokens:1024,max_query_cost_usd:0}};
 const result=await remote.call(actor,'hellotest_context_build',args);
 assert.equal(result.packet.project_id,'project');assert.deepEqual(incoming.args,args);assert.equal(incoming.verified.projectId,'project');assert.equal(revoked,1);
 await assert.rejects(remote.call({...actor,packetInput:{query:'private callback'}},'hellotest_context_build',args),{code:'MCP_CONFIGURATION'});
 assert.equal(revoked,1,'Rejected private callbacks must not issue a credential');
});

test('remote tool failures preserve safe domain status and revoke credentials after cancellation',async t=>{
 let revoked=0,entered;
 const started=new Promise(resolve=>entered=resolve);
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks));
  if(body.params.name==='hellotest_context_build'){entered();return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:{isError:true,content:[{type:'text',text:JSON.stringify({status_code:409,code:'MCP_STALE_PLAN',message:'The reviewed plan changed.'})}]}}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const previous=process.env.HELLOTEST_MCP_INTERNAL_URL;process.env.HELLOTEST_MCP_INTERNAL_URL=`http://127.0.0.1:${server.address().port}/mcp`;
 t.after(async()=>{if(previous===undefined)delete process.env.HELLOTEST_MCP_INTERNAL_URL;else process.env.HELLOTEST_MCP_INTERNAL_URL=previous;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const remote=load('remote',{'./auth':{fail,issue:async()=>({id:'credential',token:'fixture'})},'@hellotest/platform/backend/src/db':{prepare:()=>({run:async()=>{revoked++;}})}});
 await assert.rejects(remote.call(actor,'hellotest_operation_execute',{plan_id:'plan'}),{code:'MCP_STALE_PLAN',statusCode:409});
 assert.equal(revoked,1);
 const controller=new AbortController();const pending=remote.call(actor,'hellotest_context_build',{question:'Inspect'},controller.signal);
 await started;controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(revoked,2);
});

test('real signed remote credentials preserve host task attribution across HTTP without accepting model-selected identity',async t=>{
 const traces=require('@hellotest/platform/backend/src/utils/llmTraceContext');
 const memory=require('../../backend/contextGraph');
 const credentials=new Map(),records=[],observedTokens=[];
 const store={prepare:sql=>({run:async(...values)=>{
  if(sql.startsWith('INSERT INTO mcp_credentials'))credentials.set(values[0],{user:values[1],project:values[2],client:values[3],revoked:false});
  else if(sql.startsWith('UPDATE mcp_credentials'))credentials.get(values[0]).revoked=true;
 },get:async(id,user,project,client)=>{
  const row=credentials.get(id);return row&&!row.revoked&&row.user===user&&row.project===project&&row.client===client?{id}:undefined;
 }})};
 const auth=load('auth',{
  '@hellotest/platform/backend/src/db':store,
  '@hellotest/platform/backend/src/security/runtimeSecrets':{resolveSessionSecret:()=> 'remote-attribution-fixture-secret-32-characters'},
  '@hellotest/platform/backend/public/projectAccess':{getProject:async()=>({})},
  '@hellotest/platform/backend/services/permission.service':{hasPermission:async()=>true},
  '@hellotest/platform/backend/services/featureFlag.service':{getFeatureKeysForPermission:()=>[]},
  '@hellotest/platform/backend/services/user.service':{getUser:async id=>({id,status:'active'})}
 });
 const sdk=load('mcpServer',{
  './backplane':{context:async verified=>({packet:await memory.rememberContext(verified,{
   contract_type:'ContextPacket',project_id:verified.projectId,packet_id:'packet-'+verified.user.id,evidence:[]
  },{service:()=>({recordContext:async input=>{records.push(input);return{trace_id:'trace-'+input.user.id};}})})})},
  './projections':{entities:{projects:{}}},'./auth':{permit:async()=>{},fail},'./gateway':{installTransport:()=>{}},
  '@hellotest/platform/backend/src/db':{prepare:()=>({run:async()=>{}})}
 });
 const server=http.createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const body=JSON.parse(Buffer.concat(chunks)),token=req.headers.authorization.slice('Bearer '.length);
   observedTokens.push(auth.decode(token));
   assert.equal(Object.hasOwn(body.params.arguments,'context_attribution'),false);
   // Transport metadata cannot supersede the correlation signed by the host.
   body.params._meta.feature='forged-feature';body.params._meta.session_id='forged-session';
   const verified=await auth.authenticate(token);
   const response=await traces.run({feature:'transport-feature',task_id:'transport-task'},()=>sdk.handler.fetch(new Request('http://localhost/mcp',{
    method:'POST',headers:req.headers,body:JSON.stringify(body)
   }),{authInfo:{token:'verified',clientId:verified.clientId,scopes:[],extra:{actor:verified}}}));
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  }catch(error){res.writeHead(500);res.end(String(error));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const previous=process.env.HELLOTEST_MCP_INTERNAL_URL;process.env.HELLOTEST_MCP_INTERNAL_URL=`http://127.0.0.1:${server.address().port}/mcp`;
 t.after(async()=>{if(previous===undefined)delete process.env.HELLOTEST_MCP_INTERNAL_URL;else process.env.HELLOTEST_MCP_INTERNAL_URL=previous;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await sdk.handler.close();});
 const remote=load('remote',{'./auth':auth,'@hellotest/platform/backend/src/db':store});
 await Promise.all(['a','b'].map(key=>traces.run({feature:'ai.knowledge.assistant',session_id:'session-'+key,task_id:'task-'+key,
  request_id:'request-'+key,trace_id:'trace-'+key,actor_id:'untrusted-label',project_id:'untrusted-label',prompt:'MUST_NOT_BE_SIGNED'},()=>
  remote.call({user:{id:'user-'+key},projectId:'project-'+key,clientId:'worker'},'hellotest_context_build',{question:'Inspect checkout'}))));
 assert.equal(records.length,2);
 for(const key of ['a','b']){
  const record=records.find(item=>item.user.id==='user-'+key);
  assert.equal(record.projectId,'project-'+key);assert.equal(record.featureId,'ai.knowledge.assistant');
  assert.equal(record.sessionId,'session-'+key);assert.equal(record.taskRef,'task-'+key);assert.equal(record.traceId,'trace-'+key);
 }
 assert.ok([...credentials.values()].every(row=>row.revoked));
 assert.doesNotMatch(JSON.stringify(observedTokens),/MUST_NOT_BE_SIGNED|untrusted-label|forged-session|transport-task/);
 const external=await auth.issue({id:'user-a'},'project-a','external-host');
 assert.equal(Object.hasOwn(auth.decode(external.token),'context_attribution'),false);
 assert.equal(Object.hasOwn(await auth.authenticate(external.token),'contextAttribution'),false);
 await assert.rejects(sdk.invoke(actor,'hellotest_context_build',{question:'Inspect',context_attribution:{session_id:'another-session'}}),{code:'MCP_INVALID_ARGUMENT'});
});
