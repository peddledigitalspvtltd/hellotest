const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),path=require('node:path'),fs=require('node:fs/promises');
const {tmpdir}=require('node:os'),{pathToFileURL}=require('node:url'),{randomUUID,createHmac}=require('node:crypto');
test('paired browser owns real local case/suite execution, outbound claims, persisted results and native MCP',{skip:process.env.PAIRED_LOCAL_POSTGRES_TEST!=='1',timeout:180000},async t=>{
 assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/agent_verify_paired_local_[0-9]+$/);
 const directory=await fs.mkdtemp(path.join(tmpdir(),'hellotest-paired-pg-'));process.env.ARTIFACT_ROOT=path.join(directory,'artifacts');
 const db=require('../../src/db'),obs=require('../../src/obsDb'),Fastify=require('fastify');let api,agent,proxy;
 try{
  await require('../../src/migrate').migrate();
  await db.query("INSERT INTO roles(id,name) VALUES('paired-role','Paired fixture')");
  await db.query("INSERT INTO role_permissions(role_id,permission_id) SELECT 'paired-role',id FROM permissions WHERE code IN('project.view','app_type.view','testcase.view','run.create','run.execute','run.view','result.view','automation.run.local','automation.build','automation.ai','automation.code.view')");
  await db.query("INSERT INTO users(id,email,password_hash,name,default_role_id) VALUES('paired-owner','paired@example.test','unused','Paired owner','paired-role')");
  await db.query("INSERT INTO projects(id,name,created_by) VALUES('paired-project','Paired fixture','paired-owner')");
  await db.query("INSERT INTO project_members(id,project_id,user_id,role_id) VALUES('paired-member','paired-project','paired-owner','paired-role')");
  await db.query("INSERT INTO app_types(id,project_id,name,type) VALUES('paired-app','paired-project','Local web','web')");
  api=Fastify({logger:false});api.register(require('@fastify/multipart'));api.register(require('../../src/plugins/errorHandler'));api.register(require('../../src/plugins/validator'));api.register(require('../../src/plugins/accessControl'));api.register(require('../../src/routes'));await api.ready();
  // Keep real multipart/attachment validation and checksums; replace only the
  // external object-store adapter with private fixture bytes.
  const objects=new Map(),storage=require('../../src/services/objectStorage.service');
  t.mock.method(storage,'putObject',async({objectName,stream})=>{const chunks=[];for await(const chunk of stream)chunks.push(chunk);const bytes=Buffer.concat(chunks);objects.set(objectName,bytes);return {bucket:'paired-fixture',etag:'fixture',size:bytes.length};});
  t.mock.method(storage,'removeObject',async({objectName})=>{objects.delete(objectName);});
  let targetRequests=0;const forwarded=[];
  proxy=http.createServer(async(req,res)=>{
   try{
    if(req.url.startsWith('/fixture-target')){targetRequests++;res.setHeader('content-type','text/html');return res.end('<html><title>Paired fixture</title><h1>Paired machine</h1><button>Saved action</button></html>');}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const url=req.url.replace(/^\/api(?=\/)/,'');forwarded.push(url);
    const response=await api.inject({method:req.method,url,headers:{...req.headers},...(chunks.length?{payload:Buffer.concat(chunks)}:{})});
    if(response.statusCode>=400)console.error(`API ${req.method} ${url}: ${response.statusCode} ${response.body.slice(0,1000)}`);
    res.writeHead(response.statusCode,response.headers);res.end(response.rawPayload);
   }catch{res.statusCode=500;res.end('Fixture proxy failed');}
  });await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${proxy.address().port}`;
  const {registerPairedLocalExecutionRoutes}=await import(pathToFileURL(path.resolve(__dirname,'../../../../../testengine/backend/dist/lib/pairedLocalExecution.js')).href);
  const pairToken='paired-local-browser-fixture-'.repeat(3);agent=Fastify({logger:false});
  const capabilities=await registerPairedLocalExecutionRoutes(agent,{directory:path.join(directory,'agent'),origin,apiOrigin:origin,token:pairToken});await agent.listen({host:'127.0.0.1',port:0});
  const actor={id:'paired-owner'},headers={authorization:'Bearer '+require('../../src/utils/token').createToken(actor),origin};
  const localHeaders={origin,'x-hellotest-agent-token':pairToken};
  const dispatch=require('@hellotest/automation/backend/services/testEngineDispatch.service');
  const actualPrepare=dispatch.preparePairedLocalDispatch;
  // Keep the actual native executor while avoiding visible test windows. This
  // fixture changes only browser display/video policy, never commands/results.
  t.mock.method(dispatch,'preparePairedLocalDispatch',input=>actualPrepare({...input,integration:{config:{...input.integration?.config,headless:true,video_mode:'off',trace_mode:'on',screenshot_on_failure:true,screenshot_on_success:true}}}));
  const generatedCases=[];
  for(const [index,mode] of ['record','instructions','build'].entries()){
   const caseId=`paired-${mode}`;generatedCases.push(caseId);
   await db.prepare("INSERT INTO test_cases(id,app_type_id,title,automated,automation_status,automation_start_url,author_id) VALUES(?,'paired-app',?,'yes','ready',?,'paired-owner')").run(caseId,`Saved ${mode} case`,origin+'/fixture-target');
   await db.prepare("INSERT INTO test_steps(id,test_case_id,step_order,action,expected_result,step_type,automation_code) VALUES(?,?,1,'Open fixture','Heading is visible','web',?)")
    .run(`paired-step-${mode}`,caseId,`await page.goto(${JSON.stringify(origin+'/fixture-target')});\nawait expect(page.locator('h1')).toHaveText('Paired machine');`);
  }
  await db.query("INSERT INTO test_suites(id,app_type_id,name) VALUES('paired-suite','paired-app','Saved local suite')");
  for(const [index,caseId]of generatedCases.entries())await db.prepare("INSERT INTO suite_test_cases(suite_id,test_case_id,sort_order) VALUES('paired-suite',?,?)").run(caseId,index+1);
  const prepare=async input=>{
   const response=await api.inject({method:'POST',url:'/executions/local-run',headers,payload:{project_id:'paired-project',app_type_id:'paired-app',created_by:actor.id,local_transport:'paired-agent',paired_origin:origin,local_agent_id:capabilities.agent_id,request_id:randomUUID(),...input}});
   assert.equal(response.statusCode,200,response.body);assert.ok(response.json().local_dispatch);return response.json();
  };
  const accept=async receipt=>{
   const result=await agent.inject({method:'POST',url:'/api/v1/local-executions',headers:localHeaders,payload:{execution_id:receipt.id,claim_url:receipt.local_dispatch.claim_url,grant_token:receipt.local_dispatch.grant_token}});
   assert.equal(result.statusCode,202,result.body);assert.equal(result.json().accepted,true);return result.json();
  };
  const wait=async(fn,label)=>{const until=Date.now()+40000;for(;;){const value=await fn();if(value)return value;if(Date.now()>until)throw Error(`Timed out: ${label}`);await new Promise(resolve=>setTimeout(resolve,100));}};
  const individual=await prepare({test_case_ids:[generatedCases[0]]});await accept(individual);
  await wait(async()=>{const row=await db.prepare('SELECT status FROM executions WHERE id=?').get(individual.id);return row.status==='completed'?row:false;},'individual callback');
  assert.equal((await db.prepare('SELECT count(*)::int AS count FROM test_case_effective_results WHERE execution_id=?').get(individual.id)).count,1);
  const targetsBeforeReplay=targetRequests;await accept(individual);await new Promise(resolve=>setTimeout(resolve,200));assert.equal(targetRequests,targetsBeforeReplay,'Lost acknowledgements cannot execute the case twice.');
  const suite=await prepare({suite_ids:['paired-suite'],test_case_ids:[]});const accepted=await accept(suite);assert.equal(accepted.engine_run_ids.length,3);
  await wait(async()=>{const row=await db.prepare('SELECT status FROM executions WHERE id=?').get(suite.id);return row.status==='completed'?row:false;},'suite callbacks');
  const results=await db.prepare('SELECT test_case_id,status FROM test_case_effective_results WHERE execution_id=? ORDER BY test_case_id').all(suite.id);
  assert.equal(results.length,3);assert.ok(results.every(row=>row.status==='passed'),JSON.stringify(results));
  const evidence=await db.prepare("SELECT a.* FROM attachments a JOIN execution_results r ON r.id=a.entity_id WHERE r.execution_id=? AND a.entity_type='execution_result'").all(suite.id);
  assert.equal(evidence.filter(item=>item.mime_type==='image/jpeg').length,3,'Each single-step case uploads its screenshot before the final callback.');
  assert.equal(evidence.filter(item=>item.mime_type==='application/zip').length,3,'Native traces use the scoped evidence grant.');
  for(const item of evidence){const bytes=objects.get(item.object_name);assert.ok(bytes?.length);assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),item.checksum_sha256);}
  const cipher=await db.prepare('SELECT * FROM automation_paired_dispatches WHERE execution_id=?').get(suite.id);assert.equal(cipher.state,'claimed');assert.ok(cipher.envelope_cipher.data);assert.ok(!JSON.stringify(cipher).includes('signing_secret'));
  const forged=await api.inject({method:'POST',url:`/executions/${suite.id}/local-dispatch/claim`,headers:{authorization:'Bearer '+suite.local_dispatch.grant_token},payload:{agent_id:'another-machine'}});assert.equal(forged.statusCode,401,forged.body);
  const bridgeResponse=await api.inject({method:'POST',url:'/automation/browser-bridges',headers,payload:{test_case_ids:[generatedCases[0]],local_agent_id:capabilities.agent_id,paired_origin:origin}});
  assert.equal(bridgeResponse.statusCode,200,bridgeResponse.body);const bridge=bridgeResponse.json();
  const bridged=await agent.inject({method:'POST',url:'/api/v1/local-browser-bridges',headers:localHeaders,payload:bridge});assert.equal(bridged.statusCode,202,bridged.body);
  const browser=require('@hellotest/automation/backend/services/pairedBrowserBridge.service');
  const scope={bridgeId:bridge.id,projectId:'paired-project',appTypeId:'paired-app',userId:actor.id,caseId:generatedCases[0],jobId:'paired-fixture-job'};
  const initialized=await browser.exchange({scope,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'paired-fixture',version:'1'},_meta:{hellotest:{start_url:origin+'/fixture-target',headless:true}}},timeoutMs:15000});
  assert.equal(initialized.status,200,JSON.stringify(initialized));assert.ok(initialized.session_id);
  const tools=await browser.exchange({scope,method:'tools/list',sessionId:initialized.session_id,params:{},timeoutMs:15000});assert.equal(tools.status,200);assert.ok(tools.body.result.tools.length);
  const stored=await db.prepare('SELECT request_ciphertext,response_ciphertext FROM automation_paired_browser_commands WHERE bridge_id=?').all(bridge.id);assert.equal(stored.length,2);assert.ok(stored.every(row=>row.response_ciphertext));
  await browser.exchange({scope,method:'session/delete',sessionId:initialized.session_id,timeoutMs:15000});
  await db.prepare("UPDATE automation_paired_browser_bridges SET status='closed' WHERE id=?").run(bridge.id);
  assert.ok(forwarded.some(url=>url.endsWith('/local-dispatch/claim')));assert.ok(forwarded.some(url=>url==='/testengine/callbacks/runs'));
  t.diagnostic(JSON.stringify({individual_native_case:true,suite_native_cases:results.length,source_modes:3,api_to_runner_requests:0,local_agent_outbound_claims:true,signed_results_persisted:true,replay_additional_target_requests:0,native_browser_mcp_outbound_relay:true}));
 }finally{
  if(agent)await agent.close();if(proxy){proxy.closeAllConnections?.();await new Promise(resolve=>proxy.close(resolve));}if(api)await api.close();await db.close();await obs.close();await fs.rm(directory,{recursive:true,force:true});
 }
});
