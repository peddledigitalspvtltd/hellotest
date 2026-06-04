import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AddIcon, GithubIcon, GoogleDriveIcon, GridIcon, ListIcon, OpenIcon, PlayIcon, TrashIcon } from "../components/AppIcons";
import { AppTypeDropdown, AppTypeInlineValue } from "../components/AppTypeDropdown";
import { api } from "../lib/api";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { CatalogActionMenu } from "../components/CatalogActionMenu";
import { DisplayIdBadge } from "../components/DisplayIdBadge";
import { FormField } from "../components/FormField";
import { InfoTooltip } from "../components/InfoTooltip";
import { Panel } from "../components/Panel";
import { ProgressMeter } from "../components/ProgressMeter";
import {
  TileCardAppTypesIcon,
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
import { useCurrentProject } from "../hooks/useCurrentProject";
import { useDomainMetadata } from "../hooks/useDomainMetadata";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import { useAuth } from "../auth/AuthContext";
import { formatAuditTimestamp } from "../lib/auditDisplay";
import type { AppType, Execution, ExecutionResult, Project, WorkspaceTransaction } from "../types";

type ProjectSection = "members" | "appTypes";

type ProjectAppTypeDraft = {
  id: string;
  name: string;
  type: AppType["type"];
  is_unified: boolean;
};

type ProjectCreateDraft = {
  name: string;
  description: string;
  memberIds: string[];
  appTypes: ProjectAppTypeDraft[];
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
};

type ProjectHealthTone = "success" | "warning" | "danger" | "neutral";

type ProjectPortfolioItem = {
  project: Project;
  memberCount: number;
  memberNames: string[];
  appTypes: AppType[];
  appTypeCount: number;
  appTypeSummary: string;
  requirementCount: number;
  testCaseCount: number;
  suiteCount: number;
  coverage: ProjectRequirementCoverage;
  automationCoverage: ProjectAutomationCoverage;
  passCoverage: ProjectPassCoverage;
  latestExecution: Execution | null;
  latestExecutionResults: ExecutionResult[];
  latestFailedCount: number;
  latestBlockedCount: number;
  latestDurationLabel: string;
  latestRunLabel: string;
  readinessScore: number;
  healthTone: ProjectHealthTone;
  healthLabel: string;
  readinessLabel: string;
  insight: string;
};

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
  memberIds: [],
  appTypes: [createProjectAppTypeDraft(defaultType)]
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
  coveragePercent: 0
};

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
    return "Start by importing requirements or creating the first test suite.";
  }

  if (item.latestFailedCount > 0 || item.latestBlockedCount > 0) {
    return `${formatCompactCount(item.latestFailedCount, "failed test")} and ${formatCompactCount(item.latestBlockedCount, "blocked test")} need review before release.`;
  }

  if (item.automationCoverage.totalCases > 0 && item.automationCoverage.coveragePercent < 40) {
    return "Automation maturity is low. Prioritize high-value regression flows for the next sprint.";
  }

  if (item.coverage.totalRequirements > 0 && item.coverage.coveragePercent < 80) {
    return "Requirement traceability has gaps. Link uncovered requirements before release planning.";
  }

  if (item.passCoverage.totalCases > 0 && item.passCoverage.coveragePercent >= 80) {
    return "Execution confidence is strong. Keep monitoring high-risk app types for regressions.";
  }

  return "Project scope is available. Add recent execution evidence to improve readiness confidence.";
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

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const { session } = useAuth();
  const isAdmin = session?.user.role === "admin";
  const domainMetadataQuery = useDomainMetadata();
  const { projects, users, roles, projectMembers, appTypes, requirements, testSuites, testCases, executions, executionResults } = useWorkspaceData();
  const [selectedProjectId, setSelectedProjectId] = useCurrentProject();
  const [focusedProjectId, setFocusedProjectId] = useState("");
  const [section, setSection] = useState<ProjectSection>("members");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectAppTypeFilter, setProjectAppTypeFilter] = useState("all");
  const [projectMemberFilter, setProjectMemberFilter] = useState("all");
  const [projectViewMode, setProjectViewMode] = useState<"cards" | "list">("cards");
  const defaultAppTypeValue = domainMetadataQuery.data?.app_types.default_type || "web";
  const appTypeTypeOptions = domainMetadataQuery.data?.app_types.types || [];
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
  const [quickAddAppTypeType, setQuickAddAppTypeType] = useState(defaultAppTypeValue);
  const integrationsQuery = useQuery({
    queryKey: ["integrations"],
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

  const projectItems = projects.data || [];
  const isProjectCatalogLoading =
    projects.isPending ||
    projectMembers.isPending ||
    appTypes.isPending ||
    requirements.isPending ||
    testSuites.isPending ||
    testCases.isPending ||
    executions.isPending ||
    executionResults.isPending;

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
    () => projectItems.find((project) => String(project.id) === String(selectedProjectId)) || projectItems[0],
    [projectItems, selectedProjectId]
  );
  const focusedProject = useMemo(
    () => projectItems.find((project) => String(project.id) === String(focusedProjectId)) || null,
    [focusedProjectId, projectItems]
  );
  const scopedProject = focusedProject || selectedProject;
  const projectId = scopedProject?.id;

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

      if (latestExecutionResultByCaseId[testCase.id]?.status === "passed") {
        coverageByProjectId[owningProjectId].passedCases += 1;
      }
    });

    Object.values(coverageByProjectId).forEach((metric) => {
      metric.coveragePercent = metric.totalCases ? Math.round((metric.passedCases / metric.totalCases) * 100) : 0;
    });

    return coverageByProjectId;
  }, [latestExecutionResultByCaseId, projectIdByAppTypeId, projectItems, testCases.data]);

  const projectPortfolioItems = useMemo<ProjectPortfolioItem[]>(() => {
    return projectItems.map((project) => {
      const projectAppTypes = appTypesByProjectId[project.id] || [];
      const projectMemberUserIds = projectMemberUserIdsByProjectId.get(project.id) || new Set<string>();
      const memberNames = Array.from(projectMemberUserIds)
        .map((userId) => users.data?.find((user) => user.id === userId))
        .map((user) => user?.name || user?.email || "")
        .filter(Boolean);
      const coverage = requirementCoverageByProjectId[project.id] || emptyRequirementCoverage;
      const automationCoverage = automationCoverageByProjectId[project.id] || emptyAutomationCoverage;
      const passCoverage = passCoverageByProjectId[project.id] || emptyPassCoverage;
      const latestExecution = latestExecutionByProjectId[project.id] || null;
      const latestExecutionResults = latestExecution ? executionResultsByExecutionId[latestExecution.id] || [] : [];
      const latestFailedCount = latestExecutionResults.filter((result) => result.status === "failed").length;
      const latestBlockedCount = latestExecutionResults.filter((result) => result.status === "blocked").length;
      const readinessScore = clampPercent(
        Math.round((coverage.coveragePercent * 0.35) + (automationCoverage.coveragePercent * 0.25) + (passCoverage.coveragePercent * 0.4))
      );
      const health = resolveProjectHealth({
        readinessScore,
        requirementCount: requirementCountByProjectId[project.id] || 0,
        testCaseCount: testCaseCountByProjectId[project.id] || 0,
        latestFailedCount,
        latestBlockedCount,
        passCoverage
      });
      const appTypeSummary = projectAppTypes.length
        ? projectAppTypes.map((appType) => appType.is_unified ? `${appType.name} unified` : `${appType.name} ${appType.type}`).join(", ")
        : "No app types";
      const baseItem = {
        project,
        memberCount: memberCountByProjectId[project.id] || 0,
        memberNames,
        appTypes: projectAppTypes,
        appTypeCount: projectAppTypes.length,
        appTypeSummary,
        requirementCount: requirementCountByProjectId[project.id] || 0,
        testCaseCount: testCaseCountByProjectId[project.id] || 0,
        suiteCount: testSuiteCountByProjectId[project.id] || 0,
        coverage,
        automationCoverage,
        passCoverage,
        latestExecution,
        latestExecutionResults,
        latestFailedCount,
        latestBlockedCount,
        latestDurationLabel: formatProjectDuration(latestExecution),
        latestRunLabel: formatProjectTimeAgo(latestExecution?.created_at || latestExecution?.started_at),
        readinessScore,
        ...health
      };

      return {
        ...baseItem,
        insight: getProjectInsight(baseItem)
      };
    });
  }, [
    appTypesByProjectId,
    automationCoverageByProjectId,
    executionResultsByExecutionId,
    latestExecutionByProjectId,
    memberCountByProjectId,
    passCoverageByProjectId,
    projectItems,
    projectMemberUserIdsByProjectId,
    requirementCountByProjectId,
    requirementCoverageByProjectId,
    testCaseCountByProjectId,
    testSuiteCountByProjectId,
    users.data
  ]);

  const portfolioSummary = useMemo(() => {
    const totalProjects = projectPortfolioItems.length;
    const riskyProjects = projectPortfolioItems.filter((item) => item.healthTone === "danger").length;
    const releaseReadyProjects = projectPortfolioItems.filter((item) => item.healthTone === "success").length;
    const averageRequirementCoverage = totalProjects
      ? Math.round(projectPortfolioItems.reduce((sum, item) => sum + item.coverage.coveragePercent, 0) / totalProjects)
      : 0;
    const averageAutomationCoverage = totalProjects
      ? Math.round(projectPortfolioItems.reduce((sum, item) => sum + item.automationCoverage.coveragePercent, 0) / totalProjects)
      : 0;
    const overallHealth = totalProjects
      ? Math.round(projectPortfolioItems.reduce((sum, item) => sum + item.readinessScore, 0) / totalProjects)
      : 0;

    return {
      totalProjects,
      riskyProjects,
      releaseReadyProjects,
      averageRequirementCoverage,
      averageAutomationCoverage,
      overallHealth
    };
  }, [projectPortfolioItems]);

  const filteredProjectItems = useMemo(() => {
    const normalizedSearch = projectSearch.trim().toLowerCase();

    return projectPortfolioItems.filter((item) => {
      const { project } = item;
      const projectAppTypes = item.appTypes;
      const projectMemberUserIds = projectMemberUserIdsByProjectId.get(project.id) || new Set<string>();
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
    });
  }, [
    projectAppTypeFilter,
    projectPortfolioItems,
    projectMemberFilter,
    projectMemberUserIdsByProjectId,
    projectSearch,
    userSearchValueById
  ]);

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

  const projectMemberOptions = useMemo(
    () =>
      [...(users.data || [])].sort((left, right) => {
        const leftAuto = left.id === session?.user.id || left.role === "admin";
        const rightAuto = right.id === session?.user.id || right.role === "admin";

        if (leftAuto !== rightAuto) {
          return leftAuto ? -1 : 1;
        }

        return String(left.name || left.email).localeCompare(String(right.name || right.email));
      }),
    [session?.user.id, users.data]
  );
  const selectableProjectMemberIds = useMemo(
    () =>
      projectMemberOptions
        .filter((user) => user.id !== session?.user.id && user.role !== "admin")
        .map((user) => user.id),
    [projectMemberOptions, session?.user.id]
  );
  const areAllSelectableProjectMembersSelected =
    Boolean(selectableProjectMemberIds.length) &&
    selectableProjectMemberIds.every((userId) => projectDraft.memberIds.includes(userId));

  const selectedProjectRequirementCount = projectId ? requirementCountByProjectId[projectId] || 0 : 0;
  const selectedProjectTestCaseCount = projectId ? testCaseCountByProjectId[projectId] || 0 : 0;
  const selectedProjectAppTypeCount = projectId ? appTypeCountByProjectId[projectId] || 0 : 0;
  const selectedProjectPassCoverage = projectId ? passCoverageByProjectId[projectId] || emptyPassCoverage : emptyPassCoverage;
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
    mutationFn: api.projects.create,
    onSuccess: async (response) => {
      setMessageTone("success");
      setMessage(
        `Project created. ${response.members_added} members linked and ${response.app_types_created} app type${response.app_types_created === 1 ? "" : "s"} added.`
      );
      setSelectedProjectId(response.id);
      setFocusedProjectId(response.id);
      setIsCreateModalOpen(false);
      setProjectDraft(createInitialProjectDraft(defaultAppTypeValue));
      await invalidate();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to create project");
    }
  });

  useEffect(() => {
    if (!isCreateModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !createProject.isPending) {
        setIsCreateModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [createProject.isPending, isCreateModalOpen]);

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

  const createAppType = useMutation({
    mutationFn: api.appTypes.create,
    onSuccess: async () => {
      setMessageTone("success");
      setMessage("App type added.");
      await invalidate();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to add app type");
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
    setProjectDraft(createInitialProjectDraft(defaultAppTypeValue));
    setIsCreateModalOpen(true);
  };

  const closeCreateProjectModal = () => {
    if (createProject.isPending) {
      return;
    }

    setIsCreateModalOpen(false);
  };

  const handleDeleteProject = async () => {
    if (!focusedProject || deleteProject.isPending) {
      return;
    }

    const confirmed = await confirmDelete({ message: `Delete project "${focusedProject.name}" and all related data?` });

    if (!confirmed) {
      return;
    }

    await deleteProject.mutateAsync(focusedProject.id);
  };

  const updateProjectDraft = (input: Partial<ProjectCreateDraft>) => {
    setProjectDraft((current) => ({ ...current, ...input }));
  };

  const toggleProjectDraftMember = (userId: string) => {
    setProjectDraft((current) => ({
      ...current,
      memberIds: current.memberIds.includes(userId)
        ? current.memberIds.filter((id) => id !== userId)
        : [...current.memberIds, userId]
    }));
  };

  const addProjectAppTypeRow = () => {
    setProjectDraft((current) => ({
      ...current,
      appTypes: [...current.appTypes, createProjectAppTypeDraft(defaultAppTypeValue)]
    }));
  };

  const updateProjectAppType = (draftId: string, input: Partial<Omit<ProjectAppTypeDraft, "id">>) => {
    setProjectDraft((current) => ({
      ...current,
      appTypes: current.appTypes.map((appType) => (appType.id === draftId ? { ...appType, ...input } : appType))
    }));
  };

  const removeProjectAppType = (draftId: string) => {
    setProjectDraft((current) => {
      if (current.appTypes.length === 1) {
        return {
          ...current,
          appTypes: [createProjectAppTypeDraft(defaultAppTypeValue)]
        };
      }

      return {
        ...current,
        appTypes: current.appTypes.filter((appType) => appType.id !== draftId)
      };
    });
  };

  const handleProjectCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

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
      setMessage("At least one app type is required.");
      return;
    }

    createProject.mutate({
      name: normalizedName,
      description: projectDraft.description.trim() || undefined,
      member_ids: projectDraft.memberIds,
      app_types: normalizedAppTypes
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

  const openPortfolioProject = (item: ProjectPortfolioItem) => {
    setSelectedProjectId(item.project.id);
    setFocusedProjectId(item.project.id);
  };

  const openPortfolioProjectPath = (item: ProjectPortfolioItem, path: string) => {
    setSelectedProjectId(item.project.id);
    setFocusedProjectId(item.project.id);
    navigate(path);
  };

  const getProjectActionItems = (item: ProjectPortfolioItem) => [
    {
      label: "Open project details",
      icon: <OpenIcon />,
      onClick: () => openPortfolioProject(item),
      description: "Open members, app types, integrations, and project summary."
    },
    {
      label: "Open requirements",
      icon: <TileCardRequirementIcon />,
      onClick: () => openPortfolioProjectPath(item, "/requirements"),
      description: "Review requirement scope and coverage links."
    },
    {
      label: "Open test cases",
      icon: <TileCardCaseIcon />,
      onClick: () => openPortfolioProjectPath(item, "/test-cases"),
      description: "Review manual and automated test cases for this project."
    },
    {
      label: "Create run",
      icon: <PlayIcon />,
      onClick: () => openPortfolioProjectPath(item, "/executions"),
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
      disabled: !isAdmin || deleteProject.isPending,
      description: isAdmin ? "Delete this project and related workspace data." : "Only admins can delete projects.",
      tone: "danger" as const
    }
  ];

  return (
    <div className="page-content">
      {confirmationDialog}
      <ToastMessage
        message={message}
        onDismiss={() => setMessage("")}
        tone={messageTone}
      />

      <section className="projects-command-card">
        <div className="projects-command-copy">
          <span className="eyebrow">Projects Command Center</span>
          <h2>See quality, risk and release readiness at a glance.</h2>
          <p>Monitor project health, automation maturity, execution confidence and delivery blockers from one workspace.</p>
          <div className="projects-command-actions">
            <button className="primary-button projects-create-button" onClick={openCreateProjectModal} type="button">
              <AddIcon />
              Create New Project
            </button>
            <button className="ghost-button" onClick={() => navigate("/executions")} type="button">
              <PlayIcon />
              View Run Console
            </button>
          </div>
        </div>
          <div className="projects-command-insight">
          <span className="projects-ai-chip">AI Insight</span>
          <h3>{portfolioSummary.riskyProjects || "No"} project{portfolioSummary.riskyProjects === 1 ? "" : "s"} need attention</h3>
          <p>
            {portfolioSummary.riskyProjects
              ? "Review risky projects before release planning. Low pass rate and blocked cases are weighted into readiness."
              : "Portfolio readiness is stable. Keep execution evidence fresh as project scope changes."}
          </p>
          <div className="projects-health-ring" style={{ "--score": `${portfolioSummary.overallHealth}%` } as CSSProperties}>
            <strong>{portfolioSummary.overallHealth}%</strong>
            <span>Overall health</span>
          </div>
        </div>
      </section>

      <section className="projects-stats-grid" aria-label="Portfolio summary">
        <article className="project-stat-card">
          <span>Total Projects</span>
          <strong>{portfolioSummary.totalProjects}</strong>
          <small>{formatCompactCount(projectPortfolioItems.filter((item) => item.appTypeCount > 0).length, "project")} with app types</small>
        </article>
        <article className="project-stat-card danger">
          <span>Risky Projects</span>
          <strong>{portfolioSummary.riskyProjects}</strong>
          <small>Needs immediate review</small>
        </article>
        <article className="project-stat-card warning">
          <span>Release Ready</span>
          <strong>{portfolioSummary.releaseReadyProjects}</strong>
          <small>Passing health threshold</small>
        </article>
        <article className="project-stat-card success">
          <span>Requirement Coverage</span>
          <strong>{portfolioSummary.averageRequirementCoverage}%</strong>
          <small>Average across scope</small>
        </article>
        <article className="project-stat-card info">
          <span>Automation Coverage</span>
          <strong>{portfolioSummary.averageAutomationCoverage}%</strong>
          <small>Automation maturity</small>
        </article>
      </section>

      <WorkspaceMasterDetail
        browseView={(
          <Panel
            className="projects-catalog-panel"
            title="Project Portfolio"
            subtitle="Browse workspace scope, then open a focused project workspace when you want to edit members or app types."
            actions={(
              <div className="projects-view-toggle" aria-label="Project view options">
                <button
                  aria-label="Card view"
                  className={projectViewMode === "cards" ? "is-active" : ""}
                  onClick={() => setProjectViewMode("cards")}
                  type="button"
                >
                  <GridIcon />
                </button>
                <button
                  aria-label="List view"
                  className={projectViewMode === "list" ? "is-active" : ""}
                  onClick={() => setProjectViewMode("list")}
                  type="button"
                >
                  <ListIcon />
                </button>
              </div>
            )}
          >
            <div className="project-list-toolbar">
              <CatalogSearchFilter
                activeFilterCount={activeProjectFilterCount}
                ariaLabel="Search projects"
                onChange={setProjectSearch}
                placeholder="Search projects"
                subtitle="Filter projects by app type scope or project members."
                title="Filter projects"
                type="search"
                value={projectSearch}
              >
                <div className="catalog-filter-grid">
                  <label className="catalog-filter-field">
                    <span>App type</span>
                    <select onChange={(event) => setProjectAppTypeFilter(event.target.value)} value={projectAppTypeFilter}>
                      <option value="all">All app types</option>
                      <option value="with-app-types">Has app types</option>
                      <option value="without-app-types">No app types</option>
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
                        <option key={user.id} value={user.id}>{user.name || user.email}</option>
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
            </div>
            {isProjectCatalogLoading ? <TileCardSkeletonGrid className="catalog-grid compact" /> : null}
            {!isProjectCatalogLoading ? (
              projectViewMode === "cards" ? (
                <div className="projects-grid">
                  {filteredProjectItems.map((item) => {
                    const { project, coverage, automationCoverage, passCoverage } = item;
                    const isSelected = String(selectedProjectId) === String(project.id);
                    const requirementCoverageDetail = coverage.totalRequirements
                      ? `${coverage.coveredRequirements}/${coverage.totalRequirements} requirements covered`
                      : "No requirements available to measure coverage";
                    const automationCoverageDetail = automationCoverage.totalCases
                      ? `${automationCoverage.automatedCases}/${automationCoverage.totalCases} cases automated`
                      : "No test cases available to measure automation coverage";
                    const passCoverageDetail = passCoverage.totalCases
                      ? `${passCoverage.passedCases}/${passCoverage.totalCases} cases are currently passing`
                      : "No test cases available to measure pass rate";

                    return (
                      <article
                        key={project.id}
                        aria-pressed={isSelected}
                        className={[
                          "project-portfolio-card",
                          `is-${item.healthTone}`,
                          isSelected ? "is-active" : ""
                        ].filter(Boolean).join(" ")}
                        onClick={() => openPortfolioProject(item)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) {
                            return;
                          }

                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openPortfolioProject(item);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="project-portfolio-topline">
                          <div className="project-portfolio-title">
                            <TileCardIconFrame className="project-card-icon" tone={isSelected ? "success" : "info"}>
                              <TileCardProjectIcon />
                            </TileCardIconFrame>
                            <div>
                              <DisplayIdBadge value={project.display_id || project.id} />
                              <h3>{project.name}</h3>
                              <span>{item.appTypeSummary}</span>
                            </div>
                          </div>
                          <div className="project-card-top-actions" onClick={(event) => event.stopPropagation()}>
                            <span className={`project-health-badge ${item.healthTone}`}>{item.healthLabel}</span>
                            <CatalogActionMenu
                              actions={getProjectActionItems(item)}
                              label={`${project.name} actions`}
                            />
                          </div>
                        </div>

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
                            label="Requirement coverage"
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
                            label="Latest pass rate"
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
                          <span><b>{item.memberCount}</b> Members</span>
                          <span><b>{item.suiteCount}</b> Suites</span>
                          <span><b>{item.testCaseCount}</b> Cases</span>
                          <span><b>{item.requirementCount}</b> Requirements</span>
                        </div>

                        <div className={`project-risk-note ${item.healthTone}`}>
                          <span>{item.healthTone === "danger" ? "!" : "AI"}</span>
                          <p>{item.insight}</p>
                        </div>

                        <div className="project-card-actions" aria-hidden="true" />
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="projects-list-view" role="table" aria-label="Project relation list">
                  <div className="projects-list-row projects-list-head" role="row">
                    <span>Project</span>
                    <span>Readiness</span>
                    <span>Scope</span>
                    <span>Coverage</span>
                    <span>Latest Run</span>
                    <span>Actions</span>
                  </div>
                  {filteredProjectItems.map((item) => (
                    <div className="projects-list-row" role="row" key={item.project.id}>
                      <div className="projects-list-project">
                        <DisplayIdBadge value={item.project.display_id || item.project.id} />
                        <strong>{item.project.name}</strong>
                        <span>{item.project.description || item.appTypeSummary}</span>
                        <small>{item.memberNames.length ? item.memberNames.join(", ") : "No members assigned"}</small>
                      </div>
                      <div>
                        <span className={`project-health-badge ${item.healthTone}`}>{item.healthLabel}</span>
                        <strong>{item.readinessScore}%</strong>
                        <small>{item.readinessLabel}</small>
                      </div>
                      <div>
                        <strong>{item.appTypeCount} app types</strong>
                        <span>{item.suiteCount} suites · {item.requirementCount} reqs · {item.testCaseCount} cases</span>
                      </div>
                      <div className="projects-list-coverage">
                        <span>Req {item.coverage.coveragePercent}%</span>
                        <span>Auto {item.automationCoverage.coveragePercent}%</span>
                        <span>Pass {item.passCoverage.coveragePercent}%</span>
                      </div>
                      <div>
                        <strong>{item.latestRunLabel}</strong>
                        <span>{item.latestExecution?.status || "No execution"} · {item.latestFailedCount} failed</span>
                        <small>{item.latestDurationLabel}</small>
                      </div>
                      <div className="projects-list-actions">
                        <button className="ghost-button" onClick={() => openPortfolioProject(item)} type="button">Open</button>
                        <CatalogActionMenu actions={getProjectActionItems(item)} label={`${item.project.name} actions`} />
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : null}
            {!isProjectCatalogLoading && !projectItems.length ? <div className="empty-state compact">No projects yet. Create the first project to add scope, app types, and the initial team in one flow.</div> : null}
            {!isProjectCatalogLoading && projectItems.length > 0 && !filteredProjectItems.length ? <div className="empty-state compact">No projects match the current search or filters.</div> : null}
          </Panel>
        )}
        detailView={(
          <div className="stack-grid">
            <Panel
              actions={<WorkspaceBackButton label="Back to projects list" onClick={() => setFocusedProjectId("")} />}
              title={focusedProject ? focusedProject.name : "Project summary"}
              subtitle={focusedProject ? "Quick orientation before you dive into related records." : "Select a project to reveal its scoped data."}
            >
              {focusedProject ? (
                <div className="detail-stack">
                  <div className="detail-summary">
                    <strong>{focusedProject.name}</strong>
                    <span>{focusedProject.description || "No description provided yet."}</span>
                  </div>
                  <div className="metric-strip">
                    <button
                      aria-label={`Open members for ${focusedProject.name}`}
                      className="mini-card project-metric-link-card"
                      onClick={() => openProjectSection("members")}
                      type="button"
                    >
                      <strong>{scopedMembers.length}</strong>
                      <span>Members</span>
                    </button>
                    <button
                      aria-label={`Open app types for ${focusedProject.name}`}
                      className="mini-card project-metric-link-card"
                      onClick={() => openProjectSection("appTypes")}
                      type="button"
                    >
                      <strong>{selectedProjectAppTypeCount}</strong>
                      <span>App types</span>
                    </button>
                    <button
                      aria-label={`Open requirements for ${focusedProject.name}`}
                      className="mini-card project-metric-link-card"
                      onClick={() => openProjectWorkspacePage("/requirements")}
                      type="button"
                    >
                      <strong>{selectedProjectRequirementCount}</strong>
                      <span>Requirements</span>
                    </button>
                    <button
                      aria-label={`Open test cases for ${focusedProject.name}`}
                      className="mini-card project-metric-link-card"
                      onClick={() => openProjectWorkspacePage("/test-cases")}
                      type="button"
                    >
                      <strong>{selectedProjectTestCaseCount}</strong>
                      <span>Test cases</span>
                    </button>
                    <button
                      aria-label={`Open execution results for ${focusedProject.name}`}
                      className="mini-card project-metric-link-card"
                      onClick={() => openProjectWorkspacePage("/executions")}
                      type="button"
                    >
                      <strong>{`${selectedProjectPassCoverage.coveragePercent}%`}</strong>
                      <span>
                        {selectedProjectPassCoverage.totalCases
                          ? `Pass rate · ${selectedProjectPassCoverage.passedCases}/${selectedProjectPassCoverage.totalCases} passed`
                          : "Pass rate"}
                      </span>
                    </button>
                  </div>
                  <div className="action-row">
                    <button
                      className="ghost-button"
                      disabled={!focusedGoogleDriveIntegration || queueProjectSync.isPending}
                      onClick={() => focusedProject && queueProjectSync.mutate({ projectId: focusedProject.id, provider: "google_drive" })}
                      title={
                        focusedGoogleDriveIntegration
                          ? `Last backup: ${lastProjectBackupByProvider.google_drive ? formatAuditTimestamp(lastProjectBackupByProvider.google_drive.completed_at || lastProjectBackupByProvider.google_drive.created_at, "Not recorded") : "Not recorded"}`
                          : "Configure a Google Drive backup integration for this project first"
                      }
                      type="button"
                    >
                      <GoogleDriveIcon />
                      <span>{queueProjectSync.isPending && focusedGoogleDriveIntegration ? "Queueing…" : "Backup to Drive"}</span>
                    </button>
                    <button
                      className="ghost-button"
                      disabled={!focusedGithubIntegration || queueProjectSync.isPending}
                      onClick={() => focusedProject && queueProjectSync.mutate({ projectId: focusedProject.id, provider: "github" })}
                      title={
                        focusedGithubIntegration
                          ? `Last sync: ${lastProjectBackupByProvider.github ? formatAuditTimestamp(lastProjectBackupByProvider.github.completed_at || lastProjectBackupByProvider.github.created_at, "Not recorded") : "Not recorded"}`
                          : "Configure a GitHub sync integration for this project first"
                      }
                      type="button"
                    >
                      <GithubIcon />
                      <span>{queueProjectSync.isPending && focusedGithubIntegration ? "Queueing…" : "Sync to GitHub"}</span>
                    </button>
                    {isAdmin ? (
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
                  <div className="record-grid">
                    <article className="mini-card">
                      <strong>{focusedGoogleDriveIntegration ? "Google Drive" : "No Drive backup"}</strong>
                      <span>{focusedGoogleDriveIntegration ? `Mode: ${String(focusedGoogleDriveIntegration.config?.schedule_mode || "manual")}` : "Create a Google Drive integration mapped to this project."}</span>
                      <span>{focusedGoogleDriveIntegration ? `Last backup: ${formatAuditTimestamp(typeof focusedGoogleDriveIntegration.config?.last_synced_at === "string" ? focusedGoogleDriveIntegration.config.last_synced_at : undefined, "Not recorded")}` : "Compressed artifact backup stays unavailable until configured."}</span>
                    </article>
                    <article className="mini-card">
                      <strong>{focusedGithubIntegration ? "GitHub" : "No GitHub sync"}</strong>
                      <span>{focusedGithubIntegration ? `Mode: ${String(focusedGithubIntegration.config?.schedule_mode || "manual")}` : "Create a GitHub integration mapped to this project."}</span>
                      <span>{focusedGithubIntegration ? `Last sync: ${formatAuditTimestamp(typeof focusedGithubIntegration.config?.last_synced_at === "string" ? focusedGithubIntegration.config.last_synced_at : undefined, "Not recorded")}` : "Automation code sync stays unavailable until configured."}</span>
                    </article>
                  </div>
                </div>
              ) : (
                <div className="empty-state compact">Choose a project to continue.</div>
              )}
            </Panel>

            <SubnavTabs
              value={section}
              onChange={setSection}
              items={[
                { value: "members", label: "Members", meta: `${scopedMembers.length}` },
                { value: "appTypes", label: "App Types", meta: `${scopedAppTypes.length}` }
              ]}
            />

            {section === "members" ? (
              <Panel title="Project members" subtitle={projectId ? `Assignments for ${scopedProject?.name}` : "Select a project first"}>
              <form
                className="elevated-toolbar"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!projectId) return;
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
                  {(users.data || []).map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
                </select>
                <select name="role_id" required defaultValue="">
                  <option value="" disabled>Select role</option>
                  {(roles.data || []).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
                <button className="primary-button" disabled={!projectId || createMember.isPending} type="submit">
                  {createMember.isPending ? "Adding…" : "Add member"}
                </button>
              </form>

              <div className="record-grid">
                {scopedMembers.map((member) => {
                  const user = users.data?.find((item) => item.id === member.user_id);
                  const role = roles.data?.find((item) => item.id === member.role_id);
                  const isCurrentUser = member.user_id === session?.user.id;

                  return (
                    <article className="mini-card" key={member.id}>
                      <strong>{user?.name || user?.email || member.user_id}</strong>
                      <span>{role?.name || member.role_id}</span>
                      {isCurrentUser ? <span className="text-muted project-member-note">You</span> : null}
                      <button
                        className="ghost-button danger"
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

            {section === "appTypes" ? (
              <Panel title="App types" subtitle="Keep platform boundaries readable and lightweight.">
              <form
                className="elevated-toolbar"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!projectId) return;
                  const formData = new FormData(event.currentTarget);
                  createAppType.mutate({
                    project_id: projectId,
                    name: String(formData.get("name") || ""),
                    type: String(formData.get("type") || quickAddAppTypeType || defaultAppTypeValue) as AppType["type"],
                    is_unified: String(formData.get("is_unified") || "") === "on"
                  });
                  event.currentTarget.reset();
                  setQuickAddAppTypeType(defaultAppTypeValue);
                }}
              >
                <input name="name" required placeholder="Web app" />
                <AppTypeDropdown
                  ariaLabel="Select an app type platform"
                  name="type"
                  onChange={setQuickAddAppTypeType}
                  options={appTypeDropdownOptions}
                  placeholder="Select platform type"
                  value={quickAddAppTypeType}
                />
                <label className="checkbox-field">
                  <input name="is_unified" type="checkbox" />
                  Unified
                </label>
                <button className="primary-button" disabled={!projectId || createAppType.isPending} type="submit">
                  {createAppType.isPending ? "Adding…" : "Add app type"}
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
                      onClick={() => void api.appTypes.delete(item.id).then(() => {
                        setMessageTone("success");
                        setMessage("App type deleted.");
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
              {!scopedAppTypes.length ? <div className="empty-state compact">No app types defined yet.</div> : null}
              </Panel>
            ) : null}
          </div>
        )}
        isDetailOpen={Boolean(focusedProject)}
      />

      {isCreateModalOpen ? (
        <div className="modal-backdrop" onClick={closeCreateProjectModal}>
          <div
            aria-labelledby="create-project-title"
            aria-modal="true"
            className="modal-card project-create-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="project-create-header">
              <div className="project-create-title">
                <p className="eyebrow">Projects & Scope</p>
                <div className="modal-title-info-row">
                  <p className="eyebrow" id="create-project-title">Create project</p>
                  <InfoTooltip
                    content="Create the project, attach app types, and select any extra members. Admins are added automatically, and your account is linked as a member."
                    label="Create project information"
                  />
                </div>
              </div>
              <button className="ghost-button" disabled={createProject.isPending} onClick={closeCreateProjectModal} type="button">
                Close
              </button>
            </div>

            <form className="project-create-modal-form" onSubmit={handleProjectCreate}>
              <div className="project-create-modal-body">
                <div className="form-grid">
                  <FormField label="Project name" inputId="project-name-input" required>
                    <input
                      autoComplete="organization"
                      autoFocus
                      id="project-name-input"
                      onChange={(event) => updateProjectDraft({ name: event.target.value })}
                      value={projectDraft.name}
                    />
                  </FormField>
                  <FormField label="Description" inputId="project-description-input">
                    <textarea
                      id="project-description-input"
                      onChange={(event) => updateProjectDraft({ description: event.target.value })}
                      rows={3}
                      value={projectDraft.description}
                    />
                  </FormField>
                </div>

                <div className="metric-strip compact">
                  <div className="mini-card">
                    <strong>{projectDraft.memberIds.length}</strong>
                    <span>Extra members selected</span>
                  </div>
                  <div className="mini-card">
                    <strong>{projectDraft.appTypes.filter((appType) => appType.name.trim()).length}</strong>
                    <span>App types ready</span>
                  </div>
                </div>

                <div className="detail-summary">
                  <strong>Automatic membership is handled for you</strong>
                  <span>Admins are linked automatically with admin access, while the project creator is linked automatically as a member. Extra selected users are added as project members in the same create action.</span>
                </div>

                <section className="project-create-section">
                  <div className="project-create-section-head">
                    <div>
                      <h4>App types</h4>
                      <p>Add one or more app types so the project is ready for design work immediately.</p>
                    </div>
                    <button className="ghost-button" onClick={addProjectAppTypeRow} type="button">
                      Add app type
                    </button>
                  </div>

                  <div className="project-app-type-list">
                    {projectDraft.appTypes.map((appType, index) => (
                      <div className="project-app-type-row" key={appType.id}>
                        <div className="project-app-type-grid">
                          <FormField label={`App type ${index + 1} name`}>
                            <input
                              onChange={(event) => updateProjectAppType(appType.id, { name: event.target.value })}
                              placeholder="Web app"
                              required
                              value={appType.name}
                            />
                          </FormField>
                          <FormField label="Platform type">
                            <AppTypeDropdown
                              ariaLabel={`Select platform type for app type ${index + 1}`}
                              onChange={(value) => updateProjectAppType(appType.id, { type: value as AppType["type"] })}
                              options={appTypeDropdownOptions}
                              placeholder="Select platform type"
                              value={appType.type}
                            />
                          </FormField>
                          <label className="checkbox-field project-app-type-checkbox">
                            <input
                              checked={appType.is_unified}
                              onChange={(event) => updateProjectAppType(appType.id, { is_unified: event.target.checked })}
                              type="checkbox"
                            />
                            Unified
                          </label>
                          <button className="ghost-button danger" onClick={() => removeProjectAppType(appType.id)} type="button">
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="project-create-section">
                  <div className="project-create-section-head">
                    <div>
                      <h4>Project members</h4>
                      <p>All existing users are listed here. Admins are auto-added, your account is auto-added as a member, and any other users can be selected now.</p>
                    </div>
                    <div className="panel-head-actions">
                      <span className="status-pill tone-neutral">{projectDraft.memberIds.length} selected</span>
                      <button
                        className="ghost-button"
                        disabled={!selectableProjectMemberIds.length || areAllSelectableProjectMembersSelected}
                        onClick={() => updateProjectDraft({ memberIds: selectableProjectMemberIds })}
                        type="button"
                      >
                        Select all
                      </button>
                      <button
                        className="ghost-button"
                        disabled={!projectDraft.memberIds.length}
                        onClick={() => updateProjectDraft({ memberIds: [] })}
                        type="button"
                      >
                        Clear selection
                      </button>
                    </div>
                  </div>

                  {projectMemberOptions.length ? (
                    <div className="modal-case-picker project-member-picker">
                      {projectMemberOptions.map((user) => {
                        const isAutoIncluded = user.id === session?.user.id || user.role === "admin";

                        return (
                          <label className={isAutoIncluded ? "modal-case-option project-member-option is-auto-included" : "modal-case-option project-member-option"} key={user.id}>
                            <input
                              checked={isAutoIncluded || projectDraft.memberIds.includes(user.id)}
                              disabled={isAutoIncluded}
                              onChange={() => toggleProjectDraftMember(user.id)}
                              type="checkbox"
                            />
                            <div>
                              <strong>{user.name || user.email}</strong>
                              <span>{user.email}</span>
                              <span className="project-member-option-meta">
                                {isAutoIncluded ? (user.id === session?.user.id ? "Project creator • auto-added as member" : "Admin • auto-added") : "Selectable member"}
                              </span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty-state compact">No users exist yet to add to this project.</div>
                  )}
                </section>
              </div>

              <div className="action-row project-create-modal-actions">
                <button className="ghost-button danger" disabled={createProject.isPending} onClick={closeCreateProjectModal} type="button">
                  Cancel
                </button>
                <button className="primary-button" disabled={createProject.isPending} type="submit">
                  {createProject.isPending ? "Creating…" : "Create project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
