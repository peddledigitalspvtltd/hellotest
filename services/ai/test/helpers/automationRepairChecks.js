const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createServer}=require('node:http');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
exports.run=async({db,obsDb,user,projectId,appTypeId,modelReview=false,instructionRepair=false})=>{
  const service=require('../../../automation/backend/services/automationRepair.service');
  const executions=require('@hellotest/testing/backend/services/execution.service');
  const dispatch=require('../../../automation/backend/services/testEngineDispatch.service');
  const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<input id="value"><button id="new" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#value\').value===\'good\'?\'Accepted\':\'Rejected\'">Submit</button><p id="result">Waiting</p>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const environmentId=randomUUID(),caseId=randomUUID(),neighborId=randomUUID(),good=randomUUID(),negative=randomUUID(),integrationId=randomUUID();
    await db.prepare('INSERT INTO test_environments(id,project_id,name,base_url) VALUES(?,?,?,?)').run(environmentId,projectId,'Isolated repair fixture',`http://127.0.0.1:${server.address().port}`);
    for(const [id,value] of [[good,'good'],[negative,'bad']])await db.prepare("INSERT INTO test_data_sets(id,project_id,app_type_id,name,mode,rows) VALUES(?,?,?,?,'key_value',?)").run(id,projectId,appTypeId,`Repair ${value}`,[{key:'value',value}]);
    for(const id of [caseId,neighborId])await db.prepare("INSERT INTO test_cases(id,app_type_id,title,automated,automation_status) VALUES(?,?,?,'yes','ready')").run(id,appTypeId,id===caseId?'Repair target':'Neighbor assertion');
    const ids=[randomUUID(),randomUUID(),randomUUID()];
    for(const [i,code] of ['await web.fill("#value", "@r.value");','await web.click("#old");','await web.expectText("#result", "Accepted");'].entries())await db.prepare("INSERT INTO test_steps(id,test_case_id,step_order,action,expected_result,step_type,automation_code) VALUES(?,?,?,?,?,'web',?)").run(ids[i],caseId,i+1,['Enter fixture','Submit form','Check acceptance'][i],i===2?'Valid input must be accepted':'',code);
    await db.prepare("INSERT INTO test_steps(id,test_case_id,step_order,action,expected_result,step_type,automation_code) VALUES(?,?,1,'Check initial state','Initial state must be waiting','web',?)").run(randomUUID(),neighborId,'await web.expectText("#result", "Waiting");');
    await db.prepare("INSERT INTO integrations(id,type,name,base_url,config) VALUES(?,'testengine','Repair fixture engine','http://127.0.0.1:4301',?)").run(integrationId,{project_id:projectId,headless:true,action_timeout_ms:250,assertion_timeout_ms:250,healing_enabled:true,max_repair_attempts:2,web_session_mode:'reuse',web_session_reuse_key:'should-not-reuse',video_mode:'off'});
    const original=await executions.createExecution({project_id:projectId,app_type_id:appTypeId,test_case_ids:[caseId],test_environment_id:environmentId,test_data_set_id:good,build:'repair-fixture-build',created_by:user.id});
    const snapshot=await db.prepare('SELECT * FROM execution_step_snapshots WHERE execution_id=? ORDER BY step_order').all(original.id);
    const sharedProbe={values:{'t.shared_probe':'original-frozen-value'},templates:{'t.shared_probe':'original-template-not-for-regeneration'},privateNames:['t.shared_probe']};
    await db.prepare('UPDATE execution_step_snapshots SET shared_parameter_values=?,shared_parameter_template_values=?,shared_parameter_sensitive_names=? WHERE execution_id=? AND snapshot_step_id=?').run(sharedProbe.values,sharedProbe.templates,sharedProbe.privateNames,original.id,snapshot[0].snapshot_step_id);
    const resultId=randomUUID(), originalLogs={stepStatuses:{[snapshot[0].snapshot_step_id]:'passed',[snapshot[1].snapshot_step_id]:'failed'}};
    await db.prepare("INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,logs) VALUES(?,?,?,?,'failed',?)").run(resultId,original.id,caseId,appTypeId,JSON.stringify(originalLogs));
    if (instructionRepair) {
      const typedLogs={...originalLogs,stepWebDetails:{[snapshot[1].snapshot_step_id]:{provider:'playwright',first_failure:{schema:'web-failure-report/1',code:'navigation_timeout',line:1}}}};
      await db.prepare('UPDATE execution_results SET logs=? WHERE id=?').run(JSON.stringify(typedLogs),resultId);
      try {
        const response=await require('../../../agentic/backend/services/agenticAssistant.service').respond({project_id:projectId,app_type_id:appTypeId,user,agent_id:'automation-repair',mode:'agent',
          integration_id:randomUUID(),inputs:{test_case_id:caseId,execution_id:original.id},prompt:'Diagnose the selected failed automation Run.'});
        assert.equal(response.transaction.status,'completed');
        assert.equal(response.provenance.generation_mode,'deterministic');
        assert.equal(response.result.model_execution.model_calls,0);
        assert.equal(response.result.verification.status,'passed');
        assert.equal(response.result.automation_repair.status,'triaged');
        assert.equal(response.result.automation_repair.triage.route,'timing');
        assert.equal(response.result.automation_repair.patch,undefined);
      } finally {
        await db.prepare('UPDATE execution_results SET logs=? WHERE id=?').run(JSON.stringify(originalLogs),resultId);
      }
    }
    const prepared=await service.prepare({projectId,appTypeId,user,input:{test_case_id:caseId,execution_id:original.id}});
    assert.equal(prepared.status,'eligible',prepared.detail);
    const patch=service.validatePatch(prepared.base,instructionRepair?{kind:'replace_instructions',step_id:ids[1],automation_code:'await web.click("#new");',rationale:'The observed fixture has the new submit control; retain the complete section action and protected assertions.'}:{kind:'replace_locator',step_id:ids[1],new_locator:'#new',rationale:'The supplied fixture uses the new submit button identifier.'});
    const saved=modelReview?(await require('../../../agentic/backend/services/agenticAssistant.service').respond({project_id:projectId,app_type_id:appTypeId,user,agent_id:'automation-repair',mode:'agent',inputs:{test_case_id:caseId,execution_id:original.id},prompt:'Propose a typed locator repair from the supplied captured fixture evidence.'})).result.automation_repair:await service.save(projectId,user,randomUUID(),prepared,patch);
    assert.equal(saved.status,'proposal',JSON.stringify(saved));
    await assert.rejects(service.apply(projectId,saved.id,user),{statusCode:409});
    const plan=await service.plan(projectId,saved.id,user,{neighbor_ids:[neighborId],negative_data_set_id:negative,oracle_step_id:ids[2],fixture_contract:'Dedicated local fixture with a fresh page per run; bad input must be rejected by the protected acceptance assertion.'});
    for(const phase of ['original','patched','negative']){
      const frozen=await db.prepare('SELECT snapshot_step_id,shared_parameter_values,shared_parameter_template_values,shared_parameter_sensitive_names FROM execution_step_snapshots WHERE execution_id=? AND test_case_id=? AND step_order=1').get(plan.validation[phase].id,caseId);
      assert.notEqual(frozen.snapshot_step_id,snapshot[0].snapshot_step_id,'Validation retains its own snapshot IDs');
      assert.deepEqual(frozen.shared_parameter_values,sharedProbe.values,phase+' frozen shared values');
      assert.deepEqual(frozen.shared_parameter_template_values,sharedProbe.templates,phase+' frozen shared templates');
      assert.deepEqual(frozen.shared_parameter_sensitive_names,sharedProbe.privateNames,phase+' shared private flags');
    }
    assert.equal((await service.plan(projectId,saved.id,user,{})).validation.original.id,plan.validation.original.id,'Repeated planning reuses the same pinned Runs');
    await assert.rejects(service.start(projectId,saved.id,user,{phase:'patched'}),{statusCode:409});
    const {createWebRunSession}=await import(pathToFileURL(path.resolve(__dirname,'../../../../testengine/backend/dist/lib/webEngine.js')).href);
    for(const phase of ['original','patched','negative']) {
      await service.start(projectId,saved.id,user,{phase});
      const jobs=await obsDb.prepare('SELECT * FROM test_engine_jobs WHERE execution_id=? ORDER BY id').all(plan.validation[phase].id);
      assert.equal(jobs.length,phase==='patched'?2:1);
      for(let index=0;index<jobs.length;index++){
        const worker_id='repair-browser-fixture';
        const job=await dispatch.leaseNextQueuedJob({worker_id,engine_class:'web'});
        assert.ok(jobs.some(item=>item.id===job?.id));
        assert.equal(job.payload.max_repair_attempts,0);assert.equal(job.payload.session_policy.web.mode,'new');
        if(job.test_case_id===caseId)assert.deepEqual(job.payload.steps.find(step=>step.order===1).shared_parameter_values,sharedProbe.values,'The real runner receives the original frozen shared input');
        await dispatch.startQueuedJob({job_id:job.id,worker_id});
        const session=createWebRunSession(job.payload);let status='passed';
        try{await session.start();for(const step of job.payload.steps){
          const outcome=await session.runStep(step);
          // The real queue worker forwards the web engine's untouched trace
          // inside automation_detail; top-level line_results are not a report
          // contract and would silently discard the assertion provenance.
          await dispatch.reportQueuedStep({job_id:job.id,worker_id,step_id:step.id,...outcome,automation_detail:{
            engine:step.step_type,provider:outcome.web_detail?.provider||session.provider,status:outcome.status,
            code:step.automation_code,line_results:outcome.line_results
          }});
          if (phase==='patched') assert.equal(outcome.status,'passed',`Step ${step.order}: ${outcome.note || 'No runtime detail'}`);
          if(phase==='negative'&&job.test_case_id===caseId&&outcome.status==='failed'){
            assert.ok(outcome.line_results?.some(line=>line.status==='failed'&&line.attempt===1),'The real negative assertion supplies a first-attempt failed line');
            const persisted=await obsDb.prepare('SELECT runtime_state FROM test_engine_jobs WHERE id=?').get(job.id);
            const lines=persisted.runtime_state.logs.stepAutomationDetails[step.id].line_results;
            const proof=rows=>rows.map(({line,status,attempt})=>({line,status,attempt}));
            assert.deepEqual(proof(lines),proof(outcome.line_results),'Persisted assertion provenance comes from the actual browser run');
            assert.equal(outcome.web_detail.first_failure?.schema,'web-failure-report/1');
            assert.deepEqual(persisted.runtime_state.logs.stepWebDetails[step.id].first_failure,outcome.web_detail.first_failure,'Queued evidence keeps the actual browser’s first-failure report');
          }
          if(outcome.status!=='passed'){status='failed';break;}
        }}finally{await session.stop(status);}
        await dispatch.completeQueuedJob({job_id:job.id,worker_id,status});
      }
      const state=await service.load(projectId,saved.id);
      assert.equal(state.verification.checks.find(check=>check.phase===phase).status,'passed',JSON.stringify(state.verification));
    }
    const verified=await service.load(projectId,saved.id);assert.equal(verified.verification.status,'verified');
    const changedRun=plan.validation.patched.id;
    await db.prepare('UPDATE execution_step_snapshots SET automation_code=? WHERE execution_id=? AND test_case_id=? AND step_order=3').run('await web.expectText("#result", "Rejected");',changedRun,caseId);
    await assert.rejects(service.apply(projectId,saved.id,user),{statusCode:409});
    await db.prepare('UPDATE execution_step_snapshots SET automation_code=? WHERE execution_id=? AND test_case_id=? AND step_order=3').run('await web.expectText("#result", "Accepted");',changedRun,caseId);
    const applied=await service.apply(projectId,saved.id,user);assert.equal(applied.applied,true);
    assert.equal((await db.prepare('SELECT automation_code FROM test_steps WHERE id=?').get(ids[1])).automation_code,patch.after);
    assert.equal((await db.prepare('SELECT automation_code FROM test_steps WHERE id=?').get(ids[2])).automation_code,'await web.expectText("#result", "Accepted");');
    assert.equal((await service.apply(projectId,saved.id,user)).applied,true);
  }finally{await new Promise(resolve=>server.close(resolve));}
};

exports.runApi=async({db,obsDb,user,projectId,appTypeId})=>{
  const service=require('../../../automation/backend/services/automationRepair.service');
  const executions=require('@hellotest/testing/backend/services/execution.service');
  const dispatch=require('../../../automation/backend/services/testEngineDispatch.service');
  const {executeApiStepInEngine}=await import(pathToFileURL(path.resolve(__dirname,'../../../../testengine/backend/dist/lib/apiEngine.js')).href);
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    res.statusCode=url.pathname==='/verify'?200:404;
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({accepted:url.pathname==='/verify'&&url.searchParams.get('value')==='good'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const environmentId=randomUUID(),caseId=randomUUID(),stepId=randomUUID(),good=randomUUID(),negative=randomUUID();
    await db.prepare('INSERT INTO test_environments(id,project_id,name,base_url) VALUES(?,?,?,?)').run(environmentId,projectId,'Isolated API repair fixture',`http://127.0.0.1:${server.address().port}`);
    await db.prepare("INSERT INTO integrations(id,type,name,base_url,config) VALUES(?,'testengine','API repair fixture engine','http://127.0.0.1:4301',?)").run(randomUUID(),{project_id:projectId});
    for(const [id,value] of [[good,'good'],[negative,'bad']])await db.prepare("INSERT INTO test_data_sets(id,project_id,app_type_id,name,mode,rows) VALUES(?,?,?,?,'key_value',?)").run(id,projectId,appTypeId,`API repair ${value}`,[{key:'value',value}]);
    await db.prepare("INSERT INTO test_cases(id,app_type_id,title,automated,automation_status,test_data_options) VALUES(?,?,?,'yes','ready',?)").run(caseId,appTypeId,'API repair target',{automation_case_type:'api'});
    const request={method:'GET',url:'/old',follow_redirects:false,query_params:[{key:'value',value:'@r.value'}],validations:[{kind:'status',expected:'200'},{kind:'json_path',target:'$.accepted',expected:'true'}]};
    await db.prepare("INSERT INTO test_steps(id,test_case_id,step_order,action,expected_result,step_type,api_request) VALUES(?,?,1,'GET /verify','The fixture is accepted','api',?)").run(stepId,caseId,request);
    const original=await executions.createExecution({project_id:projectId,app_type_id:appTypeId,test_case_ids:[caseId],test_environment_id:environmentId,test_data_set_id:good,build:'api-repair-fixture-build',created_by:user.id});
    async function runQueue(id,expected){
      const jobs=await obsDb.prepare('SELECT * FROM test_engine_jobs WHERE execution_id=?').all(id);
      assert.equal(jobs.length,1);
      const worker_id='repair-api-fixture';
      const job=await dispatch.leaseNextQueuedJob({worker_id,engine_class:jobs[0].engine_class});
      assert.equal(job?.id,jobs[0].id);
      const [step]=job.payload.steps;
      await dispatch.startQueuedJob({job_id:job.id,worker_id});
      const outcome=await executeApiStepInEngine(job.payload,step);
      assert.equal(outcome.status,expected,outcome.note);
      await dispatch.reportQueuedStep({job_id:job.id,worker_id,step_id:step.id,status:outcome.status,note:outcome.note,duration_ms:outcome.duration_ms,api_detail:outcome.detail});
      await dispatch.completeQueuedJob({job_id:job.id,worker_id,status:outcome.status});
    }
    await executions.startExecution(original.id,{initiated_by:user.id,execution_mode:'remote'});
    await runQueue(original.id,'failed');
    const prepared=await service.prepare({projectId,appTypeId,user,input:{test_case_id:caseId,execution_id:original.id}});
    assert.equal(prepared.status,'eligible',prepared.detail);
    const patch=service.validatePatch(prepared.base,{kind:'replace_api_url',step_id:stepId,new_url:'/verify',rationale:'The authored API requests the fixture verification endpoint on the pinned origin.'});
    const saved=await service.save(projectId,user,randomUUID(),prepared,patch);
    await assert.rejects(service.apply(projectId,saved.id,user),{statusCode:409});
    const plan=await service.plan(projectId,saved.id,user,{neighbor_ids:[],negative_data_set_id:negative,oracle_step_id:stepId,fixture_contract:'Isolated API fixture. A bad input must fail the JSON acceptance assertion.'});
    for (const phase of ['original','patched','negative']) {
      const frozen=await db.prepare('SELECT api_request FROM execution_step_snapshots WHERE execution_id=?').get(plan.validation[phase].id);
      assert.deepEqual(frozen.api_request,{...request,url:phase==='original'?'/old':'/verify'});
      await service.start(projectId,saved.id,user,{phase});
      await runQueue(plan.validation[phase].id,phase==='patched'?'passed':'failed');
    }
    const verified=await service.load(projectId,saved.id);
    assert.equal(verified.status,'verified',JSON.stringify(verified.verification));
    assert.equal((await service.apply(projectId,saved.id,user)).applied,true);
    const after=await db.prepare('SELECT api_request FROM test_steps WHERE id=?').get(stepId);
    const {normalizeApiRequest}=require('@hellotest/platform/backend/src/utils/testStepAutomation');
    assert.deepEqual(after.api_request,normalizeApiRequest({...request,url:'/verify'}));
  } finally {await new Promise(resolve=>server.close(resolve));}
};
