const assert = require('node:assert/strict');
const test = require('node:test');

test('First login assigns only the setup project, preserves grants, and handles concurrent users safely', {
  skip: !process.env.DEFAULT_MEMBERSHIP_TEST_DATABASE_URL, timeout: 30000
}, async (t) => {
  const url = process.env.DEFAULT_MEMBERSHIP_TEST_DATABASE_URL;
  assert.match(new URL(url).pathname.slice(1), /^agent_verify_[a-z0-9_]+$/);
  process.env.DATABASE_URL = url;
  const db = require('../../src/db');
  const membership = require('../../services/defaultProjectMembership.service');
  const token = require('../../src/utils/token');
  try {
    const password = 'Fixture correct horse battery staple!';
    const hash = await token.hashPasswordAsync(password);
    await db.query("INSERT INTO projects(id,name) VALUES ('sample-project','Customized setup title'),('unrelated','Private project')");
    await db.query("INSERT INTO roles(id,name) VALUES('fixture-member','member'),('fixture-admin','admin') ON CONFLICT(name) DO NOTHING");
    await db.query("INSERT INTO permissions(id,code,description) VALUES('fixture-view','project.view','View projects') ON CONFLICT(code) DO NOTHING");
    const member = (await db.query("SELECT id FROM roles WHERE name='member'")).rows[0];
    const admin = (await db.query("SELECT id FROM roles WHERE name='admin'")).rows[0];
    assert.ok(member && admin);
    // A customized default member role must not silently regain stock grants.
    await db.query('DELETE FROM role_permissions WHERE role_id=?', [member.id]);
    await db.query("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE code='project.view'", [member.id]);
    for (const id of ['concurrent','assigned','administrator','suspended','first-login','retry-login','deleting']) {
      await db.query('INSERT INTO users(id,email,password_hash,status,is_workspace_admin) VALUES(?,?,?,?,?)', [id, id+'@membership.test', hash, id==='suspended'?'suspended':'active', id==='administrator']);
    }
    await db.query('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?),(?,?,?,?)', ['existing','unrelated','assigned',member.id,'admin-other','unrelated','administrator',admin.id]);
    const results = await Promise.all(Array.from({ length: 6 }, () => membership.assign('concurrent')));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await db.query("SELECT COUNT(*)::int count FROM project_members WHERE user_id='concurrent'")).rows[0].count, 1);
    assert.equal(await membership.assign('assigned'), false, 'an assigned user never gains another project');
    assert.equal(await membership.assign('suspended'), false);
    assert.equal(await membership.assign('administrator'), true);
    const adminMembership = (await db.query("SELECT role_id FROM project_members WHERE project_id='sample-project' AND user_id='administrator'")).rows[0];
    assert.equal(adminMembership.role_id, admin.id);
    await db.query("UPDATE project_members SET role_id=? WHERE project_id='sample-project' AND user_id='administrator'", [member.id]);
    assert.equal(await membership.assign('administrator'), false, 'existing customized memberships are preserved');
    const auth = require('../../services/auth.service');
    const session = await auth.login({ email: 'first-login@membership.test', password });
    assert.deepEqual(session.user.project_permissions['sample-project'], ['project.view'], 'first response already contains the new project grant');
    assert.ok((await db.query("SELECT last_login_at FROM users WHERE id='first-login'")).rows[0].last_login_at);
    const assign = membership.assign;
    const transient = t.mock.method(membership, 'assign', async userId => {
      if (userId === 'retry-login') throw new Error('Transient membership storage failure');
      return assign(userId);
    });
    await assert.rejects(auth.login({email:'retry-login@membership.test',password}), /Transient membership storage failure/);
    assert.equal((await db.query("SELECT last_login_at FROM users WHERE id='retry-login'")).rows[0].last_login_at, null, 'A failed first login must not consume the assignment opportunity');
    assert.equal((await db.query("SELECT COUNT(*)::int count FROM project_members WHERE user_id='retry-login'")).rows[0].count, 0);
    transient.mock.restore();
    const retried = await auth.login({email:'retry-login@membership.test',password});
    assert.deepEqual(retried.user.project_permissions['sample-project'], ['project.view']);
    assert.ok((await db.query("SELECT last_login_at FROM users WHERE id='retry-login'")).rows[0].last_login_at);
    assert.equal((await db.query('SELECT COUNT(*)::int count FROM role_permissions WHERE role_id=?', [member.id])).rows[0].count, 1, 'role customization is not overwritten');
    await db.query("INSERT INTO project_deletion_jobs(id,project_id,project_name,requested_by,status) VALUES('delete-setup','sample-project','Setup','administrator','queued')");
    assert.equal(await membership.assign('deleting'), false, 'a deleting setup project cannot admit new members');
    assert.equal((await db.query("SELECT COUNT(*)::int count FROM project_members WHERE user_id='deleting'")).rows[0].count, 0, 'unrelated private projects are not selected as a fallback');
  } finally {
    await db.close();
    await require('../../src/obsDb').close();
  }
});
