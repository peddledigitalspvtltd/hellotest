import { readApiSources } from "../../../platform/frontend/test/helpers/readApiSources.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("execution case snapshots expose immutable per-case Data Set context", async () => {
  const types = await readSource("../../../platform/frontend/src/types.ts");

  for (const field of [
    "test_data_set_id?: string | null",
    "test_data_set_name?: string | null",
    "test_data_set_snapshot?: ExecutionDataSetSnapshot | null",
    "data_set_source?: \"test_case\" | \"run\" | string | null"
  ]) {
    assert.match(types, new RegExp(field.replace(/[?+|]/g, "\\$&")));
  }
});

test("run cases derive stable row instances and render every frozen row with values and status", async () => {
  const [page, styles] = await Promise.all([
    readSource("../../frontend/pages/ExecutionsPage.tsx"),
    readSource("../../frontend/pages/ExecutionsPage.case-run.css")
  ]);

  assert.match(page, /function executionCaseInstanceKey/);
  assert.match(page, /function buildExecutionCaseInstances/);
  assert.match(page, /resolvedRows\.length \? resolvedRows : \[null\]/);
  assert.match(page, /data_set_instances: buildExecutionCaseInstances\(snapshot, execution\)/);
  assert.match(page, /dataSetInstances\.map\(\(instance\) =>/);
  assert.match(page, /Object\.entries\(instance\.data_set_row_snapshot \|\| \{\}\)/);
  assert.match(page, /instanceDerivedStatus\(instance\)/);
  assert.match(page, /Active data row/);
  assert.match(styles, /\.execution-case-instance-scroll/);
  assert.match(styles, /\.execution-case-detail-instance-list/);
});

test("row selection is URL-stable and result reads and writes stay iteration scoped", async () => {
  const [page, api] = await Promise.all([
    readSource("../../frontend/pages/ExecutionsPage.tsx"),
    readApiSources()
  ]);

  assert.match(page, /searchParams\.get\("iteration"\)/);
  assert.match(page, /nextParams\.set\("iteration", caseInstanceKey\)/);
  assert.match(page, /resultByCaseInstanceKey/);
  assert.match(page, /executionResultMatchesCaseInstance\(item, targetInstance\)/);
  for (const field of [
    "test_data_set_id: targetInstance.test_data_set_id",
    "test_data_set_name: targetInstance.test_data_set_name",
    "data_set_iteration_index: targetInstance.data_set_iteration_index",
    "data_set_iteration_key: targetInstance.data_set_iteration_key",
    "data_set_row_snapshot: targetInstance.data_set_row_snapshot"
  ]) {
    assert.match(page, new RegExp(field.replace(/[.]/g, "\\.")));
  }
  assert.match(api, /runApiStep: \(executionId: string, testCaseId: string, stepId: string, input\?: \{ data_set_iteration_index\?: number \}\)/);
  assert.match(api, /body: JSON\.stringify\(input \|\| \{\}\)/);
  assert.match(page, /dataSetIterationIndex: selectedExecutionCaseInstance\?\.data_set_iteration_index/);
});

test("run progress and hierarchy metrics count case instances instead of collapsing by case id", async () => {
  const page = await readSource("../../frontend/pages/ExecutionsPage.tsx");

  assert.match(page, /function executionExpectedOutcomeCount/);
  assert.match(page, /execution\.case_snapshots\.reduce\([\s\S]*buildExecutionCaseInstances\(snapshot, execution\)\.length/);
  assert.match(page, /executionCaseOrder\.flatMap\(\(testCase\) => testCase\.data_set_instances\)/);
  assert.match(page, /const scopedInstances = scopedCases\.flatMap\(\(testCase\) => testCase\.data_set_instances\)/);
  assert.match(page, /const moduleInstances = module\.cases\.flatMap\(\(testCase\) => testCase\.data_set_instances\)/);
  assert.match(page, /executionExpectedOutcomeCount\(execution\)/);
});
