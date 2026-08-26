const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("test case metadata and data set links are durable and scope checked", async () => {
  const [schema, bootstrap, service, routes] = await Promise.all([
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js"),
    readSource("../src/services/testCase.service.js"),
    readSource("../src/routes/testCases.routes.js")
  ]);

  assert.match(schema, /test_case_type TEXT NOT NULL DEFAULT 'functional'/);
  assert.match(schema, /CREATE TABLE test_case_data_sets/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS test_case_data_sets/);
  assert.match(service, /All test data sets must belong to the test case project/);
  assert.match(service, /test_data_set_ids:/);
  assert.match(service, /author:/);
  assert.match(routes, /test_case_type:/);
  assert.match(routes, /test_data_set_ids:/);
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
