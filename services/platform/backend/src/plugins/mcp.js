const fp=require('fastify-plugin');
const db=require('../db');
const registry=require('../mcp/registry');
const auth=require('../mcp/auth');
const backplane=require('../mcp/backplane');
module.exports=fp(async function mcpPlugin(app){
 backplane.configure(app);
 app.addHook('onRoute',registry.register);
 const {handler,tools}=require('../mcp/server');
 const publicUrl=process.env.HELLOTEST_MCP_PUBLIC_URL;
 if(process.env.HELLOTEST_MCP_SIGNING_KEY&&Buffer.byteLength(process.env.HELLOTEST_MCP_SIGNING_KEY)<32)throw new Error('HELLOTEST_MCP_SIGNING_KEY must contain at least 32 bytes.');
 if(publicUrl&&(!/^https:\/\//.test(publicUrl)&&process.env.NODE_ENV==='production'))throw new Error('HELLOTEST_MCP_PUBLIC_URL must use HTTPS in production.');
 const hosts=new Set((process.env.HELLOTEST_MCP_ALLOWED_HOSTS||'localhost,127.0.0.1,api,hellotest-local-api').split(',').map(value=>value.trim()));
 if(publicUrl)hosts.add(new URL(publicUrl).hostname);
 const origins=new Set((process.env.CORS_ORIGIN||'http://localhost:8080,http://localhost:5173').split(',').map(value=>value.trim()));
 let inFlight=0;const capacity=Math.min(64,Math.max(1,Number(process.env.HELLOTEST_MCP_MAX_CONCURRENT)||16));
 app.route({method:['POST','GET','DELETE'],url:'/mcp',bodyLimit:128*1024,handler:async(req,reply)=>{
  if(!hosts.has(req.hostname)||req.headers.origin&&!origins.has(req.headers.origin))return reply.code(403).send({error:'MCP origin or host denied.'});
  if(req.method!=='POST')return reply.code(405).header('Allow','POST').send({error:'This stateless MCP endpoint accepts POST only.'});
  if(inFlight>=capacity)return reply.code(429).header('Retry-After','2').send({error:'MCP capacity reached.'});
  let actor;try{actor=await auth.authenticate(/^Bearer (.+)$/i.exec(req.headers.authorization||'')?.[1]);}catch(error){return reply.code(error.statusCode||401).header('WWW-Authenticate','Bearer realm="HelloTest MCP"').send({error:error.publicMessage||'MCP authentication required.'});}
  // Authentication awaits database reads; check again before claiming capacity.
  if(inFlight>=capacity)return reply.code(429).header('Retry-After','2').send({error:'MCP capacity reached.'});
  inFlight++;const controller=new AbortController();const disconnected=()=>{if(!reply.raw.writableEnded)controller.abort();};req.raw.once('aborted',disconnected);reply.raw.once('close',disconnected);
  try{
   const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(typeof value==='string'&&!['content-length','host'].includes(name))headers.set(name,value);
   const response=await handler.fetch(new Request(publicUrl||'http://localhost/mcp',{method:'POST',headers,body:JSON.stringify(req.body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])}),{authInfo:{token:'verified-resource-credential',clientId:actor.clientId,scopes:[],extra:{actor}}});
   reply.code(response.status);for(const [name,value] of response.headers)if(!['content-length','transfer-encoding'].includes(name))reply.header(name,value);
   return reply.send(await response.text());
  }finally{inFlight--;req.raw.removeListener('aborted',disconnected);reply.raw.removeListener('close',disconnected);}
 }});
 const access=async(req,projectId)=>{await app.authenticate(req);if(req.apiKey)throw auth.fail('Use your signed-in session to manage delegated MCP access.');return auth.principal(req.user.id,projectId);};
 app.get('/agentic-workflows/mcp/server',async(req)=>{
  const actor=await access(req,req.query.project_id);await auth.permit(actor,'project.view');
  return {id:'hellotest',name:'HelloTest',builtin:true,transport:'streamable-http',protocol_versions:['2026-07-28','2025-11-25','2025-06-18','2025-03-26'],endpoint:publicUrl||'/api/mcp',tools:Object.entries(tools).map(([name,item])=>({name,description:item.description,read_only:!item.write})),catalog_revision:registry.revision(),operation_count:registry.all().length,authentication:'Project-bound, revocable MCP credentials. OAuth federation requires deployment identity configuration.'};
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
   await db.prepare("UPDATE mcp_action_plans SET state='authorized',approved_at=NOW(),updated_at=NOW() WHERE id=?").run(row.id);
   await db.prepare('INSERT INTO mcp_audit_events(project_id,user_id,client_id,tool,outcome,plan_id) VALUES (?,?,?,?,?,?)').run(actor.projectId,actor.user.id,row.client_id,'authorize_plan','authorized',row.id);
   return {plan_id:row.id,state:'authorized',digest:row.digest};
  })();
 });
 app.addHook('onClose',async()=>{await handler.close();await require('../mcp/readDatabase').close();});
});
