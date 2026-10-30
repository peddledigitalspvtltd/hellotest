const assert = require('node:assert/strict');
const test = require('node:test');
const { Readable, PassThrough } = require('node:stream');
const db = require('../src/db');
const service = require('../../../agentic/backend/agents/repositoryAgents.service');
const compiler = require('../../../agentic/backend/agents/compiler');
const sources = require('../../../agentic/backend/agents/repositorySource');
const publisher = require('../../../agentic/backend/agents/publish');
const permissions = require('../services/permission.service');
const projects = require('../services/project.service');
const storage = require('../src/services/objectStorage.service');
const cases = require('../../../testing/backend/services/testCase.service');
const modules = require('../../../testing/backend/services/testCaseModule.service');
const knowledge = require('../../../knowledge/backend/services/aiKnowledge.service');
const objects = require('../../../automation/backend/services/aiAutomationBuilder.service');
const mobileFeatures = require('../services/mobileFeature.service');
const { normalizeApiRequest, normalizeTestStepType } = require('../src/utils/testStepAutomation');
const { FINDING_KEYS, LIMITS } = require('../../../agentic/backend/agents/catalog');

const user = { id: 'user-a', role: 'member' };
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const source = { type: 'github', repository_url: 'https://github.com/acme/repository', ref: 'main' };
const finding = {
  id: 'finding-1', title: 'GET /users returns documented users', description: 'Read the users contract.',
  method: 'GET', path: '/users', expected_status: 200, confidence: 0.9,
  evidence: [{ path: 'src/users.ts', line: 12 }],
  steps: [{ action: 'Request <script>alert(1)</script>', expected_result: 'Review the documented response.' }],
  assumptions: ['Provide an authorized account.'], review_reasons: ['Runtime behavior requires verification.']
};
const result = (agentType = 'api_tests', findings = [finding], patch = {}) => ({
  schema_version: 1, agent_type: agentType, findings: { [FINDING_KEYS[agentType]]: structuredClone(findings) },
  summary: { files_scanned: 1, status: 'completed' }, stages: [{ id: 'compile', label: 'Compile contracts', status: 'completed' }], warnings: [],
  artifacts: [{ name: 'contracts.json', content: '{"safe":true}' }], ...patch
});
const run = (patch = {}) => ({
  id: 'run-a', project_id: 'project-a', app_type_id: 'app-a', agent_type: 'api_tests', status: 'completed',
  source: { type: 'zip', name: 'source.zip' }, input: { archive: { bucket: 'private', objectName: 'source.zip' } },
  input_hash: 'internal-hash', compiler_version: 'version', request_key: 'private-key', lease_token: 'lease', heartbeat_at: 'private-heartbeat',
  created_by: user.id, result: result(), published: { items: [] }, ...patch
});

// Individual lifecycle tests invoke the worker explicitly. No fixture may start
// an automatic queue poll or connect to the user's database.
test.before(() => service.shutdown());
function scope(t, { allow = true, appProject = 'project-a' } = {}) {
  t.mock.method(require('../../../agentic/backend/agents/agentRegistry.service'), 'resolveModel', async () => ({ id: 'model', model: 'test-model' }));
  t.mock.method(require('../../../agentic/backend/services/agenticAssistant.service'), 'respond', async () => ({ transaction: { id: 'model-review' }, result: { response: 'Source findings reviewed.', verification: { status: 'passed' } }, provenance: { generation_mode: 'llm' } }));
  const accesses = [];
  t.mock.method(projects, 'getProject', async (id, actor) => { accesses.push(['project', id, actor]); return { id }; });
  t.mock.method(permissions, 'hasPermission', async (_user, permission, project) => { accesses.push(['permission', permission, project]); return typeof allow === 'function' ? allow(permission, project) : allow; });
  t.mock.method(compiler, 'runtimeStatus', async () => ({ available: true }));
  t.mock.method(compiler, 'compilerVersion', async () => 'version');
  return { accesses, appProject };
}
function database(t, handler) {
  const calls = [];
  t.mock.method(db, 'prepare', sql => Object.fromEntries(['get', 'all', 'run'].map(method => [method, async (...args) => {
    const query = sql.replace(/\s+/g, ' ').trim(); calls.push({ query, method, args });
    if (/^SELECT id, project_id(?:, type)? FROM app_types WHERE id = \?$/.test(query)) return { id: args[0], project_id: 'project-a', type:'web' };
    return handler(query, method, args);
  }])));
  t.mock.method(db, 'query', async (query, args) => { calls.push({ query, args }); return {}; });
  t.mock.method(db, 'transaction', callback => async (...args) => callback(...args));
  return calls;
}
const unreachable = (query) => assert.fail(`Unexpected database query: ${query}`);

test('public run serialization excludes upload locations, idempotency keys and worker lease internals', () => {
  const original = run();
  const visible = service.toPublic(original);
  for (const key of ['input', 'input_hash', 'compiler_version', 'request_key', 'lease_token', 'heartbeat_at']) assert.equal(visible[key], undefined);
  assert.equal(visible.id, 'run-a');
  assert.equal(visible.result.artifacts[0].name, 'contracts.json');
  assert.equal(visible.result.artifacts[0].content, undefined);
  assert.equal(visible.result.artifacts[0].size_bytes, Buffer.byteLength('{"safe":true}'));
  assert.equal(original.result.artifacts[0].content, '{"safe":true}', 'Downloads retain the full stored artifact');
  assert.throws(() => service.toPublic(null), { statusCode: 404 });
});

test('analysis history filters agent and status within the authorized application', async t => {
  scope(t);
  const calls = database(t, (sql, method) => method === 'all' ? [run()] : { total: 21 });
  const response = await service.listRuns({ project_id: 'project-a', app_type_id: 'app-a', agent_type: 'api_tests', status: 'partial', page: 2 }, user);
  assert.equal(response.total, 21); assert.equal(response.has_more, false);
  const queries = calls.filter(call => call.query.includes('FROM repository_agent_runs'));
  assert.equal(queries.length, 2);
  for (const call of queries) {
    assert.ok(call.query.includes('project_id = ? AND app_type_id = ? AND agent_type = ? AND status = ?'));
    assert.deepEqual(call.args.slice(0, 4), ['project-a', 'app-a', 'api_tests', 'partial']);
  }
  await assert.rejects(service.listRuns({ project_id: 'project-a', agent_type: 'unsupported' }, user), { statusCode: 400 });
  await assert.rejects(service.listRuns({ project_id: 'project-a', status: "completed' OR TRUE" }, user), { statusCode: 400 });
});

test('artifact retrieval authorizes project scope and requires a finished result', async t => {
  scope(t);
  let row = { project_id: 'project-a', app_type_id: 'app-a', status: 'completed', artifacts: [{ name: 'contracts.json', content: '{"safe":true}' }] };
  database(t, () => row);
  assert.equal((await service.getArtifact('run-a', 'contracts.json', user)).artifact.content, '{"safe":true}');
  await assert.rejects(service.getArtifact('run-a', '../contracts.json', user), { statusCode: 404 });
  await assert.rejects(service.getArtifact('run-a', 'missing.json', user), { statusCode: 404 });
  row = { ...row, status: 'running' };
  await assert.rejects(service.getArtifact('run-a', 'contracts.json', user), { statusCode: 404 });
  t.mock.method(permissions, 'hasPermission', async () => false);
  await assert.rejects(service.getArtifact('run-a', 'contracts.json', user), { statusCode: 403 });
});

test('scope checks project membership and permission before accepting an application', async t => {
  const state = scope(t, { allow: false });
  const calls = database(t, unreachable);
  await assert.rejects(service.requireScope('project-a', 'app-a', user, 'agentic_workflow.run'), { statusCode: 403 });
  assert.deepEqual(state.accesses, [['project', 'project-a', 'user-a'], ['permission', 'agentic_workflow.run', 'project-a']]);
  assert.equal(calls.length, 0);
});

test('a project cannot use an application owned by another project', async t => {
  scope(t);
  t.mock.method(db, 'prepare', () => ({ get: async () => ({ id: 'foreign', project_id: 'project-b' }) }));
  await assert.rejects(service.requireScope('project-a', 'foreign', user), { statusCode: 403 });
});

test('small malformed uploads produce validation errors rather than buffer RangeErrors', async t => {
  scope(t); database(t, unreachable);
  for (const buffer of [Buffer.from([0x50]), Buffer.from('bad')]) {
    await assert.rejects(service.createRun({ project_id: 'project-a', app_type_id: 'app-a', agent_type: 'api_tests' }, user, { file: { filename: 'source.zip', buffer } }), error => error.statusCode === 400 || error.statusCode === 413);
  }
});

test('oversized and truncated uploads are rejected before object storage', async t => {
  scope(t); database(t, unreachable);
  t.mock.method(storage, 'putObject', async () => assert.fail('Invalid upload must not be saved'));
  for (const file of [{ filename: 'source.zip', buffer: zip, truncated: true }, { filename: 'source.zip', buffer: Buffer.alloc(LIMITS.max_archive_bytes + 1) }]) {
    await assert.rejects(service.createRun({ project_id: 'project-a', app_type_id: 'app-a', agent_type: 'api_tests' }, user, { file }), { statusCode: 413 });
  }
});

test('private GitHub source requires integration access before queue insertion', async t => {
  scope(t, { allow: permission => permission !== 'integration.view' }); database(t, unreachable);
  await assert.rejects(service.createRun({ project_id: 'project-a', app_type_id: 'app-a', agent_type: 'api_tests', source: { ...source, integration_id: 'saved' } }, user), { statusCode: 403 });
});

test('creating an upload is idempotent and changing payload under the same key is rejected', async t => {
  scope(t); let storedRun; let writes = 0; let uploads = 0;
  t.mock.method(storage, 'putObject', async () => { uploads++; return { bucket: 'private' }; });
  const calls = database(t, (sql, _method, args) => {
    if (sql.includes('request_key = ?')) return storedRun;
    if (sql.startsWith('SELECT count(*)')) return { total: 0 };
    if (sql.startsWith('INSERT INTO repository_agent_runs')) {
      writes++;
      storedRun = run({ id: args[0], project_id: args[1], app_type_id: args[2], agent_type: args[3], source: args[4], input: args[5], input_hash: args[6], compiler_version: args[7], request_key: args[8], created_by: args[9], status: 'queued', result: null });
      return { changes: 1 };
    }
    if (sql === 'SELECT * FROM repository_agent_runs WHERE id = ?') return structuredClone(storedRun);
    return unreachable(sql);
  });
  const input = { project_id: 'project-a', app_type_id: 'app-a', agent_type: 'api_tests' };
  const options = { file: { filename: '../source.zip', buffer: zip }, requestKey: 'same-request' };
  const first = await service.createRun(input, user, options);
  const second = await service.createRun(input, user, options);
  assert.equal(first.id, second.id); assert.equal(first.source.name, 'source.zip');
  assert.equal(first.input, undefined); assert.equal(uploads, 1); assert.equal(writes, 1);
  await assert.rejects(service.createRun({ ...input, agent_type: 'component_tests' }, user, options), { statusCode: 409 });
  assert.equal(writes, 1);
  assert.ok(calls.some(call => call.query.includes('pg_advisory_xact_lock')));
});

test('queue capacity rejects additional analyses before uploading source', async t => {
  scope(t);
  database(t, sql => sql.startsWith('SELECT count(*)') ? { total: 3 } : unreachable(sql));
  t.mock.method(storage, 'putObject', async () => assert.fail('Capacity must be checked before upload'));
  await assert.rejects(service.createRun({ project_id: 'project-a', app_type_id: 'app-a', agent_type: 'api_tests' }, user, { file: { filename: 'source.zip', buffer: zip } }), { statusCode: 429 });
});

test('repository jobs persist workflow trace scope only from trusted runtime options', async t => {
  scope(t); let saved;
  t.mock.method(storage, 'putObject', async () => ({ bucket: 'private' }));
  database(t, (sql, _method, args) => {
    if (sql.startsWith('SELECT count(*)')) return { total: 0 };
    if (sql.startsWith('INSERT INTO repository_agent_runs')) {
      saved = run({ id: args[0], input: args[5], status: 'queued' }); return { changes: 1 };
    }
    if (sql === 'SELECT * FROM repository_agent_runs WHERE id = ?') return structuredClone(saved);
    return unreachable(sql);
  });
  const input = { project_id: 'project-a', app_type_id: 'app-a', agent_type: 'api_tests', workflow_trace: { run_id: 'spoofed-run', node_id: 'spoofed-node' } };
  const options = { file: { filename: 'source.zip', buffer: zip } };
  await service.createRun(input, user, options);
  assert.equal(saved.input.workflow_trace, undefined, 'A request cannot claim a workflow node');
  const workflowTrace = { run_id: 'host-workflow-run', node_id: 'host-source-node' };
  await service.createRun(input, user, { ...options, workflowTrace });
  assert.deepEqual(saved.input.workflow_trace, workflowTrace, 'Worker restarts retain the exact owning run and node');
});

test('queued repository reviews restore their own workflow scope and clear unrelated worker context', async t => {
  scope(t);
  const trace = require('../src/utils/llmTraceContext'), observed = [];
  t.mock.method(require('../../../agentic/backend/services/agenticAssistant.service'), 'respond', async () => {
    observed.push(trace.current());
    return { transaction: { id: 'fresh-review' }, result: { response: 'Source reviewed.', verification: { status: 'passed' } }, provenance: { generation_mode: 'llm' } };
  });
  t.mock.method(storage, 'getObject', async () => Readable.from([zip]));
  database(t, sql => {
    if (sql.includes('FROM users')) return { ...user, status: 'active' };
    if (sql.startsWith('SELECT id, result')) return { id: 'cache', result: result() };
    if (sql.startsWith('UPDATE')) return { changes: 1 };
    return unreachable(sql);
  });
  for (const workflowTrace of [{ run_id: 'owning-run', node_id: 'owning-node' }, undefined]) {
    const current = run({ status: 'running' });
    if (workflowTrace) current.input.workflow_trace = workflowTrace;
    await trace.run({ run_id: 'unrelated-run', node_id: 'unrelated-node', session_id: 'unrelated-session' }, () => service._internals.performRun(current, new AbortController()));
    assert.equal(trace.current().run_id, undefined, 'Worker execution leaves the outer task context intact');
  }
  assert.deepEqual(observed.map(scope => [scope.run_id, scope.node_id, scope.session_id]), [['owning-run', 'owning-node', null], [null, null, null]]);
});

test('failed queue insertion removes uploaded source but ambiguous commit retains it for recovery', async t => {
  for (const ambiguous of [false, true]) {
    scope(t); let saved; const removed = [];
    t.mock.method(storage, 'putObject', async () => ({ bucket: 'private' }));
    t.mock.method(storage, 'removeObject', async object => { removed.push(object); });
    database(t, (sql, _method, args) => {
      if (sql.startsWith('SELECT count(*)')) return { total: 0 };
      if (sql.startsWith('INSERT INTO repository_agent_runs')) {
        if (!ambiguous) throw new Error('Insert failed');
        saved = run({ id: args[0] }); return { changes: 1 };
      }
      if (sql === 'SELECT * FROM repository_agent_runs WHERE id = ?') return saved;
      return unreachable(sql);
    });
    if (ambiguous) t.mock.method(db, 'transaction', callback => async () => { await callback(); throw Object.assign(new Error('Commit uncertain'), { transactionOutcomeUnknown: true }); });
    await assert.rejects(service.createRun({ project_id: 'project-a', app_type_id: 'app-a', agent_type: 'api_tests' }, user, { file: { filename: 'source.zip', buffer: zip } }));
    assert.equal(removed.length, ambiguous ? 0 : 1);
  }
});

test('cancel changes only queued/running analyses and preserves completed results', async t => {
  scope(t); let row = run({ status: 'running' });
  const calls = database(t, sql => {
    if (sql.startsWith('SELECT *')) return structuredClone(row);
    if (sql.startsWith('UPDATE')) { if (['queued', 'running'].includes(row.status)) row.status = 'cancelled'; return { changes: 1 }; }
    return unreachable(sql);
  });
  assert.equal((await service.cancelRun(row.id, user)).status, 'cancelled');
  row = run();
  assert.equal((await service.cancelRun(row.id, user)).status, 'completed');
  assert.ok(calls.filter(call => call.query.startsWith('UPDATE')).every(call => call.query.includes("status IN ('queued','running')")));
});

test('retry rejects completed analyses rather than silently re-executing a different revision', async t => {
  scope(t); database(t, sql => sql.startsWith('SELECT *') ? run() : unreachable(sql));
  await assert.rejects(service.retryRun('run-a', user), { statusCode: 409 });
});

test('archive retrieval stops on cancellation while waiting for object storage and closes a late stream', async t => {
  let resolveStorage;
  t.mock.method(storage, 'getObject', () => new Promise(resolve => { resolveStorage = resolve; }));
  const controller = new AbortController();
  const pending = service._internals.readArchive({ bucket: 'private', objectName: 'source.zip' }, controller.signal);
  controller.abort();
  await assert.rejects(pending, { statusCode: 409 });
  const late = new PassThrough(); resolveStorage(late);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(late.destroyed, true);
});

test('archive retrieval bounds chunked storage responses and closes the stream', async t => {
  const body = Readable.from([Buffer.alloc(LIMITS.max_archive_bytes), Buffer.alloc(1)]);
  t.mock.method(storage, 'getObject', async () => body);
  await assert.rejects(service._internals.readArchive({}, new AbortController().signal), { statusCode: 413 });
  assert.equal(body.destroyed, true);
});

test('compiler validation rejects missing evidence, duplicate identities and unsafe artifact filenames', () => {
  for (const value of [result('api_tests', [{ ...finding, evidence: [] }]), result('api_tests', [finding, finding]), result('api_tests', [finding], { artifacts: [{ name: '../script.html', content: 'bad' }] }), result('api_tests', [{ ...finding, evidence: [{ path: 'src/a.js', line: 0 }] }])]) {
    assert.throws(() => compiler.validateResult(value, 'api_tests'), { statusCode: 502 });
  }
  assert.equal(compiler.validateResult(result(), 'api_tests').findings.test_cases[0].review_required, true);
});

test('worker reuses matching cached analysis and preserves source evidence without recompiling', async t => {
  scope(t); const updates = []; const cached = result();
  const review = t.mock.method(require('../../../agentic/backend/services/agenticAssistant.service'), 'respond', async () => ({ transaction: { id: 'fresh-model-review' }, result: { response: 'Fresh source review.', verification: { status: 'passed' } }, provenance: { generation_mode: 'llm' } }));
  t.mock.method(storage, 'getObject', async () => Readable.from([zip]));
  t.mock.method(compiler, 'compileArchive', async () => assert.fail('Matching source and compiler version should reuse cache'));
  database(t, (sql, _method, args) => {
    if (sql.includes('FROM users')) return { ...user, status: 'active' };
    if (sql.startsWith('SELECT id, result')) { assert.deepEqual(args.slice(0, 3), ['project-a', 'app-a', 'api_tests']); assert.equal(args[4], 'version'); return { id: 'cached-run', result: cached }; }
    if (sql.startsWith('UPDATE')) { updates.push({ sql, args }); return { changes: 1 }; }
    return unreachable(sql);
  });
  await service._internals.performRun(run({ status: 'running' }), new AbortController());
  const complete = updates.find(update => update.sql.includes('result = ?'));
  assert.equal(complete.args[0], 'completed'); assert.equal(complete.args[6], 'cached-run');
  assert.equal(complete.args[2].findings.test_cases[0].evidence[0].line, 12);
  assert.equal(review.mock.callCount(), 1, 'Cached source extraction still requires a fresh model review');
  assert.equal(complete.args[2].llm_review.session_id, 'fresh-model-review');
  assert.equal(cached.llm_review, undefined, 'A new run must not mutate the cached result');
  assert.ok(complete.sql.includes("lease_token = ? AND status = 'running'"));
});

test('explicit model reviews validate their connection and cannot hide model failure', async t => {
  scope(t);
  const registry = require('../../../agentic/backend/agents/agentRegistry.service');
  t.mock.method(registry, 'resolveModel', async () => { throw Object.assign(new Error('Configure an LLM.'), { code: 'AGENT_MODEL_REQUIRED', statusCode: 422 }); });
  const calls = database(t, unreachable);
  await assert.rejects(service.createRun({ project_id: 'project-a', app_type_id: 'app-a', agent_type: 'api_tests', llm_integration_id: 'missing', source }, user), { code: 'AGENT_MODEL_REQUIRED' });
  assert.equal(calls.some(call => call.query.startsWith('INSERT')), false);
  const updates = [];
  t.mock.method(storage, 'getObject', async () => Readable.from([zip]));
  t.mock.method(require('../../../agentic/backend/services/agenticAssistant.service'), 'respond', async () => { throw Object.assign(new Error('Model unavailable.'), { publicMessage: 'Model unavailable.', statusCode: 503 }); });
  database(t, (sql, _method, args) => {
    if (sql.includes('FROM users')) return { ...user, status: 'active' };
    if (sql.startsWith('SELECT id, result')) return { id: 'cache', result: result() };
    if (sql.startsWith('UPDATE')) { updates.push({ sql, args }); return { changes: 1 }; }
    return unreachable(sql);
  });
  await service._internals.performRun(run({ status: 'running', input: { archive: { bucket: 'private', objectName: 'source.zip' }, llm_integration_id: 'model' } }), new AbortController());
  assert.ok(updates.some(update => update.sql.includes("status = 'failed'") && update.args[0] === 'Model unavailable.'));
  assert.equal(updates.some(update => update.sql.includes('result = ?')), false);
});

test('worker respects compiler partial status and never overwrites a cancellation', async t => {
  scope(t); const updates = []; const controller = new AbortController();
  t.mock.method(storage, 'getObject', async () => Readable.from([zip]));
  t.mock.method(compiler, 'compileArchive', async () => result('api_tests', [finding], { summary: { files_scanned: 1, status: 'partial' }, warnings: ['Some source could not be analyzed.'] }));
  database(t, (sql, _method, args) => {
    if (sql.includes('FROM users')) return { ...user, status: 'active' };
    if (sql.startsWith('SELECT id, result')) return null;
    if (sql.startsWith('UPDATE')) { updates.push({ sql, args }); return { changes: 1 }; }
    return unreachable(sql);
  });
  await service._internals.performRun(run({ status: 'running' }), controller);
  assert.equal(updates.find(update => update.sql.includes('result = ?')).args[0], 'partial');
  updates.length = 0;
  t.mock.method(compiler, 'compileArchive', async () => { controller.abort(); return result(); });
  await service._internals.performRun(run({ status: 'running' }), controller);
  assert.ok(updates.every(update => !update.sql.includes('result = ?')));
  assert.ok(updates.filter(update => update.sql.includes("SET status = 'failed'")).every(update => update.sql.includes("AND status = 'running'")));
});

test('worker rechecks inactive users and private integration permission before reading source', async t => {
  for (const active of [false, true]) {
    scope(t, { allow: permission => permission !== 'integration.view' });
    const updates = [];
    t.mock.method(sources, 'downloadGithubSource', async () => assert.fail('Revoked access must not download source'));
    database(t, (sql, _method, args) => {
      if (sql.includes('FROM users')) return { ...user, status: active ? 'active' : 'inactive' };
      if (sql.startsWith('UPDATE')) { updates.push({ sql, args }); return { changes: 1 }; }
      return unreachable(sql);
    });
    await service._internals.performRun(run({ status: 'running', input: { source: { ...source, integration_id: 'saved' } } }), new AbortController());
    assert.ok(updates.some(update => update.sql.includes("SET status = 'failed'")));
  }
});

test('worker retains saved-connection metadata after replacing GitHub source with a pinned snapshot', async t => {
  scope(t); const sourcesWritten = [];
  t.mock.method(sources, 'downloadGithubSource', async () => ({ buffer: zip, source: { type: 'github', name: 'acme/repository', repository_url: source.repository_url, ref: 'main', commit_sha: 'a'.repeat(40) } }));
  t.mock.method(compiler, 'compileArchive', async () => result());
  database(t, (sql, _method, args) => {
    if (sql.includes('FROM users')) return { ...user, status: 'active' };
    if (sql.startsWith('SELECT id, result')) return null;
    if (sql.startsWith('UPDATE')) {
      if (sql.startsWith('UPDATE repository_agent_runs SET source')) sourcesWritten.push(args[0]);
      if (sql.includes('result = ?')) sourcesWritten.push(args[1]);
      return { changes: 1 };
    }
    return unreachable(sql);
  });
  await service._internals.performRun(run({ status: 'running', source: { ...source, uses_saved_connection: true }, input: { source: { ...source, integration_id: 'saved' } } }), new AbortController());
  assert.equal(sourcesWritten.length, 2);
  assert.ok(sourcesWritten.every(value => value.uses_saved_connection === true && value.commit_sha === 'a'.repeat(40)));
  assert.ok(sourcesWritten.every(value => value.integration_id === undefined));
});

test('generated test payload uses supported authoring and step schemas and escapes source markup', () => {
  for (const agent_type of ['api_tests', 'component_tests']) {
    const payload = publisher.casePayload(run({ agent_type }), finding, user, 'idempotency', {automationStartUrl:'https://app.example.test/component'});
    assert.equal(payload.authoring_mode, 'structured'); assert.equal(payload.status, 'draft'); assert.equal(payload.automated, 'yes');
    assert.equal(payload.automation_status,'incomplete');
    assert.equal(payload.source_idempotency_key, 'idempotency');
    assert.equal(payload.reviewer_id, user.id); assert.equal(payload.review_status, 'pending');
    assert.equal(payload.ai_generation_source, 'repository'); assert.equal(payload.ai_generation_review_status, 'pending');
    assert.ok(payload.description.includes('src/users.ts:12'));
    assert.ok(!payload.steps.some(step => step.action.includes('<script>')));
    for (const step of payload.steps) assert.equal(normalizeTestStepType(step.step_type), step.step_type);
    if (agent_type === 'api_tests' && payload.steps.some(step => step.api_request)) {
      const request = normalizeApiRequest(payload.steps.find(step => step.api_request).api_request);
      assert.equal(request.method, 'GET'); assert.ok(request.url.includes('/users'));
      assert.ok(request.validations.every(validation => validation.expected === '200'));
      assert.equal(request.body, null);
    }
  }
});

test('generated API drafts pass the actual Test Case service normalization and persistence contract', async t => {
  const persistedCases = [], persistedSteps = [];
  t.mock.method(require('../services/displayId.service'), 'createDisplayId', async () => 'TC-AGENT');
  t.mock.method(require('../services/mobileFeature.service'), 'assertAuthoringMobileFeatureEnabled', async () => {});
  database(t, (sql, method, args) => {
    if (sql.includes('FROM users')) return { id: user.id, name: 'Reviewer' };
    if (sql.includes('FROM project_members')) return { user_id: user.id };
    if (sql === 'SELECT value, updated_at FROM app_settings WHERE key = ?') { assert.deepEqual(args, ['dropdown_catalog']); return null; }
    if (sql.includes('source_idempotency_key = ?')) return null;
    if (sql.startsWith('INSERT INTO test_cases ') || sql.startsWith('INSERT INTO test_steps ')) {
      const columns = /INSERT INTO \w+ \((.*?)\) VALUES/.exec(sql)[1].split(',').map(column => column.trim());
      const record = Object.fromEntries(columns.map((column, index) => [column, args[index]]));
      (sql.startsWith('INSERT INTO test_cases ') ? persistedCases : persistedSteps).push(record);
      return { changes: 1 };
    }
    if (method === 'run' && sql.startsWith('DELETE FROM ')) return { changes: 0 };
    if (method === 'run' && sql.startsWith('UPDATE automation_case_links ')) return { changes: 0 };
    return unreachable(sql);
  });
  // This service prepares statements at module load. Reload only this module
  // against our database stub, then restore its original shared module instance.
  const filename = require.resolve('../../../testing/backend/services/testCase.service');
  const original = require.cache[filename];
  delete require.cache[filename];
  t.after(() => { require.cache[filename] = original; });
  const actualCases = require(filename);
  const payload = publisher.casePayload(run(), { ...finding, path: '/users/{user_id}', parameters: [{ name: 'active', in: 'query', required: true }] }, user, 'normalized-contract');
  await actualCases.createTestCase(payload);
  assert.equal(persistedCases.length, 1); assert.equal(persistedCases[0].authoring_mode, 'structured');
  assert.equal(persistedCases[0].automated, 'yes'); assert.equal(persistedCases[0].automation_status,'incomplete'); assert.equal(persistedCases[0].status, 'draft');
  assert.equal(persistedCases[0].reviewer_id, user.id); assert.equal(persistedCases[0].review_status, 'pending');
  assert.equal(persistedCases[0].ai_generation_source, 'repository'); assert.equal(persistedCases[0].ai_generation_review_status, 'pending');
  const request = persistedSteps.find(step => step.step_type === 'api').api_request;
  assert.equal(request.method, 'GET'); assert.equal(request.url, '@r.base_url/users/@t.user_id?active=@t.active');
  assert.equal(request.body, null); assert.deepEqual(request.validations, [{ kind: 'status', target: null, expected: '200' }]);
  assert.ok(persistedSteps.every(step => step.step_order >= 1 && step.automation_code === null));
});

test('generated non-simple parameter names resolve through the existing API execution runtime', async t => {
  const urls = [];
  t.mock.method(global, 'fetch', async url => { urls.push(String(url)); return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
  const payload = publisher.casePayload(run(), { ...finding, path: '/users/{_id}', expected_status: undefined, parameters: [{ name: 'filter.status', in: 'query', required: true }, { name: 'include-deleted', in: 'query', required: true }] }, user, 'runtime-parameter-contract');
  const apiRequest = payload.steps.find(step => step.api_request).api_request;
  assert.deepEqual(apiRequest.validations, [], 'Do not invent a success status missing from source evidence');
  await require('../../../automation/backend/services/apiRequestExecution.service').runApiRequestPreview(apiRequest, { parameterValues: { 'r.base_url': 'https://api.example.test', 't._id': '42', 't.filter.status': 'active', 't.include-deleted': 'false' } });
  assert.deepEqual(urls, ['https://api.example.test/users/42?filter.status=active&include-deleted=false']);
});

test('source API contracts become one native request in the Automation library without browser setup or duplicate writes',async t=>{
  const contract={...finding,method:'POST',path:'/orders',steps:[
    {action:'Prepare an authorized account',expected_result:'The reviewed test data is available'},
    {action:'Send POST /orders',expected_result:'The documented created response is returned'},
    {action:'Inspect the returned order',expected_result:'The order follows the source contract'}
  ]};
  const row=run({result:result('api_tests',[contract])}),state=publication(t,row);
  const receipt=await publisher.publishRun(row.id,{item_ids:[contract.id]},user);
  const payload=state.calls[0].payload;
  assert.equal(payload.automated,'yes');assert.equal(payload.automation_status,'incomplete');
  assert.equal(payload.automation_start_url,null);assert.equal(payload.steps.length,1);
  assert.equal(payload.steps[0].step_type,'api');assert.equal(payload.steps[0].api_request.method,'POST');
  assert.match(payload.description,/Prepare an authorized account.*Inspect the returned order/s);
  assert.match(payload.source_idempotency_key,/^repository-agent:automation-v2:/);
  assert.equal(receipt.items[0].target_type,'automation');
  assert.match(receipt.items[0].url,/^\/automation\?case=/);
});

test('component acceptance requires a reviewed Start URL and saves an unverified Automation draft',async t=>{
  const row=run({agent_type:'component_tests',result:result('component_tests')}),state=publication(t,row);
  await assert.rejects(publisher.publishRun(row.id,{item_ids:[finding.id]},user),{code:'AUTOMATION_START_URL_REQUIRED',statusCode:400});
  await assert.rejects(publisher.publishRun(row.id,{item_ids:[finding.id],automation_start_url:'https://user:secret@app.example.test'},user),{code:'AUTOMATION_START_URL_INVALID',statusCode:400});
  assert.equal(state.calls.length,0);
  await publisher.publishRun(row.id,{item_ids:[finding.id],automation_start_url:'https://app.example.test/components'},user);
  assert.equal(state.calls[0].payload.automated,'yes');assert.equal(state.calls[0].payload.automation_status,'incomplete');
  assert.equal(state.calls[0].payload.automation_start_url,'https://app.example.test/components');
  assert.ok(state.calls[0].payload.steps.every(step=>step.step_type==='web'&&!step.automation_code));
  await assert.rejects(publisher.publishRun(row.id,{item_ids:[finding.id],automation_start_url:'https://other.example.test/components'},user),error=>error.statusCode===409&&/different Start URL/.test(error.message));
  assert.equal(state.calls.length,1,'A changed target cannot silently reuse or mutate an already accepted case');
  const second=publication(t,{...row,id:'other-run'});
  await publisher.publishRun('other-run',{item_ids:[finding.id],automation_start_url:'https://other.example.test/components'},user);
  assert.notEqual(second.calls[0].payload.source_idempotency_key,state.calls[0].payload.source_idempotency_key,'Separate reviewed targets have distinct idempotency keys');
});

test('source Automation acceptance rechecks current automation permissions before saving any record',async t=>{
  for(const denied of ['automation.view','automation.code.view','automation.build']){
    const state=publication(t,run(),{deny:denied});
    await assert.rejects(publisher.publishRun('run-a',{item_ids:[finding.id]},user),error=>error.statusCode===403&&error.message.includes(denied));
    assert.equal(state.calls.length,0);
  }
});

test('API publication preserves declared body media and requires reviewed non-JSON wire content', async t => {
  const sent = [];
  t.mock.method(global, 'fetch', async (_url, options) => { sent.push(options); return new Response('{}', { status: 201 }); });
  const contract = { ...finding, method: 'POST', path: '/submit', body: { name: '{{name}}' }, expected_status: 201 };
  for (const [contentType, mode, body] of [
    ['application/x-www-form-urlencoded', 'form', 'name=Jane%20Doe'],
    ['application/xml', 'xml', '<person><name>Jane</name></person>'],
    ['text/plain; charset=utf-8', 'text', 'Jane Doe']
  ]) {
    const payload = publisher.casePayload(run(), { ...contract, content_type: contentType }, user, contentType);
    const request = payload.steps.find(step => step.api_request).api_request;
    assert.equal(request.body_mode, mode); assert.equal(request.body, '@t.request_body');
    assert.match(payload.description, /complete reviewed wire payload/);
    await require('../../../automation/backend/services/apiRequestExecution.service').runApiRequestPreview(request, { parameterValues: { 'r.base_url': 'https://api.example.test', 't.request_body': body } });
    assert.equal(sent.at(-1).body, body);
    assert.equal(sent.at(-1).headers.get('content-type'), contentType);
  }
  const json = publisher.apiDraftRequest({ ...contract, content_type: 'application/vnd.example+json' });
  assert.equal(json.body_mode, 'json'); assert.equal(json.headers[0].value, 'application/vnd.example+json');
  assert.deepEqual(JSON.parse(json.body), { name: '@t.name' });
  const typed = publisher.apiDraftRequest({ ...contract, content_type: 'application/json', body: { quantity: '{{quantity}}', active: '{{active}}' }, body_schema: { type: 'object', properties: { quantity: { type: 'integer' }, active: { type: 'boolean' } } } });
  assert.equal(typed.body, '@t.request_body', 'Do not force schema numbers and booleans into quoted strings');
  const typedJson = '{"quantity":2,"active":false}';
  await require('../../../automation/backend/services/apiRequestExecution.service').runApiRequestPreview(typed, { parameterValues: { 'r.base_url': 'https://api.example.test', 't.request_body': typedJson } });
  assert.deepEqual(JSON.parse(sent.at(-1).body), { quantity: 2, active: false });
  const scalar = publisher.apiDraftRequest({ ...contract, content_type: 'text/plain', body: null, body_schema: { type: 'string' } });
  assert.equal(scalar.body_mode, 'text'); assert.equal(scalar.body, '@t.request_body', 'A scalar schema still establishes a request body');
});

test('multipart and binary schemas remain explicit manual drafts instead of becoming incorrect JSON requests', () => {
  assert.equal(publisher.apiDraftRequest({ ...finding, method: 'POST', path: '/upload', body: { value: '{{value}}' }, body_media_type_established: false }), null);
  for (const content_type of ['multipart/form-data', 'application/octet-stream']) {
    const contract = { ...finding, method: 'POST', path: '/upload', content_type, body: { file: '{{file}}' } };
    assert.equal(publisher.apiDraftRequest(contract), null);
    const payload = publisher.casePayload(run(), contract, user, content_type);
    assert.ok(payload.steps.every(step => !step.api_request));
    assert.match(payload.description, /requires manual setup/);
    assert.ok(payload.description.includes(content_type));
    assert.equal(payload.status, 'draft');
  }
});

test('worker claim enforces global concurrency before leasing a queued run', async t => {
  const calls = database(t, (sql, method, args) => {
    if (sql.includes('heartbeat_at <')) return { changes: 0 };
    if (sql.startsWith('SELECT count(*)')) return { total: LIMITS.max_concurrent };
    return unreachable(sql);
  });
  assert.equal(await service._internals.claimRun(), null);
  assert.ok(calls[0].query.includes('pg_advisory_xact_lock'));
  assert.ok(!calls.some(call => call.query.includes('FOR UPDATE SKIP LOCKED')));
});

test('worker claim expires interrupted work and assigns a distinct lease under row locking', async t => {
  const calls = database(t, (sql, method, args) => {
    if (sql.includes('heartbeat_at <')) return { changes: 1 };
    if (sql.startsWith('SELECT count(*)')) return { total: 0 };
    if (sql.includes('FOR UPDATE SKIP LOCKED')) return { id: 'queued-run' };
    if (sql.includes('RETURNING *')) return run({ id: args[1], status: 'running', lease_token: args[0] });
    return unreachable(sql);
  });
  const leased = await service._internals.claimRun();
  assert.equal(leased.id, 'queued-run'); assert.equal(leased.status, 'running');
  assert.match(leased.lease_token, /^[a-f0-9-]{36}$/);
  assert.ok(calls.some(call => call.query.includes("INTERVAL '90 seconds'")));
  assert.ok(calls.some(call => call.query.includes('FOR UPDATE SKIP LOCKED')));
});

function publication(t, row = run(), options = {}) {
  let stored = structuredClone(row); const calls = [];
  t.mock.method(service, 'getRun', async () => service.toPublic(stored));
  t.mock.method(permissions, 'hasPermission', async (_user, permission) => options.deny !== permission);
  t.mock.method(mobileFeatures, 'appTypeUsesMobile', async appTypeId => { assert.equal(appTypeId, row.app_type_id); return Boolean(options.mobile); });
  database(t, (sql, _method, args) => {
    if (sql.includes('FOR UPDATE')) return structuredClone(stored);
    if (sql.startsWith('UPDATE repository_agent_runs SET published')) { stored.published = args[0]; return { changes: 1 }; }
    if (sql.includes('FROM ai_knowledge_repo')) return options.existingKnowledge || null;
    if (sql.includes('FROM automation_learning_cache')) return options.existingObject || null;
    return unreachable(sql);
  });
  t.mock.method(cases, 'createTestCase', async payload => { calls.push({ type: 'case', payload }); return { id: 'case-a' }; });
  t.mock.method(knowledge, 'createKnowledge', async (projectId, payload, userId) => { calls.push({ type: 'knowledge', projectId, payload, userId }); return { id: 'knowledge-a' }; });
  t.mock.method(objects, 'createLearningCacheEntry', async payload => { calls.push({ type: 'object', payload }); return { id: 'object-a' }; });
  t.mock.method(modules, 'getModule', async () => ({ app_type_id: options.moduleApp || 'app-a' }));
  t.mock.method(modules, 'assignCases', async (...args) => { calls.push({ type: 'module', args }); });
  return { calls, read: () => stored };
}

test('publication requires the target permission, completed results and valid selections', async t => {
  publication(t, run(), { deny: 'testcase.create' });
  await assert.rejects(publisher.publishRun('run-a', { item_ids: [finding.id] }, user), { statusCode: 403 });
  publication(t, run({ status: 'running' }));
  await assert.rejects(publisher.publishRun('run-a', { item_ids: [finding.id] }, user), { statusCode: 409 });
  publication(t);
  for (const item_ids of [[], [finding.id, finding.id], new Array(51).fill(finding.id)]) await assert.rejects(publisher.publishRun('run-a', { item_ids }, user), { statusCode: 400 });
  await assert.rejects(publisher.publishRun('run-a', { item_ids: ['foreign-finding'] }, user), { statusCode: 409 });
});

test('publication is idempotent within a run and records who published each target', async t => {
  const state = publication(t);
  const first = await publisher.publishRun('run-a', { item_ids: [finding.id] }, user);
  const second = await publisher.publishRun('run-a', { item_ids: [finding.id] }, user);
  assert.deepEqual(first.items, second.items); assert.equal(state.calls.length, 1);
  assert.equal(first.items[0].published_by, user.id); assert.ok(Date.parse(first.items[0].published_at));
  assert.equal(state.calls[0].payload.status, 'draft'); assert.ok(state.calls[0].payload.source_idempotency_key.startsWith('repository-agent:'));
});

test('identical findings across runs reuse stable test case idempotency keys', async t => {
  const keys = [];
  for (const id of ['run-a', 'run-b']) {
    const state = publication(t, run({ id }));
    await publisher.publishRun(id, { item_ids: [finding.id] }, user);
    keys.push(state.calls[0].payload.source_idempotency_key);
  }
  assert.equal(keys[0], keys[1]);
});

test('module assignment checks update permission and application before target creation', async t => {
  for (const options of [{ deny: 'testcase.update' }, { moduleApp: 'foreign-app' }]) {
    const state = publication(t, run(), options);
    await assert.rejects(publisher.publishRun('run-a', { item_ids: [finding.id], module_id: 'module-a' }, user), { statusCode: 403 });
    assert.equal(state.calls.length, 0);
  }
  const state = publication(t);
  await publisher.publishRun('run-a', { item_ids: [finding.id], module_id: 'module-a' }, user);
  assert.deepEqual(state.calls.at(-1), { type: 'module', args: ['module-a', ['case-a'], { append: true }] });
});

test('API and component publication into mobile applications requires mobile role permission before creating cases', async t => {
  for (const agent_type of ['api_tests', 'component_tests']) {
    const state = publication(t, run({ agent_type, result: result(agent_type) }), { mobile: true, deny: 'mobile.manage' });
    await assert.rejects(publisher.publishRun('run-a', { item_ids: [finding.id] }, user), error => error.statusCode === 403 && error.message.includes('mobile.manage'));
    assert.equal(state.calls.length, 0);
    assert.deepEqual(state.read().published.items, []);
  }
});

test('mobile publication succeeds with mobile permission and web publication does not require it', async t => {
  for (const agent_type of ['api_tests', 'component_tests']) {
    for (const mobile of [true, false]) {
      const state = publication(t, run({ agent_type, result: result(agent_type) }), { mobile, deny: mobile ? null : 'mobile.manage' });
      const published = await publisher.publishRun('run-a', { item_ids: [finding.id],automation_start_url:'https://app.example.test/component' }, user);
      assert.equal(published.items[0].target_type, 'automation');
      assert.match(published.items[0].url,/^\/automation\?case=/);
      assert.equal(state.calls.length, 1);
      assert.equal(state.calls[0].payload.status, 'draft');
    }
  }
});

test('knowledge and object publication do not acquire unrelated mobile authoring permissions', async t => {
  for (const agent_type of ['repository_knowledge', 'object_repository']) {
    const item = { ...finding, title: 'Repository source', content: 'Evidence.', screen_name: 'Login', object_name: 'Submit', locator: '[data-testid="submit"]' };
    const state = publication(t, run({ agent_type, result: result(agent_type, [item]) }), { mobile: true, deny: 'mobile.manage' });
    t.mock.method(mobileFeatures, 'appTypeUsesMobile', async () => assert.fail('Only test case publication requires a mobile authoring check'));
    const response = await publisher.publishRun('run-a', { item_ids: [finding.id] }, user);
    assert.equal(state.calls.length, 1);
    if (agent_type === 'object_repository') assert.equal(response.items[0].url, '/object-repository?app_type_id=app-a&repository=object-a');
  }
});

test('API drafts carry required header parameters without malformed headers or inferred credentials', () => {
  const contract = { ...finding, method: 'POST', body: { name: '{{name}}' }, body_schema: { properties: { name: { type: 'string' } } }, parameters: [
    { name: 'X-Workspace', in: 'header', required: true },
    { name: 'x-workspace', in: 'header', required: true },
    { name: 'X-Optional', in: 'header', required: false },
    { name: 'Authorization', in: 'header', required: true },
    { name: 'Content-Type', in: 'header', required: true },
    { name: 'Content-Length', in: 'header', required: true },
    { name: 'X-Bad\r\nInjected', in: 'header', required: true }
  ] };
  assert.deepEqual(publisher.apiDraftRequest(contract).headers, [
    { key: 'Content-Type', value: 'application/json' },
    { key: 'X-Workspace', value: '@t.X-Workspace' },
    { key: 'Authorization', value: '@t.Authorization' }
  ]);
  assert.deepEqual(publisher.apiDraftRequest({ ...contract, case_kind: 'authentication' }).headers, [{ key: 'Content-Type', value: 'application/json' }]);
});

test('knowledge publication permits project scope, retains revision evidence and queues indexing via existing service', async t => {
  const item = { id: 'document', title: 'Repository architecture', content: 'Observed module structure.', evidence: finding.evidence, metadata: { repository_file: 'src/users.ts', content_hash: 'sha256-source', start_line: 1, end_line: 100, truncated: true, runtime_verified: true } };
  const row = run({ agent_type: 'repository_knowledge', app_type_id: null, result: result('repository_knowledge', [item]), source: { ...source, commit_sha: 'a'.repeat(40) } });
  const state = publication(t, row);
  const published = await publisher.publishRun(row.id, { item_ids: [item.id] }, user);
  assert.equal(published.indexing, 'queued'); assert.equal(state.calls[0].projectId, 'project-a');
  assert.equal(published.knowledge_graph,'queued'); assert.equal(published.context_graph,'queued');
  assert.equal(state.calls[0].payload.app_type_id, null); assert.equal(state.calls[0].payload.metadata.revision, 'a'.repeat(40));
  assert.deepEqual(state.calls[0].payload.metadata.evidence, finding.evidence);
  assert.equal(state.calls[0].payload.metadata.repository_file, 'src/users.ts');
  assert.equal(state.calls[0].payload.metadata.content_hash, 'sha256-source');
  assert.equal(state.calls[0].payload.metadata.end_line, 100);
  assert.equal(state.calls[0].payload.metadata.truncated, true);
  assert.equal(state.calls[0].payload.metadata.runtime_verified, false);
  assert.equal(state.calls[0].userId, user.id);
  const reused = publication(t, row, { existingKnowledge: { id: 'knowledge-existing' } });
  assert.equal((await publisher.publishRun(row.id, { item_ids: [item.id] }, user)).items[0].target_id, 'knowledge-existing');
  assert.equal(reused.calls.length, 0);
});

test('object publication preserves provenance, flags runtime review and does not overwrite existing objects', async t => {
  const object = { ...finding, id: 'object', screen_name: 'Login', object_name: 'Submit', locator: '[data-testid="submit"]', locator_kind: 'css', metadata: { runtime_verified: true } };
  const row = run({ agent_type: 'object_repository', result: result('object_repository', [object]) });
  const state = publication(t, row);
  await publisher.publishRun(row.id, { item_ids: [object.id] }, user);
  assert.equal(state.calls[0].payload.metadata.runtime_verified, false);
  assert.equal(state.calls[0].payload.metadata.review_required, true);
  assert.deepEqual(state.calls[0].payload.metadata.evidence, finding.evidence);
  const duplicate = publication(t, row, { existingObject: { id: 'existing', locator: object.locator } });
  const response = await publisher.publishRun(row.id, { item_ids: [object.id] }, user);
  assert.equal(response.skipped, 1); assert.equal(duplicate.calls.length, 0);
});

async function routeHandlers(t, deny) {
  const handlers = new Map(), events = [];
  t.mock.method(mobileFeatures, 'appTypeUsesMobile', async () => false);
  const fastify = {
    authenticate: async () => { events.push('authenticate'); },
    requirePermission: (permission, options) => async () => { events.push([permission, options?.projectId]); if (permission === deny) throw Object.assign(new Error('Denied'), { statusCode: 403 }); }
  };
  for (const method of ['get', 'post']) fastify[method] = (path, ...args) => handlers.set(`${method} ${path}`, args.at(-1));
  await require('../../../agentic/backend/routes/repositoryAgents.routes')(fastify);
  const req = { user, params: { id: 'run-a', name: 'contracts.json' }, query: { project_id: 'project-a' }, headers: {}, body: {}, isMultipart: () => false };
  const reply = { values: {}, code(code) { this.values.status = code; return this; }, header(name, value) { this.values[name] = value; return this; }, type(type) { this.values.type = type; return this; }, send(value) { this.values.body = value; return this; } };
  return { handlers, events, req, reply };
}

test('artifact route enforces view access and always downloads with private cache policy', async t => {
  t.mock.method(service, 'getArtifact', async () => ({ project_id: 'project-a', artifact: { name: 'contracts.json', content: '{"safe":true}' } }));
  const state = await routeHandlers(t);
  await state.handlers.get('get /repository-agents/runs/:id/artifacts/:name')(state.req, state.reply);
  assert.equal(state.reply.values['Content-Disposition'], 'attachment; filename="contracts.json"');
  assert.equal(state.reply.values.body, '{"safe":true}');
  assert.equal(state.reply.values['Cache-Control'], 'private, no-store'); assert.equal(state.reply.values.type, 'application/octet-stream');
  assert.ok(state.events.some(event => Array.isArray(event) && event[0] === 'agentic_workflow.view'));
  const denied = await routeHandlers(t, 'agentic_workflow.view');
  await assert.rejects(denied.handlers.get('get /repository-agents/runs/:id/artifacts/:name')(denied.req, denied.reply), { statusCode: 403 });
});

test('JSON creation enforces run permission and returns a 202 location for polling', async t => {
  const state = await routeHandlers(t);
  t.mock.method(service, 'createRun', async (_input, _user, options) => { assert.equal(options.requestKey, 'request-a'); return service.toPublic(run({ status: 'queued' })); });
  state.req.body = { project_id: 'project-a', agent_type: 'api_tests', source }; state.req.headers['idempotency-key'] = 'request-a';
  await state.handlers.get('post /repository-agents/runs')(state.req, state.reply);
  assert.equal(state.reply.values.status, 202); assert.equal(state.reply.values.Location, '/repository-agents/runs/run-a');
  assert.ok(state.events.some(event => Array.isArray(event) && event[0] === 'agentic_workflow.run' && event[1] === 'project-a'));
});

test('private source API route checks integration API-key scope before creating the analysis', async t => {
  const state = await routeHandlers(t, 'integration.view');
  state.req.body = { project_id: 'project-a', agent_type: 'api_tests', source: { ...source, integration_id: 'saved' } };
  t.mock.method(service, 'createRun', async () => assert.fail('Denied integration scope must not create an analysis'));
  await assert.rejects(state.handlers.get('post /repository-agents/runs')(state.req, state.reply), { statusCode: 403 });
});

test('mobile publication route enforces mobile API-key scope before invoking publication', async t => {
  for (const agent_type of ['api_tests', 'component_tests']) {
    const state = await routeHandlers(t, 'mobile.manage');
    t.mock.method(service, 'getRun', async () => service.toPublic(run({ agent_type, result: result(agent_type) })));
    t.mock.method(mobileFeatures, 'appTypeUsesMobile', async appTypeId => { assert.equal(appTypeId, 'app-a'); return true; });
    t.mock.method(cases, 'createTestCase', async () => assert.fail('Mobile API-key scope denial must occur before case creation'));
    t.mock.method(db, 'transaction', () => assert.fail('Mobile API-key scope denial must occur before publication transaction'));
    state.req.body = { item_ids: [finding.id] };
    await assert.rejects(state.handlers.get('post /repository-agents/runs/:id/publish')(state.req), { statusCode: 403 });
    assert.ok(state.events.some(event => Array.isArray(event) && event[0] === 'mobile.manage' && event[1] === 'project-a'));
  }
});

test('repository knowledge fails explicitly when its model review fails without returning extraction as an AI outcome', async t => {
  scope(t); const updates = []; const cached = result('repository_knowledge');
  t.mock.method(require('../../../agentic/backend/services/agenticAssistant.service'), 'respond', async input => {
    assert.match(input.prompt, /documentation outline/);
    assert.equal(input.workflow_policy.connected_input.findings[0].method, 'GET');
    throw Object.assign(new Error('private provider failure'), { code: 'MODEL_TIMEOUT', statusCode: 503 });
  });
  t.mock.method(storage, 'getObject', async () => Readable.from([zip]));
  t.mock.method(compiler, 'compileArchive', async () => assert.fail('Reuse the validated source snapshot'));
  database(t, (sql, _method, args) => {
    if (sql.includes('FROM users')) return { ...user, status: 'active' };
    if (sql.startsWith('SELECT id, result')) return { id: 'cached-run', result: cached };
    if (sql.startsWith('UPDATE')) { updates.push({sql,args}); return {changes:1}; }
    return unreachable(sql);
  });
  const current = run({status:'running',agent_type:'repository_knowledge'});
  current.input.llm_integration_id = 'model';
  await service._internals.performRun(current, new AbortController());
  assert.equal(updates.some(update => update.sql.includes('result = ?')),false);
  assert.ok(updates.some(update => update.sql.includes("SET status = 'failed'")));
  assert.equal(cached.findings.knowledge.length,1,'Source evidence is retained independently of the failed model run.');
});
