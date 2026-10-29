const db = require('@hellotest/platform/backend/src/db');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const flags = require('@hellotest/platform/backend/services/featureFlag.service');
const scoped = require('@hellotest/platform/backend/src/utils/agentEvidenceScopeSql');
const SOURCES = Object.freeze({
  story_id: { kind: 'story', table: 'requirements', permission: 'requirement.view', name: 'title' },
  test_case_id: { kind: 'test_case', table: 'test_cases', permission: 'testcase.view', name: 'title' },
  execution_id: { kind: 'run', table: 'executions', permission: 'run.view', name: 'name' },
  release_id: { kind: 'release', table: 'requirement_releases', permission: 'requirement_iteration.view', name: 'name' },
  sprint_id: { kind: 'sprint', table: 'requirement_iterations', permission: 'requirement_iteration.view', name: 'name' }
});
const failure = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
async function options(input = {}, user) {
  const source = Object.hasOwn(SOURCES, input.field) ? SOURCES[input.field] : null;
  if (!source) throw failure('Choose a supported evidence filter.');
  if (!await permissions.hasPermission(user, source.permission, input.project_id)
    || !await flags.areEnabled(flags.getFeatureKeysForPermission(source.permission), { user })) throw failure('You cannot view these evidence records.', 403);
  const limit = Math.max(1, Math.min(10, Number.parseInt(input.limit, 10) || 10));
  const scope = scoped.normalize(input);
  delete scope[input.field];
  const isCase = source.kind === 'test_case';
  const params = [input.project_id];
  const clauses = [isCase ? 'owner_app.project_id = ?' : 'record.project_id = ?'];
  const joins = isCase ? 'JOIN app_types owner_app ON owner_app.id = record.app_type_id' : '';
  if (['story', 'test_case', 'run'].includes(source.kind)) {
    for (const predicate of [scoped.predicate(source.kind, 'record', scope), scoped.applicationPredicate(source.kind, 'record', input.app_type_id)]) {
      if (predicate.sql) { clauses.push(predicate.sql.replace(/^ AND /, '')); params.push(...predicate.params); }
    }
  } else if (Object.keys(scope).length || input.app_type_id) {
    // A delivery choice must have a current Story or Run that satisfies the
    // other selections. A fresh, unfiltered selector also lists empty releases.
    const witnesses = [];
    if (!input.app_type_id && source.kind === 'release' && Object.keys(scope).every(key => key === 'sprint_id') && scope.sprint_id) {
      witnesses.push('EXISTS (SELECT 1 FROM requirement_release_sprints scope_delivery JOIN requirement_iterations scope_iteration ON scope_iteration.id = scope_delivery.iteration_id AND scope_iteration.project_id = record.project_id WHERE scope_delivery.release_id = record.id AND scope_delivery.iteration_id = ?)');
      params.push(scope.sprint_id);
    }
    if (!input.app_type_id && source.kind === 'sprint' && Object.keys(scope).every(key => key === 'release_id') && scope.release_id) {
      witnesses.push('EXISTS (SELECT 1 FROM requirement_release_sprints scope_delivery JOIN requirement_releases scope_release ON scope_release.id = scope_delivery.release_id AND scope_release.project_id = record.project_id WHERE scope_delivery.iteration_id = record.id AND scope_delivery.release_id = ?)');
      params.push(scope.release_id);
    }
    for (const [kind, table, permission] of [['story', 'requirements', 'requirement.view'], ['run', 'executions', 'run.view']]) {
      if (!await permissions.hasPermission(user, permission, input.project_id)
        || !await flags.areEnabled(flags.getFeatureKeysForPermission(permission), { user })) continue;
      const predicate = scoped.predicate(kind, 'scope_record', scope);
      const app = scoped.applicationPredicate(kind, 'scope_record', input.app_type_id);
      const membership = source.kind === 'release'
        ? (kind === 'story' ? require('@hellotest/platform/backend/src/utils/deliveryScopeSql').releaseStoryMembershipSql('scope_record', 'record') : require('@hellotest/platform/backend/src/utils/deliveryScopeSql').releaseExecutionMembershipSql('scope_record', 'record'))
        : scoped.sprintMembership('scope_record', 'record');
      witnesses.push(`EXISTS (SELECT 1 FROM ${table} scope_record WHERE scope_record.project_id = record.project_id AND ${membership}${predicate.sql}${app.sql})`);
      params.push(...predicate.params, ...app.params);
    }
    clauses.push(witnesses.length ? `(${witnesses.join(' OR ')})` : 'FALSE');
  }
  const search = typeof input.search === 'string' ? input.search.trim().slice(0, 255) : '';
  if (search) {
    const columns = ['record.id', ...(source.kind !== 'run' ? ['record.display_id'] : []), `record.${source.name}`];
    clauses.push(`(${columns.map(column => `STRPOS(LOWER(COALESCE(${column}, '')), LOWER(?)) > 0`).join(' OR ')})`);
    params.push(...columns.map(() => search));
  }
  const rows = await db.prepare(`SELECT record.id, ${source.kind === 'run' ? 'NULL::text' : 'record.display_id'} AS display_id, record.${source.name} AS name
    FROM ${source.table} record ${joins} WHERE ${clauses.join(' AND ')}
    ORDER BY ${search ? 'CASE WHEN LOWER(record.id) = LOWER(?) THEN 0 ELSE 1 END,' : ''} record.created_at DESC NULLS LAST, record.id
    LIMIT ?`).all(...params, ...(search ? [search] : []), limit + 1);
  return { items: rows.slice(0, limit).map(row => ({ id: row.id, label: row.display_id || row.id, description: row.name || undefined })), has_more: rows.length > limit };
}
module.exports = { options };
