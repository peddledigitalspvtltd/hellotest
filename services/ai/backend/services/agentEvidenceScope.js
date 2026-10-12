const { releaseStoryMembershipSql, releaseExecutionMembershipSql } = require('@hellotest/platform/backend/src/utils/deliveryScopeSql');
const FIELDS = require('@hellotest/platform/shared/agentEvidenceScopeFields.json');
const KEYS = FIELDS.map(field => field.key);
function normalize(input = {}, scopes) {
  return Object.fromEntries(KEYS.filter(key => (!Array.isArray(scopes) || FIELDS.find(field => field.key === key).scopes.some(scope => scopes.includes(scope))) && typeof input[key] === 'string' && input[key].trim()).map(key => [key, input[key].trim().slice(0, 255)]));
}
// Fixed SQL identifiers only; all caller values are parameters. Project/app and
// permission predicates remain the responsibility of the native evidence reader.
function predicate(kind, alias, input = {}) {
  const scope = normalize(input), clauses = [], params = [];
  const add = (sql, value) => { if (value) { clauses.push(sql); params.push(...(Array.isArray(value) ? value : [value])); } };
  if (kind === 'story') {
    add(`${alias}.id = ?`, scope.story_id);
    add(`EXISTS (SELECT 1 FROM requirement_test_cases scope_links WHERE scope_links.requirement_id = ${alias}.id AND scope_links.test_case_id = ?)`, scope.test_case_id);
    add(`EXISTS (SELECT 1 FROM requirement_releases scope_release WHERE scope_release.id = ? AND scope_release.project_id = ${alias}.project_id AND ${releaseStoryMembershipSql(alias, 'scope_release')})`, scope.release_id);
  }
  if (kind === 'test_case') {
    add(`${alias}.id = ?`, scope.test_case_id);
    add(`EXISTS (SELECT 1 FROM execution_case_snapshots scope_case WHERE scope_case.test_case_id = ${alias}.id AND scope_case.execution_id = ?)`, scope.execution_id);
    add(`EXISTS (SELECT 1 FROM requirements scope_story JOIN requirement_releases scope_release ON scope_release.project_id = scope_story.project_id WHERE scope_story.project_id = (SELECT owner_app.project_id FROM app_types owner_app WHERE owner_app.id = ${alias}.app_type_id) AND (scope_story.id = ${alias}.requirement_id OR EXISTS (SELECT 1 FROM requirement_test_cases scope_link WHERE scope_link.requirement_id = scope_story.id AND scope_link.test_case_id = ${alias}.id)) AND scope_release.id = ? AND ${releaseStoryMembershipSql('scope_story', 'scope_release')})`, scope.release_id);
    if(scope.story_id) add(`(${alias}.requirement_id = ? OR EXISTS (SELECT 1 FROM requirement_test_cases scope_links WHERE scope_links.test_case_id = ${alias}.id AND scope_links.requirement_id = ?))`, [scope.story_id,scope.story_id]);
  }
  if (kind === 'run') {
    add(`${alias}.id = ?`, scope.execution_id);
    add(`${alias}.build = ?`, scope.build);
    add(`${alias}.test_environment_id = ?`, scope.environment_id);
    add(`EXISTS (SELECT 1 FROM requirement_releases scope_release WHERE scope_release.id = ? AND scope_release.project_id = ${alias}.project_id AND ${releaseExecutionMembershipSql(alias, 'scope_release')})`, scope.release_id);
    add(`EXISTS (SELECT 1 FROM execution_case_snapshots scope_result WHERE scope_result.execution_id = ${alias}.id AND scope_result.test_case_id = ?)`, scope.test_case_id);
    add(`EXISTS (SELECT 1 FROM execution_case_snapshots scope_case JOIN requirement_test_cases scope_link ON scope_link.test_case_id = scope_case.test_case_id WHERE scope_case.execution_id = ${alias}.id AND scope_link.requirement_id = ?)`, scope.story_id);
  }
  if (kind === 'bug') {
    add(`${alias}.linked_test_run_id = ?`, scope.execution_id);
    add(`${alias}.build = ?`, scope.build);
    add(`EXISTS (SELECT 1 FROM test_environments scope_env WHERE scope_env.id = ? AND scope_env.project_id = ${alias}.project_id AND (${alias}.environment = scope_env.id OR (LOWER(TRIM(${alias}.environment)) = LOWER(TRIM(scope_env.name)) AND (SELECT COUNT(*) FROM test_environments candidate_env WHERE candidate_env.project_id = scope_env.project_id AND LOWER(TRIM(candidate_env.name)) = LOWER(TRIM(scope_env.name))) = 1)))`, scope.environment_id);
    add(`EXISTS (SELECT 1 FROM requirement_releases scope_release WHERE scope_release.id = ? AND scope_release.project_id = ${alias}.project_id AND (LOWER(TRIM(COALESCE(NULLIF(TRIM(${alias}.fix_version),''),${alias}.release))) IN (LOWER(TRIM(scope_release.fix_version)),LOWER(TRIM(scope_release.name)))))`, scope.release_id);
    add(`${alias}.linked_requirement_ids @> jsonb_build_array(?::text)`, scope.story_id);
    add(`${alias}.linked_test_case_ids @> jsonb_build_array(?::text)`, scope.test_case_id);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params, scope };
}
module.exports = { normalize, predicate };
