const assert = require('node:assert/strict');
const test = require('node:test');

test('Release metrics use complete project links and finalized release outcomes in PostgreSQL', {
  skip: process.env.RELEASE_METRICS_POSTGRES !== '1', timeout:30000
}, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname.slice(1), /^agent_verify_[a-z0-9_]+$/);
  const db = require('../../src/db');
  const service = require('../../src/services/requirementRelease.service');
  const prefix = `releasemetrics-${Date.now()}`;
  const id = value => `${prefix}-${value}`;
  const result = async (name,run,caseName,status,date,index=null) => db.prepare(`
    INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,created_at,data_set_iteration_index)
    VALUES(?,?,?,?,?,?,?)`).run(id(name),id(run),id(caseName),id('app'),status,date,index);
  try {
    await db.prepare('INSERT INTO users(id,email,password_hash,name) VALUES(?,?,?,?)').run(id('user'),id('user')+'@example.test','unused','Release reviewer');
    await db.prepare('INSERT INTO projects(id,name) VALUES(?,?),(?,?)').run(id('project'),'Release project',id('foreign'),'Foreign');
    await db.prepare('INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,?,?),(?,?,?,?)').run(id('app'),id('project'),'App','web',id('foreign-app'),id('foreign'),'Foreign app','web');
    await db.prepare('INSERT INTO requirements(id,project_id,title,status) VALUES(?,?,?,?),(?,?,?,?)').run(id('s1'),id('project'),'Primary Story','qa_done',id('s2'),id('project'),'Shared coverage','open');
    for (const [name,version] of [['release',' v1 '],['no-runs','v2'],['empty','v3']]) {
      await db.prepare('INSERT INTO requirement_releases(id,project_id,name,fix_version) VALUES(?,?,?,?)').run(id(name),id('project'),name,version);
    }
    await db.prepare('INSERT INTO requirement_release_items(release_id,requirement_id) VALUES(?,?),(?,?),(?,?)').run(id('release'),id('s1'),id('release'),id('s2'),id('no-runs'),id('s1'));
    for (const [name,automated,status,app] of [['c1','yes','not_automated','app'],['c2','no','ready','app'],['c3','yes','not_automated','app'],['c4','no','not_automated','app'],['foreign-case','yes','ready','foreign-app']]) {
      await db.prepare('INSERT INTO test_cases(id,app_type_id,title,requirement_id,automated,automation_status) VALUES(?,?,?,?,?,?)').run(id(name),id(app),name,id('s1'),automated,status);
    }
    await db.prepare('INSERT INTO test_cases(id,title,requirement_id) VALUES(?,?,?)').run(id('legacy-null-app'),'Legacy case',id('s2'));
    // Mirrored links and one case shared by Stories must not inflate totals.
    await db.prepare('INSERT INTO requirement_test_cases(requirement_id,test_case_id) VALUES(?,?),(?,?),(?,?)').run(id('s1'),id('c1'),id('s2'),id('c1'),id('s2'),id('foreign-case'));
    for (const [run,project,version] of [['old','project','V1'],['pending','project','v1'],['incomplete','project','v1'],['other-release','project','v10'],['foreign-run','foreign','v1']]) {
      await db.prepare('INSERT INTO executions(id,project_id,app_type_id,status,release) VALUES(?,?,?,?,?)').run(id(run),id(project),id(project==='foreign'?'foreign-app':'app'),'running',version);
    }
    await result('c1-pass','old','c1','passed','2026-09-01');
    await result('c2-pass','old','c2','passed','2026-09-01');
    await result('c3-blocked','old','c3','blocked','2026-09-01');
    await result('c3-pending-retry','old','c3','pending','2026-09-02');
    await result('c1-pending','pending','c1','pending','2026-09-02');
    await result('c4-pending','pending','c4','pending','2026-09-02');
    await result('c1-other','other-release','c1','failed','2026-09-10');
    await result('c1-foreign','foreign-run','c1','failed','2026-09-11');
    await db.prepare('INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title,test_data_set_snapshot) VALUES(?,?,?,?::jsonb)').run(id('incomplete'),id('c2'),'Case2',JSON.stringify({mode:'tabular',rows:[{a:1},{a:2}]}));
    await result('partial-row','incomplete','c2','passed','2026-09-03',0);
    for (const [name,project,status] of [['open','project','open'],['accepted','project',' Accepted '],['completed','project',' Completed '],['fixed','project','FIXED'],['foreign-bug','foreign','open']]) {
      await db.prepare('INSERT INTO feedback(id,project_id,user_id,title,message,status) VALUES(?,?,?,?,?,?)').run(id(name),id(project),id('user'),name,'Evidence',status);
    }
    await db.prepare('INSERT INTO requirement_defects(requirement_id,issue_id) VALUES(?,?),(?,?),(?,?),(?,?)').run(id('s1'),id('open'),id('s2'),id('open'),id('s1'),id('accepted'),id('s1'),id('foreign-bug'));
    await db.prepare('INSERT INTO requirement_defects(requirement_id,issue_id) VALUES(?,?),(?,?)').run(id('s1'),id('completed'),id('s1'),id('fixed'));

    const metrics = await service.getReadiness(id('release'));
    assert.equal(metrics.total_stories,2);
    assert.equal(metrics.covered_stories,2);
    assert.equal(metrics.linked_cases,5,'Union includes direct-only and null-app legacy links and excludes foreign app cases');
    assert.equal(metrics.executed_cases,3,'Pending and incomplete datasets cannot replace finalized outcomes');
    assert.equal(metrics.passed_cases,2);
    assert.equal(metrics.pass_rate_percent,66.7);
    assert.equal(metrics.automated_cases,3);
    assert.equal(metrics.automation_coverage_percent,60);
    assert.equal(metrics.total_bugs,4,'Shared Bugs count once and foreign Bugs are excluded');
    assert.equal(metrics.open_bugs,1,'Accepted, completed and fixed are closed Bug outcomes');
    assert.equal(metrics.bug_density,2);
    assert.equal(metrics.readiness_score,81);
    assert.equal(metrics.readiness_state,'at_risk');
    assert.deepEqual(metrics.story_metrics[id('s1')],{linked_cases:4,executed_cases:3,passed_cases:2,pass_rate_percent:66.7,automated_cases:3,automation_coverage_percent:75,total_bugs:4,open_bugs:1,readiness_score:78});
    assert.equal(metrics.story_metrics[id('s2')].linked_cases,2);
    assert.equal(metrics.story_metrics[id('s2')].readiness_score,95);

    await result('failed-row','incomplete','c2','failed','2026-09-03',1);
    const mixed = await service.getReadiness(id('release'));
    assert.equal(mixed.executed_cases,3);
    assert.equal(mixed.passed_cases,1,'One failed dataset row prevents a passing case outcome');
    await result('failed-row-retry','incomplete','c2','pending','2026-09-04',1);
    const retrying = await service.getReadiness(id('release'));
    assert.equal(retrying.executed_cases,3);
    assert.equal(retrying.passed_cases,1,'A pending retry cannot erase a finalized failed dataset outcome');
    const noRuns = await service.getReadiness(id('no-runs'));
    assert.equal(noRuns.pass_rate_percent,null);
    assert.equal(noRuns.readiness_score,null);
    assert.equal(noRuns.story_metrics[id('s1')].readiness_score,null);
    const empty = await service.getReadiness(id('empty'));
    assert.equal(empty.total_stories,0);
    assert.equal(empty.readiness_score,null);
    assert.deepEqual(empty.story_metrics,{});
    const notes = await service.generateReleaseNotes(id('release'));
    assert.equal(notes.story_evaluations.find(row=>row.id===id('s1')).linked_cases,4);
    assert.equal(notes.story_evaluations.find(row=>row.id===id('s1')).open_bugs,1);
    const today = new Date(); today.setUTCHours(0,0,0,0);
    await db.prepare('UPDATE requirement_releases SET target_date = ?, state = ? WHERE id = ?').run(today.toISOString(),'in_progress',id('empty'));
    assert.equal((await service.getRelease(id('empty'))).state,'in_progress','A target due today is not overdue at midnight');
    await db.prepare('UPDATE requirement_releases SET target_date = ? WHERE id = ?').run(new Date(today.getTime()-86400000).toISOString(),id('empty'));
    assert.equal((await service.getRelease(id('empty'))).state,'overdue');
    await db.prepare('UPDATE requirements SET status = ? WHERE id = ?').run(' QA--Done ',id('s1'));
    assert.equal((await service.updateRelease(id('no-runs'),{state:'released'})).release.persisted_state,'released','Completion guard agrees with normalized metric statuses');
  } finally {
    await db.prepare('DELETE FROM execution_results WHERE id LIKE ?').run(prefix+'%');
    await db.prepare('DELETE FROM executions WHERE id LIKE ?').run(prefix+'%');
    await db.prepare('DELETE FROM requirement_releases WHERE id LIKE ?').run(prefix+'%');
    await db.prepare('DELETE FROM test_cases WHERE id LIKE ?').run(prefix+'%');
    await db.prepare('DELETE FROM feedback WHERE id LIKE ?').run(prefix+'%');
    await db.prepare('DELETE FROM requirements WHERE id LIKE ?').run(prefix+'%');
    await db.prepare('DELETE FROM app_types WHERE id LIKE ?').run(prefix+'%');
    await db.prepare('DELETE FROM projects WHERE id LIKE ?').run(prefix+'%');
    await db.prepare('DELETE FROM users WHERE id = ?').run(id('user'));
    await db.close();
  }
});
