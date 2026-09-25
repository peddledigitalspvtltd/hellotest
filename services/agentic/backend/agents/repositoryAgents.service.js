const { randomUUID, createHash } = require('node:crypto');
const db = require('@hellotest/platform/backend/src/db');
const objectStorage = require('@hellotest/platform/backend/src/services/objectStorage.service');
const projectService = require('@hellotest/platform/backend/public/projectAccess');
const permissionService = require('@hellotest/platform/backend/services/permission.service');
const { AGENTS, LIMITS, FINDING_KEYS, error } = require('./catalog');
const compiler = require('./compiler');
const repositorySource = require('./repositorySource');

const active = new Map();
let accepting = true;
const hash = value => createHash('sha256').update(value).digest('hex');
const cleanText = (value, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const SUMMARY_COLUMNS = 'id, project_id, app_type_id, agent_type, status, source, progress, stages, summary, warnings, error, published, cached_from, created_by, created_at, started_at, completed_at, updated_at';
const toPublic = row => {
  if (!row) throw error('Agent run not found.', 404);
  const { input, input_hash, compiler_version, request_key, lease_token, heartbeat_at, ...visible } = row;
  if (visible.result) visible.result = {
    ...visible.result,
    artifacts: (visible.result.artifacts || []).map(({ content, ...artifact }) => ({
      ...artifact, size_bytes: typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : 0
    }))
  };
  return visible;
};
async function requireScope(projectId, appTypeId, user, permission = 'agentic_workflow.view') {
  if (!cleanText(projectId)) throw error('Select a project for this agent.');
  await projectService.getProject(projectId, user.id);
  if (!await permissionService.hasPermission(user, permission, projectId)) throw error(`Permission required: ${permission}`, 403);
  if (appTypeId) {
    const app = await db.prepare('SELECT id, project_id FROM app_types WHERE id = ?').get(appTypeId);
    if (!app || app.project_id !== projectId) throw error('The application must belong to this project.', 403);
  }
}
async function getRun(id, user, permission = 'agentic_workflow.view') {
  const row = await db.prepare('SELECT * FROM repository_agent_runs WHERE id = ?').get(id);
  if (!row) throw error('Agent run not found.', 404);
  await requireScope(row.project_id, row.app_type_id, user, permission);
  return toPublic(row);
}
async function getArtifact(id, name, user) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/.test(name)) throw error('Agent artifact not found.', 404);
  const row = await db.prepare("SELECT project_id, app_type_id, status, result->'artifacts' AS artifacts FROM repository_agent_runs WHERE id = ?").get(id);
  if (!row) throw error('Agent run not found.', 404);
  await requireScope(row.project_id, row.app_type_id, user);
  const artifact = row.artifacts?.find(item => item.name === name);
  if (!artifact || !['completed', 'partial'].includes(row.status)) throw error('Agent artifact not found.', 404);
  return { project_id: row.project_id, artifact };
}
async function listRuns({ project_id, app_type_id, agent_type, status, page = 1 }, user) {
  await requireScope(project_id, app_type_id, user);
  if (agent_type && !AGENTS.some(agent => agent.id === agent_type)) throw error('Choose a supported repository agent.');
  if (status && !['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'].includes(status)) throw error('Choose a supported analysis status.');
  const currentPage = Math.max(1, Math.min(10000, Number.parseInt(page, 10) || 1));
  let filter = app_type_id ? 'project_id = ? AND app_type_id = ?' : 'project_id = ?';
  const params = app_type_id ? [project_id, app_type_id] : [project_id];
  if (agent_type) { filter += ' AND agent_type = ?'; params.push(agent_type); }
  if (status) { filter += ' AND status = ?'; params.push(status); }
  const [items, count] = await Promise.all([
    db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM repository_agent_runs WHERE ${filter} ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ?`).all(...params, (currentPage - 1) * 20),
    db.prepare(`SELECT count(*)::integer AS total FROM repository_agent_runs WHERE ${filter}`).get(...params)
  ]);
  return { items, total: count.total, has_more: currentPage * 20 < count.total };
}
async function createRun(input, user, { file, requestKey } = {}) {
  const projectId = cleanText(input.project_id), appTypeId = cleanText(input.app_type_id) || null;
  const agentType = input.agent_type;
  if (!AGENTS.some(agent => agent.id === agentType)) throw error('Choose a supported repository agent.');
  await requireScope(projectId, appTypeId, user, 'agentic_workflow.run');
  const runtime = await compiler.runtimeStatus();
  if (!runtime.available) throw error(runtime.detail, 503);
  const version = await compiler.compilerVersion();
  let source, inputHash;
  if (file) {
    if (!Buffer.isBuffer(file.buffer) || file.buffer.length > LIMITS.max_archive_bytes || file.truncated) throw error('Upload a ZIP archive no larger than 20 MB.', 413);
    if (file.buffer.length < 4) throw error('Upload a valid ZIP source archive.');
    if (!/\.zip$/i.test(file.filename || '') || file.buffer.readUInt16LE(0) !== 0x4b50) throw error('Upload a valid ZIP source archive.');
    source = { type: 'zip', name: cleanText(String(file.filename).split(/[\\/]/).pop()).replace(/[\x00-\x1f\x7f]/g, '') || 'source.zip', size_bytes: file.buffer.length };
    inputHash = hash(file.buffer);
  } else {
    source = repositorySource.normalizeGithubSource(input.source);
    if (source.integration_id && !await permissionService.hasPermission(user, 'integration.view', projectId)) throw error('Integration access is required to use a saved GitHub connection.', 403);
  }
  const requestHash = hash(JSON.stringify([agentType, appTypeId, source, inputHash]));
  const key = cleanText(requestKey, 160) || null;
  if (requestKey && key !== requestKey) throw error('The request identifier must be between 1 and 160 characters.');
  const id = randomUUID();
  let uploaded, inserted = false;
  try {
    const run = await db.transaction(async () => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext(?))', [`repository-agent-create:${projectId}:${user.id}`]);
      if (key) {
        const existing = await db.prepare('SELECT * FROM repository_agent_runs WHERE project_id = ? AND created_by = ? AND request_key = ?').get(projectId, user.id, key);
        if (existing) {
          if (existing.input.request_hash !== requestHash) throw error('This request identifier was used for different agent settings.', 409);
          return toPublic(existing);
        }
      }
      const busy = await db.prepare("SELECT count(*)::integer AS total FROM repository_agent_runs WHERE project_id = ? AND created_by = ? AND status IN ('queued','running')").get(projectId, user.id);
      if (busy.total >= 3) throw error('Three of your repository analyses are already queued or running. Wait for one to finish or cancel it.', 429);
      const payload = { request_hash: requestHash, source };
      if (file) {
        const objectName = `repository-agents/${projectId}/${id}/source.zip`;
        const stored = await objectStorage.putObject({ objectName, stream: file.buffer, mimeType: 'application/zip' });
        uploaded = { bucket: stored.bucket, objectName };
        payload.archive = uploaded;
      }
      const safeSource = { ...source, ...(source.type === 'github' ? { uses_saved_connection: Boolean(source.integration_id) } : {}) }; delete safeSource.integration_id;
      await db.prepare(`INSERT INTO repository_agent_runs (id, project_id, app_type_id, agent_type, source, input, input_hash, compiler_version, request_key, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, projectId, appTypeId, agentType, safeSource, payload, inputHash || null, version, key, user.id);
      inserted = true;
      return toPublic(await db.prepare('SELECT * FROM repository_agent_runs WHERE id = ?').get(id));
    })();
    // Persistent queue is also polled, so a restart between commit and this wakeup
    // cannot lose the task.
    void processQueuedRuns().catch(() => {});
    return run;
  } catch (failure) {
    if (uploaded && (!inserted || !failure.transactionOutcomeUnknown)) await objectStorage.removeObject(uploaded).catch(() => {});
    throw failure;
  }
}
async function cancelRun(id, user) {
  await getRun(id, user, 'agentic_workflow.run');
  await db.prepare("UPDATE repository_agent_runs SET status = 'cancelled', error = NULL, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('queued','running')").run(id);
  active.get(id)?.abort();
  return getRun(id, user);
}
async function retryRun(id, user) {
  await getRun(id, user, 'agentic_workflow.run');
  const existing = await db.prepare('SELECT * FROM repository_agent_runs WHERE id = ?').get(id);
  if (!['failed', 'cancelled'].includes(existing.status)) throw error('Only failed or cancelled analyses can be retried. Start a new analysis for a fresh repository revision.', 409);
  if (!existing.input.archive) return createRun({ project_id: existing.project_id, app_type_id: existing.app_type_id, agent_type: existing.agent_type, source: { ...existing.input.source, ref: existing.source.commit_sha || existing.input.source.ref } }, user);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const buffer = await readArchive(existing.input.archive, controller.signal);
    return createRun({ project_id: existing.project_id, app_type_id: existing.app_type_id, agent_type: existing.agent_type }, user, { file: { buffer, filename: existing.source.name } });
  } finally { clearTimeout(timer); }
}
async function readArchive(location, signal) {
  if (signal.aborted) throw error('Analysis was cancelled.', 409);
  let cancelLookup;
  const lookup = objectStorage.getObject(location);
  // A late storage response must be closed even if its await was cancelled.
  lookup.then(stream => { if (signal.aborted) stream.destroy(); }, () => {});
  const cancelled = new Promise((_, reject) => {
    cancelLookup = () => reject(error('Source retrieval was cancelled.', 409));
    signal.addEventListener('abort', cancelLookup, { once: true });
    if (signal.aborted) cancelLookup();
  });
  let stream;
  try { stream = await Promise.race([lookup, cancelled]); }
  finally { signal.removeEventListener('abort', cancelLookup); }
  const abort = () => stream.destroy(error('Source retrieval was cancelled.', 409));
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    const chunks = []; let bytes = 0;
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > LIMITS.max_archive_bytes) { stream.destroy(); throw error('The source archive exceeds 20 MB.', 413); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally { signal.removeEventListener('abort', abort); }
}
async function claimRun() {
  return db.transaction(async () => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext(?))', ['repository-agent-worker-slots']);
    await db.prepare("UPDATE repository_agent_runs SET status = 'failed', error = 'Analysis was interrupted. Retry to continue from the saved source.', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE status = 'running' AND heartbeat_at < CURRENT_TIMESTAMP - INTERVAL '90 seconds'").run();
    const busy = await db.prepare("SELECT count(*)::integer AS total FROM repository_agent_runs WHERE status = 'running'").get();
    if (busy.total >= LIMITS.max_concurrent) return null;
    const row = await db.prepare("SELECT id FROM repository_agent_runs WHERE status = 'queued' ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1").get();
    if (!row) return null;
    return db.prepare("UPDATE repository_agent_runs SET status = 'running', progress = 5, lease_token = ?, heartbeat_at = CURRENT_TIMESTAMP, started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *").get(randomUUID(), row.id);
  })();
}
const workerUser = async id => {
  const row = await db.prepare('SELECT id, email, name, status, is_workspace_admin FROM users WHERE id = ?').get(id);
  if (!row || row.status !== 'active') throw error('The account that started this analysis is no longer active.', 403);
  return { ...row, role: row.is_workspace_admin ? 'admin' : 'member' };
};
async function performRun(run, controller) {
  const signal = controller.signal;
  let stageChain = Promise.resolve(), stages = [], heartbeatBusy = false;
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy) return; heartbeatBusy = true;
    try {
      const update = await db.prepare("UPDATE repository_agent_runs SET heartbeat_at = CURRENT_TIMESTAMP WHERE id = ? AND lease_token = ? AND status = 'running'").run(run.id, run.lease_token);
      if (!update.changes) controller.abort();
    } catch { controller.abort(); }
    finally { heartbeatBusy = false; }
  }, 10_000);
  const deadline = setTimeout(() => controller.abort(), LIMITS.worker_timeout_ms + 65_000);
  const onStage = incoming => {
    if (signal.aborted || !incoming || typeof incoming.id !== 'string') return;
    const stage = { id: cleanText(incoming.id, 80), label: cleanText(incoming.label, 120), status: ['running','completed','passed','partial','failed','skipped'].includes(incoming.status) ? incoming.status : 'completed', detail: cleanText(incoming.detail, 500), duration_ms: Math.max(0, Number(incoming.duration_ms) || 0) };
    stages = [...stages.filter(item => item.id !== stage.id), stage].slice(-40);
    const snapshot = [...stages];
    stageChain = stageChain.then(() => db.prepare("UPDATE repository_agent_runs SET stages = ?, progress = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND lease_token = ? AND status = 'running'").run(snapshot, Math.min(90, 10 + snapshot.length * 9), run.id, run.lease_token)).catch(() => controller.abort());
  };
  try {
    const user = await workerUser(run.created_by);
    await requireScope(run.project_id, run.app_type_id, user, 'agentic_workflow.run');
    const deployedVersion = await compiler.compilerVersion();
    if (run.compiler_version !== deployedVersion) {
      run.compiler_version = deployedVersion;
      await db.prepare("UPDATE repository_agent_runs SET compiler_version = ? WHERE id = ? AND lease_token = ? AND status = 'running'").run(deployedVersion, run.id, run.lease_token);
    }
    onStage({ id: 'source', label: 'Read repository source', status: 'running', detail: 'Loading a bounded source snapshot.' });
    let buffer, source = run.source;
    if (run.input.archive) buffer = await readArchive(run.input.archive, signal);
    else {
      if (run.input.source.integration_id && !await permissionService.hasPermission(user, 'integration.view', run.project_id)) throw error('GitHub integration access is no longer available.', 403);
      const download = await repositorySource.downloadGithubSource(run.input.source, { signal, projectId: run.project_id, user });
      buffer = download.buffer; source = { ...download.source, uses_saved_connection: Boolean(run.input.source.integration_id) };
    }
    const fingerprint = hash(buffer);
    await db.prepare("UPDATE repository_agent_runs SET source = ?, input_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND lease_token = ? AND status = 'running'").run(source, fingerprint, run.id, run.lease_token);
    onStage({ id: 'source', label: 'Read repository source', status: 'completed', detail: 'Repository snapshot loaded. Repository commands are never executed.' });
    const cached = await db.prepare("SELECT id, result, summary, warnings FROM repository_agent_runs WHERE project_id = ? AND app_type_id IS NOT DISTINCT FROM ? AND agent_type = ? AND input_hash = ? AND compiler_version = ? AND id <> ? AND status IN ('completed','partial') AND result IS NOT NULL ORDER BY completed_at DESC LIMIT 1").get(run.project_id, run.app_type_id, run.agent_type, fingerprint, run.compiler_version, run.id);
    const result = cached ? compiler.validateResult(cached.result, run.agent_type) : await compiler.compileArchive({ buffer, agentType: run.agent_type, signal, onStage });
    if (signal.aborted) throw error('Analysis was cancelled.', 409);
    await stageChain;
    const findings = result.findings[FINDING_KEYS[run.agent_type]];
    const status = result.summary.status === 'partial' || !findings.length ? 'partial' : 'completed';
    const finalStages = cached ? [{ id: 'cache', label: 'Reuse unchanged source analysis', status: 'completed', detail: 'The source snapshot and compiler version match an existing analysis in this project.' }, ...result.stages] : result.stages;
    await db.prepare("UPDATE repository_agent_runs SET status = ?, source = ?, progress = 100, result = ?, summary = ?, warnings = ?, stages = ?, cached_from = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND lease_token = ? AND status = 'running'").run(status, { ...source, file_count: result.summary.files_scanned }, result, result.summary, result.warnings, finalStages, cached?.id || null, run.id, run.lease_token);
  } catch (failure) {
    await stageChain;
    const message = failure.publicMessage || (failure.statusCode && typeof failure.message === 'string' ? failure.message.slice(0, 500) : 'Repository analysis could not complete. Check the source and retry.');
    await db.prepare("UPDATE repository_agent_runs SET status = 'failed', error = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND lease_token = ? AND status = 'running'").run(message, run.id, run.lease_token);
  } finally { clearInterval(heartbeat); clearTimeout(deadline); active.delete(run.id); }
}
async function processQueuedRuns() {
  if (!accepting) return;
  const work = [];
  while (accepting && active.size < LIMITS.max_concurrent) {
    const run = await claimRun();
    if (!run) break;
    const controller = new AbortController(); active.set(run.id, controller);
    work.push(performRun(run, controller));
  }
  await Promise.allSettled(work);
}
async function shutdown() { accepting = false; for (const controller of active.values()) controller.abort(); }
module.exports = { getRun, getArtifact, listRuns, createRun, cancelRun, retryRun, processQueuedRuns, shutdown, requireScope, toPublic, _internals: { hash, readArchive, claimRun, performRun } };
