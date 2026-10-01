import { useEffect, useMemo, useState } from "react";
import { integrationApi } from "@hellotest/integration/frontend/api.client";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import type { AiPromptTemplate } from "@hellotest/platform/frontend/src/types";
import { AddIcon, SearchIcon, SparkIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { hasCapability } from "@hellotest/platform/frontend/src/platform/lib/capabilityAccess";
import "./AiPromptTemplatePicker.css";

export type AiPromptLibraryScope =
  | "workflow_skill"
  | "requirement_creation"
  | "requirement_completion"
  | "test_case_generation"
  | "test_case_steps"
  | "bug_creation";

export type AiPromptScope = Exclude<AiPromptLibraryScope, "workflow_skill">;

const DEFAULT_PROMPT_SCOPE: AiPromptLibraryScope = "test_case_generation";

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

const PROMPT_SCOPE_CONFIGS: Record<AiPromptLibraryScope, PromptScopeConfig> = {
  workflow_skill: {
    triggerLabel: "Choose or create skill", contextLabel: "Workflow skill library",
    libraryTitle: "Choose or create a workflow skill",
    libraryHelp: "Add reusable guidance to an AI node. Each node keeps an editable copy of its selected skills.",
    searchPlaceholder: "Skill name, domain, role, or tag…", emptyMessage: "No skills matched. Create a skill for this project.",
    createTitle: "Create skill", createHelp: "Save instructions to reuse across custom AI and specialist nodes.",
    appliesTo: ["agentic_workflows"], domainLabel: "Domain", domainPlaceholder: "Payments, identity…",
    roleLabel: "Role", rolePlaceholder: "QA architect…", typeLabel: "Skill focus", typePlaceholder: "Review, summarize, design…",
    formatLabel: "Output guidance", formatPlaceholder: "Findings with supporting sources…",
    countLabel: "Count", countUnit: "results", showCount: false,
    promptLabel: "Skill instructions", promptPlaceholder: "Describe the repeatable task, expected output, and boundaries.",
  },
  requirement_creation: {
    triggerLabel: "Story templates",
    contextLabel: "Story creation prompt library",
    libraryTitle: "Choose or create a Story-generation template",
    libraryHelp: "Only Story-creation templates are shown. Applying one copies its guidance into this Story draft session.",
    searchPlaceholder: "Story format, persona, domain, or tag...",
    emptyMessage: "No Story-creation templates matched. Create one for this screen on the right.",
    createTitle: "Add Story template",
    createHelp: "Capture guidance for generating new testable Story drafts. It will not appear in Test Case or Defect dialogs.",
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
    libraryHelp: "Only Test Case-generation templates are shown. Story and Defect templates stay in their own authoring screens.",
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
    triggerLabel: "Defect templates",
    contextLabel: "Defect drafting prompt library",
    libraryTitle: "Choose or create a Defect-report template",
    libraryHelp: "Only Defect-drafting templates are shown. Failed evidence stays bounded to the current Defect context.",
    searchPlaceholder: "Failure type, evidence style, domain, or tag...",
    emptyMessage: "No Defect templates matched. Create one for this screen on the right.",
    createTitle: "Add Defect template",
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
    promptLabel: "Defect guidance",
    promptPlaceholder: "Describe the reproduction detail, evidence, impact, and wording required for a ready-to-file Defect."
  }
};

const isAiPromptLibraryScope = (scope: string | undefined): scope is AiPromptLibraryScope =>
  Boolean(scope && scope in PROMPT_SCOPE_CONFIGS);

const getPromptScopeConfig = (scope: AiPromptLibraryScope) => PROMPT_SCOPE_CONFIGS[scope];

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
  if (!isAiPromptLibraryScope(template.scope)) {
    return String(template.prompt_text || "").trim();
  }

  const scopeConfig = getPromptScopeConfig(template.scope);
  const lines = [
    template.domain ? `${scopeConfig.domainLabel}: ${template.domain}` : "",
    template.role ? `${scopeConfig.roleLabel}: ${template.role}` : "",
    template.test_type ? `${scopeConfig.typeLabel}: ${template.test_type}` : "",
    template.test_format ? `${scopeConfig.formatLabel}: ${template.test_format}` : "",
    template.test_count && scopeConfig.showCount && template.scope !== "requirement_creation" ? `${scopeConfig.countLabel}: ${template.test_count}` : "",
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
  scope = DEFAULT_PROMPT_SCOPE,
  triggerLabel
}: {
  projectId?: string;
  appTypeId?: string;
  onApply: (prompt: string, template: AiPromptTemplate) => void;
  disabled?: boolean;
  scope?: AiPromptLibraryScope;
  triggerLabel?: string;
}) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const featureFlags = useFeatureFlags(Boolean(session));
  const canViewTemplates = hasCapability(session, featureFlags.data, "prompt_template.view", projectId);
  const canManageTemplates = hasCapability(session, featureFlags.data, "prompt_template.manage", projectId);
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingTemplate, setEditingTemplate] = useState<AiPromptTemplate | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  useEffect(() => {
    setIsOpen(false);
    setDraft(emptyDraft);
    setEditingTemplate(null);
    setSavedMessage("");
    setSearchTerm("");
  }, [projectId, appTypeId, scope]);
  const scopeConfig = getPromptScopeConfig(scope);
  const query = useQuery({
    queryKey: ["ai-prompt-templates", projectId, appTypeId, scope],
    queryFn: async () => integrationApi.aiPromptTemplates.list({
      project_id: projectId,
      app_type_id: appTypeId,
      scope
    }),
    enabled: Boolean(isOpen && projectId && canViewTemplates)
  });
  const saveTemplate = useMutation({
    mutationFn: async ({ useAfterSave }: { useAfterSave: boolean }) => {
      if (!canViewTemplates || !canManageTemplates) throw new Error("Prompt template management access is required.");
      if (!projectId) {
        throw new Error("Select a project before saving prompt templates.");
      }

      const payload = {
        project_id: projectId,
        app_type_id: editingTemplate && !editingTemplate.built_in ? editingTemplate.app_type_id || undefined : appTypeId || undefined,
        scope,
        name: draft.name,
        description: draft.description,
        domain: draft.domain,
        role: draft.role,
        test_type: draft.test_type,
        test_format: draft.test_format,
        test_count: scopeConfig.showCount ? Number(draft.test_count) || undefined : undefined,
        prompt_text: draft.prompt_text,
        applies_to: scopeConfig.appliesTo,
        tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
      };
      const { aiPromptTemplates } = integrationApi;
      // Built-ins belong to every project. Editing one creates an editable
      // project template; subsequent saves update that saved template.
      const template = editingTemplate && !editingTemplate.built_in
        ? await aiPromptTemplates.update(editingTemplate.id, payload)
        : await aiPromptTemplates.create(payload);
      return { template, useAfterSave };
    },
    onSuccess: ({ template, useAfterSave }) => {
      queryClient.setQueryData<AiPromptTemplate[]>(["ai-prompt-templates", projectId, appTypeId, scope], (current) =>
        [template, ...(current || []).filter((item) => item.id !== template.id)]
      );
      void queryClient.invalidateQueries({ queryKey: ["ai-prompt-templates", projectId] });
      setEditingTemplate(template);
      setSavedMessage(`Saved "${template.name}".`);
      if (useAfterSave) {
        onApply(renderAiPromptTemplate(template), template);
        setIsOpen(false);
      }
    }
  });
  const closePicker = () => {
    if (!saveTemplate.isPending) {
      setIsOpen(false);
    }
  };
  const dialogRef = useDialogFocus<HTMLDivElement>({
    active: isOpen && canViewTemplates,
    closeDisabled: saveTemplate.isPending,
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
  const selectTemplate = (template: AiPromptTemplate | null) => {
    if (!canManageTemplates) return;
    saveTemplate.reset();
    setSavedMessage("");
    setEditingTemplate(template);
    setDraft(template ? {
      name: template.name,
      description: template.description || "",
      domain: template.domain || "",
      role: template.role || "",
      test_type: template.test_type || "",
      test_format: template.test_format || "",
      test_count: String(template.test_count || 6),
      prompt_text: template.prompt_text,
      tags: (template.tags || []).join(", ")
    } : emptyDraft);
  };
  const saveDisabled = saveTemplate.isPending || draft.name.trim().length < 2 || draft.prompt_text.trim().length < 2 || !projectId
    || (scopeConfig.showCount && (!Number.isInteger(Number(draft.test_count)) || Number(draft.test_count) < 1 || Number(draft.test_count) > (scope === "requirement_creation" ? 6 : 10)));

  if (!canViewTemplates) return null;

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
        <span>{triggerLabel || scopeConfig.triggerLabel}</span>
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
              <DialogCloseButton disabled={saveTemplate.isPending} label="Close prompt library" onClick={closePicker} />
            </div>

            <div className="ai-prompt-template-grid" style={!canManageTemplates ? { gridTemplateColumns: "1fr" } : undefined}>
              <section className="ai-prompt-template-list">
                <label className="form-field">
                  <span>Search templates</span>
                  <input autoFocus onChange={(event) => setSearchTerm(event.target.value)} placeholder={scopeConfig.searchPlaceholder} value={searchTerm} />
                </label>
                <div className="ai-prompt-template-results">
                  {query.isLoading ? <LoadingState label="Loading prompt templates" /> : null}
                  {query.isError ? <div className="inline-message error-message">{query.error instanceof Error ? query.error.message : "Unable to load prompt templates."}</div> : null}
                  {filteredTemplates.map((template) => (
                    <article className={`ai-prompt-template-card${editingTemplate?.id === template.id ? " is-editing" : ""}`} key={template.id}>
                      <div>
                        <strong>{template.name}</strong>
                        <span>{template.description || compactJoin([template.domain, template.role, template.test_type]) || "Reusable AI generation guidance"}</span>
                        <small>{compactJoin([template.domain, template.role, template.test_type, template.test_format, template.test_count && scopeConfig.showCount ? `${template.test_count} ${scopeConfig.countUnit}` : ""])}</small>
                      </div>
                      <div className="ai-prompt-template-card-actions">
                      {canManageTemplates ? <button className="ghost-button compact" disabled={saveTemplate.isPending} onClick={() => selectTemplate(template)} type="button" aria-label={`Edit ${template.name}`}>Edit</button> : null}
                      <button className="primary-button compact" disabled={saveTemplate.isPending} onClick={() => {
                        onApply(renderAiPromptTemplate(template), template);
                        setIsOpen(false);
                      }} type="button">
                        <SparkIcon size={14} />
                        <span>Use</span>
                      </button>
                      </div>
                    </article>
                  ))}
                  {!query.isLoading && !filteredTemplates.length ? <div className="empty-state compact">{scopeConfig.emptyMessage}</div> : null}
                </div>
              </section>

              {canManageTemplates ? <section className="ai-prompt-template-create">
                <div className="panel-head">
                  <div>
                    <div className="panel-title-row">
                      <p className="eyebrow">{editingTemplate ? "Edit template" : scopeConfig.createTitle}</p>
                      <InfoTooltip
                        content={scopeConfig.createHelp}
                        label="Add prompt information"
                      />
                    </div>
                  </div>
                  <button className="ghost-button compact" disabled={saveTemplate.isPending} onClick={() => selectTemplate(null)} type="button"><AddIcon size={15} /><span>{scope === "workflow_skill" ? "New skill" : "New template"}</span></button>
                </div>
                {editingTemplate?.built_in ? <p className="ai-prompt-template-edit-note">Saving these changes creates a template for this project.</p> : null}
                <fieldset className="record-grid ai-prompt-template-fields" disabled={saveTemplate.isPending} onChange={() => setSavedMessage("")}>
                  <FormField label={scope === "workflow_skill" ? "Skill name" : "Template name"}>
                    <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Checkout role-based regression" />
                  </FormField>
                  <FormField label="Description">
                    <input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="When to use this template" />
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
                      <input min="1" max={scope === "requirement_creation" ? "6" : "10"} type="number" value={draft.test_count} onChange={(event) => setDraft((current) => ({ ...current, test_count: event.target.value }))} />
                    </FormField>
                  ) : null}
                  <FormField label="Tags">
                    <input value={draft.tags} onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} placeholder="regression, security, mobile" />
                  </FormField>
                  <FormField label={scopeConfig.promptLabel}>
                    <textarea rows={6} value={draft.prompt_text} onChange={(event) => setDraft((current) => ({ ...current, prompt_text: event.target.value }))} placeholder={scopeConfig.promptPlaceholder} />
                  </FormField>
                </fieldset>
                {saveTemplate.isError ? (
                  <div className="inline-message error-message">{saveTemplate.error instanceof Error ? saveTemplate.error.message : "Unable to save prompt template."}</div>
                ) : null}
                {savedMessage ? <div className="inline-message" role="status">{savedMessage}</div> : null}
                <div className="testops-action-row">
                  <button className="ghost-button" disabled={saveDisabled} onClick={() => saveTemplate.mutate({ useAfterSave: false })} type="button">
                    <span>{saveTemplate.isPending && !saveTemplate.variables?.useAfterSave ? "Saving..." : "Save"}</span>
                  </button>
                  <button className="primary-button" disabled={saveDisabled} onClick={() => saveTemplate.mutate({ useAfterSave: true })} type="button">
                    <SparkIcon size={15} />
                    <span>{saveTemplate.isPending && saveTemplate.variables?.useAfterSave ? "Saving..." : "Save and Use"}</span>
                  </button>
                </div>
              </section> : null}
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
