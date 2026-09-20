const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const { stripTypeScriptTypes } = require("node:module");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const test = require("node:test");

const {
  hasGeneratorTemplate,
  materializeDataSetSnapshot,
  materializeParameterValues,
  materializeTemplateValue
} = require("../src/utils/testDataGenerators");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

test("run snapshots materialize dynamic and static Test Params without mutating reusable source rows", () => {
  const source = deepFreeze({
    id: "data-set-1",
    name: "Login users",
    description: null,
    mode: "table",
    columns: ["username", "reference", "createdOn"],
    rows: [{
      username: "Jay",
      reference: "USER-{{randomNumber:6}}",
      createdOn: "{{date:YYYY-MM-DD}}"
    }]
  });
  const original = structuredClone(source);
  const now = new Date("2026-08-28T10:30:00.000Z");
  const snapshot = materializeDataSetSnapshot(source, now);

  assert.deepEqual(source, original);
  assert.notStrictEqual(snapshot, source);
  assert.notStrictEqual(snapshot.rows, source.rows);
  assert.deepEqual(snapshot.template_rows, source.rows);
  assert.equal(snapshot.rows[0].username, "Jay");
  assert.match(snapshot.rows[0].reference, /^USER-\d{6}$/);
  assert.equal(snapshot.rows[0].createdOn, "2026-08-28");
  assert.equal(snapshot.generated_field_count, 2);

  const parameterTemplates = deepFreeze({
    "t.username": "Jay",
    "t.reference": "CASE-{{randomString:8}}"
  });
  const parameterCopy = structuredClone(parameterTemplates);
  const parameters = materializeParameterValues(parameterTemplates, now);

  assert.deepEqual(parameterTemplates, parameterCopy);
  assert.equal(parameters["t.username"], "Jay");
  assert.match(parameters["t.reference"], /^CASE-[A-Za-z0-9]{8}$/);
});

test("reviewed one-of Data Set utilities resolve at runtime instead of leaking template syntax", () => {
  const candidates = ["Jay", "Maya", "Priya"];
  const encoded = Buffer.from(JSON.stringify(candidates), "utf8").toString("base64url");
  const template = `{{oneOf:${encoded}}}`;

  assert.equal(hasGeneratorTemplate(template), true);
  assert.ok(candidates.includes(materializeTemplateValue(template)));
});

test("selected data rows consistently override case defaults regardless of attachment source", async (t) => {
  // Exercise current TypeScript sources with the same .js import layout as the
  // built engine, without depending on or modifying generated dist artifacts.
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "hellotest-case-parameters-"));
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  await writeFile(path.join(temporaryDirectory, "package.json"), '{"type":"module"}');
  await Promise.all(["runtimeContext", "stepParameterReferences"].map(async (name) => {
    const source = await readSource(`../../../testengine/backend/src/lib/${name}.ts`);
    await writeFile(path.join(temporaryDirectory, `${name}.js`), stripTypeScriptTypes(source));
  }));
  const runtime = await import(pathToFileURL(path.join(temporaryDirectory, "runtimeContext.js")).href);
  const dataSet = deepFreeze({
    id: "data-set-1",
    name: "Login users",
    source: "test_case",
    mode: "table",
    columns: ["username", "password"],
    rows: [{ username: "source-user", password: "source-password" }]
  });
  const original = structuredClone(dataSet);
  const context = runtime.buildInitialContext({
    suite_parameters: {},
    case_parameters: { username: "Jay" },
    manual_spec: { test_data: {} },
    environment: null,
    configuration: null,
    data_set: dataSet
  });

  assert.equal(context.values["r.username"], "source-user");
  assert.equal(context.values["r.password"], "source-password");
  assert.equal(runtime.interpolateText("Login and enter @username", context), "Login and enter source-user");
  assert.deepEqual(dataSet, original);

  const explicitRunContext = runtime.buildInitialContext({
    suite_parameters: {},
    case_parameters: { username: "Jay" },
    manual_spec: { test_data: {} },
    environment: null,
    configuration: null,
    data_set: { ...dataSet, source: "run" }
  });
  assert.equal(explicitRunContext.values["r.username"], "source-user");
});

test("dispatch expands each Test Case by its own associated Data Set rows and snapshots each result row", async () => {
  const [schema, bootstrap, execution, dispatch, callback, openapi, engineContract] = await Promise.all([
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js"),
    readSource("../src/services/execution.service.js"),
    readSource("../src/services/testEngineDispatch.service.js"),
    readSource("../src/services/testEngineCallback.service.js"),
    readSource("../../../openapi.yaml"),
    readSource("../../../testengine/backend/src/contracts/hellotest.ts")
  ]);
  const caseLoopStart = dispatch.indexOf("for (const caseSnapshot of execution.case_snapshots || [])");
  const caseLoopEnd = dispatch.indexOf("\n  return {\n    execution,", caseLoopStart);
  const caseLoop = dispatch.slice(caseLoopStart, caseLoopEnd);

  assert.ok(caseLoopStart >= 0 && caseLoopEnd > caseLoopStart);
  assert.match(schema, /execution_case_snapshots[\s\S]*test_data_set_id/);
  assert.match(schema, /execution_case_snapshots[\s\S]*test_data_set_snapshot/);
  assert.match(schema, /data_set_source TEXT CHECK\(data_set_source IS NULL OR data_set_source IN \('run','suite','test_case'\)\)/);
  assert.match(bootstrap, /execution_case_snapshots_data_set_source_check/);
  assert.match(execution, /test_case_data_sets/);
  assert.match(execution, /attachCaseDataSetSnapshots/);
  assert.match(execution, /composeScopedTestData\(\{ hierarchical: true/);
  assert.match(execution, /data_set_source: effective\.source/);
  assert.match(execution, /materializeDataSetSnapshot/);
  assert.match(caseLoop, /resolveExecutionDataSetIterations/);
  assert.match(caseLoop, /for \(const dataSetIteration of dataSetIterations\)/);
  assert.match(dispatch, /source: caseDataSet\.source/);
  assert.match(dispatch, /resolveParameterLayers\(/);
  assert.match(dispatch, /data_set_iteration: dataSetIteration/);
  assert.match(dispatch, /data_set_row_snapshot: rowSnapshot/);
  assert.match(callback, /resolveCaseDataSetContext\(execution, caseSnapshot\)/);
  assert.match(callback, /requiredCases\.flatMap/);
  assert.match(callback, /test_data_set_id: caseDataSet\?\.id/);
  assert.match(openapi, /data_set_source: \{ type: string, nullable: true, enum: \[run, suite, test_case\] \}/);
  assert.match(engineContract, /source\?: "run" \| "suite" \| "test_case"/);
});

test("manual API-step execution selects and persists the requested frozen Data Set row", async () => {
  const [routes, execution, dispatch, openapi] = await Promise.all([
    readSource("../src/routes/executions.routes.js"),
    readSource("../src/services/execution.service.js"),
    readSource("../src/services/testEngineDispatch.service.js"),
    readSource("../../../openapi.yaml")
  ]);

  assert.match(routes, /data_set_iteration_index: \{ required: false, type: "number" \}/);
  assert.match(routes, /data_set_iteration_index: req\.body\?\.data_set_iteration_index/);
  assert.match(execution, /resolveExecutionCaseDataSetIteration/);
  assert.match(execution, /Data Set iteration index must be a non-negative integer/);
  assert.match(execution, /Data Set iteration \$\{index \+ 1\} is outside the frozen \$\{total\}-row snapshot/);
  assert.match(execution, /rowIndex: Number\.isInteger\(dataSetIterationIndex\) \? dataSetIterationIndex : 0/);
  assert.match(execution, /findLatestExecutionResult\(\{[\s\S]*data_set_iteration_index: dataSetIteration\.result_metadata\.data_set_iteration_index/);
  assert.match(execution, /dataSetIteration: dataSetIteration\.engine_iteration/);
  assert.ok((execution.match(/\.\.\.dataSetIteration\.result_metadata/g) || []).length >= 4);
  assert.match(dispatch, /existingLogs = null,[\s\S]*dataSetIteration = null/);
  assert.match(dispatch, /objectRepository,[\s\S]*dataSetIteration/);
  assert.match(openapi, /data_set_iteration_index: \{ type: integer, minimum: 0, nullable: true \}/);
});
