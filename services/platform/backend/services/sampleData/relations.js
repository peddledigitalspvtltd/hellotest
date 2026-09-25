const defaultDb = require('../../src/db');
const defaultRepository = require('./repository');

const scalarTargets = Object.freeze({
  project_id: 'projects', app_type_id: 'app_types', iteration_id: 'requirement_iterations', release_id: 'requirement_releases',
  requirement_id: 'requirements', related_requirement_id: 'requirements', test_case_id: 'test_cases', manual_test_case_id: 'test_cases',
  automation_test_case_id: 'test_cases', suite_id: 'test_suites', module_id: 'test_case_modules', issue_id: 'feedback', source_issue_id: 'feedback',
  execution_id: 'executions', linked_test_run_id: 'executions', test_environment_id: 'test_environments', test_configuration_id: 'test_configurations',
  test_data_set_id: 'test_data_sets', collection_id: 'ai_knowledge_collections', source_id: 'ai_knowledge_sources',
  document_id: 'ai_knowledge_documents', transaction_id: 'workspace_transactions', reusable_group_id: 'shared_step_groups'
});
const arrayTargets = Object.freeze({
  sprint_ids: 'requirement_iterations', suite_ids: 'test_suites', linked_test_case_ids: 'test_cases', linked_test_cases: 'test_cases',
  linked_requirement_ids: 'requirements', linked_test_suite_ids: 'test_suites', linked_module_ids: 'test_case_modules',
  defects: 'feedback', case_defects: 'feedback'
});
const entityTargets = Object.freeze({
  story: 'requirements', requirement: 'requirements', test_case: 'test_cases', suite: 'test_suites', test_suite: 'test_suites',
  defect: 'feedback', issue: 'feedback', feedback: 'feedback', execution: 'executions', test_run: 'executions',
  module: 'test_case_modules', sprint: 'requirement_iterations', release: 'requirement_releases', shared_step_group: 'shared_step_groups'
});
// These are user-supplied values or authored prose, not domain relationships.
// A CSV column named project_id or a JSON example in a Story must remain legal.
const opaqueFields = new Set([
  'parameter_values', 'parameter_template_values', 'suite_parameter_values', 'suite_parameter_template_values',
  'shared_parameter_values', 'shared_parameter_template_values', 'data_set_row_snapshot', 'variables', 'rows', 'columns',
  'additional_fields', 'description', 'message', 'body', 'content', 'prompt_text', 'gherkin_document',
  'specification_content', 'action', 'expected_result', 'actual_result', 'steps_to_reproduce'
]);
const globalTables = new Set(['integrations']);
const sqlIdentifier = value => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Invalid setup relationship identifier');
  return `"${value}"`;
};
const identity = (keys, row) => JSON.stringify(keys.map(key => row[key]));

function createRelationValidator({ db = defaultDb, repository = defaultRepository } = {}) {
  const checkSignal = signal => {
    if (signal?.aborted) throw Object.assign(repository.error('SETUP_INTERRUPTED', 'Instance setup was interrupted and can be resumed.'), { retryable: true });
  };
  const relationError = (code, message, origin) => repository.error(code, message, origin.file.path);

  function references(row, origin) {
    const result = [];
    const seen = new Set();
    const add = (value, table, path) => {
      if (value === null || value === undefined || value === '') return;
      if (typeof value !== 'string') throw relationError('SETUP_RELATION_INVALID', `${origin.table}.${path} must contain a record ID. Review this setup relationship.`, origin);
      result.push({ id: value, table, path, origin });
    };
    const walk = (value, prefix = '', depth = 0) => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      if (depth > 64) throw relationError('SETUP_RELATION_INVALID', 'Setup relationship metadata is nested too deeply.', origin);
      seen.add(value);
      if (Array.isArray(value)) { value.forEach((child, index) => walk(child, `${prefix}[${index}]`, depth + 1)); return; }
      if (value.entity_id && entityTargets[value.entity_type]) add(value.entity_id, entityTargets[value.entity_type], `${prefix}entity_id`);
      for (const [key, child] of Object.entries(value)) {
        if (child === null || child === undefined || child === '' || opaqueFields.has(key)) continue;
        const path = `${prefix}${key}`;
        if (scalarTargets[key]) add(child, scalarTargets[key], path);
        if (arrayTargets[key]) {
          if (!Array.isArray(child)) throw relationError('SETUP_RELATION_INVALID', `${origin.table}.${path} must contain an array of record IDs.`, origin);
          child.forEach((id, index) => add(id, arrayTargets[key], `${path}[${index}]`));
        }
        if (key === 'step_defects' || key === 'stepDefects') {
          if (!child || typeof child !== 'object' || Array.isArray(child)) throw relationError('SETUP_RELATION_INVALID', 'Step Defect evidence must map step IDs to Defect ID arrays.', origin);
          for (const [stepId, defects] of Object.entries(child)) {
            add(stepId, 'test_steps', `${path}.step`);
            if (!Array.isArray(defects)) throw relationError('SETUP_RELATION_INVALID', 'Step Defect evidence must contain Defect ID arrays.', origin);
            defects.forEach(id => add(id, 'feedback', `${path}.defects`));
          }
        }
        if (typeof child === 'string' && /^[\[{]/.test(child.trim())) {
          let parsed;
          try { parsed = JSON.parse(child); } catch { continue; }
          walk(parsed, `${path}.`, depth + 1);
        } else walk(child, `${path}.`, depth + 1);
      }
    };
    walk(row);
    return result;
  }

  // Scope follows ownership only, never every outgoing relationship of an
  // unrelated user record. That bounds traversal and permits mixed-app cases.
  function ownerReferences(node) {
    if (node.table === 'projects' || globalTables.has(node.table)) return [];
    const direct = ['project_id', 'app_type_id'].filter(key => node.row[key]);
    const keys = direct.length ? direct : Object.keys(scalarTargets).filter(key => node.row[key]);
    return keys.map(key => ({ table: scalarTargets[key], id: node.row[key], path: key, origin: node.origin }));
  }

  async function validateRelations({ dataset, files, actorId, signal, mode = 'planned' }) {
    if (!['planned', 'saved'].includes(mode)) throw repository.error('SETUP_RELATION_MODE', 'Unsupported setup relationship validation mode.');
    checkSignal(signal);
    const roots = [], groups = new Map(), cache = new Map();
    const tableCache = table => {
      if (!cache.has(table)) cache.set(table, new Map());
      return cache.get(table);
    };
    for (const file of files) {
      checkSignal(signal);
      if (file.kind === 'role_presets') continue;
      const groupKey = `${file.table}:${file.keys.join(',')}`;
      if (!groups.has(groupKey)) groups.set(groupKey, { table: file.table, keys: file.keys, roots: [] });
      for (const row of repository.loadFile(dataset, file, actorId)) {
        const root = { table: file.table, authored: row, row: null, file, origin: null };
        root.origin = root;
        groups.get(groupKey).roots.push(root);
        roots.push(root);
      }
    }
    // Fetch only selected identities. Existing content wins over authored data,
    // including legitimate new Sprint links and edited snapshots in this scope.
    for (const group of groups.values()) for (let offset = 0; offset < group.roots.length; offset += 100) {
      checkSignal(signal);
      const batch = group.roots.slice(offset, offset + 100), params = [];
      const where = batch.map(root => '(' + group.keys.map(key => { params.push(root.authored[key]); return `${sqlIdentifier(key)} = ?`; }).join(' AND ') + ')').join(' OR ');
      const saved = await db.prepare(`SELECT * FROM ${sqlIdentifier(group.table)} WHERE ${where}`).all(...params);
      const byIdentity = new Map(saved.map(row => [identity(group.keys, row), row]));
      for (const root of batch) {
        const existing = byIdentity.get(identity(group.keys, root.authored));
        if (!existing && mode === 'saved') throw relationError('SETUP_RELATION_MISSING', `A saved ${root.table} record is missing. Retry setup to restore its identity before verification.`, root);
        root.row = existing || root.authored;
        if (root.row.id) tableCache(root.table).set(root.row.id, root);
      }
    }

    const allReferences = [];
    let pending = [];
    const expanded = new Set();
    for (const root of roots) {
      root.references = references(root.row, root);
      root.owners = ownerReferences(root);
      pending.push(...root.references, ...root.owners);
      allReferences.push(...root.references);
      expanded.add(root);
    }
    // Batch unresolved IDs by table and cache both hits and misses. Ownership
    // chains such as step -> case -> application -> project require a handful
    // of rounds rather than one query for every field, snapshot or data row.
    while (pending.length) {
      checkSignal(signal);
      const missing = new Map();
      for (const ref of pending) {
        if (typeof ref.id !== 'string') throw relationError('SETUP_RELATION_INVALID', `${ref.origin.table}.${ref.path} contains an invalid record ID.`, ref.origin);
        if (!tableCache(ref.table).has(ref.id)) {
          if (!missing.has(ref.table)) missing.set(ref.table, new Set());
          missing.get(ref.table).add(ref.id);
        }
      }
      for (const [table, ids] of missing) {
        const values = [...ids], stored = tableCache(table);
        for (let offset = 0; offset < values.length; offset += 100) {
          checkSignal(signal);
          const batch = values.slice(offset, offset + 100);
          const rows = await db.prepare(`SELECT * FROM ${sqlIdentifier(table)} WHERE id IN (${batch.map(() => '?').join(',')})`).all(...batch);
          batch.forEach(id => stored.set(id, null));
          rows.forEach(row => stored.set(row.id, { table, row, origin: null, owners: [] }));
        }
      }
      const next = [];
      for (const ref of pending) {
        const node = tableCache(ref.table).get(ref.id);
        if (!node) throw relationError('SETUP_RELATION_MISSING', `${ref.origin.table}.${ref.path} references a missing ${ref.table} record. Restore the related data or its setup dependency.`, ref.origin);
        ref.node = node;
        if (!expanded.has(node)) {
          expanded.add(node);
          node.origin = ref.origin;
          node.owners = ownerReferences(node);
          next.push(...node.owners);
        }
      }
      pending = next;
    }

    const projectCache = new Map();
    const projectsOf = (node, seen = new Set()) => {
      if (projectCache.has(node)) return projectCache.get(node);
      if (seen.has(node)) return new Set();
      const visited = new Set(seen); visited.add(node);
      const projects = new Set(node.table === 'projects' ? [node.row.id] : []);
      for (const owner of node.owners || []) for (const project of projectsOf(owner.node, visited)) projects.add(project);
      projectCache.set(node, projects);
      return projects;
    };
    const assertScope = (node, origin, path) => {
      if (globalTables.has(origin.table)) return;
      const projects = projectsOf(node);
      if (!projects.size || [...projects].some(project => project !== dataset.manifest.project_id)) {
        throw relationError('SETUP_SCOPE_CONFLICT', `${origin.table}${path ? `.${path}` : ''} references data outside the setup project or without a valid project owner. Existing data was retained; repair the relationship before retrying.`, origin);
      }
    };
    for (const root of roots) { checkSignal(signal); assertScope(root, root); }
    for (const ref of allReferences) assertScope(ref.node, ref.origin, ref.path);
    checkSignal(signal);
    return { mode, records: roots.length, references: allReferences.length };
  }

  return validateRelations;
}

module.exports = { validateRelations: createRelationValidator(), createRelationValidator, scalarTargets, arrayTargets };
