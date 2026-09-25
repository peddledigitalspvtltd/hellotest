import { sourceFile } from "./helpers/sourceFile.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const modules = {};
function load(name) {
  if (modules[name]) return modules[name];
  const exports = modules[name] = {};
  const source = readFileSync(sourceFile(`${name}.ts`, "lib"), "utf8");
  const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "exports", script)(id => load(id.replace(/^\.\//, "")), exports);
  return exports;
}
const { dataOverrideEnabled, missingDataSetParameters } = load("dataSetValidation");
const require = createRequire(import.meta.url);
const { normalizeDataOptions } = require("../../backend/src/utils/scopedTestData.js");
const required = (...names) => names.map(name => ({ name }));

test("dataset links match canonical scoped and quoted names without requiring nonempty cells", () => {
  const dataset = { mode: "table", columns: [" @R.Email ", "@S.[Tenant Name]", "t.[Customer\\] ID]", "t.Expected"],
    rows: [{ " @R.Email ": "", "@S.[Tenant Name]": "", "t.[Customer\\] ID]": "", "t.Expected": "" }] };
  const before = structuredClone(dataset);
  assert.deepEqual(missingDataSetParameters(dataset, required("email", "r.EMAIL", "s.tenant name", "t.customer] id", "@T.EXPECTED")), []);
  assert.deepEqual(dataset, before);
});

test("namespaces remain distinct and missing parameters are sorted and deduplicated", () => {
  assert.deepEqual(missingDataSetParameters({ mode: "table", columns: ["email", "s.email"], rows: [{ email: "value", "t.email": "undeclared" }] },
    required("@t.Email", "t.email", "r.email", "s.email", " t.[Postal Code] ", "", " ")), ["t.email", "t.postal code"]);
});

test("key/value sets use parameter keys rather than table columns or values", () => {
  const dataset = { mode: "key_value", columns: ["t.not-declared"], rows: [
    { key: "@R.User", value: "t.not-declared" }, { key: "@s.[Tenant Name]", value: "" },
    { key: "token", value: "", is_secret: true, has_stored_value: true }, { key: "", value: "t.not-declared" }
  ] };
  assert.deepEqual(missingDataSetParameters(dataset, required("r.user", "s.tenant name", "r.token", "t.not-declared")), ["t.not-declared"]);
});

test("empty requirements need no columns while absent declarations remain visible", () => {
  assert.deepEqual(missingDataSetParameters({ mode: "table", columns: [], rows: [] }, []), []);
  assert.deepEqual(missingDataSetParameters({ mode: "table", columns: [], rows: [] }, required("t.user", "r.build")), ["r.build", "t.user"]);
  // The API separately rejects zero rows even when declared headers match.
  assert.deepEqual(missingDataSetParameters({ mode: "table", columns: ["r.build"], rows: [] }, required("build")), []);
});

test("legacy preferences seed both lower-layer checkboxes and leave shared override independent", () => {
  const values = options => ["case", "suite", "shared"].map(layer => dataOverrideEnabled(options, layer));
  assert.deepEqual(values({}), [true, true, true]);
  assert.deepEqual(values({ override_lower_scopes: false }), [false, false, true]);
  assert.deepEqual(values({ override_lower_scopes: false, override_test_case_data: true, override_shared_steps: false }), [true, false, false]);
  assert.deepEqual(values({ override_lower_scopes: true, override_suite_data: false }), [true, false, true]);
});

test("independent overrides match backend policies despite contradictory legacy flags", () => {
  for (const legacy of [undefined, false, true]) for (const caseFlag of [false, true]) for (const suiteFlag of [false, true]) for (const sharedFlag of [false, true]) {
    const options = { override_lower_scopes: legacy, override_test_case_data: caseFlag, override_suite_data: suiteFlag, override_shared_steps: sharedFlag };
    const before = structuredClone(options);
    const persisted = normalizeDataOptions(options);
    assert.equal(dataOverrideEnabled(options, "case"), persisted.override_test_case_data);
    assert.equal(dataOverrideEnabled(options, "suite"), persisted.override_suite_data);
    assert.equal(dataOverrideEnabled(options, "shared"), persisted.override_shared_steps);
    assert.deepEqual(options, before);
  }
});
