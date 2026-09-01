import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBug,
  IconChartBar,
  IconCheck,
  IconChevronRight,
  IconCircleCheck,
  IconClock,
  IconExternalLink,
  IconFileAnalytics,
  IconFlag,
  IconGitBranch,
  IconListCheck,
  IconRefresh,
  IconRoute,
  IconShieldCheck,
  IconSparkles,
  IconTargetArrow,
  IconTestPipe
} from "@tabler/icons-react";
import { useAuth } from "../auth/AuthContext";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { useAiPromptRegistry } from "../hooks/useAiPromptRegistry";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import { api } from "../lib/api";
import { asArray } from "../lib/collectionGuards";
import { areFeatureFlagsEnabled } from "../lib/featureFlags";
import { hasPermission } from "../lib/permissions";
import {
  deriveReleaseReadiness,
  releaseReadinessScopeOptions,
  type ReadinessGateState
} from "../lib/releaseReadiness";
import type { ExecutionResult } from "../types";
import { AiInsightPreviewDialog, type AiPreviewFinding } from "./AiInsightPreviewDialog";
import { EvidenceFlipCard } from "./EvidenceFlipCard";
import { ReleaseReadinessIcon } from "./AppIcons";
import { LoadingState } from "./LoadingState";
import { MetricMethodologyInfo } from "./MetricMethodologyInfo";
import { ProgressMeter } from "./ProgressMeter";
import { StatusBadge } from "./StatusBadge";
import "./ReleaseReadinessDashboard.css";

type ReadinessView = "brief" | "traceability" | "execution";

const dateTimeFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const latestResultMap = (results: ExecutionResult[]) => {
  const latest = new Map<string, ExecutionResult>();
  results.forEach((result) => {
    const key = `${result.execution_id}:${result.test_case_id}`;
    const current = latest.get(key);
    const currentTimestamp = current?.updated_at || current?.created_at;
    const nextTimestamp = result.updated_at || result.created_at;
    const currentTime = currentTimestamp ? new Date(currentTimestamp).getTime() || 0 : 0;
    const nextTime = nextTimestamp ? new Date(nextTimestamp).getTime() || 0 : 0;
    const isNewer = nextTime > currentTime
      || (nextTime === currentTime && String(result.id).localeCompare(String(current?.id || "")) > 0);
    if (!current || isNewer) latest.set(key, result);
  });
  return latest;
};

function GateIcon({ state }: { state: ReadinessGateState }) {
  return (
    <span aria-hidden="true" className={`readiness-gate-icon is-${state}`}>
      {state === "pass"
        ? <IconCheck size={15} stroke={2.4} />
        : state === "block"
          ? <IconAlertTriangle size={15} stroke={2.2} />
          : <IconClock size={15} stroke={2.1} />}
    </span>
  );
}

function ScopeSelect({
  label,
  value,
  options,
  emptyLabel,
  onChange,
  disabled = false
}: {
  label: string;
  value: string;
  options: string[];
  emptyLabel: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="readiness-scope-field">
      <span>{label}</span>
      <select disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">{emptyLabel}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
  progress,
  methodology
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "blue" | "green" | "amber" | "red";
  progress?: number;
  methodology?: ReactNode;
}) {
  const mappedTone = tone === "green" ? "success" : tone === "amber" ? "warning" : tone === "red" ? "danger" : "info";
  return (
    <EvidenceFlipCard
      caption={typeof progress === "number" ? `${Math.max(0, Math.min(100, Math.round(progress)))}% measured` : "Open for evidence"}
      className={`readiness-metric-flip-card is-${tone}`}
      evidence={[detail, methodology].filter(Boolean) as ReactNode[]}
      frontIcon={icon}
      label={label}
      maxEvidenceItems={3}
      tone={mappedTone}
      value={value}
    />
  );
}

export function ReleaseReadinessDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { session } = useAuth();
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const [projectId] = useCurrentProject();
  const requestedReleaseId = searchParams.get("release_id") || "";
  const requestedRelease = searchParams.get("release") || "";
  const requestedSprint = searchParams.get("sprint") || "";
  const [release, setRelease] = useState(requestedRelease);
  const [sprint, setSprint] = useState(requestedSprint);
  const [activeView, setActiveView] = useState<ReadinessView>("brief");
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedGateId, setSelectedGateId] = useState("");
  const [selectedHotspotId, setSelectedHotspotId] = useState("");
  const [selectedExecutionId, setSelectedExecutionId] = useState("");
  const { getMetricCriteria } = useAiPromptRegistry();
  const canViewProjects = hasPermission(session, "project.view", projectId);
  const canViewStories = hasPermission(session, "requirement.view", projectId);
  const canViewCases = hasPermission(session, "testcase.view", projectId);
  const canViewRuns = hasPermission(session, "run.view", projectId);
  const canViewResults = hasPermission(session, "result.view", projectId);
  const canViewBugs = hasPermission(session, "feedback.view", projectId);
  const unavailableEvidenceSources = [
    !canViewStories ? "Stories" : "",
    !canViewCases ? "Test Cases" : "",
    !canViewRuns ? "Runs" : "",
    !canViewResults ? "Results" : "",
    !canViewBugs ? "Bugs" : ""
  ].filter(Boolean);
  const workspace = useWorkspaceData({
    users: false,
    roles: false,
    projects: canViewProjects,
    projectMembers: false,
    appTypes: false,
    testSuites: false,
    requirements: false,
    testCases: false,
    executions: false,
    executionResults: false,
    issues: false
  });
  const projects = asArray(workspace.projects.data);
  const activeProjectId = String(projectId || projects[0]?.id || "");
  const selectedProject = projects.find((project) => String(project.id) === activeProjectId) || null;
  const releaseContextQuery = useQuery({
    queryKey: ["release-readiness-context", requestedReleaseId],
    queryFn: () => api.requirementReleases.get(requestedReleaseId),
    enabled: Boolean(requestedReleaseId),
    staleTime: 30_000
  });
  const releaseContext = releaseContextQuery.data && String(releaseContextQuery.data.project_id) === activeProjectId
    ? releaseContextQuery.data
    : null;
  const deepLinkedRelease = releaseContext?.fix_version || requestedRelease;
  const isReleaseScopeLocked = Boolean(requestedReleaseId && releaseContext);
  const requirementsPageQuery = useQuery({
    queryKey: ["release-readiness-stories", activeProjectId],
    queryFn: () => api.requirements.listPage({
      project_id: activeProjectId,
      page_size: 100,
      projection: "summary"
    }),
    enabled: Boolean(activeProjectId && canViewStories),
    staleTime: 30_000
  });
  const testCasesPageQuery = useQuery({
    queryKey: ["release-readiness-test-cases", activeProjectId],
    queryFn: () => api.testCases.listPage({
      page_size: 100,
      projection: "summary"
    }),
    enabled: Boolean(activeProjectId && canViewCases),
    staleTime: 30_000
  });
  const issuesPageQuery = useQuery({
    queryKey: ["release-readiness-bugs", activeProjectId],
    queryFn: () => api.issues.listPage({
      project_id: activeProjectId,
      page_size: 100,
      projection: "detail"
    }),
    enabled: Boolean(activeProjectId && canViewBugs),
    staleTime: 30_000
  });
  const executionEvidenceQuery = useQuery({
    queryKey: ["release-readiness-execution-evidence", activeProjectId, release, sprint],
    queryFn: () => api.executionResults.releaseReadiness({
      project_id: activeProjectId,
      ...(release ? { release } : {}),
      ...(sprint ? { sprint } : {}),
      run_limit: 10,
      result_limit: 300
    }),
    enabled: Boolean(
      activeProjectId
      && canViewRuns
      && canViewResults
      && (!requestedReleaseId || releaseContext || releaseContextQuery.isError)
    ),
    staleTime: 30_000
  });
  useEffect(() => {
    setRelease(deepLinkedRelease);
    setSprint(requestedSprint);
    setSelectedGateId("");
    setSelectedHotspotId("");
    setSelectedExecutionId("");
    setIsAiOpen(false);
  }, [activeProjectId, deepLinkedRelease, requestedSprint]);
  const requirements = useMemo(
    () => (requirementsPageQuery.data?.items || []).filter((requirement) => String(requirement.project_id) === activeProjectId),
    [activeProjectId, requirementsPageQuery.data?.items]
  );
  const readinessRequirements = useMemo(() => {
    if (!releaseContext) return requirements;
    return asArray(releaseContext.requirements).map((requirement) => ({
      ...requirement,
      fix_version: releaseContext.fix_version,
      release: releaseContext.name
    }));
  }, [releaseContext, requirements]);
  const executions = useMemo(
    () => (executionEvidenceQuery.data?.executions || []).filter((execution) => String(execution.project_id) === activeProjectId),
    [activeProjectId, executionEvidenceQuery.data?.executions]
  );
  const executionIds = useMemo(() => new Set(executions.map((execution) => execution.id)), [executions]);
  const results = useMemo(
    () => (executionEvidenceQuery.data?.results || []).filter((result) => executionIds.has(result.execution_id)),
    [executionEvidenceQuery.data?.results, executionIds]
  );
  const testCases = testCasesPageQuery.data?.items || [];
  const issues = issuesPageQuery.data?.items || [];
  const ambiguousSprintNames = (() => {
    const idsByName = new Map<string, Set<string>>();
    requirements.forEach((requirement) => {
      const name = String(requirement.sprint || "").trim();
      const id = String(requirement.sprint_id || "").trim();
      if (!name || !id) return;
      const key = name.toLowerCase();
      const ids = idsByName.get(key) || new Set<string>();
      ids.add(id);
      idsByName.set(key, ids);
    });
    return [...idsByName.entries()].filter(([, ids]) => ids.size > 1).map(([name]) => name);
  })();
  const incompleteEvidenceSources = [
    !releaseContext && requirementsPageQuery.data?.is_last === false ? `Stories are paged (${requirements.length} of ${requirementsPageQuery.data.total} loaded)` : "",
    testCasesPageQuery.data?.is_last === false ? `Test Cases are paged (${testCases.length} of ${testCasesPageQuery.data.total} loaded)` : "",
    issuesPageQuery.data?.is_last === false ? `Bugs are paged (${issues.length} of ${issuesPageQuery.data.total} loaded)` : "",
    executionEvidenceQuery.data?.complete === false
      ? `run evidence is bounded (${executionEvidenceQuery.data.reasons.join(", ").replace(/_/g, " ") || "scan limit"})`
      : "",
    issues.some((issue) => issue.traceability_truncated === true) ? "Bug traceability is truncated" : "",
    testCases.some((testCase) => testCase.detail_complete === false && testCase.summary_complete !== true)
      ? "legacy Test Case summary metadata is unknown"
      : "",
    ambiguousSprintNames.length
      ? `duplicate Sprint names require Fix Version disambiguation (${ambiguousSprintNames.join(", ")})`
      : "",
    executions.some((execution) => Number(execution.scope_case_count || 0) > new Set([
      ...(execution.test_case_ids || []),
      ...(execution.direct_test_case_ids || []),
      ...(execution.case_snapshots || []).map((item) => item.test_case_id)
    ]).size) ? "one or more run scopes are only partially projected" : ""
  ].filter(Boolean);
  const evidenceScopeIncomplete = incompleteEvidenceSources.length > 0;
  const evidenceLoadFailed = (canViewStories && requirementsPageQuery.isError)
    || (canViewCases && testCasesPageQuery.isError)
    || (canViewBugs && issuesPageQuery.isError)
    || (canViewRuns && canViewResults && executionEvidenceQuery.isError);
  const scopeIsExplicit = Boolean(release || sprint);
  const evidenceIsProvisional = evidenceScopeIncomplete
    || evidenceLoadFailed
    || unavailableEvidenceSources.length > 0
    || !scopeIsExplicit;
  const scopeOptions = useMemo(
    () => {
      const options = releaseReadinessScopeOptions(readinessRequirements, executions, issues);
      return releaseContext && !options.releases.includes(releaseContext.fix_version)
        ? { ...options, releases: [releaseContext.fix_version, ...options.releases] }
        : options;
    },
    [executions, issues, readinessRequirements, releaseContext]
  );
  const sprintOptions = useMemo(() => {
    if (!release) return scopeOptions.sprints;
    const matchesRelease = (value: string | null | undefined) => String(value || "").trim().toLowerCase() === release.trim().toLowerCase();
    return releaseReadinessScopeOptions(
      readinessRequirements.filter((requirement) => matchesRelease(requirement.fix_version || requirement.release)),
      executions.filter((execution) => matchesRelease(execution.release)),
      issues.filter((issue) => matchesRelease(issue.fix_version || issue.release))
    ).sprints;
  }, [executions, issues, readinessRequirements, release, scopeOptions.sprints]);
  const model = useMemo(() => deriveReleaseReadiness({
    release,
    sprint,
    requirements: readinessRequirements,
    testCases,
    executions,
    executionResults: results,
    issues,
    evidenceComplete: !evidenceIsProvisional
  }), [evidenceIsProvisional, executions, issues, readinessRequirements, release, results, sprint, testCases]);
  const canUseAi = hasPermission(session, "quality_insight.view", projectId)
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.quality_insights"]);
  const qualityInsightPreview = useMutation({
    mutationFn: ({ activeProject, activeRelease }: { activeProject: string; activeRelease: string }) => api.ai.qualityInsights({
      project_id: activeProject,
      ...(activeRelease ? { release: activeRelease } : {})
    })
  });
  const aiFindings = useMemo<AiPreviewFinding[]>(() => (qualityInsightPreview.data?.insights || []).map((insight) => ({
    id: insight.id,
    title: insight.title,
    severity: insight.severity,
    description: insight.explanation,
    action: insight.recommended_action,
    meta: `${insight.evidence.length} linked work item${insight.evidence.length === 1 ? "" : "s"}`,
    evidence: insight.evidence.map((item) => item.display_id || item.id).filter(Boolean)
  })), [qualityInsightPreview.data]);
  const runResultMap = useMemo(() => latestResultMap(model.executionResults), [model.executionResults]);
  const executionSummaries = useMemo(() => model.executions
    .map((execution) => {
      const executionResults = [...runResultMap.values()].filter((result) => result.execution_id === execution.id);
      return {
        execution,
        total: executionResults.length,
        passed: executionResults.filter((result) => result.status === "passed").length,
        failed: executionResults.filter((result) => result.status === "failed").length,
        blocked: executionResults.filter((result) => result.status === "blocked").length,
        running: executionResults.filter((result) => result.status === "running").length
      };
    })
    .sort((left, right) => {
      const leftTime = new Date(left.execution.ended_at || left.execution.started_at || left.execution.created_at || 0).getTime() || 0;
      const rightTime = new Date(right.execution.ended_at || right.execution.started_at || right.execution.created_at || 0).getTime() || 0;
      return rightTime - leftTime;
    }), [model.executions, runResultMap]);
  const selectedGate = model.gates.find((gate) => gate.id === selectedGateId)
    || model.gates.find((gate) => gate.state === "block")
    || model.gates.find((gate) => gate.state === "warning")
    || model.gates[0]
    || null;
  const selectedHotspot = model.hotspots.find((hotspot) => hotspot.id === selectedHotspotId)
    || model.hotspots[0]
    || null;
  const selectedExecutionSummary = executionSummaries.find(({ execution }) => execution.id === selectedExecutionId)
    || executionSummaries[0]
    || null;
  const actionableHotspots = model.hotspots.filter((hotspot) => !hotspot.reasons.includes("No dominant deterministic risk"));
  const completedStoryCount = model.requirements.filter((requirement) => (
    String(requirement.status_category || "").trim().toLowerCase() === "done"
    || /^(done|closed|resolved)(\b|$)/i.test(String(requirement.status || "").trim())
  )).length;
  const knownCaseDesignCount = model.testCases.filter((testCase) => Number.isFinite(testCase.step_count)).length;
  const reviewAttentionCount = model.testCases.filter((testCase) => (
    testCase.review_status === "pending" || testCase.review_status === "changes_requested"
  )).length;
  const loading = Boolean(requestedReleaseId && releaseContextQuery.isPending)
    || (canViewStories && requirementsPageQuery.isPending)
    || (canViewCases && testCasesPageQuery.isPending)
    || (canViewBugs && issuesPageQuery.isPending)
    || (canViewRuns && canViewResults && executionEvidenceQuery.isPending);
  const scopeLabel = [release || "All releases", sprint || "All sprints"].join(" · ");
  const passingGateCount = model.gates.filter((gate) => gate.state === "pass").length;
  const blockingSignalCount = model.metrics.openCriticalBugCount
    + model.metrics.blockedCount
    + model.metrics.highPriorityUncoveredCount;
  const latestEvidenceLabel = model.latestEvidenceAt
    ? dateTimeFormatter.format(new Date(model.latestEvidenceAt))
    : "No dated result";
  const latestScopedExecution = executionSummaries[0]?.execution || null;
  const latestRunEnvironment = latestScopedExecution?.test_environment?.name || "Not recorded";
  const latestRunConfiguration = latestScopedExecution?.test_configuration?.name || "Not recorded";
  const latestRunDataSet = latestScopedExecution?.test_data_set?.name || "Not recorded";
  const evidenceFooterState = evidenceLoadFailed
    ? "error"
    : evidenceIsProvisional
      ? "provisional"
      : "current";
  const metricMethodology = (criteriaKey: string, evidence: ReactNode, label?: string, trigger: "button" | "span" = "button") => (
    <MetricMethodologyInfo
      criteriaKey={criteriaKey}
      evidence={evidence}
      label={label}
      organizationCriteria={getMetricCriteria(criteriaKey)}
      trigger={trigger}
    />
  );

  const openAiBrief = () => {
    setIsAiOpen(true);
    qualityInsightPreview.reset();
    if (activeProjectId) qualityInsightPreview.mutate({ activeProject: activeProjectId, activeRelease: release });
  };

  const refreshEvidence = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        ...(canViewStories ? [requirementsPageQuery.refetch()] : []),
        ...(canViewCases ? [testCasesPageQuery.refetch()] : []),
        ...(canViewRuns && canViewResults ? [executionEvidenceQuery.refetch()] : []),
        ...(canViewBugs ? [issuesPageQuery.refetch()] : [])
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const inspectSelectedGate = () => {
    if (!selectedGate) return;
    if (selectedGate.id === "critical-defects") {
      if (canViewBugs) navigate("/issues");
      return;
    }
    if (selectedGate.id === "priority-coverage") {
      if (canViewStories && canViewCases) setActiveView("traceability");
      return;
    }
    if (canViewRuns && canViewResults) setActiveView("execution");
  };

  if (!activeProjectId) {
    return <div className="page-content page-content--overview"><div className="empty-state compact">Select a project to review release readiness.</div></div>;
  }

  return (
    <div className="page-content page-content--overview readiness-page readiness-command-page">
      <header className="readiness-command-header">
        <div className="readiness-command-identity">
          <span className="readiness-command-mark" aria-hidden="true">
            <ReleaseReadinessIcon size={28} strokeWidth={1.9} />
          </span>
          <div>
            <p>Release decision room</p>
            <h1>Release readiness</h1>
            <span>{selectedProject?.name || "Selected project"} · {release || "All Fix Versions"}</span>
          </div>
        </div>

        <div className="readiness-command-scope" aria-label="Release scope">
          <ScopeSelect
            disabled={isReleaseScopeLocked}
            emptyLabel="All releases"
            label="Fix Version"
            onChange={(value) => {
              setRelease(value);
              setSprint("");
              setSelectedGateId("");
              setSelectedHotspotId("");
              setSelectedExecutionId("");
            }}
            options={scopeOptions.releases}
            value={release}
          />
          <ScopeSelect
            emptyLabel="All sprints"
            label="Sprint"
            onChange={(value) => {
              setSprint(value);
              setSelectedGateId("");
              setSelectedHotspotId("");
              setSelectedExecutionId("");
            }}
            options={sprintOptions}
            value={sprint}
          />
          {(release || sprint) && !isReleaseScopeLocked ? (
            <button
              className="readiness-clear-scope"
              onClick={() => {
                setRelease("");
                setSprint("");
                setSelectedGateId("");
                setSelectedHotspotId("");
                setSelectedExecutionId("");
              }}
              type="button"
            >
              Clear scope
            </button>
          ) : null}
        </div>

        <div className="readiness-command-actions" aria-label="Readiness actions">
          <button
            className="readiness-command-button"
            disabled={!canViewStories || !canViewCases || !actionableHotspots.length}
            onClick={() => setActiveView("traceability")}
            title={!canViewStories || !canViewCases ? "Story and Test Case view permissions are required" : !actionableHotspots.length ? "No actionable Story gap is visible" : "Review actionable Story evidence gaps"}
            type="button"
          >
            <IconTargetArrow aria-hidden="true" size={18} stroke={1.9} />
            <span>Review gaps</span>
          </button>
          <button
            className="readiness-command-button"
            disabled={!canViewRuns || !canViewResults}
            onClick={() => setActiveView("execution")}
            title={!canViewRuns || !canViewResults ? "Run and result view permissions are required" : "Review scoped execution evidence"}
            type="button"
          >
            <IconChartBar aria-hidden="true" size={18} stroke={1.9} />
            <span>Execution evidence</span>
          </button>
          <button
            className="readiness-command-button"
            disabled={!canViewBugs}
            onClick={() => navigate("/issues")}
            title={!canViewBugs ? "Bug view permission is required" : "Open the Bugs workspace"}
            type="button"
          >
            <IconBug aria-hidden="true" size={18} stroke={1.9} />
            <span>Open Bugs</span>
          </button>
          {canUseAi ? (
            <button
              className="readiness-command-button is-primary"
              disabled={qualityInsightPreview.isPending}
              onClick={openAiBrief}
              type="button"
            >
              <IconSparkles aria-hidden="true" size={18} stroke={1.9} />
              <span>{qualityInsightPreview.isPending ? "Reviewing…" : "Explain with AI"}</span>
            </button>
          ) : null}
          <button
            aria-label="Refresh readiness evidence"
            className={`readiness-command-button is-icon${isRefreshing ? " is-loading" : ""}`}
            disabled={isRefreshing}
            onClick={refreshEvidence}
            title="Refresh readiness evidence"
            type="button"
          >
            <IconRefresh aria-hidden="true" size={19} stroke={1.9} />
          </button>
        </div>
      </header>

      {!scopeIsExplicit ? (
        <div className="readiness-command-notice" role="status">
          <IconClock aria-hidden="true" size={17} stroke={2} />
          <span>Select a Fix Version or Sprint for a definitive release decision. Until then, this is a provisional project portfolio snapshot.</span>
        </div>
      ) : null}

      {unavailableEvidenceSources.length ? (
        <div className="readiness-command-notice" role="status">
          <IconAlertTriangle aria-hidden="true" size={17} stroke={2} />
          <span>Evidence is permission-limited: {unavailableEvidenceSources.join(", ")} cannot be read by this role. Available records remain visible, but no definitive release verdict is produced.</span>
        </div>
      ) : null}

      {evidenceScopeIncomplete ? (
        <div className="readiness-command-notice" role="status">
          <IconAlertTriangle aria-hidden="true" size={17} stroke={2} />
          <span>Readiness is provisional: {incompleteEvidenceSources.join("; ")}. Use the linked workspaces to review the complete paged scope.</span>
        </div>
      ) : null}

      {evidenceLoadFailed ? (
        <div className="readiness-command-notice is-error" role="alert">
          <IconAlertTriangle aria-hidden="true" size={17} stroke={2} />
          <span>Some delivery evidence could not be refreshed. Visible metrics remain provisional until every evidence source loads successfully.</span>
          <button disabled={isRefreshing} onClick={() => void refreshEvidence()} type="button">Retry</button>
        </div>
      ) : null}

      {loading ? (
        <div className="readiness-command-loading">
          <LoadingState label="Building the release evidence graph" description="Connecting delivery scope, traceability, latest results, and linked Bugs." />
        </div>
      ) : (
        <>
          <section aria-label="Readiness metrics" className="readiness-metric-grid metric-strip page-metric-strip">
            <MetricCard
              detail={`${evidenceIsProvisional ? "Provisional · " : ""}${model.decision.label} · ${model.metrics.confidence}% confidence`}
              icon={<IconShieldCheck size={28} stroke={1.7} />}
              label="Overall readiness"
              methodology={metricMethodology(
                "metric.release.readiness",
                `${model.metrics.coverage}% Story coverage, ${model.metrics.completion}% completion, ${model.metrics.passRate}% latest-terminal pass rate, and ${model.metrics.openCriticalBugCount} open critical Bugs.`,
                "How overall readiness is calculated"
              )}
              progress={model.metrics.readinessScore}
              tone={model.decision.state === "on-track"
                ? "green"
                : model.decision.state === "review"
                  ? "amber"
                  : model.decision.state === "insufficient"
                    ? "blue"
                    : "red"}
              value={`${model.metrics.readinessScore}/100`}
            />
            <MetricCard
              detail={`${model.metrics.coveredRequirementCount} of ${model.metrics.requirementCount} Stories linked · ${model.metrics.highPriorityUncoveredCount} priority gaps`}
              icon={<IconGitBranch size={28} stroke={1.7} />}
              label="Story coverage"
              methodology={metricMethodology("metric.story.coverage", `${model.metrics.coveredRequirementCount} linked Stories ÷ ${model.metrics.requirementCount} scoped Stories.`)}
              progress={model.metrics.coverage}
              tone={!model.metrics.requirementCount ? "blue" : model.metrics.coverage >= 90 ? "green" : "amber"}
              value={`${model.metrics.coverage}%`}
            />
            <MetricCard
              detail={`${model.metrics.completion}% execution complete · ${model.metrics.notRunCount} not run · ${latestEvidenceLabel}`}
              icon={<IconCircleCheck size={28} stroke={1.7} />}
              label="Latest pass rate"
              methodology={metricMethodology("metric.execution.pass_rate", `${model.metrics.passedCount} passed ÷ ${model.metrics.executedCaseCount} latest terminal outcomes.`)}
              progress={model.metrics.passRate}
              tone={!model.metrics.executedCaseCount
                ? "blue"
                : model.metrics.failedCount || model.metrics.blockedCount
                  ? "red"
                  : model.metrics.passRate >= 90
                    ? "green"
                    : "amber"}
              value={`${model.metrics.passRate}%`}
            />
            <MetricCard
              detail={`${model.metrics.openCriticalBugCount} critical Bugs · ${model.metrics.blockedCount} blocked tests · ${model.metrics.highPriorityUncoveredCount} coverage gaps`}
              icon={<IconAlertTriangle size={28} stroke={1.7} />}
              label="Blocking signals"
              methodology={metricMethodology("metric.release.blocking_signals", `${model.metrics.openCriticalBugCount} critical Bugs + ${model.metrics.blockedCount} blocked latest outcomes + ${model.metrics.highPriorityUncoveredCount} uncovered P1/P2 Stories.`)}
              tone={blockingSignalCount ? "red" : evidenceIsProvisional ? "blue" : model.metrics.openHighBugCount ? "amber" : "green"}
              value={evidenceIsProvisional && !blockingSignalCount ? "—" : String(blockingSignalCount)}
            />
          </section>

          <section aria-label="Readiness evidence context" className="readiness-command-context-bar">
            <div>
              <span>connected release scope</span>
              <strong>{scopeLabel}</strong>
              <small>{completedStoryCount}/{model.metrics.requirementCount} Stories Done · Fix Version and Sprint are authoritative.</small>
            </div>
            <div>
              <span>Latest run context</span>
              <strong>{latestRunEnvironment} · {latestScopedExecution?.build || "No build"}</strong>
              <small>{latestRunConfiguration} · {latestRunDataSet}</small>
            </div>
            <div>
              <span>Evidence snapshot</span>
              <strong>{latestEvidenceLabel}</strong>
              <small>{passingGateCount}/{model.gates.length} gates passing · {knownCaseDesignCount}/{model.metrics.plannedCaseCount} case designs known{reviewAttentionCount ? ` · ${reviewAttentionCount} review alerts` : ""}</small>
            </div>
            <div>
              <span>Decision ownership</span>
              <strong>Human owned · {model.metrics.confidence}% confidence</strong>
              <small className="readiness-inline-methodology">Scores guide attention; people own the decision. {metricMethodology("metric.release.evidence_confidence", `${model.metrics.coverage}% coverage and ${model.metrics.completion}% completion${model.metrics.openBugCount ? ` with ${model.metrics.linkedBugCount} of ${model.metrics.openBugCount} scoped Bugs trace-linked` : "; no scoped Bug denominator"}.`)}</small>
            </div>
          </section>

          <section className="readiness-command-workspace">
            <aside className="readiness-command-hierarchy" aria-label="Release evidence navigation">
              <div className="readiness-command-pane-heading">
                <span><IconRoute aria-hidden="true" size={18} stroke={1.9} /> Evidence map</span>
                <small>{model.metrics.requirementCount + model.metrics.plannedCaseCount} records</small>
              </div>

              <nav aria-label="Readiness report views" className="readiness-command-view-nav">
                {([
                  ["brief", "Decision brief", "Gates and leading risks", <IconFileAnalytics aria-hidden="true" size={18} stroke={1.9} />],
                  ["traceability", "Traceability", "Story-to-evidence matrix", <IconGitBranch aria-hidden="true" size={18} stroke={1.9} />],
                  ["execution", "Execution evidence", "Runs and latest results", <IconChartBar aria-hidden="true" size={18} stroke={1.9} />]
                ] as const).map(([id, label, detail, icon]) => (
                  <button
                    aria-current={activeView === id ? "page" : undefined}
                    className={activeView === id ? "is-active" : ""}
                    key={id}
                    onClick={() => setActiveView(id)}
                    type="button"
                  >
                    {icon}
                    <span><strong>{label}</strong><small>{detail}</small></span>
                    <IconChevronRight aria-hidden="true" size={16} stroke={1.9} />
                  </button>
                ))}
              </nav>

              <div className="readiness-command-gates">
                <div className="readiness-command-subheading">
                  <span>Release controls</span>
                  <small>{passingGateCount}/{model.gates.length}</small>
                </div>
                {model.gates.map((gate) => (
                  <button
                    aria-pressed={selectedGate?.id === gate.id}
                    className={selectedGate?.id === gate.id ? "is-selected" : ""}
                    key={gate.id}
                    onClick={() => {
                      setSelectedGateId(gate.id);
                      setActiveView("brief");
                    }}
                    type="button"
                  >
                    <GateIcon state={gate.state} />
                    <span><strong>{gate.label}</strong><small>{gate.actual}</small></span>
                  </button>
                ))}
              </div>

              <div className="readiness-command-ai-card">
                <div><IconSparkles aria-hidden="true" size={18} stroke={1.9} /><strong>Explainable assist</strong></div>
                <p>Summarize release-scoped delivery evidence with cited records and human-owned actions.</p>
                {canUseAi ? (
                  <button disabled={qualityInsightPreview.isPending} onClick={openAiBrief} type="button">
                    {qualityInsightPreview.isPending ? "Building evidence brief…" : "Open evidence brief"}
                  </button>
                ) : (
                  <small>Quality insights are not enabled for this role or project.</small>
                )}
              </div>
            </aside>

            <main className="readiness-command-main">
              <header className="readiness-command-main-header">
                <div>
                  <p>{activeView === "brief" ? "Release control center" : activeView === "traceability" ? "Traceability analysis" : "Run evidence"}</p>
                  <h2>{activeView === "brief" ? "Priority evidence queue" : activeView === "traceability" ? "Story → tests → latest evidence → Bugs" : "Scoped execution history"}</h2>
                  <span>
                    {activeView === "brief"
                      ? "Ranked by coverage gaps, latest failures, blockers, and open linked Bugs."
                      : activeView === "traceability"
                        ? "One row per Story, ranked by explainable risk."
                        : "Latest result per case within each run; reruns do not inflate progress."}
                  </span>
                </div>
                <div className="readiness-command-main-actions">
                  <button disabled={!canViewStories} onClick={() => navigate("/backlog")} type="button">
                    <IconFlag aria-hidden="true" size={16} stroke={1.9} />
                    <span>Stories</span>
                  </button>
                  <button disabled={!canViewRuns} onClick={() => navigate("/executions")} type="button">
                    <IconExternalLink aria-hidden="true" size={16} stroke={1.9} />
                    <span>Runs</span>
                  </button>
                </div>
              </header>

              <div className="readiness-command-main-scroll">
                {activeView === "brief" ? (
                  <>
                    <section className="readiness-command-trace-path" aria-label="Release traceability path">
                      {[
                        { label: "Stories", value: model.metrics.requirementCount, detail: "delivery scope", to: "/backlog", enabled: canViewStories, icon: <IconFlag size={17} stroke={1.9} /> },
                        { label: "Covered", value: model.metrics.coveredRequirementCount, detail: `${model.metrics.coverage}% mapped`, to: "/test-cases", enabled: canViewStories && canViewCases, icon: <IconGitBranch size={17} stroke={1.9} /> },
                        { label: "Scoped tests", value: model.metrics.plannedCaseCount, detail: "Linked cases", to: "/test-cases", enabled: canViewCases, icon: <IconTestPipe size={17} stroke={1.9} /> },
                        { label: "Executed", value: model.metrics.executedCaseCount, detail: `${model.metrics.completion}% complete`, to: "/executions", enabled: canViewRuns && canViewResults, icon: <IconListCheck size={17} stroke={1.9} /> },
                        { label: "Passing", value: model.metrics.passedCount, detail: `${model.metrics.passRate}% pass rate`, to: "/executions", enabled: canViewRuns && canViewResults, icon: <IconCircleCheck size={17} stroke={1.9} /> },
                        { label: "Open Bugs", value: model.metrics.openBugCount, detail: `${model.metrics.openCriticalBugCount} critical`, to: "/issues", enabled: canViewBugs, icon: <IconBug size={17} stroke={1.9} /> }
                      ].map((step, index, steps) => (
                        <div className="readiness-command-trace-step" key={step.label}>
                          <button disabled={!step.enabled} onClick={() => navigate(step.to)} type="button">
                            <span aria-hidden="true">{step.icon}</span>
                            <strong>{step.value}</strong>
                            <b>{step.label}</b>
                            <small>{step.detail}</small>
                          </button>
                          {index < steps.length - 1 ? <IconChevronRight aria-hidden="true" size={16} stroke={1.9} /> : null}
                        </div>
                      ))}
                    </section>

                    <section className="readiness-command-section">
                      <header>
                        <div><span className="readiness-inline-methodology">Priority queue {metricMethodology("metric.story.release_risk", "Each Story is ranked from priority, direct coverage, latest terminal outcomes, and open linked Bugs.")}</span><strong>Stories needing attention</strong></div>
                        <button onClick={() => setActiveView("traceability")} type="button">View full matrix</button>
                      </header>
                      <div className="readiness-command-risk-list">
                        {actionableHotspots.slice(0, 8).map((hotspot) => (
                          <button
                            aria-pressed={selectedHotspot?.id === hotspot.id}
                            className={selectedHotspot?.id === hotspot.id ? "is-selected" : ""}
                            key={hotspot.id}
                            onClick={() => setSelectedHotspotId(hotspot.id)}
                            type="button"
                          >
                            <span className={`readiness-risk-score is-${hotspot.riskLabel.toLowerCase()}`}>{hotspot.riskScore}</span>
                            <span className="readiness-command-risk-copy">
                              <strong>{hotspot.displayId} · {hotspot.title}</strong>
                              <small>{hotspot.reasons.join(" · ")}</small>
                            </span>
                            <span>{hotspot.coverageCount} tests</span>
                            <span>{hotspot.openBugCount} Bugs</span>
                            <IconArrowRight aria-hidden="true" size={17} stroke={1.9} />
                          </button>
                        ))}
                        {!actionableHotspots.length ? <div className="readiness-empty">No actionable Story gap is visible in the loaded scope.</div> : null}
                      </div>
                    </section>
                  </>
                ) : null}

                {activeView === "traceability" ? (
                  <div className="readiness-table-wrap">
                    <table className="readiness-matrix">
                      <thead><tr><th>Story</th><th>Priority</th><th>Coverage</th><th>Latest results</th><th>Open Bugs</th><th><span className="readiness-inline-methodology">Risk {metricMethodology("metric.story.release_risk", "Priority baseline plus traceability, execution, and open-Bug penalties; capped at 100.")}</span></th></tr></thead>
                      <tbody>
                        {model.hotspots.map((hotspot) => (
                          <tr
                            className={selectedHotspot?.id === hotspot.id ? "is-selected" : ""}
                            key={hotspot.id}
                          >
                            <td>
                              <button
                                aria-pressed={selectedHotspot?.id === hotspot.id}
                                className="readiness-matrix-story-button"
                                onClick={() => setSelectedHotspotId(hotspot.id)}
                                type="button"
                              >
                                <strong>{hotspot.displayId}</strong><span>{hotspot.title}</span>
                              </button>
                            </td>
                            <td>{hotspot.priority ? `P${hotspot.priority}` : "—"}</td>
                            <td><strong>{hotspot.coverageCount}</strong><span>{hotspot.executedCount} executed</span></td>
                            <td><div className="readiness-result-pills"><span className="is-pass">{hotspot.passedCount} passed</span><span className="is-fail">{hotspot.failedCount} failed</span><span className="is-blocked">{hotspot.blockedCount} blocked</span></div></td>
                            <td><strong>{hotspot.openBugCount}</strong><span>{hotspot.criticalBugCount} critical</span></td>
                            <td><span className={`readiness-risk-pill is-${hotspot.riskLabel.toLowerCase()}`}>{hotspot.riskScore} · {hotspot.riskLabel}</span><small>{hotspot.reasons.join(" · ")}</small></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!model.hotspots.length ? <div className="readiness-empty">No Story traceability is available for {scopeLabel}.</div> : null}
                  </div>
                ) : null}

                {activeView === "execution" ? (
                  <div className="readiness-run-list">
                    {executionSummaries.map(({ execution, total, passed, failed, blocked, running }) => {
                      const passRate = total ? Math.round((passed / total) * 100) : 0;
                      return (
                        <button
                          aria-pressed={selectedExecutionSummary?.execution.id === execution.id}
                          className={selectedExecutionSummary?.execution.id === execution.id ? "is-selected" : ""}
                          key={execution.id}
                          onClick={() => setSelectedExecutionId(execution.id)}
                          type="button"
                        >
                          <div className="readiness-run-head">
                            <div><strong>{execution.display_id || execution.name || "Unnamed run"}</strong><span>{execution.name && execution.display_id ? execution.name : `${execution.trigger || "manual"} execution`}</span></div>
                            <StatusBadge value={execution.status} />
                          </div>
                          <ProgressMeter detail={`${passed} passed · ${failed} failed · ${blocked} blocked · ${running} running`} label="Pass rate" tone={failed || blocked ? "danger" : "success"} value={passRate} />
                          <footer><span>{execution.release || "No release"} · {execution.sprint || "No sprint"}</span><span>{execution.ended_at || execution.started_at ? dateTimeFormatter.format(new Date(execution.ended_at || execution.started_at || "")) : "Not started"}</span></footer>
                        </button>
                      );
                    })}
                    {!executionSummaries.length ? <div className="readiness-empty">No executions match the selected release and Sprint.</div> : null}
                  </div>
                ) : null}
              </div>
            </main>

            <aside className="readiness-command-analysis" aria-label="Release analysis workspace">
              <div className="readiness-command-pane-heading">
                <span><IconShieldCheck aria-hidden="true" size={18} stroke={1.9} /> Decision analysis</span>
                <small>{evidenceIsProvisional ? "Provisional" : "Current"}</small>
              </div>

              <div className="readiness-command-analysis-scroll">
                <article className={`readiness-command-verdict is-${model.decision.state}`}>
                  <div className="readiness-command-verdict-head">
                    <span className="readiness-inline-methodology">{scopeIsExplicit ? "Release verdict" : "Portfolio snapshot"} {metricMethodology("metric.release.readiness", "The score below uses the exact currently selected release scope and is capped when evidence is incomplete.")}</span>
                    <strong>{model.decision.label}</strong>
                  </div>
                  <div className="readiness-command-verdict-score">
                    <strong>{model.metrics.readinessScore}</strong><span>/100</span>
                  </div>
                  <progress aria-label={`${model.metrics.readinessScore} out of 100 release readiness`} max={100} value={model.metrics.readinessScore} />
                  <h3>{model.decision.summary}</h3>
                  <p>{model.decision.primaryAction}</p>
                  <div className="readiness-command-confidence">
                    <span className="readiness-inline-methodology">Evidence confidence {metricMethodology("metric.release.evidence_confidence", `${model.metrics.coverage}% Story coverage, ${model.metrics.completion}% execution completion, and ${model.metrics.linkedBugCount}/${model.metrics.openBugCount} scoped Bugs trace-linked.`)}</span><strong>{model.metrics.confidence}%</strong>
                  </div>
                  <progress aria-label={`${model.metrics.confidence}% evidence confidence`} max={100} value={model.metrics.confidence} />
                  <details className="readiness-method">
                    <summary>How the score works</summary>
                    <p>Coverage 25% · completion 20% · pass rate 35% · defect containment 20%. Missing, stale, bounded, permission-limited, or failed evidence; P1/P2 gaps; blocked tests; and critical Bugs cap the score. When no scoped Bugs exist, confidence is reweighted across coverage and completion.</p>
                  </details>
                </article>

                {activeView === "execution" ? (
                  <section className="readiness-command-inspector">
                    <div className="readiness-command-section-title"><IconChartBar aria-hidden="true" size={17} stroke={1.9} /><strong>Run inspector</strong></div>
                    {selectedExecutionSummary ? (
                      <article>
                        <header>
                          <div><strong>{selectedExecutionSummary.execution.display_id || selectedExecutionSummary.execution.name || "Unnamed run"}</strong><span>{selectedExecutionSummary.execution.name || `${selectedExecutionSummary.execution.trigger || "manual"} execution`}</span></div>
                          <StatusBadge value={selectedExecutionSummary.execution.status} />
                        </header>
                        <div className="readiness-result-stack">
                          {[
                            ["Passed", selectedExecutionSummary.passed, "pass"],
                            ["Failed", selectedExecutionSummary.failed, "fail"],
                            ["Blocked", selectedExecutionSummary.blocked, "blocked"],
                            ["Running", selectedExecutionSummary.running, "running"],
                            ["Total results", selectedExecutionSummary.total, "not-run"]
                          ].map(([label, count, tone]) => <div key={label}><span><i className={`is-${tone}`} />{label}</span><strong>{count}</strong></div>)}
                        </div>
                        <button disabled={!canViewRuns} onClick={() => navigate(`/executions?execution=${encodeURIComponent(selectedExecutionSummary.execution.id)}`)} type="button">
                          Open run evidence <IconArrowRight aria-hidden="true" size={16} stroke={1.9} />
                        </button>
                      </article>
                    ) : <div className="readiness-empty">Select a run to inspect its release evidence.</div>}
                  </section>
                ) : (
                  <>
                    <section className="readiness-command-inspector">
                      <div className="readiness-command-section-title"><IconAlertTriangle aria-hidden="true" size={17} stroke={1.9} /><strong className="readiness-inline-methodology">Risk inspector {metricMethodology("metric.story.release_risk", selectedHotspot ? selectedHotspot.reasons.join(" · ") : "No scoped Story risk is selected.")}</strong></div>
                      {selectedHotspot ? (
                        <article>
                          <header>
                            <div><strong>{selectedHotspot.displayId}</strong><span>{selectedHotspot.title}</span></div>
                            <span className={`readiness-risk-pill is-${selectedHotspot.riskLabel.toLowerCase()}`}>{selectedHotspot.riskScore} · {selectedHotspot.riskLabel}</span>
                          </header>
                          <ul>{selectedHotspot.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                          <div className="readiness-command-inspector-facts">
                            <span><strong>{selectedHotspot.coverageCount}</strong><small>Linked tests</small></span>
                            <span><strong>{selectedHotspot.failedCount + selectedHotspot.blockedCount}</strong><small>Failed/blocked</small></span>
                            <span><strong>{selectedHotspot.openBugCount}</strong><small>Open Bugs</small></span>
                          </div>
                          <button disabled={!canViewStories} onClick={() => navigate(`/backlog?requirement=${encodeURIComponent(selectedHotspot.id)}`)} type="button">
                            Open Story evidence <IconArrowRight aria-hidden="true" size={16} stroke={1.9} />
                          </button>
                        </article>
                      ) : <div className="readiness-empty">No Story risk is available in this scope.</div>}
                    </section>

                    <section className="readiness-command-inspector">
                      <div className="readiness-command-section-title"><IconListCheck aria-hidden="true" size={17} stroke={1.9} /><strong>Selected gate</strong></div>
                      {selectedGate ? (
                        <article className="readiness-command-gate-detail">
                          <header><div><strong>{selectedGate.label}</strong><span>{selectedGate.expectation}</span></div><GateIcon state={selectedGate.state} /></header>
                          <b className={`is-${selectedGate.state}`}>{selectedGate.actual}</b>
                          <p>{selectedGate.detail}</p>
                          <button
                            disabled={selectedGate.id === "critical-defects"
                              ? !canViewBugs
                              : selectedGate.id === "priority-coverage"
                                ? !canViewStories || !canViewCases
                                : !canViewRuns || !canViewResults}
                            onClick={inspectSelectedGate}
                            type="button"
                          >
                            Inspect gate evidence <IconArrowRight aria-hidden="true" size={16} stroke={1.9} />
                          </button>
                        </article>
                      ) : null}
                    </section>
                  </>
                )}

                <section className="readiness-command-action-queue">
                  <div className="readiness-command-section-title"><IconTargetArrow aria-hidden="true" size={17} stroke={1.9} /><strong className="readiness-inline-methodology">Next review actions {metricMethodology("metric.story.release_risk", "The three highest deterministic Story release-risk scores are shown.")}</strong></div>
                  {actionableHotspots.slice(0, 3).map((hotspot) => (
                    <button key={hotspot.id} onClick={() => { setActiveView("traceability"); setSelectedHotspotId(hotspot.id); }} type="button">
                      <span className={`is-${hotspot.riskLabel.toLowerCase()}`}>{hotspot.riskScore}</span>
                      <strong>{hotspot.displayId}</strong>
                      <small>{hotspot.reasons[0]}</small>
                      <IconChevronRight aria-hidden="true" size={15} stroke={1.9} />
                    </button>
                  ))}
                  {!actionableHotspots.length ? <div className="readiness-empty">No deterministic review action is queued.</div> : null}
                </section>
              </div>

              <div className="readiness-command-analysis-footer">
                {canUseAi ? (
                  <button disabled={qualityInsightPreview.isPending} onClick={openAiBrief} type="button">
                    <IconSparkles aria-hidden="true" size={18} stroke={1.9} />
                    <span>{qualityInsightPreview.isPending ? "Building evidence brief…" : "Open AI evidence brief"}</span>
                  </button>
                ) : <span>AI quality insights are unavailable for this role or project.</span>}
              </div>
            </aside>
          </section>

          <footer className={`readiness-command-footer is-${evidenceFooterState}`}>
            <span>
              {evidenceFooterState === "current"
                ? <IconCircleCheck aria-hidden="true" size={15} stroke={2} />
                : evidenceFooterState === "error"
                  ? <IconAlertTriangle aria-hidden="true" size={15} stroke={2} />
                  : <IconClock aria-hidden="true" size={15} stroke={2} />}
              {evidenceFooterState === "current" ? "Current delivery evidence" : evidenceFooterState === "error" ? "Evidence source error" : "Provisional delivery evidence"}
            </span>
            <span>{model.metrics.requirementCount} Stories · {model.metrics.plannedCaseCount} cases · {model.executions.length} runs · {model.metrics.openBugCount} open Bugs</span>
            <span>{evidenceIsProvisional ? "Review scope, permissions, and source notices" : `Latest evidence ${latestEvidenceLabel}`}</span>
          </footer>
        </>
      )}

      <AiInsightPreviewDialog
        assuranceTitle="Release evidence grounding"
        emptyMessage="No deterministic release risk signal matched. This is not a release guarantee."
        error={qualityInsightPreview.error instanceof Error ? qualityInsightPreview.error.message : null}
        eyebrow="Release readiness"
        findings={aiFindings}
        gaps={[
          ...(sprint ? ["The AI endpoint evaluates connected release scope; the Sprint filter remains visible in the deterministic page metrics."] : []),
          ...(!release && scopeOptions.releases.length ? ["Select a Fix Version for a release-specific AI evidence brief."] : [])
        ]}
        limitations={qualityInsightPreview.data?.limitations || []}
        loading={qualityInsightPreview.isPending}
        onClose={() => setIsAiOpen(false)}
        open={isAiOpen}
        recommendedActions={aiFindings.map((finding) => finding.action).filter((action): action is string => Boolean(action))}
        response={qualityInsightPreview.data}
        signals={qualityInsightPreview.data ? [
          { label: "Scope", value: release || "Project", tone: release ? "positive" : "neutral" },
          { label: "Evidence", value: `${qualityInsightPreview.data.provenance.evidence.length} references`, tone: qualityInsightPreview.data.provenance.evidence.length ? "positive" : "warning" },
          { label: "Decision", value: "Human owned", tone: "warning" }
        ] : []}
        subtitle={`Read-only review for ${selectedProject?.name || "the selected project"}${release ? ` · ${release}` : ""}.`}
        summary="HelloTest applies transparent rules to visible work-item fields, issue links, properties, and execution evidence. It explains risk and suggests review work; it does not decide release readiness."
        title="AI release evidence brief"
      />
    </div>
  );
}
