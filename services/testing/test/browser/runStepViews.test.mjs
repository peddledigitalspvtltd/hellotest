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
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "/src/auth/AuthContext";
import { api, sessionStorage } from "/src/lib/api";
import { ExecutionsPage } from "/services/testing/frontend/pages/ExecutionsPage";
import "/src/styles.css";
import "/src/dark-theme.css";
import "/src/catalog-list.css";
import "/src/modal-system.css";
import "/src/execution-run-builder.css";
import "/src/workspace-layout.css";
const params = new URLSearchParams(location.search);
const permissions = ["workspace.view", "project.view", "run.view", "run.execute", "run.update", "result.view", "result.manage", "testcase.view", "suite.view", "requirement.view", "environment.view", "configuration.view", "data.view", "automation.view", "automation.code.view", "run.gherkin.view"];
let grants = permissions.filter(permission => permission !== params.get("deny"));
const makeSession = () => ({ token: "run-step-fixture", user: { id: "reviewer", role: "member", name: "Run Reviewer", email: "reviewer@example.test", permissions: grants, workspace_permissions: ["workspace.view"], project_permissions: { project: grants } } });
let currentSession = makeSession();
const disabledFlags = new Set([params.get("disable")].filter(Boolean));
sessionStorage.write(currentSession);
localStorage.setItem("hellotest.current_project_id", "project");
localStorage.setItem("hellotest.current_app_type_by_project", JSON.stringify({ project: "app" }));
localStorage.setItem("hellotest.default_catalog_view_mode", "tile");
document.documentElement.dataset.sidebar = "collapsed";
window.fixtureApiCalls = [];
for (const [resource, methods] of Object.entries(api)) if (methods && typeof methods === "object") {
  for (const [method, value] of Object.entries(methods)) if (typeof value === "function") methods[method] = async (...args) => { window.fixtureApiCalls.push({ resource, method, args }); return []; };
}
const project = { id: "project", name: "Step view project", description: "", app_type_ids: ["app"] };
const app = { id: "app", project_id: "project", name: "Browser app", type: "web" };
const testCase = { id: "case", display_id: "TC-STEP", title: "Saved checkout case", description: "Review the saved run steps.", app_type_id: "app", project_id: "project", priority: 2, status: "approved", suite_ids: [], requirement_ids: [], external_references: [], parameter_values: { email: "run-customer@example.test" }, steps: [] };
const steps = [
 { execution_id: "run", test_case_id: "case", snapshot_step_id: "saved-step-login", step_order: 1, action: "Enter customer @email", expected_result: "Customer account is recognized", step_type: "web", automation_code: 'console.log("RUN_CODE_VISIBLE_TO_AUTHORIZED");', automation_language: "javascript" },
 { execution_id: "run", test_case_id: "case", snapshot_step_id: "saved-step-checkout", step_order: 2, action: "Submit the checkout request", expected_result: "Order confirmation appears", step_type: "web", automation_code: 'console.log("SECOND_SAVED_STEP_CODE");', automation_language: "javascript" }
];
const run = { id: "run", display_id: "RUN-STEP", project_id: "project", app_type_id: "app", revision: 1, name: "Saved step presentation run", status: "failed", trigger: "manual", run_mode: "manual", test_case_ids: ["case"], direct_test_case_ids: ["case"], suite_ids: [], created_by: "reviewer", created_at: "2026-09-09T08:00:00Z", updated_at: "2026-09-09T10:00:00Z", started_at: "2026-09-09T09:00:00Z", ended_at: "2026-09-09T09:15:00Z", assigned_to_ids: ["reviewer"], assigned_users: [{ id: "reviewer", name: "Run Reviewer" }],
  metrics: { total_cases: 1, passed_cases: 0, failed_cases: 1, blocked_cases: 0, running_cases: 0, pending_cases: 0, defect_count: 0, story_count: 0, failed_story_count: 0 },
  case_snapshots: [{ execution_id: "run", test_case_id: "case", test_case_title: testCase.title, test_case_description: testCase.description, priority: 2, status: "approved", sort_order: 0, requirement_ids: [], external_references: [], parameter_values: testCase.parameter_values }], step_snapshots: steps, suite_snapshots: [], module_snapshots: [], requirement_snapshots: [] };
const result = { id: "result", execution_id: "run", test_case_id: "case", test_case_title: testCase.title, app_type_id: "app", status: "failed", duration_ms: 1500, error: "Confirmation did not appear", logs: JSON.stringify({ stepStatuses: { "saved-step-login": "passed", "saved-step-checkout": "failed" }, stepNotes: { "saved-step-login": "Customer was recognized.", "saved-step-checkout": "Confirmation did not appear." } }), defects: [], executed_by: "reviewer", created_at: "2026-09-09T09:15:00Z", external_references: [] };
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
api.auth.session = async () => structuredClone(currentSession);
api.featureFlags.snapshot = async () => ({ flags: Object.fromEntries(["hellotest.manual.runs", "hellotest.manual.run_gherkin", "hellotest.manual.test_cases", "hellotest.manual.test_data", "hellotest.manual.requirements", "hellotest.automation.workspace", "hellotest.automation.step_code"].map(name => [name, !disabledFlags.has(name)])) });
api.settings.getWorkspacePreferences = async () => ({ preferences: {} });
api.settings.getLocalization = async () => ({ strings: {} });
api.metadata.domain = async () => ({ test_environments: { browsers: [], mobile_os: [] }, test_data_sets: { modes: [] } });
api.projects.list = async () => [project]; api.appTypes.list = async () => [app];
api.projectMembers.list = async () => [{ project_id: "project", user_id: "reviewer", user_name: "Run Reviewer", user_email: "reviewer@example.test" }];
api.executions.list = async () => [run]; api.executions.get = async () => run;
api.executionResults.list = async () => [result];
api.testCases.list = async () => [testCase]; api.testCases.get = async () => testCase;
window.fixtureChangeAccess = async ({ revokePermission, restorePermission, disableFeature, enableFeature }) => {
  if (revokePermission) grants = grants.filter(permission => permission !== revokePermission);
  if (restorePermission && !grants.includes(restorePermission)) grants = [...grants, restorePermission];
  if (disableFeature) disabledFlags.add(disableFeature);
  if (enableFeature) disabledFlags.delete(enableFeature);
  currentSession = makeSession();
  await window.fixtureRefreshSession();
  await client.invalidateQueries({ queryKey: ["feature-flags"] });
};
function Fixture() {
  const { refreshSession } = useAuth();
  useEffect(() => { window.fixtureRefreshSession = refreshSession; }, [refreshSession]);
  return <div className="app-shell app-layout app-layout--workspace-wide"><aside className="sidebar is-collapsed">Navigation</aside><main className="workspace-main main main--library-fill" data-route="/executions"><ExecutionsPage /></main></div>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/executions?view=suite-runs&execution=run&testCase=case"]}><AuthProvider><Fixture /></AuthProvider></MemoryRouter></QueryClientProvider>);
`;

test("saved run steps default to Structured and preserve evidence across permitted views", { timeout: 150000 }, async () => {
  const name = `run-step-views-${randomUUID()}`;
  const html = new URL(`${name}.html`, frontendRoot);
  const source = new URL(`${name}.tsx`, frontendRoot);
  let browser;
  let page;
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(source, fixtureSource);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => { errors.push(`Unexpected API request: ${route.request().url()}`); return route.abort(); });
    const url = `${process.env.VITE_TEST_URL || "http://127.0.0.1:5173"}/${name}.html`;
    const tabs = () => page.getByRole("tablist", { name: "Step view", exact: true });
    const tab = name => tabs().getByRole("tab", { name, exact: true });
    const cards = () => page.locator(".execution-step-card[data-step-id]");
    const structured = async () => {
      await tab("Structured steps").waitFor();
      await page.waitForFunction(() => document.querySelector('[role="tablist"][aria-label="Step view"] [role="tab"][aria-selected="true"]')?.textContent.trim() === "Structured steps");
      assert.equal(await cards().count(), 2);
      assert.equal(await cards().getByText("Action", { exact: true }).count(), 2);
      assert.equal(await cards().getByText("Expected result", { exact: true }).count(), 2);
      assert.equal(await cards().locator(".gherkin-keyword").count(), 0, "Structured steps do not invent Given/When/Then prefixes");
      assert.match(await cards().first().innerText(), /Enter customer run-customer@example\.test/);
      assert.doesNotMatch((await cards().allTextContents()).join("\n"), /RUN_CODE_VISIBLE_TO_AUTHORIZED|SECOND_SAVED_STEP_CODE/);
    };
    const open = async query => {
      await page.goto(`${url}${query ? `?${query}` : ""}`);
      await page.getByRole("heading", { name: "Saved checkout case", exact: true }).waitFor();
      await structured();
    };
    const evidence = () => cards().evaluateAll(elements => elements.map(element => ({
      id: element.dataset.stepId,
      outcome: element.classList.contains("step-status-passed") ? "passed" : element.classList.contains("step-status-failed") ? "failed" : "unknown",
      parameter: element.querySelector(".step-parameter-token")?.textContent || null
    })));
    const assertFits = async label => {
      const bounds = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, toggle: (() => { const e = document.querySelector('.execution-step-view-toggle'); const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, client: e.clientWidth, scroll: e.scrollWidth }; })() }));
      assert.ok(bounds.document <= bounds.viewport + 1, `${label}: page overflow ${JSON.stringify(bounds)}`);
      assert.ok(bounds.toggle.left >= 0 && bounds.toggle.right <= bounds.viewport + 1 && bounds.toggle.scroll <= bounds.toggle.client + 1, `${label}: step view controls fit ${JSON.stringify(bounds)}`);
    };
    await open();
    const savedEvidence = await evidence();
    assert.deepEqual(savedEvidence, [{ id: "saved-step-login", outcome: "passed", parameter: "run-customer@example.test" }, { id: "saved-step-checkout", outcome: "failed", parameter: null }]);
    await tab("Gherkin steps").click();
    assert.equal(await tab("Gherkin steps").getAttribute("aria-selected"), "true");
    assert.deepEqual(await evidence(), savedEvidence, "Gherkin changes presentation without replacing step IDs, outcomes, or resolved parameters");
    assert.deepEqual(await cards().first().locator(".gherkin-keyword").allTextContents(), ["When", "Then"]);
    await tab("Coded steps").click();
    await page.getByRole("list", { name: "Coded steps for this case", exact: true }).waitFor();
    assert.match(await page.getByRole("list", { name: "Coded steps for this case", exact: true }).innerText(), /RUN_CODE_VISIBLE_TO_AUTHORIZED/);
    await page.evaluate(() => window.fixtureChangeAccess({ revokePermission: "automation.code.view" }));
    await structured();
    assert.equal(await tab("Coded steps").count(), 0);
    assert.doesNotMatch(await page.locator("body").innerText(), /RUN_CODE_VISIBLE_TO_AUTHORIZED|SECOND_SAVED_STEP_CODE/);
    await tab("Gherkin steps").click();
    await page.evaluate(() => window.fixtureChangeAccess({ revokePermission: "run.gherkin.view" }));
    await structured();
    assert.equal(await tab("Gherkin steps").count(), 0);
    assert.deepEqual(await evidence(), savedEvidence);
    await page.evaluate(() => window.fixtureChangeAccess({ restorePermission: "run.gherkin.view" }));
    await tab("Gherkin steps").click();
    await page.evaluate(() => window.fixtureChangeAccess({ disableFeature: "hellotest.manual.run_gherkin" }));
    await structured();
    assert.equal(await tab("Gherkin steps").count(), 0);

    await open("deny=automation.code.view");
    assert.equal(await tab("Coded steps").count(), 0);
    assert.doesNotMatch(await page.locator("body").innerText(), /RUN_CODE_VISIBLE_TO_AUTHORIZED|SECOND_SAVED_STEP_CODE/);
    await open("deny=run.gherkin.view");
    assert.equal(await tab("Gherkin steps").count(), 0);
    for (const feature of ["hellotest.manual.run_gherkin", "hellotest.manual.runs"]) {
      await open(`disable=${feature}`);
      assert.equal(await tab("Gherkin steps").count(), 0, `${feature} is required for Gherkin`);
    }
    for (const feature of ["hellotest.automation.workspace", "hellotest.automation.step_code"]) {
      await open(`disable=${feature}`);
      assert.equal(await tab("Coded steps").count(), 0, `${feature} is required for coded steps`);
      assert.doesNotMatch(await page.locator("body").innerText(), /RUN_CODE_VISIBLE_TO_AUTHORIZED|SECOND_SAVED_STEP_CODE/);
    }
    await open();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const view of ["Structured steps", "Gherkin steps", "Coded steps"]) {
        await tab(view).click();
        await assertFits(`${view} at ${width}px`);
      }
    }
    assert.deepEqual(await page.evaluate(() => window.fixtureApiCalls.filter(call => ["create", "update", "delete", "record", "start", "complete"].includes(call.method))), [], "Changing the presentation never saves new execution outcomes");
    assert.deepEqual(errors, []);
  } catch (error) {
    if (page && process.env.BROWSER_SCREENSHOT_DIR) {
      await page.screenshot({ path: join(process.env.BROWSER_SCREENSHOT_DIR, "run-step-views-failure.png"), animations: "disabled" });
      await writeFile(join(process.env.BROWSER_SCREENSHOT_DIR, "run-step-views-failure.html"), await page.content());
    }
    throw error;
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(source)]);
  }
});
