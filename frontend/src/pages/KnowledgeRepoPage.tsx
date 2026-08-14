import { useMemo, useState, FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { useCurrentProject, useCurrentAppType } from "../hooks/useCurrentProject";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { api } from "../lib/api";
import { asArray } from "../lib/collectionGuards";
import { canViewAutomationCode as resolveCanViewAutomationCode } from "../lib/automationAccess";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { CatalogActionMenu } from "../components/CatalogActionMenu";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { CatalogViewToggle } from "../components/CatalogViewToggle";
import { DataTable } from "../components/DataTable";
import { AddIcon, TrashIcon, OpenIcon, SparkIcon } from "../components/AppIcons";
import { ToastMessage } from "../components/ToastMessage";
import { FormField } from "../components/FormField";
import { RichTextEditor, richTextToPlainText } from "../components/RichTextEditor";
import { RovoProviderStatus } from "../components/RovoProviderStatus";
import { DialogCloseButton } from "../components/DialogCloseButton";
import { useDeleteConfirmation } from "../components/DeleteConfirmationDialog";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { readDefaultCatalogViewMode } from "../lib/viewPreferences";
import { isRovoIntegrationId } from "../lib/rovo";
import "./KnowledgeRepoPage.rovo.css";

const agentEducationTemplates = [
  {
    title: "Object repository naming rules",
    description: "Teach HelloTest how your screens, fields, and business objects should be named.",
    content_type: "markdown",
    content: [
      "# Object repository naming rules",
      "- Screen names:",
      "- Field naming convention:",
      "- Preferred locator order:",
      "- Labels that map to the same business field:",
      "- Components that require special handling:"
    ].join("\n")
  },
  {
    title: "Auto-heal behavior",
    description: "Describe acceptable locator fallbacks and when the local agent must stop.",
    content_type: "markdown",
    content: [
      "# Auto-heal behavior",
      "- Safe fallback locators:",
      "- Labels/placeholders that are stable:",
      "- Text that is dynamic and should not be used:",
      "- Before retrying a click:",
      "- Stop and ask for review when:"
    ].join("\n")
  },
  {
    title: "Application documents",
    description: "Attach a URL, PDF reference, or release note that explains the app workflow.",
    content_type: "url",
    content: "https://"
  }
];

export function KnowledgeRepoPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const canViewAutomationCode = resolveCanViewAutomationCode(session, featureFlagsQuery.data);
  const [projectId] = useCurrentProject();
  const [appTypeId] = useCurrentAppType(projectId);
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();

  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [catalogViewMode, setCatalogViewMode] = useState<"tile" | "list">(() => readDefaultCatalogViewMode());
  const [knowledgeSearch, setKnowledgeSearch] = useState("");

  const [draft, setDraft] = useState({
    title: "",
    description: "",
    content_type: "text",
    content: "",
    is_active: true
  });
  const [contextSources, setContextSources] = useState({
    requirements: true,
    manualCases: true,
    automatedCases: true,
    objectRepository: true,
    apiEndpoints: true,
    documents: true
  });
  const [contextMessage, setContextMessage] = useState("");

  const knowledgeQuery = useQuery({
    queryKey: ["knowledge", projectId],
    queryFn: () => api.knowledgeRepo.list(projectId),
    enabled: Boolean(projectId)
  });
  const requirementsQuery = useQuery({
    queryKey: ["knowledge-context-requirements", projectId],
    queryFn: () => api.requirements.list({ project_id: projectId }),
    enabled: Boolean(projectId)
  });
  const testCasesQuery = useQuery({
    queryKey: ["knowledge-context-test-cases", appTypeId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId, projection: "summary" }),
    enabled: Boolean(appTypeId)
  });
  const objectRepositoryQuery = useQuery({
    queryKey: ["knowledge-context-object-repository", projectId, appTypeId],
    queryFn: () => api.testCases.learningCache({ project_id: projectId || undefined, app_type_id: appTypeId || undefined, limit: 200 }),
    enabled: Boolean(projectId || appTypeId)
  });
  const integrationsQuery = useQuery({
    queryKey: ["knowledge-context-llm-integrations"],
    queryFn: () => api.integrations.list({ type: "llm", is_active: true })
  });

  const createKnowledge = useMutation({
    mutationFn: (data: any) => api.knowledgeRepo.create(projectId, { ...data, app_type_id: appTypeId })
  });

  const updateKnowledge = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.knowledgeRepo.update(projectId, id, { ...data, app_type_id: appTypeId })
  });

  const deleteKnowledge = useMutation({
    mutationFn: (id: string) => api.knowledgeRepo.delete(projectId, id)
  });
  const isKnowledgeMutationPending = createKnowledge.isPending || updateKnowledge.isPending;
  const closeKnowledgeDialog = () => {
    if (isKnowledgeMutationPending) return;
    setIsModalOpen(false);
  };
  const knowledgeDialogRef = useDialogFocus<HTMLDivElement>({
    active: isModalOpen,
    closeDisabled: isKnowledgeMutationPending,
    onClose: closeKnowledgeDialog
  });

  const items = asArray(knowledgeQuery.data);
  const filteredItems = useMemo(() => {
    const normalizedSearch = knowledgeSearch.trim().toLowerCase();
    if (!normalizedSearch) return items;

    return items.filter((item: any) => [
      item.title,
      richTextToPlainText(item.description),
      item.content_type,
      item.is_active ? "active" : "inactive"
    ].filter(Boolean).join(" ").toLowerCase().includes(normalizedSearch));
  }, [items, knowledgeSearch]);
  const requirements = asArray(requirementsQuery.data);
  const testCases = asArray(testCasesQuery.data);
  const objectRepository = asArray(objectRepositoryQuery.data);
  const llmIntegrations = (integrationsQuery.data || []).filter((integration) => !isRovoIntegrationId(integration.id));
  const manualCases = useMemo(() => testCases.filter((testCase: any) => testCase.automated !== "yes"), [testCases]);
  const automatedCases = useMemo(() => testCases.filter((testCase: any) => testCase.automated === "yes"), [testCases]);

  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  const handleOpenCreateModal = () => {
    setEditingId(null);
    setDraft({ title: "", description: "", content_type: "text", content: "", is_active: true });
    setIsModalOpen(true);
  };

  const handleOpenTemplate = (template: typeof agentEducationTemplates[number]) => {
    setEditingId(null);
    setDraft({
      title: template.title,
      description: template.description,
      content_type: template.content_type,
      content: template.content,
      is_active: true
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item: any) => {
    setEditingId(item.id);
    setDraft({
      title: item.title,
      description: item.description || "",
      content_type: item.content_type || "text",
      content: item.content || "",
      is_active: item.is_active
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) {
      showError(null, "Select a project first.");
      return;
    }

    try {
      if (editingId) {
        await updateKnowledge.mutateAsync({ id: editingId, data: draft });
        showSuccess("Knowledge item updated successfully.");
      } else {
        await createKnowledge.mutateAsync(draft);
        showSuccess("Knowledge item created successfully.");
      }
      setIsModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["knowledge", projectId] });
    } catch (error) {
      showError(error, "Failed to save knowledge item.");
    }
  };

  const buildCaseContext = async (cases: any[], label: string) => {
    const limitedCases = cases.slice(0, 60);
    const lines = [`## ${label}`];

    for (const testCase of limitedCases) {
      const steps = await api.testSteps.list({ test_case_id: testCase.id }).catch(() => []);
      lines.push(`### ${testCase.title}`);
      lines.push(`- ID: ${testCase.display_id || testCase.id}`);
      lines.push(`- Status: ${testCase.status || "unknown"}`);
      lines.push(`- Automated: ${testCase.automated === "yes" ? "yes" : "no"}`);
      if (testCase.description) {
        lines.push(`- Description: ${testCase.description}`);
      }
      steps.slice(0, 30).forEach((step) => {
        lines.push(`- Step ${step.step_order}: ${step.action || ""} => ${step.expected_result || ""}`);
        if (canViewAutomationCode && step.automation_code) {
          lines.push(`  - Keyword automation: ${step.automation_code}`);
        }
        if (canViewAutomationCode && step.api_request) {
          lines.push(`  - API request: ${JSON.stringify(step.api_request)}`);
        }
      });
      lines.push("");
    }

    return lines.join("\n");
  };

  const handleBuildContextPack = async () => {
    if (!projectId) {
      showError(null, "Select a project first.");
      return;
    }

    setContextMessage("Building application context pack...");

    try {
      const sections = [
        "# HelloTest Application Context Pack",
        "",
        "Use this as retrieval context for direct LLM/manual case generation, story maturation, automation generation, and locator repair.",
        "",
        "## RAG Agent Operating Model",
        "- Stories define product intent and acceptance criteria.",
        "- Manual cases describe business workflows and expected outcomes.",
        "- Automated cases provide executable keyword steps, variables, APIs, and locator usage.",
        "- Object repository records are execution-time locator truth; prefer target locator first, DOM/accessibility structure second, screenshot fallback last.",
        "- PDF/manual/API documents should be added as separate active knowledge items and cross-referenced here.",
        ""
      ];

      if (contextSources.requirements) {
        sections.push("## Stories");
        requirements.slice(0, 120).forEach((requirement: any) => {
          sections.push(`### ${requirement.title}`);
          sections.push(`- ID: ${requirement.display_id || requirement.id}`);
          sections.push(`- Priority: P${requirement.priority ?? 3}`);
          sections.push(`- Status: ${requirement.status || "open"}`);
          sections.push(richTextToPlainText(requirement.description) || "No description recorded.");
          sections.push("");
        });
      }

      if (contextSources.manualCases) {
        sections.push(await buildCaseContext(manualCases, "Manual Test Cases"));
      }

      if (contextSources.automatedCases) {
        sections.push(await buildCaseContext(automatedCases, "Automated Cases And Keyword Steps"));
      }

      if (contextSources.objectRepository) {
        sections.push("## Object Repository");
        objectRepository.forEach((entry: any) => {
          const metadata = entry.metadata || {};
          sections.push(`### ${metadata.object_name || entry.locator_intent}`);
          sections.push(`- Screen: ${metadata.screen_name || entry.page_key}`);
          sections.push(`- Role: ${metadata.object_role || entry.locator_kind || entry.source}`);
          sections.push(`- Target locator: ${entry.locator}`);
          sections.push(`- DOM/accessibility structure: ${metadata.dom_structure || metadata.dom_path || "Not captured"}`);
          sections.push(`- Screenshot fallback: ${metadata.screenshot_url || metadata.screenshot_path || "Not captured"}`);
          sections.push(`- Fallback strategy: ${metadata.fallback_strategy || "Locator first; screenshot only after locator failure."}`);
          sections.push("");
        });
      }

      if (contextSources.apiEndpoints) {
        sections.push("## API Endpoint Context");
        sections.push("Add API payload/response knowledge items with content type Markdown. Include method, URL, headers, request body, response body, validation rules, and captured variables.");
        sections.push("");
      }

      if (contextSources.documents) {
        sections.push("## Document Context");
        sections.push("Add PDF/manual/setup documents as separate knowledge items. For direct LLM quality, paste extracted text or structured summaries when PDF parsing is unavailable.");
        sections.push("");
      }

      const response = await createKnowledge.mutateAsync({
        title: `Application context pack ${new Date().toLocaleDateString()}`,
        description: "Auto-built RAG context from stories, cases, automation, object repository, APIs, and documents.",
        content_type: "markdown",
        content: sections.join("\n"),
        metadata: {
          source: "context-pack-builder",
          sources: contextSources,
          requirement_count: requirements.length,
          manual_case_count: manualCases.length,
          automated_case_count: automatedCases.length,
          object_repository_count: objectRepository.length
        },
        is_active: true
      });

      setContextMessage(`Context pack created: ${response.title || response.id}`);
      showSuccess("Application context pack created and activated for AI generation.");
      queryClient.invalidateQueries({ queryKey: ["knowledge", projectId] });
    } catch (error) {
      showError(error, "Unable to build context pack.");
      setContextMessage("");
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirmDelete({
      message: "Are you sure you want to delete this AI knowledge item? It will no longer be used for generation."
    });
    if (confirmed) {
      try {
        await deleteKnowledge.mutateAsync(id);
        showSuccess("Knowledge item deleted.");
        queryClient.invalidateQueries({ queryKey: ["knowledge", projectId] });
      } catch (error) {
        showError(error, "Failed to delete item.");
      }
    }
  };
  const getKnowledgeActions = (item: any) => [
    {
      label: "Edit knowledge",
      description: "Open this knowledge item for editing.",
      icon: <OpenIcon />,
      onClick: () => handleOpenEditModal(item)
    },
    {
      label: "Delete knowledge",
      description: "Remove this knowledge item from AI retrieval context.",
      icon: <TrashIcon />,
      onClick: () => void handleDelete(item.id),
      tone: "danger" as const
    }
  ];

  return (
    <div className="workspace-layout">
      {confirmationDialog}
      <ToastMessage message={message} tone={messageTone} onDismiss={() => setMessage("")} />
      
      <div className="workspace-main">
        <PageHeader
          eyebrow="Administration"
          title="Knowledge Repo"
          description="Educate HelloTest's local agent with app-specific locator rules, workflows, screenshots, and documents for stronger generation and auto-heal."
        />

        <div className="workspace-content page-content--knowledge">
          <section className="agent-education-panel">
            <div>
              <span className="eyebrow">Local agent education</span>
              <h2>Give auto-heal the context it cannot infer from code alone</h2>
              <p>Active knowledge is packed with object repository entries, test cases, recorder screenshots, and external documents when HelloTest builds or repairs automation.</p>
            </div>
            <div className="agent-context-cockpit">
              <div>
                <h2>Build an application-aware RAG pack</h2>
                <p>Package selected stories, manual cases, automated keyword steps, object repository fields, API notes, and document guidance into one active knowledge item. Direct LLM integrations can then use the same context to mature stories, design manual cases, generate automation, and repair locators; Rovo remains a separate Jira conversation.</p>
                <div className="agent-context-metrics metric-strip page-metric-strip" aria-label="Available application context" role="group">
                  <div className="mini-card">
                    <strong>{requirements.length}</strong>
                    <span>Stories</span>
                  </div>
                  <div className="mini-card">
                    <strong>{manualCases.length}</strong>
                    <span>Manual cases</span>
                  </div>
                  <div className="mini-card">
                    <strong>{automatedCases.length}</strong>
                    <span>Automated cases</span>
                  </div>
                  <div className="mini-card">
                    <strong>{objectRepository.length}</strong>
                    <span>OR fields</span>
                  </div>
                  <div className="mini-card">
                    <strong>{llmIntegrations.length ? "Ready" : "Setup"}</strong>
                    <span>Direct LLM</span>
                  </div>
                </div>
                <RovoProviderStatus
                  className="knowledge-rovo-provider"
                  compact
                  prompt={[
                    "Open a Jira-native HelloTest QA Agent conversation. This is a Rovo knowledge-design review, not a direct model invocation and must not create or update knowledge items.",
                    `Review the knowledge context for Jira project ${projectId || "not selected"} and app type ${appTypeId || "not selected"}.`,
                    `Available evidence counts: ${requirements.length} Stories, ${manualCases.length} manual cases, ${automatedCases.length} automated cases, and ${objectRepository.length} object-repository records.`,
                    `Selected context families: ${Object.entries(contextSources).filter(([, enabled]) => enabled).map(([key]) => key).join(", ") || "none"}.`,
                    "Identify missing product knowledge, safe retrieval boundaries, stale-source risks, and the smallest useful additions. Clearly separate observed counts from recommendations."
                  ].join("\n").slice(0, 3_800)}
                />
              </div>
              <div className="agent-context-source-grid">
                {([
                  ["requirements", "Stories"],
                  ["manualCases", "Manual cases and steps"],
                  ["automatedCases", "Automated keyword steps"],
                  ["objectRepository", "Object repository and locators"],
                  ["apiEndpoints", "API endpoint guidance"],
                  ["documents", "PDF/manual document guidance"]
                ] as Array<[keyof typeof contextSources, string]>).map(([key, label]) => (
                  <label className="checkbox-field" key={key}>
                    <input
                      checked={contextSources[key]}
                      onChange={(event) => setContextSources((current) => ({ ...current, [key]: event.target.checked }))}
                      type="checkbox"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="action-row">
                <button className="primary-button" disabled={!projectId || createKnowledge.isPending} onClick={() => void handleBuildContextPack()} type="button">
                  <SparkIcon />
                  {createKnowledge.isPending ? "Building…" : "Build context pack"}
                </button>
                <button className="ghost-button" onClick={() => handleOpenTemplate(agentEducationTemplates[2])} type="button">
                  Add PDF/manual reference
                </button>
              </div>
              {contextMessage ? <div className="empty-state compact">{contextMessage}</div> : null}
            </div>
            <div className="agent-education-grid">
              {agentEducationTemplates.map((template) => (
                <button className="agent-education-card" disabled={!projectId} key={template.title} onClick={() => handleOpenTemplate(template)} type="button">
                  <strong>{template.title}</strong>
                  <span>{template.description}</span>
                </button>
              ))}
            </div>
          </section>

          <Panel title="Knowledge items" subtitle="Active entries are retrieved by AI generation, story completion, automation build, and locator repair flows.">
            <div className="design-list-toolbar catalog-command-toolbar resource-catalog-toolbar knowledge-repo-toolbar">
              <div className="catalog-toolbar-discovery" aria-label="Knowledge views and search">
                <CatalogViewToggle onChange={setCatalogViewMode} value={catalogViewMode} />
                <CatalogSearchFilter
                  activeFilterCount={knowledgeSearch.trim() ? 1 : 0}
                  ariaLabel="Search knowledge items"
                  onChange={setKnowledgeSearch}
                  placeholder="Search title, description, type, or status"
                  subtitle="Search the active project knowledge catalog."
                  title="Knowledge search"
                  type="search"
                  value={knowledgeSearch}
                >
                  <div className="catalog-filter-actions">
                    <button className="ghost-button" disabled={!knowledgeSearch.trim()} onClick={() => setKnowledgeSearch("")} type="button">
                      Clear search
                    </button>
                  </div>
                </CatalogSearchFilter>
              </div>
              <div className="catalog-toolbar-actions" aria-label="Knowledge actions">
                <button className="primary-button" onClick={handleOpenCreateModal} disabled={!projectId} type="button">
                  <AddIcon />
                  <span>Add Knowledge</span>
                </button>
              </div>
            </div>

            {filteredItems.length && catalogViewMode === "tile" ? (
              <div className="tile-browser-grid">
                {filteredItems.map((item: any) => (
                  <article
                    aria-label={`Open knowledge item ${item.title}`}
                    className="record-card tile-card knowledge-catalog-card"
                    key={item.id}
                    onClick={() => handleOpenEditModal(item)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleOpenEditModal(item);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="tile-card-main">
                      <div className="tile-card-select-row">
                        <span className="badge badge-neutral">{item.content_type || "text"}</span>
                        <div onClick={(event) => event.stopPropagation()}>
                          <CatalogActionMenu actions={getKnowledgeActions(item)} label={`${item.title} actions`} />
                        </div>
                      </div>
                      <div className="tile-card-header">
                        <div className="tile-card-title-group">
                          <strong>{item.title}</strong>
                        </div>
                      </div>
                      <p className="tile-card-description">
                        {richTextToPlainText(item.description) || "No description captured for this knowledge item."}
                      </p>
                      <div className="tile-card-footer">
                        <span className={`badge ${item.is_active ? "badge-success" : "badge-neutral"}`}>
                          {item.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}

            {filteredItems.length && catalogViewMode === "list" ? <DataTable
              rows={filteredItems}
              columns={[
                {
                  key: "title",
                  label: "Title",
                  render: (item: any) => <strong>{item.title}</strong>
                },
                {
                  key: "type",
                  label: "Type",
                  render: (item: any) => <span className="badge badge-neutral">{item.content_type}</span>
                },
                {
                  key: "description",
                  label: "Description",
                  render: (item: any) => richTextToPlainText(item.description) || "—"
                },
                {
                  key: "status",
                  label: "Status",
                  render: (item: any) => (
                    <span className={`badge ${item.is_active ? "badge-success" : "badge-neutral"}`}>
                      {item.is_active ? "Active" : "Inactive"}
                    </span>
                  )
                }
              ]}
              enableColumnResize
              enableHeaderColumnReorder
              emptyMessage="No AI knowledge items found."
              renderRowActions={(item: any) => (
                <CatalogActionMenu
                  actions={getKnowledgeActions(item)}
                  label={`${item.title} actions`}
                />
              )}
              storageKey="qaira:knowledge:list-columns:v2"
            /> : null}
            {!knowledgeQuery.isPending && !filteredItems.length ? (
              <div className="empty-state compact">
                {items.length ? "No knowledge items match the current search." : "No AI knowledge items found."}
              </div>
            ) : null}
          </Panel>
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-backdrop modal-backdrop--scroll" onClick={closeKnowledgeDialog} role="presentation">
          <div
            aria-labelledby="knowledge-item-dialog-title"
            aria-modal="true"
            className="modal-card requirement-create-modal knowledge-item-modal"
            onClick={(e) => e.stopPropagation()}
            ref={knowledgeDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="requirement-create-header">
              <div className="requirement-create-title">
                <p className="dialog-context-label">AI knowledge</p>
                <h2 className="dialog-title" id="knowledge-item-dialog-title">{editingId ? "Edit knowledge" : "Add knowledge"}</h2>
                <p>Store durable app context for direct LLM retrieval, generation, and locator repair.</p>
              </div>
              <DialogCloseButton
                disabled={isKnowledgeMutationPending}
                label={`Close ${editingId ? "edit" : "add"} knowledge dialog`}
                onClick={closeKnowledgeDialog}
              />
            </div>
            <form onSubmit={handleSubmit}>
              <div className="requirement-create-modal-body">
                <FormField label="Title" required>
                  <input
                    data-autofocus="true"
                    type="text"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    required
                    placeholder="e.g. User Registration Flow"
                  />
                </FormField>

                <FormField label="Description">
                  <RichTextEditor
                    appearance="canonical"
                    rows={3}
                    value={draft.description}
                    onChange={(description) => setDraft({ ...draft, description })}
                    placeholder="Brief summary of this knowledge"
                  />
                </FormField>

                <FormField label="Content Type" required>
                  <select
                    value={draft.content_type}
                    onChange={(e) => setDraft({ ...draft, content_type: e.target.value })}
                  >
                    <option value="text">Text / Rules</option>
                    <option value="markdown">Markdown Playbook</option>
                    <option value="url">URL Reference</option>
                    <option value="pdf">PDF Reference</option>
                    <option value="image">Screenshot / Image Notes</option>
                  </select>
                </FormField>

                <FormField label="Content" required>
                  <textarea
                    value={draft.content}
                    onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                    rows={6}
                    required
                    placeholder={draft.content_type === "url" ? "https://..." : "Describe the domain rules or test instructions..."}
                  />
                </FormField>

                <FormField label="Active">
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={draft.is_active}
                      onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                    />
                    <span>Use this knowledge in AI prompt generation</span>
                  </label>
                </FormField>
              </div>
              <div className="action-row requirement-create-modal-actions">
                <button type="button" className="ghost-button" disabled={isKnowledgeMutationPending} onClick={closeKnowledgeDialog}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={isKnowledgeMutationPending}>
                  {editingId ? "Save changes" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
