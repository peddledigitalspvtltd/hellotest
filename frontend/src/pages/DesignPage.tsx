import { DragEvent, FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AddIcon, LayersIcon } from "../components/AppIcons";
import { CatalogViewToggle } from "../components/CatalogViewToggle";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { DisplayIdBadge } from "../components/DisplayIdBadge";
import { FormField } from "../components/FormField";
import { ExecutionContextSelector } from "../components/ExecutionContextSelector";
import { LinkedTestCaseModal } from "../components/LinkedTestCaseModal";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StepParameterDialog } from "../components/StepParameterDialog";
import { SharedGroupLevelIcon } from "../components/StepAutomationEditor";
import { StatusBadge } from "../components/StatusBadge";
import {
  TileCardCaseIcon,
  TileCardFact,
  TileCardIconFrame,
  TileCardLinkIcon,
  TileCardPriorityIcon,
  TileCardRunsIcon,
  TileCardStatusIndicator,
  TileCardStepsIcon,
  formatTileCardLabel,
  getTileCardTone
} from "../components/TileCardPrimitives";
import { SuiteCasePicker, SuiteScopePicker } from "../components/SuiteCasePicker";
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
import {
  collectStepParameters,
  filterStepParameterValues,
  filterStepParameterValuesByScope,
  normalizeStepParameterValues,
  parseStepParameterName,
  type StepParameterDefinition
} from "../lib/stepParameters";
import { type AssigneeOption, buildAssigneeOptions } from "../lib/userDisplay";
import { TEST_AUTHORING_SECTION_ITEMS } from "../lib/workspaceSections";
import type { AppType, ExecutionResult, Project, ProjectMember, Requirement, TestCase, TestStep, TestSuite, User } from "../types";

type CaseDraft = {
  suite_id: string;
  title: string;
  description: string;
  automated: "yes" | "no";
  priority: string;
  status: string;
  requirement_id: string;
};

type StepDraft = {
  action: string;
  expected_result: string;
};

type DraftTestStep = {
  id: string;
  action: string;
  expected_result: string;
  group_id: string | null;
  group_name: string | null;
  group_kind: "local" | "reusable" | null;
  reusable_group_id: string | null;
};

type SuiteCaseEditorSectionKey = "case" | "steps" | "history";

type SuiteModalMode = "create" | "edit";
type SuitePlacementFilter = "all" | "root" | "nested";
type SuiteMappedCasesFilter = "all" | "with-cases" | "empty";
type SuiteChildrenFilter = "all" | "with-children" | "no-children";
type SuiteCaseStepFilter = "all" | "with-steps" | "no-steps";
type SuiteCaseRunFilter = "all" | "with-runs" | "no-runs";
type SuiteExecutionAssigneeOption = AssigneeOption;

const DEFAULT_CASE_STATUS = "active";
const createEmptyCaseDraft = (defaultStatus = DEFAULT_CASE_STATUS, defaultAutomated: "yes" | "no" = "no"): CaseDraft => ({
  suite_id: "",
  title: "",
  description: "",
  automated: defaultAutomated,
  priority: "3",
  status: defaultStatus,
  requirement_id: ""
});
const EMPTY_STEP_DRAFT = {
  action: "",
  expected_result: ""
};

const normalizeSuiteParameterValues = (values?: Record<string, unknown> | null) =>
  normalizeStepParameterValues((values || {}) as Record<string, string>, "s");

const serializeSuiteParameterValues = (values?: Record<string, unknown> | null) =>
  JSON.stringify(
    Object.entries(normalizeSuiteParameterValues(values))
      .sort(([left], [right]) => left.localeCompare(right))
  );

const areSuiteParameterValuesEqual = (
  left?: Record<string, unknown> | null,
  right?: Record<string, unknown> | null
) => serializeSuiteParameterValues(left) === serializeSuiteParameterValues(right);

const aggregateExecutionResultStatus = (
  current: ExecutionResult["status"] | undefined,
  next: ExecutionResult["status"]
): ExecutionResult["status"] => {
  if (current === "failed" || next === "failed") {
    return "failed";
  }

  if (current === "blocked" || next === "blocked") {
    return "blocked";
  }

  return "passed";
};

const createDefaultSuiteCaseSections = (): Record<SuiteCaseEditorSectionKey, boolean> => ({
  case: true,
  steps: true,
  history: false
});

const createDraftStepId = () =>
  globalThis.crypto?.randomUUID?.() || `suite-draft-step-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const normalizeDraftSteps = (steps: DraftTestStep[]) =>
  steps
    .map((step, index) => ({
      step_order: index + 1,
      action: step.action.trim(),
      expected_result: step.expected_result.trim(),
      group_id: step.group_id || undefined,
      group_name: step.group_name || undefined,
      group_kind: step.group_kind || undefined,
      reusable_group_id: step.reusable_group_id || undefined
    }))
    .filter((step) => step.action || step.expected_result);

const getSuiteStepKindMeta = (kind?: TestStep["group_kind"] | null) => {
  if (kind === "reusable") {
    return { label: "Shared Steps", tone: "shared" as const };
  }

  if (kind === "local") {
    return { label: "Local group step", tone: "local" as const };
  }

  return { label: "Standard step", tone: "default" as const };
};

function ExecutionStepsIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16">
      <path d="M8 7h10" />
      <path d="M8 12h10" />
      <path d="M8 17h10" />
      <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function StepKindIconBadge({
  kind,
  label,
  tone
}: {
  kind?: TestStep["group_kind"] | null;
  label: string;
  tone: "default" | "shared" | "local";
}) {
  const icon =
    tone === "shared"
      ? <SharedGroupLevelIcon kind="reusable" />
      : tone === "local"
        ? <SharedGroupLevelIcon kind="local" />
        : <ExecutionStepsIcon />;

  return (
    <span
      aria-label={kind === "reusable" ? "Shared Steps" : label}
      className={["step-kind-badge", tone === "default" ? "" : `is-${tone}`].filter(Boolean).join(" ")}
      title={kind === "reusable" ? "Shared Steps" : label}
    >
      {icon}
    </span>
  );
}

export function DesignPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const domainMetadataQuery = useDomainMetadata();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const [selectedSuiteId, setSelectedSuiteId] = useState("");
  const [selectedSuiteActionIds, setSelectedSuiteActionIds] = useState<string[]>([]);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState("");
  const [suiteSearchTerm, setSuiteSearchTerm] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [suiteCatalogViewMode, setSuiteCatalogViewMode] = useState<"tile" | "list">("tile");
  const [suiteCaseCatalogViewMode, setSuiteCaseCatalogViewMode] = useState<"tile" | "list">("tile");
  const [statusFilter, setStatusFilter] = useState("all");
  const [suitePlacementFilter, setSuitePlacementFilter] = useState<SuitePlacementFilter>("all");
  const [suiteMappedCasesFilter, setSuiteMappedCasesFilter] = useState<SuiteMappedCasesFilter>("all");
  const [suiteChildrenFilter, setSuiteChildrenFilter] = useState<SuiteChildrenFilter>("all");
  const [casePriorityFilter, setCasePriorityFilter] = useState("all");
  const [caseStepFilter, setCaseStepFilter] = useState<SuiteCaseStepFilter>("all");
  const [caseRunFilter, setCaseRunFilter] = useState<SuiteCaseRunFilter>("all");
  const [isCreatingCase, setIsCreatingCase] = useState(false);
  const [isTestCaseEditorModalOpen, setIsTestCaseEditorModalOpen] = useState(false);
  const [isCreateExecutionModalOpen, setIsCreateExecutionModalOpen] = useState(false);
  const [executionName, setExecutionName] = useState("");
  const [selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId] = useState("");
  const [selectedExecutionConfigurationId, setSelectedExecutionConfigurationId] = useState("");
  const [selectedExecutionDataSetId, setSelectedExecutionDataSetId] = useState("");
  const [selectedExecutionAssigneeId, setSelectedExecutionAssigneeId] = useState("");
  const [suiteModalMode, setSuiteModalMode] = useState<SuiteModalMode>("create");
  const [isSuiteModalOpen, setIsSuiteModalOpen] = useState(false);
  const [isSuiteParameterDialogOpen, setIsSuiteParameterDialogOpen] = useState(false);
  const [suiteParameterValues, setSuiteParameterValues] = useState<Record<string, string>>({});
  const [expandedSections, setExpandedSections] = useState<Record<SuiteCaseEditorSectionKey, boolean>>(createDefaultSuiteCaseSections);
  const [expandedStepIds, setExpandedStepIds] = useState<string[]>([]);
  const [isDeletingSelectedSuites, setIsDeletingSelectedSuites] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const defaultCaseStatus = domainMetadataQuery.data?.test_cases.default_status || DEFAULT_CASE_STATUS;
  const defaultCaseAutomated = (domainMetadataQuery.data?.test_cases.default_automated || "no") as "yes" | "no";
  const testCaseStatusOptions = domainMetadataQuery.data?.test_cases.statuses || [];
  const testCaseAutomatedOptions = domainMetadataQuery.data?.test_cases.automated_options || [
    { value: "no", label: "No" },
    { value: "yes", label: "Yes" }
  ];
  const emptyCaseDraft = useMemo(
    () => createEmptyCaseDraft(defaultCaseStatus, defaultCaseAutomated),
    [defaultCaseAutomated, defaultCaseStatus]
  );

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list
  });
  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: api.users.list,
    enabled: Boolean(session)
  });
  const projectMembersQuery = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => api.projectMembers.list({ project_id: projectId }),
    enabled: Boolean(projectId && session)
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
  const suitesQuery = useQuery({
    queryKey: ["design-suites", appTypeId],
    queryFn: () => api.testSuites.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const testCasesQuery = useQuery({
    queryKey: ["design-test-cases", appTypeId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const executionResultsQuery = useQuery({
    queryKey: ["design-case-results", appTypeId],
    queryFn: () => api.executionResults.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const allTestStepsQuery = useQuery({
    queryKey: ["design-all-test-steps", appTypeId],
    queryFn: () => api.testSteps.list(),
    enabled: Boolean(appTypeId)
  });
  const sharedGroupsQuery = useQuery({
    queryKey: ["design-shared-step-groups", appTypeId],
    queryFn: () => api.sharedStepGroups.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const suiteMappingsQuery = useQuery({
    queryKey: ["suite-test-case-mappings", selectedSuiteId],
    queryFn: () => api.suiteTestCases.list({ suite_id: selectedSuiteId }),
    enabled: Boolean(selectedSuiteId)
  });
  const stepsQuery = useQuery({
    queryKey: ["design-test-steps", selectedTestCaseId],
    queryFn: () => api.testSteps.list({ test_case_id: selectedTestCaseId }),
    enabled: Boolean(selectedTestCaseId) && !isCreatingCase
  });

  const createSuiteMutation = useMutation({ mutationFn: api.testSuites.create });
  const updateSuiteMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<{ name: string; parent_id: string; parameter_values: Record<string, string> }> }) =>
      api.testSuites.update(id, input)
  });
  const assignSuiteCasesMutation = useMutation({
    mutationFn: ({ id, testCaseIds }: { id: string; testCaseIds: string[] }) => api.testSuites.assignTestCases(id, testCaseIds)
  });
  const reorderSuiteCasesMutation = useMutation({
    mutationFn: ({ suiteId, testCaseIds }: { suiteId: string; testCaseIds: string[] }) =>
      api.suiteTestCases.reorder(suiteId, testCaseIds)
  });
  const createTestCaseMutation = useMutation({ mutationFn: api.testCases.create });
  const updateTestCaseMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<{ app_type_id: string; suite_id: string; suite_ids: string[]; title: string; description: string; automated: "yes" | "no"; priority: number; status: string; requirement_id: string }> }) =>
      api.testCases.update(id, input)
  });
  const deleteTestCaseMutation = useMutation({ mutationFn: api.testCases.delete });
  const createStepMutation = useMutation({ mutationFn: api.testSteps.create });
  const updateStepMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<{ test_case_id: string; step_order: number; action: string; expected_result: string; group_id: string | null; group_name: string | null; group_kind: "local" | "reusable" | null; reusable_group_id: string | null }> }) =>
      api.testSteps.update(id, input)
  });
  const reorderStepsMutation = useMutation({
    mutationFn: ({ testCaseId, stepIds }: { testCaseId: string; stepIds: string[] }) =>
      api.testSteps.reorder(testCaseId, stepIds)
  });
  const deleteStepMutation = useMutation({ mutationFn: api.testSteps.delete });
  const createExecutionMutation = useMutation({ mutationFn: api.executions.create });

  const projects = projectsQuery.data || [];
  const users = (usersQuery.data || []) as User[];
  const projectMembers = (projectMembersQuery.data || []) as ProjectMember[];
  const appTypes = appTypesQuery.data || [];
  const requirements = requirementsQuery.data || [];
  const suites = suitesQuery.data || [];
  const allTestCases = testCasesQuery.data || [];
  const executionResults = executionResultsQuery.data || [];
  const allTestSteps = allTestStepsQuery.data || [];
  const suiteMappings = suiteMappingsQuery.data || [];
  const steps = stepsQuery.data || [];
  const assigneeOptions = useMemo<SuiteExecutionAssigneeOption[]>(
    () => buildAssigneeOptions(projectMembers, users),
    [projectMembers, users]
  );

  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  const openCreateSuiteModal = () => {
    setSuiteModalMode("create");
    setIsSuiteModalOpen(true);
  };

  const resetExecutionContextSelection = () => {
    setSelectedExecutionEnvironmentId("");
    setSelectedExecutionConfigurationId("");
    setSelectedExecutionDataSetId("");
  };

  const closeCreateExecutionModal = () => {
    setIsCreateExecutionModalOpen(false);
    setExecutionName("");
    setSelectedExecutionAssigneeId("");
    resetExecutionContextSelection();
  };

  const [caseDraft, setCaseDraft] = useState<CaseDraft>(() => createEmptyCaseDraft());
  const [newStepDraft, setNewStepDraft] = useState(EMPTY_STEP_DRAFT);
  const [isStepCreateVisible, setIsStepCreateVisible] = useState(false);
  const [draftSteps, setDraftSteps] = useState<DraftTestStep[]>([]);
  const [stepDrafts, setStepDrafts] = useState<Record<string, StepDraft>>({});

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
    if (usersQuery.isPending || projectMembersQuery.isPending) {
      return;
    }

    if (selectedExecutionAssigneeId && !assigneeOptions.some((option) => option.id === selectedExecutionAssigneeId)) {
      setSelectedExecutionAssigneeId("");
    }
  }, [assigneeOptions, projectMembersQuery.isPending, selectedExecutionAssigneeId, usersQuery.isPending]);

  const appTypeCases = useMemo(() => allTestCases, [allTestCases]);

  const suiteCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    appTypeCases.forEach((testCase) => {
      (testCase.suite_ids || []).forEach((suiteId) => {
        counts[suiteId] = (counts[suiteId] || 0) + 1;
      });
    });

    return counts;
  }, [appTypeCases]);
  const childSuiteCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    suites.forEach((suite) => {
      if (suite.parent_id) {
        counts[suite.parent_id] = (counts[suite.parent_id] || 0) + 1;
      }
    });

    return counts;
  }, [suites]);
  const requirementTitleById = useMemo(
    () =>
      requirements.reduce<Record<string, string>>((map, requirement) => {
        map[requirement.id] = requirement.title;
        return map;
      }, {}),
    [requirements]
  );
  const filteredSuites = useMemo(() => {
    const normalizedSearch = suiteSearchTerm.trim().toLowerCase();

    return suites.filter((suite) => {
      const mappedCaseCount = suiteCounts[suite.id] || 0;
      const childSuiteCount = childSuiteCounts[suite.id] || 0;
      const haystack = `${suite.name} ${suite.parent_id ? "nested" : "root"}`.toLowerCase();
      const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);

      if (!matchesSearch) {
        return false;
      }

      if (suitePlacementFilter === "root" && suite.parent_id) {
        return false;
      }

      if (suitePlacementFilter === "nested" && !suite.parent_id) {
        return false;
      }

      if (suiteMappedCasesFilter === "with-cases" && !mappedCaseCount) {
        return false;
      }

      if (suiteMappedCasesFilter === "empty" && mappedCaseCount) {
        return false;
      }

      if (suiteChildrenFilter === "with-children" && !childSuiteCount) {
        return false;
      }

      if (suiteChildrenFilter === "no-children" && childSuiteCount) {
        return false;
      }

      return true;
    });
  }, [childSuiteCounts, suiteChildrenFilter, suiteMappedCasesFilter, suitePlacementFilter, suiteCounts, suiteSearchTerm, suites]);

  const orderedSuiteCases = useMemo(() => {
    if (!selectedSuiteId) {
      return [];
    }

    const suiteOrder = new Map(suiteMappings.map((mapping) => [mapping.test_case_id, mapping.sort_order]));

    return appTypeCases
      .filter((testCase) => (testCase.suite_ids || []).includes(selectedSuiteId))
      .slice()
      .sort((left, right) => {
        const leftOrder = suiteOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = suiteOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        return left.title.localeCompare(right.title);
      });
  }, [appTypeCases, selectedSuiteId, suiteMappings]);

  const selectedProject = projects.find((project) => String(project.id) === String(projectId)) || null;
  const selectedAppType = appTypes.find((appType) => appType.id === appTypeId) || null;
  const sharedGroups = sharedGroupsQuery.data || [];
  const authoringSectionItems = useMemo(
    () =>
      TEST_AUTHORING_SECTION_ITEMS.map((item) => ({
        ...item,
        meta:
          item.to === "/requirements"
            ? String(requirements.length)
            : item.to === "/test-cases"
              ? String(appTypeCases.length)
              : item.to === "/shared-steps"
                ? String(sharedGroups.length)
                : item.to === "/design"
                  ? String(suites.length)
                  : undefined
      })),
    [appTypeCases.length, requirements.length, sharedGroups.length, suites.length]
  );
  const selectedSuite = suites.find((suite) => suite.id === selectedSuiteId) || null;
  const selectedTestCase = appTypeCases.find((testCase) => testCase.id === selectedTestCaseId) || null;
  const selectedSuiteCaseIdSet = useMemo(
    () => new Set(orderedSuiteCases.map((testCase) => testCase.id)),
    [orderedSuiteCases]
  );
  const selectedSuiteParameterDefinitions = useMemo<StepParameterDefinition[]>(() => {
    const parameterMap = new Map<string, StepParameterDefinition>();

    collectStepParameters(
      allTestSteps
        .filter((step) => selectedSuiteCaseIdSet.has(step.test_case_id))
        .map((step) => ({
          id: step.id,
          action: step.action,
          expected_result: step.expected_result,
          automation_code: step.automation_code,
          api_request: step.api_request
        }))
    )
      .filter((parameter) => parameter.scope === "s")
      .forEach((parameter) => {
        parameterMap.set(parameter.name, parameter);
      });

    Object.keys(normalizeSuiteParameterValues(selectedSuite?.parameter_values)).forEach((name) => {
      const parsed = parseStepParameterName(name, "s");

      if (!parsed || parameterMap.has(parsed.name)) {
        return;
      }

      parameterMap.set(parsed.name, {
        name: parsed.name,
        rawName: parsed.rawName,
        label: parsed.rawName,
        token: parsed.token,
        scope: parsed.scope,
        scopeLabel: parsed.scopeLabel,
        stepIds: [],
        occurrenceCount: 0
      });
    });

    return [...parameterMap.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [allTestSteps, selectedSuite?.parameter_values, selectedSuiteCaseIdSet]);
  const sortedSteps = useMemo(
    () => [...steps].sort((left, right) => left.step_order - right.step_order),
    [steps]
  );
  const displaySteps = useMemo(
    () =>
      isCreatingCase
        ? draftSteps.map((step, index) => ({
            id: step.id,
            test_case_id: selectedTestCaseId || "draft",
            step_order: index + 1,
            action: step.action,
            expected_result: step.expected_result,
            group_id: step.group_id,
            group_name: step.group_name,
            group_kind: step.group_kind,
            reusable_group_id: step.reusable_group_id
          }))
        : sortedSteps,
    [draftSteps, isCreatingCase, selectedTestCaseId, sortedSteps]
  );
  const historyByCaseId = useMemo(() => {
    const map: Record<string, ExecutionResult[]> = {};

    executionResults.forEach((result) => {
      map[result.test_case_id] = map[result.test_case_id] || [];
      map[result.test_case_id].push(result);
    });

    Object.values(map).forEach((items) => {
      items.sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
    });

    return map;
  }, [executionResults]);
  const historyBySuiteId = useMemo(() => {
    const map: Record<string, Record<string, { execution_id: string; status: ExecutionResult["status"]; created_at?: string }>> = {};

    executionResults.forEach((result) => {
      if (!result.suite_id) {
        return;
      }

      map[result.suite_id] = map[result.suite_id] || {};
      const current = map[result.suite_id][result.execution_id];

      map[result.suite_id][result.execution_id] = {
        execution_id: result.execution_id,
        status: aggregateExecutionResultStatus(current?.status, result.status),
        created_at:
          String(result.created_at || "") > String(current?.created_at || "")
            ? result.created_at
            : current?.created_at || result.created_at
      };
    });

    return Object.fromEntries(
      Object.entries(map).map(([suiteId, resultsByExecution]) => [
        suiteId,
        Object.values(resultsByExecution).sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
      ])
    ) as Record<string, Array<{ execution_id: string; status: ExecutionResult["status"]; created_at?: string }>>;
  }, [executionResults]);
  const stepCountByCaseId = useMemo(() => {
    const scopedCaseIds = new Set(appTypeCases.map((testCase) => testCase.id));
    const counts: Record<string, number> = {};

    allTestSteps.forEach((step) => {
      if (!scopedCaseIds.has(step.test_case_id)) {
        return;
      }

      counts[step.test_case_id] = (counts[step.test_case_id] || 0) + 1;
    });

    return counts;
  }, [allTestSteps, appTypeCases]);
  const caseStatusOptions = useMemo(
    () =>
      Array.from(
        new Set(
          appTypeCases.map((testCase) => {
            const history = historyByCaseId[testCase.id] || [];
            return history[0]?.status || testCase.status || defaultCaseStatus;
          })
        )
      ).sort((left, right) => left.localeCompare(right)),
    [appTypeCases, historyByCaseId]
  );
  const casePriorityOptions = useMemo(
    () => Array.from(new Set(appTypeCases.map((testCase) => String(testCase.priority || 3)))).sort((left, right) => Number(left) - Number(right)),
    [appTypeCases]
  );
  const filteredCases = useMemo(() => {
    const suiteOrder = new Map(suiteMappings.map((mapping) => [mapping.test_case_id, mapping.sort_order]));
    const sourceCases = selectedSuiteId
      ? appTypeCases
          .filter((testCase) => (testCase.suite_ids || []).includes(selectedSuiteId))
          .slice()
          .sort((left, right) => {
            const leftOrder = suiteOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
            const rightOrder = suiteOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

            if (leftOrder !== rightOrder) {
              return leftOrder - rightOrder;
            }

            return left.title.localeCompare(right.title);
          })
      : appTypeCases;

    const normalizedSearch = searchTerm.trim().toLowerCase();

    return sourceCases.filter((testCase) => {
      if (selectedSuiteId && !(testCase.suite_ids || []).includes(selectedSuiteId)) {
        return false;
      }

      const requirementTitle =
        (testCase.requirement_ids || [testCase.requirement_id]).map((id) => (id ? requirementTitleById[id] || "" : "")).find(Boolean) || "";
      const history = historyByCaseId[testCase.id] || [];
      const latest = history[0];
      const caseStatusValue = latest?.status || testCase.status || defaultCaseStatus;
      const stepCount = stepCountByCaseId[testCase.id] || 0;
      const runCount = history.length;
      const matchesSearch =
        !normalizedSearch ||
        `${testCase.title} ${testCase.description || ""} ${requirementTitle}`.toLowerCase().includes(normalizedSearch);

      if (!matchesSearch) {
        return false;
      }

      if (statusFilter !== "all" && caseStatusValue !== statusFilter) {
        return false;
      }

      if (casePriorityFilter !== "all" && String(testCase.priority || 3) !== casePriorityFilter) {
        return false;
      }

      if (caseStepFilter === "with-steps" && !stepCount) {
        return false;
      }

      if (caseStepFilter === "no-steps" && stepCount) {
        return false;
      }

      if (caseRunFilter === "with-runs" && !runCount) {
        return false;
      }

      if (caseRunFilter === "no-runs" && runCount) {
        return false;
      }

      return true;
    });
  }, [
    appTypeCases,
    casePriorityFilter,
    caseRunFilter,
    caseStepFilter,
    historyByCaseId,
    requirementTitleById,
    searchTerm,
    selectedSuiteId,
    statusFilter,
    stepCountByCaseId,
    suiteMappings
  ]);
  const selectedHistory = selectedTestCase ? historyByCaseId[selectedTestCase.id] || [] : [];
  const executionTargetSuiteIds = useMemo(
    () => selectedSuiteActionIds,
    [selectedSuiteActionIds]
  );
  const areAllFilteredSuitesSelected = Boolean(filteredSuites.length) && filteredSuites.every((suite) => selectedSuiteActionIds.includes(suite.id));
  const activeSuiteFilterCount =
    Number(suitePlacementFilter !== "all") +
    Number(suiteMappedCasesFilter !== "all") +
    Number(suiteChildrenFilter !== "all");
  const activeCaseFilterCount =
    Number(statusFilter !== "all") +
    Number(casePriorityFilter !== "all") +
    Number(caseStepFilter !== "all") +
    Number(caseRunFilter !== "all");
  const suiteParameterDialogHeaderContent = selectedSuite ? (
    <div className="step-parameter-dialog-context">
      <div className="step-parameter-dialog-context-card">
        <strong>Suite scope</strong>
        <span>{selectedSuite.name} · {orderedSuiteCases.length} linked case{orderedSuiteCases.length === 1 ? "" : "s"} in this suite context.</span>
      </div>
      <div className="step-parameter-dialog-context-card">
        <strong>Scope guide</strong>
        <span>`@s` values are saved on this suite and reused by any linked case in the suite that references them.</span>
      </div>
    </div>
  ) : null;

  useEffect(() => {
    if (selectedSuiteId && !suites.some((suite) => suite.id === selectedSuiteId)) {
      setSelectedSuiteId("");
      setSelectedTestCaseId("");
      setIsCreatingCase(false);
      setIsTestCaseEditorModalOpen(false);
    }
  }, [selectedSuiteId, suites]);

  useEffect(() => {
    setSelectedSuiteActionIds((current) => current.filter((suiteId) => suites.some((suite) => suite.id === suiteId)));
  }, [suites]);

  useEffect(() => {
    setSelectedTestCaseId("");
    setIsCreatingCase(false);
    setIsTestCaseEditorModalOpen(false);
    setIsSuiteParameterDialogOpen(false);
    setDraftSteps([]);
    setExpandedSections(createDefaultSuiteCaseSections());
    setExpandedStepIds([]);
    setNewStepDraft(EMPTY_STEP_DRAFT);
  }, [selectedSuiteId]);

  useEffect(() => {
    setSuiteParameterValues(normalizeSuiteParameterValues(selectedSuite?.parameter_values));
  }, [selectedSuite?.id, selectedSuite?.parameter_values]);

  useEffect(() => {
    setSuiteParameterValues((current) => {
      const next = filterStepParameterValuesByScope(
        filterStepParameterValues(current, selectedSuiteParameterDefinitions),
        "s"
      );
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);

      if (currentKeys.length === nextKeys.length && currentKeys.every((key) => current[key] === next[key])) {
        return current;
      }

      return next;
    });
  }, [selectedSuiteParameterDefinitions]);

  useEffect(() => {
    setExpandedSections(createDefaultSuiteCaseSections());
    setNewStepDraft(EMPTY_STEP_DRAFT);

    if (isCreatingCase) {
      setExpandedStepIds([]);
      return;
    }

    setExpandedStepIds([]);
  }, [isCreatingCase, selectedTestCaseId]);

  useEffect(() => {
    if (!isCreatingCase) {
      return;
    }

    setExpandedStepIds((current) => current.filter((id) => draftSteps.some((step) => step.id === id)));
  }, [draftSteps, isCreatingCase]);

  useEffect(() => {
    if (isCreatingCase) {
      return;
    }

    setExpandedStepIds((current) => {
      const validIds = current.filter((id) => sortedSteps.some((step) => step.id === id));

      if (!validIds.length && sortedSteps.length) {
        return sortedSteps.map((step) => step.id);
      }

      return validIds;
    });
  }, [isCreatingCase, sortedSteps]);

  useEffect(() => {
    setIsStepCreateVisible(false);
  }, [isCreatingCase, selectedTestCaseId]);

  useEffect(() => {
    if (isCreatingCase || !selectedTestCase) {
      setCaseDraft({
        ...emptyCaseDraft,
        suite_id: selectedSuiteId || ""
      });
      return;
    }

    setCaseDraft({
      suite_id: selectedTestCase.suite_ids?.[0] || selectedTestCase.suite_id || "",
      title: selectedTestCase.title,
      description: selectedTestCase.description || "",
      automated: (selectedTestCase.automated || defaultCaseAutomated) as "yes" | "no",
      priority: String(selectedTestCase.priority ?? 3),
      status: selectedTestCase.status || defaultCaseStatus,
      requirement_id: selectedTestCase.requirement_id || ""
    });
  }, [defaultCaseAutomated, defaultCaseStatus, emptyCaseDraft, isCreatingCase, selectedSuiteId, selectedTestCase, suites]);

  useEffect(() => {
    const drafts: Record<string, StepDraft> = {};
    sortedSteps.forEach((step) => {
      drafts[step.id] = {
        action: step.action || "",
        expected_result: step.expected_result || ""
      };
    });
    setStepDrafts(drafts);
  }, [sortedSteps]);

  useEffect(() => {
    if (!selectedSuite || updateSuiteMutation.isPending) {
      return;
    }

    const normalizedCurrentValues = normalizeSuiteParameterValues(suiteParameterValues);
    const normalizedSavedValues = normalizeSuiteParameterValues(selectedSuite.parameter_values);

    if (areSuiteParameterValuesEqual(normalizedCurrentValues, normalizedSavedValues)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      updateSuiteMutation.mutate(
        {
          id: selectedSuite.id,
          input: {
            parameter_values: normalizedCurrentValues
          }
        },
        {
          onSuccess: () => {
            updateSuitesCache((current) =>
              current.map((suite) =>
                suite.id === selectedSuite.id
                  ? {
                      ...suite,
                      parameter_values: normalizedCurrentValues
                    }
                  : suite
              )
            );
          },
          onError: (error) => {
            showError(error, "Unable to update suite test data");
          }
        }
      );
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [selectedSuite, suiteParameterValues, updateSuiteMutation, updateSuiteMutation.isPending]);

  const updateCasesCache = (updater: (current: TestCase[]) => TestCase[]) => {
    queryClient.setQueryData<TestCase[]>(["design-test-cases", appTypeId], (current = []) => updater(current));
    queryClient.setQueryData<TestCase[]>(["global-test-cases", appTypeId], (current = []) => updater(current));
    queryClient.setQueryData<TestCase[]>(["test-cases"], (current = []) => updater(current));
  };

  const updateSuitesCache = (updater: (current: TestSuite[]) => TestSuite[]) => {
    queryClient.setQueryData<TestSuite[]>(["design-suites", appTypeId], (current = []) => updater(current));
    queryClient.setQueryData<TestSuite[]>(["test-case-suites", appTypeId], (current = []) => updater(current));
    queryClient.setQueryData<TestSuite[]>(["test-suites"], (current = []) => updater(current));
  };

  const updateStepsCache = (testCaseId: string, updater: (current: TestStep[]) => TestStep[]) => {
    queryClient.setQueryData<TestStep[]>(["design-test-steps", testCaseId], (current = []) => updater(current));
    queryClient.setQueryData<TestStep[]>(["test-steps"], (current = []) => updater(current));
  };

  const refreshSuites = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["design-suites", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["test-suites"] }),
      queryClient.invalidateQueries({ queryKey: ["design-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["suite-test-case-mappings"] }),
      queryClient.invalidateQueries({ queryKey: ["test-cases"] }),
      queryClient.invalidateQueries({ queryKey: ["global-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["global-test-case-results", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["design-case-results", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["design-all-test-steps", appTypeId] })
    ]);
  };

  const closeTestCaseEditorModal = () => {
    setIsTestCaseEditorModalOpen(false);
    setExpandedSections(createDefaultSuiteCaseSections());
    setExpandedStepIds([]);
    setNewStepDraft(EMPTY_STEP_DRAFT);

    if (isCreatingCase) {
      setIsCreatingCase(false);
      setDraftSteps([]);
      setCaseDraft({
        ...emptyCaseDraft,
        suite_id: selectedSuiteId || ""
      });
    }
  };

  const beginCreateCase = () => {
    if (!selectedSuiteId) {
      setMessageTone("error");
      setMessage("Select a suite first before creating a test case.");
      return;
    }

    const params = new URLSearchParams();

    if (projectId) {
      params.set("project", projectId);
    }
    if (appTypeId) {
      params.set("appType", appTypeId);
    }
    params.set("create", "1");
    params.set("suite", selectedSuiteId);

    navigate(`/test-cases?${params.toString()}`);
  };

  const openSelectedCaseEditor = () => {
    if (!selectedTestCase && !isCreatingCase) {
      return;
    }

    setIsCreatingCase(false);
    setIsTestCaseEditorModalOpen(true);
  };

  const handleProjectChange = (value: string) => {
    setProjectId(value);
    setSelectedSuiteId("");
    setSelectedSuiteActionIds([]);
    setSelectedTestCaseId("");
    setSuiteSearchTerm("");
    setSearchTerm("");
    setStatusFilter("all");
    setSuitePlacementFilter("all");
    setSuiteMappedCasesFilter("all");
    setSuiteChildrenFilter("all");
    setCasePriorityFilter("all");
    setCaseStepFilter("all");
    setCaseRunFilter("all");
    setIsCreatingCase(false);
    setIsTestCaseEditorModalOpen(false);
    setIsCreateExecutionModalOpen(false);
    setExecutionName("");
    setSelectedExecutionAssigneeId("");
    resetExecutionContextSelection();
    setExpandedSections(createDefaultSuiteCaseSections());
    setExpandedStepIds([]);
    setDraftSteps([]);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setMessage("");
  };

  const handleAppTypeChange = (value: string) => {
    setAppTypeId(value);
    setSelectedSuiteId("");
    setSelectedSuiteActionIds([]);
    setSelectedTestCaseId("");
    setSuiteSearchTerm("");
    setIsCreatingCase(false);
    setIsTestCaseEditorModalOpen(false);
    setIsCreateExecutionModalOpen(false);
    setExecutionName("");
    setSelectedExecutionAssigneeId("");
    resetExecutionContextSelection();
    setSearchTerm("");
    setStatusFilter("all");
    setSuitePlacementFilter("all");
    setSuiteMappedCasesFilter("all");
    setSuiteChildrenFilter("all");
    setCasePriorityFilter("all");
    setCaseStepFilter("all");
    setCaseRunFilter("all");
    setExpandedSections(createDefaultSuiteCaseSections());
    setExpandedStepIds([]);
    setDraftSteps([]);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setMessage("");
  };

  const handleSuiteSave = async (input: { name: string; parent_id?: string; selectedIds: string[] }) => {
    try {
      let suiteId = selectedSuiteId;

      if (suiteModalMode === "create") {
        const response = await createSuiteMutation.mutateAsync({
          app_type_id: appTypeId,
          name: input.name,
          parent_id: input.parent_id || undefined
        });
        suiteId = response.id;
      } else if (selectedSuite) {
        await updateSuiteMutation.mutateAsync({
          id: selectedSuite.id,
          input: {
            name: input.name,
            parent_id: input.parent_id || undefined
          }
        });
      }

      if (suiteId && (suiteModalMode === "edit" || input.selectedIds.length)) {
        await assignSuiteCasesMutation.mutateAsync({
          id: suiteId,
          testCaseIds: input.selectedIds
        });
      }

      setSelectedSuiteId(suiteId);
      setIsSuiteModalOpen(false);
      showSuccess(suiteModalMode === "create" ? "Suite created." : "Suite updated.");
      await refreshSuites();
    } catch (error) {
      showError(error, "Unable to save suite");
    }
  };

  const handleSaveTestCase = async () => {
    const suiteId = caseDraft.suite_id || selectedSuiteId;

    if (!suiteId) {
      setMessageTone("error");
      setMessage("Create a suite first before saving test cases.");
      return;
    }

    try {
      if (isCreatingCase || !selectedTestCase) {
        const response = await createTestCaseMutation.mutateAsync({
          app_type_id: appTypeId,
          suite_ids: [suiteId],
          title: caseDraft.title,
          description: caseDraft.description || undefined,
          automated: caseDraft.automated,
          priority: Number(caseDraft.priority || 3),
          status: caseDraft.status || defaultCaseStatus,
          requirement_id: caseDraft.requirement_id || undefined,
          requirement_ids: caseDraft.requirement_id ? [caseDraft.requirement_id] : [],
          steps: normalizeDraftSteps(draftSteps)
        });

        const optimisticCase: TestCase = {
          id: response.id,
          suite_id: suiteId,
          suite_ids: [suiteId],
          title: caseDraft.title,
          description: caseDraft.description || null,
          automated: caseDraft.automated,
          priority: Number(caseDraft.priority || 3),
          status: caseDraft.status || defaultCaseStatus,
          requirement_id: caseDraft.requirement_id || null
        };

        updateCasesCache((current) => [optimisticCase, ...current]);
        setSelectedSuiteId(suiteId);
        setSelectedTestCaseId(response.id);
        setIsCreatingCase(false);
        setDraftSteps([]);
        showSuccess("Test case created.");
      } else {
        await updateTestCaseMutation.mutateAsync({
          id: selectedTestCase.id,
          input: {
            app_type_id: appTypeId,
            suite_ids: selectedTestCase.suite_ids?.length
              ? [suiteId, ...selectedTestCase.suite_ids.filter((id) => id !== suiteId)]
              : [suiteId],
            title: caseDraft.title,
            description: caseDraft.description,
            automated: caseDraft.automated,
            priority: Number(caseDraft.priority || 3),
            status: caseDraft.status,
            requirement_id: caseDraft.requirement_id || undefined
          }
        });

        updateCasesCache((current) =>
          current.map((testCase) =>
            testCase.id === selectedTestCase.id
              ? {
                ...testCase,
                  suite_id: suiteId,
                  suite_ids: testCase.suite_ids?.length
                    ? [suiteId, ...testCase.suite_ids.filter((id) => id !== suiteId)]
                    : [suiteId],
                  title: caseDraft.title,
                  description: caseDraft.description || null,
                  automated: caseDraft.automated,
                  priority: Number(caseDraft.priority || 3),
                  status: caseDraft.status,
                  requirement_id: caseDraft.requirement_id || null
                }
              : testCase
          )
        );

        showSuccess("Test case updated.");
      }

      await refreshSuites();
    } catch (error) {
      showError(error, "Unable to save test case");
    }
  };

  const closeSuiteWorkspace = () => {
    setSelectedSuiteId("");
    setSelectedTestCaseId("");
    setIsCreatingCase(false);
    setIsTestCaseEditorModalOpen(false);
    setDraftSteps([]);
    setExpandedSections(createDefaultSuiteCaseSections());
    setExpandedStepIds([]);
    setNewStepDraft(EMPTY_STEP_DRAFT);
  };

  const handleDeleteSelectedSuites = async () => {
    const selectedSuites = suites.filter((suite) => selectedSuiteActionIds.includes(suite.id));

    if (!selectedSuites.length) {
      return;
    }

    const confirmed = await confirmDelete({
      message: `Delete ${selectedSuites.length} suite${selectedSuites.length === 1 ? "" : "s"}? Linked test cases will be kept, but their suite mappings will be removed.`
    });

    if (!confirmed) {
      return;
    }

    setIsDeletingSelectedSuites(true);

    try {
      const results = await Promise.allSettled(selectedSuites.map((suite) => api.testSuites.delete(suite.id)));
      const deletedIds = selectedSuites
        .filter((_, index) => results[index]?.status === "fulfilled")
        .map((suite) => suite.id);
      const failedResults = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

      setSelectedSuiteActionIds((current) => current.filter((id) => !deletedIds.includes(id)));

      if (deletedIds.includes(selectedSuiteId)) {
        setSelectedSuiteId("");
        setSelectedTestCaseId("");
        setIsCreatingCase(false);
        setIsTestCaseEditorModalOpen(false);
      }

      if (deletedIds.length) {
        await refreshSuites();
      }

      if (!failedResults.length) {
        showSuccess(`${deletedIds.length} suite${deletedIds.length === 1 ? "" : "s"} deleted. Linked test cases remain reusable.`);
        return;
      }

      const firstError = failedResults[0]?.reason;
      const detail = firstError instanceof Error ? ` ${firstError.message}` : "";

      if (deletedIds.length) {
        setMessageTone("error");
        setMessage(`${deletedIds.length} suite${deletedIds.length === 1 ? "" : "s"} deleted, but ${failedResults.length} failed.${detail}`);
        return;
      }

      showError(firstError, "Unable to delete selected suites");
    } finally {
      setIsDeletingSelectedSuites(false);
    }
  };

  const handleCreateExecution = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!session?.user.id) {
      setMessageTone("error");
      setMessage("You need an active session before creating a run.");
      return;
    }

    if (!projectId || !appTypeId || !executionTargetSuiteIds.length) {
      setMessageTone("error");
      setMessage("Select at least one suite in the current scope before creating a run.");
      return;
    }

    try {
      const response = await createExecutionMutation.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId,
        suite_ids: executionTargetSuiteIds,
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined,
        assigned_to: selectedExecutionAssigneeId || undefined,
        name: executionName.trim() || undefined,
        created_by: session.user.id
      });

      closeCreateExecutionModal();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["executions"] }),
        queryClient.invalidateQueries({ queryKey: ["executions", projectId] })
      ]);
      navigate(`/executions?view=suite-runs&execution=${response.id}`);
    } catch (error) {
      showError(error, "Unable to create run");
    }
  };

  const handleDeleteTestCase = async () => {
    if (!selectedTestCase || !(await confirmDelete({ message: `Delete test case "${selectedTestCase.title}"? This will remove its steps and mappings.` }))) {
      return;
    }

    try {
      await deleteTestCaseMutation.mutateAsync(selectedTestCase.id);
      updateCasesCache((current) => current.filter((testCase) => testCase.id !== selectedTestCase.id));
      queryClient.removeQueries({ queryKey: ["design-test-steps", selectedTestCase.id] });
      setSelectedTestCaseId("");
      setIsCreatingCase(false);
      setIsTestCaseEditorModalOpen(false);
      setDraftSteps([]);
      setExpandedStepIds([]);
      showSuccess("Test case deleted.");
      await refreshSuites();
    } catch (error) {
      showError(error, "Unable to delete test case");
    }
  };

  const handleCreateStep = async () => {
    const normalizedDraft = {
      action: newStepDraft.action.trim(),
      expected_result: newStepDraft.expected_result.trim()
    };

    if (!normalizedDraft.action && !normalizedDraft.expected_result) {
      setMessageTone("error");
      setMessage("Add an action or expected result before creating a step.");
      return;
    }

    if (isCreatingCase) {
      const draftId = createDraftStepId();
      setDraftSteps((current) => [...current, {
        id: draftId,
        ...normalizedDraft,
        group_id: null,
        group_name: null,
        group_kind: null,
        reusable_group_id: null
      }]);
      setExpandedStepIds((current) => [...new Set([...current, draftId])]);
      setNewStepDraft(EMPTY_STEP_DRAFT);
      setIsStepCreateVisible(false);
      showSuccess("Draft step added to the new test case.");
      return;
    }

    if (!selectedTestCase) {
      setMessageTone("error");
      setMessage("Select a test case before adding steps.");
      return;
    }

    try {
      const nextStepOrder = (sortedSteps[sortedSteps.length - 1]?.step_order || 0) + 1;
      const response = await createStepMutation.mutateAsync({
        test_case_id: selectedTestCase.id,
        step_order: nextStepOrder,
        action: normalizedDraft.action,
        expected_result: normalizedDraft.expected_result
      });

      const optimisticStep: TestStep = {
        id: response.id,
        test_case_id: selectedTestCase.id,
        step_order: nextStepOrder,
        action: normalizedDraft.action || null,
        expected_result: normalizedDraft.expected_result || null,
        group_id: null,
        group_name: null,
        group_kind: null,
        reusable_group_id: null
      };

      updateStepsCache(selectedTestCase.id, (current) => [...current, optimisticStep]);
      setNewStepDraft(EMPTY_STEP_DRAFT);
      setIsStepCreateVisible(false);
      setExpandedStepIds((current) => [...new Set([...current, response.id])]);
      showSuccess("Step added.");
      await queryClient.invalidateQueries({ queryKey: ["design-all-test-steps", appTypeId] });
    } catch (error) {
      showError(error, "Unable to add step");
    }
  };

  const handleUpdateStep = async (stepId: string, draftOverride?: StepDraft) => {
    const draft = draftOverride || stepDrafts[stepId];
    const step = sortedSteps.find((item) => item.id === stepId);

    if (!draft || !step) {
      return;
    }

    try {
      await updateStepMutation.mutateAsync({
        id: stepId,
        input: {
          test_case_id: step.test_case_id,
          step_order: step.step_order,
          action: draft.action,
          expected_result: draft.expected_result,
          group_id: step.group_id || null,
          group_name: step.group_name || null,
          group_kind: step.group_kind || null,
          reusable_group_id: step.reusable_group_id || null
        }
      });

      updateStepsCache(step.test_case_id, (current) =>
        current.map((item) =>
          item.id === stepId
            ? {
                ...item,
                step_order: step.step_order,
                action: draft.action || null,
                expected_result: draft.expected_result || null,
                group_id: step.group_id || null,
                group_name: step.group_name || null,
                group_kind: step.group_kind || null,
                reusable_group_id: step.reusable_group_id || null
              }
            : item
        )
      );

      showSuccess("Step updated.");
      await queryClient.invalidateQueries({ queryKey: ["design-all-test-steps", appTypeId] });
    } catch (error) {
      showError(error, "Unable to update step");
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    if (isCreatingCase) {
      setDraftSteps((current) => current.filter((step) => step.id !== stepId));
      setExpandedStepIds((current) => current.filter((id) => id !== stepId));
      showSuccess("Draft step removed.");
      return;
    }

    if (!selectedTestCase) {
      return;
    }

    if (!(await confirmDelete({ message: "Delete this step?" }))) {
      return;
    }

    try {
      await deleteStepMutation.mutateAsync(stepId);
      updateStepsCache(selectedTestCase.id, (current) =>
        current
          .filter((step) => step.id !== stepId)
          .map((step, index) => ({ ...step, step_order: index + 1 }))
      );
      setExpandedStepIds((current) => current.filter((id) => id !== stepId));
      showSuccess("Step deleted.");
      await queryClient.invalidateQueries({ queryKey: ["design-all-test-steps", appTypeId] });
    } catch (error) {
      showError(error, "Unable to delete step");
    }
  };

  const handleReorderStep = async (stepId: string, direction: "up" | "down") => {
    if (!selectedTestCase) {
      return;
    }

    const currentIndex = sortedSteps.findIndex((step) => step.id === stepId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= sortedSteps.length) {
      return;
    }

    const reordered = [...sortedSteps];
    const [movedStep] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, movedStep);

    const normalized = reordered.map((step, index) => ({
      ...step,
      step_order: index + 1
    }));

    try {
      await reorderStepsMutation.mutateAsync({
        testCaseId: selectedTestCase.id,
        stepIds: normalized.map((step) => step.id)
      });

      updateStepsCache(selectedTestCase.id, () => normalized);
      setExpandedStepIds((current) => [...new Set([...current, stepId])]);
      showSuccess("Step order updated.");
      await queryClient.invalidateQueries({ queryKey: ["design-all-test-steps", appTypeId] });
    } catch (error) {
      showError(error, "Unable to reorder steps");
    }
  };

  const handleUpdateDraftStep = (stepId: string, input: StepDraft) => {
    setDraftSteps((current) =>
      current.map((step) =>
        step.id === stepId
          ? {
              ...step,
              action: input.action,
              expected_result: input.expected_result
            }
          : step
      )
    );
  };

  const handleReorderDraftStep = (stepId: string, direction: "up" | "down") => {
    setDraftSteps((current) => {
      const currentIndex = current.findIndex((step) => step.id === stepId);
      const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

      if (currentIndex === -1 || targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const reordered = [...current];
      const [movedStep] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, movedStep);
      return reordered;
    });
    showSuccess("Draft step order updated.");
  };

  const handleReorderCases = async (fromCaseId: string, toCaseId: string) => {
    if (!selectedSuiteId || fromCaseId === toCaseId) {
      return;
    }

    const reordered = [...orderedSuiteCases];
    const fromIndex = reordered.findIndex((testCase) => testCase.id === fromCaseId);
    const toIndex = reordered.findIndex((testCase) => testCase.id === toCaseId);

    if (fromIndex === -1 || toIndex === -1) {
      return;
    }

    const [movedCase] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, movedCase);

    try {
      await reorderSuiteCasesMutation.mutateAsync({
        suiteId: selectedSuiteId,
        testCaseIds: reordered.map((testCase) => testCase.id)
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["design-test-cases", appTypeId] }),
        queryClient.invalidateQueries({ queryKey: ["suite-test-case-mappings", selectedSuiteId] })
      ]);
      showSuccess("Test case order updated.");
    } catch (error) {
      showError(error, "Unable to reorder test cases");
    }
  };

  const isDesignLoading =
    projectsQuery.isLoading ||
    appTypesQuery.isLoading ||
    suitesQuery.isLoading ||
    testCasesQuery.isLoading ||
    executionResultsQuery.isLoading ||
    allTestStepsQuery.isLoading ||
    (Boolean(selectedSuiteId) && suiteMappingsQuery.isLoading);
  const designMetrics = useMemo(() => {
    const casesWithRequirements = appTypeCases.filter((testCase) => testCase.requirement_id || testCase.requirement_ids?.length).length;
    const casesWithHistory = appTypeCases.filter((testCase) => (historyByCaseId[testCase.id] || []).length > 0).length;
    const totalSteps = appTypeCases.reduce((total, testCase) => total + (stepCountByCaseId[testCase.id] || 0), 0);

    return {
      totalSuites: suites.length,
      totalCases: appTypeCases.length,
      casesWithRequirements,
      casesWithHistory,
      totalSteps
    };
  }, [appTypeCases, historyByCaseId, stepCountByCaseId, suites.length]);
  const showSuiteTilesHeader = !selectedSuiteId;

  return (
    <div className="page-content page-content--library-full">
      {confirmationDialog}
      {showSuiteTilesHeader ? (
        <PageHeader
          eyebrow="Test Design"
          title="Test Suites"
          description="Shape suite structure, assign reusable cases, and keep executable design tidy enough for fast run handoff."
          meta={[
            { label: "Suites", value: designMetrics.totalSuites },
            { label: "Cases", value: designMetrics.totalCases },
            { label: "Steps", value: designMetrics.totalSteps }
          ]}
          actions={
            <button
              className="primary-button"
              disabled={!appTypeId}
              onClick={openCreateSuiteModal}
              type="button"
            >
              <LayersIcon />
              Create Suite
            </button>
          }
        />
      ) : null}

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

      <WorkspaceScopeBar
        appTypeId={appTypeId}
        appTypes={appTypes}
        onAppTypeChange={handleAppTypeChange}
        onProjectChange={handleProjectChange}
        projectId={projectId}
        projects={projects}
      />

      <WorkspaceSectionTabs ariaLabel="Test authoring sections" items={authoringSectionItems} />

      <WorkspaceMasterDetail
        browseView={(
          <SuiteSidebar
            suites={filteredSuites}
            activeSuiteId={selectedSuiteId}
            counts={suiteCounts}
            childCounts={childSuiteCounts}
            historyBySuiteId={historyBySuiteId}
            suiteSearchTerm={suiteSearchTerm}
            suitePlacementFilter={suitePlacementFilter}
            suiteMappedCasesFilter={suiteMappedCasesFilter}
            suiteChildrenFilter={suiteChildrenFilter}
            activeFilterCount={activeSuiteFilterCount}
            selectedSuiteActionIds={selectedSuiteActionIds}
            areAllVisibleSuitesSelected={areAllFilteredSuitesSelected}
            onSelectSuite={setSelectedSuiteId}
            onSuiteSearchChange={setSuiteSearchTerm}
            onSuitePlacementFilter={setSuitePlacementFilter}
            onSuiteMappedCasesFilter={setSuiteMappedCasesFilter}
            onSuiteChildrenFilter={setSuiteChildrenFilter}
            onToggleSuiteSelection={(suiteId) =>
              setSelectedSuiteActionIds((current) =>
                current.includes(suiteId) ? current.filter((id) => id !== suiteId) : [...new Set([...current, suiteId])]
              )
            }
            onSelectAllVisibleSuites={() =>
              setSelectedSuiteActionIds((current) => [...new Set([...current, ...filteredSuites.map((suite) => suite.id)])])
            }
            onClearSuiteSelection={() => setSelectedSuiteActionIds([])}
            onCreateSuite={openCreateSuiteModal}
            onDeleteSelectedSuites={() => void handleDeleteSelectedSuites()}
            onCreateExecution={() => setIsCreateExecutionModalOpen(true)}
            isLoading={suitesQuery.isLoading && Boolean(appTypeId)}
            selectedAppType={selectedAppType}
            canCreateSuite={Boolean(appTypeId)}
            canCreateExecution={Boolean(projectId && appTypeId && suites.length && session?.user.id)}
            selectedSuiteCount={selectedSuiteActionIds.length}
            isDeletingSelectedSuites={isDeletingSelectedSuites}
            hasSuiteSearchResults={Boolean(filteredSuites.length)}
            hasAnySuites={Boolean(suites.length)}
            viewMode={suiteCatalogViewMode}
            onViewModeChange={setSuiteCatalogViewMode}
          />
        )}
        detailView={(
          <TestCaseList
            actions={
              <>
                <WorkspaceBackButton label="Back to suite tiles" onClick={closeSuiteWorkspace} />
                <button
                  className="ghost-button"
                  disabled={!selectedSuite}
                  onClick={() => setIsSuiteParameterDialogOpen(true)}
                  type="button"
                >
                  <span>{selectedSuiteParameterDefinitions.length ? `Suite test data · ${selectedSuiteParameterDefinitions.length}` : "Suite test data"}</span>
                </button>
                <button
                  className="ghost-button"
                  disabled={!selectedSuite}
                  onClick={() => {
                    setSuiteModalMode("edit");
                    setIsSuiteModalOpen(true);
                  }}
                  type="button"
                >
                  Edit Suite
                </button>
              </>
            }
            cases={filteredCases}
            activeCaseId={selectedTestCaseId}
            searchTerm={searchTerm}
            statusFilter={statusFilter}
            casePriorityFilter={casePriorityFilter}
            caseStepFilter={caseStepFilter}
            caseRunFilter={caseRunFilter}
            statusOptions={caseStatusOptions}
            priorityOptions={casePriorityOptions}
            activeFilterCount={activeCaseFilterCount}
            defaultCaseStatus={defaultCaseStatus}
            selectedSuite={selectedSuite}
            isLoading={isDesignLoading}
            historyByCaseId={historyByCaseId}
            requirements={requirements}
            stepCountByCaseId={stepCountByCaseId}
            onSearch={setSearchTerm}
            onStatusFilter={setStatusFilter}
            onCasePriorityFilter={setCasePriorityFilter}
            onCaseStepFilter={setCaseStepFilter}
            onCaseRunFilter={setCaseRunFilter}
            onSelectCase={(testCaseId) => {
              setSelectedTestCaseId(testCaseId);
              setIsCreatingCase(false);
            }}
            onCreateCase={beginCreateCase}
            onOpenCaseEditor={openSelectedCaseEditor}
            canOpenCaseEditor={Boolean(selectedTestCaseId)}
            onReorderCases={handleReorderCases}
            viewMode={suiteCaseCatalogViewMode}
            onViewModeChange={setSuiteCaseCatalogViewMode}
          />
        )}
        isDetailOpen={Boolean(selectedSuiteId)}
      />

      {isTestCaseEditorModalOpen && selectedTestCase ? (
        <LinkedTestCaseModal
          appTypeName={selectedAppType?.name || ""}
          onClose={closeTestCaseEditorModal}
          projectName={selectedProject?.name || ""}
          requirements={requirements}
          selectedSuite={selectedSuite}
          suites={suites}
          testCase={selectedTestCase}
        />
      ) : null}

      {isSuiteParameterDialogOpen && selectedSuite ? (
        <StepParameterDialog
          getInputState={() => ({
            hint: `Saved on suite "${selectedSuite.name}" and reused by any linked case that references the same @s token.`
          })}
          headerContent={suiteParameterDialogHeaderContent}
          onChange={(name, value) =>
            setSuiteParameterValues((current) => ({
              ...current,
              [name]: value
            }))
          }
          onClose={() => setIsSuiteParameterDialogOpen(false)}
          parameters={selectedSuiteParameterDefinitions}
          subtitle="Suite-shared values detected across the cases linked into this suite."
          title={`${selectedSuite.name} test data`}
          values={suiteParameterValues}
        />
      ) : null}

      {isCreateExecutionModalOpen ? (
        <SuiteExecutionModal
          assigneeOptions={assigneeOptions}
          canCreateExecution={Boolean(projectId && appTypeId && executionTargetSuiteIds.length && session?.user.id)}
          executionName={executionName}
          isSubmitting={createExecutionMutation.isPending}
          onAssigneeChange={setSelectedExecutionAssigneeId}
          onClose={closeCreateExecutionModal}
          onConfigurationChange={setSelectedExecutionConfigurationId}
          onDataSetChange={setSelectedExecutionDataSetId}
          onEnvironmentChange={setSelectedExecutionEnvironmentId}
          onExecutionNameChange={setExecutionName}
          onSuiteSelectionChange={setSelectedSuiteActionIds}
          onSubmit={handleCreateExecution}
          appTypeId={appTypeId}
          projectId={projectId}
          selectedAssigneeId={selectedExecutionAssigneeId}
          selectedConfigurationId={selectedExecutionConfigurationId}
          selectedAppType={selectedAppType?.name || ""}
          selectedDataSetId={selectedExecutionDataSetId}
          selectedEnvironmentId={selectedExecutionEnvironmentId}
          selectedProject={selectedProject?.name || ""}
          scopeSuites={suites}
          selectedSuiteIds={selectedSuiteActionIds}
        />
      ) : null}

      {isSuiteModalOpen ? (
        <SuiteModal
          key={suiteModalMode === "edit" ? `edit-${selectedSuite?.id || "none"}` : "create-new"}
          mode={suiteModalMode}
          suite={suiteModalMode === "edit" ? selectedSuite : null}
          suites={suites}
          appTypeCases={allTestCases}
          selectedCaseIds={suiteModalMode === "edit" ? orderedSuiteCases.map((testCase) => testCase.id) : []}
          onClose={() => setIsSuiteModalOpen(false)}
          onSubmit={handleSuiteSave}
          isSaving={createSuiteMutation.isPending || updateSuiteMutation.isPending || assignSuiteCasesMutation.isPending}
        />
      ) : null}
    </div>
  );
}

function SuiteSidebar({
  actions,
  suites,
  activeSuiteId,
  counts,
  childCounts,
  historyBySuiteId,
  suiteSearchTerm,
  suitePlacementFilter,
  suiteMappedCasesFilter,
  suiteChildrenFilter,
  activeFilterCount,
  selectedSuiteActionIds,
  areAllVisibleSuitesSelected,
  onSelectSuite,
  onSuiteSearchChange,
  onSuitePlacementFilter,
  onSuiteMappedCasesFilter,
  onSuiteChildrenFilter,
  onToggleSuiteSelection,
  onSelectAllVisibleSuites,
  onClearSuiteSelection,
  onCreateSuite,
  onDeleteSelectedSuites,
  onCreateExecution,
  isLoading,
  selectedAppType,
  canCreateSuite,
  canCreateExecution,
  selectedSuiteCount,
  isDeletingSelectedSuites,
  hasSuiteSearchResults,
  hasAnySuites,
  viewMode,
  onViewModeChange
}: {
  actions?: ReactNode;
  suites: TestSuite[];
  activeSuiteId: string;
  counts: Record<string, number>;
  childCounts: Record<string, number>;
  historyBySuiteId: Record<string, Array<{ execution_id: string; status: ExecutionResult["status"]; created_at?: string }>>;
  suiteSearchTerm: string;
  suitePlacementFilter: SuitePlacementFilter;
  suiteMappedCasesFilter: SuiteMappedCasesFilter;
  suiteChildrenFilter: SuiteChildrenFilter;
  activeFilterCount: number;
  selectedSuiteActionIds: string[];
  areAllVisibleSuitesSelected: boolean;
  onSelectSuite: (suiteId: string) => void;
  onSuiteSearchChange: (value: string) => void;
  onSuitePlacementFilter: (value: SuitePlacementFilter) => void;
  onSuiteMappedCasesFilter: (value: SuiteMappedCasesFilter) => void;
  onSuiteChildrenFilter: (value: SuiteChildrenFilter) => void;
  onToggleSuiteSelection: (suiteId: string) => void;
  onSelectAllVisibleSuites: () => void;
  onClearSuiteSelection: () => void;
  onCreateSuite: () => void;
  onDeleteSelectedSuites: () => void;
  onCreateExecution: () => void;
  isLoading: boolean;
  selectedAppType: AppType | null;
  canCreateSuite: boolean;
  canCreateExecution: boolean;
  selectedSuiteCount: number;
  isDeletingSelectedSuites: boolean;
  hasSuiteSearchResults: boolean;
  hasAnySuites: boolean;
  viewMode: "tile" | "list";
  onViewModeChange: (value: "tile" | "list") => void;
}) {
  return (
    <Panel
      className="execution-panel suite-design-panel suite-design-panel--list"
      actions={actions}
      title="Suite tiles"
      subtitle={selectedAppType ? "Browse suites as tiles first, then open one to manage its mapped test cases." : "Select a project and app type first."}
    >
      <div className="suite-design-panel-stack">
        <div className="design-sidebar-actions">
          <button className="primary-button" disabled={!canCreateSuite} onClick={onCreateSuite} type="button">Create Suite</button>
          <button className="ghost-button" disabled={!canCreateExecution} onClick={onCreateExecution} type="button">Create Run</button>
        </div>

        <div className="design-list-toolbar suite-sidebar-toolbar">
          <CatalogViewToggle onChange={onViewModeChange} value={viewMode} />
          <CatalogSearchFilter
            activeFilterCount={activeFilterCount}
            ariaLabel="Search suites"
            onChange={onSuiteSearchChange}
            placeholder="Search suites"
            subtitle="Filter suite tiles by the placement and counts shown on each card."
            title="Filter suites"
            value={suiteSearchTerm}
          >
            <div className="catalog-filter-grid">
              <label className="catalog-filter-field">
                <span>Placement</span>
                <select value={suitePlacementFilter} onChange={(event) => onSuitePlacementFilter(event.target.value as SuitePlacementFilter)}>
                  <option value="all">All suites</option>
                  <option value="root">Root suites</option>
                  <option value="nested">Nested suites</option>
                </select>
              </label>

              <label className="catalog-filter-field">
                <span>Mapped cases</span>
                <select value={suiteMappedCasesFilter} onChange={(event) => onSuiteMappedCasesFilter(event.target.value as SuiteMappedCasesFilter)}>
                  <option value="all">All suites</option>
                  <option value="with-cases">With mapped cases</option>
                  <option value="empty">Empty suites</option>
                </select>
              </label>

              <label className="catalog-filter-field">
                <span>Child suites</span>
                <select value={suiteChildrenFilter} onChange={(event) => onSuiteChildrenFilter(event.target.value as SuiteChildrenFilter)}>
                  <option value="all">All suites</option>
                  <option value="with-children">With child suites</option>
                  <option value="no-children">No child suites</option>
                </select>
              </label>

              <div className="catalog-filter-actions">
                <button
                  className="ghost-button"
                  disabled={!activeFilterCount}
                  onClick={() => {
                    onSuitePlacementFilter("all");
                    onSuiteMappedCasesFilter("all");
                    onSuiteChildrenFilter("all");
                  }}
                  type="button"
                >
                  Clear filters
                </button>
              </div>
            </div>
          </CatalogSearchFilter>
          <button className="ghost-button" disabled={!suites.length || areAllVisibleSuitesSelected} onClick={onSelectAllVisibleSuites} type="button">
            Select all visible
          </button>
          <button className="ghost-button" disabled={!selectedSuiteActionIds.length} onClick={onClearSuiteSelection} type="button">
            Clear selection
          </button>
          <button
            className="ghost-button danger"
            disabled={!selectedSuiteActionIds.length || isDeletingSelectedSuites}
            onClick={onDeleteSelectedSuites}
            type="button"
          >
            {isDeletingSelectedSuites ? "Deleting…" : `Delete selected${selectedSuiteActionIds.length ? ` (${selectedSuiteActionIds.length})` : ""}`}
          </button>
        </div>

        {selectedSuiteCount ? (
          <div className="detail-summary suite-selection-summary">
            <strong>{selectedSuiteCount} suite{selectedSuiteCount === 1 ? "" : "s"} selected for bulk actions</strong>
            <span>Checkbox selections power bulk delete and run creation. Click a card body to keep curating one suite at a time.</span>
          </div>
        ) : null}
        <TileBrowserPane className="test-case-library-scroll suite-tile-browser">
          {isLoading ? <TileCardSkeletonGrid /> : null}
          {!isLoading && !hasAnySuites ? (
            <div className="empty-state compact">
              <div>No suites yet. Create your first suite to start organizing reusable cases.</div>
              <button className="primary-button" disabled={!canCreateSuite} onClick={onCreateSuite} type="button">Create first suite</button>
            </div>
          ) : null}
          {!isLoading && hasAnySuites && !hasSuiteSearchResults ? <div className="empty-state compact">No suites match the current search.</div> : null}

          {!isLoading && hasSuiteSearchResults && viewMode === "tile" ? (
            <div className="tile-browser-grid">
              {suites.map((suite) => {
                const mappedCaseCount = counts[suite.id] || 0;
                const history = (historyBySuiteId[suite.id] || []).slice(0, 5);
                const runCount = (historyBySuiteId[suite.id] || []).length;
                const latestRun = history[0];

                return (
                  <button
                    key={suite.id}
                    className={[
                      "record-card tile-card test-suite-card",
                      activeSuiteId === suite.id ? "is-active" : "",
                      selectedSuiteActionIds.includes(suite.id) ? "is-marked-for-delete" : ""
                    ].filter(Boolean).join(" ")}
                    onClick={() => onSelectSuite(suite.id)}
                    type="button"
                  >
                    <div className="tile-card-main">
                      <div className="tile-card-select-row">
                        <label className="checkbox-field suite-card-action-checkbox" onClick={(event) => event.stopPropagation()}>
                          <input
                            checked={selectedSuiteActionIds.includes(suite.id)}
                            onChange={() => onToggleSuiteSelection(suite.id)}
                            type="checkbox"
                          />
                          <DisplayIdBadge value={suite.display_id || suite.id} />
                        </label>
                      </div>
                      <div className="tile-card-header">
                        <div className="tile-card-title-group">
                          <strong>{suite.name}</strong>
                        </div>
                      </div>
                      <p className="tile-card-description">{selectedAppType ? `${selectedAppType.name} workspace suite` : "No app type selected"}</p>
                      <div className="tile-card-facts" aria-label={`${suite.name} facts`}>
                        <TileCardFact
                          label={String(mappedCaseCount)}
                          title={`${mappedCaseCount} mapped case${mappedCaseCount === 1 ? "" : "s"}`}
                          tone={mappedCaseCount ? "success" : "neutral"}
                        >
                          <TileCardCaseIcon />
                        </TileCardFact>
                        <TileCardFact
                          label={String(runCount)}
                          title={`${runCount} suite run${runCount === 1 ? "" : "s"}`}
                          tone={runCount ? getTileCardTone(latestRun?.status || "neutral") : "neutral"}
                        >
                          <TileCardRunsIcon />
                        </TileCardFact>
                      </div>
                      <div className="tile-card-footer">
                        <div className="history-bars" aria-label="Suite run history">
                          {history.length ? history.map((result) => (
                            <span
                              key={`${suite.id}-${result.execution_id}`}
                              className={result.status === "passed" ? "history-bar is-passed" : result.status === "failed" ? "history-bar is-failed" : "history-bar is-blocked"}
                              title={`${result.status} · ${result.created_at || "recent"}`}
                            />
                          )) : <span className="history-bar" />}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
          {!isLoading && hasSuiteSearchResults && viewMode === "list" ? (
            <div className="table-wrap catalog-table-wrap">
              <table className="data-table catalog-data-table">
                <thead>
                  <tr>
                    <th><span className="data-table-header-label" /></th>
                    <th><span className="data-table-header-label">ID</span></th>
                    <th><span className="data-table-header-label">Suite</span></th>
                    <th><span className="data-table-header-label">Placement</span></th>
                    <th><span className="data-table-header-label">Mapped cases</span></th>
                    <th><span className="data-table-header-label">Child suites</span></th>
                  </tr>
                </thead>
                <tbody>
                  {suites.map((suite) => {
                    const suitePlacementLabel = suite.parent_id ? "Nested suite" : "Root suite";
                    const mappedCaseCount = counts[suite.id] || 0;
                    const childSuiteCount = childCounts[suite.id] || 0;

                    return (
                      <tr
                        className={activeSuiteId === suite.id ? "is-active-row" : ""}
                        key={suite.id}
                        onClick={() => onSelectSuite(suite.id)}
                      >
                        <td onClick={(event) => event.stopPropagation()}>
                          <input
                            checked={selectedSuiteActionIds.includes(suite.id)}
                            onChange={() => onToggleSuiteSelection(suite.id)}
                            type="checkbox"
                          />
                        </td>
                        <td><DisplayIdBadge value={suite.display_id || suite.id} /></td>
                        <td>
                          <strong>{suite.name}</strong>
                          <div className="catalog-row-subcopy">{selectedAppType ? `${selectedAppType.name} workspace suite` : "Suite"}</div>
                        </td>
                        <td>{suitePlacementLabel}</td>
                        <td>{mappedCaseCount}</td>
                        <td>{childSuiteCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </TileBrowserPane>
      </div>
    </Panel>
  );
}

function TestCaseList({
  actions,
  cases,
  activeCaseId,
  searchTerm,
  statusFilter,
  casePriorityFilter,
  caseStepFilter,
  caseRunFilter,
  statusOptions,
  priorityOptions,
  activeFilterCount,
  defaultCaseStatus,
  selectedSuite,
  isLoading,
  historyByCaseId,
  requirements,
  stepCountByCaseId,
  onSearch,
  onStatusFilter,
  onCasePriorityFilter,
  onCaseStepFilter,
  onCaseRunFilter,
  onSelectCase,
  onCreateCase,
  onOpenCaseEditor,
  canOpenCaseEditor,
  onReorderCases,
  viewMode,
  onViewModeChange
}: {
  actions?: ReactNode;
  cases: TestCase[];
  activeCaseId: string;
  searchTerm: string;
  statusFilter: string;
  casePriorityFilter: string;
  caseStepFilter: SuiteCaseStepFilter;
  caseRunFilter: SuiteCaseRunFilter;
  statusOptions: string[];
  priorityOptions: string[];
  activeFilterCount: number;
  defaultCaseStatus: string;
  selectedSuite: TestSuite | null;
  isLoading: boolean;
  historyByCaseId: Record<string, ExecutionResult[]>;
  requirements: Requirement[];
  stepCountByCaseId: Record<string, number>;
  onSearch: (value: string) => void;
  onStatusFilter: (value: string) => void;
  onCasePriorityFilter: (value: string) => void;
  onCaseStepFilter: (value: SuiteCaseStepFilter) => void;
  onCaseRunFilter: (value: SuiteCaseRunFilter) => void;
  onSelectCase: (testCaseId: string) => void;
  onCreateCase: () => void;
  onOpenCaseEditor: () => void;
  canOpenCaseEditor: boolean;
  onReorderCases: (fromCaseId: string, toCaseId: string) => void;
  viewMode: "tile" | "list";
  onViewModeChange: (value: "tile" | "list") => void;
}) {
  const [draggedCaseId, setDraggedCaseId] = useState("");
  const casesWithRequirements = cases.filter((testCase) => testCase.requirement_id || testCase.requirement_ids?.length).length;
  const casesWithHistory = cases.filter((testCase) => (historyByCaseId[testCase.id] || []).length > 0).length;
  const getRequirementTitleForCase = (testCase: TestCase) =>
    requirements
      .find((item) => (testCase.requirement_ids || [testCase.requirement_id]).includes(item.id))
      ?.title || "No requirement linked";
  const suiteCaseListColumns = useMemo<Array<DataTableColumn<TestCase>>>(() => [
    {
      key: "id",
      label: "ID",
      render: (testCase) => <DisplayIdBadge value={testCase.display_id || testCase.id} />
    },
    {
      key: "title",
      label: "Test case",
      canToggle: false,
      render: (testCase) => (
        <div className="data-table-multiline">
          <strong>{testCase.title}</strong>
          <span className="data-table-multiline-line">{getRequirementTitleForCase(testCase)}</span>
        </div>
      )
    },
    {
      key: "description",
      label: "Description",
      defaultVisible: false,
      render: (testCase) => testCase.description || "No description yet for this test case."
    },
    {
      key: "status",
      label: "Status",
      render: (testCase) => {
        const history = historyByCaseId[testCase.id] || [];
        const latest = history[0];
        return formatTileCardLabel(latest?.status || testCase.status || defaultCaseStatus, "Active");
      }
    },
    {
      key: "automated",
      label: "Automated",
      render: (testCase) => (testCase.automated === "yes" ? "Yes" : "No")
    },
    {
      key: "priority",
      label: "Priority",
      render: (testCase) => `P${testCase.priority || 3}`
    },
    {
      key: "steps",
      label: "Steps",
      render: (testCase) => stepCountByCaseId[testCase.id] || 0
    },
    {
      key: "testData",
      label: "Test data",
      defaultVisible: false,
      render: (testCase) => {
        const parameterEntries = Object.entries(testCase.parameter_values || {}).sort(([left], [right]) => left.localeCompare(right));

        if (!parameterEntries.length) {
          return "No test data";
        }

        return (
          <div className="data-table-multiline">
            {parameterEntries.map(([name, value]) => (
              <span className="data-table-multiline-line" key={name}>{`${name} = ${value}`}</span>
            ))}
          </div>
        );
      }
    },
    {
      key: "suites",
      label: "Suites",
      render: (testCase) => (testCase.suite_ids || (testCase.suite_id ? [testCase.suite_id] : [])).length || 0
    },
    {
      key: "runs",
      label: "Runs",
      render: (testCase) => (historyByCaseId[testCase.id] || []).length
    }
  ], [defaultCaseStatus, historyByCaseId, requirements, stepCountByCaseId]);

  return (
    <Panel
      className="execution-panel suite-design-panel suite-design-panel--cases"
      actions={actions}
      title="Suite cases"
      subtitle={selectedSuite ? `Curated reusable cases inside ${selectedSuite.name}.` : "Showing all reusable cases for the current app type."}
    >
      <div className="suite-design-panel-stack">
        <div className="metric-strip compact">
          <div className="mini-card">
            <strong>{cases.length}</strong>
            <span>Visible cases</span>
          </div>
          <div className="mini-card">
            <strong>{casesWithRequirements}</strong>
            <span>Requirement-linked</span>
          </div>
          <div className="mini-card">
            <strong>{casesWithHistory}</strong>
            <span>Have run history</span>
          </div>
          <div className="mini-card">
            <strong>{selectedSuite ? "Ordered" : "Library"}</strong>
            <span>{selectedSuite ? "Drag cards to reorder the suite" : "View any case in the reusable case viewer"}</span>
          </div>
        </div>

        <div className="design-list-toolbar test-case-catalog-toolbar">
          <CatalogViewToggle onChange={onViewModeChange} value={viewMode} />
          <CatalogSearchFilter
            activeFilterCount={activeFilterCount}
            ariaLabel="Search suite cases"
            onChange={onSearch}
            placeholder="Search title or description"
            subtitle="Filter the case tiles by the same facts shown on each card."
            title="Filter suite cases"
            value={searchTerm}
          >
            <div className="catalog-filter-grid">
              <label className="catalog-filter-field">
                <span>Status</span>
                <select value={statusFilter} onChange={(event) => onStatusFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {formatTileCardLabel(status, "Active")}
                    </option>
                  ))}
                </select>
              </label>

              <label className="catalog-filter-field">
                <span>Priority</span>
                <select value={casePriorityFilter} onChange={(event) => onCasePriorityFilter(event.target.value)}>
                  <option value="all">All priorities</option>
                  {priorityOptions.map((priority) => (
                    <option key={priority} value={priority}>
                      {`P${priority}`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="catalog-filter-field">
                <span>Steps</span>
                <select value={caseStepFilter} onChange={(event) => onCaseStepFilter(event.target.value as SuiteCaseStepFilter)}>
                  <option value="all">All cases</option>
                  <option value="with-steps">With steps</option>
                  <option value="no-steps">Without steps</option>
                </select>
              </label>

              <label className="catalog-filter-field">
                <span>Recent runs</span>
                <select value={caseRunFilter} onChange={(event) => onCaseRunFilter(event.target.value as SuiteCaseRunFilter)}>
                  <option value="all">All cases</option>
                  <option value="with-runs">With recent runs</option>
                  <option value="no-runs">No recent runs</option>
                </select>
              </label>

              <div className="catalog-filter-actions">
                <button
                  className="ghost-button"
                  disabled={!activeFilterCount}
                  onClick={() => {
                    onStatusFilter("all");
                    onCasePriorityFilter("all");
                    onCaseStepFilter("all");
                    onCaseRunFilter("all");
                  }}
                  type="button"
                >
                  Clear filters
                </button>
              </div>
            </div>
          </CatalogSearchFilter>
          <button className="primary-button" onClick={onCreateCase} type="button"><AddIcon />New Test Case</button>
          <button className="ghost-button" disabled={!canOpenCaseEditor} onClick={onOpenCaseEditor} type="button">View Test Case</button>
        </div>

        {selectedSuite ? (
          <div className="detail-summary suite-workspace-card">
            <strong>{selectedSuite.name}</strong>
            <span>Cases stay ordered inside the suite, while each case remains reusable elsewhere.</span>
            <span>
              {Object.keys(selectedSuite.parameter_values || {}).length
                ? `${Object.keys(selectedSuite.parameter_values || {}).length} suite test data value${Object.keys(selectedSuite.parameter_values || {}).length === 1 ? "" : "s"} saved on this suite.`
                : "No suite-level test data saved yet."}
            </span>
          </div>
        ) : null}

        <TileBrowserPane className="test-case-library-scroll">
          {isLoading ? <TileCardSkeletonGrid /> : null}
          {!isLoading && !cases.length ? (
            searchTerm || activeFilterCount ? (
              <div className="empty-state compact">No test cases match this scope yet.</div>
            ) : (
              <div className="empty-state compact">
                <div>No reusable test cases exist in this scope yet.</div>
                <button className="primary-button" onClick={onCreateCase} type="button">Create first case</button>
              </div>
            )
          ) : null}

          {!isLoading && cases.length && viewMode === "tile" ? (
            <div className="tile-browser-grid">
              {cases.map((testCase) => {
                const history = (historyByCaseId[testCase.id] || []).slice(0, 10);
                const latest = history[0];
                const requirement = requirements.find((item) => (testCase.requirement_ids || [testCase.requirement_id]).includes(item.id));
                const stepCount = stepCountByCaseId[testCase.id] || 0;
                const caseStatusValue = latest?.status || testCase.status || defaultCaseStatus;
                const caseStatusLabel = formatTileCardLabel(caseStatusValue, "Active");
                const caseStatusTone = getTileCardTone(caseStatusValue);
                const suiteCount = (testCase.suite_ids || []).length || 0;

                return (
                  <button
                    key={testCase.id}
                    className={[
                      "record-card tile-card test-case-card test-case-catalog-card suite-case-workspace-card",
                      activeCaseId === testCase.id ? "is-active" : ""
                    ].filter(Boolean).join(" ")}
                    onClick={() => onSelectCase(testCase.id)}
                    draggable={Boolean(selectedSuite)}
                    onDragStart={() => setDraggedCaseId(testCase.id)}
                    onDragOver={(event: DragEvent<HTMLButtonElement>) => event.preventDefault()}
                    onDrop={() => {
                      if (selectedSuite && draggedCaseId) {
                        void onReorderCases(draggedCaseId, testCase.id);
                      }
                      setDraggedCaseId("");
                    }}
                    onDragEnd={() => setDraggedCaseId("")}
                    type="button"
                  >
                    {selectedSuite ? <span className="drag-handle" aria-hidden="true">::</span> : null}
                    <div className="tile-card-main">
                      <div className="tile-card-header">
                        <TileCardIconFrame tone={caseStatusTone}>
                          <TileCardCaseIcon />
                        </TileCardIconFrame>
                        <div className="tile-card-title-group">
                          <strong>{testCase.title}</strong>
                          <span className="tile-card-kicker">{requirement?.title || "No requirement linked"}</span>
                        </div>
                        <div className="tile-card-header-meta">
                          <DisplayIdBadge value={testCase.display_id || testCase.id} />
                          <TileCardStatusIndicator title={caseStatusLabel} tone={caseStatusTone} />
                        </div>
                      </div>
                      <p className="tile-card-description">{testCase.description || "No description yet for this test case."}</p>
                      <div className="tile-card-facts" aria-label={`${testCase.title} facts`}>
                        <TileCardFact
                          label={`P${testCase.priority || 3}`}
                          title={`Priority P${testCase.priority || 3}`}
                          tone={(testCase.priority || 3) <= 2 ? "danger" : "info"}
                        >
                          <TileCardPriorityIcon />
                        </TileCardFact>
                        <TileCardFact
                          label={String(stepCount)}
                          title={`${stepCount} step${stepCount === 1 ? "" : "s"}`}
                          tone={stepCount ? "info" : "neutral"}
                        >
                          <TileCardStepsIcon />
                        </TileCardFact>
                        <TileCardFact
                          label={String(suiteCount)}
                          title={`${suiteCount} linked suite${suiteCount === 1 ? "" : "s"}`}
                          tone={suiteCount ? "success" : "neutral"}
                        >
                          <TileCardLinkIcon />
                        </TileCardFact>
                        <TileCardFact
                          label={String(history.length)}
                          title={`${history.length} recent run${history.length === 1 ? "" : "s"}`}
                          tone={history.length ? getTileCardTone(latest?.status || caseStatusValue) : "neutral"}
                        >
                          <TileCardRunsIcon />
                        </TileCardFact>
                      </div>
                      <div className="tile-card-footer">
                        <div className="history-bars" aria-label="Run history">
                          {history.length ? history.map((result) => (
                            <span
                              key={result.id}
                              className={result.status === "passed" ? "history-bar is-passed" : result.status === "failed" ? "history-bar is-failed" : "history-bar is-blocked"}
                              title={`${result.status} · ${result.created_at || "recent"}`}
                            />
                          )) : <span className="history-bar" />}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
          {!isLoading && cases.length && viewMode === "list" ? (
            <DataTable
              columns={suiteCaseListColumns}
              emptyMessage="No test cases match this suite scope."
              getRowClassName={(testCase) => (activeCaseId === testCase.id ? "is-active-row" : "")}
              getRowKey={(testCase) => testCase.id}
              hideToolbarCopy
              onRowClick={(testCase) => onSelectCase(testCase.id)}
              rows={cases}
              storageKey="qaira:suite-cases:list-columns"
            />
          ) : null}
        </TileBrowserPane>
      </div>
    </Panel>
  );
}

function SuiteCaseEditorModal({
  project,
  appType,
  suites,
  selectedSuite,
  requirements,
  selectedTestCase,
  history,
  displaySteps,
  stepDrafts,
  caseDraft,
  defaultCaseStatus,
  isStepCreateVisible,
  newStepDraft,
  draftSteps,
  expandedSections,
  expandedStepIds,
  isCreatingCase,
  isLoadingSteps,
  createPending,
  updatePending,
  deletePending,
  testCaseAutomatedOptions,
  testCaseStatusOptions,
  onCaseDraftChange,
  onClose,
  onCreateStep,
  onCloseStepCreate,
  onDeleteStep,
  onDeleteTestCase,
  onDraftStepChange,
  onDraftStepMove,
  onExpandAllSteps,
  onCollapseAllSteps,
  onNewStepDraftChange,
  onOpenStepCreate,
  onSaveTestCase,
  onStepMove,
  onStepSave,
  onToggleSection,
  onToggleStep
}: {
  project: Project | null;
  appType: AppType | null;
  suites: TestSuite[];
  selectedSuite: TestSuite | null;
  requirements: Requirement[];
  selectedTestCase: TestCase | null;
  history: ExecutionResult[];
  displaySteps: TestStep[];
  stepDrafts: Record<string, StepDraft>;
  caseDraft: CaseDraft;
  defaultCaseStatus: string;
  isStepCreateVisible: boolean;
  newStepDraft: { action: string; expected_result: string };
  draftSteps: DraftTestStep[];
  expandedSections: Record<SuiteCaseEditorSectionKey, boolean>;
  expandedStepIds: string[];
  isCreatingCase: boolean;
  isLoadingSteps: boolean;
  createPending: boolean;
  updatePending: boolean;
  deletePending: boolean;
  testCaseAutomatedOptions: Array<{ value: string; label: string }>;
  testCaseStatusOptions: Array<{ value: string; label: string }>;
  onCaseDraftChange: (value: CaseDraft) => void;
  onClose: () => void;
  onCreateStep: () => void;
  onCloseStepCreate: () => void;
  onDeleteStep: (stepId: string) => void;
  onDeleteTestCase: () => void;
  onDraftStepChange: (stepId: string, input: StepDraft) => void;
  onDraftStepMove: (stepId: string, direction: "up" | "down") => void;
  onExpandAllSteps: () => void;
  onCollapseAllSteps: () => void;
  onNewStepDraftChange: (value: { action: string; expected_result: string }) => void;
  onOpenStepCreate: () => void;
  onSaveTestCase: () => void;
  onStepMove: (stepId: string, direction: "up" | "down") => void;
  onStepSave: (stepId: string, draft: StepDraft) => void;
  onToggleSection: (section: SuiteCaseEditorSectionKey) => void;
  onToggleStep: (stepId: string) => void;
}) {
  const selectedRequirement = requirements.find((item) => item.id === caseDraft.requirement_id) || null;
  const caseSectionSummary = isCreatingCase
    ? caseDraft.title.trim() || "Start the reusable case definition before saving it into the suite workspace."
    : selectedTestCase?.title || "Select a case from the workspace to edit it here.";
  const firstStepPreview = displaySteps[0]?.action || displaySteps[0]?.expected_result || "";
  const stepSectionSummary = firstStepPreview
    ? `Starts with: ${firstStepPreview}`
    : isCreatingCase
      ? "No draft steps added yet."
      : "No steps added yet for this case.";
  const historySectionSummary = history.length
    ? "Review the latest preserved run evidence for this reusable case."
    : "No run history has been recorded yet for this case.";
  const groupedStepCount = displaySteps.filter((step) => Boolean(step.group_id)).length;
  const sharedGroupCount = new Set(
    displaySteps
      .filter((step) => step.group_kind === "reusable" && step.group_id)
      .map((step) => step.group_id as string)
  ).size;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-labelledby="suite-case-editor-title"
        aria-modal="true"
        className="modal-card suite-test-case-editor-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="suite-test-case-editor-header">
          <div className="suite-test-case-editor-title">
            <p className="eyebrow">Test Suites</p>
            <h3 id="suite-case-editor-title">{isCreatingCase ? "Create test case" : selectedTestCase ? `Edit ${selectedTestCase.title}` : "Test case editor"}</h3>
            <p>Use the modal for focused edits, then return to the three-panel suite workspace without losing your place.</p>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">Close</button>
        </div>

        <div className="suite-test-case-editor-body">
          <div className="detail-summary">
            <strong>{selectedTestCase?.title || (isCreatingCase ? "New test case" : "No test case selected")}</strong>
            <span>{project?.name || "No project"} · {appType?.name || "No app type"}</span>
            <span>Suite context: {selectedSuite?.name || caseDraft.suite_id || "All suites"}</span>
          </div>

          <div className="metric-strip compact">
            <div className="mini-card">
              <strong>{selectedTestCase?.suite_ids?.length || (caseDraft.suite_id ? 1 : 0)}</strong>
              <span>Linked suites</span>
            </div>
            <div className="mini-card">
              <strong>{history.length}</strong>
              <span>Run records</span>
            </div>
            <div className="mini-card">
              <strong>{displaySteps.length}</strong>
              <span>{isCreatingCase ? "Draft steps" : "Defined steps"}</span>
            </div>
            <div className="mini-card">
              <strong>{selectedRequirement ? "Linked" : "Open"}</strong>
              <span>{selectedRequirement?.title || "Requirement not linked yet"}</span>
            </div>
          </div>

          <div className="editor-accordion">
            <EditorAccordionSection
              countLabel={isCreatingCase ? "Draft" : caseDraft.status || defaultCaseStatus}
              isExpanded={expandedSections.case}
              onToggle={() => onToggleSection("case")}
              summary={caseSectionSummary}
              title={isCreatingCase ? "New test case" : "Selected test case"}
            >
              <form
                className="form-grid"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  onSaveTestCase();
                }}
              >
                <div className="record-grid">
                  <FormField label="Title" required>
                    <input
                      required
                      value={caseDraft.title}
                      onChange={(event) => onCaseDraftChange({ ...caseDraft, title: event.target.value })}
                    />
                  </FormField>
                  <FormField label="Suite">
                    <select value={caseDraft.suite_id} onChange={(event) => onCaseDraftChange({ ...caseDraft, suite_id: event.target.value })}>
                      {suites.map((suite) => (
                        <option key={suite.id} value={suite.id}>{suite.name}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Status">
                    <select value={caseDraft.status} onChange={(event) => onCaseDraftChange({ ...caseDraft, status: event.target.value })}>
                      {testCaseStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Automated">
                    <select value={caseDraft.automated} onChange={(event) => onCaseDraftChange({ ...caseDraft, automated: event.target.value as "yes" | "no" })}>
                      {testCaseAutomatedOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Priority">
                    <input
                      min="1"
                      max="5"
                      type="number"
                      value={caseDraft.priority}
                      onChange={(event) => onCaseDraftChange({ ...caseDraft, priority: event.target.value || "3" })}
                    />
                  </FormField>
                  <FormField label="Requirement">
                    <select value={caseDraft.requirement_id} onChange={(event) => onCaseDraftChange({ ...caseDraft, requirement_id: event.target.value })}>
                      <option value="">No requirement</option>
                      {requirements.map((requirement) => (
                        <option key={requirement.id} value={requirement.id}>{requirement.title}</option>
                      ))}
                    </select>
                  </FormField>
                </div>

                <FormField label="Description">
                  <textarea
                    rows={4}
                    value={caseDraft.description}
                    onChange={(event) => onCaseDraftChange({ ...caseDraft, description: event.target.value })}
                  />
                </FormField>

                <div className="detail-summary">
                  <strong>{isCreatingCase ? "Create with steps attached" : "Live case definition"}</strong>
                  <span>{isCreatingCase ? `This test case will be saved with ${displaySteps.length} draft step${displaySteps.length === 1 ? "" : "s"} attached.` : "Edits here update the reusable test case while historical run evidence stays preserved."}</span>
                </div>

                <div className="action-row">
                  <button className="primary-button" disabled={createPending || updatePending} type="submit">
                    {isCreatingCase ? (createPending ? "Creating…" : "Create test case") : (updatePending ? "Saving…" : "Save test case")}
                  </button>
                  {!isCreatingCase && selectedTestCase ? (
                    <button className="ghost-button danger" disabled={deletePending} onClick={onDeleteTestCase} type="button">Delete test case</button>
                  ) : null}
                </div>
              </form>
            </EditorAccordionSection>

            <EditorAccordionSection
              countLabel={`${displaySteps.length} step${displaySteps.length === 1 ? "" : "s"}`}
              isExpanded={expandedSections.steps}
              onToggle={() => onToggleSection("steps")}
              summary={stepSectionSummary}
              title={isCreatingCase ? "Draft steps" : "Test steps"}
            >
              <div className="step-editor step-editor--embedded">
                {!isCreatingCase && displaySteps.length ? (
                  <div className="action-row">
                    <button className="ghost-button" onClick={onExpandAllSteps} type="button">
                      Expand all
                    </button>
                    <button className="ghost-button" onClick={onCollapseAllSteps} type="button">
                      Collapse all
                    </button>
                  </div>
                ) : null}

                {groupedStepCount ? (
                  <div className="detail-summary">
                    <strong>{groupedStepCount} grouped step{groupedStepCount === 1 ? "" : "s"} in this case</strong>
                    <span>{sharedGroupCount ? `${sharedGroupCount} linked shared group${sharedGroupCount === 1 ? "" : "s"} appear in this suite editor.` : "Local step group metadata is preserved in this suite editor."}</span>
                  </div>
                ) : null}

                {!isCreatingCase && isLoadingSteps ? <div className="empty-state compact">Loading steps…</div> : null}
                {!displaySteps.length ? (
                  <div className="empty-state compact">
                    <div>{isCreatingCase ? "No draft steps yet. Add steps below before you save if this case needs a guided run flow." : "No steps yet for this test case."}</div>
                    {!isStepCreateVisible ? <button className="ghost-button" onClick={onOpenStepCreate} type="button">Add first step</button> : null}
                  </div>
                ) : null}

                <div className="step-list">
                  {isCreatingCase
                    ? draftSteps.map((step, index) => (
                        <DraftStepCard
                          isExpanded={expandedStepIds.includes(step.id)}
                          canMoveDown={index < draftSteps.length - 1}
                          canMoveUp={index > 0}
                          key={step.id}
                          onChange={(input) => onDraftStepChange(step.id, input)}
                          onDelete={() => onDeleteStep(step.id)}
                          onMoveDown={() => onDraftStepMove(step.id, "down")}
                          onMoveUp={() => onDraftStepMove(step.id, "up")}
                          onToggle={() => onToggleStep(step.id)}
                          step={{ ...step, step_order: index + 1 }}
                        />
                      ))
                    : displaySteps.map((step, index) => (
                        <EditableStepCard
                          key={step.id}
                          canMoveDown={index < displaySteps.length - 1}
                          canMoveUp={index > 0}
                          isExpanded={expandedStepIds.includes(step.id)}
                          onDelete={() => onDeleteStep(step.id)}
                          onMoveDown={() => onStepMove(step.id, "down")}
                          onMoveUp={() => onStepMove(step.id, "up")}
                          onSave={(input) => onStepSave(step.id, input)}
                          onToggle={() => onToggleStep(step.id)}
                          step={step}
                          stepDraft={stepDrafts[step.id]}
                        />
                      ))}
                </div>

                {!isStepCreateVisible && displaySteps.length ? (
                  <div className="action-row">
                    <button className="ghost-button" onClick={onOpenStepCreate} type="button">
                      + Add Step
                    </button>
                  </div>
                ) : (
                  <form
                    className="step-create"
                    onSubmit={(event: FormEvent<HTMLFormElement>) => {
                      event.preventDefault();
                      onCreateStep();
                    }}
                  >
                    <strong>+ Add Step</strong>
                    <FormField label="Action">
                      <input
                        value={newStepDraft.action}
                        onChange={(event) => onNewStepDraftChange({ ...newStepDraft, action: event.target.value })}
                      />
                    </FormField>
                    <FormField label="Expected result">
                      <textarea
                        rows={3}
                        value={newStepDraft.expected_result}
                        onChange={(event) => onNewStepDraftChange({ ...newStepDraft, expected_result: event.target.value })}
                      />
                    </FormField>
                    <div className="action-row">
                      <button className="primary-button" type="submit">Add step</button>
                      <button className="ghost-button" onClick={onCloseStepCreate} type="button">
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </EditorAccordionSection>

            {!isCreatingCase ? (
              <EditorAccordionSection
                countLabel={`${history.length} record${history.length === 1 ? "" : "s"}`}
                isExpanded={expandedSections.history}
                onToggle={() => onToggleSection("history")}
                summary={historySectionSummary}
                title="Run history"
              >
                <div className="step-editor step-history">
                  <div className="stack-list">
                    {history.map((result) => (
                      <div className="stack-item" key={result.id}>
                        <div>
                          <strong>{result.test_case_title || selectedTestCase?.title || "Run record"}</strong>
                          <span>{result.error || result.logs || result.created_at || "Historical run evidence retained."}</span>
                        </div>
                        <StatusBadge value={result.status} />
                      </div>
                    ))}
                    {!history.length ? <div className="empty-state compact">No run history yet for this test case.</div> : null}
                  </div>
                </div>
              </EditorAccordionSection>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function EditorAccordionSection({
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
    <section className={isExpanded ? "editor-accordion-section is-expanded" : "editor-accordion-section"}>
      <button
        aria-expanded={isExpanded}
        className="editor-accordion-toggle"
        onClick={onToggle}
        type="button"
      >
        <div className="editor-accordion-toggle-main">
          <span aria-hidden="true" className={isExpanded ? "editor-accordion-icon is-expanded" : "editor-accordion-icon"}>
            <EditorAccordionChevronIcon />
          </span>
          <div className="editor-accordion-toggle-copy">
            <strong>{title}</strong>
            <span>{summary}</span>
          </div>
        </div>
        <div className="editor-accordion-toggle-meta">
          <span className="editor-accordion-toggle-count">{countLabel}</span>
          <span className="editor-accordion-toggle-state">{isExpanded ? "Collapse" : "Expand"}</span>
        </div>
      </button>
      {isExpanded ? <div className="editor-accordion-body">{children}</div> : null}
    </section>
  );
}

function EditorAccordionChevronIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function StepKebabIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </svg>
  );
}

function EditableStepCard({
  step,
  stepDraft,
  isExpanded,
  canMoveUp,
  canMoveDown,
  onSave,
  onDelete,
  onToggle,
  onMoveUp,
  onMoveDown
}: {
  step: TestStep;
  stepDraft?: StepDraft;
  isExpanded: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSave: (input: StepDraft) => void;
  onDelete: () => void;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [draft, setDraft] = useState<StepDraft>({
    action: stepDraft?.action || step.action || "",
    expected_result: stepDraft?.expected_result || step.expected_result || ""
  });
  const stepKind = getSuiteStepKindMeta(step.group_kind);

  useEffect(() => {
    setDraft({
      action: stepDraft?.action || step.action || "",
      expected_result: stepDraft?.expected_result || step.expected_result || ""
    });
  }, [step.action, step.expected_result, step.id, stepDraft?.action, stepDraft?.expected_result]);

  return (
    <article
      className={[
        isExpanded ? "step-card is-expanded" : "step-card",
        step.group_kind === "reusable" ? "step-card--shared" : "",
        step.group_kind === "local" ? "step-card--grouped" : ""
      ].filter(Boolean).join(" ")}
    >
      <button
        aria-label={isExpanded ? `Hide step ${step.step_order} details` : `Show step ${step.step_order} details`}
        className="step-card-toggle"
        onClick={onToggle}
        type="button"
      >
        <div className="step-card-summary">
          <div className="step-card-summary-top">
            <StepKindIconBadge kind={step.group_kind} label={stepKind.label} tone={stepKind.tone} />
            <strong>Step {step.step_order}</strong>
          </div>
          {step.group_name ? <small className="suite-step-group-note">{step.group_name}</small> : null}
          <span>{draft.action || "No action written yet"}</span>
        </div>
        <span aria-hidden="true" className="step-card-toggle-state">
          <StepKebabIcon />
        </span>
      </button>

      {isExpanded ? (
        <div className="step-card-body">
          <FormField label="Action">
            <input value={draft.action} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))} />
          </FormField>
          <FormField label="Expected result">
            <textarea rows={3} value={draft.expected_result} onChange={(event) => setDraft((current) => ({ ...current, expected_result: event.target.value }))} />
          </FormField>
          <div className="action-row">
            <button className="ghost-button" disabled={!canMoveUp} onClick={onMoveUp} type="button">Move up</button>
            <button className="ghost-button" disabled={!canMoveDown} onClick={onMoveDown} type="button">Move down</button>
            <button className="primary-button" onClick={() => onSave(draft)} type="button">Save step</button>
            <button className="ghost-button danger" onClick={onDelete} type="button">Delete step</button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function DraftStepCard({
  step,
  isExpanded,
  canMoveUp,
  canMoveDown,
  onChange,
  onDelete,
  onToggle,
  onMoveUp,
  onMoveDown
}: {
  step: { step_order: number; action: string; expected_result: string; group_id?: string | null; group_name?: string | null; group_kind?: "local" | "reusable" | null; reusable_group_id?: string | null };
  isExpanded: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (input: StepDraft) => void;
  onDelete: () => void;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const stepKind = getSuiteStepKindMeta(step.group_kind);

  return (
    <article
      className={[
        isExpanded ? "step-card is-expanded" : "step-card",
        step.group_kind === "reusable" ? "step-card--shared" : "",
        step.group_kind === "local" ? "step-card--grouped" : ""
      ].filter(Boolean).join(" ")}
    >
      <div className="step-card-top">
        <button
          aria-label={isExpanded ? `Hide step ${step.step_order} details` : `Show step ${step.step_order} details`}
          className="step-card-toggle"
          onClick={onToggle}
          type="button"
        >
          <div className="step-card-summary">
            <div className="step-card-summary-top">
              <StepKindIconBadge kind={step.group_kind} label={stepKind.label} tone={stepKind.tone} />
              <strong>Step {step.step_order}</strong>
            </div>
            {step.group_name ? <small className="suite-step-group-note">{step.group_name}</small> : null}
            <span>{step.action || step.expected_result || "Draft step details"}</span>
          </div>
          <span aria-hidden="true" className="step-card-toggle-state">
            <StepKebabIcon />
          </span>
        </button>
      </div>

      {isExpanded ? (
        <div className="step-card-body">
          <FormField label="Action">
            <input
              value={step.action}
              onChange={(event) => onChange({ action: event.target.value, expected_result: step.expected_result })}
            />
          </FormField>
          <FormField label="Expected result">
            <textarea
              rows={3}
              value={step.expected_result}
              onChange={(event) => onChange({ action: step.action, expected_result: event.target.value })}
            />
          </FormField>
          <div className="action-row">
            <button className="ghost-button" disabled={!canMoveUp} onClick={onMoveUp} type="button">Move up</button>
            <button className="ghost-button" disabled={!canMoveDown} onClick={onMoveDown} type="button">Move down</button>
            <button className="ghost-button danger" onClick={onDelete} type="button">Delete step</button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function SuiteExecutionModal({
  scopeSuites,
  selectedProject,
  selectedAppType,
  appTypeId,
  projectId,
  selectedSuiteIds,
  executionName,
  selectedAssigneeId,
  assigneeOptions,
  selectedEnvironmentId,
  selectedConfigurationId,
  selectedDataSetId,
  canCreateExecution,
  isSubmitting,
  onAssigneeChange,
  onEnvironmentChange,
  onConfigurationChange,
  onDataSetChange,
  onExecutionNameChange,
  onSuiteSelectionChange,
  onClose,
  onSubmit
}: {
  scopeSuites: TestSuite[];
  selectedProject: string;
  selectedAppType: string;
  appTypeId: string;
  projectId: string;
  selectedSuiteIds: string[];
  executionName: string;
  selectedAssigneeId: string;
  assigneeOptions: SuiteExecutionAssigneeOption[];
  selectedEnvironmentId: string;
  selectedConfigurationId: string;
  selectedDataSetId: string;
  canCreateExecution: boolean;
  isSubmitting: boolean;
  onAssigneeChange: (value: string) => void;
  onEnvironmentChange: (value: string) => void;
  onConfigurationChange: (value: string) => void;
  onDataSetChange: (value: string) => void;
  onExecutionNameChange: (value: string) => void;
  onSuiteSelectionChange: (nextIds: string[]) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={() => !isSubmitting && onClose()} role="presentation">
      <div
        aria-labelledby="create-suite-execution-title"
        aria-modal="true"
        className="modal-card execution-create-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <form className="execution-create-form" onSubmit={onSubmit}>
          <div className="execution-create-header">
            <div className="execution-create-title">
              <p className="eyebrow">Suites</p>
              <h3 id="create-suite-execution-title">Create run</h3>
              <p>Use the suites you selected here as the run snapshot scope.</p>
            </div>
            <button
              aria-label="Close create run dialog"
              className="ghost-button"
              disabled={isSubmitting}
              onClick={onClose}
              type="button"
            >
              Close
            </button>
          </div>

          <div className="execution-create-body">
            <div className="execution-create-grid">
              <FormField label="Run name">
                <input
                  autoFocus
                  placeholder="Optional run name"
                  value={executionName}
                  onChange={(event) => onExecutionNameChange(event.target.value)}
                />
              </FormField>
              <FormField label="Assign to" hint="Sets the default owner for this run and the test cases snapped into it.">
                <select
                  disabled={!projectId || !assigneeOptions.length}
                  value={selectedAssigneeId}
                  onChange={(event) => onAssigneeChange(event.target.value)}
                >
                  <option value="">
                    {!projectId ? "Select a project first" : assigneeOptions.length ? "Unassigned" : "No project members available"}
                  </option>
                  {assigneeOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.caption ? `${option.label} · ${option.caption}` : option.label}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>

            <div className="detail-summary">
              <strong>{selectedProject || "Select a project to continue"}</strong>
              <span>{selectedAppType ? `${selectedAppType} app type selected for this snapshot.` : "Choose an app type to load suite scope."}</span>
              <span>{scopeSuites.length ? `${scopeSuites.length} suites available in the current scope.` : "No suites available in the current scope yet."}</span>
            </div>

            <ExecutionContextSelector
              appTypeId={appTypeId}
              onConfigurationChange={onConfigurationChange}
              onDataSetChange={onDataSetChange}
              onEnvironmentChange={onEnvironmentChange}
              prefillFirstAvailable={true}
              projectId={projectId}
              selectedConfigurationId={selectedConfigurationId}
              selectedDataSetId={selectedDataSetId}
              selectedEnvironmentId={selectedEnvironmentId}
            />

            <FormField label="Suite scope" required>
              <div className="suite-modal-picker-shell suite-modal-picker-shell--scope">
                <SuiteScopePicker
                  description="Select the suites to snapshot for this run, then adjust their order if you need a different run sequence."
                  emptyMessage="No suites available for this app type yet."
                  heading="Available suites"
                  onChange={onSuiteSelectionChange}
                  selectedSuiteIds={selectedSuiteIds}
                  suites={scopeSuites}
                />
              </div>
            </FormField>

            {!scopeSuites.length && selectedAppType ? <div className="empty-state compact">No suites available for this app type. Create a suite first.</div> : null}
          </div>

          <div className="action-row execution-create-actions">
            <button className="primary-button" disabled={!canCreateExecution || isSubmitting} type="submit">
              {isSubmitting ? "Creating…" : "Create run"}
            </button>
            <button className="ghost-button" disabled={isSubmitting} onClick={onClose} type="button">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SuiteModal({
  mode,
  suite,
  suites,
  appTypeCases,
  selectedCaseIds,
  onClose,
  onSubmit,
  isSaving
}: {
  mode: SuiteModalMode;
  suite: TestSuite | null;
  suites: TestSuite[];
  appTypeCases: TestCase[];
  selectedCaseIds: string[];
  onClose: () => void;
  onSubmit: (input: { name: string; parent_id?: string; selectedIds: string[] }) => void;
  isSaving: boolean;
}) {
  const availableCaseIdSet = useMemo(
    () => new Set(appTypeCases.map((testCase) => testCase.id)),
    [appTypeCases]
  );
  const initialSelectedIds = useMemo(
    () => selectedCaseIds.filter((testCaseId) => availableCaseIdSet.has(testCaseId)),
    [availableCaseIdSet, selectedCaseIds]
  );

  const [name, setName] = useState(() => (mode === "edit" && suite ? suite.name : ""));
  const [parentId, setParentId] = useState(() => (mode === "edit" && suite ? suite.parent_id || "" : ""));
  const [localSelectedIds, setLocalSelectedIds] = useState<string[]>(() => initialSelectedIds);
  const initialSelectedIdsKey = initialSelectedIds.join("::");

  useEffect(() => {
    if (mode === "edit" && suite) {
      setName(suite.name);
      setParentId(suite.parent_id || "");
      setLocalSelectedIds(initialSelectedIds);
      return;
    }

    setLocalSelectedIds((current) => current.filter((testCaseId) => availableCaseIdSet.has(testCaseId)));
  }, [availableCaseIdSet, initialSelectedIdsKey, mode, suite?.id, suite?.name, suite?.parent_id]);

  return (
    <div className="modal-backdrop" onClick={() => !isSaving && onClose()} role="presentation">
      <div
        className="modal-card suite-create-modal"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "edit" ? "Edit suite" : "Create suite"}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="suite-create-header">
          <div className="suite-create-title">
            <h3>{mode === "edit" ? "Edit Suite" : "Create Suite"}</h3>
            <p>Choose the reusable cases once, keep their saved order with the arrow controls, and submit from this modal.</p>
          </div>
          <button className="ghost-button" disabled={isSaving} onClick={onClose} type="button">
            Close
          </button>
        </div>

        <form
          className="form-grid suite-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit({
              name,
              parent_id: parentId || undefined,
              selectedIds: localSelectedIds
            });
          }}
        >
          <div className="suite-modal-body">
            <div className="record-grid suite-modal-config-grid">
              <FormField label="Suite name">
                <input autoFocus required value={name} onChange={(event) => setName(event.target.value)} />
              </FormField>
              <FormField label="Parent suite">
                <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
                  <option value="">None</option>
                  {suites
                    .filter((item) => item.id !== suite?.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                </select>
              </FormField>
            </div>

            <div className="suite-modal-picker-shell">
              <SuiteCasePicker
                cases={appTypeCases}
                description="Check the cases that belong in this suite, then use the up and down arrows to set the saved order."
                emptyMessage="No test cases available in this app type yet."
                heading="App type test cases"
                onChange={setLocalSelectedIds}
                selectedCaseIds={localSelectedIds}
              />
            </div>
          </div>

          <div className="action-row suite-modal-actions">
            <button className="primary-button" disabled={isSaving} type="submit">
              {isSaving ? "Saving…" : mode === "edit" ? "Save Suite" : "Create Suite"}
            </button>
            <button className="ghost-button" disabled={isSaving} onClick={onClose} type="button">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
