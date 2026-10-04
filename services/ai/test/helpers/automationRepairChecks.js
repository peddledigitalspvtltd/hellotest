const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createServer}=require('node:http');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
exports.run=async({db,obsDb,user,projectId,appTypeId,modelReview=false})=>{
  const service=require('../../backend/services/automationRepair.service');
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
    await db.prepare("INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,logs) VALUES(?,?,?,?,'failed',?)").run(randomUUID(),original.id,caseId,appTypeId,JSON.stringify({stepStatuses:{[snapshot[0].snapshot_step_id]:'passed',[snapshot[1].snapshot_step_id]:'failed'}}));
    const prepared=await service.prepare({projectId,appTypeId,user,input:{test_case_id:caseId,execution_id:original.id}});
    assert.equal(prepared.status,'eligible',prepared.detail);
    const patch=service.validatePatch(prepared.base,{kind:'replace_locator',step_id:ids[1],new_locator:'#new',rationale:'The supplied fixture uses the new submit button identifier.'});
    const saved=modelReview?(await require('../../../agentic/backend/services/agenticAssistant.service').respond({project_id:projectId,app_type_id:appTypeId,user,agent_id:'automation-repair',mode:'agent',inputs:{test_case_id:caseId,execution_id:original.id},prompt:'Propose a typed locator repair from the supplied captured fixture evidence.'})).result.automation_repair:await service.save(projectId,user,randomUUID(),prepared,patch);
    assert.equal(saved.status,'proposal',JSON.stringify(saved));
    await assert.rejects(service.apply(projectId,saved.id,user),{statusCode:409});
    const plan=await service.plan(projectId,saved.id,user,{neighbor_ids:[neighborId],negative_data_set_id:negative,oracle_step_id:ids[2],fixture_contract:'Dedicated local fixture with a fresh page per run; bad input must be rejected by the protected acceptance assertion.'});
    assert.equal((await service.plan(projectId,saved.id,user,{})).validation.original.id,plan.validation.original.id,'Repeated planning reuses the same pinned Runs');
    await assert.rejects(service.start(projectId,saved.id,user,{phase:'patched'}),{statusCode:409});
    const {createWebRunSession}=await import(pathToFileURL(path.resolve(__dirname,'../../../../testengine/backend/dist/lib/webEngine.js')).href);
    for(const phase of ['original','patched','negative']) {
      await service.start(projectId,saved.id,user,{phase});
      const jobs=await obsDb.prepare('SELECT * FROM test_engine_jobs WHERE execution_id=? ORDER BY id').all(plan.validation[phase].id);
      assert.equal(jobs.length,phase==='patched'?2:1);
      for(const job of jobs){
        assert.equal(job.payload.max_repair_attempts,0);assert.equal(job.payload.session_policy.web.mode,'new');
        await dispatch.startQueuedJob({job_id:job.id,worker_id:'repair-browser-fixture'});
        const session=createWebRunSession(job.payload);let status='passed';
        try{await session.start();for(const step of job.payload.steps){const outcome=await session.runStep(step);await dispatch.reportQueuedStep({job_id:job.id,step_id:step.id,...outcome});if(outcome.status!=='passed'){status='failed';break;}}}finally{await session.stop(status);}
        await dispatch.completeQueuedJob({job_id:job.id,status});
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
