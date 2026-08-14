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
import { AiCaseAuthoringModal } from "./components/AiCaseAuthoringModal";
import { AiDesignStudioModal } from "./components/AiDesignStudioModal";
import type { AiAuthoredTestCasePreview, AiDesignedTestCaseCandidate, Integration, Requirement, TestCase } from "./types";

const requirements: Requirement[] = [
  {
    id: "story-142",
    display_id: "QAIRA-142",
    project_id: "project-1",
    title: "Customers can securely recover a forgotten password",
    description: "A customer needs a secure recovery path that does not expose whether an account exists.",
    priority: 2,
    status: "In Progress",
  },
  {
    id: "story-148",
    display_id: "QAIRA-148",
    project_id: "project-1",
    title: "Administrators can invalidate compromised sessions",
    description: "Administrators need an audited way to invalidate customer sessions after a security event.",
    priority: 2,
    status: "To Do",
  }
];

const integrations: Integration[] = [{
  id: "provider-1",
  name: "Configured provider",
  type: "llm",
  base_url: null,
  api_key: null,
  model: "governed-default",
  project_key: null,
  username: null,
  config: null,
  is_active: true
}];

const linkedCases: TestCase[] = [
  {
    id: "case-18",
    display_id: "TC-018",
    suite_id: null,
    title: "Request password recovery with a registered email",
    description: "Verifies the public recovery response and delivery behavior.",
    automated: "yes",
    priority: 2,
    status: "active",
    requirement_id: "story-142",
    requirement_ids: ["story-142"],
    step_count: 4
  }
];

const initialCandidates: AiDesignedTestCaseCandidate[] = [
  {
    client_id: "draft-case-1",
    title: "Complete password recovery with a valid single-use token",
    description: "Validates the complete customer recovery journey, token expiry boundary, and session invalidation after the new password is saved.",
    priority: 2,
    applicable_domain: "Web",
    requirement_ids: ["story-142"],
    requirement_titles: [requirements[0].title],
    step_count: 5,
    steps: [
      { step_order: 1, step_type: "web", action: "Open the password recovery page", expected_result: "The email field and recovery guidance are displayed" },
      { step_order: 2, step_type: "web", action: "Submit a registered customer email address", expected_result: "A neutral confirmation is shown without disclosing account existence" },
      { step_order: 3, step_type: "android", action: "Open the delivered recovery link within 15 minutes", expected_result: "The reset form accepts a compliant new password" },
      { step_order: 4, step_type: "ios", action: "Save the new password", expected_result: "The customer is shown a successful recovery confirmation" },
      { step_order: 5, step_type: "api", action: "Reuse a previously active session", expected_result: "The previous session is rejected and requires sign-in" }
    ]
  },
  {
    client_id: "draft-case-2",
    title: "Reject an expired password recovery token",
    description: "Covers the expiry boundary without weakening the account-enumeration response.",
    priority: 2,
    applicable_domain: "Security",
    requirement_ids: ["story-142"],
    requirement_titles: [requirements[0].title],
    step_count: 3,
    steps: [
      { step_order: 1, step_type: "web", action: "Open a recovery link after its 15-minute lifetime", expected_result: "The reset form does not accept the expired token" },
      { step_order: 2, step_type: "api", action: "Request a new recovery link", expected_result: "A neutral confirmation is shown" },
      { step_order: 3, step_type: "web", action: "Open the replacement link", expected_result: "Only the newest valid token can continue" }
    ]
  }
];

const initialImprovement: AiAuthoredTestCasePreview = {
  title: "Recover an account with a secure single-use token",
  description: "Verifies the customer recovery journey with explicit expiry, neutral responses, reusable test data, and observable session invalidation.",
  summary: "Adds security boundaries and clearer expected evidence while preserving the selected case intent.",
  parameter_values: {
    registered_email: "customer@example.com",
    compliant_password: "SafePassphrase!2026"
  },
  step_count: 5,
  parameter_count: 2,
  steps: [
    { step_order: 1, step_type: "web", action: "Open the password recovery page", expected_result: "The recovery form is displayed" },
    { step_order: 2, step_type: "web", action: "Submit @t.registered_email", expected_result: "A neutral confirmation is displayed" },
    { step_order: 3, step_type: "web", action: "Open the newest recovery link within 15 minutes", expected_result: "The password form is available" },
    { step_order: 4, step_type: "web", action: "Save @t.compliant_password", expected_result: "The password is updated successfully" },
    { step_order: 5, step_type: "api", action: "Reuse the previous authenticated session", expected_result: "The old session is rejected" }
  ]
};

const params = new URLSearchParams(window.location.search);
const previewMode = params.get("mode") === "improve" ? "improve" : "generate";
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false }
  }
});

document.body.dataset.qaRuntimeErrors = "0";
window.addEventListener("error", () => {
  document.body.dataset.qaRuntimeErrors = String(Number(document.body.dataset.qaRuntimeErrors || 0) + 1);
});
window.addEventListener("unhandledrejection", () => {
  document.body.dataset.qaRuntimeErrors = String(Number(document.body.dataset.qaRuntimeErrors || 0) + 1);
});

function Preview() {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [improvement, setImprovement] = useState<AiAuthoredTestCasePreview | null>(initialImprovement);
  const [requirementIds, setRequirementIds] = useState(["story-142"]);
  const [requirementId, setRequirementId] = useState("story-142");
  const [prompt, setPrompt] = useState("");
  const [links, setLinks] = useState("");

  if (previewMode === "improve") {
    return (
      <AiCaseAuthoringModal
        additionalContext={prompt}
        applyLabel="Apply Reviewed Improvement"
        closeDisabled={false}
        disableApply={!improvement}
        disableGenerate={false}
        externalLinksText={links}
        hasAutomationWarning={false}
        integrationId="provider-1"
        integrations={integrations}
        isApplying={false}
        isCreating={false}
        isPreviewing={false}
        onAddImages={() => undefined}
        onAdditionalContextChange={setPrompt}
        onApply={() => { document.body.dataset.qaApplied = "true"; }}
        onClose={() => { document.body.dataset.qaClosed = "true"; }}
        onExternalLinksTextChange={setLinks}
        onGenerate={() => setImprovement(initialImprovement)}
        onIntegrationIdChange={() => undefined}
        onPreviewChange={setImprovement}
        onPreviewMessageDismiss={() => undefined}
        onRemoveImage={() => undefined}
        onRequirementChange={setRequirementId}
        preview={improvement}
        previewMessage=""
        previewTone="success"
        referenceImages={[]}
        requirementId={requirementId}
        requirements={requirements}
        sourceDraft={{
          title: "Request password recovery with a registered email",
          description: "Verifies the public recovery response and delivery behavior.",
          parameter_values: { registered_email: "customer@example.com" },
          steps: [
            { step_order: 1, step_type: "web", action: "Open password recovery", expected_result: "Recovery form appears" },
            { step_order: 2, step_type: "web", action: "Submit the registered email", expected_result: "Confirmation is shown" }
          ]
        }}
      />
    );
  }

  return (
    <AiDesignStudioModal
      acceptLabel="Accept Into Test Case Library"
      additionalContext={prompt}
      allowMultipleRequirements
      appTypeName="Web Project"
      closeDisabled={false}
      disableAccept={!candidates.length}
      disablePreview={false}
      disableSchedule={false}
      existingCases={linkedCases}
      existingCasesSubtitle="Reusable coverage already mapped to the selected Jira Story scope."
      existingCasesTitle="Linked test cases"
      externalLinksText={links}
      eyebrow="AI Test Case Generation"
      integrationId="provider-1"
      integrations={integrations}
      isAccepting={false}
      isPreviewing={false}
      isScheduling={false}
      maxCases={2}
      onAccept={() => { document.body.dataset.qaAccepted = "true"; }}
      onAddImages={() => undefined}
      onAdditionalContextChange={setPrompt}
      onClose={() => { document.body.dataset.qaClosed = "true"; }}
      onExternalLinksTextChange={setLinks}
      onIntegrationIdChange={() => undefined}
      onMaxCasesChange={() => undefined}
      onPreview={() => setCandidates(initialCandidates)}
      onPreviewCaseChange={(clientId, next) => setCandidates((current) => current.map((candidate) => candidate.client_id === clientId ? next : candidate))}
      onPreviewMessageDismiss={() => undefined}
      onRemoveImage={() => undefined}
      onRemovePreviewCase={(clientId) => setCandidates((current) => current.filter((candidate) => candidate.client_id !== clientId))}
      onRequirementSelectionChange={setRequirementIds}
      onSchedule={() => { document.body.dataset.qaScheduled = "true"; }}
      onTogglePreviewRequirement={(clientId, nextRequirementId) => setCandidates((current) => current.map((candidate) => candidate.client_id === clientId ? {
        ...candidate,
        requirement_ids: candidate.requirement_ids.includes(nextRequirementId)
          ? candidate.requirement_ids.filter((id) => id !== nextRequirementId)
          : [...candidate.requirement_ids, nextRequirementId]
      } : candidate))}
      onViewExistingCase={() => { document.body.dataset.qaExistingOpened = "true"; }}
      previewCases={candidates}
      previewMessage=""
      previewTone="success"
      referenceImages={[]}
      requirementHelpText="Select one or more Jira Stories, then review generated reusable coverage before accepting it."
      requirementLabel="Stories"
      requirements={requirements}
      selectedRequirementIds={requirementIds}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <Preview />
  </QueryClientProvider>
);
