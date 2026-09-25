const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const loadService = (db) => {
  const exported = {};
  vm.runInNewContext(readFileSync(path.join(__dirname, '../../backend/services/testCaseCatalog.service.js'), 'utf8'), {
    exports: exported, Buffer, console,
    require: (id) => id === '@hellotest/platform/backend/src/db' ? db : id === 'crypto' ? require('node:crypto') : require('../../../platform/backend/src/utils/externalReferences')
  });
  return exported;
};

test('catalog filters keep literal search escaped, values parameterized, and execution filters permission-controlled', () => {
  const svc = loadService({});
  const scope = svc.buildScope({ app_type_id: 'app', project_id: 'project', search: "50%_' OR TRUE --", workflow_status: 'pending-review', step_filter: 'no-steps', run_filter: 'with-runs', include_execution: false });
  assert.match(scope.where, /tc.app_type_id = \?/);
  assert.match(scope.where, /project_id = \?/);
  assert.ok(!scope.where.includes("OR TRUE --"));
  assert.ok(scope.params.includes("%50\\%\\_' OR TRUE --%"));
  assert.match(scope.where, /NOT EXISTS \(SELECT 1 FROM test_steps/);
  assert.doesNotMatch(scope.where, /execution_results/);
  assert.match(svc.buildScope({ run_filter: 'with-runs', include_execution: true }).where, /EXISTS \(SELECT 1 FROM execution_results/);
});

test('only one bounded page is returned and hydrated; cursors cannot cross catalog filters', async () => {
  const calls = [];
  const rows = Array.from({ length: 26 }, (_, index) => ({ id: `case-${index}`, title: `Case ${index}`, cursor_activity: '2026-09-01 00:00:00.000123+00', labels: [], external_references: [], gherkin_document: 'large authoring payload', parameter_values: {} }));
  const svc = loadService({ prepare: (sql) => ({
    all: async (...params) => { calls.push({ sql, params }); return sql.includes('cursor_activity') ? rows : rows.slice(0, 25).map((row) => ({ id: row.id, step_count: 1, requirement_ids: [] })); },
    get: async (...params) => { calls.push({ sql, params }); return { total: 101 }; }
  }) });
  const first = await svc.listPage({ app_type_id: 'app', projection: 'summary', exclude_automated: true });
  assert.equal(first.items.length, 25);
  assert.equal(first.total, 101);
  assert.equal(first.is_last, false);
  assert.equal(JSON.parse(Buffer.from(first.next_cursor, 'base64url')).activity, '2026-09-01 00:00:00.000123+00');
  assert.equal(first.items[0].gherkin_document, undefined);
  assert.equal(first.items[0].summary_complete, true);
  assert.equal(calls[0].params.at(-1), 26);
  const hydration = calls.find((call) => call.sql.includes('AS step_count'));
  assert.equal(hydration.params.length, 25);
  assert.ok(!hydration.params.includes('case-25'));
  await assert.rejects(() => svc.listPage({ app_type_id: 'other-app', cursor: first.next_cursor }), /invalid/);
  await assert.rejects(() => svc.listPage({ app_type_id: 'app', cursor: first.next_cursor, search: 'new filter' }), /invalid/);
  await svc.listPage({ app_type_id: 'app', projection: 'summary', exclude_automated: true, cursor: first.next_cursor });
  assert.ok(calls.some((call) => call.sql.includes('(?::timestamptz, ?)') && call.params.includes('case-24')));
});

test('catalog and module metrics are normalized from one aggregate request independently of page sizes', async () => {
  let requests = 0;
  const svc = loadService({ prepare: () => ({ all: async () => {
    requests += 1;
    return [
      { catalog: 1, count: 2000, covered: 1500, automated: 400, automation_known: 2000, finalized: 10, passed: 8, duration_count: 2, duration_sum: 1500, blocked: 1, failed: 2 },
      { catalog: 0, module_id: 'module', count: 1500, defects: 3, executed: 10, latest_passed: 8, duration_count: 2, duration_sum: 1500 },
      { catalog: 0, module_id: null, count: 500, pending_review: 12 }
    ];
  } }) });
  const result = await svc.getMetrics({ app_type_id: 'app', include_execution: true });
  assert.equal(requests, 1);
  assert.equal(result.catalog.total, 2000);
  assert.equal(result.catalog.automationPercent, 20);
  assert.equal(result.catalog.recentPassRate, 80);
  assert.equal(result.catalog.averageExecutionMs, 750);
  assert.equal(result.catalog.critical, 3);
  assert.equal(result.modules.module.count, 1500);
  assert.equal(result.modules.module.latestPassRatePercent, 80);
  assert.equal(result.unassigned.pendingReviewCount, 12);
});

test('summary pages can skip full-scope totals and never select authoring JSON columns', async () => {
  const calls = [];
  const svc = loadService({ prepare: (sql) => ({
    all: async (...params) => { calls.push({ sql, params }); return []; },
    get: async () => { throw new Error('A page without totals must not count the full scope'); }
  }) });
  const page = await svc.listPage({ app_type_id: 'app', projection: 'summary', include_total: false });
  assert.equal(page.total, undefined);
  assert.equal(page.is_last, true);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].sql, /tc\.\*|gherkin_document|parameter_values|review_history/);
  assert.match(calls[0].sql, /DESC NULLS LAST/);
});

test('null timestamps have a valid cursor and continue within the null-date tail', async () => {
  const calls = [];
  const svc = loadService({ prepare: (sql) => ({
    all: async (...params) => {
      calls.push({ sql, params });
      return sql.includes('cursor_activity') ? [{ id: 'z', cursor_activity: null }, { id: 'y', cursor_activity: null }] : [];
    }
  }) });
  const first = await svc.listPage({ page_size: 1, include_total: false });
  assert.equal(JSON.parse(Buffer.from(first.next_cursor, 'base64url')).activity, null);
  await svc.listPage({ page_size: 1, include_total: false, cursor: first.next_cursor });
  const second = calls.filter((call) => call.sql.includes('cursor_activity'))[1];
  assert.match(second.sql, /COALESCE\(tc.updated_at, tc.created_at\) IS NULL AND tc.id < \?/);
  assert.equal(second.params[0], 'z');
});

test('picker pages cap at 25 and read only their compact page and membership labels', async () => {
  const calls = [];
  const svc = loadService({ prepare: (sql) => ({
    all: async (...params) => {
      calls.push({ sql, params });
      return Array.from({ length: 26 }, (_, n) => ({ id: `picker-${n}`, title: 'Choice', cursor_activity: '2026-01-01 00:00:00.123456+00', labels: [], requirement_ids: ['story'], suite_ids: [] }));
    },
    get: async () => assert.fail('Pickers do not count the catalog by default')
  }) });
  const page = await svc.listPage({ project_id: 'project', projection: 'picker', page_size: 200, module_id: 'module', include_execution: true, run_filter: 'with-runs' });
  assert.equal(calls.length, 1);
  assert.equal(page.items.length, 25);
  assert.equal(page.items[0].summary_complete, false);
  assert.equal(page.items[0].detail_complete, false);
  assert.equal(page.total, undefined);
  assert.equal(calls[0].params.at(-1), 26);
  assert.match(calls[0].sql, /WITH picker_page AS MATERIALIZED/);
  assert.match(calls[0].sql, /LEFT\(tc.description, 240\)/);
  assert.doesNotMatch(calls[0].sql, /OFFSET|execution_results|AS step_count|run_count|recent_results|gherkin_document|parameter_values|review_history/);
  await svc.listPage({ project_id: 'project', projection: 'picker', module_id: 'module', cursor: page.next_cursor });
  assert.match(calls[1].sql, /\(\?::timestamptz, \?\)/);
  assert.doesNotMatch(calls[1].sql, /OFFSET/);
});

test('picker exact-ID and Suite selections stay parameterized and cannot mean the whole library when empty', () => {
  const svc = loadService({});
  const scope = svc.buildScope({ projection: 'picker', project_id: 'project', ids: "one,two,'bad", suite_ids: 'suite-b,suite-a', label: 'release', shared_step_group_id: 'group', automated: 'yes' });
  assert.match(scope.where, /tc.id IN \(\?,\?,\?\)/);
  assert.ok(!scope.where.includes("'bad"));
  assert.ok(scope.params.includes("'bad"));
  assert.match(scope.where, /tc.suite_id IN/);
  assert.match(scope.where, /reusable_group_id = \?/);
  assert.match(scope.where, /tc.automated = \?/);
  assert.match(svc.buildScope({ projection: 'picker', ids: '' }).where, /false/);
  assert.throws(() => svc.buildScope({ ids: Array.from({ length: 201 }, (_, n) => String(n)) }), { statusCode: 400 });
  assert.throws(() => svc.buildScope({ ids: {} }), { statusCode: 400 });
  assert.throws(() => svc.buildScope({ automated: 'sometimes' }), { statusCode: 400 });
});

test('review filters combine manual and AI pending states with assigned ownership and safe legacy fallback', () => {
  const svc = loadService({});
  const scope = svc.buildScope({ project_id: 'project', app_type_id: 'app', review_queue: 'mine', review_user_id: "reviewer' OR TRUE --" });
  assert.match(scope.where, /tc\.review_status = 'pending'/);
  assert.match(scope.where, /NOT IN \('accepted', 'changes_requested'\)/);
  assert.match(scope.where, /tc\.reviewer_id = \? OR \(NULLIF\(tc\.reviewer_id, ''\) IS NULL/);
  assert.match(scope.where, /tc\.created_by = \?/);
  assert.doesNotMatch(scope.where, /OR TRUE --|source = 'scheduler'/);
  assert.equal(scope.params.filter(value => value === "reviewer' OR TRUE --").length, 2);
  assert.throws(() => svc.buildScope({ review_queue: 'all', review_user_id: 'reviewer' }), { statusCode: 400 });
  assert.throws(() => svc.buildScope({ review_queue: 'mine' }), { statusCode: 400 });
});

test('pending-review button counts all scoped cases without catalog filters or detail reads', async () => {
  const calls = [];
  const svc = loadService({ prepare: sql => ({ get: async (...params) => { calls.push({ sql, params }); return { pending: 70, overall_pending: 93 }; } }) });
  const result = await svc.getReviewSummary({ project_id: 'project', app_type_id: 'app', review_user_id: 'reviewer', search: 'invisible', module_id: 'one', page_size: 1 });
  assert.equal(result.pending, 70);
  assert.equal(result.overall_pending, 93);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /COUNT\(\*\)::int AS overall_pending/);
  assert.doesNotMatch(calls[0].sql, /LIMIT|OFFSET|execution_results|test_steps|test_case_module_cases|description|ILIKE/);
  assert.ok(!calls[0].params.includes('invisible'));
});

test('review cursors cannot cross reviewers even within the same project', async () => {
  const svc = loadService({ prepare: sql => ({ all: async () => sql.includes('cursor_activity') ? [{ id: 'b', cursor_activity: '2026-01-01' }, { id: 'a', cursor_activity: '2026-01-01' }] : [] }) });
  const first = await svc.listPage({ project_id: 'project', review_queue: 'mine', review_user_id: 'reviewer-a', page_size: 1, include_total: false });
  await assert.rejects(svc.listPage({ project_id: 'project', review_queue: 'mine', review_user_id: 'reviewer-b', page_size: 1, include_total: false, cursor: first.next_cursor }), { statusCode: 400 });
});
