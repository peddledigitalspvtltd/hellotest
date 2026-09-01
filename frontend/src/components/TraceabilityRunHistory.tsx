import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ActivityIcon, OpenIcon, SearchIcon } from "./AppIcons";
import { CatalogActionMenu } from "./CatalogActionMenu";
import { DataTable, type DataTableColumn } from "./DataTable";
import { DisplayIdBadge } from "./DisplayIdBadge";
import { LoadingState } from "./LoadingState";
import { StatusBadge } from "./StatusBadge";
import { api } from "../lib/api";
import { asArray } from "../lib/collectionGuards";
import type { TraceabilityRunHistoryItem } from "../types";

const formatTimestamp = (value?: string | null) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const formatDuration = (startedAt?: string | null, endedAt?: string | null) => {
  if (!startedAt || !endedAt) return "—";
  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) return "—";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const durationMsFor = (item: TraceabilityRunHistoryItem) => {
  if (!item.started_at || !item.ended_at) return null;
  const durationMs = new Date(item.ended_at).getTime() - new Date(item.started_at).getTime();
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null;
};

const formatDurationMs = (value: number | null) => {
  if (value === null) return "—";
  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

export function TraceabilityRunHistory({
  appTypeId,
  projectId,
  requirementId,
  testCaseId
}: {
  appTypeId?: string;
  projectId: string;
  requirementId?: string;
  testCaseId?: string;
}) {
  const navigate = useNavigate();
  const historyQuery = useQuery({
    queryKey: ["traceability-run-history", projectId, appTypeId || "all", requirementId || "", testCaseId || ""],
    queryFn: () => api.executions.history({
      project_id: projectId,
      app_type_id: appTypeId || undefined,
      requirement_id: requirementId || undefined,
      test_case_id: testCaseId || undefined,
      page_size: 25
    }),
    enabled: Boolean(projectId && (requirementId || testCaseId)),
    staleTime: 30_000
  });
  const rows = asArray(historyQuery.data);
  const [searchTerm, setSearchTerm] = useState("");
  const [resultFilter, setResultFilter] = useState("all");
  const filteredRows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return rows.filter((row) => {
      if (resultFilter !== "all" && row.result_status !== resultFilter) return false;
      if (!normalizedSearch) return true;
      return [
        row.execution_id,
        row.execution_display_id || "",
        row.execution_name,
        row.execution_status || "",
        row.test_case_id,
        row.test_case_title,
        row.result_status,
        row.release || "",
        ...row.defects
      ].join(" ").toLowerCase().includes(normalizedSearch);
    });
  }, [resultFilter, rows, searchTerm]);
  const resultOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.result_status).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [rows]
  );
  const runHealth = useMemo(() => {
    const comparableStatuses = ["passed", "failed", "blocked", "error"];
    const finalized = rows.filter((row) => comparableStatuses.includes(String(row.result_status || "").toLowerCase()));
    const recent = rows.slice(0, 16).reverse();
    const latestFirst = [...recent].reverse();
    const latestStatus = String(latestFirst[0]?.result_status || "").toLowerCase();
    const streak = latestFirst.findIndex((row) => String(row.result_status || "").toLowerCase() !== latestStatus);
    const rateFor = (items: TraceabilityRunHistoryItem[]) => {
      const comparable = items.filter((row) => comparableStatuses.includes(String(row.result_status || "").toLowerCase()));
      return comparable.length ? Math.round((comparable.filter((row) => String(row.result_status || "").toLowerCase() === "passed").length / comparable.length) * 100) : null;
    };
    const currentWindow = finalized.slice(0, 5);
    const previousWindow = finalized.slice(5, 10);
    const recentRate = rateFor(currentWindow);
    const previousRate = rateFor(previousWindow);
    const rateDelta = recentRate === null || previousRate === null ? null : recentRate - previousRate;
    const direction = rateDelta === null || Math.abs(rateDelta) < 5
      ? "stable"
      : rateDelta > 0 ? "improving" : "declining";
    const durations = currentWindow.map(durationMsFor).filter((value): value is number => value !== null).sort((left, right) => left - right);
    const medianDurationMs = durations.length
      ? durations.length % 2
        ? durations[Math.floor(durations.length / 2)]
        : (durations[(durations.length / 2) - 1] + durations[durations.length / 2]) / 2
      : null;
    const defectCount = new Set(currentWindow.flatMap((row) => row.defects)).size;
    const health = recentRate === null
      ? { label: "No signal", tone: "neutral" }
      : latestStatus === "passed" && recentRate >= 80
        ? { label: "Healthy", tone: "success" }
        : recentRate >= 60
          ? { label: "Watch", tone: "warning" }
          : { label: "At risk", tone: "danger" };
    return {
      finalized: finalized.length,
      recent,
      recentRate,
      previousRate,
      rateDelta,
      latestStatus,
      streak: streak === -1 ? latestFirst.length : streak,
      direction,
      medianDurationMs,
      defectCount,
      health
    };
  }, [rows]);

  const openRun = (item: TraceabilityRunHistoryItem) => {
    const view = item.trigger === "local" ? "local-runs" : item.suite_ids.length ? "suite-runs" : "test-case-runs";
    const params = new URLSearchParams({ view, execution: item.execution_id, testCase: item.test_case_id });
    navigate(`/executions?${params.toString()}`);
  };

  const columns: Array<DataTableColumn<TraceabilityRunHistoryItem>> = [
    {
      key: "run",
      label: "Run",
      canToggle: false,
      sortValue: (item) => item.execution_name,
      render: (item) => (
        <div className="traceability-run-name">
          <DisplayIdBadge value={item.execution_display_id || item.execution_id} />
          <strong>{item.execution_name}</strong>
        </div>
      )
    },
    {
      key: "testCase",
      label: "Test case",
      sortValue: (item) => item.test_case_title,
      render: (item) => item.test_case_title
    },
    {
      key: "result",
      label: "Result",
      sortValue: (item) => item.result_status,
      render: (item) => <StatusBadge value={item.result_status} />
    },
    {
      key: "runStatus",
      label: "Run status",
      defaultVisible: false,
      render: (item) => <StatusBadge value={item.execution_status || "queued"} />
    },
    {
      key: "defects",
      label: "Bugs",
      sortValue: (item) => item.defects.length,
      render: (item) => item.defects.length
    },
    {
      key: "started",
      label: "Started",
      sortValue: (item) => item.started_at || item.result_created_at || "",
      render: (item) => formatTimestamp(item.started_at || item.result_created_at)
    },
    {
      key: "duration",
      label: "Duration",
      render: (item) => formatDuration(item.started_at, item.ended_at)
    },
    {
      key: "release",
      label: "Release",
      defaultVisible: false,
      render: (item) => item.release || "—"
    }
  ];

  if (historyQuery.isLoading) {
    return <LoadingState label="Loading run history" />;
  }

  if (historyQuery.isError) {
    return <div className="empty-state compact">Run history could not be loaded.</div>;
  }

  return (
    <div className="traceability-run-history">
      <section className={`story-run-health-trend execution-health-overview is-${runHealth.direction} health-${runHealth.health.tone}`} aria-label={`${testCaseId ? "Test case" : "Story"} execution health trend`}>
        <header className="execution-health-header">
          <div>
            <span>Execution health</span>
            <strong>{runHealth.health.label}</strong>
            <p>{runHealth.finalized
              ? `${runHealth.recentRate ?? "—"}% pass rate across the latest ${Math.min(runHealth.finalized, 5)} finalized outcomes${runHealth.defectCount ? ` · ${runHealth.defectCount} linked ${runHealth.defectCount === 1 ? "Bug" : "Bugs"}` : ""}.`
              : "Finalized outcomes will establish the first health signal."}</p>
          </div>
          <span className="story-run-trend-direction">{runHealth.direction}</span>
        </header>
        <div className="story-run-health-summary execution-health-metrics">
          <div><span>Recent pass rate</span><strong>{runHealth.recentRate === null ? "—" : `${runHealth.recentRate}%`}</strong><small>Latest {Math.min(runHealth.finalized, 5)} finalized</small></div>
          <div><span>Movement</span><strong>{runHealth.rateDelta === null ? "—" : `${runHealth.rateDelta > 0 ? "+" : ""}${runHealth.rateDelta} pp`}</strong><small>Versus previous window</small></div>
          <div><span>Current streak</span><strong>{runHealth.streak || "—"}</strong><small>{runHealth.latestStatus ? `${runHealth.latestStatus} outcomes` : "No outcome yet"}</small></div>
          <div><span>Median duration</span><strong>{formatDurationMs(runHealth.medianDurationMs)}</strong><small>Latest finalized window</small></div>
        </div>
        {(runHealth.recentRate !== null || runHealth.previousRate !== null) ? (
          <div className="execution-health-comparison" aria-label="Recent pass rate compared with the previous five finalized outcomes">
            <div><span>Previous 5</span><div><i style={{ width: `${runHealth.previousRate || 0}%` }} /></div><strong>{runHealth.previousRate === null ? "—" : `${runHealth.previousRate}%`}</strong></div>
            <div className="is-current"><span>Recent 5</span><div><i style={{ width: `${runHealth.recentRate || 0}%` }} /></div><strong>{runHealth.recentRate === null ? "—" : `${runHealth.recentRate}%`}</strong></div>
          </div>
        ) : null}
        {runHealth.recent.length ? (
          <div className="execution-health-timeline-block">
            <div className="execution-health-timeline-heading"><strong>Outcome timeline</strong><span>Oldest to newest · select a state to inspect the run</span></div>
            <ol className="story-run-trend-plot execution-health-timeline" aria-label={`Last ${runHealth.recent.length} run outcomes, oldest to newest`}>
            {runHealth.recent.map((row, index) => {
              const status = String(row.result_status || "unknown").toLowerCase();
              return (
                <li className={`is-${status}`} key={`${row.id}:${index}`}>
                  <button aria-label={`${formatTimestamp(row.started_at || row.result_created_at)}: ${row.result_status}. Open ${row.execution_name}`} onClick={() => openRun(row)} title={`${row.execution_name} · ${row.result_status} · ${formatTimestamp(row.started_at || row.result_created_at)}`} type="button">
                    <span aria-hidden="true" />
                  </button>
                </li>
              );
            })}
            </ol>
            <div className="execution-health-legend" aria-label="Outcome legend"><span className="is-passed">Passed</span><span className="is-failed">Failed / error</span><span className="is-blocked">Blocked</span><span className="is-skipped">Skipped</span></div>
          </div>
        ) : <div className="story-run-trend-empty">Run outcomes will form a health trend here after the first linked execution.</div>}
      </section>
      <div className="traceability-section-toolbar">
        <ActivityIcon />
        <strong>{filteredRows.length} of {rows.length} run outcome{rows.length === 1 ? "" : "s"}</strong>
      </div>
      <div className="traceability-search-row traceability-run-filter-row">
        <label className="traceability-search-input">
          <SearchIcon />
          <input
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search runs, test cases, bugs, release"
            value={searchTerm}
          />
        </label>
        <label className="requirement-link-filter-field">
          <span>Result</span>
          <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value)}>
            <option value="all">All results</option>
            {resultOptions.map((result) => (
              <option key={result} value={result}>{result}</option>
            ))}
          </select>
        </label>
        <button
          className="ghost-button"
          disabled={!searchTerm.trim() && resultFilter === "all"}
          onClick={() => {
            setSearchTerm("");
            setResultFilter("all");
          }}
          type="button"
        >
          <span>Clear filters</span>
        </button>
      </div>
      <DataTable
        columns={columns}
        emptyMessage="No historical run outcome is linked to this item."
        getRowKey={(item) => item.id}
        hideToolbarCopy
        onRowClick={openRun}
        renderRowActions={(item) => (
          <CatalogActionMenu
            actions={[
              {
                label: "Open run",
                description: "Open this historical outcome in Test Runs.",
                icon: <OpenIcon />,
                onClick: () => openRun(item)
              }
            ]}
            label={`${item.execution_name} actions`}
          />
        )}
        rows={filteredRows}
        storageKey={`hellotest:traceability-runs:${requirementId ? "requirement" : "test-case"}`}
      />
    </div>
  );
}
