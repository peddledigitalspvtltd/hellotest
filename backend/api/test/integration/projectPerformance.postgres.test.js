const assert = require("node:assert/strict");
const test = require("node:test");

test("project portfolio keeps exact metrics while transferring only relevant execution history", {
  skip: !process.env.PROJECT_PERFORMANCE_TEST_DATABASE_URL,
  timeout: 30_000
}, async t => {
  const url = process.env.PROJECT_PERFORMANCE_TEST_DATABASE_URL;
  assert.match(new URL(url).pathname.slice(1), /^agent_verify_[a-z0-9_]+$/);
  process.env.DATABASE_URL = url;
  const db = require("../../src/db");
  const projects = require("../../src/services/project.service");
  const analytics = require("../../src/services/portfolioAnalytics.service");
  t.mock.method(require("../../src/services/settings.service"), "getWorkspacePreferences", async () => ({}));
  const rollback = new Error("ROLLBACK_PROJECT_PERFORMANCE_FIXTURE");
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null, "An empty disposable database is required");
    await db.transaction(async () => {
      await db.query(`
        CREATE TABLE projects(id text PRIMARY KEY, display_id text, name text, description text, visibility text, created_by text, created_at timestamptz DEFAULT now());
        CREATE TABLE users(id text PRIMARY KEY, name text);
        CREATE TABLE project_members(id text, project_id text, user_id text);
        CREATE TABLE project_favorites(project_id text, user_id text);
        CREATE TABLE app_types(id text, project_id text, name text, type text, is_unified boolean);
        CREATE TABLE requirements(id text, project_id text, display_id text, title text);
        CREATE TABLE test_case_modules(id text, app_type_id text, name text);
        CREATE TABLE test_cases(id text, app_type_id text, title text, automated text, automation_status text, requirement_id text);
        CREATE TABLE test_suites(id text, app_type_id text);
        CREATE TABLE requirement_test_cases(requirement_id text, test_case_id text);
        CREATE TABLE test_case_module_cases(module_id text, test_case_id text);
        CREATE TABLE executions(id text PRIMARY KEY, project_id text, name text, status text, trigger text, created_at timestamptz, started_at timestamptz, ended_at timestamptz, duration_ms integer, oversized_snapshot text);
        CREATE TABLE execution_results(id text PRIMARY KEY, execution_id text, test_case_id text, status text, created_at timestamptz, oversized_snapshot text, data_set_iteration_index integer, data_set_iteration_key text);
        CREATE TABLE execution_case_snapshots(execution_id text, test_case_id text, test_data_set_snapshot jsonb);
        CREATE TABLE attachments(project_id text, entity_type text, entity_id text, mime_type text);
        CREATE TABLE entity_comments(project_id text, entity_type text, entity_id text, body text);
        CREATE TABLE feedback(id text, project_id text, display_id text, title text, status text, severity text, priority text, linked_test_case_ids jsonb, linked_module_ids jsonb, linked_requirement_ids jsonb);
        CREATE TABLE requirement_defects(issue_id text, requirement_id text);
        CREATE TABLE test_case_defects(issue_id text, test_case_id text);
        INSERT INTO projects(id,name,description,created_by,visibility) VALUES ('own','Own','Full project description','actor','private'),('locked','Locked','Private description','other','private');
        INSERT INTO users VALUES ('actor','Actor');
        INSERT INTO project_members VALUES ('member','own','actor');
        INSERT INTO project_favorites VALUES ('own','actor');
        INSERT INTO app_types VALUES ('app','own','Web','web',false),('foreign-app','locked','Private app','web',false);
        INSERT INTO requirements VALUES ('story','own','STORY-1','Story'),('foreign-story','locked','STORY-2','Private story');
        INSERT INTO test_case_modules VALUES ('module','app','Module');
        INSERT INTO test_cases(id,app_type_id,title,automated,automation_status) VALUES ('case-a','app','A','yes','ready'),('case-b','app','B','no','not_automated'),('foreign-case','foreign-app','Private case','yes','ready');
        INSERT INTO test_suites VALUES ('suite','app'),('foreign-suite','foreign-app');
        INSERT INTO requirement_test_cases VALUES ('story','case-a');
        INSERT INTO test_case_module_cases VALUES ('module','case-a');
        INSERT INTO executions(id,project_id,status,created_at,oversized_snapshot) VALUES
          ('old','own','passed','2026-01-01',repeat('large-',10000)),
          ('recent','own','failed','2026-01-03',repeat('large-',10000)),
          ('pending','own','running','2026-01-06',repeat('large-',10000)),
          ('foreign','locked','passed','2026-01-07',repeat('large-',10000));
        INSERT INTO execution_results(id,execution_id,test_case_id,status,created_at,oversized_snapshot)
          SELECT 'history-'||n,'old','case-a','failed','2025-01-01'::timestamptz+n*interval '1 second',repeat('large-',1000) FROM generate_series(1,1000) AS n;
        INSERT INTO execution_results(id,execution_id,test_case_id,status,created_at) VALUES
          ('failed','recent','case-a','failed','2026-01-03'),
          ('blocked','recent','case-b','blocked','2026-01-03'),
          ('latest-pass','old','case-a','passed','2026-01-05'),
          ('in-progress','pending','case-a','pending','2026-01-06'),
          ('foreign-pass','foreign','foreign-case','passed','2026-01-07');
        INSERT INTO attachments VALUES ('own','execution','recent','image/png'),('own','execution','old','video/mp4'),('locked','execution','foreign','image/png');
        INSERT INTO entity_comments VALUES ('own','execution_result','failed','Comment'),('own','execution','old','Historical note');
        INSERT INTO feedback(id,project_id,title,status,linked_test_case_ids) VALUES ('bug-a','own','Open Bug','open','["case-a"]'),('bug-b','own','Fixed Bug','resolved','[]');
      `);

      const catalog = await projects.getProjectCatalog("actor", { projection: "summary" });
      assert.equal(catalog.find(row => row.id === "own").is_favorite, true);
      const locked = catalog.find(row => row.id === "locked");
      assert.equal(locked.has_access, false);
      assert.equal(locked.description, null);
      assert.equal(locked.created_by, null);
      assert.ok(catalog.every(row => !Object.hasOwn(row, "case_count")));
      assert.deepEqual((await projects.getProjects("actor", { projection: "summary" })).map(row => row.id), ["own"]);
      assert.equal((await projects.getProject("own", "actor")).description, "Full project description");
      await assert.rejects(() => projects.getProject("locked", "actor"), /Access denied/);
      const longDescription = "Project details ".repeat(500);
      await db.prepare("UPDATE projects SET description = ? WHERE id = 'own'").run(longDescription);
      assert.equal((await projects.getProjectCatalog("actor", { projection: "summary" })).find(row => row.id === "own").description.length, 1024);
      assert.equal((await projects.getProject("own", "actor")).description, longDescription, "opening a project retrieves the complete description for editing");

      const originalPrepare = db.prepare.bind(db);
      let transferredResults;
      t.mock.method(db, "prepare", sql => {
        const statement = originalPrepare(sql);
        if (!sql.includes("WITH latest_case_results AS")) return statement;
        return { ...statement, all: async (...args) => {
          const rows = await statement.all(...args);
          transferredResults = rows;
          return rows;
        } };
      });
      const metrics = await analytics.buildPortfolioAnalytics("actor");
      assert.equal(transferredResults.length, 3, "1,000 historical outcomes never leave PostgreSQL");
      assert.ok(transferredResults.every(row => !Object.hasOwn(row, "oversized_snapshot")));
      assert.equal(metrics.projects.length, 1);
      const own = metrics.projects[0];
      assert.equal(own.project_id, "own");
      assert.equal(own.latest_execution.id, "recent", "a newer running-only run does not replace finalized evidence");
      assert.ok(!Object.hasOwn(own.latest_execution, "oversized_snapshot"));
      assert.equal(own.latest_failed_count, 1);
      assert.equal(own.latest_blocked_count, 1);
      assert.deepEqual(own.pass_confidence, { total: 4, passed: 2, percent: 50, case_total: 2, case_passed: 1, bug_total: 2, bug_resolved: 1 });
      assert.equal(own.execution_evidence.total, 2);
      assert.equal(own.execution_evidence.percent, 100);
      assert.equal(own.story_coverage.percent, 100);
      assert.equal(own.automation_coverage.percent, 50);
      assert.equal(own.counts.suites, 1);
      assert.equal(own.failure_impacts.modules.total, 1);
      assert.equal(own.bug_impacts.requirements.total, 1);
      assert.equal(metrics.summary.locked_projects, 1);
      assert.equal(own.latest_run_pass_rate.execution.id, "pending", "the tile uses the true newest run even when only pending");
      assert.equal(own.latest_run_pass_rate.percent, 0);
      assert.equal(own.latest_run_pass_rate.counts.pending, 1);

      await db.query(`
        INSERT INTO requirements VALUES ('legacy-story','own','STORY-3','Legacy Story'),('invalid-story','own','STORY-4','Invalid mapping');
        INSERT INTO requirement_test_cases VALUES ('story','case-a'),('story','case-b'),('invalid-story','foreign-case'),('invalid-story','deleted-case');
        UPDATE test_cases SET requirement_id = 'legacy-story' WHERE id = 'case-b';
        INSERT INTO execution_case_snapshots VALUES ('pending','case-a','{"rows":[{},{}]}'),('pending','case-b','{"mode":"key_value","rows":[{},{}]}');
        UPDATE execution_results SET status='failed',data_set_iteration_index=0 WHERE id='in-progress';
        INSERT INTO execution_results(id,execution_id,test_case_id,status,created_at,data_set_iteration_index,data_set_iteration_key) VALUES
          ('retry-pass','pending','case-a','passed','2026-01-07',0,'replacement-key'),
          ('na','pending','case-b','not_applicable','2026-01-07',0,'row-one');
      `);
      const partial = (await analytics.buildPortfolioAnalytics("actor")).projects[0];
      assert.deepEqual(partial.story_coverage, { total: 3, covered: 2, percent: 67 }, "unique same-project mappings and legacy direct links count once; invalid/foreign links do not");
      assert.equal(partial.latest_run_pass_rate.total, 2);
      assert.equal(partial.latest_run_pass_rate.counts.pending, 1, "missing planned data rows prevent a whole-case pass");
      assert.equal(partial.latest_run_pass_rate.counts.not_applicable, 1);
      await db.query(`INSERT INTO execution_results(id,execution_id,test_case_id,status,created_at,data_set_iteration_index) VALUES ('final-row','pending','case-a','passed','2026-01-08',1)`);
      const completed = (await analytics.buildPortfolioAnalytics("actor")).projects[0].latest_run_pass_rate;
      assert.equal(completed.total, 2, "two data rows still represent one Test Case");
      assert.equal(completed.passed, 1);
      assert.equal(completed.percent, 50, "resolved Bugs and older run results never contribute to this tile");

      await db.prepare("DELETE FROM execution_results WHERE execution_id <> 'foreign'").run();
      const withoutFinalized = await analytics.buildPortfolioAnalytics("actor");
      assert.equal(withoutFinalized.projects[0].latest_execution.id, "pending");
      assert.equal(withoutFinalized.projects[0].execution_evidence.total, 0);
      assert.equal(withoutFinalized.projects[0].latest_run_pass_rate.percent, null, "planned scope without outcomes is unassessed");
      assert.equal(withoutFinalized.projects[0].latest_run_pass_rate.counts.pending, 2);
      await db.prepare("DELETE FROM executions WHERE project_id = 'own'").run();
      const withoutRuns = await analytics.buildPortfolioAnalytics("actor");
      assert.equal(withoutRuns.projects[0].latest_execution, null, "empty run ID lists remain valid SQL");
      assert.equal(withoutRuns.projects[0].latest_run_pass_rate.execution, null);
      assert.equal(withoutRuns.projects[0].latest_run_pass_rate.percent, null);
      throw rollback;
    })();
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await db.close();
  }
});
