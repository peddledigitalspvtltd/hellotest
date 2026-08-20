import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDialogFocus } from "../hooks/useDialogFocus";
import type { AiPromptTemplate } from "../types";
import { AddIcon, SearchIcon, SparkIcon } from "./AppIcons";
import { DialogCloseButton } from "./DialogCloseButton";
import { FormField } from "./FormField";
import { InfoTooltip } from "./InfoTooltip";
import { LoadingState } from "./LoadingState";

export type AiPromptScope =
  | "requirement_creation"
  | "requirement_completion"
  | "test_case_generation"
  | "test_case_steps"
  | "bug_creation";

const DEFAULT_PROMPT_SCOPE: AiPromptScope = "test_case_generation";

type PromptScopeConfig = {
  triggerLabel: string;
  contextLabel: string;
  libraryTitle: string;
  libraryHelp: string;
  searchPlaceholder: string;
  emptyMessage: string;
  createTitle: string;
  createHelp: string;
  appliesTo: string[];
  domainLabel: string;
  domainPlaceholder: string;
  roleLabel: string;
  rolePlaceholder: string;
  typeLabel: string;
  typePlaceholder: string;
  formatLabel: string;
  formatPlaceholder: string;
  countLabel: string;
  countUnit: string;
  showCount: boolean;
  promptLabel: string;
  promptPlaceholder: string;
};

const PROMPT_SCOPE_CONFIGS: Record<AiPromptScope, PromptScopeConfig> = {
  requirement_creation: {
    triggerLabel: "Story templates",
    contextLabel: "Story creation prompt library",
    libraryTitle: "Choose or create a Story-generation template",
    libraryHelp: "Only Story-creation templates are shown. Applying one copies its guidance into this Story draft session.",
    searchPlaceholder: "Story format, persona, domain, or tag...",
    emptyMessage: "No Story-creation templates matched. Create one for this screen on the right.",
    createTitle: "Add Story template",
    createHelp: "Capture guidance for generating new testable Story drafts. It will not appear in Test Case or Bug dialogs.",
    appliesTo: ["requirements"],
    domainLabel: "Product domain",
    domainPlaceholder: "Payments, identity, reporting...",
    roleLabel: "Story persona",
    rolePlaceholder: "Customer, admin, support agent...",
    typeLabel: "Story pattern",
    typePlaceholder: "Feature, enabler, compliance...",
    formatLabel: "Acceptance format",
    formatPlaceholder: "Outcome-based, Gherkin-ready...",
    countLabel: "Draft count",
    countUnit: "drafts",
    showCount: true,
    promptLabel: "Story guidance",
    promptPlaceholder: "Describe the Story structure, acceptance boundaries, risks, and details the AI must preserve."
  },
  requirement_completion: {
    triggerLabel: "Completion templates",
    contextLabel: "Story completion prompt library",
    libraryTitle: "Choose or create a Story-completion template",
    libraryHelp: "Only Story-completion templates are shown. The selected Story remains the authoritative context.",
    searchPlaceholder: "Completion goal, persona, domain, or tag...",
    emptyMessage: "No Story-completion templates matched. Create one for this screen on the right.",
    createTitle: "Add completion template",
    createHelp: "Capture guidance for completing an existing Story without changing its intent.",
    appliesTo: ["requirements"],
    domainLabel: "Product domain",
    domainPlaceholder: "Payments, identity, reporting...",
    roleLabel: "Primary persona",
    rolePlaceholder: "Customer, admin, support agent...",
    typeLabel: "Completion focus",
    typePlaceholder: "Acceptance criteria, risks, edge cases...",
    formatLabel: "Output style",
    formatPlaceholder: "Concise, Gherkin-ready, audit-ready...",
    countLabel: "Suggestion count",
    countUnit: "suggestions",
    showCount: false,
    promptLabel: "Completion guidance",
    promptPlaceholder: "Describe what weak Story details to complete and what existing intent must remain unchanged."
  },
  test_case_generation: {
    triggerLabel: "Test Case templates",
    contextLabel: "Test Case generation prompt library",
    libraryTitle: "Choose or create a Test Case template",
    libraryHelp: "Only Test Case-generation templates are shown. Story and Bug templates stay in their own authoring screens.",
    searchPlaceholder: "Test type, role, domain, format, or tag...",
    emptyMessage: "No Test Case templates matched. Create one for this screen on the right.",
    createTitle: "Add Test Case template",
    createHelp: "Capture repeatable coverage guidance for generating reusable Test Case drafts.",
    appliesTo: ["test_cases"],
    domainLabel: "Product domain",
    domainPlaceholder: "Payments, auth, CRM...",
    roleLabel: "Test persona",
    rolePlaceholder: "Admin, guest, support user...",
    typeLabel: "Type of test",
    typePlaceholder: "Smoke, regression, negative...",
    formatLabel: "Case format",
    formatPlaceholder: "Manual, Gherkin, mobile-ready...",
    countLabel: "Case count",
    countUnit: "cases",
    showCount: true,
    promptLabel: "Test Case guidance",
    promptPlaceholder: "Describe coverage, step detail, expected results, data needs, and exclusions."
  },
  test_case_steps: {
    triggerLabel: "Step templates",
    contextLabel: "Test-step prompt library",
    libraryTitle: "Choose or create a Test Step template",
    libraryHelp: "Only step-authoring templates are shown. They extend the current Test Case rather than generating unrelated cases.",
    searchPlaceholder: "Platform, step style, evidence, or tag...",
    emptyMessage: "No Test Step templates matched. Create one for this screen on the right.",
    createTitle: "Add Test Step template",
    createHelp: "Capture how AI should structure actions, expected results, and reusable test data for the current case.",
    appliesTo: ["test_cases"],
    domainLabel: "Product domain",
    domainPlaceholder: "Payments, auth, CRM...",
    roleLabel: "Execution persona",
    rolePlaceholder: "Tester, customer, administrator...",
    typeLabel: "Step focus",
    typePlaceholder: "Happy path, negative, API, mobile...",
    formatLabel: "Step style",
    formatPlaceholder: "Atomic actions, data-driven, concise...",
    countLabel: "Step count",
    countUnit: "steps",
    showCount: false,
    promptLabel: "Step guidance",
    promptPlaceholder: "Describe the required action granularity, assertions, data tokens, and platform constraints."
  },
  bug_creation: {
    triggerLabel: "Bug templates",
    contextLabel: "Bug drafting prompt library",
    libraryTitle: "Choose or create a Bug-report template",
    libraryHelp: "Only Bug-drafting templates are shown. Failed evidence stays bounded to the current Bug context.",
    searchPlaceholder: "Failure type, evidence style, domain, or tag...",
    emptyMessage: "No Bug templates matched. Create one for this screen on the right.",
    createTitle: "Add Bug template",
    createHelp: "Capture ready-to-file reproduction and evidence guidance. It will not appear in Story or Test Case dialogs.",
    appliesTo: ["bugs"],
    domainLabel: "Affected domain",
    domainPlaceholder: "Checkout, identity, reporting...",
    roleLabel: "Affected persona",
    rolePlaceholder: "Customer, admin, support agent...",
    typeLabel: "Failure category",
    typePlaceholder: "Functional, visual, performance...",
    formatLabel: "Evidence format",
    formatPlaceholder: "Steps, expected vs actual, logs...",
    countLabel: "Draft count",
    countUnit: "drafts",
    showCount: false,
    promptLabel: "Bug guidance",
    promptPlaceholder: "Describe the reproduction detail, evidence, impact, and wording required for a ready-to-file Bug."
  }
};

const isAiPromptScope = (scope: string | undefined): scope is AiPromptScope =>
  Boolean(scope && scope in PROMPT_SCOPE_CONFIGS);

const getPromptScopeConfig = (scope: AiPromptScope) => PROMPT_SCOPE_CONFIGS[scope];

type Draft = {
  name: string;
  description: string;
  domain: string;
  role: string;
  test_type: string;
  test_format: string;
  test_count: string;
  prompt_text: string;
  tags: string;
};

const emptyDraft: Draft = {
  name: "",
  description: "",
  domain: "",
  role: "",
  test_type: "",
  test_format: "",
  test_count: "6",
  prompt_text: "",
  tags: ""
};

function compactJoin(items: Array<string | null | undefined>) {
  return items.map((item) => String(item || "").trim()).filter(Boolean).join(" · ");
}

export function renderAiPromptTemplate(template: AiPromptTemplate) {
  if (!isAiPromptScope(template.scope)) {
    return String(template.prompt_text || "").trim();
  }

  const scopeConfig = getPromptScopeConfig(template.scope);
  const lines = [
    template.domain ? `${scopeConfig.domainLabel}: ${template.domain}` : "",
    template.role ? `${scopeConfig.roleLabel}: ${template.role}` : "",
    template.test_type ? `${scopeConfig.typeLabel}: ${template.test_type}` : "",
    template.test_format ? `${scopeConfig.formatLabel}: ${template.test_format}` : "",
    template.test_count && scopeConfig.showCount ? `${scopeConfig.countLabel}: ${template.test_count}` : "",
    "",
    `${scopeConfig.promptLabel}:`,
    template.prompt_text
  ].filter((line, index, array) => line || array[index - 1] !== "");

  return lines.join("\n").trim();
}

export function AiPromptTemplatePicker({
  projectId,
  appTypeId,
  onApply,
  disabled = false,
  scope = DEFAULT_PROMPT_SCOPE
}: {
  projectId?: string;
  appTypeId?: string;
  onApply: (prompt: string, template: AiPromptTemplate) => void;
  disabled?: boolean;
  scope?: AiPromptScope;
}) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const scopeConfig = getPromptScopeConfig(scope);
  const query = useQuery({
    queryKey: ["ai-prompt-templates", projectId, appTypeId, scope],
    queryFn: async () => (await import("../lib/api")).api.aiPromptTemplates.list({
      project_id: projectId,
      app_type_id: appTypeId,
      scope
    }),
    enabled: Boolean(isOpen && projectId)
  });
  const createTemplate = useMutation({
    mutationFn: async () => {
      if (!projectId) {
        throw new Error("Select a project before saving prompt templates.");
      }

      return (await import("../lib/api")).api.aiPromptTemplates.create({
        project_id: projectId,
        app_type_id: appTypeId || undefined,
        scope,
        name: draft.name,
        description: draft.description || undefined,
        domain: draft.domain || undefined,
        role: draft.role || undefined,
        test_type: draft.test_type || undefined,
        test_format: draft.test_format || undefined,
        test_count: scopeConfig.showCount ? Number(draft.test_count) || undefined : undefined,
        prompt_text: draft.prompt_text,
        applies_to: scopeConfig.appliesTo,
        tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
      });
    },
    onSuccess: (template) => {
      queryClient.setQueryData<AiPromptTemplate[]>(["ai-prompt-templates", projectId, appTypeId, scope], (current) =>
        current ? [template, ...current] : [template]
      );
      setDraft(emptyDraft);
      onApply(renderAiPromptTemplate(template), template);
      setIsOpen(false);
    }
  });
  const closePicker = () => {
    if (!createTemplate.isPending) {
      setIsOpen(false);
    }
  };
  const dialogRef = useDialogFocus<HTMLDivElement>({
    active: isOpen,
    closeDisabled: createTemplate.isPending,
    onClose: closePicker
  });

  const templates = (query.data || []).filter((template) =>
    template.scope === scope
    && (!template.applies_to?.length || template.applies_to.some((target) => scopeConfig.appliesTo.includes(target)))
  );
  const filteredTemplates = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return templates;
    return templates.filter((template) =>
      [
        template.name,
        template.description,
        template.domain,
        template.role,
        template.test_type,
        template.test_format,
        template.prompt_text,
        ...(template.tags || [])
      ].some((value) => String(value || "").toLowerCase().includes(term))
    );
  }, [searchTerm, templates]);
  const saveDisabled = createTemplate.isPending || !draft.name.trim() || !draft.prompt_text.trim() || !projectId;

  return (
    <>
      <button
        className="ghost-button compact ai-prompt-template-trigger"
        disabled={disabled || !projectId}
        onClick={() => setIsOpen(true)}
        title={`Search ${scopeConfig.triggerLabel.toLowerCase()}`}
        type="button"
      >
        <SearchIcon size={15} />
        <span>{scopeConfig.triggerLabel}</span>
      </button>

      {isOpen ? createPortal(
        <div
          className="modal-backdrop ai-prompt-template-backdrop"
          onClick={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) closePicker();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          role="presentation"
        >
          <div
            aria-labelledby="ai-prompt-template-title"
            aria-modal="true"
            className="modal-card ai-prompt-template-modal"
            onClick={(event) => event.stopPropagation()}
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="import-modal-header">
              <div className="import-modal-title">
                <p className="dialog-context-label">{scopeConfig.contextLabel}</p>
                <div className="modal-title-info-row">
                  <h2 className="dialog-title" id="ai-prompt-template-title">{scopeConfig.libraryTitle}</h2>
                  <InfoTooltip
                    content={scopeConfig.libraryHelp}
                    label="Prompt library information"
                  />
                </div>
              </div>
              <DialogCloseButton disabled={createTemplate.isPending} label="Close prompt library" onClick={closePicker} />
            </div>

            <div className="ai-prompt-template-grid">
              <section className="ai-prompt-template-list">
                <label className="form-field">
                  <span>Search templates</span>
                  <input autoFocus onChange={(event) => setSearchTerm(event.target.value)} placeholder={scopeConfig.searchPlaceholder} value={searchTerm} />
                </label>
                <div className="ai-prompt-template-results">
                  {query.isLoading ? <LoadingState label="Loading prompt templates" /> : null}
                  {filteredTemplates.map((template) => (
                    <article className="ai-prompt-template-card" key={template.id}>
                      <div>
                        <strong>{template.name}</strong>
                        <span>{template.description || compactJoin([template.domain, template.role, template.test_type]) || "Reusable AI generation guidance"}</span>
                        <small>{compactJoin([template.domain, template.role, template.test_type, template.test_format, template.test_count && scopeConfig.showCount ? `${template.test_count} ${scopeConfig.countUnit}` : ""])}</small>
                      </div>
                      <button className="primary-button compact" onClick={() => {
                        onApply(renderAiPromptTemplate(template), template);
                        setIsOpen(false);
                      }} type="button">
                        <SparkIcon size={14} />
                        <span>Use</span>
                      </button>
                    </article>
                  ))}
                  {!query.isLoading && !filteredTemplates.length ? <div className="empty-state compact">{scopeConfig.emptyMessage}</div> : null}
                </div>
              </section>

              <section className="ai-prompt-template-create">
                <div className="panel-head">
                  <div>
                    <div className="panel-title-row">
                      <p className="eyebrow">{scopeConfig.createTitle}</p>
                      <InfoTooltip
                        content={scopeConfig.createHelp}
                        label="Add prompt information"
                      />
                    </div>
                  </div>
                </div>
                <div className="record-grid">
                  <FormField label="Template name">
                    <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Checkout role-based regression" />
                  </FormField>
                  <FormField label={scopeConfig.domainLabel}>
                    <input value={draft.domain} onChange={(event) => setDraft((current) => ({ ...current, domain: event.target.value }))} placeholder={scopeConfig.domainPlaceholder} />
                  </FormField>
                  <FormField label={scopeConfig.roleLabel}>
                    <input value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))} placeholder={scopeConfig.rolePlaceholder} />
                  </FormField>
                  <FormField label={scopeConfig.typeLabel}>
                    <input value={draft.test_type} onChange={(event) => setDraft((current) => ({ ...current, test_type: event.target.value }))} placeholder={scopeConfig.typePlaceholder} />
                  </FormField>
                  <FormField label={scopeConfig.formatLabel}>
                    <input value={draft.test_format} onChange={(event) => setDraft((current) => ({ ...current, test_format: event.target.value }))} placeholder={scopeConfig.formatPlaceholder} />
                  </FormField>
                  {scopeConfig.showCount ? (
                    <FormField label={scopeConfig.countLabel}>
                      <input min="1" max="50" type="number" value={draft.test_count} onChange={(event) => setDraft((current) => ({ ...current, test_count: event.target.value }))} />
                    </FormField>
                  ) : null}
                  <FormField label="Tags">
                    <input value={draft.tags} onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} placeholder="regression, security, mobile" />
                  </FormField>
                  <FormField label={scopeConfig.promptLabel}>
                    <textarea rows={6} value={draft.prompt_text} onChange={(event) => setDraft((current) => ({ ...current, prompt_text: event.target.value }))} placeholder={scopeConfig.promptPlaceholder} />
                  </FormField>
                </div>
                {createTemplate.isError ? (
                  <div className="inline-message error-message">{createTemplate.error instanceof Error ? createTemplate.error.message : "Unable to save prompt template."}</div>
                ) : null}
                <div className="testops-action-row">
                  <button className="primary-button" disabled={saveDisabled} onClick={() => createTemplate.mutate()} type="button">
                    <AddIcon size={15} />
                    <span>{createTemplate.isPending ? "Saving..." : "Save and use"}</span>
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
