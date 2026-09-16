const assert = require('node:assert/strict');
const test = require('node:test');

// Run against a disposable database initialized with schema.sql and runtime migrations.
test('Bug catalog pages and metrics stay complete, scoped and stable in PostgreSQL', {
  skip: process.env.ISSUE_CATALOG_POSTGRES !== '1', timeout: 30000
}, async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname.slice(1), /^agent_verify_[a-z0-9_]+$/);
  const db = require('../../src/db');
  const issues = require('../../src/services/issues.service');
  const prefix = `bugperf-${Date.now()}`;
  const project = `${prefix}-project`;
  const other = `${prefix}-other`;
  const user = `${prefix}-user`;
  const app = `${prefix}-app`;
  const foreignApp = `${prefix}-foreign-app`;
  try {
    await db.prepare('INSERT INTO users(id,email,password_hash,name) VALUES(?,?,?,?)').run(user, `${prefix}@example.test`, 'unused', 'Catalog reporter');
    await db.prepare('INSERT INTO projects(id,name) VALUES(?,?),(?,?)').run(project, 'Catalog project', other, 'Foreign project');
    await db.prepare('INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,?,?),(?,?,?,?)').run(app, project, 'App', 'web', foreignApp, other, 'Foreign app', 'web');
    await db.prepare(`INSERT INTO feedback(id,display_id,project_id,user_id,title,message,status,priority,assignee_id,jira_bug_key,created_at)
      SELECT ? || '-' || LPAD(n::text,3,'0'), ? || '-' || n, ?, ?,
        CASE WHEN n >= 51 THEN 'needle ' ELSE 'Bug ' END || n, 'Reproduce failure',
        CASE WHEN n % 3 = 0 THEN 'closed' ELSE 'open' END,
        CASE WHEN n % 4 = 0 THEN 'High' ELSE 'Medium' END,
        CASE WHEN n % 2 = 0 THEN NULL ELSE ? END,
        ? || '-' || n,
        CASE WHEN n > 60 THEN NULL WHEN n <= 35 THEN '2026-09-15T10:00:00.123456Z'::timestamptz
          ELSE '2026-09-15T10:00:00.123456Z'::timestamptz + n * interval '1 microsecond' END
      FROM generate_series(1,67) n`).run(prefix, `${prefix}-BUG`, project, user, user, `${prefix}-JIRA`);
    await db.prepare('INSERT INTO feedback(id,project_id,user_id,title,message,status) VALUES(?,?,?,?,?,?)').run(`${prefix}-foreign`, other, user, 'needle foreign', 'Private', 'open');
    // Two converted cases still count their source Bug only once. Foreign cases do not count.
    await db.prepare('INSERT INTO test_cases(id,app_type_id,title,source_issue_id) VALUES(?,?,?,?),(?,?,?,?),(?,?,?,?)').run(
      `${prefix}-case1`, app, 'Converted one', `${prefix}-067`, `${prefix}-case2`, app, 'Converted two', `${prefix}-067`,
      `${prefix}-foreign-case`, foreignApp, 'Foreign conversion', `${prefix}-066`);
    const scope = { project_id: project, viewer_id: user, include_total: false, page_size: 25 };
    const metrics = await issues.getIssueMetrics(scope);
    assert.deepEqual(metrics, { total: 67, open: 45, priority_risks: 11, unassigned: 22, converted: 1, statuses: { closed: 22, open: 45 } });
    const first = await issues.getIssuePage(scope);
    assert.equal(first.items.length, 25);
    assert.equal('total' in first, false, 'Catalog pages must not count the entire catalog again');
    assert.equal('_cursor_created_at' in first.items[0], false);
    const cursor = JSON.parse(Buffer.from(first.next_cursor, 'base64url').toString());
    assert.match(cursor.created_at, /\.\d{6}Z$/, 'Preserve database timestamp precision');
    // An insert above the first page must neither duplicate nor omit existing records.
    await db.prepare('INSERT INTO feedback(id,project_id,user_id,title,message,created_at) VALUES(?,?,?,?,?,?)').run(`${prefix}-inserted`, project, user, 'Inserted later', 'New', '2026-09-16T10:00:00Z');
    const found = [...first.items];
    const lengths = [first.items.length];
    let page = first;
    while (!page.is_last) {
      page = await issues.getIssuePage({ ...scope, cursor: page.next_cursor });
      lengths.push(page.items.length);
      found.push(...page.items);
    }
    assert.deepEqual(lengths, [25,25,17]);
    assert.equal(new Set(found.map(item => item.id)).size, 67);
    assert.equal(found.some(item => item.id === `${prefix}-inserted` || item.id === `${prefix}-foreign`), false);
    assert.equal(page.next_cursor, null);
    assert.equal(found.filter(item => item.created_at === null).length, 7);
    for (const changed of [{ project_id: other }, { status: 'closed' }, { q: 'needle' }, { priority: 'High' }, { assignee_id: user }]) {
      await assert.rejects(issues.getIssuePage({ ...scope, ...changed, cursor: first.next_cursor }), error => error.statusCode === 400);
    }
    await assert.rejects(issues.getIssuePage({ ...scope, cursor: 'bad-cursor' }), error => error.statusCode === 400);
    for (const filter of [{ q: 'needle' }, { status: 'open', priority: 'High' }, { assignee_id: '__unassigned__' }, { q: 'needle', status: 'closed', assignee_id: user }, { q: '%_' }]) {
      const full = await issues.getIssues({ ...scope, ...filter });
      const totals = await issues.getIssueMetrics({ ...scope, ...filter });
      const bounded = await issues.getIssuePage({ ...scope, ...filter, include_total: true, page_size: 200 });
      assert.equal(totals.total, full.length);
      assert.equal(bounded.total, full.length);
      assert.deepEqual(bounded.items.map(item => item.id), full.map(item => item.id));
    }
    const referenced = await issues.getIssueItem(`${prefix}-JIRA-67`, { project_id: project, resolveReference: true });
    assert.equal(referenced.id, `${prefix}-067`, 'Deep links resolve independently of loaded pages');
    await assert.rejects(issues.getIssueItem(`${prefix}-JIRA-67`, { project_id: other, resolveReference: true }), /Issue not found/);
  } finally {
    await db.prepare('DELETE FROM test_cases WHERE id LIKE ?').run(`${prefix}%`);
    await db.prepare('DELETE FROM feedback WHERE project_id IN (?,?)').run(project, other);
    await db.prepare('DELETE FROM app_types WHERE project_id IN (?,?)').run(project, other);
    await db.prepare('DELETE FROM projects WHERE id IN (?,?)').run(project, other);
    await db.prepare('DELETE FROM users WHERE id = ?').run(user);
    await db.close();
  }
});
