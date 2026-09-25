const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const records = require("./helpers/instanceDataset");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("fresh schema and runtime bootstrap persist native delivery scope", async () => {
  const [schema, bootstrap, requirementService, iterationService, releaseService, issueService, executionService] = await Promise.all([
    readSource("../instance-setup-data/schema-setup/schema.sql"),
    readSource("../src/db/bootstrap.js"),
    readSource("../../../manual/backend/services/requirement.service.js"),
    readSource("../../../manual/backend/services/requirementIteration.service.js"),
    readSource("../../../manual/backend/services/requirementRelease.service.js"),
    readSource("../../../testing/backend/services/issues.service.js"),
    readSource("../../../testing/backend/services/execution.service.js")
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

  const sprints = new Set(records("requirement_iterations").map(row => row.id));
  const releases = records("requirement_releases");
  assert.ok(releases.length && releases.some(row => row.sprint_ids.some(id => sprints.has(id))));
  assert.ok(records("requirement_release_items").some(row => releases.some(release => release.id === row.release_id)));
  for (const table of ["executions", "feedback", "execution_schedules"]) {
    assert.ok(records(table).some(row => row.release && row.sprint), `${table} must include delivery scope`);
  }
});

test("accumulated author, dataset, execution snapshot, and Module scope changes have schema parity", async () => {
  const [schema, bootstrap, testCaseService, moduleService, executionService] = await Promise.all([
    readSource("../instance-setup-data/schema-setup/schema.sql"),
    readSource("../src/db/bootstrap.js"),
    readSource("../../../testing/backend/services/testCase.service.js"),
    readSource("../../../testing/backend/services/testCaseModule.service.js"),
    readSource("../../../testing/backend/services/execution.service.js")
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
    assert.match(source, /authoring_mode TEXT NOT NULL DEFAULT 'structured'/);
    assert.match(source, /gherkin_document TEXT/);
  }

  assert.match(bootstrap, /INSERT INTO test_case_data_set_link_archive/);
  assert.match(bootstrap, /ROW_NUMBER\(\) OVER \(PARTITION BY test_case_id/);
  assert.match(bootstrap, /UPDATE test_cases SET author_id = created_by/);
  assert.match(testCaseService, /const resolvedAuthorId = normalizeText\(author_id\) \|\| resolvedCreatorId/);
  assert.match(testCaseService, /syncDataSetMappings\(id, payload\.test_data_set_ids\)/);
  assert.match(moduleService, /test_case_module_requirements/);
  assert.match(moduleService, /requirement_ids = \[\]/);
  const sharedStepGroupService = await readSource("../../../testing/backend/services/sharedStepGroup.service.js");
  assert.match(sharedStepGroupService, /normalizeAuthoringMode/);
  assert.match(sharedStepGroupService, /authoring_mode, gherkin_document, steps/);
  assert.match(executionService, /test_data_set_snapshot/);
  assert.match(executionService, /data_set_source/);

  assert.ok(records("test_cases").some(row => row.author_id === "__SETUP_ACTOR_ID__"));
  const caseIds = new Set(records("test_cases").map(row => row.id));
  const dataIds = new Set(records("test_data_sets").map(row => row.id));
  assert.ok(records("test_case_data_sets").some(row => caseIds.has(row.test_case_id) && dataIds.has(row.test_data_set_id)));
  assert.ok(records("shared_step_groups").some(row => row.steps?.length));
  assert.doesNotMatch(schema, /CREATE TABLE[^;]*shared_steps\b/i);
});
