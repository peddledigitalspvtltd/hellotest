const { setTimeout: delay } = require('node:timers/promises');
const db = require('../../src/db');
const flags = require('../featureFlag.service');
const rolePresets = require('../rolePreset.service');
const { normalizePresetRoleName } = require('../../src/security/rolePresets.catalog');
const repository = require('./repository');
const validation = require('./validation');
const { validateRelations } = require('./relations');
const { identifier, grouped, checkSignal, countFile, validateExistingScopes } = validation;
const { resolveModules, buildRecords, getInstallPlan } = repository;
const recordsFor = (file, rows) => rows.map(values => ({ table: file.table, keys: file.keys, values }));
const isTransient = error => error.retryable === true || /^(08|40)/.test(error.code || '') || ['55P03', '57014', '57P01', '57P02', '57P03', '54000', '53200', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'].includes(error.code);

// Count canonical identities, never arbitrary customer records or stale install markers.
async function countRecords(packs, dataset = repository.loadManifest()) {
  const params = [], presets = repository.getRolePresets(dataset);
  const queries = dataset.manifest.modules.map((module, index) => {
    if (module.key === 'workspace_roles') {
      const names = presets.map(role => normalizePresetRoleName(role.name));
      params.push(...names);
      return `SELECT ${index} AS module_index, (SELECT COUNT(DISTINCT LOWER(BTRIM(name))) FROM roles WHERE LOWER(BTRIM(name)) IN (${names.map(() => '?').join(',')}))::INTEGER AS count`;
    }
    const counts = grouped(packs[module.key]).flatMap(records => {
      const batches = [];
      for (let offset = 0; offset < records.length; offset += 100) {
        const where = validation.identityWhere(records.slice(offset, offset + 100));
        params.push(...where.params);
        batches.push(`(SELECT COUNT(*) FROM ${identifier(records[0].table)} WHERE ${where.sql})`);
      }
      return batches;
    });
    return `SELECT ${index} AS module_index, (${counts.join(' + ') || '0'})::INTEGER AS count`;
  });
  const rows = await db.prepare(queries.join(' UNION ALL ')).all(...params);
  return dataset.manifest.modules.map((_, index) => Number(rows.find(row => Number(row.module_index) === index)?.count || 0));
}
async function insertRecords(records, batchSize = 50) {
  let inserted = 0;
  // Preserve authored ordering, including parent/child rows in the same table.
  for (let offset = 0; offset < records.length;) {
    const first = records[offset], columns = Object.keys(first.values), batch = [first];
    while (batch.length < batchSize && offset + batch.length < records.length) {
      const next = records[offset + batch.length];
      if (next.table !== first.table || Object.keys(next.values).join(',') !== columns.join(',')) break;
      batch.push(next);
    }
    const values = [], placeholders = batch.map(record => '(' + columns.map(column => {
      values.push(record.values[column]);
      return column === 'search_vector' ? "to_tsvector('simple', ?)" : '?';
    }).join(',') + ')');
    const result = await db.prepare(`INSERT INTO ${identifier(first.table)} (${columns.map(identifier).join(',')}) VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING`).run(...values);
    inserted += result.changes;
    offset += batch.length;
  }
  return inserted;
}
async function getCatalog() {
  const dataset = repository.loadManifest(), { manifest } = dataset;
  const packs = buildRecords(null), presets = repository.getRolePresets(dataset);
  const [counts, snapshot, project, roles, existingApplications] = await Promise.all([
    countRecords(packs, dataset), flags.getSnapshot(),
    db.prepare('SELECT id, name, description, (SELECT COUNT(*)::INTEGER FROM project_members WHERE project_id = projects.id) AS member_count FROM projects WHERE id = ?').get(manifest.project_id),
    rolePresets.getSetupRoleCatalog(presets),
    db.prepare('SELECT id, name, type, is_unified FROM app_types WHERE project_id = ? ORDER BY name, id').all(manifest.project_id)
  ]);
  const plannedProject = packs.workspace.find(record => record.table === 'projects').values;
  const plannedApplications = packs.workspace.filter(record => record.table === 'app_types').map(record => record.values);
  return {
    version: manifest.version, project_id: project?.id || null, roles,
    project_name: project?.name || plannedProject.name, blueprint: manifest.blueprint,
    dataset: { id: manifest.dataset_id, version: manifest.version, authored_at: manifest.authored_at, manifest_hash: dataset.manifest_hash, file_count: manifest.files.length, source: 'repository' },
    description: manifest.description,
    workspace: {
      description: project ? project.description || '' : plannedProject.description,
      applications: plannedApplications.map(planned => existingApplications.find(app => app.id === planned.id) || { id: planned.id, name: planned.name, type: planned.type, is_unified: planned.is_unified }),
      member_count: project?.member_count || 0,
      membership: 'All active workspace administrators are added when not already members. Existing member roles and assignments are retained.'
    },
    notes: ['Endpoints and integrations require your own connection settings before execution.', 'AI workflows are drafts. Run evidence is synthetic sample data; live model responses, telemetry and device sessions require configured services.'],
    modules: manifest.modules.map((module, index) => {
      const expected = manifest.files.filter(file => file.module === module.key).reduce((sum, file) => sum + file.record_count, 0);
      return { ...module,
        tables: module.key === 'workspace_roles' ? ['roles', 'role_permissions'] : [...new Set(packs[module.key].map(record => record.table))],
        record_count: counts[index], expected_record_count: expected,
        status: counts[index] === expected ? 'installed' : counts[index] ? 'partial' : 'not_installed',
        available: module.feature_keys.every(key => snapshot.flags[key] !== false)
      };
    })
  };
}

async function install({ requestedModules, actorId, ensureWorkspace, recordAudit, ipAddress, onProgress = async () => {}, onCheckpoint, checkpoints = [], expectedManifestHash, signal }) {
  const dataset = repository.loadManifest(), plan = getInstallPlan(requestedModules);
  if (dataset.manifest_hash !== plan.manifest_hash || (expectedManifestHash && expectedManifestHash !== plan.manifest_hash)) throw repository.error('SETUP_DATASET_CHANGED', 'The setup dataset changed after this job was queued. Start a new setup with the current files.');
  const { selection } = plan;
  const files = plan.files.map(file => {
    const saved = checkpoints.find(item => item.key === file.key && item.path === file.path && (!item.sha256 || item.sha256 === file.sha256));
    return { ...file, ...(saved?.status === 'completed' ? saved : {}), attempts: Number(saved?.attempts || 0), status: saved?.status === 'completed' ? 'completed' : 'pending' };
  });
  const progressState = (phase, currentFile = null, entries = files) => ({ phase, current_file: currentFile, files: entries.map(file => ({ ...file })), completed_files: entries.filter(file => file.status === 'completed').length, total_files: entries.length, manifest_hash: plan.manifest_hash, dataset_version: plan.dataset_version });
  const progress = async (phase, currentFile = null) => {
    checkSignal(signal);
    await onProgress(progressState(phase, currentFile));
  };
  await progress('validating');
  await validation.preflight(dataset, plan.files, actorId, signal);
  await validateRelations({ dataset, files: plan.files, actorId, signal, mode: 'planned' });
  const workspaceFile = plan.files.filter(file => file.module === 'workspace').at(-1)?.key;
  for (const file of files) {
    checkSignal(signal);
    const rows = repository.loadFile(dataset, file, actorId);
    const wasCompleted = file.status === 'completed';
    // Recheck saved identities: deletion since the checkpoint must be repaired.
    if (wasCompleted && file.key !== workspaceFile && await countFile(file, rows) === file.record_count) continue;
    file.status = 'running'; delete file.error;
    await progress('installing', file.path);
    let finished = false;
    for (let attempt = 0; attempt < 3 && !finished; attempt++) {
      checkSignal(signal);
      file.attempts++;
      try {
        const outcome = await db.transaction(async () => {
          await db.prepare("SET LOCAL lock_timeout = '5s'").run();
          await db.prepare("SET LOCAL statement_timeout = '30s'").run();
          // Also serialize legacy internal callers if a worker loses its session lock.
          await db.prepare("SELECT pg_advisory_xact_lock(hashtext('admin_sample_data_v2'))").get();
          checkSignal(signal);
          if (file.kind !== 'role_presets') await validateExistingScopes(recordsFor(file, rows), file.path);
          const before = await countFile(file, rows);
          const roles = file.kind === 'role_presets' ? await rolePresets.ensureSetupRoles(rows) : null;
          if (!roles) await insertRecords(recordsFor(file, rows), [50, 10, 1][attempt]);
          const memberships = file.key === workspaceFile ? await ensureWorkspace(actorId) : 0;
          const after = await countFile(file, rows);
          if (after !== file.record_count) throw repository.error('SETUP_IDENTITY_CONFLICT', `Setup file ${file.path} conflicts with an existing record. Existing data was retained; resolve the conflicting identity before retrying.`, file.path);
          checkSignal(signal);
          const inserted = Math.min(file.record_count, Number(file.inserted_records || 0) + after - before);
          const completedFile = { ...file, inserted_records: inserted, existing_records: after - inserted, total_records: after, administrator_memberships: Number(file.administrator_memberships || 0) + memberships, status: 'completed' };
          delete completedFile.error;
          if (roles) {
            const created = [...new Map([...(file.roles?.created || []), ...roles.created].map(role => [role.id, role])).values()];
            completedFile.roles = { created, retained: roles.retained.filter(role => !created.some(item => item.id === role.id)) };
          }
          // The worker persists this callback through the same transaction adapter:
          // a process exit cannot separate committed records from their receipt.
          if (onCheckpoint) await onCheckpoint(progressState('installing', file.path, files.map(item => item.key === file.key ? completedFile : item)));
          checkSignal(signal);
          return completedFile;
        })();
        Object.assign(file, outcome);
        finished = true;
      } catch (cause) {
        checkSignal(signal);
        const retryable = isTransient(cause);
        file.status = retryable && attempt < 2 ? 'retrying' : 'failed';
        file.error = cause.publicMessage || (retryable ? 'A temporary database error interrupted this file. Its transaction was rolled back safely.' : 'This file could not be installed. Review its schema, identities and relationships before retrying.');
        await progress('installing', file.path);
        if (file.status === 'failed') throw Object.assign(cause, { file: file.path, retryable, publicMessage: file.error });
        await delay(250 * (attempt + 1));
        checkSignal(signal);
        file.fallback_batch_size = [50, 10, 1][attempt + 1];
        file.status = 'running';
      }
    }
    delete file.error;
    await progress('installing', file.path);
  }
  await progress('verifying');
  for (const file of files) {
    checkSignal(signal);
    const rows = repository.loadFile(dataset, file, actorId);
    if (await countFile(file, rows) !== file.record_count) throw repository.error('SETUP_VERIFICATION_FAILED', `Setup file ${file.path} is incomplete. Retry to restore its missing records.`, file.path);
    if (file.kind !== 'role_presets') await validateExistingScopes(recordsFor(file, rows), file.path);
  }
  await validateRelations({ dataset, files: plan.files, actorId, signal, mode: 'saved' });
  if (repository.loadManifest().manifest_hash !== plan.manifest_hash) throw repository.error('SETUP_DATASET_CHANGED', 'The setup dataset changed during installation. Start a new setup to validate the current files.');
  const results = selection.installed.map(key => {
    const selected = files.filter(file => file.module === key);
    return { key, inserted_records: selected.reduce((n, file) => n + Number(file.inserted_records || 0), 0), existing_records: selected.reduce((n, file) => n + Number(file.existing_records || 0), 0), total_records: selected.reduce((n, file) => n + file.record_count, 0) };
  });
  const roles = files.reduce((result, file) => { if (file.roles) { result.created.push(...file.roles.created); result.retained.push(...file.roles.retained); } return result; }, { created: [], retained: [] });
  const administratorMemberships = files.reduce((n, file) => n + Number(file.administrator_memberships || 0), 0);
  const inserted = results.reduce((n, item) => n + item.inserted_records, 0);
  const projectId = selection.installed.includes('workspace') ? dataset.manifest.project_id : null;
  const result = { ...selection, project_id: projectId, administrator_memberships: administratorMemberships, roles, idempotent: true, version: plan.dataset_version, manifest_hash: plan.manifest_hash, inserted_records: inserted, existing_records: results.reduce((sum, item) => sum + item.existing_records, 0), module_results: results, file_results: files };
  checkSignal(signal);
  await recordAudit({ actorId, action: 'sample_data.seed', targetType: projectId ? 'project' : 'workspace', targetId: projectId, summary: `Installed ${selection.installed.length} sample modules; ${inserted} new records including ${roles.created.length} roles.`, metadata: { ...selection, module_results: results, administrator_memberships: administratorMemberships, roles, version: plan.dataset_version, manifest_hash: plan.manifest_hash }, ipAddress });
  checkSignal(signal);
  return result;
}
module.exports = { getCatalog, install, insertRecords, countRecords, resolveModules, buildRecords, getInstallPlan };
