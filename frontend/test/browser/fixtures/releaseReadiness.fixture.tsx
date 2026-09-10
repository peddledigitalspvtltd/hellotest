import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "/src/auth/AuthContext";
import { api, sessionStorage } from "/src/lib/api";
import {
  LocalizationProvider,
  useLocalization,
} from "/src/context/LocalizationContext";
import { setCurrentScope } from "/src/hooks/useCurrentProject";
import { ReleaseReadinessDashboard } from "/src/components/ReleaseReadinessDashboard";
import "/src/styles.css";
import "/src/dark-theme.css";
import "/src/modal-system.css";
import "/src/workspace-layout.css";
const scenario = new URLSearchParams(location.search).get("scenario") || "";
window.readinessCalls = [];
window.readinessDenyBugs = scenario === "restricted";
window.readinessFailBugs = false;
const call = (kind, input) => window.readinessCalls.push({ kind, input });
const session = {
  token: "fixture",
  user: {
    id: "qa",
    name: "QA Reviewer",
    email: "qa@example.test",
    role: "admin",
  },
};
sessionStorage.write(session);
setCurrentScope("project", "app");
for (const methods of Object.values(api))
  if (methods && typeof methods === "object")
    for (const [name, value] of Object.entries(methods))
      if (typeof value === "function") methods[name] = async () => [];
api.auth.session = async () => session;
api.featureFlags.snapshot = async () => ({
  flags: Object.fromEntries(
    [
      "hellotest.ops.projects",
          "hellotest.analytics.dashboards",
          "hellotest.manual.suites",
      "hellotest.manual.requirements",
      "hellotest.manual.test_cases",
      "hellotest.manual.runs",
      "hellotest.manual.bugs",
      "hellotest.ai.quality_insights",
    ].map((x) => [
      x,
      x === "hellotest.manual.bugs" ? !window.readinessDenyBugs : true,
    ]),
  ),
});
api.settings.getWorkspacePreferences = async () => ({ preferences: {} });
api.projects.list = async () => [
  { id: "project", name: "Commerce platform", key: "CP" },
];
const date = new Date().toISOString();
const stories = [
  {
    id: "s1",
    display_id: "CP-142",
    title: "Customers can securely complete checkout",
    priority: 1,
    test_case_ids: ["c1", "c2"],
    status: "In progress",
  },
  {
    id: "s2",
    display_id: "CP-143",
    title: "Recover abandoned payments without a duplicate charge",
    priority: 1,
    test_case_ids: [],
    status: "Ready for QA",
  },
  {
    id: "s3",
    display_id: "CP-144",
    title: "Display localized order confirmation",
    priority: 3,
    test_case_ids: ["c3"],
    status: "Done",
  },
].map((x) => ({
  ...x,
  project_id: "project",
  fix_version: "Autumn 2026",
  sprint: "Sprint 24",
  created_at: date,
  updated_at: date,
}));
const cases = [
  { id: "c1", title: "Card payment succeeds", requirement_ids: ["s1"] },
  {
    id: "c2",
    title: "Expired cards show a helpful message",
    requirement_ids: ["s1"],
  },
  {
    id: "c3",
    title: "Confirmation uses customer locale",
    requirement_ids: ["s3"],
  },
].map((x) => ({
  ...x,
  app_type_id: "app",
  project_id: "project",
  step_count: 4,
  summary_complete: true,
  detail_complete: true,
}));
const runs = [
  {
    id: "r1",
    project_id: "project",
    name: "Release candidate · Chrome and Safari",
    title: "Release candidate · Chrome and Safari",
    release: "Autumn 2026",
    sprint: "Sprint 24",
    test_case_ids: ["c1", "c2", "c3"],
    scope_case_count: 3,
    status: "running",
    created_at: date,
    started_at: date,
  },
];
const results = [
  {
    id: "res1",
    test_case_id: "c1",
    status: "failed",
    data_set_iteration_key: "card-a",
    defects: ["bug1"],
  },
  {
    id: "res2",
    test_case_id: "c1",
    status: "passed",
    data_set_iteration_key: "card-b",
  },
  { id: "res3", test_case_id: "c2", status: "paused" },
  { id: "res4", test_case_id: "c3", status: "passed" },
].map((x) => ({
  ...x,
  execution_id: "r1",
  app_type_id: "app",
  created_at: date,
  updated_at: date,
}));
const bugs = [
  {
    id: "bug1",
    jira_bug_key: "CP-208",
    title: "Payment is captured twice after retry",
    severity: "Critical",
    priority: "Highest",
    status: "Open",
    status_category: "todo",
    project_id: "project",
    fix_version: "Autumn 2026",
    sprint: "Sprint 24",
    linked_test_case_ids: ["c1"],
    linked_requirement_ids: ["s1"],
  },
];
const page = (items) => ({
  items,
  total: items.length,
  is_last: true,
  page: 1,
  page_size: 100,
});
api.requirements.listPage = async (input) => {
  call("stories", input);
  if (scenario === "empty" || input.project_id !== "project") return page([]);
  if (scenario === "partial" && !input.cursor)
    return {
      ...page(stories.slice(0, 2)),
      total: 3,
      is_last: false,
      next_cursor: "next",
    };
  return page(input.cursor ? stories.slice(2) : stories);
};
api.testCases.listPage = async (input) => {
  call("cases", input);
  return page(
    scenario === "empty" || input.project_id !== "project" ? [] : cases,
  );
};
api.issues.listPage = async (input) => {
  call("bugs", input);
  if (window.readinessFailBugs) throw new Error("Isolated connection failure");
  return page(
    scenario === "empty" || input.project_id !== "project" ? [] : bugs,
  );
};
api.requirementReleases.get = async () => scenario === "linked" ? {id:"linked",project_id:"project",fix_version:"Autumn 2026",requirement_count:1,requirements:[{...stories[1],fix_version:null}]} : ({
  id: "wrong",
  project_id: "other-project",
  fix_version: "Private release",
  requirements: [],
});
api.ai.qualityInsights = async (input) => {
  call("ai", input);
  return new Promise(
    (resolve) =>
      (window.finishReadinessAi = () =>
        resolve({
          insights: [],
          limitations: [],
          provenance: { evidence: [] },
          generation_mode: "deterministic",
          confidence: 0,
        })),
  );
};
api.executionResults.releaseReadiness = async (input) => {
  call("runs", input);
  return {
    executions:
      scenario === "empty" || input.project_id !== "project" ? [] : runs,
    results:
      scenario === "empty" || input.project_id !== "project" ? [] : results,
    complete: true,
    reasons: [],
    runs_scanned: 1,
    results_scanned: 4,
    candidate_results: 4,
    limits: { runs: 10, results: 300, results_per_run: 300 },
  };
};
function Preferences() {
  const { setPreferences } = useLocalization();
  const { refreshSession } = useAuth();
  window.revokeReadinessBugs = async () => {
    session.user.role = 'member';
    session.user.project_permissions = { project: ['dashboard.view','requirement.view','testcase.view','suite.view','run.view','result.view','project.view','quality_insight.view'] };
    api.auth.session = async () => structuredClone(session);
    await refreshSession();
  };
  window.setReadinessPreferences = setPreferences;
  window.changeReadinessProject = setCurrentScope;
  return null;
}
createRoot(document.getElementById("root")).render(
  <MemoryRouter
    initialEntries={[
      "/release-readiness?release=Autumn%202026" +
        (scenario === "wrong" ? "&release_id=wrong" : scenario === "linked" ? "&release_id=linked" : ""),
    ]}
  >
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AuthProvider>
        <LocalizationProvider userId="readiness-fixture">
          <Preferences />
          <div
            className="app-shell app-layout"
            style={{ gridTemplateColumns: "minmax(0,1fr)", padding: 0 }}
          >
            <main className="workspace-main" data-route="/release-readiness">
              <ReleaseReadinessDashboard />
            </main>
          </div>
        </LocalizationProvider>
      </AuthProvider>
    </QueryClientProvider>
  </MemoryRouter>,
);
