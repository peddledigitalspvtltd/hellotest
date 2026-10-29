const { releaseStoryMembershipSql, releaseExecutionMembershipSql } = require('./deliveryScopeSql');
const FIELDS = require('../../../shared/agentEvidenceScopeFields.json');
const KEYS = FIELDS.map(field => field.key);
const normalize = (input = {}, scopes) => Object.fromEntries(KEYS.filter(key => (
  (!Array.isArray(scopes) || FIELDS.find(field => field.key === key).scopes.some(scope => scopes.includes(scope)))
  && typeof input?.[key] === 'string' && input[key].trim()
)).map(key => [key, input[key].trim().slice(0, 255)]));

// All identifiers are supplied by code. Values are always bound parameters.
const linkedStory = (story, testCase) => `(${testCase}.requirement_id = ${story}.id OR EXISTS (SELECT 1 FROM requirement_test_cases scope_link WHERE scope_link.requirement_id = ${story}.id AND scope_link.test_case_id = ${testCase}.id))`;
const sprintMembership = (record, sprint, hasIteration = true) => `(${hasIteration ? `${record}.iteration_id = ${sprint}.id OR (${record}.iteration_id IS NULL AND ` : ''}LOWER(TRIM(${record}.sprint)) = LOWER(TRIM(${sprint}.name)) AND (SELECT COUNT(*) FROM requirement_iterations scope_sprint_name WHERE scope_sprint_name.project_id = ${sprint}.project_id AND LOWER(TRIM(scope_sprint_name.name)) = LOWER(TRIM(${sprint}.name))) = 1${hasIteration ? ')' : ''})`;
function predicate(kind, alias, input = {}) {
  const scope = normalize(input), clauses = [], params = [];
  const add = (sql, values) => { clauses.push(sql); params.push(...(Array.isArray(values) ? values : [values])); };
  const storyDelivery = (story) => {
    const delivery = [], values = [];
    if (scope.story_id) { delivery.push(`${story}.id = ?`); values.push(scope.story_id); }
    if (scope.release_id) { delivery.push(`EXISTS (SELECT 1 FROM requirement_releases scope_release WHERE scope_release.id = ? AND scope_release.project_id = ${story}.project_id AND ${releaseStoryMembershipSql(story, 'scope_release')})`); values.push(scope.release_id); }
    if (scope.sprint_id) { delivery.push(`EXISTS (SELECT 1 FROM requirement_iterations scope_sprint WHERE scope_sprint.id = ? AND scope_sprint.project_id = ${story}.project_id AND ${sprintMembership(story, 'scope_sprint')})`); values.push(scope.sprint_id); }
    return { sql: delivery.join(' AND '), params: values };
  };
  if (kind === 'story') {
    const delivery = storyDelivery(alias);
    if (delivery.sql) add(delivery.sql, delivery.params);
    if (scope.test_case_id) add(`EXISTS (SELECT 1 FROM test_cases scope_case JOIN app_types scope_app ON scope_app.id = scope_case.app_type_id AND scope_app.project_id = ${alias}.project_id WHERE scope_case.id = ? AND ${linkedStory(alias, 'scope_case')})`, scope.test_case_id);
    if (scope.execution_id) add(`EXISTS (SELECT 1 FROM executions scope_run JOIN execution_case_snapshots scope_snapshot ON scope_snapshot.execution_id = scope_run.id JOIN test_cases scope_case ON scope_case.id = scope_snapshot.test_case_id WHERE scope_run.id = ? AND scope_run.project_id = ${alias}.project_id AND ${linkedStory(alias, 'scope_case')}${scope.test_case_id ? ' AND scope_case.id = ?' : ''})`, [scope.execution_id, ...(scope.test_case_id ? [scope.test_case_id] : [])]);
  } else if (kind === 'test_case') {
    if (scope.test_case_id) add(`${alias}.id = ?`, scope.test_case_id);
    const delivery = storyDelivery('scope_story');
    if (delivery.sql) {
      const storyWitness = `EXISTS (SELECT 1 FROM requirements scope_story JOIN app_types scope_owner ON scope_owner.id = ${alias}.app_type_id AND scope_owner.project_id = scope_story.project_id WHERE ${linkedStory('scope_story', alias)} AND ${delivery.sql})`;
      if (!scope.story_id && (scope.release_id || scope.sprint_id)) {
        const runDelivery = predicate('run', 'scope_delivery_run', { release_id: scope.release_id, sprint_id: scope.sprint_id, execution_id: scope.execution_id });
        add(`(${storyWitness} OR EXISTS (SELECT 1 FROM execution_case_snapshots scope_delivery_case JOIN executions scope_delivery_run ON scope_delivery_run.id = scope_delivery_case.execution_id JOIN app_types scope_owner ON scope_owner.id = ${alias}.app_type_id AND scope_owner.project_id = scope_delivery_run.project_id WHERE scope_delivery_case.test_case_id = ${alias}.id ${runDelivery.sql}))`, [...delivery.params, ...runDelivery.params]);
      } else add(storyWitness, delivery.params);
    }
    if (scope.execution_id) add(`EXISTS (SELECT 1 FROM executions scope_run JOIN execution_case_snapshots scope_snapshot ON scope_snapshot.execution_id = scope_run.id JOIN app_types scope_owner ON scope_owner.id = ${alias}.app_type_id AND scope_owner.project_id = scope_run.project_id WHERE scope_snapshot.test_case_id = ${alias}.id AND scope_run.id = ?)`, scope.execution_id);
  } else if (kind === 'run') {
    if (scope.execution_id) add(`${alias}.id = ?`, scope.execution_id);
    if (scope.release_id) add(`EXISTS (SELECT 1 FROM requirement_releases scope_release WHERE scope_release.id = ? AND scope_release.project_id = ${alias}.project_id AND ${releaseExecutionMembershipSql(alias, 'scope_release')})`, scope.release_id);
    if (scope.sprint_id) add(`EXISTS (SELECT 1 FROM requirement_iterations scope_sprint WHERE scope_sprint.id = ? AND scope_sprint.project_id = ${alias}.project_id AND ${sprintMembership(alias, 'scope_sprint')})`, scope.sprint_id);
    if (scope.test_case_id || scope.story_id) {
      const caseScope = predicate('test_case', 'scope_case', { story_id: scope.story_id, test_case_id: scope.test_case_id });
      add(`EXISTS (SELECT 1 FROM execution_case_snapshots scope_snapshot JOIN test_cases scope_case ON scope_case.id = scope_snapshot.test_case_id JOIN app_types scope_owner ON scope_owner.id = scope_case.app_type_id AND scope_owner.project_id = ${alias}.project_id WHERE scope_snapshot.execution_id = ${alias}.id ${caseScope.sql})`, caseScope.params);
    }
  } else if (kind === 'bug') {
    if (scope.execution_id) add(`${alias}.linked_test_run_id = ?`, scope.execution_id);
    if (scope.story_id || scope.test_case_id || scope.release_id || scope.sprint_id) {
      // Each selected dimension must be witnessed; OR across different filters
      // would admit a defect from another Story, Sprint or Run.
      if (scope.story_id) add(`(${alias}.linked_requirement_ids @> jsonb_build_array(?::text) OR EXISTS (SELECT 1 FROM requirement_defects scope_defect WHERE scope_defect.issue_id = ${alias}.id AND scope_defect.requirement_id = ?))`, [scope.story_id, scope.story_id]);
      if (scope.test_case_id) add(`(${alias}.linked_test_case_ids @> jsonb_build_array(?::text) OR EXISTS (SELECT 1 FROM test_case_defects scope_defect WHERE scope_defect.issue_id = ${alias}.id AND scope_defect.test_case_id = ?))`, [scope.test_case_id, scope.test_case_id]);
      const deliveryInput = { release_id: scope.release_id, sprint_id: scope.sprint_id, story_id: scope.story_id, test_case_id: scope.test_case_id, execution_id: scope.execution_id };
      if (scope.release_id || scope.sprint_id) {
        const story = predicate('story', 'scope_story', deliveryInput);
        const run = predicate('run', 'scope_run', deliveryInput);
        const testCase = predicate('test_case', 'scope_defect_case', deliveryInput);
        const metadata = [], metadataParams = [];
        if (scope.release_id) { metadata.push(`EXISTS (SELECT 1 FROM requirement_releases scope_release WHERE scope_release.id = ? AND scope_release.project_id = ${alias}.project_id AND LOWER(TRIM(COALESCE(NULLIF(TRIM(${alias}.fix_version), ''), ${alias}.release))) IN (LOWER(TRIM(scope_release.fix_version)), LOWER(TRIM(scope_release.name))) AND (SELECT COUNT(*) FROM requirement_releases scope_name WHERE scope_name.project_id = ${alias}.project_id AND LOWER(TRIM(COALESCE(NULLIF(TRIM(${alias}.fix_version), ''), ${alias}.release))) IN (LOWER(TRIM(scope_name.fix_version)), LOWER(TRIM(scope_name.name)))) = 1)`); metadataParams.push(scope.release_id); }
        if (scope.sprint_id) { metadata.push(`EXISTS (SELECT 1 FROM requirement_iterations scope_sprint WHERE scope_sprint.id = ? AND scope_sprint.project_id = ${alias}.project_id AND ${sprintMembership(alias, 'scope_sprint', false)})`); metadataParams.push(scope.sprint_id); }
        add(`((${metadata.join(' AND ')}) OR EXISTS (SELECT 1 FROM requirements scope_story WHERE scope_story.project_id = ${alias}.project_id AND (${alias}.linked_requirement_ids @> jsonb_build_array(scope_story.id) OR EXISTS (SELECT 1 FROM requirement_defects scope_defect WHERE scope_defect.issue_id = ${alias}.id AND scope_defect.requirement_id = scope_story.id)) ${story.sql}) OR EXISTS (SELECT 1 FROM executions scope_run WHERE scope_run.id = ${alias}.linked_test_run_id AND scope_run.project_id = ${alias}.project_id ${run.sql}) OR EXISTS (SELECT 1 FROM test_cases scope_defect_case JOIN app_types scope_defect_app ON scope_defect_app.id = scope_defect_case.app_type_id AND scope_defect_app.project_id = ${alias}.project_id WHERE (${alias}.linked_test_case_ids @> jsonb_build_array(scope_defect_case.id) OR EXISTS (SELECT 1 FROM test_case_defects scope_defect_link WHERE scope_defect_link.issue_id = ${alias}.id AND scope_defect_link.test_case_id = scope_defect_case.id)) ${testCase.sql}))`, [...metadataParams, ...story.params, ...run.params, ...testCase.params]);
      }
    }
  }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params, scope };
}

function applicationPredicate(kind, alias, appTypeId) {
  if (!appTypeId) return { sql: '', params: [] };
  if (kind === 'test_case' || kind === 'run') return { sql: ` AND ${alias}.app_type_id = ?`, params: [appTypeId] };
  if (kind === 'story') return { sql: ` AND EXISTS (SELECT 1 FROM test_cases scope_app_case WHERE scope_app_case.app_type_id = ? AND ${linkedStory(alias, 'scope_app_case')})`, params: [appTypeId] };
  if (kind === 'bug') return { sql: ` AND (EXISTS (SELECT 1 FROM executions scope_app_run WHERE scope_app_run.id = ${alias}.linked_test_run_id AND scope_app_run.project_id = ${alias}.project_id AND scope_app_run.app_type_id = ?) OR EXISTS (SELECT 1 FROM test_cases scope_app_case WHERE scope_app_case.app_type_id = ? AND (${alias}.linked_test_case_ids @> jsonb_build_array(scope_app_case.id) OR EXISTS (SELECT 1 FROM test_case_defects scope_defect WHERE scope_defect.issue_id = ${alias}.id AND scope_defect.test_case_id = scope_app_case.id))))`, params: [appTypeId, appTypeId] };
  return { sql: '', params: [] };
}
// Indexed evidence qualifies by current native ownership or an explicit stored
// link. Similarity, source pins and text mentioning an ID cannot widen scope.
function sourcePredicate(alias, input, appTypeId) {
  const scope = normalize(input);
  if (!Object.keys(scope).length) return { sql: '', params: [] };
  const alternatives = [], params = [];
  for (const [kind, sourceKind, entityType, table] of [['story', 'requirement', 'requirement', 'requirements'], ['test_case', 'test_case', 'test_case', 'test_cases'], ['run', 'execution', 'execution', 'executions'], ['bug', 'bug', 'feedback', 'feedback']]) {
    const filter = predicate(kind, 'scope_source_record', scope), app = applicationPredicate(kind, 'scope_source_record', appTypeId);
    const owner = kind === 'test_case' ? `EXISTS (SELECT 1 FROM app_types scope_source_app WHERE scope_source_app.id = scope_source_record.app_type_id AND scope_source_app.project_id = ${alias}.project_id)` : `scope_source_record.project_id = ${alias}.project_id`;
    const links = [
      // Persisted Run passages contain whole-run aggregates. Narrower case or
      // Story selections use the live reader's filtered result aggregates.
      ...(kind === 'run' && (scope.story_id || scope.test_case_id) ? [] : [`(${alias}.source_kind = '${sourceKind}' AND scope_source_record.id = ${alias}.source_ref_id)`]),
      `EXISTS (SELECT 1 FROM attachments scope_attachment WHERE scope_attachment.id = ${alias}.attachment_id AND scope_attachment.project_id = ${alias}.project_id AND scope_attachment.entity_type = '${entityType}' AND scope_attachment.entity_id = scope_source_record.id)`,
      `(${alias}.source_kind = 'knowledge_item' AND EXISTS (SELECT 1 FROM ai_knowledge_relations scope_relation JOIN ai_knowledge_repo scope_knowledge ON scope_knowledge.id = ${alias}.source_ref_id AND scope_knowledge.project_id = ${alias}.project_id AND scope_knowledge.is_active = TRUE WHERE scope_relation.project_id = ${alias}.project_id AND ((scope_relation.source_type = 'knowledge_item' AND scope_relation.source_id = scope_knowledge.id AND scope_relation.target_type = '${sourceKind}' AND scope_relation.target_id = scope_source_record.id) OR (scope_relation.target_type = 'knowledge_item' AND scope_relation.target_id = scope_knowledge.id AND scope_relation.source_type = '${sourceKind}' AND scope_relation.source_id = scope_source_record.id))))`
    ];
    alternatives.push(`EXISTS (SELECT 1 FROM ${table} scope_source_record WHERE ${owner} AND (${links.join(' OR ')})${filter.sql}${app.sql})`);
    params.push(...filter.params, ...app.params);
  }
  const test = predicate('test_case', 'scope_knowledge_case', scope), app = applicationPredicate('test_case', 'scope_knowledge_case', appTypeId);
  alternatives.push(`(${alias}.source_kind = 'knowledge_item' AND EXISTS (SELECT 1 FROM ai_knowledge_repo scope_knowledge JOIN test_cases scope_knowledge_case ON scope_knowledge.linked_test_cases @> jsonb_build_array(scope_knowledge_case.id) JOIN app_types scope_knowledge_app ON scope_knowledge_app.id = scope_knowledge_case.app_type_id AND scope_knowledge_app.project_id = ${alias}.project_id WHERE scope_knowledge.id = ${alias}.source_ref_id AND scope_knowledge.project_id = ${alias}.project_id AND scope_knowledge.is_active = TRUE${test.sql}${app.sql}))`);
  params.push(...test.params, ...app.params);
  return { sql: ` AND (${alternatives.join(' OR ')})`, params };
}
module.exports = { normalize, predicate, applicationPredicate, linkedStory, sprintMembership, sourcePredicate };
