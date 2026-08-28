const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("fresh schema and runtime bootstrap persist native delivery scope", async () => {
  const [schema, bootstrap, seed, requirementService, iterationService, releaseService, issueService, executionService] = await Promise.all([
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js"),
    readSource("../../db/seed.sql"),
    readSource("../src/services/requirement.service.js"),
    readSource("../src/services/requirementIteration.service.js"),
    readSource("../src/services/requirementRelease.service.js"),
    readSource("../src/services/issues.service.js"),
    readSource("../src/services/execution.service.js")
  ]);

  for (const source of [schema, bootstrap]) {
    assert.match(source, /iteration_id TEXT/);
    assert.match(source, /requirements_iteration_id_fkey/);
    assert.match(source, /REFERENCES requirement_iterations\(id\) ON DELETE SET NULL/);
    assert.match(source, /idx_requirements_iteration/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS requirement_releases/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS requirement_release_items/);
    assert.match(source, /requirement_releases_sprint_ids_array_check/);
    assert.match(source, /idx_requirement_releases_sprint_ids/);
  }

  assert.match(requirementService, /INSERT INTO requirements[\s\S]*iteration_id/);
  assert.match(requirementService, /syncSprintMembership\(iteration_id/);
  assert.match(requirementService, /previousIterationId !== nextIterationId[\s\S]*syncSprintMembership/);
  assert.match(releaseService, /exports\.syncSprintMembership/);
  assert.match(releaseService, /WHERE sprint_ids @> \?::jsonb/);
  assert.match(releaseService, /WHERE release_id = \? AND source = 'manual'/);
  assert.match(releaseService, /replaceMembership\([\s\S]*directRows\.map[\s\S]*sprintIds/);
  assert.match(releaseService, /RELEASE_SCOPE_LOCKED/);
  assert.match(iterationService, /syncSprintMembership\(id, \{ remove: true \}\)/);
  assert.match(issueService, /feedback\.sprint/);
  assert.match(issueService, /feedback\.fix_version/);
  assert.match(executionService, /INSERT INTO executions[\s\S]*release,[\s\S]*sprint/);

  assert.match(seed, /INSERT INTO requirement_iterations[\s\S]*iter_seed_1/);
  assert.match(seed, /INSERT INTO requirement_releases[\s\S]*release_seed_1/);
  assert.match(seed, /INSERT INTO requirement_release_items/);
  assert.match(seed, /UPDATE executions[\s\S]*release = '2026\.1'[\s\S]*sprint = 'Mobile Readiness Sprint'/);
  assert.match(seed, /UPDATE feedback[\s\S]*fix_version = '2026\.1'/);
  assert.match(seed, /INSERT INTO execution_schedules[\s\S]*release,[\s\S]*sprint/);
});

test("accumulated author, dataset, execution snapshot, and Module scope changes have schema parity", async () => {
  const [schema, bootstrap, seed, testCaseService, moduleService, executionService] = await Promise.all([
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js"),
    readSource("../../db/seed.sql"),
    readSource("../src/services/testCase.service.js"),
    readSource("../src/services/testCaseModule.service.js"),
    readSource("../src/services/execution.service.js")
  ]);

  for (const source of [schema, bootstrap]) {
    assert.match(source, /author_id TEXT/);
    assert.match(source, /test_cases_author_id_fkey/);
    assert.match(source, /CREATE TABLE(?: IF NOT EXISTS)? test_case_data_set_link_archive/);
    assert.match(source, /idx_test_case_data_sets_one_per_case/);
    assert.match(source, /test_data_set_snapshot JSONB/);
    assert.match(source, /data_set_source/);
    assert.match(source, /data_set_iteration_index INTEGER/);
    assert.match(source, /data_set_row_snapshot JSONB/);
    assert.match(source, /CREATE TABLE IF NOT EXISTS test_case_module_requirements/);
    assert.match(source, /idx_test_case_module_requirements_module_sort/);
  }

  assert.match(bootstrap, /INSERT INTO test_case_data_set_link_archive/);
  assert.match(bootstrap, /ROW_NUMBER\(\) OVER \(PARTITION BY test_case_id/);
  assert.match(bootstrap, /UPDATE test_cases SET author_id = created_by/);
  assert.match(testCaseService, /const resolvedAuthorId = normalizeText\(author_id\) \|\| resolvedCreatorId/);
  assert.match(testCaseService, /syncDataSetMappings\(id, payload\.test_data_set_ids\)/);
  assert.match(moduleService, /test_case_module_requirements/);
  assert.match(moduleService, /requirement_ids = \[\]/);
  assert.match(executionService, /test_data_set_snapshot/);
  assert.match(executionService, /data_set_source/);

  assert.match(seed, /author_id = COALESCE\(author_id, created_by, 'u1'\)/);
  assert.match(seed, /INSERT INTO test_case_data_sets[\s\S]*tc_web_1_1[\s\S]*tds_web_1/);
  assert.match(seed, /Starter Shared Step Group/);
  assert.doesNotMatch(schema, /CREATE TABLE[^;]*shared_steps\b/i);
});
