import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const exports = {};
new Function("exports", ts.transpileModule(readFileSync(new URL("../src/platform/lib/domainOptions.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(exports);
const { getDomainOptions, getDomainSuggestions, getDomainDefault, resolveDomainSuggestionValue } = exports;
const field = "test_cases.types";
const metadata = { dropdowns: { revision: 7, fields: { [field]: {
  default_value: "contract", options: [
    { value: "contract", label: "Contract behavior", active: true },
    { value: "legacy", label: "Legacy coverage", active: false },
    { value: "functional", label: "Functional", active: true }
  ] } } } };

test("registry order, custom labels, and retired saved values survive refresh without reviving retired choices", () => {
  const fallback = [{ value: "fallback", label: "Fallback" }];
  assert.deepEqual(getDomainOptions(undefined, field, fallback), fallback);
  assert.deepEqual(getDomainOptions(metadata, field).map(item => item.value), ["contract", "functional"]);
  const existing = getDomainOptions(metadata, field, fallback, ["legacy", "missing", "missing"]);
  assert.deepEqual(existing.map(item => item.value), ["contract", "legacy", "functional", "missing"]);
  assert.equal(existing[1].label, "Legacy coverage");
  assert.equal(existing[1].current, true);
  assert.equal(existing[3].current, true);
  assert.equal(getDomainDefault(metadata, field, "functional"), "contract");
  assert.equal(getDomainDefault({ dropdowns: { fields: { [field]: { ...metadata.dropdowns.fields[field], default_value: "legacy" } } } }, field, "functional"), "functional");
});

test("an explicitly empty registry is authoritative and snapshots are not mutated", () => {
  const before = JSON.stringify(metadata);
  getDomainOptions(metadata, field, [], ["legacy"]);
  assert.equal(JSON.stringify(metadata), before);
  assert.deepEqual(getDomainOptions({ dropdowns: { fields: { [field]: { options: [] } } } }, field, [{ value: "old", label: "Old" }]), []);
  assert.deepEqual(getDomainOptions({ test_cases: { types: [{ value: "api", label: "API" }] } }, field).map(item => item.value), ["api"]);
});

test("suggestions put admin values first, keep free text, and omit retired observed suggestions", () => {
  assert.deepEqual(getDomainSuggestions(metadata, field, ["FUNCTIONAL", "legacy", "Unlisted label", "Unlisted label", ""]), [{ value: "contract", label: "Contract behavior", active: true }, { value: "functional", label: "Functional", active: true }, { value: "Unlisted label", label: "Unlisted label" }]);
  assert.deepEqual(getDomainOptions(metadata, field, [], ['<img src=x onerror=alert(1)>']).at(-1), { value: '<img src=x onerror=alert(1)>', label: '<img src=x onerror=alert(1)>', current: true });
});


test("renamed suggestion labels remain separate from stored values and arbitrary input remains free text", () => {
  const suggestions = getDomainSuggestions(metadata, field, ["Observed text"]);
  assert.equal(suggestions[0].label, "Contract behavior");
  assert.equal(resolveDomainSuggestionValue("Contract behavior", suggestions), "contract");
  assert.equal(resolveDomainSuggestionValue("CONTRACT", suggestions), "contract");
  assert.equal(resolveDomainSuggestionValue("New custom label", suggestions), "New custom label");
  assert.equal(resolveDomainSuggestionValue("Observed text", suggestions), "Observed text");
  const renamed = structuredClone(metadata);
  renamed.dropdowns.fields[field].options[0].label = "API contract coverage";
  const next = getDomainSuggestions(renamed, field);
  assert.equal(next[0].value, suggestions[0].value);
  assert.equal(next[0].label, "API contract coverage");
});
