import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const frontendRoot = new URL("../../../platform/frontend/", import.meta.url);
const fixtureSource = `
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "/src/auth/AuthContext";
import { api, sessionStorage } from "/src/lib/api";
import { ExecutionsPage } from "/services/testing/frontend/pages/ExecutionsPage";
import "/src/styles.css";
import "/src/dark-theme.css";
import "/src/catalog-list.css";
import "/src/modal-system.css";
import "/src/execution-run-builder.css";
import "/src/workspace-layout.css";
const project = { id: "project", name: "Regression project", description: "", app_type_ids: ["app"] };
const app = { id: "app", project_id: "project", name: "Web app", description: "" };
const session = { token: "isolated-fixture", user: { id: "qa", role: "admin", name: "QA Reviewer", email: "qa@example.test" } };
sessionStorage.write(session);
localStorage.setItem("hellotest.current_project_id", "project");
localStorage.setItem("hellotest.current_app_type_by_project", JSON.stringify({ project: "app" }));
localStorage.setItem("hellotest.default_catalog_view_mode", "tile");
document.documentElement.dataset.sidebar = "collapsed";
window.fixtureApiCalls = [];
for (const [resource, methods] of Object.entries(api)) {
  if (methods && typeof methods === "object") for (const [method, value] of Object.entries(methods)) {
    if (typeof value === "function") methods[method] = async (...args) => { window.fixtureApiCalls.push({ resource, method, args }); return []; };
  }
}
const statuses = ["failed", "failed", "failed", "blocked", "passed", "passed"];
const modules = [{ id: "module-payments", name: "Payment methods" }, { id: "module-retries", name: "Retry handling" }];
const cases = statuses.map((status, i) => ({ id: "case-" + (i + 1), display_id: "TC-" + (i + 1), title: "Checkout scenario " + (i + 1), description: "Saved case description", priority: 2, status: "approved", app_type_id: "app", project_id: "project", suite_id: null, suite_ids: [], module_id: modules[i < 3 ? 0 : 1].id, module_name: modules[i < 3 ? 0 : 1].name, module_ids: [modules[i < 3 ? 0 : 1].id], requirement_id: "story-" + (i < 2 ? 1 : i < 4 ? 2 : 3), requirement_ids: ["story-" + (i < 2 ? 1 : i < 4 ? 2 : 3)], steps: [], parameter_values: {}, external_references: [] }));
const assignees = [{ id: "qa", name: "QA Reviewer", email: "qa@example.test" }, { id: "reviewer-2", name: "Release Reviewer", email: "release@example.test" }];
const longStoryTitle = new URLSearchParams(location.search).has("longStories") ? " with varied customer profiles and payment confirmation states".repeat(4).slice(0, 220) : "";
const stories = [1, 2, 3].map(i => ({ id: "story-" + i, title: "Checkout story " + i + longStoryTitle, description: "Saved story", priority: 2, status: "in_progress", test_case_ids: cases.filter(item => item.requirement_id === "story-" + i).map(item => item.id) }));
const environment = { id: "env", name: "Run staging", description: "<p>Saved environment.</p>", base_url: "https://saved.example.test", variables: [] };
const configuration = { id: "config", name: "Run browser matrix", description: "", targets: [{ id: "target", os: "Linux", browser: "Chromium", mobile_os: "", version: "120" }], variables: [] };
const data = { id: "data", name: "Run customer data", description: "", mode: "key_value", columns: ["key", "value"], rows: [{ key: "email", value: "saved-at-run@example.test" }] };
const makeRun = (id, name, status, suites = [], trigger = "manual", day = 1) => ({
  id, display_id: "RUN-HIDDEN-" + id, project_id: "project", app_type_id: "app", revision: 2, name, status, trigger, run_mode: trigger === "local" ? "local" : "manual", test_case_ids: cases.map(item => item.id), direct_test_case_ids: suites.length ? [] : cases.map(item => item.id), suite_ids: suites,
  created_at: "2026-09-" + String(day).padStart(2, "0") + "T08:00:00Z", updated_at: "2026-09-09T10:00:00Z", created_by: "qa", started_at: status === "queued" ? null : status === "running" ? new Date(Date.now() - 65000).toISOString() : "2026-09-09T09:00:00Z", ended_at: ["completed", "failed", "aborted"].includes(status) ? "2026-09-09T09:15:00Z" : null,
  release: "HIDDEN-RELEASE", sprint: "HIDDEN-SPRINT", build: "HIDDEN-BUILD", assigned_to_ids: ["qa"], assigned_users: [assignees[0]], assigned_to: "qa", assigned_user: assignees[0],
  test_environment: { id: environment.id, name: environment.name, snapshot: environment }, test_configuration: { id: configuration.id, name: configuration.name, snapshot: configuration }, test_data_set: { id: data.id, name: data.name, snapshot: data },
  metrics: { total_cases: 6, passed_cases: status === "queued" ? 0 : 2, failed_cases: status === "queued" ? 0 : status === "running" ? 1 : 3, blocked_cases: status === "queued" ? 0 : 1, running_cases: status === "running" ? 1 : 0, pending_cases: status === "queued" ? 6 : status === "running" ? 1 : 0, defect_count: status === "queued" ? 0 : 2, story_count: 3, failed_story_count: status === "queued" ? 0 : 2 },
  case_snapshots: cases.map((item, i) => ({ execution_id: id, test_case_id: item.id, test_case_title: item.title, test_case_description: item.description, priority: item.priority, status: item.status, sort_order: i, requirement_ids: item.requirement_ids, suite_id: suites[0] || null, suite_name: suites.length ? "Checkout suite" : null, module_id: item.module_id, module_name: item.module_name, external_references: [], parameter_values: {}, assigned_to: "qa", assigned_to_ids: ["qa"], assigned_users: [assignees[0]], assignment_source: "run" })),
  step_snapshots: cases.map(item => ({ execution_id: id, test_case_id: item.id, snapshot_step_id: "step-" + item.id, step_order: 1, action: "Given checkout is ready", expected_result: "Checkout succeeds", step_type: "web" })),
  suite_snapshots: suites.map(id => ({ id, name: "Checkout suite", test_case_count: cases.length })), module_snapshots: modules.map(module => ({ ...module, test_case_count: 3 })), requirement_snapshots: stories
});
const runs = [makeRun("direct", "Direct checkout run", "failed", [], "manual", 9), makeRun("suite", "Suite checkout run", "queued", ["suite"], "manual", 8), makeRun("running", "Active checkout run", "running", ["suite"], "manual", 7), makeRun("aborted", "Aborted checkout run", "aborted", [], "manual", 6), makeRun("completed", "Completed checkout run", "completed", [], "manual", 5), makeRun("local", "Local checkout run", "queued", [], "local", 4)];
let results = runs.filter(run => run.status !== "queued").flatMap(run => cases.map((item, i) => {
  const status = run.status === "running" ? ["failed", "passed", "blocked", "passed", "running", null][i] : run.status === "aborted" ? ["passed", "failed", "blocked", "skipped", "aborted", "paused"][i] : statuses[i];
  if (!status) return null;
  return { id: run.id + "-" + item.id, execution_id: run.id, test_case_id: item.id, test_case_title: item.title, app_type_id: "app", status, duration_ms: 1000, started_at: status === "running" ? new Date(Date.now() - 1000).toISOString() : null, timer_started_at: status === "running" ? new Date(Date.now() - 1000).toISOString() : null, error: status === "failed" ? "Expected payment confirmation was not shown." : null, logs: JSON.stringify({ stepStatuses: { ["step-" + item.id]: status }, stepNotes: { ["step-" + item.id]: "Recorded execution notes." }, aiAnalysis: { executionId: run.id, testCaseId: item.id, response: "Review payment confirmation and retry handling against the recorded result.", generatedAt: "2026-09-09T10:00:00Z" } }), test_data_set_id: "data", data_set_iteration_index: 0, data_set_iteration_key: "data:0", data_set_row_snapshot: { email: "saved-at-run@example.test" }, external_references: ["https://example.test/evidence/" + item.id], defects: i < 3 ? ["BUG-" + (i < 2 ? 1 : 2)] : [], executed_by: "qa", created_at: "2026-09-09T09:10:00Z" };
}).filter(Boolean));
const fixtureQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const resultsReady = new URLSearchParams(location.search).has("delayedResults")
  ? new Promise(resolve => { window.fixtureReleaseResults = resolve; })
  : Promise.resolve();
window.fixtureUpdateResultEvidence = async error => {
  results = results.map(result => result.id === "direct-case-1" ? { ...result, error } : result);
  await fixtureQueryClient.invalidateQueries({ queryKey: ["execution-results"] });
};
api.auth.session = async () => session;
api.featureFlags.snapshot = async () => ({ flags: new Proxy({}, { get: () => true }) });
api.settings.getWorkspacePreferences = async () => ({ preferences: {} });
api.metadata.domain = async () => ({ test_environments: { browsers: [{ value: "Chromium", label: "Chromium" }], mobile_os: [] }, test_data_sets: { modes: [{ value: "key_value", label: "Key/value pairs" }] } });
api.projects.list = async () => [project]; api.appTypes.list = async () => [app];
api.projectMembers.list = async () => assignees.map(user => ({ user_id: user.id, user_name: user.name, user_email: user.email, project_id: "project" }));
api.executions.list = async () => runs;
api.executions.get = async id => runs.find(run => run.id === id);
api.executions.parameterPlan = async () => ({case_count:6,suite_count:1,expected_instance_count:6,parameters:[]});
window.fixtureAnalysisCalls = [];
api.executions.analyzeCase = async (executionId, testCaseId) => {
  window.fixtureAnalysisCalls.push({ executionId, testCaseId });
  return new Promise((resolve, reject) => { window.fixtureRejectAnalysis = () => reject(new Error("Fixture analysis provider unavailable.")); });
};
api.executionResults.list = async query => { await resultsReady; return query?.execution_id ? results.filter(result => result.execution_id === query.execution_id) : results; };
api.requirements.list = async () => stories;
api.testCases.list = async () => cases;
api.testSuites.list = async () => [{ id: "suite", name: "Checkout suite", app_type_id: "app", project_id: "project", test_case_ids: cases.map(item => item.id) }];
api.testEnvironments.list = async () => [{ ...environment, project_id: "project", app_type_id: "app" }];
api.testConfigurations.list = async () => [{ ...configuration, project_id: "project", app_type_id: "app" }];
api.testDataSets.list = async () => [{ ...data, project_id: "project", app_type_id: "app" }];
api.executionSchedules.list = async () => [{
  id: "scheduled", project_id: "project", app_type_id: "app", name: "Nightly checkout", cadence: "daily",
  is_active: true, next_run_at: "2099-01-01T10:00:00Z", suite_ids: ["suite"], test_case_ids: [],
  test_environment_id: "env", assigned_to_ids: ["qa"], assigned_users: [assignees[0]], created_by: "qa"
}];
function Fixture() {
  const location = useLocation();
  return <div className="app-shell app-layout app-layout--workspace-wide"><aside className="sidebar is-collapsed">Navigation</aside><main className="workspace-main main main--library-fill" data-route="/executions"><ExecutionsPage /></main><output hidden data-testid="location">{location.pathname + location.search}</output></div>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={fixtureQueryClient}><MemoryRouter initialEntries={[new URLSearchParams(location.search).get("route") || "/executions?view=test-case-runs"]}><AuthProvider><Fixture /></AuthProvider></MemoryRouter></QueryClientProvider>);
`;

test("run review keeps metric evidence, dialogs, hierarchy and catalog selection accessible at every width", { timeout: 240000 }, async () => {
  const name = `run-catalog-qa-${randomUUID()}`;
  const htmlPath = new URL(`${name}.html`, frontendRoot);
  const sourcePath = new URL(`${name}.tsx`, frontendRoot);
  let browser;
  let page;
  try {
    await writeFile(htmlPath, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(sourcePath, fixtureSource);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); void writeFile("/tmp/qaira-run-catalog-error.txt", String(error.stack)); });
    const url = `${process.env.VITE_TEST_URL || "http://127.0.0.1:5173"}/${name}.html`;
    const assertNoOverflow = async label => {
      const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, main: document.querySelector(".workspace-main")?.getBoundingClientRect().toJSON(), content: document.querySelector(".page-content")?.getBoundingClientRect().toJSON() }));
      assert.ok(overflow.document <= overflow.viewport + 1, `${label}: ${JSON.stringify(overflow)}`);
      assert.ok(overflow.content.right <= overflow.viewport + 1 && overflow.content.width > 200, `${label}: ${JSON.stringify(overflow)}`);
    };
    const assertWheelScrollsPage = async target => {
      await target.scrollIntoViewIfNeeded();
      await target.hover();
      const { top, remaining } = await page.locator(".workspace-main").evaluate(element => ({ top: element.scrollTop, remaining: element.scrollHeight - element.clientHeight - element.scrollTop }));
      const delta = remaining > 60 ? 240 : -240;
      await page.mouse.wheel(0, delta);
      await page.waitForFunction(({ top, delta }) => delta > 0
        ? document.querySelector(".workspace-main").scrollTop > top + 10
        : document.querySelector(".workspace-main").scrollTop < top - 10, { top, delta }, { timeout: 2000 });
    };
    const assertDialogFitsAndTrapsFocus = async (dialog, width) => {
      await dialog.waitFor();
      await page.waitForFunction(() => document.querySelector(".run-review-dialog")?.contains(document.activeElement));
      const bounds = await dialog.evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, width: element.clientWidth, scroll: element.scrollWidth, top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom }));
      assert.ok(bounds.left >= 0 && bounds.right <= width + 1 && bounds.top >= 0 && bounds.bottom <= 901 && bounds.scroll <= bounds.width + 1, JSON.stringify({ width, bounds }));
      const controls = dialog.locator('button:visible:not([disabled]), textarea:visible:not([disabled]), input:visible:not([disabled]), select:visible:not([disabled]), a[href]:visible');
      await controls.last().focus();
      await page.keyboard.press("Tab");
      assert.equal(await controls.first().evaluate(element => document.activeElement === element), true, "Tab wraps within the modal");
      await page.keyboard.press("Shift+Tab");
      assert.equal(await controls.last().evaluate(element => document.activeElement === element), true, "Shift+Tab wraps within the modal");
    };
    await page.goto(url);
    await page.getByRole("heading", { name: "Runs", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="location"]').textContent.includes("view=suite-runs"));
    assert.equal(await page.getByRole("heading", { name: "Test Case Runs", exact: true }).count(), 0);
    const direct = page.getByRole("article", { name: "Open run Direct checkout run", exact: true });
    await direct.waitFor();
    assert.equal(await page.getByRole("article", { name: "Open run Suite checkout run", exact: true }).count(), 1);
    assert.equal(await page.getByRole("article", { name: "Open run Local checkout run", exact: true }).count(), 1);
    assert.doesNotMatch(await direct.innerText(), /RUN-HIDDEN-|HIDDEN-RELEASE|HIDDEN-SPRINT|HIDDEN-BUILD/);
    assert.equal(await direct.locator(".tile-card-title-group").evaluate(element => getComputedStyle(element, "::before").content), "none", "run title has one visible field label");
    assert.equal(await direct.locator('.tile-card-metric').filter({ hasText: "Defects" }).innerText().then(value => value.replace(/\s+/g, " ").trim()), "2 Defects");
    assert.match(await direct.innerText(), /2\/3/);
    const segmentTitles = tile => tile.locator(".metric-status-segment").evaluateAll(elements => elements.map(element => element.title));
    assert.deepEqual(await segmentTitles(direct.locator(".tile-card-progress").nth(0)), ["Passed: 2", "Failed: 3", "Blocked: 1"]);
    assert.deepEqual(await segmentTitles(direct.locator(".tile-card-progress").nth(1)), ["Passed: 2", "Failed: 3", "Blocked: 1"]);
    const activeRun = page.getByRole("article", { name: "Open run Active checkout run", exact: true });
    assert.equal(await activeRun.locator(".tile-card-progress").nth(0).getByRole("progressbar").getAttribute("aria-valuenow"), "67");
    assert.deepEqual(await segmentTitles(activeRun.locator(".tile-card-progress").nth(0)), ["Passed: 2", "Failed: 1", "Blocked: 1", "Running: 1", "Pending: 1"]);
    assert.equal(await activeRun.locator(".tile-card-progress").nth(1).getByRole("progressbar").getAttribute("aria-valuenow"), "50");
    assert.deepEqual(await segmentTitles(activeRun.locator(".tile-card-progress").nth(1)), ["Passed: 2", "Failed: 1", "Blocked: 1"]);
    const abortedRun = page.getByRole("article", { name: "Open run Aborted checkout run", exact: true });
    assert.equal(await abortedRun.locator(".tile-card-progress").nth(0).getByRole("progressbar").getAttribute("aria-valuenow"), "83", "Skipped and aborted outcomes complete work; paused outcomes do not");
    assert.deepEqual(await segmentTitles(abortedRun.locator(".tile-card-progress").nth(0)), ["Passed: 1", "Failed: 1", "Blocked: 1", "Skipped: 1", "Aborted: 1", "Paused: 1"]);
    assert.equal(await abortedRun.locator(".tile-card-progress").nth(1).getByRole("progressbar").getAttribute("aria-valuenow"), "33", "Pass rate preserves the passed/failed/blocked denominator");
    for (const run of ["Direct", "Aborted", "Completed", "Suite", "Active"]) assert.equal(await page.getByRole("button", { name: `Edit ${run} checkout run`, exact: true }).count(), 0, "Run edit buttons are removed");

    for (const view of ["List view", "Tile view"]) {
      await page.getByRole("button", {name:view,exact:true}).click();
      assert.equal(await page.getByRole("button", {name:"Edit selected run",exact:true}).count(),0);
      assert.equal(await page.getByRole("button", {name:/^Edit .*checkout run$/}).count(),0);
      const selected = view === "Tile view" ? page.getByRole("checkbox", {name:"Select Suite checkout run",exact:true}) : page.getByRole("row").filter({hasText:"Suite checkout run"}).getByRole("checkbox");
      await selected.check();
      await page.getByRole("button", {name:"Clear",exact:true}).click();
      assert.equal(await selected.isChecked(),false);
    }

    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await assertNoOverflow(`catalog ${width}`);
      const positions = await direct.locator(".execution-run-selection-row").evaluate(row => {
        const checkbox = row.querySelector("input").getBoundingClientRect();
        const status = row.querySelector(".execution-card-status").getBoundingClientRect();
        return { checkbox: { x: checkbox.x, center: checkbox.y + checkbox.height / 2 }, status: { x: status.x, center: status.y + status.height / 2 } };
      });
      assert.ok(positions.status.x > positions.checkbox.x && Math.abs(positions.status.center - positions.checkbox.center) < 5, JSON.stringify({ width, positions }));
      if (process.env.BROWSER_SCREENSHOT_DIR && [1440, 390].includes(width)) await page.screenshot({ path: join(process.env.BROWSER_SCREENSHOT_DIR, `run-catalog-${width}.png`), animations: "disabled" });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("checkbox", { name: "Select Suite checkout run", exact: true }).check();
    await direct.locator(".tile-card-open-button").click();
    await page.getByRole("heading", { name: "Direct checkout run", exact: true }).waitFor();
    assert.equal(await page.locator(".execution-command-actions").getByRole("button", { name: "Edit run", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "View evidence for Run Results", exact: true }).locator(":scope > strong").innerText(), "33%", "Run pass rate uses finalized instances");
    assert.match(await page.getByRole("button", { name: "View evidence for Defects", exact: true }).innerText(), /2/);
    assert.match(await page.getByRole("button", { name: "View evidence for Run Impacted Stories", exact: true }).innerText(), /2\/3/);
    assert.match(await page.getByRole("button", { name: "View evidence for Evidence Readiness", exact: true }).innerText(), /100%/);
    assert.equal(await page.locator(".execution-command-analysis > .agent-process-rail, .execution-command-analysis .execution-command-readiness").count(), 0, "The side panel has no duplicate readiness card or always-visible workflow");
    assert.equal(await page.locator("details > summary").filter({ hasText: /^Evidence analysis$/i }).count(), 0, "Evidence analysis is not duplicated below the page");
    assert.equal(await page.getByRole("dialog").count(), 0, "Review and workflow dialogs open only on request");
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await assertNoOverflow(`details ${width}`);
      const actionPosition = await page.locator(".execution-run-command-center").evaluate(root => ({ heading: root.querySelector(".execution-command-header").getBoundingClientRect().bottom, actions: root.querySelector(".execution-command-actions").getBoundingClientRect().top }));
      assert.ok(actionPosition.actions >= actionPosition.heading - 1, JSON.stringify({ width, actionPosition }));
      const health = page.locator('[aria-label="Execution health"]');
      for (const label of ["Run Results", "Execution Progress", "Total Duration", "Defects"]) {
        const front = health.getByRole("button", { name: `View evidence for ${label}`, exact: true });
        await front.click();
        const evidence = health.getByRole("list", { name: `${label} evidence`, exact: true });
        await evidence.waitFor();
        assert.ok((await evidence.getByRole("listitem").count()) > 0, `${label} exposes supporting evidence`);
        await assertNoOverflow(`${label} flipped at ${width}`);
        await health.getByRole("button", { name: `Back to ${label} metric`, exact: true }).click();
      }
      {
        const configTops = await page.locator(".execution-run-config-links button").evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().top)));
        assert.ok(Math.max(...configTops) - Math.min(...configTops) < 3, `Configuration links share one compact row: ${configTops}`);
      }
      for (const selector of [".execution-command-actions button", ".execution-command-search input", ".execution-command-case-inspect"]) {
        await assertWheelScrollsPage(page.locator(selector).first());
      }
      const clippedComposerControls = await page.locator(".execution-command-analysis").evaluate(composer => {
        const bounds = composer.getBoundingClientRect();
        return [...composer.querySelectorAll("button")].filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.width && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || element.scrollWidth > element.clientWidth + 1);
        }).map(element => ({ label: element.textContent, right: element.getBoundingClientRect().right, width: element.clientWidth, scrollWidth: element.scrollWidth, composerRight: bounds.right }));
      });
      assert.deepEqual(clippedComposerControls, [], `Failure Analyst controls fit at ${width}px`);
      if (process.env.BROWSER_SCREENSHOT_DIR && [1440, 390].includes(width)) {
        await page.locator(".workspace-main").evaluate(element => element.scrollTop = 0);
        await page.screenshot({ path: join(process.env.BROWSER_SCREENSHOT_DIR, `run-details-${width}.png`), animations: "disabled" });
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "View evidence for Run Impacted Stories", exact: true }).click();
    await page.getByRole("list", { name: "Run Impacted Stories evidence", exact: true }).waitFor();
    assert.match(await page.getByRole("list", { name: "Run Impacted Stories evidence", exact: true }).innerText(), /Checkout story/);
    await page.getByRole("button", { name: "Inspect failed cases", exact: true }).click();
    assert.equal(await page.locator(".execution-command-case-inspect").count(), 3);
    await page.getByRole("button", { name: "View evidence for Evidence Readiness", exact: true }).click();
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const evidenceTrigger = page.getByRole("button", { name: "Open evidence", exact: true });
      await evidenceTrigger.click();
      const analysis = page.getByRole("dialog", { name: "Evidence Analysis", exact: true });
      await assertDialogFitsAndTrapsFocus(analysis, width);
      await analysis.getByRole("heading", { name: "Evidence details", exact: true }).waitFor();
      if (width === 1440) {
        await analysis.getByRole("textbox", { name: "Edit run analysis summary", exact: true }).fill("Reviewed against recorded failure evidence.");
        await analysis.getByRole("button", { name: "Accept reviewed summary", exact: true }).click();
        await analysis.getByText("Accepted for this review", { exact: true }).waitFor();
      }
      if (process.env.BROWSER_SCREENSHOT_DIR && [1440, 390].includes(width)) await page.screenshot({ path: join(process.env.BROWSER_SCREENSHOT_DIR, `run-evidence-dialog-${width}.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await analysis.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.textContent.trim() === "Open evidence");
      const workflowTrigger = page.getByRole("button", { name: "Workflow", exact: true });
      await workflowTrigger.click();
      const workflow = page.getByRole("dialog", { name: "Failure Analyst workflow", exact: true });
      await assertDialogFitsAndTrapsFocus(workflow, width);
      assert.equal(await workflow.locator(".agent-process-rail").count(), 1);
      const processOverflow = await workflow.locator(".agent-process-rail").evaluate(rail => [...rail.querySelectorAll(".agent-process-stage, .agent-process-stage strong, .agent-process-rail__trace")].filter(element => element.scrollWidth > element.clientWidth + 1).map(element => ({ className: element.className, text: element.textContent, width: element.clientWidth, scroll: element.scrollWidth })));
      assert.deepEqual(processOverflow, [], `Workflow labels fit at ${width}px`);
      if (process.env.BROWSER_SCREENSHOT_DIR && [1440, 390].includes(width)) await page.screenshot({ path: join(process.env.BROWSER_SCREENSHOT_DIR, `run-workflow-dialog-${width}.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await workflow.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.textContent.trim() === "Workflow");
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [label, title] of [["Environment", "Environment"], ["Test data", "Test data"], ["Configuration", "Configuration"]]) {
      await page.locator(".execution-run-config-links").getByRole("button", { name: new RegExp(`^${label} `) }).click();
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await dialog.getByText("Saved with this run", { exact: true }).waitFor();
      assert.equal(await dialog.locator("form.resource-form").count(), 1);
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
    }
    await page.getByRole("button", { name: "Open Checkout scenario 1 case workspace", exact: true }).click();
    await page.getByRole("heading", { name: "Checkout scenario 1", exact: true }).waitFor();
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await assertNoOverflow(`case workspace ${width}`);
      if (process.env.BROWSER_SCREENSHOT_DIR && [1440, 1024, 390].includes(width)) await page.screenshot({ path: join(process.env.BROWSER_SCREENSHOT_DIR, `run-case-${width}.png`), animations: "disabled" });
      const positions = await page.locator(".execution-case-run-header").evaluate(header => ({ identity: header.querySelector(".execution-case-run-identity").getBoundingClientRect().toJSON(), actions: header.querySelector(".execution-case-run-header-actions").getBoundingClientRect().toJSON() }));
      assert.ok(positions.actions.top >= positions.identity.bottom - 1 || positions.actions.left >= positions.identity.right - 1 || positions.actions.right <= positions.identity.left + 1, JSON.stringify({ width, positions }));
    }
    await page.goto(`${url}?route=${encodeURIComponent("/executions?view=test-case-runs&execution=direct&testCase=case-1")}`);
    await page.getByRole("heading", { name: "Checkout scenario 1", exact: true }).waitFor();
    const legacyTarget = await page.getByTestId("location").textContent();
    assert.match(legacyTarget, /view=suite-runs/);
    assert.match(legacyTarget, /execution=direct/);
    assert.match(legacyTarget, /testCase=case-1/);
    await assertNoOverflow("legacy direct case link");
    await page.goto(`${url}?route=${encodeURIComponent("/executions?view=suite-runs&execution=suite")}`);
    await page.getByRole("heading", { name: "Suite checkout run", exact: true }).waitFor();
    for (const [label, value] of [["Run Results", "—"], ["Execution Progress", "0%"], ["Defects", "0"]]) {
      assert.equal(await page.getByRole("button", { name: `View evidence for ${label}`, exact: true }).locator(":scope > strong").innerText(), value, `Queued ${label} distinguishes missing results from zero progress or defects`);
    }
    await page.getByRole("button", { name: "Workflow", exact: true }).click();
    const queuedWorkflow = page.getByRole("dialog", { name: "Failure Analyst workflow", exact: true });
    await queuedWorkflow.getByRole("status").filter({ hasText: "No Failure Analyst analysis has been recorded for this run" }).waitFor();
    await page.keyboard.press("Escape");
    await page.goto(`${url}?route=${encodeURIComponent("/executions?view=suite-runs&execution=running")}`);
    await page.getByRole("heading", { name: "Active checkout run", exact: true }).waitFor();
    const durationMetric = page.locator('button[aria-label="View evidence for Total Duration"] > strong');
    const durationBeforeTick = await durationMetric.innerText();
    await page.getByRole("button", { name: "View evidence for Total Duration", exact: true }).click();
    await page.waitForFunction(previous => document.querySelector('button[aria-label="View evidence for Total Duration"] > strong').textContent !== previous, durationBeforeTick, { timeout: 3000 });
    assert.equal(await page.getByRole("button", { name: "Back to Total Duration metric", exact: true }).isVisible(), true, "Live duration updates preserve the evidence face");
    await page.getByRole("button", { name: "Back to Total Duration metric", exact: true }).click();
    const runRoot = page.getByRole("button", { name: "Run: Active checkout run", exact: true });
    assert.equal(await runRoot.locator(".execution-hierarchy-completion").innerText(), "67%");
    assert.equal(await page.locator(".execution-command-case-inspect").count(), 6, "The run root starts with every case in scope");
    const suite = page.getByRole("button", { name: "Suite: Checkout suite", exact: true });
    const expandSuite = page.getByRole("button", { name: "Expand Checkout suite", exact: true });
    if (await expandSuite.isVisible()) await expandSuite.click();
    const payments = page.getByRole("button", { name: "Module: Payment methods", exact: true });
    const retries = page.getByRole("button", { name: "Module: Retry handling", exact: true });
    assert.equal(await suite.locator(".execution-hierarchy-completion").innerText(), "67%");
    assert.equal(await payments.locator(".execution-hierarchy-completion").innerText(), "100%");
    assert.equal(await retries.locator(".execution-hierarchy-completion").innerText(), "33%");
    assert.match(await retries.locator(".execution-hierarchy-completion").getAttribute("title"), /1 of 3 case instances finalized \(33%\)/);
    await suite.click();
    const suiteAssignees = page.getByRole("group", { name: "Suite assignees", exact: true });
    assert.doesNotMatch(await suiteAssignees.innerText(), /Inherit(?:ed)? run owner/i);
    await suiteAssignees.getByRole("button", { name: "Select assignees", exact: true }).click();
    const assigneeSearch = suiteAssignees.getByRole("textbox", { name: "Search assignees", exact: true });
    await assigneeSearch.fill("Release");
    await suiteAssignees.getByRole("checkbox", { name: /Release Reviewer/ }).waitFor();
    assert.equal(await suiteAssignees.getByRole("checkbox", { name: /QA Reviewer/ }).count(), 0);
    await page.keyboard.press("Escape");
    assert.equal(await suiteAssignees.locator(".multi-assignee-list").count(), 0);
    await retries.click();
    const moduleAssignees = page.getByRole("group", { name: "Module assignees", exact: true });
    await moduleAssignees.waitFor();
    assert.equal(await moduleAssignees.getByRole("button", { name: "Select assignees", exact: true }).isEnabled(), true);
    assert.equal(await page.locator(".execution-command-case-inspect").count(), 3, "Selecting a module narrows the case scope");
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await assertNoOverflow(`module hierarchy ${width}`);
      const expandedWidth = await page.locator(".execution-command-cases").evaluate(element => element.clientWidth);
      const collapse = page.getByRole("button", { name: "Collapse test hierarchy", exact: true });
      assert.equal(await collapse.getAttribute("aria-expanded"), "true");
      await collapse.click();
      const expand = page.getByRole("button", { name: "Expand test hierarchy", exact: true });
      assert.equal(await expand.getAttribute("aria-expanded"), "false");
      assert.equal(await page.locator("#execution-hierarchy-content").isVisible(), false);
      if (width >= 1024) assert.ok(await page.locator(".execution-command-cases").evaluate(element => element.clientWidth) > expandedWidth, `Collapsing the hierarchy returns space to cases at ${width}px`);
      await assertNoOverflow(`collapsed hierarchy ${width}`);
      await expand.click();
      await retries.waitFor();
      await assertWheelScrollsPage(retries);
      await assertWheelScrollsPage(moduleAssignees.getByRole("button", { name: "Select assignees", exact: true }));
      if (process.env.BROWSER_SCREENSHOT_DIR && [1440, 390].includes(width)) {
        await page.locator(".execution-command-hierarchy").scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(process.env.BROWSER_SCREENSHOT_DIR, `run-hierarchy-${width}.png`), animations: "disabled" });
      }
    }
    await runRoot.click();
    assert.equal(await page.locator(".execution-command-case-inspect").count(), 6, "Selecting the labeled run root restores every case");
    await payments.click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(".execution-command-case-toolbar").getByRole("button", { name: "List view", exact: true }).click();
    await page.locator(".execution-command-case-list.is-list").waitFor();
    await page.getByRole("button", { name: "Open Checkout scenario 1 case workspace", exact: true }).click();
    await page.getByRole("heading", { name: "Checkout scenario 1", exact: true }).waitFor();
    assert.match(await page.getByTestId("location").textContent(), /execution=running/);
    assert.match(await page.getByTestId("location").textContent(), /testCase=case-1/);
    await assertNoOverflow("suite module case link");
    await page.goto(`${url}?longStories=1&route=${encodeURIComponent("/executions?view=suite-runs&execution=direct")}`);
    await page.getByRole("heading", { name: "Direct checkout run", exact: true }).waitFor();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole("button", { name: "View evidence for Run Impacted Stories", exact: true }).click();
      const evidence = page.getByRole("list", { name: "Run Impacted Stories evidence", exact: true });
      await evidence.waitFor();
      const evidenceBounds = await evidence.evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, width: element.clientWidth, scrollWidth: element.scrollWidth, overscrollY: getComputedStyle(element).overscrollBehaviorY }));
      assert.ok(evidenceBounds.scrollHeight <= evidenceBounds.height + 1 && evidenceBounds.scrollWidth <= evidenceBounds.width + 1, JSON.stringify({ width, evidenceBounds }));
      assert.equal(evidenceBounds.overscrollY, "auto", "global flip-card styles must not contain the run page wheel");
      await evidence.scrollIntoViewIfNeeded();
      await evidence.hover();
      const previous = await page.locator(".workspace-main").evaluate(element => element.scrollTop);
      await page.mouse.wheel(0, 240);
      await page.waitForFunction(previous => document.querySelector(".workspace-main").scrollTop > previous + 10, previous, { timeout: 2000 });
      assert.equal(await evidence.evaluate(element => element.scrollTop), 0, "long evidence uses the page scrollbar");
      await assertNoOverflow(`long flipped evidence ${width}`);
      if (process.env.BROWSER_SCREENSHOT_DIR) await evidence.locator("xpath=ancestor::article[1]").screenshot({ path: join(process.env.BROWSER_SCREENSHOT_DIR, `run-story-evidence-${width}.png`), animations: "disabled" });
      await page.getByRole("button", { name: "Back to Run Impacted Stories metric", exact: true }).click();
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${url}?delayedResults=1&route=${encodeURIComponent("/executions?view=suite-runs&execution=direct")}`);
    await page.getByRole("heading", { name: "Direct checkout run", exact: true }).waitFor();
    await page.getByRole("button", { name: "View evidence for Evidence Readiness", exact: true }).click();
    await page.getByRole("button", { name: "Open evidence", exact: true }).click();
    const delayedAnalysis = page.getByRole("dialog", { name: "Evidence Analysis", exact: true });
    const summary = delayedAnalysis.getByRole("textbox", { name: "Edit run analysis summary", exact: true });
    await summary.waitFor();
    assert.doesNotMatch(await summary.inputValue(), /Expected payment confirmation was not shown/);
    await page.evaluate(() => window.fixtureReleaseResults());
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="Edit run analysis summary"]').value.includes("Expected payment confirmation was not shown"));
    assert.match(await summary.inputValue(), /3 failed/, "An untouched summary includes late-arriving results even when the run timestamp is unchanged");
    const reviewedSummary = "Human review retained while fresh execution evidence arrives.";
    await summary.fill(reviewedSummary);
    await delayedAnalysis.getByRole("button", { name: "Accept reviewed summary", exact: true }).click();
    await delayedAnalysis.getByText("Accepted for this review", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await delayedAnalysis.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Open evidence", exact: true }).click();
    assert.equal(await summary.inputValue(), reviewedSummary);
    await delayedAnalysis.getByText("Accepted for this review", { exact: true }).waitFor();
    await page.evaluate(() => window.fixtureUpdateResultEvidence("A fresh checkout trace identifies a delayed callback."));
    const changedEvidence = delayedAnalysis.getByText("Run evidence changed. Your edits are preserved; compare with the latest summary.", { exact: true });
    await changedEvidence.waitFor();
    assert.equal(await summary.inputValue(), reviewedSummary, "New evidence preserves the user's edited summary");
    assert.equal(await delayedAnalysis.getByText("Accepted for this review", { exact: true }).count(), 0, "New evidence invalidates prior acceptance");
    assert.equal(await delayedAnalysis.getByRole("button", { name: "Accept reviewed summary", exact: true }).isEnabled(), true);
    await changedEvidence.click();
    await delayedAnalysis.getByRole("button", { name: "Use latest summary", exact: true }).click();
    assert.match(await summary.inputValue(), /A fresh checkout trace identifies a delayed callback/);
    assert.equal(await changedEvidence.count(), 0);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Open evidence", exact: true }).click();
    await delayedAnalysis.getByRole("button", { name: "Refresh analysis", exact: true }).click();
    await delayedAnalysis.getByRole("status").filter({ hasText: "0 of 6 cases analyzed" }).waitFor();
    assert.equal(await delayedAnalysis.getByRole("button", { name: "Refresh analysis", exact: true }).isDisabled(), true, "An in-flight analysis cannot start a duplicate batch");
    assert.equal(await summary.isDisabled(), true);
    const switchRun = async name => {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Back to run library", exact: true }).click();
      await page.getByRole("article", { name: `Open run ${name}`, exact: true }).locator(".tile-card-open-button").click();
      await page.getByRole("heading", { name, exact: true }).waitFor();
      await page.getByRole("button", { name: "View evidence for Evidence Readiness", exact: true }).click();
      await page.getByRole("button", { name: "Open evidence", exact: true }).click();
    };
    await switchRun("Completed checkout run");
    assert.equal(await summary.isEnabled(), true, "Run A's pending analysis does not disable run B's review");
    assert.equal(await delayedAnalysis.getByRole("status").filter({ hasText: "cases analyzed" }).count(), 0);
    assert.equal(await delayedAnalysis.getByRole("button", { name: "Refresh analysis", exact: true }).isEnabled(), true);
    await switchRun("Direct checkout run");
    await delayedAnalysis.getByRole("status").filter({ hasText: "0 of 6 cases analyzed" }).waitFor();
    assert.equal(await summary.isDisabled(), true, "Run A keeps its batch progress while another run is viewed");
    await switchRun("Completed checkout run");
    await page.evaluate(() => window.fixtureRejectAnalysis());
    assert.equal(await delayedAnalysis.getByRole("alert").count(), 0, "Run A's failure does not leak into run B's review");
    assert.equal(await summary.isEnabled(), true);
    await switchRun("Direct checkout run");
    await delayedAnalysis.getByRole("alert").filter({ hasText: "Fixture analysis provider unavailable." }).waitFor();
    assert.equal(await summary.isEnabled(), true, "The failed run can be reviewed and retried");
    assert.equal(await delayedAnalysis.getByRole("button", { name: "Refresh analysis", exact: true }).isEnabled(), true);
    assert.equal(await page.evaluate(() => window.fixtureAnalysisCalls.length), 1, "A single batch made only one pending provider request");
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, []);
  } catch (error) {
    if (page && process.env.BROWSER_SCREENSHOT_DIR) {
      await page.screenshot({ path: join(process.env.BROWSER_SCREENSHOT_DIR, "run-review-failure.png"), animations: "disabled" });
      await writeFile(join(process.env.BROWSER_SCREENSHOT_DIR, "run-review-failure.html"), await page.content());
    }
    throw error;
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(htmlPath), unlink(sourcePath)]);
  }
});

test("Scheduled Run tile bars show readiness and context counts with their own tooltips", { timeout: 60000 }, async () => {
  const name = `scheduled-run-progress-qa-${randomUUID()}`;
  const htmlPath = new URL(`${name}.html`, frontendRoot);
  const sourcePath = new URL(`${name}.tsx`, frontendRoot);
  let browser;
  try {
    await writeFile(htmlPath, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(sourcePath, fixtureSource);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL || "http://127.0.0.1:5173"}/${name}.html?route=${encodeURIComponent("/executions?view=scheduled-runs")}`);
    const tile = page.getByRole("article", { name: "Open Scheduled Run scheduled: Nightly checkout", exact: true });
    await tile.waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const launch = tile.locator(".tile-card-progress").nth(0);
      const context = tile.locator(".tile-card-progress").nth(1);
      assert.equal(await launch.getByRole("progressbar").getAttribute("aria-valuenow"), "100");
      assert.deepEqual(await launch.locator(".metric-status-segment").evaluateAll(elements => elements.map(element => element.title)), ["Ready: 3"]);
      assert.equal(await context.getByRole("progressbar").getAttribute("aria-valuenow"), "33");
      assert.deepEqual(await context.locator(".metric-status-segment").evaluateAll(elements => elements.map(element => element.title)), ["Attached: 1", "Not attached: 2"]);
      assert.match(await context.getByRole("progressbar").getAttribute("aria-valuetext"), /1 Attached.*2 Not attached/);
      const bounds = await tile.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
      assert.ok(bounds.scrollWidth <= bounds.width + 1, JSON.stringify({ width, bounds }));
    }
    await page.getByRole("button", {name:"Add test plan",exact:true}).first().click();
    const planDialog = page.getByRole("dialog", {name:"Add test plan",exact:true});
    await planDialog.waitFor();
    await planDialog.getByRole("button", {name:"Close create schedule dialog",exact:true}).click();
    await planDialog.waitFor({state:"hidden"});
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(htmlPath), unlink(sourcePath)]);
  }
});
