const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("test case metadata and data set links are durable and scope checked", async () => {
  const [schema, bootstrap, service, dataSetService, routes, versionRestore, openapi] = await Promise.all([
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js"),
    readSource("../src/services/testCase.service.js"),
    readSource("../src/services/testDataSet.service.js"),
    readSource("../src/routes/testCases.routes.js"),
    readSource("../src/services/testCaseVersionRestore.service.js"),
    readSource("../../../openapi.yaml")
  ]);

  assert.match(schema, /test_case_type TEXT NOT NULL DEFAULT 'functional'/);
  assert.match(schema, /CREATE TABLE test_case_data_sets/);
  assert.match(schema, /CREATE TABLE test_case_data_set_link_archive/);
  assert.match(schema, /CREATE UNIQUE INDEX idx_test_case_data_sets_one_per_case/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS test_case_data_sets/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS test_case_data_set_link_archive/);
  assert.match(bootstrap, /INSERT INTO test_case_data_set_link_archive/);
  assert.match(bootstrap, /archive_reason[\s\S]*single-data-set-enforcement/);
  assert.match(bootstrap, /ROW_NUMBER\(\) OVER \(PARTITION BY test_case_id ORDER BY sort_order ASC, test_data_set_id ASC\) AS link_rank/);
  assert.match(bootstrap, /CREATE UNIQUE INDEX IF NOT EXISTS idx_test_case_data_sets_one_per_case/);
  assert.match(service, /All test data sets must belong to the test case project/);
  assert.match(service, /A test case can link to only one test data set/);
  assert.match(service, /test_data_set_ids:/);
  assert.match(service, /redactTestDataSetRows\(row\.mode, row\.rows\)/);
  assert.match(dataSetService, /is_secret: true, value: "", has_stored_value: Boolean\(entry\.value\)/);
  assert.match(service, /author:/);
  assert.match(routes, /test_case_type:/);
  assert.match(schema, /test_case_type ~ '\^\[a-z\]\[a-z0-9_-\]\{0,119\}\$'/);
  assert.match(bootstrap, /test_cases_test_case_type_check CHECK \(test_case_type ~/);
  assert.match(service, /dropdownCatalog\.validateValue\("test_cases\.types", normalized, \{ existingValue, allowEmpty: false \}\)/);
  assert.doesNotMatch(service, /TEST_CASE_TYPE_VALUES/);
  assert.equal((routes.match(/test_case_type: \{ required: false, type: "string", minLength: 1, maxLength: 120 \}/g) || []).length, 2);
  assert.equal((openapi.match(/test_case_type: \{ type: string, minLength: 1, maxLength: 120,[^\n]*test_cases\.types dropdown catalog/g) || []).length, 3);
  assert.equal((routes.match(/test_data_set_ids: \{ required: false, type: "array", items: "string", maxItems: 1 \}/g) || []).length, 2);
  assert.match(versionRestore, /version\.content\.test_data_set_ids\.slice\(0, 1\)/);
});

test("hidden key-value data is redacted from API hydration", () => {
  const { redactTestDataSetRows } = require("../src/services/testDataSet.service");
  const rows = redactTestDataSetRows("key_value", [
    { id: "visible", key: "username", value: "jay", is_secret: false },
    { id: "hidden", key: "password", value: "do-not-render", is_secret: true }
  ]);

  assert.deepEqual(rows, [
    { id: "visible", key: "username", value: "jay", is_secret: false },
    { id: "hidden", key: "password", value: "", is_secret: true, has_stored_value: true }
  ]);
});

test("test case author can be selected without changing the acting audit user", async () => {
  const [schema, bootstrap, service, routes, versions, openapi] = await Promise.all([
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js"),
    readSource("../src/services/testCase.service.js"),
    readSource("../src/routes/testCases.routes.js"),
    readSource("../src/services/testCaseVersion.service.js"),
    readSource("../../../openapi.yaml")
  ]);
  const updateStatement = service.match(/const updateTestCaseRecord = db\.prepare\(`([\s\S]*?)`\);/)?.[1] || "";

  assert.match(schema, /author_id TEXT/);
  assert.match(schema, /UPDATE test_cases SET author_id = created_by WHERE author_id IS NULL AND created_by IS NOT NULL/);
  assert.match(bootstrap, /ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS author_id TEXT/);
  assert.match(bootstrap, /UPDATE test_cases SET author_id = created_by WHERE author_id IS NULL AND created_by IS NOT NULL/);
  assert.match(routes, /author_id: \{ required: false, type: "string" \}/);
  assert.match(routes, /author_id: req\.body\.author_id \|\| req\.user\.id/);
  assert.match(routes, /updated_by: req\.user\.id/);
  assert.match(service, /Author must be a member of the test case project/);
  assert.match(service, /Test case creator is required/);
  assert.match(service, /author_id: resolvedAuthorId,[\s\S]*created_by: resolvedCreatorId,[\s\S]*updated_by: normalizeText\(updated_by\) \|\| resolvedCreatorId/);
  assert.match(service, /author_id: testCase\.author_id \|\| testCase\.created_by \|\| null/);
  assert.match(service, /LEFT JOIN users ON users\.id = COALESCE\(test_cases\.author_id, test_cases\.created_by\)/);
  assert.match(updateStatement, /author_id = \?, updated_by = \?/);
  assert.doesNotMatch(updateStatement, /created_by = \?/);
  assert.match(service, /actor_id: payload\.updated_by/);
  assert.match(versions, /"author_id"/);
  assert.match(versions, /testCase\.author_id \|\| testCase\.author\?\.id \|\| testCase\.created_by \|\| null/);
  assert.match(openapi, /author_id: \{ type: string, nullable: true, description: Selected Test Case author/);
  assert.match(openapi, /created_by: \{ type: string, nullable: true, description: Immutable user who created the Test Case/);
});

test("table data sets expand into independently tracked engine iterations", async () => {
  const [schema, dispatch, callback, results] = await Promise.all([
    readSource("../../db/schema.sql"),
    readSource("../src/services/testEngineDispatch.service.js"),
    readSource("../src/services/testEngineCallback.service.js"),
    readSource("../src/services/executionResult.service.js")
  ]);

  assert.match(schema, /data_set_iteration_index INTEGER/);
  assert.match(dispatch, /resolveExecutionDataSetIterations/);
  assert.match(dispatch, /for \(const dataSetIteration of dataSetIterations\)/);
  assert.match(dispatch, /data_set_row_snapshot/);
  assert.match(callback, /requiredIterationKeys/);
  assert.match(results, /COALESCE\(data_set_iteration_index, -1\)/);
});
