const assert = require('node:assert/strict');
const test = require('node:test');

// Only run against a disposable schema; the enclosing transaction always rolls back.
test('Product Story metrics reconcile full scope, legacy links, statuses and finalized case outcomes', {
  skip: !process.env.REQUIREMENT_CATALOG_TEST_DATABASE_URL, timeout: 30000
}, async () => {
  const url = process.env.REQUIREMENT_CATALOG_TEST_DATABASE_URL;
  assert.match(new URL(url).pathname.slice(1), /^agent_verify_[a-z0-9_]+$/);
  process.env.DATABASE_URL = url;
  const db = require('../../src/db');
  const catalog = require('../../src/services/requirementCatalog.service');
  const service = require('../../src/services/requirement.service');
  const prefix = `metricfix-${Date.now()}`;
  const id = (value) => `${prefix}-${value}`;
  const rollback = new Error('ROLLBACK_VERIFIED_FIXTURE');
  try {
    await db.transaction(async () => {
      for (const project of ['project', 'other']) await db.prepare('INSERT INTO projects(id,name) VALUES(?,?)').run(id(project), 'Metrics verification');
      await db.prepare('INSERT INTO users(id,email,password_hash) VALUES(?,?,?)').run(id('user'), `${prefix}@example.test`, 'test-only');
      for (const [app, project] of [['app', 'project'], ['other-app', 'other']]) await db.prepare('INSERT INTO app_types(id,project_id,name) VALUES(?,?,?)').run(id(app), id(project), 'App');
      await db.prepare('INSERT INTO requirement_iterations(id,project_id,name,state) VALUES(?,?,?,?)').run(id('sprint'), id('project'), 'Legacy Sprint', 'active');
      const statuses = ['QA Done', 'Closed', 'Resolved', 'Accepted', 'completed', 'Complete', 'Dev Done', 'QA Blocked', 'Dev Ready', 'active', 'open'];
      for (let n = 1; n <= 33; n++) {
        await db.prepare(`INSERT INTO requirements(id,project_id,title,status,priority,iteration_id,sprint,description,gherkin_scenarios,dev_completion_target_date,qa_completion_target_date)
          VALUES(?,?,?,?,?,?,?,?,?::jsonb,?,?)`).run(id(`story-${n}`), id('project'), `Story ${n}`, statuses[n - 1] || 'open', n < 3 ? n : 3,
          [1, 3, 4, 5, 7, 8].includes(n) ? id('sprint') : null, n === 2 ? 'Legacy Sprint' : null,
          n === 10 ? '<p>&nbsp; &#160; \t</p>' : n < 12 ? 'Reviewable description' : null,
          JSON.stringify(n === 10 ? [' ', '<p>&nbsp;</p>'] : n < 12 ? ['Given a customer'] : []),
          [1, 2, 3, 4, 5, 7].includes(n) ? '2020-01-01' : null, n === 8 ? '2020-01-01' : null);
      }
      await db.prepare("UPDATE requirements SET dev_completion_target_date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date WHERE id = ?").run(id('story-9'));
      await db.prepare('INSERT INTO entity_comments(id,project_id,entity_type,entity_id,body) VALUES(?,?,?,?,?)').run(id('comment'), id('project'), 'requirement', id('story-8'), 'Review note');
      await db.prepare('INSERT INTO requirement_releases(id,project_id,name,fix_version) VALUES(?,?,?,?)').run(id('release'), id('project'), 'Release', '1.0');
      await db.prepare('INSERT INTO requirement_release_items(release_id,requirement_id) VALUES(?,?)').run(id('release'), id('story-1'));
      for (const [n, story, automated, automationStatus] of [[1, 1, 'yes', 'ready'], [2, 2, 'no', 'ready'], [3, 3, 'no', 'not_automated'], [4, 7, 'no', 'not_automated'], [5, 8, 'no', 'not_automated']]) {
        await db.prepare('INSERT INTO test_cases(id,app_type_id,title,requirement_id,automated,automation_status) VALUES(?,?,?,?,?,?)').run(id(`case-${n}`), id('app'), `Case ${n}`, id(`story-${story}`), automated, automationStatus);
      }
      // One duplicate source and one shared case must never inflate counts.
      for (const story of [1, 2]) await db.prepare('INSERT INTO requirement_test_cases(requirement_id,test_case_id) VALUES(?,?)').run(id(`story-${story}`), id('case-1'));
      await db.prepare('INSERT INTO test_cases(id,app_type_id,title) VALUES(?,?,?)').run(id('foreign-case'), id('other-app'), 'Other project case');
      await db.prepare('INSERT INTO requirement_test_cases(requirement_id,test_case_id) VALUES(?,?)').run(id('story-11'), id('foreign-case'));
      for (const [bug, status, priority, project] of [['open', 'open', 'high', 'project'], ['resolved', 'Resolved', 'high', 'project'], ['foreign', 'open', 'high', 'other']]) {
        await db.prepare('INSERT INTO feedback(id,project_id,user_id,title,message,status,priority) VALUES(?,?,?,?,?,?,?)').run(id(`bug-${bug}`), id(project), id('user'), bug, 'Evidence', status, priority);
      }
      for (const [story, bug] of [[1, 'open'], [2, 'open'], [1, 'resolved'], [11, 'foreign']]) await db.prepare('INSERT INTO requirement_defects(requirement_id,issue_id) VALUES(?,?)').run(id(`story-${story}`), id(`bug-${bug}`));
      for (const run of ['old', 'pending', 'blocked', 'partial', 'dataset', 'foreign']) await db.prepare('INSERT INTO executions(id,project_id,app_type_id,status) VALUES(?,?,?,?)').run(id(run), id(run === 'foreign' ? 'other' : 'project'), id(run === 'foreign' ? 'other-app' : 'app'), 'running');
      const result = async (name, run, caseN, status, date, iteration = null) => db.prepare(`INSERT INTO execution_results(id,execution_id,test_case_id,app_type_id,status,created_at,data_set_iteration_index) VALUES(?,?,?,?,?,?::timestamptz,?)`).run(id(name), id(run), id(`case-${caseN}`), id(run === 'foreign' ? 'other-app' : 'app'), status, date, iteration);
      await result('passed', 'old', 1, 'passed', '2026-01-01');
      await result('new-pending', 'pending', 1, 'pending', '2026-02-01');
      await result('blocked-result', 'blocked', 2, 'blocked', '2026-01-02');
      await result('blocked-retry-pending', 'blocked', 2, 'pending', '2026-02-02');
      await result('partial-pass', 'partial', 4, 'passed', '2026-01-03', 0);
      await result('dataset-fail', 'dataset', 5, 'failed', '2026-01-03', 0);
      await result('dataset-pass', 'dataset', 5, 'passed', '2026-01-04', 1);
      await result('dataset-failed-retry-pending', 'dataset', 5, 'pending', '2026-02-04', 0);
      await result('foreign-newest', 'foreign', 1, 'failed', '2026-12-01');
      for (const [run, n] of [['partial', 4], ['dataset', 5]]) await db.prepare(`INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title,test_data_set_snapshot) VALUES(?,?,?,'{"mode":"table","rows":[{},{}]}'::jsonb)`).run(id(run), id(`case-${n}`), `Case ${n}`);

      const query = { project_id: id('project'), include_execution: true, include_sprints: true };
      const metrics = await catalog.getMetrics(query);
      assert.equal(metrics.all.total, 33);
      assert.equal(metrics.sprints.total, 7);
      assert.equal(metrics.backlog.total, 26);
      assert.equal(metrics.all.qaTotal, 7);
      assert.equal(metrics.all.completed, 5, 'Completed backlog Story stays outside QA denominator');
      assert.equal(metrics.all.completionPercent, 71);
      assert.equal(metrics.all.mapped, 5);
      assert.equal(metrics.all.coveragePercent, 15);
      assert.equal(metrics.all.groomed, 10, 'Empty HTML and blank scenarios are not grooming evidence');
      assert.equal(metrics.all.notGroomed, 23);
      assert.equal(metrics.all.releaseScoped, 1, 'Release membership counts without legacy text fields');
      assert.equal(metrics.all.totalDefects, 2, 'A shared defect counts once; foreign project is excluded');
      assert.equal(metrics.sprints.slipped, 1, 'Completed aliases and due-today target are not slipped');
      assert.equal(metrics.backlog.slipped, 0);
      const sprint = metrics.sprint_health[0];
      assert.equal(sprint.total_stories, 7, 'Legacy Sprint name participates in the same Sprint');
      assert.equal(sprint.linked_cases, 5);
      assert.equal(sprint.executed_linked_cases, 3, 'Never-run and partially finalized dataset cases stay outside pass rate');
      assert.equal(sprint.passed_cases, 1, 'Mixed dataset outcomes fail once; newer pending run preserves last finalized outcome');
      assert.equal(sprint.pass_percent, 33.3);
      assert.equal(sprint.open_p1_p2_bugs, 1);
      assert.equal(sprint.blocked_stories, 1);
      assert.equal(sprint.comment_count, 1);
      const storyRows = await service.getRequirementsPage({ ...query, projection: 'summary' });
      assert.equal(storyRows.items.length, 25);
      const getFacts = async (n, include_execution = true) => (await catalog.withCatalogMetrics([{ id: id(`story-${n}`) }], { include_execution }))[0].catalog_metrics;
      assert.deepEqual(await getFacts(1), { linked_cases: 1, automated_cases: 1, executed_cases: 1, passed_cases: 1, total_bugs: 2, open_bugs: 1, closed_bugs: 1, described: true, specified: true, groomed: true, slipped: false, completed: true, execution_complete: true, automation_complete: true });
      assert.equal((await getFacts(2)).automated_cases, 2, 'Ready automation counts alongside automated=yes');
      const neverRun = await getFacts(3);
      assert.equal(neverRun.executed_cases, 0);
      assert.equal(neverRun.execution_complete, true, 'Known absent outcomes are not missing evidence');
      assert.equal((await getFacts(10)).groomed, false);
      assert.equal((await getFacts(11)).linked_cases, 0);
      assert.equal((await getFacts(11)).total_bugs, 0);
      const redacted = await getFacts(1, false);
      assert.equal(redacted.executed_cases, null);
      assert.equal(redacted.passed_cases, null);
      assert.equal(redacted.execution_complete, false);
      assert.equal(redacted.linked_cases, 1);
      const linked = await service.getRequirementsPage({ project_id: id('project'), coverage: 'linked' });
      assert.equal(linked.total, 5);
      const legacySprint = await service.getRequirementsPage({ project_id: id('project'), sprint_id: id('sprint') });
      assert.equal(legacySprint.total, 7);
      const alias = await service.getRequirementsPage({ project_id: id('project'), status: 'qa_done' });
      assert.equal(alias.total, 1);
      assert.equal(alias.items[0].test_case_ids.length, 1, 'Summary hydration matches union link metrics');
      const noExecution = await catalog.getMetrics({ project_id: id('project'), include_sprints: true });
      assert.equal(noExecution.sprint_health[0].pass_percent, null);
      assert.ok(!noExecution.sprint_health[0].exact_fields.includes('passed_cases'));
      assert.ok(noExecution.sprint_health[0].exact_fields.includes('covered_stories'));
      throw rollback;
    })();
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.close(); }
});
