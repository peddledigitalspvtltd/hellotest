const fp=require('fastify-plugin');
const db=require('@hellotest/platform/backend/src/db');
const registry=require('./registry');
const auth=require('./auth');
const backplane=require('./backplane');
module.exports=fp(async function mcpPlugin(app){
 backplane.configure(app);
 app.addHook('onRoute',registry.register);
 const {handler,toolDefinitions}=require('./mcpServer');
 const publicUrl=process.env.HELLOTEST_MCP_PUBLIC_URL || (/^https:\/\//.test(process.env.HELLOTEST_API_PUBLIC_URL || '') ? `${process.env.HELLOTEST_API_PUBLIC_URL.replace(/\/$/,'')}/mcp` : /^https:\/\//.test(process.env.HELLOTEST_PUBLIC_URL || '') ? `${process.env.HELLOTEST_PUBLIC_URL.replace(/\/$/,'')}/api/mcp` : undefined);
 if(process.env.HELLOTEST_MCP_SIGNING_KEY&&Buffer.byteLength(process.env.HELLOTEST_MCP_SIGNING_KEY)<32)throw new Error('HELLOTEST_MCP_SIGNING_KEY must contain at least 32 bytes.');
 if(publicUrl){
  const endpoint=new URL(publicUrl);
  if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!endpoint.pathname.endsWith('/mcp'))throw new Error('HELLOTEST_MCP_PUBLIC_URL must be an HTTP(S) MCP endpoint without credentials, query or fragment.');
  if(endpoint.protocol!=='https:'&&process.env.NODE_ENV==='production')throw new Error('HELLOTEST_MCP_PUBLIC_URL must use HTTPS in production.');
 }
 const hostname=value=>{try{const url=new URL(`http://${value}`);if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)return null;return url.hostname.toLowerCase().replace(/\.$/,'');}catch{return null;}};
 const hosts=new Set((process.env.HELLOTEST_MCP_ALLOWED_HOSTS||'localhost,127.0.0.1,api,hellotest-local-api').split(',').map(value=>hostname(value.trim())).filter(Boolean));
 if(publicUrl)hosts.add(hostname(new URL(publicUrl).host));
 const origins=new Set((process.env.CORS_ORIGIN||'http://localhost:8080,http://localhost:5173').split(',').map(value=>value.trim()));
 if(publicUrl)origins.add(new URL(publicUrl).origin);
 const acceptsHost=req=>hosts.has(hostname(req.hostname));
 const acceptsOrigin=req=>!req.headers.origin||origins.has(req.headers.origin);
 let inFlight=0;const capacity=Math.min(64,Math.max(1,Number(process.env.HELLOTEST_MCP_MAX_CONCURRENT)||16));
 app.route({method:['POST','GET','DELETE'],url:'/mcp',bodyLimit:128*1024,handler:async(req,reply)=>{
  if(!acceptsHost(req))return reply.code(403).send({code:'MCP_HOST_DENIED',error:'MCP origin or host denied.',message:'Configure HELLOTEST_MCP_PUBLIC_URL for this public endpoint or add the exact server hostname to HELLOTEST_MCP_ALLOWED_HOSTS, then recreate the API container. The reverse proxy must preserve the public Host.'});
  if(!acceptsOrigin(req))return reply.code(403).send({code:'MCP_ORIGIN_DENIED',error:'MCP origin or host denied.',message:'Add the external browser client’s exact Origin to CORS_ORIGIN, then recreate the API container. Server-to-server clients may omit Origin.'});
  if(req.method!=='POST')return reply.code(405).header('Allow','POST').send({error:'This stateless MCP endpoint accepts POST only.'});
  if(inFlight>=capacity)return reply.code(429).header('Retry-After','2').send({error:'MCP capacity reached.'});
  inFlight++;const controller=new AbortController();const disconnected=()=>{if(!reply.raw.writableEnded)controller.abort();};req.raw.once('aborted',disconnected);reply.raw.once('close',disconnected);
  try{return await require('./mcpDeadline').withDeadline(async signal=>{
  let actor;try{actor=await auth.authenticate(/^Bearer\s+([^\s]+)\s*$/i.exec(req.headers.authorization||'')?.[1]);}catch(error){signal.throwIfAborted();return reply.code(error.statusCode||401).header('WWW-Authenticate','Bearer realm="HelloTest MCP"').send({code:error.code||'MCP_UNAUTHORIZED',error:error.publicMessage||'MCP authentication required.'});}
   signal.throwIfAborted();
   const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(typeof value==='string'&&!['content-length','host'].includes(name))headers.set(name,value);
   const response=await handler.fetch(new Request(publicUrl||'http://localhost/mcp',{method:'POST',headers,body:JSON.stringify(req.body),signal}),{authInfo:{token:'verified-resource-credential',clientId:actor.clientId,scopes:[],extra:{actor}}});
   const body=await response.text();signal.throwIfAborted();
   reply.code(response.status);for(const [name,value] of response.headers)if(!['content-length','transfer-encoding'].includes(name))reply.header(name,value);
   return reply.send(body);
  },{signal:controller.signal,timeoutMs:require('./contextRequest').requestTimeoutMs(req.body),timeoutMessage:'The MCP request exceeded its bounded request time.'});
  }catch(error){
   if(error.code!=='MCP_CONTEXT_TIMEOUT')throw error;
   return reply.code(504).send({jsonrpc:'2.0',id:['string','number'].includes(typeof req.body?.id)?req.body.id:null,error:{code:-32603,message:'The MCP request exceeded its bounded request time.',data:{code:'MCP_REQUEST_TIMEOUT'}}});
  }finally{inFlight--;req.raw.removeListener('aborted',disconnected);reply.raw.removeListener('close',disconnected);}
 }});
 const access=async(req,projectId)=>{await app.authenticate(req);if(req.apiKey)throw auth.fail('Use your signed-in session to manage delegated MCP access.');return auth.principal(req.user.id,projectId);};
 app.get('/agentic-workflows/mcp/server',async(req)=>{
  const actor=await access(req,req.query.project_id);await auth.permit(actor,'project.view');
  const definitions=toolDefinitions();
  return {id:'hellotest',name:'HelloTest',builtin:true,transport:'streamable-http',protocol_versions:['2026-07-28','2025-11-25','2025-06-18','2025-03-26'],endpoint:publicUrl||'/api/mcp',tools:definitions.map(item=>({name:item.name,title:item.title,description:item.description,read_only:item.annotations.readOnlyHint,input_schema:item.inputSchema,output_schema:item.outputSchema,annotations:item.annotations})),catalog_revision:registry.revision(),operation_count:registry.all().length,authentication:'Project-bound, revocable MCP credentials. OAuth federation requires deployment identity configuration.',
   client_contract:{authentication:'manual_bearer',credential_ttl_seconds:3600,project_id:actor.projectId,accept:'application/json, text/event-stream',stateless:true,standalone_get_supported:false,oauth_supported:false},
   discovery:{tools:definitions.length,resources:['hellotest://schema'],resource_templates:['hellotest://projects/{project_id}/ontology','hellotest://projects/{project_id}/graph/ontology'],prompts:['investigate_failure']}};
 });
 app.get('/agentic-workflows/mcp/status',async(req,reply)=>{
  reply.header('Cache-Control','no-store');
  return require('./mcpDeadline').withDeadline(async signal=>{
   const actor=await access(req,req.query.project_id);
   const tools=await require('./mcpServer').inspectLocal(actor,signal);
   return {status:'connected',transport:'streamable-http',protocol_version:'2026-07-28',tool_count:tools.length,catalog_revision:registry.revision(),checked_at:new Date().toISOString(),external_transport:{public_endpoint_configured:Boolean(publicUrl),request_host_allowed:acceptsHost(req),request_origin_allowed:acceptsOrigin(req)}};
  },{timeoutMs:8000,timeoutMessage:'The built-in MCP status check timed out. Retry.'});
 });
 app.get('/agentic-workflows/mcp/credentials',async(req)=>{const actor=await access(req,req.query.project_id);return db.prepare('SELECT id,client_id,expires_at,revoked_at,created_at FROM mcp_credentials WHERE user_id=? AND project_id=? ORDER BY created_at DESC LIMIT 50').all(actor.user.id,actor.projectId);});
 app.post('/agentic-workflows/mcp/credentials',async(req,reply)=>{const actor=await access(req,req.body?.project_id);const client=String(req.body?.client_id||'external-host');if(!/^[A-Za-z0-9._ -]{1,80}$/.test(client))throw auth.fail('Enter a valid host label.',400);reply.header("Cache-Control","no-store");return auth.issue(actor.user,actor.projectId,client+'-'+require('node:crypto').randomUUID());});
 app.delete('/agentic-workflows/mcp/credentials/:id',async(req)=>{const actor=await access(req,req.query.project_id);await db.prepare('UPDATE mcp_credentials SET revoked_at=NOW() WHERE id=? AND user_id=? AND project_id=?').run(req.params.id,actor.user.id,actor.projectId);return {revoked:true};});
 app.get('/agentic-workflows/mcp/plans',async(req)=>{const actor=await access(req,req.query.project_id);const rows=await db.prepare('SELECT id,client_id,operation_id,arguments,digest,state,expires_at,receipt,created_at FROM mcp_action_plans WHERE user_id=? AND project_id=? ORDER BY created_at DESC LIMIT 50').all(actor.user.id,actor.projectId);return rows.map(row=>{const op=registry.all().find(item=>item.id===row.operation_id);return {...row,operation:op?{method:op.method,path:op.path,permission:op.permission}:{method:'Unavailable',path:'Catalog changed',permission:null}};});});
 app.post('/agentic-workflows/mcp/plans/:id/authorize',async(req)=>{
  const actor=await access(req,req.body?.project_id);
  return db.transaction(async()=>{
   const row=await db.prepare('SELECT * FROM mcp_action_plans WHERE id=? AND user_id=? AND project_id=? FOR UPDATE').get(req.params.id,actor.user.id,actor.projectId);
   if(!row||row.state!=='requires_authorization'||row.digest!==req.body.digest||row.digest!==backplane.planDigest(row)||new Date(row.expires_at)<=new Date()||row.catalog_revision!==registry.revision())throw auth.fail('The reviewed plan is stale or unavailable.',409,'MCP_STALE_PLAN');
   await auth.permit(actor,registry.get(row.operation_id).permission);
   await backplane.verifyPlanTargets(actor,row);
   await db.prepare("UPDATE mcp_action_plans SET state='authorized',approved_at=NOW(),updated_at=NOW() WHERE id=?").run(row.id);
   await db.prepare('INSERT INTO mcp_audit_events(project_id,user_id,client_id,tool,outcome,plan_id) VALUES (?,?,?,?,?,?)').run(actor.projectId,actor.user.id,row.client_id,'authorize_plan','authorized',row.id);
   return {plan_id:row.id,state:'authorized',digest:row.digest};
  })();
 });
 app.addHook('onClose',async()=>{await handler.close();await require('./readDatabase').close();});
});
