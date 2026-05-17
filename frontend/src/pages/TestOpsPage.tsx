import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityIcon, OpenIcon, SparkIcon, TrashIcon } from "../components/AppIcons";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ProgressMeter } from "../components/ProgressMeter";
import { RecorderSessionInsights } from "../components/RecorderSessionInsights";
import { RecorderStartControls, type RecorderStartOptions } from "../components/RecorderStartControls";
import { StatusBadge } from "../components/StatusBadge";
import { SubnavTabs } from "../components/SubnavTabs";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { useDeleteConfirmation } from "../components/DeleteConfirmationDialog";
import { useAuth } from "../auth/AuthContext";
import { useCurrentAppType, useCurrentProject } from "../hooks/useCurrentProject";
import { api } from "../lib/api";
import { buildBrowserUrl } from "../lib/integrationUrls";
import type { Integration, RecorderSessionResponse, TestCase, WorkspaceTransaction, WorkspaceTransactionArtifact } from "../types";

type TestOpsView = "automation-builder" | "batch-process" | "ops-telemetry" | "traces";

const BATCH_PROCESS_CATEGORIES = new Set([
  "bulk_import",
  "bulk_export",
  "ai_generation",
  "backup",
  "automation_build",
  "smart_execution",
  "reporting"
]);

function isBatchProcessTransaction(transaction: WorkspaceTransaction) {
  return BATCH_PROCESS_CATEGORIES.has(transaction.category)
    || transaction.action === "testengine_run"
    || transaction.action === "execution_report_export"
    || transaction.action === "run_report_export";
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDuration(start?: string | null, end?: string | null) {
  if (!start) {
    return "0s";
  }

  const startedAt = new Date(start).getTime();
  const endedAt = end ? new Date(end).getTime() : Date.now();

  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) {
    return "0s";
  }

  const seconds = Math.round((endedAt - startedAt) / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (!minutes) {
    return `${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return hours ? `${hours}h ${remainingMinutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function readNumberMetadata(transaction: WorkspaceTransaction | null, key: string) {
  const value = transaction?.metadata?.[key];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function resolveProgressPercent(transaction: WorkspaceTransaction | null) {
  if (!transaction) {
    return 0;
  }

  const explicit = readNumberMetadata(transaction, "progress_percent");

  if (explicit) {
    return Math.max(0, Math.min(100, explicit));
  }

  const total = readNumberMetadata(transaction, "total_items") || readNumberMetadata(transaction, "total_rows");
  const processed = readNumberMetadata(transaction, "processed_items");

  if (!total) {
    return transaction.status === "completed" ? 100 : 0;
  }

  return Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
}

function formatProgressDetail(transaction: WorkspaceTransaction | null) {
  if (!transaction) {
    return "";
  }

  const total = readNumberMetadata(transaction, "total_items") || readNumberMetadata(transaction, "total_rows");
  const processed = readNumberMetadata(transaction, "processed_items");
  const imported = readNumberMetadata(transaction, "imported") || readNumberMetadata(transaction, "exported");
  const failed = readNumberMetadata(transaction, "failed");

  return [
    total ? `${processed}/${total} processed` : "",
    imported ? `${imported} succeeded` : "",
    failed ? `${failed} failed` : ""
  ].filter(Boolean).join(" · ");
}

function formatLabel(value?: string | null) {
  return String(value || "unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resolveScopedIntegration(integrations: Integration[], type: Integration["type"], projectId: string) {
  const active = integrations.filter((integration) => integration.type === type && integration.is_active);
  const scoped = projectId
    ? active.find((integration) => String(integration.config?.project_id || "") === projectId)
    : null;

  return scoped || active.find((integration) => !String(integration.config?.project_id || "").trim()) || active[0] || null;
}

function formatRecorderDisplayMode(value?: string | null) {
  return value === "browser-live-view" ? "Live view" : value === "local-browser-with-live-view" ? "Local browser + live view" : "Recorder";
}

function isManualCase(testCase: TestCase) {
  return testCase.automated !== "yes";
}

export function TestOpsPage({ initialView = "batch-process" }: { initialView?: TestOpsView } = {}) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const [view, setView] = useState<TestOpsView>(initialView);
  const [selectedTransactionId, setSelectedTransactionId] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [startUrl, setStartUrl] = useState("");
  const [builderContext, setBuilderContext] = useState("");
  const [builderMessage, setBuilderMessage] = useState("");
  const [recorderSession, setRecorderSession] = useState<RecorderSessionResponse | null>(null);
  const [recorderStartOptions, setRecorderStartOptions] = useState<RecorderStartOptions | null>(null);
  const isAdmin = session?.user.role === "admin";

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
  const integrationsQuery = useQuery({
    queryKey: ["integrations", "testops"],
    queryFn: () => api.integrations.list({ is_active: true }),
    enabled: Boolean(session)
  });
  const transactionsQuery = useQuery({
    queryKey: ["workspace-transactions", "testops", projectId, appTypeId],
    queryFn: () => api.workspaceTransactions.list({
      project_id: projectId || undefined,
      app_type_id: appTypeId || undefined,
      include_global: true,
      limit: 150
    }),
    enabled: Boolean(projectId && session),
    refetchInterval: (query) =>
      Array.isArray(query.state.data) && query.state.data.some((transaction) => ["queued", "running"].includes(transaction.status))
        ? 15_000
        : false
  });
  const testCasesQuery = useQuery({
    queryKey: ["test-cases", "automation-builder", appTypeId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId && session && view === "automation-builder")
  });
  const learningCacheQuery = useQuery({
    queryKey: ["automation-learning-cache", projectId, appTypeId],
    queryFn: () => api.testCases.learningCache({
      project_id: projectId || undefined,
      app_type_id: appTypeId || undefined,
      limit: 25
    }),
    enabled: Boolean((projectId || appTypeId) && session && view === "automation-builder")
  });
  const transactionEventsQuery = useQuery({
    queryKey: ["workspace-transaction-events", "testops", selectedTransactionId],
    queryFn: () => api.workspaceTransactions.events(selectedTransactionId),
    enabled: Boolean(selectedTransactionId && session),
    refetchInterval: 15_000
  });
  const transactionArtifactsQuery = useQuery({
    queryKey: ["workspace-transaction-artifacts", "testops", selectedTransactionId],
    queryFn: () => api.workspaceTransactions.artifacts(selectedTransactionId),
    enabled: Boolean(selectedTransactionId && session),
    refetchInterval: 15_000
  });

  const projects = projectsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const integrations = integrationsQuery.data || [];
  const testCases = testCasesQuery.data || [];

  useEffect(() => {
    if (appTypesQuery.isPending) {
      return;
    }

    const scopedAppTypes = projectId
      ? appTypes.filter((appType) => String(appType.project_id) === String(projectId))
      : appTypes;

    if (projectId && appTypes.length && !scopedAppTypes.length) {
      return;
    }

    if (!scopedAppTypes.length) {
      setAppTypeId("");
      return;
    }

    if (!scopedAppTypes.some((appType) => appType.id === appTypeId)) {
      setAppTypeId(scopedAppTypes[0].id);
      setSelectedCaseId("");
      setSelectedCaseIds([]);
      setRecorderSession(null);
    }
  }, [appTypeId, appTypes, appTypesQuery.isPending, projectId, setAppTypeId]);

  const manualCases = useMemo(() => testCases.filter(isManualCase), [testCases]);
  const batchTransactions = useMemo(
    () => (transactionsQuery.data || []).filter(isBatchProcessTransaction),
    [transactionsQuery.data]
  );
  const deletableBatchTransactions = useMemo(
    () => batchTransactions,
    [batchTransactions]
  );
  const selectedTransaction = batchTransactions.find((transaction) => transaction.id === selectedTransactionId) || null;
  const testEngineIntegration = resolveScopedIntegration(integrations, "testengine", projectId);
  const llmIntegration = resolveScopedIntegration(integrations, "llm", projectId);
  const opsIntegration = resolveScopedIntegration(integrations, "ops", projectId);
  const opsBoardUrl = buildBrowserUrl(testEngineIntegration, "/ops-telemetry", [
    "ops_public_base_url",
    "public_base_url",
    "recorder_public_base_url",
    "live_view_url"
  ]);
  const runningCount = batchTransactions.filter((transaction) => transaction.status === "queued" || transaction.status === "running").length;
  const failedCount = batchTransactions.filter((transaction) => transaction.status === "failed").length;
  const activeCase = testCases.find((testCase) => testCase.id === selectedCaseId) || manualCases[0] || null;
  const learningCache = learningCacheQuery.data || [];
  const recorderLiveUrl = recorderSession?.live_view_url || "";

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
        // Live recorder counters are best-effort and should not interrupt the recorder.
      }
    };
    const timer = window.setInterval(() => void refreshRecorderSession(), 1000);

    void refreshRecorderSession();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [recorderSession?.id, recorderSession?.status, recorderSession?.status_url]);

  const invalidateAutomationViews = () => {
    void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    void queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] });
    void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
  };

  const buildSingleAutomation = useMutation({
    mutationFn: () => {
      if (!activeCase) {
        throw new Error("Select a manual web case first.");
      }

      return api.testCases.queueAutomationGenerator(activeCase.id, {
        integration_id: llmIntegration?.id,
        start_url: startUrl || undefined,
        additional_context: builderContext || undefined
      });
    },
    onSuccess: (response) => {
      setBuilderMessage(`Automation generator queued as ${response.transaction_id}.`);
      setSelectedTransactionId(response.transaction_id);
      setView("batch-process");
      invalidateAutomationViews();
    },
    onError: (error) => setBuilderMessage(error instanceof Error ? error.message : "Unable to build automation.")
  });

  const buildBatchAutomation = useMutation({
    mutationFn: () => {
      if (!appTypeId) {
        throw new Error("Select an app type first.");
      }

      return api.testCases.buildAutomationBatch({
        app_type_id: appTypeId,
        test_case_ids: selectedCaseIds,
        integration_id: llmIntegration?.id,
        start_url: startUrl || undefined,
        additional_context: builderContext || undefined
      });
    },
    onSuccess: (response) => {
      setBuilderMessage(`Batch AI automation queued as ${response.transaction_id}.`);
      setSelectedTransactionId(response.transaction_id);
      setView("batch-process");
      invalidateAutomationViews();
    },
    onError: (error) => setBuilderMessage(error instanceof Error ? error.message : "Unable to queue batch automation.")
  });

  const startRecorder = useMutation({
    mutationFn: (options: RecorderStartOptions) => {
      if (!activeCase) {
        throw new Error("Select a manual web case first.");
      }

      return api.testCases.startRecorderSession(activeCase.id, {
        start_url: startUrl || undefined,
        recorder_mode: options.recorder_mode,
        engine_base_url: options.engine_base_url,
        recorder_public_base_url: options.recorder_public_base_url
      });
    },
    onSuccess: (response, options) => {
      setRecorderSession(response);
      setRecorderStartOptions(options);
      setBuilderMessage(response.live_view_url ? "Recorder live view is ready in QAira." : "Recorder started in the Test Engine browser session.");
      invalidateAutomationViews();
    },
    onError: (error) => setBuilderMessage(error instanceof Error ? error.message : "Unable to start recorder.")
  });

  const finishRecorder = useMutation({
    mutationFn: () => {
      if (!activeCase || !recorderSession?.id) {
        throw new Error("Start a recorder session before finishing it.");
      }

      return api.testCases.finishRecorderSession(activeCase.id, recorderSession.id, {
        transaction_id: recorderSession.transaction_id,
        integration_id: llmIntegration?.id,
        additional_context: builderContext || undefined,
        recorder_mode: recorderStartOptions?.recorder_mode,
        engine_base_url: recorderStartOptions?.engine_base_url
      });
    },
    onSuccess: (response) => {
      setBuilderMessage(
        response.generated_step_count
          ? `Recorder stopped. Created ${response.created_step_count || 0} and updated ${response.updated_step_count || 0} web step${response.generated_step_count === 1 ? "" : "s"}.`
          : "Recorder stopped. No supported interactions were captured for step creation."
      );
      setRecorderSession(null);
      setRecorderStartOptions(null);
      invalidateAutomationViews();
    },
    onError: (error) => setBuilderMessage(error instanceof Error ? error.message : "Unable to finish recorder session.")
  });

  const deleteBatchLog = useMutation({
    mutationFn: (transactionId: string) => api.workspaceTransactions.delete(transactionId),
    onSuccess: async (_, transactionId) => {
      if (selectedTransactionId === transactionId) {
        setSelectedTransactionId("");
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-transaction-events"] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-transaction-artifacts"] })
      ]);
    }
  });

  const handleDownloadArtifact = async (artifact: WorkspaceTransactionArtifact) => {
    if (!selectedTransaction) {
      return;
    }

    const blob = await api.workspaceTransactions.downloadArtifact(selectedTransaction.id, artifact.id);
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = href;
    link.download = artifact.file_name || "artifact";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  };

  const handleDeleteSelectedBatchLog = async () => {
    if (!selectedTransaction || !(await confirmDelete({ message: `Delete batch process log "${selectedTransaction.title}"?` }))) {
      return;
    }

    try {
      await deleteBatchLog.mutateAsync(selectedTransaction.id);
      setBuilderMessage("Batch process log deleted.");
    } catch (error) {
      setBuilderMessage(error instanceof Error ? error.message : "Unable to delete batch process log.");
    }
  };

  const handleDeleteVisibleBatchLogs = async () => {
    if (!deletableBatchTransactions.length || !(await confirmDelete({ message: `Delete ${deletableBatchTransactions.length} batch process log${deletableBatchTransactions.length === 1 ? "" : "s"}?` }))) {
      return;
    }

    let deleted = 0;

    for (const transaction of deletableBatchTransactions) {
      try {
        await deleteBatchLog.mutateAsync(transaction.id);
        deleted += 1;
      } catch (error) {
        setBuilderMessage(`${deleted} log${deleted === 1 ? "" : "s"} deleted before a failure. ${error instanceof Error ? error.message : "Unable to delete one of the logs."}`);
        return;
      }
    }

    setBuilderMessage(`${deleted} batch process log${deleted === 1 ? "" : "s"} deleted.`);
  };

  return (
    <div className="page-content page-content--testops">
      {confirmationDialog}
      <PageHeader
        eyebrow="TestOps"
        title="TestOps"
        description="Monitor background automation builds, imports, exports, reports, Test Engine jobs, and OPS telemetry without leaving QAira."
        meta={[
          { label: "Batch records", value: batchTransactions.length },
          { label: "Running", value: runningCount },
          { label: "OPS board", value: opsBoardUrl ? "Ready" : "Not configured" }
        ]}
      />

      <SubnavTabs
        ariaLabel="TestOps views"
        items={[
          { value: "batch-process", label: "Batch Process", meta: `${batchTransactions.length}`, icon: <ActivityIcon /> },
          { value: "ops-telemetry", label: "OPS Telemetry", meta: opsBoardUrl ? "iframe" : "setup", icon: <ActivityIcon /> },
          { value: "traces", label: "Traces", meta: "iframe", icon: <ActivityIcon /> }
        ]}
        onChange={setView}
        value={view}
      />

      <WorkspaceScopeBar
        appTypeId={appTypeId}
        appTypes={appTypes}
        onAppTypeChange={(value) => {
          setAppTypeId(value);
          setSelectedCaseId("");
          setSelectedCaseIds([]);
          setRecorderSession(null);
        }}
        onProjectChange={(value) => {
          setProjectId(value);
          setSelectedTransactionId("");
          setSelectedCaseId("");
          setSelectedCaseIds([]);
          setRecorderSession(null);
        }}
        projectId={projectId}
        projects={projects}
      />

      {builderMessage && view !== "automation-builder" ? <div className="empty-state compact">{builderMessage}</div> : null}

      {view === "automation-builder" ? (
        <div className="testops-builder-layout">
          <Panel
            className="testops-panel"
            title="Manual web cases"
            subtitle="Select one case for an immediate AI build or choose several for a background batch."
          >
            {!appTypeId ? <div className="empty-state compact">Select a web app type to load manual cases.</div> : null}
            {testCasesQuery.isLoading ? <TileCardSkeletonGrid /> : null}
            {!testCasesQuery.isLoading && appTypeId && !manualCases.length ? (
              <div className="empty-state compact">No manual cases are waiting for automation in this app type.</div>
            ) : null}
            {manualCases.length ? (
              <div className="testops-case-picker">
                {manualCases.map((testCase) => {
                  const isActive = activeCase?.id === testCase.id;
                  const isChecked = selectedCaseIds.includes(testCase.id);

                  return (
                    <article className={isActive ? "record-card tile-card is-active" : "record-card tile-card"} key={testCase.id}>
                      <div className="tile-card-main">
                        <div className="tile-card-header">
                          <label className="checkbox-field">
                            <input
                              checked={isChecked}
                              onChange={(event) =>
                                setSelectedCaseIds((current) =>
                                  event.target.checked
                                    ? [...new Set([...current, testCase.id])]
                                    : current.filter((id) => id !== testCase.id)
                                )
                              }
                              type="checkbox"
                            />
                          </label>
                          <div className="tile-card-title-group">
                            <strong>{testCase.title}</strong>
                            <span className="tile-card-kicker">{testCase.display_id || "Manual case"}</span>
                          </div>
                          <StatusBadge value={testCase.status || "draft"} />
                        </div>
                        <p className="tile-card-description">{testCase.description || "No description recorded yet."}</p>
                        <div className="integration-card-footer">
                          <button className="ghost-button compact" onClick={() => setSelectedCaseId(testCase.id)} type="button">
                            <SparkIcon size={16} />
                            <span>{isActive ? "Selected" : "Use case"}</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </Panel>

          <Panel
            className="testops-panel testops-automation-panel"
            title="AI automation build"
            subtitle={activeCase ? `Target case: ${activeCase.title}` : "Choose a manual case to generate keyword automation."}
          >
            <div className="detail-stack">
              <div className="metric-strip compact">
                <div className="mini-card">
                  <strong>{llmIntegration ? "Ready" : "Fallback"}</strong>
                  <span>LLM</span>
                </div>
                <div className="mini-card">
                  <strong>{testEngineIntegration ? "Ready" : "Setup"}</strong>
                  <span>Local recorder</span>
                </div>
                <div className="mini-card">
                  <strong>{learningCache.length}</strong>
                  <span>Cached locators</span>
                </div>
                <div className="mini-card">
                  <strong>{selectedCaseIds.length || manualCases.length}</strong>
                  <span>Batch scope</span>
                </div>
              </div>

              <div className="record-grid testops-builder-form">
                <label className="form-field">
                  <span>Start URL</span>
                  <input
                    onChange={(event) => setStartUrl(event.target.value)}
                    placeholder="https://app.example.com/login"
                    value={startUrl}
                  />
                </label>
                <label className="form-field">
                  <span>Builder guidance</span>
                  <textarea
                    onChange={(event) => setBuilderContext(event.target.value)}
                    placeholder="Preferred flows, auth assumptions, test data tokens, or areas to ignore."
                    rows={4}
                    value={builderContext}
                  />
                </label>
              </div>

              {builderMessage ? <div className="empty-state compact">{builderMessage}</div> : null}

              <div className="testops-action-row">
                <button
                  className="primary-button"
                  disabled={!activeCase || buildSingleAutomation.isPending}
                  onClick={() => buildSingleAutomation.mutate()}
                  type="button"
                >
                  <SparkIcon />
                  <span>{buildSingleAutomation.isPending ? "Automating…" : "Automate case with AI"}</span>
                </button>
                <button
                  className="ghost-button"
                  disabled={!appTypeId || buildBatchAutomation.isPending}
                  onClick={() => buildBatchAutomation.mutate()}
                  type="button"
                >
                  <ActivityIcon />
                  <span>{buildBatchAutomation.isPending ? "Queueing…" : selectedCaseIds.length ? "Queue selected AI batch" : "Queue manual AI batch"}</span>
                </button>
              </div>

              <div className="stack-list">
                <div className="stack-item">
                  <div>
                    <strong>Test case recorder</strong>
                    <span>Starts a browser-backed Test Engine session, captures user actions once, suppresses duplicate typing, and records fetch/XHR traffic for API test suggestions.</span>
                  </div>
                  <div className="recorder-workspace-pane">
                    <RecorderStartControls
                      disabled={!activeCase || !testEngineIntegration}
                      hasSession={Boolean(recorderSession)}
                      isStarting={startRecorder.isPending}
                      onStart={(options) => startRecorder.mutate(options)}
                    />
                    <div className="testops-recorder-actions recorder-control-buttons">
                      <button
                        className="primary-button"
                        disabled={!recorderSession || finishRecorder.isPending}
                        onClick={() => finishRecorder.mutate()}
                        type="button"
                      >
                        <SparkIcon size={16} />
                        <span>{finishRecorder.isPending ? "Stopping…" : "Stop and create steps"}</span>
                      </button>
                    </div>
                  </div>
                </div>
                {recorderSession ? (
                  <div className="stack-item">
                    <div>
                      <strong>Recorder session {recorderSession.id.slice(0, 8)}</strong>
                      <span>
                        {formatRecorderDisplayMode(recorderSession.display_mode)}
                        {" · "}
                        {recorderSession.action_count || 0} actions · {recorderSession.network_count || 0} API candidates
                      </span>
                    </div>
                    {recorderLiveUrl ? (
                      <a className="ghost-button compact" href={recorderLiveUrl} rel="noreferrer" target="_blank">
                        <OpenIcon size={16} />
                        <span>Open live view</span>
                      </a>
                    ) : null}
                    <StatusBadge value={recorderSession.status} />
                  </div>
                ) : null}
                {recorderLiveUrl ? (
                  <iframe
                    allow="clipboard-read; clipboard-write"
                    className="recorder-live-frame"
                    src={recorderLiveUrl}
                    title="QAira recorder live view"
                  />
                ) : null}
                <RecorderSessionInsights session={recorderSession} />
              </div>

              <div className="execution-context-summary-head">
                <div className="execution-context-summary-copy">
                  <strong>Object repository</strong>
                  <span>Screens, labels, field names, and locators learned from AI builds and recorder sessions are reused across later builds in this scope.</span>
                </div>
                <span className="count-pill">{learningCache.length} cached</span>
              </div>
              {learningCache.length ? (
                <div className="stack-list testops-learning-list">
                  {learningCache.slice(0, 8).map((entry) => (
                    <div className="stack-item" key={entry.id}>
                      <div>
                        <strong>{typeof entry.metadata?.object_name === "string" ? entry.metadata.object_name : entry.locator_intent}</strong>
                        <span>
                          {typeof entry.metadata?.screen_name === "string" ? entry.metadata.screen_name : entry.page_key}
                          {" · "}
                          {typeof entry.metadata?.object_role === "string" ? entry.metadata.object_role : entry.locator_kind || entry.source}
                        </span>
                      </div>
                      <code className="execution-operation-json">{entry.locator}</code>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state compact">No object repository learning has been cached for this scope yet.</div>
              )}
            </div>
          </Panel>
        </div>
      ) : view === "batch-process" ? (
        <div className="testops-layout">
          <Panel
            className="testops-panel"
            title="Batch process"
            subtitle="Imports, exports, automation handoffs, generated cases, reports, and sync work appear here with their latest trace state."
            actions={
              isAdmin ? (
                <button
                  className="ghost-button danger"
                  disabled={!deletableBatchTransactions.length || deleteBatchLog.isPending}
                  onClick={() => void handleDeleteVisibleBatchLogs()}
                  type="button"
                >
                  <TrashIcon size={16} />
                  <span>{deleteBatchLog.isPending ? "Deleting..." : "Delete logs"}</span>
                </button>
              ) : undefined
            }
          >
            {transactionsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
            {!transactionsQuery.isLoading && batchTransactions.length ? (
              <div className="testops-operation-grid">
                {batchTransactions.map((transaction) => (
                  <button
                    className={selectedTransactionId === transaction.id ? "record-card tile-card is-active" : "record-card tile-card"}
                    key={transaction.id}
                    onClick={() => setSelectedTransactionId(transaction.id)}
                    type="button"
                  >
                    <div className="tile-card-main">
                      <div className="tile-card-header">
                        <span className="integration-type-badge"><ActivityIcon size={18} /></span>
                        <div className="tile-card-title-group">
                          <strong>{transaction.title}</strong>
                          <span className="tile-card-kicker">{formatLabel(transaction.action)}</span>
                        </div>
                        <StatusBadge value={transaction.status} />
                      </div>
                      <p className="tile-card-description">{transaction.description || formatLabel(transaction.category)}</p>
                      <ProgressMeter
                        value={resolveProgressPercent(transaction)}
                        label={formatLabel(String(transaction.metadata?.current_phase || transaction.status))}
                        detail={formatProgressDetail(transaction)}
                        tone={transaction.status === "failed" ? "danger" : transaction.status === "completed" ? "success" : "info"}
                      />
                      <div className="integration-card-footer">
                        <span className="count-pill">{transaction.event_count || 0} events</span>
                        <span className="count-pill">
                          {formatDuration(transaction.started_at || transaction.created_at, transaction.completed_at || transaction.updated_at)}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            {!transactionsQuery.isLoading && !batchTransactions.length ? (
              <div className="empty-state compact">No batch process records have been recorded for this scope yet.</div>
            ) : null}
          </Panel>

          <Panel
            className="testops-panel testops-detail-panel"
            title={selectedTransaction ? selectedTransaction.title : "Process trace"}
            subtitle={selectedTransaction ? "The latest metadata and event timeline for this operation." : "Choose a batch process card to inspect its trace."}
            actions={
              isAdmin && selectedTransaction ? (
                <button
                  className="ghost-button danger"
                  disabled={deleteBatchLog.isPending}
                  onClick={() => void handleDeleteSelectedBatchLog()}
                  type="button"
                >
                  <TrashIcon size={16} />
                  <span>{deleteBatchLog.isPending ? "Deleting..." : "Delete log"}</span>
                </button>
              ) : undefined
            }
          >
            {selectedTransaction ? (
              <div className="detail-stack">
                <div className="metric-strip compact">
                  <div className="mini-card">
                    <strong>{selectedTransaction.status}</strong>
                    <span>Status</span>
                  </div>
                  <div className="mini-card">
                    <strong>{selectedTransaction.event_count || 0}</strong>
                    <span>Events</span>
                  </div>
                  <div className="mini-card">
                    <strong>{failedCount}</strong>
                    <span>Failures in scope</span>
                  </div>
                  <div className="mini-card">
                    <strong>{resolveProgressPercent(selectedTransaction)}%</strong>
                    <span>Progress</span>
                  </div>
                </div>
                <ProgressMeter
                  value={resolveProgressPercent(selectedTransaction)}
                  label={formatLabel(String(selectedTransaction.metadata?.current_phase || selectedTransaction.status))}
                  detail={formatProgressDetail(selectedTransaction)}
                  tone={selectedTransaction.status === "failed" ? "danger" : selectedTransaction.status === "completed" ? "success" : "info"}
                />
                <div className="stack-list">
                  <div className="stack-item">
                    <div>
                      <strong>Category</strong>
                      <span>{formatLabel(selectedTransaction.category)}</span>
                    </div>
                    <StatusBadge value={selectedTransaction.status} />
                  </div>
                  <div className="stack-item">
                    <div>
                      <strong>Latest activity</strong>
                      <span>{formatTimestamp(selectedTransaction.latest_event_at || selectedTransaction.updated_at)}</span>
                    </div>
                  </div>
                  {Object.keys(selectedTransaction.metadata || {}).length ? (
                    <div className="stack-item execution-operation-metadata">
                      <div>
                        <strong>Metadata</strong>
                        <span>Structured context emitted by the operation.</span>
                      </div>
                      <code className="execution-operation-json">{JSON.stringify(selectedTransaction.metadata, null, 2)}</code>
                    </div>
                  ) : null}
                </div>

                {(transactionArtifactsQuery.data || []).length ? (
                  <div className="stack-list">
                    {(transactionArtifactsQuery.data || []).map((artifact) => (
                      <div className="stack-item" key={artifact.id}>
                        <div>
                          <strong>{artifact.file_name}</strong>
                          <span>{artifact.mime_type} · {formatTimestamp(artifact.created_at)}</span>
                        </div>
                        <button className="ghost-button" onClick={() => void handleDownloadArtifact(artifact)} type="button">
                          <OpenIcon size={16} />
                          <span>Download</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="execution-context-summary-head">
                  <div className="execution-context-summary-copy">
                    <strong>Trace log</strong>
                    <span>Recorded operation stages in chronological order.</span>
                  </div>
                  <span className="count-pill">{(transactionEventsQuery.data || []).length} events</span>
                </div>

                {transactionEventsQuery.isLoading ? <div className="empty-state compact">Loading process events...</div> : null}
                {!transactionEventsQuery.isLoading && !(transactionEventsQuery.data || []).length ? (
                  <div className="empty-state compact">No events have been recorded for this process yet.</div>
                ) : null}
                {(transactionEventsQuery.data || []).length ? (
                  <div className="stack-list execution-activity-list">
                    {(transactionEventsQuery.data || []).map((event) => (
                      <details className="stack-item execution-operation-event" key={event.id}>
                        <summary className="execution-operation-event-summary">
                          <div>
                            <strong>{event.message}</strong>
                            <span>{event.phase ? `${event.phase} · ` : ""}{formatTimestamp(event.created_at)}</span>
                          </div>
                          <span className={`status-badge ${event.level}`}>{event.level}</span>
                        </summary>
                        {Object.keys(event.details || {}).length ? (
                          <code className="execution-operation-json">{JSON.stringify(event.details, null, 2)}</code>
                        ) : null}
                      </details>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-state compact">Choose a process card to review its metadata and trace log.</div>
            )}
          </Panel>
        </div>
      ) : view === "ops-telemetry" ? (
        <Panel
          className="testops-panel testops-telemetry-panel"
          title="OPS telemetry"
          subtitle={opsIntegration ? `Using ${opsIntegration.name}` : "Configure an active OPS telemetry integration and Test Engine host to load the board."}
          actions={
            opsBoardUrl ? (
              <a className="ghost-button" href={opsBoardUrl} rel="noreferrer" target="_blank">
                <OpenIcon />
                <span>Open board</span>
              </a>
            ) : undefined
          }
        >
          {opsBoardUrl ? (
            <iframe
              className="testops-telemetry-frame"
              src={opsBoardUrl}
              title="OPS telemetry dashboard"
            />
          ) : (
            <div className="empty-state compact">
              Activate a Test Engine integration for this project so QAira can resolve the hosted OPS telemetry board.
            </div>
          )}
        </Panel>
      ) : (
        <Panel
          className="testops-panel testops-telemetry-panel"
          title="Distributed Traces"
          subtitle="View full OpenTelemetry traces from QAira and TestEngine via local Jaeger instance."
          actions={
            <a className="ghost-button" href="http://localhost:16686" rel="noreferrer" target="_blank">
              <OpenIcon />
              <span>Open Jaeger in new tab</span>
            </a>
          }
        >
          <iframe
            className="testops-telemetry-frame"
            src="http://localhost:16686"
            title="Jaeger Traces"
          />
        </Panel>
      )}
    </div>
  );
}
