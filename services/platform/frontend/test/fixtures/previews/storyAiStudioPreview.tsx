import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  IconCirclePlus,
  IconDatabase,
  IconLibraryPlus,
  IconPhotoPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconUpload,
  IconX
} from "@tabler/icons-react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import "../../../src/styles.css";
import "../../../src/modal-system.css";
import "../../../../../manual/frontend/pages/RequirementsPage.ai.css";
import { FormField } from "../../../src/shared/components/FormField";
import {
  StoryAiDraftInspector,
  StoryAiDraftQueue,
  type StoryAiStudioDraft,
  type StoryAiStudioFieldSelection
} from "../../../../../ai/frontend/components/StoryAiStudioContent";
import { StoryAiStudioShell, type StoryAiStudioNavKey } from "../../../../../ai/frontend/components/StoryAiStudioShell";
import "./storyAiStudioPreview.css";

const previewParams = new URLSearchParams(window.location.search);
const previewMode = previewParams.get("mode") === "complete" ? "improve" : "create";
const startGenerated = previewMode === "create" || previewParams.get("state") === "generated";
const startWithExistingReview = previewParams.get("review") === "existing";

document.body.dataset.qaRuntimeErrors = "0";
window.addEventListener("error", () => {
  document.body.dataset.qaRuntimeErrors = String(Number(document.body.dataset.qaRuntimeErrors || 0) + 1);
});
window.addEventListener("unhandledrejection", () => {
  document.body.dataset.qaRuntimeErrors = String(Number(document.body.dataset.qaRuntimeErrors || 0) + 1);
});

const createDrafts: StoryAiStudioDraft[] = [
  {
    id: "draft-1",
    sequence: 1,
    title: "As a user, I can reset my password via email link",
    description: "In order to regain access to my account when I forget my password, I need a secure mechanism to verify my identity and set a new password via my registered email address.",
    acceptanceCriteria: [
      "The user must enter a valid email address on the \"Forgot Password\" screen.",
      "If the email exists, a secure, time-limited token (valid for 15 minutes) is generated and sent via email.",
      "The email contains a unique link to the password reset form.",
      "The reset form requires the new password to meet standard complexity requirements.",
      "Upon successful reset, all active sessions for the user are terminated."
    ],
    gherkinScenarios: [
      "Scenario: Successful password reset request\nGiven the user is on the \"Forgot Password\" page\nWhen they enter a valid registered email address\nAnd they submit the request\nThen a reset email should be sent with a 15-minute token\nAnd a success message should be displayed confirming the email was sent"
    ],
    estimateLabel: "3 Points",
    confidenceLabel: "95% Conf.",
    generated: true,
    status: "To Do",
    priority: 3,
    externalReferences: ["Auth_Requirements_v2.pdf"],
    risks: ["Password-reset enumeration and token replay require explicit test coverage."],
    openQuestions: ["Should support agents be able to invalidate the token manually?"],
    rationale: "Based on your security guidelines provided in \"Auth_Requirements_v2.pdf\", the AI prioritized session invalidation upon reset. The 15-minute token expiry is standard OWASP recommendation for password reset flows. No complexity rules were explicitly stated in the prompt, so standard defaults were assumed."
  },
  {
    id: "draft-2",
    sequence: 2,
    title: "As an admin, I can bulk delete outdated user sessions",
    description: "Administrators need a governed bulk action that removes expired sessions while protecting active customer access.",
    acceptanceCriteria: ["Only expired sessions are eligible.", "The action requires confirmation and writes an audit record."],
    gherkinScenarios: ["Scenario: Bulk-delete expired sessions\nGiven an administrator has selected expired sessions\nWhen they confirm the bulk action\nThen only the selected expired sessions are deleted\nAnd an audit record is written"],
    estimateLabel: "5 Points",
    confidenceLabel: "88% Conf.",
    generated: true,
    status: "To Do",
    priority: 2,
    rationale: "The draft keeps destructive administration bounded, confirmable, and auditable."
  },
  {
    id: "draft-3",
    sequence: 3,
    title: "Implement rate limiting on the login API endpoint",
    description: "Protect the authentication endpoint from automated credential attacks without blocking legitimate retries.",
    acceptanceCriteria: ["Requests are limited by account and source signal.", "Clients receive a stable retry response."],
    gherkinScenarios: ["Scenario: Login requests exceed the threshold\nGiven repeated login attempts exceed the configured threshold\nWhen another request is submitted\nThen the API returns a rate-limit response\nAnd includes a retry interval"],
    estimateLabel: "2 Points",
    confidenceLabel: "92% Conf.",
    generated: true,
    status: "To Do",
    priority: 2,
    rationale: "The draft adds a bounded security control at the highest-risk authentication entry point."
  }
];

const existingStory: StoryAiStudioDraft = {
  id: "HELLOTEST-142:existing",
  displayId: "HELLOTEST-142",
  title: "Customers can recover access after forgetting their password",
  description: "A customer who cannot remember their password needs a secure recovery flow so they can regain account access without contacting support.",
  gherkinScenarios: [
    "Scenario: Existing recovery entry point\nGiven a customer is on the sign-in page\nWhen they choose Forgot password\nThen the recovery form is displayed"
  ],
  estimateLabel: "P2 Priority",
  confidenceLabel: "Existing Story",
  generated: false,
  status: "In Progress",
  priority: 2,
  labels: ["authentication", "customer-access"],
  sprint: "Sprint 42",
  release: "2026.08",
  externalReferences: ["Security requirements", "Recovery flow v2"]
};

const completedStory: StoryAiStudioDraft = {
  ...existingStory,
  id: "HELLOTEST-142:generated",
  sequence: 1,
  title: "As a customer, I can securely reset my forgotten password",
  description: "A customer who forgets their password can verify their identity through their registered email address and create a new password without exposing whether an account exists.",
  acceptanceCriteria: [
    "The recovery response is identical for registered and unregistered email addresses.",
    "A single-use reset token expires after 15 minutes.",
    "Successful reset invalidates the customer’s active sessions.",
    "The new password must satisfy the project security policy."
  ],
  gherkinScenarios: [
    "Scenario: Customer completes password recovery\nGiven the customer requested recovery for their registered email\nWhen they open the valid reset link and save a compliant password\nThen the password is changed\nAnd every previous active session is invalidated"
  ],
  confidenceLabel: "AI Completed",
  generated: true,
  status: "In Progress",
  priority: 2,
  risks: ["The response must not disclose whether the supplied address belongs to an account."],
  openQuestions: ["Should trusted-device sessions also be invalidated?"],
  rationale: "The completion preserves the selected Story’s recovery intent and adds the missing identity, expiry, enumeration, and session-invalidation boundaries."
};

function mark(name: string, value = "true") {
  document.body.dataset[name] = value;
}

function PreviewContextPanel({
  links,
  mode,
  onLinksChange,
  onPromptChange,
  prompt
}: {
  links: string;
  mode: "create" | "improve";
  onLinksChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  prompt: string;
}) {
  const smartCopy = mode === "create"
    ? "Package project knowledge and safe reference files for new Story drafts."
    : "Package the selected Story, relevant project knowledge, and safe files without replacing the Story's existing intent.";
  const promptPlaceholder = mode === "create"
    ? "Product outcome, target persona, acceptance boundaries, delivery constraints, risks..."
    : "Missing acceptance detail, risks, assumptions, questions, or constraints to complete...";

  return (
    <section className="ai-studio-panel ai-prompt-context-panel">
      <div aria-label="Additional context" className="ai-prompt-context-head">
        <span>Prompt instructions</span>
        <button className="ghost-button compact ai-prompt-template-trigger" onClick={() => mark("qaTemplates")} type="button"><IconSearch size={16} stroke={1.9} />Templates</button>
      </div>
      <div className="ai-smart-context-card">
        <div><strong>Smart context</strong><span>{smartCopy}</span></div>
        <div className="ai-smart-context-actions">
          <label className="ghost-button compact ai-context-file-button">
            <input multiple onChange={() => mark("qaFiles")} type="file" />
            <IconUpload size={16} stroke={1.9} /><span>Add files</span>
          </label>
          <button className="primary-button compact ai-smart-context-button" onClick={() => mark("qaContext")} type="button"><IconCirclePlus size={16} stroke={1.9} /><span>Context</span></button>
        </div>
      </div>
      <FormField className="ai-prompt-copy-field" label="Prompt copy">
        <textarea onChange={(event) => onPromptChange(event.target.value)} placeholder={promptPlaceholder} rows={5} value={prompt} />
      </FormField>
      <FormField className="ai-external-links-field" label="External links">
        <textarea onChange={(event) => onLinksChange(event.target.value)} placeholder="One link per line" rows={3} value={links} />
      </FormField>
      <FormField className="ai-reference-photos-field" label="Reference photos">
        <label className="ai-reference-upload-zone">
          <input accept="image/*" multiple onChange={() => mark("qaImages")} type="file" />
          <IconPhotoPlus aria-hidden="true" size={24} stroke={1.8} />
          <span>Add product references or screenshots.</span>
          <strong>Choose files</strong>
        </label>
      </FormField>
    </section>
  );
}

function Preview() {
  const [includeGherkin, setIncludeGherkin] = useState(true);
  const [nav, setNav] = useState<StoryAiStudioNavKey>("drafts");
  const [drafts, setDrafts] = useState(createDrafts);
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [activeDraftId, setActiveDraftId] = useState("draft-1");
  const [hasCompletedSuggestion, setHasCompletedSuggestion] = useState(previewMode === "improve" && startGenerated);
  const [activeCompletionReview, setActiveCompletionReview] = useState<"existing" | "generated">(
    previewMode === "improve" && startGenerated && !startWithExistingReview ? "generated" : "existing"
  );
  const [completeDraft, setCompleteDraft] = useState(completedStory);
  const [prompt, setPrompt] = useState("");
  const [links, setLinks] = useState("");
  const [fieldChecks, setFieldChecks] = useState<Record<string, boolean>>({
    title: true,
    description: true,
    references: true,
    priority: true,
    status: true,
    gherkin: true
  });

  const modeDrafts = previewMode === "create"
    ? drafts
    : hasCompletedSuggestion ? [existingStory, completeDraft] : [existingStory];
  const activeDraft = previewMode === "create"
    ? drafts.find((draft) => draft.id === activeDraftId) || drafts[0] || null
    : activeCompletionReview === "generated" && hasCompletedSuggestion ? completeDraft : existingStory;
  const fieldSelection: StoryAiStudioFieldSelection[] = useMemo(() => previewMode === "improve" && activeCompletionReview === "generated" && hasCompletedSuggestion ? [
    { key: "title", label: "Title", value: completeDraft.title, checked: fieldChecks.title },
    { key: "description", label: "Description package", value: completeDraft.description, checked: fieldChecks.description },
    { key: "references", label: "References", value: completeDraft.externalReferences?.join(" · ") || "", checked: fieldChecks.references },
    { key: "priority", label: "Priority", value: `P${completeDraft.priority || 3}`, checked: fieldChecks.priority },
    { key: "status", label: "Status", value: completeDraft.status || "Not set", checked: fieldChecks.status },
    { key: "gherkin", label: "Gherkin scenarios", value: `${completeDraft.gherkinScenarios?.length || 0} generated`, checked: fieldChecks.gherkin }
  ] : [], [activeCompletionReview, completeDraft, fieldChecks, hasCompletedSuggestion]);

  const updateActive = (patch: Partial<StoryAiStudioDraft>) => {
    if (previewMode === "create") {
      setDrafts((current) => current.map((draft) => draft.id === activeDraftId ? { ...draft, ...patch } : draft));
    } else if (activeCompletionReview === "generated" && hasCompletedSuggestion) {
      setCompleteDraft((current) => ({ ...current, ...patch }));
    } else {
      return;
    }
    mark("qaEdited");
  };

  return (
    <main className="story-ai-preview-root">
      <StoryAiStudioShell
        closeDisabled={false}
        commandBar={(
          <>
            <div className="story-studio-command-bar__secondary">
              <button
                className="story-studio-command-button"
                disabled={!activeDraft}
                onClick={() => {
                  mark("qaDeclined");
                  if (previewMode === "create") {
                    setDrafts((current) => current.filter((draft) => draft.id !== activeDraftId));
                    setSelectedDraftIds((current) => current.filter((id) => id !== activeDraftId));
                  } else {
                    setHasCompletedSuggestion(false);
                    setActiveCompletionReview("existing");
                  }
                }}
                type="button"
              >
                <IconX size={18} stroke={2} />{previewMode === "create" ? "Decline Draft" : "Decline Changes"}
              </button>
              <button className="story-studio-command-button" onClick={() => {
                setHasCompletedSuggestion(true);
                setActiveCompletionReview("generated");
                mark("qaRegenerated");
              }} type="button">
                <IconRefresh size={18} stroke={2} />Regenerate
              </button>
            </div>
            <button
              className="story-studio-accept-button"
              disabled={previewMode === "create" ? !selectedDraftIds.length : !hasCompletedSuggestion || activeCompletionReview !== "generated"}
              onClick={() => mark(previewMode === "create" ? "qaAccepted" : "qaApplied")}
              type="button"
            >
              <IconLibraryPlus size={18} stroke={2} />{previewMode === "create" ? "Accept into Library" : "Apply to Story"}
            </button>
          </>
        )}
        descriptionId="story-preview-description"
        includeGherkin={includeGherkin}
        inspectorContent={(
          <StoryAiDraftInspector
            draft={activeDraft}
            editable={previewMode === "create" || activeCompletionReview === "generated" && hasCompletedSuggestion}
            fieldSelection={fieldSelection}
            onAcceptanceCriteriaChange={(criteria) => updateActive({ acceptanceCriteria: criteria })}
            onDescriptionChange={(description) => updateActive({ description })}
            onFieldSelectionChange={(key, checked) => {
              setFieldChecks((current) => ({ ...current, [key]: checked }));
              mark("qaFieldSelection");
            }}
            onGherkinScenariosChange={(gherkinScenarios) => updateActive({ gherkinScenarios })}
            onPriorityChange={(priority) => updateActive({ priority })}
            onTitleChange={(title) => updateActive({ title })}
            showGherkin={includeGherkin}
            showProperties={previewMode === "improve"}
          />
        )}
        mode={previewMode}
        navActive={nav}
        onClose={() => mark("qaClosed")}
        onIncludeGherkinChange={(value) => { setIncludeGherkin(value); mark("qaGherkin", String(value)); }}
        onNavChange={(next) => { setNav(next); mark("qaNav", next); }}
        onPrimaryGenerate={() => {
          setHasCompletedSuggestion(true);
          setActiveCompletionReview("generated");
          mark("qaGenerated");
        }}
        primaryGenerateLabel={previewMode === "create" ? "Generate drafts" : "Complete Story"}
        queuePane={(
          <StoryAiDraftQueue
            activeDraftId={previewMode === "create" ? activeDraftId : activeCompletionReview === "generated" && hasCompletedSuggestion ? completeDraft.id : existingStory.id}
            allowSelection={previewMode === "create"}
            drafts={modeDrafts}
            onActivateDraft={(draftId) => {
              if (previewMode === "create") setActiveDraftId(draftId);
              else setActiveCompletionReview(draftId.endsWith(":generated") ? "generated" : "existing");
              mark("qaActivated", draftId);
            }}
            onClearSelection={() => { setSelectedDraftIds([]); mark("qaCleared"); }}
            onSelectAll={(selected) => { setSelectedDraftIds(selected ? drafts.map((draft) => draft.id) : []); mark("qaSelectAll", String(selected)); }}
            onToggleDraft={(draftId, selected) => {
              setSelectedDraftIds((current) => selected ? [...new Set([...current, draftId])] : current.filter((id) => id !== draftId));
              mark("qaSelected", draftId);
            }}
            selectedDraftIds={previewMode === "create" ? selectedDraftIds : [activeCompletionReview === "generated" && hasCompletedSuggestion ? completeDraft.id : existingStory.id]}
          />
        )}
        settingsPane={(
          <div className="story-studio-settings-content">
            <section className="story-studio-settings-section story-studio-model-settings">
              <div className="story-studio-settings-heading"><IconSettings size={20} stroke={1.9} /><h2>Model Settings</h2></div>
              <p>Use a governed provider and a bounded review batch.</p>
              <div className="story-studio-model-grid">
                <FormField label="Provider"><select defaultValue=""><option value="">Configured prompt LLM</option></select></FormField>
                <FormField label="Count"><select defaultValue={previewMode === "create" ? "3" : "1"} disabled={previewMode === "improve"}><option value="3">3 drafts</option><option value="1">1 Story</option></select></FormField>
              </div>
            </section>
            <hr />
            <section className="story-studio-settings-section story-studio-data-sources">
              <div className="story-studio-settings-heading"><IconDatabase size={20} stroke={1.9} /><h2>Data Sources</h2></div>
              <p>Add project knowledge, safe text files, links, and screenshots.</p>
              <PreviewContextPanel links={links} mode={previewMode} onLinksChange={setLinks} onPromptChange={setPrompt} prompt={prompt} />
            </section>
          </div>
        )}
        titleId="story-preview-title"
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><Preview /></React.StrictMode>);

if (previewParams.has("exercise")) {
  window.setTimeout(() => {
    document.querySelector<HTMLButtonElement>('.story-studio-switch')?.click();
    [...document.querySelectorAll<HTMLButtonElement>('.story-studio-nav-item')].find((button) => button.textContent?.trim() === "Review")?.click();
    document.querySelector<HTMLInputElement>('.story-studio-draft-tile input')?.click();
    document.querySelector<HTMLButtonElement>('.story-studio-draft-tile:nth-child(2) .story-studio-draft-tile__activation')?.click();
    document.querySelector<HTMLButtonElement>('.story-studio-primary-action')?.click();
    window.setTimeout(() => {
      const finishExercise = () => {
        document.querySelector<HTMLButtonElement>('.story-studio-accept-button')?.click();
        const passed = document.body.dataset.qaRuntimeErrors === "0"
          && document.body.dataset.qaGherkin === "false"
          && document.body.dataset.qaNav === "review"
          && (previewMode === "create" ? document.body.dataset.qaSelected === "draft-1" : document.body.dataset.qaGenerated === "true")
          && (previewMode === "create" || document.body.dataset.qaComparisonGuard === "true")
          && (previewMode === "create" ? document.body.dataset.qaAccepted === "true" : document.body.dataset.qaApplied === "true");
        document.body.dataset.qaInteractionStatus = passed ? "passed" : "failed";
        const result = document.createElement("output");
        result.id = "qa-interaction-result";
        result.textContent = `Interaction QA: ${passed ? "passed" : "failed"} · runtime errors: ${document.body.dataset.qaRuntimeErrors}`;
        result.style.cssText = "position:fixed;z-index:9999;right:12px;top:76px;padding:8px 12px;border-radius:6px;background:#0f172a;color:#fff;font:600 12px/16px Inter,sans-serif;box-shadow:0 4px 12px rgba(15,23,42,.24)";
        document.body.append(result);
      };

      if (previewMode === "improve") {
        document.querySelectorAll<HTMLButtonElement>('.story-studio-draft-tile__activation')[0]?.click();
        window.setTimeout(() => {
          const tiles = document.querySelectorAll('.story-studio-draft-tile');
          const acceptButton = document.querySelector<HTMLButtonElement>('.story-studio-accept-button');
          mark("qaComparisonGuard", String(tiles.length === 2 && Boolean(acceptButton?.disabled)));
          document.querySelectorAll<HTMLButtonElement>('.story-studio-draft-tile__activation')[1]?.click();
          window.setTimeout(finishExercise, 100);
        }, 100);
      } else {
        finishExercise();
      }
    }, 250);
  }, 500);
}
