import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as csvGrid from "../src/lib/csvGrid.ts";
import { getStoryReleaseOptions } from "../src/lib/requirementReleaseSelection.ts";
const imported = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/requirementImport.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, { module: imported, exports: imported.exports, require: name => {
  assert.equal(name, "./csvGrid");
  return csvGrid;
} });
const { parseRequirementCsv, resolveImportedRequirementPlanning } = imported.exports;

const releases = [
  { id: "release-open", project_id: "project", name: "Autumn delivery", fix_version: "v2", state: "planned" },
  { id: "release-done", project_id: "project", name: "Summer delivery", fix_version: "v1", state: "released" }
];
test("project Releases populate Story details when there are no connected versions", () => {
  const choices = getStoryReleaseOptions(releases, [], { release: "Autumn delivery", fix_version: "v2" });
  assert.equal(choices.value, "release:release-open");
  assert.deepEqual(choices.options.map(option => option.label), ["Autumn delivery"]);
  assert.equal(choices.options[0].fixVersion, "v2");
});
test("a historical Release remains visible without offering completed Releases to new Stories", () => {
  const choices = getStoryReleaseOptions(releases, [], { release: "Summer delivery", fix_version: "v1" });
  assert.equal(choices.value, "release:release-done");
  assert.equal(choices.options.at(-1).completed, true);
  assert.equal(getStoryReleaseOptions(releases, []).options.length, 1);
  const legacy = getStoryReleaseOptions(releases, [], { release: "Saved external delivery", fix_version: "legacy-v0" });
  assert.equal(legacy.options.at(-1).value, legacy.value);
  assert.equal(legacy.options.at(-1).fixVersion, "legacy-v0");
});
test("canonical project Release wins over a duplicate connected version", () => {
  const choices = getStoryReleaseOptions(releases, [{ id: "external", name: "v2" }], { fix_version: "v2" });
  assert.equal(choices.value, "release:release-open");
  assert.equal(choices.options.length, 1);
});
test("CSV Sprint and Release names resolve to scoped persisted IDs without clearing omitted defaults", () => {
  const iterations = [{ id: "sprint", project_id: "project", name: "Sprint Alpha", state: "future" }];
  const parsed = parseRequirementCsv("Title,Sprint,Release\nNew story,Sprint Alpha,Autumn delivery\nNo assignments,,");
  const rows = resolveImportedRequirementPlanning(parsed.rows, iterations, releases);
  assert.equal(rows[0].iteration_id, "sprint");
  assert.equal(rows[0].release_id, "release-open");
  assert.equal(rows[0].fix_version, "v2");
  assert.deepEqual(JSON.parse(JSON.stringify(rows[1])), { title: "No assignments" });
  assert.equal(parsed.rows[0].iteration_id, undefined, "Preview rows are not mutated");
});
test("CSV assignment rejects unknown explicit IDs, completed targets and ambiguous names", () => {
  assert.throws(() => resolveImportedRequirementPlanning([{ title: "Story", iteration_id: "foreign-sprint" }], [], releases), /not available/);
  assert.throws(() => resolveImportedRequirementPlanning([{ title: "Story", release_id: "foreign-release" }], [], releases), /not available/);
  assert.throws(() => resolveImportedRequirementPlanning([{ title: "Story", release: "Summer delivery" }], [], releases), /Completed Release/);
  assert.throws(() => resolveImportedRequirementPlanning([{ title: "Story", release: "Autumn delivery" }], [], [...releases, { ...releases[0], id: "duplicate" }]), /ambiguous/);
});
