import { LoadingState } from "./LoadingState";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  IconArrowDown,
  IconArrowRight,
  IconArrowUp,
  IconChartBar,
  IconDownload,
  IconInfoCircle,
  IconRefresh,
  IconSettings2,
  IconShieldCheck,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { useAuth } from "../auth/AuthContext";
import { useLocalization } from "../context/LocalizationContext";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { api } from "../lib/api";
import { areFeatureFlagsEnabled } from "../lib/featureFlags";
import { canAccessPath, hasPermission } from "../lib/permissions";
import {
  analyticsCsv,
  analyticsWindow,
  groupAnalyticsTrend,
  normalizeAnalyticsLayout,
  qualityRatio,
  type AnalyticsLayout,
  type AnalyticsSection,
} from "../lib/qualityAnalytics";
import { AiInsightPreviewDialog } from "./AiInsightPreviewDialog";
import { StatusBadge } from "./StatusBadge";
import "./QualityAnalyticsDashboard.css";

function AnalyticsDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useDialogFocus<HTMLDivElement>({ onClose });
  const { t } = useLocalization();
  return (
    <div className="modal-backdrop qa-dialog-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="qa-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qa-dialog-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="qa-dialog-title">{title}</h2>
          <button
            className="qa-icon-button"
            onClick={onClose}
            aria-label={t("analytics.close")}
          >
            <IconX size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function QualityAnalyticsDashboard() {
  const { session } = useAuth();
  const { t, formatNumber, formatDate } = useLocalization();
  const tr = (key: string, values?: Record<string, string | number>) =>
    t(`analytics.${key}`, undefined, values);
  const [projectId] = useCurrentProject();
  const [params, setParams] = useSearchParams();
  const days = analyticsWindow(params.get("days"));
  const flags = useFeatureFlags(Boolean(session));
  const authorizationKey = JSON.stringify([
    session?.user.id,
    session?.user.role,
    session?.user.status,
    session?.user.permissions,
    session?.user.workspace_permissions,
    session?.user.project_permissions,
    flags.data?.flags,
  ]);
  const allowed = Boolean(
    projectId && hasPermission(session, "dashboard.view", projectId),
  );
  const query = useQuery({
    queryKey: ["quality-overview", projectId, days, authorizationKey],
    queryFn: ({ signal }) =>
      api.analytics.overview(
        { project_id: String(projectId), days },
        { signal },
      ),
    enabled:
      allowed &&
      Boolean(flags.data) &&
      areFeatureFlagsEnabled(flags.data, ["hellotest.analytics.dashboards"]),
    staleTime: 30_000,
    retry: 1,
  });
  const data = query.data;
  const [dialog, setDialog] = useState<"method" | "layout" | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [allAttention, setAllAttention] = useState(false);
  const layoutKey = `hellotest.analytics.layout.v2:${session?.user.id || "guest"}:${projectId}`;
  const [layout, setLayout] = useState<AnalyticsLayout>(() =>
    normalizeAnalyticsLayout(null),
  );
  useEffect(() => {
    try {
      setLayout(
        normalizeAnalyticsLayout(
          JSON.parse(localStorage.getItem(layoutKey) || "null"),
        ),
      );
    } catch {
      setLayout(normalizeAnalyticsLayout(null));
    }
  }, [layoutKey]);
  const saveLayout = (next: AnalyticsLayout) => {
    const value = normalizeAnalyticsLayout(next);
    setLayout(value);
    try {
      localStorage.setItem(layoutKey, JSON.stringify(value));
    } catch {
      /* This view still works when storage is disabled. */
    }
  };
  const [reviewOpen, setReviewOpen] = useState(false);
  const review = useMutation({
    mutationFn: (scope: string) =>
      api.ai.qualityInsights({ project_id: scope }),
  });
  useEffect(() => {
    setDialog(null);
    setReviewOpen(false);
    review.reset();
  }, [projectId, authorizationKey]);
  const canReview =
    allowed &&
    [
      "quality_insight.view",
      "requirement.view",
      "testcase.view",
      "suite.view",
      "run.view",
      "result.view",
      "feedback.view",
    ].every((permission) => hasPermission(session, permission, projectId)) &&
    areFeatureFlagsEnabled(flags.data, [
      "hellotest.ai.quality_insights",
      "hellotest.manual.requirements",
      "hellotest.manual.test_cases",
      "hellotest.manual.suites",
      "hellotest.manual.runs",
      "hellotest.manual.bugs",
    ]);
  const canReadiness =
    allowed &&
    areFeatureFlagsEnabled(flags.data, ["hellotest.analytics.dashboards"]);
  const chart = useMemo(
    () => groupAnalyticsTrend(data?.trend || [], days),
    [data?.trend, days],
  );
  const count = (value: number | null | undefined) =>
    value == null ? "—" : formatNumber(value);
  const percent = (numerator: number | null, denominator: number | null) => {
    const ratio = qualityRatio(numerator, denominator);
    return ratio == null
      ? "—"
      : formatNumber(ratio, { style: "percent", maximumFractionDigits: 0 });
  };
  const canOpen = (to: string) =>
    canAccessPath(session, to, undefined, projectId);
  const destination = (to: string, label: string) =>
    canOpen(to) ? (
      <Link className="qa-text-link" to={to}>
        {label}
        <IconArrowRight size={15} />
      </Link>
    ) : null;
  const metric = (
    key: string,
    value: string,
    detail: string,
    tone = "neutral",
  ) => (
    <button
      className={`qa-metric qa-tone-${tone}`}
      onClick={() => setDialog("method")}
      aria-label={`${tr(key)}: ${value}. ${detail}. ${tr("metricHelp", { metric: tr(key) })}`}
    >
      <span className="qa-metric-label">
        {tr(key)}
        <IconInfoCircle size={15} />
      </span>
      <strong>{value}</strong>
      <span>{detail}</span>
    </button>
  );
  const loading = (
    <LoadingState label={tr("loading")} />
  );
  const error = (
    <div className="qa-empty" role="alert">
      <h2>{tr("loadError")}</h2>
      <p>
        {query.error instanceof Error
          ? query.error.message
          : tr("notAvailable")}
      </p>
      <button className="button" onClick={() => void query.refetch()}>
        {tr("retry")}
      </button>
    </div>
  );
  if (!projectId)
    return (
      <main className="quality-analytics">
        <div className="qa-empty">
          <IconChartBar size={32} />
          <h1>{tr("selectProject")}</h1>
          <p>{tr("selectHelp")}</p>
        </div>
      </main>
    );
  if (!allowed)
    return (
      <main className="quality-analytics">
        <div className="qa-empty">
          <h1>{t("access.deniedTitle")}</h1>
          <p>{t("access.deniedHelp")}</p>
        </div>
      </main>
    );
  if (
    flags.data &&
    !areFeatureFlagsEnabled(flags.data, ["hellotest.analytics.dashboards"])
  )
    return (
      <main className="quality-analytics">
        <div className="qa-empty">
          <h1>{t("access.disabledTitle")}</h1>
          <p>{t("access.disabledHelp")}</p>
        </div>
      </main>
    );
  const inv = data?.inventory;
  const ex = data?.execution;
  const attentionContent = () => {
    const definitions: Record<string, [string, number | null, string]> = {
      "failed-results": ["failed", ex?.failed ?? null, "openRuns"],
      "blocked-results": ["blocked", ex?.blocked ?? null, "openRuns"],
      "open-defects": ["defect", inv?.open_defects ?? null, "openBugs"],
      "coverage-gaps": [
        "coverage",
        inv?.covered_stories == null
          ? null
          : inv.stories! - inv.covered_stories,
        "openStories",
      ],
      "design-gaps": [
        "design",
        inv?.designed_cases == null ? null : inv.cases! - inv.designed_cases,
        "openCases",
      ],
      "pending-results": ["pending", ex?.pending ?? null, "openRuns"],
    };
    return (
      <section className="qa-panel qa-attention">
        <div className="qa-panel-head">
          <div>
            <span className="qa-eyebrow">{tr("attention")}</span>
            <h2>{tr("attentionHelp")}</h2>
          </div>
          <span className="qa-count">{count(data?.attention.length)}</span>
        </div>
        {data?.attention.length ? (
          <ul className="qa-actions">
            {data.attention.slice(0, allAttention ? 8 : 3).map((action) => {
              const def = definitions[action.id];
              return (
                <li key={action.id} className={`qa-tone-${action.tone}`}>
                  <span className="qa-action-dot" />
                  <div>
                    <h3>
                      {def
                        ? tr(`${def[0]}Title${def[1] === 1 ? "One" : ""}`, {
                            count: count(def[1]),
                          })
                        : action.title}
                    </h3>
                    <p>{def ? tr(`${def[0]}Help`) : action.detail}</p>
                    {destination(action.to, def ? tr(def[2]) : action.title)}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="qa-empty qa-empty-small">
            <IconShieldCheck size={25} />
            <h3>{tr("noActions")}</h3>
            <p>{tr("noActionsHelp")}</p>
          </div>
        )}
        {data && data.attention.length > 3 && (
          <button
            className="qa-attention-more qa-text-link"
            aria-expanded={allAttention}
            onClick={() => setAllAttention(!allAttention)}
          >
            {tr(allAttention ? "fewerActions" : "allActions", {
              count: data.attention.length,
            })}
          </button>
        )}
      </section>
    );
  };
  const activityContent = () => {
    const peak = Math.max(
      1,
      ...chart.map((point) => point.passed + point.failed + point.blocked),
    );
    const label = (point: (typeof chart)[number]) =>
      `${formatDate(`${point.date}T12:00:00Z`, { timeZone: "UTC", month: "short", day: "numeric" })}${point.date !== point.end ? ` – ${formatDate(`${point.end}T12:00:00Z`, { timeZone: "UTC", month: "short", day: "numeric" })}` : ""}`;
    return (
      <section className="qa-panel qa-activity">
        <div className="qa-panel-head">
          <div>
            <h2>{tr("activity")}</h2>
            <p>{tr("activityHelp")}</p>
          </div>
          <button
            className="qa-icon-button"
            aria-label={tr("method")}
            onClick={() => setDialog("method")}
          >
            <IconInfoCircle size={19} />
          </button>
        </div>
        {data?.visibility.runs ? (
          <>
            <div className="qa-activity-summary">
              <div>
                <strong>{count(ex?.completed_runs)}</strong>
                <span>{tr("completed")}</span>
              </div>
              <div>
                <strong>{count(ex?.active_runs)}</strong>
                <span>{tr("active")}</span>
              </div>
              <div>
                <strong>{count(ex?.total)}</strong>
                <span>{tr("total")}</span>
              </div>
            </div>
            {data.recent_runs.length ? (
              <>
                <div className="qa-legend">
                  {(["passed", "failed", "blocked"] as const).map((key) => (
                    <span key={key}>
                      <i className={`qa-result-${key}`} />
                      {tr(key)} <b>{count(ex?.[key])}</b>
                    </span>
                  ))}
                </div>
                <div
                  className="qa-chart"
                  role="img"
                  aria-label={tr("chartLabel")}
                >
                  <div className="qa-chart-y">
                    <span>{count(peak)}</span>
                    <span>{count(Math.round(peak / 2))}</span>
                    <span>0</span>
                  </div>
                  <div className="qa-bars">
                    {chart.map((point, index) => (
                      <div
                        className="qa-bar-column"
                        key={point.date}
                        title={`${label(point)}: ${tr("passed")} ${point.passed}, ${tr("failed")} ${point.failed}, ${tr("blocked")} ${point.blocked}`}
                      >
                        <div className="qa-bar-stack">
                          {(["passed", "failed", "blocked"] as const).map(
                            (key) => (
                              <i
                                key={key}
                                className={`qa-result-${key}`}
                                style={{
                                  height: `${(point[key] / peak) * 100}%`,
                                }}
                              />
                            ),
                          )}
                        </div>
                        <span>
                          {index === 0 ||
                          index === chart.length - 1 ||
                          index % Math.ceil(chart.length / 5) === 0
                            ? label(point)
                            : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="qa-empty qa-empty-small">
                <h3>{tr("noRuns")}</h3>
                <p>{tr("noRunsHelp")}</p>
                {destination("/executions", tr("openRuns"))}
              </div>
            )}
            <div className="qa-outcome-foot">
              <span>
                {tr("pending")}: <b>{count(ex?.pending)}</b>
              </span>
              <span>
                {tr("other")}: <b>{count(ex?.other)}</b>
              </span>
              <button
                className="qa-text-link"
                aria-expanded={showTable}
                aria-controls="qa-trend-table"
                onClick={() => setShowTable(!showTable)}
              >
                {tr(showTable ? "hideTable" : "showTable")}
              </button>
            </div>
            {showTable && (
              <div
                className="qa-table-scroll"
                id="qa-trend-table"
                tabIndex={0}
                role="region"
                aria-label={tr("activity")}
              >
                <table>
                  <caption>{tr("activityHelp")} UTC</caption>
                  <thead>
                    <tr>
                      {["date", "runs", "passed", "failed", "blocked"].map(
                        (key) => (
                          <th key={key} scope="col">
                            {tr(key)}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {chart.map((point) => (
                      <tr key={point.date}>
                        <th scope="row">{label(point)}</th>
                        <td>{count(point.runs)}</td>
                        <td>{count(point.passed)}</td>
                        <td>{count(point.failed)}</td>
                        <td>{count(point.blocked)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="qa-empty qa-empty-small">
            <p>{tr("notAvailable")}</p>
          </div>
        )}
      </section>
    );
  };
  const runsContent = () => (
    <section className="qa-panel qa-runs">
      <div className="qa-panel-head">
        <div>
          <h2>{tr("runs")}</h2>
          <p>{tr("runsHelp")}</p>
        </div>
        {data?.visibility.runs && destination("/executions", tr("openRuns"))}
      </div>
      {data?.recent_runs.length ? (
        <div
          className="qa-table-scroll"
          role="region"
          tabIndex={0}
          aria-label={tr("runs")}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{tr("runName")}</th>
                <th scope="col">{tr("status")}</th>
                <th scope="col">{tr("outcomes")}</th>
                <th scope="col">{tr("pending")}</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_runs.map((run) => (
                <tr key={run.id}>
                  <th scope="row">
                    <Link
                      to={`/executions?execution=${encodeURIComponent(run.id)}`}
                    >
                      {run.name}
                    </Link>
                    <small>{formatDate(run.ended_at || run.started_at)}</small>
                  </th>
                  <td>
                    <StatusBadge value={run.status} />
                  </td>
                  <td>
                    <div className="qa-run-outcomes">
                      <span className="qa-result-text-passed">
                        {count(run.passed)} {tr("passed")}
                      </span>
                      <span
                        className={run.failed ? "qa-result-text-failed" : ""}
                      >
                        {count(run.failed)} {tr("failed")}
                      </span>
                      <span>
                        {count(run.blocked)} {tr("blocked")}
                      </span>
                    </div>
                  </td>
                  <td>
                    {count(run.pending)}
                    <small>/ {count(run.total)}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="qa-empty qa-empty-small">
          <p>{tr(data?.visibility.runs ? "noRuns" : "notAvailable")}</p>
        </div>
      )}
    </section>
  );
  const inventoryContent = () => (
    <section className="qa-panel qa-inventory">
      <div className="qa-panel-head">
        <div>
          <h2>{tr("inventory")}</h2>
          <p>{tr("inventoryHelp")}</p>
        </div>
      </div>
      <div className="qa-inventory-grid">
        {inv &&
          (
            [
              ["stories", inv.covered_stories, inv.stories],
              ["cases", inv.designed_cases, inv.cases],
              ["suites", inv.suites, null],
              ...(data?.visibility.automation
                ? [["automation", inv.automated_cases, inv.cases]]
                : []),
            ] as Array<[string, number | null, number | null]>
          ).map(([key, value, total]) => (
            <div key={key}>
              <span>{tr(key)}</span>
              <strong>
                {count(value)}
                {total !== null && <small> / {count(total)}</small>}
              </strong>
              {total !== null && qualityRatio(value, total) !== null && (
                <div
                  className="qa-progress"
                  role="meter"
                  aria-label={tr(key)}
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={value!}
                >
                  <i
                    style={{ width: `${qualityRatio(value, total)! * 100}%` }}
                  />
                </div>
              )}
              {key === "automation" && <p>{tr("automationHelp")}</p>}
            </div>
          ))}
      </div>
    </section>
  );
  const sections: Record<AnalyticsSection, () => ReactNode> = {
    activity: activityContent,
    attention: attentionContent,
    runs: runsContent,
    inventory: inventoryContent,
  };
  const exportSnapshot = () => {
    if (!data) return;
    const url = URL.createObjectURL(
      new Blob([analyticsCsv(data)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `quality-analytics-${days}d-${data.evaluated_at.slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <main className="quality-analytics">
      <header className="qa-header">
        <div>
          <span className="qa-eyebrow">
            <IconChartBar size={16} />
            {data?.project.name || tr("title")}
          </span>
          <h1>{tr("title")}</h1>
          <p>{tr("subtitle")}</p>
        </div>
        <div className="qa-header-actions">
          {canReadiness && (
            <Link className="button qa-readiness-link" to="/?view=readiness">
              <IconShieldCheck size={17} />
              {tr("readiness")}
              <IconArrowRight size={16} />
            </Link>
          )}
          <button
            className="button secondary"
            disabled={!data}
            onClick={exportSnapshot}
          >
            <IconDownload size={17} />
            {tr("export")}
          </button>
        </div>
      </header>
      <div className="qa-toolbar">
        <label>
          {tr("period")}
          <select
            aria-label={tr("period")}
            value={days}
            onChange={(event) =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                next.set("days", event.target.value);
                return next;
              })
            }
          >
            {[14, 30, 90].map((day) => (
              <option key={day} value={day}>
                {tr("days", { count: day })}
              </option>
            ))}
          </select>
        </label>
        <span className="qa-updated" aria-live="polite">
          {data ? tr("updated", { date: formatDate(data.evaluated_at) }) : ""}
        </span>
        <div className="qa-toolbar-actions">
          <button className="qa-text-link" onClick={() => setDialog("layout")}>
            <IconSettings2 size={16} />
            {tr("personalize")}
          </button>
          <button
            className="qa-text-link"
            disabled={query.isFetching || !flags.data}
            onClick={() => void query.refetch()}
          >
            <IconRefresh size={16} />
            {tr(query.isFetching ? "refreshing" : "refresh")}
          </button>
        </div>
      </div>
      <p className="qa-scope-note">{tr("scope")}</p>
      {flags.isError && !flags.data ? (
        <div className="qa-notice" role="alert">
          {t("access.errorHelp")}{" "}
          <button className="qa-text-link" onClick={() => void flags.refetch()}>
            {tr("retry")}
          </button>
        </div>
      ) : !data ? (
        query.isError ? (
          error
        ) : (
          loading
        )
      ) : (
        <>
          {query.isError && (
            <div className="qa-notice" role="alert">
              {tr("refreshError")}{" "}
              <button
                className="qa-text-link"
                onClick={() => void query.refetch()}
              >
                {tr("retry")}
              </button>
            </div>
          )}
          {data.evidence.limitations.length > 0 && (
            <div className="qa-notice">
              <IconInfoCircle size={19} />
              <div>
                <strong>{tr("restricted")}</strong>
                <p>{tr("restrictedHelp")}</p>
              </div>
              <button
                className="qa-text-link"
                onClick={() => setDialog("method")}
              >
                {tr("method")}
              </button>
            </div>
          )}
          <div className="qa-metrics">
            {metric(
              "coverage",
              percent(inv!.covered_stories, inv!.stories),
              inv!.covered_stories === null
                ? tr("unavailable")
                : tr("coverageDetail", {
                    covered: count(inv!.covered_stories),
                    total: count(inv!.stories),
                  }),
            )}
            {metric(
              "pass",
              percent(
                ex!.passed,
                ex!.passed === null || ex!.failed === null
                  ? null
                  : ex!.passed + ex!.failed,
              ),
              ex!.passed === null
                ? tr("unavailable")
                : tr("passDetail", {
                    passed: count(ex!.passed),
                    failed: count(ex!.failed),
                  }),
            )}
            {metric(
              "attentionMetric",
              count(
                ex!.failed === null || ex!.blocked === null
                  ? null
                  : ex!.failed + ex!.blocked,
              ),
              ex!.failed === null
                ? tr("unavailable")
                : tr("attentionDetail", {
                    failed: count(ex!.failed),
                    blocked: count(ex!.blocked),
                  }),
              ex!.failed || ex!.blocked ? "danger" : "neutral",
            )}
            {metric(
              "defects",
              count(inv!.open_defects),
              inv!.open_defects === null
                ? tr("unavailable")
                : tr("defectsDetail"),
              inv!.open_defects ? "warning" : "neutral",
            )}
          </div>
          <div className="qa-content-grid">
            {layout.order
              .filter((id) => !layout.hidden.includes(id))
              .map((id) => (
                <div key={id} className={`qa-section qa-section-${id}`}>
                  {sections[id]()}
                </div>
              ))}
          </div>
          <footer className="qa-footer">
            <button
              className="qa-text-link"
              onClick={() => setDialog("method")}
            >
              <IconInfoCircle size={16} />
              {tr("method")}
            </button>
            {canReview && (
              <button
                className="qa-text-link"
                onClick={() => {
                  setReviewOpen(true);
                  review.mutate(String(projectId));
                }}
              >
                <IconSparkles size={16} />
                {tr("review")}
              </button>
            )}
            <span>
              {data.evidence.latest_at
                ? tr("freshMethod", {
                    date: formatDate(data.evidence.latest_at),
                  })
                : tr("noEvidence")}
            </span>
          </footer>
        </>
      )}
      {dialog === "method" && (
        <AnalyticsDialog title={tr("method")} onClose={() => setDialog(null)}>
          <p>{tr("methodHelp")}</p>
          <dl className="qa-definitions">
            {["coverage", "pass", "result", "defect", "trend"].map((key) => (
              <div key={key}>
                <dt>
                  {tr(
                    (
                      {
                        result: "attentionMetric",
                        defect: "defects",
                        trend: "activity",
                      } as Record<string, string>
                    )[key] || key,
                  )}
                </dt>
                <dd>{tr(`${key}Method`)}</dd>
              </div>
            ))}
          </dl>
          <p className="qa-scope-note">
            {tr("freshMethod", {
              date: data?.evidence.latest_at
                ? formatDate(data.evidence.latest_at)
                : tr("noEvidence"),
            })}
          </p>
          {data && (
            <ul className="qa-source-list">
              {Object.entries(data.visibility).map(([source, visible]) => (
                <li key={source}>
                  {tr(source === "bugs" ? "defects" : source)}:{" "}
                  {visible ? "✓" : tr("unavailable")}
                </li>
              ))}
            </ul>
          )}
        </AnalyticsDialog>
      )}
      {dialog === "layout" && (
        <AnalyticsDialog
          title={tr("personalize")}
          onClose={() => setDialog(null)}
        >
          <p>{tr("layoutHelp")}</p>
          <div className="qa-layout-options">
            {layout.order.map((id, index) => (
              <div key={id}>
                <label>
                  <input
                    type="checkbox"
                    checked={!layout.hidden.includes(id)}
                    disabled={
                      layout.hidden.length === 3 && !layout.hidden.includes(id)
                    }
                    onChange={() =>
                      saveLayout({
                        ...layout,
                        hidden: layout.hidden.includes(id)
                          ? layout.hidden.filter((item) => item !== id)
                          : [...layout.hidden, id],
                      })
                    }
                  />
                  {tr(id)}
                </label>
                {[-1, 1].map((direction) => (
                  <button
                    key={direction}
                    className="qa-icon-button"
                    disabled={
                      index + direction < 0 ||
                      index + direction >= layout.order.length
                    }
                    aria-label={tr(direction === -1 ? "moveUp" : "moveDown", {
                      section: tr(id),
                    })}
                    onClick={() => {
                      const order = [...layout.order];
                      [order[index], order[index + direction]] = [
                        order[index + direction],
                        order[index],
                      ];
                      saveLayout({ ...layout, order });
                    }}
                  >
                    {direction === -1 ? (
                      <IconArrowUp size={16} />
                    ) : (
                      <IconArrowDown size={16} />
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <button
            className="button secondary"
            onClick={() => saveLayout(normalizeAnalyticsLayout(null))}
          >
            {tr("reset")}
          </button>
        </AnalyticsDialog>
      )}
      <AiInsightPreviewDialog
        showScore={false}
        open={reviewOpen && canReview}
        onClose={() => setReviewOpen(false)}
        eyebrow={tr("title")}
        title={tr("review")}
        subtitle={tr("reviewHelp")}
        assuranceTitle={tr("method")}
        response={review.data}
        summary={review.data?.release_summary}
        loading={review.isPending}
        error={review.error instanceof Error ? review.error.message : null}
        findings={(review.data?.insights || []).map((insight) => ({
          id: insight.id,
          title: insight.title,
          severity: insight.severity,
          description: insight.explanation,
          action: insight.recommended_action,
          evidence: (insight.evidence || []).map(
            (item) => item.display_id || item.id,
          ),
        }))}
        recommendedActions={(review.data?.insights || []).map(insight => insight.recommended_action).filter((action): action is string => Boolean(action))}
        limitations={review.data?.limitations || []}
        emptyMessage={tr("reviewEmpty")}
      />
    </main>
  );
}
