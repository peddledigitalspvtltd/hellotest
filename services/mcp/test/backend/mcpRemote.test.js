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

test('a remote context call uses the real SDK public schema over HTTP with one narrowly scoped credential for the turn',async t=>{
 let incoming,revoked=0,issued=0;
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
 const remote=load('remote',{'./auth':{fail,issue:async(user,project,client,options)=>{
   assert.equal(user.id,'user');assert.equal(project,'project');assert.equal(client,'worker');
   // Retrieval needs the read-only knowledge set and nothing else; the credential is the platform's own and short-lived.
   assert.deepEqual(options.scopes,['knowledge']);assert.equal(options.internal,true);assert.equal(options.ttlSeconds,180);
   issued++;return {id:'credential',token:'fixture-resource-credential'};}},
  '@hellotest/platform/backend/src/db':{prepare:()=>({run:async(id)=>{assert.equal(id,'credential');revoked++;}})}});
 const args={question:'Investigate checkout',app_type_id:'app',integration_id:'model',token_budget:1024,
  filters:{requested_scopes:['stories','runs'],evidence_scope:{execution_id:'run'},source_ids:['source']},
  budgets:{deadline_ms:60000,max_context_tokens:1024,max_query_cost_usd:0}};
 const result=await remote.call(actor,'hellotest_context_build',args);
 assert.equal(result.packet.project_id,'project');assert.deepEqual(incoming.args,args);assert.equal(incoming.verified.projectId,'project');assert.equal(issued,1);assert.equal(revoked,0,'the credential is not revoked per call');
 // There is no private callback channel any more: a forged field on the actor is inert and
 // only the audited public arguments reach the host.
 await remote.call({...actor,packetInput:{query:'private callback'},retrievalInput:{request:{query:'private callback'}}},'hellotest_context_build',args);
 assert.deepEqual(incoming.args,args);assert.ok(!JSON.stringify(incoming).includes('private callback'));
 assert.equal(issued,1,'the second call of the turn reuses the credential');
 assert.equal(await remote.release(),1);assert.equal(revoked,1,'release revokes what the process still holds');
});

test('remote tool failures preserve safe domain status, and a cancelled call leaves a credential that release revokes',async t=>{
 let revokedIds=[],issuedScopes=[],entered;
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
 const remote=load('remote',{'./auth':{fail,issue:async(_user,_project,_client,options)=>{issuedScopes.push(options.scopes);return {id:'credential-'+issuedScopes.length,token:'fixture'};}},'@hellotest/platform/backend/src/db':{prepare:()=>({run:async(id)=>{revokedIds.push(id);}})}});
 await assert.rejects(remote.call(actor,'hellotest_operation_execute',{plan_id:'plan'}),{code:'MCP_STALE_PLAN',statusCode:409});
 assert.deepEqual(issuedScopes,[['records','actions']],'executing a reviewed plan needs the actions set, which brings discovery with it');
 assert.deepEqual(revokedIds,[],'a failure does not revoke the turn\'s credential');
 const controller=new AbortController();const pending=remote.call(actor,'hellotest_context_build',{question:'Inspect'},controller.signal);
 await started;controller.abort();await assert.rejects(pending,{name:'AbortError'});
 assert.deepEqual(issuedScopes,[['records','actions'],['knowledge']],'a retrieval call is scoped to knowledge, not to what the previous call needed');
 assert.deepEqual(revokedIds,[]);
 assert.equal(await remote.release(),2);assert.deepEqual(revokedIds.sort(),['credential-1','credential-2']);
});

test('real signed remote credentials preserve host task attribution across HTTP without accepting model-selected identity',async t=>{
 const traces=require('@hellotest/platform/backend/src/utils/llmTraceContext');
  const memory=require('../../backend/contextTraceTools');
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
 // Each turn holds one internal, read-only, short-lived credential; releasing revokes them.
 assert.equal(credentials.size,2);assert.ok([...credentials.values()].every(row=>!row.revoked));
 assert.deepEqual(observedTokens.map(claims=>claims.scp),[['knowledge'],['knowledge']]);
 assert.ok(observedTokens.every(claims=>claims.int===true&&claims.exp-claims.iat===180));
 assert.equal(await remote.release(),2);
 assert.ok([...credentials.values()].every(row=>row.revoked));
 assert.doesNotMatch(JSON.stringify(observedTokens),/MUST_NOT_BE_SIGNED|untrusted-label|forged-session|transport-task/);
 const external=await auth.issue({id:'user-a'},'project-a','external-host');
 assert.equal(Object.hasOwn(auth.decode(external.token),'context_attribution'),false);
 assert.equal(Object.hasOwn(await auth.authenticate(external.token),'contextAttribution'),false);
 await assert.rejects(sdk.invoke(actor,'hellotest_context_build',{question:'Inspect',context_attribution:{session_id:'another-session'}}),{code:'MCP_INVALID_ARGUMENT'});
});

// --- one credential per turn --------------------------------------------------------------------------------

async function turnHarness(t,{respond,issueError}={}){
 const tokens=new Map(),issued=[],seen=[],revoked=[];
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks)),token=req.headers.authorization.slice('Bearer '.length);
  seen.push({token,name:body.params.name});
  const custom=respond?.(token,seen);
  res.setHeader('Content-Type','application/json');
  if(custom){res.statusCode=custom.status;res.end(JSON.stringify(custom.body));return;}
  const owner=tokens.get(token);
  res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:{structuredContent:{scope:{project_id:owner.project,subject:owner.user},data:{ok:true,token}}}}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const previous=process.env.HELLOTEST_MCP_INTERNAL_URL;process.env.HELLOTEST_MCP_INTERNAL_URL=`http://127.0.0.1:${server.address().port}/mcp`;
 t.after(async()=>{if(previous===undefined)delete process.env.HELLOTEST_MCP_INTERNAL_URL;else process.env.HELLOTEST_MCP_INTERNAL_URL=previous;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const issue=async(user,project,client,options)=>{
  if(issueError?.(issued.length))throw fail('This account is unavailable.');
  const token='token-'+(issued.length+1);tokens.set(token,{user:user.id,project});issued.push({user:user.id,project,client,options,token});return {id:'credential-'+issued.length,token};
 };
 const remote=load('remote',{'./auth':{fail,issue},'@hellotest/platform/backend/src/db':{prepare:()=>({run:async(id)=>{revoked.push(id);}})}});
 return {remote,issued,seen,revoked};
}
const worker=(user='user-1',projectId='project')=>({user:{id:user},projectId,clientId:'worker'});
const turnCall=(remote,who,name='hellotest_context_build')=>remote.call(who,name,{question:'Inspect'});

test('one credential serves every call of a turn; users, projects, tool sets and turns never share one',async t=>{
 const traces=require('@hellotest/platform/backend/src/utils/llmTraceContext');
 const attribution=require('../../backend/contextAttribution');
 const {remote,issued,seen}=await turnHarness(t);
 const first=worker('user-1');
 for(let index=0;index<3;index++)await turnCall(remote,first);
 assert.equal(issued.length,1,'three sequential calls, one credential');
 // The planner and the first read run together: concurrent calls of a new turn share one issuance.
 const second=worker('user-2');
 const results=await Promise.all([1,2,3,4].map(()=>turnCall(remote,second)));
 assert.equal(issued.length,2);assert.ok(results.every(result=>result.token==='token-2'));
 await turnCall(remote,first,'hellotest_operation_execute');assert.equal(issued.length,3,'another tool set is another credential');
 await turnCall(remote,worker('user-1','other-project'));assert.equal(issued.length,4,'another project is another credential');
 const turn=labels=>traces.run(labels,()=>turnCall(remote,first));
 await turn({session_id:'session-1',task_id:'task-1'});assert.equal(issued.length,5);
 await turn({session_id:'session-1',task_id:'task-1'});assert.equal(issued.length,5,'the same turn reuses its credential');
 await turn({session_id:'session-1',task_id:'task-2'});assert.equal(issued.length,6,'a different turn does not');
 assert.deepEqual(issued[4].options.contextAttribution,attribution.select({session_id:'session-1',task_id:'task-1'}));
 assert.ok(issued.every(item=>item.options.internal===true&&item.options.ttlSeconds===180));
 assert.deepEqual(issued.map(item=>item.options.scopes),[['knowledge'],['knowledge'],['records','actions'],['knowledge'],['knowledge'],['knowledge']]);
 assert.equal(seen.length,3+4+1+1+3);
});

test('a credential that could not be issued is not remembered',async t=>{
 let attempts=0;
 const {remote,issued}=await turnHarness(t,{issueError:()=>++attempts===1});
 await assert.rejects(turnCall(remote,worker()),{code:'MCP_ACCESS_DENIED'});
 assert.equal(issued.length,0);
 assert.equal((await turnCall(remote,worker())).ok,true,'the next call tries again');
 assert.equal(issued.length,1);
});

test('a credential that stops working mid-turn is replaced once, and a second refusal is an error, not a loop',async t=>{
 const {remote,issued,seen}=await turnHarness(t,{respond:token=>token==='token-1'?{status:401,body:{code:'MCP_UNAUTHORIZED',error:'MCP credential revoked or expired.'}}:null});
 const result=await turnCall(remote,worker());
 assert.equal(result.token,'token-2');assert.deepEqual(seen.map(item=>item.token),['token-1','token-2']);assert.equal(issued.length,2);
 assert.equal((await turnCall(remote,worker())).token,'token-2','the replacement is the turn\'s credential from now on');
 assert.equal(issued.length,2);
});

test('persistent authentication failure stops after one retry with a safe error',async t=>{
 const {remote,issued,seen}=await turnHarness(t,{respond:()=>({status:401,body:{code:'MCP_UNAUTHORIZED',error:'private detail'}})});
 await assert.rejects(turnCall(remote,worker()),error=>error.code==='MCP_TOOL_FAILED'&&error.statusCode===502&&!/private detail/.test(error.message));
 assert.equal(issued.length,2);assert.equal(seen.length,2);
});

test('a credential near its expiry is replaced rather than reused',async t=>{
 const {remote,issued}=await turnHarness(t);
 await turnCall(remote,worker());assert.equal(issued.length,1);
 const real=Date.now;t.after(()=>{Date.now=real;});
 Date.now=()=>real()+100_000;await turnCall(remote,worker());assert.equal(issued.length,1,'well inside its lifetime');
 Date.now=()=>real()+170_000;await turnCall(remote,worker());assert.equal(issued.length,2,'inside the last twenty seconds of its 180');
});

test('a tool in no set, or a misconfigured endpoint, is refused before any credential exists',async t=>{
 const {remote,issued,seen}=await turnHarness(t);
 await assert.rejects(turnCall(remote,worker(),'not_a_tool'),{code:'MCP_TOOL_NOT_FOUND',statusCode:404});
 await assert.rejects(turnCall(remote,worker(),'hellotest_graph_expand'),{code:'MCP_TOOL_NOT_FOUND'});
 process.env.HELLOTEST_MCP_INTERNAL_URL='http://user:password@127.0.0.1:1/mcp';
 await assert.rejects(turnCall(remote,worker()),{code:'MCP_CONFIGURATION',statusCode:500});
 assert.equal(issued.length,0);assert.equal(seen.length,0);
});

test('releasing revokes every held credential and the next call starts a new one',async t=>{
 const {remote,issued,revoked}=await turnHarness(t);
 await turnCall(remote,worker('user-1'));await turnCall(remote,worker('user-2'));
 assert.equal(await remote.release(),2);assert.deepEqual(revoked.sort(),['credential-1','credential-2']);
 assert.equal(await remote.release(),0,'nothing is revoked twice');
 await turnCall(remote,worker('user-1'));assert.equal(issued.length,3);
});
