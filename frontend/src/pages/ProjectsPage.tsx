import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, ReactNode } from "react";
import {
  IconActivity,
  IconAlertTriangle,
  IconChartBar,
  IconChevronDown,
  IconChevronUp,
  IconCircleCheck,
  IconInfoCircle,
  IconBug,
  IconDownload,
  IconLock,
  IconPaperclip,
  IconSearch,
  IconStar,
  IconUpload,
  IconX,
  IconShieldCheck
} from "@tabler/icons-react";
import { toJpeg } from "html-to-image";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AddIcon, GithubIcon, GoogleDriveIcon, OpenIcon, PlayIcon, TrashIcon } from "../components/AppIcons";
import { AppTypeDropdown, AppTypeIcon, AppTypeInlineValue, normalizeAppTypeKind } from "../components/AppTypeDropdown";
import { api } from "../lib/api";
import { CatalogSelectionControls } from "../components/CatalogSelectionControls";
import { CatalogViewToggle } from "../components/CatalogViewToggle";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { CatalogActionMenu } from "../components/CatalogActionMenu";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { DisplayIdBadge } from "../components/DisplayIdBadge";
import { DialogCloseButton } from "../components/DialogCloseButton";
import { EvidenceFlipCard } from "../components/EvidenceFlipCard";
import { MetricMethodologyInfo } from "../components/MetricMethodologyInfo";
import { FormField } from "../components/FormField";
import { LoadingState } from "../components/LoadingState";
import { JiraAttachmentPanel } from "../components/JiraAttachmentPanel";
import { Panel } from "../components/Panel";
import { ProgressMeter } from "../components/ProgressMeter";
import { ProjectTraceabilityMap } from "../components/ProjectTraceabilityMap";
import { RichTextEditor, richTextToPlainText } from "../components/RichTextEditor";
import {
  TileCardCaseIcon,
  TileCardFact,
  TileCardIconFrame,
  TileCardProjectIcon,
  TileCardRequirementIcon,
  TileCardUsersIcon
} from "../components/TileCardPrimitives";
import { SubnavTabs } from "../components/SubnavTabs";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { ToastMessage } from "../components/ToastMessage";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
import { useDeleteConfirmation } from "../components/DeleteConfirmationDialog";
import { useCurrentAppType, useCurrentProject } from "../hooks/useCurrentProject";
import { useDomainMetadata } from "../hooks/useDomainMetadata";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { useAiPromptRegistry } from "../hooks/useAiPromptRegistry";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import { useAuth } from "../auth/AuthContext";
import { formatAuditTimestamp } from "../lib/auditDisplay";
import { asArray, getVerifiedNextPageCursor, normalizePagedResult } from "../lib/collectionGuards";
import { areFeatureFlagsEnabled } from "../lib/featureFlags";
import { readDefaultCatalogViewMode } from "../lib/viewPreferences";
import { hasPermission } from "../lib/permissions";
import { resolveVisibleEmail } from "../lib/userDisplay";
import type { AppType, Execution, ExecutionResult, Issue, JiraAttachment, Project, ProjectPortfolioImpact, Requirement, RequirementIteration, TestCase, TestCaseModule, WorkspaceTransaction } from "../types";
import "./ProjectsPage.css";

type ProjectSection = "details" | "members" | "applications" | "attachments" | "traceability";

type ProjectAppTypeDraft = {
  id: string;
  name: string;
  type: AppType["type"];
  is_unified: boolean;
};

type ProjectCreateDraft = {
  name: string;
  description: string;
  visibility: "private" | "public";
  memberIds: string[];
  memberRoleIds: Record<string, string>;
  appTypes: ProjectAppTypeDraft[];
  attachments: File[];
};

type ProjectCreateMutationInput = {
  project: {
    name: string;
    description?: string;
    visibility: "private" | "public";
    members: Array<{ user_id: string; role_id: string }>;
    app_types: Array<{ name: string; type: AppType["type"]; is_unified?: boolean }>;
  };
  attachments: File[];
};

type ProjectDetailsDraft = {
  name: string;
  description: string;
};

const NEW_PROJECT_ROLE_DEFAULTS = [
  { id: "qa-lead", name: "QA lead" },
  { id: "qa-member", name: "QA member" },
  { id: "viewer", name: "Viewer" }
] as const;
const DEFAULT_NEW_PROJECT_MEMBER_ROLE_ID = "qa-member";
const MAX_PROJECT_ATTACHMENTS = 10;

const formatProjectAttachmentBytes = (value: number) => {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
};

type ProjectRequirementCoverage = {
  totalRequirements: number;
  coveredRequirements: number;
  coveragePercent: number;
};

type ProjectAutomationCoverage = {
  totalCases: number;
  automatedCases: number;
  coveragePercent: number;
};

type ProjectPassCoverage = {
  totalCases: number;
  passedCases: number;
  coveragePercent: number;
  testCaseTotal: number;
  testCasePassed: number;
  bugTotal: number;
  bugResolved: number;
};

type ProjectHealthTone = "success" | "warning" | "danger" | "neutral";

type ProjectPortfolioItem = {
  project: Project;
  memberCount: number;
  memberNames: string[];
  memberUserIds: string[];
  appTypes: AppType[];
  appTypeCount: number;
  appTypeSummary: string;
  requirementCount: number;
  moduleCount: number;
  testCaseCount: number;
  bugCount: number;
  suiteCount: number;
  coverage: ProjectRequirementCoverage;
  automationCoverage: ProjectAutomationCoverage;
  passCoverage: ProjectPassCoverage;
  latestExecution: Execution | null;
  latestExecutionResults: ExecutionResult[];
  latestFailedCount: number;
  latestBlockedCount: number;
  executionEvidence: { total: number; evidenced: number; missing: number; coveragePercent: number; threshold: number; violates: boolean };
  failureImpacts: { modules: ProjectPortfolioImpact; requirements: ProjectPortfolioImpact };
  bugImpacts: { modules: ProjectPortfolioImpact; requirements: ProjectPortfolioImpact };
  openBugCount: number;
  attentionReasons: string[];
  latestDurationLabel: string;
  latestRunLabel: string;
  readinessScore: number;
  healthTone: ProjectHealthTone;
  healthLabel: string;
  readinessLabel: string;
  insight: string;
};

const emptyPortfolioImpact: ProjectPortfolioImpact = { total: 0, top: [] };

const createDraftId = () =>
  globalThis.crypto?.randomUUID?.() || `project-draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createProjectAppTypeDraft = (defaultType: string): ProjectAppTypeDraft => ({
  id: createDraftId(),
  name: "",
  type: (defaultType || "web") as AppType["type"],
  is_unified: false
});

const createInitialProjectDraft = (defaultType: string): ProjectCreateDraft => ({
  name: "",
  description: "",
  visibility: "private",
  memberIds: [],
  memberRoleIds: {},
  appTypes: [createProjectAppTypeDraft(defaultType)],
  attachments: []
});

const emptyRequirementCoverage: ProjectRequirementCoverage = {
  totalRequirements: 0,
  coveredRequirements: 0,
  coveragePercent: 0
};

const emptyAutomationCoverage: ProjectAutomationCoverage = {
  totalCases: 0,
  automatedCases: 0,
  coveragePercent: 0
};

const emptyPassCoverage: ProjectPassCoverage = {
  totalCases: 0,
  passedCases: 0,
  coveragePercent: 0,
  testCaseTotal: 0,
  testCasePassed: 0,
  bugTotal: 0,
  bugResolved: 0
};

const formatPassCoverageDetail = (coverage: ProjectPassCoverage) => coverage.totalCases
  ? `${coverage.testCasePassed}/${coverage.testCaseTotal} tests passed · ${coverage.bugResolved}/${coverage.bugTotal} Bugs resolved`
  : "No finalized tests or Bugs available to measure pass rate";

const getMetricTone = (covered: number, total: number) => {
  if (!total) {
    return "neutral" as const;
  }

  if (covered >= total) {
    return "success" as const;
  }

  if (covered > 0) {
    return "info" as const;
  }

  return "danger" as const;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const formatCompactCount = (value: number, singular: string, plural = `${singular}s`) =>
  `${value} ${value === 1 ? singular : plural}`;

const compactImpactEvidence = (label: string, impact: ProjectPortfolioImpact) => {
  if (!impact.total) return `No impacted ${label.toLowerCase()} linked`;
  const highlighted = impact.top.map((item) => `${item.name} (${item.count})`);
  const remaining = Math.max(0, impact.total - impact.top.length);
  return highlighted.length
    ? `${highlighted.join(" · ")}${remaining ? ` · ${remaining} more ${label}` : ""}`
    : `${impact.total} impacted ${label}`;
};

const waitForSnapshotPaint = () => new Promise<void>((resolve) => {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
});

async function primeProjectAttentionScroll(container: HTMLElement) {
  const originalScrollTop = container.scrollTop;
  const maximumScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const viewportStep = Math.max(240, Math.floor(container.clientHeight * 0.8));

  try {
    for (let scrollTop = 0; scrollTop < maximumScrollTop; scrollTop += viewportStep) {
      container.scrollTop = scrollTop;
      await waitForSnapshotPaint();
    }
    container.scrollTop = maximumScrollTop;
    await waitForSnapshotPaint();
    container.scrollTop = 0;
    await waitForSnapshotPaint();
  } catch (error) {
    container.scrollTop = originalScrollTop;
    throw error;
  }

  return () => {
    container.scrollTop = originalScrollTop;
  };
}

async function captureProjectAttentionSnapshot(node: HTMLElement) {
  await document.fonts?.ready;
  const reportBody = node.querySelector<HTMLElement>(".project-risk-evidence-body");
  const restoreScroll = reportBody ? await primeProjectAttentionScroll(reportBody) : () => undefined;
  node.classList.add("is-exporting-snapshot");
  try {
    await waitForSnapshotPaint();
    const fragmentSelectors = [
      ".project-risk-evidence-header",
      ".project-risk-summary-grid",
      ".project-risk-method",
      ".project-risk-section-heading",
      ".project-risk-project-card",
      ".project-risk-empty-state"
    ];
    const fragments = fragmentSelectors.flatMap((selector) => Array.from(node.querySelectorAll<HTMLElement>(selector)));
    if (!fragments.length) throw new Error("Portfolio attention report has no rendered content to export.");
    const reportWidth = Math.max(760, Math.ceil(node.getBoundingClientRect().width || node.scrollWidth));
    const renderedPages: string[] = [];
    for (const fragment of fragments) {
      await waitForSnapshotPaint();
      const height = Math.max(1, Math.ceil(fragment.scrollHeight || fragment.getBoundingClientRect().height));
      const width = Math.max(1, reportWidth);
      const maximumCanvasPixels = 4_000_000;
      const captureScale = Math.min(
        window.devicePixelRatio || 1,
        1.35,
        Math.sqrt(maximumCanvasPixels / Math.max(1, width * height)),
        12_000 / width,
        12_000 / height
      );
      const dataUrl = await toJpeg(fragment, {
        backgroundColor: window.getComputedStyle(fragment).backgroundColor || "#f7f9ff",
        cacheBust: true,
        canvasHeight: Math.max(1, Math.floor(height * captureScale)),
        canvasWidth: Math.max(1, Math.floor(width * captureScale)),
        filter: (candidate) => !(candidate instanceof HTMLElement) || !candidate.matches(".dialog-close-button, .metric-methodology-info, .project-risk-open-button"),
        height,
        pixelRatio: 1,
        preferredFontFormat: "woff2",
        quality: 0.86,
        style: { boxSizing: "border-box", height: `${height}px`, margin: "0", overflow: "visible", width: `${width}px` },
        width
      });
      if (!dataUrl.startsWith("data:image/jpeg")) throw new Error("Portfolio attention report page could not be encoded.");
      renderedPages.push(dataUrl);
    }
    return {
      rendered_snapshot_pages_data_urls: renderedPages,
      rendered_snapshot_name: "Projects needing attention",
      rendered_snapshot_captured_at: new Date().toISOString()
    };
  } finally {
    node.classList.remove("is-exporting-snapshot");
    restoreScroll();
  }
}

const formatProjectTimeAgo = (value?: string | null) => {
  if (!value) {
    return "No run yet";
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "Not recorded";
  }

  const diffMs = Date.now() - timestamp;
  const absMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) {
    return "Just now";
  }

  if (absMs < hour) {
    const minutes = Math.round(absMs / minute);
    return `${minutes}m ago`;
  }

  if (absMs < day) {
    const hours = Math.round(absMs / hour);
    return `${hours}h ago`;
  }

  const days = Math.round(absMs / day);
  return `${days}d ago`;
};

const formatProjectDuration = (execution?: Execution | null) => {
  if (!execution?.started_at || !execution.ended_at) {
    return "Not recorded";
  }

  const startedAt = new Date(execution.started_at).getTime();
  const endedAt = new Date(execution.ended_at).getTime();
  const durationMs = endedAt - startedAt;

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "Not recorded";
  }

  const minutes = Math.round(durationMs / 60000);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

const resolveProjectHealth = ({
  readinessScore,
  requirementCount,
  testCaseCount,
  latestFailedCount,
  latestBlockedCount,
  passCoverage
}: {
  readinessScore: number;
  requirementCount: number;
  testCaseCount: number;
  latestFailedCount: number;
  latestBlockedCount: number;
  passCoverage: ProjectPassCoverage;
}) => {
  if (!requirementCount && !testCaseCount) {
    return {
      healthTone: "neutral" as const,
      healthLabel: "New",
      readinessLabel: "Not assessed"
    };
  }

  if (latestFailedCount > 0 || latestBlockedCount > 0 || (passCoverage.totalCases > 0 && passCoverage.coveragePercent < 60)) {
    return {
      healthTone: "danger" as const,
      healthLabel: "Risky",
      readinessLabel: "Not Ready"
    };
  }

  if (readinessScore >= 80) {
    return {
      healthTone: "success" as const,
      healthLabel: "Healthy",
      readinessLabel: "Release Ready"
    };
  }

  return {
    healthTone: "warning" as const,
    healthLabel: "Watch",
    readinessLabel: "Needs Review"
  };
};

const getProjectInsight = (item: Omit<ProjectPortfolioItem, "insight">) => {
  if (!item.requirementCount && !item.testCaseCount) {
    return "Start by importing stories or creating the first test suite.";
  }

  if (item.latestFailedCount > 0 || item.latestBlockedCount > 0) {
    return `${formatCompactCount(item.latestFailedCount, "failed test")} and ${formatCompactCount(item.latestBlockedCount, "blocked test")} need review before release.`;
  }

  if (item.automationCoverage.totalCases > 0 && item.automationCoverage.coveragePercent < 40) {
    return "Automation maturity is low. Prioritize high-value regression flows for the next sprint.";
  }

  if (item.coverage.totalRequirements > 0 && item.coverage.coveragePercent < 80) {
    return "Story traceability has gaps. Link uncovered stories before release planning.";
  }

  if (item.passCoverage.totalCases > 0 && item.passCoverage.coveragePercent >= 80) {
    return "Quality confidence is strong. Keep monitoring high-risk applications and Bugs for regressions.";
  }

  return "Project scope is available. Add recent execution evidence to improve readiness confidence.";
};

const getProjectRiskSignals = (item: ProjectPortfolioItem) => {
  const signals: Array<{ label: string; detail: string; tone: "danger" | "warning" | "neutral" }> = [];

  if (item.latestFailedCount > 0) {
    signals.push({
      label: "Latest execution failures",
      detail: `${formatCompactCount(item.latestFailedCount, "failed test")} in the latest project run.`,
      tone: "danger"
    });
  }

  if (item.latestBlockedCount > 0) {
    signals.push({
      label: "Blocked execution paths",
      detail: `${formatCompactCount(item.latestBlockedCount, "blocked test")} cannot currently complete.`,
      tone: "danger"
    });
  }

  if (item.executionEvidence.violates) {
    signals.push({
      label: "Execution evidence below policy",
      detail: item.executionEvidence.total
        ? `${item.executionEvidence.evidenced}/${item.executionEvidence.total} latest finalized outcomes have screenshot, video, or comment evidence; ${item.executionEvidence.threshold}% is required.`
        : "No finalized latest-run outcomes are available to demonstrate execution evidence.",
      tone: "warning"
    });
  }

  if (item.openBugCount > 0) {
    signals.push({
      label: "Open Bug exposure",
      detail: `${formatCompactCount(item.openBugCount, "open Bug")} currently affects the project scope.`,
      tone: "warning"
    });
  }

  if (item.passCoverage.totalCases > 0 && item.passCoverage.coveragePercent < 60) {
    signals.push({
      label: "Pass rate below threshold",
      detail: `${item.passCoverage.coveragePercent}% combined Test Case and Bug pass rate is below the 60% risk threshold.`,
      tone: "danger"
    });
  }

  if (!item.latestExecution) {
    signals.push({
      label: "Execution evidence missing",
      detail: "No completed project run is available to validate the current delivery scope.",
      tone: "warning"
    });
  }

  if (item.coverage.totalRequirements > 0 && item.coverage.coveragePercent < 80) {
    signals.push({
      label: "Story traceability gap",
      detail: `${item.coverage.totalRequirements - item.coverage.coveredRequirements} of ${item.coverage.totalRequirements} Stories have no linked test case.`,
      tone: "warning"
    });
  }

  if (item.automationCoverage.totalCases > 0 && item.automationCoverage.coveragePercent < 40) {
    signals.push({
      label: "Low automation coverage",
      detail: `${item.automationCoverage.coveragePercent}% of loaded test cases are automated; the guidance threshold is 40%.`,
      tone: "warning"
    });
  }

  if (!signals.length) {
    signals.push({
      label: "Weighted readiness needs review",
      detail: `${item.readinessScore}% readiness remains below the 80% release-ready threshold.`,
      tone: "neutral"
    });
  }

  return signals;
};

function ProjectProgressBar({
  label,
  value,
  tone,
  detail
}: {
  label: string;
  value: number;
  tone: "info" | "success" | "danger" | "neutral";
  detail?: string;
}) {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div className="project-progress-meter" aria-label={`${label} ${safeValue}%`} title={detail}>
      <div className="project-progress-meter-header">
        <span>{label}</span>
        <strong>{safeValue}%</strong>
      </div>
      <ProgressMeter hideCopy tone={tone} value={safeValue} />
    </div>
  );
}

function PortfolioMetricCard({
  label,
  value,
  caption,
  evidence,
  criteriaKey,
  tone
}: {
  label: string;
  value: ReactNode;
  caption: string;
  evidence: string[];
  criteriaKey?: string;
  tone?: "danger" | "warning" | "success" | "info";
}) {
  const { getMetricCriteria } = useAiPromptRegistry();
  return (
    <EvidenceFlipCard
      caption={caption}
      evidence={evidence}
      frontAccessory={criteriaKey ? (
        <MetricMethodologyInfo
          criteriaKey={criteriaKey}
          evidence={evidence.join(" · ")}
          organizationCriteria={getMetricCriteria(criteriaKey)}
        />
      ) : null}
      label={label}
      tone={tone}
      value={value}
    />
  );
}

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const { session } = useAuth();
  const { getMetricCriteria } = useAiPromptRegistry();
  const hasJiraAdministration = session?.user.role === "admin";
  const canManageUsers = hasPermission(session, "user.view");
  const canManageProjects = hasJiraAdministration && hasPermission(session, "project.manage");
  const canCreateProjects = canManageProjects;
  const canDeleteProjects = hasJiraAdministration && hasPermission(session, "project.delete");
  const canSyncProjects = hasPermission(session, "project.sync");
  const canExportPortfolioAttention = hasPermission(session, "run.report.export");
  const canManageProjectMembers = hasJiraAdministration && hasPermission(session, "project_member.manage");
  const canManageAppTypes = hasJiraAdministration && hasPermission(session, "project.manage");
  const canViewAttachments = hasPermission(session, "attachment.view");
  const canCreateAttachments = hasPermission(session, "attachment.create");
  const canDeleteAttachments = hasPermission(session, "attachment.delete");
  const visibleUserEmail = (email?: string | null) => resolveVisibleEmail(email, canManageUsers);
  const domainMetadataQuery = useDomainMetadata();
  const [loadProjectMetrics, setLoadProjectMetrics] = useState(false);
  const { users, roles, projectMembers, appTypes, requirements, testSuites, testCases, executions, executionResults } = useWorkspaceData({
    projects: false,
    issues: false,
    requirements: loadProjectMetrics,
    testSuites: loadProjectMetrics,
    testCases: loadProjectMetrics,
    executions: loadProjectMetrics,
    executionResults: loadProjectMetrics,
    testCasesProjection: "summary"
  });
  const [selectedProjectId, setSelectedProjectId] = useCurrentProject();
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const canViewProjectAutomationCoverage = hasPermission(session, "automation.analytics.view")
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.analytics"]);
  const [focusedProjectId, setFocusedProjectId] = useState("");
  const [section, setSection] = useState<ProjectSection>("details");
  const [traceabilityAppTypeId, setTraceabilityAppTypeId] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [expandedProjectAppTypeId, setExpandedProjectAppTypeId] = useState("");
  const [projectMemberSearch, setProjectMemberSearch] = useState("");
  const [isProjectAttachmentDragging, setIsProjectAttachmentDragging] = useState(false);
  const projectAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [isRiskEvidenceOpen, setIsRiskEvidenceOpen] = useState(false);
  const [isExportingRiskPdf, setIsExportingRiskPdf] = useState(false);
  const riskEvidenceReportRef = useRef<HTMLDivElement | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const deferredProjectSearch = useDeferredValue(projectSearch);
  const [projectAppTypeFilter, setProjectAppTypeFilter] = useState("all");
  const [projectMemberFilter, setProjectMemberFilter] = useState("all");
  const [projectViewMode, setProjectViewMode] = useState<"tile" | "list">(() => readDefaultCatalogViewMode());
  const [selectedActionProjectIds, setSelectedActionProjectIds] = useState<string[]>([]);
  const defaultAppTypeValue = domainMetadataQuery.data?.app_types?.default_type || "web";
  const appTypeTypeOptions = domainMetadataQuery.data?.app_types?.types || [];
  const appTypeDropdownOptions = useMemo(
    () =>
      appTypeTypeOptions.map((option) => ({
        value: option.value,
        label: option.label,
        type: option.value,
        description: option.description
      })),
    [appTypeTypeOptions]
  );
  const [projectDraft, setProjectDraft] = useState<ProjectCreateDraft>(() => createInitialProjectDraft(defaultAppTypeValue));
  const [projectDetailsDraft, setProjectDetailsDraft] = useState<ProjectDetailsDraft>({ name: "", description: "" });
  const [quickAddAppTypeType, setQuickAddAppTypeType] = useState(defaultAppTypeValue);
  const projectAttachmentMetaQuery = useQuery({
    queryKey: ["project-attachment-meta"],
    queryFn: api.attachments.meta,
    enabled: Boolean(session && canCreateAttachments),
    staleTime: 5 * 60_000
  });
  const projectCatalogQuery = useQuery({
    queryKey: ["projects", "catalog"],
    queryFn: api.projects.catalog,
    enabled: Boolean(session),
    staleTime: 30_000
  });
  const portfolioAnalyticsQuery = useQuery({
    queryKey: ["projects", "portfolio-analytics"],
    queryFn: api.projects.portfolioAnalytics,
    enabled: Boolean(session),
    staleTime: 30_000
  });
  const projectCreationUsersQuery = useQuery({
    queryKey: ["project-create", "users"],
    queryFn: api.users.list,
    enabled: isCreateModalOpen && canCreateProjects,
    staleTime: 30_000
  });
  const projectCreationRolesQuery = useQuery({
    queryKey: ["project-create", "roles"],
    queryFn: api.roles.list,
    enabled: isCreateModalOpen && canCreateProjects,
    staleTime: 30_000
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations", selectedProjectId],
    queryFn: () => api.integrations.list(),
    enabled: Boolean(session)
  });
  const projectSyncTransactionsQuery = useQuery({
    queryKey: ["project-sync-transactions", focusedProjectId || selectedProjectId],
    queryFn: () => api.workspaceTransactions.list({
      project_id: focusedProjectId || selectedProjectId || undefined,
      category: "backup",
      limit: 20
    }),
    enabled: Boolean((focusedProjectId || selectedProjectId) && session)
  });

  const projectItems = asArray(projectCatalogQuery.data);
  const isProjectCatalogLoading = projectCatalogQuery.isPending || portfolioAnalyticsQuery.isPending;

  useEffect(() => {
    if (!projectCatalogQuery.data?.some((project) => project.has_access !== false) || loadProjectMetrics) return;
    const timer = window.setTimeout(() => setLoadProjectMetrics(true), 120);
    return () => window.clearTimeout(timer);
  }, [loadProjectMetrics, projectCatalogQuery.data]);

  useEffect(() => {
    if (!appTypeDropdownOptions.length) {
      if (!quickAddAppTypeType) {
        setQuickAddAppTypeType(defaultAppTypeValue);
      }
      return;
    }

    if (!appTypeDropdownOptions.some((option) => option.value === quickAddAppTypeType)) {
      const fallbackValue =
        appTypeDropdownOptions.find((option) => option.value === defaultAppTypeValue)?.value || appTypeDropdownOptions[0].value;
      setQuickAddAppTypeType(fallbackValue);
    }
  }, [appTypeDropdownOptions, defaultAppTypeValue, quickAddAppTypeType]);

  const selectedProject = useMemo(
    () => projectItems.find((project) => project.has_access !== false && String(project.id) === String(selectedProjectId))
      || projectItems.find((project) => project.has_access !== false),
    [projectItems, selectedProjectId]
  );
  const focusedProject = useMemo(
    () => projectItems.find((project) => project.has_access !== false && String(project.id) === String(focusedProjectId)) || null,
    [focusedProjectId, projectItems]
  );
  const scopedProject = focusedProject || selectedProject;
  const projectId = scopedProject?.id || "";
  const [, setCurrentAppTypeId] = useCurrentAppType(projectId);

  useEffect(() => {
    setProjectDetailsDraft({
      name: focusedProject?.name || "",
      description: focusedProject?.description || ""
    });
  }, [focusedProject?.description, focusedProject?.id, focusedProject?.name]);

  useEffect(() => {
    if (focusedProjectId && !projectItems.some((project) => String(project.id) === String(focusedProjectId))) {
      setFocusedProjectId("");
    }
  }, [focusedProjectId, projectItems]);

  const memberCountByProjectId = useMemo(() => {
    const counts: Record<string, number> = {};

    (projectMembers.data || []).forEach((member) => {
      counts[member.project_id] = (counts[member.project_id] || 0) + 1;
    });

    return counts;
  }, [projectMembers.data]);

  const projectMemberUserIdsByProjectId = useMemo(() => {
    const map = new Map<string, Set<string>>();

    (projectMembers.data || []).forEach((member) => {
      const current = map.get(member.project_id) || new Set<string>();
      current.add(member.user_id);
      map.set(member.project_id, current);
    });

    return map;
  }, [projectMembers.data]);

  const userSearchValueById = useMemo(() => {
    const map = new Map<string, string>();

    (users.data || []).forEach((user) => {
      map.set(user.id, [user.name, user.email].filter(Boolean).join(" ").toLowerCase());
    });

    return map;
  }, [users.data]);

  const appTypesByProjectId = useMemo(() => {
    const map: Record<string, AppType[]> = {};

    (appTypes.data || []).forEach((appType) => {
      map[appType.project_id] = [...(map[appType.project_id] || []), appType];
    });

    return map;
  }, [appTypes.data]);

  const appTypeCountByProjectId = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(appTypesByProjectId).map(([currentProjectId, projectAppTypes]) => [currentProjectId, projectAppTypes.length])
      ) as Record<string, number>,
    [appTypesByProjectId]
  );

  const requirementCountByProjectId = useMemo(() => {
    const counts: Record<string, number> = {};

    (requirements.data || []).forEach((requirement) => {
      counts[requirement.project_id] = (counts[requirement.project_id] || 0) + 1;
    });

    return counts;
  }, [requirements.data]);

  const projectIdByAppTypeId = useMemo(() => {
    const map = new Map<string, string>();

    (appTypes.data || []).forEach((appType) => {
      map.set(appType.id, appType.project_id);
    });

    return map;
  }, [appTypes.data]);

  const testCaseCountByProjectId = useMemo(() => {
    const counts: Record<string, number> = {};

    (testCases.data || []).forEach((testCase) => {
      if (!testCase.app_type_id) {
        return;
      }

      const owningProjectId = projectIdByAppTypeId.get(testCase.app_type_id);
      if (!owningProjectId) {
        return;
      }

      counts[owningProjectId] = (counts[owningProjectId] || 0) + 1;
    });

    return counts;
  }, [projectIdByAppTypeId, testCases.data]);

  const testSuiteCountByProjectId = useMemo(() => {
    const counts: Record<string, number> = {};

    (testSuites.data || []).forEach((suite) => {
      const owningProjectId = projectIdByAppTypeId.get(suite.app_type_id);

      if (!owningProjectId) {
        return;
      }

      counts[owningProjectId] = (counts[owningProjectId] || 0) + 1;
    });

    return counts;
  }, [projectIdByAppTypeId, testSuites.data]);

  const latestExecutionByProjectId = useMemo(() => {
    const latestByProjectId: Record<string, Execution> = {};

    (executions.data || []).forEach((execution) => {
      const current = latestByProjectId[execution.project_id];
      const currentTime = current?.created_at ? new Date(current.created_at).getTime() || 0 : 0;
      const nextTime = execution.created_at ? new Date(execution.created_at).getTime() || 0 : 0;

      if (!current || nextTime >= currentTime) {
        latestByProjectId[execution.project_id] = execution;
      }
    });

    return latestByProjectId;
  }, [executions.data]);

  const executionResultsByExecutionId = useMemo(() => {
    const map: Record<string, ExecutionResult[]> = {};

    (executionResults.data || []).forEach((result) => {
      map[result.execution_id] = [...(map[result.execution_id] || []), result];
    });

    return map;
  }, [executionResults.data]);

  const latestExecutionResultByCaseId = useMemo(() => {
    const resultsByCaseId: Record<string, ExecutionResult> = {};

    (executionResults.data || []).forEach((result) => {
      const current = resultsByCaseId[result.test_case_id];
      const currentTime = current?.created_at ? new Date(current.created_at).getTime() || 0 : 0;
      const nextTime = result.created_at ? new Date(result.created_at).getTime() || 0 : 0;

      if (!current || nextTime >= currentTime) {
        resultsByCaseId[result.test_case_id] = result;
      }
    });

    return resultsByCaseId;
  }, [executionResults.data]);

  const requirementCoverageByProjectId = useMemo(() => {
    const requirementProjectById = new Map((requirements.data || []).map((requirement) => [requirement.id, requirement.project_id]));
    const coveredRequirementIdsByProjectId = new Map<string, Set<string>>();

    const markRequirementCovered = (projectId: string, requirementId: string) => {
      const current = coveredRequirementIdsByProjectId.get(projectId) || new Set<string>();
      current.add(requirementId);
      coveredRequirementIdsByProjectId.set(projectId, current);
    };

    (requirements.data || []).forEach((requirement) => {
      if ((requirement.test_case_ids || []).filter(Boolean).length) {
        markRequirementCovered(requirement.project_id, requirement.id);
      }
    });

    (testCases.data || []).forEach((testCase) => {
      const owningProjectId = testCase.app_type_id ? projectIdByAppTypeId.get(testCase.app_type_id) : "";
      const linkedRequirementIds = [...(testCase.requirement_ids || []), testCase.requirement_id].filter(Boolean) as string[];

      linkedRequirementIds.forEach((requirementId) => {
        const requirementProjectId = requirementProjectById.get(requirementId);

        if (!requirementProjectId || (owningProjectId && owningProjectId !== requirementProjectId)) {
          return;
        }

        markRequirementCovered(requirementProjectId, requirementId);
      });
    });

    const coverageByProjectId: Record<string, ProjectRequirementCoverage> = {};

    projectItems.forEach((project) => {
      const totalRequirements = requirementCountByProjectId[project.id] || 0;
      const coveredRequirements = Math.min(coveredRequirementIdsByProjectId.get(project.id)?.size || 0, totalRequirements);

      coverageByProjectId[project.id] = {
        totalRequirements,
        coveredRequirements,
        coveragePercent: totalRequirements ? Math.round((coveredRequirements / totalRequirements) * 100) : 0
      };
    });

    return coverageByProjectId;
  }, [projectIdByAppTypeId, projectItems, requirementCountByProjectId, requirements.data, testCases.data]);

  const automationCoverageByProjectId = useMemo(() => {
    const coverageByProjectId: Record<string, ProjectAutomationCoverage> = {};

    projectItems.forEach((project) => {
      coverageByProjectId[project.id] = {
        totalCases: 0,
        automatedCases: 0,
        coveragePercent: 0
      };
    });

    (testCases.data || []).forEach((testCase) => {
      if (!testCase.app_type_id) {
        return;
      }

      const owningProjectId = projectIdByAppTypeId.get(testCase.app_type_id);
      if (!owningProjectId || !coverageByProjectId[owningProjectId]) {
        return;
      }

      coverageByProjectId[owningProjectId].totalCases += 1;

      if (testCase.automated === "yes") {
        coverageByProjectId[owningProjectId].automatedCases += 1;
      }
    });

    Object.values(coverageByProjectId).forEach((metric) => {
      metric.coveragePercent = metric.totalCases ? Math.round((metric.automatedCases / metric.totalCases) * 100) : 0;
    });

    return coverageByProjectId;
  }, [projectIdByAppTypeId, projectItems, testCases.data]);

  const passCoverageByProjectId = useMemo(() => {
    const coverageByProjectId: Record<string, ProjectPassCoverage> = {};

    projectItems.forEach((project) => {
      coverageByProjectId[project.id] = {
        totalCases: 0,
        passedCases: 0,
        coveragePercent: 0,
        testCaseTotal: 0,
        testCasePassed: 0,
        bugTotal: 0,
        bugResolved: 0
      };
    });

    (testCases.data || []).forEach((testCase) => {
      if (!testCase.app_type_id) {
        return;
      }

      const owningProjectId = projectIdByAppTypeId.get(testCase.app_type_id);
      if (!owningProjectId || !coverageByProjectId[owningProjectId]) {
        return;
      }

      const latestResult = latestExecutionResultByCaseId[testCase.id];
      if (!latestResult || !["passed", "failed", "blocked"].includes(String(latestResult.status || "").toLowerCase())) {
        return;
      }

      coverageByProjectId[owningProjectId].totalCases += 1;
      coverageByProjectId[owningProjectId].testCaseTotal += 1;

      if (String(latestResult.status).toLowerCase() === "passed") {
        coverageByProjectId[owningProjectId].passedCases += 1;
        coverageByProjectId[owningProjectId].testCasePassed += 1;
      }
    });

    Object.values(coverageByProjectId).forEach((metric) => {
      metric.coveragePercent = metric.totalCases ? Math.round((metric.passedCases / metric.totalCases) * 100) : 0;
    });

    return coverageByProjectId;
  }, [latestExecutionResultByCaseId, projectIdByAppTypeId, projectItems, testCases.data]);

  const portfolioAnalyticsByProjectId = useMemo(
    () => new Map((portfolioAnalyticsQuery.data?.projects || []).map((item) => [item.project_id, item])),
    [portfolioAnalyticsQuery.data]
  );

  const projectPortfolioItems = useMemo<ProjectPortfolioItem[]>(() => {
    return projectItems.map((project) => {
      const exactMetric = portfolioAnalyticsByProjectId.get(project.id);
      const projectAppTypes = exactMetric?.app_types || appTypesByProjectId[project.id] || [];
      const projectMemberUserIds = projectMemberUserIdsByProjectId.get(project.id) || new Set<string>();
      const memberNames = exactMetric?.members.map((member) => member.name) || Array.from(projectMemberUserIds)
        .map((userId) => users.data?.find((user) => user.id === userId))
        .map((user) => user?.name || visibleUserEmail(user?.email) || "")
        .filter(Boolean);
      const coverage = exactMetric ? {
        totalRequirements: exactMetric.story_coverage.total,
        coveredRequirements: exactMetric.story_coverage.covered,
        coveragePercent: exactMetric.story_coverage.percent
      } : requirementCoverageByProjectId[project.id] || emptyRequirementCoverage;
      const automationCoverage = exactMetric ? {
        totalCases: exactMetric.automation_coverage.total,
        automatedCases: exactMetric.automation_coverage.automated,
        coveragePercent: exactMetric.automation_coverage.percent
      } : automationCoverageByProjectId[project.id] || emptyAutomationCoverage;
      const passCoverage = exactMetric ? {
        totalCases: exactMetric.pass_confidence.total,
        passedCases: exactMetric.pass_confidence.passed,
        coveragePercent: exactMetric.pass_confidence.percent,
        testCaseTotal: exactMetric.pass_confidence.case_total,
        testCasePassed: exactMetric.pass_confidence.case_passed,
        bugTotal: exactMetric.pass_confidence.bug_total,
        bugResolved: exactMetric.pass_confidence.bug_resolved
      } : passCoverageByProjectId[project.id] || emptyPassCoverage;
      const latestExecution = exactMetric?.latest_execution || latestExecutionByProjectId[project.id] || null;
      const latestExecutionResults = latestExecution ? executionResultsByExecutionId[latestExecution.id] || [] : [];
      const latestFailedCount = exactMetric?.latest_failed_count ?? latestExecutionResults.filter((result) => result.status === "failed").length;
      const latestBlockedCount = exactMetric?.latest_blocked_count ?? latestExecutionResults.filter((result) => result.status === "blocked").length;
      const readinessScore = exactMetric?.readiness_score ?? clampPercent(
        Math.round((coverage.coveragePercent * 0.35) + (automationCoverage.coveragePercent * 0.25) + (passCoverage.coveragePercent * 0.4))
      );
      const health = exactMetric ? {
        healthTone: exactMetric.health_tone,
        healthLabel: exactMetric.health_label,
        readinessLabel: exactMetric.readiness_label
      } : resolveProjectHealth({
        readinessScore,
        requirementCount: requirementCountByProjectId[project.id] || 0,
        testCaseCount: testCaseCountByProjectId[project.id] || 0,
        latestFailedCount,
        latestBlockedCount,
        passCoverage
      });
      const appTypeSummary = projectAppTypes.length
        ? projectAppTypes.map((appType) => appType.is_unified ? `${appType.name} unified` : `${appType.name} ${appType.type}`).join(", ")
        : "No applications";
      const baseItem = {
        project,
        memberCount: exactMetric?.counts.members ?? memberCountByProjectId[project.id] ?? 0,
        memberNames,
        memberUserIds: exactMetric?.members.map((member) => member.user_id) || Array.from(projectMemberUserIds),
        appTypes: projectAppTypes,
        appTypeCount: projectAppTypes.length,
        appTypeSummary,
        requirementCount: exactMetric?.counts.stories ?? project.story_count ?? requirementCountByProjectId[project.id] ?? 0,
        moduleCount: exactMetric?.counts.modules ?? project.module_count ?? 0,
        testCaseCount: exactMetric?.counts.cases ?? project.case_count ?? testCaseCountByProjectId[project.id] ?? 0,
        bugCount: exactMetric?.bug_count ?? project.bug_count ?? 0,
        openBugCount: exactMetric?.open_bug_count ?? 0,
        suiteCount: testSuiteCountByProjectId[project.id] || 0,
        coverage,
        automationCoverage,
        passCoverage,
        latestExecution,
        latestExecutionResults,
        latestFailedCount,
        latestBlockedCount,
        executionEvidence: exactMetric ? {
          total: exactMetric.execution_evidence.total,
          evidenced: exactMetric.execution_evidence.evidenced,
          missing: exactMetric.execution_evidence.missing,
          coveragePercent: exactMetric.execution_evidence.percent,
          threshold: exactMetric.execution_evidence.threshold,
          violates: exactMetric.execution_evidence.violates
        } : { total: 0, evidenced: 0, missing: 0, coveragePercent: 0, threshold: 80, violates: false },
        failureImpacts: exactMetric?.failure_impacts || { modules: emptyPortfolioImpact, requirements: emptyPortfolioImpact },
        bugImpacts: exactMetric?.bug_impacts || { modules: emptyPortfolioImpact, requirements: emptyPortfolioImpact },
        attentionReasons: exactMetric?.attention_reasons || [],
        latestDurationLabel: formatProjectDuration(latestExecution),
        latestRunLabel: formatProjectTimeAgo(latestExecution?.created_at || latestExecution?.started_at),
        readinessScore,
        ...health
      };

      return {
        ...baseItem,
        insight: exactMetric?.insight || getProjectInsight(baseItem)
      };
    });
  }, [
    appTypesByProjectId,
    automationCoverageByProjectId,
    executionResultsByExecutionId,
    latestExecutionByProjectId,
    memberCountByProjectId,
    passCoverageByProjectId,
    portfolioAnalyticsByProjectId,
    projectItems,
    projectMemberUserIdsByProjectId,
    requirementCountByProjectId,
    requirementCoverageByProjectId,
    testCaseCountByProjectId,
    testSuiteCountByProjectId,
    users.data
  ]);

  const portfolioSummary = useMemo(() => {
    const exactSummary = portfolioAnalyticsQuery.data?.summary;
    const totalProjects = projectPortfolioItems.length;
    const accessibleItems = projectPortfolioItems.filter((item) => item.project.has_access !== false);
    const riskyItems = accessibleItems.filter((item) => item.healthTone === "danger");
    const watchItems = accessibleItems.filter((item) => item.healthTone === "warning");
    const releaseReadyItems = accessibleItems.filter((item) => item.healthTone === "success");
    const assessedItems = accessibleItems.filter((item) => item.healthTone !== "neutral");
    const riskyProjects = riskyItems.length;
    const watchProjects = watchItems.length;
    const releaseReadyProjects = releaseReadyItems.length;
    const attentionProjects = riskyProjects + watchProjects;
    const averageRequirementCoverage = accessibleItems.length
      ? Math.round(accessibleItems.reduce((sum, item) => sum + item.coverage.coveragePercent, 0) / accessibleItems.length)
      : 0;
    const averageAutomationCoverage = accessibleItems.length
      ? Math.round(accessibleItems.reduce((sum, item) => sum + item.automationCoverage.coveragePercent, 0) / accessibleItems.length)
      : 0;
    const overallHealth = accessibleItems.length
      ? Math.round(accessibleItems.reduce((sum, item) => sum + item.readinessScore, 0) / accessibleItems.length)
      : 0;
    const totalStories = accessibleItems.reduce((sum, item) => sum + item.coverage.totalRequirements, 0);
    const coveredStories = accessibleItems.reduce((sum, item) => sum + item.coverage.coveredRequirements, 0);
    const totalCases = accessibleItems.reduce((sum, item) => sum + item.automationCoverage.totalCases, 0);
    const automatedCases = accessibleItems.reduce((sum, item) => sum + item.automationCoverage.automatedCases, 0);
    const riskyLatestFailed = riskyItems.reduce((sum, item) => sum + item.latestFailedCount, 0);
    const riskyLatestBlocked = riskyItems.reduce((sum, item) => sum + item.latestBlockedCount, 0);
    const riskPassThreshold = portfolioAnalyticsQuery.data?.configuration["metric.project.risky_classification"]?.pass_confidence_threshold ?? 60;
    const riskyLowPassProjects = riskyItems.filter((item) => item.passCoverage.totalCases > 0 && item.passCoverage.coveragePercent < riskPassThreshold).length;
    const readyWithExecutionEvidence = releaseReadyItems.filter((item) => Boolean(item.latestExecution)).length;
    const releaseReadyAverage = releaseReadyItems.length
      ? Math.round(releaseReadyItems.reduce((sum, item) => sum + item.readinessScore, 0) / releaseReadyItems.length)
      : 0;
    const passAssessedItems = accessibleItems.filter((item) => item.passCoverage.totalCases > 0);
    const averagePassCoverage = passAssessedItems.length
      ? Math.round(passAssessedItems.reduce((sum, item) => sum + item.passCoverage.coveragePercent, 0) / passAssessedItems.length)
      : 0;
    const attentionWithoutExecution = [...riskyItems, ...watchItems].filter((item) => !item.latestExecution).length;

    return {
      totalProjects: exactSummary?.total_projects ?? totalProjects,
      accessibleProjects: exactSummary?.accessible_projects ?? accessibleItems.length,
      lockedProjects: exactSummary?.locked_projects ?? totalProjects - accessibleItems.length,
      riskyProjects,
      watchProjects,
      attentionProjects,
      releaseReadyProjects,
      assessedProjects: assessedItems.length,
      averageRequirementCoverage,
      averageAutomationCoverage,
      overallHealth,
      totalStories,
      coveredStories,
      totalCases,
      automatedCases,
      riskyLatestFailed,
      riskyLatestBlocked,
      riskyLowPassProjects,
      readyWithExecutionEvidence,
      releaseReadyAverage,
      averagePassCoverage: exactSummary?.average_pass_confidence ?? averagePassCoverage,
      attentionWithoutExecution,
      evidenceMissingProjects: exactSummary?.evidence_missing_projects ?? accessibleItems.filter((item) => item.executionEvidence.violates).length,
      executionFailureCases: exactSummary?.execution_failure_cases ?? accessibleItems.reduce((sum, item) => sum + item.latestFailedCount, 0),
      executionBlockedCases: exactSummary?.execution_blocked_cases ?? accessibleItems.reduce((sum, item) => sum + item.latestBlockedCount, 0),
      bugCount: exactSummary?.bug_count ?? accessibleItems.reduce((sum, item) => sum + item.bugCount, 0),
      openBugCount: exactSummary?.open_bug_count ?? accessibleItems.reduce((sum, item) => sum + item.openBugCount, 0),
      failureImpacts: exactSummary?.failure_impacts || { modules: emptyPortfolioImpact, requirements: emptyPortfolioImpact },
      bugImpacts: exactSummary?.bug_impacts || { modules: emptyPortfolioImpact, requirements: emptyPortfolioImpact },
      riskPassThreshold
    };
  }, [portfolioAnalyticsQuery.data, projectPortfolioItems]);

  const projectRiskEvidenceItems = useMemo(
    () =>
      projectPortfolioItems
        .filter((item) => item.project.has_access !== false && (item.healthTone === "danger" || item.healthTone === "warning"))
        .sort((left, right) => {
          const toneRank = { danger: 0, warning: 1, success: 2, neutral: 3 } as const;
          return toneRank[left.healthTone] - toneRank[right.healthTone] || left.readinessScore - right.readinessScore;
        }),
    [projectPortfolioItems]
  );
  const compactAttentionEvidence = useMemo(() => {
    const limit = Math.round(portfolioAnalyticsQuery.data?.configuration["metric.project.needs_attention"]?.priority_project_limit ?? 3);
    const priority = projectRiskEvidenceItems.slice(0, limit).map((item) =>
      `${item.project.name} · ${item.healthLabel} · ${item.attentionReasons.slice(0, 2).join(" + ") || `${item.readinessScore}% readiness`}`
    );
    const remaining = Math.max(0, projectRiskEvidenceItems.length - priority.length);
    return remaining ? [...priority, `${remaining} more attention project${remaining === 1 ? "" : "s"}`] : priority;
  }, [portfolioAnalyticsQuery.data, projectRiskEvidenceItems]);

  const filteredProjectItems = useMemo(() => {
    const normalizedSearch = deferredProjectSearch.trim().toLowerCase();

    return projectPortfolioItems.filter((item) => {
      const { project } = item;
      const projectAppTypes = item.appTypes;
      const projectMemberUserIds = new Set(item.memberUserIds);
      const searchContent = [
        project.id,
        project.name,
        project.display_id,
        project.description,
        item.healthLabel,
        item.readinessLabel,
        item.appTypeSummary,
        item.memberNames.join(" "),
        ...projectAppTypes.flatMap((appType) => [appType.name, appType.type]),
        ...Array.from(projectMemberUserIds).map((userId) => userSearchValueById.get(userId))
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (normalizedSearch && !searchContent.includes(normalizedSearch)) {
        return false;
      }

      if (projectAppTypeFilter === "with-app-types" && !projectAppTypes.length) {
        return false;
      }

      if (projectAppTypeFilter === "without-app-types" && projectAppTypes.length) {
        return false;
      }

      if (
        projectAppTypeFilter !== "all" &&
        projectAppTypeFilter !== "with-app-types" &&
        projectAppTypeFilter !== "without-app-types" &&
        !projectAppTypes.some((appType) => appType.type === projectAppTypeFilter)
      ) {
        return false;
      }

      if (projectMemberFilter === "with-members" && !projectMemberUserIds.size) {
        return false;
      }

      if (projectMemberFilter === "without-members" && projectMemberUserIds.size) {
        return false;
      }

      if (
        projectMemberFilter !== "all" &&
        projectMemberFilter !== "with-members" &&
        projectMemberFilter !== "without-members" &&
        !projectMemberUserIds.has(projectMemberFilter)
      ) {
        return false;
      }

      return true;
    }).sort((left, right) => {
      const leftLocked = left.project.has_access === false;
      const rightLocked = right.project.has_access === false;

      if (leftLocked !== rightLocked) {
        return leftLocked ? 1 : -1;
      }

      const leftFavorite = Boolean(left.project.is_favorite);
      const rightFavorite = Boolean(right.project.is_favorite);
      if (leftFavorite !== rightFavorite) {
        return leftFavorite ? -1 : 1;
      }

      return 0;
    });
  }, [
    projectAppTypeFilter,
    projectPortfolioItems,
    projectMemberFilter,
    projectMemberUserIdsByProjectId,
    deferredProjectSearch,
    userSearchValueById
  ]);

  const selectableFilteredProjectItems = filteredProjectItems.filter((item) => item.project.has_access !== false);
  const areAllFilteredProjectsSelected =
    Boolean(selectableFilteredProjectItems.length) && selectableFilteredProjectItems.every((item) => selectedActionProjectIds.includes(item.project.id));

  useEffect(() => {
    setSelectedActionProjectIds((current) =>
      current.filter((projectId) => projectPortfolioItems.some((item) => item.project.id === projectId))
    );
  }, [projectPortfolioItems]);

  const activeProjectFilterCount =
    (projectAppTypeFilter !== "all" ? 1 : 0) + (projectMemberFilter !== "all" ? 1 : 0);

  const scopedMembers = useMemo(
    () => (projectMembers.data || []).filter((member) => String(member.project_id) === String(projectId)),
    [projectMembers.data, projectId]
  );
  const scopedAppTypes = useMemo(
    () => (appTypes.data || []).filter((item) => String(item.project_id) === String(projectId)),
    [appTypes.data, projectId]
  );
  const traceabilityModulesQuery = useQuery({
    queryKey: ["project-traceability-modules", projectId, traceabilityAppTypeId],
    queryFn: () => api.testCaseModules.list({ app_type_id: traceabilityAppTypeId }),
    enabled: Boolean(projectId && traceabilityAppTypeId && loadProjectMetrics),
    staleTime: 30_000
  });
  const traceabilitySprintsQuery = useQuery({
    queryKey: ["project-traceability-sprints", projectId],
    queryFn: () => api.requirementIterations.list({ project_id: projectId }),
    enabled: Boolean(projectId && focusedProject && section === "traceability" && loadProjectMetrics),
    staleTime: 30_000
  });
  const traceabilityRequirementsQuery = useInfiniteQuery({
    queryKey: ["project-traceability-requirements", projectId],
    queryFn: ({ pageParam }) => api.requirements.listPage({
      project_id: projectId,
      page_size: 50,
      cursor: pageParam,
      projection: "summary"
    }).then((value) => normalizePagedResult<Requirement>(value)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage, _pages, _lastPageParam, pageParams) => {
      const cursor = getVerifiedNextPageCursor(lastPage);
      return cursor && !pageParams.includes(cursor) ? cursor : undefined;
    },
    enabled: Boolean(projectId && focusedProject && section === "traceability" && loadProjectMetrics),
    staleTime: 30_000
  });
  const traceabilityCasesQuery = useInfiniteQuery({
    queryKey: ["project-traceability-cases", projectId, traceabilityAppTypeId],
    queryFn: ({ pageParam }) => api.testCases.listPage({
      app_type_id: traceabilityAppTypeId,
      page_size: 50,
      cursor: pageParam,
      projection: "summary"
    }).then((value) => normalizePagedResult<TestCase>(value)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage, _pages, _lastPageParam, pageParams) => {
      const cursor = getVerifiedNextPageCursor(lastPage);
      return cursor && !pageParams.includes(cursor) ? cursor : undefined;
    },
    enabled: Boolean(projectId && focusedProject && traceabilityAppTypeId && section === "traceability" && loadProjectMetrics),
    staleTime: 30_000
  });
  const traceabilityBugsQuery = useInfiniteQuery({
    queryKey: ["project-traceability-bugs", projectId],
    queryFn: ({ pageParam }) => api.issues.listPage({
      project_id: projectId,
      page_size: 50,
      cursor: pageParam,
      projection: "detail"
    }).then((value) => normalizePagedResult<Issue>(value)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage, _pages, _lastPageParam, pageParams) => {
      const cursor = getVerifiedNextPageCursor(lastPage);
      return cursor && !pageParams.includes(cursor) ? cursor : undefined;
    },
    enabled: Boolean(projectId && focusedProject && section === "traceability" && loadProjectMetrics),
    staleTime: 30_000
  });
  const traceabilityRequirements = useMemo(
    () => traceabilityRequirementsQuery.data?.pages?.flatMap((page) => page.items) || [],
    [traceabilityRequirementsQuery.data]
  );
  const traceabilityCases = useMemo(
    () => traceabilityCasesQuery.data?.pages?.flatMap((page) => page.items) || [],
    [traceabilityCasesQuery.data]
  );
  const traceabilityBugs = useMemo(
    () => traceabilityBugsQuery.data?.pages?.flatMap((page) => page.items) || [],
    [traceabilityBugsQuery.data]
  );
  const isTraceabilityLoading = traceabilityRequirementsQuery.isLoading || traceabilityCasesQuery.isLoading || traceabilityBugsQuery.isLoading || traceabilityModulesQuery.isLoading || traceabilitySprintsQuery.isLoading;
  const isTraceabilityError = traceabilityRequirementsQuery.isError || traceabilityCasesQuery.isError || traceabilityBugsQuery.isError || traceabilityModulesQuery.isError || traceabilitySprintsQuery.isError;
  const hasMoreTraceability = Boolean(traceabilityRequirementsQuery.hasNextPage || traceabilityCasesQuery.hasNextPage || traceabilityBugsQuery.hasNextPage);
  const isLoadingMoreTraceability = traceabilityRequirementsQuery.isFetchingNextPage || traceabilityCasesQuery.isFetchingNextPage || traceabilityBugsQuery.isFetchingNextPage;
  const traceabilityLoadMoreError = traceabilityRequirementsQuery.isFetchNextPageError || traceabilityCasesQuery.isFetchNextPageError || traceabilityBugsQuery.isFetchNextPageError;
  useEffect(() => {
    if (!scopedAppTypes.length) {
      setTraceabilityAppTypeId("");
      return;
    }
    if (!scopedAppTypes.some((item) => item.id === traceabilityAppTypeId)) {
      setTraceabilityAppTypeId(scopedAppTypes[0].id);
      setCurrentAppTypeId(scopedAppTypes[0].id);
    }
  }, [scopedAppTypes, setCurrentAppTypeId, traceabilityAppTypeId]);
  const assignableProjectRoles = useMemo(
    () => (roles.data || []).filter((role) => role.id !== "jira-admin"),
    [roles.data]
  );
  const newProjectRoleOptions = useMemo(
    () => NEW_PROJECT_ROLE_DEFAULTS.map((fallback) => {
      const configured = (projectCreationRolesQuery.data || roles.data || []).find((role) => role.id === fallback.id);
      return { id: fallback.id, name: configured?.name || fallback.name };
    }),
    [projectCreationRolesQuery.data, roles.data]
  );

  const projectMemberOptions = useMemo(
    () =>
      [...(projectCreationUsersQuery.data || users.data || [])].sort((left, right) => {
        const leftAuto = left.id === session?.user.id;
        const rightAuto = right.id === session?.user.id;

        if (leftAuto !== rightAuto) {
          return leftAuto ? -1 : 1;
        }

        return String(left.name || left.email).localeCompare(String(right.name || right.email));
      }),
    [projectCreationUsersQuery.data, session?.user.id, users.data]
  );
  const filteredProjectMemberOptions = useMemo(() => {
    const query = projectMemberSearch.trim().toLowerCase();

    if (!query) {
      return projectMemberOptions;
    }

    return projectMemberOptions.filter((user) =>
      [user.name, resolveVisibleEmail(user.email, canManageUsers)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [canManageUsers, projectMemberOptions, projectMemberSearch]);
  const selectableProjectMemberIds = useMemo(
    () =>
      projectMemberOptions
        .filter((user) => user.id !== session?.user.id)
        .map((user) => user.id),
    [projectMemberOptions, session?.user.id]
  );
  const areAllSelectableProjectMembersSelected =
    Boolean(selectableProjectMemberIds.length) &&
    selectableProjectMemberIds.every((userId) => projectDraft.memberIds.includes(userId));

  const selectedPortfolioMetric = projectId ? portfolioAnalyticsByProjectId.get(projectId) : null;
  const selectedProjectRequirementCount = selectedPortfolioMetric?.counts.stories ?? (projectId ? requirementCountByProjectId[projectId] || 0 : 0);
  const selectedProjectTestCaseCount = selectedPortfolioMetric?.counts.cases ?? (projectId ? testCaseCountByProjectId[projectId] || 0 : 0);
  const selectedProjectAppTypeCount = selectedPortfolioMetric?.counts.app_types ?? (projectId ? appTypeCountByProjectId[projectId] || 0 : 0);
  const selectedProjectBugCount = selectedPortfolioMetric?.counts.bugs ?? scopedProject?.bug_count ?? 0;
  const isProjectDetailsDirty = focusedProject !== null && (
    projectDetailsDraft.name !== focusedProject.name
    || projectDetailsDraft.description !== (focusedProject.description || "")
  );
  const selectedProjectPassCoverage = selectedPortfolioMetric ? {
    totalCases: selectedPortfolioMetric.pass_confidence.total,
    passedCases: selectedPortfolioMetric.pass_confidence.passed,
    coveragePercent: selectedPortfolioMetric.pass_confidence.percent,
    testCaseTotal: selectedPortfolioMetric.pass_confidence.case_total,
    testCasePassed: selectedPortfolioMetric.pass_confidence.case_passed,
    bugTotal: selectedPortfolioMetric.pass_confidence.bug_total,
    bugResolved: selectedPortfolioMetric.pass_confidence.bug_resolved
  } : projectId ? passCoverageByProjectId[projectId] || emptyPassCoverage : emptyPassCoverage;
  const focusedProjectSyncIntegrations = useMemo(
    () =>
      (integrationsQuery.data || []).filter(
        (integration) =>
          (integration.type === "google_drive" || integration.type === "github") &&
          integration.is_active &&
          integration.config?.project_id === focusedProject?.id
      ),
    [focusedProject?.id, integrationsQuery.data]
  );
  const lastProjectBackupByProvider = useMemo(
    () =>
      (projectSyncTransactionsQuery.data || []).reduce<Record<string, WorkspaceTransaction>>((accumulator, transaction) => {
        const provider = String(transaction.metadata?.provider || "");

        if (!provider || accumulator[provider]) {
          return accumulator;
        }

        accumulator[provider] = transaction;
        return accumulator;
      }, {}),
    [projectSyncTransactionsQuery.data]
  );
  const focusedGoogleDriveIntegration = focusedProjectSyncIntegrations.find((integration) => integration.type === "google_drive") || null;
  const focusedGithubIntegration = focusedProjectSyncIntegrations.find((integration) => integration.type === "github") || null;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["project-members"] }),
      queryClient.invalidateQueries({ queryKey: ["app-types"] }),
      queryClient.invalidateQueries({ queryKey: ["integrations"] }),
      queryClient.invalidateQueries({ queryKey: ["project-sync-transactions"] })
    ]);
  };

  const invalidateWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["project-members"] }),
      queryClient.invalidateQueries({ queryKey: ["app-types"] }),
      queryClient.invalidateQueries({ queryKey: ["requirements"] }),
      queryClient.invalidateQueries({ queryKey: ["test-cases"] }),
      queryClient.invalidateQueries({ queryKey: ["test-suites"] }),
      queryClient.invalidateQueries({ queryKey: ["test-steps"] }),
      queryClient.invalidateQueries({ queryKey: ["executions"] }),
      queryClient.invalidateQueries({ queryKey: ["execution-results"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-transaction-events"] }),
      queryClient.invalidateQueries({ queryKey: ["integrations"] }),
      queryClient.invalidateQueries({ queryKey: ["project-sync-transactions"] })
    ]);
  };

  const createProject = useMutation({
    mutationFn: async ({ project, attachments }: ProjectCreateMutationInput) => {
      const response = await api.projects.create(project);
      const uploaded: JiraAttachment[] = [];
      const attachmentErrors: string[] = [];
      const scope = { project_id: response.id, entity_type: "project" as const, entity_id: response.id };

      for (let offset = 0; offset < attachments.length; offset += 2) {
        const batch = attachments.slice(offset, offset + 2);
        const results = await Promise.allSettled(batch.map((file) => api.attachments.upload(scope, file)));
        results.forEach((result, index) => {
          if (result.status === "fulfilled") uploaded.push(result.value);
          else attachmentErrors.push(`${batch[index].name}: ${result.reason instanceof Error ? result.reason.message : "upload failed"}`);
        });
      }

      return {
        ...response,
        attachments_uploaded: uploaded.length,
        attachment_errors: attachmentErrors
      };
    },
    onSuccess: async (response) => {
      const provisioningErrorCount = response.provisioning_errors?.length || 0;
      const attachmentErrorCount = response.attachment_errors.length;
      const hasWarnings = Boolean(provisioningErrorCount || attachmentErrorCount);
      setMessageTone(hasWarnings ? "error" : "success");
      setMessage(provisioningErrorCount
        ? `Project created, but ${provisioningErrorCount} access or application item${provisioningErrorCount === 1 ? " needs" : "s need"} attention. Open the project and retry the missing setup.`
        : attachmentErrorCount
          ? `Project created with ${response.attachments_uploaded} attachment${response.attachments_uploaded === 1 ? "" : "s"}. ${attachmentErrorCount} file${attachmentErrorCount === 1 ? " needs" : "s need"} to be retried from Project Details.`
          : `Project created. ${response.members_added} HelloTest role assignment${response.members_added === 1 ? "" : "s"}, ${response.app_types_created} application${response.app_types_created === 1 ? "" : "s"}, and ${response.attachments_uploaded} compressed attachment${response.attachments_uploaded === 1 ? "" : "s"} are ready.`);
      queryClient.setQueryData<Project[]>(["projects", "catalog"], (current) => {
        const createdProject: Project = {
          id: response.id,
          display_id: response.display_id || null,
          name: response.name,
          description: response.description,
          visibility: response.visibility,
          created_by: response.created_by,
          has_access: true,
          is_favorite: false,
          story_count: 0,
          module_count: 0,
          case_count: 0,
          bug_count: 0
        };
        return [...asArray(current).filter((project) => project.id !== response.id), createdProject];
      });
      setSelectedProjectId(response.id);
      setFocusedProjectId(response.id);
      setIsCreateModalOpen(false);
      setExpandedProjectAppTypeId("");
      setProjectDraft(createInitialProjectDraft(defaultAppTypeValue));
      await invalidate();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to create project");
    }
  });
  const updateProjectFavorite = useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) =>
      favorite ? api.projects.favorite(id) : api.projects.unfavorite(id),
    onSuccess: (_response, input) => {
      queryClient.setQueryData<Project[]>(["projects", "catalog"], (current) =>
        asArray(current).map((project) =>
          project.id === input.id ? { ...project, is_favorite: input.favorite } : project
        )
      );
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to update project favorite");
    }
  });
  const updateProjectDetails = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name: string; description: string } }) =>
      api.projects.update(id, input),
    onSuccess: async (_response, { id, input }) => {
      queryClient.setQueryData<Project[]>(["projects", "catalog"], (current) =>
        current?.map((project) => project.id === id ? { ...project, ...input } : project)
      );
      setProjectDetailsDraft(input);
      setMessageTone("success");
      setMessage("Project details updated.");
      await invalidate();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to update project details");
    }
  });

  const createMember = useMutation({
    mutationFn: api.projectMembers.create,
    onSuccess: async () => {
      setMessageTone("success");
      setMessage("Project member added.");
      await invalidate();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to add project member");
    }
  });
  const updateMemberRole = useMutation({
    mutationFn: ({ memberId, roleId }: { memberId: string; roleId: string }) =>
      api.projectMembers.update(memberId, { role_id: roleId }),
    onSuccess: async () => {
      setMessageTone("success");
      setMessage("Project role updated.");
      await invalidate();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to update the project role");
    }
  });

  const createAppType = useMutation({
    mutationFn: api.appTypes.create,
    onSuccess: async () => {
      setMessageTone("success");
      setMessage("Application added.");
      await invalidate();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to add application");
    }
  });
  const queueProjectSync = useMutation({
    mutationFn: ({ projectId: syncProjectId, provider }: { projectId: string; provider: "google_drive" | "github" }) =>
      api.projects.sync(syncProjectId, provider),
    onSuccess: async (_, variables) => {
      setMessageTone("success");
      setMessage(`${variables.provider === "google_drive" ? "Google Drive backup" : "GitHub sync"} queued.`);
      await invalidate();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to queue project sync");
    }
  });
  const deleteProject = useMutation({
    mutationFn: api.projects.delete,
    onSuccess: async (_, deletedProjectId) => {
      setMessageTone("success");
      setMessage("Project deleted.");
      setFocusedProjectId("");
      setSelectedActionProjectIds((current) => current.filter((projectId) => projectId !== deletedProjectId));
      if (selectedProjectId === deletedProjectId) {
        setSelectedProjectId("");
      }
      await invalidateWorkspace();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to delete project");
    }
  });

  const openCreateProjectModal = () => {
    if (!canCreateProjects) {
      setMessageTone("error");
      setMessage("Permission required: project.manage");
      return;
    }

    const nextDraft = createInitialProjectDraft(defaultAppTypeValue);
    setProjectDraft(nextDraft);
    setExpandedProjectAppTypeId(nextDraft.appTypes[0]?.id || "");
    setProjectMemberSearch("");
    setIsProjectAttachmentDragging(false);
    setIsCreateModalOpen(true);
  };

  const closeCreateProjectModal = () => {
    if (createProject.isPending) {
      return;
    }

    setIsCreateModalOpen(false);
    setExpandedProjectAppTypeId("");
    setProjectMemberSearch("");
    setIsProjectAttachmentDragging(false);
  };
  const createProjectDialogRef = useDialogFocus<HTMLDivElement>({
    active: isCreateModalOpen,
    closeDisabled: createProject.isPending,
    onClose: closeCreateProjectModal
  });
  const closeRiskEvidenceDialog = useCallback(() => {
    setIsRiskEvidenceOpen(false);
  }, []);
  const riskEvidenceDialogRef = useDialogFocus<HTMLDivElement>({
    active: isRiskEvidenceOpen,
    onClose: closeRiskEvidenceDialog
  });
  const exportRiskEvidencePdf = async () => {
    if (!riskEvidenceReportRef.current || isExportingRiskPdf || !canExportPortfolioAttention) return;
    setIsExportingRiskPdf(true);
    try {
      const snapshot = await captureProjectAttentionSnapshot(riskEvidenceReportRef.current);
      const blob = await api.projects.downloadPortfolioAttentionPdf(snapshot);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "HelloTest-projects-needing-attention.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setMessageTone("success");
      setMessage("Projects needing attention PDF exported.");
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to export the attention report.");
    } finally {
      setIsExportingRiskPdf(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!focusedProject || deleteProject.isPending || !canDeleteProjects) {
      return;
    }

    const confirmed = await confirmDelete({ message: `Delete project "${focusedProject.name}" and all related data?` });

    if (!confirmed) {
      return;
    }

    await deleteProject.mutateAsync(focusedProject.id);
  };

  const handleDeleteSelectedProjects = async () => {
    if (!selectedActionProjectIds.length || deleteProject.isPending || !canDeleteProjects) {
      return;
    }

    const selectedProjects = projectPortfolioItems.filter((item) => selectedActionProjectIds.includes(item.project.id));
    const confirmed = await confirmDelete({
      message: `Delete ${selectedProjects.length} selected project${selectedProjects.length === 1 ? "" : "s"} and all related data?`
    });

    if (!confirmed) {
      return;
    }

    for (const projectId of selectedActionProjectIds) {
      await deleteProject.mutateAsync(projectId);
    }

    setSelectedActionProjectIds([]);
  };

  const updateProjectDraft = (input: Partial<ProjectCreateDraft>) => {
    setProjectDraft((current) => ({ ...current, ...input }));
  };

  const stageProjectAttachments = (files: FileList | File[]) => {
    if (!canCreateAttachments || projectAttachmentMetaQuery.data?.enabled === false) {
      setMessageTone("error");
      setMessage(projectAttachmentMetaQuery.data?.enabled === false
        ? "Attachments are disabled for this workspace."
        : "Permission required: attachment.create");
      return;
    }

    const candidates = Array.from(files);
    const uploadLimit = Number(projectAttachmentMetaQuery.data?.uploadLimit || 0);
    const invalid = candidates.find((file) => file.size <= 0 || (uploadLimit > 0 && file.size > uploadLimit));
    if (invalid) {
      setMessageTone("error");
      setMessage(invalid.size <= 0
        ? `${invalid.name} is empty and cannot be attached.`
        : `${invalid.name} exceeds the ${formatProjectAttachmentBytes(uploadLimit)} attachment limit.`);
      return;
    }

    const existingKeys = new Set(projectDraft.attachments.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    const unique = candidates.filter((file) => !existingKeys.has(`${file.name}:${file.size}:${file.lastModified}`));
    const availableSlots = Math.max(0, MAX_PROJECT_ATTACHMENTS - projectDraft.attachments.length);
    if (unique.length > availableSlots) {
      setMessageTone("error");
      setMessage(`Attach up to ${MAX_PROJECT_ATTACHMENTS} files to a project.`);
    }
    setProjectDraft((current) => ({
      ...current,
      attachments: [...current.attachments, ...unique.slice(0, availableSlots)]
    }));

    if (projectAttachmentInputRef.current) projectAttachmentInputRef.current.value = "";
  };

  const removeProjectAttachment = (fileToRemove: File) => {
    setProjectDraft((current) => ({
      ...current,
      attachments: current.attachments.filter((file) => file !== fileToRemove)
    }));
  };

  const handleProjectAttachmentDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsProjectAttachmentDragging(false);
    if (event.dataTransfer.files.length) stageProjectAttachments(event.dataTransfer.files);
  };

  const resetProjectDetailsDraft = () => {
    if (!focusedProject || updateProjectDetails.isPending) return;
    setProjectDetailsDraft({
      name: focusedProject.name,
      description: focusedProject.description || ""
    });
  };

  const handleProjectDetailsSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!focusedProject || !canManageProjects || !isProjectDetailsDirty || updateProjectDetails.isPending) return;

    const name = projectDetailsDraft.name.trim();
    if (!name) {
      setMessageTone("error");
      setMessage("Project name is required.");
      return;
    }

    updateProjectDetails.mutate({
      id: focusedProject.id,
      input: { name, description: projectDetailsDraft.description.trim() }
    });
  };

  const toggleProjectDraftMember = (userId: string) => {
    setProjectDraft((current) => {
      const isSelected = current.memberIds.includes(userId);
      const memberRoleIds = { ...current.memberRoleIds };
      if (isSelected) {
        delete memberRoleIds[userId];
      } else {
        memberRoleIds[userId] = DEFAULT_NEW_PROJECT_MEMBER_ROLE_ID;
      }
      return {
        ...current,
        memberIds: isSelected
          ? current.memberIds.filter((id) => id !== userId)
          : [...current.memberIds, userId],
        memberRoleIds
      };
    });
  };

  const updateProjectDraftMemberRole = (userId: string, roleId: string) => {
    setProjectDraft((current) => ({
      ...current,
      memberRoleIds: { ...current.memberRoleIds, [userId]: roleId }
    }));
  };

  const selectAllProjectDraftMembers = () => {
    setProjectDraft((current) => ({
      ...current,
      memberIds: selectableProjectMemberIds,
      memberRoleIds: Object.fromEntries(selectableProjectMemberIds.map((userId) => [
        userId,
        current.memberRoleIds[userId] || DEFAULT_NEW_PROJECT_MEMBER_ROLE_ID
      ]))
    }));
  };

  const clearProjectDraftMembers = () => {
    setProjectDraft((current) => ({ ...current, memberIds: [], memberRoleIds: {} }));
  };

  const addProjectAppTypeRow = () => {
    const nextAppType = createProjectAppTypeDraft(defaultAppTypeValue);
    setProjectDraft((current) => ({
      ...current,
      appTypes: [...current.appTypes, nextAppType]
    }));
    setExpandedProjectAppTypeId(nextAppType.id);
  };

  const updateProjectAppType = (draftId: string, input: Partial<Omit<ProjectAppTypeDraft, "id">>) => {
    setProjectDraft((current) => ({
      ...current,
      appTypes: current.appTypes.map((appType) => (appType.id === draftId ? { ...appType, ...input } : appType))
    }));
  };

  const removeProjectAppType = (draftId: string) => {
    if (projectDraft.appTypes.length === 1) {
      const replacement = createProjectAppTypeDraft(defaultAppTypeValue);
      setProjectDraft((current) => ({ ...current, appTypes: [replacement] }));
      setExpandedProjectAppTypeId(replacement.id);
      return;
    }

    const remainingAppTypes = projectDraft.appTypes.filter((appType) => appType.id !== draftId);
    setProjectDraft((current) => ({
      ...current,
      appTypes: current.appTypes.filter((appType) => appType.id !== draftId)
    }));
    if (expandedProjectAppTypeId === draftId) {
      setExpandedProjectAppTypeId(remainingAppTypes[0]?.id || "");
    }
  };

  const handleProjectCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canCreateProjects) {
      setMessageTone("error");
      setMessage("Permission required: project.manage");
      return;
    }

    if (!session?.user.id) {
      setMessageTone("error");
      setMessage("You need an active session to create a project.");
      return;
    }

    const normalizedName = projectDraft.name.trim();
    if (!normalizedName) {
      setMessageTone("error");
      setMessage("Project name is required.");
      return;
    }

    const normalizedAppTypes = projectDraft.appTypes
      .map((appType) => ({
        name: appType.name.trim(),
        type: appType.type,
        is_unified: appType.is_unified
      }))
      .filter((appType) => appType.name);

    if (!normalizedAppTypes.length) {
      setMessageTone("error");
      setMessage("At least one application is required.");
      return;
    }

    createProject.mutate({
      project: {
        name: normalizedName,
        description: projectDraft.description.trim() || undefined,
        visibility: projectDraft.visibility,
        members: (projectDraft.visibility === "public" ? projectDraft.memberIds : []).map((userId) => ({
          user_id: userId,
          role_id: projectDraft.memberRoleIds[userId] || DEFAULT_NEW_PROJECT_MEMBER_ROLE_ID
        })),
        app_types: normalizedAppTypes
      },
      attachments: projectDraft.attachments
    });
  };

  const handleRemoveMember = async (member: { id: string; user_id: string }) => {
    if (member.user_id === session?.user.id) {
      const confirmed = await confirmDelete({ message: "Remove yourself from this project? You will no longer be able to access it." });
      if (!confirmed) return;
    }

    try {
      await api.projectMembers.delete(member.id);
      setMessageTone("success");
      setMessage(`Member removed. ${member.user_id === session?.user.id ? "You have been removed from this project." : ""}`);
      await invalidate();
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to remove member");
    }
  };

  const openProjectSection = (targetSection: ProjectSection) => {
    if (!focusedProject) {
      return;
    }

    setSelectedProjectId(focusedProject.id);
    setSection(targetSection);
  };

  const openProjectWorkspacePage = (path: string) => {
    if (!focusedProject) {
      return;
    }

    setSelectedProjectId(focusedProject.id);
    navigate(path);
  };

  const openPortfolioProject = useCallback((item: ProjectPortfolioItem) => {
    if (item.project.has_access === false) return;
    setSection("details");
    // Establish the local master-detail transition before broadcasting the
    // project scope change. The scope event is synchronous and otherwise can
    // consume the first catalog click while the page is still in browse mode.
    setFocusedProjectId(item.project.id);
    setSelectedProjectId(item.project.id);
  }, [setSelectedProjectId]);

  const openPortfolioProjectPath = useCallback((item: ProjectPortfolioItem, path: string) => {
    if (item.project.has_access === false) return;
    setSelectedProjectId(item.project.id);
    setFocusedProjectId(item.project.id);
    navigate(path);
  }, [navigate, setSelectedProjectId]);

  const toggleProjectFavorite = useCallback((item: ProjectPortfolioItem) => {
    if (updateProjectFavorite.isPending) return;
    updateProjectFavorite.mutate({ id: item.project.id, favorite: !item.project.is_favorite });
  }, [updateProjectFavorite]);

  const getProjectActionItems = useCallback((item: ProjectPortfolioItem) => [
    {
      label: "Open project details",
      icon: <OpenIcon />,
      onClick: () => openPortfolioProject(item),
      requiredPermissions: ["project.view"],
      description: "Open project details, members, applications, attachments, and traceability."
    },
    {
      label: "Open stories",
      icon: <TileCardRequirementIcon />,
      onClick: () => openPortfolioProjectPath(item, "/backlog"),
      featureKeys: ["hellotest.manual.requirements"],
      requiredPermissions: ["requirement.view"],
      description: "Review story scope and coverage links."
    },
    {
      label: "Open test cases",
      icon: <TileCardCaseIcon />,
      onClick: () => openPortfolioProjectPath(item, "/test-cases"),
      featureKeys: ["hellotest.manual.test_cases"],
      requiredPermissions: ["testcase.view"],
      description: "Review manual and automated test cases for this project."
    },
    {
      label: "Create run",
      icon: <PlayIcon />,
      onClick: () => openPortfolioProjectPath(item, "/executions"),
      featureKeys: ["hellotest.manual.runs"],
      requiredPermissions: ["run.create"],
      description: "Move to the execution console with this project selected.",
      tone: "primary" as const
    },
    {
      label: "Delete project",
      icon: <TrashIcon />,
      onClick: async () => {
        setFocusedProjectId(item.project.id);
        const confirmed = await confirmDelete({ message: `Delete project "${item.project.name}" and all related data?` });

        if (confirmed) {
          await deleteProject.mutateAsync(item.project.id);
        }
      },
      disabled: deleteProject.isPending,
      requiredPermissions: ["project.delete"],
      description: "Delete this project and related workspace data.",
      tone: "danger" as const
    }
  ], [confirmDelete, deleteProject.isPending, deleteProject.mutateAsync, openPortfolioProject, openPortfolioProjectPath]);

  const projectListColumns = useMemo<Array<DataTableColumn<ProjectPortfolioItem>>>(() => [
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
            aria-label="Select all filtered projects"
            checked={areAllFilteredProjectsSelected}
            onChange={(event) =>
              setSelectedActionProjectIds((current) =>
                event.target.checked
                  ? [...new Set([...current, ...selectableFilteredProjectItems.map((item) => item.project.id)])]
                  : current.filter((projectId) => !selectableFilteredProjectItems.some((item) => item.project.id === projectId))
              )
            }
            type="checkbox"
          />
        </label>
      ),
      render: (item) => (
        <div onClick={(event) => event.stopPropagation()}>
          <input
            aria-label={`Select ${item.project.name}`}
            checked={selectedActionProjectIds.includes(item.project.id)}
            disabled={item.project.has_access === false}
            onChange={(event) =>
              setSelectedActionProjectIds((current) =>
                event.target.checked
                  ? [...new Set([...current, item.project.id])]
                  : current.filter((projectId) => projectId !== item.project.id)
              )
            }
            type="checkbox"
          />
        </div>
      )
    },
    {
      key: "select-favorite",
      label: "Favorite",
      headerRender: () => (
        <span className="project-favorite-column-label" title="Favorites">
          <IconStar aria-hidden="true" size={16} stroke={2} />
          <span className="sr-only">Favorite</span>
        </span>
      ),
      canToggle: false,
      canReorder: false,
      canResize: false,
      width: 88,
      render: (item) => (
        <button
          aria-label={`${item.project.is_favorite ? "Remove" : "Add"} ${item.project.name} ${item.project.is_favorite ? "from" : "to"} favorites`}
          aria-pressed={Boolean(item.project.is_favorite)}
          className={item.project.is_favorite ? "project-favorite-button is-favorite" : "project-favorite-button"}
          disabled={updateProjectFavorite.isPending}
          onClick={(event) => {
            event.stopPropagation();
            toggleProjectFavorite(item);
          }}
          title={item.project.is_favorite ? "Remove from favorites" : "Add to favorites"}
          type="button"
        >
          <IconStar aria-hidden="true" fill={item.project.is_favorite ? "currentColor" : "none"} size={18} stroke={2} />
        </button>
      )
    },
    {
      key: "id",
      label: "ID",
      width: 120,
      minWidth: 96,
      sortValue: (item) => item.project.display_id || item.project.id,
      render: (item) => <DisplayIdBadge value={item.project.display_id || item.project.id} />
    },
    {
      key: "project",
      label: "Project",
      canToggle: false,
      width: 280,
      minWidth: 180,
      sortValue: (item) => item.project.name,
      render: (item) => (
        <div className="projects-list-project-cell">
          <TileCardIconFrame className={item.project.has_access === false ? "projects-list-project-icon is-locked" : "projects-list-project-icon"} tone={item.project.has_access === false ? "neutral" : "info"}>
            {item.project.has_access === false ? <IconLock size={16} stroke={2.2} /> : <TileCardProjectIcon />}
          </TileCardIconFrame>
          <div className="projects-list-primary-cell">
            <strong>{item.project.name}</strong>
            <span>{item.project.has_access === false ? "Access required" : richTextToPlainText(item.project.description) || "No description yet."}</span>
          </div>
        </div>
      )
    },
    {
      key: "readiness",
      label: "Readiness",
      width: 180,
      minWidth: 140,
      sortValue: (item) => item.readinessScore,
      render: (item) => item.project.has_access === false ? (
        <span className="project-locked-list-label"><IconLock aria-hidden="true" size={14} /> Locked</span>
      ) : (
        <div className="projects-list-status-cell">
          <span className={`project-health-badge ${item.healthTone}`}>{item.healthLabel}</span>
          <strong>{item.readinessScore}%</strong>
          <span>{item.readinessLabel}</span>
        </div>
      )
    },
    {
      key: "scope",
      label: "Scope",
      width: 240,
      minWidth: 164,
      sortValue: (item) => item.appTypeCount,
      render: (item) => item.project.has_access === false ? "—" : (
        <div className="projects-list-meta-cell">
          <strong>{item.appTypeCount} applications</strong>
          <span>{item.suiteCount} suites / {item.requirementCount} stories / {item.testCaseCount} cases</span>
        </div>
      )
    },
    {
      key: "members",
      label: "Members",
      defaultVisible: false,
      width: 260,
      minWidth: 180,
      sortValue: (item) => item.memberCount,
      render: (item) => item.project.has_access === false ? "—" : item.memberNames.length ? item.memberNames.join(", ") : "No members assigned"
    },
    {
      key: "coverage",
      label: "Coverage",
      width: 220,
      minWidth: 160,
      sortValue: (item) => item.coverage.coveragePercent,
      render: (item) => item.project.has_access === false ? "—" : (
        <div className="projects-list-meta-cell">
          <span>Story {item.coverage.coveragePercent}%</span>
          <span>Auto {item.automationCoverage.coveragePercent}%</span>
          <span>Pass {item.passCoverage.coveragePercent}%</span>
        </div>
      )
    },
    {
      key: "latestRun",
      label: "Latest run",
      width: 220,
      minWidth: 160,
      sortValue: (item) => item.latestExecution?.created_at || item.latestExecution?.started_at || "",
      render: (item) => item.project.has_access === false ? "—" : (
        <div className="projects-list-meta-cell">
          <strong>{item.latestRunLabel}</strong>
          <span>{item.latestExecution?.status || "No execution"} / {item.latestFailedCount} failed</span>
          <span>{item.latestDurationLabel}</span>
        </div>
      )
    }
  ], [areAllFilteredProjectsSelected, selectableFilteredProjectItems, selectedActionProjectIds, toggleProjectFavorite, updateProjectFavorite.isPending]);

  const projectListRowGroups = useMemo(() => [
    {
      key: "favorites",
      header: <span className="project-list-group-label"><IconStar aria-hidden="true" fill="currentColor" size={14} /> Favorites</span>,
      rows: filteredProjectItems.filter((item) => item.project.has_access !== false && item.project.is_favorite)
    },
    {
      key: "projects",
      header: <span className="project-list-group-label"><TileCardProjectIcon /> Projects</span>,
      rows: filteredProjectItems.filter((item) => item.project.has_access !== false && !item.project.is_favorite)
    },
    {
      key: "locked",
      header: <span className="project-list-group-label is-locked"><IconLock aria-hidden="true" size={14} /> Locked</span>,
      rows: filteredProjectItems.filter((item) => item.project.has_access === false)
    }
  ].filter((group) => group.rows.length), [filteredProjectItems]);

  return (
    <div className="page-content projects-page">
      {confirmationDialog}
      <ToastMessage
        message={message}
        onDismiss={() => setMessage("")}
        tone={messageTone}
      />

      {!focusedProject ? (
        <>
          <section className="projects-command-card">
            <div className="projects-command-copy">
              <h2 className="page-header-title">Projects</h2>
            </div>
            <div className="projects-command-insight">
              <EvidenceFlipCard
                autoResetMs={12_000}
                caption={`${portfolioSummary.riskyProjects} risky · ${portfolioSummary.watchProjects} watch · accessible portfolio`}
                className="projects-attention-flip-card"
                evidence={compactAttentionEvidence.length ? compactAttentionEvidence : ["No accessible project crosses the configured attention rules."]}
                label="Projects need attention"
                maxEvidenceItems={4}
                tone={portfolioSummary.attentionProjects ? "warning" : "success"}
                value={`${portfolioSummary.attentionProjects}/${portfolioSummary.accessibleProjects}`}
              />
              <div className="projects-health-ring" style={{ "--score": `${portfolioSummary.overallHealth}%` } as CSSProperties}>
                <strong>{portfolioSummary.overallHealth}%</strong>
                <span>Overall health</span>
                <MetricMethodologyInfo criteriaKey="metric.project.portfolio_health" evidence={`${projectPortfolioItems.filter((item) => item.project.has_access !== false).length} equally weighted accessible project readiness scores; locked projects are excluded.`} organizationCriteria={getMetricCriteria("metric.project.portfolio_health")} />
              </div>
              <button
                aria-haspopup="dialog"
                className="projects-view-evidence-button"
                onClick={() => setIsRiskEvidenceOpen(true)}
                type="button"
              >
                Inspect portfolio evidence
              </button>
            </div>
          </section>

          <section className="projects-stats-grid metric-strip page-metric-strip" aria-label="Portfolio summary">
            <PortfolioMetricCard
              caption="projects in portfolio"
              evidence={[
                `${portfolioSummary.accessibleProjects} accessible projects included in quality calculations`,
                `${portfolioSummary.lockedProjects} locked project${portfolioSummary.lockedProjects === 1 ? "" : "s"} excluded from sensitive evidence`,
                `${portfolioSummary.assessedProjects} with assessable QA scope`
              ]}
              label="Total Projects"
              value={portfolioSummary.totalProjects}
            />
            <PortfolioMetricCard
              caption="Needs immediate review"
              evidence={[
                `${portfolioSummary.executionFailureCases} failed and ${portfolioSummary.executionBlockedCases} blocked latest outcomes`,
                `${portfolioSummary.riskyLowPassProjects} below the ${portfolioSummary.riskPassThreshold}% Test Case and Bug pass-rate threshold`
              ]}
              label="Risky Projects"
              criteriaKey="metric.project.risky_classification"
              tone="danger"
              value={portfolioSummary.riskyProjects}
            />
            <PortfolioMetricCard
              caption="Passing health threshold"
              evidence={[
                `${portfolioSummary.readyWithExecutionEvidence} with execution evidence`,
                `${portfolioSummary.releaseReadyAverage}% average readiness`
              ]}
              label="Release Ready"
              criteriaKey="metric.project.release_ready"
              tone="success"
              value={portfolioSummary.releaseReadyProjects}
            />
            <PortfolioMetricCard
              caption="Below run-evidence policy"
              evidence={[
                `${portfolioSummary.evidenceMissingProjects} accessible project${portfolioSummary.evidenceMissingProjects === 1 ? "" : "s"} violate the configured threshold`,
                `Screenshots, videos, and comments on the latest run or its results count as evidence`,
                `Projects without finalized run outcomes are flagged when QA scope exists`
              ]}
              label="Evidence Missing"
              criteriaKey="metric.project.execution_evidence"
              tone="warning"
              value={portfolioSummary.evidenceMissingProjects}
            />
            {canViewProjectAutomationCoverage ? (
              <PortfolioMetricCard
                caption="Automation maturity"
                evidence={[
                  `${portfolioSummary.automatedCases} of ${portfolioSummary.totalCases} cases automated`,
                  `${portfolioSummary.totalCases - portfolioSummary.automatedCases} manual or incomplete`
                ]}
                label="Automation Coverage"
                criteriaKey="metric.project.average_automation_coverage"
                tone="info"
                value={`${portfolioSummary.averageAutomationCoverage}%`}
              />
            ) : null}
          </section>
        </>
      ) : null}

      <WorkspaceMasterDetail
        browseView={(
          <Panel
            className="projects-catalog-panel"
            title="Project Portfolio"
            titleVariant="eyebrow"
            subtitle="Browse workspace scope, then open a focused project workspace when you want to edit members or applications."
            actions={(
              <div className="projects-catalog-actions catalog-command-toolbar">
                <div className="catalog-toolbar-discovery" aria-label="Project views, search, and selection">
                  <CatalogViewToggle onChange={setProjectViewMode} value={projectViewMode} />
                  <CatalogSearchFilter
                    activeFilterCount={activeProjectFilterCount}
                    ariaLabel="Search projects"
                    onChange={setProjectSearch}
                    placeholder="Search projects"
                    subtitle="Filter projects by application scope or project members."
                    title="Filter projects"
                    type="search"
                    value={projectSearch}
                  >
                    <div className="catalog-filter-grid">
                      <label className="catalog-filter-field">
                        <span>Application</span>
                        <select onChange={(event) => setProjectAppTypeFilter(event.target.value)} value={projectAppTypeFilter}>
                          <option value="all">All applications</option>
                          <option value="with-app-types">Has applications</option>
                          <option value="without-app-types">No applications</option>
                          {appTypeTypeOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="catalog-filter-field">
                        <span>Project member</span>
                        <select onChange={(event) => setProjectMemberFilter(event.target.value)} value={projectMemberFilter}>
                          <option value="all">All members</option>
                          <option value="with-members">Has members</option>
                          <option value="without-members">No members</option>
                          {projectMemberOptions.map((user) => (
                            <option key={user.id} value={user.id}>{user.name || visibleUserEmail(user.email) || "Unnamed user"}</option>
                          ))}
                        </select>
                      </label>
                      <div className="catalog-filter-actions">
                        <button
                          className="ghost-button"
                          disabled={!activeProjectFilterCount}
                          onClick={() => {
                            setProjectAppTypeFilter("all");
                            setProjectMemberFilter("all");
                          }}
                          type="button"
                        >
                          Clear filters
                        </button>
                      </div>
                    </div>
                  </CatalogSearchFilter>
                  <CatalogSelectionControls
                    allSelected={areAllFilteredProjectsSelected}
                    canSelectAll={Boolean(selectableFilteredProjectItems.length)}
                    onClear={() => setSelectedActionProjectIds([])}
                    onSelectAll={() =>
                      setSelectedActionProjectIds((current) => [...new Set([...current, ...selectableFilteredProjectItems.map((item) => item.project.id)])])
                    }
                    selectedCount={selectedActionProjectIds.length}
                  />
                </div>
                <div className="catalog-toolbar-actions" aria-label="Project actions">
                  <button
                    className="ghost-button projects-catalog-create-button"
                    disabled={!canCreateProjects}
                    onClick={openCreateProjectModal}
                    type="button"
                  >
                    <AddIcon />
                    <span>Create New Project</span>
                  </button>
                  <button
                    className="ghost-button danger projects-catalog-delete-button"
                    disabled={!selectedActionProjectIds.length || !canDeleteProjects || deleteProject.isPending}
                    onClick={() => void handleDeleteSelectedProjects()}
                    type="button"
                  >
                    <TrashIcon />
                    <span>
                      {deleteProject.isPending
                        ? "Deleting…"
                        : selectedActionProjectIds.length
                          ? `Delete selected (${selectedActionProjectIds.length})`
                          : "Delete selected"}
                    </span>
                  </button>
                </div>
              </div>
            )}
          >
            {isProjectCatalogLoading ? <TileCardSkeletonGrid className="catalog-grid compact" /> : null}
            {!isProjectCatalogLoading ? (
              projectViewMode === "tile" ? (
                <div className="projects-grid">
                  {filteredProjectItems.map((item) => {
                    const { project, coverage, automationCoverage, passCoverage } = item;
                    const isLocked = project.has_access === false;
                    const isSelected = String(selectedProjectId) === String(project.id);
                    const requirementCoverageDetail = coverage.totalRequirements
                      ? `${coverage.coveredRequirements}/${coverage.totalRequirements} stories covered`
                      : "No stories available to measure coverage";
                    const automationCoverageDetail = automationCoverage.totalCases
                      ? `${automationCoverage.automatedCases}/${automationCoverage.totalCases} cases automated`
                      : "No test cases available to measure automation coverage";
                    const passCoverageDetail = formatPassCoverageDetail(passCoverage);

                    return (
                      <article
                        key={project.id}
                        aria-pressed={isSelected}
                        className={[
                          "project-portfolio-card",
                          `is-${item.healthTone}`,
                          project.is_favorite ? "is-favorite" : "",
                          isLocked ? "is-locked" : "",
                          isSelected ? "is-active" : ""
                        ].filter(Boolean).join(" ")}
                        onClick={isLocked ? undefined : () => openPortfolioProject(item)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) {
                            return;
                          }

                          if (!isLocked && (event.key === "Enter" || event.key === " ")) {
                            event.preventDefault();
                            openPortfolioProject(item);
                          }
                        }}
                        role={isLocked ? "article" : "button"}
                        tabIndex={isLocked ? -1 : 0}
                      >
                        <div className="project-portfolio-topline">
                          <div className="tile-card-select-row project-card-select-row">
                            <label className="checkbox-field" onClick={(event) => event.stopPropagation()}>
                              <input
                                aria-label={`Select ${project.name}`}
                                checked={selectedActionProjectIds.includes(project.id)}
                                disabled={isLocked}
                                onChange={(event) =>
                                  setSelectedActionProjectIds((current) =>
                                    event.target.checked
                                      ? [...new Set([...current, project.id])]
                                      : current.filter((projectId) => projectId !== project.id)
                                  )
	                                }
	                                type="checkbox"
	                              />
	                              <span className="sr-only">Select project</span>
	                            </label>
	                            <div className="project-portfolio-title">
                                <span className="project-card-icon-stack">
	                                <TileCardIconFrame className={isLocked ? "project-card-icon is-locked" : "project-card-icon"} tone={isLocked ? "neutral" : isSelected ? "success" : "info"}>
	                                  {isLocked ? <IconLock size={18} stroke={2.2} /> : <TileCardProjectIcon />}
	                                </TileCardIconFrame>
                                  <button
                                    aria-label={`${project.is_favorite ? "Remove" : "Add"} ${project.name} ${project.is_favorite ? "from" : "to"} favorites`}
                                    aria-pressed={Boolean(project.is_favorite)}
                                    className={project.is_favorite ? "project-favorite-button project-tile-favorite is-favorite" : "project-favorite-button project-tile-favorite"}
                                    disabled={updateProjectFavorite.isPending}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      toggleProjectFavorite(item);
                                    }}
                                    title={project.is_favorite ? "Remove from favorites" : "Add to favorites"}
                                    type="button"
                                  >
                                    <IconStar aria-hidden="true" fill={project.is_favorite ? "currentColor" : "none"} size={14} stroke={2.2} />
                                  </button>
                                </span>
	                              <DisplayIdBadge value={project.display_id || project.id} />
	                              <div>
	                                <h3>{project.name}</h3>
	                              </div>
                            </div>
                            <div className="project-card-top-actions" onClick={(event) => event.stopPropagation()}>
                              <span className={`project-health-badge ${isLocked ? "neutral" : item.healthTone}`}>{isLocked ? "Locked" : item.healthLabel}</span>
                              {!isLocked ? (
                                <CatalogActionMenu
                                  actions={getProjectActionItems(item)}
                                  label={`${project.name} actions`}
                                />
                              ) : null}
                            </div>
                          </div>
                        </div>

                        {isLocked ? (
                          <div className="project-card-locked-state">
                            <span className="project-card-locked-symbol"><IconLock aria-hidden="true" size={20} stroke={2} /></span>
                            <div>
                              <strong>Project access required</strong>
                              <p>This project is visible in the workspace catalog, but its scope and activity remain private.</p>
                            </div>
                          </div>
                        ) : <>
                        <div className={`project-readiness-row ${item.healthTone}`}>
                          <div>
                            <span>Release Readiness</span>
                            <strong>{item.readinessLabel}</strong>
                          </div>
                          <button
                            className="project-mini-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              openPortfolioProject(item);
                            }}
                            type="button"
                          >
                            Open
                          </button>
                        </div>

                        <div className="project-card-progress-stack" aria-label={`${project.name} coverage summary`}>
                          <ProjectProgressBar
                            detail={requirementCoverageDetail}
                            label="Story coverage"
                            tone={getMetricTone(coverage.coveredRequirements, coverage.totalRequirements)}
                            value={coverage.coveragePercent}
                          />
                          <ProjectProgressBar
                            detail={automationCoverageDetail}
                            label="Automation coverage"
                            tone={getMetricTone(automationCoverage.automatedCases, automationCoverage.totalCases)}
                            value={automationCoverage.coveragePercent}
                          />
                          <ProjectProgressBar
                            detail={passCoverageDetail}
                            label="Pass rate"
                            tone={getMetricTone(passCoverage.passedCases, passCoverage.totalCases)}
                            value={passCoverage.coveragePercent}
                          />
                        </div>

                        {item.latestExecution ? (
                          <div className="project-execution-strip">
                            <div><span>Last Run</span><strong>{item.latestRunLabel}</strong></div>
                            <div><span>Status</span><strong>{item.latestExecution.status || "Unknown"}</strong></div>
                            <div><span>Failed</span><strong>{item.latestFailedCount}</strong></div>
                            <div><span>Duration</span><strong>{item.latestDurationLabel}</strong></div>
                          </div>
                        ) : null}

                        <div className="project-meta-grid">
                          <span><b>{item.requirementCount}</b> Stories</span>
                          <span><b>{item.moduleCount}</b> Modules</span>
                          <span><b>{item.testCaseCount}</b> Cases</span>
                          <span><b>{item.bugCount}</b> Bugs</span>
                        </div>

                        <div className={`project-risk-note ${item.healthTone}`}>
                          <span>{item.healthTone === "danger" ? "!" : "Focus"}</span>
                          <p>{item.insight}</p>
                        </div>
                        </>}

                        <div className="project-card-actions" aria-hidden="true" />
                      </article>
                    );
                  })}
                </div>
              ) : filteredProjectItems.length ? (
                <DataTable
                  columns={projectListColumns}
                  enableColumnResize
                  enableHeaderColumnReorder
                  emptyMessage="No projects match the current search or filters."
                  getRowClassName={(item) => [
                    String(selectedProjectId) === String(item.project.id) ? "is-active-row" : "",
                    item.project.is_favorite ? "is-favorite-row" : "",
                    item.project.has_access === false ? "is-locked-row" : ""
                  ].filter(Boolean).join(" ")}
                  getRowKey={(item) => item.project.id}
                  hideToolbarCopy
                  onRowClick={openPortfolioProject}
                  renderRowActions={(item) => (
                    <div className="projects-list-actions">
                      {item.project.has_access !== false ? (
                        <CatalogActionMenu actions={getProjectActionItems(item)} label={`${item.project.name} actions`} />
                      ) : null}
                    </div>
                  )}
                  rowGroups={projectListRowGroups}
                  rows={filteredProjectItems}
                  storageKey="hellotest:projects:list-columns"
                />
              ) : null
            ) : null}
            {!isProjectCatalogLoading && !projectItems.length ? <div className="empty-state compact">No projects yet. Create the first project to add scope, applications, and the initial team in one flow.</div> : null}
            {!isProjectCatalogLoading && projectItems.length > 0 && !filteredProjectItems.length ? <div className="empty-state compact">No projects match the current search or filters.</div> : null}
          </Panel>
        )}
        detailView={(
          <div className="stack-grid">
            <Panel
              actions={<WorkspaceBackButton label="Back to projects list" onClick={() => {
                setFocusedProjectId("");
              }} />}
              title={focusedProject ? focusedProject.name : "Project summary"}
              subtitle={focusedProject ? "Quick orientation before you dive into related records." : "Select a project to reveal its scoped data."}
            >
              {focusedProject ? (
                <>
                  <SubnavTabs
                    value={section}
                    onChange={setSection}
                    items={[
                      { value: "details", label: "Project details" },
                      { value: "members", label: "Members", meta: `${scopedMembers.length}` },
                      { value: "applications", label: "Applications", meta: `${scopedAppTypes.length}` },
                      { value: "attachments", label: "Attachments" },
                      { value: "traceability", label: "Traceability", meta: traceabilityAppTypeId ? "Live" : "—" }
                    ]}
                  />
                  {section === "details" ? <div className="detail-stack">
                    <form className="project-details-edit-form" onSubmit={handleProjectDetailsSave}>
                      <div className="project-details-edit-heading">
                        <div>
                          <span className="project-details-eyebrow">Project details</span>
                          <h3>Name and description</h3>
                          <p>Keep the description concise and scannable so the team understands the project scope quickly.</p>
                        </div>
                      </div>
                      <div className="project-details-edit-fields">
                        <FormField label="Project name" inputId="project-details-name" required>
                          <input
                            disabled={!canManageProjects || updateProjectDetails.isPending}
                            id="project-details-name"
                            onChange={(event) => setProjectDetailsDraft((current) => ({ ...current, name: event.target.value }))}
                            value={projectDetailsDraft.name}
                          />
                        </FormField>
                        <FormField label="Description" inputId="project-details-description">
                          <RichTextEditor
                            aiRephraseContext={{
                              entityType: "project",
                              entityId: focusedProject.id,
                              entityTitle: projectDetailsDraft.name || focusedProject.name,
                              fieldLabel: "Project description"
                            }}
                            aiRephraseTitle="Rephrase project description with AI"
                            aria-label="Project description"
                            appearance="canonical"
                            className="project-details-description-editor"
                            disabled={!canManageProjects || updateProjectDetails.isPending}
                            id="project-details-description"
                            onChange={(description) => setProjectDetailsDraft((current) => ({ ...current, description }))}
                            placeholder="Describe the goals, scope, systems, and intended quality outcomes..."
                            rows={5}
                            value={projectDetailsDraft.description}
                          />
                        </FormField>
                      </div>
                      {canManageProjects && isProjectDetailsDirty ? (
                        <div className="project-details-edit-actions">
                          <span>You have unsaved changes.</span>
                          <button className="ghost-button" disabled={updateProjectDetails.isPending} onClick={resetProjectDetailsDraft} type="button">Cancel</button>
                          <button className="primary-button" disabled={!projectDetailsDraft.name.trim() || updateProjectDetails.isPending} type="submit">
                            {updateProjectDetails.isPending ? "Saving…" : "Save changes"}
                          </button>
                        </div>
                      ) : null}
                    </form>
                  <div className="metric-strip">
                    <button
                      aria-label={`Open members for ${focusedProject.name}`}
                      className="mini-card project-metric-link-card metric-ribbon-card metric-evidence-trigger"
                      onClick={() => openProjectSection("members")}
                      type="button"
                    >
                      <strong>{scopedMembers.length}</strong>
                      <span>Members</span>
                      <span className="metric-evidence-hint">Open evidence</span>
                    </button>
                    <button
                      aria-label={`Open applications for ${focusedProject.name}`}
                      className="mini-card project-metric-link-card metric-ribbon-card metric-evidence-trigger"
                      onClick={() => openProjectSection("applications")}
                      type="button"
                    >
                      <strong>{selectedProjectAppTypeCount}</strong>
                      <span>Applications</span>
                      <span className="metric-evidence-hint">Open evidence</span>
                    </button>
                    <button
                      aria-label={`Open stories for ${focusedProject.name}`}
                      className="mini-card project-metric-link-card metric-ribbon-card metric-evidence-trigger"
                      onClick={() => openProjectWorkspacePage("/backlog")}
                      type="button"
                    >
                      <strong>{selectedProjectRequirementCount}</strong>
                      <span>Stories</span>
                      <span className="metric-evidence-hint">Open evidence</span>
                    </button>
                    <button
                      aria-label={`Open test cases for ${focusedProject.name}`}
                      className="mini-card project-metric-link-card metric-ribbon-card metric-evidence-trigger"
                      onClick={() => openProjectWorkspacePage("/test-cases")}
                      type="button"
                    >
                      <strong>{selectedProjectTestCaseCount}</strong>
                      <span>Test cases</span>
                      <span className="metric-evidence-hint">Open evidence</span>
                    </button>
                    <button
                      aria-label={`Open bugs for ${focusedProject.name}`}
                      className="mini-card project-metric-link-card metric-ribbon-card metric-evidence-trigger"
                      onClick={() => openProjectWorkspacePage("/issues")}
                      type="button"
                    >
                      <strong>{selectedProjectBugCount}</strong>
                      <span>Total Bugs</span>
                      <span className="metric-evidence-hint">Open evidence</span>
                    </button>
                    <button
                      aria-label={`Open execution results for ${focusedProject.name}`}
                      className="mini-card project-metric-link-card metric-ribbon-card metric-evidence-trigger"
                      onClick={() => openProjectWorkspacePage("/executions")}
                      type="button"
                    >
                      <strong>{`${selectedProjectPassCoverage.coveragePercent}%`}</strong>
                      <span>
                        {selectedProjectPassCoverage.totalCases
                          ? `Pass rate · ${formatPassCoverageDetail(selectedProjectPassCoverage)}`
                          : "Pass rate"}
                      </span>
                      <span className="metric-evidence-hint">Open evidence</span>
                    </button>
                  </div>
                  <div className="action-row">
                    <button
                      className="ghost-button"
                      disabled={!canSyncProjects || !focusedGoogleDriveIntegration || queueProjectSync.isPending}
                      onClick={() => focusedProject && queueProjectSync.mutate({ projectId: focusedProject.id, provider: "google_drive" })}
                      type="button"
                    >
                      <GoogleDriveIcon />
                      <span>{queueProjectSync.isPending && focusedGoogleDriveIntegration ? "Queueing…" : "Backup to Drive"}</span>
                    </button>
                    <button
                      className="ghost-button"
                      disabled={!canSyncProjects || !focusedGithubIntegration || queueProjectSync.isPending}
                      onClick={() => focusedProject && queueProjectSync.mutate({ projectId: focusedProject.id, provider: "github" })}
                      type="button"
                    >
                      <GithubIcon />
                      <span>{queueProjectSync.isPending && focusedGithubIntegration ? "Queueing…" : "Sync to GitHub"}</span>
                    </button>
                    {canDeleteProjects ? (
                      <button
                        className="ghost-button danger"
                        disabled={deleteProject.isPending}
                        onClick={() => void handleDeleteProject()}
                        type="button"
                      >
                        <span>{deleteProject.isPending ? "Deleting…" : "Delete project"}</span>
                      </button>
                    ) : null}
                  </div>
                  </div> : null}
                </>
              ) : (
                <div className="empty-state compact">Choose a project to continue.</div>
              )}
            </Panel>

            {section === "attachments" && focusedProject ? (
              <Panel title="Project attachments" subtitle="Project briefs, references, and supporting files.">
                {canViewAttachments ? (
                  <JiraAttachmentPanel
                    canDelete={canDeleteAttachments}
                    canUpload={canCreateAttachments}
                    canView={canViewAttachments}
                    entityId={focusedProject.id}
                    entityType="project"
                    issueKey={focusedProject.display_id || focusedProject.id}
                    projectId={focusedProject.id}
                    title="Project attachments"
                  />
                ) : <div className="empty-state compact">Permission required: attachment.view</div>}
              </Panel>
            ) : null}

            {section === "traceability" ? (
              <Panel title="Traceability map" subtitle="Explore Story-to-Bug coverage for one application without leaving the project.">
                {scopedAppTypes.length && traceabilityAppTypeId ? (
                  isTraceabilityLoading ? <LoadingState label="Loading application traceability" /> : isTraceabilityError ? (
                    <div className="empty-state compact">
                      <strong>Traceability data could not be loaded.</strong>
                      <span>Retry the Story, module, test case, and Bug queries without leaving this project.</span>
                      <button className="ghost-button compact" onClick={() => {
                        void traceabilityRequirementsQuery.refetch();
                        void traceabilityCasesQuery.refetch();
                        void traceabilityBugsQuery.refetch();
                        void traceabilityModulesQuery.refetch();
                        void traceabilitySprintsQuery.refetch();
                      }} type="button">Retry map</button>
                    </div>
                  ) : <ProjectTraceabilityMap
                    appTypes={scopedAppTypes}
                    bugs={traceabilityBugs}
                    hasMore={hasMoreTraceability}
                    isLoadingMore={isLoadingMoreTraceability}
                    loadMoreError={traceabilityLoadMoreError}
                    modules={(traceabilityModulesQuery.data || []) as TestCaseModule[]}
                    onAppTypeChange={(id) => {
                      setTraceabilityAppTypeId(id);
                      setCurrentAppTypeId(id);
                    }}
                    onOpen={(kind, id) => {
                      const target = kind === "requirement"
                        ? `/backlog?requirement=${encodeURIComponent(id)}`
                        : kind === "bug"
                          ? `/issues?issue=${encodeURIComponent(id)}`
                          : kind === "module"
                            ? `/test-cases?module=${encodeURIComponent(id)}`
                            : `/test-cases?case=${encodeURIComponent(id)}`;
                      navigate(target);
                    }}
                    onLoadMore={() => {
                      if (traceabilityRequirementsQuery.hasNextPage) void traceabilityRequirementsQuery.fetchNextPage();
                      if (traceabilityCasesQuery.hasNextPage) void traceabilityCasesQuery.fetchNextPage();
                      if (traceabilityBugsQuery.hasNextPage) void traceabilityBugsQuery.fetchNextPage();
                    }}
                    requirements={traceabilityRequirements}
                    selectedAppTypeId={traceabilityAppTypeId}
                    sprints={(traceabilitySprintsQuery.data || []) as RequirementIteration[]}
                    testCases={traceabilityCases}
                  />
                ) : <div className="empty-state compact">Add an application to build its traceability map.</div>}
              </Panel>
            ) : null}

            {section === "members" ? (
              <Panel title="Project members" subtitle={projectId ? `Assignments for ${scopedProject?.name}` : "Select a project first"}>
              <form
                className="elevated-toolbar"
	                onSubmit={(event) => {
	                  event.preventDefault();
	                  if (!canManageProjectMembers || !projectId) return;
	                  const formData = new FormData(event.currentTarget);
                  createMember.mutate({
                    project_id: projectId,
                    user_id: String(formData.get("user_id") || ""),
                    role_id: String(formData.get("role_id") || "")
                  });
                  event.currentTarget.reset();
                }}
              >
                <select name="user_id" required defaultValue="">
                  <option value="" disabled>Select user</option>
                  {(users.data || []).map((user) => <option key={user.id} value={user.id}>{user.name || visibleUserEmail(user.email) || "Unnamed user"}</option>)}
                </select>
                <select name="role_id" required defaultValue="">
                  <option value="" disabled>Select role</option>
                  {assignableProjectRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
                <button className="primary-button" disabled={!canManageProjectMembers || !projectId || createMember.isPending} type="submit">
                  {createMember.isPending ? "Adding…" : "Add member"}
                </button>
              </form>

              <div className="record-grid">
                {scopedMembers.map((member) => {
                  const user = users.data?.find((item) => item.id === member.user_id);
                  const role = roles.data?.find((item) => item.id === member.role_id);
                  const isCurrentUser = member.user_id === session?.user.id;
                  const isJiraManagedAdministrator = member.role_id === "jira-admin" && member.assignment_source === "jira-permission";

                  return (
                    <article className="mini-card" key={member.id}>
                      <strong>{user?.name || visibleUserEmail(user?.email) || member.user_id}</strong>
                      <select
                        aria-label={`HelloTest role for ${user?.name || member.user_id}`}
                        disabled={!canManageProjectMembers || updateMemberRole.isPending || isJiraManagedAdministrator}
                        onChange={(event) => updateMemberRole.mutate({ memberId: member.id, roleId: event.target.value })}
                        value={member.role_id}
                      >
                        {!assignableProjectRoles.some((roleOption) => roleOption.id === member.role_id) ? (
                          <option value={member.role_id}>{role?.name || member.role_id} · workspace-derived</option>
                        ) : null}
                        {assignableProjectRoles.map((roleOption) => (
                          <option key={roleOption.id} value={roleOption.id}>{roleOption.name}</option>
                        ))}
                      </select>
                      <button
                        className="ghost-button danger"
                        disabled={!canManageProjectMembers || isJiraManagedAdministrator}
                        onClick={() => void handleRemoveMember(member)}
                        type="button"
                      >
                        Remove
                      </button>
                    </article>
                  );
                })}
              </div>
              {!scopedMembers.length ? <div className="empty-state compact">No members assigned yet.</div> : null}
              </Panel>
            ) : null}

            {section === "applications" ? (
              <Panel title="Applications" subtitle="Keep application platform boundaries readable and lightweight.">
              <form
                className="elevated-toolbar"
	                onSubmit={(event) => {
	                  event.preventDefault();
	                  if (!canManageAppTypes || !projectId) return;
	                  const formData = new FormData(event.currentTarget);
                  createAppType.mutate({
                    project_id: projectId,
                    name: String(formData.get("name") || ""),
                    type: String(formData.get("type") || quickAddAppTypeType || defaultAppTypeValue) as AppType["type"],
                    is_unified: false
                  });
                  event.currentTarget.reset();
                  setQuickAddAppTypeType(defaultAppTypeValue);
                }}
              >
                <input name="name" required placeholder="Web app" />
                <AppTypeDropdown
                  ariaLabel="Select an application platform"
                  name="type"
                  onChange={setQuickAddAppTypeType}
                  options={appTypeDropdownOptions}
                  placeholder="Select platform type"
                  value={quickAddAppTypeType}
                />
                <button className="primary-button" disabled={!canManageAppTypes || !projectId || createAppType.isPending} type="submit">
                  {createAppType.isPending ? "Adding…" : "Add application"}
                </button>
              </form>

              <div className="record-grid">
                {scopedAppTypes.map((item) => (
                  <article className="mini-card" key={item.id}>
                    <strong className="project-app-type-card-title">
                      <AppTypeInlineValue isUnified={item.is_unified} label={item.name} type={item.type} />
                    </strong>
                    <span>{item.type}{item.is_unified ? " · unified" : ""}</span>
                    <button
                      className="ghost-button danger"
                      disabled={!canManageAppTypes}
                      onClick={() => void api.appTypes.delete(item.id).then(() => {
                        setMessageTone("success");
                        setMessage("Application deleted.");
                        return invalidate();
                      }).catch((error: Error) => {
                        setMessageTone("error");
                        setMessage(error.message);
                      })}
                      type="button"
                    >
                      Delete
                    </button>
                  </article>
                ))}
              </div>
              {!scopedAppTypes.length ? <div className="empty-state compact">No applications defined yet.</div> : null}
              </Panel>
            ) : null}
          </div>
        )}
        isDetailOpen={Boolean(focusedProject)}
      />

      {isRiskEvidenceOpen ? (
        <div
          className="modal-backdrop project-risk-evidence-backdrop"
          onClick={closeRiskEvidenceDialog}
          role="presentation"
        >
          <div
            aria-describedby="project-risk-evidence-description"
            aria-labelledby="project-risk-evidence-title"
            aria-modal="true"
            className="modal-card project-risk-evidence-dialog"
            onClick={(event) => event.stopPropagation()}
            ref={riskEvidenceDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="project-risk-report-surface" ref={riskEvidenceReportRef}>
            <header className="project-risk-evidence-header">
              <div className="project-risk-evidence-heading">
                <span className="project-risk-evidence-icon" aria-hidden="true">
                  <IconShieldCheck size={20} stroke={1.9} />
                </span>
                <div>
                  <span className="dialog-context-label">Portfolio health</span>
                  <h2 className="dialog-title" id="project-risk-evidence-title">Projects needing attention</h2>
                  <p id="project-risk-evidence-description">
                    Exact evidence across every accessible project, evaluated with the configured portfolio metric rules.
                  </p>
                </div>
              </div>
              <DialogCloseButton
                label="Close project risk evidence"
                onClick={closeRiskEvidenceDialog}
              />
            </header>

            <div className="project-risk-evidence-body">
              <section className="project-risk-summary-grid" aria-label="Portfolio risk summary">
                <EvidenceFlipCard
                  caption={`${portfolioSummary.riskyProjects} risky · ${portfolioSummary.watchProjects} watch · accessible portfolio`}
                  className="project-risk-summary-card"
                  evidence={compactAttentionEvidence.length ? compactAttentionEvidence : ["No configured attention threshold is currently crossed."]}
                  frontIcon={<IconAlertTriangle size={18} stroke={1.9} />}
                  label="Projects need attention"
                  tone={portfolioSummary.attentionProjects ? "danger" : "success"}
                  value={`${portfolioSummary.attentionProjects}/${portfolioSummary.accessibleProjects}`}
                />
                <EvidenceFlipCard
                  caption={`${portfolioSummary.executionBlockedCases} blocked outcomes disclosed separately`}
                  className="project-risk-summary-card"
                  evidence={[
                    compactImpactEvidence("Modules", portfolioSummary.failureImpacts.modules),
                    compactImpactEvidence("Stories", portfolioSummary.failureImpacts.requirements),
                    `${portfolioSummary.executionFailureCases} failed cases across newest project runs`
                  ]}
                  frontIcon={<IconActivity size={18} stroke={1.9} />}
                  label="Execution failure cases"
                  tone="danger"
                  value={portfolioSummary.executionFailureCases}
                />
                <EvidenceFlipCard
                  caption="Finalized Test Case and Bug outcomes"
                  className="project-risk-summary-card"
                  evidence={[
                    `${portfolioAnalyticsQuery.data?.projects.filter((item) => item.pass_confidence.total > 0).length || 0} projects have finalized pass evidence`,
                    `${portfolioSummary.executionFailureCases} failed · ${portfolioSummary.executionBlockedCases} blocked latest-run cases`,
                    "Running and unknown tests are excluded; resolved Bugs count as passed Bug outcomes"
                  ]}
                  frontIcon={<IconChartBar size={18} stroke={1.9} />}
                  label="Average pass rate"
                  tone="info"
                  value={`${portfolioSummary.averagePassCoverage}%`}
                />
                <EvidenceFlipCard
                  caption={`${portfolioSummary.openBugCount} currently open`}
                  className="project-risk-summary-card"
                  evidence={[
                    compactImpactEvidence("Modules", portfolioSummary.bugImpacts.modules),
                    compactImpactEvidence("Stories", portfolioSummary.bugImpacts.requirements),
                    `${portfolioSummary.bugCount} distinct Bugs across accessible projects`
                  ]}
                  frontIcon={<IconBug size={18} stroke={1.9} />}
                  label="Bugs"
                  tone="warning"
                  value={portfolioSummary.bugCount}
                />
              </section>

              <section className="project-risk-method" aria-labelledby="project-risk-method-title">
                <div>
                  <span className="project-risk-method-icon" aria-hidden="true">
                    <IconCircleCheck size={18} stroke={1.9} />
                  </span>
                  <div>
                    <h3 id="project-risk-method-title">How the signal is calculated</h3>
                    <p>
                      Readiness weights Story coverage at {Math.round(portfolioAnalyticsQuery.data?.configuration["metric.project.portfolio_health"]?.story_weight ?? 35)}%, automation coverage at {Math.round(portfolioAnalyticsQuery.data?.configuration["metric.project.portfolio_health"]?.automation_weight ?? 25)}%, and the combined finalized Test Case and Bug pass rate at {Math.round(portfolioAnalyticsQuery.data?.configuration["metric.project.portfolio_health"]?.pass_weight ?? 40)}%.
                      Evidence policy requires {Math.round(portfolioAnalyticsQuery.data?.configuration["metric.project.execution_evidence"]?.minimum_coverage_percent ?? 80)}% latest-run evidence coverage.
                    </p>
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>Risky</dt>
                    <dd>Latest failures or blockers, or combined Test Case and Bug pass rate below {portfolioSummary.riskPassThreshold}%.</dd>
                  </div>
                  <div>
                    <dt>Watch</dt>
                    <dd>Readiness, evidence completeness, or open-Bug policy needs review.</dd>
                  </div>
                  <div>
                    <dt>Release ready</dt>
                    <dd>Readiness of at least {Math.round(portfolioAnalyticsQuery.data?.configuration["metric.project.release_ready"]?.readiness_threshold ?? 80)}% with no hard risk or policy violation.</dd>
                  </div>
                </dl>
              </section>

              <section className="project-risk-projects" aria-labelledby="project-risk-projects-title">
                <div className="project-risk-section-heading">
                  <div>
                    <h3 id="project-risk-projects-title">Project evidence</h3>
                    <p>Highest-risk projects appear first. Each reason is tied to a loaded metric or execution outcome.</p>
                  </div>
                  <span>{projectRiskEvidenceItems.length} project{projectRiskEvidenceItems.length === 1 ? "" : "s"}</span>
                </div>

                {projectRiskEvidenceItems.length ? (
                  <div className="project-risk-project-list">
                    {projectRiskEvidenceItems.map((item) => {
                      const riskSignals = getProjectRiskSignals(item);

                      return (
                        <article className={`project-risk-project-card tone-${item.healthTone}`} key={item.project.id}>
                          <header>
                            <div>
                              <span className={`project-health-badge ${item.healthTone}`}>{item.healthLabel}</span>
                              <h4>{item.project.name}</h4>
                              <small>{item.project.display_id || item.project.id} · Latest run {item.latestRunLabel}</small>
                            </div>
                            <button
                              className="project-risk-open-button"
                              onClick={() => {
                                closeRiskEvidenceDialog();
                                openPortfolioProject(item);
                              }}
                              type="button"
                            >
                              Open project
                            </button>
                          </header>

                          <div className="project-risk-score-row">
                            <div>
                              <span>Readiness</span>
                              <strong>{item.readinessScore}%</strong>
                            </div>
                            <ProjectProgressBar
                              detail="Configured Story coverage, automation coverage, and combined Test Case and Bug pass-rate weights"
                              label="Weighted readiness"
                              tone={item.healthTone === "danger" ? "danger" : "info"}
                              value={item.readinessScore}
                            />
                          </div>

                          <dl className="project-risk-metric-grid">
                            <div>
                              <dt>Story coverage</dt>
                              <dd>{item.coverage.coveragePercent}%</dd>
                              <small>{item.coverage.coveredRequirements}/{item.coverage.totalRequirements} linked</small>
                            </div>
                            <div>
                              <dt>Automation</dt>
                              <dd>{item.automationCoverage.coveragePercent}%</dd>
                              <small>{item.automationCoverage.automatedCases}/{item.automationCoverage.totalCases} automated</small>
                            </div>
                            <div>
                              <dt>Pass rate</dt>
                              <dd>{item.passCoverage.coveragePercent}%</dd>
                              <small>{formatPassCoverageDetail(item.passCoverage)}</small>
                            </div>
                            <div>
                              <dt>Latest blockers</dt>
                              <dd>{item.latestFailedCount + item.latestBlockedCount}</dd>
                              <small>{item.latestFailedCount} failed · {item.latestBlockedCount} blocked</small>
                            </div>
                            <div>
                              <dt>Evidence</dt>
                              <dd>{item.executionEvidence.coveragePercent}%</dd>
                              <small>{item.executionEvidence.evidenced}/{item.executionEvidence.total} latest outcomes evidenced</small>
                            </div>
                            <div>
                              <dt>Bugs</dt>
                              <dd>{item.bugCount}</dd>
                              <small>{item.openBugCount} open · {compactImpactEvidence("Modules", item.bugImpacts.modules)}</small>
                            </div>
                          </dl>

                          <ul className="project-risk-signal-list" aria-label={`${item.project.name} attention reasons`}>
                            {riskSignals.map((signal) => (
                              <li className={`tone-${signal.tone}`} key={signal.label}>
                                <span aria-hidden="true" />
                                <div>
                                  <strong>{signal.label}</strong>
                                  <p>{signal.detail}</p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="project-risk-empty-state">
                    <IconCircleCheck aria-hidden="true" size={22} stroke={1.9} />
                    <div>
                      <strong>No portfolio risk signals</strong>
                      <p>Loaded projects are release ready or do not yet have enough QA scope to assess.</p>
                    </div>
                  </div>
                )}
              </section>
            </div>
            </div>

            <footer className="project-risk-evidence-footer">
              <span>Evidence refreshes from every accessible project. Compact cards reset automatically after 10 seconds.</span>
              <div className="project-risk-footer-actions">
                <button className="ghost-button" disabled={isExportingRiskPdf || !canExportPortfolioAttention} onClick={() => void exportRiskEvidencePdf()} title={canExportPortfolioAttention ? "Export this rendered attention view as PDF" : "Permission required: run.report.export"} type="button">
                  <IconDownload aria-hidden="true" size={16} />
                  {isExportingRiskPdf ? "Exporting…" : "Export PDF"}
                </button>
                <button className="ghost-button" onClick={closeRiskEvidenceDialog} type="button">Close</button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}

      {isCreateModalOpen ? (
        <div className="modal-backdrop" onClick={closeCreateProjectModal} role="presentation">
          <div
            aria-labelledby="create-project-title"
            aria-modal="true"
            className="modal-card project-create-modal"
            onClick={(event) => event.stopPropagation()}
            ref={createProjectDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="project-create-header">
              <div className="project-create-heading">
                <DialogCloseButton
                  disabled={createProject.isPending}
                  label="Close create project dialog"
                  onClick={closeCreateProjectModal}
                />
                <h2 className="dialog-title" id="create-project-title">Create Project</h2>
              </div>
            </div>

            <form className="project-create-modal-form" id="create-project-form" onSubmit={handleProjectCreate}>
              <div className="project-create-modal-body">
                <div className="project-create-left-column">
                <section aria-labelledby="project-app-configurations-title" className="project-create-section project-create-app-section">
                  <div className="project-create-section-head">
                    <div>
                      <h3 className="project-create-step-title" id="project-app-configurations-title">
                        <span aria-hidden="true" className="project-create-step-number">1</span>
                        <span>Applications</span>
                      </h3>
                      <p>Define the applications involved in this project to set up appropriate test environments.</p>
                    </div>
                  </div>

                  <div className="project-app-type-list">
                    {projectDraft.appTypes.map((appType, index) => {
                      const isExpanded = expandedProjectAppTypeId === appType.id;
                      const appPanelId = `project-app-editor-${appType.id}`;
                      return (
                        <div className={isExpanded ? "project-app-type-row is-expanded" : "project-app-type-row"} key={appType.id}>
                        <div className="project-app-type-summary">
                          <span
                            className="project-app-type-icon"
                            data-platform-type={normalizeAppTypeKind(appType.type, appType.is_unified)}
                          >
                            <AppTypeIcon isUnified={appType.is_unified} size={19} type={appType.type} />
                          </span>
                          <span className="project-app-type-summary-copy">
                            <strong>{appType.name.trim() || `App ${index + 1}`}</strong>
                            <span>{appTypeDropdownOptions.find((option) => option.value === appType.type)?.label || appType.type || "Platform"}</span>
                          </span>
                          <span className="project-app-type-status">{appType.name.trim() ? "Added" : "Editing"}</span>
                          <button
                            aria-label={`Remove app ${index + 1}`}
                            className="project-app-type-remove-button"
                            onClick={() => removeProjectAppType(appType.id)}
                            type="button"
                          >
                            <TrashIcon />
                          </button>
                          <button
                            aria-controls={appPanelId}
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? "Collapse" : "Edit"} app ${index + 1}`}
                            className="project-app-type-expand-button"
                            onClick={() => setExpandedProjectAppTypeId(isExpanded ? "" : appType.id)}
                            type="button"
                          >
                            {isExpanded ? <IconChevronUp aria-hidden="true" /> : <IconChevronDown aria-hidden="true" />}
                          </button>
                        </div>
                        <div className="project-app-type-grid" hidden={!isExpanded} id={appPanelId}>
                          <FormField label="App Name">
                            <input
                              onChange={(event) => updateProjectAppType(appType.id, { name: event.target.value })}
                              placeholder="e.g. Mobile API"
                              required
                              value={appType.name}
                            />
                          </FormField>
                          <FormField label="Platform Type">
                            <AppTypeDropdown
                              ariaLabel={`Select platform type for application ${index + 1}`}
                              inlineMenu
                              onChange={(value) => updateProjectAppType(appType.id, {
                                type: value as AppType["type"],
                                is_unified: value === "unified"
                              })}
                              options={appTypeDropdownOptions}
                              placeholder="Select platform type"
                              value={appType.type}
                            />
                          </FormField>
                          <button
                            className="primary-button project-app-type-done-button"
                            onClick={() => setExpandedProjectAppTypeId("")}
                            type="button"
                          >
                            Save Changes
                          </button>
                        </div>
                        </div>
                      );
                    })}
                  </div>
                  <button className="project-add-app-button" onClick={addProjectAppTypeRow} type="button">
                    <AddIcon />
                    <span>Add App</span>
                  </button>
                </section>

                <section aria-labelledby="project-members-title" className="project-create-section project-create-members-section">
                  <div className="project-create-section-head">
                    <h3 className="project-create-step-title" id="project-members-title">
                      <span aria-hidden="true" className="project-create-step-number">2</span>
                      <span>Project Members</span>
                    </h3>
                  </div>

                  {projectDraft.visibility === "private" ? (
                    <div className="project-private-owner-card">
                      <span className="project-private-owner-icon"><IconLock aria-hidden="true" size={18} stroke={2.1} /></span>
                      <div>
                        <strong>Private to you</strong>
                        <p>{session?.user.name || visibleUserEmail(session?.user.email) || "Project creator"} will be added automatically. Other workspace users stay hidden and cannot access this project.</p>
                      </div>
                    </div>
                  ) : <>
                  <div className="project-create-access-banner">
                    <IconInfoCircle aria-hidden="true" size={20} stroke={2} />
                    <div>
                      <strong>Project-scoped access</strong>
                      <p>Users added here only have access to resources within this project. Assign <b>Administrator</b> for full project control, or <b>QA Lead</b> for testing management.</p>
                    </div>
                  </div>

                  <div className="project-member-picker-shell">
                    <div className="project-member-picker-toolbar">
                      <label className="project-member-search-field">
                        <span className="sr-only">Search team members</span>
                        <IconSearch aria-hidden="true" size={17} stroke={2} />
                        <input
                          onChange={(event) => setProjectMemberSearch(event.target.value)}
                          placeholder="Search team members..."
                          type="search"
                          value={projectMemberSearch}
                        />
                      </label>
                      <div className="project-member-picker-actions">
                      <button
                        className="project-member-text-button"
                        disabled={!selectableProjectMemberIds.length || areAllSelectableProjectMembersSelected}
                        onClick={selectAllProjectDraftMembers}
                        type="button"
                      >
                        Select all
                      </button>
                      <button
                        className="project-member-text-button is-muted"
                        disabled={!projectDraft.memberIds.length}
                        onClick={clearProjectDraftMembers}
                        type="button"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {projectMemberOptions.length ? (
                    <div className="modal-case-picker project-member-picker">
                      {filteredProjectMemberOptions.map((user) => {
                        const isAutoIncluded = user.id === session?.user.id;
                        const isSelected = isAutoIncluded || projectDraft.memberIds.includes(user.id);
                        const initials = String(user.name || visibleUserEmail(user.email) || "?")
                          .split(/\s+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((part) => part[0]?.toUpperCase())
                          .join("");

                        return (
                          <div className={isAutoIncluded ? "modal-case-option project-member-option is-auto-included" : "modal-case-option project-member-option"} key={user.id}>
                            <label className="project-member-option-identity">
                              <input
                                checked={isSelected}
                                disabled={isAutoIncluded}
                                onChange={() => toggleProjectDraftMember(user.id)}
                                type="checkbox"
                              />
                              <span aria-hidden="true" className="project-member-avatar">{initials}</span>
                              <span>
                                <strong>{user.name || visibleUserEmail(user.email) || "Unnamed user"}</strong>
                                <span>{visibleUserEmail(user.email)}</span>
                                <span className="project-member-option-meta">
                                  {isAutoIncluded ? `Project creator · ${hasJiraAdministration ? "workspace administrator" : "QA lead"}` : isSelected ? "Role required" : "Not added"}
                                </span>
                              </span>
                            </label>
                            {isAutoIncluded ? (
                              <span className="status-pill tone-info">{hasJiraAdministration ? "workspace administrator" : "QA lead"}</span>
                            ) : isSelected ? (
                              <select
                                aria-label={`HelloTest role for ${user.name || visibleUserEmail(user.email) || "selected user"}`}
                                onChange={(event) => updateProjectDraftMemberRole(user.id, event.target.value)}
                                required
                                value={projectDraft.memberRoleIds[user.id] || DEFAULT_NEW_PROJECT_MEMBER_ROLE_ID}
                              >
                                {newProjectRoleOptions.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                              </select>
                            ) : null}
                          </div>
                        );
                      })}
                      {!filteredProjectMemberOptions.length ? (
                        <div className="project-member-search-empty">No team members match “{projectMemberSearch}”.</div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="empty-state compact">No users exist yet to add to this project.</div>
                  )}
                  </div>
                  </>}
                </section>
                </div>

                <section aria-labelledby="project-create-details-title" className="project-create-section project-create-general-section">
                  <h3 className="project-create-step-title" id="project-create-details-title">
                    <span aria-hidden="true" className="project-create-step-number is-primary">3</span>
                    <span>Project Details</span>
                  </h3>
                  <div className="project-create-general-card">
                    <FormField label="Project name" inputId="project-name-input" required>
                      <input
                        autoComplete="organization"
                        autoFocus
                        data-autofocus="true"
                        id="project-name-input"
                        onChange={(event) => updateProjectDraft({ name: event.target.value })}
                        placeholder="e.g. Q4 Data Pipeline Refactor"
                        value={projectDraft.name}
                      />
                    </FormField>
                    <FormField label="Description" inputId="project-description-input">
                      <RichTextEditor
                        aria-label="Project description"
                        appearance="canonical"
                        id="project-description-input"
                        onAttachmentRequest={() => projectAttachmentInputRef.current?.click()}
                        onChange={(description) => updateProjectDraft({ description })}
                        placeholder="Briefly describe the goals and scope of this project..."
                        rows={3}
                        value={projectDraft.description}
                      />
                    </FormField>
                    <FormField label="Project type" inputId="project-visibility-input" required>
                      <select
                        id="project-visibility-input"
                        onChange={(event) => updateProjectDraft({
                          visibility: event.target.value as ProjectCreateDraft["visibility"],
                          ...(event.target.value === "private" ? { memberIds: [], memberRoleIds: {} } : {})
                        })}
                        value={projectDraft.visibility}
                      >
                        <option value="private">Private — only you</option>
                        <option value="public">Public — invite workspace users</option>
                      </select>
                      <span className="project-visibility-help">
                        {projectDraft.visibility === "private"
                          ? "Creator-only access. Choose Public when this project needs collaborators."
                          : "Choose the workspace users who should receive project access."}
                      </span>
                    </FormField>
                    <section aria-labelledby="project-create-attachments-title" className="project-create-attachments-section">
                      <div className="project-create-attachments-heading">
                        <div>
                          <span className="project-create-attachments-icon"><IconPaperclip aria-hidden="true" size={16} stroke={2.1} /></span>
                          <span>
                            <strong id="project-create-attachments-title">Attachments</strong>
                            <small>{projectDraft.attachments.length}/{MAX_PROJECT_ATTACHMENTS} files · gzip compressed on upload</small>
                          </span>
                        </div>
                        <button
                          className="project-create-attachment-browse"
                          disabled={!canCreateAttachments || projectAttachmentMetaQuery.data?.enabled === false}
                          onClick={() => projectAttachmentInputRef.current?.click()}
                          type="button"
                        >
                          <IconUpload aria-hidden="true" size={15} stroke={2} />
                          <span>Add files</span>
                        </button>
                      </div>
                      <input
                        hidden
                        multiple
                        onChange={(event) => event.target.files && stageProjectAttachments(event.target.files)}
                        ref={projectAttachmentInputRef}
                        type="file"
                      />
                      <div
                        className={isProjectAttachmentDragging ? "project-create-attachment-dropzone is-dragging" : "project-create-attachment-dropzone"}
                        onDragEnter={(event) => { event.preventDefault(); setIsProjectAttachmentDragging(true); }}
                        onDragLeave={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsProjectAttachmentDragging(false);
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={handleProjectAttachmentDrop}
                      >
                        {projectDraft.attachments.length ? (
                          <ul className="project-create-attachment-list">
                            {projectDraft.attachments.map((file) => (
                              <li key={`${file.name}:${file.size}:${file.lastModified}`}>
                                <span className="project-create-attachment-file-icon"><IconPaperclip aria-hidden="true" size={14} stroke={2} /></span>
                                <span className="project-create-attachment-file-copy">
                                  <strong title={file.name}>{file.name}</strong>
                                  <small>{formatProjectAttachmentBytes(file.size)} · ready to compress</small>
                                </span>
                                <button aria-label={`Remove ${file.name}`} onClick={() => removeProjectAttachment(file)} type="button">
                                  <IconX aria-hidden="true" size={15} stroke={2} />
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <button
                            className="project-create-attachment-empty"
                            disabled={!canCreateAttachments || projectAttachmentMetaQuery.data?.enabled === false}
                            onClick={() => projectAttachmentInputRef.current?.click()}
                            type="button"
                          >
                            <IconUpload aria-hidden="true" size={18} stroke={1.9} />
                            <span>Drop project files here or browse</span>
                          </button>
                        )}
                      </div>
                      {projectAttachmentMetaQuery.error ? (
                        <span className="project-create-attachment-error">Unable to verify attachment storage. Files can be retried from Project Details.</span>
                      ) : null}
                    </section>
                  </div>
                </section>
              </div>
            </form>

            <footer className="project-create-footer">
              <button className="ghost-button project-create-cancel-button" disabled={createProject.isPending} onClick={closeCreateProjectModal} type="button">
                Cancel
              </button>
              <button
                className="primary-button project-create-submit-button"
                disabled={!canCreateProjects || createProject.isPending}
                form="create-project-form"
                type="submit"
              >
                {createProject.isPending ? "Creating…" : "Create Project"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
