const db = require('../../db');
const flags = require('../featureFlag.service');
const rolePresets = require('../rolePreset.service');
const { modules, resolveModules } = require('./catalog');
const { buildRecords, PROJECT } = require('./records');
const identifier = value => { if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Invalid sample schema identifier'); return `"${value}"`; };
const grouped = records => {
  const groups = new Map();
  for (const record of records) {
    const key = record.table + ':' + record.keys.join(',');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.values()];
};
// One bounded read for the entire catalog. Count only known sample keys, never
// arbitrary customer records or a stored installation marker that may be stale.
async function countRecords(packs) {
  const params = [];
  const queries = modules.map((module, index) => {
    const counts = grouped(packs[module.key]).map(records => {
      const where = records.map(record => '(' + record.keys.map(key => {
        params.push(record.values[key]); return `${identifier(key)} = ?`;
      }).join(' AND ') + ')').join(' OR ');
      return `(SELECT COUNT(*) FROM ${identifier(records[0].table)} WHERE ${where})`;
    });
    return `SELECT ${index} AS module_index, (${counts.join(' + ') || '0'})::INTEGER AS count`;
  });
  const rows = await db.prepare(queries.join(' UNION ALL ')).all(...params);
  return modules.map((_, index) => Number(rows.find(row => Number(row.module_index) === index)?.count || 0));
}
async function validateExistingScopes(packs, selected) {
  const params = [];
  const queries = [];
  for (const key of selected) for (const records of grouped(packs[key])) {
    const predicates = records.flatMap(record => {
      const scope = ['project_id', 'app_type_id'].filter(column => record.values[column]);
      if (!scope.length) return [];
      const identity = record.keys.map(column => { params.push(record.values[column]); return `${identifier(column)} = ?`; }).join(' AND ');
      const mismatch = scope.map(column => { params.push(record.values[column]); return `${identifier(column)} IS DISTINCT FROM ?`; }).join(' OR ');
      return [`(${identity} AND (${mismatch}))`];
    });
    if (predicates.length) queries.push(`SELECT 1 FROM ${identifier(records[0].table)} WHERE ${predicates.join(' OR ')}`);
  }
  const conflict = queries.length && await db.prepare(`SELECT EXISTS (${queries.join(' UNION ALL ')}) AS conflict`).get(...params);
  if (conflict?.conflict) throw Object.assign(new Error('An existing sample record belongs to a different project or application. No sample changes were saved.'), { statusCode: 409 });
}
async function insertRecords(records) {
  let inserted = 0;
  // Each pack declares parent tables before dependents. Batch all rows from
  // each table/column profile, rather than making a round trip per sample.
  records = grouped(records).flatMap(group => {
    const profiles = new Map();
    for (const record of group) {
      const profile = Object.keys(record.values).join(',');
      if (!profiles.has(profile)) profiles.set(profile, []);
      profiles.get(profile).push(record);
    }
    return [...profiles.values()].flat();
  });
  for (let offset = 0; offset < records.length;) {
    const first = records[offset];
    const columns = Object.keys(first.values);
    const batch = [first];
    while (batch.length < 50 && offset + batch.length < records.length) {
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
  const packs = buildRecords(null);
  const [counts, snapshot, project, roles] = await Promise.all([
    countRecords(packs), flags.getSnapshot(),
    db.prepare("SELECT id, name FROM projects WHERE id = ?").get(PROJECT),
    rolePresets.getSetupRoleCatalog()
  ]);
  return {
    version: 2, project_id: project?.id || null, roles,
    project_name: project?.name || 'HelloTest Launchpad',
    description: 'Connected, synthetic commerce examples. Existing records are retained; required modules are included automatically.',
    notes: ['Endpoints and integrations require your own connection settings before execution.', 'AI workflows are drafts. Live model responses, telemetry and device sessions require configured services.'],
    modules: modules.map((module, index) => ({ ...module,
      tables: [...new Set(packs[module.key].map(record => record.table))],
      record_count: counts[index], expected_record_count: packs[module.key].length,
      status: counts[index] === packs[module.key].length ? 'installed' : counts[index] ? 'partial' : 'not_installed',
      available: module.feature_keys.every(key => snapshot.flags[key] !== false)
    }))
  };
}
async function install({ requestedModules, actorId, ensureWorkspace, recordAudit, ipAddress }) {
  const selection = resolveModules(requestedModules);
  const packs = buildRecords(actorId);
  return db.transaction(async () => {
    // Serialize installs to keep per-module counts and dependency outcomes exact.
    await db.prepare("SELECT pg_advisory_xact_lock(hashtext('admin_sample_data_v2'))").get();
    const roles = await rolePresets.ensureSetupRoles();
    await validateExistingScopes(packs, selection.installed);
    const before = await countRecords(packs);
    const administratorMemberships = await ensureWorkspace(actorId);
    const results = [];
    for (const key of selection.installed) {
      await insertRecords(packs[key]);
    }
    const after = await countRecords(packs);
    for (const key of selection.installed) {
      const index = modules.findIndex(module => module.key === key);
      if (after[index] !== packs[key].length) throw Object.assign(new Error(`Sample module ${key} conflicts with an existing record. No sample changes were saved.`), { statusCode: 409 });
      results.push({ key, inserted_records: after[index] - before[index], existing_records: before[index], total_records: after[index] });
    }
    const inserted = results.reduce((sum, item) => sum + item.inserted_records, 0);
    await recordAudit({ actorId, action: 'sample_data.seed', targetType: 'project', targetId: PROJECT, summary: `Installed ${selection.installed.length} sample modules; ${inserted} new records and ${roles.created.length} roles.`, metadata: { ...selection, module_results: results, administrator_memberships: administratorMemberships, roles, version: 2 }, ipAddress });
    return { ...selection, project_id: PROJECT, administrator_memberships: administratorMemberships, roles, idempotent: true, version: 2, inserted_records: inserted, existing_records: results.reduce((sum, item) => sum + item.existing_records, 0), module_results: results };
  })();
}
module.exports = { getCatalog, install, insertRecords, countRecords, resolveModules, buildRecords };
