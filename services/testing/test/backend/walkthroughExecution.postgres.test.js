const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
test('walkthrough execution boundaries persist layered input, exact provenance, frozen summaries and suite membership',{skip:process.env.WALKTHROUGH_EXECUTION_POSTGRES!=='1',timeout:120000},async t=>{
 assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/agent_verify_walkthrough_execution_[a-z0-9_]+$/);
 const db=require('@hellotest/platform/backend/src/db'),obs=require('@hellotest/platform/backend/src/obsDb');
 try{
  await db.query(fs.readFileSync(path.resolve(__dirname,'../../../platform/backend/instance-setup-data/schema-setup/schema.sql'),'utf8'));
  await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
  await require('../../../platform/backend/src/obsDb/bootstrap').ensureRuntimeSchema();
  const actor=randomUUID(),project=randomUUID(),app=randomUUID();
  await db.prepare("INSERT INTO users(id,email,password_hash,name,status,is_workspace_admin) VALUES(?,?,'no-login','Execution fixture','active',TRUE)").run(actor,`${actor}@example.test`);
  await db.prepare("INSERT INTO projects(id,name) VALUES(?,'Walkthrough fixture')").run(project);
  await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,'Fixture','web')").run(app,project);
  await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(randomUUID(),project,actor,'role-admin');
  const limitedUser=randomUUID(),limitedRole=randomUUID();
  await db.prepare("INSERT INTO users(id,email,password_hash,name,status) VALUES(?,?,'no-login','Run-only member','active')").run(limitedUser,`${limitedUser}@example.test`);
  await db.prepare("INSERT INTO roles(id,name) VALUES(?,'Run reader without defect access')").run(limitedRole);
  await db.prepare("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE code IN ('run.view','result.view','run.report.export')").run(limitedRole);
  await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(randomUUID(),project,limitedUser,limitedRole);
  const cases=require('../../backend/services/testCase.service'),runs=require('../../backend/services/execution.service'),data=require('../../backend/services/testDataSet.service'),suites=require('../../backend/services/testSuite.service');
  const manual=await cases.createTestCase({app_type_id:app,title:'Login — Unicode ≥ 1',created_by:actor,steps:[{action:'<p>Enter @r.email</p>',expected_result:'<p>Welcome &amp; ready</p>'},{action:'Sign in using @r.password at @r.base_url',expected_result:'Authenticated'}]});
  const native=await cases.createTestCase({app_type_id:app,title:'Native API',created_by:actor,automated:'yes',automation_case_type:'api',manual_test_case_ids:[manual.id],steps:[{step_type:'api',action:'Read session',api_request:{method:'GET',url:'https://fixture.test/session',validations:[{kind:'status',expected:'200'}]}}]});
  await t.test('metadata saves preserve stored native API readiness and partial mapping stays incomplete',async()=>{
   await cases.updateTestCase(native.id,{automated:'yes',title:'Metadata-only change',updated_by:actor});
   assert.equal((await cases.getTestCase(native.id)).automation_status,'ready');
   await db.prepare("UPDATE test_cases SET automation_status='incomplete' WHERE id=?").run(native.id);
   await cases.updateTestCase(native.id,{automated:'yes',description:'Repair stale metadata state',updated_by:actor});assert.equal((await cases.getTestCase(native.id)).automation_status,'ready');
   const partial=await cases.createTestCase({app_type_id:app,title:'Partial automation',created_by:actor,automated:'yes',automation_case_type:'api',steps:[{step_type:'api',action:'Mapped request',api_request:{method:'GET',url:'https://fixture.test/'}},{step_type:'api',action:'Unmapped request'}]});
   assert.equal((await cases.getTestCase(partial.id)).automation_status,'incomplete');
   await cases.updateTestCase(partial.id,{automated:'yes',title:'Partial remains incomplete',updated_by:actor});assert.equal((await cases.getTestCase(partial.id)).automation_status,'incomplete');
  });
  const env=await require('../../backend/services/testEnvironment.service').createTestEnvironment({project_id:project,app_type_id:app,name:'Private context',variables:[{key:'password',value:'DO_NOT_EXPORT',is_secret:true},{key:'base_url',value:'https://fixture.test'}]});
  const dataset=await data.createTestDataSet({project_id:project,app_type_id:app,name:'Public inputs',mode:'table',columns:['r.email'],rows:[{'r.email':''}]});
  const run=await runs.createExecution({project_id:project,app_type_id:app,created_by:actor,test_case_ids:[manual.id],test_environment_id:env.id,test_data_set_id:dataset.id});
  await t.test('a blank negative row persists and private context satisfies missing override columns',async()=>{
   assert.equal((await data.getTestDataSet(dataset.id)).rows.length,1);
   const plan=await require('../../backend/services/runParameterPlan.service').buildRunParameterPlan({project_id:project,app_type_id:app,execution_id:run.id});
   assert.equal(plan.data_set_validation.valid,true);assert.doesNotMatch(JSON.stringify(plan),/DO_NOT_EXPORT/);
   assert.equal(plan.parameter_bindings.find(row=>row.name==='r.password').source,'environment');
   const before=(await db.prepare('SELECT count(*)::int AS count FROM executions').get()).count;
   await assert.rejects(runs.createExecution({project_id:project,app_type_id:app,created_by:actor,test_case_ids:[manual.id],test_data_set_id:dataset.id}),{code:'TEST_DATA_MISSING_PARAMETERS'});
   assert.equal((await db.prepare('SELECT count(*)::int AS count FROM executions').get()).count,before,'Rejected data links cannot leave a run without data.');
   await db.prepare('UPDATE test_environments SET variables=? WHERE id=?').run([{key:'password',value:'changed',is_secret:true}],env.id);
   assert.equal((await require('../../backend/services/runParameterPlan.service').buildRunParameterPlan({project_id:project,app_type_id:app,execution_id:run.id})).data_set_validation.valid,true,'Frozen bindings survive live environment changes.');
  });
  const result=randomUUID(),step=(await db.prepare('SELECT snapshot_step_id FROM execution_step_snapshots WHERE execution_id=? ORDER BY step_order').all(run.id))[0].snapshot_step_id;
  await db.prepare("INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,data_set_iteration_index) VALUES(?,?,?,?,'failed',0)").run(result,run.id,manual.id,app);
  const issueService=require('../../backend/services/issues.service');
  const issue=await issueService.createIssue({project_id:project,user_id:actor,title:'Trace fixture',message:'Intentional trace fixture',linked_test_run_id:run.id,linked_execution_result_id:result,linked_step_id:step,linked_test_case_ids:[manual.id]});
  await db.prepare('UPDATE execution_results SET case_defects=?,step_defects=? WHERE id=?').run([issue.id],{[step]:[issue.display_id||((await issueService.getIssueItem(issue.id)).display_id)]},result);
  await t.test('run, case and export deduplicate real defect identities, enforce ACL and validate exact origin',async()=>{
   const projection=require('../../backend/services/executionEvidenceProjection.service');
   const found=(await projection.loadRunDefects([run.id])).get(run.id);assert.equal(found.length,1);assert.ok(found[0].provenance.some(row=>row.source==='step'));
   const visible=await runs.projectExecutionForUser(await runs.getExecution(run.id,true),{id:actor,role:'admin'});assert.equal(visible.metrics.defect_count,1);
   assert.equal(await require('../../../platform/backend/services/permission.service').hasPermission({id:limitedUser,role:'member'},'run.view',project),true);
   const denied=await runs.projectExecutionForUser(visible,{id:limitedUser,role:'member'});assert.equal(denied.metrics.defect_count,null);assert.equal(denied.linked_defects,undefined);
   assert.equal((await require('../../backend/services/testCaseDefect.service').getDefectsForTestCase(manual.id)).length,1);
   const report=await require('../../backend/services/executionReport.service').renderReportHtml(run.id,{user:{id:actor,role:'admin'}});assert.match(report,/Trace fixture/);assert.doesNotMatch(report,/DO_NOT_EXPORT/);
   const deniedHtml=await require('../../backend/services/executionReport.service').renderReportHtml(run.id,{user:{id:limitedUser,role:'member'}});assert.doesNotMatch(deniedHtml,/Trace fixture|BUG-/);
   await assert.rejects(issueService.updateIssue(issue.id,{linked_step_id:'foreign-step'},{actorId:actor}),{code:'DEFECT_ORIGIN_INVALID'});
   assert.equal((await db.prepare('SELECT linked_step_id FROM feedback WHERE id=?').get(issue.id)).linked_step_id,step);
   await issueService.updateIssue(issue.id,{linked_test_run_id:null,linked_execution_result_id:null,linked_step_id:null},{actorId:actor});
   assert.equal((await projection.loadRunDefects([run.id])).get(run.id).length,1,'Stored result evidence still links the defect after its direct run link is cleared.');
   await issueService.deleteIssue(issue.id);assert.equal((await projection.loadRunDefects([run.id])).get(run.id).length,0,'Deleted references do not count as defects.');
   const resultOnly=await issueService.createIssue({project_id:project,user_id:actor,title:'Step-only defect',message:'Linked solely by persisted result evidence'});
   const reference=(await issueService.getIssueItem(resultOnly.id)).display_id;
   await db.prepare('UPDATE execution_results SET case_defects=?,step_defects=? WHERE id=?').run([reference],{[step]:[resultOnly.id]},result);
   const caseDefects=require('../../backend/services/testCaseDefect.service');await caseDefects.syncAutomaticDefectsForTestCase(manual.id);
   assert.equal((await caseDefects.getDefectsForTestCase(manual.id)).length,1);assert.equal((await projection.loadRunDefects([run.id])).get(run.id).length,1);
   await db.prepare('UPDATE execution_results SET case_defects=?,step_defects=? WHERE id=?').run([],{},result);await caseDefects.syncAutomaticDefectsForTestCase(manual.id);
   assert.equal((await caseDefects.getDefectsForTestCase(manual.id)).length,0,'Removing the last evidence reference clears automatic case links.');await issueService.deleteIssue(resultOnly.id);
   assert.ok(await db.prepare("SELECT indexname FROM pg_indexes WHERE indexname='idx_feedback_linked_test_run_id'").get());
  });
  await t.test('failure references share persisted run/case/step projection, frozen instance identity and ACL with the real frontend assessment',async()=>{
   const createdIssues=[];
   try {
   const first=await cases.createTestCase({app_type_id:app,title:'Login failure evidence',created_by:actor,steps:[{action:'Sign in',expected_result:'Accepted'}]});
   const second=await cases.createTestCase({app_type_id:app,title:'Signup failure evidence',created_by:actor,steps:[{action:'Register',expected_result:'Accepted'}]});
   const story=randomUUID();await db.prepare("INSERT INTO requirements(id,project_id,title,status) VALUES(?,?,'Evidence story','open')").run(story,project);
   for(const item of [first,second])await db.prepare('INSERT INTO requirement_test_cases(requirement_id,test_case_id) VALUES(?,?)').run(story,item.id);
   const evidenceRun=await runs.createExecution({project_id:project,app_type_id:app,created_by:actor,test_case_ids:[first.id,second.id]});
   const resultIds=[randomUUID(),randomUUID()];
   for(const [index,item]of [first,second].entries())await db.prepare('INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,data_set_iteration_index) VALUES(?,?,?,?,?,0)').run(resultIds[index],evidenceRun.id,item.id,app,index?'blocked':'failed');
   const linked=[];for(const item of [first,second]){const issue=await issueService.createIssue({project_id:project,user_id:actor,title:'Run-linked failure',message:'Persisted case scope',linked_test_run_id:evidenceRun.id,linked_test_case_ids:[item.id]});linked.push(issue);createdIssues.push(issue);}
   const detail=await runs.projectExecutionForUser(await runs.getExecution(evidenceRun.id,true),{id:actor,role:'admin'});
   assert.equal(detail.failure_evidence.availability,'available');assert.equal(detail.failure_evidence.reference_count,2);
   assert.equal(detail.failure_evidence.referenced_instance_count,2);assert.equal(detail.failure_evidence.instances.length,2);
   assert.ok(detail.failure_evidence.instances.every(row=>row.defects.length===1&&row.coverage==='referenced'));
   assert.ok((await db.prepare('SELECT defects,case_defects FROM execution_results WHERE execution_id=?').all(evidenceRun.id)).every(row=>!row.defects.length&&!row.case_defects.length),'Reproduce direct issue links absent from result arrays.');
   const {loadTsModule}=await import('../../../platform/frontend/test/helpers/loadTsModule.mjs');
   const frontend=loadTsModule(path.resolve(__dirname,'../../frontend/lib/executionFailureEvidence.ts'));
   const assessment=frontend.assessExecutionRunEvidence(detail,{totalCaseCount:0,touchedCaseCount:0,linkedRequirementCount:0,failedCount:0,blockedCount:0});
   assert.equal(assessment.score,100);assert.equal(assessment.scoreDisplay,'100%');assert.equal(assessment.signals.find(row=>row.label==='Failure references').value,'2 captured');
   assert.ok(!assessment.gaps.some(gap=>gap.startsWith('Attach defects')),'Persisted direct links must remove the contradictory triage guidance.');
   const pickerRows=(await runs.getExecutions({project_id:project,app_type_id:app,user:{id:actor,role:'admin'}})).find(row=>row.id===evidenceRun.id);
   assert.equal(pickerRows.failure_evidence,undefined,'The list remains a lightweight summary.');
   const hidden=await runs.projectExecutionForUser(detail,{id:limitedUser,role:'member'});
   assert.equal(hidden.failure_evidence.availability,'partial');assert.equal(hidden.failure_evidence.defect_count,null);assert.equal(hidden.failure_evidence.reference_count,null);
   assert.ok(hidden.failure_evidence.instances.every(row=>!row.defects.length));assert.doesNotMatch(JSON.stringify(hidden.failure_evidence),new RegExp(linked[0].id));
   const hiddenAssessment=frontend.assessExecutionRunEvidence(hidden,{totalCaseCount:0,touchedCaseCount:0,linkedRequirementCount:0,failedCount:0,blockedCount:0});
   assert.equal(hiddenAssessment.scoreDisplay,'Partial evidence');assert.match(frontend.executionFailureReferenceContext(hidden),/unavailable/);assert.doesNotMatch(frontend.executionFailureReferenceContext(hidden),/0 known/);assert.match(hiddenAssessment.signals.find(row=>row.label==='Failure references').value,/unavailable/);assert.doesNotMatch(hiddenAssessment.signals.find(row=>row.label==='Failure references').value,/0 captured/);assert.ok(!hiddenAssessment.gaps.some(gap=>gap.startsWith('Attach defects')));
   const viewOnlyRole=randomUUID(),viewOnlyUser=randomUUID();
   await db.prepare("INSERT INTO users(id,email,password_hash,name,status) VALUES(?,?,'no-login','Run-only fixture','active')").run(viewOnlyUser,`${viewOnlyUser}@example.test`);
   await db.prepare("INSERT INTO roles(id,name) VALUES(?,'Run-only fixture')").run(viewOnlyRole);await db.prepare("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE code='run.view'").run(viewOnlyRole);
   await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(randomUUID(),project,viewOnlyUser,viewOnlyRole);
   const noResults=await runs.projectExecutionForUser(detail,{id:viewOnlyUser,role:'member'});assert.equal(noResults.failure_evidence.availability,'unavailable');assert.equal(noResults.failure_evidence.failed_instance_count,null);assert.deepEqual(noResults.failure_evidence.instances,[]);
   const noResultAssessment=frontend.assessExecutionRunEvidence(noResults,{totalCaseCount:0,touchedCaseCount:0,linkedRequirementCount:0,failedCount:0,blockedCount:0});assert.equal(noResultAssessment.scoreDisplay,'Unavailable');
   assert.match(frontend.executionFailureRiskLines(noResults,[first,second]).join(' '),/unavailable/);assert.doesNotMatch(frontend.executionFailureRiskLines(noResults,[first,second]).join(' '),/No failed/);
   assert.match(frontend.executionFailureRiskLines(hidden,[first,second]).join(' '),/defect reference coverage unavailable/);
   const rows=await data.createTestDataSet({project_id:project,app_type_id:app,name:'Two evidence rows',mode:'table',columns:['label'],rows:[{label:'first'},{label:'second'}]});
   const multi=await runs.createExecution({project_id:project,app_type_id:app,created_by:actor,test_case_ids:[first.id],test_data_set_id:rows.id});
   const old=randomUUID(),current=randomUUID(),other=randomUUID();
   for(const [id,index,date]of [[old,0,'2026-11-15'],[current,0,'2026-11-16'],[other,1,'2026-11-16']])await db.prepare("INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,data_set_iteration_index,created_at) VALUES(?,?,?,?,'failed',?,?)").run(id,multi.id,first.id,app,index,date);
   const oldIssue=await issueService.createIssue({project_id:project,user_id:actor,title:'Earlier attempt only',message:'Exact older origin',linked_test_run_id:multi.id,linked_test_case_ids:[first.id],linked_execution_result_id:old});
   createdIssues.push(oldIssue);
   const broad=await issueService.createIssue({project_id:project,user_id:actor,title:'Case context without row',message:'Scope is deliberately ambiguous',linked_test_run_id:multi.id,linked_test_case_ids:[first.id]});
   createdIssues.push(broad);
   let projected=await runs.projectExecutionForUser(await runs.getExecution(multi.id,true),{id:actor,role:'admin'});
   assert.equal(projected.failure_evidence.instances.length,2);assert.equal(projected.failure_evidence.reference_count,1,'An older exact attempt is not evidence for either current failed row.');
   assert.equal(projected.failure_evidence.referenced_instance_count,null);assert.equal(projected.failure_evidence.ambiguous_instance_count,2);
   assert.ok(projected.failure_evidence.instances.every(row=>row.coverage==='ambiguous'&&row.defects[0].id===broad.id));
   const exact=await issueService.createIssue({project_id:project,user_id:actor,title:'Current row defect',message:'Exact current origin',linked_test_run_id:multi.id,linked_test_case_ids:[first.id],linked_execution_result_id:current});
   createdIssues.push(exact);
   const exactDisplay=(await issueService.getIssueItem(exact.id)).display_id,multiStep=(await db.prepare('SELECT snapshot_step_id FROM execution_step_snapshots WHERE execution_id=?').all(multi.id))[0].snapshot_step_id;
   await db.prepare('UPDATE execution_results SET case_defects=?,step_defects=? WHERE id=?').run([exactDisplay],{[multiStep]:[exact.id]},current);
   projected=await runs.projectExecutionForUser(await runs.getExecution(multi.id,true),{id:actor,role:'admin'});
   assert.equal(projected.failure_evidence.reference_count,2,'IDs, display keys and step origins deduplicate to one defect identity.');
   assert.equal(projected.failure_evidence.ambiguous_instance_count,1);assert.equal(projected.failure_evidence.instances.find(row=>row.result_id===current).coverage,'referenced');
   assert.ok(!projected.failure_evidence.instances.find(row=>row.result_id===other).defects.some(row=>row.id===exact.id),'An exact row defect never fans out to a sibling row.');
   await db.prepare("INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,defects) VALUES(?,?,?,?,'failed',?)").run(randomUUID(),multi.id,second.id,app,[oldIssue.id]);
   projected=await runs.projectExecutionForUser(await runs.getExecution(multi.id,true),{id:actor,role:'admin'});assert.equal(projected.failure_evidence.instances.length,2,'Results outside immutable scope are excluded.');
   await cases.updateTestCase(first.id,{external_references:['SPEC-CASE-CONTEXT'],updated_by:actor});
   const externalRun=await runs.createExecution({project_id:project,app_type_id:app,created_by:actor,test_case_ids:[first.id],test_data_set_id:rows.id});
   const externalIds=[randomUUID(),randomUUID()];for(const [index,id]of externalIds.entries())await db.prepare("INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,data_set_iteration_index) VALUES(?,?,?,?,'failed',?)").run(id,externalRun.id,first.id,app,index);
   let external=await runs.projectExecutionForUser(await runs.getExecution(externalRun.id,true),{id:actor,role:'admin'});
   assert.equal(external.failure_evidence.known_reference_count,1);assert.equal(external.failure_evidence.ambiguous_instance_count,2,'Frozen case references cannot prove either data-row origin.');
   await db.prepare('UPDATE execution_results SET external_references=? WHERE id=?').run(['SPEC-EXACT-RESULT'],externalIds[0]);
   external=await runs.projectExecutionForUser(await runs.getExecution(externalRun.id,true),{id:actor,role:'admin'});
   assert.equal(external.failure_evidence.known_reference_count,2);assert.equal(external.failure_evidence.ambiguous_instance_count,1);
   const ambiguousRun=await runs.createExecution({project_id:project,app_type_id:app,created_by:actor,test_case_ids:[first.id],test_data_set_id:rows.id});
   await db.prepare("INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status) VALUES(?,?,?,?,'failed')").run(randomUUID(),ambiguousRun.id,first.id,app);
   const ambiguous=await runs.projectExecutionForUser(await runs.getExecution(ambiguousRun.id,true),{id:actor,role:'admin'});
   assert.equal(ambiguous.failure_evidence.referenced_instance_count,null);assert.equal(ambiguous.failure_evidence.ambiguous_instance_count,1,'A legacy unindexed attempt must retain unknown row coverage.');
   } finally { for(const issue of createdIssues)await issueService.deleteIssue(issue.id); }
  });
  await t.test('light list uses frozen instances and detail exposes authoritative impacted Story rows',async()=>{
   const list=await runs.getExecutions({project_id:project,app_type_id:app,user:{id:actor,role:'admin'}}),row=list.find(row=>row.id===run.id);
   assert.equal(row.instance_summary.total,1);assert.equal(row.instance_summary.failed,1);assert.equal(row.test_environment_snapshot,undefined);assert.ok(Buffer.byteLength(JSON.stringify(row))<2048,JSON.stringify(row));
   assert.equal((await runs.getExecution(run.id,true)).frozen_scope_evidence.availability,'available');
  });
  await t.test('live suites track new module members, snapshots and old run scope stay fixed',async()=>{
   const moduleId=randomUUID();await db.prepare("INSERT INTO test_case_modules(id,app_type_id,name) VALUES(?,?,'Login')").run(moduleId,app);
   await db.prepare('INSERT INTO test_case_module_cases(module_id,test_case_id,sort_order) VALUES(?,?,1)').run(moduleId,manual.id);
   const snapshot=await suites.createTestSuite({app_type_id:app,name:'Snapshot',module_ids:[moduleId],created_by:actor});
   const live=await suites.createTestSuite({app_type_id:app,name:'Live membership',module_ids:[moduleId],module_membership:'live',created_by:actor});
   const prior=await runs.createExecution({project_id:project,app_type_id:app,created_by:actor,suite_ids:[live.id]});
   const added=await cases.createTestCase({app_type_id:app,title:'New module case',created_by:actor,steps:[{action:'Observe',expected_result:'Visible'}]});
   await db.prepare('INSERT INTO test_case_module_cases(module_id,test_case_id,sort_order) VALUES(?,?,2)').run(moduleId,added.id);
   const members=async id=>(await db.prepare('SELECT test_case_id FROM suite_effective_test_cases WHERE suite_id=?').all(id)).map(row=>row.test_case_id);
   assert.ok((await members(live.id)).includes(added.id));assert.ok(!(await members(snapshot.id)).includes(added.id));
   assert.ok(!(await runs.getExecution(prior.id,true)).test_case_ids.includes(added.id));
   const after=await runs.createExecution({project_id:project,app_type_id:app,created_by:actor,suite_ids:[live.id]});assert.ok((await runs.getExecution(after.id,true)).test_case_ids.includes(added.id));
   await db.prepare('DELETE FROM test_case_module_cases WHERE module_id=? AND test_case_id=?').run(moduleId,added.id);assert.ok(!(await members(live.id)).includes(added.id));
  });
  await t.test('shared case latest outcomes stay inside each Sprint and Release scope',async()=>{
   const sprintA=randomUUID(),sprintB=randomUUID(),storyA=randomUUID(),storyB=randomUUID(),releaseA=randomUUID(),releaseB=randomUUID();
   for(const [id,name] of [[sprintA,'A'],[sprintB,'B']])await db.prepare("INSERT INTO requirement_iterations(id,project_id,name,state) VALUES(?,?,?,'active')").run(id,project,name);
   for(const [id,sprint,title] of [[storyA,sprintA,'Story A'],[storyB,sprintB,'Story B']]){await db.prepare("INSERT INTO requirements(id,project_id,title,iteration_id,status) VALUES(?,?,?,?,'open')").run(id,project,title,sprint);await db.prepare('INSERT INTO requirement_test_cases(requirement_id,test_case_id) VALUES(?,?)').run(id,native.id);}
   for(const [id,name,sprint,story] of [[releaseA,'Release A',sprintA,storyA],[releaseB,'Release B',sprintB,storyB]]){await db.prepare('INSERT INTO requirement_releases(id,project_id,name,fix_version) VALUES(?,?,?,?)').run(id,project,name,name);await db.prepare('INSERT INTO requirement_release_sprints(release_id,iteration_id) VALUES(?,?)').run(id,sprint);await db.prepare("INSERT INTO requirement_release_items(release_id,requirement_id,source) VALUES(?,?,'manual')").run(id,story);}
   for(const [sprint,release,status,date] of [[sprintA,releaseA,'failed','2026-11-15'],[sprintB,releaseB,'passed','2026-11-16']]){const execution=randomUUID();await db.prepare("INSERT INTO executions(id,project_id,app_type_id,iteration_id,release_id,status,trigger) VALUES(?,?,?,?,?,'completed','ci')").run(execution,project,app,sprint,release);await db.prepare('INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title) VALUES(?,?,?)').run(execution,native.id,'Shared API');await db.prepare('INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),execution,native.id,app,status,date);}
   const catalog=require('../../../manual/backend/services/requirementCatalog.service');
   const metricsA=await catalog.getMetrics({project_id:project,sprint_id:sprintA,include_execution:true,include_sprints:true});
   assert.equal(metricsA.sprint_health.find(row=>row.iteration_id===sprintA).passed_cases,0,'A later passing run from Sprint B cannot overwrite Sprint A evidence.');
   const releaseService=require('../../../manual/backend/services/requirementRelease.service');
   assert.equal((await releaseService.getReadiness(releaseA)).passed_cases,0);assert.equal((await releaseService.getReadiness(releaseB)).passed_cases,1);
   const verified=await issueService.createIssue({project_id:project,user_id:actor,title:'Verified defect',message:'Closed-state vocabulary consistency',status:'verified',linked_test_case_ids:[native.id]});
   const storyMetrics=(await catalog.withCatalogMetrics([{id:storyA}],{include_execution:true}))[0].catalog_metrics;
   assert.equal(storyMetrics.open_bugs,0);assert.equal(storyMetrics.closed_bugs,1);assert.equal((await issueService.getIssueMetrics({project_id:project})).open,0);assert.equal((await releaseService.getReadiness(releaseA)).open_bugs,0);
   const portfolio=(await require('../../../dashboard/backend/services/portfolioAnalytics.service').buildPortfolioAnalytics(actor)).projects.find(row=>row.project_id===project);
   assert.equal(portfolio.open_bug_count,0);assert.equal(portfolio.counts.manual_cases+portfolio.counts.automation_cases,portfolio.counts.cases);
   await issueService.deleteIssue(verified.id);
   const impacted=(await runs.getExecution((await db.prepare("SELECT execution_id FROM execution_results WHERE test_case_id=? AND status='failed'").get(native.id)).execution_id,true)).frozen_scope_evidence;
   assert.equal(impacted.total_stories,2);assert.equal(impacted.impacted_stories.length,2);assert.ok(impacted.impacted_stories.every(story=>story.failed_test_case_ids.length===1));
   const immutable=await runs.createExecution({project_id:project,app_type_id:app,created_by:actor,test_case_ids:[native.id]});
   await db.prepare("INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status) VALUES(?,?,?,?,'failed')").run(randomUUID(),immutable.id,native.id,app);
   await db.prepare('DELETE FROM requirement_test_cases WHERE test_case_id=?').run(native.id);
   const savedScope=(await runs.getExecution(immutable.id,true)).frozen_scope_evidence;
   assert.equal(savedScope.total_stories,2,'Later Story relinks cannot rewrite a frozen run impact cohort.');assert.equal(savedScope.story_links_frozen,true);
   await db.prepare("UPDATE executions SET status='failed',ended_at=CURRENT_TIMESTAMP WHERE id=?").run(immutable.id);runs.invalidateExecutionCache(immutable.id);
   const rerun=await runs.rerunExecution(immutable.id,{created_by:actor});
   assert.deepEqual((await db.prepare('SELECT requirement_snapshots FROM execution_case_snapshots WHERE execution_id=?').get(rerun.id)).requirement_snapshots,savedScope.stories.map(({id,display_id,title})=>({id,display_id,title})),'Reruns retain the captured Story cohort after catalog unlink.');
   const legacyRun=randomUUID();await db.prepare("INSERT INTO executions(id,project_id,app_type_id,status,trigger) VALUES(?,?,?,'failed','manual')").run(legacyRun,project,app);
   await db.prepare('INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title) VALUES(?,?,?)').run(legacyRun,native.id,'Legacy unknown Story scope');
   const legacyRerun=await runs.rerunExecution(legacyRun,{created_by:actor});assert.equal((await db.prepare('SELECT requirement_snapshots FROM execution_case_snapshots WHERE execution_id=?').get(legacyRerun.id)).requirement_snapshots,null,'Legacy NULL remains unknown, never backfilled from current links.');

   for(let i=0;i<11;i++){
    const execution=randomUUID();await db.prepare("INSERT INTO executions(id,project_id,app_type_id,status,trigger) VALUES(?,?,?,'completed','ci')").run(execution,project,app);
    await db.prepare('INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title) VALUES(?,?,?)').run(execution,native.id,'Recent automation');
    await db.prepare("INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status) VALUES(?,?,?,?,'passed')").run(randomUUID(),execution,native.id,app);
   }
   const channelSummary=(await require('../../backend/services/testCaseCatalog.service').listPage({app_type_id:app,ids:[manual.id],include_execution:true,projection:'summary'})).items[0];
   assert.equal(channelSummary.recent_results.length,10);assert.ok(channelSummary.recent_results.every(row=>row.derived));
   assert.equal(channelSummary.latest_manual_result.id,result);assert.equal(channelSummary.latest_manual_result.status,'failed');assert.equal(channelSummary.latest_automation_result.status,'passed');


  });
  await t.test('PDF export is provider-independent, byte-correct and independently decodes Unicode',async()=>{
   const reports=require('../../backend/services/executionReport.service');
   await db.prepare("UPDATE executions SET started_at='2026-11-17T09:00:00Z',ended_at='2026-11-17T09:00:02Z' WHERE id=?").run(run.id);runs.invalidateExecutionCache(run.id);
   const start=Date.now();const pdf=await reports.renderReportPdf(run.id,{user:{id:actor,role:'admin'}});assert.ok(Date.now()-start<5000);
   const binary=pdf.toString('latin1');for(const match of binary.matchAll(/\/Length (\d+)[^>]*>>\nstream\n/g)){const begin=match.index+match[0].length;assert.equal(binary.slice(begin+Number(match[1]),begin+Number(match[1])+10),'\nendstream');}
   const out=path.join('/tmp','walkthrough-execution-unicode.pdf');fs.writeFileSync(out,pdf);
   const {spawnSync}=require('node:child_process');const extracted=spawnSync('pdftotext',[out,'-'],{encoding:'utf8'});if(!extracted.error){assert.equal(extracted.status,0,extracted.stderr);assert.doesNotMatch(extracted.stderr,/incorrect stream|Missing endstream/);assert.match(extracted.stdout,/Login — Unicode ≥ 1/);assert.match(extracted.stdout,/2026-11-17 09:00:00 UTC/);assert.doesNotMatch(extracted.stdout,/AI execution analysis|DO_NOT_EXPORT|<p>/);}
  });
 }finally{await Promise.all([db.close(),obs.close()]);}
});
