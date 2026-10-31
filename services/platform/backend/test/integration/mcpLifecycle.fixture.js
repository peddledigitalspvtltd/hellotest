const assert=require('node:assert/strict');

// Exercise real saved lifecycle states through authenticated SDK requests.
// PostgreSQL and native services are real; no execution provider is involved.
exports.verify=async({app,db,createToken})=>{
 const project='mcp-p-a',application='mcp-app-a',user='mcp-a';
 const headers={authorization:'Bearer '+createToken({id:user})};
 const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}};
 const cases=[],runs=[],workflowRuns=[],stories=[],sprints=[],plans=[],added=[];let credential,primaryError;
 const existingCases=new Set((await db.prepare('SELECT id FROM test_cases WHERE app_type_id=? AND created_by=?').all(application,user)).map(row=>row.id));
 const existingRuns=new Set((await db.prepare('SELECT id FROM executions WHERE project_id=? AND created_by=?').all(project,user)).map(row=>row.id));
 async function rpc(name,args={}){
  const response=await app.inject({method:'POST',url:'/mcp',headers:{host:'localhost',authorization:'Bearer '+credential.token,accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':name},payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args,_meta:meta}}});
  assert.equal(response.statusCode,200,response.body);return response.json().result;
 }
 async function call(name,args={}){const result=await rpc(name,args);assert.equal(result.isError,undefined,JSON.stringify(result));assert.equal(result.structuredContent.scope.project_id,project);assert.equal(result.structuredContent.scope.subject,user);return result.structuredContent.data;}
 async function operation(method,path){const catalog=await call('hellotest_capabilities',{query:path,limit:50});const selected=catalog.operations.find(item=>item.method===method&&item.path===path);assert.ok(selected,`${method} ${path} must be callable`);return selected;}
 async function prepare(op,path,body={}){const plan=await call('hellotest_operation_prepare',{operation_id:op.id,arguments:{path,body}});assert.equal(plan.state,'requires_authorization');plans.push(plan.plan_id);return plan;}
 async function authorize(plan){return app.inject({method:'POST',url:`/agentic-workflows/mcp/plans/${encodeURIComponent(plan.plan_id)}/authorize`,headers,payload:{project_id:project,digest:plan.digest}});}
 async function execute(plan){const approved=await authorize(plan);assert.equal(approved.statusCode,200,approved.body);return call('hellotest_operation_execute',{plan_id:plan.plan_id});}
 async function seedCase(id,{generated=false,reviewer=user,author=user}={}){
  cases.push(id);await db.prepare('INSERT INTO test_cases(id,app_type_id,title,status,reviewer_id,review_status,ai_generation_source,ai_generation_review_status,created_by,author_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,application,'Lifecycle '+id,'draft',reviewer,'pending',generated?'interactive':null,generated?'pending':null,user,author);
 }
 try{
  for(const code of ['run.execute','testcase.update','testcase.delete','agentic_workflow.run']){
   const permission=await db.prepare('SELECT id FROM permissions WHERE code=?').get(code);assert.ok(permission,code);
   if(!await db.prepare('SELECT 1 AS present FROM role_permissions WHERE role_id=? AND permission_id=?').get('mcp-fixture-role',permission.id)){
    await db.prepare('INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)').run('mcp-fixture-role',permission.id);added.push(permission.id);
   }
  }
  const issued=await app.inject({method:'POST',url:'/agentic-workflows/mcp/credentials',headers,payload:{project_id:project}});assert.equal(issued.statusCode,200,issued.body);credential=issued.json();
  const start=await operation('POST','/executions/:id/start'),complete=await operation('POST','/executions/:id/complete'),rerun=await operation('POST','/executions/:id/rerun');
  const review=await operation('POST','/test-cases/:id/review'),accept=await operation('POST','/test-cases/:id/accept-generated'),reject=await operation('DELETE','/test-cases/:id/reject-generated');

  await seedCase('mcp-life-case');
  // Manual creation retains saved scope; start/complete are separate reviewed effects.
  const creation=await call('hellotest_test_run_create_prepare',{app_type_id:application,test_case_ids:['mcp-case-a','mcp-life-case'],execution_mode:'manual',name:'MCP lifecycle run'});plans.push(creation.plan_id);
  const created=await execute(creation);assert.equal(created.state,'succeeded_verified',JSON.stringify(created));runs.push(created.domain_id);
  assert.equal((await call('hellotest_test_runs_get',{run_id:created.domain_id})).record.status,'queued');
  const startedPlan=await prepare(start,{id:created.domain_id},{execution_mode:'manual'});
  assert.equal((await call('hellotest_operation_execute',{plan_id:startedPlan.plan_id})).state,'requires_authorization');
  const started=await execute(startedPlan);assert.equal(started.state,'submitted',JSON.stringify(started));
  const running=(await call('hellotest_test_runs_get',{run_id:created.domain_id})).record;assert.equal(running.status,'running');assert.ok(running.started_at);
  assert.equal((await call('hellotest_operation_execute',{plan_id:startedPlan.plan_id})).state,'submitted');
  const forbiddenUrl=await rpc('hellotest_operation_prepare',{operation_id:start.id,arguments:{path:{id:created.domain_id},body:{execution_mode:'local',engine_base_url:'http://127.0.0.1:39191'}}});assert.equal(forbiddenUrl.isError,true,'Native host endpoints require their dedicated transport, not generic MCP delegation.');

  const completed=await execute(await prepare(complete,{id:created.domain_id},{status:'completed'}));
  assert.equal(completed.state,'succeeded_verified',JSON.stringify(completed));
  assert.equal(completed.data.status,'partially_completed','Native completion derives its real status from pending results instead of trusting a requested success.');
  assert.equal((await db.prepare('SELECT status FROM executions WHERE id=?').get(created.domain_id)).status,'partially_completed');
  const emptyRerun=await execute(await prepare(rerun,{id:created.domain_id},{failed_only:true}));
  assert.equal(emptyRerun.state,'failed',JSON.stringify(emptyRerun));
  assert.equal((await db.prepare('SELECT COUNT(*)::integer AS count FROM executions WHERE project_id=? AND created_by=?').get(project,user)).count,existingRuns.size+1,'A failed-only rerun without failures rejects before creating another run.');

  const clonePlan=await prepare(rerun,{id:created.domain_id},{name:'MCP lifecycle rerun',failed_only:false});
  const cloned=await execute(clonePlan);assert.equal(cloned.state,'succeeded_verified',JSON.stringify(cloned));runs.push(cloned.domain_id);assert.notEqual(cloned.domain_id,created.domain_id);
  const clone=(await call('hellotest_test_runs_get',{run_id:cloned.domain_id})).record;
  assert.equal(clone.status,'queued');assert.equal(clone.created_by,user);assert.equal(clone.name,'MCP lifecycle rerun');assert.deepEqual(clone.case_snapshots.map(item=>item.test_case_id).sort(),running.case_snapshots.map(item=>item.test_case_id).sort());
  const repeated=await call('hellotest_operation_execute',{plan_id:clonePlan.plan_id});assert.equal(repeated.domain_id,cloned.domain_id);
  assert.equal((await db.prepare('SELECT COUNT(*)::integer AS count FROM executions WHERE project_id=? AND name=?').get(project,'MCP lifecycle rerun')).count,1);
  await db.prepare("UPDATE executions SET trigger='local',execution_mode='local',revision=revision+1 WHERE id=?").run(cloned.domain_id);
  require('../../../../testing/backend/services/execution.service').invalidateExecutionCache(cloned.domain_id);
  const inheritedLocal=await rpc('hellotest_operation_prepare',{operation_id:start.id,arguments:{path:{id:cloned.domain_id},body:{execution_mode:'manual'}}});
  assert.equal(inheritedLocal.isError,true,'A stored local run cannot bypass host-transport limits by requesting manual mode.');
  assert.equal((await db.prepare('SELECT status FROM executions WHERE id=?').get(cloned.domain_id)).status,'queued');

  // Review decision and comment are read back from native saved review history.
  const changes=await execute(await prepare(review,{id:'mcp-life-case'},{review_status:'changes_requested',comment:'Specify the visible confirmation before accepting this case.'}));
  assert.equal(changes.state,'succeeded_verified',JSON.stringify(changes));
  const changed=(await call('hellotest_test_cases_get',{test_case_id:'mcp-life-case'})).record;assert.equal(changed.review_status,'changes_requested');assert.equal(changed.status,'draft');assert.equal(changed.review_history.at(-1).comment,'Specify the visible confirmation before accepting this case.');assert.equal(changed.review_history.at(-1).user_id,user);

  await seedCase('mcp-life-generated',{generated:true});
  const acceptedPlan=await prepare(accept,{id:'mcp-life-generated'}),accepted=await execute(acceptedPlan);assert.equal(accepted.state,'succeeded_verified',JSON.stringify(accepted));
  const saved=(await call('hellotest_test_cases_get',{test_case_id:'mcp-life-generated'})).record;assert.equal(saved.review_status,'accepted');assert.equal(saved.ai_generation_review_status,'accepted');assert.equal(saved.status,'ready');
  assert.equal((await call('hellotest_operation_execute',{plan_id:acceptedPlan.plan_id})).state,'succeeded_verified');assert.equal((await db.prepare('SELECT jsonb_array_length(review_history)::integer AS count FROM test_cases WHERE id=?').get('mcp-life-generated')).count,1);

  await seedCase('mcp-life-reject',{generated:true});
  const rejected=await execute(await prepare(reject,{id:'mcp-life-reject'}));assert.equal(rejected.state,'succeeded_verified',JSON.stringify(rejected));assert.equal(await db.prepare('SELECT id FROM test_cases WHERE id=?').get('mcp-life-reject'),undefined);

  await seedCase('mcp-life-other-reviewer',{reviewer:'mcp-b'});
  const wrongReviewer=await execute(await prepare(review,{id:'mcp-life-other-reviewer'},{review_status:'accepted'}));assert.equal(wrongReviewer.state,'failed',JSON.stringify(wrongReviewer));assert.equal((await db.prepare('SELECT review_status FROM test_cases WHERE id=?').get('mcp-life-other-reviewer')).review_status,'pending','MCP plan approval does not grant native reviewer ownership.');

  await seedCase('mcp-life-stale',{generated:true});
  const stale=await prepare(accept,{id:'mcp-life-stale'});
  const current=(await call('hellotest_test_cases_get',{test_case_id:'mcp-life-stale'})).record;
  const edited=await app.inject({method:'PUT',url:'/test-cases/mcp-life-stale',headers,payload:{title:'Lifecycle revised after review preview',expected_revision:current.revision}});assert.equal(edited.statusCode,200,edited.body);
  const staleApproval=await authorize(stale);assert.equal(staleApproval.statusCode,409,staleApproval.body);assert.equal(staleApproval.json().code,'MCP_STALE_PLAN');
  assert.equal((await db.prepare('SELECT review_status FROM test_cases WHERE id=?').get('mcp-life-stale')).review_status,'pending');
  const foreign=await rpc('hellotest_operation_prepare',{operation_id:review.id,arguments:{path:{id:'mcp-case-b'},body:{review_status:'accepted'}}});assert.equal(foreign.isError,true,'The user can access project B, but this credential cannot review its records.');

  // Native draft acceptance uses recorded assessed content and its durable
  // acceptance ledger. It saves a pending-review case without approving it.
  const draftAccept=await operation('POST','/agentic-workflow-runs/:id/drafts/accept');
  const storyId='mcp-life-workflow-story',workflowId='mcp-life-workflow-run',sprintId='mcp-life-workflow-sprint';stories.push(storyId);workflowRuns.push(workflowId);sprints.push(sprintId);
  await db.prepare("INSERT INTO requirement_iterations(id,project_id,name,state,created_by) VALUES(?,?,?,'active',?)").run(sprintId,project,'Lifecycle workflow Sprint',user);
  await db.prepare('INSERT INTO requirements(id,project_id,title,description,iteration_id,revision) VALUES(?,?,?,?,?,1)').run(storyId,project,'Lifecycle workflow Story','Submitting valid registration details shows exactly one confirmation.',sprintId);
  const tasks=require('../../../../agentic/backend/workflows/artifactTasks');
  const story=await require('../../../../manual/backend/services/requirement.service').getRequirement(storyId);
  const types=await require('../../services/dropdownCatalog.service').getField('test_cases.types'),caseType=types.options.find(option=>option.active!==false).value;
  const draft={client_id:'mcp-life-draft',title:'Lifecycle recorded registration draft',description:'Verify exactly one confirmation after valid registration.',priority:3,test_case_type:caseType,authoring_mode:'structured',requirement_ids:[storyId],parameter_values:{},steps:[{step_order:1,step_type:'web',action:'Submit the supplied valid registration details.',expected_result:'Exactly one confirmation is displayed.'}]};
  const packet={story_id:storyId,story_revision:tasks.revision(story),cases:[draft],case_assurance:[{case_fingerprint:tasks.fingerprint(draft),verification:{status:'passed'}}]};
  await db.prepare("INSERT INTO agentic_workflow_runs(id,project_id,app_type_id,workflow_name,status,input_payload,workflow_snapshot,node_results,created_by) VALUES(?,?,?,'MCP lifecycle reviewed drafts','completed',?,?,?,?)").run(workflowId,project,application,{sprint_id:sprintId},{execution_mode:'review',nodes:[{id:'author',data:{kind:'artifactTask',artifactTask:'test-case-generation'}}],edges:[]},[{node_id:'author',node_type:'artifactTask',status:'completed',output:{data:[packet]}}],user);
  const draftBody={node_id:'author',story_index:0,case_index:0,kind:'manual'};
  const acceptedDraft=await execute(await prepare(draftAccept,{id:workflowId},draftBody));assert.equal(acceptedDraft.state,'succeeded_verified',JSON.stringify(acceptedDraft));
  cases.push(acceptedDraft.domain_id);
  const recorded=(await call('hellotest_test_cases_get',{test_case_id:acceptedDraft.domain_id})).record;assert.equal(recorded.title,draft.title);assert.deepEqual(recorded.requirement_ids,[storyId]);assert.equal(recorded.review_status,'pending');assert.equal(recorded.ai_generation_review_status,'pending');assert.equal(recorded.status,'draft');assert.deepEqual(recorded.review_history,[]);
  const acceptedAgain=await execute(await prepare(draftAccept,{id:workflowId},draftBody));assert.equal(acceptedAgain.state,'succeeded_verified',JSON.stringify(acceptedAgain));assert.equal(acceptedAgain.domain_id,acceptedDraft.domain_id,'The native acceptance ledger prevents duplicates even across two reviewed plans.');
  assert.equal((await db.prepare('SELECT COUNT(*)::integer AS count FROM workflow_draft_acceptances WHERE run_id=?').get(workflowId)).count,1);
 }catch(error){primaryError=error;throw error;}finally{
  const cleanupErrors=[],cleanup=async task=>{try{await task();}catch(error){cleanupErrors.push(error);}};
  await cleanup(async()=>{const saved=await db.prepare('SELECT id FROM test_cases WHERE app_type_id=? AND created_by=?').all(application,user);cases.push(...saved.map(row=>row.id).filter(id=>!existingCases.has(id)));});
  await cleanup(async()=>{const saved=await db.prepare('SELECT id FROM executions WHERE project_id=? AND created_by=?').all(project,user);runs.push(...saved.map(row=>row.id).filter(id=>!existingRuns.has(id)));});
  for(const id of new Set(runs))await cleanup(()=>db.prepare('DELETE FROM executions WHERE id=?').run(id));
  for(const id of workflowRuns){await cleanup(()=>db.prepare('DELETE FROM workflow_draft_acceptances WHERE run_id=?').run(id));await cleanup(()=>db.prepare('DELETE FROM agentic_workflow_runs WHERE id=?').run(id));}
  for(const id of new Set(cases)){await cleanup(()=>db.prepare('DELETE FROM test_steps WHERE test_case_id=?').run(id));await cleanup(()=>db.prepare('DELETE FROM test_cases WHERE id=?').run(id));}
  for(const id of stories)await cleanup(()=>db.prepare('DELETE FROM requirements WHERE id=?').run(id));
  for(const id of sprints)await cleanup(()=>db.prepare('DELETE FROM requirement_iterations WHERE id=?').run(id));
  for(const id of plans)await cleanup(()=>db.prepare('DELETE FROM mcp_action_plans WHERE id=?').run(id));
  if(credential?.id)await cleanup(()=>db.prepare('DELETE FROM mcp_credentials WHERE id=?').run(credential.id));
  for(const id of added)await cleanup(()=>db.prepare('DELETE FROM role_permissions WHERE role_id=? AND permission_id=?').run('mcp-fixture-role',id));
  if(cleanupErrors.length){if(primaryError)primaryError.cleanupErrors=cleanupErrors;else throw new AggregateError(cleanupErrors,'MCP lifecycle cleanup failed: '+cleanupErrors.map(error=>error.message).join('; '));}
 }
};
