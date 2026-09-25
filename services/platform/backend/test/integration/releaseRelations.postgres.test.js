const assert = require('node:assert/strict');
const test = require('node:test');

test('native Release and Sprint relations preserve scope, history, isolation and deletion in PostgreSQL', {
  skip: process.env.RELEASE_METRICS_POSTGRES !== '1', timeout: 30000
}, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname.slice(1), /^agent_verify_[a-z0-9_]+$/);
  const db = require('../../src/db');
  const service = require('../../../../manual/backend/services/requirementRelease.service');
  const catalog = require('../../../../manual/backend/services/requirementCatalog.service');
  const prefix = `delivery-${Date.now()}`;
  const id = name => `${prefix}-${name}`;
  try {
    for (const name of ['project', 'foreign']) await db.prepare('INSERT INTO projects(id,name) VALUES(?,?)').run(id(name), name);
    await db.prepare('INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,?,?)').run(id('app'),id('project'),'App','web');
    for (const [name, project] of [['sprint','project'],['other-sprint','project'],['foreign-sprint','foreign']]) {
      await db.prepare('INSERT INTO requirement_iterations(id,project_id,name,state) VALUES(?,?,?,?)').run(id(name),id(project),name,'active');
    }
    for (const [name,version,sprints] of [['release','v1',['sprint']],['other-release','v2',[]]]) {
      await db.prepare('INSERT INTO requirement_releases(id,project_id,name,fix_version,sprint_ids) VALUES(?,?,?,?,?::jsonb)')
        .run(id(name),id('project'),name,version,JSON.stringify(sprints.map(id)));
    }
    assert.deepEqual(await db.prepare('SELECT iteration_id FROM requirement_release_sprints WHERE release_id = ?').all(id('release')),[{iteration_id:id('sprint')}]);
    await assert.rejects(db.prepare('UPDATE requirement_releases SET sprint_ids = ?::jsonb WHERE id = ?')
      .run(JSON.stringify([id('foreign-sprint')]),id('release')), /same project/);
    for (const [name,iteration,version] of [['inherited','sprint','v1'],['shared',null,'v2'],['stale',null,'v1'],['legacy',null,'v1']]) {
      await db.prepare('INSERT INTO requirements(id,project_id,title,iteration_id,sprint,fix_version,status) VALUES(?,?,?,?,?,?,?)')
        .run(id(name),id('project'),name,iteration ? id(iteration) : null,iteration,version,'qa_done');
    }
    for (const [release,story,source] of [['release','inherited','sprint'],['release','shared','manual'],['other-release','shared','manual'],['release','stale','sprint']]) {
      await db.prepare('INSERT INTO requirement_release_items(release_id,requirement_id,source) VALUES(?,?,?)').run(id(release),id(story),source);
    }
    const scope = await service.getRelease(id('release'));
    assert.deepEqual([...scope.requirement_ids].sort(),['inherited','legacy','shared'].map(id).sort(), 'manual, inherited and unambiguous legacy scope survive; stale Sprint rows do not');
    for (const [name,story] of [['case-a','inherited'],['case-b','shared']]) {
      await db.prepare('INSERT INTO test_cases(id,app_type_id,title,requirement_id) VALUES(?,?,?,?)').run(id(name),id('app'),name,id(story));
    }
    for (const [name,release,sprint] of [['run','v1','sprint'],['sprint-run',null,'sprint'],['other-run','v2','sprint']]) {
      await db.prepare('INSERT INTO executions(id,project_id,app_type_id,status,release,sprint) VALUES(?,?,?,?,?,?)')
        .run(id(name),id('project'),id('app'),'completed',release,sprint);
    }
    assert.deepEqual(await db.prepare('SELECT release_id,iteration_id FROM executions WHERE id = ?').get(id('run')),
      {release_id:id('release'),iteration_id:id('sprint')});
    await assert.rejects(db.prepare('UPDATE executions SET iteration_id = ? WHERE id = ?').run(id('foreign-sprint'),id('run')), /same project/);
    for (const [name,run,caseName,status,date] of [['result-a','run','case-a','passed','2026-09-01'],['result-b','sprint-run','case-b','passed','2026-09-02'],['foreign-outcome','other-run','case-a','failed','2026-09-03']]) {
      await db.prepare('INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,created_at) VALUES(?,?,?,?,?,?)')
        .run(id(name),id(run),id(caseName),id('app'),status,date);
    }
    const before = await service.getReadiness(id('release'));
    assert.equal(before.passed_cases,2,'Sprint-only runs count, runs explicitly assigned another Release do not');
    const [storyEvidence] = await catalog.withCatalogMetrics([await db.prepare('SELECT * FROM requirements WHERE id = ?').get(id('inherited'))],{include_execution:true});
    assert.equal(storyEvidence.catalog_metrics.passed_cases,1,'Story evidence cannot borrow another Release outcome for the same case');
    await db.prepare('UPDATE requirement_releases SET name = ?, fix_version = ? WHERE id = ?').run('Renamed release','v1-renamed',id('release'));
    await db.prepare('UPDATE requirement_iterations SET name = ? WHERE id = ?').run('Renamed sprint',id('sprint'));
    assert.equal((await service.getReadiness(id('release'))).passed_cases,2,'renaming delivery labels preserves native run evidence');
    assert.equal((await db.prepare('SELECT release FROM executions WHERE id = ?').get(id('run'))).release,'v1','original historical labels are retained');
    await db.prepare('UPDATE requirements SET iteration_id = NULL, sprint = NULL WHERE id = ?').run(id('inherited'));
    assert.equal((await service.getRelease(id('release'))).requirement_ids.includes(id('inherited')),false,'live relation excludes stale materialized membership after direct import changes');

    for (const name of ['duplicate-a','duplicate-b']) await db.prepare('INSERT INTO requirement_releases(id,project_id,name,fix_version) VALUES(?,?,?,?)').run(id(name),id('project'),name,'ambiguous');
    await db.prepare('INSERT INTO executions(id,project_id,status,release) VALUES(?,?,?,?)').run(id('ambiguous-run'),id('project'),'queued','ambiguous');
    await db.prepare('INSERT INTO requirements(id,project_id,title,fix_version) VALUES(?,?,?,?)').run(id('ambiguous-story'),id('project'),'Ambiguous','ambiguous');
    assert.equal((await db.prepare('SELECT release_id FROM executions WHERE id = ?').get(id('ambiguous-run'))).release_id,null);
    assert.equal((await service.getRelease(id('duplicate-a'))).requirement_count,0,'ambiguous legacy tokens are not guessed');
    for (const statement of require('../../src/db/releaseRelationsSchema')) await db.query(statement);
    assert.equal((await db.prepare('SELECT release_id FROM executions WHERE id = ?').get(id('run'))).release_id,id('release'),'idempotent migration preserves native history');
    await db.prepare('UPDATE requirement_releases SET sprint_ids = ?::jsonb WHERE id = ?').run(JSON.stringify([id('sprint'),id('other-sprint')]),id('release'));
    await db.prepare('INSERT INTO executions(id,project_id,app_type_id,status,iteration_id) VALUES(?,?,?,?,?)').run(id('second-sprint-run'),id('project'),id('app'),'completed',id('other-sprint'));
    await db.prepare('UPDATE executions SET test_data_set_snapshot = ?::jsonb WHERE id = ?').run(JSON.stringify({id:'archived-data',name:'Frozen release rows',mode:'table',rows:[{secret:'private-1'},{secret:'private-2'},{secret:'private-3'}]}),id('run'));
    await db.prepare('INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title,test_data_set_snapshot) VALUES(?,?,?,?::jsonb)')
      .run(id('run'),id('case-a'),'Case A',JSON.stringify({mode:'table',rows:[{},{},{}],data_scope_policy:{version:2},parameter_data_layers:{run:{rows:[{secret:'private-1'}]}}}));
    await db.prepare('UPDATE execution_results SET data_set_iteration_index = 0, data_set_iteration_key = ? WHERE id = ?').run('old-row-label',id('result-a'));
    for (const [name,status,row,key,date] of [['retry-row','failed',0,'new-row-label','2026-09-04'],['second-row','passed',1,'new-row-label','2026-09-05'],['future-row','passed',2,'future-row','2999-01-01']]) {
      await db.prepare('INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,data_set_iteration_index,data_set_iteration_key,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(id(name),id('run'),id('case-a'),id('app'),status,row,key,date);
    }
    const Fastify = require('fastify');
    const app = Fastify();
    const projectService = require('../../services/project.service');
    const originalGetProject = projectService.getProject;
    projectService.getProject = async projectId => ({id:projectId});
    try {
      app.decorate('authenticate',async req => {req.user = {id:'reader'};});
      app.decorate('validate',()=>{}); app.decorate('requirePermission',()=>async()=>{});
      await app.register(require('../../../../testing/backend/routes/executionResults.routes'));
      const whole = await app.inject(`/execution-results/release-readiness?project_id=${id('project')}&release_id=${id('release')}&iteration_id=${id('sprint')}`);
      assert.equal(whole.statusCode,200,whole.body);
      const runIds = whole.json().executions.map(run => run.id);
      assert.ok(runIds.includes(id('sprint-run')) && runIds.includes(id('second-sprint-run')),'Release requests include every linked Sprint despite stale Sprint restriction');
      assert.ok(!runIds.includes(id('other-run')),'an explicitly different Release remains excluded');
      const evidence = whole.json();
      const retainedRun = evidence.executions.find(run => run.id === id('run'));
      assert.deepEqual(retainedRun.test_data_set,{id:'archived-data',name:'Frozen release rows'},'Readiness displays saved dataset labels after the catalog item has gone');
      assert.deepEqual(retainedRun.case_snapshots,[{test_case_id:id('case-a'),expected_iterations:3}],'Frozen hierarchy rows retain the full planned denominator');
      assert.deepEqual(evidence.results.filter(result => result.execution_id === id('run')).map(result=>result.id).sort(),[id('retry-row'),id('second-row')].sort(),'Retry identity follows row index, distinct rows survive equal labels, and future attempts are excluded');
      assert.doesNotMatch(whole.body,/private-[123]|parameter_data_layers|data_scope_policy/, 'Only metadata and row counts leave the readiness endpoint');
      const exact = await app.inject(`/execution-results/release-readiness?project_id=${id('project')}&iteration_id=${id('other-sprint')}`);
      assert.equal(exact.statusCode,200,exact.body);
      assert.deepEqual(exact.json().executions.map(run => run.id),[id('second-sprint-run')]);
    } finally { projectService.getProject = originalGetProject; await app.close(); }
    await db.prepare('DELETE FROM requirement_iterations WHERE id IN (?,?)').run(id('sprint'),id('other-sprint'));
    assert.deepEqual((await db.prepare('SELECT sprint_ids FROM requirement_releases WHERE id = ?').get(id('release'))).sprint_ids,[]);
    assert.equal((await db.prepare('SELECT iteration_id FROM executions WHERE id = ?').get(id('run'))).iteration_id,null);
    await db.prepare('DELETE FROM requirement_releases WHERE id = ?').run(id('release'));
    assert.equal((await db.prepare('SELECT release_id FROM executions WHERE id = ?').get(id('run'))).release_id,null,'deleting a Release preserves the execution without a dangling relation');
  } finally {
    await db.prepare('DELETE FROM execution_results WHERE id LIKE ?').run(prefix+'%');
    await db.prepare('DELETE FROM executions WHERE id LIKE ?').run(prefix+'%');
    await db.prepare('DELETE FROM requirement_releases WHERE id LIKE ?').run(prefix+'%');
    await db.prepare('DELETE FROM test_cases WHERE id LIKE ?').run(prefix+'%');
    await db.prepare('DELETE FROM requirements WHERE id LIKE ?').run(prefix+'%');
    await db.prepare('DELETE FROM requirement_iterations WHERE id LIKE ?').run(prefix+'%');
    await db.prepare('DELETE FROM app_types WHERE id LIKE ?').run(prefix+'%');
    await db.prepare('DELETE FROM projects WHERE id LIKE ?').run(prefix+'%');
    await db.close();
  }
});
