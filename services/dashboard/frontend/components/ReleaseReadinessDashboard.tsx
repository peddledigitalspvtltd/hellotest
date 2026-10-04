import { capabilityView } from "@hellotest/platform/frontend/src/platform/capabilities/CapabilityView";
const AiLifecycleReview = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiLifecycleReview")["AiLifecycleReview"]>>("ai", "AiLifecycleReview", () => import("@hellotest/ai/frontend/components/AiLifecycleReview"), "AI review");
const AiInsightPreviewDialog = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiInsightPreviewDialog")["AiInsightPreviewDialog"]> & {}>("ai", "AiInsightPreviewDialog", () => import("@hellotest/ai/frontend/components/AiInsightPreviewDialog"), "AI insights");
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBug,
  IconChevronDown,
  IconEye,
  IconGitBranch,
  IconSearch,
  IconShieldCheck,
  IconTestPipe,
} from "@tabler/icons-react";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { useLocalization } from "@hellotest/platform/frontend/src/context/LocalizationContext";
import { useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import {
  deriveReleaseReadiness,
  isCriticalReadinessIssue,
  readinessDeliveryLabels,
  releaseReadinessScopeOptions,
} from "../lib/releaseReadiness";
import { ReadinessRecordExplorer } from "./ReadinessRecordExplorer";
import { deriveReadinessIndex } from "../lib/readinessIndex";
import { READINESS_MESSAGES } from "../lib/releaseReadinessMessages";
import {
  type AiPreviewFinding,
} from "@hellotest/ai/frontend/components/AiInsightPreviewDialog";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { HierarchyAutoLoadSentinel } from "@hellotest/testing/frontend/components/HierarchyLoadMoreButton";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import "./ReleaseReadinessDashboard.css";
import { ReleaseReadinessLayout } from "./ReleaseReadinessLayout";
import "./ReleaseReadinessLayout.css";

type View = "review" | "stories" | "runs" | "cases" | "bugs";
const EVIDENCE_VIEWS: View[] = ["review", "stories", "runs", "cases", "bugs"];
const FILTER_OPTIONS: Record<View, string[]> = {
  review: ["all", "urgent", "blocking", "critical", "bugs", "runs", "stories"],
  stories: [
    "all",
    "covered",
    "attention",
    "priority",
    "uncovered",
    "failed",
    "unassessed",
    "defects",
  ],
  runs: ["all", "failed", "blocked", "unassessed"],
  cases: [
    "all",
    "executed",
    "passed",
    "failed",
    "blocked",
    "unassessed",
    "not-run",
  ],
  bugs: ["all", "critical", "high", "linked"],
};
const clearEvidenceParams = (params: URLSearchParams) => {
  for (const key of ["view", "filter", "search", "story", "check"])
    params.delete(`evidence_${key}`);
};
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
  const authorizationKey = JSON.stringify([
    session?.user.id,
    session?.user.role,
    session?.user.status,
    session?.user.permissions,
    session?.user.workspace_permissions,
    session?.user.project_permissions,
    flags.data?.flags,
  ]);
  const dashboardGranted = hasPermission(session, "dashboard.view", projectId);
  const dashboardEnabled = areFeatureFlagsEnabled(flags.data, [
    "hellotest.analytics.dashboards",
  ]);
  const allowed = (permission: string, flag: string) =>
    dashboardGranted &&
    dashboardEnabled &&
    hasPermission(session, permission, projectId) &&
    areFeatureFlagsEnabled(flags.data, [flag]);
  const canStories = allowed(
    "requirement.view",
    "hellotest.manual.requirements",
  );
  const canCases = allowed("testcase.view", "hellotest.manual.test_cases");
  const canReleaseContext =
    canStories &&
    hasPermission(session, "requirement_iteration.view", projectId);
  const canBugs = allowed("feedback.view", "hellotest.manual.bugs");
  const canRuns =
    allowed("run.view", "hellotest.manual.runs") &&
    hasPermission(session, "result.view", projectId);
  const canProjects = allowed("project.view", "hellotest.ops.projects");
  const canAi =
    canStories &&
    canCases &&
    canBugs &&
    canRuns &&
    allowed("suite.view", "hellotest.manual.suites") &&
    allowed("quality_insight.view", "hellotest.ai.quality_insights");
  const canAgenticReview = canAi && hasPermission(session, "agentic_workflow.run", projectId) && areFeatureFlagsEnabled(flags.data, ["hellotest.ai.agentic_workflows"]);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedReleaseId = searchParams.get("release_id") || "";
  const requestedRelease = searchParams.get("release") || "";
  const requestedSprint = searchParams.get("sprint") || "";
  const releaseCatalog = useQuery({
    queryKey: ["release-review-release-catalog", authorizationKey, projectId],
    queryFn: () => api.requirementReleases.list({ project_id: projectId }),
    enabled: canReleaseContext, staleTime: 30_000, retry: 1,
  });
  const aiEnvironments = useQuery({
    queryKey: ["release-review-environments", authorizationKey, projectId],
    queryFn: () => api.testEnvironments.list({ project_id: projectId }),
    enabled: canAgenticReview && hasPermission(session, "environment.view", projectId), staleTime: 30_000, retry: false,
  });
  const aiModels = useQuery({
    queryKey: ["release-review-models", authorizationKey, projectId],
    queryFn: () => api.integrations.list({ type: "llm" }),
    enabled: canAgenticReview && hasPermission(session, "integration.view", projectId), staleTime: 30_000, retry: false,
  });
  const sprintCatalog = useQuery({
    queryKey: ["release-review-sprint-catalog", authorizationKey, projectId],
    queryFn: () => api.requirementIterations.list({ project_id: projectId }),
    enabled: canReleaseContext, staleTime: 30_000, retry: 1,
  });
  const nativeReleases = (Array.isArray(releaseCatalog.data) ? releaseCatalog.data : []).filter(item => item.project_id === projectId);
  const nativeSprints = (Array.isArray(sprintCatalog.data) ? sprintCatalog.data : []).filter(item => item.project_id === projectId);
  const matchingReleases = nativeReleases.filter(item => requestedRelease && (same(item.fix_version, requestedRelease) || same(item.name, requestedRelease)));
  const releaseId = requestedReleaseId || (matchingReleases.length === 1 ? matchingReleases[0].id : "");
  const hasReleaseScope = Boolean(releaseId || requestedRelease.trim());
  const matchingSprints = nativeSprints.filter(item => requestedSprint && same(item.name, requestedSprint));
  const iterationId = hasReleaseScope ? "" : searchParams.get("iteration_id") || (matchingSprints.length === 1 ? matchingSprints[0].id : "");
  const sprint = hasReleaseScope ? "" : nativeSprints.find(item => item.id === iterationId)?.name || requestedSprint;
  useEffect(() => {
    if (!hasReleaseScope || (!searchParams.has("sprint") && !searchParams.has("iteration_id"))) return;
    const next = new URLSearchParams(searchParams);
    next.delete("sprint");
    next.delete("iteration_id");
    setSearchParams(next, { replace: true, preventScrollReset: true });
  }, [hasReleaseScope, searchParams, setSearchParams]);
  const view: View = EVIDENCE_VIEWS.includes(
    searchParams.get("evidence_view") as View,
  )
    ? (searchParams.get("evidence_view") as View)
    : "review";
  const evidenceSearch = searchParams.get("evidence_search") || "";
  const evidenceFilter = FILTER_OPTIONS[view].includes(
    searchParams.get("evidence_filter") || "",
  )
    ? searchParams.get("evidence_filter")!
    : "all";
  const evidenceFilters = {
    review: "all",
    stories: "all",
    runs: "all",
    cases: "all",
    bugs: "all",
    [view]: evidenceFilter,
  };
  const selectedStoryId = searchParams.get("evidence_story") || "";
  const selectedCheckId = searchParams.get("evidence_check") || "";
  const updateEvidence = (patch: Record<string, string>, replace = false) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch))
      value
        ? next.set(`evidence_${key}`, value)
        : next.delete(`evidence_${key}`);
    setSearchParams(next, { replace, preventScrollReset: true });
  };
  const [evidenceFocus, setEvidenceFocus] = useState<{
    target: View;
    filter: string;
    story: string;
    scroll: boolean;
  } | null>(null);
  const [actionLimit, setActionLimit] = useState(6);
  const evidenceOpen = Boolean(searchParams.get("evidence_view"));
  const closeEvidence = () => {
    const next = new URLSearchParams(searchParams);
    clearEvidenceParams(next);
    setSearchParams(next, { preventScrollReset: true });
  };
  const [storyLimit, setStoryLimit] = useState(25);
  const [aiScope, setAiScope] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const tabId = useId();
  useEffect(() => {
    setStoryLimit(25);
    setActionLimit(6);
  }, [evidenceSearch, evidenceFilter, releaseId, requestedRelease, sprint]);
  const projects = useQuery({
    queryKey: ["release-review-projects", authorizationKey],
    queryFn: () => api.projects.list(),
    enabled: canProjects,
    staleTime: 60_000,
  });
  const context = useQuery({
    queryKey: [
      "release-review-context",
      authorizationKey,
      projectId,
      releaseId,
    ],
    queryFn: () => api.requirementReleases.get(releaseId),
    enabled: Boolean(releaseId && canReleaseContext),
    staleTime: 30_000,
    retry: 1,
  });
  const validContext =
    context.data && String(context.data.project_id) === projectId
      ? context.data
      : null;
  const invalidContext = Boolean(
    releaseId &&
      (!canReleaseContext ||
        context.isError ||
        validContext?.story_scope_visible === false ||
        (context.data && !validContext)),
  );
  const release = validContext?.fix_version || requestedRelease;
  const contextReady = !releaseId || Boolean(validContext && validContext.story_scope_visible !== false);
  useEffect(() => {
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
    queryKey: [
      "release-review-runs",
      authorizationKey,
      projectId,
      releaseId,
      iterationId,
      release,
      sprint,
    ],
    queryFn: () =>
      api.executionResults.releaseReadiness({
        project_id: projectId,
        ...(releaseId ? { release_id: releaseId } : {}),
        ...(iterationId ? { iteration_id: iterationId } : {}),
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
          ? (validContext.requirements || [])
              .filter((item) => String(item.project_id) === projectId)
          : unique(
              storiesQuery.data?.pages.flatMap((page) => page.items) || [],
            ).filter((item) => String(item.project_id) === projectId)
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
      total:
        validContext?.requirement_count ??
        storiesQuery.data?.pages[0]?.total ??
        0,
      incomplete: validContext
        ? validContext.requirement_count === null || requirements.length < validContext.requirement_count
        : storiesQuery.data?.pages.slice(-1)[0]?.is_last === false,
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
  const failed =
    flags.isError ||
    sources.some((item) => item.enabled && item.error) ||
    (canRuns && runsQuery.isError);
  const incomplete =
    flags.isError ||
    Boolean(canReleaseContext && ((hasReleaseScope && (releaseCatalog.isPending || releaseCatalog.isError || sprintCatalog.isPending || sprintCatalog.isError)) || (!hasReleaseScope && (iterationId || requestedSprint) && (sprintCatalog.isPending || sprintCatalog.isError)))) ||
    matchingReleases.length > 1 && !requestedReleaseId ||
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
    !iterationId && sprint &&
      new Set(
        requirements
          .filter(
            (item) =>
              same(item.sprint, sprint) &&
              (!release || same(item.fix_version || item.release, release)),
          )
          .map((item) => item.iteration_id || item.sprint_id)
          .filter(Boolean),
      ).size > 1,
  );
  const model = useMemo(
    () =>
      deriveReleaseReadiness({
        release,
        sprint,
        iterationId,
        ...readinessDeliveryLabels(validContext, nativeReleases, nativeSprints, iterationId),
        // A legacy text-only release keeps its exact label scope. Once native
        // membership is available, only its unambiguous aliases are accepted.
        ...(!validContext ? { releaseAliases: undefined } : {}),
        ...(validContext ? { scopedRequirementIds: validContext.requirement_ids || requirements.map(item => item.id) } : {}),
        ...(releaseId || iterationId ? { scopedExecutionIds: executions.map(item => item.id) } : {}),
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
      iterationId,
      releaseId,
      validContext,
      releaseCatalog.data,
      sprintCatalog.data,
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
  const readinessIndex = deriveReadinessIndex(model, {
    sourcesAvailable: canStories && canCases && canRuns && canBugs && !failed,
    evidenceComplete: !provisional,
    scoped: Boolean(release || sprint),
  });
  const scopeOptions = useMemo(
    () => {
      const options = releaseReadinessScopeOptions(requirements, executions, issues);
      const releases = nativeReleases.map(item => ({value: item.id, label: nativeReleases.filter(other => same(other.fix_version,item.fix_version)).length > 1 ? `${item.name} · ${item.fix_version}` : item.fix_version}));
      const sprints = nativeSprints.map(item => ({value: item.id, label: nativeSprints.filter(other => same(other.name,item.name)).length > 1 ? `${item.name} · ${item.display_id || item.id}` : item.name}));
      for (const value of new Set([release, ...options.releases].filter(Boolean))) {
        if (!nativeReleases.some(item => same(item.fix_version,value) || same(item.name,value))) releases.push({value,label:value});
      }
      for (const value of new Set([sprint, ...options.sprints].filter(Boolean))) {
        if (!nativeSprints.some(item => same(item.name,value))) sprints.push({value,label:value});
      }
      return {releases: releases.sort((a,b) => a.label.localeCompare(b.label)), sprints: sprints.sort((a,b) => a.label.localeCompare(b.label))};
    },
    [requirements, executions, issues, releaseCatalog.data, sprintCatalog.data, release, sprint],
  );
  const projectName = (
    canProjects && Array.isArray(projects.data) ? projects.data : []
  ).find((item) => String(item.id) === projectId)?.name;
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
  useEffect(() => {
    setAiScope(null);
    ai.reset();
  }, [authorizationKey]);
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
            blocking: isCriticalReadinessIssue(issue),
            priority: isCriticalReadinessIssue(issue)
              ? 0
              : /high/i.test(`${issue.severity || ""} ${issue.priority || ""}`)
                ? 1
                : 4,
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
        blocking: run.blocked > 0,
        priority: run.failed || run.blocked ? 1 : 3,
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
            blocking: !story.coverageCount && Number(story.priority || 3) <= 2,
            priority:
              !story.coverageCount && Number(story.priority || 3) <= 2
                ? 1
                : !story.coverageCount
                  ? 2
                  : 3,
          }))
      : []),
  ].sort((left, right) => left.priority - right.priority);
  const loading =
    flags.isPending ||
    Boolean(releaseId && canReleaseContext && context.isPending) ||
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
        ...(canReleaseContext ? [releaseCatalog.refetch(), sprintCatalog.refetch()] : []),
        ...(releaseId && canReleaseContext ? [context.refetch()] : []),
        ...(canStories && contextReady && !validContext
          ? [storiesQuery.refetch()]
          : []),
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
  const applyScope = (nextRelease: string, nextSprint: string) => {
    if (nextRelease.trim()) nextSprint = "";
    const selectedReleaseById = nativeReleases.find(item => item.id === nextRelease);
    const selectedSprintById = nativeSprints.find(item => item.id === nextSprint);
    if (selectedReleaseById) nextRelease = selectedReleaseById.fix_version;
    if (selectedSprintById) nextSprint = selectedSprintById.name;
    const next = new URLSearchParams(searchParams);
    clearEvidenceParams(next);
    next.delete("release_id");
    next.delete("iteration_id");
    const selectedReleases = nativeReleases.filter(item => nextRelease.trim() && (same(item.fix_version, nextRelease) || same(item.name, nextRelease)));
    const selectedSprints = nativeSprints.filter(item => nextSprint.trim() && same(item.name, nextSprint));
    if (selectedReleaseById) next.set("release_id", selectedReleaseById.id);
    else if (releaseId && same(nextRelease, release)) next.set("release_id", releaseId);
    else if (selectedReleases.length === 1) next.set("release_id", selectedReleases[0].id);
    if (selectedSprintById) next.set("iteration_id", selectedSprintById.id);
    else if (iterationId && same(nextSprint, sprint)) next.set("iteration_id", iterationId);
    else if (selectedSprints.length === 1) next.set("iteration_id", selectedSprints[0].id);
    nextRelease.trim()
      ? next.set("release", nextRelease.trim())
      : next.delete("release");
    nextSprint.trim()
      ? next.set("sprint", nextSprint.trim())
      : next.delete("sprint");
    setSearchParams(next);
  };
  const clearContext = () => {
    const next = new URLSearchParams(searchParams);
    clearEvidenceParams(next);
    next.delete("release_id");
    setSearchParams(next);
  };
  const tabs = EVIDENCE_VIEWS;
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
    openEvidence(tabs[next], "all", { scroll: false });
    document.getElementById(`${tabId}-${tabs[next]}`)?.focus();
  };
  const searchMatches = (...values: unknown[]) =>
    values
      .join(" ")
      .toLocaleLowerCase()
      .includes(evidenceSearch.trim().toLocaleLowerCase());
  const visibleActions = actions.filter(
    (action) =>
      searchMatches(action.title, action.label, action.detail) &&
      (evidenceFilters.review === "all" ||
        (evidenceFilters.review === "blocking" && action.blocking) ||
        (evidenceFilters.review === "urgent" && action.priority <= 1) ||
        (evidenceFilters.review === "critical" &&
          action.kind === "bug" &&
          action.priority === 0) ||
        evidenceFilters.review ===
          (action.kind === "story" ? "stories" : `${action.kind}s`)),
  );
  const visibleStories = model.hotspots.filter(
    (story) =>
      searchMatches(story.title, story.displayId) &&
      (evidenceFilters.stories === "all" ||
        (evidenceFilters.stories === "covered" && story.coverageCount > 0) ||
        (evidenceFilters.stories === "attention" && story.needsAttention) ||
        (evidenceFilters.stories === "uncovered" && !story.coverageCount) ||
        (evidenceFilters.stories === "priority" &&
          !story.coverageCount &&
          Number(story.priority || 3) <= 2) ||
        (evidenceFilters.stories === "failed" &&
          (story.failedCount > 0 || story.blockedCount > 0)) ||
        (evidenceFilters.stories === "unassessed" &&
          story.executedCount < story.coverageCount) ||
        (evidenceFilters.stories === "defects" && story.openBugCount > 0)),
  );
  const visibleRuns = runs.filter(
    (run) =>
      searchMatches(
        run.execution.name,
        run.execution.test_environment?.name,
        run.execution.test_configuration?.name,
      ) &&
      (evidenceFilters.runs === "all" ||
        (evidenceFilters.runs === "failed" && run.failed > 0) ||
        (evidenceFilters.runs === "blocked" &&
          (run.blocked > 0 || run.paused > 0)) ||
        (evidenceFilters.runs === "unassessed" && run.unassessed > 0)),
  );
  const selectedStory =
    visibleStories.find((story) => story.id === selectedStoryId) ||
    visibleStories[0];
  const selectedCheck = model.gates.find((gate) => gate.id === selectedCheckId);
  const filterOptions = FILTER_OPTIONS;
  const visibleCount =
    view === "review"
      ? visibleActions.length
      : view === "stories"
        ? visibleStories.length
        : visibleRuns.length;
  const totalCount =
    view === "review"
      ? actions.length
      : view === "stories"
        ? model.hotspots.length
        : runs.length;
  const openEvidence = (
    target: View,
    filter = "all",
    context: { story?: string; check?: string; scroll?: boolean } = {},
  ) => {
    updateEvidence({
      view: target,
      filter: filter === "all" ? "" : filter,
      search: "",
      story: context.story || "",
      check: context.check || "",
    });
    setActionLimit(6);
    setEvidenceFocus({
      target,
      filter,
      story: context.story || "",
      scroll: context.scroll !== false,
    });
  };
  const inspectStory = (id: string) => {
    updateEvidence({ story: id });
    if (window.matchMedia("(max-width: 980px)").matches) {
      requestAnimationFrame(() => {
        const inspector = document.getElementById(
          `${tabId}-story-inspector-panel`,
        );
        inspector?.focus({ preventScroll: true });
        inspector?.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
        });
      });
    }
  };
  const checkAvailable = (id: string) =>
    id === "critical-defects"
      ? canBugs
      : id === "priority-coverage"
        ? canStories && canCases
        : id === "remaining-evidence"
          ? canStories && canCases && canRuns
          : canRuns;
  const inspectCheck = (id: string) => {
    if (id === "critical-defects")
      openEvidence("bugs", "critical", { check: id });
    else if (id === "priority-coverage")
      openEvidence("stories", "priority", { check: id });
    else if (id === "remaining-evidence")
      openEvidence("cases", "unassessed", { check: id });
    else
      openEvidence(
        "runs",
        id === "failed-outcomes"
          ? "failed"
          : id === "blocked-evidence"
            ? "blocked"
            : "all",
        { check: id },
      );
  };
  // Router navigation can commit after the click handler. Focus only after the
  // requested view and selection have rendered, so mobile Story links find the inspector.
  useEffect(() => {
    if (
      !evidenceFocus ||
      view !== evidenceFocus.target ||
      evidenceFilter !== evidenceFocus.filter ||
      selectedStoryId !== evidenceFocus.story
    )
      return;
    const inspector =
      evidenceFocus.story && window.matchMedia("(max-width: 980px)").matches
        ? document.getElementById(`${tabId}-story-inspector-panel`)
        : null;
    const target = inspector || document.getElementById(`${tabId}-${view}`);
    target?.focus({ preventScroll: true });
    if (evidenceFocus.scroll)
      target?.scrollIntoView({
        block: "start",
        inline: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    setEvidenceFocus(null);
  }, [evidenceFocus, view, evidenceFilter, selectedStoryId, tabId]);
  useEffect(() => {
    const strip = document.getElementById(`${tabId}-tabs`);
    if (!strip) return;
    const revealActiveTab = () => {
      const active = document.getElementById(`${tabId}-${view}`);
      if (!active) return;
      const bounds = strip.getBoundingClientRect();
      const tab = active.getBoundingClientRect();
      const shift =
        tab.left < bounds.left
          ? tab.left - bounds.left
          : tab.right > bounds.right
            ? tab.right - bounds.right
            : 0;
      if (shift) strip.scrollLeft += shift;
    };
    const observer = new ResizeObserver(revealActiveTab);
    observer.observe(strip);
    revealActiveTab();
    return () => observer.disconnect();
  }, [view, evidenceOpen, loading, invalidContext, tabId, flags.data]);
  const exportEvidence = () => {
    const evaluatedAt = new Date().toISOString();
    const snapshot = {
      schema_version: 2,
      evaluated_at: evaluatedAt,
      readiness_index: readinessIndex,
      scope: {
        project_id: projectId,
        release_id: releaseId || null,
        ...(iterationId ? { iteration_id: iterationId } : {}),
        release: release || null,
        sprint: sprint || null,
      },
      assessment: {
        state: model.decisionState,
        provisional,
        latest_evidence_at: model.latestEvidenceAt,
        approval:
          "Human review required; this report does not approve a release.",
      },
      source_limits: {
        page_size: PAGE_SIZE,
        maximum_pages: MAX_PAGES,
        run_limit: RUN_LIMIT,
        result_attempt_limit: RESULT_LIMIT,
      },
      sources: [
        ...sources.map((source) => ({
          source: source.id,
          available: source.enabled,
          status: !source.enabled
            ? "unavailable"
            : source.error
              ? "error"
              : source.incomplete
                ? "partial"
                : "complete",
          loaded: source.enabled ? source.loaded : null,
          total: source.enabled ? source.total : null,
        })),
        {
          source: "runs",
          available: canRuns,
          status: !canRuns
            ? "unavailable"
            : runsQuery.isError
              ? "error"
              : runsQuery.data?.complete
                ? "complete"
                : "partial",
          loaded: canRuns ? executions.length : null,
          total: null,
        },
      ],
      metrics: {
        story_coverage:
          canStories && canCases
            ? {
                percent: model.metrics.coverage,
                covered: model.metrics.coveredRequirementCount,
                stories: model.metrics.requirementCount,
              }
            : null,
        cases_assessed:
          canStories && canCases && canRuns
            ? {
                percent: model.metrics.completion,
                assessed: model.metrics.executedCaseCount,
                planned: model.metrics.plannedCaseCount,
              }
            : null,
        passing_outcomes: canRuns
          ? {
              percent: model.metrics.passRate,
              passed: model.metrics.passedCount,
              failed: model.metrics.failedCount,
              blocked: model.metrics.blockedCount,
            }
          : null,
        open_defects: canBugs
          ? {
              count: model.metrics.openBugCount,
              critical: model.metrics.openCriticalBugCount,
              high: model.metrics.openHighBugCount,
            }
          : null,
      },
      case_evidence: canCases
        ? model.caseEvidence.map((item) => ({
            id: item.id,
            title: item.title,
            story_ids: canStories ? item.storyIds : [],
            run_ids: canRuns ? item.runIds : [],
            status: canRuns ? item.status : null,
            missing_rows: canRuns ? item.missingRows : null,
            details_available: item.detailsAvailable,
          }))
        : [],
      checks: model.gates.map((gate) => ({
        ...gate,
        count: checkAvailable(gate.id) ? gate.count : null,
        available: checkAvailable(gate.id),
      })),
      stories: canStories
        ? model.hotspots.map((story) => ({
            id: story.id,
            display_id: story.displayId,
            title: story.title,
            priority: story.priority,
            test_case_ids: canCases ? story.caseIds : [],
            run_ids: canRuns ? story.runIds : [],
            open_defect_ids: canBugs ? story.openIssueIds : [],
          }))
        : [],
      runs: canRuns
        ? runs.map((run) => ({
            id: run.execution.id,
            name: run.execution.name,
            status: run.execution.status,
            build: run.execution.build || null,
            data_set: run.execution.test_data_set?.name || null,
            environment: run.execution.test_environment?.name || null,
            configuration: run.execution.test_configuration?.name || null,
            passed: run.passed,
            failed: run.failed,
            blocked: run.blocked,
            unassessed: run.unassessed,
            outcomes: run.rows.map((row) => ({
              id: row.id,
              test_case_id: row.test_case_id,
              status: row.status,
              test_data_set_id: row.test_data_set_id || null,
              data_set_iteration_key: row.data_set_iteration_key ?? null,
              data_set_iteration_index: row.data_set_iteration_index ?? null,
              created_at: row.created_at,
            })),
          }))
        : [],
      open_defects: canBugs
        ? model.openIssues.map((issue) => ({
            id: issue.id,
            key: issue.jira_bug_key || null,
            title: issue.title,
            severity: issue.severity,
            priority: issue.priority,
          }))
        : [],
      methodology: text("methodologyBody"),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `release-evidence-${evaluatedAt.slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (!dashboardGranted || (flags.data && !dashboardEnabled))
    return (
      <div className="release-review">
        <div className="rr-empty">
          <h2>
            {t(
              dashboardGranted ? "access.disabledTitle" : "access.deniedTitle",
            )}
          </h2>
          <p>
            {t(dashboardGranted ? "access.disabledHelp" : "access.deniedHelp")}
          </p>
        </div>
      </div>
    );
  return (
    <div className="release-review rr-reference-layout">
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
          <ReleaseReadinessLayout
            aiReviewContent={canAgenticReview ? <AiLifecycleReview projectId={projectId} inputs={{ release_id: releaseId || undefined }} features={["release-readiness", "risk-prediction", "release-risk-simulation", "quality-graph"]} title="AI release review" environments={aiEnvironments.data || []} integrations={aiModels.data || []} /> : null}
            model={model}
            readinessIndex={readinessIndex}
            projectName={projectName}
            release={release}
            sprint={sprint}
            scopeOptions={scopeOptions}
            releaseSelection={releaseId || release}
            sprintSelection={iterationId || sprint}
            canStories={canStories}
            canCases={canCases}
            canRuns={canRuns}
            canBugs={canBugs}
            canAi={Boolean(canAi && release && contextReady)}
            aiPending={ai.isPending}
            refreshing={refreshing}
            text={text}
            onScopeChange={applyScope}
            onEvidence={openEvidence}
            onInspectCheck={inspectCheck}
            onExplain={() => {
              ai.reset();
              setAiScope(aiKey);
              ai.mutate({ project_id: projectId, release, key: aiKey });
            }}
            onRefresh={() => void refresh()}
            onExport={exportEvidence}
            sourceDetails={
              <>
                {" "}
                <section
                  className="rr-card rr-boundary"
                  id={`${tabId}-sources`}
                  tabIndex={-1}
                >
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
                    <HierarchyAutoLoadSentinel
                      error={sources.some(
                        (source) =>
                          source.enabled && source.more && source.error,
                      )}
                      isLoading={sources.some((source) => source.fetching)}
                      onLoad={loadMore}
                      progressKey={sources
                        .map((source) => `${source.id}:${source.loaded}`)
                        .join(":")}
                      scopeLabel="evidence"
                    />
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
              </>
            }
            evidenceOpen={evidenceOpen}
            onCloseEvidence={closeEvidence}
          >
            <div className="rr-workspace">
              <section className="rr-evidence">
                <div
                  className="rr-tabs"
                  id={`${tabId}-tabs`}
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
                      onClick={() =>
                        openEvidence(item, "all", { scroll: false })
                      }
                    >
                      {text(`tab.${item}`)}
                      <span>
                        {(item === "stories" && !canStories) ||
                        (item === "runs" && !canRuns) ||
                        (item === "cases" && !canCases) ||
                        (item === "bugs" && !canBugs)
                          ? "—"
                          : n(
                              item === "stories"
                                ? model.requirements.length
                                : item === "runs"
                                  ? runs.length
                                  : item === "cases"
                                    ? model.caseEvidence.length
                                    : item === "bugs"
                                      ? model.openIssues.length
                                      : actions.length,
                            )}
                      </span>
                    </button>
                  ))}
                </div>
                {selectedCheck && (
                  <div className="rr-check-detail" aria-live="polite">
                    <strong>{text(`check.${selectedCheck.id}`)}</strong>
                    <p>{text(`checkHelp.${selectedCheck.id}`)}</p>
                    {provisional && <p>{text("partialHelp")}</p>}
                    {selectedCheck.id === "remaining-evidence" && canRuns && (
                      <button
                        className="rr-link-button"
                        type="button"
                        onClick={() => openEvidence("runs", "unassessed")}
                      >
                        {text("inspectRemainingRuns")}
                        <IconArrowRight size={14} />
                      </button>
                    )}
                  </div>
                )}
                <div className="rr-evidence-toolbar">
                  <label className="rr-search">
                    <IconSearch size={17} />
                    <input
                      type="search"
                      aria-label={text("searchEvidence")}
                      placeholder={text("searchEvidence")}
                      value={evidenceSearch}
                      onChange={(event) =>
                        updateEvidence({ search: event.target.value }, true)
                      }
                    />
                  </label>
                  <select
                    aria-label={text("filterEvidence")}
                    value={evidenceFilters[view]}
                    onChange={(event) =>
                      updateEvidence(
                        {
                          filter:
                            event.target.value === "all"
                              ? ""
                              : event.target.value,
                          check: "",
                        },
                        true,
                      )
                    }
                  >
                    {filterOptions[view].map((option) => (
                      <option key={option} value={option}>
                        {text(
                          view === "cases" && option === "blocked"
                            ? "explorer.caseStatus.blocked"
                            : view === "stories" && option === "failed"
                              ? "filter.failedOrBlocked"
                              : `filter.${option}`,
                        )}
                      </option>
                    ))}
                  </select>
                  {(evidenceSearch || evidenceFilters[view] !== "all") && (
                    <button
                      className="rr-link-button"
                      type="button"
                      onClick={() =>
                        updateEvidence(
                          { search: "", filter: "", check: "" },
                          true,
                        )
                      }
                    >
                      {text("clearFilters")}
                    </button>
                  )}
                  {view !== "cases" && view !== "bugs" && (
                    <span className="rr-filter-count" aria-live="polite">
                      {text("matching", {
                        shown: n(visibleCount),
                        total: n(totalCount),
                      })}
                    </span>
                  )}
                </div>
                <div
                  role="tabpanel"
                  tabIndex={0}
                  id={`${tabId}-panel-${view}`}
                  aria-labelledby={`${tabId}-${view}`}
                  className="rr-panel"
                >
                  {(view === "cases" || view === "bugs") && (
                    <ReadinessRecordExplorer
                      kind={view}
                      model={model}
                      projectId={projectId}
                      filter={evidenceFilter}
                      search={evidenceSearch}
                      canStories={canStories}
                      canCases={canCases}
                      canRuns={canRuns}
                      canBugs={canBugs}
                      text={text}
                      onInspectStory={(id) =>
                        openEvidence("stories", "all", { story: id })
                      }
                    />
                  )}
                  {view === "review" && (
                    <>
                      <div className="rr-panel-heading">
                        <h2>{text("actions")}</h2>
                        <p>{text("actionsHelp")}</p>
                      </div>
                      {visibleActions.length ? (
                        <ol className="rr-actions">
                          {visibleActions
                            .slice(0, actionLimit)
                            .map((action, index) => (
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
                          <h3>
                            {text(actions.length ? "noMatches" : "noActions")}
                          </h3>
                          <p>
                            {text(
                              actions.length ? "refineSearch" : "noActionsHelp",
                            )}
                          </p>
                        </div>
                      )}
                      {visibleActions.length > 0 && (
                        <div className="rr-list-footer">
                          <span>
                            {text("actionCount", {
                              shown: n(
                                Math.min(actionLimit, visibleActions.length),
                              ),
                              total: n(visibleActions.length),
                            })}
                          </span>
                          {visibleActions.length > actionLimit && (
                            <HierarchyAutoLoadSentinel
                              isLoading={false}
                              onLoad={() =>
                                setActionLimit((value) => value + 10)
                              }
                              progressKey={actionLimit}
                              scopeLabel="actions"
                            />
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
                      ) : visibleStories.length ? (
                        <div className="rr-story-list">
                          <div className="rr-story-head">
                            <span>{text("storyColumn")}</span>
                            <span>{text("coverageColumn")}</span>
                            <span>{text("assessedColumn")}</span>
                            <span>{text("signalsColumn")}</span>
                          </div>
                          {visibleStories.slice(0, storyLimit).map((story) => (
                            <div
                              className={`rr-story-row${selectedStory?.id === story.id ? " is-selected" : ""}`}
                              key={story.id}
                            >
                              <div>
                                <span className="rr-action-meta">
                                  {story.displayId}
                                  {story.priority
                                    ? ` · P${story.priority}`
                                    : ""}
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
                                <button
                                  className="rr-story-inspect"
                                  type="button"
                                  aria-pressed={selectedStory?.id === story.id}
                                  onClick={() => inspectStory(story.id)}
                                  aria-label={`${text("inspectStory")}: ${story.title}`}
                                >
                                  <IconEye size={14} />
                                  {text("inspectStory")}
                                </button>
                              </div>
                              <div>
                                <span className="rr-mobile-label">
                                  {text("coverageColumn")}
                                </span>
                                <strong>
                                  {canCases ? n(story.coverageCount) : "—"}
                                </strong>
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
                                {canCases && !story.coverageCount && (
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
                                    {n(story.openBugCount)}{" "}
                                    {text("source.bugs")}
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
                          {visibleStories.length > storyLimit && (
                            <HierarchyAutoLoadSentinel
                              isLoading={false}
                              onLoad={() =>
                                setStoryLimit((value) => value + 25)
                              }
                              progressKey={storyLimit}
                              scopeLabel="stories"
                            />
                          )}
                        </div>
                      ) : (
                        <div className="rr-empty">
                          <h3>
                            {text(
                              model.hotspots.length ? "noMatches" : "noStories",
                            )}
                          </h3>
                          <p>
                            {text(
                              model.hotspots.length
                                ? "refineSearch"
                                : "noStoriesHelp",
                            )}
                          </p>
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
                      ) : visibleRuns.length ? (
                        <div className="rr-runs">
                          {visibleRuns.map((run) => (
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
                                  {text("build")}:{" "}
                                  {run.execution.build || text("notRecorded")}
                                </span>
                                {run.execution.test_data_set?.name && (
                                  <span>
                                    {text("dataSet")}:{" "}
                                    {run.execution.test_data_set.name}
                                  </span>
                                )}
                                <span>
                                  {formatDate(
                                    run.execution.started_at ||
                                      run.execution.created_at,
                                  )}
                                </span>
                              </div>
                              <div
                                className="rr-outcome-bar"
                                aria-hidden="true"
                              >
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
                              <details className="rr-run-result-detail">
                                <summary>
                                  {text("runRows")}
                                  <span>
                                    {n(run.rows.length)}
                                    <IconChevronDown size={14} />
                                  </span>
                                </summary>
                                {run.rows.length > 0 && (
                                  <div className="rr-result-table-scroll">
                                    <table className="rr-result-table">
                                      <thead>
                                        <tr>
                                          <th>{text("explorer.case")}</th>
                                          <th>{text("rowColumn")}</th>
                                          <th>{text("outcomeColumn")}</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {run.rows.map((row) => (
                                          <tr key={row.id}>
                                            <td>
                                              {canCases ? (
                                                <Link
                                                  to={recordLink(
                                                    "/test-cases",
                                                    "case",
                                                    row.test_case_id,
                                                  )}
                                                >
                                                  {model.caseEvidence.find(
                                                    (item) =>
                                                      item.id ===
                                                      row.test_case_id,
                                                  )?.title || row.test_case_id}
                                                </Link>
                                              ) : (
                                                text("source.unavailable")
                                              )}
                                            </td>
                                            <td>
                                              <span>
                                                {row.data_set_iteration_key ||
                                                  (row.data_set_iteration_index !=
                                                  null
                                                    ? text("explorer.dataRow", {
                                                        number: n(
                                                          row.data_set_iteration_index +
                                                            1,
                                                        ),
                                                      })
                                                    : text(
                                                        "explorer.defaultRow",
                                                      ))}
                                              </span>
                                              <small>{row.id}</small>
                                              {(row.test_data_set_name ||
                                                row.test_data_set_id) && (
                                                <small>
                                                  {text("dataSet")}:{" "}
                                                  {row.test_data_set_name ||
                                                    row.test_data_set_id}
                                                </small>
                                              )}
                                            </td>
                                            <td>
                                              <StatusBadge value={row.status} />
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                                {(model.missingRowsByRun.get(
                                  run.execution.id,
                                ) || 0) > 0 && (
                                  <p>
                                    {text("runMissing", {
                                      count: n(
                                        model.missingRowsByRun.get(
                                          run.execution.id,
                                        ) || 0,
                                      ),
                                    })}
                                  </p>
                                )}
                              </details>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="rr-empty">
                          <h3>{text(runs.length ? "noMatches" : "noRuns")}</h3>
                          <p>
                            {text(runs.length ? "refineSearch" : "noRunsHelp")}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>
              {view === "stories" && (
                <aside className="rr-sidebar">
                  {view === "stories" && selectedStory && (
                    <section
                      className="rr-card rr-story-inspector"
                      id={`${tabId}-story-inspector-panel`}
                      aria-labelledby={`${tabId}-story-inspector`}
                      tabIndex={-1}
                    >
                      <div className="rr-inspector-heading">
                        <IconEye size={18} />
                        <h2 id={`${tabId}-story-inspector`}>
                          {text("storyInspector")}
                        </h2>
                      </div>
                      <span className="rr-action-meta">
                        {selectedStory.displayId}
                        {selectedStory.priority
                          ? ` · P${selectedStory.priority}`
                          : ""}
                      </span>
                      <h3 aria-live="polite">{selectedStory.title}</h3>
                      <ul className="rr-story-reasons">
                        {canCases && !selectedStory.coverageCount && (
                          <li>
                            {text(
                              Number(selectedStory.priority || 3) <= 2
                                ? "priorityReason"
                                : "noTests",
                            )}
                          </li>
                        )}
                        {canRuns && selectedStory.failedCount > 0 && (
                          <li>
                            {text("failed", {
                              count: n(selectedStory.failedCount),
                            })}
                          </li>
                        )}
                        {canRuns && selectedStory.blockedCount > 0 && (
                          <li>
                            {text("blocked", {
                              count: n(selectedStory.blockedCount),
                            })}
                          </li>
                        )}
                        {canBugs && selectedStory.openBugCount > 0 && (
                          <li>
                            {n(selectedStory.openBugCount)}{" "}
                            {text("metric.defects")}
                          </li>
                        )}
                      </ul>
                      <div className="rr-inspector-metrics">
                        <div>
                          <strong>
                            {canCases ? n(selectedStory.coverageCount) : "—"}
                          </strong>
                          <span>{text("coverageColumn")}</span>
                        </div>
                        <div>
                          <strong>
                            {canCases && canRuns
                              ? n(selectedStory.executedCount)
                              : "—"}
                          </strong>
                          <span>{text("assessedColumn")}</span>
                        </div>
                        <div>
                          <strong>
                            {canRuns
                              ? n(
                                  selectedStory.failedCount +
                                    selectedStory.blockedCount,
                                )
                              : "—"}
                          </strong>
                          <span>{text("failedBlocked")}</span>
                        </div>
                        <div>
                          <strong>
                            {canBugs ? n(selectedStory.openBugCount) : "—"}
                          </strong>
                          <span>{text("metric.defects")}</span>
                        </div>
                      </div>
                      {canCases && (
                        <details className="rr-inspector-links">
                          <summary>
                            {text("coverageColumn")}
                            <span>
                              {n(selectedStory.caseIds.length)}
                              <IconChevronDown size={14} />
                            </span>
                          </summary>
                          {selectedStory.caseIds.length ? (
                            <ul>
                              {selectedStory.caseIds.map((id) => (
                                <li key={id}>
                                  <Link
                                    to={recordLink("/test-cases", "case", id)}
                                  >
                                    {model.testCases.find(
                                      (item) => item.id === id,
                                    )?.title || id}
                                    <IconArrowRight size={13} />
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>{text("noTests")}</p>
                          )}
                        </details>
                      )}
                      {canRuns && (
                        <details className="rr-inspector-links">
                          <summary>
                            {text("tab.runs")}
                            <span>
                              {n(selectedStory.runIds.length)}
                              <IconChevronDown size={14} />
                            </span>
                          </summary>
                          {selectedStory.runIds.length ? (
                            <ul>
                              {selectedStory.runIds.map((id) => (
                                <li key={id}>
                                  <Link
                                    to={recordLink(
                                      "/executions",
                                      "execution",
                                      id,
                                    )}
                                  >
                                    {model.executions.find(
                                      (item) => item.id === id,
                                    )?.name || id}
                                    <IconArrowRight size={13} />
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>{text("noLinkedRuns")}</p>
                          )}
                        </details>
                      )}
                      {canBugs && (
                        <details className="rr-inspector-links">
                          <summary>
                            {text("metric.defects")}
                            <span>
                              {n(selectedStory.openIssueIds.length)}
                              <IconChevronDown size={14} />
                            </span>
                          </summary>
                          {selectedStory.openIssueIds.length ? (
                            <ul>
                              {selectedStory.openIssueIds.map((id) => (
                                <li key={id}>
                                  <Link to={recordLink("/issues", "issue", id)}>
                                    {model.openIssues.find(
                                      (item) => item.id === id,
                                    )?.title || id}
                                    <IconArrowRight size={13} />
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>{text("noSignal")}</p>
                          )}
                        </details>
                      )}
                      <Link
                        className="rr-button rr-inspector-open"
                        to={recordLink(
                          "/stories",
                          "requirement",
                          selectedStory.id,
                        )}
                      >
                        {text("openStory")}
                        <IconArrowRight size={15} />
                      </Link>
                      {provisional && (
                        <p className="rr-inspector-note">
                          {text("inspectorPartial")}
                        </p>
                      )}
                    </section>
                  )}
                </aside>
              )}
            </div>
          </ReleaseReadinessLayout>
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
