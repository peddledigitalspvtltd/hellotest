import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ActivityIcon, OpenIcon, SparkIcon, TrashIcon } from "../components/AppIcons";
import { CatalogCardDescription } from "../components/CatalogCardDescription";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { CatalogSelectionControls } from "../components/CatalogSelectionControls";
import { CatalogViewToggle } from "../components/CatalogViewToggle";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { InfoTooltip } from "../components/InfoTooltip";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ProgressMeter } from "../components/ProgressMeter";
import { RecorderSessionInsights } from "../components/RecorderSessionInsights";
import { RecorderStartControls, type RecorderStartOptions } from "../components/RecorderStartControls";
import { StatusBadge } from "../components/StatusBadge";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { TileCardProgress } from "../components/TileCardPrimitives";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
import { useDeleteConfirmation } from "../components/DeleteConfirmationDialog";
import { useAuth } from "../auth/AuthContext";
import { useCurrentAppType, useCurrentProject } from "../hooks/useCurrentProject";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { api } from "../lib/api";
import { asArray } from "../lib/collectionGuards";
import {
  canEditAutomationCode as resolveCanEditAutomationCode,
  canGenerateAutomationCode as resolveCanGenerateAutomationCode,
  canRecordAutomationCode as resolveCanRecordAutomationCode
} from "../lib/automationAccess";
import { areFeatureFlagsEnabled } from "../lib/featureFlags";
import { hasPermission } from "../lib/permissions";
import { isRovoIntegrationId } from "../lib/rovo";
import { readDefaultCatalogViewMode } from "../lib/viewPreferences";
import { transactionTileProgress } from "../lib/transactionTileProgress";
import type { Integration, OpsTelemetryEvent, RecorderSessionResponse, TestCase, WorkspaceTransaction, WorkspaceTransactionArtifact } from "../types";
import "./TestOpsPage.rovo.css";

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

function truncateProcessName(value?: string | null, limit = 46) {
  const normalized = String(value || "Batch process").trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function describeOpsEventScope(event: OpsTelemetryEvent) {
  return event.execution?.name
    || event.test_case?.title
    || event.suite?.name
    || event.step?.action
    || "Project telemetry";
}

function resolveScopedIntegration(integrations: Integration[], type: Integration["type"], projectId: string) {
  const active = integrations.filter((integration) =>
    integration.type === type
    && integration.is_active
    && (type !== "llm" || !isRovoIntegrationId(integration.id))
  );
  const scoped = projectId
    ? active.find((integration) => String(integration.config?.project_id || "") === projectId)
    : null;

  return scoped || active.find((integration) => !String(integration.config?.project_id || "").trim()) || active[0] || null;
}

function formatRecorderDisplayMode(value?: string | null) {
  return value === "browser-live-view" ? "Live view" : value === "local-browser-with-live-view" ? "Local browser + live view" : "Recorder";
}

function isManualCase(testCase: TestCase) {
  return testCase.automated === "no";
}

export function TestOpsPage({ initialView = "batch-process" }: { initialView?: TestOpsView } = {}) {
  const { session } = useAuth();
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const [projectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const [view, setView] = useState<TestOpsView>(initialView);
  const [selectedTransactionId, setSelectedTransactionId] = useState("");
  const [batchProcessViewMode, setBatchProcessViewMode] = useState<"tile" | "list">(() => readDefaultCatalogViewMode());
  const [batchProcessSearch, setBatchProcessSearch] = useState("");
  const [selectedBatchLogIds, setSelectedBatchLogIds] = useState<string[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [startUrl, setStartUrl] = useState("");
  const [builderContext, setBuilderContext] = useState("");
  const [builderMessage, setBuilderMessage] = useState("");
  const [opsTelemetrySearch, setOpsTelemetrySearch] = useState("");
  const watchedBatchStatusesRef = useRef<Map<string, string>>(new Map());
  const [recorderSession, setRecorderSession] = useState<RecorderSessionResponse | null>(null);
  const [recorderStartOptions, setRecorderStartOptions] = useState<RecorderStartOptions | null>(null);
  const canUseAutomationWorkspace = areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.workspace"]);
  const canUseBatchProcesses = areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.batch_process", "hellotest.ops.background_jobs"]);
  const canBuildAutomation = resolveCanEditAutomationCode(session, featureFlagsQuery.data, projectId);
  const canUseAutomationAi = resolveCanGenerateAutomationCode(session, featureFlagsQuery.data, projectId);
  const canUseRecorder = resolveCanRecordAutomationCode(session, featureFlagsQuery.data, projectId);
  const canViewAutomationLearning = hasPermission(session, "automation.view", projectId)
    && canUseAutomationWorkspace
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.object_repository"]);
  const canManageTransactions = hasPermission(session, "transaction.manage", projectId) && canUseBatchProcesses;
  const canDownloadArtifacts = hasPermission(session, "transaction.artifact.download", projectId) && canUseBatchProcesses;

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const appTypesQuery = useQuery({
    queryKey: ["app-types", projectId],
    queryFn: ({ signal }) => api.appTypes.list({ project_id: projectId }, { signal }),
    enabled: Boolean(projectId && session && view === "automation-builder")
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations", "testops"],
    queryFn: ({ signal }) => api.integrations.list({ is_active: true }, { signal }),
    enabled: Boolean(session && (view === "automation-builder" || view === "ops-telemetry"))
  });
  const transactionsQuery = useQuery({
    // Project-level batch jobs (including Story imports) do not always belong to
    // an app type, so TestOps must not hide them behind the app-type filter.
    queryKey: ["workspace-transactions", "testops", projectId],
    queryFn: ({ signal }) => api.workspaceTransactions.list({
      project_id: projectId || undefined,
      limit: 300
    }, { signal }),
    enabled: Boolean(projectId && session && canUseBatchProcesses && (view === "batch-process" || view === "automation-builder")),
    refetchInterval: (query) =>
      Array.isArray(query.state.data) && query.state.data.some((transaction) => ["queued", "running"].includes(transaction.status))
        ? 15_000
        : false
  });
  const testCasesQuery = useQuery({
    queryKey: ["test-cases", "automation-builder", appTypeId],
    queryFn: ({ signal }) => api.testCases.list({ app_type_id: appTypeId, projection: "summary" }, { signal }),
    enabled: Boolean(appTypeId && session && view === "automation-builder" && (canBuildAutomation || canUseRecorder))
  });
  const learningCacheQuery = useQuery({
    queryKey: ["automation-learning-cache", projectId, appTypeId],
    queryFn: ({ signal }) => api.testCases.learningCache({
      project_id: projectId || undefined,
      app_type_id: appTypeId || undefined,
      limit: 25
    }, { signal }),
    enabled: Boolean((projectId || appTypeId) && session && view === "automation-builder" && canViewAutomationLearning)
  });
  const selectedTransactionStatus = transactionsQuery.data?.find((transaction) => transaction.id === selectedTransactionId)?.status;
  const selectedTransactionIsRunning = ["queued", "running"].includes(selectedTransactionStatus || "");
  const transactionEventsQuery = useQuery({
    // Include status so completion fetches the final records before polling stops.
    queryKey: ["workspace-transaction-events", "testops", selectedTransactionId, selectedTransactionStatus],
    queryFn: ({ signal }) => api.workspaceTransactions.events(selectedTransactionId, { signal }),
    enabled: Boolean(selectedTransactionId && session && canUseBatchProcesses && view === "batch-process"),
    refetchInterval: selectedTransactionIsRunning ? 15_000 : false
  });
  const transactionArtifactsQuery = useQuery({
    queryKey: ["workspace-transaction-artifacts", "testops", selectedTransactionId, selectedTransactionStatus],
    queryFn: ({ signal }) => api.workspaceTransactions.artifacts(selectedTransactionId, { signal }),
    enabled: Boolean(selectedTransactionId && session && canUseBatchProcesses && view === "batch-process"),
    refetchInterval: selectedTransactionIsRunning ? 15_000 : false
  });

  const appTypes = asArray(appTypesQuery.data);
  const integrations = asArray(integrationsQuery.data);
  const testCases = asArray(testCasesQuery.data);

  useEffect(() => {
    if (view !== "automation-builder" || appTypesQuery.isPending) {
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
  }, [appTypeId, appTypes, appTypesQuery.isPending, projectId, setAppTypeId, view]);

  const manualCases = useMemo(() => testCases.filter(isManualCase), [testCases]);
  const unknownAutomationCases = useMemo(
    () => testCases.filter((testCase) => testCase.automated !== "yes" && testCase.automated !== "no"),
    [testCases]
  );
  const batchTransactions = useMemo(
    () => (transactionsQuery.data || []).filter(isBatchProcessTransaction),
    [transactionsQuery.data]
  );
  const filteredBatchTransactions = useMemo(() => {
    const normalizedSearch = batchProcessSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return batchTransactions;
    }

    return batchTransactions.filter((transaction) => {
      const metadataValues = Object.values(transaction.metadata || {}).map((value) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : ""
      );
      return [
        transaction.id,
        transaction.title,
        transaction.description,
        transaction.category,
        transaction.action,
        transaction.status,
        formatLabel(transaction.category),
        formatLabel(transaction.action),
        ...metadataValues
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [batchProcessSearch, batchTransactions]);
  const visibleBatchTransactionIds = useMemo(
    () => filteredBatchTransactions.map((transaction) => transaction.id),
    [filteredBatchTransactions]
  );
  const selectedBatchLogTransactions = useMemo(
    () => batchTransactions.filter((transaction) => selectedBatchLogIds.includes(transaction.id)),
    [batchTransactions, selectedBatchLogIds]
  );
  const areAllFilteredBatchLogsSelected =
    Boolean(visibleBatchTransactionIds.length) && visibleBatchTransactionIds.every((id) => selectedBatchLogIds.includes(id));
  const selectedTransaction = batchTransactions.find((transaction) => transaction.id === selectedTransactionId) || null;

  const syncProcessSearchParams = (transactionId?: string | null) => {
    const targetTransactionId = transactionId || "";

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (targetTransactionId) {
        next.set("process", targetTransactionId);
      } else {
        next.delete("process");
      }
      return next;
    }, { replace: true });
  };

  const openBatchProcess = (transactionId: string) => {
    syncProcessSearchParams(transactionId);
    setSelectedTransactionId(transactionId);
    setView("batch-process");
  };

  const closeBatchProcess = () => {
    syncProcessSearchParams(null);
    setSelectedTransactionId("");
  };

  const toggleBatchLogSelection = (transactionId: string, checked: boolean) => {
    setSelectedBatchLogIds((current) =>
      checked
        ? [...new Set([...current, transactionId])]
        : current.filter((id) => id !== transactionId)
    );
  };

  useEffect(() => {
    const availableIds = new Set(batchTransactions.map((transaction) => transaction.id));
    setSelectedBatchLogIds((current) => current.filter((id) => availableIds.has(id)));

    const requestedTransactionId = searchParams.get("process");
    if (requestedTransactionId) {
      if (availableIds.has(requestedTransactionId)) {
        if (view !== "batch-process") {
          setView("batch-process");
        }
        if (selectedTransactionId !== requestedTransactionId) {
          setSelectedTransactionId(requestedTransactionId);
        }
        return;
      }

      if (transactionsQuery.isLoading || transactionsQuery.isFetching || selectedTransactionId === requestedTransactionId) {
        return;
      }

      syncProcessSearchParams(null);
    }

    if (selectedTransactionId && !availableIds.has(selectedTransactionId)) {
      setSelectedTransactionId("");
    }
  }, [batchTransactions, searchParams, selectedTransactionId, transactionsQuery.isFetching, transactionsQuery.isLoading, view]);

  const batchProcessListColumns = useMemo<Array<DataTableColumn<WorkspaceTransaction>>>(() => [
    {
      key: "select",
      label: "",
      canToggle: false,
      canReorder: false,
      canResize: false,
      width: 56,
      headerRender: () => (
        <label className="data-table-header-checkbox" onClick={(event) => event.stopPropagation()}>
          <input
            aria-label="Select all filtered batch process logs"
            checked={areAllFilteredBatchLogsSelected}
            onChange={(event) =>
              setSelectedBatchLogIds((current) =>
                event.target.checked
                  ? [...new Set([...current, ...visibleBatchTransactionIds])]
                  : current.filter((id) => !visibleBatchTransactionIds.includes(id))
              )
            }
            type="checkbox"
          />
        </label>
      ),
      render: (transaction) => (
        <div onClick={(event) => event.stopPropagation()}>
          <input
            aria-label={`Select ${transaction.title}`}
            checked={selectedBatchLogIds.includes(transaction.id)}
            onChange={(event) => toggleBatchLogSelection(transaction.id, event.target.checked)}
            type="checkbox"
          />
        </div>
      )
    },
    {
      key: "title",
      label: "Process",
      canToggle: false,
      width: 300,
      minWidth: 180,
      sortValue: (transaction) => transaction.title,
      render: (transaction) => (
        <div className="data-table-multiline batch-process-name-cell">
          <strong title={transaction.title}>{truncateProcessName(transaction.title)}</strong>
          <span className="data-table-multiline-line" title={transaction.description || formatLabel(transaction.category)}>
            {truncateProcessName(transaction.description || formatLabel(transaction.category), 64)}
          </span>
        </div>
      )
    },
    {
      key: "status",
      label: "Status",
      width: 132,
      minWidth: 108,
      sortValue: (transaction) => transaction.status,
      render: (transaction) => <StatusBadge value={transaction.status} />
    },
    {
      key: "action",
      label: "Action",
      width: 180,
      minWidth: 128,
      sortValue: (transaction) => formatLabel(transaction.action),
      render: (transaction) => formatLabel(transaction.action)
    },
    {
      key: "progress",
      label: "Progress",
      width: 116,
      minWidth: 92,
      sortValue: (transaction) => resolveProgressPercent(transaction),
      render: (transaction) => `${resolveProgressPercent(transaction)}%`
    },
    {
      key: "events",
      label: "Events",
      width: 92,
      minWidth: 76,
      sortValue: (transaction) => transaction.event_count || 0,
      render: (transaction) => transaction.event_count || 0
    },
    {
      key: "latest",
      label: "Latest activity",
      width: 210,
      minWidth: 150,
      sortValue: (transaction) => transaction.latest_event_at || transaction.updated_at || "",
      render: (transaction) => formatTimestamp(transaction.latest_event_at || transaction.updated_at)
    }
  ], [areAllFilteredBatchLogsSelected, selectedBatchLogIds, visibleBatchTransactionIds]);

  useEffect(() => {
    if (!batchTransactions.length) {
      watchedBatchStatusesRef.current.clear();
      return;
    }

    const previousStatuses = watchedBatchStatusesRef.current;
    const nextStatuses = new Map<string, string>();
    const finishedStatuses = new Set(["completed", "failed"]);

    batchTransactions.forEach((transaction) => {
      const status = String(transaction.status || "");
      const previousStatus = previousStatuses.get(transaction.id);
      nextStatuses.set(transaction.id, status);

      if (
        previousStatus
        && ["queued", "running"].includes(previousStatus)
        && finishedStatuses.has(status)
      ) {
        const result = status === "completed" ? "completed" : "failed";
        setBuilderMessage(`${transaction.title || "Scheduled batch process"} ${result}.`);
      }
    });

    watchedBatchStatusesRef.current = nextStatuses;
  }, [batchTransactions]);
  const testEngineIntegration = resolveScopedIntegration(integrations, "testengine", projectId);
  const llmIntegration = resolveScopedIntegration(integrations, "llm", projectId);
  const opsIntegration = resolveScopedIntegration(integrations, "ops", projectId);
  const opsTelemetryQuery = useQuery({
    queryKey: ["ops-telemetry", projectId],
    queryFn: ({ signal }) => api.opsTelemetry.snapshot({ project_id: projectId, limit: 150 }, { signal }),
    enabled: Boolean(session && projectId && view === "ops-telemetry" && (opsIntegration || testEngineIntegration)),
    refetchInterval: 10_000
  });
  const filteredOpsEvents = useMemo(() => {
    const normalizedSearch = opsTelemetrySearch.trim().toLowerCase();
    const events = opsTelemetryQuery.data?.events.items || [];
    if (!normalizedSearch) return events;
    return events.filter((event) => [
      event.event_type,
      event.service_name,
      event.environment,
      event.status,
      event.summary,
      event.execution?.id,
      event.execution?.name,
      event.test_case?.id,
      event.test_case?.title
    ].filter(Boolean).join(" ").toLowerCase().includes(normalizedSearch));
  }, [opsTelemetryQuery.data?.events.items, opsTelemetrySearch]);
  const jaegerUrl = "/jaeger/";
  const runningCount = batchTransactions.filter((transaction) => transaction.status === "queued" || transaction.status === "running").length;
  const failedCount = batchTransactions.filter((transaction) => transaction.status === "failed").length;
  const activeCase = testCases.find((testCase) => testCase.id === selectedCaseId) || manualCases[0] || null;
  const learningCache = asArray(learningCacheQuery.data);
  const recorderLiveUrl = recorderSession?.live_view_url || "";

  useEffect(() => {
    if (!recorderSession?.status_url || recorderSession.status !== "running") {
      return undefined;
    }

    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();
    const refreshRecorderSession = async () => {
      try {
        if (document.hidden) return;
        const response = await fetch(recorderSession.status_url as string, { cache: "no-store", signal: controller.signal });

        if (!response.ok) {
          return;
        }

        const next = await response.json() as Partial<RecorderSessionResponse>;

        if (!cancelled) {
          setRecorderSession((current) => current?.id === recorderSession.id ? { ...current, ...next } : current);
        }
      } catch {
        // Live recorder counters are best-effort and should not interrupt the recorder.
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void refreshRecorderSession(), 1000);
      }
    };

    void refreshRecorderSession();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [recorderSession?.id, recorderSession?.status, recorderSession?.status_url]);

  const invalidateAutomationViews = () => {
    void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    void queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] });
    void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
    void transactionsQuery.refetch();
  };

  const clearOpsTelemetry = useMutation({
    mutationFn: () => api.opsTelemetry.clearLogs({ project_id: projectId }),
    onSuccess: () => void opsTelemetryQuery.refetch(),
    onError: (error) => setBuilderMessage(error instanceof Error ? error.message : "Unable to clear OPS telemetry logs.")
  });

  const requestClearOpsTelemetry = async () => {
    if (!(await confirmDelete({ message: "Delete all captured OPS telemetry logs for this project?" }))) return;
    clearOpsTelemetry.mutate();
  };

  const buildSingleAutomation = useMutation({
    mutationFn: () => {
      if (!canBuildAutomation || !canUseAutomationAi) {
        throw new Error("Automation build and AI feature access are required.");
      }
      if (!activeCase) {
        throw new Error("Select a manual web case first.");
      }

      return api.testCases.queueAutomationGenerator(activeCase.id, {
        start_url: startUrl || undefined,
        additional_context: builderContext || undefined
      });
    },
    onSuccess: (response) => {
      setBuilderMessage(`Automation generator queued as ${response.transaction_id}.`);
      openBatchProcess(response.transaction_id);
      invalidateAutomationViews();
    },
    onError: (error) => setBuilderMessage(error instanceof Error ? error.message : "Unable to build automation.")
  });

  const buildBatchAutomation = useMutation({
    mutationFn: () => {
      if (!canBuildAutomation || !canUseAutomationAi) {
        throw new Error("Automation build and AI feature access are required.");
      }
      if (!appTypeId) {
        throw new Error("Select an app type first.");
      }

      const manualCaseIds = new Set(manualCases.map((testCase) => testCase.id));
      const requestedCaseIds = selectedCaseIds.length
        ? selectedCaseIds.filter((testCaseId) => manualCaseIds.has(testCaseId))
        : manualCases.map((testCase) => testCase.id);
      if (!requestedCaseIds.length) {
        throw new Error("No verified manual cases are available. Open cases with an unknown execution type before queueing automation.");
      }

      return api.testCases.buildAutomationBatch({
        app_type_id: appTypeId,
        test_case_ids: requestedCaseIds,
        start_url: startUrl || undefined,
        additional_context: builderContext || undefined
      });
    },
    onSuccess: (response) => {
      setBuilderMessage(`Batch AI automation queued as ${response.transaction_id}.`);
      openBatchProcess(response.transaction_id);
      invalidateAutomationViews();
    },
    onError: (error) => setBuilderMessage(error instanceof Error ? error.message : "Unable to queue batch automation.")
  });

  const startRecorder = useMutation({
    mutationFn: (options: RecorderStartOptions) => {
      if (!canUseRecorder) {
        throw new Error("Automation recorder permission and feature access are required.");
      }
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
      setBuilderMessage(response.live_view_url ? "Recorder live view is ready in HelloTest." : "Recorder started in the Test Engine browser session.");
      invalidateAutomationViews();
    },
    onError: (error) => setBuilderMessage(error instanceof Error ? error.message : "Unable to start recorder.")
  });

  const finishRecorder = useMutation({
    mutationFn: () => {
      if (!canUseRecorder) {
        throw new Error("Automation recorder permission and feature access are required.");
      }
      if (!activeCase || !recorderSession?.id) {
        throw new Error("Start a recorder session before finishing it.");
      }

      return api.testCases.finishRecorderSession(activeCase.id, recorderSession.id, {
        transaction_id: recorderSession.transaction_id,
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
        closeBatchProcess();
      }

      setSelectedBatchLogIds((current) => current.filter((id) => id !== transactionId));

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-transaction-events"] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-transaction-artifacts"] })
      ]);
    }
  });

  const handleDownloadArtifact = async (artifact: WorkspaceTransactionArtifact) => {
    if (!selectedTransaction || !canDownloadArtifacts) {
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
    if (!selectedTransaction || !canManageTransactions || !(await confirmDelete({ message: `Delete batch process log "${selectedTransaction.title}"?` }))) {
      return;
    }

    try {
      await deleteBatchLog.mutateAsync(selectedTransaction.id);
      setBuilderMessage("Batch process log deleted.");
    } catch (error) {
      setBuilderMessage(error instanceof Error ? error.message : "Unable to delete batch process log.");
    }
  };

  const handleDeleteSelectedBatchLogs = async () => {
    if (!selectedBatchLogTransactions.length || !canManageTransactions || !(await confirmDelete({ message: `Delete ${selectedBatchLogTransactions.length} selected batch process log${selectedBatchLogTransactions.length === 1 ? "" : "s"}?` }))) {
      return;
    }

    let deleted = 0;

    for (const transaction of selectedBatchLogTransactions) {
      try {
        await deleteBatchLog.mutateAsync(transaction.id);
        deleted += 1;
      } catch (error) {
        setBuilderMessage(`${deleted} log${deleted === 1 ? "" : "s"} deleted before a failure. ${error instanceof Error ? error.message : "Unable to delete one of the logs."}`);
        return;
      }
    }

    setSelectedBatchLogIds([]);
    setBuilderMessage(`${deleted} selected batch process log${deleted === 1 ? "" : "s"} deleted.`);
  };

  const testOpsPageHeader = view === "ops-telemetry"
    ? {
        eyebrow: "Quality operations",
        title: "OPS Telemetry",
        description: "Inspect operational events, integration health, and Test Engine signals from the active workspace context."
      }
    : view === "traces"
      ? {
          eyebrow: "Quality operations",
          title: "Traces",
          description: "Follow distributed execution traces and correlated runtime evidence across HelloTest services."
        }
      : view === "automation-builder"
        ? {
            eyebrow: "Quality operations",
            title: "Automation Builder",
            description: "Turn selected manual Test Cases into reviewable automation builds with visible processing evidence."
          }
        : {
            eyebrow: "Quality operations",
            title: "Batch Process",
            description: "Monitor background automation builds, imports, exports, reports, and Test Engine jobs without leaving HelloTest."
          };

  return (
    <div className="page-content page-content--testops">
      {confirmationDialog}
      <PageHeader
        eyebrow={testOpsPageHeader.eyebrow}
        title={testOpsPageHeader.title}
        description={testOpsPageHeader.description}
        meta={[
          { label: "Batch records", value: batchTransactions.length },
          { label: "Running", value: runningCount },
          { label: "OPS telemetry", value: opsTelemetryQuery.data ? `${opsTelemetryQuery.data.events.total} events` : (opsIntegration || testEngineIntegration) ? "Ready" : "Not configured" }
        ]}
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
            {!testCasesQuery.isLoading && unknownAutomationCases.length ? (
              <div className="inline-message">
                {unknownAutomationCases.length} legacy case{unknownAutomationCases.length === 1 ? " has" : "s have"} an unknown execution type and {unknownAutomationCases.length === 1 ? "is" : "are"} excluded until opened and saved.
              </div>
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
                        <CatalogCardDescription
                          fallback="No description recorded yet."
                          profile="test-case"
                          value={testCase.description}
                        />
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
                  <span>Direct LLM</span>
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
	                  disabled={!canBuildAutomation || !canUseAutomationAi || !activeCase || buildSingleAutomation.isPending}
	                  onClick={() => buildSingleAutomation.mutate()}
	                  type="button"
                >
                  <SparkIcon />
                  <span>{buildSingleAutomation.isPending ? "Automating…" : "Automate case with AI"}</span>
                </button>
	                <button
	                  className="ghost-button"
	                  disabled={!canBuildAutomation || !canUseAutomationAi || !appTypeId || !manualCases.length || buildBatchAutomation.isPending}
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
	                      disabled={!canUseRecorder || !activeCase || !testEngineIntegration}
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
                    title="HelloTest recorder live view"
                  />
                ) : null}
                <RecorderSessionInsights session={recorderSession} />
              </div>

              <div className="execution-context-summary-head">
                <div className="execution-context-summary-copy">
                  <div className="execution-context-summary-title-row">
                    <strong>Object repository</strong>
                    <InfoTooltip
                      content="Screens, labels, field names, and locators learned from AI builds and recorder sessions are reused across later builds in this scope."
                      label="Object repository information"
                    />
                  </div>
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
        <WorkspaceMasterDetail
          className="testops-batch-workspace"
          isDetailOpen={Boolean(selectedTransaction)}
          browseView={(
            <Panel
            className="testops-panel testops-batch-browser-panel"
            title="Batch process"
            subtitle="Imports, exports, automation handoffs, generated cases, reports, and sync work appear here with their latest trace state."
            actions={
              <div className="batch-process-toolbar catalog-command-toolbar">
                <div className="catalog-toolbar-discovery" aria-label="Batch process views, search, and selection">
                  <CatalogViewToggle onChange={setBatchProcessViewMode} value={batchProcessViewMode} />
                  <CatalogSearchFilter
                    activeFilterCount={batchProcessSearch.trim() ? 1 : 0}
                    ariaLabel="Search batch process logs"
                    onChange={setBatchProcessSearch}
                    placeholder="Search batch process"
                    subtitle="Search by title, status, action, category, or metadata."
                    title="Batch process filters"
                    value={batchProcessSearch}
                  >
                    <div className="catalog-filter-actions">
                      <button
                        className="ghost-button"
                        disabled={!batchProcessSearch.trim()}
                        onClick={() => setBatchProcessSearch("")}
                        type="button"
                      >
                        Clear search
                      </button>
                    </div>
                  </CatalogSearchFilter>
                  <CatalogSelectionControls
                    allSelected={areAllFilteredBatchLogsSelected}
                    canSelectAll={Boolean(filteredBatchTransactions.length)}
                    onClear={() => setSelectedBatchLogIds([])}
                    onSelectAll={() => setSelectedBatchLogIds((current) => [...new Set([...current, ...visibleBatchTransactionIds])])}
                    selectedCount={selectedBatchLogIds.length}
                  />
                </div>
                {canManageTransactions ? (
                  <div className="catalog-toolbar-actions" aria-label="Batch process actions">
                    <button
                      className="ghost-button danger catalog-selection-button"
                      disabled={!selectedBatchLogIds.length || deleteBatchLog.isPending}
                      onClick={() => void handleDeleteSelectedBatchLogs()}
                      type="button"
                    >
                      <TrashIcon />
                      <span>{deleteBatchLog.isPending ? "Deleting..." : "Delete logs"}</span>
                    </button>
                  </div>
                ) : null}
              </div>
            }
          >
            {transactionsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
            {!transactionsQuery.isLoading && batchTransactions.length ? (
              batchProcessViewMode === "list" ? (
                <DataTable
                  columns={batchProcessListColumns}
                  emptyMessage="No batch process logs match the current search."
                  enableColumnResize
                  enableHeaderColumnReorder
                  enableRowSelection={false}
                  getRowClassName={(transaction) => (selectedTransactionId === transaction.id ? "is-active-row" : "")}
                  getRowKey={(transaction) => transaction.id}
                  onRowClick={(transaction) => openBatchProcess(transaction.id)}
                  rows={filteredBatchTransactions}
                  storageKey="hellotest:testops:batch-process:list-columns"
                />
              ) : filteredBatchTransactions.length ? (
                <div className="testops-operation-grid batch-process-browser-grid">
                  {filteredBatchTransactions.map((transaction) => {
                    const isActive = selectedTransactionId === transaction.id;
                    const isChecked = selectedBatchLogIds.includes(transaction.id);
                    const tileProgress = transactionTileProgress(transaction, resolveProgressPercent(transaction));

                    return (
                      <article
                        aria-selected={isActive}
                        className={isActive ? "record-card tile-card batch-process-card is-active" : "record-card tile-card batch-process-card"}
                        key={transaction.id}
                        onClick={() => openBatchProcess(transaction.id)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) {
                            return;
                          }

                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openBatchProcess(transaction.id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="tile-card-main">
                          <div className="tile-card-select-row batch-process-card-select-row">
                            <label className="checkbox-field" onClick={(event) => event.stopPropagation()}>
                              <input
                                aria-label={`Select ${transaction.title}`}
                                checked={isChecked}
                                onChange={(event) => toggleBatchLogSelection(transaction.id, event.target.checked)}
                                type="checkbox"
                              />
                              <code>{transaction.id.slice(0, 8)}</code>
                            </label>
                            <StatusBadge value={transaction.status} />
                          </div>
                          <div className="tile-card-header batch-process-card-header">
                            <span className={`record-card-icon tile-card-icon batch-process-card-icon status-${transaction.status}`}>
                              <ActivityIcon size={18} />
                            </span>
                            <div className="tile-card-title-group">
                              <strong>{transaction.title}</strong>
                              <span className="tile-card-kicker">{formatLabel(transaction.action)}</span>
                            </div>
                          </div>
                          <p className="tile-card-description">{transaction.description || formatLabel(transaction.category)}</p>
                          <TileCardProgress
                            breakdown={tileProgress.breakdown}
                            value={tileProgress.value}
                            label={formatLabel(String(transaction.metadata?.current_phase || transaction.status))}
                            title={formatProgressDetail(transaction) || "Reported process progress; item counts are unavailable"}
                            tone={transaction.status === "failed" ? "danger" : transaction.status === "completed" ? "success" : "info"}
                          />
                          <div className="batch-process-card-facts">
                            <span>
                              <small>Category</small>
                              <strong>{formatLabel(transaction.category)}</strong>
                            </span>
                            <span>
                              <small>Events</small>
                              <strong>{transaction.event_count || 0}</strong>
                            </span>
                            <span>
                              <small>Duration</small>
                              <strong>{formatDuration(transaction.started_at || transaction.created_at, transaction.completed_at || transaction.updated_at)}</strong>
                            </span>
                            <span>
                              <small>Latest</small>
                              <strong>{formatTimestamp(transaction.latest_event_at || transaction.updated_at)}</strong>
                            </span>
                          </div>
                          <div className="batch-process-card-footer">
                            <span className="count-pill">{tileProgress.value}% complete</span>
                            <button
                              className="ghost-button compact-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openBatchProcess(transaction.id);
                              }}
                              type="button"
                            >
                              <OpenIcon />
                              <span>Open</span>
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state compact">No batch process logs match the current search.</div>
              )
            ) : null}
            {!transactionsQuery.isLoading && !batchTransactions.length ? (
              <div className="empty-state compact">No batch process records have been recorded for this scope yet.</div>
            ) : null}
            </Panel>
          )}

          detailView={selectedTransaction ? (
            <Panel
              className="testops-panel testops-detail-panel batch-process-detail-panel"
              title={selectedTransaction.title}
              subtitle="The latest metadata and event timeline for this operation."
              actions={
                <div className="testops-action-row batch-process-detail-actions">
                  <WorkspaceBackButton label="Back to batch process logs" onClick={closeBatchProcess} />
	                  {canManageTransactions ? (
	                    <button
	                      className="ghost-button danger"
	                      disabled={deleteBatchLog.isPending}
                      onClick={() => void handleDeleteSelectedBatchLog()}
                      type="button"
                    >
                      <TrashIcon size={16} />
                      <span>{deleteBatchLog.isPending ? "Deleting..." : "Delete log"}</span>
                    </button>
                  ) : null}
                </div>
              }
            >
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
	                        <button className="ghost-button" disabled={!canDownloadArtifacts} onClick={() => void handleDownloadArtifact(artifact)} type="button">
	                          <OpenIcon size={16} />
	                          <span>Download</span>
	                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="execution-context-summary-head">
                  <div className="execution-context-summary-copy">
                    <div className="execution-context-summary-title-row">
                      <strong>Trace log</strong>
                      <InfoTooltip
                        content="Recorded operation stages in chronological order."
                        label="Trace log information"
                      />
                    </div>
                  </div>
                  <span className="count-pill">{(transactionEventsQuery.data || []).length} events</span>
                </div>

                {transactionEventsQuery.isLoading ? <LoadingState label="Loading process events" /> : null}
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
            </Panel>
          ) : (
            <Panel
              className="testops-panel testops-detail-panel batch-process-detail-panel"
              title="Process trace"
              subtitle="Choose a batch process log to inspect its trace."
              actions={<WorkspaceBackButton label="Back to batch process logs" onClick={closeBatchProcess} />}
            >
              <div className="empty-state compact">Choose a process log to review its metadata and trace log.</div>
            </Panel>
          )}
        />
      ) : view === "ops-telemetry" ? (
        <Panel
          className="testops-panel testops-telemetry-panel"
          title="OPS telemetry"
          subtitle={opsIntegration ? `Secure server-side connection through ${opsIntegration.name}` : "Using the active Test Engine telemetry endpoint through the HelloTest API."}
          actions={
            opsIntegration || testEngineIntegration ? (
              <div className="testops-telemetry-actions">
                <button className="ghost-button" disabled={opsTelemetryQuery.isFetching} onClick={() => void opsTelemetryQuery.refetch()} type="button">
                  <ActivityIcon />
                  <span>{opsTelemetryQuery.isFetching ? "Refreshing…" : "Refresh"}</span>
                </button>
                <button className="ghost-button danger" disabled={clearOpsTelemetry.isPending} onClick={() => void requestClearOpsTelemetry()} type="button">
                  <TrashIcon />
                  <span>{clearOpsTelemetry.isPending ? "Deleting…" : "Clear logs"}</span>
                </button>
              </div>
            ) : undefined
          }
        >
          {opsTelemetryQuery.isLoading ? (
            <LoadingState label="Loading redacted OPS telemetry…" />
          ) : opsTelemetryQuery.error ? (
            <div className="empty-state compact">
              {opsTelemetryQuery.error instanceof Error ? opsTelemetryQuery.error.message : "Unable to load OPS telemetry."}
            </div>
          ) : opsTelemetryQuery.data ? (
            <div className="testops-telemetry-workspace">
              <div className="testops-telemetry-metrics" aria-label="OPS telemetry summary">
                <article><span>Captured Events</span><strong>{opsTelemetryQuery.data.events.total}</strong></article>
                <article><span>Visible Events</span><strong>{filteredOpsEvents.length}</strong></article>
                <article><span>Services</span><strong>{opsTelemetryQuery.data.services.items.length}</strong></article>
                <article><span>Last Sync</span><strong>{new Date(opsTelemetryQuery.data.checked_at).toLocaleTimeString()}</strong></article>
              </div>
              <label className="testops-telemetry-search">
                <span>Search telemetry</span>
                <input
                  onChange={(event) => setOpsTelemetrySearch(event.target.value)}
                  placeholder="Event, service, execution, case, or status"
                  type="search"
                  value={opsTelemetrySearch}
                />
              </label>
              {filteredOpsEvents.length ? (
                <div className="testops-telemetry-events">
                  {filteredOpsEvents.map((event, index) => (
                    <article className="testops-telemetry-event" key={event.id || `${event.event_type || "event"}-${event.received_at || index}`}>
                      <header>
                        <div>
                          <strong>{event.event_type || "Unknown event"}</strong>
                          <span>{describeOpsEventScope(event)}</span>
                        </div>
                        <StatusBadge value={event.status || "received"} />
                      </header>
                      <p>{event.summary || "No event summary was provided."}</p>
                      <footer>
                        <span>{event.service_name || "Unlabeled service"}</span>
                        <span>{event.environment || "Environment unavailable"}</span>
                        <span>{formatTimestamp(event.received_at)}</span>
                      </footer>
                      {event.payload && Object.keys(event.payload).length ? (
                        <details>
                          <summary>Redacted payload</summary>
                          <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                        </details>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state compact">No captured telemetry matches this project and search.</div>
              )}
            </div>
          ) : (
            <div className="empty-state compact">
              Activate an OPS or Test Engine integration for this project to load telemetry securely.
            </div>
          )}
        </Panel>
      ) : (
        <Panel
          className="testops-panel testops-telemetry-panel"
          title="Distributed Traces"
          subtitle="View full OpenTelemetry traces from HelloTest and TestEngine in Jaeger."
          actions={
            <a className="ghost-button" href={jaegerUrl} rel="noreferrer" target="_blank">
              <OpenIcon />
              <span>Open Jaeger in new tab</span>
            </a>
          }
        >
          <iframe
            className="testops-telemetry-frame"
            src={jaegerUrl}
            title="Jaeger Traces"
          />
        </Panel>
      )}
    </div>
  );
}
