const db = require('../../db');
const repository = require('./repository');
const identifier = value => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw repository.error('SETUP_IDENTIFIER', 'Invalid setup schema identifier.');
  return `"${value}"`;
};
const grouped = records => {
  const groups = new Map();
  for (const record of records) {
    const key = `${record.table}:${record.keys.join(',')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.values()];
};
const checkSignal = signal => {
  if (signal?.aborted) throw Object.assign(new Error('Instance setup was interrupted and can be resumed.'), { code: 'SETUP_INTERRUPTED', retryable: true, publicMessage: 'Instance setup was interrupted and can be resumed.' });
};
function identityWhere(records) {
  const params = [];
  const sql = records.map(record => '(' + record.keys.map(key => { params.push(record.values[key]); return `${identifier(key)} = ?`; }).join(' AND ') + ')').join(' OR ');
  return { sql, params };
}
async function countFile(file, records) {
  if (file.kind === 'role_presets') {
    const names = records.map(record => record.name.trim().toLowerCase());
    const row = await db.prepare(`SELECT COUNT(DISTINCT LOWER(BTRIM(name)))::INTEGER AS count FROM roles WHERE LOWER(BTRIM(name)) IN (${names.map(() => '?').join(',')})`).get(...names);
    return Number(row.count);
  }
  let total = 0;
  for (let offset = 0; offset < records.length; offset += 100) {
    const batch = records.slice(offset, offset + 100).map(values => ({ table: file.table, keys: file.keys, values }));
    const where = identityWhere(batch);
    total += Number((await db.prepare(`SELECT COUNT(*)::INTEGER AS count FROM ${identifier(file.table)} WHERE ${where.sql}`).get(...where.params)).count);
  }
  return total;
}
async function validateExistingScopes(records, file) {
  for (const group of grouped(records)) for (let offset = 0; offset < group.length; offset += 100) {
    const params = [], predicates = [];
    for (const record of group.slice(offset, offset + 100)) {
      const scope = ['project_id', 'app_type_id'].filter(column => record.values[column]);
      if (!scope.length) continue;
      const identity = record.keys.map(column => { params.push(record.values[column]); return `${identifier(column)} = ?`; }).join(' AND ');
      const mismatch = scope.map(column => { params.push(record.values[column]); return `${identifier(column)} IS DISTINCT FROM ?`; }).join(' OR ');
      predicates.push(`(${identity} AND (${mismatch}))`);
    }
    if (!predicates.length) continue;
    const conflict = await db.prepare(`SELECT EXISTS (SELECT 1 FROM ${identifier(group[0].table)} WHERE ${predicates.join(' OR ')}) AS conflict`).get(...params);
    if (conflict?.conflict) throw repository.error('SETUP_SCOPE_CONFLICT', 'An existing sample record belongs to a different project or application. Existing data was retained; review the conflicting record before retrying.', file);
  }
}
async function preflight(dataset, files, actorId, signal) {
  checkSignal(signal);
  const actor = await db.prepare("SELECT id FROM users WHERE id = ? AND COALESCE(is_workspace_admin, FALSE) = TRUE AND COALESCE(status, 'active') <> 'suspended'").get(actorId);
  if (!actor) throw Object.assign(repository.error('SETUP_ACTOR_ACCESS', 'Active workspace administrator access is required for instance setup.'), { statusCode: 403 });
  if (files.some(file => file.module === 'workspace') && !await db.prepare("SELECT id FROM roles WHERE LOWER(BTRIM(name)) = 'admin' LIMIT 1").get()) throw repository.error('SETUP_ADMIN_ROLE_MISSING', 'The administrator role is missing. Validate the database schema before setting up the workspace.');
  const tables = [...new Set(files.filter(file => file.kind !== 'role_presets').map(file => file.table))];
  const [columns, foreignKeys] = await Promise.all([
    db.prepare(`SELECT table_name, column_name, is_nullable, column_default, is_identity, is_generated FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN (SELECT value FROM jsonb_array_elements_text(?::jsonb))`).all(tables),
    db.prepare(`SELECT child.relname AS child_table, parent.relname AS parent_table,
      ARRAY(SELECT attribute.attname::text FROM unnest(constraint_row.conkey) WITH ORDINALITY AS part(number, position) JOIN pg_attribute attribute ON attribute.attrelid = child.oid AND attribute.attnum = part.number ORDER BY part.position) AS child_columns,
      ARRAY(SELECT attribute.attname::text FROM unnest(constraint_row.confkey) WITH ORDINALITY AS part(number, position) JOIN pg_attribute attribute ON attribute.attrelid = parent.oid AND attribute.attnum = part.number ORDER BY part.position) AS parent_columns
      FROM pg_constraint constraint_row JOIN pg_class child ON child.oid = constraint_row.conrelid JOIN pg_namespace schema ON schema.oid = child.relnamespace
      JOIN pg_class parent ON parent.oid = constraint_row.confrelid WHERE constraint_row.contype = 'f' AND schema.nspname = 'public'
      AND child.relname IN (SELECT value FROM jsonb_array_elements_text(?::jsonb))`).all(tables)
  ]);
  const byTable = new Map(tables.map(table => [table, columns.filter(column => column.table_name === table)]));
  const planned = new Map(), identities = new Set(), loaded = [];
  // Parse and verify every selected file before the first write. No generated fallback
  // can hide a broken checksum, missing field, scope conflict or parent relationship.
  for (const [index, file] of files.entries()) {
    checkSignal(signal);
    const rows = repository.loadFile(dataset, file, actorId);
    loaded.push({ file, rows, index });
    if (file.kind === 'role_presets') {
      const codes = [...new Set(rows.flatMap(role => role.permission_codes))];
      const permissions = await db.prepare('SELECT code FROM permissions WHERE code IN (SELECT value FROM jsonb_array_elements_text(?::jsonb))').all(codes);
      const available = new Set(permissions.map(permission => permission.code));
      if (codes.some(code => !available.has(code))) throw repository.error('SETUP_PERMISSION_SCHEMA', 'The role presets require the current permission schema. Validate the schema, then retry.', file.path);
      continue;
    }
    const schema = byTable.get(file.table);
    if (!schema?.length) throw repository.error('SETUP_SCHEMA_MISSING', `Required table ${file.table} is unavailable. Validate the database schema, then retry.`, file.path);
    const known = new Set(schema.map(column => column.column_name));
    for (const [position, row] of rows.entries()) {
      const identity = `${file.table}:${JSON.stringify(file.keys.map(key => row[key]))}`;
      if (identities.has(identity)) throw repository.error('SETUP_DUPLICATE_IDENTITY', 'A setup identity is declared in more than one file.', file.path);
      identities.add(identity);
      for (const key of Object.keys(row)) if (!known.has(key)) throw repository.error('SETUP_COLUMN_MISSING', `Unknown column ${file.table}.${key}. Align the setup files and database schema.`, file.path);
      for (const column of schema) if (column.is_nullable === 'NO' && ((Object.hasOwn(row, column.column_name) && row[column.column_name] === null) || (!Object.hasOwn(row, column.column_name) && !column.column_default && column.is_identity !== 'YES' && column.is_generated === 'NEVER'))) throw repository.error('SETUP_REQUIRED_METADATA', `Required field ${file.table}.${column.column_name} is missing.`, file.path);
      if (!planned.has(file.table)) planned.set(file.table, []);
      planned.get(file.table).push({ row, index, position });
    }
    await validateExistingScopes(rows.map(values => ({ table: file.table, keys: file.keys, values })), file.path);
  }
  const external = new Map();
  for (const { file, rows, index } of loaded) {
    checkSignal(signal);
    if (file.kind === 'role_presets') continue;
    for (const relation of foreignKeys.filter(relation => relation.child_table === file.table)) for (const [position, row] of rows.entries()) {
      const values = relation.child_columns.map(column => row[column]);
      if (values.some(value => value === null || value === undefined)) continue;
      const parent = planned.get(relation.parent_table)?.find(item => relation.parent_columns.every((column, n) => item.row[column] === values[n]));
      if (parent) {
        if (parent.index > index || (parent.index === index && parent.position > position)) throw repository.error('SETUP_RELATION_ORDER', `${file.table} requires ${relation.parent_table} to be installed first. Correct the manifest order.`, file.path);
        continue;
      }
      const key = `${relation.parent_table}:${relation.parent_columns.join(',')}:${JSON.stringify(values)}`;
      if (!external.has(key)) external.set(key, Boolean(await db.prepare(`SELECT 1 AS present FROM ${identifier(relation.parent_table)} WHERE ${relation.parent_columns.map(column => `${identifier(column)} = ?`).join(' AND ')} LIMIT 1`).get(...values)));
      if (!external.get(key)) throw repository.error('SETUP_RELATION_MISSING', `${file.table} references a missing ${relation.parent_table} record. Restore the parent data or its setup dependency.`, file.path);
    }
  }
  checkSignal(signal);
}
module.exports = { identifier, grouped, checkSignal, identityWhere, countFile, validateExistingScopes, preflight };
