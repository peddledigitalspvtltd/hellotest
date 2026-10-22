// Opt-in integration check against an EMPTY, disposable database. The database
// name guard prevents this test from initializing or changing a user database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('repository agents persist four analyses, publish into real stores and replay safely', { skip: !process.env.REPOSITORY_AGENTS_POSTGRES, timeout: 120000 }, async t => {
  const databaseName = new URL(process.env.DATABASE_URL).pathname.slice(1);
  assert.match(databaseName, /^agent_verify_[a-z0-9_]+$/);
  assert.equal(process.env.KNOWLEDGE_VECTOR_STORE, 'postgresql', 'Keep index validation inside the disposable database');
  const db = require('../../src/db');
  const agents = require('../../../../agentic/backend/agents/repositoryAgents.service');
  const { publishRun } = require('../../../../agentic/backend/agents/publish');
  const storage = require('../../src/services/objectStorage.service');
  t.mock.method(require('../../../../agentic/backend/agents/agentRegistry.service'), 'resolveModel', async () => ({ id: 'fixture-model', model: 'test-model' }));
  t.mock.method(require('../../../../agentic/backend/services/agenticAssistant.service'), 'respond', async () => ({ transaction: { id: 'fixture-model-review' }, result: { response: 'Source findings reviewed.', verification: { status: 'passed' } }, provenance: { generation_mode: 'llm' } }));
  try {
    await db.query(fs.readFileSync(process.env.REPOSITORY_AGENT_SCHEMA_PATH, 'utf8'));
    await require('../../src/db/bootstrap').ensureRuntimeSchema();
    const projectId = randomUUID(), applicationId = randomUUID(), userId = randomUUID(), roleId = randomUUID();
    await db.prepare('INSERT INTO roles(id,name) VALUES (?,?)').run(roleId, 'Agent validation administrator');
    await db.prepare("INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES (?,?,?,?,TRUE,'active')").run(userId, 'agent-validation@example.test', 'not-a-login', 'Agent validation');
    await db.prepare('INSERT INTO projects(id,name,created_by) VALUES (?,?,?)').run(projectId, 'Disposable agent validation', userId);
    await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES (?,?,?,?)').run(randomUUID(), projectId, userId, roleId);
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES (?,?,?,'web')").run(applicationId, projectId, 'Fixture application');
    const user = { id: userId, role: 'admin' };
    const file = { filename: 'sample.zip', buffer: fs.readFileSync(process.env.REPOSITORY_AGENT_FIXTURE) };
    const terminal = async id => {
      for (let attempt = 0; attempt < 300; attempt++) {
        const row = await agents.getRun(id, user);
        if (!['queued','running'].includes(row.status)) { assert.ok(['completed','partial'].includes(row.status), row.error); return row; }
        await pause(100);
      }
      assert.fail('Agent analysis did not complete');
    };
    const receipts = [];
    for (const [agentType, key] of [['object_repository','objects'], ['api_tests','test_cases'], ['repository_knowledge','knowledge'], ['component_tests','test_cases']]) {
      const input = { project_id: projectId, app_type_id: applicationId, agent_type: agentType };
      const queued = await agents.createRun(input, user, { file, requestKey: agentType });
      const replay = await agents.createRun(input, user, { file, requestKey: agentType });
      assert.equal(replay.id, queued.id);
      const run = await terminal(queued.id);
      for (const artifact of run.result.artifacts) {
        assert.equal(artifact.content, undefined, 'Run responses should not duplicate downloadable artifact content');
        const download = await agents.getArtifact(run.id, artifact.name, user);
        assert.equal(download.project_id, projectId);
        assert.equal(Buffer.byteLength(download.artifact.content, 'utf8'), artifact.size_bytes);
      }
      const findings = run.result.findings[key];
      assert.ok(findings.length, agentType + ' should produce findings');
      const selection = findings.slice(0, 10).map(item => item.id);
      const publishInput = { item_ids: selection, ...(agentType === 'component_tests' ? { automation_start_url: 'https://reviewed-component.example.test' } : {}) };
      const published = await publishRun(run.id, publishInput, user);
      assert.equal(published.items.length, selection.length, JSON.stringify(published));
      assert.deepEqual((await publishRun(run.id, publishInput, user)).items, published.items);
      assert.equal(published.skipped, 0);
      if (agentType === 'api_tests') {
        const saved = await require('../../../../testing/backend/services/testCase.service').getTestCase(published.items[0].target_id);
        assert.equal(saved.status, 'draft');
        assert.equal(saved.authoring_mode, 'structured');
        assert.equal(saved.automated, 'yes');
        assert.equal(saved.automation_status, 'incomplete');
        const steps = await db.prepare('SELECT api_request FROM test_steps WHERE test_case_id = ?').all(saved.id);
        assert.ok(steps.some(step => step.api_request?.url === '@r.base_url/orders'));
        assert.ok(steps.some(step => step.api_request?.validations.some(rule => rule.expected === '201')));
      }
      receipts.push({ agent_type: agentType, findings: findings.length, published: published.items.length });
    }
    const cached = await agents.createRun({ project_id: projectId, app_type_id: applicationId, agent_type: 'api_tests' }, user, { file, requestKey: 'cached-analysis' });
    const cachedRun = await terminal(cached.id);
    assert.ok(cachedRun.cached_from, 'Unchanged source should reuse validated analysis');
    const duplicateCases = await publishRun(cachedRun.id, { item_ids: cachedRun.result.findings.test_cases.map(item => item.id) }, user);
    assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM test_cases WHERE app_type_id = ?').get(applicationId)).count, 4, 'Reanalysis must not duplicate the two API and two component test cases');
    assert.equal(duplicateCases.items.length, 2);
    assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM ai_knowledge_sync_outbox WHERE project_id = ?').get(projectId)).count, 4, 'Published documents must enter the durable indexing queue');
    assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM automation_learning_cache WHERE app_type_id = ?').get(applicationId)).count, 3, 'Screen and its fields must be persisted together');
    assert.equal((await agents.listRuns({ project_id: projectId }, user)).total, 5);
    assert.equal((await agents.listRuns({ project_id: projectId, app_type_id: applicationId, agent_type: 'api_tests' }, user)).total, 2);
    const rag = require('../../../../knowledge/backend/services/knowledgeRag.service');
    const indexed = await rag.processLegacyKnowledgeSyncOutbox({ limit: 4 });
    assert.equal(indexed.length, 4);
    assert.ok(indexed.every(item => item.status === 'completed'), JSON.stringify(indexed));
    const retrieved = await rag.search({ projectId, query: 'Checkout order', mode: 'keyword', filters: { app_type_id: applicationId, source_kinds: ['knowledge_item'] }, user });
    assert.ok(retrieved.results.length > 0, 'Published repository evidence must be retrievable after indexing');
    assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM ai_knowledge_sync_outbox WHERE project_id = ?').get(projectId)).count, 0);
    console.log(JSON.stringify({ validated: receipts, cache_reused: true, publications_idempotent: true, knowledge_indexed: indexed.length, retrieved_evidence: retrieved.results.length }));
  } finally {
    await agents.shutdown();
    // Only source objects from this explicitly disposable database are removed.
    const exists = await db.prepare("SELECT to_regclass('repository_agent_runs') AS table_name").get();
    if (exists?.table_name) for (const row of await db.prepare('SELECT input FROM repository_agent_runs').all()) if (row.input?.archive) await storage.removeObject(row.input.archive);
    await require('../../src/obsDb').close();
    await db.close();
  }
});
