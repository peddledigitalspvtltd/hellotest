const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('durable workflow scheduling preserves parallel dependencies, loop receipts, cancellation and replay', { skip: process.env.WORKFLOW_TEMPORAL_POSTGRES_TEST !== '1', timeout: 120000 }, async () => {
  const primary = new URL(process.env.DATABASE_URL);
  const observation = new URL(process.env.OBS_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(primary.hostname));
  assert.match(primary.pathname, /^\/agent_verify_workflow_temporal_\d+$/);
  assert.equal(primary.href, observation.href);
  assert.equal(process.env.KNOWLEDGE_VECTOR_STORE, 'postgresql');
  const db = require('../../src/db');
  const obsDb = require('../../src/obsDb');
  let originalError;
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS projects").get()).projects, null, 'Only initialize an empty disposable database.');
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../src/db/bootstrap').ensureRuntimeSchema();
    const userId = randomUUID(), projectId = randomUUID(), roleId = randomUUID();
    await db.prepare('INSERT INTO roles(id,name) VALUES (?,?)').run(roleId, 'Disposable durable workflow administrator');
    await db.prepare("INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES (?,?,?,?,TRUE,'active')").run(userId, 'temporal-fixture@example.test', 'not-a-login', 'Durable workflow fixture');
    await db.prepare('INSERT INTO projects(id,name,created_by) VALUES (?,?,?)').run(projectId, 'Disposable durable workflow project', userId);
    await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES (?,?,?,?)').run(randomUUID(), projectId, userId, roleId);
    const workflow = await require('../../../../agentic/backend/services/agenticWorkflow.service').createWorkflow({ project_id: projectId,
      name: 'Durable scheduling fixture', nodes: [{ id: 'input', data: { kind: 'trigger' } }, { id: 'output', data: { kind: 'output' } }],
      edges: [{ id: 'input-output', source: 'input', target: 'output' }] }, userId);
    const result = await require('../../../../agentic/test/helpers/temporalSchedulingChecks').run({ db, workflow, user: { id: userId, role: 'admin', is_workspace_admin: true } });
    console.log(JSON.stringify({ temporal_native_scheduling: result }));
  } catch (error) { originalError = error; throw error; }
  finally {
    const failures = [];
    for (const adapter of [obsDb, db]) { try { await adapter.close(); } catch (error) { failures.push(error); } }
    if (!originalError && failures.length) throw new AggregateError(failures, 'Disposable database adapter cleanup failed.');
  }
});
