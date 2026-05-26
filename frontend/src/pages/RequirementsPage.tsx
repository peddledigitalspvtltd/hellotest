import { ChangeEvent, Dispatch, FormEvent, ReactNode, SetStateAction, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AiDesignStudioModal } from "../components/AiDesignStudioModal";
import { AddIcon, ImportIcon, OpenIcon, SparkIcon, TrashIcon } from "../components/AppIcons";
import { CatalogActionMenu } from "../components/CatalogActionMenu";
import { CatalogViewToggle } from "../components/CatalogViewToggle";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { DisplayIdBadge } from "../components/DisplayIdBadge";
import { FormField } from "../components/FormField";
import { LinkedTestCaseModal } from "../components/LinkedTestCaseModal";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { ProgressMeter } from "../components/ProgressMeter";
import {
  TileCardFact,
  TileCardLinkIcon,
  TileCardPriorityIcon,
  formatTileCardLabel
} from "../components/TileCardPrimitives";
import { TileBrowserPane } from "../components/TileBrowserPane";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { ToastMessage } from "../components/ToastMessage";
import { WorkspaceSectionTabs } from "../components/WorkspaceSectionTabs";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { useDeleteConfirmation } from "../components/DeleteConfirmationDialog";
import { useCurrentAppType, useCurrentProject } from "../hooks/useCurrentProject";
import { useDomainMetadata } from "../hooks/useDomainMetadata";
import { api } from "../lib/api";
import { appendUniqueImages, parseExternalLinks, readImageFiles } from "../lib/aiDesignStudio";
import { formatAuditTimestamp, resolveAuditUserLabel } from "../lib/auditDisplay";
import { formatReferenceList, parseReferenceList } from "../lib/externalReferences";
import { parseRequirementCsv } from "../lib/requirementImport";
import { TEST_AUTHORING_SECTION_ITEMS } from "../lib/workspaceSections";
import type { AiDesignImageInput, AiDesignedTestCaseCandidate, ExecutionResult, Requirement, TestCase, User } from "../types";

type RequirementDraft = {
  title: string;
  description: string;
  externalReferencesText: string;
  priority: number;
  status: string;
};

type RequirementSectionKey = "details" | "library";
type RequirementCoverageFilter = "all" | "linked" | "unlinked";

type RequirementCoverageMetric = {
  total: number;
  covered: number;
  percent: number;
};

type RequirementOptimizationSuggestion = Awaited<ReturnType<typeof api.requirements.previewOptimization>>["suggestion"];

const createEmptyRequirementDraft = (defaultStatus = "open"): RequirementDraft => ({
  title: "",
  description: "",
  externalReferencesText: "",
  priority: 3,
  status: defaultStatus
});

const createDefaultRequirementSections = (): Record<RequirementSectionKey, boolean> => ({
  details: true,
  library: false
});

const getRequirementCoverageTone = (covered: number, total: number) => {
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

function RequirementProgressBar({
  label,
  metric,
  detail
}: {
  label: string;
  metric: RequirementCoverageMetric;
  detail: string;
}) {
  const safeValue = Math.max(0, Math.min(100, Math.round(metric.percent)));
  const tone = getRequirementCoverageTone(metric.covered, metric.total);

  return (
    <div className="requirement-progress-meter" aria-label={`${label} ${safeValue}%`} title={detail}>
      <div className="requirement-progress-meter-header">
        <span>{label}</span>
        <strong>{safeValue}%</strong>
      </div>
      <ProgressMeter hideCopy tone={tone} value={safeValue} />
    </div>
  );
}

export function RequirementsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const domainMetadataQuery = useDomainMetadata();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const [selectedRequirementId, setSelectedRequirementId] = useState("");
  const [selectedTestCaseIds, setSelectedTestCaseIds] = useState<string[]>([]);
  const [linkedPreviewCaseId, setLinkedPreviewCaseId] = useState("");
  const [deleteSelectedRequirementIds, setDeleteSelectedRequirementIds] = useState<string[]>([]);
  const [isDeletingSelectedRequirements, setIsDeletingSelectedRequirements] = useState(false);
  const [requirementSearchTerm, setRequirementSearchTerm] = useState("");
  const [requirementStatusFilter, setRequirementStatusFilter] = useState("all");
  const [requirementPriorityFilter, setRequirementPriorityFilter] = useState("all");
  const [requirementCoverageFilter, setRequirementCoverageFilter] = useState<RequirementCoverageFilter>("all");
  const [catalogViewMode, setCatalogViewMode] = useState<"tile" | "list">("tile");
  const [expandedSections, setExpandedSections] = useState<Record<RequirementSectionKey, boolean>>(createDefaultRequirementSections);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const defaultRequirementStatus = domainMetadataQuery.data?.requirements.default_status || "open";
  const emptyRequirementDraft = useMemo(() => createEmptyRequirementDraft(defaultRequirementStatus), [defaultRequirementStatus]);
  const [draft, setDraft] = useState<RequirementDraft>(() => createEmptyRequirementDraft());
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<RequirementDraft>(() => createEmptyRequirementDraft());
  const [createSelectedTestCaseIds, setCreateSelectedTestCaseIds] = useState<string[]>([]);
  const [isAiStudioOpen, setIsAiStudioOpen] = useState(false);
  const [aiRequirementId, setAiRequirementId] = useState("");
  const [integrationId, setIntegrationId] = useState("");
  const [maxCases, setMaxCases] = useState(6);
  const [aiAdditionalContext, setAiAdditionalContext] = useState("");
  const [aiExternalLinksText, setAiExternalLinksText] = useState("");
  const [aiReferenceImages, setAiReferenceImages] = useState<AiDesignImageInput[]>([]);
  const [previewCases, setPreviewCases] = useState<AiDesignedTestCaseCandidate[]>([]);
  const [previewMessage, setPreviewMessage] = useState("");
  const [previewTone, setPreviewTone] = useState<"success" | "error">("success");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState<Array<{ title: string; description?: string; external_references?: string[]; priority?: number; status?: string }>>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [isOptimizeModalOpen, setIsOptimizeModalOpen] = useState(false);
  const [optimizeRequirementIds, setOptimizeRequirementIds] = useState<string[]>([]);
  const [optimizeRequirementIndex, setOptimizeRequirementIndex] = useState(0);
  const [optimizeContext, setOptimizeContext] = useState("");
  const [optimizationSuggestion, setOptimizationSuggestion] = useState<RequirementOptimizationSuggestion | null>(null);
  const [optimizationFields, setOptimizationFields] = useState({
    title: true,
    description: true,
    external_references: true,
    priority: true,
    status: true
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list
  });
  const appTypesQuery = useQuery({
    queryKey: ["app-types", projectId],
    queryFn: () => api.appTypes.list({ project_id: projectId }),
    enabled: Boolean(projectId)
  });
  const requirementsQuery = useQuery({
    queryKey: ["requirements", projectId],
    queryFn: () => api.requirements.list({ project_id: projectId }),
    enabled: Boolean(projectId)
  });
  const testCasesQuery = useQuery({
    queryKey: ["requirements-test-cases", appTypeId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const executionResultsQuery = useQuery({
    queryKey: ["requirements-execution-results", appTypeId],
    queryFn: () => api.executionResults.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const sharedGroupsQuery = useQuery({
    queryKey: ["requirements-shared-step-groups", appTypeId],
    queryFn: () => api.sharedStepGroups.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const suitesQuery = useQuery({
    queryKey: ["requirements-test-suites", appTypeId],
    queryFn: () => api.testSuites.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations", "llm"],
    queryFn: () => api.integrations.list({ type: "llm", is_active: true }),
    enabled: Boolean(session)
  });
  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: api.users.list,
    enabled: Boolean(session)
  });

  const createRequirement = useMutation({ mutationFn: api.requirements.create });
  const bulkImportRequirements = useMutation({ mutationFn: api.requirements.bulkImport });
  const updateRequirement = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.requirements.update>[1] }) =>
      api.requirements.update(id, input)
  });
  const deleteRequirement = useMutation({ mutationFn: api.requirements.delete });
  const replaceMappings = useMutation({
    mutationFn: ({ requirementId, testCaseIds }: { requirementId: string; testCaseIds: string[] }) =>
      api.requirementTestCases.replace(requirementId, testCaseIds)
  });
  const previewDesignedCases = useMutation({
    mutationFn: ({ requirementId, input }: { requirementId: string; input: Parameters<typeof api.requirements.previewDesignedTestCases>[1] }) =>
      api.requirements.previewDesignedTestCases(requirementId, input)
  });
  const acceptDesignedCases = useMutation({
    mutationFn: ({ requirementId, input }: { requirementId: string; input: Parameters<typeof api.requirements.acceptDesignedTestCases>[1] }) =>
      api.requirements.acceptDesignedTestCases(requirementId, input)
  });
  const previewRequirementOptimization = useMutation({
    mutationFn: ({ requirementId, input }: { requirementId: string; input?: Parameters<typeof api.requirements.previewOptimization>[1] }) =>
      api.requirements.previewOptimization(requirementId, input)
  });

  const projects = projectsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const requirements = requirementsQuery.data || [];
  const testCases = testCasesQuery.data || [];
  const executionResults = executionResultsQuery.data || [];
  const sharedGroups = sharedGroupsQuery.data || [];
  const suites = suitesQuery.data || [];
  const integrations = integrationsQuery.data || [];
  const users = (usersQuery.data || []) as User[];
  const userById = useMemo(
    () =>
      users.reduce<Record<string, User>>((accumulator, user) => {
        accumulator[user.id] = user;
        return accumulator;
      }, {}),
    [users]
  );
  const isRequirementCatalogLoading =
    projectsQuery.isLoading ||
    (Boolean(projectId) && requirementsQuery.isLoading) ||
    (Boolean(appTypeId) && executionResultsQuery.isLoading);

  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  useEffect(() => {
    if (appTypesQuery.isPending) {
      return;
    }

    const scopedAppTypes = projectId
      ? appTypes.filter((item) => String(item.project_id) === String(projectId))
      : appTypes;

    if (projectId && appTypes.length && !scopedAppTypes.length) {
      return;
    }

    if (!scopedAppTypes.length) {
      setAppTypeId("");
      return;
    }

    if (!scopedAppTypes.some((item) => item.id === appTypeId)) {
      setAppTypeId(scopedAppTypes[0].id);
    }
  }, [appTypeId, appTypes, appTypesQuery.isPending, projectId, setAppTypeId]);

  useEffect(() => {
    if (!integrations.length) {
      setIntegrationId("");
      return;
    }

    if (!integrations.some((integration) => integration.id === integrationId)) {
      setIntegrationId(integrations[0].id);
    }
  }, [integrationId, integrations]);

  useEffect(() => {
    if (!requirements.length) {
      if (selectedRequirementId) {
        setSelectedRequirementId("");
      }
      return;
    }

    if (selectedRequirementId && !requirements.some((item) => item.id === selectedRequirementId)) {
      setSelectedRequirementId("");
    }
  }, [requirements, selectedRequirementId]);

  useEffect(() => {
    setDeleteSelectedRequirementIds((current) => current.filter((id) => requirements.some((item) => item.id === id)));
  }, [requirements]);

  const selectedRequirement = useMemo(
    () => requirements.find((item) => item.id === selectedRequirementId) || null,
    [requirements, selectedRequirementId]
  );
  const optimizeTargets = useMemo(
    () =>
      optimizeRequirementIds
        .map((id) => requirements.find((item) => item.id === id) || null)
        .filter(Boolean) as Requirement[],
    [optimizeRequirementIds, requirements]
  );
  const activeOptimizeRequirement = optimizeTargets[optimizeRequirementIndex] || selectedRequirement;
  const selectedRequirementActionCount = deleteSelectedRequirementIds.length;

  const latestResultByCaseId = useMemo(() => {
    const map: Record<string, ExecutionResult> = {};

    executionResults.forEach((result) => {
      const current = map[result.test_case_id];
      const currentTime = current?.created_at ? new Date(current.created_at).getTime() || 0 : 0;
      const nextTime = result.created_at ? new Date(result.created_at).getTime() || 0 : 0;

      if (!current || nextTime >= currentTime) {
        map[result.test_case_id] = result;
      }
    });

    return map;
  }, [executionResults]);

  const linkedCaseIdsByRequirementId = useMemo(() => {
    const map: Record<string, string[]> = {};
    const requirementIds = new Set(requirements.map((requirement) => requirement.id));

    requirements.forEach((requirement) => {
      map[requirement.id] = [];
    });

    testCases.forEach((testCase) => {
      const linkedRequirementIds = [...(testCase.requirement_ids || []), testCase.requirement_id].filter(Boolean) as string[];

      linkedRequirementIds.forEach((requirementId) => {
        if (!requirementIds.has(requirementId)) {
          return;
        }

        map[requirementId] = [...new Set([...(map[requirementId] || []), testCase.id])];
      });
    });

    requirements.forEach((requirement) => {
      const scopedLinkedIds = (requirement.test_case_ids || []).filter((testCaseId) => testCases.some((testCase) => testCase.id === testCaseId));
      map[requirement.id] = [...new Set([...(map[requirement.id] || []), ...scopedLinkedIds])];
    });

    return map;
  }, [requirements, testCases]);

  const passCoverageByRequirementId = useMemo(() => {
    const coverage: Record<string, RequirementCoverageMetric> = {};

    requirements.forEach((requirement) => {
      const linkedCaseIds = linkedCaseIdsByRequirementId[requirement.id] || [];
      const covered = linkedCaseIds.filter((testCaseId) => latestResultByCaseId[testCaseId]?.status === "passed").length;
      const total = linkedCaseIds.length;

      coverage[requirement.id] = {
        total,
        covered,
        percent: total ? Math.round((covered / total) * 100) : 0
      };
    });

    return coverage;
  }, [latestResultByCaseId, linkedCaseIdsByRequirementId, requirements]);

  const automationCoverageByRequirementId = useMemo(() => {
    const coverage: Record<string, RequirementCoverageMetric> = {};
    const testCaseById = new Map(testCases.map((testCase) => [testCase.id, testCase]));

    requirements.forEach((requirement) => {
      const linkedCaseIds = linkedCaseIdsByRequirementId[requirement.id] || [];
      const covered = linkedCaseIds.filter((testCaseId) => testCaseById.get(testCaseId)?.automated === "yes").length;
      const total = linkedCaseIds.length;

      coverage[requirement.id] = {
        total,
        covered,
        percent: total ? Math.round((covered / total) * 100) : 0
      };
    });

    return coverage;
  }, [linkedCaseIdsByRequirementId, requirements, testCases]);

  const requirementStatusOptions = useMemo(
    () => Array.from(new Set(requirements.map((item) => item.status || defaultRequirementStatus))).sort((left, right) => left.localeCompare(right)),
    [defaultRequirementStatus, requirements]
  );
  const requirementPriorityOptions = useMemo(
    () =>
      Array.from(new Set(requirements.map((item) => String(item.priority ?? 3)))).sort((left, right) => Number(left) - Number(right)),
    [requirements]
  );

  const filteredRequirements = useMemo(() => {
    const normalizedSearch = requirementSearchTerm.trim().toLowerCase();

    return requirements.filter((item) => {
      const linkedCaseCount = (linkedCaseIdsByRequirementId[item.id] || []).length;
      const matchesSearch =
        !normalizedSearch ||
        [
          item.title,
          item.description || "",
          ...(item.external_references || []),
          item.status || defaultRequirementStatus,
          `p${item.priority ?? 3}`,
          `priority ${item.priority ?? 3}`
        ].some((value) => value.toLowerCase().includes(normalizedSearch));

      if (!matchesSearch) {
        return false;
      }

      if (requirementStatusFilter !== "all" && (item.status || defaultRequirementStatus) !== requirementStatusFilter) {
        return false;
      }

      if (requirementPriorityFilter !== "all" && String(item.priority ?? 3) !== requirementPriorityFilter) {
        return false;
      }

      if (requirementCoverageFilter === "linked" && !linkedCaseCount) {
        return false;
      }

      if (requirementCoverageFilter === "unlinked" && linkedCaseCount) {
        return false;
      }

      return true;
    });
  }, [defaultRequirementStatus, linkedCaseIdsByRequirementId, requirementCoverageFilter, requirementPriorityFilter, requirementSearchTerm, requirementStatusFilter, requirements]);

  const activeRequirementFilterCount =
    Number(requirementStatusFilter !== "all") +
    Number(requirementPriorityFilter !== "all") +
    Number(requirementCoverageFilter !== "all");

  const areAllFilteredRequirementsSelected =
    filteredRequirements.length > 0 && filteredRequirements.every((item) => deleteSelectedRequirementIds.includes(item.id));

  const aiRequirement = useMemo(
    () => requirements.find((item) => item.id === aiRequirementId) || selectedRequirement || requirements[0] || null,
    [aiRequirementId, requirements, selectedRequirement]
  );

  const currentAppTypeName = appTypes.find((item) => item.id === appTypeId)?.name || "No app type selected";
  const requirementListColumns = useMemo<Array<DataTableColumn<Requirement>>>(() => [
    {
      key: "select",
      label: "",
      canToggle: false,
      headerRender: () => (
        <label className="data-table-header-checkbox" onClick={(event) => event.stopPropagation()}>
          <input
            aria-label="Select all filtered requirements"
            checked={areAllFilteredRequirementsSelected}
            onChange={(event) =>
              setDeleteSelectedRequirementIds((current) =>
                event.target.checked
                  ? [...new Set([...current, ...filteredRequirements.map((item) => item.id)])]
                  : current.filter((id) => !filteredRequirements.some((item) => item.id === id))
              )
            }
            type="checkbox"
          />
        </label>
      ),
      render: (item) => (
        <div onClick={(event) => event.stopPropagation()}>
          <input
            checked={deleteSelectedRequirementIds.includes(item.id)}
            onChange={(event) =>
              setDeleteSelectedRequirementIds((current) =>
                event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id)
              )
            }
            type="checkbox"
          />
        </div>
      )
    },
    {
      key: "id",
      label: "ID",
      render: (item) => <DisplayIdBadge value={item.display_id || item.id} />
    },
    {
      key: "title",
      label: "Requirement",
      canToggle: false,
      render: (item) => <strong>{item.title}</strong>
    },
    {
      key: "description",
      label: "Description",
      defaultVisible: false,
      render: (item) => item.description || currentAppTypeName
    },
    {
      key: "externalReferences",
      label: "References",
      defaultVisible: false,
      render: (item) => formatReferenceList(item.external_references) || "—"
    },
    {
      key: "status",
      label: "Status",
      render: (item) => formatTileCardLabel(item.status, "Open")
    },
    {
      key: "priority",
      label: "Priority",
      render: (item) => `P${item.priority ?? 3}`
    },
    {
      key: "linkedCases",
      label: "Linked cases",
      render: (item) => (linkedCaseIdsByRequirementId[item.id] || []).length
    },
    {
      key: "passRate",
      label: "Pass rate",
      defaultVisible: false,
      render: (item) => {
        const metric = passCoverageByRequirementId[item.id] || { total: 0, covered: 0, percent: 0 };
        const safeValue = Math.max(0, Math.min(100, Math.round(metric.percent)));
        return `${safeValue}%`;
      }
    },
    {
      key: "automationCoverage",
      label: "Automation coverage",
      defaultVisible: false,
      render: (item) => {
        const metric = automationCoverageByRequirementId[item.id] || { total: 0, covered: 0, percent: 0 };
        const safeValue = Math.max(0, Math.min(100, Math.round(metric.percent)));
        return `${safeValue}%`;
      }
    },
    {
      key: "createdBy",
      label: "Created by",
      defaultVisible: false,
      render: (item) => resolveAuditUserLabel(item.created_by, userById)
    },
    {
      key: "createdAt",
      label: "Created at",
      defaultVisible: false,
      render: (item) => formatAuditTimestamp(item.created_at)
    },
    {
      key: "updatedBy",
      label: "Last updated by",
      defaultVisible: false,
      render: (item) => resolveAuditUserLabel(item.updated_by || item.created_by, userById)
    },
    {
      key: "updatedAt",
      label: "Last updated at",
      defaultVisible: false,
      render: (item) => formatAuditTimestamp(item.updated_at || item.created_at)
    },
    {
      key: "actions",
      label: "Actions",
      canToggle: false,
      render: (item) => (
        <div onClick={(event) => event.stopPropagation()}>
          <CatalogActionMenu
            actions={[
              {
                label: "Open requirement",
                description: "Open this requirement in the detail workspace.",
                icon: <OpenIcon />,
                onClick: () => setSelectedRequirementId(item.id)
              },
              {
                label: "AI test cases",
                description: "Generate or review AI-designed test cases for this requirement.",
                icon: <SparkIcon />,
                onClick: () => openRequirementAiStudio(item.id)
              },
              {
                label: "Delete requirement",
                description: "Delete this requirement while keeping linked test cases in the library.",
                icon: <TrashIcon />,
                onClick: () => void handleDeleteRequirementItem(item),
                disabled: deleteRequirement.isPending,
                tone: "danger" as const
              }
            ]}
            label={`${item.title} actions`}
          />
        </div>
      )
    }
  ], [
    automationCoverageByRequirementId,
    currentAppTypeName,
    deleteSelectedRequirementIds,
    deleteRequirement.isPending,
    handleDeleteRequirementItem,
    linkedCaseIdsByRequirementId,
    openRequirementAiStudio,
    passCoverageByRequirementId,
    userById
  ]);

  const selectedRequirementPassCoverage = selectedRequirement
    ? passCoverageByRequirementId[selectedRequirement.id] || { total: 0, covered: 0, percent: 0 }
    : { total: 0, covered: 0, percent: 0 };
  const selectedRequirementAutomationCoverage = selectedRequirement
    ? automationCoverageByRequirementId[selectedRequirement.id] || { total: 0, covered: 0, percent: 0 }
    : { total: 0, covered: 0, percent: 0 };

  const associatedCases = useMemo(() => {
    if (!aiRequirement) {
      return [];
    }

    const linkedIds = new Set(aiRequirement.test_case_ids || []);
    return testCases.filter((testCase) => linkedIds.has(testCase.id));
  }, [aiRequirement, testCases]);

  const linkedPreviewCase = useMemo(
    () => testCases.find((testCase) => testCase.id === linkedPreviewCaseId) || null,
    [linkedPreviewCaseId, testCases]
  );

  const openTestCaseWorkspace = (testCaseId: string) => setLinkedPreviewCaseId(testCaseId);
  const openNewTestCase = (requirement: Requirement) => {
    if (!appTypeId) {
      setMessageTone("error");
      setMessage("Select an app type before creating a test case for this requirement.");
      return;
    }

    const params = new URLSearchParams({
      create: "1",
      requirement: requirement.id,
      appType: appTypeId
    });

    if (projectId) {
      params.set("project", projectId);
    }

    navigate(`/test-cases?${params.toString()}`);
  };
  const authoringSectionItems = useMemo(
    () =>
      TEST_AUTHORING_SECTION_ITEMS.map((item) => ({
        ...item,
        meta:
          item.to === "/requirements"
            ? String(requirements.length)
            : item.to === "/test-cases"
              ? String(testCases.length)
              : item.to === "/shared-steps"
                ? String(sharedGroups.length)
                : item.to === "/design"
                  ? String(suites.length)
                  : undefined
      })),
    [requirements.length, sharedGroups.length, suites.length, testCases.length]
  );

  useEffect(() => {
    if (!selectedRequirement) {
      setDraft(emptyRequirementDraft);
      setSelectedTestCaseIds([]);
      return;
    }

    setDraft({
      title: selectedRequirement.title,
      description: selectedRequirement.description || "",
      externalReferencesText: formatReferenceList(selectedRequirement.external_references),
      priority: selectedRequirement.priority ?? 3,
      status: selectedRequirement.status || defaultRequirementStatus
    });
    setSelectedTestCaseIds(selectedRequirement.test_case_ids || []);
  }, [selectedRequirement]);

  useEffect(() => {
    setExpandedSections(createDefaultRequirementSections());
  }, [selectedRequirement?.id]);

  useEffect(() => {
    if (!aiRequirementId && selectedRequirement) {
      setAiRequirementId(selectedRequirement.id);
    }
  }, [aiRequirementId, selectedRequirement]);

  useEffect(() => {
    if (!isCreateModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !createRequirement.isPending && !replaceMappings.isPending) {
        setIsCreateModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [createRequirement.isPending, isCreateModalOpen, replaceMappings.isPending]);

  useEffect(() => {
    if (!isImportModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !bulkImportRequirements.isPending) {
        setIsImportModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [bulkImportRequirements.isPending, isImportModalOpen]);

  useEffect(() => {
    if (!isAiStudioOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !previewDesignedCases.isPending && !acceptDesignedCases.isPending) {
        setIsAiStudioOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [acceptDesignedCases.isPending, isAiStudioOpen, previewDesignedCases.isPending]);

  useEffect(() => {
    if (!isCreateModalOpen) {
      return;
    }

    setCreateSelectedTestCaseIds((current) => current.filter((id) => testCases.some((testCase) => testCase.id === id)));
  }, [isCreateModalOpen, testCases]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["requirements-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-cases"] })
    ]);
  };

  const openCreateRequirementModal = () => {
    setCreateDraft(emptyRequirementDraft);
    setCreateSelectedTestCaseIds([]);
    setIsCreateModalOpen(true);
  };

  const closeRequirementDetail = () => {
    setSelectedRequirementId("");
    setDraft(emptyRequirementDraft);
    setSelectedTestCaseIds([]);
    setExpandedSections(createDefaultRequirementSections());
  };

  const closeCreateRequirementModal = () => {
    if (createRequirement.isPending || replaceMappings.isPending) {
      return;
    }

    setIsCreateModalOpen(false);
  };

  const toggleSelectedTestCase = (
    setter: Dispatch<SetStateAction<string[]>>,
    testCaseId: string,
    checked: boolean
  ) => {
    setter((current) => (checked ? [...new Set([...current, testCaseId])] : current.filter((id) => id !== testCaseId)));
  };
  const allReusableTestCaseIds = useMemo(
    () => testCases.map((testCase) => testCase.id),
    [testCases]
  );
  const areAllCreateRequirementCasesSelected =
    Boolean(allReusableTestCaseIds.length) && createSelectedTestCaseIds.length === allReusableTestCaseIds.length;

  const handleCreateRequirement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!projectId) {
      showError(null, "Select a project before creating a requirement.");
      return;
    }

    try {
      const response = await createRequirement.mutateAsync({
        project_id: projectId,
        title: createDraft.title,
        description: createDraft.description || undefined,
        external_references: parseReferenceList(createDraft.externalReferencesText),
        priority: createDraft.priority,
        status: createDraft.status
      });

      if (createSelectedTestCaseIds.length) {
        await replaceMappings.mutateAsync({ requirementId: response.id, testCaseIds: createSelectedTestCaseIds });
      }

      setSelectedRequirementId(response.id);
      setAiRequirementId(response.id);
      setIsCreateModalOpen(false);
      setCreateDraft(emptyRequirementDraft);
      setCreateSelectedTestCaseIds([]);
      showSuccess("Requirement created.");
      await refresh();
    } catch (error) {
      showError(error, "Unable to create requirement");
    }
  };

  const handleSaveRequirement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedRequirement) {
      return;
    }

    try {
      await updateRequirement.mutateAsync({
        id: selectedRequirement.id,
        input: {
          title: draft.title,
          description: draft.description,
          external_references: parseReferenceList(draft.externalReferencesText),
          priority: draft.priority,
          status: draft.status
        }
      });

      await replaceMappings.mutateAsync({ requirementId: selectedRequirement.id, testCaseIds: selectedTestCaseIds });
      showSuccess("Requirement updated.");
      await refresh();
    } catch (error) {
      showError(error, "Unable to update requirement");
    }
  };

  const handleRequirementImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseRequirementCsv(text);

      setImportRows(parsed.rows);
      setImportWarnings(parsed.warnings);
      setImportFileName(file.name);
      setMessageTone(parsed.rows.length ? "success" : "error");
      setMessage(
        parsed.rows.length
          ? `Prepared ${parsed.rows.length} requirements from ${file.name}.`
          : parsed.warnings[0] || "No requirements could be parsed from the CSV file."
      );
    } catch (error) {
      showError(error, "Unable to read the CSV file");
    } finally {
      event.target.value = "";
    }
  };

  const handleBulkImportRequirements = async () => {
    if (!projectId || !importRows.length) {
      return;
    }

    try {
      const response = await bulkImportRequirements.mutateAsync({
        project_id: projectId,
        rows: importRows
      });

      setMessageTone("success");
      setMessage(`Requirement import queued. Track progress in TestOps batch process ${response.transaction_id.slice(0, 8)}.`);
      setImportWarnings([]);
      setImportRows([]);
      setImportFileName("");
      setIsImportModalOpen(false);
      await refresh();
    } catch (error) {
      showError(error, "Unable to import requirements");
    }
  };

  const handleDeleteRequirement = async () => {
    if (!selectedRequirement || !(await confirmDelete({ message: `Delete requirement "${selectedRequirement.title}"? Linked test cases will remain in the library.` }))) {
      return;
    }

    try {
      await deleteRequirement.mutateAsync(selectedRequirement.id);
      setSelectedRequirementId("");
      setDraft(emptyRequirementDraft);
      setSelectedTestCaseIds([]);
      setPreviewCases([]);
      showSuccess("Requirement deleted.");
      await refresh();
    } catch (error) {
      showError(error, "Unable to delete requirement");
    }
  };

  function openRequirementAiStudio(requirementId: string) {
    setSelectedRequirementId(requirementId);
    setAiRequirementId(requirementId);
    setIsAiStudioOpen(true);
  }

  async function handleDeleteRequirementItem(requirement: Requirement) {
    if (!(await confirmDelete({ message: `Delete requirement "${requirement.title}"? Linked test cases will remain in the library.` }))) {
      return;
    }

    try {
      await deleteRequirement.mutateAsync(requirement.id);
      setDeleteSelectedRequirementIds((current) => current.filter((id) => id !== requirement.id));

      if (selectedRequirementId === requirement.id) {
        setSelectedRequirementId("");
        setDraft(emptyRequirementDraft);
        setSelectedTestCaseIds([]);
        setPreviewCases([]);
      }

      if (aiRequirementId === requirement.id) {
        setAiRequirementId("");
      }

      showSuccess("Requirement deleted.");
      await refresh();
    } catch (error) {
      showError(error, "Unable to delete requirement");
    }
  }

  const handleDeleteSelectedRequirements = async () => {
    const selectedRequirements = requirements.filter((item) => deleteSelectedRequirementIds.includes(item.id));

    if (!selectedRequirements.length) {
      return;
    }

    const confirmed = await confirmDelete({
      message: `Delete ${selectedRequirements.length} requirement${selectedRequirements.length === 1 ? "" : "s"}? Linked test cases will remain in the library.`
    });

    if (!confirmed) {
      return;
    }

    setIsDeletingSelectedRequirements(true);

    try {
      const results = await Promise.allSettled(selectedRequirements.map((requirement) => api.requirements.delete(requirement.id)));
      const deletedIds = selectedRequirements
        .filter((_, index) => results[index]?.status === "fulfilled")
        .map((requirement) => requirement.id);
      const failedResults = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

      setDeleteSelectedRequirementIds((current) => current.filter((id) => !deletedIds.includes(id)));

      if (deletedIds.includes(selectedRequirementId)) {
        setSelectedRequirementId("");
      }

      if (deletedIds.includes(aiRequirementId)) {
        setAiRequirementId("");
      }

      if (deletedIds.length) {
        await refresh();
      }

      if (!failedResults.length) {
        showSuccess(`${deletedIds.length} requirement${deletedIds.length === 1 ? "" : "s"} deleted.`);
        return;
      }

      const firstError = failedResults[0]?.reason;
      setMessageTone("error");
      setMessage(
        `${deletedIds.length} requirement${deletedIds.length === 1 ? "" : "s"} deleted, ${failedResults.length} failed.${firstError instanceof Error ? ` ${firstError.message}` : ""}`
      );
    } finally {
      setIsDeletingSelectedRequirements(false);
    }
  };

  const handleAddAiReferenceImages = async (files: FileList | null) => {
    try {
      const images = await readImageFiles(files);
      setAiReferenceImages((current) => appendUniqueImages(current, images));
    } catch (error) {
      setPreviewTone("error");
      setPreviewMessage(error instanceof Error ? error.message : "Unable to attach the selected image");
    }
  };

  const handlePreviewDesignedCases = async () => {
    if (!aiRequirement || !appTypeId) {
      return;
    }

    try {
      const response = await previewDesignedCases.mutateAsync({
        requirementId: aiRequirement.id,
        input: {
          app_type_id: appTypeId,
          integration_id: integrationId || undefined,
          max_cases: maxCases,
          additional_context: aiAdditionalContext || undefined,
          external_links: parseExternalLinks(aiExternalLinksText),
          images: aiReferenceImages
        }
      });

      setPreviewCases(response.cases);
      setPreviewTone("success");
      setPreviewMessage(`${response.generated} draft cases generated using ${response.integration.name}. Review them before accepting.`);
    } catch (error) {
      setPreviewTone("error");
      setPreviewMessage(error instanceof Error ? error.message : "Unable to preview AI-generated test cases");
    }
  };

  const handleAcceptDesignedCases = async () => {
    if (!aiRequirement || !appTypeId || !previewCases.length) {
      return;
    }

    try {
      await acceptDesignedCases.mutateAsync({
        requirementId: aiRequirement.id,
        input: {
          app_type_id: appTypeId,
          status: "draft",
          cases: previewCases.map((item) => ({
            title: item.title,
            description: item.description,
            priority: item.priority,
            requirement_ids: item.requirement_ids,
            steps: item.steps.map((step) => ({
              step_order: step.step_order,
              action: step.action,
              expected_result: step.expected_result
            }))
          }))
        }
      });

      setIsAiStudioOpen(false);
      setPreviewCases([]);
      setPreviewMessage("");
      showSuccess("AI-designed cases accepted as standard steps and linked to the requirement.");
      await refresh();
      navigate("/test-cases");
    } catch (error) {
      setPreviewTone("error");
      setPreviewMessage(error instanceof Error ? error.message : "Unable to accept AI-generated test cases");
    }
  };

  const openRequirementOptimization = (requirementIds?: string[]) => {
    const targetIds = Array.from(
      new Set((requirementIds?.length ? requirementIds : selectedRequirement ? [selectedRequirement.id] : []).filter(Boolean))
    );

    if (!targetIds.length) {
      showError(new Error("Select one or more requirements first."), "Unable to complete requirement");
      return;
    }

    setOptimizeRequirementIds(targetIds);
    setOptimizeRequirementIndex(0);
    setOptimizationSuggestion(null);
    setOptimizationFields({
      title: true,
      description: true,
      external_references: true,
      priority: true,
      status: true
    });
    setPreviewMessage("");
    setPreviewTone("success");
    setIsOptimizeModalOpen(true);
  };

  const handlePreviewRequirementOptimization = async () => {
    if (!activeOptimizeRequirement) {
      return;
    }

    try {
      const response = await previewRequirementOptimization.mutateAsync({
        requirementId: activeOptimizeRequirement.id,
        input: {
          integration_id: integrationId || undefined,
          additional_context: optimizeContext || undefined
        }
      });
      setOptimizationSuggestion(response.suggestion);
      setPreviewTone(response.fallback_used ? "error" : "success");
      setPreviewMessage(
        response.fallback_used
          ? `AI fallback used: ${response.fallback_reason || "LLM unavailable"}`
          : `Requirement optimized using ${response.integration?.name || "AI"}.`
      );
    } catch (error) {
      setPreviewTone("error");
      setPreviewMessage(error instanceof Error ? error.message : "Unable to optimize requirement");
    }
  };

  const handleApplyRequirementOptimization = async () => {
    if (!activeOptimizeRequirement || !optimizationSuggestion) {
      return;
    }

    const acceptanceAppend = [
      optimizationSuggestion.acceptance_criteria.length ? "Acceptance criteria:" : "",
      ...optimizationSuggestion.acceptance_criteria.map((item) => `- ${item}`),
      optimizationSuggestion.risks.length ? "\nRisks:" : "",
      ...optimizationSuggestion.risks.map((item) => `- ${item}`),
      optimizationSuggestion.open_questions.length ? "\nOpen questions:" : "",
      ...optimizationSuggestion.open_questions.map((item) => `- ${item}`)
    ].filter(Boolean).join("\n");

    const baseDraft = activeOptimizeRequirement.id === selectedRequirement?.id
      ? draft
      : {
          title: activeOptimizeRequirement.title,
          description: activeOptimizeRequirement.description || "",
          externalReferencesText: formatReferenceList(activeOptimizeRequirement.external_references),
          priority: activeOptimizeRequirement.priority ?? 3,
          status: activeOptimizeRequirement.status || defaultRequirementStatus
        };

    const nextDescription = optimizationFields.description
      ? optimizationSuggestion.description
      : [baseDraft.description, acceptanceAppend].filter(Boolean).join("\n\n");

    const nextDraft = {
      title: optimizationFields.title ? optimizationSuggestion.title : baseDraft.title,
      description: nextDescription,
      externalReferencesText: optimizationFields.external_references ? formatReferenceList(optimizationSuggestion.external_references) : baseDraft.externalReferencesText,
      priority: optimizationFields.priority ? optimizationSuggestion.priority : baseDraft.priority,
      status: optimizationFields.status ? optimizationSuggestion.status : baseDraft.status
    };

    if (activeOptimizeRequirement.id === selectedRequirement?.id) {
      setDraft(nextDraft);
    }

    try {
      await updateRequirement.mutateAsync({
        id: activeOptimizeRequirement.id,
        input: {
          title: nextDraft.title,
          description: nextDraft.description,
          external_references: parseReferenceList(nextDraft.externalReferencesText),
          priority: nextDraft.priority,
          status: nextDraft.status
        }
      });
      setOptimizationSuggestion(null);
      setPreviewMessage("");
      const hasNextRequirement = optimizeRequirementIndex + 1 < optimizeTargets.length;

      if (hasNextRequirement) {
        setOptimizeRequirementIndex((current) => current + 1);
        setOptimizationFields({
          title: true,
          description: true,
          external_references: true,
          priority: true,
          status: true
        });
        showSuccess(`AI changes applied to "${activeOptimizeRequirement.title}". Review the next selected requirement.`);
      } else {
        setIsOptimizeModalOpen(false);
        setOptimizeRequirementIds([]);
        setOptimizeRequirementIndex(0);
        setDeleteSelectedRequirementIds([]);
        showSuccess(`AI requirement changes applied to ${optimizeTargets.length || 1} requirement${(optimizeTargets.length || 1) === 1 ? "" : "s"}.`);
      }
      await refresh();
    } catch (error) {
      showError(error, "Unable to apply AI requirement changes");
    }
  };

  const metrics = useMemo(() => {
    const mapped = requirements.filter((item) => (item.test_case_ids || []).length).length;
    const highPriority = requirements.filter((item) => (item.priority || 3) <= 2).length;
    const open = requirements.filter((item) => (item.status || "open") !== "done").length;

    return {
      total: requirements.length,
      mapped,
      highPriority,
      open
    };
  }, [requirements]);

  return (
    <div className="page-content page-content--library-full">
      {confirmationDialog}
      <PageHeader
        eyebrow="Requirements"
        title="Requirements Workspace"
        description="Organize reusable requirement scope, keep coverage visible, and hand selected requirements into AI-assisted case design."
        meta={[
          { label: "Requirements", value: metrics.total },
          { label: "Mapped", value: metrics.mapped },
          { label: "High priority", value: metrics.highPriority }
        ]}
        actions={
          <>
            <button
              className="ghost-button"
              disabled={!projectId}
              onClick={() => {
                setImportRows([]);
                setImportWarnings([]);
                setImportFileName("");
                setIsImportModalOpen(true);
              }}
              type="button"
            >
              <ImportIcon />
              Bulk Import Requirements
            </button>
            <button
              className="ghost-button"
              disabled={!requirements.length || !appTypeId}
              onClick={() => {
                setAiRequirementId(selectedRequirement?.id || requirements[0]?.id || "");
                setPreviewCases([]);
                setPreviewMessage("");
                setPreviewTone("success");
                setIsAiStudioOpen(true);
              }}
              type="button"
            >
              <SparkIcon />
              AI Test Case Generation
            </button>
            <button
              className="ghost-button"
              disabled={!selectedRequirement && !selectedRequirementActionCount}
              onClick={() => openRequirementOptimization(selectedRequirementActionCount ? deleteSelectedRequirementIds : undefined)}
              type="button"
            >
              <SparkIcon />
              {selectedRequirementActionCount ? `Complete Selected (${selectedRequirementActionCount})` : "Complete Requirement"}
            </button>
            <button className="primary-button" disabled={!projectId} onClick={openCreateRequirementModal} type="button">
              <AddIcon />
              Create Requirement
            </button>
          </>
        }
      />

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

      <WorkspaceScopeBar
        appTypeId={appTypeId}
        appTypes={appTypes}
        onAppTypeChange={setAppTypeId}
        onProjectChange={setProjectId}
        projectId={projectId}
        projects={projects}
      />

      <WorkspaceSectionTabs ariaLabel="Test authoring sections" items={authoringSectionItems} />

      <WorkspaceMasterDetail
        browseView={(
          <Panel title="Requirement tiles" subtitle="Start in the visual catalog, scan coverage quickly, then open one requirement into a focused editor view.">
            <div className="design-list-toolbar requirement-catalog-toolbar">
              <CatalogViewToggle onChange={setCatalogViewMode} value={catalogViewMode} />
              <CatalogSearchFilter
                activeFilterCount={activeRequirementFilterCount}
                ariaLabel="Search requirements"
                onChange={setRequirementSearchTerm}
                placeholder="Search title, description, status, or priority"
                subtitle="Filter the requirement tiles by the same facts shown on each card."
                title="Filter requirements"
                value={requirementSearchTerm}
              >
                <div className="catalog-filter-grid">
                  <label className="catalog-filter-field">
                    <span>Status</span>
                    <select value={requirementStatusFilter} onChange={(event) => setRequirementStatusFilter(event.target.value)}>
                      <option value="all">All statuses</option>
                      {requirementStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {formatTileCardLabel(status, "Open")}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="catalog-filter-field">
                    <span>Priority</span>
                    <select value={requirementPriorityFilter} onChange={(event) => setRequirementPriorityFilter(event.target.value)}>
                      <option value="all">All priorities</option>
                      {requirementPriorityOptions.map((priority) => (
                        <option key={priority} value={priority}>
                          {`P${priority}`}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="catalog-filter-field">
                    <span>Linked cases</span>
                    <select
                      value={requirementCoverageFilter}
                      onChange={(event) => setRequirementCoverageFilter(event.target.value as RequirementCoverageFilter)}
                    >
                      <option value="all">All requirements</option>
                      <option value="linked">With linked cases</option>
                      <option value="unlinked">Without linked cases</option>
                    </select>
                  </label>

                  <div className="catalog-filter-actions">
                    <button
                      className="ghost-button"
                      disabled={!activeRequirementFilterCount}
                      onClick={() => {
                        setRequirementStatusFilter("all");
                        setRequirementPriorityFilter("all");
                        setRequirementCoverageFilter("all");
                      }}
                      type="button"
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
              </CatalogSearchFilter>
              <button
                className="ghost-button"
                disabled={!filteredRequirements.length || areAllFilteredRequirementsSelected}
                onClick={() =>
                  setDeleteSelectedRequirementIds((current) => [...new Set([...current, ...filteredRequirements.map((item) => item.id)])])
                }
                type="button"
              >
                Select all visible
              </button>
              <button
                className="ghost-button"
                disabled={!deleteSelectedRequirementIds.length}
                onClick={() => setDeleteSelectedRequirementIds([])}
                type="button"
              >
                Clear selection
              </button>
              <button
                className="ghost-button danger"
                disabled={!deleteSelectedRequirementIds.length || isDeletingSelectedRequirements}
                onClick={() => void handleDeleteSelectedRequirements()}
                type="button"
              >
                {isDeletingSelectedRequirements ? "Deleting…" : `Delete selected${deleteSelectedRequirementIds.length ? ` (${deleteSelectedRequirementIds.length})` : ""}`}
              </button>
              <button
                className="ghost-button"
                disabled={!deleteSelectedRequirementIds.length}
                onClick={() => openRequirementOptimization(deleteSelectedRequirementIds)}
                type="button"
              >
                <SparkIcon />
                {`Complete selected${deleteSelectedRequirementIds.length ? ` (${deleteSelectedRequirementIds.length})` : ""}`}
              </button>
            </div>

            {deleteSelectedRequirementIds.length ? (
              <div className="detail-summary requirement-selection-summary">
                <strong>{deleteSelectedRequirementIds.length} requirement{deleteSelectedRequirementIds.length === 1 ? "" : "s"} selected</strong>
                <span>Use the selection to complete requirements with AI or bulk delete. Open any tile to continue editing one requirement in a full-page workspace.</span>
              </div>
            ) : null}

            <TileBrowserPane className="requirement-card-list">
              {isRequirementCatalogLoading ? <TileCardSkeletonGrid /> : null}

              {!isRequirementCatalogLoading && filteredRequirements.length && catalogViewMode === "tile" ? (
                <div className="tile-browser-grid">
                  {filteredRequirements.map((item) => {
                    const isSelectedForDelete = deleteSelectedRequirementIds.includes(item.id);
                    const isActive = selectedRequirement?.id === item.id;
                    const linkedCaseCount = (linkedCaseIdsByRequirementId[item.id] || []).length;
                    const passCoverage = passCoverageByRequirementId[item.id] || { total: 0, covered: 0, percent: 0 };
                    const automationCoverage = automationCoverageByRequirementId[item.id] || { total: 0, covered: 0, percent: 0 };
                    const passCoverageTitle = passCoverage.total
                      ? `${passCoverage.covered}/${passCoverage.total} linked test cases passed`
                      : "No linked test cases to measure pass coverage";
                    const automationCoverageTitle = automationCoverage.total
                      ? `${automationCoverage.covered}/${automationCoverage.total} linked test cases automated`
                      : "No linked test cases to measure automation coverage";

                    return (
                      <button
                        key={item.id}
                        className={[
                          "record-card tile-card requirement-catalog-card",
                          isActive ? "is-active" : "",
                          isSelectedForDelete ? "is-marked-for-delete" : ""
                        ].filter(Boolean).join(" ")}
                        onClick={() => setSelectedRequirementId(item.id)}
                        type="button"
                      >
                        <div className="tile-card-main">
                          <div className="tile-card-select-row requirement-tile-top-row">
                            <label className="checkbox-field requirement-delete-checkbox" onClick={(event) => event.stopPropagation()}>
                              <input
                                checked={isSelectedForDelete}
                                onChange={(event) =>
                                  setDeleteSelectedRequirementIds((current) =>
                                    event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id)
                                  )
                                }
                                type="checkbox"
                              />
                              <DisplayIdBadge value={item.display_id || item.id} />
                            </label>
                          </div>
                          <div className="tile-card-header requirement-tile-header">
                            <div className="tile-card-title-group">
                              <strong>{item.title}</strong>
                            </div>
                          </div>
                          <div className="requirement-progress-stack">
                            <RequirementProgressBar detail={passCoverageTitle} label="Pass rate" metric={passCoverage} />
                            <RequirementProgressBar detail={automationCoverageTitle} label="Automation coverage" metric={automationCoverage} />
                          </div>
                          <div className="tile-card-facts" aria-label={`${item.title} facts`}>
                            <TileCardFact
                              label={`P${item.priority ?? 3}`}
                              title={`Priority P${item.priority ?? 3}`}
                              tone={(item.priority ?? 3) <= 2 ? "danger" : "info"}
                            >
                              <TileCardPriorityIcon />
                            </TileCardFact>
                            <TileCardFact
                              label={String(linkedCaseCount)}
                              title={`${linkedCaseCount} linked test case${linkedCaseCount === 1 ? "" : "s"}`}
                              tone={linkedCaseCount ? "success" : "neutral"}
                            >
                              <TileCardLinkIcon />
                            </TileCardFact>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {!isRequirementCatalogLoading && filteredRequirements.length && catalogViewMode === "list" ? (
                <DataTable
                  columns={requirementListColumns}
                  emptyMessage="No requirements match the current search."
                  getRowClassName={(item) => (selectedRequirement?.id === item.id ? "is-active-row" : "")}
                  getRowKey={(item) => item.id}
                  onRowClick={(item) => setSelectedRequirementId(item.id)}
                  rows={filteredRequirements}
                  storageKey="qaira:requirements:list-columns"
                />
              ) : null}
              {!isRequirementCatalogLoading && !requirements.length ? <div className="empty-state compact">No requirements yet for this project.</div> : null}
              {!isRequirementCatalogLoading && requirements.length && !filteredRequirements.length ? <div className="empty-state compact">No requirements match the current search.</div> : null}
            </TileBrowserPane>
          </Panel>
        )}
        detailView={(
          <Panel
            actions={(
              <div className="panel-head-actions-row">
                <WorkspaceBackButton label="Back to requirement tiles" onClick={closeRequirementDetail} />
                {selectedRequirement ? (
                  <button className="primary-button" disabled={!appTypeId} onClick={() => openNewTestCase(selectedRequirement)} type="button">
                    <AddIcon />
                    <span>New Test Case</span>
                  </button>
                ) : null}
              </div>
            )}
            title={selectedRequirement ? selectedRequirement.title : "Requirement details"}
            subtitle={selectedRequirement ? "Edit the requirement, manage reusable coverage links, and keep the selected item in focus." : "Select a requirement to review its details."}
          >
            {selectedRequirement ? (
              <div className="detail-stack">
                <div className="metric-strip compact">
                  <div className="mini-card">
                    <strong>{`${selectedRequirementPassCoverage.percent}%`}</strong>
                    <span>
                      {selectedRequirementPassCoverage.total
                        ? `Pass rate · ${selectedRequirementPassCoverage.covered}/${selectedRequirementPassCoverage.total} passed`
                        : "Pass rate"}
                    </span>
                  </div>
                  <div className="mini-card">
                    <strong>{`${selectedRequirementAutomationCoverage.percent}%`}</strong>
                    <span>
                      {selectedRequirementAutomationCoverage.total
                        ? `Automation coverage · ${selectedRequirementAutomationCoverage.covered}/${selectedRequirementAutomationCoverage.total} automated`
                        : "Automation coverage"}
                    </span>
                  </div>
                </div>
                <div className="requirement-accordion">
                  <RequirementAccordionSection
                    countLabel={`${selectedTestCaseIds.length} linked`}
                    isExpanded={expandedSections.details}
                    onToggle={() => setExpandedSections((current) => ({ ...current, details: !current.details }))}
                    summary="Review the requirement header details, update the draft, then save or delete from one focused section."
                    title="Requirement header details"
                  >
                    <form className="form-grid" onSubmit={(event) => void handleSaveRequirement(event)}>
                      <div className="record-grid">
                        <FormField label="Title" required>
                          <input required value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
                        </FormField>
                        <FormField label="Status">
                          <input value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))} />
                        </FormField>
                        <FormField label="Priority">
                          <input min="1" max="5" type="number" value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: Number(event.target.value) || 3 }))} />
                        </FormField>
                      </div>
                      <FormField label="Description">
                        <textarea rows={4} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
                      </FormField>
                      <FormField label="External references" hint="Ticket links or IDs, separated with commas.">
                        <input value={draft.externalReferencesText} onChange={(event) => setDraft((current) => ({ ...current, externalReferencesText: event.target.value }))} />
                      </FormField>

                      <div className="action-row">
                        <button
                          className="ghost-button"
                          disabled={previewRequirementOptimization.isPending}
                          onClick={() => {
                            setOptimizationSuggestion(null);
                            setPreviewMessage("");
                            setIsOptimizeModalOpen(true);
                          }}
                          type="button"
                        >
                          <SparkIcon />
                          AI complete
                        </button>
                        <button className="primary-button" disabled={updateRequirement.isPending || replaceMappings.isPending} type="submit">
                          {updateRequirement.isPending || replaceMappings.isPending ? "Saving…" : "Save requirement"}
                        </button>
                        <button className="ghost-button danger" disabled={deleteRequirement.isPending} onClick={() => void handleDeleteRequirement()} type="button">
                          Delete requirement
                        </button>
                      </div>
                    </form>
                  </RequirementAccordionSection>

                  <RequirementAccordionSection
                    countLabel={`${testCases.length} available`}
                    isExpanded={expandedSections.library}
                    onToggle={() => setExpandedSections((current) => ({ ...current, library: !current.library }))}
                    summary="Browse all reusable cases in the active app type and choose what should stay linked to this requirement."
                    title="Link or unlink existing test cases"
                  >
                    <RequirementTestCasePicker
                      compactTitlesOnly
                      emptyText={appTypeId ? "No reusable test cases are available for this app type." : "Select an app type first to link reusable test cases."}
                      onView={openTestCaseWorkspace}
                      pickerClassName="requirement-link-picker--workspace"
                      selectedIds={selectedTestCaseIds}
                      sortLinkedFirst
                      testCases={testCases}
                      onToggle={(testCaseId, checked) => toggleSelectedTestCase(setSelectedTestCaseIds, testCaseId, checked)}
                    />
                  </RequirementAccordionSection>
                </div>
              </div>
            ) : (
              <div className="empty-state compact">Select a requirement from the catalog to view and edit its details.</div>
            )}
          </Panel>
        )}
        isDetailOpen={Boolean(selectedRequirement)}
      />

      {isCreateModalOpen ? (
        <div className="modal-backdrop" onClick={closeCreateRequirementModal}>
          <div
            aria-labelledby="create-requirement-title"
            aria-modal="true"
            className="modal-card requirement-create-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="requirement-create-header">
              <div className="requirement-create-title">
                <p className="eyebrow">Requirements</p>
                <h3 id="create-requirement-title">Create requirement</h3>
                <p>Create the requirement in a focused modal, then link any reusable test cases that already exist for the selected app type.</p>
              </div>
              <button className="ghost-button" disabled={createRequirement.isPending || replaceMappings.isPending} onClick={closeCreateRequirementModal} type="button">
                Close
              </button>
            </div>

            <form className="requirement-create-modal-form" onSubmit={(event) => void handleCreateRequirement(event)}>
              <div className="requirement-create-modal-body">
                <div className="form-grid">
                  <FormField label="Title" inputId="create-requirement-title-input" required>
                    <input
                      autoFocus
                      id="create-requirement-title-input"
                      required
                      value={createDraft.title}
                      onChange={(event) => setCreateDraft((current) => ({ ...current, title: event.target.value }))}
                    />
                  </FormField>
                  <div className="record-grid">
                    <FormField label="Status">
                      <input
                        value={createDraft.status}
                        onChange={(event) => setCreateDraft((current) => ({ ...current, status: event.target.value }))}
                      />
                    </FormField>
                    <FormField label="Priority">
                      <input
                        min="1"
                        max="5"
                        type="number"
                        value={createDraft.priority}
                        onChange={(event) => setCreateDraft((current) => ({ ...current, priority: Number(event.target.value) || 3 }))}
                      />
                    </FormField>
                  </div>
                  <FormField label="Description" inputId="create-requirement-description-input">
                    <textarea
                      id="create-requirement-description-input"
                      rows={4}
                      value={createDraft.description}
                      onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))}
                    />
                  </FormField>
                  <FormField label="External references" hint="Ticket links or IDs, separated with commas.">
                    <input
                      value={createDraft.externalReferencesText}
                      onChange={(event) => setCreateDraft((current) => ({ ...current, externalReferencesText: event.target.value }))}
                    />
                  </FormField>
                </div>

                <div className="metric-strip compact">
                  <div className="mini-card">
                    <strong>{createSelectedTestCaseIds.length}</strong>
                    <span>Linked test cases</span>
                  </div>
                  <div className="mini-card">
                    <strong>{currentAppTypeName}</strong>
                    <span>Coverage source</span>
                  </div>
                </div>

                <section className="requirement-link-section">
                  <div className="panel-head">
                    <div>
                      <h3>Existing test cases</h3>
                      <p>{appTypeId ? `Select reusable cases from ${currentAppTypeName} to link immediately.` : "Select an app type first to link existing reusable test cases."}</p>
                    </div>
                    <div className="panel-head-actions">
                      <button
                        className="ghost-button"
                        disabled={!allReusableTestCaseIds.length || areAllCreateRequirementCasesSelected}
                        onClick={() => setCreateSelectedTestCaseIds(allReusableTestCaseIds)}
                        type="button"
                      >
                        Select all
                      </button>
                      <button
                        className="ghost-button"
                        disabled={!createSelectedTestCaseIds.length}
                        onClick={() => setCreateSelectedTestCaseIds([])}
                        type="button"
                      >
                        Clear selection
                      </button>
                    </div>
                  </div>

                  <RequirementTestCasePicker
                    compactTitlesOnly
                    emptyText={appTypeId ? "No reusable test cases are available for this app type." : "Select an app type first to link reusable test cases."}
                    onView={openTestCaseWorkspace}
                    selectedIds={createSelectedTestCaseIds}
                    testCases={testCases}
                    onToggle={(testCaseId, checked) => toggleSelectedTestCase(setCreateSelectedTestCaseIds, testCaseId, checked)}
                  />
                </section>
              </div>

              <div className="action-row requirement-create-modal-actions">
                <button className="ghost-button" disabled={createRequirement.isPending || replaceMappings.isPending} onClick={closeCreateRequirementModal} type="button">
                  Cancel
                </button>
                <button className="primary-button" disabled={createRequirement.isPending || replaceMappings.isPending} type="submit">
                  {createRequirement.isPending || replaceMappings.isPending ? "Creating…" : "Create requirement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isImportModalOpen ? (
        <div className="modal-backdrop" onClick={() => !bulkImportRequirements.isPending && setIsImportModalOpen(false)} role="presentation">
          <div
            aria-labelledby="bulk-requirement-import-title"
            aria-modal="true"
            className="modal-card import-modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="import-modal-header">
              <div className="import-modal-title">
                <p className="eyebrow">Bulk Import</p>
                <h3 id="bulk-requirement-import-title">Import requirements from CSV</h3>
                <p>
                  Upload many requirements at once. Use columns: <strong>title</strong> (required), plus optional{" "}
                  <strong>description</strong>, <strong>external_references</strong>, <strong>priority</strong> (1–5), and <strong>status</strong>.
                </p>
              </div>
              <button
                aria-label="Close bulk requirement import dialog"
                className="ghost-button"
                disabled={bulkImportRequirements.isPending}
                onClick={() => setIsImportModalOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="import-modal-body">
              <FormField label="CSV file">
                <input accept=".csv,text/csv" onChange={(event) => void handleRequirementImportFile(event)} type="file" />
              </FormField>

              <div className="metric-strip compact">
                <div className="mini-card">
                  <strong>{importRows.length}</strong>
                  <span>Rows ready</span>
                </div>
              </div>

              <div className="detail-summary">
                <strong>{importFileName || "No CSV loaded yet"}</strong>
                <span>Rows apply to the project selected in the workspace scope bar above.</span>
              </div>

              {importWarnings.length ? (
                <div className="empty-state compact">
                  {importWarnings.slice(0, 6).map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              ) : null}

              {importRows.length ? (
                <div className="table-wrap import-preview-table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>References</th>
                        <th>Priority</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 5).map((row, index) => (
                        <tr key={`${row.title}-${index}`}>
                          <td>{row.title}</td>
                          <td>{formatReferenceList(row.external_references) || "—"}</td>
                          <td>{row.priority ?? "—"}</td>
                          <td>{row.status || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            <div className="action-row import-modal-actions">
              <button
                className="primary-button"
                disabled={!projectId || !importRows.length || bulkImportRequirements.isPending}
                onClick={() => void handleBulkImportRequirements()}
                type="button"
              >
                {bulkImportRequirements.isPending ? "Queuing…" : `Queue ${importRows.length || ""} Requirements`}
              </button>
              <button
                className="ghost-button"
                disabled={!importRows.length || bulkImportRequirements.isPending}
                onClick={() => {
                  setImportRows([]);
                  setImportWarnings([]);
                  setImportFileName("");
                }}
                type="button"
              >
                Clear preview
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isOptimizeModalOpen && activeOptimizeRequirement ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!previewRequirementOptimization.isPending) {
              setIsOptimizeModalOpen(false);
              setOptimizeRequirementIds([]);
              setOptimizeRequirementIndex(0);
            }
          }}
          role="presentation"
        >
          <div
            aria-modal="true"
            className="modal-card requirement-create-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="requirement-create-header">
              <div className="requirement-create-title">
                <p className="eyebrow">AI Product Owner</p>
                <h3>Complete requirement</h3>
                <p>
                  {optimizeTargets.length > 1
                    ? `Reviewing ${optimizeRequirementIndex + 1} of ${optimizeTargets.length}: ${activeOptimizeRequirement.title}`
                    : "Generate a testable requirement upgrade, then accept all changes, decline, or apply only selected fields."}
                </p>
              </div>
              <button
                className="ghost-button"
                disabled={previewRequirementOptimization.isPending}
                onClick={() => {
                  setIsOptimizeModalOpen(false);
                  setOptimizeRequirementIds([]);
                  setOptimizeRequirementIndex(0);
                }}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="requirement-create-modal-body">
              <div className="record-grid">
                <FormField label="LLM integration">
                  <select value={integrationId} onChange={(event) => setIntegrationId(event.target.value)}>
                    <option value="">Use active local/project LLM</option>
                    {integrations.map((integration) => (
                      <option key={integration.id} value={integration.id}>
                        {integration.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Product guidance">
                  <textarea
                    rows={4}
                    value={optimizeContext}
                    onChange={(event) => setOptimizeContext(event.target.value)}
                    placeholder="Mention business rules, missing acceptance criteria, compliance expectations, or local domain language."
                  />
                </FormField>
              </div>

              <div className="action-row">
                <button className="primary-button" disabled={previewRequirementOptimization.isPending} onClick={() => void handlePreviewRequirementOptimization()} type="button">
                  <SparkIcon />
                  {previewRequirementOptimization.isPending ? "Thinking…" : "Suggest improvements"}
                </button>
              </div>

              {previewMessage ? <ToastMessage message={previewMessage} onDismiss={() => setPreviewMessage("")} tone={previewTone} /> : null}

              {optimizationSuggestion ? (
                <div className="ai-requirement-review">
                  {([
                    ["title", "Title", optimizationSuggestion.title],
                    ["description", "Description", optimizationSuggestion.description],
                    ["external_references", "References", formatReferenceList(optimizationSuggestion.external_references)],
                    ["priority", "Priority", `P${optimizationSuggestion.priority}`],
                    ["status", "Status", optimizationSuggestion.status]
                  ] as Array<[keyof typeof optimizationFields, string, string]>).map(([key, label, value]) => (
                    <label className="ai-requirement-review-row" key={key}>
                      <input
                        checked={optimizationFields[key]}
                        onChange={(event) => setOptimizationFields((current) => ({ ...current, [key]: event.target.checked }))}
                        type="checkbox"
                      />
                      <span>
                        <strong>{label}</strong>
                        <small>{value || "No suggestion"}</small>
                      </span>
                    </label>
                  ))}

                  <div className="detail-summary">
                    <strong>Change summary</strong>
                    <span>{optimizationSuggestion.change_summary.join(" ") || "No summary returned."}</span>
                  </div>
                  <div className="detail-summary">
                    <strong>Acceptance criteria</strong>
                    <span>{optimizationSuggestion.acceptance_criteria.join(" ") || "No acceptance criteria returned."}</span>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="action-row requirement-create-modal-actions">
              <button
                className="ghost-button"
                onClick={() => {
                  setIsOptimizeModalOpen(false);
                  setOptimizeRequirementIds([]);
                  setOptimizeRequirementIndex(0);
                }}
                type="button"
              >
                Decline
              </button>
              {optimizeTargets.length > 1 && optimizeRequirementIndex + 1 < optimizeTargets.length ? (
                <button
                  className="ghost-button"
                  disabled={previewRequirementOptimization.isPending || updateRequirement.isPending}
                  onClick={() => {
                    setOptimizationSuggestion(null);
                    setPreviewMessage("");
                    setOptimizeRequirementIndex((current) => current + 1);
                  }}
                  type="button"
                >
                  Skip current
                </button>
              ) : null}
              <button className="ghost-button" disabled={!optimizationSuggestion} onClick={() => setOptimizationFields({ title: false, description: false, external_references: false, priority: false, status: false })} type="button">
                Clear fields
              </button>
              <button className="primary-button" disabled={!optimizationSuggestion || updateRequirement.isPending} onClick={() => void handleApplyRequirementOptimization()} type="button">
                {updateRequirement.isPending ? "Applying…" : "Apply selected"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAiStudioOpen ? (
        <AiDesignStudioModal
          acceptLabel="Accept And Move To Test Cases"
          additionalContext={aiAdditionalContext}
          allowMultipleRequirements={false}
          appTypeName={currentAppTypeName}
          closeDisabled={previewDesignedCases.isPending || acceptDesignedCases.isPending}
          disableAccept={!previewCases.length || acceptDesignedCases.isPending}
          disablePreview={!aiRequirement || !appTypeId || previewDesignedCases.isPending || !integrations.length}
          dialogClassName="ai-design-modal--requirements"
          existingCases={associatedCases}
          existingCasesSubtitle="These are already associated with the selected requirement in the current app type."
          existingCasesTitle="Linked test cases"
          externalLinksText={aiExternalLinksText}
          eyebrow="Requirements"
          integrationId={integrationId}
          integrations={integrations}
          isAccepting={acceptDesignedCases.isPending}
          isPreviewing={previewDesignedCases.isPending}
          maxCases={maxCases}
          onAccept={() => void handleAcceptDesignedCases()}
          onAddImages={(files) => void handleAddAiReferenceImages(files)}
          onAdditionalContextChange={setAiAdditionalContext}
          onClose={() => {
            setIsAiStudioOpen(false);
            setPreviewCases([]);
            setPreviewMessage("");
          }}
          onExternalLinksTextChange={setAiExternalLinksText}
          onIntegrationIdChange={setIntegrationId}
          onViewExistingCase={openTestCaseWorkspace}
          onPreview={() => void handlePreviewDesignedCases()}
          onRemoveImage={(imageUrl) => setAiReferenceImages((current) => current.filter((image) => image.url !== imageUrl))}
          onRemovePreviewCase={(clientId) => setPreviewCases((current) => current.filter((candidate) => candidate.client_id !== clientId))}
          onRequirementSelectionChange={(requirementIds) => setAiRequirementId(requirementIds[0] || "")}
          onMaxCasesChange={setMaxCases}
          previewCases={previewCases}
          previewMessage={previewMessage}
          onPreviewMessageDismiss={() => setPreviewMessage("")}
          previewTone={previewTone}
          referenceImages={aiReferenceImages}
          requirementHelpText="Select the requirement, shape the prompt, then review the AI-generated reusable cases before approving them."
          requirementLabel="Requirement"
          requirements={requirements}
          selectedRequirementIds={aiRequirement?.id ? [aiRequirement.id] : []}
        />
      ) : null}

      {linkedPreviewCase ? (
        <LinkedTestCaseModal
          appTypeName={currentAppTypeName}
          projectName={projects.find((project) => String(project.id) === String(projectId))?.name || ""}
          requirements={requirements}
          suites={suites}
          testCase={linkedPreviewCase}
          onClose={() => setLinkedPreviewCaseId("")}
        />
      ) : null}
    </div>
  );
}

function RequirementTestCasePicker({
  testCases,
  selectedIds,
  onToggle,
  emptyText,
  pickerClassName,
  onView,
  sortLinkedFirst = false,
  compactTitlesOnly = false
}: {
  testCases: TestCase[];
  selectedIds: string[];
  onToggle: (testCaseId: string, checked: boolean) => void;
  emptyText: string;
  pickerClassName?: string;
  onView?: (testCaseId: string) => void;
  sortLinkedFirst?: boolean;
  compactTitlesOnly?: boolean;
}) {
  if (!testCases.length) {
    return <div className="empty-state compact">{emptyText}</div>;
  }

  const orderedTestCases = sortLinkedFirst
    ? [...testCases].sort((left, right) => {
        const leftLinked = selectedIds.includes(left.id);
        const rightLinked = selectedIds.includes(right.id);

        if (leftLinked !== rightLinked) {
          return leftLinked ? -1 : 1;
        }

        return left.title.localeCompare(right.title);
      })
    : testCases;

  return (
    <div className={pickerClassName ? `modal-case-picker requirement-link-picker ${pickerClassName}` : "modal-case-picker requirement-link-picker"}>
      {orderedTestCases.map((testCase) => {
        const isLinked = selectedIds.includes(testCase.id);

        return (
          <div
            className={[
              "modal-case-option requirement-link-option",
              isLinked ? "is-linked" : "",
              compactTitlesOnly ? "is-compact" : ""
            ].filter(Boolean).join(" ")}
            key={testCase.id}
          >
            <div className="requirement-link-option-copy">
              <strong>{testCase.title}</strong>
              {!compactTitlesOnly ? <span>{testCase.description || "No description available."}</span> : null}
              {!compactTitlesOnly ? (
                <span className="requirement-link-option-meta">
                  Priority P{testCase.priority ?? 3} · {testCase.status || "draft"}
                </span>
              ) : null}
            </div>
            <div className="requirement-link-actions">
              {onView ? (
                <button
                  aria-label={`View ${testCase.title}`}
                  className="ghost-button requirement-link-icon-button requirement-link-view-button"
                  onClick={() => onView(testCase.id)}
                  title="View test case"
                  type="button"
                >
                  <RequirementViewIcon />
                </button>
              ) : null}
              <button
                aria-label={isLinked ? `Unlink ${testCase.title}` : `Link ${testCase.title}`}
                className={[
                  "ghost-button requirement-link-toggle",
                  isLinked ? "is-linked" : "",
                  compactTitlesOnly ? "requirement-link-toggle--icon-only" : ""
                ].filter(Boolean).join(" ")}
                onClick={() => onToggle(testCase.id, !isLinked)}
                title={isLinked ? "Unlink test case" : "Link test case"}
                type="button"
              >
                {isLinked ? <RequirementUnlinkIcon /> : <RequirementLinkIcon />}
                {!compactTitlesOnly ? <span>{isLinked ? "Unlink" : "Link"}</span> : null}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RequirementLinkIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
      <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.8 5.12" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 1 0 7.07 7.07L13.2 18.9" />
    </svg>
  );
}

function RequirementUnlinkIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
      <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.8 5.12" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 1 0 7.07 7.07L13.2 18.9" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

function RequirementViewIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function RequirementAccordionSection({
  title,
  summary,
  countLabel,
  isExpanded,
  onToggle,
  children
}: {
  title: string;
  summary: string;
  countLabel: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={isExpanded ? "requirement-accordion-section is-expanded" : "requirement-accordion-section"}>
      <button
        aria-expanded={isExpanded}
        className="requirement-accordion-toggle"
        onClick={onToggle}
        type="button"
      >
        <div className="requirement-accordion-toggle-main">
          <span aria-hidden="true" className={isExpanded ? "requirement-accordion-icon is-expanded" : "requirement-accordion-icon"}>
            <RequirementAccordionChevronIcon />
          </span>
          <div className="requirement-accordion-toggle-copy">
            <strong>{title}</strong>
            <span>{summary}</span>
          </div>
        </div>
        <div className="requirement-accordion-toggle-meta">
          <span className="requirement-accordion-toggle-count">{countLabel}</span>
          <span className="requirement-accordion-toggle-state">{isExpanded ? "Collapse" : "Expand"}</span>
        </div>
      </button>
      {isExpanded ? <div className="requirement-accordion-body">{children}</div> : null}
    </section>
  );
}

function RequirementAccordionChevronIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
