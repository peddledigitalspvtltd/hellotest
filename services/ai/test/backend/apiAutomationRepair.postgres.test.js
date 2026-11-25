const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('typed API repair uses real HTTP and applies only after pinned positive and negative runner checks', {
  skip: process.env.AUTOMATION_API_REPAIR_POSTGRES !== '1', timeout: 120000
}, async () => {
  const target = new URL(process.env.DATABASE_URL);
  assert.match(target.pathname, /^\/agent_verify_automation_api_repair_\d+$/);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
  assert.equal(process.env.DATABASE_URL, process.env.OBS_DATABASE_URL);
  const db = require('../../../platform/backend/src/db');
  const obsDb = require('../../../platform/backend/src/obsDb');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS projects").get()).projects, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../platform/backend/instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    const userId = randomUUID(), projectId = randomUUID(), appTypeId = randomUUID(), roleId = randomUUID();
    await db.prepare('INSERT INTO roles(id,name) VALUES(?,?)').run(roleId, 'Disposable API repair administrator');
    await db.prepare("INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES(?,?,?,?,TRUE,'active')").run(userId, 'api-repair@example.test', 'not-a-login', 'API repair fixture');
    await db.prepare('INSERT INTO projects(id,name,created_by) VALUES(?,?,?)').run(projectId, 'Isolated API repair checks', userId);
    await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(randomUUID(), projectId, userId, roleId);
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,?,'api')").run(appTypeId, projectId, 'API fixture');
    await require('../helpers/automationRepairChecks').runApi({ db, obsDb, user: { id: userId, role: 'admin' }, projectId, appTypeId });
  } finally { await Promise.all([obsDb.close(), db.close()]); }
});
