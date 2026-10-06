const test=require('node:test');
const assert=require('node:assert/strict');
test('real PostgreSQL and SDK isolate two actors, execute a reviewed plan once, and honor revocation',{skip:process.env.MCP_POSTGRES_TEST!=='1',timeout:90000},async()=>{
 assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/agent_verify_mcp_[0-9]+$/);
 const db=require('../../src/db'),obsDb=require('../../src/obsDb');let app;
 try{
  await require('../../src/migrate').migrate();
  await db.query("INSERT INTO roles(id,name) VALUES ('mcp-fixture-role','MCP Fixture')");
  await db.query("INSERT INTO role_permissions(role_id,permission_id) SELECT 'mcp-fixture-role',id FROM permissions WHERE code IN ('project.view','app_type.view','testcase.view','testcase.create','knowledge.view','agentic_workflow.view')");
  await db.query("INSERT INTO users(id,email,password_hash,name,default_role_id) VALUES ('mcp-a','mcp-a@example.test','unused','A','mcp-fixture-role'),('mcp-b','mcp-b@example.test','unused','B','mcp-fixture-role')");
  await db.query("INSERT INTO projects(id,name,visibility,created_by) VALUES ('mcp-p-a','Project A','private','mcp-a'),('mcp-p-b','Project B','private','mcp-b')");
  await db.query("INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('mcp-aa','mcp-p-a','mcp-a','mcp-fixture-role'),('mcp-ab','mcp-p-b','mcp-a','mcp-fixture-role'),('mcp-bb','mcp-p-b','mcp-b','mcp-fixture-role')");
  await db.query("INSERT INTO app_types(id,project_id,name,type) VALUES ('mcp-app-a','mcp-p-a','Web A','web'),('mcp-app-b','mcp-p-b','Web B','web')");
  await db.query("INSERT INTO test_cases(id,app_type_id,title) VALUES ('mcp-case-a','mcp-app-a','A visible case'),('mcp-case-b','mcp-app-b','B private case')");
  await db.query("INSERT INTO ai_knowledge_sources(id,project_id,source_kind,title,extraction_status,required_permission,revision_token) VALUES ('mcp-source','mcp-p-a','text','Release rule','ready',NULL,'fixture')");
  await db.query("INSERT INTO ai_knowledge_documents(id,project_id,source_id,title,content,checksum_sha256) VALUES ('mcp-document','mcp-p-a','mcp-source','Release rule','Release requires passing tests','fixture')");
  await db.query("INSERT INTO ai_knowledge_chunks(id,project_id,document_id,source_id,chunk_index,content,search_vector) VALUES ('mcp-fragment','mcp-p-a','mcp-document','mcp-source',0,'Release requires passing tests',to_tsvector('simple','Release requires passing tests'))");
  await db.query("INSERT INTO ai_knowledge_index_states(document_id,project_id,source_id,document_version,is_current,lexical_state,dense_state,required_indexes_ready) VALUES ('mcp-document','mcp-p-a','mcp-source',1,TRUE,'ready','not_configured',TRUE)");
  await db.query("INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,principal_type,principal_id,effect,inherited) VALUES ('mcp-binding','mcp-p-a','mcp-source','PROJECT','mcp-p-a','ALLOW',TRUE)");
  const Fastify=require('fastify');app=Fastify({logger:false});
  app.register(require('../../src/plugins/errorHandler'));app.register(require('../../src/plugins/validator'));app.register(require('../../src/plugins/accessControl'));app.register(require('../../src/plugins/mcp'));app.register(require('../../src/routes'));
  await app.ready();
  const {createToken}=require('../../src/utils/token');
  const webToken=createToken({id:'mcp-a'}),headers={authorization:'Bearer '+webToken};
  const issued=await app.inject({method:'POST',url:'/agentic-workflows/mcp/credentials',headers,payload:{project_id:'mcp-p-a'}});
  assert.equal(issued.statusCode,200,issued.body);assert.equal(issued.headers['cache-control'],'no-store');const credential=issued.json();
  const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
  const rpc=async(name,args={},token=credential.token,extra={})=>{
   const response=await app.inject({method:'POST',url:'/mcp',headers:{host:'localhost',authorization:'Bearer '+token,accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':name,...extra},payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args,_meta:meta}}});
   return {response,result:response.statusCode===200?response.json().result:null};
  };
  const {result:catalog}=await rpc('hellotest_capabilities',{query:'test-cases',limit:50});assert.equal(catalog.isError,undefined);const ops=catalog.structuredContent.data.operations;
  const read=ops.find(op=>op.method==='GET'&&op.path==='/test-cases/:id');const create=ops.find(op=>op.method==='POST'&&op.path==='/test-cases');assert.ok(read&&create);assert.equal(create.input_schema.body.properties.title.type,'string');
  const valid=await rpc('hellotest_operation_read',{operation_id:read.id,arguments:{path:{id:'mcp-case-a'}}});assert.equal(valid.result.isError,undefined,JSON.stringify(valid.result));assert.equal(valid.result.structuredContent.data.data.title,'A visible case');
  const cross=await rpc('hellotest_operation_read',{operation_id:read.id,arguments:{path:{id:'mcp-case-b'}}});assert.equal(cross.result.isError,true);assert.ok(!JSON.stringify(cross.result).includes('B private case'));
  const projection=await rpc('hellotest_database_query',{entity:'test_cases',fields:['id','title']});assert.deepEqual(projection.result.structuredContent.data.rows.map(row=>row.id),['mcp-case-a']);
  const fragment=await rpc('hellotest_knowledge_fetch',{fragment_id:'mcp-fragment'});assert.equal(fragment.result.isError,undefined,JSON.stringify(fragment.result));assert.equal(fragment.result.structuredContent.data.fragment.content,'Release requires passing tests');
  await db.query("UPDATE ai_knowledge_security_bindings SET effect='DENY' WHERE id='mcp-binding'");const deniedFragment=await rpc('hellotest_knowledge_fetch',{fragment_id:'mcp-fragment'});assert.equal(deniedFragment.result.isError,true);assert.ok(!JSON.stringify(deniedFragment.result).includes('Release requires passing tests'));await db.query("UPDATE ai_knowledge_security_bindings SET effect='ALLOW' WHERE id='mcp-binding'");
  const historical=await rpc('hellotest_knowledge_fetch',{fragment_id:'mcp-fragment',as_of:new Date().toISOString()});assert.equal(historical.result.isError,true);
  const otherApplication=await rpc('hellotest_context_build',{question:'Show app context',app_type_id:'mcp-app-b'});assert.equal(otherApplication.result.isError,true);
  const context=await rpc('hellotest_context_build',{question:'What test cases are available?',token_budget:1000});assert.equal(context.result.isError,undefined,JSON.stringify(context.result));assert.equal(context.result.structuredContent.data.context_transport,'mcp');assert.ok(Array.isArray(context.result.structuredContent.data.packet.evidence));assert.ok(!JSON.stringify(context.result).includes('B private case'));
  const smartPacket=await require('../../src/mcp/gateway').retrievePacket({user:{id:'mcp-a'},projectId:'mcp-p-a',query:'What tests are available?',budgets:{max_context_tokens:1000,deadline_ms:3000,max_tool_calls:4}});assert.ok(Array.isArray(smartPacket.evidence));assert.ok(!JSON.stringify(smartPacket).includes('B private case'));
  const listening=await app.listen({host:'127.0.0.1',port:0});process.env.HELLOTEST_MCP_INTERNAL_URL=listening+'/mcp';
  try{const remoteActor=await require('../../src/mcp/auth').principal('mcp-a','mcp-p-a','worker-fixture');const remoteCatalog=await require('../../src/mcp/server').callLocal(remoteActor,'hellotest_capabilities',{query:'test-cases',limit:5});assert.ok(remoteCatalog.operations.length);const remaining=await db.prepare("SELECT COUNT(*)::int AS count FROM mcp_credentials WHERE client_id='worker-fixture' AND revoked_at IS NULL").get();assert.equal(remaining.count,0);}finally{delete process.env.HELLOTEST_MCP_INTERNAL_URL;}
  const forged=await rpc('hellotest_database_query',{entity:'test_cases',sql:'SELECT * FROM users'});assert.equal(forged.result.isError,true);
  assert.equal((await rpc('hellotest_capabilities',{},webToken)).response.statusCode,401);
  assert.equal((await rpc('hellotest_capabilities',{},credential.token,{origin:'https://evil.example'})).response.statusCode,403);
  assert.equal((await rpc('hellotest_capabilities',{},credential.token,{host:'evil.example'})).response.statusCode,403);
  const prepare=await rpc('hellotest_operation_prepare',{operation_id:create.id,arguments:{body:{app_type_id:'mcp-app-a',title:'Created through reviewed MCP'}}});const plan=prepare.result.structuredContent.data;assert.equal(plan.state,'requires_authorization');
  const blocked=await rpc('hellotest_operation_execute',{plan_id:plan.plan_id});assert.equal(blocked.result.structuredContent.data.state,'requires_authorization');
  const approve=await app.inject({method:'POST',url:`/agentic-workflows/mcp/plans/${plan.plan_id}/authorize`,headers,payload:{project_id:'mcp-p-a',digest:plan.digest}});assert.equal(approve.statusCode,200,approve.body);
  const [one,two]=await Promise.all([rpc('hellotest_operation_execute',{plan_id:plan.plan_id}),rpc('hellotest_operation_execute',{plan_id:plan.plan_id})]);
  assert.ok([one,two].some(item=>item.result.structuredContent.data.state==='succeeded_verified'),JSON.stringify([one,two].map(item=>item.result)));
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM test_cases WHERE title=?').get('Created through reviewed MCP')).count,1);
  const uncertain=await rpc('hellotest_operation_prepare',{operation_id:create.id,arguments:{body:{app_type_id:'mcp-app-a',title:'Uncertain receipt fixture'}}});const uncertainPlan=uncertain.result.structuredContent.data;
  const uncertainApproval=await app.inject({method:'POST',url:`/agentic-workflows/mcp/plans/${uncertainPlan.plan_id}/authorize`,headers,payload:{project_id:'mcp-p-a',digest:uncertainPlan.digest}});assert.equal(uncertainApproval.statusCode,200);
  const actualInject=app.inject.bind(app);app.inject=async options=>{const response=await actualInject(options);if(options.method==='POST'&&options.url.startsWith('/test-cases?'))throw new Error('Fixture loses receipt after committed create');return response;};
  try{const unknown=await rpc('hellotest_operation_execute',{plan_id:uncertainPlan.plan_id});assert.equal(unknown.result.structuredContent.data.state,'unknown');const repeated=await rpc('hellotest_operation_execute',{plan_id:uncertainPlan.plan_id});assert.equal(repeated.result.structuredContent.data.state,'unknown');assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM test_cases WHERE title=?').get('Uncertain receipt fixture')).count,1);}finally{app.inject=actualInject;}
  const userB=require('../../src/mcp/auth');const b=await userB.issue({id:'mcp-b'},'mcp-p-b');const wrong=await rpc('hellotest_operation_status',{plan_id:plan.plan_id},b.token);assert.equal(wrong.result.isError,true);
  await db.query("UPDATE users SET status='suspended' WHERE id='mcp-a'");assert.equal((await rpc('hellotest_capabilities')).response.statusCode,403);await db.query("UPDATE users SET status='active' WHERE id='mcp-a'");
  await app.inject({method:'DELETE',url:`/agentic-workflows/mcp/credentials/${credential.id}?project_id=mcp-p-a`,headers});assert.equal((await rpc('hellotest_capabilities')).response.statusCode,401);
 }finally{await app?.close();await require('../../src/utils/cache').close();await Promise.allSettled([db.close(),obsDb.close()]);}
});
