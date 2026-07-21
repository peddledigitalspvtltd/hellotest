import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { QualityDashboard, QualityDashboardGadget, QualityDashboardGadgetResult } from "../types";
import { RefreshIcon, SparkIcon } from "./AppIcons";
import { DialogCloseButton } from "./DialogCloseButton";
import { FormField } from "./FormField";
import { LoadingState } from "./LoadingState";
import { ToastMessage } from "./ToastMessage";
import { useDialogFocus } from "../hooks/useDialogFocus";

const labelize = (value: string) => value.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());

const EMPTY_GADGET: QualityDashboardGadget = {
  id: "",
  title: "Quality signal",
  data_source: "qaira",
  type: "metric",
  jql: "",
  group_by: "status",
  metric: "releaseConfidence",
  accent: "blue"
};

const DEFAULT_COMPLEX_DASHBOARD_PROMPT = "Build a release-quality command center for QA leadership. Include release confidence, requirement traceability and coverage gaps, effective automation when permitted, open defect exposure, QA throughput, actual test-run cycle time, execution workflow, test distribution by module, ownership, and a prioritized action table. Keep every signal project-scoped, explainable, drillable, and useful at a glance.";

const GADGET_METRICS: NonNullable<QualityDashboardGadget["metric"]>[] = [
  "releaseConfidence", "requirementCoverage", "coverageGaps", "automationCoverage", "executionCompletion", "passRate",
  "openDefects", "failedRuns", "executionCycleHours", "completedRuns30d", "testCases", "testSuites", "testRuns", "moduleCaseCount"
];

const GADGET_GROUPS: QualityDashboardGadget["group_by"][] = [
  "status", "priority", "assignee", "labels", "sprint", "fixVersion", "module", "createdWeek", "updatedWeek", "createdMonth", "updatedMonth"
];

const GADGET_PRESETS: Array<{ label: string; description: string; gadget: QualityDashboardGadget }> = [
  { label: "Release confidence", description: "Weighted evidence score for release review.", gadget: { ...EMPTY_GADGET, id: "", title: "Release confidence", metric: "releaseConfidence", accent: "blue" } },
  { label: "Requirement traceability", description: "Requirements with and without linked tests.", gadget: { ...EMPTY_GADGET, id: "", title: "Requirement traceability", metric: "requirementCoverage", accent: "green" } },
  { label: "Execution cycle time", description: "Actual elapsed time from run start to completion.", gadget: { ...EMPTY_GADGET, id: "", title: "Execution cycle time", metric: "executionCycleHours", accent: "teal" } },
  { label: "Coverage gaps", description: "Requirements without linked tests.", gadget: { ...EMPTY_GADGET, id: "", title: "Requirement coverage gaps", metric: "coverageGaps", accent: "orange" } },
  { label: "Execution flow", description: "Run status distribution.", gadget: { ...EMPTY_GADGET, id: "", title: "Execution workflow", type: "donut", metric: "testRuns", group_by: "status", accent: "teal" } },
  { label: "Open defects", description: "Current unresolved defect exposure.", gadget: { ...EMPTY_GADGET, id: "", title: "Open defects", metric: "openDefects", accent: "red" } },
  { label: "Module distribution", description: "Test cases grouped by product module.", gadget: { ...EMPTY_GADGET, id: "", title: "Test distribution by module", type: "bar", metric: "moduleCaseCount", group_by: "module", accent: "purple" } }
];

function GadgetResult({ result }: { result: QualityDashboardGadgetResult }) {
  const peak = Math.max(...result.series.map((item) => item.value), 1);
  const drilldown = (group?: string) => `${result.drilldown_target || "/"}${group ? `${(result.drilldown_target || "/").includes("?") ? "&" : "?"}dashboardGroup=${encodeURIComponent(group)}` : ""}`;
  return (
    <article className={`quality-gadget accent-${result.gadget.accent || "blue"}`}>
      <div className="quality-gadget-head"><div><span>{result.gadget.data_source === "jira" ? "Imported query" : "QAira evidence"}</span><strong>{result.gadget.title}</strong></div><small>{result.truncated ? "First 100" : `${result.returned} records`}</small></div>
      {result.gadget.type === "metric" ? <div className="quality-gadget-metric"><strong>{result.value_label}</strong><span>{result.methodology}</span></div> : null}
      {result.gadget.type !== "metric" && result.gadget.type !== "table" ? (
        <div className="quality-gadget-series">
          {result.series.slice(0, 10).map((item) => <a href={drilldown(item.label)} key={item.label} title={`Open ${item.label}`}><span>{item.label}</span><i><em style={{ width: `${Math.max(4, (item.value / peak) * 100)}%` }} /></i><strong>{item.value}</strong></a>)}
        </div>
      ) : null}
      {result.gadget.type === "table" ? (
        <div className="quality-gadget-table">{result.rows.slice(0, 8).map((row) => <a href={`${result.drilldown_target || "/"}?${result.drilldown_target === "/issues" ? "issue" : "case"}=${encodeURIComponent(row.id)}`} key={row.id}><strong>{row.key}</strong><span>{row.title}</span><small>{row.status || "No status"}</small></a>)}</div>
      ) : null}
      <div className="quality-gadget-footer"><a href={drilldown()} title="Open drill-down">Open drill-down ↗</a><span>{result.gadget.release || "All releases"}</span><small>{new Date(result.evaluated_at).toLocaleString()}</small></div>
    </article>
  );
}

export function QualityIntelligencePanel({ projectId, releases, sprints, canManage, canUseInsights, canUseAutomation = false, selectedView }: { projectId: string; releases: string[]; sprints: string[]; canManage: boolean; canUseInsights: boolean; canUseAutomation?: boolean; selectedView?: "readiness" | "dashboards" }) {
  const queryClient = useQueryClient();
  const [internalView, setInternalView] = useState<"readiness" | "dashboards">("readiness");
  const view = selectedView || internalView;
  const [release, setRelease] = useState("");
  const [sprint, setSprint] = useState("");
  const [readinessView, setReadinessView] = useState<"brief" | "traceability" | "execution">("brief");
  const [selectedId, setSelectedId] = useState("");
  const [designerOpen, setDesignerOpen] = useState(false);
  const [stakeholder, setStakeholder] = useState("quality");
  const [prompt, setPrompt] = useState(DEFAULT_COMPLEX_DASHBOARD_PROMPT);
  const [designPreview, setDesignPreview] = useState<QualityDashboard | null>(null);
  const [editDraft, setEditDraft] = useState<QualityDashboard | null>(null);
  const [gadgetDraft, setGadgetDraft] = useState<QualityDashboardGadget>(EMPTY_GADGET);
  const [editingGadgetId, setEditingGadgetId] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const insights = useQuery({
    queryKey: ["quality-insights", projectId, release, sprint],
    queryFn: () => api.ai.qualityInsights({ project_id: projectId, release: release || undefined, sprint: sprint || undefined }),
    enabled: Boolean(projectId && canUseInsights && view === "readiness"),
    staleTime: 30_000
  });
  const dashboards = useQuery({ queryKey: ["quality-dashboards", projectId], queryFn: () => api.qualityDashboards.list(projectId), enabled: Boolean(projectId && view === "dashboards") });
  const selected = useMemo(() => (dashboards.data || []).find((item) => item.id === selectedId) || null, [dashboards.data, selectedId]);
  useEffect(() => {
    if (dashboards.data?.length && !dashboards.data.some((item) => item.id === selectedId)) setSelectedId(dashboards.data[0].id);
  }, [dashboards.data, selectedId]);
  useEffect(() => { setSelectedId(""); setRelease(""); setSprint(""); setDesignPreview(null); }, [projectId]);
  useEffect(() => {
    if (!canUseAutomation && stakeholder === "automation") setStakeholder("quality");
  }, [canUseAutomation, stakeholder]);
  const results = useQuery({
    queryKey: ["quality-dashboard-results", projectId, selected?.id, selected?.updated_at],
    queryFn: () => api.analytics.queryBatch(projectId, selected?.gadgets || []),
    enabled: Boolean(projectId && selected?.gadgets.length && view === "dashboards"),
    staleTime: 30_000
  });
  const design = useMutation({
    mutationFn: () => api.analytics.designDashboard({ project_id: projectId, stakeholder, release: release || undefined, prompt }),
    onSuccess: (response) => setDesignPreview({ ...response.dashboard, id: "" }),
    onError: (error) => { setMessageTone("error"); setMessage(error instanceof Error ? error.message : "Unable to design a dashboard."); }
  });
  const gadgetPreview = useMutation({
    mutationFn: (gadget: QualityDashboardGadget) => api.analytics.query(projectId, { ...gadget, id: gadget.id || "preview" }),
    onError: (error) => { setMessageTone("error"); setMessage(error instanceof Error ? error.message : "Unable to preview the gadget."); }
  });
  const save = useMutation({
    mutationFn: () => api.qualityDashboards.create(designPreview as Omit<QualityDashboard, "id">),
    onSuccess: async (dashboard) => {
      setDesignerOpen(false);
      setDesignPreview(null);
      setSelectedId(dashboard.id);
      setMessageTone("success");
      setMessage("Quality dashboard saved.");
      await queryClient.invalidateQueries({ queryKey: ["quality-dashboards", projectId] });
    },
    onError: (error) => { setMessageTone("error"); setMessage(error instanceof Error ? error.message : "Unable to save the dashboard."); }
  });
  const remove = useMutation({
    mutationFn: api.qualityDashboards.delete,
    onSuccess: async () => {
      setDeleteCandidate("");
      setSelectedId("");
      setMessageTone("success");
      setMessage("Quality dashboard deleted.");
      await queryClient.invalidateQueries({ queryKey: ["quality-dashboards", projectId] });
    },
    onError: (error) => { setMessageTone("error"); setMessage(error instanceof Error ? error.message : "Unable to delete the dashboard."); }
  });
  const update = useMutation({
    mutationFn: () => {
      const dashboard = editDraft as QualityDashboard;
      return dashboard.id
        ? api.qualityDashboards.update(dashboard.id, dashboard)
        : api.qualityDashboards.create({ ...dashboard, project_id: projectId } as Omit<QualityDashboard, "id">);
    },
    onSuccess: async (dashboard) => {
      setEditDraft(null);
      setSelectedId(dashboard.id);
      setMessageTone("success");
      setMessage("Quality dashboard saved.");
      await queryClient.invalidateQueries({ queryKey: ["quality-dashboards", projectId] });
    },
    onError: (error) => { setMessageTone("error"); setMessage(error instanceof Error ? error.message : "Unable to update the dashboard."); }
  });
  const designerDialogRef = useDialogFocus<HTMLDivElement>({
    active: designerOpen,
    closeDisabled: save.isPending,
    onClose: () => setDesignerOpen(false)
  });
  const editorDialogRef = useDialogFocus<HTMLDivElement>({
    active: Boolean(editDraft),
    closeDisabled: update.isPending,
    onClose: () => setEditDraft(null)
  });
  const metrics = insights.data?.metrics || {};
  const gateDefinitions = [
    ["Priority requirement coverage", Number(metrics.uncoveredHighPriorityRequirements || 0) === 0, `${metrics.uncoveredHighPriorityRequirements || 0} uncovered P1/P2`],
    ["Execution completion", Number(metrics.executionCompletion || 0) >= 95, `${metrics.executionCompletion || 0}% completed`],
    ["Latest-result pass rate", Number(metrics.passRate || 0) >= 90, `${metrics.passRate || 0}% passed`],
    ["Critical defects", Number(metrics.criticalDefects || 0) === 0, `${metrics.criticalDefects || 0} open`],
    ["Blocked results", Number(metrics.blockedResults || 0) === 0, `${metrics.blockedResults || 0} blocked`],
    ["Evidence freshness", Number(metrics.evidenceAgeDays ?? -1) >= 0 && Number(metrics.evidenceAgeDays) <= 14, Number(metrics.evidenceAgeDays ?? -1) < 0 ? "No result evidence" : `${metrics.evidenceAgeDays} days old`]
  ] as const;

  const moveGadget = (index: number, offset: number) => {
    setEditDraft((current) => {
      if (!current) return current;
      const target = index + offset;
      if (target < 0 || target >= current.gadgets.length) return current;
      const gadgets = [...current.gadgets];
      [gadgets[index], gadgets[target]] = [gadgets[target], gadgets[index]];
      return { ...current, gadgets };
    });
  };

  const saveGadgetDraft = () => {
    if (!gadgetDraft.title.trim()) return;
    const id = editingGadgetId || (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `gadget-${Date.now()}`);
    setEditDraft((current) => {
      if (!current) return current;
      const gadget = { ...gadgetDraft, id, release: gadgetDraft.release || undefined };
      return {
        ...current,
        gadgets: editingGadgetId
          ? current.gadgets.map((item) => item.id === editingGadgetId ? gadget : item)
          : [...current.gadgets, gadget]
      };
    });
    setEditingGadgetId("");
    setGadgetDraft({ ...EMPTY_GADGET, title: "" });
    gadgetPreview.reset();
  };

  const openCreateDashboard = () => {
    setEditingGadgetId("");
    setGadgetDraft({ ...EMPTY_GADGET, title: "" });
    gadgetPreview.reset();
    setEditDraft({
      id: "",
      project_id: projectId,
      name: "Release quality",
      description: "",
      layout: "two-column",
      gadgets: []
    });
  };

  if (!projectId) return null;

  return (
    <section className="quality-intelligence card">
      {view !== "dashboards" || !selectedView ? <div className="quality-intelligence-head">
        <div><span className="eyebrow">Release evidence</span><h2>Quality intelligence</h2><p>Decision support derived from QAira records, with explicit scope and human approval boundaries.</p></div>
        {!selectedView ? (
          <div className="quality-view-tabs" role="tablist">
            <button aria-selected={view === "readiness"} className={view === "readiness" ? "is-active" : ""} onClick={() => setInternalView("readiness")} role="tab" type="button">Release readiness</button>
            <button aria-selected={view === "dashboards"} className={view === "dashboards" ? "is-active" : ""} onClick={() => setInternalView("dashboards")} role="tab" type="button">Custom dashboards</button>
          </div>
        ) : null}
      </div> : null}

      {view === "readiness" ? (
        <div className="release-readiness-workspace">
          <div className="quality-scope-toolbar">
            <div className="readiness-scope-fields">
              <label><span>Release scope</span><select value={release} onChange={(event) => setRelease(event.target.value)}><option value="">All releases</option>{releases.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label><span>Sprint scope</span><select value={sprint} onChange={(event) => setSprint(event.target.value)}><option value="">All sprints</option>{sprints.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            </div>
            <button className="ghost-button compact" disabled={insights.isFetching || !canUseInsights} onClick={() => void insights.refetch()} type="button">{insights.isFetching ? "Refreshing…" : "Refresh evidence"}</button>
          </div>
          <div className="readiness-section-tabs" role="tablist">
            {(["brief", "traceability", "execution"] as const).map((item) => <button aria-selected={readinessView === item} className={readinessView === item ? "is-active" : ""} key={item} onClick={() => setReadinessView(item)} role="tab" type="button">{item === "brief" ? "Decision brief" : labelize(item)}</button>)}
          </div>
          {!canUseInsights ? <div className="inline-error">Permission required: quality_insight.view</div> : null}
          {insights.isLoading ? <div className="entity-evidence-loading">Building the release evidence graph…</div> : null}
          {insights.error ? <div className="inline-error">{insights.error instanceof Error ? insights.error.message : "Unable to load release readiness."}</div> : null}
          {insights.data ? (
            <>
              <div className="release-decision-brief">
                <div className="release-confidence"><strong>{Number(metrics.releaseConfidence || 0)}%</strong><span>Readiness score</span><small>This score is an attention aid, not approval.</small></div>
                <div><span className="eyebrow">Decision brief</span><h3>{insights.data.summary}</h3><p>Evidence confidence: {Number(metrics.evidenceConfidence || 0)}%. Scope: {[release || "all releases", sprint || "all sprints"].join(" · ")}.</p><div className="ai-assurance-strip"><span><strong>{Math.round(insights.data.confidence * 100)}%</strong> analysis confidence</span><span><strong>Deterministic</strong> evidence graph</span><span><strong>Human</strong> release decision</span></div></div>
              </div>
              {readinessView === "brief" ? (
                <>
                  <div className="release-gate-grid">{gateDefinitions.map(([label, passed, detail]) => <article className={passed ? "is-passed" : "is-blocked"} key={label}><span>{passed ? "Pass" : "Review"}</span><strong>{label}</strong><small>{detail}</small></article>)}</div>
                  <div className="release-finding-grid">
                    {(insights.data.findings || []).map((finding) => <article key={finding.id}><span className={`status-pill ${finding.severity === "high" ? "danger" : "warning"}`}>{finding.severity}</span><strong>{finding.title}</strong><p>{finding.description}</p><small>{finding.action}</small></article>)}
                    {!insights.data.findings.length ? <div className="empty-state compact">No release blockers were found in the selected evidence scope.</div> : null}
                  </div>
                </>
              ) : null}
              {readinessView === "traceability" ? (
                <div className="readiness-evidence-section">
                  <div className="readiness-detail-grid">
                    <article><span>Requirement coverage</span><strong>{Number(metrics.requirementCoverage || 0)}%</strong><p>{Number(metrics.coverageGaps || 0)} requirements still need linked test coverage.</p><a href="/requirements">Review requirements</a></article>
                    <article><span>Automation coverage</span><strong>{Number(metrics.automationCoverage || 0)}%</strong><p>Effective automation within the selected release and sprint scope.</p><a href="/test-cases">Review test cases</a></article>
                    <article><span>Evidence confidence</span><strong>{Number(metrics.evidenceConfidence || 0)}%</strong><p>Completeness of traceability and execution evidence used by this brief.</p></article>
                  </div>
                  <div className="table-wrap readiness-evidence-table-wrap">
                    <table className="data-table readiness-evidence-table">
                      <thead><tr><th>Requirement</th><th>Priority</th><th>Tests</th><th>Executed</th><th>Pass</th><th>Failed / blocked</th><th>Open defects</th><th>Risk</th></tr></thead>
                      <tbody>{insights.data.traceability.map((item) => <tr key={item.id}><td><a href={`/requirements?requirement=${encodeURIComponent(item.id)}`}><strong>{item.key}</strong><span>{item.title}</span></a></td><td>P{item.priority}</td><td>{item.test_case_count}</td><td>{item.executed_count}</td><td>{item.passed_count}</td><td>{item.failed_or_blocked_count}</td><td>{item.open_defect_count}</td><td><span className={`status-pill ${item.risk === "high" ? "danger" : item.risk === "medium" ? "warning" : "success"}`}>{item.risk}</span></td></tr>)}</tbody>
                    </table>
                    {!insights.data.traceability.length ? <div className="empty-state compact">No requirements are available in this release and sprint scope.</div> : null}
                  </div>
                </div>
              ) : null}
              {readinessView === "execution" ? (
                <div className="readiness-evidence-section">
                  <div className="readiness-detail-grid">
                    <article><span>Execution completion</span><strong>{Number(metrics.executionCompletion || 0)}%</strong><p>{Number(metrics.completedRuns30d || 0)} completed runs in the latest 30-day window.</p><a href="/executions">Open test runs</a></article>
                    <article><span>Latest-result pass rate</span><strong>{Number(metrics.passRate || 0)}%</strong><p>{Number(metrics.blockedResults || 0)} blocked results and {Number(metrics.failedRuns || 0)} failed runs remain.</p><a href="/executions">Inspect failures</a></article>
                    <article><span>Open defect exposure</span><strong>{Number(metrics.openDefects || 0)}</strong><p>{Number(metrics.criticalDefects || 0)} critical defects require explicit review.</p><a href="/issues">Review bugs</a></article>
                  </div>
                  <div className="table-wrap readiness-evidence-table-wrap">
                    <table className="data-table readiness-evidence-table">
                      <thead><tr><th>Run</th><th>Status</th><th>Release / Sprint</th><th>Results</th><th>Passed</th><th>Failed</th><th>Blocked</th><th>Started</th></tr></thead>
                      <tbody>{insights.data.execution_evidence.map((item) => <tr key={item.id}><td><a href={`/executions?execution=${encodeURIComponent(item.id)}`}><strong>{item.key}</strong><span>{item.name}</span></a></td><td>{labelize(item.status || "unknown")}</td><td>{[item.release, item.sprint].filter(Boolean).join(" · ") || "Unscoped"}</td><td>{item.result_count}</td><td>{item.passed_count}</td><td>{item.failed_count}</td><td>{item.blocked_count}</td><td>{item.started_at ? new Date(item.started_at).toLocaleString() : "Not started"}</td></tr>)}</tbody>
                    </table>
                    {!insights.data.execution_evidence.length ? <div className="empty-state compact">No execution evidence is available in this release and sprint scope.</div> : null}
                  </div>
                </div>
              ) : null}
              <div className="quality-limitations"><strong>Interpretation limits</strong>{insights.data.limitations.map((item) => <span key={item}>{item}</span>)}</div>
            </>
          ) : null}
        </div>
      ) : (
        <div className="custom-dashboard-workspace">
          <div className="custom-dashboard-toolbar card">
            <div className="custom-dashboard-toolbar-main">
              <div className="custom-dashboard-selector-field">
                <FormField label="Dashboard">
                  <select disabled={!dashboards.data?.length} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                    {!dashboards.data?.length ? <option value="">No dashboards yet</option> : null}
                    {(dashboards.data || []).map((dashboard) => <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>)}
                  </select>
                </FormField>
              </div>
            </div>
            <div className="custom-dashboard-toolbar-actions">
              <button className="primary-button" disabled={!canManage} onClick={openCreateDashboard} type="button">Create dashboard</button>
              <button className="ghost-button" disabled={!canManage || !canUseInsights} onClick={() => { setDesignPreview(null); setDesignerOpen(true); }} title={!canUseInsights ? "Quality insight permission is required" : undefined} type="button"><SparkIcon /><span>Design with AI</span></button>
              <button className="ghost-button" disabled={!canManage || !selected} onClick={() => { if (!selected) return; setEditDraft({ ...selected, gadgets: selected.gadgets.map((item) => ({ ...item })) }); setEditingGadgetId(""); setGadgetDraft({ ...EMPTY_GADGET, title: "" }); gadgetPreview.reset(); }} type="button">Edit</button>
              <button className="ghost-button danger" disabled={!canManage || !selected || remove.isPending} onClick={() => selected && setDeleteCandidate(selected.id)} type="button">{remove.isPending ? "Deleting…" : "Delete"}</button>
              <button className="ghost-button" disabled={!selected} onClick={() => window.print()} type="button">Print / PDF</button>
              <button
                aria-busy={dashboards.isFetching || results.isFetching}
                aria-label={dashboards.isFetching || results.isFetching ? "Refreshing dashboards" : "Refresh dashboards"}
                className={`ghost-button explorer-icon-button${dashboards.isFetching || results.isFetching ? " is-loading" : ""}`}
                disabled={dashboards.isFetching || results.isFetching}
                onClick={() => { void dashboards.refetch(); if (selected) void results.refetch(); }}
                title="Refresh dashboards"
                type="button"
              ><RefreshIcon /></button>
            </div>
          </div>
          {dashboards.isLoading ? <LoadingState label="Loading quality dashboards" /> : null}
          {selected ? (
            <section aria-label={selected.name} className="custom-dashboard-view card">
              <div className="custom-dashboard-view-head"><div><strong>{selected.name}{selected.is_default ? " · Default" : ""}</strong><span>{selected.description || "Project-scoped quality signals"}</span></div><small>{selected.gadgets.length} gadgets · {labelize(selected.layout)}</small></div>
              {results.error ? <div className="inline-error">{results.error instanceof Error ? results.error.message : "Unable to evaluate dashboard."}</div> : null}
              {results.isLoading ? <LoadingState label="Evaluating dashboard" /> : null}
              <div className={`quality-gadget-grid layout-${selected.layout}`}>{(results.data?.results || []).map((entry) => entry.result ? <GadgetResult key={entry.gadget_id} result={entry.result} /> : <article className="quality-gadget is-error" key={entry.gadget_id}><strong>Gadget unavailable</strong><span>{entry.error?.message}</span></article>)}</div>
            </section>
          ) : !dashboards.isLoading ? (
            <div className="empty-state"><strong>No custom dashboard yet</strong><span>Create one manually or start with the assisted designer, review every signal, then save it for this project.</span>{canManage ? <button className="primary-button" onClick={openCreateDashboard} type="button">Create dashboard</button> : null}</div>
          ) : null}
        </div>
      )}

      {designerOpen ? (
        <div className="modal-backdrop modal-backdrop--scroll" onClick={() => !save.isPending && setDesignerOpen(false)} role="presentation"><div aria-labelledby="dashboard-designer-title" aria-modal="true" className="modal-card quality-designer-dialog" onClick={(event) => event.stopPropagation()} ref={designerDialogRef} role="dialog" tabIndex={-1}>
          <div className="modal-card-head"><div><span className="eyebrow">Assisted designer</span><h2 id="dashboard-designer-title">Design quality dashboard</h2><p>The designer produces a review-only draft. Nothing is saved until you approve it.</p></div><DialogCloseButton disabled={save.isPending} label="Close dashboard designer" onClick={() => setDesignerOpen(false)} /></div>
          <div className="form-grid"><label><span>Audience</span><select value={stakeholder} onChange={(event) => setStakeholder(event.target.value)}><option value="executive">Executive</option><option value="product">Product</option><option value="quality">Quality engineering</option>{canUseAutomation ? <option value="automation">Automation</option> : null}</select></label><label><span>Release</span><select value={release} onChange={(event) => setRelease(event.target.value)}><option value="">All releases</option>{releases.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label><span>Dashboard build prompt</span><textarea maxLength={2000} rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label></div>
          {designPreview ? <div className="dashboard-design-preview"><div><strong>{designPreview.name}</strong><span>{designPreview.description}</span></div>{designPreview.gadgets.map((gadget) => <article key={gadget.id}><strong>{gadget.title}</strong><span>{labelize(gadget.metric || "count")} · {labelize(gadget.type)}</span></article>)}</div> : null}
          <div className="modal-actions"><button className="ghost-button" disabled={design.isPending} onClick={() => design.mutate()} type="button">{design.isPending ? "Designing…" : designPreview ? "Redesign preview" : "Generate preview"}</button><button className="primary-button" disabled={!designPreview || save.isPending} onClick={() => save.mutate()} type="button">{save.isPending ? "Saving…" : "Approve and save"}</button></div>
        </div></div>
      ) : null}
      {editDraft ? (
        <div className="modal-backdrop modal-backdrop--scroll" onClick={() => !update.isPending && setEditDraft(null)} role="presentation"><div aria-labelledby="dashboard-editor-title" aria-modal="true" className="modal-card quality-designer-dialog custom-dashboard-modal" onClick={(event) => event.stopPropagation()} ref={editorDialogRef} role="dialog" tabIndex={-1}>
          <div className="modal-card-head"><div><span className="eyebrow">Dashboard editor</span><h2 id="dashboard-editor-title">{editDraft.id ? "Edit" : "Create"} custom dashboard</h2><p>Configure up to 12 bounded, project-scoped gadgets and preview signals before saving.</p></div><DialogCloseButton disabled={update.isPending} label="Close dashboard editor" onClick={() => setEditDraft(null)} /></div>
          <div className="form-grid">
            <label><span>Name</span><input maxLength={120} value={editDraft.name} onChange={(event) => setEditDraft((current) => current ? { ...current, name: event.target.value } : current)} /></label>
            <label><span>Description</span><input maxLength={500} value={editDraft.description || ""} onChange={(event) => setEditDraft((current) => current ? { ...current, description: event.target.value } : current)} /></label>
            <label><span>Layout</span><select value={editDraft.layout} onChange={(event) => setEditDraft((current) => current ? { ...current, layout: event.target.value as QualityDashboard["layout"] } : current)}><option value="single">Single column</option><option value="two-column">Two columns</option><option value="three-column">Three columns</option></select></label>
            <label className="dashboard-default-toggle"><input checked={Boolean(editDraft.is_default)} onChange={(event) => setEditDraft((current) => current ? { ...current, is_default: event.target.checked } : current)} type="checkbox" /><span>Use as project default</span></label>
          </div>
          <section className="dashboard-gadget-editor">
            <div className="entity-evidence-head"><div><strong>Gadgets</strong><span>{editDraft.gadgets.length}/12 configured · order controls dashboard placement</span></div></div>
            <div className="dashboard-gadget-list">{editDraft.gadgets.map((gadget, index) => <article key={gadget.id}><span>{index + 1}</span><div><strong>{gadget.title}</strong><small>{labelize(gadget.metric || "count")} · {labelize(gadget.type)} · {labelize(gadget.group_by)}</small></div><div className="dashboard-gadget-row-actions"><button className="ghost-button compact" disabled={index === 0} onClick={() => moveGadget(index, -1)} type="button">Up</button><button className="ghost-button compact" disabled={index === editDraft.gadgets.length - 1} onClick={() => moveGadget(index, 1)} type="button">Down</button><button className="ghost-button compact" onClick={() => { setEditingGadgetId(gadget.id); setGadgetDraft({ ...gadget }); }} type="button">Edit</button><button className="ghost-button compact" disabled={editDraft.gadgets.length >= 12} onClick={() => { const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `gadget-${Date.now()}`; setEditDraft((current) => current ? { ...current, gadgets: [...current.gadgets, { ...gadget, id, title: `${gadget.title} copy` }] } : current); }} type="button">Duplicate</button><button className="ghost-button compact danger" onClick={() => setEditDraft((current) => current ? { ...current, gadgets: current.gadgets.filter((item) => item.id !== gadget.id) } : current)} type="button">Remove</button></div></article>)}</div>
            {editDraft.gadgets.length < 12 || editingGadgetId ? <>
              {!editingGadgetId ? <div className="dashboard-preset-grid">{GADGET_PRESETS.map((preset) => <button key={preset.label} onClick={() => setGadgetDraft({ ...preset.gadget, release: release || undefined })} type="button"><strong>{preset.label}</strong><span>{preset.description}</span></button>)}</div> : null}
              <div className="dashboard-gadget-form">
                <label><span>Title</span><input maxLength={100} value={gadgetDraft.title} onChange={(event) => setGadgetDraft((current) => ({ ...current, title: event.target.value }))} /></label>
                <label><span>Metric</span><select value={gadgetDraft.metric} onChange={(event) => setGadgetDraft((current) => ({ ...current, metric: event.target.value as QualityDashboardGadget["metric"] }))}>{GADGET_METRICS.map((metric) => <option key={metric} value={metric}>{labelize(metric)}</option>)}</select></label>
                <label><span>Visualization</span><select value={gadgetDraft.type} onChange={(event) => setGadgetDraft((current) => ({ ...current, type: event.target.value as QualityDashboardGadget["type"] }))}><option value="metric">Metric</option><option value="bar">Bar</option><option value="stacked-bar">Stacked bar</option><option value="donut">Donut</option><option value="line">Line</option><option value="table">Table</option></select></label>
                <label><span>Group by</span><select value={gadgetDraft.group_by} onChange={(event) => setGadgetDraft((current) => ({ ...current, group_by: event.target.value as QualityDashboardGadget["group_by"] }))}>{GADGET_GROUPS.map((group) => <option key={group} value={group}>{labelize(group)}</option>)}</select></label>
                <label><span>Release</span><select value={gadgetDraft.release || ""} onChange={(event) => setGadgetDraft((current) => ({ ...current, release: event.target.value || undefined }))}><option value="">All releases</option>{releases.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                <label><span>Accent</span><select value={gadgetDraft.accent} onChange={(event) => setGadgetDraft((current) => ({ ...current, accent: event.target.value as QualityDashboardGadget["accent"] }))}>{["blue", "green", "purple", "orange", "red", "teal", "slate"].map((accent) => <option key={accent} value={accent}>{labelize(accent)}</option>)}</select></label>
                <div className="dashboard-gadget-form-actions"><button className="ghost-button" disabled={gadgetPreview.isPending || !gadgetDraft.title.trim()} onClick={() => gadgetPreview.mutate({ ...gadgetDraft, id: gadgetDraft.id || "preview" })} type="button">{gadgetPreview.isPending ? "Evaluating…" : "Preview"}</button>{editingGadgetId ? <button className="ghost-button" onClick={() => { setEditingGadgetId(""); setGadgetDraft({ ...EMPTY_GADGET, title: "" }); gadgetPreview.reset(); }} type="button">Cancel edit</button> : null}<button className="primary-button" disabled={!gadgetDraft.title.trim() || (!editingGadgetId && editDraft.gadgets.length >= 12)} onClick={saveGadgetDraft} type="button">{editingGadgetId ? "Apply gadget" : "Add gadget"}</button></div>
              </div>
              {gadgetPreview.data ? <div className="dashboard-gadget-preview"><span className="eyebrow">Live preview</span><GadgetResult result={gadgetPreview.data} /></div> : null}
            </> : null}
          </section>
          <div className="modal-actions"><button className="ghost-button" onClick={() => setEditDraft(null)} type="button">Cancel</button><button className="primary-button" disabled={!editDraft.name.trim() || update.isPending} onClick={() => update.mutate()} type="button">{update.isPending ? "Saving…" : "Save dashboard"}</button></div>
        </div></div>
      ) : null}
      {deleteCandidate ? <div className="entity-attachment-confirm" role="alert"><span>Delete this saved quality dashboard?</span><div><button className="ghost-button compact" onClick={() => setDeleteCandidate("")} type="button">Cancel</button><button className="ghost-button compact danger" disabled={remove.isPending} onClick={() => remove.mutate(deleteCandidate)} type="button">Delete</button></div></div> : null}
      {message ? <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} /> : null}
    </section>
  );
}
