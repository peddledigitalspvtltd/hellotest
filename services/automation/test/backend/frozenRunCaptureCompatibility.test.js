const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, readFile, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { stripTypeScriptTypes } = require("node:module");
const { normalizeFrozenCapturedValues, preserveFrozenEngineEnvelope } = require("../../../platform/backend/src/utils/frozenRunParameterCompatibility");
const { collectPriorParameterCaptures, resolveParameterLayers, normalizeParameterLayer, matchesParameterIteration } = require("../../../platform/backend/src/utils/stepParameterResolution");
const runtime = require("../../../platform/backend/src/domain/executionStepEvidence");
const obsDb = require("../../../platform/backend/src/obsDb");
const dispatch = require("../../backend/services/testEngineDispatch.service");

test("legacy raw captures remain private while explicit suite/run exports retain their scopes", () => {
  const logs = { stepCaptures: { login: { token: "private", "@s.[Session Id]": "suite", "r.trace": "run" } } };
  const before = structuredClone(logs);
  const captured = normalizeFrozenCapturedValues(runtime.extractCapturedValuesFromLogs(logs), "t");
  assert.deepEqual(captured, { "t.token": "private", "s.session id": "suite", "r.trace": "run" });
  assert.equal(resolveParameterLayers({ capturedValues: captured })["t.token"], "private");
  const snapshots = [{ test_case_id: "login", sort_order: 0, suite_id: "suite-1" }, { test_case_id: "checkout", sort_order: 1, suite_id: "suite-1" }];
  assert.deepEqual(collectPriorParameterCaptures(snapshots, "checkout", { login: captured }), { "s.session id": "suite", "r.trace": "run" });
  assert.deepEqual(collectPriorParameterCaptures([{ ...snapshots[0], suite_id: "other-suite" }, snapshots[1]], "checkout", { login: captured }), { "r.trace": "run" });
  assert.deepEqual(logs, before);
  assert.deepEqual(normalizeFrozenCapturedValues({ "t.token": "new", token: "old" }, "t"), { "t.token": "new" });
  assert.deepEqual(normalizeFrozenCapturedValues({ token: "new-run-export" }, "r"), { "r.token": "new-run-export" });
});

test("a persisted legacy queue job resumes with the same test-local values in API and web/mobile runtimes", async (context) => {
  const row = { id: "old-job", execution_id: "legacy-run", execution_parameter_scope_default: "t",
    payload: { parameters_frozen: true, case_parameters: { token: "case default" },
      data_set: { id: "customers", mode: "table", columns: ["email"], rows: [{ email: "selected row" }], iteration: { index: 1 } },
      steps: [{ id: "read", action: "Given @token for @email", api_request: { url: "https://example.test/@token", captures: [{ parameter: "nextToken" }] } }],
      manual_spec: { test_data: { token: "case default" }, steps: ["Given @token"], detailed_steps: [] } },
    runtime_state: { captured_values: { token: "saved session" }, logs: { stepCaptures: { login: { token: "saved session" } } } } };
  const before = structuredClone(row);
  context.mock.method(obsDb.pool, "query", async (statement) => {
    assert.match(statement.text || statement, /executions\.parameter_scope_default/);
    return { rows: [row], rowCount: 1 };
  });
  const job = await dispatch.getQueuedJob(row.id);
  assert.equal(job.payload.steps[0].action, "Given @t.token for @t.email");
  assert.equal(job.payload.steps[0].api_request.captures[0].parameter, "@t.nexttoken");
  assert.deepEqual(job.runtime_state.captured_values, { "t.token": "saved session" });
  const directory = await mkdtemp(path.join(tmpdir(), "legacy-capture-parity-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "package.json"), '{"type":"module"}');
  for (const name of ["runtimeContext", "stepParameterReferences"]) {
    const source = await readFile(path.join(__dirname, `../../../../testengine/backend/src/lib/${name}.ts`), "utf8");
    await writeFile(path.join(directory, `${name}.js`), stripTypeScriptTypes(source));
  }
  const { buildInitialContext, interpolateText } = await import(pathToFileURL(path.join(directory, "runtimeContext.js")));
  const engine = buildInitialContext(job.payload, job.runtime_state.captured_values);
  const api = resolveParameterLayers({ caseValues: job.payload.case_parameters, dataSet: job.payload.data_set, capturedValues: job.runtime_state.captured_values });
  assert.equal(api["t.token"], "saved session");
  assert.equal(engine.values["t.token"], api["t.token"]);
  assert.equal(interpolateText(job.payload.steps[0].action, engine), "Given saved session for selected row");
  assert.equal(engine.values["r.token"], undefined, "A legacy session token is not promoted into the run namespace.");
  assert.deepEqual(row, before, "Frozen persisted payload and logs remain unchanged.");
  assert.deepEqual(preserveFrozenEngineEnvelope(job.payload, "t"), job.payload);

  const dispatchSource = await readFile(path.join(__dirname, '../../backend/services/testEngineDispatch.service.js'), 'utf8');
  const functionSource = dispatchSource.slice(dispatchSource.indexOf('const buildRuntimeParameterValues ='), dispatchSource.indexOf('const resultStatusToJobStatus ='));
  const apiParameters = new Function('resolveParameterLayers', 'normalizeParameterLayer', 'normalizeFrozenCapturedValues', `${functionSource}\nreturn buildRuntimeParameterValues;`)(resolveParameterLayers, normalizeParameterLayer, normalizeFrozenCapturedValues);
  const hook = { group_kind: 'reusable', shared_parameter_values: { 't.shared': 'shared default' }, source_case_parameters: { token: 'hook default', 't.email': 'hook email' } };
  for (const dataPolicy of [undefined, { version: 2, case: {}, suite: {}, run: {} }]) {
    const envelope = { ...job.payload, data_policy: dataPolicy };
    const native = buildInitialContext(envelope, job.runtime_state.captured_values, hook);
    const apiHook = apiParameters(envelope, job.runtime_state.captured_values, hook);
    assert.equal(apiHook['t.email'], 'hook email', 'The saved hook source owns its test data.');
    assert.equal(apiHook['t.shared'], 'shared default');
    assert.equal(apiHook['t.token'], 'saved session', 'Captured setup values override source defaults.');
    for (const key of ['t.email', 't.shared', 't.token']) assert.equal(apiHook[key], native.values[key], key);
  }

  const sourceContext={case_parameters:{'t.email':'source authored','t.blank':''},suite_parameters:{'s.region':'source suite'},
    data_policy:{version:2,case:{parameter_overrides:['t.blank']},suite:{},run:{}},
    data_set:{mode:'table',rows:[{'t.email':'source dataset','t.blank':'dataset must lose'}],parameter_data_layers:{case:{rows:[{'t.email':'source dataset','t.blank':'dataset must lose'}]}}}};
  const sourceStep={...hook,source_case_parameters:{'t.email':'legacy value must lose'},source_case_context:sourceContext};
  const mainEnvelope={...job.payload,case_parameters:{'t.email':'wrong main case','t.unrelated':'main only'},suite_parameters:{'s.region':'wrong main suite'},
    data_policy:{version:2,case:{},suite:{},run:{}},data_set:{mode:'table',rows:[{'t.email':'wrong main dataset'}],parameter_data_layers:{case:{rows:[{'t.email':'wrong main dataset'}]}}},
    environment:{variables:[{key:'r.environment',value:'shared environment'}]}};
  const sourceBefore=structuredClone(sourceStep),mainBefore=structuredClone(mainEnvelope);
  const sourceNative=buildInitialContext(mainEnvelope,{'r.captured':'setup output'},sourceStep).values;
  const sourceApi=apiParameters(mainEnvelope,{'r.captured':'setup output'},sourceStep);
  for(const values of [sourceNative,sourceApi]){
    assert.equal(values['t.email'],'source dataset');assert.equal(values['s.region'],'source suite');assert.equal(values['t.blank'],'');
    assert.equal(values['r.environment'],'shared environment');assert.equal(values['r.captured'],'setup output');assert.equal(values['t.unrelated'],undefined);
  }
  assert.deepEqual(sourceStep,sourceBefore);assert.deepEqual(mainEnvelope,mainBefore);
});

test("capture compatibility never changes selected dataset identity or row matching", () => {
  const iteration = { test_data_set_id: "customers", data_set_iteration_index: 1 };
  const envelope = preserveFrozenEngineEnvelope({ data_set: { id: "customers", mode: "table", columns: ["email"],
    rows: [{ email: "row1" }], iteration: { index: 1, key: "customer-two" } } }, "t");
  assert.equal(envelope.data_set.id, iteration.test_data_set_id);
  assert.equal(envelope.data_set.iteration.index, iteration.data_set_iteration_index);
  assert.equal(matchesParameterIteration(iteration, iteration), true);
  assert.equal(matchesParameterIteration({ ...iteration, data_set_iteration_index: 0 }, iteration), false);
  assert.equal(matchesParameterIteration({ ...iteration, test_data_set_id: "other" }, iteration), false);
  assert.equal(matchesParameterIteration({ test_data_set_id: null, data_set_iteration_index: null }, iteration), false);
});
