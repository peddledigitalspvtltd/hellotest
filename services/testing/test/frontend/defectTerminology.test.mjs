import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const exports = {};
new Function("exports", ts.transpileModule(
  readFileSync(new URL("../../frontend/lib/defectTerminology.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }
).outputText)(exports);
const { formatRecordKindLabel, formatDefectFieldLabel } = exports;

test("legacy defect kinds display consistently without rewriting unrelated labels", () => {
  for (const kind of ["issue", "bug", "defect", "Issue"]) assert.equal(formatRecordKindLabel(kind), "Defect");
  for (const kind of ["issues", "bugs", "defects", "Issues"]) assert.equal(formatRecordKindLabel(kind), "Defects");
  assert.equal(formatRecordKindLabel("test_case"), "test case");
  assert.equal(formatRecordKindLabel("Network issue investigation"), "Network issue investigation");
  assert.equal(formatRecordKindLabel("constructor"), "constructor");
  assert.equal(formatRecordKindLabel(null, "knowledge"), "knowledge");
});

test("defect field headings retain metadata keys and custom labels", () => {
  const field = { key: "issue_id", label: "Issue ID", value: "ISSUE-17" };
  assert.equal(formatDefectFieldLabel(field.key, field.label), "Defect ID");
  assert.equal(field.key, "issue_id");
  assert.equal(field.value, "ISSUE-17");
  assert.equal(formatDefectFieldLabel("bug_type", "Bug Type"), "Defect Type");
  assert.equal(formatDefectFieldLabel("customfield_123", "Customer escalation"), "Customer escalation");
  assert.equal(formatDefectFieldLabel("constructor"), "constructor");
});
