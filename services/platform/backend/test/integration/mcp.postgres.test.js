const test=require('node:test');
const assert=require('node:assert/strict');
test('real PostgreSQL and SDK isolate two actors, execute a reviewed plan once, and honor revocation',{skip:process.env.MCP_POSTGRES_TEST!=='1',timeout:90000},async()=>{
 assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/agent_verify_mcp_[0-9]+$/);
 const db=require('../../src/db'),obsDb=require('../../src/obsDb');let app;
 try{
  await require('../../src/migrate').migrate();
  await db.query("INSERT INTO roles(id,name) VALUES ('mcp-fixture-role','MCP Fixture')");
  await db.query("INSERT INTO role_permissions(role_id,permission_id) SELECT 'mcp-fixture-role',id FROM permissions WHERE code IN ('project.view','app_type.view','testcase.view','testcase.create','knowledge.view','agentic_workflow.view','environment.view','configuration.view','requirement.view','requirement.create','requirement.update','feedback.view','feedback.create')");
  await db.query("INSERT INTO users(id,email,password_hash,name,default_role_id) VALUES ('mcp-a','mcp-a@example.test','unused','A','mcp-fixture-role'),('mcp-b','mcp-b@example.test','unused','B','mcp-fixture-role')");
  await db.query("INSERT INTO projects(id,name,visibility,created_by) VALUES ('mcp-p-a','Project A','private','mcp-a'),('mcp-p-b','Project B','private','mcp-b')");
  await db.query("INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('mcp-aa','mcp-p-a','mcp-a','mcp-fixture-role'),('mcp-ab','mcp-p-b','mcp-a','mcp-fixture-role'),('mcp-bb','mcp-p-b','mcp-b','mcp-fixture-role')");
  await db.query("INSERT INTO app_types(id,project_id,name,type) VALUES ('mcp-app-a','mcp-p-a','Web A','web'),('mcp-app-b','mcp-p-b','Web B','web')");
  await db.query("INSERT INTO test_environments(id,project_id,name,variables) VALUES ('mcp-env-a','mcp-p-a','Environment A','[{\"name\":\"CUSTOM_VALUE\",\"value\":\"private-variable\"}]'),('mcp-env-b','mcp-p-b','Environment B','[]')");
  await db.query("INSERT INTO test_configurations(id,project_id,name) VALUES ('mcp-config-a','mcp-p-a','Configuration A'),('mcp-config-b','mcp-p-b','Configuration B')");
  await db.query("INSERT INTO test_cases(id,app_type_id,title) VALUES ('mcp-case-a','mcp-app-a','A visible case'),('mcp-case-b','mcp-app-b','B private case')");
  await db.query("INSERT INTO ai_knowledge_sources(id,project_id,source_kind,title,extraction_status,required_permission,revision_token) VALUES ('mcp-source','mcp-p-a','text','Release rule','ready',NULL,'fixture')");
  await db.query("INSERT INTO ai_knowledge_documents(id,project_id,source_id,title,content,checksum_sha256) VALUES ('mcp-document','mcp-p-a','mcp-source','Release rule','Release requires passing tests','fixture')");
  await db.query("INSERT INTO ai_knowledge_chunks(id,project_id,document_id,source_id,chunk_index,content,search_vector) VALUES ('mcp-fragment','mcp-p-a','mcp-document','mcp-source',0,'Release requires passing tests',to_tsvector('simple','Release requires passing tests'))");
  await db.query("INSERT INTO ai_knowledge_index_states(document_id,project_id,source_id,document_version,is_current,lexical_state,dense_state,required_indexes_ready) VALUES ('mcp-document','mcp-p-a','mcp-source',1,TRUE,'ready','not_configured',TRUE)");
  await db.query("INSERT INTO ai_knowledge_security_bindings(id,project_id,source_id,principal_type,principal_id,effect,inherited) VALUES ('mcp-binding','mcp-p-a','mcp-source','PROJECT','mcp-p-a','ALLOW',TRUE)");
  const Fastify=require('fastify');app=Fastify({logger:false});
  app.register(require('../../src/plugins/errorHandler'));app.register(require('../../src/plugins/validator'));app.register(require('../../src/plugins/accessControl'));app.register(require('@hellotest/mcp/backend/plugin'));app.register(require('../../src/routes'));
  await app.ready();
  const {createToken}=require('../../src/utils/token');
  await require('./aiConfiguration.fixture').verify({app,db,obsDb,createToken});
  await require('./metricGovernance.fixture').verify({app,db,createToken});
  const webToken=createToken({id:'mcp-a'}),headers={authorization:'Bearer '+webToken};
  const issued=await app.inject({method:'POST',url:'/agentic-workflows/mcp/credentials',headers,payload:{project_id:'mcp-p-a'}});
  assert.equal(issued.statusCode,200,issued.body);assert.equal(issued.headers['cache-control'],'no-store');const credential=issued.json();
  const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
  const rpc=async(name,args={},token=credential.token,extra={})=>{
   const response=await app.inject({method:'POST',url:'/mcp',headers:{host:'localhost',authorization:'Bearer '+token,accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':name,...extra},payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args,_meta:meta}}});
   return {response,result:response.statusCode===200?response.json().result:null};
  };
  const builtinStatus=await app.inject({method:'GET',url:'/agentic-workflows/mcp/status?project_id=mcp-p-a',headers});assert.equal(builtinStatus.statusCode,200,builtinStatus.body);assert.equal(builtinStatus.json().status,'connected');assert.equal(builtinStatus.headers['cache-control'],'no-store');
  assert.equal((await app.inject({method:'GET',url:'/agentic-workflows/mcp/status?project_id=mcp-p-a',headers:{authorization:'Bearer '+credential.token}})).statusCode,401);
  const applicationProjection=await rpc('hellotest_database_query',{entity:'applications',fields:['id','name']});assert.deepEqual(applicationProjection.result.structuredContent.data.rows.map(row=>row.id),['mcp-app-a']);
  for(const [path,own,foreign] of [['/app-types/:id','mcp-app-a','mcp-app-b'],['/test-environments/:id','mcp-env-a','mcp-env-b'],['/test-configurations/:id','mcp-config-a','mcp-config-b']]){
   const {result:recordCatalog}=await rpc('hellotest_capabilities',{limit:50,query:path});
   const operation=recordCatalog.structuredContent.data.operations.find(op=>op.path===path&&op.method==='GET');assert.ok(operation,path);
   const allowed=await rpc('hellotest_operation_read',{operation_id:operation.id,arguments:{path:{id:own}}});assert.equal(allowed.result.isError,undefined,JSON.stringify(allowed.result));assert.ok(!JSON.stringify(allowed.result).includes('private-variable'));
   const rejected=await rpc('hellotest_operation_read',{operation_id:operation.id,arguments:{path:{id:foreign}}});assert.equal(rejected.result.isError,true);
  }
  const {result:catalog}=await rpc('hellotest_capabilities',{query:'test-cases',limit:50});assert.equal(catalog.isError,undefined);const ops=catalog.structuredContent.data.operations;
  const read=ops.find(op=>op.method==='GET'&&op.path==='/test-cases/:id');const create=ops.find(op=>op.method==='POST'&&op.path==='/test-cases');assert.ok(read&&create);assert.equal(create.input_schema.body.properties.title.type,'string');
  const valid=await rpc('hellotest_operation_read',{operation_id:read.id,arguments:{path:{id:'mcp-case-a'}}});assert.equal(valid.result.isError,undefined,JSON.stringify(valid.result));assert.equal(valid.result.structuredContent.data.data.title,'A visible case');
  const cross=await rpc('hellotest_operation_read',{operation_id:read.id,arguments:{path:{id:'mcp-case-b'}}});assert.equal(cross.result.isError,true);assert.ok(!JSON.stringify(cross.result).includes('B private case'));
  const projection=await rpc('hellotest_database_query',{entity:'test_cases',fields:['id','title']});assert.deepEqual(projection.result.structuredContent.data.rows.map(row=>row.id),['mcp-case-a']);
  const fragment=await rpc('hellotest_knowledge_fetch',{fragment_id:'mcp-fragment'});assert.equal(fragment.result.isError,undefined,JSON.stringify(fragment.result));assert.equal(fragment.result.structuredContent.data.fragment.content,'Release requires passing tests');
  await db.query("UPDATE ai_knowledge_security_bindings SET effect='DENY' WHERE id='mcp-binding'");const deniedFragment=await rpc('hellotest_knowledge_fetch',{fragment_id:'mcp-fragment'});assert.equal(deniedFragment.result.isError,true);assert.ok(!JSON.stringify(deniedFragment.result).includes('Release requires passing tests'));await db.query("UPDATE ai_knowledge_security_bindings SET effect='ALLOW' WHERE id='mcp-binding'");
  const historical=await rpc('hellotest_knowledge_fetch',{fragment_id:'mcp-fragment',as_of:new Date().toISOString()});assert.equal(historical.result.isError,true);
  const otherApplication=await rpc('hellotest_context_build',{question:'Show app context',app_type_id:'mcp-app-b'});assert.equal(otherApplication.result.isError,true);
  const context=await rpc('hellotest_context_build',{question:'What test cases are available?',token_budget:1000});assert.equal(context.result.isError,undefined,JSON.stringify(context.result));assert.equal(context.result.structuredContent.data.context_transport,'mcp');assert.ok(Array.isArray(context.result.structuredContent.data.packet.evidence));require('@hellotest/knowledge/backend/services/knowledgeContracts.service').buildModelRequest({contextPacket:context.result.structuredContent.data.packet,question:'What test cases are available?'});assert.ok(!JSON.stringify(context.result).includes('B private case'));
  const tokenCountBefore=(await db.prepare('SELECT COUNT(*)::int AS count FROM mcp_credentials').get()).count;
  const originalFetch=global.fetch;let modelMessages;
  global.fetch=async(url,init)=>{
   if(String(url)!=='https://mcp-model-fixture.invalid/chat/completions')return originalFetch(url,init);
   modelMessages=JSON.parse(init.body).messages;
   return new Response(JSON.stringify({id:'model-fixture',model:'fixture',choices:[{message:{role:'assistant',content:'Grounded response'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:3,total_tokens:23}}),{headers:{'Content-Type':'application/json'}});
  };
  try{
   await require('../../src/utils/llmTraceContext').run({actor_id:'mcp-a',project_id:'mcp-p-a'},()=>require('../../src/utils/llmHttpClient').fetchLlmWithRetry('https://mcp-model-fixture.invalid/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'fixture',messages:[{role:'user',content:'What test cases are available?'}]})},{operation:'case-authoring.generate',timeoutMs:30000,maxAttempts:1}));
   assert.ok(modelMessages.some(message=>typeof message.content==='string'&&message.content.includes('Authorized HelloTest MCP context')));
   assert.ok(!JSON.stringify(modelMessages).includes('B private case'));
   assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM mcp_credentials').get()).count,tokenCountBefore,'Internal AI context must not issue host credentials');
  }finally{global.fetch=originalFetch;}
  const smartPacket=await require('@hellotest/mcp/backend/gateway').retrievePacket({user:{id:'mcp-a'},projectId:'mcp-p-a',query:'What tests are available?',budgets:{max_context_tokens:1000,deadline_ms:3000,max_tool_calls:4}});assert.ok(Array.isArray(smartPacket.evidence));assert.ok(!JSON.stringify(smartPacket).includes('B private case'));
  const listening=await app.listen({host:'127.0.0.1',port:0});process.env.HELLOTEST_MCP_INTERNAL_URL=listening+'/mcp';
  const mcpClient=require('@hellotest/agentic/backend/workflows/mcpClient');
  const builtinInspection=await mcpClient.inspect({connectionId:'hellotest',projectId:'mcp-p-a',user:{id:'mcp-a'}});assert.ok(builtinInspection.tools.length);assert.equal(builtinInspection.protocolVersion,'2026-07-28');
  process.env.AGENTIC_SECRET_MCP_FIXTURE=credential.token;
  const externalInspection=await mcpClient.inspect({projectId:'mcp-p-a',draftConnection:{id:'fixture',kind:'mcp',url:listening+'/mcp',projectIds:['mcp-p-a'],allowPrivateNetwork:true,authType:'bearer',secretEnv:'AGENTIC_SECRET_MCP_FIXTURE',tools:[]}});assert.ok(externalInspection.tools.length);assert.equal(externalInspection.protocolVersion,'2025-11-25');delete process.env.AGENTIC_SECRET_MCP_FIXTURE;
  try{const remoteActor=await require('@hellotest/mcp/backend/auth').principal('mcp-a','mcp-p-a','worker-fixture');const remoteCatalog=await require('@hellotest/mcp/backend/server').callLocal(remoteActor,'hellotest_capabilities',{query:'test-cases',limit:5});assert.ok(remoteCatalog.operations.length);const remaining=await db.prepare("SELECT COUNT(*)::int AS count FROM mcp_credentials WHERE client_id='worker-fixture' AND revoked_at IS NULL").get();assert.equal(remaining.count,0);}finally{delete process.env.HELLOTEST_MCP_INTERNAL_URL;}
  const forged=await rpc('hellotest_database_query',{entity:'test_cases',sql:'SELECT * FROM users'});assert.equal(forged.result.isError,true);
  assert.equal((await rpc('hellotest_capabilities',{},webToken)).response.statusCode,401);
  assert.equal((await rpc('hellotest_capabilities',{},credential.token,{origin:'https://evil.example'})).response.statusCode,403);
  const previousNodeEnv=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try{assert.equal((await rpc('hellotest_capabilities',{},credential.token,{origin:'https://evil.example'})).response.statusCode,403,'Production CORS denials must be forbidden, not internal errors');}finally{if(previousNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previousNodeEnv;}

  assert.equal((await rpc('hellotest_capabilities',{},credential.token,{host:'evil.example'})).response.statusCode,403);
  const invalidPlan=await rpc('hellotest_operation_prepare',{operation_id:create.id,arguments:{body:{app_type_id:'mcp-app-a',title:42}}});assert.equal(invalidPlan.result.isError,true);
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
  // Acceptance saves native domain records and a durable receipt atomically.
  const createdStory=await app.inject({method:'POST',url:'/requirements',headers,payload:{project_id:'mcp-p-a',title:'Recorded retry intent',description:'Preserve exactly one order.',acceptance_criteria:['One order remains.']}});
  assert.equal(createdStory.statusCode,200,createdStory.body);
  const storyId=createdStory.json().id;
  const storyBefore=await app.inject({url:`/requirements/${storyId}`,headers});
  const proposals=[
   {kind:'story',title:'New reviewed Story',description:'Preserve customer checkout intent.',priority:'P2',citation_ids:['K-proposal'],acceptance_criteria:['Given checkout, when submitted, then one order remains.']},
   {kind:'test_case',title:'Reviewed retry Test Case',description:'Test checkout retry boundaries.',priority:'P2',citation_ids:['K-proposal'],prerequisites:['A pending checkout exists.'],steps:[{action:'Retry checkout',expected_result:'Exactly one order exists.'}]},
   {kind:'defect',title:'Observed duplicate order',description:'Duplicate orders were observed after retry.',priority:'P2',citation_ids:['K-proposal'],severity:'high',reproduction_steps:['Submit the same checkout twice.'],expected_result:'One order.',actual_result:'Two orders.'},
   {kind:'story',title:'Recorded retry intent clarified',description:'Preserve exactly one order on repeat submission.',priority:'P2',citation_ids:['K-proposal'],target_id:storyId,target_revision:storyBefore.json().revision,acceptance_criteria:['Given an existing request, when repeated, then one order remains.']}
  ];
  const transactions=require('../../services/workspaceTransaction.service');
  const reviewTxn=await transactions.createTransaction({project_id:'mcp-p-a',app_type_id:'mcp-app-a',category:'ai_agent',action:'delegate',title:'Review fixture',status:'running',related_kind:'agentic_assistant_session',created_by:'mcp-a'});
  await transactions.updateTransaction(reviewTxn.id,{status:'completed',metadata:{context_scopes:['stories','test-cases','bugs'],citations:[{id:'K-proposal',scope:'stories',label:'Recorded checkout evidence'}],result:{response:'Recorded primary review.',recommendations:[],assumptions:[],findings:[],artifacts:proposals}}});
  const acceptProposal=(index,artifact=proposals[index],extra={})=>app.inject({method:'POST',url:`/agentic-assistant/sessions/${reviewTxn.id}/proposals/accept`,headers,payload:{index,artifact,...extra}});
  for(const index of [0,1,2,3]){
   const [first,repeat]=await Promise.all([acceptProposal(index),acceptProposal(index)]);
   assert.equal(first.statusCode,200,first.body);assert.equal(repeat.statusCode,200,repeat.body);assert.equal(first.json().id,repeat.json().id);
  }
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM requirements WHERE title=?').get('New reviewed Story')).count,1);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM test_cases WHERE title=?').get('Reviewed retry Test Case')).count,1);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM feedback WHERE title=?').get('Observed duplicate order')).count,1);
  const savedCase=await db.prepare('SELECT id,description FROM test_cases WHERE title=?').get('Reviewed retry Test Case');assert.match(savedCase.description,/pending checkout/);
  const savedSteps=await db.prepare('SELECT action,expected_result FROM test_steps WHERE test_case_id=? ORDER BY step_order').all(savedCase.id);assert.deepEqual(savedSteps,[{action:'Retry checkout',expected_result:'Exactly one order exists.'}]);
  const savedDefect=await db.prepare('SELECT steps_to_reproduce,expected_result,actual_result FROM feedback WHERE title=?').get('Observed duplicate order');assert.deepEqual(savedDefect,{steps_to_reproduce:'Submit the same checkout twice.',expected_result:'One order.',actual_result:'Two orders.'});

  assert.equal((await app.inject({url:`/requirements/${storyId}`,headers})).json().title,'Recorded retry intent clarified');
  const stored=await app.inject({url:`/agentic-assistant/sessions/${reviewTxn.id}/proposals`,headers});assert.equal(stored.statusCode,200,stored.body);assert.equal(stored.json().length,4);
  assert.equal((await acceptProposal(0,{...proposals[0],title:'Changed after save'})).statusCode,409);
  assert.equal((await acceptProposal(0,{...proposals[0],citation_ids:['invented']})).statusCode,400);
  assert.equal((await acceptProposal(0,{...proposals[0],target_id:'outside-story'})).statusCode,400);
  const foreign=await app.inject({method:'POST',url:`/agentic-assistant/sessions/${reviewTxn.id}/proposals/accept`,headers:{authorization:'Bearer '+createToken({id:'mcp-b',role:'member'})},payload:{index:0,artifact:proposals[0]}});assert.equal(foreign.statusCode,403,foreign.body);
  const approvedCount=(await db.prepare('SELECT COUNT(*)::int AS count FROM agent_proposal_acceptances').get()).count;assert.equal(approvedCount,4);
  const extraReview=async artifact=>{const row=await transactions.createTransaction({project_id:'mcp-p-a',app_type_id:'mcp-app-a',category:'ai_agent',action:'delegate',title:'Acceptance failure fixture',status:'running',related_kind:'agentic_assistant_session',created_by:'mcp-a'});await transactions.updateTransaction(row.id,{status:'completed',metadata:{citations:[{id:'K-proposal',scope:'stories',label:'Recorded checkout evidence'}],result:{response:'Recorded primary review.',recommendations:[],assumptions:[],artifacts:[artifact]}}});return row.id;};
  const staleId=await extraReview(proposals[3]);
  const stale=await app.inject({method:'POST',url:`/agentic-assistant/sessions/${staleId}/proposals/accept`,headers,payload:{index:0,artifact:proposals[3]}});assert.equal(stale.statusCode,409,stale.body);
  assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM agent_proposal_acceptances WHERE session_id=?').get(staleId)).count,0);
  const lostArtifact={...proposals[0],title:'Lost destination acknowledgement'};const lostId=await extraReview(lostArtifact);
  const domainInject=app.inject.bind(app);app.inject=async options=>{const response=await domainInject(options);if(options.method==='POST'&&options.url==='/requirements'&&options.payload?.title===lostArtifact.title)throw new Error('Fixture loses acknowledgement after domain create');return response;};
  try{const lost=await app.inject({method:'POST',url:`/agentic-assistant/sessions/${lostId}/proposals/accept`,headers,payload:{index:0,artifact:lostArtifact}});assert.equal(lost.statusCode,500);assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM requirements WHERE title=?').get(lostArtifact.title)).count,0,'Lost internal acknowledgement rolls back the native write and receipt together');}finally{app.inject=domainInject;}
  const recovered=await app.inject({method:'POST',url:`/agentic-assistant/sessions/${lostId}/proposals/accept`,headers,payload:{index:0,artifact:lostArtifact}});assert.equal(recovered.statusCode,200,recovered.body);assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM requirements WHERE title=?').get(lostArtifact.title)).count,1);

  const mcpAuth=require('@hellotest/mcp/backend/auth');const cachedActor=await mcpAuth.principal('mcp-a','mcp-p-a');
  await db.query("UPDATE users SET status='suspended' WHERE id='mcp-a'");await assert.rejects(require('@hellotest/mcp/backend/server').invoke(cachedActor,'hellotest_capabilities',{}),{statusCode:403});await db.query("UPDATE users SET status='active' WHERE id='mcp-a'");
  const userB=require('@hellotest/mcp/backend/auth');const b=await userB.issue({id:'mcp-b'},'mcp-p-b');const wrong=await rpc('hellotest_operation_status',{plan_id:plan.plan_id},b.token);assert.equal(wrong.result.isError,true);
  await db.query("UPDATE users SET status='suspended' WHERE id='mcp-a'");assert.equal((await rpc('hellotest_capabilities')).response.statusCode,403);await db.query("UPDATE users SET status='active' WHERE id='mcp-a'");
  await app.inject({method:'DELETE',url:`/agentic-workflows/mcp/credentials/${credential.id}?project_id=mcp-p-a`,headers});assert.equal((await rpc('hellotest_capabilities')).response.statusCode,401);
 }finally{await app?.close();await require('../../src/utils/cache').close();await Promise.allSettled([db.close(),obsDb.close()]);}
});
