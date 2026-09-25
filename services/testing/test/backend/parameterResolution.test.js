const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtemp, readFile, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { stripTypeScriptTypes } = require("node:module");
const { normalizeParameterKey, resolveParameterLayers, collectPriorParameterCaptures } = require("../../../platform/backend/src/utils/stepParameterResolution");
const { materializeVariableSnapshot, materializeDataSetSnapshot, freezeReferencedParameterGenerators, materializeParameterValues } = require("../../../platform/backend/src/utils/testDataGenerators");

test("canonical scope precedence preserves blanks, missing cells and quoted column names", () => {
  assert.equal(normalizeParameterKey("@T.[First Name]", "s"), "t.first name");
  assert.equal(normalizeParameterKey("account.email", "s"), "s.account.email");
  const layers = { caseValues: { "t.email": "case", "t.missing": "default" }, suiteValues: { "t.email": "suite override", email: "suite value" }, environmentVariables: [{ key: "t.email", value: "env" }], configurationVariables: [{ key: "t.email", value: "config" }], runValues: { "t.email": "run" }, dataSet: { mode: "table", columns: ["email", "missing"], rows: [{ email: "first" }, { "@t.[email]": "", "s.email": "row", "r.[Build Number]": "42" }] }, rowIndex: 1 };
  assert.deepEqual(resolveParameterLayers(layers), { "t.email": "", "t.missing": "default", "s.email": "row", "r.build number": "42" });
  assert.equal(resolveParameterLayers({ ...layers, capturedValues: { "@t.email": "captured" } })["t.email"], "captured");
  assert.equal(resolveParameterLayers({ ...layers, dataSet: null })["t.email"], "run");
});

test("only prior run and same-suite captures propagate; case values and other iterations never leak", () => {
  const snapshots = [{ test_case_id: "z", suite_id: "suite", sort_order: 1 }, { test_case_id: "a", suite_id: "other", sort_order: 2 }, { test_case_id: "current", suite_id: "suite", sort_order: 3 }, { test_case_id: "later", suite_id: "suite", sort_order: 4 }];
  const captures = { z: { "t.local": "never", "@s.[Token]": "suite", "r.token": "first" }, a: { "s.token": "other-suite", "r.token": "second" }, current: { "s.token": "other-data-row", "r.token": "current" }, later: { "r.token": "future" } };
  assert.deepEqual(collectPriorParameterCaptures(snapshots, "current", captures), { "s.token": "suite", "r.token": "second" });
  assert.deepEqual(collectPriorParameterCaptures(snapshots.map((item) => ({ ...item, suite_id: null })), "current", captures), { "r.token": "second" });
});

test("API dispatch and web/mobile engine initial context agree on selected data and frozen literals", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "parameter-runtime-parity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "package.json"), '{"type":"module"}');
  for (const name of ["runtimeContext", "stepParameterReferences"]) {
    const source = await readFile(path.join(__dirname, `../../../../testengine/backend/src/lib/${name}.ts`), "utf8");
    await writeFile(path.join(directory, `${name}.js`), stripTypeScriptTypes(source));
  }
  const { buildInitialContext, interpolateText } = await import(pathToFileURL(path.join(directory, "runtimeContext.js")));
  const envelope = { parameters_frozen: true, case_parameters: { "@t.[First Name]": "case", "t.random": "", "t.literal": "{{randomString:8}}" }, suite_parameters: { "t.[First Name]": "suite", tenant: "suite namespace" }, environment: { variables: [{ key: "t.[First Name]", value: "environment" }] }, configuration: { variables: [{ key: "t.[First Name]", value: "configuration" }] }, run_parameters: { "t.[First Name]": "run" }, data_set: { source: "test_case", mode: "table", rows: [{ "t.[First Name]": "", "s.tenant": "row suite", "r.build": "123" }] } };
  const expected = resolveParameterLayers({ caseValues: envelope.case_parameters, suiteValues: envelope.suite_parameters, environmentVariables: envelope.environment.variables, configurationVariables: envelope.configuration.variables, runValues: envelope.run_parameters, dataSet: envelope.data_set });
  const actual = buildInitialContext(envelope);
  for (const [name, value] of Object.entries(expected)) assert.equal(actual.values[name], value, name);
  assert.equal(interpolateText("@t.[First Name]|@s.tenant|@r.build|@t.random|@t.literal", actual), "|row suite|123||{{randomString:8}}");
  const groupEnvelope = { parameters_frozen: true, data_set: { mode: 'table', rows: [{ login: 'case' }], shared_rows: [{}] } };
  for (const login of ['first-group', 'second-group']) {
    const step = { group_kind: 'reusable', shared_parameter_values: { login } };
    const resolved = buildInitialContext(groupEnvelope, {}, step);
    assert.equal(resolved.values['r.login'], login);
    assert.equal(buildInitialContext(groupEnvelope, { login: 'captured' }, step).values['r.login'], 'captured');
  }
  assert.equal(buildInitialContext(groupEnvelope).values['r.login'], 'case');
  const { composeScopedTestData } = require('../../../platform/backend/src/utils/scopedTestData');
  for (const override of [false, true]) {
    const selected = composeScopedTestData({ hierarchical: true,
      caseData: {mode:'table',rows:[{'r.login':'case','t.input':'case'}]},
      suiteData: {mode:'table',rows:[{'s.tenant':'suite'}]},
      runData: {mode:'table',rows:[{'r.login':'run','t.input':'run','s.tenant':'run'}]},
      caseOptions:{override_shared_steps:false},runOptions:{override_test_case_data:override,override_suite_data:override,override_shared_steps:override},sharedNames:new Set(['r.login']) }).snapshot;
    const step={group_kind:'reusable',shared_parameter_values:{login:'group'}};
    const current={parameters_frozen:true,data_set:selected,data_policy:selected.data_scope_policy,case_parameters:{'t.default':'case'},suite_parameters:{'s.default':'suite'},run_parameters:{'t.default':'run','s.default':'run'}};
    const expected=resolveParameterLayers({dataSet:selected,sharedValues:step.shared_parameter_values,isSharedStep:true,caseValues:current.case_parameters,suiteValues:current.suite_parameters,runValues:current.run_parameters});
    const actual=buildInitialContext(current,{},step).values;
    for(const [key,value] of Object.entries(expected)) assert.equal(actual[key],value,key);
  }


});

test("environment and case generators freeze once and reruns materialize preserved templates", () => {
  const now = new Date("2026-09-10T01:00:00Z");
  const source = { variables: [{ key: "r.date", value: "{{date:ISO}}" }, { key: "r.secret", value: "private", is_secret: true }] };
  const frozen = materializeVariableSnapshot(source, now);
  assert.equal(frozen.variables[0].value, now.toISOString());
  assert.equal(source.variables[0].value, "{{date:ISO}}");
  const rerun = materializeVariableSnapshot(frozen, new Date("2026-09-11T01:00:00Z"));
  assert.equal(rerun.variables[0].value, "2026-09-11T01:00:00.000Z");
  assert.deepEqual(frozen.template_variables, source.variables);
  const parameters = freezeReferencedParameterGenerators({ parameter_values: { "t.random": "" }, parameter_template_values: { "t.random": "" }, test_case_title: "Checkout @t.today" }, [{ action: "Use @random and @t.randomNumber" }], now);
  assert.equal(parameters.parameter_values["t.random"], "");
  assert.equal(parameters.parameter_values["t.today"], "2026-09-10");
  assert.match(parameters.parameter_values["t.randomnumber"], /^\d{6}$/);
  assert.equal(materializeParameterValues(parameters.parameter_template_values, new Date("2026-09-11"))["t.today"], "2026-09-11");
  const data = materializeDataSetSnapshot({ mode: "table", columns: ["stamp"], rows: [{ stamp: "{{date:ISO}}" }] }, now);
  assert.equal(resolveParameterLayers({ dataSet: data })["r.stamp"], now.toISOString());
});

test("public run snapshots redact secret values and templates in nested and raw aliases", async (context) => {
  const db = require("../../../platform/backend/src/db");
  const execution = require("../../backend/services/execution.service");
  const row = { id: "secret-context-run", project_id: "project", status: "queued", assigned_to_ids: [],
    test_environment_id: "env", test_environment_name: "Environment", test_environment_snapshot: { variables: [{ key: "token", value: "private-environment-value", is_secret: true }], template_variables: [{ key: "token", value: "private-environment-template", is_secret: true }] },
    test_configuration_id: "config", test_configuration_name: "Configuration", test_configuration_snapshot: { variables: [{ key: "token", value: "private-config-value", is_secret: true }], template_variables: [{ key: "token", value: "private-config-template", is_secret: true }] },
    test_data_set_id: "data", test_data_set_name: "Data", test_data_set_snapshot: { mode: "key_value", rows: [{ key: "token", value: "private-data-value", is_secret: true }], template_rows: [{ key: "token", value: "private-data-template", is_secret: true }] } };
  context.mock.method(db.pool, "query", async (statement) => ({ rows: /SELECT \*\s+FROM executions/.test(statement.text || statement) ? [row] : [], rowCount: 1 }));
  const response = await execution.getExecution(row.id, true);
  assert.doesNotMatch(JSON.stringify(response), /private-(?:environment|config|data)-(?:value|template)/);
  assert.equal(response.test_environment.snapshot.variables[0].is_secret, true);
  assert.equal(response.test_data_set.snapshot.rows[0].value, "");
});


test('rerun regenerates a shared group template once for all its steps, preserving different frozen definitions', () => {
  const { regenerateSharedStepData, redactSharedStepData } = require('../../backend/services/sharedStepDataSnapshot.service');
  const steps = [1,2,3].map(index => ({snapshot_step_id:String(index),reusable_group_id:'login',shared_parameter_template_values:{token:'{{randomString:24}}'},shared_parameter_sensitive_names:['r.token']}));
  const rerun = regenerateSharedStepData(steps);
  assert.equal(new Set(rerun.map(step=>step.shared_parameter_values.token)).size,1);
  assert.match(rerun[0].shared_parameter_values.token,/^[A-Za-z0-9]{24}$/);
  assert.deepEqual(redactSharedStepData(rerun[0]).shared_parameter_values,{});
  assert.equal(steps[0].shared_parameter_template_values.token,'{{randomString:24}}');
});
