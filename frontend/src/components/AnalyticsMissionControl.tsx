import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  IconAlertTriangle,
  IconApi,
  IconArrowRight,
  IconBrain,
  IconDeviceMobile,
  IconEye,
  IconRosetteDiscountCheck,
  IconSearch,
  IconWorld,
  type TablerIcon
} from "@tabler/icons-react";
import { useAiPromptRegistry } from "../hooks/useAiPromptRegistry";
import { MetricMethodologyInfo } from "./MetricMethodologyInfo";
import "./AnalyticsMissionControl.css";

export type AnalyticsMissionTone = "success" | "info" | "neutral" | "error";
export type AnalyticsMissionSectionId = "decision" | "signals" | "delivery" | "flow" | "automation" | "risk";

export type AnalyticsMissionAction = {
  id: string;
  title: string;
  detail: string;
  meta: string;
  to: string;
  tone: AnalyticsMissionTone;
};

export type AnalyticsMissionLane = {
  id: string;
  name: string;
  projectName: string;
  type: string;
  cases: number;
  suites: number;
  executableCases: number;
  failedSignals: number;
  releaseScore: number;
  label: string;
  tone: AnalyticsMissionTone;
  destination: string;
};

export type AnalyticsMissionEvidenceItem = {
  id: string;
  title: string;
  detail: string;
  label: string;
  tone: AnalyticsMissionTone;
  to: string;
};

export type AnalyticsMissionFunnelMetric = {
  id: string;
  label: string;
  value: number;
  detail: string;
  chipLabel: string;
  tone: AnalyticsMissionTone;
};

export type AnalyticsMissionHotspot = {
  id: string;
  title: string;
  detail: string;
  count: number;
  status: "failed" | "blocked";
  executionId: string;
};

export type AnalyticsMissionExecution = {
  id: string;
  name?: string | null;
  projectName: string;
  appTypeName: string;
  trigger?: string | null;
  status?: string | null;
  summary: {
    running: number;
    passed: number;
    failed: number;
    blocked: number;
    total: number;
    percent: number;
  };
};

export type AnalyticsMissionActivity = {
  key: string;
  label: string;
  total: number;
  height: number;
};

type SectionState = Record<AnalyticsMissionSectionId, { order: number; visible: boolean }>;

type AnalyticsMissionControlProps = {
  projectName: string;
  provisional: boolean;
  releaseScore: number;
  releaseHeadline: string;
  releaseNarrative: string;
  storyCoverage: number;
  mappedStories: number;
  totalStories: number;
  designCompleteness: number;
  executableCases: number;
  verifiedCases: number;
  runConfidence: number;
  latestPassRate: number;
  latestFailedSignals: number;
  openRiskCount: number;
  releaseBlockerCount: number;
  topRecommendation: string;
  actions: AnalyticsMissionAction[];
  lanes: AnalyticsMissionLane[];
  evidenceQueue: AnalyticsMissionEvidenceItem[];
  funnelMetrics: AnalyticsMissionFunnelMetric[];
  activity: AnalyticsMissionActivity[];
  passedSignals: number;
  unstableSignals: number;
  activeChecks: number;
  automationAvailable: boolean;
  automationCoverage: number;
  automatedCases: number;
  verifiedAutomationCases: number;
  automatedRuns: number;
  automatedPassRate: number;
  automatedResults: number;
  automationCandidates: number;
  hotspots: AnalyticsMissionHotspot[];
  recentExecutions: AnalyticsMissionExecution[];
  sectionState: SectionState;
  canCreateTestCases: boolean;
  canExplainSignals: boolean;
  isExplainingSignals: boolean;
  onExplainSignals: () => void;
  onOpenLayout: () => void;
  onOpenEvidence: (id: "readiness" | "requirements" | "design" | "passRate" | "risks" | "automation") => void;
  onNavigate: (to: string) => void;
};

const projectTabs = [
  { label: "Summary", to: "/?view=analytics" },
  { label: "Backlog", to: "/backlog" },
  { label: "Active sprints", to: "/sprints" },
  { label: "Releases", to: "/releases" },
  { label: "Timeline", to: "/executions" },
  { label: "Docs", to: "/knowledge-repo" }
];

function matchesQuery(query: string, values: Array<string | number | null | undefined>) {
  if (!query) return true;
  return values.filter((value) => value !== null && value !== undefined).join(" ").toLowerCase().includes(query);
}

function laneIcon(type: string): TablerIcon {
  const normalized = type.toLowerCase();
  if (normalized.includes("api")) return IconApi;
  if (normalized.includes("mobile") || normalized.includes("android") || normalized.includes("ios")) return IconDeviceMobile;
  return IconWorld;
}

function evidenceState(item: AnalyticsMissionEvidenceItem) {
  if (item.id.startsWith("execution-")) return "Failed";
  if (item.id.startsWith("requirement-")) return "No design";
  if (item.id.startsWith("case-")) return "Incomplete";
  return item.tone === "error" ? "Attention" : "Open";
}

function runStatusLabel(status?: string | null) {
  return String(status || "queued").replace(/[_-]+/g, " ");
}

function MetricButton({
  children,
  className = "",
  evidence,
  onOpenEvidence
}: {
  children: ReactNode;
  className?: string;
  evidence: "readiness" | "requirements" | "design" | "passRate" | "risks" | "automation";
  onOpenEvidence: AnalyticsMissionControlProps["onOpenEvidence"];
}) {
  const evidenceLabel = {
    readiness: "release posture",
    requirements: "Story coverage",
    design: "design completeness",
    passRate: "latest pass rate",
    risks: "open risks",
    automation: "automation"
  }[evidence];

  return (
    <article className={`qa-metric-card ${className}`.trim()}>
      <button
        aria-haspopup="dialog"
        aria-label={`View ${evidenceLabel} evidence`}
        className="qa-metric-card-open"
        onClick={() => onOpenEvidence(evidence)}
        type="button"
      />
      {children}
    </article>
  );
}

export function AnalyticsMissionControl({
  projectName,
  provisional,
  releaseScore,
  releaseHeadline,
  releaseNarrative,
  storyCoverage,
  mappedStories,
  totalStories,
  designCompleteness,
  executableCases,
  verifiedCases,
  runConfidence,
  latestPassRate,
  latestFailedSignals,
  openRiskCount,
  releaseBlockerCount,
  topRecommendation,
  actions,
  lanes,
  evidenceQueue,
  funnelMetrics,
  activity,
  passedSignals,
  unstableSignals,
  activeChecks,
  automationAvailable,
  automationCoverage,
  automatedCases,
  verifiedAutomationCases,
  automatedRuns,
  automatedPassRate,
  automatedResults,
  automationCandidates,
  hotspots,
  recentExecutions,
  sectionState,
  canCreateTestCases,
  canExplainSignals,
  isExplainingSignals,
  onExplainSignals,
  onOpenLayout,
  onOpenEvidence,
  onNavigate
}: AnalyticsMissionControlProps) {
  const [activeTab, setActiveTab] = useState("Docs");
  const [search, setSearch] = useState("");
  const { getMetricCriteria } = useAiPromptRegistry();
  const normalizedSearch = search.trim().toLowerCase();
  const metricMethodology = (criteriaKey: string, evidence: ReactNode, label?: string) => (
    <MetricMethodologyInfo
      criteriaKey={criteriaKey}
      evidence={evidence}
      label={label}
      organizationCriteria={getMetricCriteria(criteriaKey)}
    />
  );

  const filteredActions = useMemo(
    () => actions.filter((action) => matchesQuery(normalizedSearch, [action.meta, action.title, action.detail])),
    [actions, normalizedSearch]
  );
  const filteredLanes = useMemo(
    () => lanes.filter((lane) => matchesQuery(normalizedSearch, [lane.name, lane.projectName, lane.type, lane.label])),
    [lanes, normalizedSearch]
  );
  const filteredEvidence = useMemo(
    () => evidenceQueue.filter((item) => matchesQuery(normalizedSearch, [item.title, item.detail, item.label])),
    [evidenceQueue, normalizedSearch]
  );
  const filteredHotspots = useMemo(
    () => hotspots.filter((item) => matchesQuery(normalizedSearch, [item.title, item.detail, item.status])),
    [hotspots, normalizedSearch]
  );
  const filteredExecutions = useMemo(
    () => recentExecutions.filter((item) => matchesQuery(normalizedSearch, [item.name, item.projectName, item.appTypeName, automationAvailable ? item.trigger : null, item.status])),
    [automationAvailable, normalizedSearch, recentExecutions]
  );
  const matchingResultCount = filteredActions.length + filteredLanes.length + filteredEvidence.length + filteredHotspots.length + filteredExecutions.length;

  const sectionStyle = (id: AnalyticsMissionSectionId) => ({ order: sectionState[id].order } as CSSProperties);
  const shortActionDetail = (action: AnalyticsMissionAction) => {
    if (action.id === "coverage") return "Map missing stories to reusable cases.";
    if (action.id === "design") return "Curate release-ready suite structure.";
    if (action.id === "test-design") return "Add steps and expected results.";
    return action.detail;
  };

  return (
    <div className="qa-mission-canvas" data-testid="analytics-mission-control">
      <header className="qa-mission-header">
        <div className="qa-mission-search">
          <IconSearch aria-hidden="true" size={16} stroke={1.9} />
          <input
            aria-label="Search quality analytics"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search..."
            type="search"
            value={search}
          />
          <span aria-live="polite" className="qa-visually-hidden" role="status">
            {normalizedSearch ? `${matchingResultCount} matching analytics items` : ""}
          </span>
        </div>
        <nav aria-label="Project views" className="qa-mission-project-tabs">
          {projectTabs.map((tab) => (
            <button
              aria-current={activeTab === tab.label ? "page" : undefined}
              className={activeTab === tab.label ? "is-active" : ""}
              key={tab.label}
              onClick={() => {
                setActiveTab(tab.label);
                onNavigate(tab.to);
              }}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <button
          className="qa-mission-create"
          disabled={!canCreateTestCases}
          onClick={() => onNavigate("/test-cases?create=1")}
          title={canCreateTestCases ? "Create test case" : "Permission required: testcase.create"}
          type="button"
        >
          Create
        </button>

        <div className="qa-mission-title-block">
          <h1>Quality analytics</h1>
          <p>{projectName} - Evidence-led release posture, traceability, test design, execution confidence, and prioritized quality risk.</p>
        </div>
        <button className="qa-personalize" onClick={onOpenLayout} type="button">
          <IconEye aria-hidden="true" size={15} stroke={1.9} />
          <span>Personalize view</span>
        </button>
      </header>

      <div className="qa-mission-body">
        {provisional ? (
          <div className="qa-provisional-banner" role="status">
            <IconAlertTriangle aria-hidden="true" size={24} stroke={2} />
            <p>Portfolio metrics are provisional. HelloTest is using a bounded 100-record summary sample and excludes legacy cases with unknown step or execution-type metadata from percentage denominators. Open and save legacy cases to backfill their compact summary.</p>
          </div>
        ) : null}

        <div className="qa-mission-sections">
          {([
            { id: "decision" as const, content: sectionState.decision.visible ? (
            <section aria-label="Release posture" className="qa-mission-section qa-mission-section--full" key="decision" style={sectionStyle("decision")}>
              <div className="qa-kpi-grid">
                <MetricButton className="qa-release-card" evidence="readiness" onOpenEvidence={onOpenEvidence}>
                  <IconRosetteDiscountCheck aria-hidden="true" className="qa-release-watermark" size={70} stroke={2.8} />
                  <span className="qa-card-label qa-card-label-with-info">
                    <span>Release posture</span>
                    {metricMethodology(
                      "metric.analytics.release_posture",
                      `${storyCoverage}% Story coverage, ${designCompleteness}% design completeness, ${latestPassRate}% latest pass confidence, and ${latestFailedSignals} failed or blocked latest tests.`,
                      "How release posture is calculated"
                    )}
                  </span>
                  <div className="qa-release-score-row">
                    <span className="qa-release-score">{releaseScore}%</span>
                    <strong>{releaseHeadline}</strong>
                  </div>
                  <p>{releaseNarrative}</p>
                  <span className="qa-card-link">Why this value? <IconArrowRight aria-hidden="true" size={15} stroke={2} /></span>
                </MetricButton>

                <MetricButton evidence="requirements" onOpenEvidence={onOpenEvidence}>
                  <span className="qa-card-label qa-card-label-with-info">
                    <span>Story coverage</span>
                    {metricMethodology("metric.story.coverage", `${mappedStories} linked Stories ÷ ${totalStories} scoped Stories.`)}
                  </span>
                  <strong className="qa-card-value">{storyCoverage}%</strong>
                  <p>{mappedStories} / {totalStories} mapped</p>
                  <span className="qa-card-link">View mapping <IconArrowRight aria-hidden="true" size={15} stroke={2} /></span>
                </MetricButton>

                <MetricButton evidence="design" onOpenEvidence={onOpenEvidence}>
                  <span className="qa-card-label qa-card-label-with-info">
                    <span>Design completeness</span>
                    {metricMethodology("metric.test.design_completeness", `${executableCases} cases with steps ÷ ${verifiedCases} cases with a known step summary.`)}
                  </span>
                  <strong className="qa-card-value">{designCompleteness}%</strong>
                  <p>{executableCases} / {verifiedCases} verified cases with steps</p>
                  <span aria-hidden="true" className="qa-kpi-progress"><i style={{ width: `${Math.max(0, Math.min(100, designCompleteness))}%` }} /></span>
                  <span className="qa-card-link">Why this matters? <IconArrowRight aria-hidden="true" size={15} stroke={2} /></span>
                </MetricButton>

                <div className="qa-compact-kpi-stack">
                  <MetricButton className="qa-compact-kpi is-error" evidence="passRate" onOpenEvidence={onOpenEvidence}>
                    <span className="qa-card-label qa-card-label-with-info">
                      <span>Latest pass rate</span>
                      {metricMethodology("metric.analytics.latest_pass_confidence", `${latestFailedSignals} latest failed or blocked result${latestFailedSignals === 1 ? "" : "s"}; open the evidence card for the full current denominator.`)}
                    </span>
                    <strong className="qa-card-value">{latestPassRate}%</strong>
                    <p>{latestFailedSignals} failed or blocked test{latestFailedSignals === 1 ? "" : "s"}</p>
                  </MetricButton>
                  <MetricButton className="qa-compact-kpi is-warning" evidence="risks" onOpenEvidence={onOpenEvidence}>
                    <span className="qa-card-label qa-card-label-with-info">
                      <span>Open risks</span>
                      {metricMethodology("metric.analytics.open_risks", `${openRiskCount} action signals, including ${releaseBlockerCount} release blockers.`)}
                    </span>
                    <strong className="qa-card-value">{openRiskCount}</strong>
                    <p>{releaseBlockerCount} release blocker{releaseBlockerCount === 1 ? "" : "s"}</p>
                  </MetricButton>
                </div>
              </div>
            </section>
          ) : null },

            { id: "signals" as const, content: sectionState.signals.visible ? (
            <section aria-labelledby="qa-confidence-heading" className="qa-mission-section qa-mission-section--full" key="signals" style={sectionStyle("signals")}>
              <div className="qa-confidence-grid">
                <article className="qa-surface-card qa-confidence-card">
                  <header>
                    <h2 id="qa-confidence-heading">What changes confidence</h2>
                    <p>Traceability, test design, and execution evidence explain which intervention will improve the release signal.</p>
                  </header>
                  <div className="qa-confidence-content">
                    <div aria-label="Readiness score inputs" className="qa-confidence-flow" role="list">
                      <div className="qa-confidence-node" role="listitem"><strong>{storyCoverage}%</strong><span>Story Coverage {metricMethodology("metric.story.coverage", `${mappedStories} of ${totalStories} Stories are linked.`)}</span></div>
                      <div className="qa-confidence-node" role="listitem"><strong>{designCompleteness}%</strong><span>Design Completeness {metricMethodology("metric.test.design_completeness", `${executableCases} of ${verifiedCases} known designs contain steps.`)}</span></div>
                      <div className="qa-confidence-node is-emphasized" role="listitem"><strong>{runConfidence}%</strong><span>Run Confidence {metricMethodology("metric.analytics.latest_pass_confidence", "The current mission-control run input uses the latest visible result posture.")}</span></div>
                      <div aria-label={`Release readiness ${releaseScore}%`} className="qa-confidence-result" role="listitem"><strong>{releaseScore}%</strong>{metricMethodology("metric.analytics.release_posture", "Composite output of the three preceding evidence inputs and blocker penalty.")}</div>
                    </div>
                    <div className="qa-top-recommendation">
                      <div><strong>Top recommendation</strong><p>{topRecommendation}</p></div>
                      {canExplainSignals ? (
                        <button disabled={isExplainingSignals} onClick={onExplainSignals} type="button">
                          <IconBrain aria-hidden="true" size={16} stroke={1.8} />
                          <span>{isExplainingSignals ? "Reviewing…" : "Explain signals"}</span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>

                <article className="qa-surface-card qa-attention-card">
                  <header><h2>Attention Required</h2></header>
                  <div className="qa-attention-list">
                    {filteredActions.map((action) => (
                      <button key={action.id} onClick={() => onNavigate(action.to)} type="button">
                        <span className="qa-attention-meta">{action.meta}</span>
                        <strong>{action.title}</strong>
                        <p>{shortActionDetail(action)}</p>
                        <span className={`qa-status-label tone-${action.tone}`}>Open</span>
                        <IconArrowRight aria-hidden="true" className="qa-row-arrow" size={15} stroke={2} />
                      </button>
                    ))}
                    {!filteredActions.length ? <p aria-live="polite" className="qa-empty-copy" role="status">No matching actions require attention.</p> : null}
                  </div>
                </article>
              </div>
            </section>
          ) : null },

            { id: "delivery" as const, content: sectionState.delivery.visible ? (
            <section aria-label="Scope lanes and run evidence" className="qa-mission-section qa-mission-section--full" key="delivery" style={sectionStyle("delivery")}>
              <div className="qa-detail-grid">
                <article className="qa-surface-card qa-detail-card">
                  <header className="qa-panel-heading"><h2>Scope lanes and attention</h2><p>Compares product surfaces and prioritizes gaps.</p></header>
                  <div className="qa-lane-list">
                    {filteredLanes.map((lane) => {
                      const LaneIcon = laneIcon(lane.type);
                      return (
                        <div className="qa-lane-row" key={lane.id}>
                          <button
                            aria-label={`Open ${lane.name} scope lane`}
                            className="qa-row-open"
                            onClick={() => onNavigate(lane.destination)}
                            type="button"
                          />
                          <div className="qa-lane-copy">
                            <div className="qa-lane-title"><LaneIcon aria-hidden="true" size={16} stroke={1.8} /><strong>{lane.name}</strong></div>
                            <p>{lane.projectName} - {lane.type.toUpperCase()} surface</p>
                            <div className="qa-lane-tags"><span>{lane.cases} cases</span><span>{lane.suites} suites</span><span>{lane.executableCases} executable</span></div>
                          </div>
                          <div className="qa-lane-score">
                            <div><strong>{lane.releaseScore}%</strong>{metricMethodology("metric.analytics.scope_lane", `${lane.executableCases} executable of ${lane.cases} cases and ${lane.failedSignals} unstable latest signals in ${lane.name}.`)}<span className={`qa-status-label tone-${lane.tone}`}>{lane.label}</span></div>
                            <span aria-hidden="true" className="qa-lane-progress"><i style={{ width: `${Math.max(0, Math.min(100, lane.releaseScore))}%` }} /></span>
                            <small>{lane.failedSignals} unstable signal{lane.failedSignals === 1 ? "" : "s"}</small>
                          </div>
                        </div>
                      );
                    })}
                    {!filteredLanes.length ? <p aria-live="polite" className="qa-empty-copy" role="status">No product surfaces match this search.</p> : null}
                  </div>
                </article>

                <article className="qa-surface-card qa-detail-card">
                  <header className="qa-panel-heading"><h2>Run readiness &amp; evidence</h2><p>Latest run status requiring triage or execution.</p></header>
                  <div className="qa-evidence-list">
                    {filteredEvidence.slice(0, 6).map((item) => (
                      <button key={item.id} onClick={() => onNavigate(item.to)} type="button">
                        <div className="qa-evidence-title"><strong>{item.title}</strong><span>{item.label}</span></div>
                        <p>{item.detail}</p>
                        <span className={`qa-status-label tone-${item.tone}`}>{evidenceState(item)}</span>
                      </button>
                    ))}
                    {!filteredEvidence.length ? <p aria-live="polite" className="qa-empty-copy" role="status">No run or design evidence needs triage.</p> : null}
                  </div>
                </article>
              </div>
            </section>
          ) : null },

            { id: "flow" as const, content: sectionState.flow.visible ? (
            <section aria-label="Quality flow" className="qa-mission-section qa-mission-section--full" key="flow" style={sectionStyle("flow")}>
              <div className="qa-bottom-stats" role="group" aria-label="Quality flow metrics">
                {funnelMetrics.map((metric) => (
                  <article key={metric.id} title={metric.detail}>
                    <strong>{metric.value}</strong>
                    <span>{metric.label}</span>
                    <small className="qa-visually-hidden">{metric.detail}</small>
                  </article>
                ))}
              </div>
              <article className="qa-surface-card qa-momentum-card">
                <header className="qa-panel-heading"><h2>Run momentum</h2><p>Recent evidence volume and the current result posture.</p></header>
                <div className="qa-momentum-body">
                  <div aria-label="Six-month execution evidence activity" className="qa-activity-chart" role="list">
                    {activity.map((item) => (
                      <div aria-label={`${item.label}: ${item.total} execution signals`} className="qa-activity-month" key={item.key} role="listitem">
                        <div className="qa-activity-track"><i style={{ height: `${item.height}%` }} /></div>
                        <strong>{item.total}</strong><span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="qa-momentum-summary">
                    <div><strong>{passedSignals}</strong><span>Passed signals</span></div>
                    <div><strong>{unstableSignals}</strong><span>Unstable signals</span></div>
                    <div><strong>{activeChecks}</strong><span>Active checks</span></div>
                  </div>
                </div>
              </article>
            </section>
          ) : null },

            { id: "automation" as const, content: sectionState.automation.visible && automationAvailable ? (
            <section aria-labelledby="qa-automation-heading" className="qa-mission-section qa-mission-section--full" key="automation" style={sectionStyle("automation")}>
              <article className="qa-surface-card qa-automation-panel">
                <header className="qa-panel-heading"><h2 id="qa-automation-heading">Automation reach and reliability</h2><p>Operational leverage shown separately from release-readiness scoring.</p></header>
                <div className="qa-automation-grid">
                  <MetricButton evidence="automation" onOpenEvidence={onOpenEvidence}><span className="qa-card-label qa-card-label-with-info"><span>Case coverage</span>{metricMethodology("metric.automation.coverage", `${automatedCases} automated cases ÷ ${verifiedAutomationCases} cases with a verified automation state.`)}</span><strong className="qa-card-value">{automationCoverage}%</strong><p>{automatedCases} of {verifiedAutomationCases} verified cases marked automated</p></MetricButton>
                  <MetricButton evidence="automation" onOpenEvidence={onOpenEvidence}><span className="qa-card-label">Automated runs</span><strong className="qa-card-value">{automatedRuns}</strong><p>CI and local-agent executions</p></MetricButton>
                  <MetricButton evidence="automation" onOpenEvidence={onOpenEvidence}><span className="qa-card-label qa-card-label-with-info"><span>Automated pass rate</span>{metricMethodology("metric.analytics.latest_pass_confidence", `Passed latest automated results ÷ ${automatedResults} latest automated results.`)}</span><strong className="qa-card-value">{automatedPassRate}%</strong><p>{automatedResults} latest automated result{automatedResults === 1 ? "" : "s"}</p></MetricButton>
                  <MetricButton evidence="automation" onOpenEvidence={onOpenEvidence}><span className="qa-card-label">Candidate backlog</span><strong className="qa-card-value">{automationCandidates}</strong><p>Verified manual cases to prioritize</p></MetricButton>
                </div>
              </article>
            </section>
          ) : null },

            { id: "risk" as const, content: sectionState.risk.visible ? (
            <section aria-label="Reliability risk" className="qa-mission-section qa-mission-section--full" key="risk" style={sectionStyle("risk")}>
              <div className="qa-detail-grid qa-risk-grid">
                <article className="qa-surface-card qa-detail-card">
                  <header className="qa-panel-heading"><h2>Risk hotspots</h2><p>Cases creating repeated failed or blocked evidence.</p></header>
                  <div className="qa-risk-list">
                    {filteredHotspots.map((hotspot) => (
                      <button key={hotspot.id} onClick={() => onNavigate(`/executions?execution=${hotspot.executionId}`)} type="button">
                        <div><strong>{hotspot.title}</strong><p>{hotspot.detail}</p></div>
                        <span><b>{hotspot.count}</b><small>{hotspot.status}</small></span>
                      </button>
                    ))}
                    {!filteredHotspots.length ? <p aria-live="polite" className="qa-empty-copy" role="status">No unstable hotspots are dominating recent evidence.</p> : null}
                  </div>
                </article>
                <article className="qa-surface-card qa-detail-card">
                  <header className="qa-panel-heading"><h2>Recent release checks</h2><p>Latest run snapshots with pass rate and current status.</p></header>
                  <div className="qa-run-list">
                    {filteredExecutions.map((execution) => (
                      <div className="qa-run-row" key={execution.id}>
                        <button
                          aria-label={`Open ${execution.name || "unnamed run"} evidence`}
                          className="qa-row-open"
                          onClick={() => onNavigate(`/executions?execution=${execution.id}`)}
                          type="button"
                        />
                        <div><strong>{execution.name || "Unnamed run"}</strong><p>{execution.projectName} · {execution.appTypeName} · {(execution.trigger === "manual" || automationAvailable ? execution.trigger || "manual" : "run").toUpperCase()}</p></div>
                        <span className={`qa-run-score is-${runStatusLabel(execution.status).replace(/\s+/g, "-")}`}><strong>{execution.summary.percent}%</strong><small>{runStatusLabel(execution.status)}</small>{metricMethodology("metric.analytics.latest_pass_confidence", `${execution.summary.passed} passed of ${execution.summary.total} latest outcomes in this run.`)}</span>
                      </div>
                    ))}
                    {!filteredExecutions.length ? <p aria-live="polite" className="qa-empty-copy" role="status">No release checks are available yet.</p> : null}
                  </div>
                </article>
              </div>
            </section>
          ) : null }
          ]).sort((left, right) => sectionState[left.id].order - sectionState[right.id].order).map(({ content }) => content)}
        </div>
      </div>
    </div>
  );
}
