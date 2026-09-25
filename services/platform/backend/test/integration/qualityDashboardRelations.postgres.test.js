const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('dashboard joins honor native delivery scope, legacy test links and project boundaries in PostgreSQL', {
  skip: process.env.DASHBOARD_RELATIONS_POSTGRES !== '1', timeout: 120000
}, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname.slice(1), /^agent_verify_dashboard_[a-z0-9_]+$/);
  const db = require('../../src/db');
  const analytics = require('../../../../dashboard/backend/services/qualityAnalytics.service');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null, 'Disposable empty database required');
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../instance-setup-data/schema-setup/schema.sql'),'utf8'));
    await require('../../src/db/bootstrap').ensureRuntimeSchema();
    await db.query(`
      INSERT INTO users(id,email,password_hash,name) VALUES('u','dashboard-check@example.test','not-a-login','Reviewer');
      INSERT INTO projects(id,name) VALUES('p','Dashboard project'),('foreign','Foreign project');
      INSERT INTO app_types(id,project_id,name,type) VALUES('app','p','App','web'),('foreign-app','foreign','Foreign app','web');
      INSERT INTO requirement_iterations(id,project_id,name) VALUES('sprint','p','Renamed Sprint');
      INSERT INTO requirement_releases(id,project_id,name,fix_version,sprint_ids) VALUES('rel','p','Renamed Release','release-v2','["sprint"]'),('other','p','Other Release','other','[]'),('foreign-rel','foreign','Renamed Release','release-v2','[]');
      INSERT INTO requirements(id,project_id,title,status,iteration_id,sprint,release) VALUES
        ('story','p','Native sprint story','qa_done','sprint','Old Sprint','Old Release'),
        ('manual','p','Manual release story','dev_done',NULL,NULL,'Old Release'),
        ('outside','p','Outside story','open',NULL,NULL,NULL),
        ('foreign-story','foreign','Foreign story','qa_done',NULL,NULL,NULL);
      INSERT INTO requirement_release_items(release_id,requirement_id,source) VALUES('rel','manual','manual');
      INSERT INTO test_cases(id,app_type_id,title,requirement_id) VALUES('case','app','Passing case','story'),('case2','app','Manual story case','manual'),('orphan','app','Unlinked case',NULL),('foreign-case','foreign-app','Foreign case','foreign-story');
      INSERT INTO test_cases(id,title,requirement_id) VALUES('legacy-case','Legacy case without application','manual');
      INSERT INTO requirement_test_cases(requirement_id,test_case_id) VALUES('story','case'),('manual','case'),('story','foreign-case');
      INSERT INTO executions(id,project_id,app_type_id,status,release_id,iteration_id,release) VALUES
        ('run','p','app','passed','rel','sprint','Old Release'),('other-run','p','app','failed','other',NULL,'other'),('foreign-run','foreign','foreign-app','passed','foreign-rel',NULL,'release-v2');
      INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,created_at) VALUES
        ('result','run','case','app','passed','2026-01-01'),('result2','run','case2','app','passed','2026-01-01'),
        ('legacy-result','run','legacy-case','app','passed','2026-01-01'),
        ('latest-other-release','other-run','case','app','failed','2026-02-01'),
        ('foreign-result','foreign-run','case','app','failed','2026-03-01');
      INSERT INTO feedback(id,project_id,user_id,title,message,status) VALUES('defect','p','u','Open linked defect','Evidence','open'),('resolved','p','u','Fixed defect','Evidence','fixed'),('foreign-defect','foreign','u','Foreign defect','Evidence','open');
      INSERT INTO test_case_defects(test_case_id,issue_id) VALUES('case','defect'),('case','foreign-defect');
      INSERT INTO requirement_defects(requirement_id,issue_id) VALUES('manual','resolved');
    `);
    const evaluate = (metric, release='rel',type='metric',group_by='status') => analytics.evaluateGadget({projectId:'p',gadget:{metric,release,type,group_by}});
    const context=await analytics.loadContext('p','rel');
    assert.deepEqual(context.requirements.map(item=>item.id).sort(),['manual','story']);
    assert.deepEqual(context.testCases.map(item=>item.id).sort(),['case','case2','legacy-case']);
    assert.deepEqual(context.executions.map(item=>item.id),['run']);
    assert.ok(context.results.every(item=>item.execution_id==='run' && item.status==='passed'));
    assert.equal((await evaluate('requirementCoverage')).value,100);
    assert.equal((await evaluate('storyTestPassRate')).value,100);
    assert.equal((await evaluate('devStoryCompletion')).value,100);
    assert.equal((await evaluate('qaStoryCompletion')).value,50);
    assert.equal((await evaluate('storiesWithOpenDefects')).value,2,'A shared test exposes its defect to both linked stories');
    assert.equal((await evaluate('linkedDefects')).value,2,'Foreign defects excluded; fixed defects remain traceable');
    assert.equal((await evaluate('openDefects')).value,1,'Fixed defects are closed');
    assert.equal((await evaluate('unlinkedTestCases','')).value,1);
    assert.equal((await evaluate('passRate','other')).value,0);
    assert.equal((await evaluate('stories','Renamed Release')).value,2);
    const byRelease=await evaluate('stories','','column','release');
    assert.ok(byRelease.series.some(item=>item.label==='Renamed Release'&&item.value===2));
    const snapshot=await analytics.loadContext('p','','Renamed Sprint');
    assert.deepEqual(snapshot.requirements.map(item=>item.id),['story']);
  } finally {await db.close();await require('../../src/obsDb').close();}
});
