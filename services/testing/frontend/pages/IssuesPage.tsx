import { capabilityView } from "@hellotest/platform/frontend/src/platform/capabilities/CapabilityView";
const DefectTriageDialog = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/DefectTriageDialog")["DefectTriageDialog"]> & {}>("ai", "DefectTriageDialog", () => import("@hellotest/ai/frontend/components/DefectTriageDialog"), "ai");
const StoryAiStudioShell = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/StoryAiStudioShell")["StoryAiStudioShell"]> & {}>("ai", "StoryAiStudioShell", () => import("@hellotest/ai/frontend/components/StoryAiStudioShell"), "ai");
const DefectAiDraftWorkspace = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/DefectAiDraftWorkspace")["DefectAiDraftWorkspace"]> & {}>("ai", "DefectAiDraftWorkspace", () => import("@hellotest/ai/frontend/components/DefectAiDraftWorkspace"), "ai");
import { formatDefectFieldLabel, formatRecordKindLabel } from "../lib/defectTerminology";
import { FormEvent, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { BugIcon, ChevronRightIcon, ExportIcon, SearchIcon, SelectionToggleIcon, SparkIcon, TestCaseIcon, TrashIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";

import { AiEvidenceButton, AiEvidenceFlyout } from "@hellotest/agentic/frontend/components/AgenticExperience";
import { StoryAiSettingsGroup } from "@hellotest/ai/frontend/components/StoryAiStudioShell";
import { StoryAiDraftQueue } from "@hellotest/ai/frontend/components/StoryAiStudioContent";

import { AiLlmSelect } from "@hellotest/ai/frontend/components/AiLlmSelect";
import { useAiLlmDefault } from "@hellotest/integration/frontend/hooks/useAiLlmDefault";
import { AiPromptContextPanel } from "@hellotest/ai/frontend/components/AiPromptContextPanel";
import { CatalogSelectionControls } from "@hellotest/platform/frontend/src/shared/components/CatalogSelectionControls";
import { CatalogSearchFilter } from "@hellotest/platform/frontend/src/shared/components/CatalogSearchFilter";
import { CatalogViewToggle } from "@hellotest/platform/frontend/src/shared/components/CatalogViewToggle";
import { DataTable, type DataTableColumn } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { DisplayIdBadge } from "@hellotest/platform/frontend/src/shared/components/DisplayIdBadge";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { JiraAttachmentIcon, JiraAttachmentPanel } from "@hellotest/integration/frontend/components/JiraAttachmentPanel";
import { IssueActivityPanel } from "../components/IssueActivityPanel";
import { JiraRequiredFields } from "@hellotest/integration/frontend/components/JiraRequiredFields";
import { HierarchyAutoLoadSentinel } from "../components/HierarchyLoadMoreButton";
import { LabelsField } from "@hellotest/platform/frontend/src/shared/components/LabelsField";
import { TestCasePicker } from "../components/TestCasePicker";
import { resolveTestCasePickerScope } from "../lib/testCasePickerPages";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { MetricMethodologyInfo } from "@hellotest/ai/frontend/components/MetricMethodologyInfo";
import { PageHeader } from "@hellotest/platform/frontend/src/shared/components/PageHeader";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";
import { QualityMetricStrip } from "@hellotest/dashboard/frontend/components/QualityMetricStrip";
import { RichTextContent, RichTextEditor, richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { ReportBugSplitActionButton } from "../components/ReportBugSplitActionButton";
import { ReportBugModal } from "../components/ReportBugModal";
import { TileCardSkeletonGrid } from "@hellotest/platform/frontend/src/shared/components/TileCardSkeletonGrid";
import { TileCardMetric, TileCardProgress, TileCardStatusIndicator, formatTileCardLabel, getTileCardTone } from "@hellotest/platform/frontend/src/shared/components/TileCardPrimitives";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "@hellotest/platform/frontend/src/platform/components/WorkspaceMasterDetail";
import { useDeleteConfirmation } from "@hellotest/platform/frontend/src/shared/components/DeleteConfirmationDialog";
import { useDomainMetadata } from "@hellotest/platform/frontend/src/platform/hooks/useDomainMetadata";
import { getDomainOptions, getDomainSuggestions } from "@hellotest/platform/frontend/src/platform/lib/domainOptions";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { useAiPromptRegistry } from "@hellotest/integration/frontend/hooks/useAiPromptRegistry";
import { useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { BUG_TO_TEST_CASE_STORAGE_KEY, buildBugToTestCaseDraft } from "../lib/bugToTestCaseConversion";
import { isJiraCoreFieldRequired } from "@hellotest/integration/frontend/lib/jiraCreateMetadata";
import { mergeAiReferenceImagesWithinBudget, parseExternalLinks, readImageFiles } from "@hellotest/ai/frontend/lib/aiDesignStudio";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { safeBugReportReturnRoute } from "../lib/bugReportNavigation";
import {
  buildDeliveryScopeOptions,
  resolveDeliveryScopePrefill,
  type DeliveryScopeCatalogInput,
  type DeliveryScopePrefillInput
} from "@hellotest/manual/frontend/lib/deliveryScopeOptions";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { optionalQueryView } from "@hellotest/platform/frontend/src/shared/lib/optionalQueryView";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { downloadCsvRecords } from "@hellotest/platform/frontend/src/shared/lib/csvExport";
import { readDefaultCatalogViewMode } from "@hellotest/platform/frontend/src/shared/lib/viewPreferences";
import { useWorkspaceData } from "@hellotest/platform/frontend/src/platform/hooks/useWorkspaceData";
import type { AiBugDraftEditableField, AiBugDraftPreview, AiDesignImageInput, AiProcessingSnapshot, Issue, Requirement, RequirementIteration, RequirementRelease, TestCase } from "@hellotest/platform/frontend/src/types";
import "./IssuesPage.css";

const MAX_AI_BUG_TRIAGE_ITEMS = 10;
const BULK_BUG_DELETE_BATCH_SIZE = 20;
const BUG_EXPORT_BATCH_SIZE = 100;

const AI_BUG_DRAFT_PENDING_PROCESSING: AiProcessingSnapshot = {
  active_stage_id: "context",
  completed_stage_count: 1,
  total_stage_count: 4,
  status_label: "Validating selected evidence",
  stages: [
    { id: "intake", status: "complete", detail: "Incident brief submitted.", evidence: "The reporter's requested Defect boundary was accepted." },
    { id: "context", status: "running", detail: "Validating project records and reporter evidence.", evidence: "Only bounded, project-scoped sources will be admitted." },
    { id: "specialist", status: "queued", detail: "Drafting starts after evidence validation." },
    { id: "review", status: "queued", detail: "Human review opens after contract validation." }
  ]
};


type IssueDraft = {
  title: string;
  message: string;
  steps_to_reproduce: string;
  expected_result: string;
  actual_result: string;
  severity: string;
  priority: string;
  environment: string;
  build: string;
  jira_bug_key: string;
  linked_test_run_id: string;
  linked_test_case_ids: string[];
  linked_test_suite_ids: string[];
  linked_module_ids: string[];
  linked_requirement_ids: string[];
  assignee_id: string;
  root_cause: string;
  qa_root_cause: string;
  bug_type: string;
  regression: boolean;
  status: string;
  labelsText: string;
  sprint: string;
  release: string;
  additional_fields: Record<string, unknown>;
};

const DEFAULT_ISSUE_STATUS_OPTIONS = [
  { value: "To Do", label: "To Do", category_key: "new", category_name: "To Do" },
  { value: "In Progress", label: "In Progress", category_key: "indeterminate", category_name: "In Progress" },
  { value: "Done", label: "Done", category_key: "done", category_name: "Done" }
];

function jiraStatusOptionLabel(option: { label: string; category_name?: string | null; current?: boolean }) {
  const category = String(option.category_name || "").trim();
  return `${option.label}${category && category.toLowerCase() !== option.label.toLowerCase() ? ` · ${category}` : ""}${option.current ? " · current" : ""}`;
}

const ISSUE_SEVERITY_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" }
];

const ISSUE_PRIORITY_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "Highest", label: "Highest" },
  { value: "High", label: "High" },
  { value: "Medium", label: "Medium" },
  { value: "Low", label: "Low" },
  { value: "Lowest", label: "Lowest" }
];

const ISSUE_ROOT_CAUSE_OPTIONS = ["Code Defect", "Requirements Gap", "Design Defect", "Configuration", "Test Data", "Environment", "Integration", "Dependency", "Deployment", "Performance / Capacity", "Security", "Human Error", "Duplicate", "Not Reproducible", "Unknown"];
const ISSUE_QA_ROOT_CAUSE_OPTIONS = ["Missed test scenario", "Missed in execution", "Edge case not covered", "Unique data variation", "Third party scenario"];
const ISSUE_BUG_TYPE_OPTIONS = ["Functional", "UI / UX", "Performance", "Security", "Accessibility", "Compatibility", "Integration", "Data", "API", "Reliability", "Localization", "Installation / Deployment", "Documentation"];

const createEmptyIssueDraft = (defaultStatus = "To Do"): IssueDraft => ({
  title: "",
  message: "",
  steps_to_reproduce: "",
  expected_result: "",
  actual_result: "",
  severity: "",
  priority: "",
  environment: "",
  build: "",
  jira_bug_key: "",
  linked_test_run_id: "",
  linked_test_case_ids: [],
  linked_test_suite_ids: [],
  linked_module_ids: [],
  linked_requirement_ids: [],
  assignee_id: "",
  root_cause: "",
  qa_root_cause: "",
  bug_type: "",
  regression: false,
  status: defaultStatus,
  labelsText: "",
  sprint: "",
  release: "",
  additional_fields: {}
});

const createIssueDraftFromItem = (item: Issue, defaultStatus: string): IssueDraft => ({
  title: item.title,
  message: item.message,
  steps_to_reproduce: item.steps_to_reproduce || "",
  expected_result: item.expected_result || "",
  actual_result: item.actual_result || "",
  severity: item.severity || "",
  priority: item.priority || "",
  environment: item.environment || "",
  build: item.build || "",
  jira_bug_key: item.jira_bug_key || "",
  linked_test_run_id: item.linked_test_run_id || "",
  linked_test_case_ids: item.linked_test_case_ids || [],
  linked_test_suite_ids: item.linked_test_suite_ids || [],
  linked_module_ids: item.linked_module_ids || [],
  linked_requirement_ids: item.linked_requirement_ids || [],
  assignee_id: item.assignee_id || "",
  root_cause: item.root_cause || "",
  qa_root_cause: item.qa_root_cause || "",
  bug_type: item.bug_type || "",
  regression: Boolean(item.regression),
  status: item.status || defaultStatus,
  labelsText: (item.labels || []).join(", "),
  sprint: item.sprint || "",
  release: item.fix_version || item.release || "",
  additional_fields: {}
});

const parseQueryIdList = (...values: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      values
        .flatMap((value) => String(value || "").split(/[,\n;|]/))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );

const readDeliveryScopePrefill = (searchParams: URLSearchParams): DeliveryScopePrefillInput => ({
  releaseId: searchParams.get("releaseId") || searchParams.get("release_id"),
  releaseToken: searchParams.get("fixVersion") || searchParams.get("fix_version") || searchParams.get("release"),
  sprintId: searchParams.get("sprintId") || searchParams.get("sprint_id"),
  sprintToken: searchParams.get("sprint")
});

const deliveryScopePrefillKey = (prefill: DeliveryScopePrefillInput) => [
  prefill.releaseId || "",
  prefill.releaseToken || "",
  prefill.sprintId || "",
  prefill.sprintToken || ""
].join("\u0000");

const hasDeliveryScopePrefill = (prefill: DeliveryScopePrefillInput) =>
  Boolean(prefill.releaseId || prefill.releaseToken || prefill.sprintId || prefill.sprintToken);

const createIssueDraftFromQuery = (searchParams: URLSearchParams, defaultStatus: string): IssueDraft => {
  const runId = searchParams.get("run") || "";
  const linkedTestCaseIds = parseQueryIdList(
    searchParams.get("testCase"),
    searchParams.get("testCaseId"),
    searchParams.get("case"),
    searchParams.get("caseId"),
    searchParams.get("linked_test_case_ids"),
    searchParams.get("testCases")
  );
  const linkedRequirementIds = parseQueryIdList(
    searchParams.get("requirement"),
    searchParams.get("requirementId"),
    searchParams.get("linked_requirement_ids"),
    searchParams.get("requirements")
  );
  const linkedTestSuiteIds = parseQueryIdList(
    searchParams.get("suite"),
    searchParams.get("suiteId"),
    searchParams.get("linked_test_suite_ids"),
    searchParams.get("suites")
  );
  const linkedModuleIds = parseQueryIdList(
    searchParams.get("module"),
    searchParams.get("moduleId"),
    searchParams.get("linked_module_ids"),
    searchParams.get("modules")
  );
  const title = searchParams.get("title") || (runId ? `Run defect: ${runId}` : "");
  const message = searchParams.get("message") || [
    "Reported from run details.",
    "",
    runId ? `Run ID: ${runId}` : "",
    searchParams.get("runName") ? `Run name: ${searchParams.get("runName")}` : "",
    searchParams.get("status") ? `Run status: ${searchParams.get("status")}` : "",
    "",
    "Defect details:"
  ].filter((line) => line !== "").join("\n");

  return {
    title,
    message,
    steps_to_reproduce: "",
    expected_result: "",
    actual_result: "",
    severity: "",
    priority: "",
    environment: searchParams.get("environment") || "",
    build: searchParams.get("build") || "",
    jira_bug_key: searchParams.get("jira") || searchParams.get("jiraBugKey") || "",
    linked_test_run_id: runId,
    linked_test_case_ids: linkedTestCaseIds,
    linked_test_suite_ids: linkedTestSuiteIds,
    linked_module_ids: linkedModuleIds,
    linked_requirement_ids: linkedRequirementIds,
    assignee_id: "",
    root_cause: "",
    qa_root_cause: "",
    bug_type: "",
    regression: false,
    status: defaultStatus,
    labelsText: "",
    sprint: searchParams.get("sprint") || "",
    release: searchParams.get("fixVersion") || searchParams.get("fix_version") || searchParams.get("release") || "",
    additional_fields: {}
  };
};

const optionalDraftValue = (value: string) => {
  return value.trim();
};

const bugTitleSimilarity = (left: string, right: string) => {
  const words = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 2));
  const leftWords = words(left);
  const rightWords = words(right);
  if (!leftWords.size || !rightWords.size) return 0;
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  return overlap / Math.min(leftWords.size, rightWords.size);
};

const buildIssuePayload = (draft: IssueDraft, userId: string, projectId: string, can: (permission: string) => boolean) => ({
  project_id: projectId,
  user_id: userId,
  title: draft.title,
  message: draft.message,
  steps_to_reproduce: optionalDraftValue(draft.steps_to_reproduce),
  expected_result: optionalDraftValue(draft.expected_result),
  actual_result: optionalDraftValue(draft.actual_result),
  severity: optionalDraftValue(draft.severity),
  priority: optionalDraftValue(draft.priority),
  environment: optionalDraftValue(draft.environment),
  build: optionalDraftValue(draft.build),
  jira_bug_key: optionalDraftValue(draft.jira_bug_key),
  ...(can("run.view") ? { linked_test_run_id: optionalDraftValue(draft.linked_test_run_id) } : {}),
  ...(can("testcase.view") ? { linked_test_case_ids: draft.linked_test_case_ids } : {}),
  ...(can("suite.view") ? { linked_test_suite_ids: draft.linked_test_suite_ids } : {}),
  ...(can("testcase.view") ? { linked_module_ids: draft.linked_module_ids } : {}),
  ...(can("requirement.view") ? { linked_requirement_ids: draft.linked_requirement_ids } : {}),
  ...(can("project_member.view") ? { assignee_id: optionalDraftValue(draft.assignee_id) } : {}),
  root_cause: optionalDraftValue(draft.root_cause),
  qa_root_cause: optionalDraftValue(draft.qa_root_cause),
  bug_type: optionalDraftValue(draft.bug_type),
  regression: draft.regression,
  status: draft.status,
  labels: draft.labelsText.split(",").map((value) => value.trim()).filter(Boolean),
  ...(can("requirement_iteration.view") ? { sprint: optionalDraftValue(draft.sprint) } : {}),
  fix_version: optionalDraftValue(draft.release),
  ...(can("requirement_iteration.view") ? { release: optionalDraftValue(draft.release) } : {}),
  additional_fields: draft.additional_fields
});

type ImpactPickerOption = {
  id: string;
  displayId?: string | null;
  title: string;
  meta?: string;
};

function ImpactCheckboxPicker({
  disabled,
  emptyText,
  items,
  label,
  onChange,
  placeholder,
  selectedIds
}: {
  disabled?: boolean;
  emptyText: string;
  items: ImpactPickerOption[];
  label: string;
  onChange: (ids: string[]) => void;
  placeholder: string;
  selectedIds: string[];
}) {
  const [search, setSearch] = useState("");
  const labelId = useId().replace(/:/g, "");
  const normalizedSearch = search.trim().toLowerCase();
  const visibleItems = useMemo(
    () =>
      items.filter((item) =>
        !normalizedSearch ||
        [item.id, item.displayId || "", item.title, item.meta || ""]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch)
      ),
    [items, normalizedSearch]
  );
  const visibleIds = visibleItems.map((item) => item.id);
  const areAllVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const toggleItem = (id: string, checked: boolean) => {
    onChange(checked ? [...new Set([...selectedIds, id])] : selectedIds.filter((selectedId) => selectedId !== id));
  };

  return (
    <details className="form-field impact-checkbox-field impact-select-dropdown">
      <summary className="impact-select-summary">
        <span className="form-field-label" id={labelId}>{label}</span>
        <span>{selectedIds.length ? `${selectedIds.length} selected` : "Select…"}</span>
      </summary>
      <div className="impact-select-popover">
      <div className="impact-checkbox-heading">
        <span>{selectedIds.length} selected</span>
        <div className="impact-checkbox-actions">
          <button
            className="impact-checkbox-action"
            disabled={disabled || !visibleIds.length || areAllVisibleSelected}
            onClick={() => onChange([...new Set([...selectedIds, ...visibleIds])])}
            type="button"
          >
            <SelectionToggleIcon checked />
            Select all
          </button>
          <span aria-hidden="true">|</span>
          <button
            className="impact-checkbox-action"
            disabled={disabled}
            onClick={() => onChange([])}
            type="button"
          >
            <SelectionToggleIcon checked={false} />
            Clear
          </button>
        </div>
      </div>
      <div className="impact-checkbox-picker">
        <label className="impact-checkbox-search">
          <SearchIcon />
          <input
            aria-label={`Search ${label.toLowerCase()}`}
            disabled={disabled}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={placeholder}
            value={search}
          />
        </label>
        <div aria-labelledby={labelId} className="impact-checkbox-list" role="group">
          {visibleItems.map((item) => {
            const isChecked = selectedIds.includes(item.id);

            return (
              <label className={isChecked ? "impact-checkbox-option is-selected" : "impact-checkbox-option"} key={item.id}>
                <input
                  checked={isChecked}
                  disabled={disabled}
                  onChange={(event) => toggleItem(item.id, event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <strong>{item.title}</strong>
                  <small>{[item.displayId || item.id, item.meta].filter(Boolean).join(" · ")}</small>
                </span>
              </label>
            );
          })}
          {!visibleItems.length ? <div className="empty-state compact">{items.length ? "No records match this search." : emptyText}</div> : null}
        </div>
      </div>
      </div>
    </details>
  );
}

function IssueEditorSurface({
  actions,
  backLabel,
  children,
  closeDisabled,
  isCreating,
  onClose,
  subtitle,
  title
}: {
  actions?: ReactNode;
  backLabel: string;
  children: ReactNode;
  closeDisabled: boolean;
  isCreating: boolean;
  onClose: () => void;
  subtitle: string;
  title: string;
}) {
  if (isCreating) {
    return (
      <ReportBugModal
        backLabel={backLabel}
        closeDisabled={closeDisabled}
        onClose={onClose}
      >
        {children}
      </ReportBugModal>
    );
  }

  return (
    <Panel
      className="issue-detail-shell"
      title={title}
    >
      <header className="issue-detail-header">
        <WorkspaceBackButton label={backLabel} onClick={onClose} />
        <span aria-hidden="true" className="issue-detail-header-icon">
          <BugIcon size={20} strokeWidth={1.8} />
        </span>
        <div className="issue-detail-heading">
          <span>Defect workspace</span>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {actions ? <div className="issue-detail-header-actions">{actions}</div> : null}
      </header>
      {children}
    </Panel>
  );
}

export function IssuesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { getLlmIntegrationId, getMetricCriteria, getPrompt } = useAiPromptRegistry();
  const [projectId] = useCurrentProject();
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const { can } = useCapabilityAccess(projectId);
  const canViewTestCases = can("testcase.view");
  const canViewSuites = can("suite.view");
  const canViewStories = can("requirement.view");
  const canViewRuns = can("run.view");
  const canViewEnvironments = can("environment.view");
  const canViewAttachments = can("attachment.view");
  const canCreateAttachments = can("attachment.create");
  const canDeleteAttachments = can("attachment.delete");
  const canManageBugs = can("feedback.manage");
  const canCreateBugs = can("feedback.create");
  const canCommentOnBugs = can("comment.create");
  const canCreateTestCases = can("testcase.create");
  const canViewProjectMembers = can("project_member.view");
  const canViewDeliveryScopes = can("requirement_iteration.view")
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.manual.requirements"]);
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const domainMetadataQuery = useDomainMetadata();
  const canUseAiBugDraft = canCreateBugs
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.bug_triage"]);
  const canUseAiBugTriage = canManageBugs
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.bug_triage"]);
  const [searchParams, setSearchParams] = useSearchParams();
  const bugReturnTo = safeBugReportReturnRoute(searchParams.get("returnTo"));
  const bugReturnLabel = String(searchParams.get("returnLabel") || "previous QA screen").slice(0, 80);
  const issueMetadata = domainMetadataQuery.data?.issues || domainMetadataQuery.data?.feedback;
  const defaultIssueStatus = issueMetadata?.default_status || "To Do";
  const issueStatusOptions = issueMetadata?.statuses?.length ? issueMetadata.statuses : DEFAULT_ISSUE_STATUS_OPTIONS;
  const jiraSprints = useMemo(
    () => asArray(domainMetadataQuery.data?.jira?.sprints),
    [domainMetadataQuery.data?.jira?.sprints]
  );
  const jiraVersions = useMemo(
    () => asArray(domainMetadataQuery.data?.jira?.versions).filter((version) => !version.archived),
    [domainMetadataQuery.data?.jira?.versions]
  );
  const emptyDraft = useMemo(() => createEmptyIssueDraft(defaultIssueStatus), [defaultIssueStatus]);
  const [selectedIssueId, setSelectedIssueId] = useState(() => searchParams.get("issue") || "");
  const [isCreating, setIsCreating] = useState(false);
  const canEditBugFields = isCreating ? canCreateBugs : canManageBugs;
  const selectionProjectRef = useRef(projectId);
  useEffect(() => {
    if (selectionProjectRef.current === projectId) return;
    selectionProjectRef.current = projectId;
    setSelectedIssueId(searchParams.get("issue") || "");
    setIsCreating(false);
    setIsAiBugDraftOpen(false);
    setIsAiBugEvidenceSetupOpen(false);
    setIsAiBugDraftEvidenceOpen(false);
    setAiDraftPreview(null);
    setAiBugIntegrationId("");
    aiBugRequestSequence.current += 1;
  }, [projectId, searchParams]);
  const [draft, setDraft] = useState<IssueDraft>(() => createEmptyIssueDraft());
  const rootCauseOptions = getDomainOptions(domainMetadataQuery.data, "issues.root_causes", ISSUE_ROOT_CAUSE_OPTIONS.map(value => ({ value, label: value })), [draft.root_cause]);
  const qaRootCauseOptions = getDomainOptions(domainMetadataQuery.data, "issues.qa_root_causes", ISSUE_QA_ROOT_CAUSE_OPTIONS.map(value => ({ value, label: value })), [draft.qa_root_cause]);
  const bugTypeOptions = getDomainOptions(domainMetadataQuery.data, "issues.bug_types", ISSUE_BUG_TYPE_OPTIONS.map(value => ({ value, label: value })), [draft.bug_type]);
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [isPendingAttachmentDragActive, setIsPendingAttachmentDragActive] = useState(false);
  const pendingAttachmentInputRef = useRef<HTMLInputElement>(null);
  const [duplicateCandidates, setDuplicateCandidates] = useState<Issue[]>([]);
  const [duplicateReviewAccepted, setDuplicateReviewAccepted] = useState(false);
  const [activeBugDeliveryPrefill, setActiveBugDeliveryPrefill] = useState<DeliveryScopePrefillInput | null>(null);
  const appliedBugDeliveryPrefillRef = useRef<{ key: string; release: string; sprint: string } | null>(null);
  const seededIssueDraftKeyRef = useRef("");
  const closedIssueIdRef = useRef("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [catalogViewMode, setCatalogViewMode] = useState<"tile" | "list">(() => readDefaultCatalogViewMode());
  const [selectedActionIssueIds, setSelectedActionIssueIds] = useState<string[]>([]);
  const [isDeletingSelectedIssues, setIsDeletingSelectedIssues] = useState(false);
  const [isExportingIssues, setIsExportingIssues] = useState(false);
  const [isAiBugTriageOpen, setIsAiBugTriageOpen] = useState(false);
  const [triageIssues, setTriageIssues] = useState<Issue[]>([]);
  const [issueSearch, setIssueSearch] = useState("");
  const deferredIssueSearch = useDeferredValue(issueSearch);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [issueStatusFilter, setIssueStatusFilter] = useState("");
  const [issuePriorityFilter, setIssuePriorityFilter] = useState("");
  const [issueAssigneeFilter, setIssueAssigneeFilter] = useState("");
  useEffect(() => {
    const timeout = window.setTimeout(() => setCatalogSearch(deferredIssueSearch.trim()), 200);
    return () => window.clearTimeout(timeout);
  }, [deferredIssueSearch]);
  const [isAiBugDraftOpen, setIsAiBugDraftOpen] = useState(false);
  const aiBugRequestSequence = useRef(0);
  const aiBugProjectRef = useRef(projectId);
  aiBugProjectRef.current = projectId;
  const [aiIntent, setAiIntent] = useState("");
  const [aiEvidence, setAiEvidence] = useState("");
  const [aiAdditionalContext, setAiAdditionalContext] = useState("");
  const [aiExternalLinksText, setAiExternalLinksText] = useState("");
  const [aiReferenceImages, setAiReferenceImages] = useState<AiDesignImageInput[]>([]);
  const [aiLinkedRunId, setAiLinkedRunId] = useState("");
  const [aiLinkedCaseIds, setAiLinkedCaseIds] = useState<string[]>([]);
  const [aiLinkedRequirementIds, setAiLinkedRequirementIds] = useState<string[]>([]);
  const [aiDraftPreview, setAiDraftPreview] = useState<AiBugDraftPreview | null>(null);
  const [aiDraftMessage, setAiDraftMessage] = useState("");
  const [aiDraftMessageTone, setAiDraftMessageTone] = useState<"error" | "warning">("error");
  const [aiBugIntegrationId, setAiBugIntegrationId] = useState("");
  const [isAiBugContextBusy, setIsAiBugContextBusy] = useState(false);
  const [isAiBugEvidenceSetupOpen, setIsAiBugEvidenceSetupOpen] = useState(false);
  const [isAiBugDraftEvidenceOpen, setIsAiBugDraftEvidenceOpen] = useState(false);
  const [hasAppliedBugContextDefaults, setHasAppliedBugContextDefaults] = useState(true);
  const [hasAppliedAiBugContextDefaults, setHasAppliedAiBugContextDefaults] = useState(true);

  const aiBugIntegrationsQuery = useQuery({
    queryKey: ["integrations", "llm", "ai-bug-draft"],
    queryFn: () => api.integrations.list({ type: "llm", is_active: true }),
    enabled: isAiBugDraftOpen && can("integration.view")
  });
  const aiBugIntegrations = asArray(aiBugIntegrationsQuery.data);
  const aiBugDefaultIntegrationId = useAiLlmDefault({ usageKey: "ai.bug.draft", projectId, integrations: can("integration.view") ? aiBugIntegrations : undefined, enabled: isAiBugDraftOpen });
  const shouldLoadBugContext = isCreating || Boolean(selectedIssueId) || isAiBugDraftOpen;
  const catalogFilters = useMemo(() => ({
    project_id: projectId,
    q: catalogSearch || undefined,
    status: issueStatusFilter || undefined,
    priority: issuePriorityFilter || undefined,
    assignee_id: issueAssigneeFilter || undefined
  }), [projectId, catalogSearch, issueStatusFilter, issuePriorityFilter, issueAssigneeFilter]);
  const catalogEnabled = Boolean(projectId && can("feedback.view") && !isCreating && !selectedIssueId);
  const issues = useInfiniteQuery({
    queryKey: ["issues", projectId, "catalog", session?.user.id, catalogFilters],
    queryFn: ({ pageParam, signal }) => api.issues.catalogPage({ ...catalogFilters, page_size: 25, cursor: pageParam }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage, _pages, _lastPageParam, pageParams) => {
      const cursor = !lastPage.is_last ? lastPage.next_cursor : null;
      return cursor && !pageParams.includes(cursor) ? cursor : undefined;
    },
    enabled: catalogEnabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: (previousData, previousQuery) => previousQuery?.queryKey[1] === projectId && previousQuery?.queryKey[3] === session?.user.id ? previousData : undefined
  });
  const issueMetricsQuery = useQuery({
    queryKey: ["issues", projectId, "metrics", session?.user.id, catalogFilters],
    queryFn: ({ signal }) => api.issues.metrics(catalogFilters, { signal }),
    enabled: catalogEnabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1
  });
  const { projectMembers, executions, requirements } = useWorkspaceData({
    issues: false,
    roles: false,
    projects: false,
    projectMembers: shouldLoadBugContext && canViewProjectMembers,
    appTypes: false,
    testSuites: false,
    executionResults: false,
    issuesProjection: "summary",
    users: false,
    executions: shouldLoadBugContext,
    testCases: false,
    requirements: shouldLoadBugContext
  });
  const bugSuitesQuery = optionalQueryView(useQuery({
    queryKey: ["bug-suite-picker", projectId],
    queryFn: ({ signal }) => api.testSuites.list({ project_id: projectId, projection: "picker" }, { signal }),
    enabled: Boolean(canViewSuites && projectId && shouldLoadBugContext),
    staleTime: 30_000
  }), canViewSuites);
  const testCaseModulesQuery = optionalQueryView(useQuery({
    queryKey: ["test-case-modules", projectId, "bug-scope"],
    queryFn: () => api.testCaseModules.list({ project_id: projectId, projection: "summary" }),
    enabled: Boolean(canViewTestCases && projectId && shouldLoadBugContext),
    staleTime: 30_000
  }), canViewTestCases);
  const testEnvironmentsQuery = optionalQueryView(useQuery({
    queryKey: ["test-environments", projectId, "bug-scope"],
    queryFn: () => api.testEnvironments.list({ project_id: projectId }),
    enabled: Boolean(canViewEnvironments && projectId && shouldLoadBugContext),
    staleTime: 30_000
  }), canViewEnvironments);
  const requirementIterationsQuery = optionalQueryView(useQuery({
    queryKey: ["requirement-iterations", projectId, "bug-scope"],
    queryFn: () => api.requirementIterations.list({ project_id: projectId }),
    enabled: Boolean(canViewDeliveryScopes && projectId && shouldLoadBugContext),
    staleTime: 30_000
  }), canViewDeliveryScopes);
  const requirementReleasesQuery = optionalQueryView(useQuery({
    queryKey: ["requirement-releases", projectId, "bug-scope"],
    queryFn: () => api.requirementReleases.list({ project_id: projectId }),
    enabled: Boolean(canViewDeliveryScopes && projectId && shouldLoadBugContext),
    staleTime: 30_000
  }), canViewDeliveryScopes);
  const selectedIssueQuery = useQuery({
    queryKey: ["bug-detail", projectId, selectedIssueId],
    queryFn: () => api.issues.get(selectedIssueId, { project_id: projectId }),
    enabled: Boolean(projectId && selectedIssueId),
    staleTime: 30_000
  });
  const bugCreateMetadataQuery = useQuery({
    queryKey: ["bug-create-metadata", projectId],
    queryFn: () => api.issues.createMetadata({ project_id: projectId }),
    enabled: Boolean(projectId && isCreating),
    staleTime: 5 * 60_000
  });
  const bugEditMetadataQuery = useQuery({
    queryKey: ["bug-edit-metadata", projectId, selectedIssueId],
    queryFn: () => api.issues.editMetadata(selectedIssueId, { project_id: projectId }),
    enabled: Boolean(projectId && selectedIssueId && !isCreating),
    staleTime: 60_000
  });

  const items = useMemo(() => {
    const unique = new Map<string, Issue>();
    for (const page of issues.data?.pages || []) for (const item of page.items) unique.set(item.id, item);
    return [...unique.values()];
  }, [issues.data]);
  const observedIssueLabels = useMemo(
    () => Array.from(new Set(items.flatMap((item) => item.labels || []).map((label) => label.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [items]
  );
  const issueLabelOptions = getDomainSuggestions(domainMetadataQuery.data, "issues.labels", observedIssueLabels);
  const bugStatusBreakdown = Object.entries(issueMetricsQuery.data?.statuses || {})
    .map(([status, count]) => `${formatTileCardLabel(status, "Open")} ${count}`).join(" · ");
  const userItems = useMemo(() => asArray(projectMembers.data).map((member) => ({
    id: member.user_id,
    name: member.user_name,
    email: member.user_email
  })), [projectMembers.data]);
  const executionItems = asArray(executions.data);
  const [resolvedCaseCache, setResolvedCaseCache] = useState<{ projectId: string; items: TestCase[] }>({ projectId, items: [] });
  const rememberCaseItems = useCallback((resolved: TestCase[]) => {
    if (!resolved.length) return;
    setResolvedCaseCache((current) => {
      const known = new Map((current.projectId === projectId ? current.items : []).map((item) => [item.id, item]));
      let changed = current.projectId !== projectId;
      resolved.forEach((item) => { if (known.get(item.id) !== item) { known.set(item.id, item); changed = true; } });
      return changed ? { projectId, items: [...known.values()] } : current;
    });
  }, [projectId]);
  const explicitAiCaseIds = parseQueryIdList(searchParams.get("linked_test_case_ids"), searchParams.get("testCase"));
  const aiModuleScopeIds = parseQueryIdList(searchParams.get("linked_module_ids"), searchParams.get("module"));
  const aiSuiteScopeIds = parseQueryIdList(searchParams.get("linked_test_suite_ids"), searchParams.get("suite"));
  const aiCasePrefillQuery = optionalQueryView(useQuery({
    queryKey: ["bug-case-prefill", projectId, explicitAiCaseIds.join(","), aiModuleScopeIds.join(","), aiSuiteScopeIds.join(",")],
    queryFn: async ({ signal }) => {
      if (explicitAiCaseIds.length) return resolveTestCasePickerScope({ project_id: projectId, ids: explicitAiCaseIds.join(",") }, signal);
      if (aiModuleScopeIds.length) {
        const rows: TestCase[] = [];
        for (const module_id of aiModuleScopeIds) rows.push(...await resolveTestCasePickerScope({ project_id: projectId, module_id }, signal));
        return [...new Map(rows.map((item) => [item.id, item])).values()];
      }
      return resolveTestCasePickerScope({ project_id: projectId, suite_ids: aiSuiteScopeIds.join(",") }, signal);
    },
    enabled: Boolean(canViewTestCases && projectId && isAiBugDraftOpen && !hasAppliedAiBugContextDefaults && (explicitAiCaseIds.length || aiModuleScopeIds.length || aiSuiteScopeIds.length)),
    staleTime: 30_000,
    retry: 1
  }), canViewTestCases);
  const testCaseItems = useMemo(() => !canViewTestCases ? [] : [...new Map([
    ...(resolvedCaseCache.projectId === projectId ? resolvedCaseCache.items : []),
    ...(aiCasePrefillQuery.data || [])
  ].map((item) => [item.id, item])).values()], [aiCasePrefillQuery.data, projectId, resolvedCaseCache, canViewTestCases]);
  const testSuiteItems = asArray(bugSuitesQuery.data);
  const testCaseModuleItems = asArray(testCaseModulesQuery.data);
  const requirementItems = asArray<Requirement>(requirements.data);
  const requirementIterationItems = asArray<RequirementIteration>(requirementIterationsQuery.data);
  const requirementReleaseItems = asArray<RequirementRelease>(requirementReleasesQuery.data);
  const environmentOptions = useMemo(() => Array.from(new Set([
    ...asArray(testEnvironmentsQuery.data).map((environment) => String(environment.name || "").trim()),
    ...items.map((item) => String(item.environment || "").trim()),
    draft.environment.trim()
  ].filter(Boolean))).sort((left, right) => left.localeCompare(right)), [draft.environment, items, testEnvironmentsQuery.data]);
  const deliveryScopeCatalog = useMemo<DeliveryScopeCatalogInput>(() => ({
    releases: requirementReleaseItems,
    iterations: requirementIterationItems,
    jiraVersions,
    jiraSprints
  }), [jiraSprints, jiraVersions, requirementIterationItems, requirementReleaseItems]);
  const resolvedActiveBugDeliveryPrefill = useMemo(
    () => activeBugDeliveryPrefill
      ? resolveDeliveryScopePrefill(activeBugDeliveryPrefill, deliveryScopeCatalog)
      : null,
    [activeBugDeliveryPrefill, deliveryScopeCatalog]
  );
  const { releaseOptions, sprintOptions } = useMemo(
    () => buildDeliveryScopeOptions({
      ...deliveryScopeCatalog,
      currentRelease: draft.release,
      currentSprint: draft.sprint,
      includeClosedSprints: true
    }),
    [deliveryScopeCatalog, draft.release, draft.sprint]
  );
  const executionById = useMemo(() => new Map(executionItems.map((execution) => [execution.id, execution])), [executionItems]);
  const testCaseById = useMemo(() => new Map(testCaseItems.map((testCase) => [testCase.id, testCase])), [testCaseItems]);
  const requirementIdsFromTestCases = (testCaseIds: string[]) =>
    Array.from(
      new Set(
        testCaseIds.flatMap((testCaseId) => {
          const testCase = testCaseById.get(testCaseId);
          return [
            ...(testCase?.requirement_ids || []),
            testCase?.requirement_id || ""
          ].filter(Boolean);
        })
      )
    );
  const updateDraftLinkedTestCases = (nextIds: string[], resolved: TestCase[]) => {
    rememberCaseItems(resolved);
    const lookup = new Map([...testCaseItems, ...resolved].map((item) => [item.id, item]));
    const uniqueIds = [...new Set(nextIds)];
    const selectedCases = uniqueIds.map((testCaseId) => lookup.get(testCaseId)).filter(Boolean);
    const autoRequirementIds = selectedCases.flatMap((item) => item?.requirement_ids || (item?.requirement_id ? [item.requirement_id] : []));
    const autoSuiteIds = selectedCases.flatMap((testCase) => testCase?.suite_ids || (testCase?.suite_id ? [testCase.suite_id] : []));
    const autoModuleIds = selectedCases.flatMap((testCase) => testCase?.module_ids || []);

    setDraft((current) => {
      const previousCases = current.linked_test_case_ids.map((testCaseId) => testCaseById.get(testCaseId)).filter(Boolean);
      const previousSuiteIds = new Set(previousCases.flatMap((testCase) => testCase?.suite_ids || (testCase?.suite_id ? [testCase.suite_id] : [])));
      const previousModuleIds = new Set(previousCases.flatMap((testCase) => testCase?.module_ids || []));
      const previousRequirementIds = new Set(requirementIdsFromTestCases(current.linked_test_case_ids));
      return {
        ...current,
        linked_test_case_ids: uniqueIds,
        linked_test_suite_ids: [...new Set([...current.linked_test_suite_ids.filter((id) => !previousSuiteIds.has(id)), ...autoSuiteIds])],
        linked_module_ids: [...new Set([...current.linked_module_ids.filter((id) => !previousModuleIds.has(id)), ...autoModuleIds])],
        linked_requirement_ids: [...new Set([...current.linked_requirement_ids.filter((id) => !previousRequirementIds.has(id)), ...autoRequirementIds])]
      };
    });
  };
  const updateDraftLinkedSuites = (nextIds: string[]) => {
    const uniqueIds = [...new Set(nextIds)];
    setDraft((current) => ({
      ...current,
      linked_test_suite_ids: uniqueIds
    }));
  };
  const updateDraftLinkedModules = (nextIds: string[]) => {
    const uniqueIds = [...new Set(nextIds)];
    setDraft((current) => ({
      ...current,
      linked_module_ids: uniqueIds
    }));
  };
  const updateDraftLinkedRequirements = (nextIds: string[]) => {
    setDraft((current) => ({
      ...current,
      linked_requirement_ids: [...new Set(nextIds)]
    }));
  };
  const updateAiLinkedTestCases = (nextIds: string[], resolved: TestCase[]) => {
    rememberCaseItems(resolved);
    const uniqueIds = [...new Set(nextIds)];
    const lookup = new Map([...testCaseItems, ...resolved].map((item) => [item.id, item]));
    const requirementIds = uniqueIds.flatMap((id) => { const item = lookup.get(id); return item?.requirement_ids || (item?.requirement_id ? [item.requirement_id] : []); });
    setAiLinkedCaseIds(uniqueIds);
    setAiLinkedRequirementIds((current) => [...new Set([...current, ...requirementIds])]);
  };
  const requirementImpactOptions = useMemo<ImpactPickerOption[]>(
    () =>
      requirementItems.map((requirement: Requirement) => ({
        id: requirement.id,
        displayId: requirement.display_id,
        title: requirement.title,
        meta: [
          requirement.status || "Open",
          requirement.priority ? `P${requirement.priority}` : null
        ].filter(Boolean).join(" · ")
      })),
    [requirementItems]
  );
  const suiteImpactOptions = useMemo<ImpactPickerOption[]>(
    () => testSuiteItems.map((suite) => ({
      id: suite.id,
      displayId: suite.display_id,
      title: suite.name,
      meta: `${suite.test_case_count ?? suite.test_case_ids?.length ?? 0} test cases`
    })),
    [testSuiteItems]
  );
  const moduleImpactOptions = useMemo<ImpactPickerOption[]>(
    () => testCaseModuleItems.map((module) => ({
      id: module.id,
      displayId: module.display_id,
      title: module.name,
      meta: `${module.test_case_count || module.test_case_ids?.length || 0} test cases`
    })),
    [testCaseModuleItems]
  );
  const assigneeLabelById = useMemo(
    () => new Map(userItems.map((user) => [user.id, user.name || user.email || user.id])),
    [userItems]
  );
  const runLabelById = useMemo(
    () => new Map(executionItems.map((execution) => [
      execution.id,
      [
        execution.name || execution.id,
        execution.status || null,
        execution.release ? `Release ${execution.release}` : null,
        execution.build ? `Build ${execution.build}` : null
      ].filter(Boolean).join(" · ")
    ])),
    [executionItems]
  );
  const filteredItems = items;
  const visibleIssueIds = useMemo(() => filteredItems.map((item) => item.id), [filteredItems]);
  const convertedBugCount = issueMetricsQuery.data?.converted ?? 0;
  const selectedActionIssueIdSet = useMemo(() => new Set(selectedActionIssueIds), [selectedActionIssueIds]);
  const selectedActionIssues = useMemo(
    () => items.filter((item) => selectedActionIssueIdSet.has(item.id)),
    [items, selectedActionIssueIdSet]
  );
  const areAllFilteredIssuesSelected = visibleIssueIds.length > 0 && visibleIssueIds.every((id) => selectedActionIssueIdSet.has(id));
  const areSomeFilteredIssuesSelected = visibleIssueIds.some((id) => selectedActionIssueIdSet.has(id)) && !areAllFilteredIssuesSelected;
  const setAllVisibleIssuesSelected = (selected: boolean) => {
    const visibleIds = new Set(visibleIssueIds);
    setSelectedActionIssueIds((current) => selected
      ? [...new Set([...current, ...visibleIssueIds])]
      : current.filter((id) => !visibleIds.has(id)));
  };
  const toggleIssueSelection = (issueId: string, selected: boolean) => {
    setSelectedActionIssueIds((current) => selected
      ? [...new Set([...current, issueId])]
      : current.filter((id) => id !== issueId));
  };

  useEffect(() => {
    setSelectedActionIssueIds([]);
    setIsAiBugTriageOpen(false);
  }, [projectId, catalogSearch, issueStatusFilter, issuePriorityFilter, issueAssigneeFilter]);

  useEffect(() => {
    if (issues.isLoading) return;
    const availableIds = new Set(items.map((item) => item.id));
    setSelectedActionIssueIds((current) => {
      const next = current.filter((id) => availableIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [issues.isLoading, items]);
  const openIssueCount = issueMetricsQuery.data?.open ?? 0;
  const bugCatalogMetrics = {
    priorityRisks: issueMetricsQuery.data?.priority_risks ?? 0,
    total: issueMetricsQuery.data?.total ?? 0,
    unassigned: issueMetricsQuery.data?.unassigned ?? 0
  };
  const metricsPending = issueMetricsQuery.isPending;
  const selectedCatalogItem = items.find((item) => item.id === selectedIssueId) || null;
  const selectedItem = selectedIssueQuery.data || selectedCatalogItem;
  const selectedBugMetrics = useMemo(() => {
    const evidenceFields = [
      draft.message,
      draft.steps_to_reproduce,
      draft.expected_result,
      draft.actual_result
    ];
    const completedEvidenceFields = evidenceFields.filter((value) => richTextToPlainText(value).trim()).length;
    const impactScope = Number(Boolean(draft.linked_test_run_id))
      + draft.linked_test_case_ids.length
      + draft.linked_test_suite_ids.length
      + draft.linked_module_ids.length
      + draft.linked_requirement_ids.length;

    return {
      completedEvidenceFields,
      evidencePercent: Math.round((completedEvidenceFields / evidenceFields.length) * 100),
      impactScope
    };
  }, [
    draft.actual_result,
    draft.expected_result,
    draft.linked_module_ids.length,
    draft.linked_requirement_ids.length,
    draft.linked_test_case_ids.length,
    draft.linked_test_run_id,
    draft.linked_test_suite_ids.length,
    draft.message,
    draft.steps_to_reproduce
  ]);
  const activeBugMetadata = isCreating ? bugCreateMetadataQuery.data : bugEditMetadataQuery.data;
  const activeBugStatusOptions = useMemo(() => {
    const workflowOptions = activeBugMetadata?.workflow_statuses?.statuses || [];
    const baseOptions = workflowOptions.length ? workflowOptions : issueStatusOptions;
    if (!draft.status || baseOptions.some((option) => option.value === draft.status)) return baseOptions;
    return [{ value: draft.status, label: draft.status, current: !isCreating }, ...baseOptions];
  }, [activeBugMetadata?.workflow_statuses?.statuses, draft.status, isCreating, issueStatusOptions]);
  const requiredJiraBugFields = activeBugMetadata?.required_fields || [];
  const jiraBugCoreRequired = {
    priority: isJiraCoreFieldRequired(activeBugMetadata, "priority"),
    assignee: isJiraCoreFieldRequired(activeBugMetadata, "assignee"),
    labels: isJiraCoreFieldRequired(activeBugMetadata, "labels"),
    sprint: isJiraCoreFieldRequired(activeBugMetadata, "sprint"),
    release: isJiraCoreFieldRequired(activeBugMetadata, "fixVersions", "versions")
  };
  const updateAdditionalJiraField = (fieldId: string, value: unknown) => {
    setDraft((current) => ({
      ...current,
      additional_fields: {
        ...current.additional_fields,
        [fieldId]: value
      }
    }));
  };
  const syncIssueSearchParams = (issueId?: string | null) => {
    const currentIssueId = searchParams.get("issue") || "";
    const targetIssueId = issueId || "";

    if (currentIssueId === targetIssueId) {
      return;
    }

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (targetIssueId) {
        next.set("issue", targetIssueId);
      } else {
        next.delete("issue");
      }
      return next;
    }, { replace: true });
  };
  const openIssueWorkspace = (issueId: string) => {
    const catalogItem = items.find((item) => item.id === issueId);
    if (catalogItem) {
      setDraft(createIssueDraftFromItem(catalogItem, defaultIssueStatus));
    }
    setSelectedIssueId(issueId);
    setIsCreating(false);
    syncIssueSearchParams(issueId);
  };
  const issueListColumns = useMemo<Array<DataTableColumn<Issue>>>(() => [
    {
      key: "select",
      label: "Select Defects",
      canToggle: false,
      canReorder: false,
      canResize: false,
      width: 36,
      minWidth: 36,
      headerRender: () => (
        <label className="data-table-header-checkbox" onClick={(event) => event.stopPropagation()}>
          <input
            aria-label={areAllFilteredIssuesSelected ? "Clear all visible Defects" : "Select all visible Defects"}
            checked={areAllFilteredIssuesSelected}
            disabled={!visibleIssueIds.length}
            onChange={(event) => setAllVisibleIssuesSelected(event.target.checked)}
            ref={(element) => {
              if (element) element.indeterminate = areSomeFilteredIssuesSelected;
            }}
            type="checkbox"
          />
        </label>
      ),
      render: (item) => (
        <label className="data-table-row-checkbox">
          <input
            aria-label={`Select Defect ${item.display_id || item.jira_bug_key || item.id}: ${item.title}`}
            checked={selectedActionIssueIdSet.has(item.id)}
            onChange={(event) => toggleIssueSelection(item.id, event.target.checked)}
            type="checkbox"
          />
        </label>
      )
    },
    {
      key: "id",
      label: "ID",
      width: 132,
      minWidth: 100,
      sortValue: (item) => item.id,
      render: (item) => (
        <span className="issue-list-id issue-bug-identity" onClick={(event) => event.stopPropagation()}>
          <BugIcon size={16} strokeWidth={1.8} />
          <DisplayIdBadge value={item.display_id || item.jira_bug_key || item.id} />
        </span>
      )
    },
    {
      key: "title",
      label: "Defect Title",
      canToggle: false,
      width: 280,
      minWidth: 180,
      sortValue: (item) => item.title,
      render: (item) => (
        <div className="data-table-multiline">
          <button
            aria-label={`Open Defect ${item.display_id || item.jira_bug_key || item.id}: ${item.title}`}
            className="issue-record-open-button"
            onClick={(event) => {
              event.stopPropagation();
              openIssueWorkspace(item.id);
            }}
            type="button"
          >
            {item.title}
          </button>
        </div>
      )
    },
    {
      key: "description",
      label: "Description",
      defaultVisible: false,
      width: 360,
      minWidth: 200,
      render: (item) => <span className="data-table-description-clamp">{richTextToPlainText(item.message)}</span>
    },
    {
      key: "status",
      label: "Status",
      width: 132,
      minWidth: 104,
      sortValue: (item) => item.status || defaultIssueStatus,
      render: (item) => formatTileCardLabel(item.status, "Open")
    },
    {
      key: "jira",
      label: "External Defect Key",
      defaultVisible: false,
      width: 150,
      minWidth: 120,
      sortValue: (item) => item.jira_bug_key || "",
      render: (item) => item.jira_bug_key || "—"
    },
    {
      key: "severity",
      label: "Severity",
      width: 132,
      minWidth: 104,
      sortValue: (item) => item.severity || "",
      render: (item) => formatTileCardLabel(item.severity, "Not set")
    },
    {
      key: "priority",
      label: "Priority",
      width: 120,
      minWidth: 96,
      sortValue: (item) => item.priority || "",
      render: (item) => formatTileCardLabel(item.priority, "Not set")
    },
    {
      key: "linkedRun",
      label: "Linked Test Run",
      defaultVisible: false,
      width: 240,
      minWidth: 160,
      sortValue: (item) => runLabelById.get(item.linked_test_run_id || "") || item.linked_test_run_id || "",
      render: (item) => runLabelById.get(item.linked_test_run_id || "") || item.linked_test_run_id || "—"
    },
    {
      key: "environment",
      label: "Environment",
      defaultVisible: false,
      width: 160,
      minWidth: 120,
      sortValue: (item) => item.environment || "",
      render: (item) => item.environment || "—"
    },
    {
      key: "build",
      label: "Build",
      defaultVisible: false,
      width: 150,
      minWidth: 110,
      sortValue: (item) => item.build || "",
      render: (item) => item.build || "—"
    },
    {
      key: "assignee",
      label: "Assignee",
      width: 220,
      minWidth: 150,
      sortValue: (item) => item.assignee_name || item.assignee_email || assigneeLabelById.get(item.assignee_id || "") || "",
      render: (item) => item.assignee_name || item.assignee_email || assigneeLabelById.get(item.assignee_id || "") || "Unassigned"
    },
    {
      key: "reporter",
      label: "Reporter",
      defaultVisible: false,
      width: 220,
      minWidth: 150,
      sortValue: (item) => item.user_name || item.user_email || item.user_id || "",
      render: (item) => item.user_name || item.user_email || item.user_id || "Unknown"
    },
  ], [
    areAllFilteredIssuesSelected,
    areSomeFilteredIssuesSelected,
    assigneeLabelById,
    defaultIssueStatus,
    openIssueWorkspace,
    runLabelById,
    selectedActionIssueIdSet,
    visibleIssueIds
  ]);

  const handleExportIssuesCsv = async () => {
    if (!projectId || !selectedActionIssues.length || isExportingIssues) return;
    setIsExportingIssues(true);
    setMessage("");
    try {
      const exportedItems: Issue[] = [];
      const selectedIssueIds = selectedActionIssues.map((item) => item.id);
      for (let offset = 0; offset < selectedIssueIds.length; offset += BUG_EXPORT_BATCH_SIZE) {
        const response = await api.issues.export({
          project_id: projectId,
          issue_ids: selectedIssueIds.slice(offset, offset + BUG_EXPORT_BATCH_SIZE)
        });
        exportedItems.push(...asArray<Issue>(response.bugs));
      }
      const exportedById = new Map(exportedItems.map((item) => [item.id, item]));
      const selectedItems = selectedIssueIds.map((id) => exportedById.get(id)).filter((item): item is Issue => Boolean(item));
      if (selectedItems.length !== selectedIssueIds.length) {
        throw new Error("Some selected Defects changed or became unavailable. Refresh the list and retry the export.");
      }
      downloadCsvRecords(
        `hellotest-defects-${new Date().toISOString().slice(0, 10)}.csv`,
        selectedItems.map((item) => ({
          ID: item.id,
          "Defect Title": item.title,
          Description: richTextToPlainText(item.message),
          Status: formatTileCardLabel(item.status, "Open"),
          "External Defect Key": item.jira_bug_key || "",
          Severity: formatTileCardLabel(item.severity, "Not set"),
          Priority: formatTileCardLabel(item.priority, "Not set"),
          "Linked Test Run": runLabelById.get(item.linked_test_run_id || "") || item.linked_test_run_id || "",
          Environment: item.environment || "",
          Build: item.build || "",
          Assignee: item.assignee_name || item.assignee_email || assigneeLabelById.get(item.assignee_id || "") || "Unassigned",
          Reporter: item.user_name || item.user_email || item.user_id || "Unknown",
          "Steps To Reproduce": richTextToPlainText(item.steps_to_reproduce),
          "Expected Result": richTextToPlainText(item.expected_result),
          "Actual Result": richTextToPlainText(item.actual_result),
          "Primary Root Cause": richTextToPlainText(item.root_cause),
          "QA Root Cause": item.qa_root_cause || ""
        }))
      );
      setMessageTone("success");
      setMessage(`Exported ${selectedItems.length} selected Defect${selectedItems.length === 1 ? "" : "s"} with current HelloTest details.`);
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to export the selected Defects.");
    } finally {
      setIsExportingIssues(false);
    }
  };

  useEffect(() => {
    if (searchParams.get("create") !== "1" || !canCreateBugs) {
      return;
    }

    const deliveryPrefill = readDeliveryScopePrefill(searchParams);
    const resolvedDeliveryPrefill = resolveDeliveryScopePrefill(deliveryPrefill, deliveryScopeCatalog);
    const nextDraft = createIssueDraftFromQuery(searchParams, defaultIssueStatus);
    nextDraft.release = resolvedDeliveryPrefill.release || nextDraft.release;
    nextDraft.sprint = resolvedDeliveryPrefill.sprint || nextDraft.sprint;

    setIsCreating(true);
    setSelectedIssueId("");
    setDraft(nextDraft);
    setActiveBugDeliveryPrefill(hasDeliveryScopePrefill(deliveryPrefill) ? deliveryPrefill : null);
    appliedBugDeliveryPrefillRef.current = hasDeliveryScopePrefill(deliveryPrefill)
      ? { key: deliveryScopePrefillKey(deliveryPrefill), release: nextDraft.release, sprint: nextDraft.sprint }
      : null;
    setHasAppliedBugContextDefaults(false);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("create");
    nextParams.delete("issue");
    setSearchParams(nextParams, { replace: true });
  }, [canCreateBugs, defaultIssueStatus, deliveryScopeCatalog, searchParams, setSearchParams]);

  useEffect(() => {
    if (!isCreating || !activeBugDeliveryPrefill || !resolvedActiveBugDeliveryPrefill) return;

    const key = deliveryScopePrefillKey(activeBugDeliveryPrefill);
    const previousPrefill = appliedBugDeliveryPrefillRef.current;
    setDraft((current) => {
      const mayUpdateRelease = !current.release
        || Boolean(previousPrefill?.key === key && current.release === previousPrefill.release);
      const mayUpdateSprint = !current.sprint
        || Boolean(previousPrefill?.key === key && current.sprint === previousPrefill.sprint);
      const release = mayUpdateRelease && resolvedActiveBugDeliveryPrefill.release
        ? resolvedActiveBugDeliveryPrefill.release
        : current.release;
      const sprint = mayUpdateSprint && resolvedActiveBugDeliveryPrefill.sprint
        ? resolvedActiveBugDeliveryPrefill.sprint
        : current.sprint;
      return release === current.release && sprint === current.sprint
        ? current
        : { ...current, release, sprint };
    });
    appliedBugDeliveryPrefillRef.current = {
      key,
      release: resolvedActiveBugDeliveryPrefill.release,
      sprint: resolvedActiveBugDeliveryPrefill.sprint
    };
  }, [activeBugDeliveryPrefill, isCreating, resolvedActiveBugDeliveryPrefill]);

  useEffect(() => {
    const requestedIssueId = searchParams.get("issue");
    if (!requestedIssueId) {
      closedIssueIdRef.current = "";
      return;
    }
    if (closedIssueIdRef.current === requestedIssueId) return;
    if (selectedIssueId !== requestedIssueId) {
      setSelectedIssueId(requestedIssueId);
      setIsCreating(false);
    }
  }, [searchParams, selectedIssueId]);

  useEffect(() => {
    const loaded = selectedIssueQuery.data;
    if (!loaded || !selectedIssueId || loaded.id === selectedIssueId) return;
    // Resolve a direct external key without scanning or fetching catalog pages.
    queryClient.setQueryData(["bug-detail", projectId, loaded.id], loaded);
    setSelectedIssueId(loaded.id);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("issue", loaded.id);
      return next;
    }, { replace: true });
  }, [selectedIssueQuery.data, selectedIssueId, queryClient, projectId, setSearchParams]);

  useEffect(() => {
    // The query-driven create effect above seeds the draft in this same effect
    // pass. Preserve that seed until its isCreating update has rendered.
    if (isCreating || (canCreateBugs && searchParams.get("create") === "1")) {
      seededIssueDraftKeyRef.current = "";
      return;
    }

    if (!selectedIssueId) {
      seededIssueDraftKeyRef.current = "";
      setDraft(emptyDraft);
      return;
    }

    if (selectedItem) {
      const draftSeedKey = [
        selectedItem.id,
        selectedItem.revision ?? "no-revision",
        selectedItem.updated_at || "",
        selectedIssueQuery.data?.id === selectedItem.id ? "detail" : "summary"
      ].join(":");
      if (seededIssueDraftKeyRef.current === draftSeedKey) return;
      seededIssueDraftKeyRef.current = draftSeedKey;
      setDraft(createIssueDraftFromItem(selectedItem, defaultIssueStatus));
      setHasAppliedBugContextDefaults(true);
      return;
    }

    // A direct link may refer to a Bug beyond the loaded catalog page.
    // Keep its selection while the independent detail query resolves or fails.
  }, [canCreateBugs, defaultIssueStatus, emptyDraft, isCreating, searchParams, selectedIssueId, selectedItem]);

  useEffect(() => {
    if (isCreating || !selectedItem || !bugEditMetadataQuery.data) return;
    setDraft((current) => ({
      ...current,
      additional_fields: { ...(bugEditMetadataQuery.data.current_values || {}) }
    }));
  }, [bugEditMetadataQuery.data, isCreating, selectedItem]);

  useEffect(() => {
    if (!isCreating || hasAppliedBugContextDefaults || !draft.linked_test_case_ids.length || !draft.linked_test_case_ids.every((id) => testCaseById.has(id))) {
      return;
    }

    const scopedCases = testCaseItems.filter((testCase) => draft.linked_test_case_ids.includes(testCase.id));
    const scopedCaseIds = scopedCases.map((testCase) => testCase.id);
    const autoRequirementIds = requirementIdsFromTestCases(scopedCaseIds);
    const autoSuiteIds = scopedCases.flatMap((testCase) => testCase.suite_ids || (testCase.suite_id ? [testCase.suite_id] : []));
    const autoModuleIds = scopedCases.flatMap((testCase) => testCase.module_ids || []);
    setDraft((current) => ({
      ...current,
      linked_test_case_ids: [...new Set([...current.linked_test_case_ids, ...scopedCaseIds])],
      linked_test_suite_ids: [...new Set([...current.linked_test_suite_ids, ...autoSuiteIds])],
      linked_module_ids: [...new Set([...current.linked_module_ids, ...autoModuleIds])],
      linked_requirement_ids: [...new Set([...current.linked_requirement_ids, ...autoRequirementIds])]
    }));
    setHasAppliedBugContextDefaults(true);
  }, [draft.linked_module_ids, draft.linked_test_case_ids, draft.linked_test_suite_ids, hasAppliedBugContextDefaults, isCreating, testCaseItems]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["issues"] }),
      queryClient.invalidateQueries({ queryKey: ["requirement-release-readiness", "project", projectId] }),
      queryClient.invalidateQueries({ predicate: ({ queryKey }) =>
        queryKey[1] === projectId && ["requirements", "requirement-detail", "requirement-route-detail", "requirement-sprint-health", "sprint-requirement-children", "test-case-module-children"].includes(String(queryKey[0]))
        || queryKey[2] === projectId && ["release-review-context", "release-review-stories", "release-review-cases", "release-review-bugs", "global-test-cases", "test-case-metrics"].includes(String(queryKey[0]))
      }),
      queryClient.invalidateQueries({ queryKey: ["bug-detail", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["bug-history", projectId] })
    ]);
  };

  const previewAiBugDraft = useMutation({ mutationFn: api.issues.previewAiDraft });

  const openManualBugReport = () => {
    if (!canCreateBugs) return;
    syncIssueSearchParams(null);
    setIsCreating(true);
    setSelectedIssueId("");
    setDraft(emptyDraft);
    setActiveBugDeliveryPrefill(null);
    appliedBugDeliveryPrefillRef.current = null;
    setHasAppliedBugContextDefaults(true);
    setMessage("");
    setPendingAttachments([]);
    setDuplicateCandidates([]);
    setDuplicateReviewAccepted(false);
  };

  const openAiBugReport = () => {
    if (!canUseAiBugDraft || isAiBugContextBusy) return;
    const contextualTitle = String(searchParams.get("title") || "").trim();
    const contextualMessage = String(searchParams.get("message") || "").trim();
    const contextualStatus = String(searchParams.get("status") || "").trim();
    const contextualEnvironment = String(searchParams.get("environment") || "").trim();
    const contextualBuild = String(searchParams.get("build") || "").trim();
    const deliveryPrefill = readDeliveryScopePrefill(searchParams);
    const resolvedDeliveryPrefill = resolveDeliveryScopePrefill(deliveryPrefill, deliveryScopeCatalog);
    const hasContextualScope = Boolean(
      searchParams.get("run")
      || searchParams.get("testCase")
      || searchParams.get("linked_test_case_ids")
      || searchParams.get("suite")
      || searchParams.get("linked_test_suite_ids")
      || searchParams.get("module")
      || searchParams.get("linked_module_ids")
      || searchParams.get("requirement")
      || searchParams.get("linked_requirement_ids")
      || hasDeliveryScopePrefill(deliveryPrefill)
    );
    setAiDraftPreview(null);
    setIsAiBugEvidenceSetupOpen(false);
    setIsAiBugDraftEvidenceOpen(false);
    setAiDraftMessage("");
    setAiDraftMessageTone("error");
    setAiIntent(contextualTitle || (hasContextualScope ? "Investigate the selected failed QA context" : ""));
    setAiEvidence([
      contextualMessage,
      contextualStatus ? `Source status: ${contextualStatus}` : "",
      contextualEnvironment ? `Environment: ${contextualEnvironment}` : "",
      contextualBuild ? `Build: ${contextualBuild}` : ""
    ].filter(Boolean).join("\n"));
    setAiAdditionalContext("");
    setAiExternalLinksText("");
    setAiReferenceImages([]);
    setAiLinkedRunId(searchParams.get("run") || "");
    setAiLinkedCaseIds(parseQueryIdList(searchParams.get("linked_test_case_ids"), searchParams.get("testCase")));
    setAiLinkedRequirementIds(parseQueryIdList(searchParams.get("linked_requirement_ids"), searchParams.get("requirement")));
    setActiveBugDeliveryPrefill(hasDeliveryScopePrefill(deliveryPrefill) ? deliveryPrefill : null);
    appliedBugDeliveryPrefillRef.current = hasDeliveryScopePrefill(deliveryPrefill)
      ? {
          key: deliveryScopePrefillKey(deliveryPrefill),
          release: resolvedDeliveryPrefill.release,
          sprint: resolvedDeliveryPrefill.sprint
        }
      : null;
    setHasAppliedAiBugContextDefaults(false);
    setIsAiBugDraftOpen(true);
  };

  const openSelectedBugTriage = () => {
    const selectedIssueIds = selectedActionIssues.map((item) => item.id);
    if (!projectId || !selectedIssueIds.length || !canUseAiBugTriage) return;
    if (selectedIssueIds.length > MAX_AI_BUG_TRIAGE_ITEMS) {
      setMessageTone("error");
      setMessage(`Select no more than ${MAX_AI_BUG_TRIAGE_ITEMS} Defects for one AI triage preview. This keeps workspace reads and AI usage bounded.`);
      return;
    }
    setTriageIssues(selectedActionIssues.slice());
    setIsAiBugTriageOpen(true);
  };

  useEffect(() => {
    if (!isAiBugDraftOpen || hasAppliedAiBugContextDefaults || aiCasePrefillQuery.isFetching || aiCasePrefillQuery.isError) return;
    const explicitCaseIds = parseQueryIdList(searchParams.get("linked_test_case_ids"), searchParams.get("testCase"));
    const moduleIds = parseQueryIdList(searchParams.get("linked_module_ids"), searchParams.get("module"));
    const suiteIds = parseQueryIdList(searchParams.get("linked_test_suite_ids"), searchParams.get("suite"));
    const scopedCases = explicitCaseIds.length
      ? testCaseItems.filter((testCase) => explicitCaseIds.includes(testCase.id))
      : moduleIds.length
        ? testCaseItems.filter((testCase) => (testCase.module_ids || []).some((moduleId) => moduleIds.includes(moduleId)))
        : suiteIds.length
          ? testCaseItems.filter((testCase) => (testCase.suite_ids || (testCase.suite_id ? [testCase.suite_id] : [])).some((suiteId) => suiteIds.includes(suiteId)))
          : [];
    const scopedCaseIds = scopedCases.map((testCase) => testCase.id);
    setAiLinkedCaseIds((current) => [...new Set([...current, ...scopedCaseIds])]);
    setAiLinkedRequirementIds((current) => [...new Set([...current, ...requirementIdsFromTestCases(scopedCaseIds)])]);
    setHasAppliedAiBugContextDefaults(true);
  }, [aiCasePrefillQuery.isError, aiCasePrefillQuery.isFetching, hasAppliedAiBugContextDefaults, isAiBugDraftOpen, searchParams, testCaseItems]);

  useEffect(() => {
    if (searchParams.get("ai") !== "1" || !canUseAiBugDraft) return;
    openAiBugReport();
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("ai");
      return next;
    }, { replace: true });
  // Query-driven launch should run once; the callback intentionally reads the captured URL context.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseAiBugDraft, searchParams, setSearchParams]);

  const invalidateAiBugDraft = () => {
    aiBugRequestSequence.current += 1;
    setAiDraftPreview(null);
    setAiDraftMessage("");
    setAiDraftMessageTone("error");
  };

  const updateAiBugDraftField = (
    field: AiBugDraftEditableField,
    value: AiBugDraftPreview["draft"][AiBugDraftEditableField]
  ) => {
    setAiDraftPreview((current) => {
      if (!current || JSON.stringify(current.draft[field]) === JSON.stringify(value)) return current;
      const reviewState = current.client_review || { human_edited_fields: [], stale_field_evidence: {}, stale_gaps: {}, stale_fallback_fields: [] };
      const staleFieldEvidence = { ...reviewState.stale_field_evidence };
      if (!Object.prototype.hasOwnProperty.call(staleFieldEvidence, field)) {
        staleFieldEvidence[field] = [...(current.field_evidence[field] || [])];
      }
      const staleGaps = { ...reviewState.stale_gaps };
      if (!Object.prototype.hasOwnProperty.call(staleGaps, field)) {
        staleGaps[field] = current.gaps.filter((gap) => gap.field === field);
      }
      const staleFallbackFields = current.fallback_fields.includes(field)
        ? [...new Set([...reviewState.stale_fallback_fields, field])]
        : reviewState.stale_fallback_fields;
      const humanEditedFields = [...new Set([...reviewState.human_edited_fields, field])];
      return {
        ...current,
        draft: { ...current.draft, [field]: value } as AiBugDraftPreview["draft"],
        field_evidence: { ...current.field_evidence, [field]: [] },
        gaps: current.gaps.filter((gap) => gap.field !== field),
        fallback_fields: current.fallback_fields.filter((fallbackField) => fallbackField !== field),
        processing: {
          ...current.processing,
          status_label: "Human edits awaiting verification",
          stages: current.processing.stages?.map((stage) => stage.id === "specialist" || stage.id === "evaluation"
            ? { ...stage, evidence: "Generated evaluation is historical and does not validate human-edited fields." }
            : stage.id === "review"
              ? { ...stage, evidence: `${humanEditedFields.length} human-edited field${humanEditedFields.length === 1 ? " has" : "s have"} no active AI evidence attribution and require reviewer verification.` }
              : stage)
        },
        client_review: {
          human_edited_fields: humanEditedFields,
          stale_field_evidence: staleFieldEvidence,
          stale_gaps: staleGaps,
          stale_fallback_fields: staleFallbackFields
        }
      };
    });
  };

  const handleAddAiReferenceImages = async (files: FileList | null) => {
    try {
      const images = await readImageFiles(files);
      invalidateAiBugDraft();
      let budgetMessage = "";
      setAiReferenceImages((current) => {
        const result = mergeAiReferenceImagesWithinBudget(current, images);
        budgetMessage = result.message;
        return result.images;
      });
      if (budgetMessage) {
        setAiDraftMessageTone("warning");
        setAiDraftMessage(budgetMessage);
      }
    } catch (error) {
      setAiDraftMessageTone("error");
      setAiDraftMessage(error instanceof Error ? error.message : "Unable to attach the selected reference image.");
    }
  };

  const handlePreviewAiBugDraft = async () => {
    if (!canUseAiBugDraft || isAiBugContextBusy) return;
    if (aiCasePrefillQuery.isFetching || aiCasePrefillQuery.isError) {
      setAiDraftMessageTone("error");
      setAiDraftMessage(aiCasePrefillQuery.isError
        ? "Retry the selected Test Case scope in Evidence and impacted scope before generating a draft."
        : "The selected Test Case scope is still loading. You can continue editing the draft details.");
      return;
    }
    if (!projectId || !aiIntent.trim()) {
      setAiDraftMessageTone("error");
      setAiDraftMessage("Describe the failure or defect intent before generating a draft.");
      return;
    }

    setAiDraftMessage("");
    setAiDraftMessageTone("error");
    const requestSequence = ++aiBugRequestSequence.current;
    const requestProjectId = projectId;
    try {
      const response = await previewAiBugDraft.mutateAsync({
        project_id: projectId,
        intent: aiIntent.trim(),
        evidence: aiEvidence.trim(),
        additional_context: aiAdditionalContext,
        external_links: parseExternalLinks(aiExternalLinksText),
        reference_photos: aiReferenceImages,
        linked_test_run_id: canViewRuns ? aiLinkedRunId : undefined,
        linked_test_case_ids: canViewTestCases ? aiLinkedCaseIds : [],
        linked_requirement_ids: canViewStories ? aiLinkedRequirementIds : [],
        integration_id: aiBugIntegrationId || getLlmIntegrationId("ai.bug.draft") || undefined,
        prompt_guidance: getPrompt("ai.bug.draft") || undefined
      });
      if (requestSequence !== aiBugRequestSequence.current || requestProjectId !== aiBugProjectRef.current) return;
      setAiDraftPreview({
        ...response,
        client_review: { human_edited_fields: [], stale_field_evidence: {}, stale_gaps: {}, stale_fallback_fields: [] }
      });
    } catch (error) {
      setAiDraftMessageTone("error");
      if (requestSequence !== aiBugRequestSequence.current || requestProjectId !== aiBugProjectRef.current) return;
      setAiDraftMessage(error instanceof Error ? error.message : "Unable to generate the defect draft.");
    }
  };

  const applyAiBugDraft = () => {
    if (!aiDraftPreview) {
      return;
    }
    const candidate = aiDraftPreview.draft;
    const humanEditedFieldCount = aiDraftPreview.client_review?.human_edited_fields.length || 0;
    const contextualCaseIds = parseQueryIdList(searchParams.get("linked_test_case_ids"), searchParams.get("testCase"));
    const isHierarchyScopedContext = !contextualCaseIds.length && Boolean(
      searchParams.get("linked_module_ids")
      || searchParams.get("module")
      || searchParams.get("linked_test_suite_ids")
      || searchParams.get("suite")
    );
    setDraft({
      ...emptyDraft,
      title: candidate.title,
      message: candidate.message,
      steps_to_reproduce: candidate.steps_to_reproduce,
      expected_result: candidate.expected_result,
      actual_result: candidate.actual_result,
      severity: candidate.severity,
      priority: candidate.priority,
      environment: candidate.environment,
      build: candidate.build,
      labelsText: candidate.labels.join(", "),
      sprint: resolvedActiveBugDeliveryPrefill?.sprint || "",
      release: resolvedActiveBugDeliveryPrefill?.release || "",
      bug_type: "Functional",
      regression: false,
      root_cause: "",
      qa_root_cause: "",
      assignee_id: "",
      jira_bug_key: "",
      status: defaultIssueStatus,
      additional_fields: {},
      linked_test_run_id: candidate.linked_test_run_id,
      linked_test_case_ids: isHierarchyScopedContext ? [] : candidate.linked_test_case_ids,
      linked_test_suite_ids: parseQueryIdList(searchParams.get("linked_test_suite_ids"), searchParams.get("suite")),
      linked_module_ids: parseQueryIdList(searchParams.get("linked_module_ids"), searchParams.get("module")),
      linked_requirement_ids: candidate.linked_requirement_ids
    });
    setHasAppliedBugContextDefaults(false);
    syncIssueSearchParams(null);
    setSelectedIssueId("");
    setIsCreating(true);
    setIsAiBugDraftOpen(false);
    setIsAiBugEvidenceSetupOpen(false);
    setIsAiBugDraftEvidenceOpen(false);
    setAiDraftPreview(null);
    setMessageTone("success");
    setMessage(humanEditedFieldCount
      ? `${humanEditedFieldCount} human-edited proposal field${humanEditedFieldCount === 1 ? " was" : "s were"} applied without AI evidence attribution. Review every field before saving the Defect to HelloTest.`
      : "AI draft applied. Review every field before saving the Defect to HelloTest.");
  };

  const createIssue = useMutation({
    mutationFn: api.issues.create,
    onSuccess: async (response) => {
      setMessageTone("success");
      setMessage(response.status_warning
        ? `${response.status_warning.message} The Defect was saved in its current workflow status.`
        : "Defect saved.");
      await refresh();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to save defect");
    }
  });

  const updateIssue = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.issues.update>[1] }) =>
      api.issues.update(id, input),
    onSuccess: async () => {
      setMessageTone("success");
      setMessage("Defect updated.");
      await refresh();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to update defect");
    }
  });

  const deleteIssue = useMutation({
    mutationFn: api.issues.delete,
    onSuccess: async (_response, deletedIssueId) => {
      setMessageTone("success");
      setMessage("Defect deleted.");
      setSelectedActionIssueIds((current) => current.filter((id) => id !== deletedIssueId));
      syncIssueSearchParams(null);
      setSelectedIssueId("");
      setDraft(emptyDraft);
      setIsCreating(false);
      await refresh();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to delete defect");
    }
  });

  const handleDeleteSelectedIssues = async () => {
    const selectedIssueIds = selectedActionIssues.map((item) => item.id);
    if (!projectId || !canManageBugs || !selectedIssueIds.length || isDeletingSelectedIssues) return;

    const confirmed = await confirmDelete({
      message: `Delete ${selectedIssueIds.length} selected Defect${selectedIssueIds.length === 1 ? "" : "s"} from HelloTest? Historical test-run snapshots stay preserved, but the selected Defects and their live links will be removed.`
    });
    if (!confirmed) return;

    setIsDeletingSelectedIssues(true);
    setMessage("");
    const deletedIds: string[] = [];
    const failures: string[] = [];
    let failedIssueCount = 0;
    try {
      for (let offset = 0; offset < selectedIssueIds.length; offset += BULK_BUG_DELETE_BATCH_SIZE) {
        const batch = selectedIssueIds.slice(offset, offset + BULK_BUG_DELETE_BATCH_SIZE);
        try {
          const result = await api.issues.bulkDelete({ project_id: projectId, issue_ids: batch });
          deletedIds.push(...asArray(result.deleted_ids));
          failedIssueCount += Number(result.failed || 0);
          failures.push(...asArray(result.failures).map((failure) => `${failure.display_id}: ${failure.message}`));
        } catch (error) {
          failedIssueCount += batch.length;
          failures.push(error instanceof Error ? error.message : `Unable to delete ${batch.length} selected Defects.`);
        }
      }

      const deletedIdSet = new Set(deletedIds);
      setSelectedActionIssueIds((current) => current.filter((id) => !deletedIdSet.has(id)));
      if (deletedIdSet.has(selectedIssueId)) {
        syncIssueSearchParams(null);
        setSelectedIssueId("");
        setDraft(emptyDraft);
        setIsCreating(false);
      }
      if (deletedIds.length) await refresh();

      setMessageTone(failures.length ? "error" : "success");
      setMessage(failures.length
        ? `${deletedIds.length} Defect${deletedIds.length === 1 ? "" : "s"} deleted; ${failedIssueCount} could not be deleted. ${failures[0]}`
        : `${deletedIds.length} Defect${deletedIds.length === 1 ? "" : "s"} deleted.`);
    } finally {
      setIsDeletingSelectedIssues(false);
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!session?.user.id || !canEditBugFields) {
      return;
    }

    if ((isCreating && bugCreateMetadataQuery.isLoading) || (!isCreating && bugEditMetadataQuery.isLoading)) {
      setMessageTone("success");
      setMessage(`Checking this Defect's ${isCreating ? "create" : "edit"} fields. Try again in a moment.`);
      return;
    }

    if ((isCreating && bugCreateMetadataQuery.isError) || (!isCreating && bugEditMetadataQuery.isError)) {
      setMessageTone("error");
      setMessage(`HelloTest could not verify this Defect ${isCreating ? "create" : "edit"} form. Refresh before saving.`);
      return;
    }

    if (isCreating || !selectedItem) {
      const duplicateScope = items.filter((item) => {
        const sameCase = draft.linked_test_case_ids.some((id) => (item.linked_test_case_ids || []).includes(id));
        const sameModule = draft.linked_module_ids.some((id) => (item.linked_module_ids || []).includes(id));
        return (sameCase || sameModule) && bugTitleSimilarity(item.title, draft.title) >= 0.6;
      });
      if (duplicateScope.length && !duplicateReviewAccepted) {
        setDuplicateCandidates(duplicateScope);
        setMessageTone("error");
        setMessage(`${duplicateScope.length} possible duplicate Defect${duplicateScope.length === 1 ? "" : "s"} found in the selected Test Case or Module scope. Review them or continue creating.`);
        return;
      }
      const response = await createIssue.mutateAsync(buildIssuePayload(draft, session.user.id, projectId, can));
      if (pendingAttachments.length) {
        await Promise.all(pendingAttachments.map((file) => api.attachments.upload({ project_id: projectId, entity_type: "issue", entity_id: response.id }, file)));
      }
      syncIssueSearchParams(response.id);
      setSelectedIssueId(response.id);
      setIsCreating(false);
      setPendingAttachments([]);
      setDuplicateCandidates([]);
      setDuplicateReviewAccepted(false);
      return;
    }

    await updateIssue.mutateAsync({
      id: selectedItem.id,
      input: { ...buildIssuePayload(draft, selectedItem.user_id, projectId, can), expected_revision: selectedItem.revision }
    });
  };

  const closeIssueWorkspace = () => {
    if (isCreating) setMessage("");
    closedIssueIdRef.current = selectedIssueId;
    setSelectedIssueId("");
    setIsCreating(false);
    setDraft(emptyDraft);
    if (bugReturnTo) {
      navigate(bugReturnTo);
      return;
    }
    syncIssueSearchParams(null);
  };

  const closeAiBugReport = () => {
    aiBugRequestSequence.current += 1;
    setIsAiBugDraftOpen(false);
    setIsAiBugEvidenceSetupOpen(false);
    setIsAiBugDraftEvidenceOpen(false);
    if (bugReturnTo && !isCreating && !selectedIssueId) navigate(bugReturnTo);
  };
  const aiBugDialogRef = useDialogFocus<HTMLDivElement>({
    active: isAiBugDraftOpen && canUseAiBugDraft,
    closeDisabled: previewAiBugDraft.isPending,
    onClose: closeAiBugReport
  });
  const hasInheritedAiBugContext = Boolean(
    searchParams.get("run")
    || searchParams.get("testCase")
    || searchParams.get("linked_test_case_ids")
    || searchParams.get("suite")
    || searchParams.get("linked_test_suite_ids")
    || searchParams.get("module")
    || searchParams.get("linked_module_ids")
    || searchParams.get("requirement")
    || searchParams.get("linked_requirement_ids")
    || hasDeliveryScopePrefill(readDeliveryScopePrefill(searchParams))
  );
  const normalizedBugReturnLabel = bugReturnLabel.toLowerCase();
  const aiBugExternalLinks = parseExternalLinks(aiExternalLinksText);
  const aiBugEvidenceSourceCount = aiLinkedCaseIds.length
    + aiLinkedRequirementIds.length
    + aiReferenceImages.length
    + aiBugExternalLinks.length
    + (aiLinkedRunId ? 1 : 0)
    + (aiEvidence.trim() ? 1 : 0)
    + (aiAdditionalContext.trim() ? 1 : 0);
  const aiBugOmittedEvidenceCount = Object.values(aiDraftPreview?.boundaries.omitted || {})
    .reduce((total, count) => total + Number(count || 0), 0)
    + (aiDraftPreview?.boundaries.content_omissions?.length || 0);
  const aiBugHumanEditedFields = aiDraftPreview?.client_review?.human_edited_fields || [];
  const aiBugHumanEditedFieldCount = aiBugHumanEditedFields.length;
  const hasAiBugEvidenceContext = aiBugEvidenceSourceCount > 0;
  const aiBugContextSource = normalizedBugReturnLabel.includes("test case")
    ? "Failed test case"
    : normalizedBugReturnLabel.includes("suite")
      ? "Failed suite"
      : normalizedBugReturnLabel.includes("module")
        ? "Failed module"
        : bugReturnTo.startsWith("/requirements") || bugReturnTo.startsWith("/backlog") || bugReturnTo.startsWith("/sprints") || normalizedBugReturnLabel.includes("story")
          ? "Failed Story"
          : searchParams.get("run")
            ? "Failed test run"
            : searchParams.get("linked_test_case_ids")
              ? "Failed test cases"
              : "Project context";

  return (
    <div className="page-content issues-page">
      {confirmationDialog}
      {isAiBugTriageOpen && canUseAiBugTriage && projectId ? <DefectTriageDialog
        key={projectId}
        projectId={projectId}
        issues={triageIssues}
        canViewIntegrations={can("integration.view")}
        onClose={() => setIsAiBugTriageOpen(false)}
        onOpenIssue={id => { setIsAiBugTriageOpen(false); openIssueWorkspace(id); }}
      /> : null}
      {isAiBugDraftOpen && canUseAiBugDraft ? (
        <div className="modal-backdrop story-ai-workbench-backdrop" onClick={() => !previewAiBugDraft.isPending && closeAiBugReport()} role="presentation">
          <div
            aria-labelledby="ai-bug-draft-title"
            aria-modal="true"
            className="modal-card story-ai-workbench-dialog defect-ai-workbench-dialog"
            onClick={(event) => event.stopPropagation()}
            ref={aiBugDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <StoryAiStudioShell
              mode="create"
              entityLabel="Defect"
              studioTitle="Report Defect using AI"
              titleId="ai-bug-draft-title"
              descriptionId="ai-bug-draft-description"
              studioDescription="Describe the failure, add supporting context, and review a Defect proposal before accepting it into the form."
              showIncludeGherkin={false}
              showOutputFormat={false}
              processProfile="bug-create"
              agentName="Defect Reporter"
              agentStatus={previewAiBugDraft.isPending ? "running" : aiDraftPreview ? "completed" : aiDraftMessage && aiDraftMessageTone === "error" ? "failed" : "idle"}
              processing={aiDraftPreview?.processing || (previewAiBugDraft.isPending ? AI_BUG_DRAFT_PENDING_PROCESSING : undefined)}
              hasProposal={Boolean(aiDraftPreview)}
              contextLabel={`${aiBugEvidenceSourceCount} evidence sources · ${aiBugContextSource}`}
              integrationId={aiBugIntegrationId}
              integrations={aiBugIntegrations}
              outputLabel="Editable Defect draft with reproduction evidence"
              approvalLabel="Accept into form, then review before create"
              primaryGenerateLabel={previewAiBugDraft.isPending ? "Generating draft…" : aiDraftMessageTone === "error" && aiDraftMessage ? "Retry draft generation" : aiDraftPreview ? "Regenerate draft" : "Generate draft"}
              primaryGenerateDisabled={!canUseAiBugDraft || !projectId || !aiIntent.trim() || previewAiBugDraft.isPending || isAiBugContextBusy || aiCasePrefillQuery.isFetching || aiCasePrefillQuery.isError || Boolean(can("integration.view") && aiBugIntegrationId && !aiBugIntegrations.some(item => item.id === aiBugIntegrationId))}
              onPrimaryGenerate={() => void handlePreviewAiBugDraft()}
              onClose={closeAiBugReport}
              closeDisabled={previewAiBugDraft.isPending}
                  stageEvidence={{
                    intake: aiIntent.trim() ? "Observed failure, expected behavior, and impact define the Defect drafting boundary." : "Add the observed failure and expected behavior before delegating a Defect draft.",
                    context: `${aiLinkedRunId ? "One linked run" : "No linked run"}, ${aiLinkedCaseIds.length} Test Case${aiLinkedCaseIds.length === 1 ? "" : "s"}, ${aiLinkedRequirementIds.length} Stor${aiLinkedRequirementIds.length === 1 ? "y" : "ies"}, ${aiBugExternalLinks.length} external link pointer${aiBugExternalLinks.length === 1 ? "" : "s"}, ${aiReferenceImages.length} image${aiReferenceImages.length === 1 ? "" : "s"}, and ${aiEvidence.trim() || aiAdditionalContext.trim() ? "reporter notes" : "no reporter notes"} form the evidence pack.`,
                    guardrails: "The agent cannot create a Defect, change connected work items, or treat reference text as trusted instructions.",
                    specialist: "Defect Reporter is separating observed facts from assumptions and constructing reproducible evidence.",
                    outcome: "Title, severity, priority, description, reproduction, expected/actual result, environment, build, and labels remain editable proposal fields.",
                    evaluation: "The draft is checked for reproducibility, evidence linkage, impact clarity, and unsupported claims.",
                    review: "The proposal must first be accepted into the Defect form and then explicitly created by a person."
                  }}
              settingsPane={<div className="story-studio-settings-content">
                <StoryAiSettingsGroup title="Defect Intent" description="Observed failure and expected behavior">
                  <FormField label="What failed?" required><textarea disabled={previewAiBugDraft.isPending} onChange={event => { setAiIntent(event.target.value); invalidateAiBugDraft(); }} placeholder="Describe what failed, where it failed, the expected behavior, and why the impact matters." rows={4} value={aiIntent} /></FormField>
                  <p className="defect-studio-context-note"><strong>{hasInheritedAiBugContext ? "Auto-selected context" : "Context"}</strong> · {aiBugContextSource}</p>
                  <AiEvidenceButton count={aiBugEvidenceSourceCount} label="Review evidence setup" onClick={() => setIsAiBugEvidenceSetupOpen(true)} />
                </StoryAiSettingsGroup>
                <StoryAiSettingsGroup title="Generation Context" description="Supporting evidence">
                    <AiPromptContextPanel
                      additionalContext={aiAdditionalContext}
                      disabled={previewAiBugDraft.isPending}
                      externalLinksText={aiExternalLinksText}
                      onAddImages={(files) => void handleAddAiReferenceImages(files)}
                      onAdditionalContextChange={(value) => {
                        setAiAdditionalContext(value);
                        invalidateAiBugDraft();
                      }}
                      onExternalLinksTextChange={(value) => {
                        setAiExternalLinksText(value);
                        invalidateAiBugDraft();
                      }}
                      onRemoveImage={(imageUrl) => {
                        setAiReferenceImages((current) => current.filter((image) => image.url !== imageUrl));
                        invalidateAiBugDraft();
                      }}
                      onBusyChange={setIsAiBugContextBusy}
                      referenceUploadPresentation="dropzone"
                      promptScope="bug_creation"
                      projectId={projectId}
                      referenceImages={aiReferenceImages}
                      requirements={requirementItems.filter((requirement) => aiLinkedRequirementIds.includes(requirement.id))}
                    />
                </StoryAiSettingsGroup>
                <StoryAiSettingsGroup title="Intelligence Engine" description="Provider for this draft">
                  <AiLlmSelect scopeKey={projectId} defaultIntegrationId={aiBugDefaultIntegrationId} disabled={previewAiBugDraft.isPending} integrations={aiBugIntegrations} value={aiBugIntegrationId} onChange={value => { setAiBugIntegrationId(value); invalidateAiBugDraft(); }} />
                </StoryAiSettingsGroup>
              </div>}
              queuePane={<StoryAiDraftQueue activeDraftId="defect-proposal" allowSelection={false} drafts={aiDraftPreview ? [{ id: "defect-proposal", title: aiDraftPreview.draft.title, description: aiDraftPreview.draft.message, generated: true }] : []} itemNoun="Defect" itemMeta="Reproduction, impact, and evidence" queueTitle="Defect proposal" onActivateDraft={() => {}} selectedDraftIds={aiDraftPreview ? ["defect-proposal"] : []} />}
              inspectorContent={<DefectAiDraftWorkspace hasDraft={Boolean(aiDraftPreview)} statusContent={aiDraftMessage ? <p className={`inline-message ${aiDraftMessageTone === "error" ? "error" : "warning-message"}`} role={aiDraftMessageTone === "error" ? "alert" : "status"}>{aiDraftMessage}</p> : null}>
                {aiDraftPreview ? (
                  <section className="ai-bug-review-card" aria-label="AI defect draft preview">
                    <div className="ai-bug-review-head">
                      <div>
                        <span>Human review required</span>
                        <strong>Editable Defect proposal</strong>
                      </div>
                      <div className="ai-bug-review-head__evidence">
                        <span className="count-pill">{aiBugHumanEditedFieldCount ? `${aiBugHumanEditedFieldCount} human-edited · verify evidence` : aiDraftPreview.gaps.length ? `${aiDraftPreview.gaps.length} gap${aiDraftPreview.gaps.length === 1 ? "" : "s"} to verify` : "Required evidence present"} <MetricMethodologyInfo criteriaKey="metric.ai.evidence_grounding" evidence={`${aiDraftPreview.provenance.evidence.length} bounded evidence reference${aiDraftPreview.provenance.evidence.length === 1 ? "" : "s"}; ${aiDraftPreview.gaps.length} explicit gap${aiDraftPreview.gaps.length === 1 ? "" : "s"}; ${aiDraftPreview.fallback_fields.length} deterministic fallback field${aiDraftPreview.fallback_fields.length === 1 ? "" : "s"}; ${aiBugHumanEditedFieldCount} human-edited field${aiBugHumanEditedFieldCount === 1 ? "" : "s"} with original AI evidence attribution removed. This does not measure model certainty.`} organizationCriteria={getMetricCriteria("metric.ai.evidence_grounding")} /></span>
                        <AiEvidenceButton count={aiDraftPreview.evidence_sources.length} label="View evidence" onClick={() => setIsAiBugDraftEvidenceOpen(true)} />
                      </div>
                    </div>
                    {aiDraftPreview.provenance.fallback_used ? (
                      <p className="inline-message warning-message" role="status">
                        {aiDraftPreview.provenance.generation_mode === "hybrid" ? "Some proposal fields used evidence-bound deterministic values." : "HelloTest used the evidence-bound deterministic drafting path."} {aiDraftPreview.provenance.fallback_reason || "Review every field before accepting it."}
                      </p>
                    ) : null}
                    {aiBugHumanEditedFieldCount ? (
                      <p className="inline-message warning-message ai-bug-human-edit-notice" role="status">
                        <strong>Human-edited content is unverified.</strong> Original field citations were removed from {aiBugHumanEditedFieldCount} changed field{aiBugHumanEditedFieldCount === 1 ? "" : "s"}; review the current values before accepting them.
                      </p>
                    ) : null}
                    <div className="ai-bug-proposal-fields">
                      <FormField label="Title" required>
                        <input onChange={(event) => updateAiBugDraftField("title", event.target.value)} value={aiDraftPreview.draft.title} />
                      </FormField>
                      <div className="ai-bug-proposal-pair">
                        <FormField label="Severity">
                          <select onChange={(event) => updateAiBugDraftField("severity", event.target.value as AiBugDraftPreview["draft"]["severity"])} value={aiDraftPreview.draft.severity}>
                            {['critical', 'high', 'medium', 'low'].map((value) => <option key={value} value={value}>{value}</option>)}
                          </select>
                        </FormField>
                        <FormField label="Priority">
                          <select onChange={(event) => updateAiBugDraftField("priority", event.target.value as AiBugDraftPreview["draft"]["priority"])} value={aiDraftPreview.draft.priority}>
                            {['Highest', 'High', 'Medium', 'Low', 'Lowest'].map((value) => <option key={value} value={value}>{value}</option>)}
                          </select>
                        </FormField>
                      </div>
                      <FormField label="Description">
                        <textarea onChange={(event) => updateAiBugDraftField("message", event.target.value)} rows={4} value={aiDraftPreview.draft.message} />
                      </FormField>
                      <FormField label="Steps to reproduce">
                        <textarea onChange={(event) => updateAiBugDraftField("steps_to_reproduce", event.target.value)} rows={5} value={aiDraftPreview.draft.steps_to_reproduce} />
                      </FormField>
                      <div className="ai-bug-proposal-pair">
                        <FormField label="Expected result">
                          <textarea onChange={(event) => updateAiBugDraftField("expected_result", event.target.value)} rows={3} value={aiDraftPreview.draft.expected_result} />
                        </FormField>
                        <FormField label="Actual result">
                          <textarea onChange={(event) => updateAiBugDraftField("actual_result", event.target.value)} rows={3} value={aiDraftPreview.draft.actual_result} />
                        </FormField>
                      </div>
                      <div className="ai-bug-proposal-pair">
                        <FormField label="Environment">
                          <input onChange={(event) => updateAiBugDraftField("environment", event.target.value)} placeholder="Not evidenced" value={aiDraftPreview.draft.environment} />
                        </FormField>
                        <FormField label="Build or version">
                          <input onChange={(event) => updateAiBugDraftField("build", event.target.value)} placeholder="Not evidenced" value={aiDraftPreview.draft.build} />
                        </FormField>
                      </div>
                      <FormField label="Labels">
                        <input onChange={(event) => updateAiBugDraftField("labels", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} value={aiDraftPreview.draft.labels.join(", ")} />
                      </FormField>
                    </div>
                    <AiEvidenceFlyout
                      description="Inspect the exact source references, field grounding, disclosed gaps, and processing boundary for this proposal."
                      eyebrow="Defect creation · Decision evidence"
                      facts={[
                        { label: "Mode", value: aiDraftPreview.provenance.generation_mode },
                        { label: "Evidence sources", value: aiDraftPreview.evidence_sources.length },
                        { label: "Evidence gaps", value: aiDraftPreview.gaps.length },
                        { label: "Fallback fields", value: aiDraftPreview.fallback_fields.length },
                        { label: "Human-edited", value: aiBugHumanEditedFieldCount },
                        { label: "Omitted by boundary", value: aiBugOmittedEvidenceCount }
                      ]}
                      onClose={() => setIsAiBugDraftEvidenceOpen(false)}
                      open={isAiBugDraftEvidenceOpen}
                      title="Defect proposal evidence"
                    >
                      <section className="ai-evidence-flyout__section ai-bug-evidence-sources">
                        <header><span>Sources</span><strong>Bounded evidence pack</strong></header>
                        <div>
                          {aiDraftPreview.evidence_sources.map((source) => (
                            <article key={source.ref}>
                              <span>{formatRecordKindLabel(source.type).replace(/-/g, " ")}{source.trust ? ` · ${source.trust}` : ""}</span>
                              <strong>{source.title}</strong>
                              {source.excerpt ? <p>{source.excerpt}</p> : null}
                              <code>{source.ref}</code>
                            </article>
                          ))}
                        </div>
                      </section>
                      <section className="ai-evidence-flyout__section ai-bug-field-evidence">
                        <header><span>Field grounding</span><strong>Evidence used by proposal field</strong></header>
                        <dl>
                          {Object.entries(aiDraftPreview.field_evidence).map(([field, refs]) => {
                            const editableField = field as AiBugDraftEditableField;
                            const isHumanEdited = aiBugHumanEditedFields.includes(editableField);
                            const staleRefs = aiDraftPreview.client_review?.stale_field_evidence[editableField] || [];
                            const staleGaps = aiDraftPreview.client_review?.stale_gaps[editableField] || [];
                            const hadDeterministicFallback = aiDraftPreview.client_review?.stale_fallback_fields.includes(editableField) || false;
                            return (
                              <div key={field}>
                                <dt>{formatDefectFieldLabel(field)}</dt>
                                <dd data-evidence-state={isHumanEdited ? "human-edited" : "current"}>
                                  {isHumanEdited ? (
                                    <>
                                      <span className="ai-bug-field-evidence__state">Human-edited · unverified</span>
                                      <small>Active AI evidence attribution was removed for the current value.</small>
                                      {staleRefs.length ? <span className="ai-bug-field-evidence__stale">Original proposal only — stale: {staleRefs.map((ref) => <code key={ref}>{ref}</code>)}</span> : null}
                                      {staleGaps.length ? <span className="ai-bug-field-evidence__stale">Original generated gap — stale: {staleGaps.map((gap) => gap.reason).join(" ")}</span> : null}
                                      {hadDeterministicFallback ? <span className="ai-bug-field-evidence__stale">Original deterministic fallback evaluation — stale after edit.</span> : null}
                                    </>
                                  ) : refs.length ? refs.map((ref) => <code key={ref}>{ref}</code>) : <span>No supporting ref</span>}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      </section>
                      {aiDraftPreview.gaps.length ? (
                        <section className="ai-evidence-flyout__section ai-bug-evidence-gaps">
                          <header><span>Needs verification</span><strong>Evidence gaps</strong></header>
                          <ul>{aiDraftPreview.gaps.map((gap) => <li key={`${gap.field}:${gap.reason}`}><strong>{formatDefectFieldLabel(gap.field)}</strong><span>{gap.reason}</span>{gap.question ? <em>{gap.question}</em> : null}</li>)}</ul>
                        </section>
                      ) : null}
                      {aiDraftPreview.fallback_fields.length ? (
                        <section className="ai-evidence-flyout__section">
                          <header><span>Hybrid boundary</span><strong>Fields using deterministic fallback</strong></header>
                          <ul className="ai-evidence-flyout__bullet-list">
                            {aiDraftPreview.fallback_fields.map((field) => <li key={field}>{formatDefectFieldLabel(field)}</li>)}
                          </ul>
                        </section>
                      ) : null}
                      {aiDraftPreview.assumptions.length ? (
                        <section className="ai-evidence-flyout__section">
                          <header><span>Needs verification</span><strong>Explicit assumptions</strong></header>
                          <ul className="ai-evidence-flyout__bullet-list">
                            {aiDraftPreview.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
                          </ul>
                        </section>
                      ) : null}
                      {aiDraftPreview.boundaries.partial_sources ? (
                        <section className="ai-evidence-flyout__section ai-bug-field-evidence">
                          <header><span>Processing boundary</span><strong>Requested evidence not included</strong></header>
                          <dl>
                            {Object.entries(aiDraftPreview.boundaries.omitted).filter(([, count]) => count > 0).map(([source, count]) => (
                              <div key={source}><dt>{source.replace(/_/g, " ")}</dt><dd>{count} omitted</dd></div>
                            ))}
                            {(aiDraftPreview.boundaries.content_omissions || []).map((omission) => (
                              <div key={`${omission.source_ref}:${omission.field}`}><dt>{formatDefectFieldLabel(omission.field)}</dt><dd>{omission.omitted} {omission.unit} omitted from <code>{omission.source_ref}</code></dd></div>
                            ))}
                          </dl>
                        </section>
                      ) : null}
                      <section className="ai-evidence-flyout__section">
                        <header><span>Decision basis</span><strong>Draft rationale</strong></header>
                        <p>{aiDraftPreview.draft.rationale}</p>
                        {aiBugHumanEditedFieldCount ? <p className="warning-message">This rationale describes the generated proposal before human edits. It does not support the current values of human-edited fields.</p> : null}
                        {aiDraftPreview.boundaries.partial_sources ? <p className="warning-message">Some requested, invalid, inaccessible, or over-limit sources were omitted. Their counts remain part of the input fingerprint.</p> : null}
                      </section>
                    </AiEvidenceFlyout>
                  </section>
                ) : null}
              </DefectAiDraftWorkspace>}
              commandBar={<>
                {aiDraftPreview ? <button className="ghost-button" disabled={previewAiBugDraft.isPending} onClick={() => { setIsAiBugDraftEvidenceOpen(false); setAiDraftPreview(null); }} type="button">Discard draft</button> : <button className="ghost-button" disabled={previewAiBugDraft.isPending} onClick={closeAiBugReport} type="button">Cancel</button>}
                {aiDraftPreview ? <button className="story-studio-accept-button" disabled={previewAiBugDraft.isPending || !aiDraftPreview.draft.title.trim()} onClick={applyAiBugDraft} type="button">Accept into Defect form</button> : null}
              </>}
            />
                <AiEvidenceFlyout
                  description="Add or refine the bounded evidence pack used to prepare this Defect proposal. External URLs remain pointer-only."
                  eyebrow="Defect creation · Input evidence"
                  facts={[
                    { label: "Linked run", value: aiLinkedRunId ? "1" : "0" },
                    { label: "Test Cases", value: aiLinkedCaseIds.length },
                    { label: "Stories", value: aiLinkedRequirementIds.length },
                    { label: "Images", value: aiReferenceImages.length }
                  ]}
                  onClose={() => setIsAiBugEvidenceSetupOpen(false)}
                  open={isAiBugEvidenceSetupOpen}
                  title="Evidence and impacted scope"
                >
                  <div className="ai-bug-input-flyout__body">
                    {aiCasePrefillQuery.isFetching ? <p className="inline-message" role="status">Preparing the selected Test Case scope…</p> : null}
                    {aiCasePrefillQuery.isError ? <p className="inline-message error" role="alert">Could not prepare the selected Test Cases. <button type="button" className="ghost-button" onClick={() => void aiCasePrefillQuery.refetch()}>Retry</button></p> : null}
                    <FormField label="Observed evidence">
                      <textarea
                        disabled={previewAiBugDraft.isPending}
                        onChange={(event) => {
                          setAiEvidence(event.target.value);
                          invalidateAiBugDraft();
                        }}
                        placeholder="Error text, observed result, timestamps, logs, or reproduction notes"
                        rows={4}
                        value={aiEvidence}
                      />
                    </FormField>
                    <div className="issue-form-grid issue-form-grid--triple ai-bug-scope-grid">
                      <FormField label="Impacted Test Run">
                        <select
                          disabled={previewAiBugDraft.isPending || !canViewRuns}
                          onChange={(event) => {
                            setAiLinkedRunId(event.target.value);
                            invalidateAiBugDraft();
                          }}
                          value={aiLinkedRunId}
                        >
                          <option value="">No linked run</option>
                          {executionItems.map((execution) => (
                            <option key={execution.id} value={execution.id}>{runLabelById.get(execution.id) || execution.id}</option>
                          ))}
                        </select>
                      </FormField>
                      <TestCasePicker
                        projectId={projectId}
                        disabled={previewAiBugDraft.isPending || !canViewTestCases}
                        initialItems={testCaseItems}
                        onItemsResolved={rememberCaseItems}
                        heading="Impacted Test Cases"
                        presentation="impact"
                        onChange={(ids, selectedItems) => {
                          updateAiLinkedTestCases(ids, selectedItems);
                          invalidateAiBugDraft();
                        }}
                        selectedIds={aiLinkedCaseIds}
                      />
                      <ImpactCheckboxPicker
                        disabled={previewAiBugDraft.isPending || !canViewStories}
                        emptyText="No stories are available for this project."
                        items={requirementImpactOptions}
                        label="Impacted Stories"
                        onChange={(ids) => {
                          setAiLinkedRequirementIds(ids);
                          invalidateAiBugDraft();
                        }}
                        placeholder="Search stories..."
                        selectedIds={aiLinkedRequirementIds}
                      />
                    </div>
                  </div>
                </AiEvidenceFlyout>

          </div>
        </div>
      ) : null}
      <PageHeader
        className={isCreating || selectedItem ? "page-header--workspace-context" : ""}
        eyebrow="Defect Management"
        title="Defects"
        description="Capture, reproduce, triage, and resolve Defects with delivery context, ownership, linked quality evidence, and end-to-end traceability."
      />
      {!(isCreating || selectedItem) ? (
        <QualityMetricStrip
          ariaLabel="Defect catalog quality metrics"
          metrics={[
            {
              label: "Total defects",
              value: metricsPending || issueMetricsQuery.isError ? "—" : bugCatalogMetrics.total,
              detail: metricsPending ? "Loading catalog" : "Current catalog scope"
            },
            {
              label: "Open defects",
              value: metricsPending || issueMetricsQuery.isError ? "—" : openIssueCount,
              detail: metricsPending ? "Loading workflow status" : bugStatusBreakdown || "No Defects"
            },
            {
              label: "Priority risks",
              value: metricsPending || issueMetricsQuery.isError ? "—" : bugCatalogMetrics.priorityRisks,
              detail: metricsPending ? "Loading priorities" : "Open Highest or High",
              tone: !metricsPending && bugCatalogMetrics.priorityRisks ? "danger" : "neutral"
            },
            {
              label: "Unassigned",
              value: metricsPending || issueMetricsQuery.isError ? "—" : bugCatalogMetrics.unassigned,
              detail: metricsPending ? "Loading ownership" : "Open defects without owner",
              tone: !metricsPending && bugCatalogMetrics.unassigned ? "danger" : "neutral"
            },
            {
              label: "Converted to Test Cases",
              value: metricsPending || issueMetricsQuery.isError ? "—" : convertedBugCount,
              detail: metricsPending ? "Loading recorded conversions" : deferredIssueSearch.trim() ? "Matching defects with converted cases" : "Defects with converted cases",
              methodology: "Each defect is counted once when an existing test case was created from it using Convert to Test Case. Ordinary case links and older conversions without a recorded origin are excluded."
            }
          ]}
        />
      ) : null}

      {issueMetricsQuery.isError && !isCreating && !selectedIssueId ? <p className="inline-error" role="alert">Defect metrics could not be loaded. <button className="ghost-button" type="button" onClick={() => void issueMetricsQuery.refetch()}>Retry metrics</button></p> : null}
      {message && !isCreating ? <p className={messageTone === "error" ? "inline-message error-message" : "inline-message success-message"}>{message}</p> : null}

      <WorkspaceMasterDetail
        browseView={(
          <Panel title="Defects" titleVariant="eyebrow" subtitle="Review, select, export, triage, or safely remove project Defects in tile or list view.">
            <div className="design-list-toolbar catalog-command-toolbar issue-catalog-toolbar">
              <div className="catalog-toolbar-discovery" aria-label="Defect views, search, and selection">
                <CatalogViewToggle onChange={setCatalogViewMode} value={catalogViewMode} />
                <CatalogSearchFilter
                activeFilterCount={Number(Boolean(issueSearch.trim())) + Number(Boolean(issueStatusFilter)) + Number(Boolean(issuePriorityFilter)) + Number(Boolean(issueAssigneeFilter))}
                ariaLabel="Search defects"
                onChange={setIssueSearch}
                placeholder="Search defects"
                subtitle="Search by title, description, external key, run, status, severity, priority, assignee, or reporter."
                title="Defect search"
                type="search"
                value={issueSearch}
              >
                <div className="catalog-filter-grid">
                  <label className="catalog-filter-field"><span>Status</span><select value={issueStatusFilter} onChange={(event) => setIssueStatusFilter(event.target.value)}><option value="">All statuses</option>{issueStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label className="catalog-filter-field"><span>Priority</span><select value={issuePriorityFilter} onChange={(event) => setIssuePriorityFilter(event.target.value)}><option value="">All priorities</option>{ISSUE_PRIORITY_OPTIONS.filter((option) => option.value).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label className="catalog-filter-field"><span>Assignee</span><select value={issueAssigneeFilter} onChange={(event) => setIssueAssigneeFilter(event.target.value)}><option value="">All assignees</option><option value="__unassigned__">Unassigned</option>{session?.user.id ? <option value={session.user.id}>Assigned to me</option> : null}</select></label>
                  <div className="catalog-filter-actions">
                    <button className="ghost-button" disabled={!issueSearch.trim() && !issueStatusFilter && !issuePriorityFilter && !issueAssigneeFilter} onClick={() => { setIssueSearch(""); setIssueStatusFilter(""); setIssuePriorityFilter(""); setIssueAssigneeFilter(""); }} type="button">
                      Clear filters
                    </button>
                  </div>
                </div>
                </CatalogSearchFilter>
                <CatalogSelectionControls
                  allSelected={areAllFilteredIssuesSelected}
                  canSelectAll={Boolean(visibleIssueIds.length)}
                  onClear={() => setSelectedActionIssueIds([])}
                  onSelectAll={() => setAllVisibleIssuesSelected(true)}
                  selectedCount={selectedActionIssues.length}
                />
              </div>
              <div className="catalog-toolbar-actions" aria-label="Defect actions">
                {canCreateBugs ? (<ReportBugSplitActionButton
                  canUseAi={canUseAiBugDraft}
                  disabled={!canCreateBugs}
                  onReportBug={openManualBugReport}
                  onReportBugWithAi={openAiBugReport}
                />) : null}
                <button
                  className="ghost-button catalog-selection-button"
                  disabled={!selectedActionIssues.length || isDeletingSelectedIssues || isExportingIssues}
                  onClick={() => void handleExportIssuesCsv()}
                  title={selectedActionIssues.length ? `Export ${selectedActionIssues.length} selected Defects as CSV` : "Select Defects to export"}
                  type="button"
                >
                  <ExportIcon />
                  <span>{isExportingIssues ? "Exporting…" : `Export${selectedActionIssues.length ? ` ${selectedActionIssues.length}` : ""}`}</span>
                </button>
                {canUseAiBugTriage ? (
                  <button
                    className="ghost-button catalog-selection-button"
                    disabled={!selectedActionIssues.length || isDeletingSelectedIssues || isExportingIssues}
                    onClick={openSelectedBugTriage}
                    title={selectedActionIssues.length > MAX_AI_BUG_TRIAGE_ITEMS
                      ? `Select up to ${MAX_AI_BUG_TRIAGE_ITEMS} Defects to keep workspace reads and AI usage bounded`
                      : selectedActionIssues.length
                        ? "Classify selected Defects and recommend priority in a read-only review"
                        : "Select Defects for AI classification and priority review"}
                    type="button"
                  >
                    <SparkIcon />
                    <span>AI triage</span>
                  </button>
                ) : null}
                {canManageBugs ? (
                  <button
                    className="ghost-button danger catalog-selection-button"
                    disabled={!selectedActionIssues.length || isDeletingSelectedIssues || isExportingIssues}
                    onClick={() => void handleDeleteSelectedIssues()}
                    title={selectedActionIssues.length ? "Delete selected Defects" : "Select Defects to delete"}
                    type="button"
                  >
                    <TrashIcon />
                    <span>{isDeletingSelectedIssues ? "Deleting…" : `Delete${selectedActionIssues.length ? ` ${selectedActionIssues.length}` : ""}`}</span>
                  </button>
                ) : null}
              </div>
            </div>

            {issues.isLoading ? (
              <TileCardSkeletonGrid />
            ) : null}
            {issues.isFetching && !issues.isLoading && !issues.isFetchingNextPage ? <p role="status" className="inline-message">Updating defects…</p> : null}

            {!issues.isLoading && filteredItems.length && catalogViewMode === "tile" ? (
            <div className="tile-browser-grid">
              {filteredItems.map((item: Issue) => {
                const issueTone = getTileCardTone(item.status || defaultIssueStatus);
                const issueStatus = formatTileCardLabel(item.status, "Open");
                const severity = String(item.severity || "").trim().toLowerCase();
                const priority = String(item.priority || "").trim().toLowerCase();
                const assigneeLabel = item.assignee_name || item.assignee_email || assigneeLabelById.get(item.assignee_id || "") || "Unassigned";
                const isAssigned = Boolean(String(item.assignee_id || item.assignee_name || item.assignee_email || "").trim());
                const evidenceFields = [
                  item.message,
                  item.steps_to_reproduce,
                  item.expected_result,
                  item.actual_result
                ];
                const completedEvidenceFields = evidenceFields.filter((value) => richTextToPlainText(value || "").trim()).length;
                const evidencePercent = Math.round((completedEvidenceFields / evidenceFields.length) * 100);
                const triageFields = [item.severity, item.priority, isAssigned ? assigneeLabel : ""];
                const completedTriageFields = triageFields.filter((value) => String(value || "").trim()).length;
                const triagePercent = Math.round((completedTriageFields / triageFields.length) * 100);
                const linkedCaseCount = (item.linked_test_case_ids || []).length;
                const impactScope = Number(Boolean(item.linked_test_run_id))
                  + linkedCaseCount
                  + (item.linked_test_suite_ids || []).length
                  + (item.linked_module_ids || []).length
                  + (item.linked_requirement_ids || []).length;
                const severityTone = ["critical", "high"].includes(severity)
                  ? "danger"
                  : ["medium", "major"].includes(severity)
                    ? "warning"
                    : severity
                      ? "info"
                      : "neutral";
                const priorityTone = ["highest", "high", "p1"].includes(priority)
                  ? "danger"
                  : ["medium", "p2"].includes(priority)
                    ? "warning"
                    : priority
                      ? "info"
                      : "neutral";
                return (
                  <article
                    aria-label={`Open Defect ${item.display_id || item.jira_bug_key || item.id}: ${item.title}`}
                    key={item.id}
                    className={[
                      "record-card tile-card issue-catalog-card",
                      selectedIssueId === item.id ? "is-active" : "",
                      selectedActionIssueIdSet.has(item.id) ? "is-selected" : ""
                    ].filter(Boolean).join(" ")}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("a, button, input, label, select, textarea")) {
                        return;
                      }
                      openIssueWorkspace(item.id);
                    }}
                  >
                    <div className="tile-card-main">
                      <div className="tile-card-select-row issue-tile-top-row">
                        <label className="checkbox-field" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                          <input
                            aria-label={`Select Defect ${item.display_id || item.jira_bug_key || item.id}: ${item.title}`}
                            checked={selectedActionIssueIdSet.has(item.id)}
                            onChange={(event) => toggleIssueSelection(item.id, event.target.checked)}
                            type="checkbox"
                          />
                          <span className="sr-only">Select defect</span>
                        </label>
                        <span className="issue-bug-identity">
                          <BugIcon size={16} strokeWidth={1.8} />
                          <DisplayIdBadge value={item.display_id || item.jira_bug_key || item.id} />
                        </span>
                        <TileCardStatusIndicator title={issueStatus} tone={issueTone} />
                      </div>
                      <div className="tile-card-header">
                        <button
                          aria-current={selectedIssueId === item.id ? "page" : undefined}
                          className="tile-card-title-group tile-card-open-button"
                          onClick={() => openIssueWorkspace(item.id)}
                          type="button"
                        >
                          <strong>{item.title}</strong>
                          <span className="tile-card-kicker">
                            {[
                              item.jira_bug_key || null,
                              item.severity ? `Severity ${formatTileCardLabel(item.severity, "Not set")}` : null,
                              item.priority ? `Priority ${formatTileCardLabel(item.priority, "Not set")}` : null
                            ].filter(Boolean).join(" · ") || item.user_name || item.user_email || item.user_id}
                          </span>
                        </button>
                      </div>
                      <RichTextContent className="tile-card-description" value={item.message} />
                      <div className="tile-card-progress-stack issue-tile-progress-stack">
                        <TileCardProgress
                          breakdown={{ total: evidenceFields.length, segments: [
                            { key: "covered", label: "Completed evidence fields", count: completedEvidenceFields },
                            { key: "uncovered", label: "Missing evidence fields", count: evidenceFields.length - completedEvidenceFields }
                          ] }}
                          displayValue={`${evidencePercent}%`}
                          label="Evidence completeness"
                          title={`${completedEvidenceFields} of ${evidenceFields.length} evidence fields completed`}
                          tone={evidencePercent === 100 ? "success" : evidencePercent >= 50 ? "warning" : "danger"}
                          value={evidencePercent}
                        />
                        <TileCardProgress
                          breakdown={{ total: triageFields.length, segments: [
                            { key: "covered", label: "Completed triage fields", count: completedTriageFields },
                            { key: "uncovered", label: "Missing triage fields", count: triageFields.length - completedTriageFields }
                          ] }}
                          displayValue={`${triagePercent}%`}
                          label="Triage completeness"
                          title={`${completedTriageFields} of ${triageFields.length} triage fields completed`}
                          tone={triagePercent === 100 ? "success" : triagePercent >= 67 ? "warning" : "danger"}
                          value={triagePercent}
                        />
                      </div>
                      <div className="tile-card-metric-grid issue-tile-metrics" aria-label={`${item.title} metrics`}>
                        <TileCardMetric
                          label="Severity"
                          title={`Severity: ${formatTileCardLabel(item.severity, "Not set")}`}
                          tone={severityTone}
                          value={formatTileCardLabel(item.severity, "Unset")}
                        />
                        <TileCardMetric
                          label="Priority"
                          title={`Priority: ${formatTileCardLabel(item.priority, "Not set")}`}
                          tone={priorityTone}
                          value={formatTileCardLabel(item.priority, "Unset")}
                        />
                        <TileCardMetric
                          label="Linked scope"
                          title={`${impactScope} linked run, case, suite, module, or story record${impactScope === 1 ? "" : "s"}; ${linkedCaseCount} linked case${linkedCaseCount === 1 ? "" : "s"}`}
                          tone={impactScope ? "info" : "neutral"}
                          value={impactScope}
                        />
                        <TileCardMetric
                          label="Ownership"
                          title={isAssigned ? `Assigned to ${assigneeLabel}` : "No assignee"}
                          tone={isAssigned ? "success" : "warning"}
                          value={isAssigned ? "Assigned" : "Unassigned"}
                        />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            ) : null}

            {!issues.isLoading && filteredItems.length && catalogViewMode === "list" ? (
              <DataTable
                columns={issueListColumns}
                enableColumnResize
                enableHeaderColumnReorder
                enableRowSelection={false}
                emptyMessage="No defects match the current search."
                getRowClassName={(item) => (selectedIssueId === item.id ? "is-active-row" : "")}
                getRowKey={(item) => item.id}
                hideToolbarCopy
                onRowClick={(item) => openIssueWorkspace(item.id)}
                rows={filteredItems}
                storageKey="hellotest:issues:list-columns"
              />
            ) : null}

            {issues.isError && !items.length ? <div className="empty-state compact" role="alert"><p>Defects could not be loaded.</p><button className="ghost-button" type="button" onClick={() => void issues.refetch()}>Retry</button></div> : null}
            {!issues.isLoading && !issues.isError && !items.length ? <div className="empty-state compact">{catalogSearch || issueStatusFilter || issuePriorityFilter || issueAssigneeFilter ? "No defects match the current filters." : "No defects reported yet."}</div> : null}
            {issues.hasNextPage && !issues.isPlaceholderData ? <HierarchyAutoLoadSentinel
              isLoading={issues.isFetchingNextPage}
              onLoad={() => issues.fetchNextPage()}
              scopeLabel="bugs"
              progressKey={`${JSON.stringify(catalogFilters)}:${items.length}`}
              error={issues.isFetchNextPageError ? issues.error : undefined}
              onRetry={() => issues.fetchNextPage()}
            /> : null}
          </Panel>
        )}
        detailView={(
          <IssueEditorSurface
            actions={!isCreating && selectedItem && canCreateTestCases ? (
              <button
                className="issue-detail-convert-button"
                onClick={() => {
                  sessionStorage.setItem(
                    BUG_TO_TEST_CASE_STORAGE_KEY,
                    JSON.stringify(buildBugToTestCaseDraft(selectedItem))
                  );
                  navigate("/test-cases?create=1&source=bug");
                }}
                type="button"
              >
                <TestCaseIcon size={15} />
                <span>Convert to Test Case</span>
              </button>
            ) : null}
            backLabel={bugReturnTo ? `Back to ${bugReturnLabel}` : "Back to defect tiles"}
            closeDisabled={createIssue.isPending}
            isCreating={isCreating}
            onClose={closeIssueWorkspace}
            subtitle="Capture the Defect in a HelloTest-ready structure with run context, reproduction evidence, ownership, and root cause."
            title={isCreating ? "Report defect" : selectedItem ? "Defect details" : "Defect editor"}
          >
            {!isCreating && selectedIssueId && selectedIssueQuery.isLoading ? <LoadingState label="Loading defect details" /> : null}
            {!isCreating && selectedIssueId && selectedIssueQuery.isError ? <div role="alert" className="inline-error"><p>Defect details could not be loaded.</p><button type="button" className="ghost-button" onClick={() => void selectedIssueQuery.refetch()}>Retry</button></div> : null}
            {!isCreating && selectedIssueId && selectedIssueQuery.isFetching && selectedIssueQuery.data ? (
              <LoadingState label="Refreshing current Defect details" />
            ) : null}
            {(isCreating || (selectedItem && (!selectedIssueQuery.isLoading || selectedIssueQuery.isError))) ? (
              <form
                className={isCreating ? "issue-report-form report-defect-modal-form" : "issue-report-form issue-detail-form"}
                onSubmit={(event) => void handleSave(event)}
              >
                <div className={isCreating ? "report-bug-modal-body" : "issue-report-fields issue-detail-body"}>
                {isCreating && message ? (
                  <p className={messageTone === "error" ? "inline-message error-message" : "inline-message success-message"}>{message}</p>
                ) : null}
                {!isCreating && selectedItem ? (
                  <div className="requirement-detail-id-row">
                    <span>Defect ID</span>
                    <DisplayIdBadge
                      value={selectedItem.display_id || selectedItem.jira_bug_key || selectedItem.id}
                    />
                  </div>
                ) : null}
                {!isCreating && selectedItem ? (
                  <QualityMetricStrip
                    ariaLabel="Selected defect quality metrics"
                    className="issue-detail-metric-strip"
                    metrics={[
                      {
                        label: "Impact scope",
                        value: selectedBugMetrics.impactScope,
                        detail: `${draft.linked_test_case_ids.length} cases · ${draft.linked_requirement_ids.length} stories`
                      },
                      {
                        label: "Evidence completeness",
                        value: `${selectedBugMetrics.evidencePercent}%`,
                        detail: `${selectedBugMetrics.completedEvidenceFields} of 4 core fields`,
                        progress: selectedBugMetrics.evidencePercent,
                        tone: selectedBugMetrics.evidencePercent === 100 ? "success" : "info"
                      },
                      {
                        label: "Linked test cases",
                        value: draft.linked_test_case_ids.length,
                        detail: draft.linked_test_run_id ? "Run context linked" : "No linked run"
                      },
                      {
                        label: "Linked stories",
                        value: draft.linked_requirement_ids.length,
                        detail: draft.linked_requirement_ids.length ? "Traceable requirements" : "No linked stories",
                        tone: draft.linked_requirement_ids.length ? "success" : "danger"
                      }
                    ]}
                  />
                ) : null}
                <section className="issue-form-section issue-form-section--summary">
                  <div className="issue-form-section-head">
                    <strong>Defect summary</strong>
                  </div>
                  <div className="issue-form-grid">
                    <FormField className="bug-field-title" label="Defect Title" required>
                      <input
                        disabled={!canEditBugFields}
                        data-autofocus={isCreating ? "true" : undefined}
                        placeholder="Brief summary of the defect"
                        required
                        value={draft.title}
                        onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                      />
                    </FormField>
                  </div>

                  <div className="issue-form-compact-grid issue-form-classification-grid">
                    <FormField className="form-field--compact-enum bug-field-status" label="Status">
                      <select disabled={!canEditBugFields} value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>
                        {activeBugStatusOptions.map((option) => (
                          <option key={option.value} value={option.value}>{jiraStatusOptionLabel(option)}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField className="form-field--compact-enum bug-field-severity" label="Severity">
                      <select disabled={!canEditBugFields} value={draft.severity} onChange={(event) => setDraft((current) => ({ ...current, severity: event.target.value }))}>
                        {ISSUE_SEVERITY_OPTIONS.map((option) => (
                          <option key={option.value || "none"} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField className="form-field--compact-enum bug-field-priority" label="Priority" required={jiraBugCoreRequired.priority}>
                      <select disabled={!canEditBugFields} required={jiraBugCoreRequired.priority} value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))}>
                        {ISSUE_PRIORITY_OPTIONS.map((option) => (
                          <option key={option.value || "none"} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField className="bug-field-assignee" label="Assignee" required={jiraBugCoreRequired.assignee}>
                      <select disabled={!canEditBugFields || !canViewProjectMembers} required={jiraBugCoreRequired.assignee} value={draft.assignee_id} onChange={(event) => setDraft((current) => ({ ...current, assignee_id: event.target.value }))}>
                        <option value="">Unassigned</option>
                        {userItems.map((user) => (
                          <option key={user.id} value={user.id}>{user.name || user.email || user.id}</option>
                        ))}
                      </select>
                    </FormField>
                  </div>

                  <div className="issue-form-compact-grid issue-form-context-grid">
                    <FormField className="bug-field-environment" label="Environment">
                      <select disabled={!canEditBugFields} value={draft.environment} onChange={(event) => setDraft((current) => ({ ...current, environment: event.target.value }))}>
                        <option value="">No environment</option>
                        {environmentOptions.map((environment) => <option key={environment} value={environment}>{environment}</option>)}
                      </select>
                    </FormField>
                    <FormField className="bug-field-build" label="Build">
                      <input disabled={!canEditBugFields} placeholder="2026.07.02" value={draft.build} onChange={(event) => setDraft((current) => ({ ...current, build: event.target.value }))} />
                    </FormField>
                    <FormField className="bug-field-linked-run" label="Linked Test Run">
                      <select disabled={!canEditBugFields || !canViewRuns} value={draft.linked_test_run_id} onChange={(event) => setDraft((current) => ({ ...current, linked_test_run_id: event.target.value }))}>
                        <option value="">No linked run</option>
                        {draft.linked_test_run_id && !executionById.has(draft.linked_test_run_id) ? (
                          <option value={draft.linked_test_run_id}>{draft.linked_test_run_id}</option>
                        ) : null}
                        {executionItems.map((execution) => (
                          <option key={execution.id} value={execution.id}>{runLabelById.get(execution.id) || execution.id}</option>
                        ))}
                      </select>
                    </FormField>
                  </div>
                </section>

                <section className="issue-form-section issue-form-section--impact">
                  <div className="issue-form-section-head">
                    <strong>Impact Analysis</strong>
                    <small className="bug-impact-auto-link-note">Selecting an impacted Test Case automatically includes its associated Modules and Stories.</small>
                  </div>
                  <div className="issue-form-grid issue-form-impact-grid">
                    <ImpactCheckboxPicker
                      disabled={!canEditBugFields || !canViewSuites}
                      emptyText="No test suites are available for this project."
                      items={suiteImpactOptions}
                      label="Impacted Test Suites"
                      onChange={updateDraftLinkedSuites}
                      placeholder="Search test suites..."
                      selectedIds={draft.linked_test_suite_ids}
                    />
                    <ImpactCheckboxPicker
                      disabled={!canEditBugFields || !canViewTestCases}
                      emptyText="No test case modules are available for this project."
                      items={moduleImpactOptions}
                      label="Impacted Modules"
                      onChange={updateDraftLinkedModules}
                      placeholder="Search modules..."
                      selectedIds={draft.linked_module_ids}
                    />
                    <TestCasePicker
                      disabled={!canEditBugFields || !canViewTestCases}
                      projectId={projectId}
                      initialItems={testCaseItems}
                      onItemsResolved={rememberCaseItems}
                      heading="Impacted Test Cases"
                      presentation="impact"
                      onChange={updateDraftLinkedTestCases}
                      selectedIds={draft.linked_test_case_ids}
                    />
                    <ImpactCheckboxPicker
                      disabled={!canEditBugFields || !canViewStories}
                      emptyText="No stories are available for this project."
                      items={requirementImpactOptions}
                      label="Impacted Stories"
                      onChange={updateDraftLinkedRequirements}
                      placeholder="Search stories..."
                      selectedIds={draft.linked_requirement_ids}
                    />
                  </div>
                </section>

                <section className="issue-form-section issue-form-section--classification">
                  <div className="issue-form-section-head">
                    <strong>Classification</strong>
                  </div>
                  <div className="issue-form-grid issue-form-grid--triple">
                    <FormField label="Defect Type">
                      <select disabled={!canEditBugFields} value={draft.bug_type} onChange={(event) => setDraft((current) => ({ ...current, bug_type: event.target.value }))}>
                        <option value="">Not set</option>
                        {bugTypeOptions.map(option => <option key={option.value} value={option.value}>{option.label}{option.current ? " · current" : ""}</option>)}
                      </select>
                    </FormField>
                    <label className="checkbox-field bug-regression-field">
                      <input disabled={!canEditBugFields} checked={draft.regression} onChange={(event) => setDraft((current) => ({ ...current, regression: event.target.checked }))} type="checkbox" />
                      <span>Regression</span>
                    </label>
                    <LabelsField
                      disabled={!canEditBugFields}
                      options={issueLabelOptions}
                      placeholder="Select or add label"
                      required={jiraBugCoreRequired.labels}
                      value={draft.labelsText}
                      onChange={(labelsText) => setDraft((current) => ({ ...current, labelsText }))}
                    />
                    <FormField label="Sprint" required={jiraBugCoreRequired.sprint}>
                      <select disabled={!canEditBugFields || !canViewDeliveryScopes} required={jiraBugCoreRequired.sprint} value={draft.sprint} onChange={(event) => setDraft((current) => ({ ...current, sprint: event.target.value }))}>
                        <option value="">No sprint</option>
                        {sprintOptions.map((option) => (
                          <option key={`${option.source}:${option.sourceId || option.value}`} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Release / Fix version" required={jiraBugCoreRequired.release}>
                      <select disabled={!canEditBugFields || !canViewDeliveryScopes} required={jiraBugCoreRequired.release} value={draft.release} onChange={(event) => setDraft((current) => ({ ...current, release: event.target.value }))}>
                        <option value="">No release</option>
                        {releaseOptions.map((option) => (
                          <option key={`${option.source}:${option.sourceId || option.value}`} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </FormField>
                  </div>
                </section>

                {(isCreating ? bugCreateMetadataQuery.isLoading || bugCreateMetadataQuery.isError : bugEditMetadataQuery.isLoading || bugEditMetadataQuery.isError) || requiredJiraBugFields.length ? (
                  <section className="issue-form-section issue-form-section--required-fields">
                    <div className="issue-form-section-head">
                      <strong>Required Defect fields</strong>
                      <span>
                        These fields come from the HelloTest Defect {isCreating ? "create" : "edit"} form and are validated with this save.
                      </span>
                    </div>
                    {(isCreating ? bugCreateMetadataQuery.isLoading : bugEditMetadataQuery.isLoading) ? (
                      <LoadingState label={`Checking Defect ${isCreating ? "create" : "edit"} fields`} />
                    ) : (isCreating ? bugCreateMetadataQuery.isError : bugEditMetadataQuery.isError) ? (
                      <p className="inline-message error-message">HelloTest could not verify this Defect {isCreating ? "create" : "edit"} form. Refresh or ask a workspace administrator to check field-metadata access.</p>
                    ) : (
                      <JiraRequiredFields
                        disabled={!canEditBugFields}
                        fields={requiredJiraBugFields}
                        issueTypeName="Defect"
                        mode={isCreating ? "create" : "edit"}
                        onChange={updateAdditionalJiraField}
                        users={userItems}
                        values={draft.additional_fields}
                      />
                    )}
                  </section>
                ) : null}

                <section className="issue-form-section issue-form-section--evidence">
                  <div className="issue-form-section-head">
                    <strong>Failure evidence</strong>
                    <span>Description, reproduction steps, expected result, and actual result.</span>
                  </div>
                  <FormField label="Description" required>
                    <RichTextEditor
                      disabled={!canEditBugFields}
                      appearance="canonical"
                      required
                      rows={6}
                      value={draft.message}
                      onChange={(message) => setDraft((current) => ({ ...current, message }))}
                    />
                  </FormField>
                  <FormField label="Steps to Reproduce">
                    <RichTextEditor
                      disabled={!canEditBugFields}
                      appearance="canonical"
                      rows={6}
                      value={draft.steps_to_reproduce}
                      onChange={(steps_to_reproduce) => setDraft((current) => ({ ...current, steps_to_reproduce }))}
                    />
                  </FormField>
                  <div className="issue-form-grid issue-form-evidence-result-grid">
                    <FormField label="Expected Result">
                      <RichTextEditor
                        disabled={!canEditBugFields}
                        appearance="canonical"
                        rows={5}
                        value={draft.expected_result}
                        onChange={(expected_result) => setDraft((current) => ({ ...current, expected_result }))}
                      />
                    </FormField>
                    <FormField label="Actual Result">
                      <RichTextEditor
                        disabled={!canEditBugFields}
                        appearance="canonical"
                        rows={5}
                        value={draft.actual_result}
                        onChange={(actual_result) => setDraft((current) => ({ ...current, actual_result }))}
                      />
                    </FormField>
                  </div>
                </section>

                <section className="issue-form-section issue-form-section--root-cause">
                  <div className="issue-root-cause-grid">
                    <FormField label="Primary Root Cause">
                      <select disabled={!canEditBugFields} value={draft.root_cause} onChange={(event) => setDraft((current) => ({ ...current, root_cause: event.target.value }))}>
                        <option value="">Not determined</option>
                        {rootCauseOptions.map(option => <option key={option.value} value={option.value}>{option.label}{option.current ? " · current" : ""}</option>)}
                      </select>
                    </FormField>
                    <FormField label="QA Root Cause">
                      <select disabled={!canEditBugFields} value={draft.qa_root_cause} onChange={(event) => setDraft((current) => ({ ...current, qa_root_cause: event.target.value }))}>
                        <option value="">Not determined</option>
                        {qaRootCauseOptions.map(option => <option key={option.value} value={option.value}>{option.label}{option.current ? " · current" : ""}</option>)}
                      </select>
                    </FormField>
                  </div>
                </section>
                {isCreating && canCreateAttachments ? (
                  <section className="jira-attachment-panel" aria-label="Attachments for new Defect">
                    <div className="jira-attachment-head"><div><strong>Attachments</strong><span>{pendingAttachments.length} ready to upload when this Defect is created</span></div></div>
                    <div
                      className={isPendingAttachmentDragActive ? "jira-attachment-dropzone is-dragging" : "jira-attachment-dropzone"}
                      onDragEnter={(event) => { event.preventDefault(); setIsPendingAttachmentDragActive(true); }}
                      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsPendingAttachmentDragActive(false); }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => { event.preventDefault(); setIsPendingAttachmentDragActive(false); setPendingAttachments((current) => [...current, ...Array.from(event.dataTransfer.files)].slice(0, 10)); }}
                    >
                      <input hidden multiple onChange={(event) => setPendingAttachments((current) => [...current, ...Array.from(event.target.files || [])].slice(0, 10))} ref={pendingAttachmentInputRef} type="file" />
                      <JiraAttachmentIcon />
                      <span>Drop files to attach or</span>
                      <button className="jira-attachment-browse-button" onClick={() => pendingAttachmentInputRef.current?.click()} type="button">Browse</button>
                    </div>
                    <div className="jira-attachment-grid">
                      {pendingAttachments.map((file, index) => (
                        <article className="jira-attachment-card" key={`${file.name}-${file.size}-${index}`}>
                          <div className="jira-attachment-preview"><JiraAttachmentIcon /></div>
                          <div className="jira-attachment-copy"><strong title={file.name}>{file.name}</strong><span>{Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB · pending</span></div>
                          <div className="jira-attachment-actions"><button className="ghost-button compact danger" onClick={() => setPendingAttachments((current) => current.filter((_, fileIndex) => fileIndex !== index))} type="button">Remove</button></div>
                        </article>
                      ))}
                    </div>
                    {!pendingAttachments.length ? <div className="empty-state compact">No attachments yet.</div> : null}
                  </section>
                ) : null}
                {!isCreating && selectedItem ? (
                  <JiraAttachmentPanel
                    canDelete={canDeleteAttachments}
                    canUpload={canCreateAttachments}
                    canView={canViewAttachments}
                    entityId={selectedItem.id}
                    entityType="issue"
                    issueKey={selectedItem.jira_bug_key || selectedItem.id}
                    projectId={projectId}
                  />
                ) : null}
                {!isCreating && selectedItem ? (
                  <IssueActivityPanel canComment={canCommentOnBugs} issueId={selectedItem.id} issueKey={selectedItem.display_id || selectedItem.id} key={selectedItem.id} projectId={projectId} />
                ) : null}
                {isCreating && duplicateCandidates.length ? (
                  <section className="issue-duplicate-review" role="alert">
                    <strong>{duplicateCandidates.length} possible duplicate Defect{duplicateCandidates.length === 1 ? "" : "s"}</strong>
                    <div className="action-row">
                      <button onClick={() => duplicateCandidates.forEach((candidate) => window.open(`/issues?issue=${encodeURIComponent(candidate.id)}`, "_blank", "noopener,noreferrer"))} type="button">Open all in new tabs</button>
                      <button className="primary-button" onClick={(event) => { const form = event.currentTarget.closest("form"); setDuplicateReviewAccepted(true); setDuplicateCandidates([]); window.setTimeout(() => form?.requestSubmit(), 0); }} type="button">Continue and Create</button>
                    </div>
                  </section>
                ) : null}
                </div>
                {isCreating ? (
                  <footer className="report-bug-modal-footer">
                    <button
                      className="report-bug-modal-cancel-button"
                      disabled={createIssue.isPending}
                      onClick={closeIssueWorkspace}
                      type="button"
                    >
                      Cancel
                    </button>
                    {canCreateBugs ? (<button
                      className="report-bug-modal-save-button"
                      disabled={!canCreateBugs || createIssue.isPending || bugCreateMetadataQuery.isLoading || bugCreateMetadataQuery.isError}
                      type="submit"
                    >
                      <BugIcon />
                      <span>
                        {createIssue.isPending
                          ? "Creating…"
                          : bugCreateMetadataQuery.isLoading
                            ? "Checking Defect fields…"
                            : "Create"}
                      </span>
                    </button>) : null}
                  </footer>
                ) : (
                  <footer className="issue-detail-footer">
                    <span className="issue-detail-footer-context">
                      <BugIcon size={15} strokeWidth={1.8} />
                      <span>{canManageBugs ? "Changes save to the HelloTest Defect and preserve linked evidence." : "You have read-only access to this Defect."}</span>
                    </span>
                    <div className="issue-detail-footer-actions">
                      {selectedItem && canManageBugs ? (
                        <button
                          className="issue-detail-delete-button"
                          disabled={deleteIssue.isPending}
                          onClick={async () => {
                            if (await confirmDelete({ message: `Delete Defect "${selectedItem.title}" from HelloTest? Historical test-run snapshots stay preserved, but this Defect and its live links will be removed.` })) {
                              void deleteIssue.mutateAsync(selectedItem.id);
                            }
                          }}
                          type="button"
                        >
                          <TrashIcon size={14} />
                          <span>{deleteIssue.isPending ? "Deleting…" : "Delete Defect"}</span>
                        </button>
                      ) : null}
                      {canManageBugs ? (<button
                        className="issue-detail-save-button"
                        disabled={!canManageBugs || updateIssue.isPending || bugEditMetadataQuery.isLoading || bugEditMetadataQuery.isError}
                        type="submit"
                      >
                        <BugIcon size={14} strokeWidth={1.8} />
                        {updateIssue.isPending
                          ? "Updating…"
                          : bugEditMetadataQuery.isLoading
                            ? "Checking Defect fields…"
                            : "Update Defect"}
                      </button>) : null}
                    </div>
                  </footer>
                )}
              </form>
            ) : (
              <div className="empty-state compact">Select a defect from the tiles or create a new entry.</div>
            )}
          </IssueEditorSurface>
        )}
        isDetailOpen={isCreating || Boolean(selectedIssueId)}
      />
    </div>
  );
}
