import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityIcon, LayersIcon, MousePointerIcon, OpenIcon, PlayIcon, SparkIcon } from "../components/AppIcons";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { RecorderSessionInsights } from "../components/RecorderSessionInsights";
import { RecorderStartControls, type RecorderStartOptions } from "../components/RecorderStartControls";
import { StatusBadge } from "../components/StatusBadge";
import { SubnavTabs } from "../components/SubnavTabs";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { useAuth } from "../auth/AuthContext";
import { useCurrentAppType, useCurrentProject } from "../hooks/useCurrentProject";
import { api } from "../lib/api";
import type { AutomationLearningCacheEntry, Integration, RecorderSessionResponse, TestCase, TestStep } from "../types";

type AutomationView = "cases" | "repository" | "local-playwright";

function isAutomatedCase(testCase: TestCase) {
  return testCase.automated === "yes";
}

function isManualCase(testCase: TestCase) {
  return testCase.automated !== "yes";
}

function normalizeMetadataValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getScreenName(entry: AutomationLearningCacheEntry) {
  return normalizeMetadataValue(entry.metadata?.screen_name) || entry.page_key || "Unassigned screen";
}

function getObjectName(entry: AutomationLearningCacheEntry) {
  return normalizeMetadataValue(entry.metadata?.object_name) || entry.locator_intent || "Unnamed object";
}

function getObjectRole(entry: AutomationLearningCacheEntry) {
  return normalizeMetadataValue(entry.metadata?.object_role) || entry.locator_kind || entry.source || "field";
}

function extractQuotedTargets(code?: string | null) {
  if (!code) {
    return [];
  }

  const targets = new Set<string>();
  const callPattern = /web\.(?:click|fill|select|check|uncheck|hover|press|expect(?:Text|Visible|Hidden)?)\(\s*(['"`])([\s\S]*?)\1/g;
  let match = callPattern.exec(code);

  while (match) {
    if (match[2]?.trim()) {
      targets.add(match[2].trim());
    }
    match = callPattern.exec(code);
  }

  return Array.from(targets);
}

function extractVariables(step: TestStep) {
  const values = `${step.action || ""} ${step.expected_result || ""} ${step.automation_code || ""}`;
  const variables = new Set<string>();
  const pattern = /\{\{\s*([^}]+?)\s*\}\}/g;
  let match = pattern.exec(values);

  while (match) {
    if (match[1]?.trim()) {
      variables.add(match[1].trim());
    }
    match = pattern.exec(values);
  }

  return Array.from(variables);
}

function formatRecorderDisplayMode(value?: string | null) {
  return value === "browser-live-view" ? "Live view" : value === "local-browser-with-live-view" ? "Local browser + live view" : "Recorder";
}

export function AutomationPage() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const [view, setView] = useState<AutomationView>("cases");
  const [selectedAutomatedCaseId, setSelectedAutomatedCaseId] = useState("");
  const [selectedManualCaseId, setSelectedManualCaseId] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [builderContext, setBuilderContext] = useState("");
  const [message, setMessage] = useState("");
  const [recorderSession, setRecorderSession] = useState<RecorderSessionResponse | null>(null);
  const [recorderStartOptions, setRecorderStartOptions] = useState<RecorderStartOptions | null>(null);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [repositoryDraft, setRepositoryDraft] = useState({
    screen_name: "",
    object_name: "",
    object_role: "",
    locator: "",
    locator_kind: "",
    target_criteria: "",
    dom_structure: "",
    screenshot_url: "",
    fallback_strategy: ""
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list,
    enabled: Boolean(session)
  });
  const appTypesQuery = useQuery({
    queryKey: ["app-types", projectId],
    queryFn: () => api.appTypes.list({ project_id: projectId }),
    enabled: Boolean(projectId && session)
  });
  const testCasesQuery = useQuery({
    queryKey: ["test-cases", "automation-workspace", appTypeId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId && session)
  });
  const learningCacheQuery = useQuery({
    queryKey: ["automation-learning-cache", "automation-workspace", projectId, appTypeId],
    queryFn: () => api.testCases.learningCache({
      project_id: projectId || undefined,
      app_type_id: appTypeId || undefined,
      limit: 200
    }),
    enabled: Boolean((projectId || appTypeId) && session)
  });
  const automatedStepsQuery = useQuery({
    queryKey: ["test-steps", "automation-workspace", selectedAutomatedCaseId],
    queryFn: () => api.testSteps.list({ test_case_id: selectedAutomatedCaseId }),
    enabled: Boolean(selectedAutomatedCaseId && session)
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations", "automation-workspace"],
    queryFn: () => api.integrations.list({ is_active: true }),
    enabled: Boolean(session)
  });

  const projects = projectsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const testCases = testCasesQuery.data || [];
  const learningCache = learningCacheQuery.data || [];
  const integrations = integrationsQuery.data || [];
  const llmIntegration = useMemo(() => {
    const active = integrations.filter((integration: Integration) => integration.type === "llm" && integration.is_active);
    return active.find((integration) => String(integration.config?.project_id || "") === projectId) || active[0] || null;
  }, [integrations, projectId]);
  const automatedCases = useMemo(() => testCases.filter(isAutomatedCase), [testCases]);
  const manualCases = useMemo(() => testCases.filter(isManualCase), [testCases]);
  const activeAutomatedCase = automatedCases.find((testCase) => testCase.id === selectedAutomatedCaseId) || automatedCases[0] || null;
  const activeManualCase = manualCases.find((testCase) => testCase.id === selectedManualCaseId) || manualCases[0] || null;
  const automatedSteps = automatedStepsQuery.data || [];
  const selectedRepositoryEntry = learningCache.find((entry) => entry.id === selectedRepositoryId) || learningCache[0] || null;
  const groupedRepository = useMemo(() => {
    const grouped = new Map<string, AutomationLearningCacheEntry[]>();

    learningCache.forEach((entry) => {
      const screenName = getScreenName(entry);
      grouped.set(screenName, [...(grouped.get(screenName) || []), entry]);
    });

    return Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [learningCache]);
  const recorderLiveUrl = recorderSession?.live_view_url || "";

  useEffect(() => {
    if (appTypesQuery.isPending) {
      return;
    }

    const scopedAppTypes = projectId ? appTypes.filter((appType) => String(appType.project_id) === String(projectId)) : appTypes;

    if (!scopedAppTypes.length) {
      setAppTypeId("");
      return;
    }

    if (!scopedAppTypes.some((appType) => appType.id === appTypeId)) {
      setAppTypeId(scopedAppTypes[0].id);
      setSelectedAutomatedCaseId("");
      setSelectedManualCaseId("");
      setRecorderSession(null);
    }
  }, [appTypeId, appTypes, appTypesQuery.isPending, projectId, setAppTypeId]);

  useEffect(() => {
    if (activeAutomatedCase && selectedAutomatedCaseId !== activeAutomatedCase.id) {
      setSelectedAutomatedCaseId(activeAutomatedCase.id);
    }
  }, [activeAutomatedCase, selectedAutomatedCaseId]);

  useEffect(() => {
    if (activeManualCase && selectedManualCaseId !== activeManualCase.id) {
      setSelectedManualCaseId(activeManualCase.id);
    }
  }, [activeManualCase, selectedManualCaseId]);

  useEffect(() => {
    if (selectedRepositoryEntry && selectedRepositoryId !== selectedRepositoryEntry.id) {
      setSelectedRepositoryId(selectedRepositoryEntry.id);
    }
  }, [selectedRepositoryEntry, selectedRepositoryId]);

  useEffect(() => {
    if (!selectedRepositoryEntry) {
      return;
    }

    const metadata = selectedRepositoryEntry.metadata || {};
    setRepositoryDraft({
      screen_name: normalizeMetadataValue(metadata.screen_name),
      object_name: getObjectName(selectedRepositoryEntry),
      object_role: getObjectRole(selectedRepositoryEntry),
      locator: selectedRepositoryEntry.locator || "",
      locator_kind: selectedRepositoryEntry.locator_kind || "",
      target_criteria: Array.isArray(metadata.target_criteria) ? metadata.target_criteria.join("\n") : normalizeMetadataValue(metadata.target_criteria),
      dom_structure: normalizeMetadataValue(metadata.dom_structure) || normalizeMetadataValue(metadata.dom_path) || normalizeMetadataValue(metadata.html),
      screenshot_url: normalizeMetadataValue(metadata.screenshot_url) || normalizeMetadataValue(metadata.screenshot_path),
      fallback_strategy: normalizeMetadataValue(metadata.fallback_strategy)
    });
  }, [selectedRepositoryEntry?.id]);

  useEffect(() => {
    if (!recorderSession?.status_url || recorderSession.status !== "running") {
      return undefined;
    }

    let cancelled = false;
    const refreshRecorderSession = async () => {
      try {
        const response = await fetch(recorderSession.status_url as string, { cache: "no-store" });

        if (!response.ok) {
          return;
        }

        const next = await response.json() as Partial<RecorderSessionResponse>;

        if (!cancelled) {
          setRecorderSession((current) => current?.id === recorderSession.id ? { ...current, ...next } : current);
        }
      } catch {
        // Recorder counters are non-critical; the backend finish call is authoritative.
      }
    };
    const timer = window.setInterval(() => void refreshRecorderSession(), 1000);

    void refreshRecorderSession();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [recorderSession?.id, recorderSession?.status, recorderSession?.status_url]);

  const invalidateAutomationData = () => {
    void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
    void queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] });
  };

  const buildSingleAutomation = useMutation({
    mutationFn: () => {
      if (!activeManualCase) {
        throw new Error("Select a manual case first.");
      }

      return api.testCases.queueAutomationGenerator(activeManualCase.id, {
        start_url: startUrl || undefined,
        additional_context: builderContext || undefined
      });
    },
    onSuccess: (response) => {
      setMessage(`Automation build queued as ${response.transaction_id}.`);
      invalidateAutomationData();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to queue automation.")
  });

  const runCase = useMutation({
    mutationFn: async ({ testCase, mode }: { testCase: TestCase; mode: "local" | "manual" }) => {
      if (!projectId || !appTypeId || !session?.user.id) {
        throw new Error("Select project and app type before running a case.");
      }

      if (mode === "local") {
        return api.executions.createLocalRun({
          project_id: projectId,
          app_type_id: appTypeId,
          test_case_ids: [testCase.id],
          name: `Automation run - ${testCase.title}`,
          created_by: session.user.id,
          engine_base_url: "http://host.docker.internal:4311"
        });
      }

      const execution = await api.executions.create({
        project_id: projectId,
        app_type_id: appTypeId,
        test_case_ids: [testCase.id],
        name: `Manual run - ${testCase.title}`,
        created_by: session.user.id
      });
      await api.executions.start(execution.id, { execution_mode: "remote" });
      return { id: execution.id, started: true };
    },
    onSuccess: (response, input) => {
      setMessage(`${input.mode === "local" ? "Local Test Engine" : "Manual"} run started as ${response.id}.`);
      void queryClient.invalidateQueries({ queryKey: ["executions"] });
      void queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to run case.")
  });

  const saveRepositoryEntry = useMutation({
    mutationFn: () => {
      if (!selectedRepositoryEntry) {
        throw new Error("Select an object repository field first.");
      }

      return api.testCases.updateLearningCacheEntry(selectedRepositoryEntry.id, {
        screen_name: repositoryDraft.screen_name,
        object_name: repositoryDraft.object_name,
        object_role: repositoryDraft.object_role,
        locator: repositoryDraft.locator,
        locator_kind: repositoryDraft.locator_kind,
        target_criteria: repositoryDraft.target_criteria.split(/\n+/).map((line) => line.trim()).filter(Boolean),
        dom_structure: repositoryDraft.dom_structure,
        screenshot_url: repositoryDraft.screenshot_url,
        fallback_strategy: repositoryDraft.fallback_strategy,
        platform: appTypes.find((appType) => appType.id === appTypeId)?.type || "web"
      });
    },
    onSuccess: () => {
      setMessage("Object repository field saved for execution-time locator resolution.");
      void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to save repository field.")
  });

  const improveRepositoryEntry = useMutation({
    mutationFn: () => {
      if (!selectedRepositoryEntry) {
        throw new Error("Select an object repository field first.");
      }

      return api.testCases.improveLearningCacheEntry(selectedRepositoryEntry.id, {
        integration_id: llmIntegration?.id,
        guidance: repositoryDraft.target_criteria || builderContext || undefined
      });
    },
    onSuccess: (response) => {
      setMessage(response.fallback_used ? `Repository improved with deterministic fallback: ${response.fallback_reason || "AI unavailable"}` : "AI improved the object repository field.");
      void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to improve repository field.")
  });

  const startRecorder = useMutation({
    mutationFn: (options: RecorderStartOptions) => {
      if (!activeManualCase) {
        throw new Error("Select a manual case first.");
      }

      return api.testCases.startRecorderSession(activeManualCase.id, {
        start_url: startUrl || undefined,
        recorder_mode: options.recorder_mode,
        recorder_target: options.recorder_target,
        engine_base_url: options.engine_base_url,
        recorder_public_base_url: options.recorder_public_base_url
      });
    },
    onSuccess: (response, options) => {
      setRecorderSession(response);
      setRecorderStartOptions(options);
      setMessage(response.live_view_url ? "Local Playwright recorder is active and learning repository objects." : "Recorder started.");
      invalidateAutomationData();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to start local Playwright recorder.")
  });

  const finishRecorder = useMutation({
    mutationFn: () => {
      if (!activeManualCase || !recorderSession?.id) {
        throw new Error("Start a recorder session before finishing it.");
      }

      return api.testCases.finishRecorderSession(activeManualCase.id, recorderSession.id, {
        transaction_id: recorderSession.transaction_id,
        additional_context: builderContext || undefined,
        recorder_mode: recorderStartOptions?.recorder_mode,
        recorder_target: recorderStartOptions?.recorder_target,
        engine_base_url: recorderStartOptions?.engine_base_url
      });
    },
    onSuccess: (response) => {
      setMessage(
        response.generated_step_count
          ? `Captured ${response.learned_locator_count} repository object${response.learned_locator_count === 1 ? "" : "s"} and updated ${response.generated_step_count} automation step${response.generated_step_count === 1 ? "" : "s"}.`
          : "Recorder stopped. No supported interactions were captured."
      );
      setRecorderSession(null);
      setRecorderStartOptions(null);
      invalidateAutomationData();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to finish recorder session.")
  });

  return (
    <div className="page-content page-content--automation">
      <PageHeader
        eyebrow="Automation"
        title="Automation workspace"
        description="Maintain automated cases, keyword steps, object repository learning, and local Playwright capture in one governed workspace."
        meta={[
          { label: "Automated cases", value: automatedCases.length },
          { label: "Manual link candidates", value: manualCases.length },
          { label: "Repository objects", value: learningCache.length }
        ]}
      />

      <SubnavTabs
        ariaLabel="Automation views"
        items={[
          { value: "cases", label: "Automated Cases", meta: `${automatedCases.length}`, icon: <SparkIcon /> },
          { value: "repository", label: "Object Repository", meta: `${groupedRepository.length} screens`, icon: <LayersIcon /> },
          { value: "local-playwright", label: "Local Playwright", meta: recorderSession ? "recording" : "capture", icon: <MousePointerIcon /> }
        ]}
        onChange={setView}
        value={view}
      />

      <WorkspaceScopeBar
        appTypeId={appTypeId}
        appTypes={appTypes}
        onAppTypeChange={(value) => {
          setAppTypeId(value);
          setSelectedAutomatedCaseId("");
          setSelectedManualCaseId("");
          setRecorderSession(null);
        }}
        onProjectChange={(value) => {
          setProjectId(value);
          setSelectedAutomatedCaseId("");
          setSelectedManualCaseId("");
          setRecorderSession(null);
        }}
        projectId={projectId}
        projects={projects}
      />

      {message ? <div className="empty-state compact">{message}</div> : null}

      {view === "cases" ? (
        <div className="automation-workspace-grid">
          <Panel title="Automated cases" subtitle="Automated case names stay aligned to their manual case name; the detail shows keyword automation, locators, and variables.">
            {testCasesQuery.isLoading ? <TileCardSkeletonGrid /> : null}
            {!testCasesQuery.isLoading && !automatedCases.length ? (
              <div className="empty-state compact">No automated cases yet. Build from a manual case or capture one with local Playwright.</div>
            ) : null}
            <div className="automation-case-list">
              {automatedCases.map((testCase) => (
                <button
                  className={activeAutomatedCase?.id === testCase.id ? "automation-case-row is-active" : "automation-case-row"}
                  key={testCase.id}
                  onClick={() => setSelectedAutomatedCaseId(testCase.id)}
                  type="button"
                >
                  <span>
                    <strong>{testCase.title}</strong>
                    <small>{testCase.display_id || "Automated case"} · linked manual case retained in QAira</small>
                  </span>
                  <StatusBadge value={testCase.status || "automated"} />
                </button>
              ))}
            </div>
          </Panel>

          <Panel
            className="automation-detail-panel"
            title={activeAutomatedCase?.title || "Automation detail"}
            subtitle="Keyword steps remain readable even when generated code is attached to the manual step."
            actions={activeAutomatedCase ? (
              <div className="testops-action-row">
                <button className="primary-button" disabled={runCase.isPending} onClick={() => runCase.mutate({ testCase: activeAutomatedCase, mode: "local" })} type="button">
                  <PlayIcon />
                  <span>{runCase.isPending ? "Starting..." : "Run automated"}</span>
                </button>
                <button className="ghost-button" disabled={runCase.isPending} onClick={() => runCase.mutate({ testCase: activeAutomatedCase, mode: "manual" })} type="button">
                  <ActivityIcon />
                  <span>Run manually</span>
                </button>
              </div>
            ) : undefined}
          >
            {!activeAutomatedCase ? (
              <div className="empty-state compact">Select an automated case to inspect its keyword steps.</div>
            ) : automatedStepsQuery.isLoading ? (
              <TileCardSkeletonGrid />
            ) : (
              <div className="automation-keyword-step-list">
                {automatedSteps.map((step) => {
                  const locators = extractQuotedTargets(step.automation_code);
                  const variables = extractVariables(step);

                  return (
                    <article className="automation-keyword-step" key={step.id}>
                      <div className="automation-keyword-step-head">
                        <span className="count-pill">Step {step.step_order}</span>
                        <StatusBadge value={step.automation_code ? "keyword-ready" : "manual-only"} />
                      </div>
                      <div>
                        <strong>{step.action || "No manual action recorded"}</strong>
                        <p>{step.expected_result || "No expected result recorded."}</p>
                      </div>
                      {step.automation_code ? <code className="automation-code-block automation-code-block--compact">{step.automation_code}</code> : null}
                      <div className="automation-step-meta-grid">
                        <div>
                          <span>Locators</span>
                          {locators.length ? locators.map((locator) => <code key={locator}>{locator}</code>) : <small>No locator parsed from keyword code.</small>}
                        </div>
                        <div>
                          <span>Variables</span>
                          {variables.length ? variables.map((variable) => <code key={variable}>{`{{${variable}}}`}</code>) : <small>No variables used.</small>}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      ) : null}

      {view === "repository" ? (
        <div className="automation-workspace-grid automation-workspace-grid--repository">
          <Panel title="Object repository" subtitle="Repository fields are grouped screen-wise with learned locator targets, DOM context, and screenshot references when the recorder provides them.">
            {learningCacheQuery.isLoading ? <TileCardSkeletonGrid /> : null}
            {!learningCacheQuery.isLoading && !groupedRepository.length ? (
              <div className="empty-state compact">No repository objects have been learned for this scope yet.</div>
            ) : null}
            <div className="object-repository-screen-list">
              {groupedRepository.map(([screenName, entries]) => (
                <section className="object-repository-screen" key={screenName}>
                  <div className="object-repository-screen-head">
                    <div>
                      <strong>{screenName}</strong>
                      <span>{entries.length} field{entries.length === 1 ? "" : "s"} learned</span>
                    </div>
                    <span className="count-pill">{entries[0]?.page_url || entries[0]?.page_key || "screen"}</span>
                  </div>
                  <div className="object-repository-field-grid">
                    {entries.map((entry) => {
                      const domStructure = normalizeMetadataValue(entry.metadata?.dom_structure) || normalizeMetadataValue(entry.metadata?.dom_path) || normalizeMetadataValue(entry.metadata?.html);
                      const screenshot = normalizeMetadataValue(entry.metadata?.screenshot_url) || normalizeMetadataValue(entry.metadata?.screenshot_path);

                      return (
                        <button className={selectedRepositoryEntry?.id === entry.id ? "object-repository-field is-active" : "object-repository-field"} key={entry.id} onClick={() => setSelectedRepositoryId(entry.id)} type="button">
                          <div className="object-repository-field-head">
                            <div>
                              <strong>{getObjectName(entry)}</strong>
                              <span>{getObjectRole(entry)} · confidence {Math.round(Number(entry.confidence || 0) * 100)}%</span>
                            </div>
                            <StatusBadge value={entry.source || "learned"} />
                          </div>
                          <label>Target locator</label>
                          <code>{entry.locator}</code>
                          <label>DOM structure</label>
                          <p>{domStructure || "DOM structure will appear after a recorder or builder capture includes it."}</p>
                          <label>Screenshot</label>
                          {screenshot ? <small>{screenshot}</small> : <small>No screenshot reference captured yet.</small>}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </Panel>

          <Panel
            className="automation-detail-panel"
            title="Field intelligence"
            subtitle="Curate the execution target. AI can propose DOM structure, page grouping, locator criteria, and visual fallback notes."
            actions={selectedRepositoryEntry ? (
              <div className="testops-action-row">
                <button className="ghost-button" disabled={improveRepositoryEntry.isPending} onClick={() => improveRepositoryEntry.mutate()} type="button">
                  <SparkIcon />
                  <span>{improveRepositoryEntry.isPending ? "Improving..." : "AI improve"}</span>
                </button>
                <button className="primary-button" disabled={saveRepositoryEntry.isPending} onClick={() => saveRepositoryEntry.mutate()} type="button">
                  <PlayIcon />
                  <span>{saveRepositoryEntry.isPending ? "Saving..." : "Save field"}</span>
                </button>
              </div>
            ) : undefined}
          >
            {!selectedRepositoryEntry ? (
              <div className="empty-state compact">Select a repository field to curate execution criteria.</div>
            ) : (
              <div className="record-grid testops-builder-form">
                <label className="form-field">
                  <span>Screen name</span>
                  <input value={repositoryDraft.screen_name} onChange={(event) => setRepositoryDraft((current) => ({ ...current, screen_name: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Field name</span>
                  <input value={repositoryDraft.object_name} onChange={(event) => setRepositoryDraft((current) => ({ ...current, object_name: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Role</span>
                  <input value={repositoryDraft.object_role} onChange={(event) => setRepositoryDraft((current) => ({ ...current, object_role: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Target locator</span>
                  <input value={repositoryDraft.locator} onChange={(event) => setRepositoryDraft((current) => ({ ...current, locator: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Locator kind</span>
                  <input value={repositoryDraft.locator_kind} onChange={(event) => setRepositoryDraft((current) => ({ ...current, locator_kind: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Screenshot URL</span>
                  <input value={repositoryDraft.screenshot_url} onChange={(event) => setRepositoryDraft((current) => ({ ...current, screenshot_url: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Target criteria</span>
                  <textarea rows={4} value={repositoryDraft.target_criteria} onChange={(event) => setRepositoryDraft((current) => ({ ...current, target_criteria: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>DOM or accessibility structure</span>
                  <textarea rows={5} value={repositoryDraft.dom_structure} onChange={(event) => setRepositoryDraft((current) => ({ ...current, dom_structure: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Visual fallback strategy</span>
                  <textarea rows={3} value={repositoryDraft.fallback_strategy} onChange={(event) => setRepositoryDraft((current) => ({ ...current, fallback_strategy: event.target.value }))} />
                </label>
                {repositoryDraft.screenshot_url ? (
                  <a className="ghost-button compact" href={repositoryDraft.screenshot_url} rel="noreferrer" target="_blank">
                    <OpenIcon size={16} />
                    <span>Open screenshot</span>
                  </a>
                ) : null}
              </div>
            )}
          </Panel>
        </div>
      ) : null}

      {view === "local-playwright" ? (
        <div className="automation-workspace-grid automation-workspace-grid--capture">
          <Panel title="Build repository with local Playwright" subtitle="Pick a manual case, open a local browser, and QAira will map captured actions back to keyword steps and repository objects.">
            <div className="record-grid testops-builder-form">
              <label className="form-field">
                <span>Manual case link</span>
                <select value={activeManualCase?.id || ""} onChange={(event) => setSelectedManualCaseId(event.target.value)}>
                  {manualCases.map((testCase) => (
                    <option key={testCase.id} value={testCase.id}>{testCase.title}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Start URL</span>
                <input onChange={(event) => setStartUrl(event.target.value)} placeholder="https://app.example.com/login" value={startUrl} />
              </label>
              <label className="form-field">
                <span>Variables and locator guidance</span>
                <textarea onChange={(event) => setBuilderContext(event.target.value)} placeholder="Example: use {{user.email}}, prefer data-testid locators, keep checkout screen names stable." rows={4} value={builderContext} />
              </label>
            </div>
            <div className="testops-action-row">
              <button className="ghost-button" disabled={!activeManualCase || buildSingleAutomation.isPending} onClick={() => buildSingleAutomation.mutate()} type="button">
                <SparkIcon />
                <span>{buildSingleAutomation.isPending ? "Queueing..." : "Queue AI automation"}</span>
              </button>
              <button className="ghost-button" disabled={!activeManualCase || runCase.isPending} onClick={() => activeManualCase ? runCase.mutate({ testCase: activeManualCase, mode: "manual" }) : undefined} type="button">
                <ActivityIcon />
                <span>{runCase.isPending ? "Starting..." : "Run manual case"}</span>
              </button>
              <button className="primary-button" disabled={!activeManualCase || runCase.isPending} onClick={() => activeManualCase ? runCase.mutate({ testCase: activeManualCase, mode: "local" }) : undefined} type="button">
                <PlayIcon />
                <span>{runCase.isPending ? "Starting..." : "Run automation"}</span>
              </button>
            </div>
            <RecorderStartControls
              disabled={!activeManualCase}
              hasSession={Boolean(recorderSession)}
              isStarting={startRecorder.isPending}
              localLabel="Build with Local Playwright"
              onStart={(options) => startRecorder.mutate(options)}
            />
            <div className="testops-action-row">
              <button className="primary-button" disabled={!recorderSession || finishRecorder.isPending} onClick={() => finishRecorder.mutate()} type="button">
                <PlayIcon />
                <span>{finishRecorder.isPending ? "Saving..." : "Stop and save repository"}</span>
              </button>
            </div>
          </Panel>

          <Panel className="automation-detail-panel" title="Capture monitor" subtitle={recorderSession ? `Session ${recorderSession.id.slice(0, 8)} · ${formatRecorderDisplayMode(recorderSession.display_mode)}` : "Start local Playwright to see captured actions, network calls, and live view."}>
            {recorderSession ? (
              <div className="stack-list">
                <div className="stack-item">
                  <div>
                    <strong>{recorderSession.action_count || 0} actions · {recorderSession.network_count || 0} API candidates</strong>
                    <span>{recorderSession.start_url || startUrl || "No start URL supplied."}</span>
                  </div>
                  <StatusBadge value={recorderSession.status} />
                </div>
              </div>
            ) : null}
            {recorderLiveUrl ? <iframe allow="clipboard-read; clipboard-write" className="recorder-live-frame" src={recorderLiveUrl} title="QAira local Playwright live view" /> : null}
            <RecorderSessionInsights session={recorderSession} />
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
