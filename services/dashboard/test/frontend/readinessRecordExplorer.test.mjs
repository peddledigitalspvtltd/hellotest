import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as modelModule from "../../frontend/lib/releaseReadiness.ts";
import * as messages from "../../frontend/lib/readinessRecordExplorerMessages.ts";
const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const messageExports = {};
new Function("require", "exports", ts.transpileModule(readFileSync(new URL("../../frontend/lib/releaseReadinessMessages.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText)(() => messages, messageExports);
const { READINESS_MESSAGES } = messageExports;
const source = ts.transpileModule(readFileSync(new URL("../../frontend/components/ReadinessRecordExplorer.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const exports = {};
new Function("require", "exports", source)(name => {
  if (name === "react" || name === "react/jsx-runtime") return require(name);
  if (name === "react-router-dom") return { Link: ({ to, children, ...props }) => React.createElement("a", { href: to, ...props }, children) };
  if (name === "@tabler/icons-react") return new Proxy({}, { get: () => () => React.createElement("svg", { "aria-hidden": true }) });
  if (name.endsWith("LocalizationContext")) return { useLocalization: () => ({ formatNumber: String, formatDate: String }) };
  if (name.endsWith("releaseReadiness")) return modelModule;
  if (name.endsWith("readinessRecordExplorerMessages")) return messages;
  if (name.endsWith("HierarchyLoadMoreButton")) return { HierarchyAutoLoadSentinel: () => null };
  if (name.endsWith("StatusBadge")) return { StatusBadge: ({ value }) => React.createElement("span", null, value) };
  if (name.endsWith(".css")) return {};
  throw new Error(`Unexpected component dependency: ${name}`);
}, exports);
const { matchesReadinessCaseFilter, matchesReadinessBugFilter, ReadinessRecordExplorer } = exports;
const at = "2026-09-10T12:00:00Z";
const model = modelModule.deriveReleaseReadiness({
  release: "R1", sprint: "", now: Date.parse(at),
  requirements: [{ id: "story", title: "Restricted story title", fix_version: "R1", test_case_ids: ["c1", "c2", "c-missing"] }],
  testCases: [{ id: "c1", display_id: "TC1", title: "Checkout evidence", defect_ids: ["BUG-1"] }, { id: "c2", display_id: "TC2", title: "No observed execution" }],
  executions: [{ id: "run", name: "Restricted run title", release: "R1", direct_test_case_ids: ["c1", "c-run-only"], case_snapshots: [{ test_case_id: "c1", expected_iterations: 3 }] }],
  executionResults: [
    { id: "r1", execution_id: "run", test_case_id: "c1", status: "passed", data_set_iteration_key: "first", created_at: at },
    { id: "r2", execution_id: "run", test_case_id: "c1", status: "failed", data_set_iteration_key: "second", created_at: at },
    { id: "r3", execution_id: "run", test_case_id: "c-run-only", status: "blocked", created_at: at },
  ],
  issues: [
    { id: "bug-critical", jira_bug_key: "BUG-1", title: "Checkout defect", status: "open", severity: "Critical", fix_version: "R1" },
    { id: "bug-high", title: "High defect", status: "open", priority: "High", fix_version: "R1" },
    { id: "bug-closed", title: "Closed defect", status: "closed", severity: "Critical", fix_version: "R1" },
  ],
});
const text = (key, values = {}) => (messages.READINESS_EXPLORER_MESSAGES[key] || READINESS_MESSAGES[`readiness.${key}`] || key).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
const render = props => renderToStaticMarkup(React.createElement(ReadinessRecordExplorer, {
  kind: "cases", model, projectId: "project", filter: "all", search: "", canStories: true, canCases: true, canRuns: true, canBugs: true, text, ...props,
}));

test("case filters preserve incomplete failed rows, run-only cases, and unknown planned details", () => {
  const byId = new Map(model.caseEvidence.map(item => [item.id, item]));
  assert.equal(byId.get("c1").missingRows, 1);
  assert.equal(matchesReadinessCaseFilter(byId.get("c1"), "failed"), true);
  assert.equal(matchesReadinessCaseFilter(byId.get("c1"), "unassessed"), true);
  assert.equal(matchesReadinessCaseFilter(byId.get("c1"), "executed"), false);
  assert.equal(matchesReadinessCaseFilter(byId.get("c1"), "passed"), false);
  assert.equal(matchesReadinessCaseFilter(byId.get("c-run-only"), "blocked"), true);
  assert.equal(matchesReadinessCaseFilter(byId.get("c-run-only"), "not-run"), false);
  assert.equal(matchesReadinessCaseFilter(byId.get("c-missing"), "not-run"), true);
  assert.equal(matchesReadinessCaseFilter(byId.get("c2"), "unassessed"), true);
  const mixed = { ...byId.get("c1"), results: [...byId.get("c1").results, { status: "blocked" }] };
  assert.equal(matchesReadinessCaseFilter(mixed, "blocked"), true, "Display failure precedence must not hide blocked outcomes from a blocked filter");
});

test("case explorer renders one row per planned ID, including missing and run-only records", () => {
  const html = render();
  for (const id of ["c1", "c2", "c-missing", "c-run-only"]) {
    assert.equal(html.split(`href="/test-cases?case=${id}&amp;project_id=project"`).length - 1, 1);
  }
  assert.match(html, /Case details are outside the loaded evidence/);
  assert.match(html, /Failed outcomes/);
  assert.match(html, /1 passed/);
  assert.match(html, /1 failed/);
  assert.match(html, /4 of 4 records shown/);
});

test("unavailable sources expose neither record metadata nor outcome-based filters", () => {
  const deniedCases = render({ canCases: false });
  assert.match(deniedCases, /Test case evidence is unavailable/);
  assert.doesNotMatch(deniedCases, /Checkout evidence|c-missing|c-run-only/);
  const deniedRuns = render({ canRuns: false, canStories: false });
  assert.match(deniedRuns, /Checkout evidence/);
  assert.doesNotMatch(deniedRuns, /Failed outcomes|1 passed|Restricted story title|Restricted run title/);
  const filtered = render({ canRuns: false, filter: "passed" });
  assert.match(filtered, /Run evidence is unavailable/);
  assert.doesNotMatch(filtered, /Checkout evidence/);
  const deniedBugs = render({ kind: "bugs", canBugs: false });
  assert.match(deniedBugs, /Defect evidence is unavailable/);
  assert.doesNotMatch(deniedBugs, /Checkout defect|BUG-1/);
});

test("bug explorer filters critical/high/exact linked records and never includes closed defects", () => {
  const linked = new Set(model.linkedIssueIds);
  assert.equal(matchesReadinessBugFilter(model.openIssues[0], "critical", linked), true);
  assert.equal(matchesReadinessBugFilter(model.openIssues[0], "high", linked), false);
  assert.equal(matchesReadinessBugFilter(model.openIssues[0], "linked", linked), true);
  assert.equal(matchesReadinessBugFilter(model.openIssues[1], "linked", linked), false);
  const html = render({ kind: "bugs", filter: "linked" });
  assert.match(html, /href="\/issues\?issue=bug-critical&amp;project_id=project"/);
  assert.match(html, /Checkout evidence/, "Reverse case defect IDs must expose their genuine relationship");
  assert.doesNotMatch(html, /High defect|Closed defect|No linked evidence/);
});

test("explorer Spanish strings cover every English key and retain interpolation fields", () => {
  assert.deepEqual(Object.keys(messages.READINESS_EXPLORER_MESSAGES_ES).sort(), Object.keys(messages.READINESS_EXPLORER_MESSAGES).sort());
  for (const [key, value] of Object.entries(messages.READINESS_EXPLORER_MESSAGES)) {
    assert.deepEqual((messages.READINESS_EXPLORER_MESSAGES_ES[key].match(/\{[^}]+\}/g) || []).sort(), (value.match(/\{[^}]+\}/g) || []).sort(), key);
  }
});
