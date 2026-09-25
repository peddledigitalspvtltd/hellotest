import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBug,
  IconCheck,
  IconChevronDown,
  IconDownload,
  IconGitBranch,
  IconListCheck,
  IconRefresh,
  IconShieldCheck,
  IconSparkles,
  IconTestPipe,
  IconX,
} from "@tabler/icons-react";
import { useLocalization } from "@hellotest/platform/frontend/src/context/LocalizationContext";
import type {
  ReleaseReadinessModel,
  RequirementHotspot,
} from "../lib/releaseReadiness";
import type { ReadinessIndex } from "../lib/readinessIndex";

type EvidenceView = "review" | "stories" | "runs" | "cases" | "bugs";
type ControlTab = "review" | "stories" | "runs";
type Props = {
  model: ReleaseReadinessModel;
  readinessIndex: ReadinessIndex;
  projectName?: string;
  release: string;
  sprint: string;
  scopeOptions: { releases: Array<{value: string; label: string}>; sprints: Array<{value: string; label: string}> };
  releaseSelection: string;
  sprintSelection: string;
  canStories: boolean;
  canCases: boolean;
  canRuns: boolean;
  canBugs: boolean;
  canAi: boolean;
  aiPending: boolean;
  refreshing: boolean;
  text: (key: string, values?: Record<string, string | number>) => string;
  onScopeChange: (release: string, sprint: string) => void;
  onEvidence: (
    view: EvidenceView,
    filter?: string,
    context?: { story?: string; scroll?: boolean },
  ) => void;
  onInspectCheck: (id: string) => void;
  onExplain: () => void;
  onRefresh: () => void;
  onExport: () => void;
  sourceDetails: ReactNode;
  evidenceOpen: boolean;
  onCloseEvidence: () => void;
  children: ReactNode;
};

/** Reference page composition only. Evidence calculations remain in the existing model. */
export function ReleaseReadinessLayout(props: Props) {
  const {
    model,
    readinessIndex,
    projectName,
    release,
    sprint,
    scopeOptions,
    canStories,
    canCases,
    canRuns,
    canBugs,
    text,
    onEvidence,
  } = props;
  const { t, formatNumber, formatDate } = useLocalization();
  const copy = (
    key: string,
    fallback: string,
    values?: Record<string, string | number>,
  ) => t(`readiness.layout.${key}`, fallback, values);
  const n = (value: number) => formatNumber(value);
  const rate = (value: number | null, available = true) =>
    available && value !== null ? `${n(value)}%` : "—";
  const id = useId();
  const [tab, setTab] = useState<ControlTab>("review");
  const [traceKind, setTraceKind] = useState<"stories" | "runs">("stories");
  const [metric, setMetric] = useState<string | null>(null);
  const [gate, setGate] = useState<string | null>(null);
  const sourceRef = useRef<HTMLDetailsElement>(null);
  const tabs: ControlTab[] = ["review", "stories", "runs"];
  const provisional = readinessIndex.provisional;
  const sourcesAvailable = canStories && canCases && canRuns && canBugs;
  const metrics = model.metrics;
  const status =
    model.decisionState === "attention"
      ? copy("atRisk", "At risk")
      : text(
          `state.${provisional && model.decisionState === "clear" ? "review" : model.decisionState}`,
        );
  const rankedStories = canStories
    ? model.hotspots.filter((story) => story.needsAttention)
    : [];
  const leadingStory = rankedStories[0];
  const checkAvailable = (key: string) =>
    key === "critical-defects"
      ? canBugs
      : key === "priority-coverage"
        ? canStories && canCases
        : key === "remaining-evidence"
          ? canStories && canCases && canRuns
          : canRuns;
  const orderedGates = [
    "priority-coverage",
    "remaining-evidence",
    "failed-outcomes",
    "critical-defects",
    "blocked-evidence",
    "evidence-freshness",
  ].flatMap((key) => model.gates.filter((item) => item.id === key));
  const checksClear = orderedGates.filter(
    (item) => item.state === "pass" && checkAvailable(item.id),
  ).length;
  const gateTitles: Record<string, string> = {
    "priority-coverage": copy("priorityCoverage", "Priority story coverage"),
    "remaining-evidence": text("metric.assessed"),
    "failed-outcomes": copy("passGate", "Latest-result pass rate"),
    "critical-defects": copy("criticalExposure", "Critical defect exposure"),
    "blocked-evidence": copy("blockedEvidence", "Blocked test evidence"),
    "evidence-freshness": copy("freshness", "Evidence freshness"),
  };
  const gateStat = (key: string, count: number | null) => {
    if (!checkAvailable(key) || count === null) return "—";
    if (key === "remaining-evidence")
      return copy("completeRate", "{value} complete", {
        value: rate(metrics.completion),
      });
    if (key === "failed-outcomes")
      return copy("passedRate", "{value} passed", {
        value: rate(metrics.passRate),
      });
    if (key === "evidence-freshness") return text("days", { count: n(count) });
    if (key === "priority-coverage")
      return copy("uncovered", "{count} uncovered", { count: n(count) });
    if (key === "blocked-evidence") return text("blocked", { count: n(count) });
    return copy("openObserved", "{count} open observed", { count: n(count) });
  };
  const storyReason = (story: RequirementHotspot) =>
    [
      canCases && !story.coverageCount ? text("noTests") : "",
      canRuns && story.failedCount
        ? text("failed", { count: n(story.failedCount) })
        : "",
      canRuns && story.blockedCount
        ? text("blocked", { count: n(story.blockedCount) })
        : "",
      canCases && canRuns && story.coverageCount > story.executedCount
        ? text("remaining", {
            count: n(story.coverageCount - story.executedCount),
          })
        : "",
      canBugs && story.openBugCount
        ? `${n(story.openBugCount)} ${text("metric.defects")}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ") || text("source.unavailable");
  const storyRows = (items: RequirementHotspot[], short = false) =>
    items.length ? (
      <div className="rr-layout-queue">
        {items.map((story, index) => (
          <button
            type="button"
            key={story.id}
            onClick={() => onEvidence("stories", "all", { story: story.id })}
          >
            <span
              className={`rr-layout-risk-score ${story.criticalBugCount || story.failedCount || (canCases && !story.coverageCount && Number(story.priority || 3) <= 2) ? "is-danger" : ""}`}
              title={copy("rank", "Review priority rank {rank}", {
                rank: n(index + 1),
              })}
            >
              {n(index + 1)}
            </span>
            <span className="rr-layout-queue-copy">
              <strong>
                {story.displayId}
                {!short && ` · ${story.title}`}
              </strong>
              <small>{storyReason(story)}</small>
            </span>
            <IconArrowRight size={16} />
          </button>
        ))}
      </div>
    ) : (
      <div className="rr-empty">
        {text(canStories ? "noActions" : "source.unavailable")}
      </div>
    );
  const latestRun = [...model.executions].sort(
    (a, b) =>
      new Date(b.started_at || b.created_at || 0).getTime() -
      new Date(a.started_at || a.created_at || 0).getTime(),
  )[0];
  const aiButton = (label: string) => (
    <button
      className="rr-button"
      type="button"
      disabled={!props.canAi || props.aiPending}
      title={text("explainHelp")}
      onClick={props.onExplain}
    >
      <IconSparkles size={15} />
      {label}
    </button>
  );
  const primaryTabKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % 3
        : event.key === "ArrowLeft"
          ? (index + 2) % 3
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? 2
              : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(tabs[next]);
    document.getElementById(`${id}-control-${tabs[next]}`)?.focus();
  };
  const metricCards = [
    {
      key: "coverage",
      icon: IconGitBranch,
      label: text("metric.stories"),
      value: rate(metrics.coverage, canStories && canCases),
      suffix: copy("measured", "measured"),
      detail:
        canStories && canCases
          ? `${text("storiesDetail", { covered: n(metrics.coveredRequirementCount), total: n(metrics.requirementCount) })} · ${copy("priorityGaps", "{count} priority gaps", { count: n(metrics.highPriorityUncoveredCount) })}`
          : text("source.unavailable"),
      definition: "definition.coverage",
    },
    {
      key: "pass",
      icon: IconCheck,
      label: text("metric.outcomes"),
      value: rate(metrics.passRate, canRuns),
      suffix: copy("measured", "measured"),
      detail: canRuns
        ? `${copy("completeRate", "{value} complete", { value: rate(metrics.completion, canCases && canStories) })} · ${canCases && canStories ? text("remaining", { count: n(metrics.unassessedCaseCount) }) : text("source.unavailable")} · ${model.latestEvidenceAt ? formatDate(model.latestEvidenceAt) : text("noDate")}`
        : text("source.unavailable"),
      definition: "definition.passRate",
    },
    {
      key: "blocking",
      icon: IconAlertTriangle,
      label: text("metric.blockers"),
      value: sourcesAvailable
        ? n(
            metrics.openCriticalBugCount +
              metrics.blockedCount +
              metrics.highPriorityUncoveredCount,
          )
        : "—",
      suffix: copy("openForEvidence", "open for evidence"),
      detail: sourcesAvailable
        ? text("blockingDetail", {
            critical: n(metrics.openCriticalBugCount),
            blocked: n(metrics.blockedCount),
            gaps: n(metrics.highPriorityUncoveredCount),
          })
        : text("source.unavailable"),
      definition: "definition.blockers",
    },
  ];
  return (
    <>
      <header className="rr-layout-header">
        <div className="rr-layout-heading">
          <span className="rr-layout-eyebrow">
            <IconShieldCheck size={14} />
            {copy("decisionRoom", "Release decision room")}
          </span>
          <h1>{text("title")}</h1>
          <p>
            {[projectName, copy("scopedFilters", "scoped to the filters below")]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="rr-layout-actions">
          <select
            aria-label={text("release")}
            value={props.releaseSelection}
            onChange={(event) =>
              props.onScopeChange(event.target.value, "")
            }
          >
            <option value="">{text("allReleases")}</option>
            {scopeOptions.releases.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select
            aria-label={text("sprint")}
            value={props.sprintSelection}
            onChange={(event) =>
              props.onScopeChange("", event.target.value)
            }
          >
            <option value="">{text("allSprints")}</option>
            {scopeOptions.sprints.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button
            className="rr-button"
            type="button"
            onClick={() => onEvidence("stories", "uncovered")}
            disabled={!canStories || !canCases}
          >
            <IconGitBranch size={15} />
            {text("reviewGaps")}
          </button>
          <button
            className="rr-button"
            type="button"
            onClick={() => {
              setTab("runs");
              onEvidence("runs");
            }}
            disabled={!canRuns}
          >
            <IconTestPipe size={15} />
            {text("tab.runs")}
          </button>
          <button
            className="rr-button"
            type="button"
            onClick={() => onEvidence("bugs")}
            disabled={!canBugs}
          >
            <IconBug size={15} />
            {text("metric.defects")}
          </button>
        </div>
      </header>
      <section className="rr-layout-hero" aria-labelledby={`${id}-overall`}>
        <div
          className="rr-layout-gauge"
          aria-label={`${text("index.title")}: ${readinessIndex.score === null ? text("index.unavailable") : `${n(readinessIndex.score)} / 100`}`}
        >
          <svg
            width="132"
            height="132"
            viewBox="0 0 132 132"
            aria-hidden="true"
          >
            <circle
              cx="66"
              cy="66"
              r="56"
              fill="none"
              stroke="var(--rr-soft)"
              strokeWidth="10"
            />
            <circle
              cx="66"
              cy="66"
              r="56"
              fill="none"
              stroke="var(--rr-blue)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray="351.86"
              strokeDashoffset={
                351.86 * (1 - (readinessIndex.score || 0) / 100)
              }
              transform="rotate(-90 66 66)"
            />
          </svg>
          <div className="rr-layout-gauge-center">
            <strong>
              {readinessIndex.score === null ? "—" : n(readinessIndex.score)}
            </strong>
            <small>/ 100</small>
          </div>
        </div>
        <div className="rr-layout-hero-body">
          <div className="rr-layout-hero-top">
            <h2 id={`${id}-overall`}>{text("index.title")}</h2>
            <span
              className={`rr-badge ${provisional || model.decisionState !== "clear" ? "is-warning" : "is-neutral"}`}
            >
              {status}
              {provisional && ` · ${copy("provisional", "provisional")}`}
            </span>
          </div>
          <p className="rr-layout-hero-description">
            {text(
              `summary.${provisional && model.decisionState === "clear" ? "review" : model.decisionState}`,
            )}
          </p>
          <button
            type="button"
            className="rr-link-button rr-layout-recommendation"
            onClick={() => onEvidence("review")}
          >
            <IconArrowRight size={15} />
            {model.decisionState === "attention"
              ? copy(
                  "triage",
                  "Triage failed tests, link defects, and rerun affected coverage",
                )
              : copy(
                  "reviewEvidence",
                  "Review coverage and confirm the latest release evidence",
                )}
          </button>
          <div className="rr-layout-hero-meta">
            <div>
              <span>{copy("confidence", "Evidence confidence")}</span>
              <strong>{copy("notScored", "Not scored")}</strong>
              <small>
                {copy("humanOwned", "Human owned · scores guide attention")}
              </small>
            </div>
            <div>
              <span>{copy("measured", "Measured")}</span>
              <strong>{rate(readinessIndex.score)}</strong>
              <small>
                {provisional
                  ? copy("provisional", "Provisional")
                  : text("complete")}{" "}
                · {status}
              </small>
            </div>
          </div>
          <details className="rr-layout-method">
            <summary>
              <IconChevronDown size={14} />
              {copy("methodology", "Release readiness methodology")}
            </summary>
            <p>
              <strong>{copy("calculation", "Calculation:")}</strong>{" "}
              {text("index.help")}
            </p>
            <div className="rr-index-components">
              {readinessIndex.components.map((component) => (
                <div key={component.id}>
                  <span>{text(`index.${component.id}`)}</span>
                  <strong>{rate(component.value)}</strong>
                  <small>
                    {text("index.weight", { weight: n(component.weight) })}
                  </small>
                </div>
              ))}
            </div>
            <p>{text("index.containmentHelp")}</p>
            <p>{text("methodologyBody")}</p>
            <p>{text("index.capsHelp")}</p>
            {readinessIndex.caps.length > 0 && (
              <ul>
                {readinessIndex.caps.map((cap) => (
                  <li key={cap.id}>
                    {text("index.limit", {
                      maximum: n(cap.maximum),
                      reason: text(`index.cap.${cap.id}`),
                    })}
                  </li>
                ))}
              </ul>
            )}
            <p>{text("humanDecision")}</p>
          </details>
        </div>
      </section>
      <div className="rr-layout-tiles">
        {metricCards.map((card) => (
          <details
            className="rr-layout-tile"
            key={card.key}
            open={metric === card.key}
          >
            <summary
              className="rr-layout-tile-head"
              onClick={(event) => {
                event.preventDefault();
                setMetric(metric === card.key ? null : card.key);
              }}
            >
              <span className={`rr-layout-tile-icon is-${card.key}`}>
                <card.icon size={19} />
              </span>
              <span className="rr-layout-tile-main">
                <span>{card.label}</span>
                <strong>
                  {card.value}
                  <small>{card.suffix}</small>
                </strong>
              </span>
              <IconChevronDown size={16} />
            </summary>
            <div className="rr-layout-tile-detail">
              {card.detail}
              {card.key !== "blocking" && (
                <details className="rr-layout-method">
                  <summary>
                    <IconChevronDown size={13} />
                    {text("calculation")}
                  </summary>
                  <p>{text(card.definition)}</p>
                </details>
              )}
            </div>
          </details>
        ))}
      </div>
      <section className="rr-layout-center" aria-labelledby={`${id}-center`}>
        <div className="rr-layout-center-title">
          <h2 id={`${id}-center`}>
            {copy("controlCenter", "Release control center")}
          </h2>
          <p>
            {copy(
              "loadedRecords",
              "Evidence map · {count} records loaded in this scope",
              {
                count: n(
                  (canStories ? model.requirements.length : 0) +
                    (canCases ? model.testCases.length : 0) +
                    (canRuns ? model.executions.length : 0) +
                    (canBugs ? model.issues.length : 0),
                ),
              },
            )}
          </p>
        </div>
        <div
          className="rr-layout-tabs"
          role="tablist"
          aria-label={copy("controlCenter", "Release control center")}
        >
          {tabs.map((key, index) => (
            <button
              type="button"
              role="tab"
              key={key}
              id={`${id}-control-${key}`}
              aria-controls={`${id}-control-panel`}
              aria-selected={tab === key}
              tabIndex={tab === key ? 0 : -1}
              onKeyDown={(event) => primaryTabKey(event, index)}
              onClick={() => setTab(key)}
            >
              <strong>{text(`tab.${key}`)}</strong>
              <small>
                {key === "review"
                  ? copy("briefHint", "Gates and leading risks")
                  : key === "stories"
                    ? copy("traceHint", "Story-to-evidence matrix")
                    : copy("runsHint", "Runs and latest results")}
              </small>
            </button>
          ))}
        </div>
        <div
          className="rr-layout-tabpanel"
          role="tabpanel"
          id={`${id}-control-panel`}
          aria-labelledby={`${id}-control-${tab}`}
          tabIndex={0}
        >
          {tab === "review" && (
            <>
              <span className="rr-layout-eyebrow rr-layout-analysis">
                {copy("decisionAnalysis", "Decision analysis")} ·{" "}
                {provisional
                  ? copy("provisional", "Provisional")
                  : text("complete")}
              </span>
              <p className="rr-layout-controls">
                {text("checks")} ·{" "}
                {copy("gatesPassing", "{clear} of {total} gates passing", {
                  clear: n(checksClear),
                  total: n(orderedGates.length),
                })}
              </p>
              <div className="rr-layout-gates">
                {orderedGates.map((item, index) => (
                  <details
                    className="rr-layout-gate"
                    key={item.id}
                    open={gate === item.id}
                  >
                    <summary
                      onClick={(event) => {
                        event.preventDefault();
                        setGate(gate === item.id ? null : item.id);
                      }}
                    >
                      <span className="rr-layout-gate-number">
                        {n(index + 1)}
                      </span>
                      <strong>{gateTitles[item.id]}</strong>
                      <span className="rr-layout-gate-stat">
                        {gateStat(item.id, item.count)}
                      </span>
                      <IconChevronDown size={16} />
                    </summary>
                    <div className="rr-layout-gate-detail">
                      <p>
                        {checkAvailable(item.id)
                          ? text(`check.${item.state}`)
                          : text("source.unavailable")}
                      </p>
                      <div className="rr-progress" aria-hidden="true">
                        <span
                          style={{
                            width: `${!checkAvailable(item.id) ? 0 : item.id === "remaining-evidence" ? metrics.completion || 0 : item.id === "failed-outcomes" ? metrics.passRate || 0 : item.state === "pass" ? 100 : 0}%`,
                          }}
                        />
                      </div>
                      <p>{text(`checkHelp.${item.id}`)}</p>
                      {provisional && <p>{text("partialHelp")}</p>}
                      <button
                        className="rr-button"
                        type="button"
                        disabled={!checkAvailable(item.id)}
                        onClick={() => props.onInspectCheck(item.id)}
                      >
                        <IconArrowRight size={14} />
                        {copy("inspectGate", "Inspect gate evidence")}
                      </button>
                    </div>
                  </details>
                ))}
              </div>
              <section className="rr-layout-panel is-ai">
                <div className="rr-layout-panel-head">
                  <div>
                    <h3>
                      <IconSparkles size={18} />
                      {copy("assist", "Explainable assist")}
                    </h3>
                    <p>
                      {copy(
                        "assistHelp",
                        "Summarize release-scoped delivery evidence with cited records and human-owned actions.",
                      )}
                    </p>
                  </div>
                  {aiButton(copy("openBrief", "Open evidence brief"))}
                </div>
              </section>
              <section className="rr-layout-panel is-risk">
                <div className="rr-layout-panel-head">
                  <div>
                    <h3>{copy("riskInspector", "Risk inspector")}</h3>
                    <p>
                      {copy("riskHelp", "Story-level release risk, ranked")}
                    </p>
                  </div>
                </div>
                <div className="rr-layout-panel-body">
                  {leadingStory ? (
                    <div className="rr-layout-risk-card">
                      <div className="rr-layout-hero-top">
                        <h3>
                          {leadingStory.displayId} · {leadingStory.title}
                        </h3>
                        <span className="rr-badge is-warning">
                          {copy("rank", "Review priority rank {rank}", {
                            rank: n(1),
                          })}
                        </span>
                      </div>
                      <p>{storyReason(leadingStory)}</p>
                      <div className="rr-layout-risk-metrics">
                        <div>
                          <strong>
                            {canCases ? n(leadingStory.coverageCount) : "—"}
                          </strong>
                          <span>{text("coverageColumn")}</span>
                        </div>
                        <div>
                          <strong>
                            {canRuns
                              ? n(
                                  leadingStory.failedCount +
                                    leadingStory.blockedCount,
                                )
                              : "—"}
                          </strong>
                          <span>{text("failedBlocked")}</span>
                        </div>
                        <div>
                          <strong>
                            {canBugs ? n(leadingStory.openBugCount) : "—"}
                          </strong>
                          <span>{text("metric.defects")}</span>
                        </div>
                      </div>
                      <button
                        className="rr-button"
                        type="button"
                        onClick={() =>
                          onEvidence("stories", "all", {
                            story: leadingStory.id,
                          })
                        }
                      >
                        <IconArrowRight size={14} />
                        {copy("storyEvidence", "Open Story evidence")}
                      </button>
                    </div>
                  ) : (
                    <div className="rr-empty">
                      {text(canStories ? "noActions" : "source.unavailable")}
                    </div>
                  )}
                </div>
              </section>
              <section className="rr-layout-panel is-next">
                <div className="rr-layout-panel-head">
                  <div>
                    <h3>{copy("nextActions", "Next review actions")}</h3>
                    <p>
                      {copy(
                        "actionsHelp",
                        "Deterministic actions queued for a human reviewer",
                      )}
                    </p>
                  </div>
                  {aiButton(copy("openAiBrief", "Open AI evidence brief"))}
                </div>
                <div className="rr-layout-panel-body">
                  {storyRows(rankedStories.slice(0, 3), true)}
                </div>
              </section>
              <p className="rr-layout-ownership">
                {copy("ownership", "Decision ownership")} —{" "}
                <strong>{text("humanDecision")}</strong>.{" "}
                {copy(
                  "scoresGuide",
                  "Scores guide attention; people own the decision.",
                )}
              </p>
            </>
          )}
          {tab === "stories" && (
            <>
              <div className="rr-layout-trace-head">
                <p>
                  {copy(
                    "queueHelp",
                    "Priority evidence queue — ranked by coverage gaps, latest failures, blockers, and open linked Defects",
                  )}
                </p>
                <div className="rr-layout-segment">
                  <button
                    type="button"
                    aria-pressed={traceKind === "stories"}
                    onClick={() => setTraceKind("stories")}
                  >
                    {text("source.stories")}
                  </button>
                  <button
                    type="button"
                    aria-pressed={traceKind === "runs"}
                    onClick={() => setTraceKind("runs")}
                  >
                    {text("source.runs")}
                  </button>
                </div>
              </div>
              <div className="rr-layout-funnel">
                {[
                  {
                    key: "stories",
                    count: metrics.requirementCount,
                    icon: IconGitBranch,
                    target: "stories",
                    filter: "all",
                    available: canStories,
                  },
                  {
                    key: "covered",
                    count: metrics.coveredRequirementCount,
                    icon: IconCheck,
                    target: "stories",
                    filter: "covered",
                    available: canStories && canCases,
                  },
                  {
                    key: "scoped",
                    count: metrics.plannedCaseCount,
                    icon: IconTestPipe,
                    target: "cases",
                    filter: "all",
                    available: canCases,
                  },
                  {
                    key: "executed",
                    count: metrics.executedCaseCount,
                    icon: IconListCheck,
                    target: "cases",
                    filter: "executed",
                    available: canRuns && canCases,
                  },
                  {
                    key: "passing",
                    count: metrics.passingCaseCount,
                    icon: IconCheck,
                    target: "cases",
                    filter: "passed",
                    available: canRuns && canCases,
                  },
                  {
                    key: "bugs",
                    count: metrics.openBugCount,
                    icon: IconBug,
                    target: "bugs",
                    filter: "all",
                    available: canBugs,
                  },
                ].map((step) => (
                  <button
                    type="button"
                    key={step.key}
                    disabled={!step.available}
                    onClick={() =>
                      onEvidence(step.target as EvidenceView, step.filter)
                    }
                  >
                    <step.icon size={18} />
                    <strong>{step.available ? n(step.count) : "—"}</strong>
                    <span>{text(`map.${step.key}`)}</span>
                    <small>
                      {step.key === "covered"
                        ? copy("mappedRate", "{value} mapped", {
                            value: rate(metrics.coverage, step.available),
                          })
                        : step.key === "executed"
                          ? copy("completeRate", "{value} complete", {
                              value: rate(
                                metrics.completion,
                                step.available && canStories,
                              ),
                            })
                          : step.key === "passing"
                            ? copy("resultPassRate", "{value} result pass rate", {
                                value: rate(metrics.passRate, step.available),
                              })
                            : step.key === "bugs"
                              ? copy("criticalCount", "{count} critical", {
                                  count: step.available
                                    ? n(metrics.openCriticalBugCount)
                                    : "—",
                                })
                              : text(`mapDetail.${step.key}`)}
                    </small>
                  </button>
                ))}
              </div>
              <span className="rr-layout-eyebrow">
                {copy("priorityQueue", "Priority queue")}
              </span>
              <div className="rr-layout-queue-heading">
                <h3>
                  {traceKind === "stories"
                    ? copy("storiesAttention", "Stories needing attention")
                    : text("tab.runs")}
                </h3>
                <button
                  className="rr-link-button"
                  type="button"
                  onClick={() => onEvidence(traceKind)}
                >
                  {copy("fullMatrix", "View full matrix")}
                  <IconArrowRight size={14} />
                </button>
              </div>
              {traceKind === "stories" ? (
                storyRows(rankedStories)
              ) : canRuns && model.executions.length ? (
                <div className="rr-layout-queue">
                  {model.executions.map((run, index) => (
                    <button
                      type="button"
                      key={run.id}
                      onClick={() => onEvidence("runs")}
                    >
                      <span className="rr-layout-risk-score">
                        {n(index + 1)}
                      </span>
                      <span className="rr-layout-queue-copy">
                        <strong>{run.name || text("runName")}</strong>
                        <small>
                          {[
                            run.test_environment?.name,
                            run.test_configuration?.name,
                            run.build,
                          ]
                            .filter(Boolean)
                            .join(" · ") || text("notRecorded")}
                        </small>
                      </span>
                      <IconArrowRight size={16} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rr-empty">
                  {text(canRuns ? "noRuns" : "source.unavailable")}
                </div>
              )}
            </>
          )}
          {tab === "runs" && (
            <div className="rr-layout-context">
              <article>
                <h3>{copy("connectedScope", "Connected release scope")}</h3>
                <strong>
                  {release || text("allReleases")} ·{" "}
                  {sprint || text("allSprints")}
                </strong>
                <p>
                  {canStories
                    ? text("storiesDone", {
                        done: n(metrics.completedRequirementCount),
                        total: n(metrics.requirementCount),
                      })
                    : text("source.unavailable")}{" "}
                  ·{" "}
                  {copy(
                    "scopeAuthority",
                    "Fix Version and Sprint are authoritative.",
                  )}
                </p>
              </article>
              <article>
                <h3>{text("latestRun")}</h3>
                <strong>
                  {canRuns
                    ? latestRun
                      ? [
                          latestRun.test_environment?.name ||
                            text("notRecorded"),
                          latestRun.test_configuration?.name,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : text("noRuns")
                    : text("source.unavailable")}
                </strong>
                <p>
                  {text("build")}:{" "}
                  {canRuns ? latestRun?.build || text("notRecorded") : "—"}
                  {canRuns && latestRun?.test_data_set?.name
                    ? ` · ${text("dataSet")}: ${latestRun.test_data_set.name}`
                    : ""}
                </p>
              </article>
              <article>
                <h3>{copy("snapshot", "Evidence snapshot")}</h3>
                <strong>
                  {canRuns && model.latestEvidenceAt
                    ? formatDate(model.latestEvidenceAt)
                    : text("noDate")}
                </strong>
                <p>
                  {copy("gatesPassing", "{clear} of {total} gates passing", {
                    clear: n(checksClear),
                    total: n(orderedGates.length),
                  })}{" "}
                  ·{" "}
                  {canCases
                    ? text("caseDetailsKnown", {
                        known: n(metrics.designKnownCount),
                        total: n(metrics.plannedCaseCount),
                      })
                    : text("source.unavailable")}{" "}
                  ·{" "}
                  {copy("reviewAlerts", "{count} control review alerts", {
                    count: n(orderedGates.length - checksClear),
                  })}
                </p>
              </article>
            </div>
          )}
        </div>
      </section>
      <footer className="rr-layout-footer">
        <div>
          <span>
            {provisional
              ? copy("provisionalEvidence", "Provisional delivery evidence")
              : copy("deliveryEvidence", "Delivery evidence")}
          </span>
          <strong>
            {copy(
              "evidenceTotals",
              "{stories} Stories · {cases} cases · {runs} runs · {defects} open Defects",
              {
                stories: canStories ? n(metrics.requirementCount) : "—",
                cases: canCases ? n(metrics.plannedCaseCount) : "—",
                runs: canRuns ? n(model.executions.length) : "—",
                bugs: canBugs ? n(metrics.openBugCount) : "—",
              },
            )}
          </strong>
        </div>
        <button
          className="rr-link-button"
          type="button"
          onClick={() => {
            if (sourceRef.current) {
              sourceRef.current.open = true;
              sourceRef.current.scrollIntoView({ block: "nearest" });
              sourceRef.current.querySelector("summary")?.focus();
            }
          }}
        >
          {copy(
            "reviewSources",
            "Review scope, permissions, and source notices",
          )}
          <IconArrowRight size={15} />
        </button>
      </footer>
      <details className="rr-layout-source-details" ref={sourceRef}>
        <summary>
          {text("sources")}
          <IconChevronDown size={15} />
        </summary>
        {props.sourceDetails}
        <div className="rr-layout-actions">
          <button
            className="rr-button"
            type="button"
            disabled={props.refreshing}
            onClick={props.onRefresh}
          >
            <IconRefresh size={15} />
            {text(props.refreshing ? "refreshing" : "refresh")}
          </button>
          <button className="rr-button" type="button" onClick={props.onExport}>
            <IconDownload size={15} />
            {text("export")}
          </button>
        </div>
      </details>
      {props.evidenceOpen && (
        <section className="rr-layout-drilldown">
          <div className="rr-layout-queue-heading">
            <h2>{text("evidenceTitle")}</h2>
            <button
              className="rr-button"
              type="button"
              onClick={props.onCloseEvidence}
            >
              <IconX size={15} />
              {copy("closeEvidence", "Close evidence")}
            </button>
          </div>
          {props.children}
        </section>
      )}
    </>
  );
}
