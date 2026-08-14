import { useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import "./styles.css";
import "./modal-system.css";
import "./execution-run-builder.css";
import { ExecutionCreateModal } from "./pages/ExecutionsPage";
import type { AppType, Integration, Project, SmartExecutionPreviewResponse, TestCase, TestSuite } from "./types";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: Infinity },
    mutations: { retry: false }
  }
});
queryClient.setQueryData(["test-environments", "project-1", "app-1"], []);
queryClient.setQueryData(["test-configurations", "project-1", "app-1"], []);
queryClient.setQueryData(["test-data-sets", "project-1", "app-1"], []);

const projects: Project[] = [{
  id: "project-1",
  name: "HelloTest Jira Cloud",
  description: "Customer identity and access platform",
  created_by: "user-1"
}];

const appTypes: AppType[] = [{
  id: "app-1",
  project_id: "project-1",
  name: "Web Project",
  type: "web",
  is_unified: 0
}];

const integrations: Integration[] = [{
  id: "provider-1",
  name: "Governed QA model",
  type: "llm",
  base_url: null,
  api_key: null,
  model: "qaira-risk-review-v2",
  project_key: null,
  username: null,
  config: null,
  is_active: true
}];

const libraryCases: TestCase[] = [
  {
    id: "case-1",
    app_type_id: "app-1",
    suite_id: "suite-default",
    title: "Complete password recovery with a valid token",
    description: "Validates token use, customer confirmation, and session invalidation.",
    automated: "yes",
    priority: 1,
    status: "active",
    requirement_id: "story-142",
    step_count: 5
  },
  {
    id: "case-2",
    app_type_id: "app-1",
    suite_id: "suite-default",
    title: "Reject expired and replayed recovery tokens",
    description: "Covers expiry and replay boundaries across the recovery flow.",
    automated: "yes",
    priority: 1,
    status: "active",
    requirement_id: "story-142",
    step_count: 4
  },
  {
    id: "case-3",
    app_type_id: "app-1",
    suite_id: "suite-default",
    title: "Verify neutral response for unknown accounts",
    description: "Protects against account enumeration in the public recovery response.",
    automated: "no",
    priority: 2,
    status: "active",
    requirement_id: "story-142",
    step_count: 3
  }
];

const scopeSuites: TestSuite[] = [{
  id: "suite-default",
  display_id: "TS-001",
  app_type_id: "app-1",
  name: "Default",
  parent_id: null,
  labels: ["release"],
  test_case_ids: libraryCases.map((testCase) => testCase.id)
}];

const preview: SmartExecutionPreviewResponse = {
  integration: { id: "provider-1", name: "Governed QA model", type: "llm", model: "qaira-risk-review-v2" },
  app_type: { id: "app-1", name: "Web Project" },
  default_suite: { id: "suite-default", name: "Default" },
  delivery_scope: { release: "2026.08", sprint: "Identity Sprint 18", build: "sha-88219" },
  source_case_count: 38,
  matched_case_count: 3,
  evidence_summary: {
    scoped_requirement_count: 4,
    scoped_bug_count: 3,
    scoped_run_count: 7,
    failed_case_count: 2,
    blocked_case_count: 1,
    candidate_case_count: 38,
    returned_case_count: 3,
    scanned_case_count: 38,
    scan_truncated: false
  },
  query_strategy: ["Exact Sprint", "Release match", "Failed evidence", "Story links"],
  retrieved_context_count: 26,
  execution_name: "Identity Sprint 18 · risk-focused regression",
  summary: "Prioritizes password recovery regressions with recent failures, open Bugs, and release-linked Story evidence.",
  generation_mode: "llm",
  cases: [
    {
      test_case_id: "case-1",
      title: "Complete password recovery with a valid token",
      description: "Validates token use, customer confirmation, and session invalidation.",
      priority: 1,
      status: "active",
      suite_names: ["Default"],
      module_names: ["Identity"],
      requirement_titles: ["Customers can securely recover a forgotten password"],
      step_count: 5,
      reason: "Recent failed evidence and an open release blocker affect the core recovery journey.",
      signals: ["recent failure", "release blocker"],
      selection_basis: ["Sprint match"],
      risk_score: 94,
      impact_level: "critical",
      failure_count: 2,
      bug_count: 1,
      evidence: { result_ids: ["result-1", "result-2"], bug_ids: ["bug-1"], requirement_ids: ["story-142"], run_ids: ["run-1"] }
    },
    {
      test_case_id: "case-2",
      title: "Reject expired and replayed recovery tokens",
      description: "Covers expiry and replay boundaries across the recovery flow.",
      priority: 1,
      status: "active",
      suite_names: ["Default"],
      module_names: ["Security"],
      requirement_titles: ["Customers can securely recover a forgotten password"],
      step_count: 4,
      reason: "Token handling changed in the selected build and maps to the impacted Story.",
      signals: ["changed code", "security boundary"],
      selection_basis: ["Build match"],
      risk_score: 82,
      impact_level: "high",
      blocked_count: 1,
      evidence: { result_ids: ["result-3"], bug_ids: [], requirement_ids: ["story-142"], run_ids: ["run-2"] }
    },
    {
      test_case_id: "case-3",
      title: "Verify neutral response for unknown accounts",
      description: "Protects against account enumeration in the public recovery response.",
      priority: 2,
      status: "active",
      suite_names: ["Default"],
      module_names: ["Identity"],
      requirement_titles: ["Customers can securely recover a forgotten password"],
      step_count: 3,
      reason: "This is adjacent Story-linked coverage with customer privacy impact.",
      signals: ["Story link", "privacy"],
      selection_basis: ["Requirement expansion"],
      risk_score: 67,
      impact_level: "medium",
      evidence: { result_ids: [], bug_ids: [], requirement_ids: ["story-142"], run_ids: [] }
    }
  ]
};

document.body.dataset.qaRuntimeErrors = "0";
window.addEventListener("error", () => {
  document.body.dataset.qaRuntimeErrors = String(Number(document.body.dataset.qaRuntimeErrors || 0) + 1);
});
window.addEventListener("unhandledrejection", () => {
  document.body.dataset.qaRuntimeErrors = String(Number(document.body.dataset.qaRuntimeErrors || 0) + 1);
});

function Preview() {
  const [selectedRequirementIds, setSelectedRequirementIds] = useState(["story-142", "story-148"]);
  const [selectedCaseIds, setSelectedCaseIds] = useState(["case-1", "case-2"]);
  const [releaseScope, setReleaseScope] = useState("Password recovery, token security, session invalidation, and account-enumeration boundaries.");
  const [additionalContext, setAdditionalContext] = useState("Production rollout reaches enterprise customers first; prioritize observable security evidence.");
  const [requirementSearch, setRequirementSearch] = useState("");

  return (
    <ExecutionCreateModal
      appTypeId="app-1"
      appTypes={appTypes}
      assigneeOptions={[]}
      buildOptions={["sha-88219", "sha-88192"]}
      canConfigureParallelAutomation={false}
      canCreateExecution
      canRunLocalAutomation={false}
      canRunRemoteAutomation={false}
      canUseRunAi
      executionBuild="sha-88219"
      executionCreateMode="smart"
      executionHookDraft={[]}
      executionName="Identity Sprint 18 · risk-focused regression"
      executionParallelCount={1}
      executionParallelEnabled={false}
      executionRelease="2026.08"
      executionSprint="Identity Sprint 18"
      executionStartMode="manual"
      integrations={integrations}
      isPreviewingSmartExecution={false}
      isSubmitting={false}
      libraryCases={libraryCases}
      onAppTypeChange={() => undefined}
      onAssigneeChange={() => undefined}
      onClearSmartExecutionCases={() => setSelectedCaseIds([])}
      onClearSmartExecutionRequirements={() => setSelectedRequirementIds([])}
      onClose={() => { document.body.dataset.qaClosed = "true"; }}
      onConfigurationChange={() => undefined}
      onDataSetChange={() => undefined}
      onEnvironmentChange={() => undefined}
      onExecutionBuildChange={() => undefined}
      onExecutionCreateModeChange={() => undefined}
      onExecutionHookDraftChange={() => undefined}
      onExecutionNameChange={() => undefined}
      onExecutionParallelCountChange={() => undefined}
      onExecutionParallelEnabledChange={() => undefined}
      onExecutionReleaseChange={() => undefined}
      onExecutionSprintChange={() => undefined}
      onExecutionStartModeChange={() => undefined}
      onPreviewSmartExecution={() => { document.body.dataset.qaPreviewed = "true"; }}
      onProjectChange={() => undefined}
      onSelectAllSmartExecutionCases={() => setSelectedCaseIds(preview.cases.map((testCase) => testCase.test_case_id))}
      onSelectAllSmartExecutionRequirements={(ids) => setSelectedRequirementIds((current) => Array.from(new Set([...current, ...ids])))}
      onSmartExecutionAdditionalContextChange={setAdditionalContext}
      onSmartExecutionIntegrationChange={() => undefined}
      onSmartExecutionReleaseScopeChange={setReleaseScope}
      onSmartExecutionRequirementSearchChange={setRequirementSearch}
      onSubmit={(event) => { event.preventDefault(); document.body.dataset.qaSubmitted = "true"; }}
      onSuiteSelectionChange={() => undefined}
      onToggleSmartExecutionCase={(id) => setSelectedCaseIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
      onToggleSmartExecutionRequirement={(id) => setSelectedRequirementIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
      projectId="project-1"
      projects={projects}
      releaseOptions={[{ value: "2026.08", label: "2026.08 · August release" }]}
      scopeSuites={scopeSuites}
      selectedAppType="Web Project"
      selectedConfigurationId=""
      selectedDataSetId=""
      selectedEnvironmentId=""
      selectedExecutionAssigneeIds={[]}
      selectedProject="HelloTest Jira Cloud"
      selectedSmartExecutionCaseIds={selectedCaseIds}
      selectedSmartRequirementIds={selectedRequirementIds}
      selectedSuiteIds={[]}
      smartExecutionAdditionalContext={additionalContext}
      smartExecutionIntegrationId="provider-1"
      smartExecutionPreview={preview}
      smartExecutionPreviewMessage="Plan generated from current Jira and HelloTest evidence. Review every selected case before creation."
      smartExecutionPreviewTone="success"
      smartExecutionReleaseScope={releaseScope}
      smartExecutionRequirementOptions={[
        { id: "story-142", title: "Customers can securely recover a forgotten password", description: "Recovery tokens are time-bound and single use.", linkedCaseCount: 3 },
        { id: "story-148", title: "Administrators can invalidate compromised sessions", description: "Security events invalidate active sessions with an audit trail.", linkedCaseCount: 2 },
        { id: "story-151", title: "Customers receive a neutral recovery response", description: "Public responses must not disclose whether an account exists.", linkedCaseCount: 1 }
      ]}
      smartExecutionRequirementSearch={requirementSearch}
      sprintOptions={[{ value: "Identity Sprint 18", label: "Identity Sprint 18" }]}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <Preview />
  </QueryClientProvider>
);
