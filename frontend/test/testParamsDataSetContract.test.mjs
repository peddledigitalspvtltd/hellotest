import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildDataSetParameterDefinitions,
  buildDataSetParameterValues,
  combineStepParameterValues,
  mergeStepParameterDefinitions,
  resolveStepParameterText
} from "../src/lib/stepParameters.ts";
import { selectLatestExecutionResultInstances } from "../src/lib/executionResultMetrics.ts";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

test("linked table Data Sets expose every declared first-row column as immutable Test Params", () => {
  const dataSet = deepFreeze({
    id: "data-set-1",
    name: "Login users",
    description: null,
    mode: "table",
    columns: ["username", "password", "role", "tenant", "region"],
    rows: [
      { username: "Jay", password: "secret", role: "admin", tenant: "QAIra" },
      { username: "Maya", password: "other", role: "viewer", tenant: "HelloTest", region: "west" }
    ]
  });
  const original = structuredClone(dataSet);

  assert.deepEqual(buildDataSetParameterValues(dataSet), {
    "t.username": "Jay",
    "t.password": "secret",
    "t.role": "admin",
    "t.tenant": "QAIra",
    "t.region": ""
  });
  assert.deepEqual(
    buildDataSetParameterDefinitions(dataSet, dataSet.name).map((parameter) => parameter.name),
    ["t.username", "t.password", "t.role", "t.tenant", "t.region"]
  );
  assert.deepEqual(dataSet, original, "building case-level Test Params must not mutate reusable Data Set rows");
});

test("case Test Param overrides resolve saved step references without changing Data Set defaults", () => {
  const source = deepFreeze({
    id: "data-set-1",
    name: "Login users",
    description: null,
    mode: "table",
    columns: ["username", "password"],
    rows: [{ username: "source-user", password: "source-password" }]
  });
  const original = structuredClone(source);
  const instanceValues = combineStepParameterValues(
    buildDataSetParameterValues(source),
    { "t.username": "Jay" }
  );

  assert.equal(instanceValues["t.username"], "Jay");
  assert.equal(instanceValues["t.password"], "source-password");
  assert.equal(resolveStepParameterText("Login and enter @t.username", instanceValues), "Login and enter Jay");
  assert.deepEqual(source, original);
});

test("linked Data Set definitions are unioned with authored Test Params without duplicate fields", () => {
  const dataSetDefinitions = buildDataSetParameterDefinitions({
    mode: "table",
    columns: ["username", "role"],
    rows: [{ username: "Jay", role: "admin" }]
  }, "Login users");
  const definitions = mergeStepParameterDefinitions([
    {
      name: "t.username",
      rawName: "username",
      label: "username",
      token: "@t.username",
      scope: "t",
      scopeLabel: "Test case",
      stepIds: ["step-1"],
      occurrenceCount: 1,
      source: "authoring"
    }
  ], dataSetDefinitions);

  assert.deepEqual(definitions.map((definition) => definition.name), ["t.role", "t.username"]);
  assert.equal(definitions.find((definition) => definition.name === "t.username")?.occurrenceCount, 1);
  assert.equal(definitions.find((definition) => definition.name === "t.username")?.sourceLabel, "Login users");
});

test("Test Case authoring names case-level values Test Params and merges linked Data Set defaults before overrides", async () => {
  const [page, dialog, linkedModal, versionHistory, styles] = await Promise.all([
    readSource("../src/pages/TestCasesPage.tsx"),
    readSource("../src/components/StepParameterDialog.tsx"),
    readSource("../src/components/LinkedTestCaseModal.tsx"),
    readSource("../src/components/TestCaseVersionHistory.tsx"),
    readSource("../src/styles.css")
  ]);

  assert.match(page, /buildDataSetParameterValues\(linkedDataSet/);
  assert.match(page, /combineStepParameterValues\(\s*linkedDataSetDefaultParameterValues,\s*testCaseParameterValues/);
  assert.match(page, /mergeStepParameterDefinitions\([\s\S]*linkedDataSetParameterDefinitions/);
  assert.match(page, /parameter_values: testCaseParameterValues/);
  assert.doesNotMatch(page, /parameter_values: effectiveTestCaseParameterValues/);
  assert.match(page, /parameterPreviewScopeKey/);
  assert.match(page, /Test Params · \$\{[^}]+\}/);
  assert.match(page, /title="Test Params"/);
  assert.match(page, />Manage Test Params</);
  assert.match(page, /label: "Test Params"/);
  assert.match(dialog, /Inherited from \$\{parameter\.sourceLabel\}/);
  assert.match(dialog, /Resolved preview/);
  assert.match(dialog, /Reset to Data Set value/);
  assert.match(dialog, /<TestDataIcon size=\{17\}/);
  assert.match(dialog, /aria-label=\{`Data utility for \$\{parameter\.token\}`\}/);
  assert.match(dialog, /<optgroup label="Data utilities">/);
  assert.match(dialog, /Create custom utility…/);
  assert.doesNotMatch(dialog, /StepParameterUtilityIcon/);
  assert.match(dialog, /scopeLabels\?\.\[parameter\.scope\] \|\| parameter\.scopeLabel/);
  assert.match(linkedModal, /buildDataSetParameterValues/);
  assert.match(linkedModal, /title="Test Params"/);
  assert.match(linkedModal, /parameterValues=\{resolvedParameterValues\}/);
  assert.match(versionHistory, /label: "Test Params"/);
  for (const className of [
    "step-parameter-row-meta",
    "step-parameter-mode-badge",
    "step-parameter-source-badge",
    "step-parameter-resolved-preview",
    "step-parameter-reset-button"
  ]) {
    assert.match(styles, new RegExp(`\\.${className}`));
  }
});

test("row-level results remain separate test instances for the same Test Case", () => {
  const base = {
    execution_id: "run-1",
    test_case_id: "case-1",
    app_type_id: "web",
    duration_ms: null,
    error: null,
    logs: null,
    executed_by: null
  };
  const latest = selectLatestExecutionResultInstances([
    {
      ...base,
      id: "result-row-1-old",
      status: "running",
      data_set_iteration_index: 0,
      data_set_iteration_key: "data-set-1:1",
      data_set_row_snapshot: { username: "Jay" },
      created_at: "2026-08-28T09:00:00.000Z"
    },
    {
      ...base,
      id: "result-row-1-new",
      status: "passed",
      data_set_iteration_index: 0,
      data_set_iteration_key: "data-set-1:1",
      data_set_row_snapshot: { username: "Jay" },
      created_at: "2026-08-28T09:01:00.000Z"
    },
    {
      ...base,
      id: "result-row-2",
      status: "failed",
      data_set_iteration_index: 1,
      data_set_iteration_key: "data-set-1:2",
      data_set_row_snapshot: { username: "Maya" },
      created_at: "2026-08-28T09:00:30.000Z"
    }
  ]);

  assert.equal(latest.length, 2);
  assert.deepEqual(
    latest.map((result) => [result.data_set_iteration_key, result.status, result.data_set_row_snapshot?.username]),
    [
      ["data-set-1:1", "passed", "Jay"],
      ["data-set-1:2", "failed", "Maya"]
    ]
  );
});
