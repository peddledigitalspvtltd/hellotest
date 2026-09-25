const assert = require('node:assert/strict');
const test = require('node:test');
test('Shared Step metrics use exact reuse, frozen step outcomes and truthful missing isolation evidence', {skip:process.env.RELEASE_METRICS_POSTGRES !== '1',timeout:30000}, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname.slice(1), /^agent_verify_[a-z0-9_]+$/);
  const db = require('../../src/db');
  const service = require('../../../../testing/backend/services/sharedStepMetrics.service');
  const groups = require('../../../../testing/backend/services/sharedStepGroup.service');
  const now = new Date('2026-09-20T12:00:00Z');
  try {
    for (const p of ['p','foreign']) await db.prepare('INSERT INTO projects(id,name) VALUES(?,?)').run(p,p);
    for (const [a,p] of [['a','p'],['foreign-a','foreign']]) await db.prepare('INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,?,?)').run(a,p,a,'web');
    for (const [g,a] of [['g1','a'],['g2','a'],['foreign-g','foreign-a']]) await db.prepare('INSERT INTO shared_step_groups(id,app_type_id,name) VALUES(?,?,?)').run(g,a,g);
    for (const [c,a] of [['c1','a'],['c2','a'],['foreign-c','foreign-a']]) await db.prepare('INSERT INTO test_cases(id,app_type_id,title) VALUES(?,?,?)').run(c,a,c);
    for (const [s,c,g] of [['s1','c1','g1'],['s2','c1','g2'],['s3','c2',null],['s4','c1','g1'],['foreign-s','foreign-c','g1']]) await db.prepare('INSERT INTO test_steps(id,test_case_id,step_order,reusable_group_id) VALUES(?,?,1,?)').run(s,c,g);
    for (const [r,p,a] of [['r1','p','a'],['r2','p','a'],['foreign-r','foreign','foreign-a']]) await db.prepare('INSERT INTO executions(id,project_id,app_type_id,status) VALUES(?,?,?,?)').run(r,p,a,'completed');
    for (const [r,c,s,g] of [['r1','c1','s1','g1'],['r1','c1','s2','g2'],['r1','c2','s3','g1'],['r2','c1','s1','g1'],['foreign-r','foreign-c','foreign-s','g1']]) await db.prepare('INSERT INTO execution_step_snapshots(execution_id,test_case_id,snapshot_step_id,step_order,reusable_group_id) VALUES(?,?,?,1,?)').run(r,c,s,g);
    const results = [
      ['old','r1','c1','a',0,{s1:'passed',s2:'passed'},'2026-09-01'],
      ['latest','r1','c1','a',0,{s1:'failed',s2:'passed'},'2026-09-02'],
      ['row2','r1','c1','a',1,{s1:'passed',s2:'blocked'},'2026-09-03'],
      ['second-case','r1','c2','a',0,{s3:'failed'},'2026-09-02'],
      ['another-run','r2','c1','a',0,{s1:'passed'},'2026-09-04'],
      ['outside-window','r1','c1','a',2,{s1:'failed'},'2026-01-01'],
      ['foreign-result','foreign-r','foreign-c','foreign-a',0,{'foreign-s':'failed'},'2026-09-04']
    ];
    for (const [id,r,c,a,iteration,statuses,date] of results) await db.prepare('INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,data_set_iteration_index,logs,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,r,c,a,'failed',iteration,JSON.stringify({stepStatuses:statuses}),date);
    await db.prepare('INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,data_set_iteration_index,logs,created_at) VALUES(?,?,?,?,?,?,?,?)').run('plain','r1','c1','a','failed',3,'legacy text is not JSON','2026-09-05');
    const metrics = await service.getSharedStepMetrics({app_type_id:'a',project_id:'p',now});
    assert.equal(metrics.total_repository_steps,4);
    assert.equal(metrics.shared_step_references,3,'the same group used twice in one case contributes two occurrences');
    assert.equal(metrics.reused_case_count,1,'case using two groups counts once; foreign links do not count');
    assert.equal(metrics.shared_steps_executed,5,'latest attempts and data rows count; blocked, malformed logs, foreign and old results do not');
    assert.equal(metrics.reusability_index,75,'three shared references among four authored case steps; execution frequency is irrelevant');
    assert.equal(metrics.failure_cluster_count,1);
    assert.equal(metrics.mtti_ms,null);
    const g1=metrics.groups.find(g=>g.id==='g1'),g2=metrics.groups.find(g=>g.id==='g2');
    assert.equal(g1.failed_steps,2);assert.equal(g1.failed_cases,2,'snapshot membership survives unlinking from current case');
    assert.equal(g2.failed_steps,0,'case status failed does not turn a passed shared step into a failed step');
    assert.equal(g1.case_count,1);assert.equal(g2.case_count,1);
    const listed=await groups.listSharedStepGroups({app_type_id:'a'});
    assert.equal(listed.find(g=>g.id==='g1').usage_count,1,'usage excludes invalid cross-application link');
    const hidden=await service.getSharedStepMetrics({app_type_id:'a',project_id:'p',now,include_execution:false});
    assert.equal(hidden.reusability_index,75,'reuse remains visible without run access');assert.equal(hidden.shared_steps_executed,null);
    assert.ok(hidden.groups.every(g=>g.failed_steps===undefined && g.failure_evidence===undefined));
    // A native step outcome supersedes the corresponding manual log; it does
    // not count the same observation twice.
    await db.prepare('INSERT INTO test_case_runs(id,run_id,test_case_id,data_set_iteration_index,status) VALUES(?,?,?,?,?)').run('native-case-row0','r2','c1',0,'failed');
    await db.prepare('INSERT INTO step_runs(id,run_id,test_case_run_id,step_id,status,created_at,finished_at) VALUES(?,?,?,?,?,?,?)').run('native','r2','native-case-row0','s1','failed','2026-09-04','2026-09-04');
    const native=await service.getSharedStepMetrics({app_type_id:'a',project_id:'p',now});
    assert.equal(native.shared_steps_executed,5);assert.equal(native.groups.find(g=>g.id==='g1').failed_steps,3);
    // Native row 0 must not suppress manual row 1 in the same run/case/step.
    await db.prepare('INSERT INTO test_case_runs(id,run_id,test_case_id,data_set_iteration_index,status) VALUES(?,?,?,?,?)').run('mixed-case-row0','r1','c1',0,'passed');
    await db.prepare('INSERT INTO step_runs(id,run_id,test_case_run_id,step_id,status,created_at,finished_at) VALUES(?,?,?,?,?,?,?)').run('mixed-native','r1','mixed-case-row0','s1','passed','2026-09-03','2026-09-03');
    const mixed = await service.getSharedStepMetrics({app_type_id:'a',project_id:'p',now});
    assert.equal(mixed.shared_steps_executed,5,'native row0 replaces only row0; manual row1 remains counted');
    assert.equal(mixed.groups.find(g=>g.id==='g1').failed_steps,2,'native row0 pass replaces its failure without hiding another row');
    for (const key of ['alpha','beta']) await db.prepare('INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,data_set_iteration_key,logs,created_at) VALUES(?,?,?,?,?,?,?,?)').run('key-'+key,'r2','c1','a','failed',key,JSON.stringify({stepStatuses:{s1:'failed'}}),'2026-09-06');
    await db.prepare('INSERT INTO test_case_runs(id,run_id,test_case_id,data_set_iteration_index,data_set_iteration_key,status) VALUES(?,?,?,?,?,?)').run('key-native-case','r2','c1',2,'alpha','passed');
    await db.prepare('INSERT INTO step_runs(id,run_id,test_case_run_id,step_id,status,created_at,finished_at) VALUES(?,?,?,?,?,?,?)').run('key-native','r2','key-native-case','s1','passed','2026-09-06','2026-09-06');
    const keyed = await service.getSharedStepMetrics({app_type_id:'a',project_id:'p',now});
    assert.equal(keyed.shared_steps_executed,7,'a shared explicit key matches when one source lacks the index; another key is retained');
    assert.equal(keyed.groups.find(g=>g.id==='g1').failed_steps,3);
    // A native retry with a new case-run ID but the same explicit data-row index
    // remains one latest outcome, rather than a second execution instance.
    await db.prepare('INSERT INTO test_case_runs(id,run_id,test_case_id,data_set_iteration_index,data_set_iteration_key,status) VALUES(?,?,?,?,?,?)').run('retry-native-case','r2','c1',2,'alpha','passed');
    await db.prepare('INSERT INTO step_runs(id,run_id,test_case_run_id,step_id,status,created_at,finished_at) VALUES(?,?,?,?,?,?,?)').run('retry-native','r2','retry-native-case','s1','passed','2026-09-07','2026-09-07');
    assert.equal((await service.getSharedStepMetrics({app_type_id:'a',project_id:'p',now})).shared_steps_executed,7);
    await db.prepare('INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,logs,created_at) VALUES(?,?,?,?,?,?,?)').run('legacy-default','r2','c1','a','passed',JSON.stringify({stepStatuses:{s1:'passed'}}),'2026-09-08');
    await db.prepare('INSERT INTO step_runs(id,run_id,step_id,status,created_at,finished_at) VALUES(?,?,?,?,?,?)').run('legacy-native','r2','s1','failed','2026-09-08','2026-09-08');
    const legacy = await service.getSharedStepMetrics({app_type_id:'a',project_id:'p',now});
    assert.equal(legacy.shared_steps_executed,8,'an unidentified native outcome only replaces the legacy/default manual outcome, leaving identified rows intact');
    assert.equal(legacy.groups.find(g=>g.id==='g1').failed_steps,4);
    await db.prepare('DELETE FROM execution_results WHERE id = ?').run('legacy-default');
    const ambiguous = await service.getSharedStepMetrics({app_type_id:'a',project_id:'p',now});
    assert.equal(ambiguous.shared_steps_executed,null,'unknown native-to-identified-manual correspondence cannot invent a distinct total');
    assert.equal(ambiguous.reusability_index,75,'ambiguous execution identities do not affect authored reuse');assert.equal(ambiguous.execution_visible,true);
    assert.match(ambiguous.execution_evidence_reason,/no data-row identity/);
    assert.equal(ambiguous.reused_case_count,1);assert.equal(ambiguous.total_repository_steps,4,'exact repository counts remain available');
    const uncertain = ambiguous.groups.find(g=>g.id==='g1');
    for (const field of ['executed_steps','passed_steps','failed_steps']) assert.equal(uncertain[field],null);
    assert.match(uncertain.execution_evidence_reason,/cannot be determined/);
    assert.equal(ambiguous.groups.find(g=>g.id==='g2').executed_steps,1,'unaffected group evidence remains available');

    await db.prepare('INSERT INTO users(id,email,password_hash) VALUES(?,?,?)').run('defect-author','shared-defects@example.test','not-a-login');
    const addDefect = async (id, project, run, cases, status = 'open') => db.prepare(`
      INSERT INTO feedback(id,project_id,user_id,title,message,status,linked_test_run_id,linked_test_case_ids)
      VALUES(?,?,'defect-author',?,'Shared failure investigation',?,?,?)
    `).run(id,project,id,status,run,JSON.stringify(cases));
    await addDefect('open-matching','p','r1',['c1']);
    await db.prepare("INSERT INTO test_case_defects(test_case_id,issue_id,link_source) VALUES('c1','open-matching','manual')").run();
    await addDefect('closed-matching','p','r1',['c1'],'closed');
    await addDefect('resolved-matching','p','r1',['c1'],'resolved');
    await addDefect('case-only','p',null,['c1']);
    await addDefect('run-only','p','r1',[]);
    await addDefect('wrong-case','p','r2',['c2']);
    await addDefect('wrong-project','foreign','r1',['c1']);
    await addDefect('foreign-run','p','foreign-r',['foreign-c']);
    let defects = await service.getSharedStepMetrics({app_type_id:'a',project_id:'p',now});
    assert.equal(defects.open_defect_count,1,'run AND case AND a failed shared snapshot step are required; closed and cross-project links never count');
    assert.equal(defects.groups.find(g=>g.id==='g1').open_defect_count,1,'historical failed snapshot persists after a passing retry and current step unlink');
    assert.equal(defects.groups.find(g=>g.id==='g2').open_defect_count,0,'a passed shared step is not blamed for another step failing in the same case');
    assert.deepEqual(defects.open_defect_evidence.map(d=>d.issue_id),['open-matching'],'legacy JSON plus relational links deduplicate');
    assert.equal(defects.open_defect_evidence[0].snapshot_step_id,'s1');

    await db.prepare('INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,data_set_iteration_index,logs,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('older-second-group-failure','r1','c1','a','failed',0,JSON.stringify({stepStatuses:{s2:'failed'}}),'2026-01-01');
    defects = await service.getSharedStepMetrics({app_type_id:'a',project_id:'p',now});
    assert.equal(defects.open_defect_count,1,'the same defect counts once overall even when several groups have failed');
    assert.equal(defects.groups.find(g=>g.id==='g2').open_defect_count,1,'open defects retain failure evidence outside the 90-day execution metric window');

    await db.prepare("INSERT INTO executions(id,project_id,app_type_id,status) VALUES('native-defect-run','p','a','completed')").run();
    await db.prepare("INSERT INTO execution_step_snapshots(execution_id,test_case_id,snapshot_step_id,step_order,reusable_group_id) VALUES('native-defect-run','c2','native-shared-step',1,'g1')").run();
    await db.prepare("INSERT INTO test_case_runs(id,run_id,test_case_id,status) VALUES('native-defect-case','native-defect-run','c2','failed')").run();
    await db.prepare("INSERT INTO step_runs(id,run_id,test_case_run_id,step_id,status) VALUES('native-defect-step','native-defect-run','native-defect-case','native-shared-step','failed')").run();
    await addDefect('native-only-defect','p','native-defect-run',[],'reopened');
    await db.prepare("INSERT INTO test_case_defects(test_case_id,issue_id,link_source) VALUES('c2','native-only-defect','manual')").run();
    defects = await service.getSharedStepMetrics({app_type_id:'a',project_id:'p',now});
    assert.equal(defects.open_defect_count,2,'native step failures and canonical-only defect links count');
    // Exact step links are authoritative even when the Defect has no run/case
    // metadata, and prevent another failed group from receiving the same Defect.
    await addDefect('exact-step-defect','p',null,[]);
    await db.prepare("UPDATE execution_results SET step_defects = ? WHERE id = 'latest'").run({s1:['exact-step-defect'],s2:['open-matching']});
    defects = await service.getSharedStepMetrics({app_type_id:'a',project_id:'p',now});
    assert.equal(defects.open_defect_count,3,'explicit step links do not require duplicate Defect run metadata');
    assert.equal(defects.groups.find(g=>g.id==='g1').open_defect_count,2,'exact link to group 2 excludes the generic link to group 1');
    assert.equal(defects.groups.find(g=>g.id==='g2').open_defect_count,1);
    assert.equal(defects.open_defect_evidence.find(d=>d.issue_id==='exact-step-defect').snapshot_step_id,'s1');
    await db.prepare("UPDATE execution_results SET step_defects = ? WHERE id = 'latest'").run({s1:['exact-step-defect','wrong-project','closed-matching'],s2:['open-matching']});
    assert.equal((await service.getSharedStepMetrics({app_type_id:'a',project_id:'p',now})).open_defect_count,3,'exact links cannot expose foreign or closed Defects');
    for (const visibility of [{include_execution:false},{include_defects:false}]) {
      const hiddenDefects = await service.getSharedStepMetrics({app_type_id:'a',project_id:'p',now,...visibility});
      assert.equal(hiddenDefects.open_defect_count,null);
      assert.equal(hiddenDefects.defects_visible,false);
      assert.deepEqual(hiddenDefects.open_defect_evidence,[]);
      assert.ok(hiddenDefects.groups.every(g=>g.open_defect_count===null));
    }
    await db.prepare("UPDATE feedback SET status = 'closed' WHERE id IN ('open-matching','native-only-defect','exact-step-defect')").run();
    assert.equal((await service.getSharedStepMetrics({app_type_id:'a',project_id:'p',now})).open_defect_count,0,'closing a defect immediately removes it from the metric');
    const noExecution = {app_type_id:'a',project_id:'p',now,include_execution:false,include_defects:false};
    const wrongProject = await service.getSharedStepMetrics({...noExecution,project_id:'foreign'});
    assert.equal(wrongProject.total_repository_steps,0,'application counts must also match the requested project');
    assert.equal(wrongProject.reusability_index,null);
    assert.deepEqual(wrongProject.groups,[]);
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES('sibling-a','p','Sibling','web')").run();
    await db.prepare("INSERT INTO test_cases(id,app_type_id,title) VALUES('sibling-c','sibling-a','Other application')").run();
    await db.prepare("INSERT INTO test_steps(id,test_case_id,step_order) VALUES('sibling-s','sibling-c',1)").run();
    assert.equal((await service.getSharedStepMetrics(noExecution)).reusability_index,75,'other applications in the same project do not affect the ratio');
    await db.prepare("DELETE FROM test_steps WHERE test_case_id IN ('c1','c2')").run();
    assert.equal((await service.getSharedStepMetrics(noExecution)).reusability_index,null,'no steps means no percentage');
    await db.prepare("INSERT INTO test_steps(id,test_case_id,step_order) VALUES('standalone','c1',1)").run();
    assert.equal((await service.getSharedStepMetrics(noExecution)).reusability_index,0,'standalone steps with no references mean zero reuse');
    for (const id of ['repeat-1','repeat-2']) await db.prepare("INSERT INTO test_steps(id,test_case_id,step_order,reusable_group_id) VALUES(?,'c1',2,'g1')").run(id);
    const repeated = await service.getSharedStepMetrics(noExecution);
    assert.equal(repeated.shared_step_references,2);
    assert.equal(repeated.reused_case_count,1);
    assert.equal(repeated.reusability_index,66.7,'every occurrence counts, rounded to one decimal place');
  } finally { await db.close(); await require('../../src/obsDb').close(); }
});
