import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBug,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconGitBranch,
  IconListCheck,
  IconRefresh,
  IconShieldCheck,
  IconSparkles,
  IconTestPipe,
} from "@tabler/icons-react";
import { useAuth } from "../auth/AuthContext";
import { useLocalization } from "../context/LocalizationContext";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { api } from "../lib/api";
import { areFeatureFlagsEnabled } from "../lib/featureFlags";
import { hasPermission } from "../lib/permissions";
import {
  deriveReleaseReadiness,
  isCriticalReadinessIssue,
  releaseReadinessScopeOptions,
} from "../lib/releaseReadiness";
import { READINESS_MESSAGES } from "../lib/releaseReadinessMessages";
import {
  AiInsightPreviewDialog,
  type AiPreviewFinding,
} from "./AiInsightPreviewDialog";
import { LoadingState } from "./LoadingState";
import { StatusBadge } from "./StatusBadge";
import "./ReleaseReadinessDashboard.css";

type View = "review" | "stories" | "runs";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const RUN_LIMIT = 10;
const RESULT_LIMIT = 300;
const same = (a: unknown, b: unknown) =>
  String(a || "")
    .trim()
    .toLowerCase() ===
  String(b || "")
    .trim()
    .toLowerCase();
const unique = <T extends { id: string }>(items: T[]) => [
  ...new Map(items.map((item) => [item.id, item])).values(),
];

export function ReleaseReadinessDashboard() {
  const [projectId] = useCurrentProject();
  const { t } = useLocalization();
  if (!projectId)
    return (
      <div className="release-review">
        <div className="rr-empty">
          <IconGitBranch size={30} />
          <h2>
            {t(
              "readiness.noProject",
              READINESS_MESSAGES["readiness.noProject"],
            )}
          </h2>
        </div>
      </div>
    );
  // Project changes destroy local selections and pending AI responses.
  return <ReadinessWorkspace key={projectId} projectId={projectId} />;
}

function ReadinessWorkspace({ projectId }: { projectId: string }) {
  const { session } = useAuth();
  const { t, formatDate, formatNumber } = useLocalization();
  const text = (key: string, values?: Record<string, string | number>) =>
    t(`readiness.${key}`, READINESS_MESSAGES[`readiness.${key}`], values);
  const n = (value: number) => formatNumber(value);
  const flags = useFeatureFlags();
  const authorizationKey = JSON.stringify([session?.user.id, session?.user.role, session?.user.status, session?.user.permissions, session?.user.workspace_permissions, session?.user.project_permissions, flags.data?.flags]);
  const dashboardGranted = hasPermission(session, "dashboard.view", projectId);
  const dashboardEnabled = areFeatureFlagsEnabled(flags.data, ["hellotest.analytics.dashboards"]);
  const allowed = (permission: string, flag: string) =>
    dashboardGranted && dashboardEnabled && hasPermission(session, permission, projectId) &&
    areFeatureFlagsEnabled(flags.data, [flag]);
  const canStories = allowed(
    "requirement.view",
    "hellotest.manual.requirements",
  );
  const canCases = allowed("testcase.view", "hellotest.manual.test_cases");
  const canBugs = allowed("feedback.view", "hellotest.manual.bugs");
  const canRuns =
    allowed("run.view", "hellotest.manual.runs") &&
    hasPermission(session, "result.view", projectId);
  const canProjects = allowed("project.view", "hellotest.ops.projects");
  const canAi = canStories && canCases && canBugs && canRuns && allowed("suite.view", "hellotest.manual.suites") && allowed("quality_insight.view", "hellotest.ai.quality_insights");
  const [searchParams, setSearchParams] = useSearchParams();
  const releaseId = searchParams.get("release_id") || "";
  const requestedRelease = searchParams.get("release") || "";
  const sprint = searchParams.get("sprint") || "";
  const [view, setView] = useState<View>("review");
  const [actionLimit, setActionLimit] = useState(6);
  const [aiScope, setAiScope] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const tabId = useId();
  const projects = useQuery({
    queryKey: ["release-review-projects", authorizationKey],
    queryFn: () => api.projects.list(),
    enabled: canProjects,
    staleTime: 60_000,
  });
  const context = useQuery({
    queryKey: ["release-review-context", authorizationKey, projectId, releaseId],
    queryFn: () => api.requirementReleases.get(releaseId),
    enabled: Boolean(releaseId && canStories),
    staleTime: 30_000,
    retry: 1,
  });
  const validContext =
    context.data && String(context.data.project_id) === projectId
      ? context.data
      : null;
  const invalidContext = Boolean(
    releaseId &&
      (!canStories || context.isError || (context.data && !validContext)),
  );
  const release = validContext?.fix_version || requestedRelease;
  const contextReady = !releaseId || Boolean(validContext);
  const [draftRelease, setDraftRelease] = useState(release);
  const [draftSprint, setDraftSprint] = useState(sprint);
  useEffect(() => {
    setDraftRelease(release);
    setDraftSprint(sprint);
    setActionLimit(6);
    setAiScope(null);
  }, [release, sprint, releaseId]);
  const queryDefaults = {
    initialPageParam: undefined as string | undefined,
    staleTime: 30_000,
    retry: 1,
  };
  const storiesQuery = useInfiniteQuery({
    ...queryDefaults,
    queryKey: ["release-review-stories", authorizationKey, projectId],
    queryFn: ({ pageParam }) =>
      api.requirements.listPage({
        project_id: projectId,
        page_size: PAGE_SIZE,
        projection: "summary",
        cursor: pageParam,
      }),
    getNextPageParam: (page, pages) =>
      !page.is_last && pages.length < MAX_PAGES
        ? page.next_cursor || undefined
        : undefined,
    enabled: canStories && contextReady && !validContext,
  });
  const casesQuery = useInfiniteQuery({
    ...queryDefaults,
    queryKey: ["release-review-cases", authorizationKey, projectId],
    queryFn: ({ pageParam }) =>
      api.testCases.listPage({
        project_id: projectId,
        page_size: PAGE_SIZE,
        projection: "summary",
        cursor: pageParam,
      }),
    getNextPageParam: (page, pages) =>
      !page.is_last && pages.length < MAX_PAGES
        ? page.next_cursor || undefined
        : undefined,
    enabled: canCases && contextReady,
  });
  const bugsQuery = useInfiniteQuery({
    ...queryDefaults,
    queryKey: ["release-review-bugs", authorizationKey, projectId],
    queryFn: ({ pageParam }) =>
      api.issues.listPage({
        project_id: projectId,
        page_size: PAGE_SIZE,
        projection: "detail",
        cursor: pageParam,
      }),
    getNextPageParam: (page, pages) =>
      !page.is_last && pages.length < MAX_PAGES
        ? page.next_cursor || undefined
        : undefined,
    enabled: canBugs && contextReady,
  });
  const runsQuery = useQuery({
    queryKey: ["release-review-runs", authorizationKey, projectId, release, sprint],
    queryFn: () =>
      api.executionResults.releaseReadiness({
        project_id: projectId,
        ...(release ? { release } : {}),
        ...(sprint ? { sprint } : {}),
        run_limit: RUN_LIMIT,
        result_limit: RESULT_LIMIT,
      }),
    enabled: canRuns && contextReady,
    staleTime: 30_000,
    retry: 1,
  });
  const requirements = useMemo(
    () =>
      canStories
        ? validContext
          ? (validContext.requirements || []).filter(item => String(item.project_id) === projectId).map(item => ({ ...item, fix_version: validContext.fix_version }))
          : unique(storiesQuery.data?.pages.flatMap(page => page.items) || []).filter(item => String(item.project_id) === projectId)
        : [],
    [canStories, storiesQuery.data, projectId, validContext],
  );
  const testCases = useMemo(
    () =>
      canCases
        ? unique(casesQuery.data?.pages.flatMap((page) => page.items) || [])
        : [],
    [canCases, casesQuery.data],
  );
  const issues = useMemo(
    () =>
      canBugs
        ? unique(bugsQuery.data?.pages.flatMap((page) => page.items) || [])
        : [],
    [canBugs, bugsQuery.data, projectId],
  );
  const executions = useMemo(
    () =>
      canRuns
        ? (runsQuery.data?.executions || []).filter(
            (item) => String(item.project_id) === projectId,
          )
        : [],
    [canRuns, runsQuery.data, projectId],
  );
  const executionResults = useMemo(
    () => (canRuns ? runsQuery.data?.results || [] : []),
    [canRuns, runsQuery.data],
  );
  const sources = [
    {
      id: "stories",
      enabled: canStories,
      error: validContext ? context.isError : storiesQuery.isError,
      loaded: requirements.length,
      total: validContext?.requirement_count ?? storiesQuery.data?.pages[0]?.total ?? 0,
      incomplete: validContext ? requirements.length < validContext.requirement_count : storiesQuery.data?.pages.slice(-1)[0]?.is_last === false,
      more: !validContext && storiesQuery.hasNextPage,
      fetching: storiesQuery.isFetchingNextPage,
    },
    {
      id: "cases",
      enabled: canCases,
      error: casesQuery.isError,
      loaded: testCases.length,
      total: casesQuery.data?.pages[0]?.total || 0,
      incomplete: casesQuery.data?.pages.slice(-1)[0]?.is_last === false,
      more: casesQuery.hasNextPage,
      fetching: casesQuery.isFetchingNextPage,
    },
    {
      id: "bugs",
      enabled: canBugs,
      error: bugsQuery.isError,
      loaded: issues.length,
      total: bugsQuery.data?.pages[0]?.total || 0,
      incomplete: bugsQuery.data?.pages.slice(-1)[0]?.is_last === false,
      more: bugsQuery.hasNextPage,
      fetching: bugsQuery.isFetchingNextPage,
    },
  ];
  const failed = flags.isError ||
    sources.some((item) => item.enabled && item.error) ||
    (canRuns && runsQuery.isError);
  const incomplete =
    sources.some((item) => !item.enabled || item.incomplete || item.error) ||
    !canRuns ||
    runsQuery.data?.complete !== true ||
    (!release && !sprint) ||
    issues.some((item) => item.traceability_truncated) ||
    testCases.some(
      (item) =>
        item.detail_complete === false && item.summary_complete !== true,
    );
  const duplicateSprint = Boolean(
    sprint &&
      new Set(
        requirements
          .filter(
            (item) =>
              same(item.sprint, sprint) &&
              (!release || same(item.fix_version || item.release, release)),
          )
          .map((item) => item.sprint_id)
          .filter(Boolean),
      ).size > 1,
  );
  const model = useMemo(
    () =>
      deriveReleaseReadiness({
        release,
        sprint,
        requirements,
        testCases,
        issues,
        executions,
        executionResults,
        evidenceComplete: !incomplete && !duplicateSprint,
      }),
    [
      release,
      sprint,
      requirements,
      testCases,
      issues,
      executions,
      executionResults,
      incomplete,
      duplicateSprint,
    ],
  );
  const provisional =
    incomplete || duplicateSprint || model.metrics.missingCaseDetailsCount > 0;
  const scopeOptions = useMemo(
    () => releaseReadinessScopeOptions(requirements, executions, issues),
    [requirements, executions, issues],
  );
  const projectName = (canProjects && Array.isArray(projects.data) ? projects.data : []).find(
    (item) => String(item.id) === projectId,
  )?.name;
  const aiKey = JSON.stringify([authorizationKey, projectId, release]);
  const ai = useMutation({
    mutationFn: async (scope: {
      project_id: string;
      release: string;
      key: string;
    }) => ({
      key: scope.key,
      response: await api.ai.qualityInsights({
        project_id: scope.project_id,
        release: scope.release,
      }),
    }),
  });
  useEffect(() => { setAiScope(null); ai.reset(); }, [authorizationKey]);
  const aiResponse =
    aiScope === aiKey && ai.data?.key === aiKey ? ai.data.response : undefined;
  const aiFindings: AiPreviewFinding[] = (aiResponse?.insights || []).map(
    (item) => ({
      id: item.id,
      title: item.title,
      severity: item.severity,
      description: item.explanation,
      action: item.recommended_action,
      evidence: item.evidence.map((source) => source.display_id || source.id),
    }),
  );
  const runs = useMemo(
    () =>
      executions.map((execution) => {
        const rows = model.latestCaseResults.filter(
          (item) => item.execution_id === execution.id,
        );
        return {
          execution,
          rows,
          passed: rows.filter((item) => item.status === "passed").length,
          failed: rows.filter((item) => item.status === "failed").length,
          blocked: rows.filter((item) => item.status === "blocked").length,
          paused: rows.filter((item) => item.status === "paused").length,
          unassessed:
            rows.filter(
              (item) => item.status !== "passed" && item.status !== "failed",
            ).length + (model.missingRowsByRun.get(execution.id) || 0),
        };
      }),
    [executions, model.latestCaseResults, model.missingRowsByRun],
  );
  const recordLink = (path: string, key: string, value: string) =>
    `${path}?${new URLSearchParams({ [key]: value, project_id: projectId })}`;
  const actions = [
    ...(canBugs
      ? [...model.openIssues]
          .sort(
            (a, b) =>
              Number(isCriticalReadinessIssue(b)) -
              Number(isCriticalReadinessIssue(a)),
          )
          .map((issue) => ({
            id: `bug:${issue.id}`,
            kind: "bug",
            title: issue.title,
            label: issue.jira_bug_key || text("defect"),
            detail: isCriticalReadinessIssue(issue)
              ? text("critical")
              : issue.severity || issue.priority || text("defect"),
            link: recordLink("/issues", "issue", issue.id),
            action: text("openDefect"),
            danger: isCriticalReadinessIssue(issue),
          }))
      : []),
    ...runs
      .filter((run) => run.failed || run.blocked || run.paused)
      .map((run) => ({
        id: `run:${run.execution.id}`,
        kind: "run",
        title: run.execution.name || text("runName"),
        label: text("tab.runs"),
        detail: [
          run.failed ? text("failed", { count: n(run.failed) }) : "",
          run.blocked ? text("blocked", { count: n(run.blocked) }) : "",
          run.paused ? text("paused", { count: n(run.paused) }) : "",
        ]
          .filter(Boolean)
          .join(" · "),
        link: recordLink("/executions", "execution", run.execution.id),
        action: text("openRun"),
        danger: run.failed > 0,
      })),
    ...(canStories
      ? model.hotspots
          .filter(
            (story) =>
              !story.coverageCount || story.executedCount < story.coverageCount,
          )
          .map((story) => ({
            id: `story:${story.id}`,
            kind: "story",
            title: story.title,
            label: story.displayId,
            detail: !story.coverageCount
              ? text("noTests")
              : text("remaining", {
                  count: n(story.coverageCount - story.executedCount),
                }),
            link: recordLink("/stories", "requirement", story.id),
            action: text("openStory"),
            danger: !story.coverageCount && Number(story.priority || 3) <= 2,
          }))
      : []),
  ];
  const loading =
    flags.isPending ||
    Boolean(releaseId && canStories && context.isPending) ||
    (contextReady &&
      ((canStories && !validContext && storiesQuery.isPending) ||
        (canCases && casesQuery.isPending) ||
        (canBugs && bugsQuery.isPending) ||
        (canRuns && runsQuery.isPending)));
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        flags.refetch(),
        ...(releaseId && canStories ? [context.refetch()] : []),
        ...(canStories && contextReady && !validContext ? [storiesQuery.refetch()] : []),
        ...(canCases && contextReady ? [casesQuery.refetch()] : []),
        ...(canBugs && contextReady ? [bugsQuery.refetch()] : []),
        ...(canRuns && contextReady ? [runsQuery.refetch()] : []),
      ]);
    } finally {
      setRefreshing(false);
    }
  };
  const loadMore = () =>
    Promise.allSettled([
      ...(canStories && storiesQuery.hasNextPage
        ? [storiesQuery.fetchNextPage()]
        : []),
      ...(canCases && casesQuery.hasNextPage
        ? [casesQuery.fetchNextPage()]
        : []),
      ...(canBugs && bugsQuery.hasNextPage ? [bugsQuery.fetchNextPage()] : []),
    ]);
  const applyScope = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("release_id");
    draftRelease.trim()
      ? next.set("release", draftRelease.trim())
      : next.delete("release");
    draftSprint.trim()
      ? next.set("sprint", draftSprint.trim())
      : next.delete("sprint");
    setSearchParams(next);
  };
  const clearContext = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("release_id");
    setSearchParams(next);
  };
  const tabs: View[] = ["review", "stories", "runs"];
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    setView(tabs[next]);
    document.getElementById(`${tabId}-${tabs[next]}`)?.focus();
  };
  const percent = (value: number | null, available: boolean) =>
    available && value !== null ? `${n(value)}%` : "—";
  const metricCards = [
    {
      icon: IconGitBranch,
      label: text("metric.stories"),
      value: percent(model.metrics.coverage, canStories && canCases),
      detail: text("storiesDetail", {
        covered: n(model.metrics.coveredRequirementCount),
        total: n(model.metrics.requirementCount),
      }),
      available: canStories && canCases,
      target: "stories" as View,
    },
    {
      icon: IconListCheck,
      label: text("metric.assessed"),
      value: percent(
        model.metrics.completion,
        canRuns && canCases && canStories,
      ),
      detail: text("casesDetail", {
        assessed: n(model.metrics.executedCaseCount),
        total: n(model.metrics.plannedCaseCount),
      }),
      available: canRuns && canCases && canStories,
      target: "runs" as View,
    },
    {
      icon: IconTestPipe,
      label: text("metric.outcomes"),
      value: percent(model.metrics.passRate, canRuns),
      detail: text("outcomesDetail", {
        passed: n(model.metrics.passedCount),
        failed: n(model.metrics.failedCount),
      }),
      available: canRuns,
      target: "runs" as View,
    },
    {
      icon: IconBug,
      label: text("metric.defects"),
      value: canBugs ? n(model.metrics.openBugCount) : "—",
      detail: text("defectsDetail", {
        critical: n(model.metrics.openCriticalBugCount),
        high: n(model.metrics.openHighBugCount),
      }),
      available: canBugs,
      target: "review" as View,
    },
  ];
  if (!dashboardGranted || flags.data && !dashboardEnabled) return <div className="release-review"><div className="rr-empty"><h2>{t(dashboardGranted ? "access.disabledTitle" : "access.deniedTitle")}</h2><p>{t(dashboardGranted ? "access.disabledHelp" : "access.deniedHelp")}</p></div></div>;
  return (
    <div className="release-review">
      <header className="rr-header">
        <div className="rr-heading">
          <span className="rr-eyebrow">{projectName || text("eyebrow")}</span>
          <h1>{text("title")}</h1>
          <p>{text("subtitle")}</p>
        </div>
        <div className="rr-header-actions">
          <button
            className="rr-button"
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing || loading}
          >
            <IconRefresh size={17} className={refreshing ? "rr-spin" : ""} />
            {text(refreshing ? "refreshing" : "refresh")}
          </button>
          {canAi && release && contextReady && (
            <button
              type="button"
              className="rr-button rr-button-primary"
              title={text("explainHelp")}
              onClick={() => {
                ai.reset();
                setAiScope(aiKey);
                ai.mutate({ project_id: projectId, release, key: aiKey });
              }}
              disabled={ai.isPending}
            >
              <IconSparkles size={17} />
              {text("explain")}
            </button>
          )}
        </div>
      </header>
      <form
        className="rr-scope"
        onSubmit={(event) => {
          event.preventDefault();
          applyScope();
        }}
      >
        <label>
          <span>{text("release")}</span>
          <input
            list={`${tabId}-releases`}
            value={draftRelease}
            placeholder={text("allReleases")}
            onChange={(event) => setDraftRelease(event.target.value)}
            disabled={Boolean(releaseId && validContext)}
          />
          <datalist id={`${tabId}-releases`}>
            {scopeOptions.releases.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </label>
        <label>
          <span>{text("sprint")}</span>
          <input
            list={`${tabId}-sprints`}
            value={draftSprint}
            placeholder={text("allSprints")}
            onChange={(event) => setDraftSprint(event.target.value)}
          />
          <datalist id={`${tabId}-sprints`}>
            {scopeOptions.sprints.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </label>
        <button
          type="submit"
          className="rr-button"
          disabled={draftRelease === release && draftSprint === sprint}
        >
          {text("apply")}
        </button>
        {releaseId && (
          <button
            type="button"
            className="rr-link-button"
            onClick={clearContext}
          >
            {text("changeScope")}
          </button>
        )}
        <div className="rr-active-scope">
          <IconGitBranch size={17} />
          <span>
            {release || sprint
              ? [
                  release || text("allReleases"),
                  sprint || text("allSprints"),
                ].join(" · ")
              : text("scopeOverview")}
          </span>
        </div>
      </form>
      {loading ? (
        <LoadingState label={text("loading")} />
      ) : invalidContext ? (
        <div className="rr-empty" role="alert">
          <IconAlertTriangle size={28} />
          <h2>{text("contextError")}</h2>
          <p>{text("contextHelp")}</p>
          <button
            type="button"
            className="rr-button"
            onClick={() => void refresh()}
          >
            {text("retry")}
          </button>
          <button
            type="button"
            className="rr-link-button"
            onClick={clearContext}
          >
            {text("changeScope")}
          </button>
        </div>
      ) : !flags.data && flags.isError ? (
        <div className="rr-notice" role="alert">
          {text("flagsError")}
          <button
            type="button"
            className="rr-button"
            onClick={() => void flags.refetch()}
          >
            {text("retry")}
          </button>
        </div>
      ) : (
        <>
          {failed && (
            <div className="rr-notice" role="alert">
              <IconAlertTriangle size={18} />
              <span>{text("cachedError")}</span>
              <button
                type="button"
                className="rr-link-button"
                onClick={() => void refresh()}
              >
                {text("retry")}
              </button>
            </div>
          )}
          <section
            className={`rr-decision is-${model.decisionState}`}
            aria-labelledby={`${tabId}-decision`}
          >
            <div className="rr-decision-icon">
              {model.decisionState === "clear" ? (
                <IconShieldCheck size={26} />
              ) : (
                <IconAlertTriangle size={25} />
              )}
            </div>
            <div>
              <div className="rr-decision-title">
                <h2 id={`${tabId}-decision`}>
                  {text(
                    `state.${provisional && model.decisionState === "clear" ? "review" : model.decisionState}`,
                  )}
                </h2>
                <span
                  className={`rr-badge ${provisional ? "is-warning" : "is-neutral"}`}
                >
                  {text(provisional ? "partial" : "complete")}
                </span>
              </div>
              <p>
                {text(
                  `summary.${provisional && model.decisionState === "clear" ? "review" : model.decisionState}`,
                )}
              </p>
            </div>
            <div className="rr-freshness">
              <IconClock size={15} />
              <span>
                {text("updated")}
                <strong>
                  {model.latestEvidenceAt
                    ? formatDate(model.latestEvidenceAt)
                    : text("noDate")}
                </strong>
              </span>
            </div>
          </section>
          <div className="rr-metrics">
            {metricCards.map((card) => (
              <button
                key={card.label}
                type="button"
                className="rr-metric"
                onClick={() => {
                  setView(card.target);
                  document.getElementById(`${tabId}-${card.target}`)?.focus();
                }}
              >
                <span className="rr-metric-heading">
                  <card.icon size={19} />
                  <span>{card.label}</span>
                  <IconArrowRight className="rr-metric-arrow" size={16} />
                </span>
                <strong>{card.value}</strong>
                <span>
                  {card.available ? card.detail : text("source.unavailable")}
                </span>
              </button>
            ))}
          </div>
          <div className="rr-workspace">
            <section className="rr-evidence">
              <div
                className="rr-tabs"
                role="tablist"
                aria-label={text("title")}
              >
                {tabs.map((item, index) => (
                  <button
                    id={`${tabId}-${item}`}
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={view === item}
                    aria-controls={`${tabId}-panel-${item}`}
                    tabIndex={view === item ? 0 : -1}
                    onKeyDown={(event) => onTabKey(event, index)}
                    onClick={() => setView(item)}
                  >
                    {text(`tab.${item}`)}
                    <span>
                      {n(
                        item === "stories"
                          ? model.requirements.length
                          : item === "runs"
                            ? runs.length
                            : actions.length,
                      )}
                    </span>
                  </button>
                ))}
              </div>
              <div
                role="tabpanel"
                tabIndex={0}
                id={`${tabId}-panel-${view}`}
                aria-labelledby={`${tabId}-${view}`}
                className="rr-panel"
              >
                {view === "review" && (
                  <>
                    <div className="rr-panel-heading">
                      <h2>{text("actions")}</h2>
                      <p>{text("actionsHelp")}</p>
                    </div>
                    {actions.length ? (
                      <ol className="rr-actions">
                        {actions.slice(0, actionLimit).map((action, index) => (
                          <li key={action.id}>
                            <span
                              className={`rr-action-symbol ${action.danger ? "is-danger" : ""}`}
                            >
                              {action.kind === "bug" ? (
                                <IconBug size={20} />
                              ) : action.kind === "run" ? (
                                <IconTestPipe size={20} />
                              ) : (
                                <IconGitBranch size={20} />
                              )}
                            </span>
                            <div className="rr-action-copy">
                              <span className="rr-action-meta">
                                {n(index + 1)} · {action.label}
                              </span>
                              <Link to={action.link}>{action.title}</Link>
                              <span
                                className={
                                  action.danger ? "rr-danger-text" : ""
                                }
                              >
                                {action.detail}
                              </span>
                            </div>
                            <Link
                              className="rr-action-link"
                              to={action.link}
                              aria-label={`${action.action}: ${action.title}`}
                            >
                              {action.action}
                              <IconArrowRight size={16} />
                            </Link>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div className="rr-empty">
                        <IconShieldCheck size={28} />
                        <h3>{text("noActions")}</h3>
                        <p>{text("noActionsHelp")}</p>
                      </div>
                    )}
                    {actions.length > 0 && (
                      <div className="rr-list-footer">
                        <span>
                          {text("actionCount", {
                            shown: n(Math.min(actionLimit, actions.length)),
                            total: n(actions.length),
                          })}
                        </span>
                        {actions.length > actionLimit && (
                          <button
                            className="rr-link-button"
                            type="button"
                            onClick={() =>
                              setActionLimit((value) => value + 10)
                            }
                          >
                            {text("moreActions")}
                            <IconChevronDown size={15} />
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
                {view === "stories" && (
                  <>
                    <div className="rr-panel-heading">
                      <h2>{text("tab.stories")}</h2>
                      <p>{text("storiesHelp")}</p>
                    </div>
                    {!canStories ? (
                      <div className="rr-empty">
                        {text("source.unavailable")}
                      </div>
                    ) : model.hotspots.length ? (
                      <div className="rr-story-list">
                        <div className="rr-story-head">
                          <span>{text("storyColumn")}</span>
                          <span>{text("coverageColumn")}</span>
                          <span>{text("assessedColumn")}</span>
                          <span>{text("signalsColumn")}</span>
                        </div>
                        {model.hotspots.map((story) => (
                          <div className="rr-story-row" key={story.id}>
                            <div>
                              <span className="rr-action-meta">
                                {story.displayId}
                                {story.priority ? ` · P${story.priority}` : ""}
                              </span>
                              <Link
                                to={recordLink(
                                  "/stories",
                                  "requirement",
                                  story.id,
                                )}
                              >
                                {story.title}
                              </Link>
                            </div>
                            <div>
                              <span className="rr-mobile-label">
                                {text("coverageColumn")}
                              </span>
                              <strong>{n(story.coverageCount)}</strong>
                            </div>
                            <div>
                              <span className="rr-mobile-label">
                                {text("assessedColumn")}
                              </span>
                              {canRuns
                                ? `${n(story.executedCount)} / ${n(story.coverageCount)}`
                                : "—"}
                            </div>
                            <div className="rr-story-signals">
                              {!story.coverageCount && (
                                <span className="rr-badge is-warning">
                                  {text("noTests")}
                                </span>
                              )}
                              {story.failedCount > 0 && (
                                <span className="rr-badge is-danger">
                                  {text("failed", {
                                    count: n(story.failedCount),
                                  })}
                                </span>
                              )}
                              {story.openBugCount > 0 && (
                                <span className="rr-badge is-warning">
                                  {n(story.openBugCount)} {text("source.bugs")}
                                </span>
                              )}
                              {story.blockedCount > 0 && (
                                <span className="rr-badge is-warning">
                                  {text("blocked", {
                                    count: n(story.blockedCount),
                                  })}
                                </span>
                              )}
                              {!story.needsAttention && (
                                <span className="rr-muted">
                                  {text("noSignal")}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rr-empty">
                        <h3>{text("noStories")}</h3>
                        <p>{text("noStoriesHelp")}</p>
                      </div>
                    )}
                  </>
                )}
                {view === "runs" && (
                  <>
                    <div className="rr-panel-heading">
                      <h2>{text("tab.runs")}</h2>
                      <p>{text("runsHelp")}</p>
                    </div>
                    {!canRuns ? (
                      <div className="rr-empty">
                        {text("source.unavailable")}
                      </div>
                    ) : runs.length ? (
                      <div className="rr-runs">
                        {runs.map((run) => (
                          <article className="rr-run" key={run.execution.id}>
                            <div className="rr-run-heading">
                              <Link
                                to={recordLink(
                                  "/executions",
                                  "execution",
                                  run.execution.id,
                                )}
                              >
                                {run.execution.name || text("runName")}
                                <IconArrowRight size={16} />
                              </Link>
                              <StatusBadge value={run.execution.status} />
                            </div>
                            <div className="rr-run-context">
                              <span>
                                {text("environment")}:{" "}
                                {run.execution.test_environment?.name ||
                                  text("notRecorded")}
                              </span>
                              <span>
                                {text("configuration")}:{" "}
                                {run.execution.test_configuration?.name ||
                                  text("notRecorded")}
                              </span>
                              <span>
                                {formatDate(
                                  run.execution.started_at ||
                                    run.execution.created_at,
                                )}
                              </span>
                            </div>
                            <div className="rr-outcome-bar" aria-hidden="true">
                              {run.rows.length ? (
                                <>
                                  {run.passed > 0 && (
                                    <span
                                      className="is-passed"
                                      style={{ flex: run.passed }}
                                    />
                                  )}
                                  {run.failed > 0 && (
                                    <span
                                      className="is-failed"
                                      style={{ flex: run.failed }}
                                    />
                                  )}
                                  {run.unassessed > 0 && (
                                    <span
                                      className="is-unassessed"
                                      style={{ flex: run.unassessed }}
                                    />
                                  )}
                                </>
                              ) : (
                                <span className="is-unassessed" />
                              )}
                            </div>
                            <div className="rr-run-outcomes">
                              <span className="rr-passed-text">
                                {text("passed", { count: n(run.passed) })}
                              </span>
                              <span
                                className={run.failed ? "rr-danger-text" : ""}
                              >
                                {text("failed", { count: n(run.failed) })}
                              </span>
                              <span>
                                {text("notAssessed", {
                                  count: n(run.unassessed),
                                })}
                              </span>
                              <span>
                                {text("runCount", {
                                  count: n(run.rows.length),
                                })}
                              </span>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="rr-empty">
                        <h3>{text("noRuns")}</h3>
                        <p>{text("noRunsHelp")}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
            <aside className="rr-sidebar">
              <section className="rr-card">
                <h2>{text("checks")}</h2>
                <p>{text("checksHelp")}</p>
                <ul className="rr-checks">
                  {model.gates.map((gate) => (
                    <li key={gate.id}>
                      <span className={`rr-check-icon is-${gate.state}`}>
                        {gate.state === "pass" ? (
                          <IconCheck size={16} />
                        ) : (
                          <IconAlertTriangle size={16} />
                        )}
                      </span>
                      <div>
                        <span>{text(`check.${gate.id}`)}</span>
                        <small>{text(`check.${gate.state}`)}</small>
                      </div>
                      <strong>{n(gate.count)}</strong>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="rr-card rr-boundary">
                <h2>{text("sources")}</h2>
                <dl>
                  {sources.map((source) => (
                    <div key={source.id}>
                      <dt>{text(`source.${source.id}`)}</dt>
                      <dd>
                        {!source.enabled
                          ? text("source.unavailable")
                          : source.error
                            ? text("source.error")
                            : text("source.loaded", {
                                loaded: n(source.loaded),
                                total: n(source.total),
                              })}
                      </dd>
                    </div>
                  ))}
                  <div>
                    <dt>{text("source.runs")}</dt>
                    <dd>
                      {!canRuns
                        ? text("source.unavailable")
                        : runsQuery.isError
                          ? text("source.error")
                          : `${n(executions.length)} · ${n(model.metrics.outcomeCount)}`}
                    </dd>
                  </div>
                </dl>
                {sources.some((source) => source.enabled && source.more) && (
                  <button
                    className="rr-button"
                    type="button"
                    disabled={sources.some((source) => source.fetching)}
                    onClick={() => void loadMore()}
                  >
                    {text(
                      sources.some((source) => source.fetching)
                        ? "loadingMore"
                        : "loadMore",
                    )}
                  </button>
                )}
                <ul className="rr-boundary-notes">
                  {!release && !sprint && <li>{text("scopeNeeded")}</li>}
                  {(sources.some((source) => source.incomplete) ||
                    runsQuery.data?.complete === false) && (
                    <li>{text("bounded")}</li>
                  )}
                  {model.metrics.missingCaseDetailsCount > 0 && (
                    <li>
                      {text("missingDetails", {
                        count: n(model.metrics.missingCaseDetailsCount),
                      })}
                    </li>
                  )}
                  {model.metrics.missingIterationCount > 0 && (
                    <li>
                      {text("missingIterations", {
                        count: n(model.metrics.missingIterationCount),
                      })}
                    </li>
                  )}
                  {duplicateSprint && <li>{text("ambiguousSprint")}</li>}
                  {model.ageDays !== null && model.ageDays > 14 && (
                    <li>{text("stale")}</li>
                  )}
                </ul>
                <details>
                  <summary>
                    {text("window")}
                    <IconChevronDown size={14} />
                  </summary>
                  <p>
                    {text("windowDetail", {
                      runs: n(RUN_LIMIT),
                      results: n(RESULT_LIMIT),
                    })}
                  </p>
                </details>
              </section>
            </aside>
          </div>
          <details className="rr-methodology">
            <summary>
              <IconListCheck size={18} />
              {text("methodology")}
              <IconChevronDown size={16} />
            </summary>
            <p>{text("methodologyBody")}</p>
          </details>
        </>
      )}
      <AiInsightPreviewDialog
        showScore={false}
        open={Boolean(aiScope === aiKey && canAi)}
        onClose={() => setAiScope(null)}
        title={text("aiTitle")}
        eyebrow={text("title")}
        subtitle={text("aiScope", { release })}
        assuranceTitle={text("aiGrounding")}
        response={aiResponse}
        loading={ai.isPending}
        error={
          aiScope === aiKey && ai.error instanceof Error
            ? ai.error.message
            : null
        }
        summary={text("aiHelp")}
        findings={aiFindings}
        limitations={aiResponse?.limitations || []}
        gaps={sprint ? [text("explainHelp")] : []}
        emptyMessage={text("aiEmpty")}
      />
    </div>
  );
}
