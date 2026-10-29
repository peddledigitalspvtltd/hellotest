const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

// Real personal credentials stay in memory; every persisted fixture is deleted.
// Never include issuance response bodies or credential headers in diagnostics.
exports.verify = async ({ app, db, createToken }) => {
  const userId = 'api-story-user', roleId = 'api-story-role', projectId = 'api-story-project';
  const session = { authorization: 'Bearer ' + createToken({ id: userId }) };
  const oldFlags = await db.prepare('SELECT value FROM app_settings WHERE key=?').get('feature_flags');
  const issued = [];
  try {
    await db.query("INSERT INTO roles(id,name) VALUES ('api-story-role','Story API fixture')");
    await db.query("INSERT INTO role_permissions(role_id,permission_id) SELECT 'api-story-role',id FROM permissions WHERE code IN ('api_key.manage','project.view','requirement.view','requirement.create','requirement.update','requirement_iteration.update')");
    await db.query("INSERT INTO users(id,email,password_hash,name,default_role_id) VALUES ('api-story-user','api-story@example.test','unused','Story API actor','api-story-role')");
    await db.query("INSERT INTO projects(id,name,visibility,created_by) VALUES ('api-story-project','Story API fixture','private','api-story-user')");
    await db.query("INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('api-story-member','api-story-project','api-story-user','api-story-role')");
    await db.query("INSERT INTO requirement_iterations(id,project_id,name) VALUES ('api-story-sprint','api-story-project','API Sprint')");
    await db.query("INSERT INTO requirements(id,project_id,title) VALUES ('api-story-foreign','mcp-p-b','Foreign project Story')");
    const issue = async scope => {
      const response = await app.inject({ method: 'POST', url: '/settings/api-keys', headers: session, payload: { name: `Story ${scope} fixture`, scope, user_id: 'mcp-b' } });
      assert.equal(response.statusCode, 200, 'A signed-in user can issue a personal API key');
      assert.equal(response.headers['cache-control'], 'no-store');
      const result = response.json(); issued.push(result);
      assert.ok(result.key.startsWith('hellotest_'), 'Issued credentials use the personal API prefix');
      const stored = await db.prepare('SELECT user_id,key_hash FROM user_api_keys WHERE id=?').get(result.api_key.id);
      assert.equal(stored.user_id, userId, 'Caller-supplied user_id cannot change the key owner');
      assert.ok(stored.key_hash === createHash('sha256').update(result.key).digest('hex'), 'Only the credential hash is persisted');
      return result;
    };
    assert.equal((await app.inject({ method: 'POST', url: '/settings/api-keys', headers: session, payload: { name: 'Invalid scope fixture', scope: 'desgin' } })).statusCode, 400, 'Invalid scopes cannot silently issue broad User access');
    assert.equal((await db.prepare('SELECT COUNT(*)::integer AS count FROM user_api_keys WHERE user_id=?').get(userId)).count, 0);
    const design = await issue('design'), read = await issue('read'), normal = await issue('user'), runs = await issue('runs');
    const headers = { 'x-api-key': design.key };
    const create = await app.inject({ method: 'POST', url: '/requirements', headers, payload: { project_id: projectId, iteration_id: 'api-story-sprint', title: 'Checkout retry via API', description: 'Exactly one order remains.', acceptance_criteria: ['One checkout remains after retry.'], created_by: 'mcp-b' } });
    assert.equal(create.statusCode, 200, create.body);
    const story = create.json();
    const persisted = await db.prepare('SELECT created_by,iteration_id FROM requirements WHERE id=?').get(story.id);
    assert.equal(persisted.created_by, userId); assert.equal(persisted.iteration_id, 'api-story-sprint');
    const page = await app.inject({ url: `/requirements?project_id=${projectId}&sprint_id=api-story-sprint&include_page=true&page_size=1`, headers });
    assert.equal(page.statusCode, 200, page.body); assert.deepEqual(page.json().items.map(item => item.id), [story.id]);
    assert.equal(page.json().is_last, true); assert.equal(page.json().next_cursor, null);
    const detail = await app.inject({ url: `/requirements/${story.id}`, headers: { authorization: 'Bearer ' + design.key } });
    assert.equal(detail.statusCode, 200, detail.body);
    const update = await app.inject({ method: 'PUT', url: `/requirements/${story.id}`, headers, payload: { title: 'Updated checkout retry', expected_revision: detail.json().revision, updated_by: 'mcp-b' } });
    assert.equal(update.statusCode, 200, update.body); assert.equal((await db.prepare('SELECT updated_by FROM requirements WHERE id=?').get(story.id)).updated_by, userId);
    const userUpdate = await app.inject({ method: 'PUT', url: `/requirements/${story.id}`, headers: { authorization: 'Bearer ' + normal.key }, payload: { description: 'Current user scope can update this Story.', expected_revision: update.json().revision } });
    assert.equal(userUpdate.statusCode, 200, userUpdate.body);
    const userCreate = await app.inject({ method: 'POST', url: '/requirements', headers: { authorization: 'Bearer ' + normal.key }, payload: { project_id: projectId, title: 'Created with User access' } });
    assert.equal(userCreate.statusCode, 200, userCreate.body);
    const readHeaders = { 'x-api-key': read.key };
    assert.equal((await app.inject({ url: `/requirements/${story.id}`, headers: readHeaders })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/requirements', headers: readHeaders, payload: { project_id: projectId, title: 'Read key cannot write' } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'PUT', url: `/requirements/${story.id}`, headers: readHeaders, payload: { title: 'Read key cannot update' } })).statusCode, 403);
    assert.equal((await app.inject({ url: `/requirements?project_id=${projectId}`, headers: { 'x-api-key': runs.key } })).statusCode, 403, 'A Runs key cannot borrow Story permissions');
    for (const request of [
      { url: '/requirements?project_id=mcp-p-b' }, { url: '/requirements/api-story-foreign' },
      { method: 'POST', url: '/requirements', payload: { project_id: 'mcp-p-b', title: 'Cross-project write' } },
      { method: 'PUT', url: '/requirements/api-story-foreign', payload: { project_id: projectId, title: 'Cross-project update' } }
    ]) assert.equal((await app.inject({ ...request, headers })).statusCode, 403, 'Credentials never bypass current project membership');
    assert.equal((await app.inject({ url: '/settings/api-keys', headers })).statusCode, 403, 'Keys cannot manage themselves');
    assert.equal((await app.inject({ method: 'POST', url: '/settings/api-keys', headers, payload: { name: 'Nested API credential', scope: 'user' } })).statusCode, 403);
    const list = await app.inject({ url: '/settings/api-keys', headers: session });
    assert.equal(list.statusCode, 200); assert.equal(list.headers['cache-control'], 'no-store');
    assert.ok(!issued.some(item => list.body.includes(item.key)), 'API-key listings never redisclose plaintext');
    assert.ok(!list.body.includes('key_hash'), 'API-key listings never expose hashes');
    await db.query("DELETE FROM role_permissions WHERE role_id='api-story-role' AND permission_id IN (SELECT id FROM permissions WHERE code='requirement.update')");
    assert.equal((await app.inject({ method: 'PUT', url: `/requirements/${story.id}`, headers, payload: { title: 'Revoked permission' } })).statusCode, 403, 'Permissions are rechecked after issuance');
    await db.query("INSERT INTO role_permissions(role_id,permission_id) SELECT 'api-story-role',id FROM permissions WHERE code='requirement.update'");
    await db.query("UPDATE users SET status='suspended' WHERE id='api-story-user'");
    assert.equal((await app.inject({ url: `/requirements/${story.id}`, headers })).statusCode, 403, 'Suspended owners cannot use an existing key');
    await db.query("UPDATE users SET status='active' WHERE id='api-story-user'");
    await require('../../services/featureFlag.service').updateLocalFlags({ 'hellotest.api.keys': false });
    const disabled = await app.inject({ url: `/requirements/${story.id}`, headers });
    assert.equal(disabled.statusCode, 403); assert.equal(disabled.json().code, 'FEATURE_DISABLED');
    assert.equal((await app.inject({ url: `/requirements/${story.id}`, headers: session })).statusCode, 200, 'Disabling API keys leaves browser Story access available');
    await require('../../services/featureFlag.service').updateLocalFlags({ 'hellotest.api.keys': true });
    assert.equal((await app.inject({ method: 'DELETE', url: `/settings/api-keys/${design.api_key.id}`, headers: session })).statusCode, 200);
    assert.equal((await app.inject({ url: `/requirements/${story.id}`, headers })).statusCode, 401, 'Revocation blocks the next request');
    assert.equal((await app.inject({ method: 'DELETE', url: `/settings/api-keys/${design.api_key.id}/permanent`, headers: session })).statusCode, 200);
    assert.equal((await app.inject({ url: `/requirements/${story.id}`, headers: readHeaders })).statusCode, 200, 'Revoking one key preserves other credentials');
  } finally {
    if (oldFlags) await db.prepare('UPDATE app_settings SET value=? WHERE key=?').run(oldFlags.value, 'feature_flags');
    else await db.prepare('DELETE FROM app_settings WHERE key=?').run('feature_flags');
    await db.prepare('DELETE FROM requirements WHERE id=?').run('api-story-foreign');
    await db.prepare('DELETE FROM requirements WHERE project_id=?').run(projectId);
    await db.prepare('DELETE FROM requirement_iterations WHERE project_id=?').run(projectId);
    await db.prepare('DELETE FROM project_members WHERE project_id=?').run(projectId);
    await db.prepare('DELETE FROM projects WHERE id=?').run(projectId);
    await db.prepare('DELETE FROM users WHERE id=?').run(userId);
    await db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(roleId);
    await db.prepare('DELETE FROM roles WHERE id=?').run(roleId);
  }
};
