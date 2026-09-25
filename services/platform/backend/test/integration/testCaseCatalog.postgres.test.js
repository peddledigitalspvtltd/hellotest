const assert = require('node:assert/strict');
const test = require('node:test');

// Requires a disposable database initialized with schema.sql and runtime migrations.
test('Test Case catalog keeps pages stable and complete metrics separate in PostgreSQL', {
  skip: process.env.TEST_CASE_CATALOG_POSTGRES !== '1', timeout: 30000
}, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname.slice(1), /^agent_verify_[a-z0-9_]+$/);
  const db = require('../../src/db');
  const catalog = require('../../../../testing/backend/services/testCaseCatalog.service');
  const prefix = `caseperf-${Date.now()}`;
  const project = `${prefix}-project`, app = `${prefix}-app`, module = `${prefix}-module`;
  try {
    await db.prepare('INSERT INTO projects(id,name) VALUES(?,?)').run(project, 'Catalog test');
    await db.prepare('INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,?,?)').run(app, project, 'Test app', 'web');
    await db.prepare('INSERT INTO test_case_modules(id,app_type_id,name) VALUES(?,?,?)').run(module, app, 'Payments');
    await db.prepare(`INSERT INTO test_cases(id,app_type_id,title,automated,created_at,updated_at)
      SELECT ? || '-' || LPAD(n::text,3,'0'), ?,
        CASE WHEN n = 1 THEN 'Literal 100%_match' ELSE 'Case ' || n END, 'no',
        CASE WHEN n > 55 THEN NULL ELSE '2026-09-01T00:00:00.123456Z'::timestamptz END,
        CASE WHEN n > 55 THEN NULL ELSE '2026-09-01T00:00:00.123456Z'::timestamptz END
      FROM generate_series(1,57) n`).run(prefix, app);
    await db.prepare('INSERT INTO test_cases(id,app_type_id,title,automated) VALUES(?,?,?,?)').run(`${prefix}-auto`, app, 'Automation', 'yes');
    await db.prepare(`INSERT INTO test_case_module_cases(module_id,test_case_id,sort_order)
      SELECT ?, ? || '-' || LPAD(n::text,3,'0'), n FROM generate_series(1,28) n`).run(module, prefix);
    await db.prepare('INSERT INTO test_steps(id,test_case_id,step_order,action) VALUES(?,?,?,?)').run(`${prefix}-step`, `${prefix}-001`, 1, 'Check');
    const scope = { project_id: project, app_type_id: app, page_size: 25, include_total: false, exclude_automated: true, projection: 'summary' };
    const metrics = await catalog.getMetrics(scope);
    assert.equal(metrics.catalog.total, 57);
    assert.equal(metrics.modules[module].count, 28);
    assert.equal(metrics.unassigned.count, 29);
    const first = await catalog.listPage(scope);
    assert.equal(first.items.length, 25);
    assert.equal('total' in first, false);
    assert.match(JSON.parse(Buffer.from(first.next_cursor, 'base64url')).activity, /\.123456/);
    await db.prepare('INSERT INTO test_cases(id,app_type_id,title,automated,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(`${prefix}-new`, app, 'Concurrent insert', 'no', '2026-09-02', '2026-09-02');
    const records = [...first.items], sizes = [first.items.length];
    let cursor = first.next_cursor;
    while (cursor) {
      const page = await catalog.listPage({ ...scope, cursor });
      records.push(...page.items); sizes.push(page.items.length); cursor = page.next_cursor;
    }
    assert.deepEqual(sizes, [25, 25, 7]);
    assert.equal(new Set(records.map(row => row.id)).size, 57);
    assert.equal(records.some(row => row.id === `${prefix}-new` || row.id === `${prefix}-auto`), false);
    assert.equal(records.filter(row => row.created_at === null).length, 2);
    assert.ok(records.every(row => !('gherkin_document' in row)));
    const found = await catalog.listPage({ ...scope, search: '100%_match' });
    assert.equal(found.items.length, 1);
    assert.equal(found.items[0].step_count, 1);
    const modulePage = await catalog.listPage({ ...scope, module_id: module });
    assert.equal(modulePage.items.length, 25);
    assert.equal((await catalog.listPage({ ...scope, module_id: module, cursor: modulePage.next_cursor })).items.length, 3);
    for (const change of [{ search: 'other' }, { module_id: module }, { project_id: `${prefix}-other` }]) {
      await assert.rejects(catalog.listPage({ ...scope, ...change, cursor: first.next_cursor }), error => error.statusCode === 400);
    }
    assert.equal((await catalog.getMetrics(scope)).catalog.total, 58);
    assert.equal((await catalog.listPage(scope)).items[0].id, `${prefix}-new`);
  } finally {
    await db.prepare('DELETE FROM test_steps WHERE test_case_id IN (SELECT id FROM test_cases WHERE app_type_id = ?)').run(app);
    await db.prepare('DELETE FROM test_case_module_cases WHERE module_id = ?').run(module);
    await db.prepare('DELETE FROM test_cases WHERE app_type_id = ?').run(app);
    await db.prepare('DELETE FROM test_case_modules WHERE id = ?').run(module);
    await db.prepare('DELETE FROM app_types WHERE id = ?').run(app);
    await db.prepare('DELETE FROM projects WHERE id = ?').run(project);
    await db.close();
  }
});
