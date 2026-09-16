import { Fragment, FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AddIcon, CollapseExpandIcon, LayersIcon, OpenIcon, SelectionToggleIcon, SparkIcon, TrashIcon } from "../components/AppIcons";
import { CatalogActionMenu } from "../components/CatalogActionMenu";
import { CatalogSelectionControls } from "../components/CatalogSelectionControls";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { CatalogViewToggle } from "../components/CatalogViewToggle";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { DisplayIdBadge } from "../components/DisplayIdBadge";
import { EntityIdBadge } from "../components/EntityIdBadge";
import { FormField } from "../components/FormField";
import { InfoTooltip } from "../components/InfoTooltip";
import { LinkedTestCaseModal } from "../components/LinkedTestCaseModal";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { RichTextContent, RichTextEditor, richTextToPlainText } from "../components/RichTextEditor";
import { SharedStepGherkinEditor } from "../components/SharedStepGherkinEditor";
import { StepParameterDialog } from "../components/StepParameterDialog";
import { StepParameterizedText } from "../components/StepParameterizedText";
import {
  StandardStepIcon,
  StepTypePickerButton
} from "../components/StepAutomationEditor";
import { SharedStepsIcon as SharedStepsIconGraphic } from "../components/SharedStepsIcon";
import { StatusBadge } from "../components/StatusBadge";
import { TileCardLinkIcon, TileCardMetric, TileCardProgress } from "../components/TileCardPrimitives";
import { TileBrowserPane } from "../components/TileBrowserPane";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { ToastMessage } from "../components/ToastMessage";
import { VisualTestBuilder } from "../components/VisualTestBuilder";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
import { useDeleteConfirmation } from "../components/DeleteConfirmationDialog";
import { useCurrentAppType, useCurrentProject } from "../hooks/useCurrentProject";
import { useCapabilityAccess } from "../hooks/useCapabilityAccess";
import { useWorkspaceResource } from "../hooks/useWorkspaceData";
import { api } from "../lib/api";
import { formatAuditTimestamp, resolveAuditUserLabel } from "../lib/auditDisplay";
import { asArray } from "../lib/collectionGuards";
import { selectLatestExecutionResultInstances } from "../lib/executionResultMetrics";
import { readDefaultCatalogViewMode } from "../lib/viewPreferences";
import { composeSharedStepGherkin, mergeGherkinStepMetadata, parseSharedStepGherkin, sharedStepGherkinToStructuredSteps, structuredStepsToSharedGherkin } from "../lib/gherkin";
import { removeSharedStepGroupFromCache, upsertSharedStepGroupInCache } from "../lib/sharedStepGroupCache";
import { findByRoutableId, getRoutableId } from "../lib/urlSelection";
import {
  normalizeStepType
} from "../lib/stepAutomation";
import { collectStepParameters, filterStepParameterValues, normalizeStepParameterValues, type StepParameterDefinition } from "../lib/stepParameters";
import type { ExecutionResult, SharedStepGroup, TestCase, TestStep, User } from "../types";

type SharedGroupDraftStep = {
  id: string;
  action: string;
  expected_result: string;
  step_type: SharedStepGroup["steps"][number]["step_type"];
  automation_code: string;
  api_request: SharedStepGroup["steps"][number]["api_request"];
};

type CopiedSharedGroupStep = SharedGroupDraftStep;

type SharedGroupDraft = {
  name: string;
  description: string;
  authoring_mode: "structured" | "gherkin";
  gherkin_document: string;
  steps: SharedGroupDraftStep[];
};

type SharedGroupStepInput = Pick<SharedGroupDraftStep, "action" | "expected_result" | "step_type" | "automation_code" | "api_request">;

type SharedGroupStepActionMenuAction = {
  label: string;
  description?: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger" | "primary";
};

const EMPTY_GROUP_DRAFT: SharedGroupDraft = {
  name: "",
  description: "",
  authoring_mode: "structured",
  gherkin_document: "",
  steps: []
};

const EMPTY_SHARED_GROUP_STEP_INPUT: SharedGroupStepInput = {
  action: "",
  expected_result: "",
  step_type: "web",
  automation_code: "",
  api_request: null
};

const createDraftStepId = () =>
  globalThis.crypto?.randomUUID?.() || `shared-step-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createEmptyDraftStep = (): SharedGroupDraftStep => ({
  id: createDraftStepId(),
  action: "",
  expected_result: "",
  step_type: "web",
  automation_code: "",
  api_request: null
});

const cloneSharedGroupStep = (
  step: Pick<SharedGroupDraftStep, "action" | "expected_result" | "step_type" | "automation_code" | "api_request">
): SharedGroupDraftStep => ({
  id: createDraftStepId(),
  action: step.action,
  expected_result: step.expected_result,
  step_type: normalizeStepType(step.step_type),
  automation_code: "",
  api_request: null
});

const draftFromGroup = (group: SharedStepGroup): SharedGroupDraft => ({
  name: group.name,
  description: group.description || "",
  authoring_mode: group.authoring_mode === "gherkin" ? "gherkin" : "structured",
  gherkin_document: composeSharedStepGherkin(parseSharedStepGherkin(group.gherkin_document || structuredStepsToSharedGherkin(asArray(group.steps)))),
  steps: asArray(group.steps).map((step) => ({
    id: step.id || createDraftStepId(),
    action: step.action || "",
    expected_result: step.expected_result || "",
    step_type: normalizeStepType(step.step_type),
    automation_code: "",
    api_request: null
  }))
});

const normalizeGroupSteps = (steps: SharedGroupDraftStep[]) =>
  steps
    .map((step, index) => ({
      id: step.id,
      step_order: index + 1,
      action: step.action.trim(),
      expected_result: step.expected_result.trim(),
      step_type: normalizeStepType(step.step_type)
    }))
    .filter((step) => step.action || step.expected_result);

const sharedStepDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric"
});

const formatSharedStepDate = (value?: string) => {
  if (!value) {
    return "Recently updated";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : sharedStepDateFormatter.format(parsed);
};

const aggregateRunStatus = (
  current: ExecutionResult["status"] | undefined,
  next: ExecutionResult["status"]
): ExecutionResult["status"] => {
  if (current === "failed" || next === "failed") {
    return "failed";
  }

  if (current === "blocked" || next === "blocked") {
    return "blocked";
  }

  if (current === "running" || next === "running") {
    return "running";
  }

  return "passed";
};

export function SharedStepsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [projectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const { can } = useCapabilityAccess(projectId);
  const canManageSharedStepGroups = can("shared_step.manage");
  const canUseSharedStepAi = canManageSharedStepGroups && can("testcase.ai");
  const canViewTestCases = can("testcase.view");
  const canViewRunHistory = can("result.view");
  const canViewAppTypes = can("app_type.view");
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [catalogViewMode, setCatalogViewMode] = useState<"tile" | "list">(() => readDefaultCatalogViewMode());
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [expandedWorkspaceSections, setExpandedWorkspaceSections] = useState({
    details: true,
    steps: true
  });
  const [groupDraft, setGroupDraft] = useState<SharedGroupDraft>(EMPTY_GROUP_DRAFT);
  const [stepInsertIndex, setStepInsertIndex] = useState<number | null>(null);
  const [newStepDraft, setNewStepDraft] = useState<SharedGroupStepInput>(EMPTY_SHARED_GROUP_STEP_INPUT);
  const [expandedStepIds, setExpandedStepIds] = useState<string[]>([]);
  const [linkedPreviewCaseId, setLinkedPreviewCaseId] = useState("");
  const [selectedStepIds, setSelectedStepIds] = useState<string[]>([]);
  const [copiedSteps, setCopiedSteps] = useState<CopiedSharedGroupStep[]>([]);
  const [cutStepIds, setCutStepIds] = useState<string[]>([]);
  const [isParameterDialogOpen, setIsParameterDialogOpen] = useState(false);
  const [sharedParameterValues, setSharedParameterValues] = useState<Record<string, string>>({});
  const [isUsageDialogOpen, setIsUsageDialogOpen] = useState(false);
  const [isImprovingSteps, setIsImprovingSteps] = useState(false);
  const [isVisualBuilderActive, setIsVisualBuilderActive] = useState(false);
  const closingWorkspaceRef = useRef(false);

  const projectsQuery = useQuery({
    queryKey: ["projects", "workspace-scopes", JSON.stringify([session?.user.id, session?.user.role, session?.user.role_id, session?.user.status, session?.user.permissions, session?.user.workspace_permissions, session?.user.project_permissions])],
    queryFn: ({ signal }) => api.metadata.workspaceScopes({ signal }),
    select: (data) => data.projects,
    enabled: can("workspace.view")
  });
  const appTypesQuery = useWorkspaceResource(
    ["app-types", projectId], signal => api.appTypes.list({ project_id: projectId }, { signal }),
    canViewAppTypes, Boolean(projectId)
  );
  const sharedGroupsQuery = useWorkspaceResource(
    ["shared-step-groups", appTypeId], signal => api.sharedStepGroups.list({ app_type_id: appTypeId }, { signal }),
    can("shared_step.view"), Boolean(appTypeId)
  );
  const requirementsQuery = useWorkspaceResource(
    ["shared-steps-requirements", projectId], signal => api.requirements.list({ project_id: projectId }, { signal }),
    can("requirement.view"), Boolean(projectId && linkedPreviewCaseId)
  );
  const testCasesQuery = useWorkspaceResource(
    ["shared-steps-test-cases", appTypeId], signal => api.testCases.list({ app_type_id: appTypeId }, { signal }),
    canViewTestCases, Boolean(appTypeId && linkedPreviewCaseId)
  );
  const executionResultsQuery = useWorkspaceResource(
    ["shared-steps-execution-results", appTypeId, "summary"], signal => api.executionResults.list({ project_id: projectId, app_type_id: appTypeId, limit: 5000, projection: "summary" }, { signal }),
    canViewRunHistory, Boolean(appTypeId)
  );
  const suitesQuery = useWorkspaceResource(
    ["shared-steps-test-suites", appTypeId], signal => api.testSuites.list({ app_type_id: appTypeId }, { signal }),
    can("suite.view"), Boolean(appTypeId && linkedPreviewCaseId)
  );
  const usersQuery = useWorkspaceResource(
    ["users", projectId], signal => api.users.list({ signal }), can("user.view"), true
  );

  const createSharedGroup = useMutation({ mutationFn: api.sharedStepGroups.create });
  const updateSharedGroup = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.sharedStepGroups.update>[1] }) =>
      api.sharedStepGroups.update(id, input)
  });
  const deleteSharedGroup = useMutation({ mutationFn: api.sharedStepGroups.delete });

  const projects = asArray(projectsQuery.data);
  const appTypes = asArray(appTypesQuery.data);
  const sharedGroups = asArray(sharedGroupsQuery.data);
  const requirements = asArray(requirementsQuery.data);
  const testCases = asArray(testCasesQuery.data);
  const executionResults = asArray(executionResultsQuery.data);
  const suites = asArray(suitesQuery.data);
  const users = asArray<User>(usersQuery.data);
  const userById = useMemo(
    () =>
      users.reduce<Record<string, User>>((accumulator, user) => {
        accumulator[user.id] = user;
        return accumulator;
      }, {}),
    [users]
  );

  const resetStepComposer = () => {
    setStepInsertIndex(null);
    setNewStepDraft(EMPTY_SHARED_GROUP_STEP_INPUT);
  };

  useEffect(() => {
    if (!canViewAppTypes || appTypesQuery.isPending || appTypesQuery.isError) {
      return;
    }

    const scopedAppTypes = projectId
      ? appTypes.filter((appType) => String(appType.project_id) === String(projectId))
      : appTypes;

    if (projectId && appTypes.length && !scopedAppTypes.length) {
      return;
    }

    if (!scopedAppTypes.length) {
      setAppTypeId("");
      return;
    }

    if (!scopedAppTypes.some((appType) => appType.id === appTypeId)) {
      setAppTypeId(scopedAppTypes[0].id);
    }
  }, [appTypeId, appTypes, appTypesQuery.isPending, appTypesQuery.isError, canViewAppTypes, projectId, setAppTypeId]);

  useEffect(() => {
    setSelectedGroupId("");
    setSelectedGroupIds([]);
    setIsCreating(false);
    setGroupDraft(EMPTY_GROUP_DRAFT);
    setExpandedStepIds([]);
    setSelectedStepIds([]);
    setCutStepIds([]);
    setSharedParameterValues({});
    setIsParameterDialogOpen(false);
    setIsUsageDialogOpen(false);
    setIsVisualBuilderActive(false);
    resetStepComposer();
  }, [appTypeId]);

  useEffect(() => {
    const nextStepIds = groupDraft.steps.map((step) => step.id);

    setExpandedStepIds((current) => {
      const nextExpandedIds = current.filter((id) => nextStepIds.includes(id));
      return nextExpandedIds.length === current.length ? current : nextExpandedIds;
    });
  }, [groupDraft.steps]);

  useEffect(() => {
    const validStepIds = new Set(groupDraft.steps.map((step) => step.id));
    setSelectedStepIds((current) => current.filter((id) => validStepIds.has(id)));
    setCutStepIds((current) => current.filter((id) => validStepIds.has(id)));
  }, [groupDraft.steps]);

  useEffect(() => {
    setSharedParameterValues({});
    setIsParameterDialogOpen(false);
    setIsUsageDialogOpen(false);
    setIsVisualBuilderActive(false);
  }, [isCreating, selectedGroupId]);

  useEffect(() => {
    setExpandedWorkspaceSections({
      details: true,
      steps: true
    });
  }, [isCreating, selectedGroupId]);

  const selectedGroup = useMemo(
    () => sharedGroups.find((group) => group.id === selectedGroupId) || null,
    [selectedGroupId, sharedGroups]
  );

  const authoredSharedSteps = useMemo<SharedGroupDraftStep[]>(() => {
    if (groupDraft.authoring_mode !== "gherkin") return groupDraft.steps;
    return mergeGherkinStepMetadata(sharedStepGherkinToStructuredSteps(groupDraft.gherkin_document), groupDraft.steps, createEmptyDraftStep);
  }, [groupDraft.authoring_mode, groupDraft.gherkin_document, groupDraft.steps]);

  const visualSharedSteps = useMemo<TestStep[]>(
    () =>
      authoredSharedSteps.map((step, index) => ({
        id: step.id,
        test_case_id: selectedGroupId || "shared-step-group-draft",
        step_order: index + 1,
        action: step.action || null,
        expected_result: step.expected_result || null,
        step_type: normalizeStepType(step.step_type),
        automation_code: null,
        api_request: null,
        group_id: null,
        group_name: groupDraft.name || null,
        group_kind: "reusable",
        reusable_group_id: selectedGroupId || null
      })),
    [authoredSharedSteps, groupDraft.name, selectedGroupId]
  );

  useEffect(() => {
    if (!sharedGroupsQuery.isFetched || sharedGroupsQuery.isError || sharedGroupsQuery.isLoading || sharedGroupsQuery.isFetching) {
      return;
    }

    const requestedGroupId = searchParams.get("group");
    if (closingWorkspaceRef.current && requestedGroupId) return;
    if (!requestedGroupId) closingWorkspaceRef.current = false;
    const requestedGroup = findByRoutableId(sharedGroups, requestedGroupId);

    if (requestedGroup) {
      if (selectedGroupId !== requestedGroup.id) {
        setSelectedGroupId(requestedGroup.id);
        setIsCreating(false);
      }
      return;
    }

    if (requestedGroupId) {
      if (selectedGroupId === requestedGroupId) {
        return;
      }

      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("group");
        return next;
      }, { replace: true });
    }
  }, [searchParams, selectedGroupId, setSearchParams, sharedGroups, sharedGroupsQuery.isFetched, sharedGroupsQuery.isError, sharedGroupsQuery.isFetching, sharedGroupsQuery.isLoading]);

  useEffect(() => {
    if (searchParams.get("usage") !== "1" || !selectedGroup) return;
    setIsUsageDialogOpen(true);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("usage");
      return next;
    }, { replace: true });
  }, [searchParams, selectedGroup, setSearchParams]);

  const detectedSharedParameters = useMemo<StepParameterDefinition[]>(
    () =>
      collectStepParameters(
        authoredSharedSteps.map((step) => ({
          id: step.id,
          action: step.action,
          expected_result: step.expected_result,
          automation_code: "",
          api_request: null
        })) as Array<{ id: string; action: string; expected_result: string; automation_code: string; api_request: SharedGroupDraftStep["api_request"] }>
      ),
    [authoredSharedSteps]
  );

  useEffect(() => {
    setSharedParameterValues((current) => {
      const next = filterStepParameterValues(current, detectedSharedParameters);
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);

      if (
        currentKeys.length === nextKeys.length
        && currentKeys.every((key) => current[key] === next[key])
      ) {
        return current;
      }

      return next;
    });
  }, [detectedSharedParameters]);

  useEffect(() => {
    if (!sharedGroupsQuery.isFetched || sharedGroupsQuery.isError) return;
    const validGroupIds = new Set(sharedGroups.map((group) => group.id));
    setSelectedGroupIds((current) => current.filter((groupId) => validGroupIds.has(groupId)));
  }, [sharedGroups, sharedGroupsQuery.isFetched, sharedGroupsQuery.isError]);

  useEffect(() => {
    if (isCreating) {
      return;
    }

    if (!selectedGroupId) {
      setGroupDraft(EMPTY_GROUP_DRAFT);
      resetStepComposer();
      return;
    }

    if (selectedGroup) {
      setGroupDraft(draftFromGroup(selectedGroup));
      setSharedParameterValues(normalizeStepParameterValues(selectedGroup.parameter_values || {}));
      resetStepComposer();
      return;
    }

    if (!sharedGroupsQuery.isFetched || sharedGroupsQuery.isError || sharedGroupsQuery.isLoading || sharedGroupsQuery.isFetching) {
      return;
    }

    setSelectedGroupId("");
    setGroupDraft(EMPTY_GROUP_DRAFT);
    resetStepComposer();
  }, [isCreating, selectedGroup, selectedGroupId, sharedGroupsQuery.isFetched, sharedGroupsQuery.isError, sharedGroupsQuery.isFetching, sharedGroupsQuery.isLoading]);

  const filteredGroups = useMemo(() => {
    const search = deferredSearchTerm.trim().toLowerCase();

    return sharedGroups.filter((group) => {
      if (!search) {
        return true;
      }

      return [
        group.display_id || "",
        group.id,
        group.name,
        richTextToPlainText(group.description || ""),
        ...asArray(group.steps).map((step) => `${richTextToPlainText(step.action || "")} ${richTextToPlainText(step.expected_result || "")}`)
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [deferredSearchTerm, sharedGroups]);
  const visibleGroupIds = useMemo(() => filteredGroups.map((group) => group.id), [filteredGroups]);
  const selectedVisibleGroupIds = useMemo(
    () => selectedGroupIds.filter((groupId) => visibleGroupIds.includes(groupId)),
    [selectedGroupIds, visibleGroupIds]
  );
  const historyBySharedGroupId = useMemo(() => {
    const groupIdsByCaseId = sharedGroups.reduce<Record<string, string[]>>((map, group) => {
      asArray(group.used_test_cases).forEach((testCase) => {
        map[testCase.id] = map[testCase.id] || [];
        map[testCase.id].push(group.id);
      });
      return map;
    }, {});
    const historyMap: Record<string, Record<string, {
      execution_id: string;
      status: ExecutionResult["status"];
      isFinalized: boolean;
      created_at?: string;
    }>> = {};

    selectLatestExecutionResultInstances(executionResults).forEach((result) => {
      const linkedGroupIds = groupIdsByCaseId[result.test_case_id] || [];

      linkedGroupIds.forEach((groupId) => {
        historyMap[groupId] = historyMap[groupId] || {};
        const current = historyMap[groupId][result.execution_id];

        historyMap[groupId][result.execution_id] = {
          execution_id: result.execution_id,
          status: aggregateRunStatus(current?.status, result.status),
          isFinalized: (current?.isFinalized ?? true) && result.status !== "running",
          created_at:
            String(result.created_at || "") > String(current?.created_at || "")
              ? result.created_at
              : current?.created_at || result.created_at
        };
      });
    });

    return Object.fromEntries(
      Object.entries(historyMap).map(([groupId, resultsByExecution]) => [
        groupId,
        Object.values(resultsByExecution).sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
      ])
    ) as Record<string, Array<{
      execution_id: string;
      status: ExecutionResult["status"];
      isFinalized: boolean;
      created_at?: string;
    }>>;
  }, [executionResults, sharedGroups]);

  const selectedProject = projects.find((project) => String(project.id) === String(projectId)) || null;
  const selectedAppType = appTypes.find((appType) => appType.id === appTypeId) || null;
  const syncSharedGroupSearchParams = (groupId?: string | null) => {
    const currentGroupId = searchParams.get("group") || "";
    const targetGroupId = groupId || "";

    if (currentGroupId === targetGroupId) {
      return;
    }

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (targetGroupId) {
        next.set("group", targetGroupId);
      } else {
        next.delete("group");
      }
      return next;
    }, { replace: true });
  };

  const openSharedGroupWorkspace = (groupId: string) => {
    const targetGroup = sharedGroups.find((group) => group.id === groupId) || null;

    closingWorkspaceRef.current = false;
    syncSharedGroupSearchParams(getRoutableId(targetGroup) || groupId);
    setSelectedGroupId(groupId);
    setIsCreating(false);
    setSelectedStepIds([]);
    setCutStepIds([]);
    resetStepComposer();
  };
  const openSharedGroupUsage = (groupId: string) => {
    openSharedGroupWorkspace(groupId);
    setIsUsageDialogOpen(true);
  };
  const handleDeleteSharedGroupItem = async (group: SharedStepGroup) => {
    if (!canManageSharedStepGroups) {
      showError(new Error("Permission required: shared_step.manage"), "Unable to delete Shared Step Group");
      return;
    }
    if (!(await confirmDelete({ message: `Delete Shared Step Group "${group.name}"? Linked test cases will keep their steps as local groups.` }))) {
      return;
    }

    try {
      await deleteSharedGroup.mutateAsync(group.id);
      removeSharedStepGroupFromCache(queryClient, appTypeId, group.id);
      setSelectedGroupIds((current) => current.filter((groupId) => groupId !== group.id));

      if (selectedGroupId === group.id) {
        syncSharedGroupSearchParams(null);
        setSelectedGroupId("");
        setGroupDraft(EMPTY_GROUP_DRAFT);
        setIsUsageDialogOpen(false);
        resetStepComposer();
      }

      showSuccess("Shared Step Group deleted. Linked test cases kept their steps as local groups.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["shared-step-groups"] }),
        queryClient.invalidateQueries({ queryKey: ["shared-step-groups", appTypeId] })
      ]);
    } catch (error) {
      showError(error, "Unable to delete Shared Step Group");
    }
  };
  const sharedGroupListColumns = useMemo<Array<DataTableColumn<SharedStepGroup>>>(() => [
    {
      key: "select",
      label: "",
      canToggle: false,
      headerRender: () => (
        <label className="data-table-header-checkbox" onClick={(event) => event.stopPropagation()}>
          <input
            aria-label="Select all filtered Shared Step Groups"
            checked={Boolean(visibleGroupIds.length) && selectedVisibleGroupIds.length === visibleGroupIds.length}
            onChange={(event) =>
              setSelectedGroupIds((current) =>
                event.target.checked
                  ? [...new Set([...current, ...visibleGroupIds])]
                  : current.filter((groupId) => !visibleGroupIds.includes(groupId))
              )
            }
            type="checkbox"
          />
        </label>
      ),
      render: (group) => (
        <div onClick={(event) => event.stopPropagation()}>
          <input
            checked={selectedGroupIds.includes(group.id)}
            onChange={(event) => {
              setSelectedGroupIds((current) =>
                event.target.checked ? [...new Set([...current, group.id])] : current.filter((groupId) => groupId !== group.id)
              );
            }}
            type="checkbox"
          />
        </div>
      )
    },
    {
      key: "id",
      label: "ID",
      sortValue: (group) => group.display_id || group.id,
      render: (group) => <EntityIdBadge icon={<SharedStepsIconGraphic size={16} />} value={group.display_id || group.id} />
    },
    {
      key: "group",
      label: "Group",
      canToggle: false,
      render: (group) => <strong>{group.name}</strong>
    },
    {
      key: "description",
      label: "Description",
      defaultVisible: false,
      render: (group) => richTextToPlainText(group.description) || "Reusable Shared Step Group"
    },
    {
      key: "preview",
      label: "Preview",
      defaultVisible: false,
      render: (group) => richTextToPlainText(group.steps[0]?.action || group.steps[0]?.expected_result || "") || "No step preview yet"
    },
    {
      key: "steps",
      label: "Steps",
      render: (group) => group.step_count || group.steps.length
    },
    {
      key: "usedInCases",
      label: "Used in cases",
      render: (group) => group.usage_count || 0
    },
    {
      key: "runs",
      label: "Runs",
      render: (group) => (historyBySharedGroupId[group.id] || []).length
    },
    {
      key: "updated",
      label: "Updated",
      render: (group) => formatSharedStepDate(group.updated_at)
    },
    {
      key: "createdBy",
      label: "Created by",
      defaultVisible: false,
      render: (group) => resolveAuditUserLabel(group.created_by, userById)
    },
    {
      key: "createdAt",
      label: "Created at",
      defaultVisible: false,
      render: (group) => formatAuditTimestamp(group.created_at)
    },
    {
      key: "updatedBy",
      label: "Last updated by",
      defaultVisible: false,
      render: (group) => resolveAuditUserLabel(group.updated_by || group.created_by, userById)
    },
    {
      key: "updatedAt",
      label: "Last updated at",
      defaultVisible: false,
      render: (group) => formatAuditTimestamp(group.updated_at || group.created_at)
    },
    {
      key: "scope",
      label: "Scope",
      defaultVisible: false,
      render: () => selectedAppType?.name || "App type"
    }
  ], [
    historyBySharedGroupId,
    selectedAppType?.name,
    selectedGroupIds,
    userById
  ]);
  const linkedPreviewCase = useMemo(
    () => testCases.find((testCase) => testCase.id === linkedPreviewCaseId) || null,
    [linkedPreviewCaseId, testCases]
  );

  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  const refreshGroups = async (options: { preserveSelectedGroupId?: string } = {}) => {
    const preserveSelectedGroupId = options.preserveSelectedGroupId;
    if (preserveSelectedGroupId) {
      await queryClient.invalidateQueries({ queryKey: ["shared-step-groups", appTypeId] });
      await queryClient.invalidateQueries({ queryKey: ["shared-step-groups"] });
      setSelectedGroupId(preserveSelectedGroupId);
      return;
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["shared-step-groups"] }),
      queryClient.invalidateQueries({ queryKey: ["shared-step-groups", appTypeId] })
    ]);
  };

  const beginCreateGroup = () => {
    if (!canManageSharedStepGroups) {
      showError(new Error("Permission required: shared_step.manage"), "Unable to create Shared Step Group");
      return;
    }
    syncSharedGroupSearchParams(null);
    setIsCreating(true);
    setSelectedGroupId("");
    setGroupDraft({
      ...EMPTY_GROUP_DRAFT,
      steps: [createEmptyDraftStep()]
    });
    setExpandedStepIds([]);
    setSelectedStepIds([]);
    setCutStepIds([]);
    resetStepComposer();
  };

  const closeWorkspace = () => {
    closingWorkspaceRef.current = true;
    syncSharedGroupSearchParams(null);
    setSelectedGroupId("");
    setIsCreating(false);
    setGroupDraft(EMPTY_GROUP_DRAFT);
    setExpandedStepIds([]);
    setSelectedStepIds([]);
    setCutStepIds([]);
    resetStepComposer();
  };

  const updateDraftStep = (stepId: string, input: Partial<SharedGroupDraftStep>) => {
    setGroupDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === stepId ? { ...step, ...input } : step))
    }));
  };

  const activateStepInsert = (index: number) => {
    setStepInsertIndex(index);
    setNewStepDraft(EMPTY_SHARED_GROUP_STEP_INPUT);
  };

  const insertDraftStepAt = (index: number, stepInput: SharedGroupStepInput) => {
    const nextStep: SharedGroupDraftStep = {
      id: createDraftStepId(),
      action: stepInput.action.trim(),
      expected_result: stepInput.expected_result.trim(),
      step_type: "web",
      automation_code: "",
      api_request: null
    };

    setGroupDraft((current) => {
      const nextSteps = [...current.steps];
      const boundedIndex = Math.max(0, Math.min(index, nextSteps.length));
      nextSteps.splice(boundedIndex, 0, nextStep);

      return {
        ...current,
        steps: nextSteps
      };
    });
  };

  const handleInsertStep = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (stepInsertIndex === null) {
      return;
    }

    const nextAction = newStepDraft.action.trim();
    const nextExpectedResult = newStepDraft.expected_result.trim();

    if (!nextAction && !nextExpectedResult) {
      return;
    }

    insertDraftStepAt(stepInsertIndex, {
      action: nextAction,
      expected_result: nextExpectedResult,
      step_type: "web",
      automation_code: "",
      api_request: null
    });
    resetStepComposer();
  };

  const moveDraftStep = (stepId: string, direction: "up" | "down") => {
    setGroupDraft((current) => {
      const currentIndex = current.steps.findIndex((step) => step.id === stepId);
      const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

      if (currentIndex === -1 || nextIndex < 0 || nextIndex >= current.steps.length) {
        return current;
      }

      const nextSteps = [...current.steps];
      const [movedStep] = nextSteps.splice(currentIndex, 1);
      nextSteps.splice(nextIndex, 0, movedStep);

      return {
        ...current,
        steps: nextSteps
      };
    });
  };

  const toggleDraftStepExpanded = (stepId: string) => {
    setExpandedStepIds((current) =>
      current.includes(stepId)
        ? current.filter((id) => id !== stepId)
        : [...current, stepId]
    );
  };

  const toggleDraftStepSelected = (stepId: string, checked: boolean) => {
    setSelectedStepIds((current) => (checked ? Array.from(new Set([...current, stepId])) : current.filter((id) => id !== stepId)));
  };

  const copyDraftSteps = (stepIds: string[]) => {
    const stepsToCopy = groupDraft.steps
      .filter((step) => stepIds.includes(step.id))
      .map((step) => ({
        action: step.action,
        expected_result: step.expected_result,
        step_type: step.step_type,
        automation_code: step.automation_code,
        api_request: step.api_request,
        id: step.id
      }));

    if (!stepsToCopy.length) {
      return;
    }

    setCopiedSteps(stepsToCopy);
    setCutStepIds([]);
  };

  const cutDraftSteps = (stepIds: string[]) => {
    const stepsToCut = groupDraft.steps
      .filter((step) => stepIds.includes(step.id))
      .map((step) => ({
        action: step.action,
        expected_result: step.expected_result,
        step_type: step.step_type,
        automation_code: step.automation_code,
        api_request: step.api_request,
        id: step.id
      }));

    if (!stepsToCut.length) {
      return;
    }

    setCopiedSteps(stepsToCut);
    setCutStepIds(stepIds);
  };

  const pasteDraftStepsAt = (index: number) => {
    if (!copiedSteps.length) {
      return;
    }

    setGroupDraft((current) => {
      const filteredSteps = cutStepIds.length ? current.steps.filter((step) => !cutStepIds.includes(step.id)) : current.steps;
      const insertIndex = Math.max(0, Math.min(index, filteredSteps.length));
      const nextSteps = [...filteredSteps];
      nextSteps.splice(insertIndex, 0, ...copiedSteps.map((step) => cloneSharedGroupStep(step)));

      return {
        ...current,
        steps: nextSteps
      };
    });

    if (cutStepIds.length) {
      setSelectedStepIds((current) => current.filter((id) => !cutStepIds.includes(id)));
      setCutStepIds([]);
    }
  };

  const deleteDraftSteps = (stepIds: string[]) => {
    if (!stepIds.length) {
      return;
    }


    setGroupDraft((current) => ({
      ...current,
      steps: current.steps.filter((step) => !stepIds.includes(step.id))
    }));
    setSelectedStepIds((current) => current.filter((id) => !stepIds.includes(id)));
    setCutStepIds((current) => current.filter((id) => !stepIds.includes(id)));
  };

  const duplicateDraftSteps = (stepIds: string[]) => {
    if (!stepIds.length) return;
    const selected = groupDraft.steps.filter((step) => stepIds.includes(step.id));
    if (!selected.length) return;
    const lastSelectedIndex = Math.max(...selected.map((step) => groupDraft.steps.findIndex((candidate) => candidate.id === step.id)));
    const copies = selected.map(cloneSharedGroupStep);
    const nextSteps = [...groupDraft.steps];
    nextSteps.splice(lastSelectedIndex + 1, 0, ...copies);
    setGroupDraft((current) => ({ ...current, steps: nextSteps }));
    setSelectedStepIds(copies.map((step) => step.id));
  };

  const handleChangeDraftStepType = (stepId: string, nextType: SharedGroupDraftStep["step_type"]) => {
    if (!nextType) {
      return;
    }

    updateDraftStep(stepId, {
      step_type: normalizeStepType(nextType)
    });
  };

  const selectSharedGroupAuthoringMode = (authoringMode: "structured" | "gherkin") => {
    if (authoringMode === groupDraft.authoring_mode) return;

    setIsVisualBuilderActive(false);
    setSelectedStepIds([]);
    setGroupDraft((current) => {
      if (authoringMode === "gherkin") {
        const previousBehavior = structuredStepsToSharedGherkin(sharedStepGherkinToStructuredSteps(current.gherkin_document));
        const nextBehavior = structuredStepsToSharedGherkin(current.steps);
        return {
          ...current,
          authoring_mode: "gherkin",
          gherkin_document: previousBehavior === nextBehavior
            ? composeSharedStepGherkin(parseSharedStepGherkin(current.gherkin_document))
            : nextBehavior
        };
      }

      const steps = mergeGherkinStepMetadata(sharedStepGherkinToStructuredSteps(current.gherkin_document), current.steps, createEmptyDraftStep);
      return { ...current, authoring_mode: "structured", steps };
    });
  };

  const handleSaveGroup = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    if (!canManageSharedStepGroups) {
      showError(new Error("Permission required: shared_step.manage"), "Unable to save Shared Step Group");
      return;
    }

    if (!appTypeId) {
      showError(new Error("Select an app type before saving a Shared Step Group."), "Unable to save Shared Step Group");
      return;
    }

    const steps = normalizeGroupSteps(authoredSharedSteps);
    const parameterValues = filterStepParameterValues(normalizeStepParameterValues(sharedParameterValues), detectedSharedParameters);
    const gherkinDocument = groupDraft.authoring_mode === "gherkin"
      ? composeSharedStepGherkin(parseSharedStepGherkin(groupDraft.gherkin_document))
      : groupDraft.gherkin_document;
    let savedGroupId = selectedGroup?.id || "";

    try {
      if (isCreating) {
        const response = await createSharedGroup.mutateAsync({
          app_type_id: appTypeId,
          name: groupDraft.name.trim(),
          description: groupDraft.description.trim() || undefined,
          authoring_mode: groupDraft.authoring_mode,
          gherkin_document: gherkinDocument,
          parameter_values: parameterValues,
          steps
        });
        const createdGroup = await api.sharedStepGroups.get(response.id);

        upsertSharedStepGroupInCache(queryClient, appTypeId, createdGroup);

        savedGroupId = createdGroup.id;
        syncSharedGroupSearchParams(getRoutableId(createdGroup) || createdGroup.id);
        setSelectedGroupId(createdGroup.id);
        setIsCreating(false);
        setGroupDraft(draftFromGroup(createdGroup));
        showSuccess("Shared Step Group created.");
      } else if (selectedGroup) {
        await updateSharedGroup.mutateAsync({
          id: selectedGroup.id,
          input: {
            app_type_id: appTypeId,
            name: groupDraft.name.trim(),
            description: groupDraft.description.trim(),
            authoring_mode: groupDraft.authoring_mode,
            gherkin_document: gherkinDocument,
            parameter_values: parameterValues,
            steps
          }
        });
        const refreshedGroup = await api.sharedStepGroups.get(selectedGroup.id);

        upsertSharedStepGroupInCache(queryClient, appTypeId, refreshedGroup);
        savedGroupId = refreshedGroup.id;
        syncSharedGroupSearchParams(getRoutableId(refreshedGroup) || refreshedGroup.id);
        setSelectedGroupId(refreshedGroup.id);
        setGroupDraft(draftFromGroup(refreshedGroup));

        showSuccess(
          selectedGroup.usage_count
            ? `Shared Step Group updated. ${selectedGroup.usage_count} linked test case${selectedGroup.usage_count === 1 ? "" : "s"} refreshed.`
            : "Shared Step Group updated."
        );
      }

      await refreshGroups({ preserveSelectedGroupId: savedGroupId });
    } catch (error) {
      showError(error, "Unable to save Shared Step Group");
    }
  };

  const handleDeleteGroup = async () => {
    if (!canManageSharedStepGroups) {
      showError(new Error("Permission required: shared_step.manage"), "Unable to delete Shared Step Group");
      return;
    }
    if (!selectedGroup) {
      return;
    }

    if (!(await confirmDelete({ message: `Delete Shared Step Group "${selectedGroup.name}"? Linked test cases will keep their steps as local groups.` }))) {
      return;
    }

    try {
      await deleteSharedGroup.mutateAsync(selectedGroup.id);
      removeSharedStepGroupFromCache(queryClient, appTypeId, selectedGroup.id);
      syncSharedGroupSearchParams(null);
      setSelectedGroupId("");
      setGroupDraft(EMPTY_GROUP_DRAFT);
      resetStepComposer();
      showSuccess("Shared Step Group deleted. Linked test cases kept their steps as local groups.");
      await refreshGroups();
    } catch (error) {
      showError(error, "Unable to delete Shared Step Group");
    }
  };

  const handleDeleteSelectedGroups = async () => {
    if (!canManageSharedStepGroups) {
      showError(new Error("Permission required: shared_step.manage"), "Unable to delete selected Shared Step Groups");
      return;
    }
    const groupsToDelete = sharedGroups.filter((group) => selectedVisibleGroupIds.includes(group.id));

    if (!groupsToDelete.length) {
      showError(new Error("Select one or more visible Shared Step Groups to delete."), "Unable to delete selected Shared Step Groups");
      return;
    }

    if (!(await confirmDelete({ message: `Delete ${groupsToDelete.length} Shared Step Group${groupsToDelete.length === 1 ? "" : "s"}? Linked test cases will keep their steps as local groups.` }))) {
      return;
    }

    try {
      const results = await Promise.allSettled(groupsToDelete.map((group) => deleteSharedGroup.mutateAsync(group.id)));
      const deletedIds = groupsToDelete
        .filter((_, index) => results[index]?.status === "fulfilled")
        .map((group) => group.id);

      deletedIds.forEach((groupId) => removeSharedStepGroupFromCache(queryClient, appTypeId, groupId));

      setSelectedGroupIds((current) => current.filter((groupId) => !deletedIds.includes(groupId)));

      if (selectedGroupId && deletedIds.includes(selectedGroupId)) {
        syncSharedGroupSearchParams(null);
        setSelectedGroupId("");
        setGroupDraft(EMPTY_GROUP_DRAFT);
        resetStepComposer();
      }

      await refreshGroups();
      showSuccess(
        deletedIds.length
          ? `${deletedIds.length} Shared Step Group${deletedIds.length === 1 ? "" : "s"} deleted.`
          : "No Shared Step Groups were deleted."
      );
    } catch (error) {
      showError(error, "Unable to delete selected Shared Step Groups");
    }
  };

  const coverageMeta = {
    total: sharedGroups.length,
    totalSteps: sharedGroups.reduce((count, group) => count + (group.step_count || asArray(group.steps).length), 0),
    usedInCases: sharedGroups.reduce((count, group) => count + (group.usage_count || 0), 0)
  };
  const sharedStepPreview = richTextToPlainText(authoredSharedSteps[0]?.action || authoredSharedSteps[0]?.expected_result || "");
  const sharedStepSectionSummary = sharedStepPreview
    ? `Starts with: ${sharedStepPreview}`
    : "No steps yet. Add at least one step so this group is useful across cases.";
  const openTestCaseWorkspace = (testCaseId: string) => {
    setIsUsageDialogOpen(false);
    setLinkedPreviewCaseId(testCaseId);
  };
  const allStepsSelected = Boolean(groupDraft.steps.length) && selectedStepIds.length === groupDraft.steps.length;
  const isSharedGroupWorkspaceOpen = isCreating || Boolean(selectedGroupId);
  const sharedEditorActions: SharedGroupStepActionMenuAction[] = [
    {
      label: isCreating ? "Create Shared Step Group" : "Save changes",
      description: isCreating ? "Create this reusable group with its current steps." : "Save the group metadata, parameters, and all step changes together.",
      icon: <SharedGroupStepSaveIcon />,
      onClick: () => void handleSaveGroup(),
      disabled: !canManageSharedStepGroups || !groupDraft.name.trim() || createSharedGroup.isPending || updateSharedGroup.isPending,
      tone: "primary"
    },
    {
      label: "Expand all steps",
      description: "Open every step editor in this group.",
      icon: <SharedGroupStepExpandAllIcon />,
      onClick: () => setExpandedStepIds(groupDraft.steps.map((step) => step.id)),
      disabled: !groupDraft.steps.length
    },
    {
      label: "Collapse all steps",
      description: "Close every step editor in this group.",
      icon: <SharedGroupStepCollapseAllIcon />,
      onClick: () => setExpandedStepIds([]),
      disabled: !expandedStepIds.length
    },
    {
      label: "Copy selected steps",
      description: "Place the selected steps in the clipboard.",
      icon: <SharedGroupStepCopyIcon />,
      onClick: () => copyDraftSteps(selectedStepIds),
      disabled: !selectedStepIds.length
    },
    {
      label: "Duplicate selected steps",
      description: "Create a bulk copy directly after the selected steps.",
      icon: <SharedGroupStepCopyIcon />,
      onClick: () => duplicateDraftSteps(selectedStepIds),
      disabled: !selectedStepIds.length
    },
    {
      label: "Cut selected steps",
      description: "Move the selected steps after you paste them somewhere else.",
      icon: <SharedGroupStepCutIcon />,
      onClick: () => cutDraftSteps(selectedStepIds),
      disabled: !selectedStepIds.length
    },
    {
      label: "Paste at end",
      description: "Insert the clipboard steps after the current Shared Step Group's steps.",
      icon: <SharedGroupStepPasteIcon />,
      onClick: () => pasteDraftStepsAt(groupDraft.steps.length),
      disabled: !copiedSteps.length
    },
    {
      label: "Delete selected steps",
      description: "Remove the selected steps from this group.",
      icon: <SharedGroupStepDeleteIcon />,
      onClick: () => deleteDraftSteps(selectedStepIds),
      disabled: !selectedStepIds.length,
      tone: "danger"
    },
    {
      label: "Clear step selection",
      description: "Reset the current multi-step selection without changing any steps.",
      icon: <SelectionToggleIcon checked={false} />,
      onClick: () => setSelectedStepIds([]),
      disabled: !selectedStepIds.length
    }
  ];

  const improveSharedGroupSteps = async () => {
    if (!canUseSharedStepAi || !appTypeId || !groupDraft.steps.length || isImprovingSteps) return;
    const selected = new Set(selectedStepIds);
    const targetSteps = selected.size ? groupDraft.steps.filter((step) => selected.has(step.id)) : groupDraft.steps;

    setIsImprovingSteps(true);
    try {
      const improvedById = new Map<string, SharedGroupDraftStep>();
      for (const [index, step] of targetSteps.entries()) {
        const response = await api.testCases.rephraseStep({
          app_type_id: appTypeId,
          additional_context: [
            "Improve this reusable Shared Step Group step. Keep related steps consistent, preserve @t parameters, remove ambiguity and needless repetition, and keep the result focused on manual action and expected-result authoring."
          ].filter(Boolean).join("\n\n"),
          test_case: {
            title: groupDraft.name || "Shared Step Group",
            description: groupDraft.description,
            parameter_values: sharedParameterValues
          },
          step: {
            step_order: groupDraft.steps.findIndex((candidate) => candidate.id === step.id) + 1 || index + 1,
            step_type: step.step_type,
            action: step.action,
            expected_result: step.expected_result
          }
        });
        improvedById.set(step.id, {
          ...step,
          action: response.step.action || step.action,
          expected_result: response.step.expected_result || step.expected_result,
          step_type: normalizeStepType(response.step.step_type || step.step_type),
          automation_code: "",
          api_request: null
        });
      }
      setGroupDraft((current) => ({
        ...current,
        steps: current.steps.map((step) => improvedById.get(step.id) || step)
      }));
      setExpandedStepIds((current) => [...new Set([...current, ...targetSteps.map((step) => step.id)])]);
      showSuccess(`${targetSteps.length} step${targetSteps.length === 1 ? "" : "s"} improved in the draft. Review the changes, then save the group.`);
    } catch (error) {
      showError(error, "Unable to improve Shared Step Group steps");
    } finally {
      setIsImprovingSteps(false);
    }
  };

  return (
    <div className="page-content page-content--library-full">
      {confirmationDialog}
      <PageHeader
        className={isSharedGroupWorkspaceOpen ? "page-header--workspace-context" : ""}
        eyebrow="Test Authoring"
        title="Shared Step Groups"
        description="Curate reusable Structured or Gherkin step blocks once, preserve linked parameters, and apply consistent behavior across every connected Test Case."
        meta={[
          { label: "Groups", value: coverageMeta.total },
          { label: "Reusable steps", value: coverageMeta.totalSteps },
          { label: "Case links", value: coverageMeta.usedInCases }
        ]}
      />

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

      <WorkspaceMasterDetail
        browseView={(
          <Panel
            title="Shared Step Group list"
            subtitle={appTypeId ? undefined : "Choose an app type to begin."}
          >
            <div className="design-list-toolbar catalog-command-toolbar test-case-catalog-toolbar">
              <div className="catalog-toolbar-discovery" aria-label="Shared Step Group views, search, and selection">
                <CatalogViewToggle onChange={setCatalogViewMode} value={catalogViewMode} />
                <CatalogSearchFilter
                  activeFilterCount={Number(Boolean(searchTerm.trim()))}
                  ariaLabel="Search Shared Step Groups"
                  onChange={setSearchTerm}
                  placeholder="Search group name, description, or step text"
                  subtitle="Find Shared Step Groups by intent, summary, or step content."
                  title="Filter Shared Step Groups"
                  value={searchTerm}
                >
                  <div className="catalog-filter-grid">
                    <div className="catalog-filter-actions">
                      <button className="ghost-button" disabled={!searchTerm.trim()} onClick={() => setSearchTerm("")} type="button">
                        Clear search
                      </button>
                    </div>
                  </div>
                </CatalogSearchFilter>
                <CatalogSelectionControls
                  allSelected={selectedVisibleGroupIds.length === visibleGroupIds.length}
                  canSelectAll={Boolean(visibleGroupIds.length)}
                  onClear={() => setSelectedGroupIds([])}
                  onSelectAll={() => setSelectedGroupIds((current) => Array.from(new Set([...current, ...visibleGroupIds])))}
                  selectedCount={selectedGroupIds.length}
                />
              </div>
              <div className="catalog-toolbar-actions" aria-label="Shared Step Group actions">
                <button className="primary-button catalog-selection-button" disabled={!appTypeId || !canManageSharedStepGroups} onClick={beginCreateGroup} type="button">
                  <AddIcon />
                  <span>New Shared Step Group</span>
                </button>
                <button
                  className="ghost-button danger catalog-selection-button"
                  disabled={!canManageSharedStepGroups || !selectedGroupIds.length || deleteSharedGroup.isPending}
                  onClick={() => void handleDeleteSelectedGroups()}
                  type="button"
                >
                  <TrashIcon />
                  <span>{deleteSharedGroup.isPending ? "Deleting selected" : "Delete selected"}</span>
                </button>
              </div>
            </div>

            <TileBrowserPane className="test-case-library-scroll" scrollKey={`shared-steps:${projectId}:${appTypeId}`}>
              {sharedGroupsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
              {!sharedGroupsQuery.isLoading && filteredGroups.length && catalogViewMode === "tile" ? (
                <div className="tile-browser-grid">
                  {filteredGroups.map((group) => {
                    const isActive = !isCreating && selectedGroupId === group.id;
                    const isSelected = selectedGroupIds.includes(group.id);
                    const stepCount = group.step_count || group.steps.length;
                    const usageCount = group.usage_count || 0;
                    const preview = richTextToPlainText(group.steps[0]?.action || group.steps[0]?.expected_result || "") || "No step preview yet";
                    const groupHistory = historyBySharedGroupId[group.id] || [];
                    const history = groupHistory.slice(0, 5);
                    const recentHistory = groupHistory.slice(0, 10);
                    const finalizedHistory = recentHistory.filter((result) => result.isFinalized);
                    const passedRunCount = finalizedHistory.filter((result) => result.status === "passed").length;
                    const failedRunCount = finalizedHistory.filter((result) => ["failed", "blocked"].includes(result.status)).length;
                    const passRate = finalizedHistory.length ? Math.round((passedRunCount / finalizedHistory.length) * 100) : 0;
                    const completeStepCount = group.steps.filter((step) => (
                      richTextToPlainText(step.action || "").trim()
                      && richTextToPlainText(step.expected_result || "").trim()
                    )).length;
                    const definitionCompleteness = stepCount ? Math.round((completeStepCount / stepCount) * 100) : 0;
                    const runCount = groupHistory.length;
                    const latestRun = history[0];
                    const cardTone = ["failed", "blocked"].includes(latestRun?.status || "")
                      ? "is-risk"
                      : !stepCount || !usageCount || (finalizedHistory.length > 0 && passRate < 70)
                        ? "is-warning"
                        : "is-healthy";

                    return (
                      <article
                        className={["record-card tile-card test-case-card test-case-catalog-card shared-step-group-tile-card", cardTone, isActive ? "is-active" : ""].filter(Boolean).join(" ")}
                        key={group.id}
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest("a, button, input, label, select, textarea")) {
                            return;
                          }
                          openSharedGroupWorkspace(group.id);
                        }}
                      >
                        <div className="tile-card-main">
                          <div className="tile-card-select-row">
                            <label className="checkbox-field" onClick={(event) => event.stopPropagation()}>
                              <input
                                aria-label={`Select Shared Step Group ${group.name}`}
                                checked={isSelected}
                                onChange={(event) => {
                                  setSelectedGroupIds((current) =>
                                    event.target.checked
                                      ? [...current, group.id]
                                      : current.filter((groupId) => groupId !== group.id)
                                  );
	                                }}
		                                type="checkbox"
		                              />
		                            </label>
		                            <EntityIdBadge icon={<SharedStepsIconGraphic size={16} />} value={group.display_id || group.id} />
		                          </div>
	                          <div className="tile-card-header">
			                            <button
                                  aria-current={isActive ? "page" : undefined}
                                  className="tile-card-title-group test-case-card-title-group test-case-card-title-group--identity tile-card-open-button"
                                  onClick={() => openSharedGroupWorkspace(group.id)}
                                  type="button"
                                >
		                              <strong>{group.name}</strong>
		                            </button>
	                          </div>
                          <RichTextContent className="tile-card-description" value={group.description} fallback={preview} />
                          <div className="tile-card-progress-stack shared-step-group-progress-stack">
                            <TileCardProgress
                              displayValue={stepCount ? `${definitionCompleteness}%` : "No steps"}
                              label="Step completeness"
                              title={stepCount ? `${completeStepCount} of ${stepCount} steps include both an action and expected result` : "No steps are defined"}
                              tone={!stepCount ? "neutral" : definitionCompleteness === 100 ? "success" : definitionCompleteness >= 60 ? "warning" : "danger"}
                              value={stepCount ? definitionCompleteness : null}
                            />
                            <TileCardProgress
                              displayValue={finalizedHistory.length ? `${passRate}%` : "No runs"}
                              label="Linked-case pass rate"
                              title={finalizedHistory.length ? `${passedRunCount} of ${finalizedHistory.length} finalized current-linked-case runs passed` : "No finalized current-linked-case run evidence"}
                              tone={!finalizedHistory.length ? "neutral" : passRate >= 80 ? "success" : passRate >= 60 ? "warning" : "danger"}
                              value={finalizedHistory.length ? passRate : null}
                            />
                          </div>
                          <div className="tile-card-metric-grid shared-step-group-tile-metrics" aria-label={`${group.name} metrics`}>
                            <TileCardMetric
                              label="Steps"
                              title={`${stepCount} step${stepCount === 1 ? "" : "s"}`}
                              tone={stepCount ? "info" : "neutral"}
                              value={stepCount}
                            />
                            <TileCardMetric
                              label="Case links"
                              title={`${usageCount} linked case${usageCount === 1 ? "" : "s"}`}
                              tone={usageCount ? "success" : "neutral"}
                              value={usageCount}
                            />
                            <TileCardMetric
                              label="Runs"
                              title={`${runCount} current-linked-case run record${runCount === 1 ? "" : "s"}`}
                              tone={runCount ? "info" : "neutral"}
                              value={runCount}
                            />
                            <TileCardMetric
                              label="Failed"
                              title={`${failedRunCount} failed or blocked finalized current-linked-case run${failedRunCount === 1 ? "" : "s"}`}
                              tone={failedRunCount ? "danger" : finalizedHistory.length ? "success" : "neutral"}
                              value={failedRunCount}
                            />
                          </div>
                          <div className="tile-card-footer">
                            <div className="history-bars" aria-label="Current-linked-case run history">
                              {history.length ? history.map((result) => (
                                <span
                                  key={`${group.id}-${result.execution_id}`}
                                  className={result.status === "passed"
                                    ? "history-bar is-passed"
                                    : result.status === "failed"
                                      ? "history-bar is-failed"
                                      : result.status === "blocked"
                                        ? "history-bar is-blocked"
                                        : "history-bar"}
                                  title={`${result.status} · ${result.created_at || "recent"}`}
                                />
                              )) : <span className="history-bar" />}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}
              {!sharedGroupsQuery.isLoading && filteredGroups.length && catalogViewMode === "list" ? (
                <DataTable
                  columns={sharedGroupListColumns}
                  emptyMessage="No Shared Step Groups match the current search."
                  getRowClassName={(group) => (!isCreating && selectedGroupId === group.id ? "is-active-row" : "")}
                  getRowKey={(group) => group.id}
                  onRowClick={(group) => openSharedGroupWorkspace(group.id)}
                  renderRowActions={(group) => (
                    <CatalogActionMenu
                      actions={[
                        {
                          label: "Open group",
                          description: "Open this Shared Step Group in the workspace.",
                          icon: <OpenIcon />,
                          onClick: () => openSharedGroupWorkspace(group.id)
                        },
                        {
                          label: "View usage",
                          description: group.usage_count
                            ? "See which test cases currently reuse this group."
                            : "No linked test cases are using this group yet.",
                          icon: <LayersIcon />,
                          onClick: () => openSharedGroupUsage(group.id),
                          disabled: !group.usage_count
                        },
                        {
                          label: "Delete group",
                          description: "Delete this Shared Step Group and keep linked case steps as local copies.",
                          icon: <TrashIcon />,
                          onClick: () => void handleDeleteSharedGroupItem(group),
                          disabled: !canManageSharedStepGroups || deleteSharedGroup.isPending,
                          tone: "danger" as const
                        }
                      ]}
                      label={`${group.name} actions`}
                    />
                  )}
                  rows={filteredGroups}
                  storageKey="hellotest:shared-steps:list-columns"
                />
              ) : null}
              {!sharedGroupsQuery.isLoading && !filteredGroups.length ? (
                sharedGroups.length ? (
                  <div className="empty-state compact">No Shared Step Groups match the current search.</div>
                ) : (
                  <div className="empty-state compact">
                    <div>No Shared Step Groups exist for this app type yet.</div>
                    <button className="primary-button" disabled={!appTypeId || !canManageSharedStepGroups} onClick={beginCreateGroup} type="button">Create first group</button>
                  </div>
                )
              ) : null}
            </TileBrowserPane>
          </Panel>
        )}
        detailView={(
          <Panel
            title="Shared Step Group workspace"
            subtitle={selectedGroupId || isCreating ? "Edit the Shared Step Group and keep its step sequence ready for test case insertion." : "Select a Shared Step Group or create a new one."}
          >
            {selectedGroupId || isCreating ? (
              <form className="detail-stack shared-step-workspace-form" onSubmit={(event) => void handleSaveGroup(event)}>
                <div className="shared-step-workspace-nav">
                  <WorkspaceBackButton label="Back to Shared Step Group list" onClick={closeWorkspace} />
                  <div className="shared-step-workspace-primary-actions">
                    <button className="ghost-button compact" onClick={() => setIsParameterDialogOpen(true)} type="button">
                      <SharedGroupParameterIcon />
                      <span>{detectedSharedParameters.length ? `Group Params · ${detectedSharedParameters.length}` : "Group Params"}</span>
                    </button>
                    {!isCreating && selectedGroup && canViewTestCases ? (
                      <button className="ghost-button compact" disabled={!selectedGroup.usage_count} onClick={() => setIsUsageDialogOpen(true)} type="button">
                        <LinkedCasesIcon />
                        <span>{selectedGroup.usage_count ? `Linked cases · ${selectedGroup.usage_count}` : "Linked cases"}</span>
                      </button>
                    ) : null}
                    <button
                      aria-pressed={isVisualBuilderActive}
                      className="ghost-button compact"
                      disabled={groupDraft.authoring_mode === "gherkin"}
                      onClick={() => setIsVisualBuilderActive((current) => !current)}
                      type="button"
                    >
                      <LayersIcon />
                      <span>{isVisualBuilderActive ? "Step list" : "Visual builder"}</span>
                    </button>
                    {canUseSharedStepAi ? (
                      <button className="ghost-button compact" disabled={groupDraft.authoring_mode === "gherkin" || !groupDraft.steps.length || isImprovingSteps} onClick={() => void improveSharedGroupSteps()} title={groupDraft.authoring_mode === "gherkin" ? "Switch to Structured to improve individual steps" : undefined} type="button">
                        <SparkIcon size={16} />
                        <span>{isImprovingSteps ? "Improving…" : selectedStepIds.length ? `AI Improve · ${selectedStepIds.length}` : "AI Improve Steps"}</span>
                      </button>
                    ) : null}
                  </div>
                </div>
                <div aria-label="Shared Step Group authoring format" className="test-authoring-mode-card shared-step-authoring-mode-card">
                  <div className="test-authoring-mode-toggle" role="tablist" aria-label="Shared Step Group authoring mode">
                    <button
                      aria-controls="shared-step-group-authoring-panel"
                      aria-selected={groupDraft.authoring_mode === "structured"}
                      className={groupDraft.authoring_mode === "structured" ? "is-active" : ""}
                      onClick={() => selectSharedGroupAuthoringMode("structured")}
                      role="tab"
                      tabIndex={groupDraft.authoring_mode === "structured" ? 0 : -1}
                      type="button"
                    >Structured</button>
                    <button
                      aria-controls="shared-step-group-authoring-panel"
                      aria-selected={groupDraft.authoring_mode === "gherkin"}
                      className={groupDraft.authoring_mode === "gherkin" ? "is-active" : ""}
                      onClick={() => selectSharedGroupAuthoringMode("gherkin")}
                      role="tab"
                      tabIndex={groupDraft.authoring_mode === "gherkin" ? 0 : -1}
                      type="button"
                    >Gherkin</button>
                  </div>
                </div>
                <div id="shared-step-group-authoring-panel" role="tabpanel">
                <div className="editor-accordion">
                  <SharedStepAccordionSection
                    countLabel={groupDraft.name.trim() ? "Ready" : "Draft"}
                    isExpanded={expandedWorkspaceSections.details}
                    onToggle={() =>
                      setExpandedWorkspaceSections((current) => ({ ...current, details: !current.details }))
                    }
                    summary="Set the Shared Step Group name and description before curating the linked reusable steps."
                    title="Shared Step Group details"
                  >
                    <div className="form-grid">
                      <div className="record-grid">
                        <FormField label="Group name" required>
                          <input
                            data-autofocus="true"
                            required
                            value={groupDraft.name}
                            onChange={(event) => setGroupDraft((current) => ({ ...current, name: event.target.value }))}
                          />
                        </FormField>
                      </div>

                      <FormField label="Description">
                        <RichTextEditor
                          appearance="canonical"
                          rows={3}
                          value={groupDraft.description}
                          onChange={(description) => setGroupDraft((current) => ({ ...current, description }))}
                        />
                      </FormField>
                    </div>
                  </SharedStepAccordionSection>

                  <SharedStepAccordionSection
                    countLabel={`${authoredSharedSteps.length} step${authoredSharedSteps.length === 1 ? "" : "s"}`}
                    isExpanded={expandedWorkspaceSections.steps}
                    onToggle={() =>
                      setExpandedWorkspaceSections((current) => ({ ...current, steps: !current.steps }))
                    }
                    summary={sharedStepSectionSummary}
                    title="Steps"
                  >
                    {groupDraft.authoring_mode === "gherkin" ? (
                      <SharedStepGherkinEditor
                        availableParameters={detectedSharedParameters}
                        groupName={groupDraft.name}
                        onChange={(gherkin_document) => setGroupDraft((current) => ({ ...current, gherkin_document }))}
                        onManageParameters={() => setIsParameterDialogOpen(true)}
                        parameterValues={sharedParameterValues}
                        value={groupDraft.gherkin_document}
                      />
                    ) : (isVisualBuilderActive ? (
                      <VisualTestBuilder testSteps={visualSharedSteps} />
                    ) : (
                    <div className="step-editor step-editor--embedded step-editor--shared">
                      {!isCreating && selectedGroup ? (
                        <div className="detail-summary">
                          <strong>
                            {selectedGroup.usage_count
                              ? `Used in ${selectedGroup.usage_count} test case${selectedGroup.usage_count === 1 ? "" : "s"}`
                              : "Not used in any test cases yet"}
                          </strong>
                          <span>
                            {selectedGroup.usage_count
                              ? "Editing this Shared Step Group updates every linked test case while preserving execution history snapshots."
                              : "Once this group is inserted into a test case, linked case usage will appear here."}
                          </span>
                        </div>
                      ) : null}

                      {!groupDraft.steps.length ? (
                        <div className="empty-state compact">
                          <div>No steps yet. Add at least one step so this group is useful across cases.</div>
                          {stepInsertIndex === null ? (
                            <button className="ghost-button" onClick={() => activateStepInsert(0)} type="button">Add first step</button>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="action-row step-editor-toolbar shared-step-editor-toolbar">
                        <label className="checkbox-field step-select-all">
                          <input
                            checked={allStepsSelected}
                            disabled={!groupDraft.steps.length}
                            onChange={(event) =>
                              setSelectedStepIds(event.target.checked ? groupDraft.steps.map((step) => step.id) : [])
                            }
                            type="checkbox"
                          />
                          Select all steps
                        </label>
                        <div className="shared-step-editor-toolbar-actions">
                          <SharedGroupStepActionMenu
                            actions={sharedEditorActions}
                            className="step-card-menu--inline step-card-menu--inline-right"
                            label="Step actions"
                            openOnHover
                            previewActions={sharedEditorActions}
                          />
                          <SharedGroupStepIconButton
                            ariaLabel="Add step"
                            onClick={() => activateStepInsert(groupDraft.steps.length)}
                            title="Add step"
                            type="button"
                          >
                            <SharedGroupStepInsertIcon />
                          </SharedGroupStepIconButton>
                        </div>
                      </div>

                      <div className="step-list">
                        {!groupDraft.steps.length ? (
                          <InlineSharedGroupStepInsertSlot
                            availableParameters={detectedSharedParameters}
                            draft={newStepDraft}
                            index={0}
                            isActive={stepInsertIndex === 0}
                            parameterValues={sharedParameterValues}
                            isVisibleByDefault={true}
                            onActivate={() => activateStepInsert(0)}
                            onCancel={resetStepComposer}
                            onChange={setNewStepDraft}
                            onSubmit={handleInsertStep}
                          />
                        ) : null}

                        {groupDraft.steps.map((step, index) => (
                          <Fragment key={step.id}>
                            <InlineSharedGroupStepInsertSlot
                              availableParameters={detectedSharedParameters}
                              draft={newStepDraft}
                              index={index}
                              isActive={stepInsertIndex === index}
                              parameterValues={sharedParameterValues}
                              onActivate={() => activateStepInsert(index)}
                              onCancel={resetStepComposer}
                              onChange={setNewStepDraft}
                              onSubmit={handleInsertStep}
                            />
                            <SharedGroupDraftStepCard
                              availableParameters={detectedSharedParameters}
                              canMoveDown={index < groupDraft.steps.length - 1}
                              canMoveUp={index > 0}
                              canPaste={Boolean(copiedSteps.length)}
                              isExpanded={expandedStepIds.includes(step.id)}
                              isSelected={selectedStepIds.includes(step.id)}
                              parameterValues={sharedParameterValues}
                              onChange={(input) => updateDraftStep(step.id, input)}
                              onCopy={() => copyDraftSteps([step.id])}
                              onCut={() => cutDraftSteps([step.id])}
                              onDelete={() => deleteDraftSteps([step.id])}
                              onChangeStepType={(nextType) => handleChangeDraftStepType(step.id, nextType)}
                              onInsertAbove={() => activateStepInsert(index)}
                              onInsertBelow={() => activateStepInsert(index + 1)}
                              onMoveDown={() => moveDraftStep(step.id, "down")}
                              onMoveUp={() => moveDraftStep(step.id, "up")}
                              onPasteAbove={() => pasteDraftStepsAt(index)}
                              onPasteBelow={() => pasteDraftStepsAt(index + 1)}
                              onToggle={() => toggleDraftStepExpanded(step.id)}
                              onToggleSelect={(checked) => toggleDraftStepSelected(step.id, checked)}
                              step={step}
                              stepNumber={index + 1}
                            />
                            {index === groupDraft.steps.length - 1 ? (
                              <InlineSharedGroupStepInsertSlot
                                availableParameters={detectedSharedParameters}
                                draft={newStepDraft}
                                index={index + 1}
                                isActive={stepInsertIndex === index + 1}
                                parameterValues={sharedParameterValues}
                                onActivate={() => activateStepInsert(index + 1)}
                                onCancel={resetStepComposer}
                                onChange={setNewStepDraft}
                                onSubmit={handleInsertStep}
                              />
                            ) : null}
                          </Fragment>
                        ))}
                      </div>
                    </div>
                    ))}
                  </SharedStepAccordionSection>
                </div>
                </div>

                <div className="action-row">
                  <button className="primary-button" disabled={!canManageSharedStepGroups || createSharedGroup.isPending || updateSharedGroup.isPending} type="submit">
                    {isCreating ? (createSharedGroup.isPending ? "Creating…" : "Create Shared Step Group") : (updateSharedGroup.isPending ? "Saving…" : "Save Shared Step Group")}
                  </button>
                  {isCreating ? (
                    <button className="ghost-button" onClick={closeWorkspace} type="button">
                      Cancel
                    </button>
                  ) : null}
                  {!isCreating && selectedGroup ? (
                    <button className="ghost-button danger" disabled={!canManageSharedStepGroups || deleteSharedGroup.isPending} onClick={() => void handleDeleteGroup()} type="button">
                      Delete group
                    </button>
                  ) : null}
                </div>
              </form>
            ) : (
              <div className="empty-state compact">
                {selectedProject && selectedAppType
                  ? `Select a Shared Step Group for ${selectedProject.name} / ${selectedAppType.name}, or create a new one.`
                  : "Choose a project and app type, then select a Shared Step Group or create a new one."}
              </div>
            )}
          </Panel>
        )}
        isDetailOpen={Boolean(selectedGroupId) || isCreating}
      />

      {isParameterDialogOpen ? (
        <StepParameterDialog
          onChange={(name, value) =>
            setSharedParameterValues((current) => ({
              ...current,
              [name]: value
            }))
          }
          onClose={() => setIsParameterDialogOpen(false)}
          parameters={detectedSharedParameters}
          scopeLabels={{ t: "Shared Step Group" }}
          subtitle="Detected @params from the current Shared Step Group. These values are previewed inline so reusable flows stay readable."
          title="Shared Step Group Params"
          values={sharedParameterValues}
        />
      ) : null}

      {isUsageDialogOpen && selectedGroup && canViewTestCases ? (
        <SharedStepUsageDialog
          groupName={selectedGroup.name}
          onClose={() => setIsUsageDialogOpen(false)}
          onViewTestCase={openTestCaseWorkspace}
          usedTestCases={selectedGroup.used_test_cases || []}
        />
      ) : null}

      {linkedPreviewCase && canViewTestCases ? (
        <LinkedTestCaseModal
          appTypeName={selectedAppType?.name || ""}
          projectName={selectedProject?.name || ""}
          requirements={requirements}
          suites={suites}
          testCase={linkedPreviewCase}
          onClose={() => setLinkedPreviewCaseId("")}
        />
      ) : null}
    </div>
  );
}

function SharedStepUsageDialog({
  groupName,
  usedTestCases,
  onClose,
  onViewTestCase
}: {
  groupName: string;
  usedTestCases: Array<{
    id: string;
    title: string;
    status: string | null;
    referenced_step_count: number;
  }>;
  onClose: () => void;
  onViewTestCase: (testCaseId: string) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-labelledby="shared-step-usage-title"
        aria-modal="true"
        className="modal-card shared-step-usage-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="import-modal-header">
          <div className="import-modal-title">
            <p className="dialog-context-label">Linked cases</p>
            <div className="modal-title-info-row">
              <h2 className="dialog-title" id="shared-step-usage-title">{groupName}</h2>
              <InfoTooltip
                content="These test cases are currently linked to this Shared Step Group."
                label="Linked cases information"
              />
            </div>
          </div>
          <button aria-label="Close linked cases dialog" className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="stack-list">
          {usedTestCases.map((testCase) => (
            <div className="stack-item shared-step-usage-row" key={testCase.id}>
              <div className="shared-step-usage-copy">
                <strong>{testCase.title}</strong>
                <span>{testCase.referenced_step_count} linked step{testCase.referenced_step_count === 1 ? "" : "s"} from this group</span>
              </div>
              <div className="shared-step-usage-actions">
                <StatusBadge value={testCase.status || "draft"} />
                <button className="ghost-button inline-button" onClick={() => onViewTestCase(testCase.id)} type="button">
                  <TileCardLinkIcon />
                  <span>View test case</span>
                </button>
              </div>
            </div>
          ))}
          {!usedTestCases.length ? <div className="empty-state compact">No linked test cases yet.</div> : null}
        </div>
      </div>
    </div>
  );
}

function SharedGroupStepIconButton({
  children,
  ariaLabel,
  title,
  onClick,
  disabled = false,
  type = "button"
}: {
  children: ReactNode;
  ariaLabel: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}) {
  return (
    <button aria-label={ariaLabel} className="step-action-button" disabled={disabled} onClick={onClick} title={title} type={type}>
      {children}
    </button>
  );
}

function SharedGroupStepIconShell({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
      {children}
    </svg>
  );
}

function SharedGroupStepInsertIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
      <path d="M7 5h10" />
      <path d="M7 19h10" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupParameterIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M5 7h14" />
      <path d="M5 12h14" />
      <path d="M5 17h14" />
      <circle cx="10" cy="7" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="17" r="2.1" fill="currentColor" stroke="none" />
      <path d="M4 11.5a3.7 3.7 0 0 0 0 1" />
      <path d="M3.1 9.4 4.3 10" />
      <path d="M4.3 14 3.1 14.6" />
      <path d="M2.5 12h1.2" />
    </SharedGroupStepIconShell>
  );
}

function LinkedCasesIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 1 0-7.07-7.07L10.8 5.1" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 0 0 7.07 7.07l1.33-1.29" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepInsertAboveIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M12 19V7" />
      <path d="m8.5 10.5 3.5-3.5 3.5 3.5" />
      <path d="M6 4h12" />
      <path d="M8 15h8" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepInsertBelowIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M12 5v12" />
      <path d="m8.5 13.5 3.5 3.5 3.5-3.5" />
      <path d="M8 9h8" />
      <path d="M6 20h12" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepMoveUpIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="m12 6-4 4" />
      <path d="m12 6 4 4" />
      <path d="M12 6v12" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepMoveDownIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="m12 18-4-4" />
      <path d="m12 18 4-4" />
      <path d="M12 6v12" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepExpandAllIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M12 12V4" />
      <path d="m8.5 7.5 3.5-3.5 3.5 3.5" />
      <path d="M12 12v8" />
      <path d="m8.5 16.5 3.5 3.5 3.5-3.5" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepSaveIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M5 4h12l2 2v14H5z" /><path d="M8 4v6h8V4" /><path d="M8 20v-6h8v6" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepCollapseAllIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M12 4v8" />
      <path d="m8.5 8.5 3.5 3.5 3.5-3.5" />
      <path d="M12 20v-8" />
      <path d="m8.5 15.5 3.5-3.5 3.5 3.5" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepCopyIcon() {
  return (
    <SharedGroupStepIconShell>
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepCutIcon() {
  return (
    <SharedGroupStepIconShell>
      <circle cx="6" cy="7" r="2" />
      <circle cx="6" cy="17" r="2" />
      <path d="M8 8.5 19 18" />
      <path d="M8 15.5 19 6" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepPasteIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 10v6" />
      <path d="m9.5 13.5 2.5 2.5 2.5-2.5" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepPasteAboveIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 16V10" />
      <path d="m8.5 12.5 3.5-3.5 3.5 3.5" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepPasteBelowIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 10v6" />
      <path d="m8.5 15.5 3.5 3.5 3.5-3.5" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepDeleteIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M4 7h16" />
      <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
      <path d="M7 7l.8 11.1A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.9L17 7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepKebabIcon() {
  return (
    <SharedGroupStepIconShell>
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepActionMenu({
  label,
  actions,
  previewActions,
  openOnHover = false,
  className = ""
}: {
  label: string;
  actions: SharedGroupStepActionMenuAction[];
  previewActions?: SharedGroupStepActionMenuAction[];
  openOnHover?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<"below" | "above">("below");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hoverExitTimeoutRef = useRef<number | null>(null);
  const isInline = className.split(/\s+/).includes("step-card-menu--inline");
  const visiblePreviewActions = previewActions?.filter((action) => !action.disabled) || [];

  const updateMenuPlacement = () => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;
    const rect = trigger.getBoundingClientRect();
    const estimatedMenuHeight = Math.max(menuRef.current?.offsetHeight || 260, 220);
    const bottomRoom = window.innerHeight - rect.bottom;
    setMenuPlacement(bottomRoom < estimatedMenuHeight + 24 && rect.top > bottomRoom ? "above" : "below");
  };

  const clearHoverExitTimeout = () => {
    if (hoverExitTimeoutRef.current === null) return;
    window.clearTimeout(hoverExitTimeoutRef.current);
    hoverExitTimeoutRef.current = null;
  };

  const handleHoverEnter = () => {
    if (!openOnHover) {
      return;
    }

    clearHoverExitTimeout();
    setIsHovering(true);
  };

  const handleHoverLeave = () => {
    if (!openOnHover) {
      return;
    }

    clearHoverExitTimeout();
    hoverExitTimeoutRef.current = window.setTimeout(() => {
      setIsHovering(false);
      hoverExitTimeoutRef.current = null;
    }, 140);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  useEffect(() => () => clearHoverExitTimeout(), []);

  return (
    <div
      className={["step-card-menu", isInline ? "" : "step-card-menu--floating", className].filter(Boolean).join(" ")}
      onMouseEnter={handleHoverEnter}
      onMouseLeave={handleHoverLeave}
    >
      {openOnHover && visiblePreviewActions.length && isHovering && !isOpen ? (
        <div className="step-card-menu-panel is-horizontal" role="menu">
          {visiblePreviewActions.map((action) => (
            <button
              aria-label={action.label}
              className={["step-card-menu-item", action.tone ? `is-${action.tone}` : ""].filter(Boolean).join(" ")}
              disabled={action.disabled}
              key={action.label}
              onClick={() => {
                action.onClick();
                setIsHovering(false);
              }}
              role="menuitem"
              title={action.label}
              type="button"
            >
              {action.icon}
            </button>
          ))}
        </div>
      ) : null}
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={label}
        className="step-card-menu-trigger"
        onClick={() => {
          updateMenuPlacement();
          setIsOpen((current) => !current);
        }}
        ref={triggerRef}
        title={label}
        type="button"
      >
        <SharedGroupStepKebabIcon />
      </button>
      {isOpen ? (
        <div className={menuPlacement === "above" ? "step-card-menu-panel is-open-above" : "step-card-menu-panel"} ref={menuRef} role="menu">
          {actions.map((action) => (
            <button
              className={["step-card-menu-item", action.tone ? `is-${action.tone}` : ""].filter(Boolean).join(" ")}
              disabled={action.disabled}
              key={action.label}
              onClick={() => {
                action.onClick();
                setIsOpen(false);
              }}
              role="menuitem"
              title={action.label}
              type="button"
            >
              {action.icon}
              <span className="step-card-menu-item-content">
                <span className="step-card-menu-item-label-row">
                  <span className="step-card-menu-item-label">{action.label}</span>
                  {action.description ? (
                    <InfoTooltip
                      content={action.description}
                      label={`${action.label} information`}
                      trigger="span"
                    />
                  ) : null}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InlineSharedGroupStepInsertSlot({
  availableParameters,
  index,
  isActive,
  isVisibleByDefault = false,
  draft,
  parameterValues,
  onActivate,
  onCancel,
  onChange,
  onSubmit
}: {
  availableParameters: StepParameterDefinition[];
  index: number;
  isActive: boolean;
  isVisibleByDefault?: boolean;
  draft: SharedGroupStepInput;
  parameterValues: Record<string, string>;
  onActivate: () => void;
  onCancel: () => void;
  onChange: (draft: SharedGroupStepInput) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const insertTitle = index === 0 ? "Add first step" : "Insert step here";

  if (!isActive && !isVisibleByDefault) {
    return null;
  }

  return (
    <div className={["step-insert-slot", isActive ? "is-active" : "", isVisibleByDefault ? "is-visible" : ""].filter(Boolean).join(" ")}>
      {!isActive ? (
        <div className="step-insert-actions">
          <SharedGroupStepIconButton ariaLabel={insertTitle} onClick={onActivate} title={insertTitle} type="button">
            <SharedGroupStepInsertIcon />
          </SharedGroupStepIconButton>
        </div>
      ) : (
        <form className="step-create step-create--inline" onSubmit={onSubmit}>
          <div className="step-card-summary-top">
            <span aria-label="Shared Step Group step" className="step-kind-badge is-shared" title="Shared Step Group step">
              <StandardStepIcon />
            </span>
            <strong>{index === 0 ? "+ Add Step" : "+ Insert Step"}</strong>
          </div>
          <FormField label="Action">
            <RichTextEditor
              autoFocus
              availableParameters={availableParameters}
              parameterValues={parameterValues}
              rows={2}
              value={draft.action}
              onChange={(action) => onChange({ ...draft, action })}
            />
          </FormField>
          <FormField label="Expected result">
            <RichTextEditor
              availableParameters={availableParameters}
              parameterValues={parameterValues}
              rows={3}
              value={draft.expected_result}
              onChange={(expected_result) => onChange({ ...draft, expected_result })}
            />
          </FormField>
          <div className="action-row">
            <button className="primary-button" type="submit">Save step</button>
            <button className="ghost-button" onClick={onCancel} type="button">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function SharedGroupDraftStepCard({
  availableParameters,
  step,
  stepNumber,
  parameterValues,
  isSelected,
  isExpanded,
  canPaste,
  canMoveUp,
  canMoveDown,
  onChange,
  onCopy,
  onCut,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  onMoveUp,
  onMoveDown,
  onPasteAbove,
  onPasteBelow,
  onToggle,
  onToggleSelect,
  onChangeStepType,
}: {
  availableParameters: StepParameterDefinition[];
  step: SharedGroupDraftStep;
  stepNumber: number;
  parameterValues: Record<string, string>;
  isSelected: boolean;
  isExpanded: boolean;
  canPaste: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (input: SharedGroupStepInput) => void;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPasteAbove: () => void;
  onPasteBelow: () => void;
  onToggle: () => void;
  onToggleSelect: (checked: boolean) => void;
  onChangeStepType: (nextType: SharedGroupDraftStep["step_type"]) => void;
}) {
  const stepLabel = "Shared Step Group step";
  const stepActions: SharedGroupStepActionMenuAction[] = [
    {
      label: "Insert above",
      description: "Open a new step slot right above this step.",
      icon: <SharedGroupStepInsertAboveIcon />,
      onClick: onInsertAbove
    },
    {
      label: "Insert below",
      description: "Open a new step slot right below this step.",
      icon: <SharedGroupStepInsertBelowIcon />,
      onClick: onInsertBelow
    },
    ...(canPaste
      ? [{
          label: "Paste above",
          description: "Insert the clipboard steps before this step.",
          icon: <SharedGroupStepPasteAboveIcon />,
          onClick: onPasteAbove
        }, {
          label: "Paste below",
          description: "Insert the clipboard steps after this step.",
          icon: <SharedGroupStepPasteBelowIcon />,
          onClick: onPasteBelow
        }]
      : []),
    {
      label: "Copy step",
      description: "Place this step in the clipboard.",
      icon: <SharedGroupStepCopyIcon />,
      onClick: onCopy
    },
    {
      label: "Cut step",
      description: "Move this step after you paste it somewhere else.",
      icon: <SharedGroupStepCutIcon />,
      onClick: onCut
    },
    {
      label: "Move up",
      description: "Shift this step earlier in the group.",
      icon: <SharedGroupStepMoveUpIcon />,
      onClick: onMoveUp,
      disabled: !canMoveUp
    },
    {
      label: "Move down",
      description: "Shift this step later in the group.",
      icon: <SharedGroupStepMoveDownIcon />,
      onClick: onMoveDown,
      disabled: !canMoveDown
    },
    {
      label: "Delete step",
      description: "Remove this step from the group.",
      icon: <SharedGroupStepDeleteIcon />,
      onClick: onDelete,
      tone: "danger"
    }
  ];

  return (
    <article className={["step-card step-card--shared", isExpanded ? "is-expanded" : ""].join(" ")}>
      <div className="step-card-top">
        <label className="checkbox-field step-card-select">
          <input
            aria-label={`Select step ${stepNumber}`}
            checked={isSelected}
            onChange={(event) => onToggleSelect(event.target.checked)}
            type="checkbox"
          />
        </label>
        <div className="step-inline-tools shared-step-type-control">
          <StepTypePickerButton value={step.step_type} onChange={onChangeStepType} />
        </div>
        <button
          aria-label={isExpanded ? `Hide step ${stepNumber} details` : `Show step ${stepNumber} details`}
          className="step-card-toggle"
          onClick={onToggle}
          type="button"
        >
          <div className="step-card-summary">
            <div className="step-card-summary-row">
              <div className="step-card-summary-top">
                <span aria-label={stepLabel} className="step-kind-badge is-shared" title={stepLabel}>
                  <StandardStepIcon />
                </span>
                <strong>Step {stepNumber}</strong>
              </div>
              <StepParameterizedText
                className="step-card-parameterized"
                fallback="Step details"
                text={richTextToPlainText(step.action || step.expected_result || "")}
                values={parameterValues}
              />
            </div>
          </div>
        </button>
        <SharedGroupStepActionMenu
          actions={stepActions}
          className="step-card-menu--floating"
          label={`Step ${stepNumber} actions`}
          openOnHover
          previewActions={stepActions}
        />
      </div>

      {isExpanded ? (
        <div className="step-card-body">
          <FormField label="Action">
            <RichTextEditor
              availableParameters={availableParameters}
              parameterValues={parameterValues}
              rows={2}
              value={step.action}
              onChange={(action) =>
                onChange({
                  action,
                  expected_result: step.expected_result,
                  step_type: step.step_type,
                  automation_code: step.automation_code,
                  api_request: step.api_request
                })
              }
            />
          </FormField>
          <FormField label="Expected result">
            <RichTextEditor
              availableParameters={availableParameters}
              parameterValues={parameterValues}
              rows={3}
              value={step.expected_result}
              onChange={(expected_result) =>
                onChange({
                  action: step.action,
                  expected_result,
                  step_type: step.step_type,
                  automation_code: step.automation_code,
                  api_request: step.api_request
                })
              }
            />
          </FormField>
        </div>
      ) : null}
    </article>
  );
}

function SharedStepAccordionSection({
  title,
  summary,
  countLabel,
  isExpanded,
  onToggle,
  actions,
  children
}: {
  title: string;
  summary: string;
  countLabel: string;
  isExpanded: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={isExpanded ? "editor-accordion-section is-expanded" : "editor-accordion-section"}>
      <div className="editor-accordion-head">
        <button
          aria-expanded={isExpanded}
          className="editor-accordion-toggle"
          onClick={onToggle}
          type="button"
        >
          <div className="editor-accordion-toggle-main">
            <span aria-hidden="true" className={isExpanded ? "editor-accordion-icon is-expanded" : "editor-accordion-icon"}>
              <SharedStepAccordionChevronIcon />
            </span>
            <div className="editor-accordion-toggle-copy">
              <strong>{title}</strong>
              <span>{summary}</span>
            </div>
          </div>
        </button>
        <div className="editor-accordion-toggle-meta">
          <span className="editor-accordion-toggle-count">{countLabel}</span>
          {actions ? <div className="editor-accordion-actions">{actions}</div> : null}
          <button
            aria-label={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
            className="editor-accordion-toggle-state explorer-icon-button"
            onClick={onToggle}
            title={isExpanded ? "Collapse section" : "Expand section"}
            type="button"
          >
            <CollapseExpandIcon isExpanded={isExpanded} />
          </button>
        </div>
      </div>
      {isExpanded ? <div className="editor-accordion-body">{children}</div> : null}
    </section>
  );
}

function SharedStepAccordionChevronIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
