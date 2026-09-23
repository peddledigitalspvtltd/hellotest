#!/usr/bin/env node
'use strict';

// Offline authoring check. The installer consumes JSON directly and never runs
// this script or imports the historical JavaScript sample-data generators.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');

const root = __dirname;
const ACTOR = '__SETUP_ACTOR_ID__';
const hash = value => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const identity = (record, keys) => JSON.stringify(keys.map(key => record[key]));
const byTable = new Map();
const byId = new Map();
const fileMap = new Map(manifest.files.map(file => [file.key, file]));
const seenFiles = new Set();
const all = [];
let presets = 0;

assert.equal(manifest.schema_version, 1);
assert.equal(new Date(manifest.authored_at).toISOString(), manifest.authored_at);
const moduleMap = new Map(manifest.modules.map(module => [module.key, module]));
assert.equal(moduleMap.size, manifest.modules.length, 'Module keys must be unique');
for (const module of manifest.modules) {
  for (const dependency of module.depends_on) assert(moduleMap.has(dependency), `Unknown module dependency ${dependency}`);
}

for (const file of manifest.files) {
  assert(!seenFiles.has(file.key), `Duplicate file key ${file.key}`);
  assert(moduleMap.has(file.module), `Unknown file module ${file.module}`);
  assert(file.path.endsWith('.json') && !file.path.split('/').includes('..') && !path.isAbsolute(file.path), `Unsafe data path ${file.path}`);
  for (const dependency of file.depends_on || []) assert(seenFiles.has(dependency), `${file.key} precedes dependency ${dependency}`);
  const raw = fs.readFileSync(path.join(root, file.path));
  assert.equal(hash(raw), file.sha256, `Checksum mismatch: ${file.path}`);
  const data = JSON.parse(raw);
  assert.equal(data.schema_version, 1);
  assert(Array.isArray(data.records));
  assert.equal(data.records.length, file.record_count, `Record count mismatch: ${file.path}`);
  if (file.kind === 'role_presets') {
    const names = new Set();
    const ids = new Set();
    for (const role of data.records) {
      assert.equal(role.id, `instance-role-${role.key}`);
      assert(!names.has(role.name.toLowerCase()) && !ids.has(role.id), 'Duplicate role preset');
      names.add(role.name.toLowerCase());
      ids.add(role.id);
      assert.equal(new Set(role.permission_codes).size, role.permission_codes.length, `Duplicate permissions for ${role.name}`);
      assert(role.permission_codes.length > 0);
    }
    presets += data.records.length;
  } else {
    assert(/^[a-z_][a-z0-9_]*$/.test(file.table), `Invalid table ${file.table}`);
    assert(Array.isArray(file.keys) && file.keys.length > 0);
    if (!byTable.has(file.table)) byTable.set(file.table, []);
    for (const record of data.records) {
      assert(record && typeof record === 'object' && !Array.isArray(record));
      for (const key of file.keys) assert(record[key] !== undefined && record[key] !== null, `Missing ${file.table}.${key}`);
      assert(!byTable.get(file.table).some(item => item.keys.join(',') === file.keys.join(',') && identity(item.record, file.keys) === identity(record, file.keys)), `Duplicate identity in ${file.table}`);
      const item = { record, table: file.table, keys: file.keys, file: file.key };
      byTable.get(file.table).push(item);
      all.push(item);
      if (record.id) {
        assert(!byId.has(record.id), `Duplicate global sample ID ${record.id}`);
        byId.set(record.id, item);
      }
    }
  }
  seenFiles.add(file.key);
}

// Read the declared PostgreSQL relationships without depending on an installed
// database. The integration suite additionally exercises the real constraints.
const sql = fs.readFileSync(path.join(root, '../db/schema.sql'), 'utf8').replace(/--[^\n]*/g, '');
const foreignKeys = [];
function foreignKeysIn(table, definition, isAlter = false) {
  for (const match of definition.matchAll(/FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+(\w+)\s*\(([^)]+)\)/gi)) {
    foreignKeys.push({ table, columns: match[1].split(',').map(s => s.trim()), target: match[2], targets: match[3].split(',').map(s => s.trim()) });
  }
  const expression = isAlter
    ? /ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)\s+[^;]*?\bREFERENCES\s+(\w+)\s*\((\w+)\)/gi
    : /^\s*(\w+)\s+[^,\n]*?\bREFERENCES\s+(\w+)\s*\((\w+)\)/gim;
  for (const match of definition.matchAll(expression)) foreignKeys.push({ table, columns: [match[1]], target: match[2], targets: [match[3]] });
}
for (const match of sql.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\);/gi)) foreignKeysIn(match[1], match[2]);
for (const match of sql.matchAll(/ALTER\s+TABLE\s+(\w+)\b([\s\S]*?);/gi)) foreignKeysIn(match[1], match[2], true);

let relationalLinks = 0;
for (const relation of foreignKeys) for (const { record } of byTable.get(relation.table) || []) {
  if (relation.columns.some(column => record[column] === null || record[column] === undefined)) continue;
  const values = relation.columns.map(column => record[column]);
  if (relation.target === 'users') assert(values.every(value => value === ACTOR), `Non-placeholder user reference in ${relation.table}`);
  else assert((byTable.get(relation.target) || []).some(({ record: target }) => relation.targets.every((column, index) => target[column] === values[index])), `Broken FK ${relation.table}.${relation.columns} -> ${relation.target}: ${values}`);
  relationalLinks += 1;
}

const scalarTargets = {
  project_id: 'projects', app_type_id: 'app_types', iteration_id: 'requirement_iterations', release_id: 'requirement_releases',
  requirement_id: 'requirements', related_requirement_id: 'requirements', test_case_id: 'test_cases', manual_test_case_id: 'test_cases',
  automation_test_case_id: 'test_cases', suite_id: 'test_suites', module_id: 'test_case_modules', issue_id: 'feedback', source_issue_id: 'feedback',
  execution_id: 'executions', linked_test_run_id: 'executions', test_environment_id: 'test_environments', test_configuration_id: 'test_configurations', test_data_set_id: 'test_data_sets',
  collection_id: 'ai_knowledge_collections', source_id: 'ai_knowledge_sources', document_id: 'ai_knowledge_documents', transaction_id: 'workspace_transactions',
  reusable_group_id: 'shared_step_groups'
};
const arrayTargets = {
  sprint_ids: 'requirement_iterations', suite_ids: 'test_suites', linked_test_case_ids: 'test_cases', linked_test_cases: 'test_cases',
  linked_requirement_ids: 'requirements', linked_test_suite_ids: 'test_suites', linked_module_ids: 'test_case_modules',
  defects: 'feedback', case_defects: 'feedback'
};
const actorFields = new Set(['actor_id', 'user_id', 'author_id', 'reviewer_id', 'assignee_id', 'assigned_to', 'created_by', 'updated_by', 'executed_by', 'original_dev_id', 'original_qa_id', 'verified_by']);
let softLinks = 0;
function checkTarget(id, target, label) {
  assert(typeof id === 'string' && byId.get(id)?.table === target, `Broken object link ${label} -> ${target}: ${id}`);
  softLinks += 1;
}
function inspect(value, label) {
  if (Array.isArray(value)) return value.forEach((item, index) => inspect(item, `${label}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (child === null || child === undefined || child === '') continue;
    if (scalarTargets[key]) checkTarget(child, scalarTargets[key], `${label}.${key}`);
    if (arrayTargets[key]) {
      assert(Array.isArray(child), `${label}.${key} must be an array`);
      child.forEach(id => checkTarget(id, arrayTargets[key], `${label}.${key}`));
    }
    if (actorFields.has(key)) assert.equal(child, ACTOR, `Non-placeholder actor in ${label}.${key}`);
    if (key === 'assigned_to_ids') { assert(Array.isArray(child)); child.forEach(id => assert.equal(id, ACTOR)); }
    if (key === 'step_defects' || key === 'stepDefects') {
      for (const [stepId, defectIds] of Object.entries(child)) {
        checkTarget(stepId, 'test_steps', `${label}.${key}`);
        assert(Array.isArray(defectIds));
        defectIds.forEach(defectId => checkTarget(defectId, 'feedback', `${label}.${key}.${stepId}`));
      }
    }
    if (typeof child === 'string' && /^[{[]/.test(child.trim())) {
      let parsed;
      try { parsed = JSON.parse(child); } catch { /* Markdown and authoring text may start with punctuation. */ }
      if (parsed) inspect(parsed, `${label}.${key}(json)`);
    } else inspect(child, `${label}.${key}`);
  }
}
for (const { record, table } of all) inspect(record, `${table}:${record.id || ''}`);

function checkOrderedReferences(value, file) {
  if (typeof value === 'string') {
    const parent = byId.get(value);
    if (parent && parent.file !== file.key) assert(file.depends_on.includes(parent.file), `Undeclared file dependency ${file.key} -> ${parent.file}`);
    if (/^[{[]/.test(value.trim())) {
      let parsed;
      try { parsed = JSON.parse(value); } catch { /* Not encoded JSON. */ }
      if (parsed) checkOrderedReferences(parsed, file);
    }
  } else if (Array.isArray(value)) value.forEach(item => checkOrderedReferences(item, file));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    checkOrderedReferences(key, file);
    checkOrderedReferences(item, file);
  }
}
for (const item of all) checkOrderedReferences(item.record, fileMap.get(item.file));

// A relationship can have valid IDs and still cross an application/project.
const projectOf = record => record.project_id || byId.get(record.app_type_id)?.record.project_id;
let scopedLinks = 0;
for (const { record, table } of all) {
  const ownProject = projectOf(record);
  const relatedProjects = new Set(ownProject ? [ownProject] : []);
  for (const column of Object.keys(scalarTargets)) {
    const parent = byId.get(record[column])?.record;
    if (!parent) continue;
    const parentProject = projectOf(parent);
    if (parentProject) relatedProjects.add(parentProject);
    if (ownProject && parentProject) assert.equal(ownProject, parentProject, `Cross-project ${table}.${column}`);
    if (record.app_type_id && parent.app_type_id) assert.equal(record.app_type_id, parent.app_type_id, `Cross-application ${table}.${column}`);
    scopedLinks += 1;
  }
  assert(relatedProjects.size <= 1, `Cross-project relation in ${table}`);
}
for (const [table, rows] of byTable) {
  const displayIds = rows.map(item => item.record.display_id).filter(Boolean);
  assert.equal(new Set(displayIds).size, displayIds.length, `Short ID collision in ${table}`);
}

for (const { record: doc } of byTable.get('ai_knowledge_documents') || []) {
  assert.equal(doc.checksum_sha256, hash(doc.content), `Knowledge checksum: ${doc.id}`);
  assert.equal(doc.char_count, doc.content.length, `Knowledge length: ${doc.id}`);
  for (const { record: chunk } of byTable.get('ai_knowledge_chunks') || []) if (chunk.document_id === doc.id) {
    assert.equal(doc.content.slice(chunk.char_start || 0, chunk.char_end), chunk.content, `Knowledge chunk offsets: ${chunk.id}`);
  }
}
const blueprint = JSON.parse(fs.readFileSync(path.join(root, 'reference/hellotest-feature-blueprint.json'), 'utf8'));
assert.equal(blueprint.features.length, manifest.blueprint.story_count);
assert.equal(blueprint.sprints.length, manifest.blueprint.sprint_count);
assert.equal(blueprint.releases.length, manifest.blueprint.release_count);
const reference = fs.readFileSync(path.join(root, 'reference/hellotest-feature-stories.md'), 'utf8');
assert.equal(byId.get('sample-v3-document-hellotest').record.content, reference);
assert.equal(byId.get('sample-v3-artifact-hellotest-stories').record.content, reference);
assert(!reference.includes('Dates are relative to installation day'));

const sharedGroup = byId.get('sample-v5-data-shared-group').record;
const sharedData = byId.get(sharedGroup.test_data_set_id).record;
assert.equal(sharedData.rows.length, 1, 'The shared group must have exactly one data row');
assert.equal(sharedGroup.test_data_row_index, 0);
const pendingCase = byId.get('sample-v5-data-case-review').record;
assert.equal(pendingCase.review_status, 'pending');
assert.equal(pendingCase.reviewer_id, ACTOR);
assert.equal(pendingCase.test_data_options.override_shared_steps, false);
const snapshot = byTable.get('execution_case_snapshots').find(item => item.record.execution_id === 'sample-v5-data-run').record;
assert.equal(snapshot.test_data_set_snapshot.data_scope_policy.version, 2);
assert.equal(snapshot.test_data_set_snapshot.rows.length, 2);
const frozenSteps = byTable.get('execution_step_snapshots').filter(item => item.record.execution_id === snapshot.execution_id).map(item => item.record);
const sharedStep = frozenSteps.find(step => step.reusable_group_id === sharedGroup.id);
assert(sharedStep, 'The run must retain its shared-group relationship');
assert.deepEqual(sharedStep.shared_parameter_values, sharedData.rows[0]);
for (const { record: result } of byTable.get('execution_results').filter(item => item.record.execution_id === snapshot.execution_id)) {
  assert.deepEqual(result.data_set_row_snapshot, snapshot.test_data_set_snapshot.rows[result.data_set_iteration_index]);
}
const failedResult = byId.get('sample-v5-data-result-1').record;
assert.equal(failedResult.status, 'failed');
assert.deepEqual(failedResult.step_defects[sharedStep.snapshot_step_id], ['sample-v5-data-defect']);
assert.equal(byId.get('sample-v5-data-defect').record.status, 'open');

const v6 = prefix => (byTable.get(prefix) || []).map(item => item.record).filter(record => Object.values(record).some(value => typeof value === 'string' && value.startsWith('sample-v6-ht-')));
const v6Sprints = v6('requirement_iterations');
const v6Releases = v6('requirement_releases');
const v6Stories = v6('requirements');
const v6Suites = v6('test_suites');
const v6Cases = v6('test_cases');
const v6Groups = v6('shared_step_groups');
const v6Runs = v6('executions');
const v6Results = v6('execution_results');
const v6Defects = v6('feedback');
assert.equal(v6Sprints.length, 3);
assert(v6Sprints.every(sprint => sprint.name.length <= 7), 'Version 6 Sprint names stay concise');
assert.equal(v6Releases.length, 3);
assert(v6Releases.every(release => release.name.length <= 7 && /^6\.\d$/.test(release.fix_version)), 'Version 6 Release names and versions stay concise');
assert.equal(v6Stories.length, 8);
assert.deepEqual(new Set(v6Stories.map(story => story.priority)), new Set([1, 2, 3, 4, 5]));
assert(v6Stories.some(story => story.status === 'dev_done'));
assert(v6Stories.some(story => story.status === 'qa_done'));
assert(v6Stories.every(story => story.iteration_id && story.release && story.fix_version && story.additional_fields?.assignee_id === ACTOR));
assert.equal(v6('requirement_release_items').length, v6Stories.length);
assert.equal(v6Suites.length, 3);
assert.equal(v6Groups.length, 3);
assert.equal(v6Cases.length, 8);
assert.equal(v6('requirement_test_cases').length, v6Cases.length);
assert.equal(v6('test_case_module_cases').length, v6Cases.length);
assert.equal(v6('test_case_module_requirements').length, v6Cases.length);
assert.equal(v6('suite_test_cases').length, v6Cases.length);
assert.equal(v6('test_case_data_sets').length, v6Cases.length);
for (const testCase of v6Cases) {
  const linkedData = byTable.get('test_case_data_sets').find(item => item.record.test_case_id === testCase.id)?.record;
  const data = byId.get(linkedData?.test_data_set_id)?.record;
  assert(data, `${testCase.id} has a linked data set`);
  assert(Object.keys(testCase.parameter_values).every(key => data.columns.includes(key)), `${testCase.id} parameters match its linked data columns`);
  const caseSteps = byTable.get('test_steps').filter(item => item.record.test_case_id === testCase.id).map(item => item.record);
  assert.equal(caseSteps.length, 3);
  assert(caseSteps.some(step => step.group_kind === 'local' && step.group_name === 'Preconditions'));
  assert(caseSteps.some(step => step.group_kind === 'reusable' && step.reusable_group_id));
}
for (const group of v6Groups) {
  const data = byId.get(group.test_data_set_id)?.record;
  assert(data && Object.keys(group.parameter_values).every(key => data.columns.includes(key)), `${group.id} parameters match shared data`);
}
assert.equal(v6Runs.length, 3);
assert(v6Runs.every(run => run.test_environment_id && run.test_configuration_id && run.test_data_set_id && run.release_id && run.iteration_id));
assert.deepEqual(new Set(v6Results.map(result => result.status)), new Set(['passed', 'failed', 'blocked', 'skipped']));
for (const run of v6Runs) assert.equal(run.duration_ms, v6Results.filter(result => result.execution_id === run.id).reduce((sum, result) => sum + result.duration_ms, 0));
assert.equal(v6Defects.length, 6);
assert.deepEqual(new Set(v6Defects.map(defect => defect.severity)), new Set(['critical', 'high', 'medium', 'low']));
assert(new Set(v6Defects.map(defect => defect.status)).size >= 6);
assert(v6Defects.every(defect => defect.linked_test_run_id && defect.linked_test_case_ids.length && defect.linked_test_suite_ids.length && defect.linked_module_ids.length && defect.linked_requirement_ids.length));
assert.equal(v6('requirement_defects').length, v6Defects.length);
assert.equal(v6('test_case_defects').length, v6Defects.length);

console.log(JSON.stringify({ dataset: manifest.dataset_id, version: manifest.version, files: manifest.files.length, records: all.length, role_presets: presets, relational_links: relationalLinks, object_links: softLinks, scoped_links: scopedLinks, status: 'passed' }, null, 2));
