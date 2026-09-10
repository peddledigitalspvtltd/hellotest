import assert from "node:assert/strict";
import test from "node:test";
import { resolveGherkinParameterText, tokenizeGherkinInlineText } from "../src/lib/gherkin.ts";
import {
  buildDataSetParameterDefinitions,
  buildDataSetParameterValues,
  buildStepParameterDefinitionsFromValues,
  collectStepParameters,
  excludeSensitiveStepParameterValues,
  filterStepParameterValuesByScope,
  getStepParameterQuery,
  getStepParameterSuggestions,
  insertStepParameterReference,
  mergeStepParameterDefinitions,
  normalizeStepParameterName,
  resolveStepParameterText
} from "../src/lib/stepParameters.ts";

test("scoped completion opens after @t., @s., and @r. and filters within the selected scope", () => {
  const parameters = buildStepParameterDefinitionsFromValues({ "t.email": "customer", "s.email": "suite", "r.build": "12", "t.owner_email": "owner" });
  for (const [scope, expected] of [["t", ["t.email", "t.owner_email"]], ["s", ["s.email"]], ["r", ["r.build"]]]) {
    const text = `Given the value is @${scope}.`;
    const query = getStepParameterQuery(text, text.length);
    assert.equal(query.scope, scope);
    assert.deepEqual(getStepParameterSuggestions(parameters, query).map((item) => item.name), expected);
  }
  assert.deepEqual(getStepParameterSuggestions(parameters, getStepParameterQuery("@T.EM", 5)).map((item) => item.name), ["t.email", "t.owner_email"]);
});

test("ordinary text, email addresses, non-collapsed selections, and unscoped tags do not trigger completion", () => {
  for (const text of ["user@t.email", "Given @smoke", "Given @t.email ", "Given t.", "@@s.value"]) {
    assert.equal(getStepParameterQuery(text, text.length), null, text);
  }
  assert.equal(getStepParameterQuery("@t.email", 3, 8), null);
  assert.equal(getStepParameterQuery("@t.email", -1), null);
});

test("completion at the middle of a reference replaces its suffix without changing surrounding prose", () => {
  const source = 'Given "@t.username" belongs to @s.tenant';
  const caret = source.indexOf("username") + 2;
  const query = getStepParameterQuery(source, caret);
  const { value, caret: nextCaret } = insertStepParameterReference(source, query, { token: "@t.user_id" });
  assert.equal(value, 'Given "@t.user_id" belongs to @s.tenant');
  assert.equal(value.slice(0, nextCaret), 'Given "@t.user_id');
  assert.equal(source, 'Given "@t.username" belongs to @s.tenant');
});

test("all linked columns and saved unused scope defaults are available before their first reference", () => {
  const dataSet = { mode: "table", columns: ["email", "region"], rows: [{ email: "first" }, { email: "second", undeclared: "late" }] };
  const parameters = mergeStepParameterDefinitions(buildDataSetParameterDefinitions(dataSet, "Customers"), buildStepParameterDefinitionsFromValues({ "s.tenant": "Acme", "r.build": "1" }));
  assert.deepEqual(parameters.map((item) => item.name), ["r.build", "t.email", "t.region", "s.tenant", "t.undeclared"]);
  assert.equal(parameters.find((item) => item.name === "t.email").sourceLabel, "Customers");
  assert.deepEqual(buildDataSetParameterValues(dataSet), { "t.email": "first" });
});

test("incomplete scope prefixes never create phantom t, s, or r parameters", () => {
  const definitions = collectStepParameters([{ id: "1", action: "Given @t. and @s. or @r. then @r.build", expected_result: "@t.email", automation_code: "", api_request: null }]);
  assert.deepEqual(definitions.map((item) => item.name), ["r.build", "t.email"]);
});

test("explicit test scope remains test scope when suite or run is the fallback", () => {
  const values = { "t.email": "test", "s.email": "suite", "r.email": "run", tenant: "legacy suite" };
  assert.deepEqual(filterStepParameterValuesByScope(values, "s"), { "s.email": "suite", "s.tenant": "legacy suite" });
  assert.deepEqual(filterStepParameterValuesByScope(values, "r"), { "r.email": "run", "r.tenant": "legacy suite" });
});

test("hidden data columns stay selectable while values and duplicate-key overrides remain undisclosed", () => {
  const dataSet = { mode: "key_value", columns: ["key", "value"], rows: [{ key: "password", value: "earlier value" }, { key: "password", value: "hidden", is_secret: true }, { key: "email", value: "visible" }] };
  const definitions = mergeStepParameterDefinitions(buildStepParameterDefinitionsFromValues({ "t.password": "override" }), buildDataSetParameterDefinitions(dataSet));
  const sensitive = definitions.filter((item) => item.sensitive).map((item) => item.name);
  assert.equal(getStepParameterSuggestions(definitions, getStepParameterQuery("@t.pass", 7))[0].sensitive, true);
  assert.deepEqual(buildDataSetParameterValues(dataSet), { "t.email": "visible" });
  assert.equal(resolveStepParameterText("Use @t.password", excludeSensitiveStepParameterValues({ "t.password": "override" }, sensitive)), "Use @t.password");
});

test("selected parameters resolve for display while their authored reference remains lossless", () => {
  const source = "When I enter @t.";
  const inserted = insertStepParameterReference(source, getStepParameterQuery(source, source.length), { token: "@t.email" });
  assert.equal(inserted.value, "When I enter @t.email");
  assert.equal(resolveStepParameterText(inserted.value, { "t.email": '<customer&name>@example.test' }), "When I enter <customer&name>@example.test");
  assert.equal(resolveStepParameterText(inserted.value, { "t.email": "" }), "When I enter ");
  assert.equal(resolveStepParameterText(inserted.value, { "t.email": "@s.tenant", "s.tenant": "should stay a reference" }), "When I enter @s.tenant");
  assert.equal(inserted.value, "When I enter @t.email");
});

test("columns with spaces, dots, numeric names, brackets, and backslashes use lossless quoted references", () => {
  const row = { "First Name": "Jay", "account.email": "jay@example.test", "2026": "current", "postal]code": "560001", "folder\\file": "document" };
  const dataSet = { mode: "table", columns: Object.keys(row), rows: [row] };
  const definitions = buildDataSetParameterDefinitions(dataSet);
  assert.deepEqual(definitions.map((item) => item.token).sort(), ["@t.[first name]", "@t.[account.email]", "@t.[2026]", "@t.[postal\\]code]", "@t.[folder\\\\file]"].sort());
  const values = buildDataSetParameterValues(dataSet);
  for (const definition of definitions) {
    assert.equal(normalizeStepParameterName(definition.token), definition.name);
    assert.equal(resolveStepParameterText(`Enter ${definition.token}.`, values), `Enter ${values[definition.name]}.`);
    assert.equal(resolveGherkinParameterText(`Given ${definition.token} is provided`, values), `Given ${values[definition.name]} is provided`);
    assert.equal(tokenizeGherkinInlineText(definition.token)[0].type, "parameter");
  }
  assert.deepEqual(collectStepParameters([{ id: "1", action: definitions.map((item) => item.token).join(" "), expected_result: "" }]).map((item) => item.name).sort(), definitions.map((item) => item.name).sort());
});

test("editing quoted references replaces their whole remaining name and closing delimiter", () => {
  const source = "Given @t.[first name] is available";
  const query = getStepParameterQuery(source, source.indexOf("first") + 3);
  assert.equal(query.query, "fir");
  assert.equal(insertStepParameterReference(source, query, { token: "@t.[account.email]" }).value, "Given @t.[account.email] is available");
  const partial = "Given @t.[first n";
  assert.equal(getStepParameterQuery(partial, partial.length).query, "first n");
  assert.equal(getStepParameterQuery("Given @t.[bad\nname", 18), null);
});
