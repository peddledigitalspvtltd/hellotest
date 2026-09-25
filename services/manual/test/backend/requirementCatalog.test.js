const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadService(db = {}) {
  const context = { exports: {}, require: (name) => { if (name === '@hellotest/platform/backend/src/utils/deliveryScopeSql') return require('../../../platform/backend/src/utils/deliveryScopeSql'); if (name === '@hellotest/platform/backend/src/utils/storyReadiness') return require('../../../platform/backend/src/utils/storyReadiness'); if (name === 'crypto') return require('crypto'); if (name === '@hellotest/platform/backend/src/utils/finalizedCaseMetrics') return require('../../../platform/backend/src/utils/finalizedCaseMetrics'); assert.equal(name, '@hellotest/platform/backend/src/db'); return db; }, Buffer, Date };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../backend/services/requirementCatalog.service.js'), 'utf8'), context);
  return context.exports;
}

test('story filters use parameterized full-catalog search and literal wildcard escaping', () => {
  const { buildWhere } = loadService();
  const filter = buildWhere({ project_id: 'project', search: "50%_ O'Reilly", priority: 1, label: 'late-page', unassigned: true, coverage: 'unlinked' });
  assert.match(filter.sql, /NOT \(r.iteration_id IS NOT NULL/);
  assert.match(filter.sql, /NOT \(EXISTS.*requirement_test_cases/);
  assert.ok(!filter.sql.includes("O'Reilly"));
  assert.deepEqual([...filter.params.slice(0, 3)], ['project', 1, '["late-page"]']);
  assert.equal(filter.params[3], "%50\\%\\_ O'Reilly%");
});

test('story page size defaults to 25 and malformed/negative cursors are rejected', () => {
  const { pageOptions } = loadService();
  assert.equal(pageOptions({}).limit, 25);
  assert.equal(pageOptions({ page_size: 900 }).limit, 200);
  for (const cursor of ['invalid', Buffer.from('{"offset":-1}').toString('base64url'), Buffer.from('{"offset":"25"}').toString('base64url')]) {
    assert.throws(() => pageOptions({ cursor }), { statusCode: 400 });
  }
});

test('story pagination hydrates only the requested page and returns a verified continuation', async () => {
  const calls = [];
  const rows = Array.from({ length: 26 }, (_, index) => ({ id: String(index), cursor_activity: '2026-01-01 00:00:00.123456+00', cursor_created_at: '2026-01-01 00:00:00.123456+00' }));
  const service = loadService({ prepare(sql) { return { async all(...params) { calls.push({ sql, params }); return rows; }, async get() { return { total: 62 }; } }; } });
  const page = await service.getPage({ project_id: 'project', projection: 'summary' }, async (items) => { assert.equal(items.length, 25); return items; });
  assert.equal(page.total, 62);
  assert.equal(page.items.length, 25);
  assert.equal(page.items[0].detail_complete, false);
  assert.match(calls[0].sql, /ORDER BY.*r.id DESC LIMIT \?/);
  assert.doesNotMatch(calls[0].sql, /OFFSET/);
  assert.deepEqual(calls[0].params.slice(-1), [26]);
  const cursor = JSON.parse(Buffer.from(page.next_cursor, 'base64url'));
  assert.equal(cursor.id, '24');
  assert.equal(cursor.activity, '2026-01-01 00:00:00.123456+00');
  assert.ok(cursor.scope);
});

test('count-free story pages do not execute a catalog count query', async () => {
  const calls = [];
  const service = loadService({ prepare(sql) { calls.push(sql); return { async all() { return []; }, async get() { throw new Error('Count query must not run'); } }; } });
  const page = await service.getPage({ project_id: 'project', include_total: false }, async (items) => items);
  assert.equal(calls.length, 1);
  assert.equal(Object.hasOwn(page, 'total'), false);
  assert.equal(page.is_last, true);
});

const integrationUrl = process.env.REQUIREMENT_CATALOG_TEST_DATABASE_URL;
test('PostgreSQL story catalog covers full-scope metrics, all page boundaries, and off-page filters', { skip: !integrationUrl }, async () => {
  process.env.DATABASE_URL = integrationUrl;
  const db = require('../../../platform/backend/src/db');
  const catalog = require('../../backend/services/requirementCatalog.service');
  const service = require('../../backend/services/requirement.service');
  const prefix = `storyperf-${Date.now()}`;
  try {
    await db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(prefix, 'Catalog verification');
    await db.prepare('INSERT INTO requirement_iterations (id, project_id, name, state) VALUES (?, ?, ?, ?)').run(`${prefix}-sprint`, prefix, 'Catalog sprint', 'active');
    for (let index = 0; index < 62; index += 1) {
      await db.prepare(`INSERT INTO requirements (id, project_id, title, description, priority, status, labels, gherkin_scenarios, iteration_id, sprint, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, '2026-01-01 00:00:00.123456+00', '2026-01-01 00:00:00.123456+00')`).run(
        `${prefix}-${String(index).padStart(3, '0')}`, prefix, index === 0 ? 'Distant story 50%_ match' : `Story ${index}`,
        'Reviewable description', index % 3 === 0 ? 1 : 3, index < 10 ? 'qa_done' : 'open', JSON.stringify(index === 0 ? ['only-last-page'] : []), JSON.stringify(index % 2 === 0 ? ['Given intent'] : []), index < 30 ? `${prefix}-sprint` : null, index < 30 ? 'Catalog sprint' : null
      );
    }
    await db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(`${prefix}-user`, `${prefix}@example.test`, 'not-a-real-password');
    await db.prepare('INSERT INTO app_types (id, project_id, name) VALUES (?, ?, ?)').run(`${prefix}-app`, prefix, 'Test app');
    await db.prepare('INSERT INTO test_cases (id, app_type_id, title) VALUES (?, ?, ?)').run(`${prefix}-case`, `${prefix}-app`, 'Linked case');
    for (const id of ['000', '001']) await db.prepare('INSERT INTO requirement_test_cases (requirement_id, test_case_id) VALUES (?, ?)').run(`${prefix}-${id}`, `${prefix}-case`);
    await db.prepare('INSERT INTO feedback (id, project_id, user_id, title, message, status, priority) VALUES (?, ?, ?, ?, ?, ?, ?)').run(`${prefix}-bug`, prefix, `${prefix}-user`, 'Shared bug', 'Test evidence', 'open', 'high');
    for (const id of ['000', '001']) await db.prepare('INSERT INTO requirement_defects (requirement_id, issue_id) VALUES (?, ?)').run(`${prefix}-${id}`, `${prefix}-bug`);
    await db.prepare('INSERT INTO executions (id, project_id, app_type_id, status, iteration_id, sprint) VALUES (?, ?, ?, ?, ?, ?)').run(`${prefix}-run`, prefix, `${prefix}-app`, 'passed',`${prefix}-sprint`,'Catalog sprint');
    for (const [index, status] of ['failed', 'passed'].entries()) await db.prepare('INSERT INTO execution_results (id, execution_id, test_case_id, app_type_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?::timestamptz)').run(`${prefix}-result-${index}`, `${prefix}-run`, `${prefix}-case`, `${prefix}-app`, status, `2026-01-0${index + 1}`);
    await db.prepare('UPDATE requirements SET description = ? WHERE id = ?').run('x'.repeat(1700) + ' offpage evidence', `${prefix}-001`);
    const descriptionMatch = await service.getRequirementsPage({ project_id: prefix, search: 'offpage evidence', projection: 'summary' });
    assert.equal(descriptionMatch.total, 1);
    assert.equal(descriptionMatch.items[0].description.length, 1600);
    assert.match((await service.getRequirement(`${prefix}-001`)).description, /offpage evidence/);
    const first = await service.getRequirementsPage({ project_id: prefix, projection: 'summary' });
    const second = await service.getRequirementsPage({ project_id: prefix, cursor: first.next_cursor, projection: 'summary' });
    const last = await service.getRequirementsPage({ project_id: prefix, cursor: second.next_cursor, projection: 'summary' });
    assert.deepEqual([first.items.length, second.items.length, last.items.length], [25, 25, 12]);
    assert.equal(new Set([...first.items, ...second.items, ...last.items].map((item) => item.id)).size, 62);
    assert.equal(last.next_cursor, null);
    await assert.rejects(service.getRequirementsPage({ project_id: prefix, cursor: first.next_cursor, label: 'only-last-page' }), { statusCode: 400 });
    const countFree = await service.getRequirementsPage({ project_id: prefix, include_total: false, projection: 'summary' });
    assert.equal(countFree.items.length, 25);
    assert.equal(Object.hasOwn(countFree, 'total'), false);
    await db.prepare("INSERT INTO requirements (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, '2026-12-01', '2026-12-01')").run(`${prefix}-inserted`, prefix, 'Inserted after page one');
    const stableSecond = await service.getRequirementsPage({ project_id: prefix, cursor: first.next_cursor, include_total: false });
    assert.deepEqual(stableSecond.items.map((item) => item.id), second.items.map((item) => item.id));
    await db.prepare('DELETE FROM requirements WHERE id = ?').run(`${prefix}-inserted`);
    const bySearch = await service.getRequirementsPage({ project_id: prefix, search: '50%_', projection: 'summary' });
    const byLabel = await service.getRequirementsPage({ project_id: prefix, label: 'only-last-page', projection: 'summary' });
    assert.equal(bySearch.total, 1);
    assert.equal(byLabel.total, 1);
    assert.equal(bySearch.items[0].id, `${prefix}-000`);
    const backlog = await service.getRequirementsPage({ project_id: prefix, unassigned: true });
    const sprint = await service.getRequirementsPage({ sprint_id: `${prefix}-sprint` });
    assert.equal(backlog.total, 32);
    assert.equal(sprint.total, 30);
    const metrics = await catalog.getMetrics({ project_id: prefix, include_sprints: true, include_execution: true });
    assert.equal(metrics.all.total, 62);
    assert.equal(metrics.backlog.total, 32);
    assert.equal(metrics.sprints.total, 30);
    assert.equal(metrics.all.groomed, 31);
    assert.equal(metrics.all.completed, 10);
    assert.equal(metrics.all.qaTotal, 30);
    assert.equal(metrics.sprint_health[0].total_stories, 30);
    assert.equal(metrics.all.mapped, 2);
    assert.equal(metrics.all.totalDefects, 1);
    assert.equal(metrics.sprint_health[0].linked_cases, 1);
    assert.equal(metrics.sprint_health[0].executed_linked_cases, 1);
    assert.equal(metrics.sprint_health[0].passed_cases, 1);
    assert.equal(metrics.sprint_health[0].pass_percent, 100);
    assert.equal(metrics.sprint_health[0].total_bugs, 1);
    assert.deepEqual(metrics.filter_options.labels, ['only-last-page']);
    const filtered = await catalog.getMetrics({ project_id: prefix, label: 'only-last-page' });
    assert.equal(filtered.all.total, 1);
    assert.deepEqual(filtered.sprint_health, []);
    // Legacy rows can explicitly store either or both timestamps as null.
    for (let index = 0; index < 31; index += 1) await db.prepare("INSERT INTO requirements (id, project_id, title, created_at, updated_at, labels) VALUES (?, ?, ?, NULL, NULL, '[\"null-dates\"]'::jsonb)").run(`${prefix}-null-${String(index).padStart(3, '0')}`, prefix, 'Undated Story');
    const datedAndUndated = [];
    let after;
    do {
      const page = await service.getRequirementsPage({ project_id: prefix, include_total: false, cursor: after, projection: 'summary' });
      datedAndUndated.push(...page.items);
      after = page.next_cursor || undefined;
    } while (after);
    assert.equal(datedAndUndated.length, 93);
    assert.equal(new Set(datedAndUndated.map((item) => item.id)).size, 93);
    assert.ok(datedAndUndated.slice(-31).every((item) => item.created_at === null && item.updated_at === null));
    const undatedFirst = await service.getRequirementsPage({ project_id: prefix, label: 'null-dates', include_total: false });
    const nullCursor = JSON.parse(Buffer.from(undatedFirst.next_cursor, 'base64url'));
    assert.equal(nullCursor.activity, null);
    assert.equal(nullCursor.created_at, null);
    const undatedLast = await service.getRequirementsPage({ project_id: prefix, label: 'null-dates', include_total: false, cursor: undatedFirst.next_cursor });
    assert.equal(undatedLast.items.length, 6);
    for (let index = 0; index < 27; index += 1) await db.prepare("INSERT INTO requirements (id, project_id, title, created_at, updated_at, labels) VALUES (?, ?, ?, NULL, '2026-01-01 00:00:00.123456+00', '[\"null-created\"]'::jsonb)").run(`${prefix}-updated-${String(index).padStart(3, '0')}`, prefix, 'Updated undated Story');
    const updatedFirst = await service.getRequirementsPage({ project_id: prefix, label: 'null-created', include_total: false });
    const updatedCursor = JSON.parse(Buffer.from(updatedFirst.next_cursor, 'base64url'));
    assert.match(updatedCursor.activity, /123456/);
    assert.equal(updatedCursor.created_at, null);
    const updatedLast = await service.getRequirementsPage({ project_id: prefix, label: 'null-created', include_total: false, cursor: updatedFirst.next_cursor });
    assert.equal(updatedLast.items.length, 2);
    assert.equal(new Set([...updatedFirst.items, ...updatedLast.items].map((item) => item.id)).size, 27);

  } finally { await db.close(); }
});
