import { ChangeEvent, FormEvent, Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AiCaseAuthoringModal } from "../components/AiCaseAuthoringModal";
import { AiDesignStudioModal } from "../components/AiDesignStudioModal";
import { AddIcon, CopyIcon, ExportIcon, MoveIcon, OpenIcon, TrashIcon } from "../components/AppIcons";
import { CatalogActionMenu } from "../components/CatalogActionMenu";
import { CatalogViewToggle } from "../components/CatalogViewToggle";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { DisplayIdBadge } from "../components/DisplayIdBadge";
import { ExecutionContextSelector } from "../components/ExecutionContextSelector";
import { FormField } from "../components/FormField";
import { LinkedTestCaseModal } from "../components/LinkedTestCaseModal";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { RecorderSessionInsights } from "../components/RecorderSessionInsights";
import { RecorderStartControls, type RecorderStartOptions } from "../components/RecorderStartControls";
import { StepParameterDialog } from "../components/StepParameterDialog";
import { StepParameterizedText } from "../components/StepParameterizedText";
import {
  AutomationCodeIcon,
  CodePreviewDialog,
  SharedGroupLevelIcon,
  StandardStepIcon,
  StepAutomationDialog,
  StepIconButton as InlineStepToolButton,
  StepTypePickerButton
} from "../components/StepAutomationEditor";
import { SharedStepsIcon as SharedStepsIconGraphic } from "../components/SharedStepsIcon";
import { StatusBadge } from "../components/StatusBadge";
import {
  TileCardFact,
  TileCardPriorityIcon,
  TileCardRequirementIcon,
  TileCardSuiteIcon,
  TileCardStepsIcon,
  formatTileCardLabel,
  getTileCardTone
} from "../components/TileCardPrimitives";
import { SuiteCasePicker } from "../components/SuiteCasePicker";
import { TileBrowserPane } from "../components/TileBrowserPane";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { ToastMessage } from "../components/ToastMessage";
import { WorkspaceSectionTabs } from "../components/WorkspaceSectionTabs";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
import { VisualTestBuilder } from "../components/VisualTestBuilder";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { useDeleteConfirmation } from "../components/DeleteConfirmationDialog";
import { useCurrentAppType, useCurrentProject } from "../hooks/useCurrentProject";
import { useDomainMetadata } from "../hooks/useDomainMetadata";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { formatAuditTimestamp, resolveAuditUserLabel } from "../lib/auditDisplay";
import {
  countImportedGroups,
  countImportedSuites,
  countImportedSteps,
  getImportedStepPreviewLabel
} from "../lib/testCaseImport";
import {
  getTestCaseImportSourceLabel,
  prepareTestCaseImportBatch,
  TEST_CASE_IMPORT_SOURCE_OPTIONS,
  type PreparedTestCaseImportBatch,
  type TestCaseImportSource,
  type TestCaseImportSourceSelection
} from "../lib/testCaseSourceImport";
import { api } from "../lib/api";
import { appendUniqueImages, parseExternalLinks, readImageFiles, toggleRequirementOnPreviewCase } from "../lib/aiDesignStudio";
import { formatReferenceList, parseReferenceList } from "../lib/externalReferences";
import { summarizeExecutionStart } from "../lib/executionStartSummary";
import { upsertSharedStepGroupInCache } from "../lib/sharedStepGroupCache";
import {
  buildCaseAutomationCode,
  buildGroupAutomationCode,
  normalizeApiRequest,
  normalizeAutomationCode,
  normalizeStepType,
  resolveStepAutomationCode,
  stepHasAutomation
} from "../lib/stepAutomation";
import { type AssigneeOption, buildAssigneeOptions } from "../lib/userDisplay";
import {
  combineStepParameterValues,
  collectStepParameters,
  normalizeStepParameterValues,
  parseStepParameterName,
  resolveStepParameterText,
  type StepParameterDefinition,
  type StepParameterScope
} from "../lib/stepParameters";
import { TEST_AUTHORING_SECTION_ITEMS } from "../lib/workspaceSections";
import type {
  AiAuthoredTestCasePreview,
  AiDesignImageInput,
  AiDesignedTestCaseCandidate,
  AiTestCaseGenerationJob,
  AppType,
  AutomationLearningCacheEntry,
  Execution,
  ExecutionResult,
  Integration,
  ProjectMember,
  Project,
  RecorderSessionResponse,
  Requirement,
  SharedStepGroup,
  TestCase,
  TestStep,
  TestSuite,
  User
} from "../types";

type TestCaseDraft = {
  title: string;
  description: string;
  externalReferencesText: string;
  automated: "yes" | "no";
  priority: number;
  status: string;
  requirement_id: string;
};

type StepDraft = {
  action: string;
  expected_result: string;
  step_type: TestStep["step_type"];
  automation_code: string;
  api_request: TestStep["api_request"];
};

type TestCaseAuthoringLens = "manual" | "ui-script" | "api-script";

type AuthoringStepProjection = Pick<TestStep, "id" | "step_order" | "action" | "expected_result" | "step_type" | "automation_code" | "api_request">;

type DraftTestStep = {
  id: string;
  action: string;
  expected_result: string;
  step_type: TestStep["step_type"];
  automation_code: string;
  api_request: TestStep["api_request"];
  group_id: string | null;
  group_name: string | null;
  group_kind: "local" | "reusable" | null;
  reusable_group_id: string | null;
};

type CopiedTestStep = {
  action: string;
  expected_result: string;
  step_type: TestStep["step_type"];
  automation_code: string;
  api_request: TestStep["api_request"];
  group_id: string | null;
  group_name: string | null;
  group_kind: "local" | "reusable" | null;
  reusable_group_id: string | null;
};

type StepInsertionGroupContext = Pick<CopiedTestStep, "group_id" | "group_name" | "group_kind" | "reusable_group_id">;

type CutStepSource = {
  stepIds: string[];
  testCaseId: string | null;
  isDraft: boolean;
};

type StepActionMenuAction = {
  label: string;
  description?: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger" | "primary";
};

type CaseStepFilter = "all" | "with-steps" | "no-steps";
type CaseRunFilter = "all" | "with-runs" | "no-runs";
type TestCaseExecutionAssigneeOption = AssigneeOption;

type TestCaseEditorSectionKey = "case" | "steps" | "automation" | "history";

const createEmptyCaseDraft = (defaultStatus = "active", defaultAutomated: "yes" | "no" = "no"): TestCaseDraft => ({
  title: "",
  description: "",
  externalReferencesText: "",
  automated: defaultAutomated,
  priority: 3,
  status: defaultStatus,
  requirement_id: ""
});

const EMPTY_STEP_DRAFT: StepDraft = {
  action: "",
  expected_result: "",
  step_type: "web",
  automation_code: "",
  api_request: null
};

const executionHistoryDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const createDefaultTestCaseSections = (): Record<TestCaseEditorSectionKey, boolean> => ({
  case: false,
  steps: true,
  automation: false,
  history: false
});

const createCreateModeTestCaseSections = (): Record<TestCaseEditorSectionKey, boolean> => ({
  case: true,
  steps: true,
  automation: false,
  history: false
});

const createDraftStepId = () =>
  globalThis.crypto?.randomUUID?.() || `draft-step-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createDraftGroupId = () =>
  globalThis.crypto?.randomUUID?.() || `draft-group-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY = "qaira.testCaseParameterDrafts.v1";
const SUITE_PARAMETER_DRAFT_STORAGE_KEY = "qaira.suiteParameterDrafts.v1";
const RUN_PARAMETER_PREVIEW_STORAGE_KEY = "qaira.runParameterPreviewDrafts.v1";

const normalizeScopedParameterValues = (
  values?: Record<string, unknown> | null,
  scope: StepParameterScope = "t"
) => normalizeStepParameterValues((values || {}) as Record<string, string>, scope);

const normalizeTestCaseParameterValues = (values?: Record<string, unknown> | null) =>
  normalizeScopedParameterValues(values, "t");

const normalizeSuiteParameterValues = (values?: Record<string, unknown> | null) =>
  normalizeScopedParameterValues(values, "s");

const normalizeRunParameterValues = (values?: Record<string, unknown> | null) =>
  normalizeScopedParameterValues(values, "r");

const serializeScopedParameterValues = (
  values?: Record<string, unknown> | null,
  scope: StepParameterScope = "t"
) =>
  JSON.stringify(
    Object.entries(normalizeScopedParameterValues(values, scope))
      .sort(([left], [right]) => left.localeCompare(right))
  );

const serializeTestCaseParameterValues = (values?: Record<string, unknown> | null) =>
  serializeScopedParameterValues(values, "t");

const areTestCaseParameterValuesEqual = (
  left?: Record<string, unknown> | null,
  right?: Record<string, unknown> | null
) => serializeTestCaseParameterValues(left) === serializeTestCaseParameterValues(right);

const areSuiteParameterValuesEqual = (
  left?: Record<string, unknown> | null,
  right?: Record<string, unknown> | null
) => serializeScopedParameterValues(left, "s") === serializeScopedParameterValues(right, "s");

const readStoredParameterDrafts = (storageKey: string, scope: StepParameterScope = "t") => {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(storageKey);

    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed).reduce<Record<string, Record<string, string>>>((next, [scopeKey, values]) => {
      next[scopeKey] = normalizeScopedParameterValues(values as Record<string, unknown>, scope);
      return next;
    }, {});
  } catch {
    return {};
  }
};

const writeStoredParameterDrafts = (storageKey: string, drafts: Record<string, Record<string, string>>) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(drafts));
  } catch {
    // Ignore storage failures and keep the in-memory editor responsive.
  }
};

const readStoredTestCaseParameterDrafts = () => readStoredParameterDrafts(TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, "t");
const readStoredSuiteParameterDrafts = () => readStoredParameterDrafts(SUITE_PARAMETER_DRAFT_STORAGE_KEY, "s");
const readStoredRunParameterDrafts = () => readStoredParameterDrafts(RUN_PARAMETER_PREVIEW_STORAGE_KEY, "r");

const readStoredParameterDraft = (
  storageKey: string,
  scopeKey: string,
  scope: StepParameterScope = "t"
) => {
  if (!scopeKey) {
    return {};
  }

  const drafts = readStoredParameterDrafts(storageKey, scope);
  return normalizeScopedParameterValues(drafts[scopeKey], scope);
};

const hasStoredParameterDraft = (
  storageKey: string,
  scopeKey: string,
  scope: StepParameterScope = "t"
) => {
  if (!scopeKey) {
    return false;
  }

  const drafts = readStoredParameterDrafts(storageKey, scope);
  return Object.prototype.hasOwnProperty.call(drafts, scopeKey);
};

const writeStoredParameterDraft = (
  storageKey: string,
  scopeKey: string,
  values: Record<string, string>,
  scope: StepParameterScope = "t"
) => {
  if (!scopeKey) {
    return;
  }

  const drafts = readStoredParameterDrafts(storageKey, scope);
  drafts[scopeKey] = normalizeScopedParameterValues(values, scope);
  writeStoredParameterDrafts(storageKey, drafts);
};

const clearStoredParameterDraft = (
  storageKey: string,
  scopeKey: string,
  scope: StepParameterScope = "t"
) => {
  if (!scopeKey || typeof window === "undefined") {
    return;
  }

  try {
    const drafts = readStoredParameterDrafts(storageKey, scope);

    if (!(scopeKey in drafts)) {
      return;
    }

    delete drafts[scopeKey];

    if (Object.keys(drafts).length) {
      writeStoredParameterDrafts(storageKey, drafts);
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Ignore storage failures and keep the in-memory editor responsive.
  }
};

const readStoredTestCaseParameterDraft = (scopeKey: string) => readStoredParameterDraft(TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "t");
const hasStoredTestCaseParameterDraft = (scopeKey: string) => hasStoredParameterDraft(TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "t");
const writeStoredTestCaseParameterDraft = (scopeKey: string, values: Record<string, string>) =>
  writeStoredParameterDraft(TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, values, "t");
const clearStoredTestCaseParameterDraft = (scopeKey: string) => clearStoredParameterDraft(TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "t");
const readStoredSuiteParameterDraft = (scopeKey: string) => readStoredParameterDraft(SUITE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "s");
const hasStoredSuiteParameterDraft = (scopeKey: string) => hasStoredParameterDraft(SUITE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "s");
const writeStoredSuiteParameterDraft = (scopeKey: string, values: Record<string, string>) =>
  writeStoredParameterDraft(SUITE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, values, "s");
const clearStoredSuiteParameterDraft = (scopeKey: string) => clearStoredParameterDraft(SUITE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "s");
const readStoredRunParameterDraft = (scopeKey: string) => readStoredParameterDraft(RUN_PARAMETER_PREVIEW_STORAGE_KEY, scopeKey, "r");
const writeStoredRunParameterDraft = (scopeKey: string, values: Record<string, string>) =>
  writeStoredParameterDraft(RUN_PARAMETER_PREVIEW_STORAGE_KEY, scopeKey, values, "r");
const clearStoredRunParameterDraft = (scopeKey: string) => clearStoredParameterDraft(RUN_PARAMETER_PREVIEW_STORAGE_KEY, scopeKey, "r");

const buildTestCaseParameterDraftScopeKey = ({
  isCreating,
  testCaseId,
  appTypeId
}: {
  isCreating: boolean;
  testCaseId?: string | null;
  appTypeId?: string | null;
}) => {
  if (isCreating) {
    return `draft:${appTypeId || "global"}`;
  }

  return testCaseId ? `case:${testCaseId}` : "";
};

const buildSuiteParameterDraftScopeKey = (suiteId?: string | null) => (suiteId ? `suite:${suiteId}` : "");
const buildRunParameterDraftScopeKey = (appTypeId?: string | null) => `run:${appTypeId || "global"}`;

const normalizeSharedGroupComparableText = (value?: string | null) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const normalizeComparableAutomationCode = (value?: string | null) => normalizeAutomationCode(value).trim();

const normalizeComparableApiRequest = (value?: TestStep["api_request"]) =>
  JSON.stringify(normalizeApiRequest(value) || null);

const buildAuthoringLensCode = (title: string, steps: AuthoringStepProjection[], emptyMessage: string) => {
  if (!steps.length) {
    return `// ${emptyMessage}`;
  }

  const caseTitle = title.trim() || "Test case";
  const blocks = steps.map((step) => {
    const stepType = normalizeStepType(step.step_type);
    const stepLabel = [`Step ${step.step_order}`, stepType.toUpperCase()].join(" · ");
    const action = String(step.action || "").trim();
    const expected = String(step.expected_result || "").trim();

    return [
      `// ${stepLabel}`,
      action ? `// Manual action: ${action}` : "",
      expected ? `// Expected result: ${expected}` : "",
      resolveStepAutomationCode(step)
    ].filter(Boolean).join("\n");
  });

  return [`// Test case: ${caseTitle}`, ...blocks].join("\n\n");
};

const areComparableStepAutomationEqual = (
  left: Pick<TestStep, "step_type" | "automation_code" | "api_request">,
  right: Pick<TestStep, "step_type" | "automation_code" | "api_request">
) =>
  normalizeStepType(left.step_type) === normalizeStepType(right.step_type)
  && normalizeComparableAutomationCode(left.automation_code) === normalizeComparableAutomationCode(right.automation_code)
  && normalizeComparableApiRequest(left.api_request) === normalizeComparableApiRequest(right.api_request);

const normalizeDraftSteps = (steps: DraftTestStep[]) =>
  steps
    .map((step, index) => ({
      step_order: index + 1,
      action: step.action.trim(),
      expected_result: step.expected_result.trim(),
      step_type: normalizeStepType(step.step_type),
      automation_code: normalizeAutomationCode(step.automation_code) || undefined,
      api_request: normalizeApiRequest(step.api_request) || undefined,
      group_id: step.group_id || undefined,
      group_name: step.group_name?.trim() || undefined,
      group_kind: step.group_kind || undefined,
      reusable_group_id: step.reusable_group_id || undefined
    }))
    .filter((step) => step.action || step.expected_result);

const buildDraftStepsFromAiAuthoringPreview = (preview: AiAuthoredTestCasePreview): DraftTestStep[] =>
  preview.steps.map((step) => ({
    id: createDraftStepId(),
    action: step.action || "",
    expected_result: step.expected_result || "",
    step_type: normalizeStepType(step.step_type),
    automation_code: "",
    api_request: null,
    group_id: null,
    group_name: null,
    group_kind: null,
    reusable_group_id: null
  }));

const buildPersistedStepsFromAiAuthoringPreview = (preview: AiAuthoredTestCasePreview) =>
  preview.steps.map((step) => ({
    step_order: step.step_order,
    step_type: normalizeStepType(step.step_type),
    action: step.action || undefined,
    expected_result: step.expected_result || undefined
  }));

const normalizeCopiedSteps = (
  steps: Array<Pick<TestStep, "action" | "expected_result" | "step_type" | "automation_code" | "api_request" | "group_id" | "group_name" | "group_kind" | "reusable_group_id">>,
  mode: "copy" | "cut"
): CopiedTestStep[] =>
  steps.map((step) => {
    if (mode === "cut") {
      return {
        action: step.action || "",
        expected_result: step.expected_result || "",
        step_type: normalizeStepType(step.step_type),
        automation_code: normalizeAutomationCode(step.automation_code),
        api_request: normalizeApiRequest(step.api_request),
        group_id: step.group_id || null,
        group_name: step.group_name || null,
        group_kind: step.group_kind || null,
        reusable_group_id: step.reusable_group_id || null
      };
    }

    return {
      action: step.action || "",
      expected_result: step.expected_result || "",
      step_type: normalizeStepType(step.step_type),
      automation_code: normalizeAutomationCode(step.automation_code),
      api_request: normalizeApiRequest(step.api_request),
      group_id: null,
      group_name: null,
      group_kind: null,
      reusable_group_id: null
    };
  });

const materializeCopiedSteps = (steps: CopiedTestStep[]) => {
  const nextGroupIds = new Map<string, string>();

  return steps.map((step) => {
    const nextGroupId = step.group_id
      ? (nextGroupIds.get(step.group_id) || createDraftGroupId())
      : null;

    if (step.group_id && nextGroupId && !nextGroupIds.has(step.group_id)) {
      nextGroupIds.set(step.group_id, nextGroupId);
    }

    return {
      ...step,
      group_id: nextGroupId
    };
  });
};

const formatBulkStepActionLabel = (
  step: Pick<TestStep, "action" | "group_id" | "group_name" | "group_kind" | "reusable_group_id">,
  sharedGroupNameById: Record<string, string>
) => {
  const action = step.action || "";

  if (step.reusable_group_id) {
    const sharedName = sharedGroupNameById[step.reusable_group_id] || step.group_name || "Shared steps";
    return `[Shared: ${sharedName}]${action ? ` ${action}` : ""}`;
  }

  if (step.group_id || (step.group_kind === "local" && step.group_name)) {
    return `[Group: ${step.group_name || "Grouped steps"}]${action ? ` ${action}` : ""}`;
  }

  return action;
};

function TestCaseActionIcon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16">
      {children}
    </svg>
  );
}

function TestCaseImportIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </TestCaseActionIcon>
  );
}

function TestCaseExportIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M12 21V9" />
      <path d="m17 14-5-5-5 5" />
      <path d="M5 3h14" />
    </TestCaseActionIcon>
  );
}

function TestCaseSparkIcon() {
  return (
    <TestCaseActionIcon>
      <path d="m12 3 1.8 4.7L18 9.5l-4.2 1.8L12 16l-1.8-4.7L6 9.5l4.2-1.8Z" />
    </TestCaseActionIcon>
  );
}

function TestCaseCreateIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </TestCaseActionIcon>
  );
}

function TestCaseSelectAllIcon() {
  return (
    <TestCaseActionIcon>
      <rect x="4" y="5" width="6" height="6" rx="1.2" />
      <path d="M14 7h6" />
      <rect x="4" y="13" width="6" height="6" rx="1.2" />
      <path d="M14 15h6" />
    </TestCaseActionIcon>
  );
}

function TestCaseClearIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M5 12h14" />
      <path d="m15.5 6.5 3 3-9.5 9.5H6v-3Z" />
    </TestCaseActionIcon>
  );
}

function TestCaseDeleteIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M7 7v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </TestCaseActionIcon>
  );
}

function TestCaseRunIcon() {
  return (
    <TestCaseActionIcon>
      <path d="m9 7 8 5-8 5z" fill="currentColor" stroke="none" />
    </TestCaseActionIcon>
  );
}

function TestCaseAcceptIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M6 12.5 10 16l8-8" />
    </TestCaseActionIcon>
  );
}

function TestCaseRejectIcon() {
  return (
    <TestCaseActionIcon>
      <path d="m8 8 8 8" />
      <path d="m16 8-8 8" />
    </TestCaseActionIcon>
  );
}

function TestCaseTileActionButton({
  children,
  className = "",
  disabled = false,
  onClick,
  title
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      aria-label={title}
      className={["test-case-tile-action-button", className].filter(Boolean).join(" ")}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

const formatExecutionHistoryDate = (value?: string | null) => {
  if (!value) {
    return "Recent run";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : executionHistoryDateFormatter.format(parsed);
};

function resolveScopedIntegration(integrations: Integration[], type: Integration["type"], projectId: string) {
  const active = integrations.filter((integration) => integration.type === type && integration.is_active);
  const scoped = projectId
    ? active.find((integration) => String(integration.config?.project_id || "") === projectId)
    : null;

  return scoped || active.find((integration) => !String(integration.config?.project_id || "").trim()) || active[0] || null;
}

function formatRecorderDisplayMode(value?: string | null) {
  return value === "browser-live-view" ? "Live view" : value === "local-browser-with-live-view" ? "Local browser + live view" : "Recorder";
}

export function TestCasesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useAuth();
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const domainMetadataQuery = useDomainMetadata();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [catalogViewMode, setCatalogViewMode] = useState<"tile" | "list">("tile");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [caseStatusFilter, setCaseStatusFilter] = useState("all");
  const [casePriorityFilter, setCasePriorityFilter] = useState("all");
  const [caseStepFilter, setCaseStepFilter] = useState<CaseStepFilter>("all");
  const [caseRunFilter, setCaseRunFilter] = useState<CaseRunFilter>("all");
  const [isCreating, setIsCreating] = useState(false);
  const [selectedActionTestCaseIds, setSelectedActionTestCaseIds] = useState<string[]>([]);
  const [linkedPreviewCaseId, setLinkedPreviewCaseId] = useState("");
  const [isDeletingSelectedTestCases, setIsDeletingSelectedTestCases] = useState(false);
  const [isCreateSuiteModalOpen, setIsCreateSuiteModalOpen] = useState(false);
  const [isCreateExecutionModalOpen, setIsCreateExecutionModalOpen] = useState(false);
  const [executionName, setExecutionName] = useState("");
  const [selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId] = useState("");
  const [selectedExecutionConfigurationId, setSelectedExecutionConfigurationId] = useState("");
  const [selectedExecutionDataSetId, setSelectedExecutionDataSetId] = useState("");
  const [selectedExecutionAssigneeId, setSelectedExecutionAssigneeId] = useState("");
  const [automationStartUrl, setAutomationStartUrl] = useState("");
  const [automationContext, setAutomationContext] = useState("");
  const [automationFailureThreshold, setAutomationFailureThreshold] = useState(3);
  const [recorderSession, setRecorderSession] = useState<RecorderSessionResponse | null>(null);
  const [recorderSessionCaseId, setRecorderSessionCaseId] = useState("");
  const [recorderStartOptions, setRecorderStartOptions] = useState<RecorderStartOptions | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<TestCaseEditorSectionKey, boolean>>(createDefaultTestCaseSections);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const lastTestCaseParameterSeedRef = useRef("");
  const generationJobAlertScopeRef = useRef("");
  const surfacedGenerationJobFailureIdsRef = useRef<Set<string>>(new Set());
  const defaultTestCaseStatus = domainMetadataQuery.data?.test_cases.default_status || "active";
  const defaultTestCaseAutomated = (domainMetadataQuery.data?.test_cases.default_automated || "no") as "yes" | "no";
  const testCaseStatusOptions = domainMetadataQuery.data?.test_cases.statuses || [];
  const testCaseAutomatedOptions = domainMetadataQuery.data?.test_cases.automated_options || [
    { value: "no", label: "No" },
    { value: "yes", label: "Yes" }
  ];
  const emptyCaseDraft = useMemo(
    () => createEmptyCaseDraft(defaultTestCaseStatus, defaultTestCaseAutomated),
    [defaultTestCaseAutomated, defaultTestCaseStatus]
  );
  const [caseDraft, setCaseDraft] = useState<TestCaseDraft>(() => createEmptyCaseDraft());
  const [newStepDraft, setNewStepDraft] = useState<StepDraft>(EMPTY_STEP_DRAFT);
  const [stepInsertIndex, setStepInsertIndex] = useState<number | null>(null);
  const [stepInsertGroupContext, setStepInsertGroupContext] = useState<StepInsertionGroupContext | null>(null);
  const [draftSteps, setDraftSteps] = useState<DraftTestStep[]>([]);
  const [selectedStepIds, setSelectedStepIds] = useState<string[]>([]);
  const [isCaseParameterDialogOpen, setIsCaseParameterDialogOpen] = useState(false);
  const [testCaseParameterValues, setTestCaseParameterValues] = useState<Record<string, string>>({});
  const [suiteParameterValues, setSuiteParameterValues] = useState<Record<string, string>>({});
  const [runPreviewParameterValues, setRunPreviewParameterValues] = useState<Record<string, string>>({});
  const [selectedParameterSuiteId, setSelectedParameterSuiteId] = useState("");
  const [copiedSteps, setCopiedSteps] = useState<CopiedTestStep[]>([]);
  const [copiedStepMode, setCopiedStepMode] = useState<"copy" | "cut">("copy");
  const [cutStepSource, setCutStepSource] = useState<CutStepSource | null>(null);
  const [expandedStepIds, setExpandedStepIds] = useState<string[]>([]);
  const [expandedStepGroupIds, setExpandedStepGroupIds] = useState<string[]>([]);
  const [stepDrafts, setStepDrafts] = useState<Record<string, StepDraft>>({});
  const [isStepGroupModalOpen, setIsStepGroupModalOpen] = useState(false);
  const [stepGroupName, setStepGroupName] = useState("");
  const [saveAsReusableGroup, setSaveAsReusableGroup] = useState(false);
  const [isSharedGroupPickerOpen, setIsSharedGroupPickerOpen] = useState(false);
  const [selectedSharedGroupId, setSelectedSharedGroupId] = useState("");
  const [sharedGroupSearchTerm, setSharedGroupSearchTerm] = useState("");
  const [isSuiteLinkModalOpen, setIsSuiteLinkModalOpen] = useState(false);
  const [suiteLinkDraftIds, setSuiteLinkDraftIds] = useState<string[]>([]);
  const [editingAutomationStepId, setEditingAutomationStepId] = useState("");
  const [rephrasingStepId, setRephrasingStepId] = useState("");
  const [codePreviewState, setCodePreviewState] = useState<{ title: string; subtitle: string; code: string } | null>(null);
  const caseSectionRef = useRef<HTMLDivElement | null>(null);
  const suppressCaseSelectionFromUrlRef = useRef(false);
  const [createSuiteContextId, setCreateSuiteContextId] = useState("");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importBatches, setImportBatches] = useState<PreparedTestCaseImportBatch[]>([]);
  const [importFileWarnings, setImportFileWarnings] = useState<string[]>([]);
  const [importRequirementId, setImportRequirementId] = useState("");
  const [importSourceSelection, setImportSourceSelection] = useState<TestCaseImportSourceSelection>("auto");
  const [isAiCaseAuthoringOpen, setIsAiCaseAuthoringOpen] = useState(false);
  const [aiCaseAuthoringRequirementId, setAiCaseAuthoringRequirementId] = useState("");
  const [aiCaseAuthoringAdditionalContext, setAiCaseAuthoringAdditionalContext] = useState("");
  const [aiCaseAuthoringPreview, setAiCaseAuthoringPreview] = useState<AiAuthoredTestCasePreview | null>(null);
  const [aiCaseAuthoringMessage, setAiCaseAuthoringMessage] = useState("");
  const [aiCaseAuthoringTone, setAiCaseAuthoringTone] = useState<"success" | "error">("success");
  const [isAiStudioOpen, setIsAiStudioOpen] = useState(false);
  const [aiRequirementIds, setAiRequirementIds] = useState<string[]>([]);
  const [integrationId, setIntegrationId] = useState("");
  const [maxCases, setMaxCases] = useState(8);
  const [parallelRequirementLimit, setParallelRequirementLimit] = useState(5);
  const [aiAdditionalContext, setAiAdditionalContext] = useState("");
  const [aiExternalLinksText, setAiExternalLinksText] = useState("");
  const [aiReferenceImages, setAiReferenceImages] = useState<AiDesignImageInput[]>([]);
  const [aiPreviewCases, setAiPreviewCases] = useState<AiDesignedTestCaseCandidate[]>([]);
  const [aiPreviewMessage, setAiPreviewMessage] = useState("");
  const [aiPreviewTone, setAiPreviewTone] = useState<"success" | "error">("success");
  const [schedulerActionCaseId, setSchedulerActionCaseId] = useState("");
  const [schedulerActionKind, setSchedulerActionKind] = useState<"accept" | "reject" | "run" | "run-local" | "">("");

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
    queryKey: ["test-case-suites", appTypeId],
    queryFn: () => api.testSuites.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const testCasesQuery = useQuery({
    queryKey: ["global-test-cases", appTypeId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const generationJobsQuery = useQuery({
    queryKey: ["ai-test-case-generation-jobs", appTypeId],
    queryFn: () => api.testCases.listGenerationJobs({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId),
    refetchInterval: appTypeId ? 5000 : false
  });
  const executionsQuery = useQuery({
    queryKey: ["executions", projectId],
    queryFn: () => api.executions.list(projectId ? { project_id: projectId } : undefined),
    enabled: Boolean(projectId)
  });
  const sharedStepGroupsQuery = useQuery({
    queryKey: ["shared-step-groups", appTypeId],
    queryFn: () => api.sharedStepGroups.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const executionResultsQuery = useQuery({
    queryKey: ["global-test-case-results", appTypeId],
    queryFn: () => api.executionResults.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const allTestStepsQuery = useQuery({
    queryKey: ["global-test-steps", appTypeId],
    queryFn: () => api.testSteps.list(),
    enabled: Boolean(appTypeId)
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations", "llm"],
    queryFn: () => api.integrations.list({ type: "llm", is_active: true })
  });
  const testEngineIntegrationsQuery = useQuery({
    queryKey: ["integrations", "testengine", projectId],
    queryFn: () => api.integrations.list({ type: "testengine", is_active: true }),
    enabled: Boolean(projectId && session)
  });
  const localDesktopIntegrationsQuery = useQuery({
    queryKey: ["integrations", "local-desktop"],
    queryFn: () => api.integrations.list({ type: "local-desktop", is_active: true }),
    enabled: Boolean(session)
  });
  const automationLearningCacheQuery = useQuery({
    queryKey: ["automation-learning-cache", projectId, appTypeId],
    queryFn: () => api.testCases.learningCache({
      project_id: projectId || undefined,
      app_type_id: appTypeId || undefined,
      limit: 12
    }),
    enabled: Boolean((projectId || appTypeId) && session)
  });
  const stepsQuery = useQuery({
    queryKey: ["test-case-steps", selectedTestCaseId],
    queryFn: () => api.testSteps.list({ test_case_id: selectedTestCaseId }),
    enabled: Boolean(selectedTestCaseId)
  });

  const createTestCase = useMutation({ mutationFn: api.testCases.create });
  const createGenerationJob = useMutation({ mutationFn: api.testCases.createGenerationJob });
  const createSuite = useMutation({ mutationFn: api.testSuites.create });
  const updateSuite = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.testSuites.update>[1] }) =>
      api.testSuites.update(id, input)
  });
  const assignSuiteCases = useMutation({
    mutationFn: ({ id, testCaseIds }: { id: string; testCaseIds: string[] }) => api.testSuites.assignTestCases(id, testCaseIds)
  });
  const createExecution = useMutation({ mutationFn: api.executions.create });
  const createLocalRun = useMutation({ mutationFn: api.executions.createLocalRun });
  const startExecution = useMutation({ mutationFn: (id: string) => api.executions.start(id) });
  const acceptGeneratedCase = useMutation({ mutationFn: api.testCases.acceptGeneratedCase });
  const rejectGeneratedCase = useMutation({ mutationFn: api.testCases.rejectGeneratedCase });
  const updateTestCase = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.testCases.update>[1] }) =>
      api.testCases.update(id, input)
  });
  const persistCaseParameterValues = useMutation({
    mutationFn: ({ id, parameter_values }: { id: string; parameter_values: Record<string, string> }) =>
      api.testCases.update(id, { parameter_values })
  });
  const deleteTestCase = useMutation({ mutationFn: api.testCases.delete });
  const importTestCases = useMutation({ mutationFn: api.testCases.bulkImport });
  const previewCaseAuthoring = useMutation({ mutationFn: api.testCases.previewCaseAuthoring });
  const rephraseStepWithAi = useMutation({ mutationFn: api.testCases.rephraseStep });
  const previewDesignedCases = useMutation({ mutationFn: api.testCases.previewDesignedCases });
  const acceptDesignedCases = useMutation({ mutationFn: api.testCases.acceptDesignedCases });
  const buildSingleAutomation = useMutation({
    mutationFn: ({ testCaseId }: { testCaseId: string }) =>
      api.testCases.queueAutomationGenerator(testCaseId, {
        integration_id: integrationId || undefined,
        start_url: automationStartUrl.trim() || undefined,
        additional_context: automationContext.trim() || undefined,
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined
      })
  });
  const buildBatchAutomation = useMutation({
    mutationFn: ({ testCaseIds }: { testCaseIds: string[] }) =>
      api.testCases.buildAutomationBatch({
        app_type_id: appTypeId,
        test_case_ids: testCaseIds,
        integration_id: integrationId || undefined,
        start_url: automationStartUrl.trim() || undefined,
        additional_context: automationContext.trim() || undefined,
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined,
        failure_threshold: automationFailureThreshold
      })
  });
  const startRecorder = useMutation({
    mutationFn: ({ testCaseId, options }: { testCaseId: string; options: RecorderStartOptions }) =>
      api.testCases.startRecorderSession(testCaseId, {
        start_url: automationStartUrl.trim() || undefined,
        recorder_mode: options.recorder_mode,
        recorder_target: options.recorder_target,
        engine_base_url: options.engine_base_url,
        recorder_public_base_url: options.recorder_public_base_url,
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined
      })
  });
  const finishRecorder = useMutation({
    mutationFn: ({ testCaseId, sessionId, transactionId, recorderStartOptions }: { testCaseId: string; sessionId: string; transactionId?: string; recorderStartOptions?: RecorderStartOptions | null }) =>
      api.testCases.finishRecorderSession(testCaseId, sessionId, {
        transaction_id: transactionId,
        integration_id: integrationId || undefined,
        additional_context: automationContext.trim() || undefined,
        recorder_mode: recorderStartOptions?.recorder_mode,
        recorder_target: recorderStartOptions?.recorder_target,
        engine_base_url: recorderStartOptions?.engine_base_url,
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined
      })
  });
  const createStep = useMutation({ mutationFn: api.testSteps.create });
  const groupSteps = useMutation({ mutationFn: api.testSteps.group });
  const ungroupSteps = useMutation({ mutationFn: api.testSteps.ungroup });
  const insertSharedGroup = useMutation({ mutationFn: api.testSteps.insertSharedGroup });
  const createSharedStepGroup = useMutation({ mutationFn: api.sharedStepGroups.create });
  const updateStep = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.testSteps.update>[1] }) =>
      api.testSteps.update(id, input)
  });
  const reorderSteps = useMutation({
    mutationFn: ({ testCaseId, stepIds }: { testCaseId: string; stepIds: string[] }) =>
      api.testSteps.reorder(testCaseId, stepIds)
  });
  const deleteStep = useMutation({ mutationFn: api.testSteps.delete });

  const projects = projectsQuery.data || [];
  const users = (usersQuery.data || []) as User[];
  const projectMembers = (projectMembersQuery.data || []) as ProjectMember[];
  const testEngineIntegrations = testEngineIntegrationsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const requirements = requirementsQuery.data || [];
  const suites = suitesQuery.data || [];
  const testCases = testCasesQuery.data || [];
  const generationJobs = generationJobsQuery.data || [];
  const executions = executionsQuery.data || [];
  const sharedStepGroups = sharedStepGroupsQuery.data || [];
  const executionResults = executionResultsQuery.data || [];
  const allTestSteps = allTestStepsQuery.data || [];
  const integrations = integrationsQuery.data || [];
  const supportsLocalDesktopExecution = (localDesktopIntegrationsQuery.data || []).length > 0;
  const userById = useMemo(
    () =>
      users.reduce<Record<string, User>>((accumulator, user) => {
        accumulator[user.id] = user;
        return accumulator;
      }, {}),
    [users]
  );
  const assigneeOptions = useMemo<TestCaseExecutionAssigneeOption[]>(
    () => buildAssigneeOptions(projectMembers, users),
    [projectMembers, users]
  );
  const steps = useMemo(
    () => ((stepsQuery.data || []) as TestStep[]).slice().sort((left, right) => left.step_order - right.step_order),
    [stepsQuery.data]
  );
  const [isVisualBuilderActive, setIsVisualBuilderActive] = useState(false);

  const displaySteps = useMemo(
    () =>
      isCreating
        ? draftSteps.map((step, index) => ({
            id: step.id,
            test_case_id: selectedTestCaseId || "draft",
            step_order: index + 1,
            action: step.action,
            expected_result: step.expected_result,
            step_type: step.step_type,
            automation_code: step.automation_code,
            api_request: step.api_request,
            group_id: step.group_id,
            group_name: step.group_name,
            group_kind: step.group_kind,
            reusable_group_id: step.reusable_group_id
          }))
        : steps,
    [draftSteps, isCreating, selectedTestCaseId, steps]
  );

  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  function clearScopedSearchParams() {
    if (!searchParams.has("project") && !searchParams.has("appType")) {
      return;
    }

    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("project");
      next.delete("appType");
      return next;
    }, { replace: true });
  }

  function syncTestCaseSearchParams(nextCaseId?: string | null) {
    const currentCaseId = searchParams.get("case") || "";
    const targetCaseId = nextCaseId || "";

    if (currentCaseId === targetCaseId) {
      if (!targetCaseId) {
        suppressCaseSelectionFromUrlRef.current = false;
      }
      return;
    }

    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (targetCaseId) {
        next.set("case", targetCaseId);
      } else {
        next.delete("case");
        suppressCaseSelectionFromUrlRef.current = true;
      }
      return next;
    }, { replace: true });
  }

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

  const beginCreateCase = (suiteContextId = "") => {
    syncTestCaseSearchParams(null);
    setCreateSuiteContextId(suiteContextId);
    setIsCreating(true);
    setSelectedTestCaseId("");
    setCaseDraft(emptyCaseDraft);
    setDraftSteps([]);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
    setSelectedStepIds([]);
    setExpandedStepIds([]);
    setExpandedStepGroupIds([]);
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
    if (usersQuery.isPending || projectMembersQuery.isPending) {
      return;
    }

    if (selectedExecutionAssigneeId && !assigneeOptions.some((option) => option.id === selectedExecutionAssigneeId)) {
      setSelectedExecutionAssigneeId("");
    }
  }, [assigneeOptions, projectMembersQuery.isPending, selectedExecutionAssigneeId, usersQuery.isPending]);

  useEffect(() => {
    const requestedProjectId = searchParams.get("project");

    if (!requestedProjectId || projectsQuery.isPending) {
      return;
    }

    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("project");
      return next;
    }, { replace: true });
  }, [projectsQuery.isPending, searchParams, setSearchParams]);

  useEffect(() => {
    const requestedAppTypeId = searchParams.get("appType");

    if (!requestedAppTypeId || appTypesQuery.isPending) {
      return;
    }

    if (appTypes.some((appType) => appType.id === requestedAppTypeId)) {
      if (requestedAppTypeId !== appTypeId) {
        setAppTypeId(requestedAppTypeId);
      }
    }

    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("appType");
      return next;
    }, { replace: true });
  }, [appTypeId, appTypes, appTypesQuery.isPending, searchParams, setAppTypeId, setSearchParams]);

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
    syncTestCaseSearchParams(null);
    setCreateSuiteContextId("");
    setSelectedTestCaseId("");
    setIsCreating(false);
    setIsImportModalOpen(false);
    setImportBatches([]);
    setImportFileWarnings([]);
    setImportSourceSelection("auto");
    setIsAiCaseAuthoringOpen(false);
    setAiCaseAuthoringRequirementId("");
    setAiCaseAuthoringAdditionalContext("");
    setAiCaseAuthoringPreview(null);
    setAiCaseAuthoringMessage("");
    setIsCreateSuiteModalOpen(false);
    setIsCreateExecutionModalOpen(false);
    setExecutionName("");
    setSelectedExecutionAssigneeId("");
    resetExecutionContextSelection();
    setAutomationStartUrl("");
    setAutomationContext("");
    setAutomationFailureThreshold(3);
    setRecorderSession(null);
    setRecorderSessionCaseId("");
    setCaseDraft(emptyCaseDraft);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
    setDraftSteps([]);
    setSelectedStepIds([]);
    setCopiedSteps([]);
    setCopiedStepMode("copy");
    setCutStepSource(null);
    setExpandedStepIds([]);
    setExpandedStepGroupIds([]);
    setIsStepGroupModalOpen(false);
    setStepGroupName("");
    setSaveAsReusableGroup(false);
    setIsSharedGroupPickerOpen(false);
    setSelectedSharedGroupId("");
    setSharedGroupSearchTerm("");
    setSelectedActionTestCaseIds([]);
    setImportRequirementId("");
    setIsAiStudioOpen(false);
    setAiRequirementIds([]);
    setAiPreviewCases([]);
    setAiPreviewMessage("");
    setParallelRequirementLimit(5);
    setSchedulerActionCaseId("");
    setSchedulerActionKind("");
    setRephrasingStepId("");
  }, [appTypeId]);

  useEffect(() => {
    if (searchParams.get("create") !== "1") {
      return;
    }

    if (isCreating || selectedTestCaseId || !appTypeId) {
      return;
    }

    const requestedSuiteId = searchParams.get("suite") || "";
    beginCreateCase(requestedSuiteId);

    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (next.has("create") || next.has("suite")) {
        next.delete("create");
        next.delete("suite");
      }
      return next;
    }, { replace: true });
  }, [appTypeId, isCreating, searchParams, selectedTestCaseId, setSearchParams]);

  useEffect(() => {
    setSelectedActionTestCaseIds((current) => current.filter((id) => testCases.some((item) => item.id === id)));
  }, [testCases]);

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

  const sharedGroupNameById = useMemo(
    () =>
      sharedStepGroups.reduce<Record<string, string>>((accumulator, group) => {
        accumulator[group.id] = group.name;
        return accumulator;
      }, {}),
    [sharedStepGroups]
  );

  const allStepsByCaseId = useMemo(() => {
    const stepsByCaseId: Record<string, TestStep[]> = {};

    allTestSteps.forEach((step) => {
      stepsByCaseId[step.test_case_id] = stepsByCaseId[step.test_case_id] || [];
      stepsByCaseId[step.test_case_id].push(step);
    });

    Object.values(stepsByCaseId).forEach((steps) => steps.sort((left, right) => left.step_order - right.step_order));
    return stepsByCaseId;
  }, [allTestSteps]);

  const stepCountByCaseId = useMemo(
    () =>
      testCases.reduce<Record<string, number>>((counts, testCase) => {
        counts[testCase.id] = (allStepsByCaseId[testCase.id] || []).length;
        return counts;
      }, {}),
    [allStepsByCaseId, testCases]
  );

  const requirementTitleById = useMemo(
    () =>
      requirements.reduce<Record<string, string>>((map, requirement) => {
        map[requirement.id] = requirement.title;
        return map;
      }, {}),
    [requirements]
  );
  const suiteNameById = useMemo(
    () =>
      suites.reduce<Record<string, string>>((accumulator, suite) => {
        accumulator[suite.id] = suite.name;
        return accumulator;
      }, {}),
    [suites]
  );

  const caseStatusOptions = useMemo(
    () =>
      Array.from(
        new Set(
          testCases.map((testCase) => {
            const history = historyByCaseId[testCase.id] || [];
            return history[0]?.status || testCase.status || defaultTestCaseStatus;
          })
        )
      ).sort((left, right) => left.localeCompare(right)),
    [historyByCaseId, testCases]
  );
  const casePriorityOptions = useMemo(
    () => Array.from(new Set(testCases.map((testCase) => String(testCase.priority || 3)))).sort((left, right) => Number(left) - Number(right)),
    [testCases]
  );

  const filteredCases = useMemo(() => {
    const search = deferredSearchTerm.trim().toLowerCase();

    return testCases.filter((testCase) => {
      const requirementTitle =
        (testCase.requirement_ids || [testCase.requirement_id]).map((id) => (id ? requirementTitleById[id] || "" : "")).find(Boolean) || "";
      const history = historyByCaseId[testCase.id] || [];
      const latest = history[0];
      const derivedStatus = latest?.status || testCase.status || defaultTestCaseStatus;
      const stepCount = stepCountByCaseId[testCase.id] || 0;
      const runCount = history.length;

      const matchesSearch =
        !search ||
        [
          testCase.title,
          testCase.description || "",
          ...(testCase.external_references || []),
          requirementTitle
        ].some((value) => value.toLowerCase().includes(search));

      if (!matchesSearch) {
        return false;
      }

      if (caseStatusFilter !== "all" && derivedStatus !== caseStatusFilter) {
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
  }, [casePriorityFilter, caseRunFilter, caseStatusFilter, caseStepFilter, deferredSearchTerm, historyByCaseId, requirementTitleById, stepCountByCaseId, testCases]);

  const activeCaseFilterCount =
    Number(caseStatusFilter !== "all") +
    Number(casePriorityFilter !== "all") +
    Number(caseStepFilter !== "all") +
    Number(caseRunFilter !== "all");

  const areAllFilteredCasesSelected =
    filteredCases.length > 0 && filteredCases.every((item) => selectedActionTestCaseIds.includes(item.id));
  const selectedProject = projects.find((project) => String(project.id) === String(projectId)) || null;
  const selectedAppType = appTypes.find((appType) => appType.id === appTypeId) || null;
  const testEngineIntegration = resolveScopedIntegration(testEngineIntegrations, "testengine", projectId);
  const mobileRemoteRecorderEnabled = Boolean(
    testEngineIntegration?.config?.mobile_cloud_provider
    && testEngineIntegration.config.mobile_cloud_provider !== "none"
    && testEngineIntegration.config.mobile_remote_url
  );
  const automationLearningCache = automationLearningCacheQuery.data || [];
  const recorderLiveUrl = recorderSession?.live_view_url || "";

  useEffect(() => {
    if (!recorderSession?.status_url || recorderSession.status !== "running") {
      return undefined;
    }

    let cancelled = false;
    const refreshRecorderSession = async () => {
      try {
        const response = await fetch(recorderSession.status_url as string, { cache: "no-store" });

        if (!response.ok) {
          return;
        }

        const next = await response.json() as Partial<RecorderSessionResponse>;

        if (!cancelled) {
          setRecorderSession((current) => current?.id === recorderSession.id ? { ...current, ...next } : current);
        }
      } catch {
        // Live recorder stats are best-effort; the stream remains the source of truth for interaction.
      }
    };
    const timer = window.setInterval(() => void refreshRecorderSession(), 1000);

    void refreshRecorderSession();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [recorderSession?.id, recorderSession?.status, recorderSession?.status_url]);

  const executionsById = useMemo(
    () =>
      executions.reduce<Record<string, Execution>>((map, execution) => {
        map[execution.id] = execution;
        return map;
      }, {}),
    [executions]
  );
  const selectedActionCases = useMemo(
    () => testCases.filter((item) => selectedActionTestCaseIds.includes(item.id)),
    [selectedActionTestCaseIds, testCases]
  );
  const selectedManualAutomationCases = useMemo(
    () => selectedActionCases.filter((item) => item.automated !== "yes"),
    [selectedActionCases]
  );
  const selectedPendingGeneratedCases = useMemo(
    () => selectedActionCases.filter((item) => item.ai_generation_source === "scheduler" && item.ai_generation_review_status === "pending"),
    [selectedActionCases]
  );

  const selectedTestCase = useMemo(
    () => testCases.find((item) => item.id === selectedTestCaseId) || null,
    [selectedTestCaseId, testCases]
  );
  const automationTargetCaseIds = useMemo(
    () =>
      selectedActionTestCaseIds.length
        ? selectedActionTestCaseIds
        : selectedTestCase
          ? [selectedTestCase.id]
          : [],
    [selectedActionTestCaseIds, selectedTestCase]
  );
  const automationTargetCases = useMemo(
    () => testCases.filter((item) => automationTargetCaseIds.includes(item.id)),
    [automationTargetCaseIds, testCases]
  );
  const selectedCaseSuiteIds = useMemo(
    () =>
      Array.from(
        new Set(
          (
            isCreating
              ? createSuiteContextId
                ? [createSuiteContextId]
                : []
              : selectedTestCase?.suite_ids || (selectedTestCase?.suite_id ? [selectedTestCase.suite_id] : [])
          ).filter(Boolean)
        )
      ) as string[],
    [createSuiteContextId, isCreating, selectedTestCase?.suite_id, selectedTestCase?.suite_ids]
  );
  const selectedParameterSuite = suites.find((suite) => suite.id === selectedParameterSuiteId) || null;
  const createCaseParameterDraftScopeKey = useMemo(
    () => buildTestCaseParameterDraftScopeKey({ isCreating: true, appTypeId }),
    [appTypeId]
  );
  const selectedCaseParameterDraftScopeKey = useMemo(
    () => buildTestCaseParameterDraftScopeKey({ isCreating: false, testCaseId: selectedTestCaseId }),
    [selectedTestCaseId]
  );
  const selectedSuiteParameterDraftScopeKey = useMemo(
    () => buildSuiteParameterDraftScopeKey(selectedParameterSuiteId),
    [selectedParameterSuiteId]
  );
  const runPreviewParameterDraftScopeKey = useMemo(
    () => buildRunParameterDraftScopeKey(appTypeId),
    [appTypeId]
  );
  const activeTestCaseParameterSeedKey = useMemo(() => {
    if (isCreating) {
      return `draft:${appTypeId || "global"}`;
    }

    return selectedTestCaseId ? `case:${selectedTestCaseId}` : "__none__";
  }, [appTypeId, isCreating, selectedTestCaseId]);
  const mergedScopedParameterValues = useMemo(
    () => combineStepParameterValues(testCaseParameterValues, suiteParameterValues, runPreviewParameterValues),
    [runPreviewParameterValues, suiteParameterValues, testCaseParameterValues]
  );
  const aiCaseAuthoringSourceDraft = useMemo(
    () => ({
      title: caseDraft.title,
      description: caseDraft.description,
      parameter_values: testCaseParameterValues,
      steps: displaySteps.map((step) => ({
        step_order: step.step_order,
        step_type: stepDrafts[step.id]?.step_type ?? step.step_type,
        action: stepDrafts[step.id]?.action ?? step.action,
        expected_result: stepDrafts[step.id]?.expected_result ?? step.expected_result
      }))
    }),
    [caseDraft.description, caseDraft.title, displaySteps, stepDrafts, testCaseParameterValues]
  );
  const aiCaseAuthoringAutomationStepCount = useMemo(
    () =>
      displaySteps.filter((step) =>
        stepHasAutomation({
          action: stepDrafts[step.id]?.action ?? step.action,
          expected_result: stepDrafts[step.id]?.expected_result ?? step.expected_result,
          step_type: stepDrafts[step.id]?.step_type ?? step.step_type,
          automation_code: stepDrafts[step.id]?.automation_code ?? step.automation_code,
          api_request: stepDrafts[step.id]?.api_request ?? step.api_request
        })
      ).length,
    [displaySteps, stepDrafts]
  );
  const resolveScopedParameterInputState = (scope: StepParameterScope) => {
    if (scope === "s") {
      if (!selectedCaseSuiteIds.length) {
        return {
          disabled: true,
          hint: "Link this case to a suite before saving suite-shared values."
        };
      }

      if (!selectedParameterSuite) {
        return {
          disabled: true,
          hint: "Choose a suite target before editing suite-shared values."
        };
      }

      return {
        disabled: false,
        hint: selectedCaseSuiteIds.length > 1
          ? `Saved on suite "${selectedParameterSuite.name}".`
          : `Saved on linked suite "${selectedParameterSuite.name}".`
      };
    }

    if (scope === "r") {
      return {
        disabled: false,
        hint: "Preview only here. Real runs resolve @r values from the attached run data set."
      };
    }

    return {
      disabled: false,
      hint: isCreating
        ? "Saved with this draft test case."
        : "Saved on this test case and reused across its steps."
    };
  };
  const handleScopedParameterValueChange = (name: string, value: string) => {
    const parsed = parseStepParameterName(name);

    if (!parsed || resolveScopedParameterInputState(parsed.scope).disabled) {
      return;
    }

    if (parsed.scope === "s") {
      setSuiteParameterValues((current) => ({
        ...current,
        [parsed.name]: value
      }));
      return;
    }

    if (parsed.scope === "r") {
      setRunPreviewParameterValues((current) => ({
        ...current,
        [parsed.name]: value
      }));
      return;
    }

    setTestCaseParameterValues((current) => ({
      ...current,
      [parsed.name]: value
    }));
  };
  const syncCachedTestCaseParameterValues = (testCaseId: string, parameterValues: Record<string, string>) => {
    const normalizedValues = normalizeTestCaseParameterValues(parameterValues);

    queryClient.setQueryData<TestCase[]>(["global-test-cases", appTypeId], (current) =>
      current
        ? current.map((item) =>
            item.id === testCaseId
              ? {
                  ...item,
                  parameter_values: normalizedValues
                }
              : item
          )
        : current
    );
  };
  const syncCachedTestCaseSuiteIds = (testCaseId: string, suiteIds: string[]) => {
    const normalizedSuiteIds = Array.from(new Set(suiteIds.filter(Boolean)));

    queryClient.setQueryData<TestCase[]>(["global-test-cases", appTypeId], (current) =>
      current
        ? current.map((item) =>
            item.id === testCaseId
              ? {
                  ...item,
                  suite_id: normalizedSuiteIds[0] || null,
                  suite_ids: normalizedSuiteIds
                }
              : item
          )
        : current
    );
  };
  const syncCachedSuiteParameterValues = (suiteId: string, parameterValues: Record<string, string>) => {
    const normalizedValues = normalizeSuiteParameterValues(parameterValues);

    queryClient.setQueryData<TestSuite[]>(["test-case-suites", appTypeId], (current) =>
      current
        ? current.map((suite) =>
            suite.id === suiteId
              ? {
                  ...suite,
                  parameter_values: normalizedValues
                }
              : suite
          )
        : current
    );
  };

  useEffect(() => {
    if (isCreating) {
      return;
    }

    if (!selectedTestCaseId) {
      setCaseDraft(emptyCaseDraft);
      return;
    }

    if (testCasesQuery.isLoading || testCasesQuery.isFetching) {
      return;
    }

    if (selectedTestCase) {
      setCaseDraft({
        title: selectedTestCase.title,
        description: selectedTestCase.description || "",
        externalReferencesText: formatReferenceList(selectedTestCase.external_references),
        automated: (selectedTestCase.automated || defaultTestCaseAutomated) as "yes" | "no",
        priority: selectedTestCase.priority ?? 3,
        status: selectedTestCase.status || defaultTestCaseStatus,
        requirement_id: selectedTestCase.requirement_ids?.[0] || selectedTestCase.requirement_id || ""
      });
      return;
    }

    syncTestCaseSearchParams(null);
    setSelectedTestCaseId("");
    setCaseDraft(emptyCaseDraft);
  }, [
    defaultTestCaseAutomated,
    defaultTestCaseStatus,
    emptyCaseDraft,
    isCreating,
    selectedTestCase,
    selectedTestCaseId,
    testCasesQuery.isFetching,
    testCasesQuery.isLoading
  ]);

  useEffect(() => {
    if (isCreating) {
      const nextSeedKey = `draft:${appTypeId || "global"}`;

      if (lastTestCaseParameterSeedRef.current !== nextSeedKey) {
        setTestCaseParameterValues(readStoredTestCaseParameterDraft(createCaseParameterDraftScopeKey));
        setIsCaseParameterDialogOpen(false);
        lastTestCaseParameterSeedRef.current = nextSeedKey;
      }
      return;
    }

    if (!selectedTestCaseId) {
      if (lastTestCaseParameterSeedRef.current !== "__none__") {
        setTestCaseParameterValues({});
        setIsCaseParameterDialogOpen(false);
        lastTestCaseParameterSeedRef.current = "__none__";
      }
      return;
    }

    if (testCasesQuery.isLoading || testCasesQuery.isFetching || !selectedTestCase) {
      return;
    }

    const nextSeedKey = `case:${selectedTestCase.id}`;

    if (lastTestCaseParameterSeedRef.current === nextSeedKey) {
      return;
    }

    const storedDraft = readStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey);
    const nextValues = Object.keys(storedDraft).length || hasStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey)
      ? storedDraft
      : normalizeTestCaseParameterValues(selectedTestCase.parameter_values);

    setTestCaseParameterValues(nextValues);
    setIsCaseParameterDialogOpen(false);
    lastTestCaseParameterSeedRef.current = nextSeedKey;
  }, [
    appTypeId,
    createCaseParameterDraftScopeKey,
    isCreating,
    selectedCaseParameterDraftScopeKey,
    selectedTestCase,
    selectedTestCaseId,
    testCasesQuery.isFetching,
    testCasesQuery.isLoading
  ]);

  useEffect(() => {
    if (!searchParams.get("case")) {
      suppressCaseSelectionFromUrlRef.current = false;
    }

    if (suppressCaseSelectionFromUrlRef.current) {
      return;
    }

    if (isCreating || selectedTestCaseId) {
      return;
    }

    const requestedCaseId = searchParams.get("case");
    if (!requestedCaseId) {
      return;
    }

    if (testCasesQuery.isLoading || testCasesQuery.isFetching) {
      return;
    }

    if (testCases.some((item) => item.id === requestedCaseId)) {
      setSelectedTestCaseId(requestedCaseId);
    }
  }, [isCreating, searchParams, selectedTestCaseId, testCases, testCasesQuery.isFetching, testCasesQuery.isLoading]);

  useEffect(() => {
    if (!selectedCaseSuiteIds.length) {
      setSelectedParameterSuiteId("");
      setSuiteParameterValues({});
      return;
    }

    if (!selectedCaseSuiteIds.includes(selectedParameterSuiteId)) {
      setSelectedParameterSuiteId(selectedCaseSuiteIds[0] || "");
    }
  }, [selectedCaseSuiteIds, selectedParameterSuiteId]);

  useEffect(() => {
    const scopeKey = isCreating ? createCaseParameterDraftScopeKey : selectedCaseParameterDraftScopeKey;

    if (!scopeKey || lastTestCaseParameterSeedRef.current !== activeTestCaseParameterSeedKey) {
      return;
    }

    writeStoredTestCaseParameterDraft(scopeKey, testCaseParameterValues);
  }, [
    activeTestCaseParameterSeedKey,
    createCaseParameterDraftScopeKey,
    isCreating,
    selectedCaseParameterDraftScopeKey,
    testCaseParameterValues
  ]);

  useEffect(() => {
    if (
      isCreating
      || !selectedTestCase
      || lastTestCaseParameterSeedRef.current !== activeTestCaseParameterSeedKey
      || testCasesQuery.isLoading
      || testCasesQuery.isFetching
      || persistCaseParameterValues.isPending
      || updateTestCase.isPending
    ) {
      return;
    }

    const normalizedCurrentValues = normalizeTestCaseParameterValues(testCaseParameterValues);
    const normalizedSavedValues = normalizeTestCaseParameterValues(selectedTestCase.parameter_values);

    if (areTestCaseParameterValuesEqual(normalizedCurrentValues, normalizedSavedValues)) {
      clearStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      persistCaseParameterValues.mutate(
        { id: selectedTestCase.id, parameter_values: normalizedCurrentValues },
        {
          onSuccess: () => {
            syncCachedTestCaseParameterValues(selectedTestCase.id, normalizedCurrentValues);

            if (areTestCaseParameterValuesEqual(readStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey), normalizedCurrentValues)) {
              clearStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey);
            }
          },
          onError: (error) => {
            showError(error, "Unable to store test data values");
          }
        }
      );
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeTestCaseParameterSeedKey,
    isCreating,
    persistCaseParameterValues.isPending,
    selectedCaseParameterDraftScopeKey,
    selectedTestCase,
    testCaseParameterValues,
    testCasesQuery.isFetching,
    testCasesQuery.isLoading,
    updateTestCase.isPending
  ]);

  useEffect(() => {
    if (!selectedParameterSuiteId) {
      return;
    }

    const storedDraft = readStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey);
    const nextValues = Object.keys(storedDraft).length || hasStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey)
      ? storedDraft
      : normalizeSuiteParameterValues(selectedParameterSuite?.parameter_values);

    setSuiteParameterValues(nextValues);
  }, [selectedParameterSuite?.parameter_values, selectedParameterSuiteId, selectedSuiteParameterDraftScopeKey]);

  useEffect(() => {
    setRunPreviewParameterValues(readStoredRunParameterDraft(runPreviewParameterDraftScopeKey));
  }, [runPreviewParameterDraftScopeKey]);

  useEffect(() => {
    if (!selectedSuiteParameterDraftScopeKey || !selectedParameterSuiteId) {
      return;
    }

    writeStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey, suiteParameterValues);
  }, [selectedParameterSuiteId, selectedSuiteParameterDraftScopeKey, suiteParameterValues]);

  useEffect(() => {
    writeStoredRunParameterDraft(runPreviewParameterDraftScopeKey, runPreviewParameterValues);
  }, [runPreviewParameterDraftScopeKey, runPreviewParameterValues]);

  useEffect(() => {
    if (!selectedParameterSuite || updateSuite.isPending) {
      return;
    }

    const normalizedCurrentValues = normalizeSuiteParameterValues(suiteParameterValues);
    const normalizedSavedValues = normalizeSuiteParameterValues(selectedParameterSuite.parameter_values);

    if (areSuiteParameterValuesEqual(normalizedCurrentValues, normalizedSavedValues)) {
      clearStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      updateSuite.mutate(
        {
          id: selectedParameterSuite.id,
          input: {
            parameter_values: normalizedCurrentValues
          }
        },
        {
          onSuccess: () => {
            syncCachedSuiteParameterValues(selectedParameterSuite.id, normalizedCurrentValues);

            if (areSuiteParameterValuesEqual(readStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey), normalizedCurrentValues)) {
              clearStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey);
            }
          },
          onError: (error) => {
            showError(error, "Unable to store suite test data values");
          }
        }
      );
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [
    selectedParameterSuite,
    selectedSuiteParameterDraftScopeKey,
    suiteParameterValues,
    updateSuite,
    updateSuite.isPending
  ]);

  useEffect(() => {
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
    setSelectedStepIds([]);
    setExpandedStepIds([]);
    setExpandedStepGroupIds([]);
    setStepDrafts({});
    setEditingAutomationStepId("");
    setRephrasingStepId("");
    setCodePreviewState(null);
    setExpandedSections(isCreating ? createCreateModeTestCaseSections() : createDefaultTestCaseSections());
  }, [isCreating, selectedTestCaseId]);

  useEffect(() => {
    setExpandedStepIds((current) => {
      const validIds = current.filter((id) => displaySteps.some((step) => step.id === id));
      return validIds;
    });

    setExpandedStepGroupIds((current) => {
      const validGroupIds = new Set(displaySteps.map((step) => step.group_id).filter(Boolean));
      return current.filter((id) => validGroupIds.has(id));
    });

    setSelectedStepIds((current) => current.filter((id) => displaySteps.some((step) => step.id === id)));

    setStepDrafts((current) => {
      const next = { ...current };
      displaySteps.forEach((step) => {
        if (!next[step.id]) {
          next[step.id] = {
            action: step.action || "",
            expected_result: step.expected_result || "",
            step_type: normalizeStepType(step.step_type),
            automation_code: normalizeAutomationCode(step.automation_code),
            api_request: normalizeApiRequest(step.api_request)
          };
        }
      });
      Object.keys(next).forEach((stepId) => {
        if (!displaySteps.some((step) => step.id === stepId)) {
          delete next[stepId];
        }
      });
      return next;
    });
  }, [displaySteps]);

  useEffect(() => {
    if (!isImportModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsImportModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isImportModalOpen]);

  useEffect(() => {
    if (!isAiCaseAuthoringOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !previewCaseAuthoring.isPending && !updateTestCase.isPending) {
        setIsAiCaseAuthoringOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isAiCaseAuthoringOpen, previewCaseAuthoring.isPending, updateTestCase.isPending]);

  useEffect(() => {
    if (!isAiStudioOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !previewDesignedCases.isPending && !acceptDesignedCases.isPending && !createGenerationJob.isPending) {
        setIsAiStudioOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [acceptDesignedCases.isPending, createGenerationJob.isPending, isAiStudioOpen, previewDesignedCases.isPending]);

  const refreshCases = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["global-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["global-test-case-results", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["ai-test-case-generation-jobs", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-case-suites", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-suites"] }),
      queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] }),
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["design-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["design-suites", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-cases"] }),
      queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] })
    ]);
  };

  const refreshSharedGroups = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["shared-step-groups"] }),
      queryClient.invalidateQueries({ queryKey: ["shared-step-groups", appTypeId] })
    ]);
  };

  const generationJobSyncToken = useMemo(
    () =>
      generationJobs
        .map((job) => `${job.id}:${job.status}:${job.processed_requirements}:${job.generated_cases_count}`)
        .join("|"),
    [generationJobs]
  );
  const lastGenerationJobSyncTokenRef = useRef("");

  useEffect(() => {
    if (!appTypeId) {
      lastGenerationJobSyncTokenRef.current = "";
      return;
    }

    if (!generationJobSyncToken) {
      lastGenerationJobSyncTokenRef.current = "";
      return;
    }

    if (!lastGenerationJobSyncTokenRef.current) {
      lastGenerationJobSyncTokenRef.current = generationJobSyncToken;
      return;
    }

    if (lastGenerationJobSyncTokenRef.current === generationJobSyncToken) {
      return;
    }

    lastGenerationJobSyncTokenRef.current = generationJobSyncToken;

    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["global-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] })
    ]);
  }, [appTypeId, generationJobSyncToken, projectId, queryClient]);

  useEffect(() => {
    if (!appTypeId) {
      generationJobAlertScopeRef.current = "";
      surfacedGenerationJobFailureIdsRef.current = new Set();
      return;
    }

    if (!generationJobsQuery.isFetched) {
      return;
    }

    if (generationJobAlertScopeRef.current !== appTypeId) {
      generationJobAlertScopeRef.current = appTypeId;
      surfacedGenerationJobFailureIdsRef.current = new Set(
        generationJobs.filter((job) => job.status === "failed").map((job) => job.id)
      );
      return;
    }

    const latestUnsurfacedFailure = generationJobs.find(
      (job) => job.status === "failed" && !surfacedGenerationJobFailureIdsRef.current.has(job.id)
    );

    if (!latestUnsurfacedFailure) {
      return;
    }

    surfacedGenerationJobFailureIdsRef.current = new Set(surfacedGenerationJobFailureIdsRef.current).add(latestUnsurfacedFailure.id);
    setMessageTone("error");
    setMessage(latestUnsurfacedFailure.error || "One or more queued AI generations failed.");
  }, [appTypeId, generationJobs, generationJobsQuery.isFetched]);

  const resolveStepInsertIndex = (items: Array<{ id: string }>) => {
    if (stepInsertIndex !== null) {
      return Math.max(0, Math.min(stepInsertIndex, items.length));
    }

    if (!selectedStepIds.length) {
      return items.length;
    }

    const selectedIndexSet = new Set(selectedStepIds);
    let lastSelectedIndex = -1;

    items.forEach((step, index) => {
      if (selectedIndexSet.has(step.id)) {
        lastSelectedIndex = index;
      }
    });

    return lastSelectedIndex >= 0 ? lastSelectedIndex + 1 : items.length;
  };

  const isContinuousStepSelection = (items: Array<{ id: string; step_order: number }>, stepIds: string[]) => {
    if (!stepIds.length) {
      return false;
    }

    const selected = items
      .filter((step) => stepIds.includes(step.id))
      .slice()
      .sort((left, right) => left.step_order - right.step_order);

    if (!selected.length) {
      return false;
    }

    return selected.every((step, index) => index === 0 || step.step_order === selected[index - 1].step_order + 1);
  };

  const getInsertionGroupContext = (
    items: Array<Pick<TestStep, "group_id" | "group_name" | "group_kind" | "reusable_group_id">>,
    insertionIndex: number
  ) => {
    const previousStep = items[insertionIndex - 1];
    const nextStep = items[insertionIndex];

    if (!previousStep?.group_id || previousStep.group_id !== nextStep?.group_id) {
      return null;
    }

    return {
      group_id: previousStep.group_id || null,
      group_name: previousStep.group_name || null,
      group_kind: previousStep.group_kind || null,
      reusable_group_id: previousStep.reusable_group_id || null
    };
  };

  const getOrCreateSharedGroupRecord = async (
    name: string,
    selectedSteps: Array<Pick<TestStep, "action" | "expected_result" | "step_type" | "automation_code" | "api_request">>
  ) => {
    if (!appTypeId) {
      throw new Error("Select an app type before creating a shared group.");
    }

    const matchingGroup = sharedStepGroups.find((group) => {
      if (normalizeSharedGroupComparableText(group.name) !== normalizeSharedGroupComparableText(name)) {
        return false;
      }

      if ((group.steps || []).length !== selectedSteps.length) {
        return false;
      }

      return group.steps.every((step, index) => {
        const candidate = selectedSteps[index];
        return (
          normalizeSharedGroupComparableText(step.action) === normalizeSharedGroupComparableText(candidate?.action) &&
          normalizeSharedGroupComparableText(step.expected_result) === normalizeSharedGroupComparableText(candidate?.expected_result) &&
          areComparableStepAutomationEqual(step, {
            step_type: candidate?.step_type,
            automation_code: candidate?.automation_code,
            api_request: candidate?.api_request
          })
        );
      });
    });

    if (matchingGroup) {
      return matchingGroup.id;
    }

    const response = await createSharedStepGroup.mutateAsync({
      app_type_id: appTypeId,
      name,
      steps: selectedSteps.map((step, index) => ({
        step_order: index + 1,
        action: step.action || undefined,
        expected_result: step.expected_result || undefined,
        step_type: normalizeStepType(step.step_type),
        automation_code: normalizeAutomationCode(step.automation_code) || undefined,
        api_request: normalizeApiRequest(step.api_request) || undefined
      }))
    });

    const createdGroup = await api.sharedStepGroups.get(response.id);
    upsertSharedStepGroupInCache(queryClient, appTypeId, createdGroup);

    return createdGroup.id;
  };

  const hasUnsavedStepGroupDrafts = (groupItems: TestStep[]) =>
    !isCreating &&
    groupItems.some((step) => {
      const draft = stepDrafts[step.id];

      if (!draft) {
        return false;
      }

      return (
        (draft.action || "").trim() !== (step.action || "").trim() ||
        (draft.expected_result || "").trim() !== (step.expected_result || "").trim() ||
        !areComparableStepAutomationEqual(draft, step)
      );
    });

  const handleConvertStepGroup = async (
    groupId: string,
    groupName: string,
    groupItems: TestStep[],
    targetKind: "local" | "reusable"
  ) => {
    if (!groupItems.length) {
      return;
    }

    if (hasUnsavedStepGroupDrafts(groupItems)) {
      showError(
        new Error("Save or discard the inline edits inside this group before changing how it is linked."),
        targetKind === "reusable" ? "Unable to convert to shared group" : "Unable to convert to local group"
      );
      return;
    }

    const resolvedName = groupName.trim() || groupItems[0]?.group_name?.trim() || "Step group";

    try {
      const reusableGroupId =
        targetKind === "reusable"
          ? await getOrCreateSharedGroupRecord(
              resolvedName,
              groupItems.map((step) => ({
                action: step.action,
                expected_result: step.expected_result,
                step_type: step.step_type,
                automation_code: step.automation_code,
                api_request: step.api_request
              }))
            )
          : null;

      if (isCreating) {
        setDraftSteps((current) =>
          current.map((step) =>
            step.group_id === groupId
              ? {
                  ...step,
                  group_name: resolvedName,
                  group_kind: targetKind,
                  reusable_group_id: reusableGroupId
                }
              : step
          )
        );
      } else if (selectedTestCaseId) {
        const response = await groupSteps.mutateAsync({
          test_case_id: selectedTestCaseId,
          step_ids: groupItems.map((step) => step.id),
          name: resolvedName,
          kind: targetKind,
          group_id: groupId,
          reusable_group_id: reusableGroupId || undefined
        });
        setExpandedStepGroupIds((current) =>
          current.includes(groupId) ? [...current.filter((id) => id !== groupId), response.group_id] : current
        );
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      }

      if (targetKind === "reusable" || groupItems.some((step) => step.reusable_group_id)) {
        await refreshSharedGroups();
      }

      showSuccess(
        targetKind === "reusable"
          ? `Converted "${resolvedName}" to a shared group.`
          : `Converted "${resolvedName}" to a local step group.`
      );
    } catch (error) {
      showError(error, targetKind === "reusable" ? "Unable to convert to shared group" : "Unable to convert to local group");
    }
  };

  const activateStepInsert = (index: number, groupContext: StepInsertionGroupContext | null = null) => {
    setStepInsertIndex(index);
    setStepInsertGroupContext(groupContext);
    setNewStepDraft(EMPTY_STEP_DRAFT);
  };

  const cancelStepInsert = () => {
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
    setNewStepDraft(EMPTY_STEP_DRAFT);
  };

  const clearStepSelectionIfClipboardActive = () => {
    if (copiedSteps.length || cutStepSource?.stepIds.length) {
      setSelectedStepIds([]);
    }
  };

  const handleSaveCaseDirect = async () => {
    try {
      if (isCreating) {
        const response = await createTestCase.mutateAsync({
          app_type_id: appTypeId,
          suite_ids: createSuiteContextId ? [createSuiteContextId] : [],
          title: caseDraft.title,
          description: caseDraft.description || undefined,
          external_references: parseReferenceList(caseDraft.externalReferencesText),
          parameter_values: testCaseParameterValues,
          automated: caseDraft.automated,
          priority: Number(caseDraft.priority),
          status: caseDraft.status,
          requirement_ids: caseDraft.requirement_id ? [caseDraft.requirement_id] : [],
          steps: normalizeDraftSteps(draftSteps)
        });

        clearStoredTestCaseParameterDraft(createCaseParameterDraftScopeKey);
        syncTestCaseSearchParams(response.id);
        setCreateSuiteContextId("");
        setSelectedTestCaseId(response.id);
        setIsCreating(false);
        setDraftSteps([]);
        setSelectedStepIds([]);
        setStepInsertIndex(null);
        setStepInsertGroupContext(null);
        showSuccess("Test case created with its draft steps.");
      } else if (selectedTestCase) {
        await updateTestCase.mutateAsync({
          id: selectedTestCase.id,
          input: {
            app_type_id: appTypeId,
            title: caseDraft.title,
            description: caseDraft.description,
            external_references: parseReferenceList(caseDraft.externalReferencesText),
            parameter_values: testCaseParameterValues,
            automated: caseDraft.automated,
            priority: Number(caseDraft.priority),
            status: caseDraft.status,
            requirement_ids: caseDraft.requirement_id ? [caseDraft.requirement_id] : []
          }
        });

        syncCachedTestCaseParameterValues(selectedTestCase.id, testCaseParameterValues);
        clearStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey);
        clearStepSelectionIfClipboardActive();
        showSuccess("Test case updated.");
      }

      await refreshCases();
    } catch (error) {
      showError(error, "Unable to save test case");
    }
  };

  const handleSaveCase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await handleSaveCaseDirect();
  };

  const handleDeleteCase = async () => {
    if (!selectedTestCase || !(await confirmDelete({ message: `Delete test case "${selectedTestCase.title}"? Historical run evidence will stay preserved.` }))) {
      return;
    }

    try {
      await deleteTestCase.mutateAsync(selectedTestCase.id);
      clearStoredTestCaseParameterDraft(buildTestCaseParameterDraftScopeKey({ isCreating: false, testCaseId: selectedTestCase.id }));
      setSelectedActionTestCaseIds((current) => current.filter((id) => id !== selectedTestCase.id));
      syncTestCaseSearchParams(null);
      setSelectedTestCaseId("");
      setCaseDraft(emptyCaseDraft);
      setIsCreating(false);
      setSelectedStepIds([]);
      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      showSuccess("Test case deleted. Run snapshots remain available.");
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to delete test case");
    }
  };

  const handleDeleteSelectedCases = async () => {
    const selectedCases = testCases.filter((item) => selectedActionTestCaseIds.includes(item.id));

    if (!selectedCases.length) {
      return;
    }

    const confirmed = await confirmDelete({
      message: `Delete ${selectedCases.length} test case${selectedCases.length === 1 ? "" : "s"}? Historical execution evidence will stay preserved.`
    });

    if (!confirmed) {
      return;
    }

    setIsDeletingSelectedTestCases(true);

    try {
      const results = await Promise.allSettled(selectedCases.map((testCase) => api.testCases.delete(testCase.id)));
      const deletedIds = selectedCases
        .filter((_, index) => results[index]?.status === "fulfilled")
        .map((testCase) => testCase.id);
      const failedResults = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

      deletedIds.forEach((testCaseId) => {
        clearStoredTestCaseParameterDraft(buildTestCaseParameterDraftScopeKey({ isCreating: false, testCaseId }));
      });
      setSelectedActionTestCaseIds((current) => current.filter((id) => !deletedIds.includes(id)));

      if (deletedIds.includes(selectedTestCaseId)) {
        syncTestCaseSearchParams(null);
        setSelectedTestCaseId("");
        setCaseDraft(emptyCaseDraft);
        setDraftSteps([]);
        setNewStepDraft(EMPTY_STEP_DRAFT);
        setStepInsertIndex(null);
        setStepInsertGroupContext(null);
        setSelectedStepIds([]);
        setExpandedStepIds([]);
        setExpandedStepGroupIds([]);
        setIsCreating(false);
      }

      if (deletedIds.length) {
        await refreshCases();
      }

      if (!failedResults.length) {
        showSuccess(`${deletedIds.length} test case${deletedIds.length === 1 ? "" : "s"} deleted. Run history remains preserved.`);
        return;
      }

      const firstError = failedResults[0]?.reason;
      setMessageTone("error");
      setMessage(
        `${deletedIds.length} test case${deletedIds.length === 1 ? "" : "s"} deleted, ${failedResults.length} failed.${firstError instanceof Error ? ` ${firstError.message}` : ""}`
      );
    } finally {
      setIsDeletingSelectedTestCases(false);
    }
  };

  const handleOpenSuiteLinkModal = () => {
    if (!selectedTestCase) {
      return;
    }

    setSuiteLinkDraftIds(selectedCaseSuiteIdsForModal);
    setIsSuiteLinkModalOpen(true);
  };

  const handleSaveSuiteLinks = async () => {
    if (!selectedTestCase) {
      return;
    }

    const nextSuiteIds = Array.from(new Set(suiteLinkDraftIds.filter(Boolean)));
    const currentSuiteIds = Array.from(new Set(selectedCaseSuiteIdsForModal.filter(Boolean)));

    if (
      nextSuiteIds.length === currentSuiteIds.length &&
      nextSuiteIds.every((suiteId) => currentSuiteIds.includes(suiteId))
    ) {
      setIsSuiteLinkModalOpen(false);
      setSuiteLinkDraftIds([]);
      return;
    }

    try {
      await updateTestCase.mutateAsync({
        id: selectedTestCase.id,
        input: {
          suite_ids: nextSuiteIds
        }
      });

      syncCachedTestCaseSuiteIds(selectedTestCase.id, nextSuiteIds);
      setIsSuiteLinkModalOpen(false);
      setSuiteLinkDraftIds([]);
      showSuccess(
        nextSuiteIds.length
          ? `Updated suite references for "${selectedTestCase.title}".`
          : `Removed all suite references from "${selectedTestCase.title}".`
      );
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to update suite references");
    }
  };

  const handleCreateSuite = async (input: { name: string; parent_id?: string; selectedIds: string[] }) => {
    if (!appTypeId) {
      setMessageTone("error");
      setMessage("Select an app type before creating a suite.");
      return;
    }

    try {
      const response = await createSuite.mutateAsync({
        app_type_id: appTypeId,
        name: input.name,
        parent_id: input.parent_id || undefined
      });

      if (input.selectedIds.length) {
        await assignSuiteCases.mutateAsync({
          id: response.id,
          testCaseIds: input.selectedIds
        });
      }

      setIsCreateSuiteModalOpen(false);
      setSelectedActionTestCaseIds([]);
      showSuccess(input.selectedIds.length ? "Suite created and linked to the selected test cases." : "Suite created.");
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to create suite");
    }
  };

  const handleCreateExecution = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!session?.user.id) {
      setMessageTone("error");
      setMessage("You need an active session before creating a run.");
      return;
    }

    if (!projectId || !appTypeId || !selectedActionTestCaseIds.length) {
      setMessageTone("error");
      setMessage("Select one or more test cases before creating a run.");
      return;
    }

    try {
      const response = await createExecution.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId,
        test_case_ids: selectedActionTestCaseIds,
        test_environment_id: selectedExecutionEnvironmentId || undefined,
        test_configuration_id: selectedExecutionConfigurationId || undefined,
        test_data_set_id: selectedExecutionDataSetId || undefined,
        assigned_to: selectedExecutionAssigneeId || undefined,
        name: executionName.trim() || undefined,
        created_by: session.user.id
      });

      closeCreateExecutionModal();
      setSelectedActionTestCaseIds([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["executions"] }),
        queryClient.invalidateQueries({ queryKey: ["executions", projectId] })
      ]);
      navigate(`/executions?view=test-case-runs&execution=${response.id}`);
    } catch (error) {
      showError(error, "Unable to create run");
    }
  };

  const handleBuildSelectedAutomation = async () => {
    if (!appTypeId || !automationTargetCaseIds.length) {
      showError(new Error("Select one or more test cases before building automation."), "Unable to build automation");
      return;
    }

    try {
      if (automationTargetCaseIds.length === 1) {
        const response = await buildSingleAutomation.mutateAsync({ testCaseId: automationTargetCaseIds[0] });
        showSuccess(`Automation generator queued as ${response.transaction_id.slice(0, 8)}. Track it in TestOps.`);
      } else {
        const response = await buildBatchAutomation.mutateAsync({ testCaseIds: automationTargetCaseIds });
        showSuccess(`Batch AI automation queued as ${response.transaction_id}. Track it in TestOps.`);
      }

      await refreshCases();
    } catch (error) {
      showError(error, "Unable to build automation");
    }
  };

  const handleScheduleSelectedManualAutomation = async () => {
    if (!appTypeId || !selectedManualAutomationCases.length) {
      showError(new Error("Select one or more manual test cases before scheduling AI automation."), "Unable to schedule AI automation");
      return;
    }

    try {
      const response = await buildBatchAutomation.mutateAsync({
        testCaseIds: selectedManualAutomationCases.map((testCase) => testCase.id)
      });
      showSuccess(`Batch AI automation scheduled as ${response.transaction_id.slice(0, 8)}. TestOps will process the manual cases one by one.`);
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to schedule AI automation");
    }
  };

  const handleStartRecorder = async (options: RecorderStartOptions) => {
    if (!selectedTestCase) {
      showError(new Error("Select a saved test case before starting the recorder."), "Unable to start recorder");
      return;
    }

    if (!testEngineIntegration) {
      showError(new Error("Configure an active Test Engine integration before starting the recorder."), "Unable to start recorder");
      return;
    }

    try {
      const response = await startRecorder.mutateAsync({ testCaseId: selectedTestCase.id, options });
      setRecorderSession(response);
      setRecorderSessionCaseId(selectedTestCase.id);
      setRecorderStartOptions(options);
      showSuccess(response.live_view_url ? "Recorder live view is ready in QAira." : "Recorder started in the Test Engine browser session.");
    } catch (error) {
      showError(error, "Unable to start recorder");
    }
  };

  const handleFinishRecorder = async () => {
    if (!recorderSession?.id || !recorderSessionCaseId) {
      showError(new Error("Start a recorder session before finishing it."), "Unable to finish recorder session");
      return;
    }

    try {
      const response = await finishRecorder.mutateAsync({
        testCaseId: recorderSessionCaseId,
        sessionId: recorderSession.id,
        recorderStartOptions,
        transactionId: recorderSession.transaction_id
      });
      setRecorderSession(null);
      setRecorderSessionCaseId("");
      showSuccess(
        response.generated_step_count
          ? `Recorder stopped. Created ${response.created_step_count || 0} and updated ${response.updated_step_count || 0} web step${response.generated_step_count === 1 ? "" : "s"}.`
          : "Recorder stopped. No supported interactions were captured for step creation."
      );
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to finish recorder session");
    }
  };

  const openExecutionHistoryResult = (result: ExecutionResult) => {
    const params = new URLSearchParams({
      execution: result.execution_id,
      testCase: result.test_case_id
    });

    navigate(`/executions?${params.toString()}`);
  };

  const handleCreateStep = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedDraft = {
      action: newStepDraft.action.trim(),
      expected_result: newStepDraft.expected_result.trim(),
      step_type: normalizeStepType(newStepDraft.step_type),
      automation_code: normalizeAutomationCode(newStepDraft.automation_code),
      api_request: normalizeApiRequest(newStepDraft.api_request)
    };

    if (!normalizedDraft.action && !normalizedDraft.expected_result) {
      setMessageTone("error");
      setMessage("Add an action or expected result before creating a step.");
      return;
    }

    if (isCreating) {
      const draftId = createDraftStepId();
      const insertionIndex = resolveStepInsertIndex(draftSteps);
      const insertionGroupContext =
        stepInsertIndex !== null && stepInsertGroupContext
          ? stepInsertGroupContext
          : getInsertionGroupContext(displaySteps, insertionIndex);

      setDraftSteps((current) => {
        const next = [...current];
        next.splice(insertionIndex, 0, {
          id: draftId,
          ...normalizedDraft,
          group_id: insertionGroupContext?.group_id || null,
          group_name: insertionGroupContext?.group_name || null,
          group_kind: insertionGroupContext?.group_kind || null,
          reusable_group_id: insertionGroupContext?.reusable_group_id || null
        });
        return next;
      });
      setExpandedStepIds((current) => [...new Set([...current, draftId])]);
      setNewStepDraft(EMPTY_STEP_DRAFT);
      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      showSuccess("Draft step added to the new test case.");
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      const insertionIndex = resolveStepInsertIndex(steps);
      const insertionGroupContext =
        stepInsertIndex !== null && stepInsertGroupContext
          ? stepInsertGroupContext
          : getInsertionGroupContext(displaySteps, insertionIndex);
      const nextStepOrder = insertionIndex + 1;
      const response = await createStep.mutateAsync({
        test_case_id: selectedTestCaseId,
        step_order: nextStepOrder,
        action: normalizedDraft.action || undefined,
        expected_result: normalizedDraft.expected_result || undefined,
        step_type: normalizedDraft.step_type,
        automation_code: normalizedDraft.automation_code || undefined,
        api_request: normalizedDraft.api_request || undefined,
        group_id: insertionGroupContext?.group_id || undefined,
        group_name: insertionGroupContext?.group_name || undefined,
        group_kind: insertionGroupContext?.group_kind || undefined,
        reusable_group_id: insertionGroupContext?.reusable_group_id || undefined
      });
      setNewStepDraft(EMPTY_STEP_DRAFT);
      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      setExpandedStepIds((current) => [...new Set([...current, response.id])]);
      showSuccess("Step added.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (insertionGroupContext?.reusable_group_id) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to add step");
    }
  };

  useEffect(() => {
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
  }, [isCreating, selectedTestCaseId]);

  const handleUpdateStep = async (step: TestStep, input: StepDraft) => {
    try {
      await updateStep.mutateAsync({
        id: step.id,
        input: {
          action: input.action,
          expected_result: input.expected_result,
          step_type: normalizeStepType(input.step_type),
          automation_code: normalizeAutomationCode(input.automation_code),
          api_request: normalizeApiRequest(input.api_request) || {}
        }
      });
      setStepDrafts((current) => ({
        ...current,
        [step.id]: {
          action: input.action,
          expected_result: input.expected_result,
          step_type: normalizeStepType(input.step_type),
          automation_code: normalizeAutomationCode(input.automation_code),
          api_request: normalizeApiRequest(input.api_request)
        }
      }));
      showSuccess("Step updated.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (step.reusable_group_id) {
        await refreshSharedGroups();
      }
      clearStepSelectionIfClipboardActive();
    } catch (error) {
      showError(error, "Unable to update step");
    }
  };

  const handleSaveMultipleSteps = async (stepIds: string[], label: string) => {
    const targets = stepIds.filter(Boolean);

    if (!targets.length) {
      showError(new Error("Select one or more steps to save."), "Unable to save steps");
      return;
    }

    try {
      const resolvedSteps = targets
        .map((id) => displaySteps.find((step) => step.id === id))
        .filter((step): step is TestStep => Boolean(step));

      for (const step of resolvedSteps) {
        const draft = stepDrafts[step.id] || {
          action: step.action || "",
          expected_result: step.expected_result || "",
          step_type: normalizeStepType(step.step_type),
          automation_code: normalizeAutomationCode(step.automation_code),
          api_request: normalizeApiRequest(step.api_request)
        };
        await updateStep.mutateAsync({
          id: step.id,
          input: {
            action: draft.action,
            expected_result: draft.expected_result,
            step_type: normalizeStepType(draft.step_type),
            automation_code: normalizeAutomationCode(draft.automation_code),
            api_request: normalizeApiRequest(draft.api_request) || {}
          }
        });
      }

      showSuccess(`${label} saved.`);
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (resolvedSteps.some((step) => step.reusable_group_id)) {
        await refreshSharedGroups();
      }
      clearStepSelectionIfClipboardActive();
    } catch (error) {
      showError(error, "Unable to save steps");
    }
  };

  const handleReorderStep = async (stepId: string, direction: "up" | "down") => {
    if (!selectedTestCaseId) {
      return;
    }

    const currentIndex = steps.findIndex((step) => step.id === stepId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= steps.length) {
      return;
    }

    const currentStep = steps[currentIndex];
    const targetStep = steps[targetIndex];

    let reordered: TestStep[] = [];

    if (currentStep.group_id) {
      if (targetStep.group_id !== currentStep.group_id) {
        return;
      }

      reordered = [...steps];
      const [movedStep] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, movedStep);
    } else {
      const blocks = buildStepBlocks(steps);
      const blockIndex = blocks.findIndex((block) => block.steps.some((step) => step.id === stepId));
      const swapIndex = direction === "up" ? blockIndex - 1 : blockIndex + 1;

      if (blockIndex === -1 || swapIndex < 0 || swapIndex >= blocks.length) {
        return;
      }

      const reorderedBlocks = [...blocks];
      const [movedBlock] = reorderedBlocks.splice(blockIndex, 1);
      reorderedBlocks.splice(swapIndex, 0, movedBlock);
      const newOrderIds = reorderedBlocks.flatMap((block) => block.steps.map((step) => step.id));
      const stepById = new Map(steps.map((step) => [step.id, step]));
      reordered = newOrderIds.map((id) => stepById.get(id)).filter(Boolean) as TestStep[];
    }

    try {
      await reorderSteps.mutateAsync({
        testCaseId: selectedTestCaseId,
        stepIds: reordered.map((step) => step.id)
      });
      showSuccess("Step order updated.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (currentStep.reusable_group_id) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to reorder steps");
    }
  };

  const handleMoveStepGroup = async (groupId: string, direction: "up" | "down") => {
    if (!groupId) {
      return;
    }

    const items = displaySteps;
    const blocks = buildStepBlocks(items);
    const blockIndex = blocks.findIndex((block) => block.group_id === groupId);
    const swapIndex = direction === "up" ? blockIndex - 1 : blockIndex + 1;

    if (blockIndex === -1 || swapIndex < 0 || swapIndex >= blocks.length) {
      return;
    }

    const reorderedBlocks = [...blocks];
    const [movedBlock] = reorderedBlocks.splice(blockIndex, 1);
    reorderedBlocks.splice(swapIndex, 0, movedBlock);
    const newOrderIds = reorderedBlocks.flatMap((block) => block.steps.map((step) => step.id));

    if (isCreating) {
      setDraftSteps((current) => {
        const stepById = new Map(current.map((step) => [step.id, step]));
        return newOrderIds.map((id) => stepById.get(id)).filter(Boolean) as DraftTestStep[];
      });
      showSuccess("Step group order updated.");
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      await reorderSteps.mutateAsync({
        testCaseId: selectedTestCaseId,
        stepIds: newOrderIds
      });
      showSuccess("Step group order updated.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      showError(error, "Unable to move step group");
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    const targetStep = displaySteps.find((step) => step.id === stepId) || null;

    if (isCreating) {
      setDraftSteps((current) => current.filter((step) => step.id !== stepId));
      if (copiedSteps.length || cutStepSource?.stepIds.length) {
        setSelectedStepIds([]);
      } else {
        setSelectedStepIds((current) => current.filter((id) => id !== stepId));
      }
      setExpandedStepIds((current) => current.filter((id) => id !== stepId));
      showSuccess("Draft step removed.");
      return;
    }

    if (!(await confirmDelete({ message: "Delete this step?" }))) {
      return;
    }

    try {
      await deleteStep.mutateAsync(stepId);
      if (copiedSteps.length || cutStepSource?.stepIds.length) {
        setSelectedStepIds([]);
      } else {
        setSelectedStepIds((current) => current.filter((id) => id !== stepId));
      }
      setExpandedStepIds((current) => current.filter((id) => id !== stepId));
      showSuccess("Step deleted.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (targetStep?.reusable_group_id) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to delete step");
    }
  };

  const handleDeleteSelectedSteps = async () => {
    const targetIds = selectedStepIds.filter((id) => displaySteps.some((step) => step.id === id));

    if (!targetIds.length) {
      showError(new Error("Select one or more steps to delete."), "Unable to delete selected steps");
      return;
    }

    const countLabel = `${targetIds.length} selected step${targetIds.length === 1 ? "" : "s"}`;

    if (!(await confirmDelete({ message: `Delete ${countLabel}?` }))) {
      return;
    }

    if (isCreating) {
      setDraftSteps((current) => current.filter((step) => !targetIds.includes(step.id)));
      setSelectedStepIds([]);
      setExpandedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      cancelStepInsert();
      showSuccess(`${countLabel} deleted.`);
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      const targetSteps = displaySteps.filter((step) => targetIds.includes(step.id));

      for (const stepId of targetIds) {
        await deleteStep.mutateAsync(stepId);
      }

      setSelectedStepIds([]);
      setExpandedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      cancelStepInsert();
      showSuccess(`${countLabel} deleted.`);
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (targetSteps.some((step) => step.reusable_group_id)) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to delete selected steps");
    }
  };

  const handleUpdateDraftStep = (stepId: string, input: StepDraft) => {
    setDraftSteps((current) =>
      current.map((step) =>
        step.id === stepId
          ? {
              ...step,
              action: input.action,
              expected_result: input.expected_result,
              step_type: normalizeStepType(input.step_type),
              automation_code: normalizeAutomationCode(input.automation_code),
              api_request: normalizeApiRequest(input.api_request)
            }
          : step
      )
    );
  };

  const handleRephraseStepWithAi = async (step: TestStep) => {
    if (!appTypeId) {
      showError(new Error("Select an app type before asking AI to rephrase a step."), "Unable to rephrase step");
      return;
    }

    const currentDraft = stepDrafts[step.id] || {
      action: step.action || "",
      expected_result: step.expected_result || "",
      step_type: normalizeStepType(step.step_type),
      automation_code: normalizeAutomationCode(step.automation_code),
      api_request: normalizeApiRequest(step.api_request)
    };

    if (!currentDraft.action.trim() && !currentDraft.expected_result.trim()) {
      showError(new Error("Write an action or expected result before asking AI to rephrase this step."), "Unable to rephrase step");
      return;
    }

    setRephrasingStepId(step.id);

    try {
      const response = await rephraseStepWithAi.mutateAsync({
        app_type_id: appTypeId,
        requirement_id: caseDraft.requirement_id || undefined,
        integration_id: integrationId || undefined,
        test_case: {
          title: caseDraft.title || selectedTestCase?.title || "",
          description: caseDraft.description || selectedTestCase?.description || "",
          parameter_values: testCaseParameterValues
        },
        step: {
          step_order: step.step_order,
          step_type: normalizeStepType(currentDraft.step_type || step.step_type),
          action: currentDraft.action,
          expected_result: currentDraft.expected_result
        }
      });
      const nextDraft: StepDraft = {
        ...currentDraft,
        action: response.step.action || "",
        expected_result: response.step.expected_result || "",
        step_type: normalizeStepType(response.step.step_type || currentDraft.step_type)
      };

      if (isCreating) {
        handleUpdateDraftStep(step.id, nextDraft);
      } else {
        await updateStep.mutateAsync({
          id: step.id,
          input: {
            action: nextDraft.action,
            expected_result: nextDraft.expected_result,
            step_type: nextDraft.step_type
          }
        });
        setStepDrafts((current) => ({
          ...current,
          [step.id]: nextDraft
        }));
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
        if (step.reusable_group_id) {
          await refreshSharedGroups();
        }
      }

      showSuccess(`Step ${step.step_order} rephrased with AI.`);
    } catch (error) {
      showError(error, "Unable to rephrase step");
    } finally {
      setRephrasingStepId("");
    }
  };

  const buildStepBlocks = <T extends { id: string; group_id?: string | null }>(items: T[]) =>
    items.reduce<Array<{ group_id: string | null; steps: T[] }>>((blocks, step) => {
      const previousBlock = blocks[blocks.length - 1];

      const resolvedGroupId = step.group_id ?? null;

      if (resolvedGroupId && previousBlock?.group_id === resolvedGroupId) {
        previousBlock.steps.push(step);
        return blocks;
      }

      blocks.push({
        group_id: resolvedGroupId,
        steps: [step]
      });

      return blocks;
    }, []);

  const handleReorderDraftStep = (stepId: string, direction: "up" | "down") => {
    setDraftSteps((current) => {
      const currentIndex = current.findIndex((step) => step.id === stepId);
      const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

      if (currentIndex === -1 || targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const currentStep = current[currentIndex];
      const targetStep = current[targetIndex];

      if (currentStep.group_id) {
        if (targetStep.group_id !== currentStep.group_id) {
          return current;
        }

        const reordered = [...current];
        const [movedStep] = reordered.splice(currentIndex, 1);
        reordered.splice(targetIndex, 0, movedStep);
        return reordered;
      }

      const blocks = buildStepBlocks(current);
      const blockIndex = blocks.findIndex((block) => block.steps.some((step) => step.id === stepId));
      const swapIndex = direction === "up" ? blockIndex - 1 : blockIndex + 1;

      if (blockIndex === -1 || swapIndex < 0 || swapIndex >= blocks.length) {
        return current;
      }

      const reorderedBlocks = [...blocks];
      const [movedBlock] = reorderedBlocks.splice(blockIndex, 1);
      reorderedBlocks.splice(swapIndex, 0, movedBlock);
      const newOrderIds = reorderedBlocks.flatMap((block) => block.steps.map((step) => step.id));
      const stepById = new Map(current.map((step) => [step.id, step]));

      return newOrderIds.map((id) => stepById.get(id)).filter(Boolean) as DraftTestStep[];
    });
    showSuccess("Draft step order updated.");
  };

  const handleCopySteps = (stepIds?: string[]) => {
    const targetIds = (stepIds && stepIds.length ? stepIds : selectedStepIds).filter(Boolean);

    if (!targetIds.length) {
      showError(new Error("Select one or more steps to copy."), "Unable to copy steps");
      return;
    }

    const orderedSelection = displaySteps.filter((step) => targetIds.includes(step.id));

    if (!orderedSelection.length) {
      return;
    }

    setCopiedSteps(normalizeCopiedSteps(orderedSelection, "copy"));
    setCopiedStepMode("copy");
    setCutStepSource(null);
    showSuccess(`${orderedSelection.length} step${orderedSelection.length === 1 ? "" : "s"} copied. Use paste to insert them where you want.`);
  };

  const handleCutSteps = (stepIds?: string[]) => {
    const targetIds = (stepIds && stepIds.length ? stepIds : selectedStepIds).filter(Boolean);

    if (!targetIds.length) {
      showError(new Error("Select one or more steps to cut."), "Unable to cut steps");
      return;
    }

    const orderedSelection = displaySteps.filter((step) => targetIds.includes(step.id));

    if (!orderedSelection.length) {
      return;
    }

    setCopiedSteps(normalizeCopiedSteps(orderedSelection, "cut"));
    setCopiedStepMode("cut");
    setCutStepSource({
      stepIds: orderedSelection.map((step) => step.id),
      testCaseId: isCreating ? null : selectedTestCaseId,
      isDraft: isCreating
    });
    showSuccess(`${orderedSelection.length} step${orderedSelection.length === 1 ? "" : "s"} cut. Paste to move ${orderedSelection.length === 1 ? "it" : "them"} into place.`);
  };

  const handlePasteSteps = async (targetIndex?: number, groupContext?: StepInsertionGroupContext | null) => {
    if (!copiedSteps.length) {
      showError(new Error("Copy one or more steps before pasting."), "Unable to paste steps");
      return;
    }

    const materialized = materializeCopiedSteps(copiedSteps);
    const insertionIndex = targetIndex ?? resolveStepInsertIndex(displaySteps);
    const insertionGroupContext = groupContext || getInsertionGroupContext(displaySteps, insertionIndex);
    const stepsToPaste =
      insertionGroupContext && materialized.every((step) => !step.group_id)
        ? materialized.map((step) => ({
            ...step,
            group_id: insertionGroupContext.group_id,
            group_name: insertionGroupContext.group_name,
            group_kind: insertionGroupContext.group_kind,
            reusable_group_id: insertionGroupContext.reusable_group_id
          }))
        : materialized;

    try {
      if (isCreating) {
        const pastedDraftSteps = stepsToPaste.map((step) => ({
          ...step,
          id: createDraftStepId()
        }));

        setDraftSteps((current) => {
          const next = [...current];
          next.splice(insertionIndex, 0, ...pastedDraftSteps);
          return next;
        });
        setExpandedStepIds((current) => [...new Set([...current, ...pastedDraftSteps.map((step) => step.id)])]);
      } else if (selectedTestCaseId) {
        const createdStepIds: string[] = [];

        for (const [offset, step] of stepsToPaste.entries()) {
          const response = await createStep.mutateAsync({
            test_case_id: selectedTestCaseId,
            step_order: insertionIndex + offset + 1,
            action: step.action || undefined,
            expected_result: step.expected_result || undefined,
            step_type: normalizeStepType(step.step_type),
            automation_code: normalizeAutomationCode(step.automation_code) || undefined,
            api_request: normalizeApiRequest(step.api_request) || undefined,
            group_id: step.group_id || undefined,
            group_name: step.group_name || undefined,
            group_kind: step.group_kind || undefined,
            reusable_group_id: step.reusable_group_id || undefined
          });
          createdStepIds.push(response.id);
        }

        setExpandedStepIds((current) => [...new Set([...current, ...createdStepIds])]);
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      }

      if (copiedStepMode === "cut" && cutStepSource?.stepIds.length) {
        if (cutStepSource.isDraft) {
          setDraftSteps((current) => current.filter((step) => !cutStepSource.stepIds.includes(step.id)));
        } else {
          const cutSourceSteps = displaySteps.filter((step) => cutStepSource.stepIds.includes(step.id));

          for (const stepId of cutStepSource.stepIds) {
            await deleteStep.mutateAsync(stepId);
          }

          if (cutStepSource.testCaseId && cutStepSource.testCaseId !== selectedTestCaseId) {
            await queryClient.invalidateQueries({ queryKey: ["test-case-steps", cutStepSource.testCaseId] });
          }

          if (selectedTestCaseId) {
            await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
          }

          if (cutSourceSteps.some((step) => step.reusable_group_id) || stepsToPaste.some((step) => step.reusable_group_id)) {
            await refreshSharedGroups();
          }
        }

        setExpandedStepIds((current) => current.filter((id) => !cutStepSource.stepIds.includes(id)));
        setCopiedSteps([]);
        setCopiedStepMode("copy");
        setCutStepSource(null);
      }

      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      setSelectedStepIds([]);
      showSuccess(`${copiedStepMode === "cut" ? "Moved" : "Pasted"} ${stepsToPaste.length} step${stepsToPaste.length === 1 ? "" : "s"}.`);
    } catch (error) {
      showError(error, "Unable to paste steps");
    }
  };

  const handleOpenStepGroupModal = () => {
    if (!selectedStepIds.length) {
      showError(new Error("Select one or more steps to group."), "Unable to group steps");
      return;
    }

    if (!isContinuousStepSelection(displaySteps, selectedStepIds)) {
      showError(new Error("Select a continuous step range before grouping."), "Unable to group steps");
      return;
    }

    setStepGroupName("");
    setSaveAsReusableGroup(false);
    setIsStepGroupModalOpen(true);
  };

  const handleConfirmStepGroup = async () => {
    const name = stepGroupName.trim();

    if (!name) {
      showError(new Error("Enter a group name before saving the step group."), "Unable to group steps");
      return;
    }

    const selectedStepsForGrouping = displaySteps.filter((step) => selectedStepIds.includes(step.id));

    if (!selectedStepsForGrouping.length) {
      return;
    }

    try {
      const reusableGroupId = saveAsReusableGroup
        ? await getOrCreateSharedGroupRecord(
            name,
            selectedStepsForGrouping.map((step) => ({
              action: step.action,
              expected_result: step.expected_result,
              step_type: step.step_type,
              automation_code: step.automation_code,
              api_request: step.api_request
            }))
          )
        : null;

      if (isCreating) {
        const groupId = createDraftGroupId();

        setDraftSteps((current) =>
          current.map((step) =>
            selectedStepIds.includes(step.id)
              ? {
                  ...step,
                  group_id: groupId,
                  group_name: name,
                  group_kind: saveAsReusableGroup ? "reusable" : "local",
                  reusable_group_id: reusableGroupId
                }
              : step
          )
        );
      } else if (selectedTestCaseId) {
        await groupSteps.mutateAsync({
          test_case_id: selectedTestCaseId,
          step_ids: selectedStepIds,
          name,
          kind: saveAsReusableGroup ? "reusable" : "local",
          reusable_group_id: reusableGroupId || undefined
        });
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      }

      setIsStepGroupModalOpen(false);
      setStepGroupName("");
      setSaveAsReusableGroup(false);

      if (reusableGroupId) {
        await refreshSharedGroups();
      }

      showSuccess(saveAsReusableGroup ? "Shared group created." : "Step group created.");
    } catch (error) {
      showError(error, "Unable to group steps");
    }
  };

  const handleUngroupStepGroup = async (groupId: string, kind?: TestStep["group_kind"]) => {
    const successMessage =
      kind === "reusable"
        ? "Shared group unlinked from this test case. Steps stayed in place."
        : "Step group removed. Steps stayed in place.";

    if (isCreating) {
      setDraftSteps((current) =>
        current.map((step) =>
          step.group_id === groupId
            ? {
                ...step,
                group_id: null,
                group_name: null,
                group_kind: null,
                reusable_group_id: null
              }
            : step
        )
      );
      cancelStepInsert();
      showSuccess(successMessage);
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      await ungroupSteps.mutateAsync({
        test_case_id: selectedTestCaseId,
        group_id: groupId
      });
      cancelStepInsert();
      showSuccess(successMessage);
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (kind === "reusable") {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to ungroup steps");
    }
  };

  const handleRemoveStepGroup = async (groupId: string, groupSteps: TestStep[], kind?: TestStep["group_kind"]) => {
    const targetIds = groupSteps.map((step) => step.id);

    if (!targetIds.length) {
      return;
    }

    const groupName = groupSteps[0]?.group_name || "this step group";
    const isSharedGroup = kind === "reusable";
    const confirmMessage = isSharedGroup
      ? `Remove shared group "${groupName}" from this test case? The shared group library item will stay available.`
      : `Delete "${groupName}" and its ${targetIds.length} step${targetIds.length === 1 ? "" : "s"}?`;

    if (!(await confirmDelete({ message: confirmMessage }))) {
      return;
    }

    if (isCreating) {
      setDraftSteps((current) => current.filter((step) => step.group_id !== groupId));
      setSelectedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      setExpandedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      setExpandedStepGroupIds((current) => current.filter((id) => id !== groupId));
      cancelStepInsert();
      showSuccess(isSharedGroup ? "Shared group removed from this draft case." : "Step group and its steps removed.");
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      for (const stepId of targetIds) {
        await deleteStep.mutateAsync(stepId);
      }
      setSelectedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      setExpandedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      setExpandedStepGroupIds((current) => current.filter((id) => id !== groupId));
      cancelStepInsert();
      showSuccess(isSharedGroup ? "Shared group removed from this test case." : "Step group and its steps removed.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (isSharedGroup) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to remove step group");
    }
  };

  const handleInsertSharedGroup = async () => {
    const sharedGroup = sharedStepGroups.find((group) => group.id === selectedSharedGroupId);

    if (!sharedGroup) {
      showError(new Error("Choose a shared step group to insert."), "Unable to insert shared group");
      return;
    }

    try {
      if (isCreating) {
        const insertionIndex = resolveStepInsertIndex(draftSteps);
        const groupInstanceId = createDraftGroupId();
        const insertedSteps = sharedGroup.steps.map((step) => ({
          id: createDraftStepId(),
          action: step.action || "",
          expected_result: step.expected_result || "",
          step_type: normalizeStepType(step.step_type),
          automation_code: normalizeAutomationCode(step.automation_code),
          api_request: normalizeApiRequest(step.api_request),
          group_id: groupInstanceId,
          group_name: sharedGroup.name,
          group_kind: "reusable" as const,
          reusable_group_id: sharedGroup.id
        }));

        setDraftSteps((current) => {
          const next = [...current];
          next.splice(insertionIndex, 0, ...insertedSteps);
          return next;
        });
        setExpandedStepIds((current) => [...new Set([...current, ...insertedSteps.map((step) => step.id)])]);
        setSelectedStepIds(insertedSteps.map((step) => step.id));
      } else if (selectedTestCaseId) {
        const insertionIndex = resolveStepInsertIndex(steps);
        const insertAfterStepId = insertionIndex > 0 ? steps[insertionIndex - 1]?.id : undefined;

        await insertSharedGroup.mutateAsync({
          test_case_id: selectedTestCaseId,
          shared_step_group_id: sharedGroup.id,
          insert_after_step_id: insertAfterStepId
        });
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
        await refreshSharedGroups();
      }

      setIsSharedGroupPickerOpen(false);
      setSelectedSharedGroupId("");
      setSharedGroupSearchTerm("");
      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      showSuccess(`Inserted shared group "${sharedGroup.name}".`);
    } catch (error) {
      showError(error, "Unable to insert shared group");
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);

    if (!files.length) {
      return;
    }

    const preparedBatches: PreparedTestCaseImportBatch[] = [];
    const failedFiles: string[] = [];

    try {
      for (const file of files) {
        try {
          preparedBatches.push(await prepareTestCaseImportBatch(file, importSourceSelection));
        } catch (error) {
          failedFiles.push(`${file.name}: ${error instanceof Error ? error.message : "Unable to parse file"}`);
        }
      }

      if (preparedBatches.length) {
        setImportBatches((current) => [...current, ...preparedBatches]);
      }

      if (failedFiles.length) {
        setImportFileWarnings((current) => [...current, ...failedFiles]);
      }

      const preparedCaseCount = preparedBatches.reduce((total, batch) => total + batch.rows.length, 0);

      if (preparedCaseCount) {
        setMessageTone("success");
        setMessage(
          `Prepared ${preparedCaseCount} test case${preparedCaseCount === 1 ? "" : "s"} from ${preparedBatches.length} file${preparedBatches.length === 1 ? "" : "s"}.`
        );
      } else if (failedFiles[0]) {
        setMessageTone("error");
        setMessage(failedFiles[0]);
      } else {
        setMessageTone("error");
        setMessage("No importable test cases were found in the selected files.");
      }
    } finally {
      event.target.value = "";
    }
  };

  const handleBulkImport = async () => {
    if (!appTypeId || !importRows.length) {
      return;
    }

    try {
      const response = await importTestCases.mutateAsync({
        app_type_id: appTypeId,
        requirement_id: importRequirementId || undefined,
        batches: importBatches
          .filter((batch) => batch.rows.length)
          .map((batch) => ({
            file_name: batch.fileName,
            import_source: batch.source,
            rows: batch.rows
          }))
      });

      setMessageTone("success");
      setMessage(
        response.split_count && response.split_count > 1
          ? `Test case import split into ${response.split_count} queued batch processes. Track progress in TestOps.`
          : `Test case import queued. Track progress in TestOps batch process ${response.transaction_id.slice(0, 8)}.`
      );
      setImportBatches([]);
      setImportFileWarnings([]);
      setImportSourceSelection("auto");
      setIsImportModalOpen(false);
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to import test cases");
    }
  };

  const exportCasesToCsv = async (
    testCasesToExport: TestCase[],
    options?: {
      fileLabel?: string;
      successMessage?: string;
    }
  ) => {
    if (!testCasesToExport.length) {
      setMessageTone("error");
      setMessage("No test cases are available to export.");
      return;
    }

    try {
      const response = await api.testCases.exportCases({
        app_type_id: appTypeId || "",
        test_case_ids: testCasesToExport.map((testCase) => testCase.id)
      });
      showSuccess(
        options?.successMessage
          || `Test case export queued. Track progress in TestOps batch process ${response.transaction_id.slice(0, 8)}.`
      );
    } catch (error) {
      showError(error, "Unable to export test cases");
    }
  };

  const handleExportCsv = async () => {
    if (!filteredCases.length) {
      setMessageTone("error");
      setMessage("No test cases match the current scope to export.");
      return;
    }

    await exportCasesToCsv(filteredCases, {
      successMessage: `Test case export queued for ${filteredCases.length} case${filteredCases.length === 1 ? "" : "s"}. Track progress in TestOps.`
    });
  };

  const handleCloneCase = async (testCase: TestCase) => {
    const nextAppTypeId = testCase.app_type_id || appTypeId;

    if (!nextAppTypeId) {
      showError(new Error("Select an app type before cloning a test case."), "Unable to clone test case");
      return;
    }

    try {
      const response = await createTestCase.mutateAsync({
        app_type_id: nextAppTypeId,
        suite_ids: testCase.suite_ids || (testCase.suite_id ? [testCase.suite_id] : []),
        title: `${testCase.title} (Copy)`,
        description: testCase.description || undefined,
        external_references: testCase.external_references || [],
        parameter_values: testCase.parameter_values || undefined,
        automated: testCase.automated || defaultTestCaseAutomated,
        priority: testCase.priority || 3,
        status: testCase.status || defaultTestCaseStatus,
        requirement_ids: testCase.requirement_ids || (testCase.requirement_id ? [testCase.requirement_id] : []),
        steps: (allStepsByCaseId[testCase.id] || []).map((step) => ({
          step_order: step.step_order,
          action: step.action || undefined,
          expected_result: step.expected_result || undefined,
          step_type: step.step_type,
          automation_code: step.automation_code || undefined,
          api_request: step.api_request || undefined,
          group_id: step.group_id || undefined,
          group_name: step.group_name || undefined,
          group_kind: step.group_kind || undefined,
          reusable_group_id: step.reusable_group_id || undefined
        }))
      });

      syncTestCaseSearchParams(response.id);
      setSelectedTestCaseId(response.id);
      setIsCreating(false);
      setDraftSteps([]);
      showSuccess(`Cloned "${testCase.title}" with its current steps.`);
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to clone test case");
    }
  };

  const handleDeleteCaseItem = async (testCase: TestCase) => {
    if (!(await confirmDelete({ message: `Delete test case "${testCase.title}"? Historical execution evidence will stay preserved.` }))) {
      return;
    }

    try {
      await deleteTestCase.mutateAsync(testCase.id);
      setSelectedActionTestCaseIds((current) => current.filter((id) => id !== testCase.id));

      if (selectedTestCaseId === testCase.id) {
        syncTestCaseSearchParams(null);
        setSelectedTestCaseId("");
        setCaseDraft(emptyCaseDraft);
        setIsCreating(false);
        setSelectedStepIds([]);
        setStepInsertIndex(null);
        setStepInsertGroupContext(null);
      }

      showSuccess("Test case deleted. Run snapshots remain available.");
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to delete test case");
    }
  };

  const openAiCaseAuthoring = () => {
    const seededRequirementId =
      caseDraft.requirement_id
      || selectedTestCase?.requirement_ids?.[0]
      || selectedTestCase?.requirement_id
      || requirements[0]?.id
      || "";

    setAiCaseAuthoringRequirementId(seededRequirementId);
    setAiCaseAuthoringPreview(null);
    setAiCaseAuthoringMessage("");
    setAiCaseAuthoringTone("success");
    setIsAiCaseAuthoringOpen(true);
  };

  const openAiStudio = () => {
    const seededRequirementIds = [
      ...(selectedTestCase?.requirement_ids || []),
      ...(selectedTestCase?.requirement_id ? [selectedTestCase.requirement_id] : []),
      ...(caseDraft.requirement_id ? [caseDraft.requirement_id] : [])
    ].filter(Boolean);

    const nextRequirementIds = seededRequirementIds.length ? [...new Set(seededRequirementIds)] : requirements[0] ? [requirements[0].id] : [];

    setAiRequirementIds(nextRequirementIds);
    setParallelRequirementLimit(Math.min(Math.max(nextRequirementIds.length || 1, 1), 3));
    setAiPreviewCases([]);
    setAiPreviewMessage("");
    setAiPreviewTone("success");
    setIsAiStudioOpen(true);
  };

  const handleAddAiReferenceImages = async (files: FileList | null) => {
    try {
      const images = await readImageFiles(files);
      setAiReferenceImages((current) => appendUniqueImages(current, images));
    } catch (error) {
      setAiPreviewTone("error");
      setAiPreviewMessage(error instanceof Error ? error.message : "Unable to attach the selected image");
    }
  };

  const handlePreviewDesignedCases = async () => {
    if (!appTypeId || !aiRequirementIds.length) {
      return;
    }

    try {
      const response = await previewDesignedCases.mutateAsync({
        app_type_id: appTypeId,
        requirement_ids: aiRequirementIds,
        integration_id: integrationId || undefined,
        max_cases: maxCases,
        additional_context: aiAdditionalContext || undefined,
        external_links: parseExternalLinks(aiExternalLinksText),
        images: aiReferenceImages
      });

      setAiPreviewCases(response.cases);
      setAiPreviewTone("success");
      setAiPreviewMessage(`${response.generated} draft cases generated using ${response.integration.name}. Review them before accepting.`);
    } catch (error) {
      setAiPreviewTone("error");
      setAiPreviewMessage(formatAiStudioErrorMessage(error, "Unable to preview AI-generated test cases right now."));
    }
  };

  const formatAiStudioErrorMessage = (error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message.trim() : "";
    const normalized = message.toLowerCase();

    if (!message) {
      return fallback;
    }

    if (normalized.includes("rate limit") || normalized.includes("too many") || normalized.includes("429")) {
      return "AI generation is being rate-limited right now. Please wait a moment and try again.";
    }

    if (normalized.includes("timeout") || normalized.includes("took too long")) {
      return "AI generation took too long to respond. Please try again in a moment.";
    }

    if (normalized.includes("unable to reach api") || normalized.includes("network") || normalized.includes("connection")) {
      return "Couldn't reach the AI generation service. Check the connection and try again.";
    }

    return message;
  };

  const handlePreviewAiCaseAuthoring = async () => {
    if (!appTypeId || !aiCaseAuthoringRequirementId) {
      setAiCaseAuthoringTone("error");
      setAiCaseAuthoringMessage("Choose the linked requirement before generating an AI authoring preview.");
      return;
    }

    try {
      const response = await previewCaseAuthoring.mutateAsync({
        app_type_id: appTypeId,
        requirement_id: aiCaseAuthoringRequirementId,
        integration_id: integrationId || undefined,
        additional_context: aiCaseAuthoringAdditionalContext || undefined,
        test_case: aiCaseAuthoringSourceDraft
      });

      setAiCaseAuthoringPreview(response.case);
      setAiCaseAuthoringTone("success");
      setAiCaseAuthoringMessage(
        `Prepared ${response.case.step_count} AI-authored step${response.case.step_count === 1 ? "" : "s"} using ${response.integration.name}.`
      );
    } catch (error) {
      setAiCaseAuthoringTone("error");
      setAiCaseAuthoringMessage(formatAiStudioErrorMessage(error, "Unable to preview AI authoring right now."));
    }
  };

  const handleApplyAiCaseAuthoring = async () => {
    if (!aiCaseAuthoringPreview) {
      return;
    }

    const normalizedPreviewParameterValues = normalizeTestCaseParameterValues(aiCaseAuthoringPreview.parameter_values);

    if (isCreating) {
      const nextDraftSteps = buildDraftStepsFromAiAuthoringPreview(aiCaseAuthoringPreview);

      setCaseDraft((current) => ({
        ...current,
        title: aiCaseAuthoringPreview.title,
        description: aiCaseAuthoringPreview.description || "",
        requirement_id: aiCaseAuthoringRequirementId || current.requirement_id
      }));
      setTestCaseParameterValues(normalizedPreviewParameterValues);
      setDraftSteps(nextDraftSteps);
      setSelectedStepIds([]);
      setExpandedStepIds(nextDraftSteps.map((step) => step.id));
      setExpandedStepGroupIds([]);
      setIsAiCaseAuthoringOpen(false);
      setAiCaseAuthoringPreview(null);
      setAiCaseAuthoringMessage("");
      showSuccess("AI-authored content applied to the new test case draft.");
      return;
    }

    if (!selectedTestCase) {
      return;
    }

    const stepReplacementMessage = aiCaseAuthoringAutomationStepCount
      ? `Replace "${selectedTestCase.title}" with the AI-authored draft? This will overwrite ${displaySteps.length} saved step${displaySteps.length === 1 ? "" : "s"} and remove automation code or API request setup from ${aiCaseAuthoringAutomationStepCount} step${aiCaseAuthoringAutomationStepCount === 1 ? "" : "s"}.`
      : `Replace "${selectedTestCase.title}" with the AI-authored draft and overwrite its ${displaySteps.length} saved step${displaySteps.length === 1 ? "" : "s"}?`;

    if (!window.confirm(stepReplacementMessage)) {
      return;
    }

    try {
      await updateTestCase.mutateAsync({
        id: selectedTestCase.id,
        input: {
          title: aiCaseAuthoringPreview.title,
          description: aiCaseAuthoringPreview.description || "",
          parameter_values: normalizedPreviewParameterValues,
          requirement_ids: aiCaseAuthoringRequirementId ? [aiCaseAuthoringRequirementId] : [],
          steps: buildPersistedStepsFromAiAuthoringPreview(aiCaseAuthoringPreview)
        }
      });

      setCaseDraft((current) => ({
        ...current,
        title: aiCaseAuthoringPreview.title,
        description: aiCaseAuthoringPreview.description || "",
        requirement_id: aiCaseAuthoringRequirementId || current.requirement_id
      }));
      setTestCaseParameterValues(normalizedPreviewParameterValues);
      syncCachedTestCaseParameterValues(selectedTestCase.id, normalizedPreviewParameterValues);
      clearStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey);
      setIsAiCaseAuthoringOpen(false);
      setAiCaseAuthoringPreview(null);
      setAiCaseAuthoringMessage("");
      showSuccess("AI-authored content replaced the saved test case steps and test data.");
      await refreshCases();
    } catch (error) {
      setAiCaseAuthoringTone("error");
      setAiCaseAuthoringMessage(formatAiStudioErrorMessage(error, "Unable to apply AI authoring right now."));
    }
  };

  const handleAcceptDesignedCases = async () => {
    if (!appTypeId || !aiRequirementIds.length || !aiPreviewCases.length) {
      return;
    }

    try {
      const response = await acceptDesignedCases.mutateAsync({
        app_type_id: appTypeId,
        requirement_ids: aiRequirementIds,
        status: "draft",
        cases: aiPreviewCases.map((item) => ({
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
      });

      setAiPreviewCases([]);
      setAiPreviewMessage("");
      setIsAiStudioOpen(false);
      if (response.created[0]) {
        syncTestCaseSearchParams(response.created[0].id);
        setSelectedTestCaseId(response.created[0].id);
        setIsCreating(false);
      }
      showSuccess("AI-designed test cases accepted into the library as standard steps.");
      await refreshCases();
    } catch (error) {
      setAiPreviewTone("error");
      setAiPreviewMessage(formatAiStudioErrorMessage(error, "Unable to accept AI-generated test cases right now."));
    }
  };

  const handleScheduleDesignedCases = async () => {
    if (!appTypeId || !aiRequirementIds.length) {
      setAiPreviewTone("error");
      setAiPreviewMessage("Select at least one requirement before scheduling AI generation.");
      return;
    }

    try {
      await createGenerationJob.mutateAsync({
        app_type_id: appTypeId,
        requirement_ids: aiRequirementIds,
        integration_id: integrationId || undefined,
        max_cases_per_requirement: maxCases,
        parallel_requirement_limit: parallelRequirementLimit,
        additional_context: aiAdditionalContext || undefined,
        external_links: parseExternalLinks(aiExternalLinksText),
        images: aiReferenceImages
      });

      setAiPreviewCases([]);
      setAiPreviewMessage("");
      setIsAiStudioOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ai-test-case-generation-jobs", appTypeId] }),
        queryClient.invalidateQueries({ queryKey: ["requirements", projectId] })
      ]);
      showSuccess("AI test case generation scheduled. Draft cases will appear in the library with accept and reject controls once processing completes.");
    } catch (error) {
      setAiPreviewTone("error");
      setAiPreviewMessage(formatAiStudioErrorMessage(error, "Unable to schedule AI-generated test cases right now."));
    }
  };

  const handleRunTestCase = async (testCaseId: string, mode?: "local") => {
    const testCase = testCases.find((item) => item.id === testCaseId);

    if (!session?.user.id) {
      showError(new Error("You need an active session before running a test case."), "Unable to run test case");
      return;
    }

    if (!projectId || !appTypeId || !testCase) {
      showError(new Error("Select a project and app type before running a test case."), "Unable to run test case");
      return;
    }

    setSchedulerActionCaseId(testCaseId);
    setSchedulerActionKind(mode === "local" ? "run-local" : "run");

    try {
      if (mode === "local") {
        const response = await createLocalRun.mutateAsync({
          project_id: projectId,
          app_type_id: appTypeId,
          test_case_ids: [testCaseId],
          assigned_to: selectedExecutionAssigneeId || undefined,
          name: `${testCase.title} Local Run`,
          created_by: session.user.id,
          engine_base_url: "http://host.docker.internal:4311"
        });

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["executions"] }),
          queryClient.invalidateQueries({ queryKey: ["executions", projectId] }),
          queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] })
        ]);

        navigate(`/executions?view=local-runs&execution=${response.id}&testCase=${testCaseId}`);
        showSuccess(`Local run started for ${testCase.title}.`);
        return;
      }

      const response = await createExecution.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId,
        test_case_ids: [testCaseId],
        assigned_to: selectedExecutionAssigneeId || undefined,
        name: `${testCase.title} Run`,
        created_by: session.user.id
      });

      try {
        const startResponse = await startExecution.mutateAsync(response.id);
        showSuccess(summarizeExecutionStart(startResponse, `${testCase.title} run started.`));
      } catch (error) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["executions"] }),
          queryClient.invalidateQueries({ queryKey: ["executions", projectId] })
        ]);
        navigate(`/executions?view=test-case-runs&execution=${response.id}&testCase=${testCaseId}`);
        showError(error, "Run created, but QAira could not start it");
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["executions"] }),
        queryClient.invalidateQueries({ queryKey: ["executions", projectId] })
      ]);

      navigate(`/executions?view=test-case-runs&execution=${response.id}&testCase=${testCaseId}`);
    } catch (error) {
      showError(error, "Unable to run test case");
    } finally {
      setSchedulerActionCaseId("");
      setSchedulerActionKind("");
    }
  };

  const handleReviewGeneratedCase = async (testCaseId: string, action: "accept" | "reject") => {
    const testCase = testCases.find((item) => item.id === testCaseId);

    if (!testCase) {
      return;
    }

    if (action === "reject" && !(await confirmDelete({ message: `Reject and permanently delete "${testCase.title}"?` }))) {
      return;
    }

    setSchedulerActionCaseId(testCaseId);
    setSchedulerActionKind(action);

    try {
      if (action === "accept") {
        await acceptGeneratedCase.mutateAsync(testCaseId);
        showSuccess(`Accepted "${testCase.title}" into the reusable test case library.`);
      } else {
        await rejectGeneratedCase.mutateAsync(testCaseId);

        if (selectedTestCaseId === testCaseId) {
          closeCaseWorkspace();
        }

        setSelectedActionTestCaseIds((current) => current.filter((id) => id !== testCaseId));
        showSuccess(`Rejected "${testCase.title}" and permanently removed it.`);
      }

      await refreshCases();
    } catch (error) {
      showError(error, action === "accept" ? "Unable to accept generated test case" : "Unable to reject generated test case");
    } finally {
      setSchedulerActionCaseId("");
      setSchedulerActionKind("");
    }
  };

  const handleReviewSelectedGeneratedCases = async (action: "accept" | "reject") => {
    if (!selectedPendingGeneratedCases.length) {
      showError(new Error("Select one or more pending generated cases first."), action === "accept" ? "Unable to accept generated cases" : "Unable to reject generated cases");
      return;
    }

    if (action === "reject" && !(await confirmDelete({ message: `Reject and permanently delete ${selectedPendingGeneratedCases.length} generated test case${selectedPendingGeneratedCases.length === 1 ? "" : "s"}?` }))) {
      return;
    }

    setSchedulerActionCaseId("bulk");
    setSchedulerActionKind(action);

    try {
      for (const testCase of selectedPendingGeneratedCases) {
        if (action === "accept") {
          await acceptGeneratedCase.mutateAsync(testCase.id);
        } else {
          await rejectGeneratedCase.mutateAsync(testCase.id);

          if (selectedTestCaseId === testCase.id) {
            closeCaseWorkspace();
          }
        }
      }

      if (action === "reject") {
        const rejectedIds = new Set(selectedPendingGeneratedCases.map((testCase) => testCase.id));
        setSelectedActionTestCaseIds((current) => current.filter((id) => !rejectedIds.has(id)));
      }

      showSuccess(`${action === "accept" ? "Accepted" : "Rejected"} ${selectedPendingGeneratedCases.length} generated test case${selectedPendingGeneratedCases.length === 1 ? "" : "s"}.`);
      await refreshCases();
    } catch (error) {
      showError(error, action === "accept" ? "Unable to accept generated cases" : "Unable to reject generated cases");
    } finally {
      setSchedulerActionCaseId("");
      setSchedulerActionKind("");
    }
  };

  const coverageMetrics = useMemo(() => {
    const covered = testCases.filter((testCase) => (testCase.requirement_ids || [testCase.requirement_id]).filter(Boolean).length).length;
    const automated = testCases.filter((testCase) => testCase.automated === "yes").length;
    const withHistory = testCases.filter((testCase) => (historyByCaseId[testCase.id] || []).length).length;
    const withSuites = testCases.filter((testCase) => (testCase.suite_ids || []).length).length;

    return {
      total: testCases.length,
      covered,
      automated,
      withHistory,
      withSuites
    };
  }, [historyByCaseId, testCases]);
  const importRows = useMemo(
    () => importBatches.flatMap((batch) => batch.rows),
    [importBatches]
  );
  const importWarnings = useMemo(
    () =>
      [
        ...importBatches.flatMap((batch) =>
          batch.warnings.map((warning) => `${batch.fileName}: ${warning}`)
        ),
        ...importFileWarnings
      ],
    [importBatches, importFileWarnings]
  );
  const importStepCount = useMemo(
    () => importRows.reduce((total, row) => total + countImportedSteps(row), 0),
    [importRows]
  );
  const importFileCount = importBatches.length;
  const importFileName = useMemo(() => {
    if (!importBatches.length) {
      return "";
    }

    if (importBatches.length === 1) {
      return importBatches[0]?.fileName || "";
    }

    return `${importBatches[0]?.fileName || "Import batch"} + ${importBatches.length - 1} more`;
  }, [importBatches]);
  const importSourceSummary = useMemo(() => {
    if (!importBatches.length) {
      return "";
    }

    const uniqueSources = Array.from(new Set(importBatches.map((batch) => batch.source)));

    if (uniqueSources.length === 1) {
      return getTestCaseImportSourceLabel(uniqueSources[0] as TestCaseImportSource);
    }

    return "Mixed sources";
  }, [importBatches]);
  const isLibraryLoading = testCasesQuery.isLoading || executionResultsQuery.isLoading || allTestStepsQuery.isLoading;

  const selectedRequirement = requirements.find((item) => item.id === caseDraft.requirement_id) || null;
  const selectedSuiteContext = suites.find((suite) => suite.id === createSuiteContextId) || null;
  const selectedCaseSuites = useMemo(() => {
    if (isCreating) {
      return selectedSuiteContext ? [selectedSuiteContext] : [];
    }

    if (!selectedTestCase) {
      return [];
    }

    const suiteIds = [
      ...(selectedTestCase.suite_ids || []),
      ...(selectedTestCase.suite_id ? [selectedTestCase.suite_id] : [])
    ].filter(Boolean);

    if (!suiteIds.length) {
      return [];
    }

    const suiteIdSet = new Set(suiteIds);
    return suites.filter((suite) => suiteIdSet.has(suite.id));
  }, [isCreating, selectedSuiteContext, selectedTestCase, suites]);
  const selectedCaseSuiteIdsForModal = useMemo(
    () => selectedCaseSuites.map((suite) => suite.id),
    [selectedCaseSuites]
  );
  const hasSuiteLinkDraftChanges = useMemo(() => {
    const currentSuiteIds = Array.from(new Set(selectedCaseSuiteIdsForModal.filter(Boolean))).sort();
    const draftSuiteIds = Array.from(new Set(suiteLinkDraftIds.filter(Boolean))).sort();

    if (currentSuiteIds.length !== draftSuiteIds.length) {
      return true;
    }

    return currentSuiteIds.some((suiteId, index) => suiteId !== draftSuiteIds[index]);
  }, [selectedCaseSuiteIdsForModal, suiteLinkDraftIds]);
  useEffect(() => {
    if (!isSuiteLinkModalOpen) {
      return;
    }

    setSuiteLinkDraftIds(selectedCaseSuiteIdsForModal);
  }, [isSuiteLinkModalOpen, selectedCaseSuiteIdsForModal]);
  const selectedHistory = selectedTestCase ? historyByCaseId[selectedTestCase.id] || [] : [];
  const selectedEditorSteps = useMemo(
    () => displaySteps.filter((step) => selectedStepIds.includes(step.id)),
    [displaySteps, selectedStepIds]
  );
  const stepBlocks = useMemo(() => {
    return displaySteps.reduce<Array<{
      key: string;
      group_id: string | null;
      group_name: string | null;
      group_kind: TestStep["group_kind"];
      reusable_group_id: string | null;
      steps: TestStep[];
    }>>((blocks, step) => {
      const previousBlock = blocks[blocks.length - 1];

      if (step.group_id && previousBlock?.group_id === step.group_id) {
        previousBlock.steps.push(step);
        return blocks;
      }

      blocks.push({
        key: step.group_id ? `group-${step.group_id}` : `step-${step.id}`,
        group_id: step.group_id || null,
        group_name: step.group_name || null,
        group_kind: step.group_kind || null,
        reusable_group_id: step.reusable_group_id || null,
        steps: [step]
      });

      return blocks;
    }, []);
  }, [displaySteps]);
  const stepGroupIds = useMemo(
    () => [...new Set(stepBlocks.map((block) => block.group_id).filter((groupId): groupId is string => Boolean(groupId)))],
    [stepBlocks]
  );
  const filteredSharedGroups = useMemo(() => {
    const search = sharedGroupSearchTerm.trim().toLowerCase();

    return sharedStepGroups.filter((group) => {
      if (!search) {
        return true;
      }

      return [group.name, group.description || "", ...group.steps.map((step) => `${step.action || ""} ${step.expected_result || ""}`)]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [sharedGroupSearchTerm, sharedStepGroups]);
  const selectedSharedGroup = sharedStepGroups.find((group) => group.id === selectedSharedGroupId) || null;
  const detectedStepParameters = useMemo<StepParameterDefinition[]>(
    () =>
      collectStepParameters(
        displaySteps.map((step) => ({
          id: step.id,
          action: stepDrafts[step.id]?.action ?? step.action,
          expected_result: stepDrafts[step.id]?.expected_result ?? step.expected_result,
          automation_code: stepDrafts[step.id]?.automation_code ?? step.automation_code,
          api_request: stepDrafts[step.id]?.api_request ?? step.api_request
        }))
      ),
    [displaySteps, stepDrafts]
  );
  const isCaseWorkspaceOpen = Boolean(selectedTestCaseId) || isCreating;
  const stepCountLabel = `${displaySteps.length} step${displaySteps.length === 1 ? "" : "s"}`;
  const allStepsSelected = Boolean(displaySteps.length) && selectedStepIds.length === displaySteps.length;
  const dirtyStepIds = useMemo(
    () =>
      displaySteps
        .filter((step) => {
          const draft = stepDrafts[step.id];
          if (!draft) {
            return false;
          }
          return (draft.action || "").trim() !== (step.action || "").trim()
            || (draft.expected_result || "").trim() !== (step.expected_result || "").trim()
            || !areComparableStepAutomationEqual(draft, step);
        })
        .map((step) => step.id),
    [displaySteps, stepDrafts]
  );
  const dirtySelectedStepIds = selectedEditorSteps.map((step) => step.id).filter((id) => dirtyStepIds.includes(id));
  const selectionIsContinuous = isContinuousStepSelection(displaySteps, selectedStepIds);
  const selectionGroupId = selectedEditorSteps.length && selectedEditorSteps.every((step) => step.group_id && step.group_id === selectedEditorSteps[0]?.group_id)
    ? (selectedEditorSteps[0]?.group_id as string)
    : "";
  const selectionGroupKind = selectionGroupId ? (selectedEditorSteps[0]?.group_kind || null) : null;
  const canUngroupSelection = Boolean(selectionGroupId && selectionIsContinuous);
  const selectionMinOrder = selectedEditorSteps.length ? Math.min(...selectedEditorSteps.map((step) => step.step_order)) : null;
  const selectionMaxOrder = selectedEditorSteps.length ? Math.max(...selectedEditorSteps.map((step) => step.step_order)) : null;
  const selectionPasteAboveIndex = selectionMinOrder ? Math.max(0, selectionMinOrder - 1) : null;
  const selectionPasteBelowIndex = selectionMaxOrder ? selectionMaxOrder : null;
  const editorStepActions: StepActionMenuAction[] = [
    {
      label: isCreating ? "Create test case" : "Save test case",
      description: isCreating ? "Create this test case and keep the current draft steps." : "Save the case title, metadata, and requirement mapping.",
      icon: <StepSaveIcon />,
      onClick: () => void handleSaveCaseDirect(),
      tone: "primary",
      disabled: createTestCase.isPending || updateTestCase.isPending
    },
    {
      label: "Save selected steps",
      description: "Persist the current edits for the selected steps only.",
      icon: <StepSaveIcon />,
      onClick: () => void handleSaveMultipleSteps(dirtySelectedStepIds.length ? dirtySelectedStepIds : selectedEditorSteps.map((step) => step.id), "Selected steps"),
      disabled: isCreating || !selectedEditorSteps.length
    },
    {
      label: "Save all steps",
      description: "Persist every pending step change in this test case.",
      icon: <StepSaveIcon />,
      onClick: () => void handleSaveMultipleSteps(dirtyStepIds.length ? dirtyStepIds : displaySteps.map((step) => step.id), "All steps"),
      disabled: isCreating || !displaySteps.length
    },
    {
      label: "Expand all steps",
      description: "Open every step editor in the current case.",
      icon: <StepExpandAllIcon />,
      onClick: () => {
        setExpandedStepIds(displaySteps.map((step) => step.id));
        setExpandedStepGroupIds(stepGroupIds);
      },
      disabled: !displaySteps.length
    },
    {
      label: "Collapse all steps",
      description: "Close all expanded step editors.",
      icon: <StepCollapseAllIcon />,
      onClick: () => {
        setExpandedStepIds([]);
        setExpandedStepGroupIds([]);
      },
      disabled: !displaySteps.length
    },
    {
      label: "Copy selected steps",
      description: "Place the selected steps in the clipboard for reuse.",
      icon: <StepCopyIcon />,
      onClick: () => handleCopySteps(),
      disabled: !selectedEditorSteps.length
    },
    {
      label: "Cut selected steps",
      description: "Move the selected steps after you paste them into a new position.",
      icon: <StepCutIcon />,
      onClick: () => handleCutSteps(),
      disabled: !selectedEditorSteps.length
    },
    ...(copiedSteps.length && selectionPasteAboveIndex !== null
      ? [{
          label: "Paste above selection",
          description: "Insert the clipboard steps before the current selection.",
          icon: <StepPasteAboveIcon />,
          onClick: () => void handlePasteSteps(selectionPasteAboveIndex)
        }, {
          label: "Paste below selection",
          description: "Insert the clipboard steps after the current selection.",
          icon: <StepPasteBelowIcon />,
          onClick: () => void handlePasteSteps(selectionPasteBelowIndex as number)
        }]
      : copiedSteps.length
        ? [{
            label: copiedStepMode === "cut" ? "Paste cut steps" : "Paste copied steps",
            description: "Insert the clipboard steps at the active step insertion point.",
            icon: <StepPasteIcon />,
            onClick: () => void handlePasteSteps()
          }]
        : []),
    ...(canUngroupSelection
      ? [{
          label: "Ungroup selected",
          description: "Remove the current selection from its group while keeping the steps in place.",
          icon: <StepUngroupIcon />,
          onClick: () => void handleUngroupStepGroup(selectionGroupId, selectionGroupKind || undefined)
        }]
      : [{
          label: "Group selected steps",
          description: "Turn the current continuous selection into one local or shared group.",
          icon: <StepGroupIcon />,
          onClick: handleOpenStepGroupModal,
          disabled: !selectedEditorSteps.length || !selectionIsContinuous
        }]),
    {
      label: "Delete selected steps",
      description: "Remove the selected steps from this test case.",
      icon: <StepDeleteIcon />,
      onClick: () => void handleDeleteSelectedSteps(),
      disabled: !selectedEditorSteps.length,
      tone: "danger"
    },
    {
      label: "Insert shared group",
      description: "Add a linked shared step group into this test case.",
      icon: <StepSharedGroupIcon />,
      onClick: () => {
        setIsSharedGroupPickerOpen(true);
        setSelectedSharedGroupId((current) => current || sharedStepGroups[0]?.id || "");
      },
      disabled: !appTypeId
    },
    {
      label: "Clear step selection",
      description: "Reset the current multi-step selection.",
      icon: <StepClearSelectionIcon />,
      onClick: () => setSelectedStepIds([]),
      disabled: !selectedEditorSteps.length
    }
  ];
  const readableCaseTitle = resolveStepParameterText(caseDraft.title, mergedScopedParameterValues);
  const readableCaseDescription = resolveStepParameterText(caseDraft.description, mergedScopedParameterValues);
  const hasReadableCasePreview = Boolean(
    detectedStepParameters.length
    || Object.keys(mergedScopedParameterValues).length
    || readableCaseTitle !== caseDraft.title
    || readableCaseDescription !== caseDraft.description
  );
  const firstStepPreview = resolveStepParameterText(
    displaySteps[0]?.action || displaySteps[0]?.expected_result || "",
    mergedScopedParameterValues
  );
  const caseSectionSummary = isCreating
    ? readableCaseTitle.trim() || "Start defining the reusable case before saving it."
    : readableCaseTitle || selectedTestCase?.title || "Select a test case from the library to edit it here.";
  const stepSectionSummary = firstStepPreview
    ? `Starts with: ${firstStepPreview}`
    : isCreating
      ? "No draft steps added yet."
      : "No steps added yet for this test case.";
  const automationSectionSummary = automationTargetCaseIds.length
    ? `${automationTargetCaseIds.length} case${automationTargetCaseIds.length === 1 ? "" : "s"} selected for AI automation or recorder capture.`
    : "Select a saved case to automate with AI or recorder capture.";
  const historySectionSummary = selectedHistory.length
    ? "Review the latest recorded outcomes and preserved run evidence for this reusable test case."
    : "No run history has been recorded for this reusable test case yet.";
  const parameterDialogHeaderContent = (
    <div className="step-parameter-dialog-context">
      <div className="step-parameter-dialog-context-card">
        <strong>Scope guide</strong>
        <span>`@t` saves on the case, `@s` saves on a linked suite, and `@r` stays local here for preview until a real execution data set supplies it.</span>
      </div>
      {selectedCaseSuites.length ? (
        <div className="step-parameter-dialog-context-card">
          <strong>Suite targets</strong>
          <span>
            {selectedCaseSuites.length === 1
              ? `Previewing and editing suite-shared values for "${selectedCaseSuites[0]?.name || "Linked suite"}".`
              : `This case is linked to ${selectedCaseSuites.length} suites. Choose the active suite target to preview or edit its saved @s values.`}
          </span>
          <div className="selection-chip-row">
            {selectedCaseSuites.map((suite) => (
              <button
                className={suite.id === selectedParameterSuiteId ? "selection-chip is-selected" : "selection-chip is-unselected"}
                key={suite.id}
                onClick={() => setSelectedParameterSuiteId(suite.id)}
                type="button"
              >
                {suite.name}
              </button>
            ))}
          </div>
        </div>
      ) : detectedStepParameters.some((parameter) => parameter.scope === "s") ? (
        <div className="step-parameter-dialog-context-card">
          <strong>Suite targets</strong>
          <span>Link this case to a suite before editing any `@s` values.</span>
        </div>
      ) : null}
    </div>
  );
  const aiSelectedRequirements = useMemo(
    () => requirements.filter((requirement) => aiRequirementIds.includes(requirement.id)),
    [aiRequirementIds, requirements]
  );
  const aiExistingCases = useMemo(() => {
    if (!aiRequirementIds.length) {
      return [];
    }

    const requirementSet = new Set(aiRequirementIds);
    return testCases.filter((testCase) =>
      (testCase.requirement_ids || [testCase.requirement_id]).filter(Boolean).some((requirementId) => requirementSet.has(requirementId as string))
    );
  }, [aiRequirementIds, testCases]);
  const linkedPreviewCase = useMemo(
    () => testCases.find((testCase) => testCase.id === linkedPreviewCaseId) || null,
    [linkedPreviewCaseId, testCases]
  );
  const activeGenerationJobs = useMemo(
    () => generationJobs.filter((job): job is AiTestCaseGenerationJob => ["queued", "running"].includes(job.status)),
    [generationJobs]
  );
  const generationQueueSummary = useMemo(() => {
    if (activeGenerationJobs.length) {
      const processed = activeGenerationJobs.reduce((total, job) => total + job.processed_requirements, 0);
      const total = activeGenerationJobs.reduce((count, job) => count + job.total_requirements, 0);

      return {
        tone: "success" as const,
        title: `${activeGenerationJobs.length} AI generation job${activeGenerationJobs.length === 1 ? "" : "s"} in progress`,
        detail: `${processed} of ${total} requirement${total === 1 ? "" : "s"} processed in the current app type.`
      };
    }

    return null;
  }, [activeGenerationJobs]);

  const openExistingCaseFromAi = (testCaseId: string) => setLinkedPreviewCaseId(testCaseId);
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
                ? String(sharedStepGroups.length)
                : item.to === "/design"
                  ? String(suites.length)
                  : undefined
      })),
    [requirements.length, sharedStepGroups.length, suites.length, testCases.length]
  );


  const closeCaseWorkspace = () => {
    syncTestCaseSearchParams(null);
    setCreateSuiteContextId("");
    setIsCreating(false);
    setSelectedTestCaseId("");
    setCaseDraft(emptyCaseDraft);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
    setDraftSteps([]);
    setSelectedStepIds([]);
    setExpandedStepIds([]);
    setExpandedStepGroupIds([]);
    setExpandedSections(createDefaultTestCaseSections());
    setIsStepGroupModalOpen(false);
    setStepGroupName("");
    setSaveAsReusableGroup(false);
    setIsSharedGroupPickerOpen(false);
    setSelectedSharedGroupId("");
    setSharedGroupSearchTerm("");
    setIsSuiteLinkModalOpen(false);
    setSuiteLinkDraftIds([]);
    setTestCaseParameterValues({});
    setIsCaseParameterDialogOpen(false);
    setIsAiCaseAuthoringOpen(false);
    setAiCaseAuthoringRequirementId("");
    setAiCaseAuthoringPreview(null);
    setAiCaseAuthoringMessage("");
  };

  const handleWorkspaceBack = () => {
    closeCaseWorkspace();
  };

  const isSelectedCaseRunning =
    Boolean(selectedTestCase?.id)
    && schedulerActionCaseId === selectedTestCase?.id
    && schedulerActionKind === "run";
  const isSelectedCaseLocalRunning =
    Boolean(selectedTestCase?.id)
    && schedulerActionCaseId === selectedTestCase?.id
    && schedulerActionKind === "run-local";
  const caseHeaderActions = (
    <div className="panel-head-actions-row">
      <WorkspaceBackButton label="Back to test case tiles" onClick={handleWorkspaceBack} />
      {selectedTestCase ? (
        <button
          className="test-case-tile-action-button is-run test-case-header-run-button"
          disabled={isSelectedCaseRunning || !projectId || !appTypeId || !session?.user.id}
          onClick={() => void handleRunTestCase(selectedTestCase.id)}
          title={
            selectedTestCase.automated === "yes"
              ? "Run the automated test case now in Test Runs"
              : "Create and open a manual run for this test case"
          }
          type="button"
        >
          <TestCaseRunIcon />
          <span>{isSelectedCaseRunning ? "Starting…" : "Run test"}</span>
        </button>
      ) : null}
      {selectedTestCase && supportsLocalDesktopExecution ? (
        <button
          className="test-case-tile-action-button is-run test-case-header-run-button"
          disabled={isSelectedCaseLocalRunning || createLocalRun.isPending || selectedTestCase.automated !== "yes" || !projectId || !appTypeId || !session?.user.id}
          onClick={() => void handleRunTestCase(selectedTestCase.id, "local")}
          title={selectedTestCase.automated === "yes" ? "Run the recorded test case locally on your machine" : "Record or automate this test case before starting a local run"}
          type="button"
        >
          <TestCaseRunIcon />
          <span>{isSelectedCaseLocalRunning ? "Starting…" : "Local run"}</span>
        </button>
      ) : null}
      {isCaseWorkspaceOpen ? (
        <button
          className="ghost-button"
          disabled={!appTypeId || !integrations.length || !requirements.length}
          onClick={openAiCaseAuthoring}
          title="Author manual test steps with AI"
          type="button"
        >
          <TestCaseSparkIcon />
          <span>AI steps</span>
        </button>
      ) : null}
      {isCaseWorkspaceOpen ? (
        <button
          className="ghost-button"
          onClick={() => setIsCaseParameterDialogOpen(true)}
          type="button"
        >
          <StepParameterIcon />
          <span>{detectedStepParameters.length ? `Test data · ${detectedStepParameters.length}` : "Test data"}</span>
        </button>
      ) : null}
    </div>
  );
  const getRequirementTitleForCase = (testCase: TestCase) =>
    (testCase.requirement_ids || [testCase.requirement_id]).map((id) => (id ? requirementTitleById[id] || "" : "")).find(Boolean) || "";
  const openLibraryCase = (testCaseId: string) => {
    syncTestCaseSearchParams(testCaseId);
    setSelectedTestCaseId(testCaseId);
    setIsCreating(false);
    setDraftSteps([]);
  };
  const testCaseListColumns = useMemo<Array<DataTableColumn<TestCase>>>(() => [
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
            aria-label="Select all filtered test cases"
            checked={areAllFilteredCasesSelected}
            onChange={(event) =>
              setSelectedActionTestCaseIds((current) =>
                event.target.checked
                  ? [...new Set([...current, ...filteredCases.map((item) => item.id)])]
                  : current.filter((id) => !filteredCases.some((item) => item.id === id))
              )
            }
            type="checkbox"
          />
        </label>
      ),
      render: (testCase) => (
        <div onClick={(event) => event.stopPropagation()}>
          <input
            checked={selectedActionTestCaseIds.includes(testCase.id)}
            onChange={(event) =>
              setSelectedActionTestCaseIds((current) =>
                event.target.checked ? [...new Set([...current, testCase.id])] : current.filter((id) => id !== testCase.id)
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
      width: 120,
      minWidth: 96,
      render: (testCase) => <DisplayIdBadge value={testCase.display_id || testCase.id} />
    },
    {
      key: "title",
      label: "Test case",
      canToggle: false,
      width: 280,
      minWidth: 180,
      render: (testCase) => <strong>{testCase.title}</strong>
    },
    {
      key: "requirement",
      label: "Requirement",
      width: 240,
      minWidth: 160,
      render: (testCase) => getRequirementTitleForCase(testCase) || "No requirement linked"
    },
    {
      key: "description",
      label: "Description",
      defaultVisible: false,
      width: 320,
      minWidth: 180,
      render: (testCase) => testCase.description || "No description yet for this test case."
    },
    {
      key: "externalReferences",
      label: "References",
      defaultVisible: false,
      width: 220,
      minWidth: 150,
      render: (testCase) => formatReferenceList(testCase.external_references) || "—"
    },
    {
      key: "status",
      label: "Status",
      width: 136,
      minWidth: 112,
      render: (testCase) => {
        const history = historyByCaseId[testCase.id] || [];
        const latest = history[0];
        return formatTileCardLabel(latest?.status || testCase.status || defaultTestCaseStatus, "Active");
      }
    },
    {
      key: "automated",
      label: "Automated",
      width: 124,
      minWidth: 104,
      render: (testCase) => (testCase.automated === "yes" ? "Yes" : "No")
    },
    {
      key: "priority",
      label: "Priority",
      width: 104,
      minWidth: 88,
      render: (testCase) => `P${testCase.priority || 3}`
    },
    {
      key: "steps",
      label: "Steps",
      width: 92,
      minWidth: 80,
      render: (testCase) => stepCountByCaseId[testCase.id] || 0
    },
    {
      key: "testSteps",
      label: "Test steps",
      defaultVisible: false,
      width: 380,
      minWidth: 220,
      render: (testCase) => {
        const steps = allStepsByCaseId[testCase.id] || [];

        if (!steps.length) {
          return "No steps yet";
        }

        return (
          <div className="data-table-multiline">
            {steps.map((step, index) => {
              const actionLabel = formatBulkStepActionLabel(step, sharedGroupNameById) || `Step ${index + 1}`;
              const detail = step.expected_result ? `${actionLabel} -> ${step.expected_result}` : actionLabel;

              return (
                <span className="data-table-multiline-line" key={step.id}>
                  {`${index + 1}. ${detail}`}
                </span>
              );
            })}
          </div>
        );
      }
    },
    {
      key: "testData",
      label: "Test data",
      defaultVisible: false,
      width: 260,
      minWidth: 180,
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
      width: 92,
      minWidth: 80,
      render: (testCase) => (testCase.suite_ids || (testCase.suite_id ? [testCase.suite_id] : [])).length || 0
    },
    {
      key: "runs",
      label: "Runs",
      width: 88,
      minWidth: 76,
      render: (testCase) => (historyByCaseId[testCase.id] || []).length
    },
    {
      key: "createdBy",
      label: "Created by",
      defaultVisible: false,
      width: 160,
      minWidth: 124,
      render: (testCase) => resolveAuditUserLabel(testCase.created_by, userById)
    },
    {
      key: "createdAt",
      label: "Created at",
      defaultVisible: false,
      width: 172,
      minWidth: 140,
      render: (testCase) => formatAuditTimestamp(testCase.created_at)
    },
    {
      key: "updatedBy",
      label: "Last updated by",
      defaultVisible: false,
      width: 172,
      minWidth: 132,
      render: (testCase) => resolveAuditUserLabel(testCase.updated_by || testCase.created_by, userById)
    },
    {
      key: "updatedAt",
      label: "Last updated at",
      defaultVisible: false,
      width: 184,
      minWidth: 148,
      render: (testCase) => formatAuditTimestamp(testCase.updated_at || testCase.created_at)
    },
    {
      key: "actions",
      label: "Actions",
      canToggle: false,
      canReorder: false,
      canResize: false,
      width: 92,
      render: (testCase) => {
        const isPendingSchedulerCase =
          testCase.ai_generation_source === "scheduler" && testCase.ai_generation_review_status === "pending";
        const isAcceptingCase = schedulerActionCaseId === testCase.id && schedulerActionKind === "accept";
        const isRejectingCase = schedulerActionCaseId === testCase.id && schedulerActionKind === "reject";
        const rowActions = [
          {
            label: "Open case",
            description: "Open this test case in the workspace.",
            icon: <OpenIcon />,
            onClick: () => openLibraryCase(testCase.id)
          },
          ...(isPendingSchedulerCase
            ? [
              {
                label: "Accept generated case",
                description: "Approve the scheduler-generated test case and keep it.",
                icon: <TestCaseAcceptIcon />,
                onClick: () => void handleReviewGeneratedCase(testCase.id, "accept"),
                disabled: isAcceptingCase || isRejectingCase,
                tone: "primary" as const
              },
              {
                label: "Reject generated case",
                description: "Reject and permanently delete this scheduler-generated case.",
                icon: <TestCaseRejectIcon />,
                onClick: () => void handleReviewGeneratedCase(testCase.id, "reject"),
                disabled: isAcceptingCase || isRejectingCase,
                tone: "danger" as const
              }
            ]
            : [
              {
                label: "Clone case",
                description: "Create a copy with the same steps and test data.",
                icon: <CopyIcon />,
                onClick: () => void handleCloneCase(testCase),
                disabled: createTestCase.isPending
              },
              {
                label: "Export case",
                description: "Download this test case as a CSV file.",
                icon: <ExportIcon />,
                onClick: () => void exportCasesToCsv([testCase], {
                  fileLabel: testCase.title,
                  successMessage: `Exported "${testCase.title}" to CSV.`
                })
              },
              {
                label: "Move to suite",
                description: "Create or pick a suite, then link this case into it.",
                icon: <MoveIcon />,
                onClick: () => {
                  setSelectedActionTestCaseIds([testCase.id]);
                  setIsCreateSuiteModalOpen(true);
                }
              },
              {
                label: "Delete case",
                description: "Remove this test case while preserving run history.",
                icon: <TrashIcon />,
                onClick: () => void handleDeleteCaseItem(testCase),
                disabled: deleteTestCase.isPending,
                tone: "danger" as const
              }
            ])
        ];

        return (
          <div onClick={(event) => event.stopPropagation()}>
            <CatalogActionMenu actions={rowActions} label={`${testCase.title} actions`} />
          </div>
        );
      }
    }
  ], [
    allStepsByCaseId,
    createTestCase.isPending,
    defaultTestCaseAutomated,
    defaultTestCaseStatus,
    deleteTestCase.isPending,
    exportCasesToCsv,
    handleCloneCase,
    handleDeleteCaseItem,
    handleReviewGeneratedCase,
    historyByCaseId,
    openLibraryCase,
    requirementTitleById,
    schedulerActionCaseId,
    schedulerActionKind,
    selectedActionTestCaseIds,
    sharedGroupNameById,
    stepCountByCaseId,
    userById
  ]);

  const isMatchingStepInsertContext = (groupContext: StepInsertionGroupContext | null = null) =>
    (stepInsertGroupContext?.group_id || null) === (groupContext?.group_id || null);

  const renderStepInsertSlot = (index: number, groupContext: StepInsertionGroupContext | null = null) => (
    <InlineStepInsertSlot
      draft={newStepDraft}
      index={index}
      isActive={stepInsertIndex === index && isMatchingStepInsertContext(groupContext)}
      onCancel={cancelStepInsert}
      onChange={setNewStepDraft}
      onSubmit={(event) => void handleCreateStep(event)}
    />
  );

  const renderStepCard = (step: TestStep, index: number, groupContext: StepInsertionGroupContext | null = null) => {
    const insertAboveIndex = Math.max(0, step.step_order - 1);
    const insertBelowIndex = step.step_order;
    const stepDraft = stepDrafts[step.id] || {
      action: step.action || "",
      expected_result: step.expected_result || "",
      step_type: normalizeStepType(step.step_type),
      automation_code: normalizeAutomationCode(step.automation_code),
      api_request: normalizeApiRequest(step.api_request)
    };
    const previousStep = displaySteps[index - 1];
    const nextStep = displaySteps[index + 1];
    const canMoveUp = step.group_id ? Boolean(previousStep && previousStep.group_id === step.group_id) : index > 0;
    const canMoveDown = step.group_id ? Boolean(nextStep && nextStep.group_id === step.group_id) : index < displaySteps.length - 1;

    if (isCreating) {
      return (
        <DraftStepCard
          parameterValues={mergedScopedParameterValues}
          canPaste={Boolean(copiedSteps.length)}
          canMoveDown={canMoveDown}
          canMoveUp={canMoveUp}
          isExpanded={expandedStepIds.includes(step.id)}
          isRephrasing={rephrasingStepId === step.id}
          isSelected={selectedStepIds.includes(step.id)}
          onChange={(input) => handleUpdateDraftStep(step.id, input)}
          onCopy={() => handleCopySteps([step.id])}
          onCut={() => handleCutSteps([step.id])}
          onDelete={() => void handleDeleteStep(step.id)}
          onInsertAbove={() => activateStepInsert(insertAboveIndex, groupContext)}
          onInsertBelow={() => activateStepInsert(insertBelowIndex, groupContext)}
          onMoveDown={() => handleReorderDraftStep(step.id, "down")}
          onMoveUp={() => handleReorderDraftStep(step.id, "up")}
          onChangeStepType={(nextType) => void handleChangeStepType(step.id, nextType)}
          onEditAutomation={() => setEditingAutomationStepId(step.id)}
          onRephrase={() => void handleRephraseStepWithAi(step)}
          onPasteAbove={() => void handlePasteSteps(insertAboveIndex, groupContext)}
          onPasteBelow={() => void handlePasteSteps(insertBelowIndex, groupContext)}
          onToggle={() =>
            setExpandedStepIds((current) =>
              current.includes(step.id) ? current.filter((id) => id !== step.id) : [...current, step.id]
            )
          }
          onToggleSelect={(checked) =>
            setSelectedStepIds((current) =>
              checked ? [...new Set([...current, step.id])] : current.filter((id) => id !== step.id)
            )
          }
          step={{
            id: step.id,
            step_order: step.step_order,
            action: step.action || "",
            expected_result: step.expected_result || "",
            step_type: normalizeStepType(step.step_type),
            automation_code: normalizeAutomationCode(step.automation_code),
            api_request: normalizeApiRequest(step.api_request),
            group_id: step.group_id || null,
            group_name: step.group_name || null,
            group_kind: step.group_kind || null,
            reusable_group_id: step.reusable_group_id || null
          }}
        />
      );
    }

      return (
        <EditableStepCard
          parameterValues={mergedScopedParameterValues}
          canPaste={Boolean(copiedSteps.length)}
        canMoveDown={canMoveDown}
        canMoveUp={canMoveUp}
        draft={stepDraft}
        isExpanded={expandedStepIds.includes(step.id)}
        isRephrasing={rephrasingStepId === step.id}
        isSelected={selectedStepIds.includes(step.id)}
        onChangeStepType={(nextType) => void handleChangeStepType(step.id, nextType)}
        onCopy={() => handleCopySteps([step.id])}
        onCut={() => handleCutSteps([step.id])}
        onDelete={() => void handleDeleteStep(step.id)}
        onEditAutomation={() => setEditingAutomationStepId(step.id)}
        onRephrase={() => void handleRephraseStepWithAi(step)}
        onInsertAbove={() => activateStepInsert(insertAboveIndex, groupContext)}
        onInsertBelow={() => activateStepInsert(insertBelowIndex, groupContext)}
        onMoveDown={() => void handleReorderStep(step.id, "down")}
        onMoveUp={() => void handleReorderStep(step.id, "up")}
        onPasteAbove={() => void handlePasteSteps(insertAboveIndex, groupContext)}
        onPasteBelow={() => void handlePasteSteps(insertBelowIndex, groupContext)}
        onSave={(input) => void handleUpdateStep(step, input)}
        onDraftChange={(input) =>
          setStepDrafts((current) => ({
            ...current,
            [step.id]: input
          }))
        }
        onToggle={() =>
          setExpandedStepIds((current) =>
            current.includes(step.id) ? current.filter((id) => id !== step.id) : [...current, step.id]
          )
        }
        onToggleSelect={(checked) =>
          setSelectedStepIds((current) =>
            checked ? [...new Set([...current, step.id])] : current.filter((id) => id !== step.id)
          )
        }
        step={step}
      />
    );
  };

  const editingAutomationStep = editingAutomationStepId
    ? displaySteps.find((step) => step.id === editingAutomationStepId) || null
    : null;

  const openCaseAutomationPreview = () => {
    setCodePreviewState({
      title: "Test case automation",
      subtitle: "This consolidated view is read-only here. Edit automation from individual steps.",
      code: buildCaseAutomationCode(caseDraft.title || selectedTestCase?.title || "Test case", displaySteps)
    });
  };

  const openGroupAutomationPreview = (groupName: string, groupSteps: TestStep[]) => {
    setCodePreviewState({
      title: `${groupName} automation`,
      subtitle: "This consolidated group view is read-only. Update code from the steps inside the group.",
      code: buildGroupAutomationCode(groupName, groupSteps)
    });
  };

  const handleChangeStepType = async (stepId: string, nextType: TestStep["step_type"]) => {
    const targetStep = displaySteps.find((step) => step.id === stepId);

    if (!targetStep || !nextType) {
      return;
    }

    if (isCreating) {
      setDraftSteps((current) =>
        current.map((step) =>
          step.id === stepId
            ? {
                ...step,
                step_type: normalizeStepType(nextType)
              }
            : step
        )
      );
      setStepDrafts((current) => ({
        ...current,
        [stepId]: {
          ...(current[stepId] || {
            action: targetStep.action || "",
            expected_result: targetStep.expected_result || "",
            automation_code: normalizeAutomationCode(targetStep.automation_code),
            api_request: normalizeApiRequest(targetStep.api_request),
            step_type: normalizeStepType(targetStep.step_type)
          }),
          step_type: normalizeStepType(nextType)
        }
      }));
      return;
    }

    try {
      await updateStep.mutateAsync({
        id: stepId,
        input: {
          step_type: normalizeStepType(nextType)
        }
      });
      setStepDrafts((current) => ({
        ...current,
        [stepId]: {
          ...(current[stepId] || {
            action: targetStep.action || "",
            expected_result: targetStep.expected_result || "",
            automation_code: normalizeAutomationCode(targetStep.automation_code),
            api_request: normalizeApiRequest(targetStep.api_request),
            step_type: normalizeStepType(targetStep.step_type)
          }),
          step_type: normalizeStepType(nextType)
        }
      }));
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (targetStep.reusable_group_id) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to update step type");
    }
  };

  const handleSaveStepAutomation = async (
    stepId: string,
    input: { step_type: TestStep["step_type"]; automation_code: string; api_request: TestStep["api_request"] }
  ) => {
    const targetStep = displaySteps.find((step) => step.id === stepId);

    if (!targetStep || !input.step_type) {
      return;
    }

    const nextDraft = {
      ...(stepDrafts[stepId] || {
        action: targetStep.action || "",
        expected_result: targetStep.expected_result || "",
        step_type: normalizeStepType(targetStep.step_type),
        automation_code: normalizeAutomationCode(targetStep.automation_code),
        api_request: normalizeApiRequest(targetStep.api_request)
      }),
      step_type: normalizeStepType(input.step_type),
      automation_code: normalizeAutomationCode(input.automation_code),
      api_request: normalizeApiRequest(input.api_request)
    };

    if (isCreating) {
      setDraftSteps((current) =>
        current.map((step) =>
          step.id === stepId
            ? {
                ...step,
                step_type: nextDraft.step_type,
                automation_code: nextDraft.automation_code,
                api_request: nextDraft.api_request
              }
            : step
        )
      );
      setStepDrafts((current) => ({
        ...current,
        [stepId]: nextDraft
      }));
      setEditingAutomationStepId("");
      showSuccess("Step automation updated.");
      return;
    }

    try {
      await updateStep.mutateAsync({
        id: stepId,
        input: {
          step_type: nextDraft.step_type,
          automation_code: nextDraft.automation_code,
          api_request: nextDraft.api_request || {}
        }
      });
      setStepDrafts((current) => ({
        ...current,
        [stepId]: nextDraft
      }));
      setEditingAutomationStepId("");
      showSuccess("Step automation updated.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (targetStep.reusable_group_id) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to update step automation");
    }
  };

  return (
    <div className={["page-content", "page-content--library-full", isCaseWorkspaceOpen ? "page-content--workspace-focus" : ""].join(" ")}>
      {confirmationDialog}
      {!isCaseWorkspaceOpen ? (
        <PageHeader
          className="page-header--test-cases"
          eyebrow="Test Cases"
          title="Test Case Library"
          description="Build reusable coverage with clean step detail, requirement traceability, suite linkage, and run-ready exports."
          meta={[
            { label: "Cases", value: coverageMetrics.total },
            { label: "Mapped", value: coverageMetrics.covered },
            { label: "Automated", value: coverageMetrics.automated }
          ]}
          actions={
            <>
              <button className="ghost-button" disabled={!appTypeId} onClick={() => {
                setImportBatches([]);
                setImportFileWarnings([]);
                setImportSourceSelection("auto");
                setIsImportModalOpen(true);
              }} type="button">
                <TestCaseImportIcon />
                <span>Bulk Import</span>
              </button>
              <button className="ghost-button" disabled={!requirements.length || !appTypeId} onClick={openAiStudio} type="button">
                <TestCaseSparkIcon />
                <span>AI Test Case Generation</span>
              </button>
              <button className="ghost-button" disabled={!filteredCases.length} onClick={() => void handleExportCsv()} type="button">
                <TestCaseExportIcon />
                <span>Export test cases</span>
              </button>
              <button className="primary-button" disabled={!appTypeId} onClick={() => beginCreateCase()} type="button">
                <TestCaseCreateIcon />
                <span>New Test Case</span>
              </button>
            </>
          }
        />
      ) : null}

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

      {generationQueueSummary ? (
        <div className="inline-message success-message">
          <strong>{generationQueueSummary.title}</strong>
          <span>{generationQueueSummary.detail}</span>
        </div>
      ) : null}

      {!isCaseWorkspaceOpen ? (
        <WorkspaceScopeBar
          appTypeId={appTypeId}
          appTypes={appTypes}
          onAppTypeChange={(value) => {
            clearScopedSearchParams();
            setAppTypeId(value);
            setSelectedExecutionAssigneeId("");
            resetExecutionContextSelection();
          }}
          onProjectChange={(value) => {
            clearScopedSearchParams();
            setProjectId(value);
            setSelectedExecutionAssigneeId("");
            resetExecutionContextSelection();
          }}
          projectId={projectId}
          projects={projects}
        />
      ) : null}

      <WorkspaceSectionTabs ariaLabel="Test authoring sections" items={authoringSectionItems} />

      <WorkspaceMasterDetail
        browseView={(
          <Panel title="Test case tiles" subtitle={appTypeId ? "Browse reusable coverage as cards first, then open one case into a full-page editor." : "Choose an app type to begin."}>
            <div className="design-list-toolbar test-case-catalog-toolbar">
              <CatalogViewToggle onChange={setCatalogViewMode} value={catalogViewMode} />
              <CatalogSearchFilter
                activeFilterCount={activeCaseFilterCount}
                ariaLabel="Search test cases"
                onChange={setSearchTerm}
                placeholder="Search title, description, or requirement"
                subtitle="Filter the case tiles by the status and facts shown on each card."
                title="Filter test cases"
                value={searchTerm}
              >
                <div className="catalog-filter-grid">
                  <label className="catalog-filter-field">
                    <span>Status</span>
                    <select value={caseStatusFilter} onChange={(event) => setCaseStatusFilter(event.target.value)}>
                      <option value="all">All statuses</option>
                      {caseStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {formatTileCardLabel(status, "Active")}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="catalog-filter-field">
                    <span>Priority</span>
                    <select value={casePriorityFilter} onChange={(event) => setCasePriorityFilter(event.target.value)}>
                      <option value="all">All priorities</option>
                      {casePriorityOptions.map((priority) => (
                        <option key={priority} value={priority}>
                          {`P${priority}`}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="catalog-filter-field">
                    <span>Steps</span>
                    <select value={caseStepFilter} onChange={(event) => setCaseStepFilter(event.target.value as CaseStepFilter)}>
                      <option value="all">All cases</option>
                      <option value="with-steps">With steps</option>
                      <option value="no-steps">Without steps</option>
                    </select>
                  </label>

                  <label className="catalog-filter-field">
                    <span>Recent runs</span>
                    <select value={caseRunFilter} onChange={(event) => setCaseRunFilter(event.target.value as CaseRunFilter)}>
                      <option value="all">All cases</option>
                      <option value="with-runs">With recent runs</option>
                      <option value="no-runs">No recent runs</option>
                    </select>
                  </label>

                  <div className="catalog-filter-actions">
                    <button
                      className="ghost-button"
                      disabled={!activeCaseFilterCount}
                      onClick={() => {
                        setCaseStatusFilter("all");
                        setCasePriorityFilter("all");
                        setCaseStepFilter("all");
                        setCaseRunFilter("all");
                      }}
                      type="button"
                    >
                      <TestCaseClearIcon />
                      Clear filters
                    </button>
                  </div>
                </div>
              </CatalogSearchFilter>
              <button
                className="ghost-button"
                disabled={!filteredCases.length || areAllFilteredCasesSelected}
                onClick={() =>
                  setSelectedActionTestCaseIds((current) => [...new Set([...current, ...filteredCases.map((item) => item.id)])])
                }
                type="button"
              >
                <TestCaseSelectAllIcon />
                <span>Select All</span>
              </button>
              <button
                className="ghost-button"
                disabled={!selectedActionTestCaseIds.length}
                onClick={() => setSelectedActionTestCaseIds([])}
                type="button"
              >
                <TestCaseClearIcon />
                <span>Clear</span>
              </button>
              <button className="ghost-button" disabled={!appTypeId} onClick={() => setIsCreateSuiteModalOpen(true)} type="button">
                <TileCardSuiteIcon />
                <span>Create suite</span>
              </button>
              <button
                className="ghost-button"
                disabled={!appTypeId || !selectedManualAutomationCases.length || buildBatchAutomation.isPending}
                onClick={() => void handleScheduleSelectedManualAutomation()}
                type="button"
              >
                <TestCaseSparkIcon />
                <span>{buildBatchAutomation.isPending ? "Scheduling..." : `Schedule AI automation${selectedManualAutomationCases.length ? ` (${selectedManualAutomationCases.length})` : ""}`}</span>
              </button>
              <button
                className="ghost-button"
                disabled={!selectedPendingGeneratedCases.length || schedulerActionCaseId === "bulk"}
                onClick={() => void handleReviewSelectedGeneratedCases("accept")}
                type="button"
              >
                <TestCaseAcceptIcon />
                <span>{schedulerActionCaseId === "bulk" && schedulerActionKind === "accept" ? "Accepting..." : `Accept generated${selectedPendingGeneratedCases.length ? ` (${selectedPendingGeneratedCases.length})` : ""}`}</span>
              </button>
              <button
                className="ghost-button danger"
                disabled={!selectedPendingGeneratedCases.length || schedulerActionCaseId === "bulk"}
                onClick={() => void handleReviewSelectedGeneratedCases("reject")}
                type="button"
              >
                <TestCaseRejectIcon />
                <span>{schedulerActionCaseId === "bulk" && schedulerActionKind === "reject" ? "Rejecting..." : `Reject generated${selectedPendingGeneratedCases.length ? ` (${selectedPendingGeneratedCases.length})` : ""}`}</span>
              </button>
              <button
                className="ghost-button"
                disabled={!projectId || !appTypeId || !selectedActionTestCaseIds.length || !session?.user.id}
                onClick={() => setIsCreateExecutionModalOpen(true)}
                type="button"
              >
                <TestCaseRunIcon />
                <span>Create Run</span>
              </button>
              <button
                className="ghost-button danger"
                disabled={!selectedActionTestCaseIds.length || isDeletingSelectedTestCases}
                onClick={() => void handleDeleteSelectedCases()}
                type="button"
              >
                <TestCaseDeleteIcon />
                <span>{isDeletingSelectedTestCases ? "Deleting…" : `Delete${selectedActionTestCaseIds.length ? ` (${selectedActionTestCaseIds.length})` : ""}`}</span>
              </button>
              <button className="ghost-button" disabled={!appTypeId} onClick={() => beginCreateCase()} type="button">
                <TestCaseCreateIcon />
                <span>New case</span>
              </button>
            </div>

            {selectedActionTestCaseIds.length ? (
              <div className="detail-summary test-case-selection-summary">
                <strong>{selectedActionTestCaseIds.length} test case{selectedActionTestCaseIds.length === 1 ? "" : "s"} selected for bulk actions</strong>
                <span>Use the checked cases to create a suite, create a run, schedule manual cases for AI automation, or bulk delete them. Open any tile body to keep editing one case at a time.</span>
              </div>
            ) : null}

            <TileBrowserPane className="test-case-library-scroll">
              {isLibraryLoading ? <TileCardSkeletonGrid /> : null}

              {!isLibraryLoading && filteredCases.length && catalogViewMode === "tile" ? (
                <div className="tile-browser-grid">
                  {filteredCases.map((testCase) => {
                    const isSelectedForAction = selectedActionTestCaseIds.includes(testCase.id);
                    const isActive = selectedTestCaseId === testCase.id && !isCreating;
                    const history = (historyByCaseId[testCase.id] || []).slice(0, 10);
                    const latest = history[0];
                    const requirementTitle =
                      (testCase.requirement_ids || [testCase.requirement_id]).map((id) => (id ? requirementTitleById[id] || "" : "")).find(Boolean) || "";
                    const stepCount = stepCountByCaseId[testCase.id] || 0;
                    const caseStatusValue = latest?.status || testCase.status || defaultTestCaseStatus;
                    const suiteCount = (testCase.suite_ids || []).length || 0;
                    const isPendingSchedulerCase =
                      testCase.ai_generation_source === "scheduler" && testCase.ai_generation_review_status === "pending";
                    const isRunningCase = schedulerActionCaseId === testCase.id && schedulerActionKind === "run";
                    const isAcceptingCase = schedulerActionCaseId === testCase.id && schedulerActionKind === "accept";
                    const isRejectingCase = schedulerActionCaseId === testCase.id && schedulerActionKind === "reject";
                    const tileActions = [
                      {
                        label: "Open case",
                        description: "Open this test case in the workspace.",
                        icon: <OpenIcon />,
                        onClick: () => openLibraryCase(testCase.id)
                      },
                      ...(isPendingSchedulerCase
                        ? [
                          {
                            label: "Accept generated case",
                            description: "Approve the scheduler-generated test case and keep it.",
                            icon: <TestCaseAcceptIcon />,
                            onClick: () => void handleReviewGeneratedCase(testCase.id, "accept"),
                            disabled: isAcceptingCase || isRejectingCase || isRunningCase,
                            tone: "primary" as const
                          },
                          {
                            label: "Reject generated case",
                            description: "Reject and permanently delete this scheduler-generated case.",
                            icon: <TestCaseRejectIcon />,
                            onClick: () => void handleReviewGeneratedCase(testCase.id, "reject"),
                            disabled: isAcceptingCase || isRejectingCase || isRunningCase,
                            tone: "danger" as const
                          }
                        ]
                        : [
                          {
                            label: "Clone case",
                            description: "Create a copy with the same steps and test data.",
                            icon: <CopyIcon />,
                            onClick: () => void handleCloneCase(testCase),
                            disabled: createTestCase.isPending
                          },
                          {
                            label: "Export case",
                            description: "Download this test case as a CSV file.",
                            icon: <ExportIcon />,
                            onClick: () => void exportCasesToCsv([testCase], {
                              fileLabel: testCase.title,
                              successMessage: `Exported "${testCase.title}" to CSV.`
                            })
                          },
                          {
                            label: "Move to suite",
                            description: "Create or pick a suite, then link this case into it.",
                            icon: <MoveIcon />,
                            onClick: () => {
                              setSelectedActionTestCaseIds([testCase.id]);
                              setIsCreateSuiteModalOpen(true);
                            }
                          },
                          {
                            label: "Delete case",
                            description: "Remove this test case while preserving run history.",
                            icon: <TrashIcon />,
                            onClick: () => void handleDeleteCaseItem(testCase),
                            disabled: deleteTestCase.isPending,
                            tone: "danger" as const
                          }
                        ])
                    ];

                    return (
                      <div
                        aria-pressed={isActive}
                        className={[
                          "record-card tile-card test-case-card test-case-catalog-card",
                          isActive ? "is-active" : "",
                          isSelectedForAction ? "is-marked-for-delete" : ""
                        ].filter(Boolean).join(" ")}
                        key={testCase.id}
                        onClick={() => {
                          syncTestCaseSearchParams(testCase.id);
                          setSelectedTestCaseId(testCase.id);
                          setIsCreating(false);
                          setDraftSteps([]);
                        }}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) {
                            return;
                          }

                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            syncTestCaseSearchParams(testCase.id);
                            setSelectedTestCaseId(testCase.id);
                            setIsCreating(false);
                            setDraftSteps([]);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="tile-card-main">
                          <div className="tile-card-select-row">
                            <label className="checkbox-field test-case-delete-checkbox" onClick={(event) => event.stopPropagation()}>
                              <input
                                checked={isSelectedForAction}
                                onChange={(event) =>
                                  setSelectedActionTestCaseIds((current) =>
                                    event.target.checked ? [...new Set([...current, testCase.id])] : current.filter((id) => id !== testCase.id)
                                  )
                                }
                                type="checkbox"
                              />
                              <DisplayIdBadge value={testCase.display_id || testCase.id} />
                            </label>
                            <div className="catalog-inline-actions test-case-top-actions">
                              {isPendingSchedulerCase ? (
                                <>
                                  <TestCaseTileActionButton
                                    className="is-accept"
                                    disabled={isAcceptingCase || isRejectingCase || isRunningCase}
                                    onClick={() => void handleReviewGeneratedCase(testCase.id, "accept")}
                                    title="Accept scheduler-generated test case"
                                  >
                                    <TestCaseAcceptIcon />
                                  </TestCaseTileActionButton>
                                  <TestCaseTileActionButton
                                    className="is-reject"
                                    disabled={isAcceptingCase || isRejectingCase || isRunningCase}
                                    onClick={() => void handleReviewGeneratedCase(testCase.id, "reject")}
                                    title="Reject and permanently delete scheduler-generated test case"
                                  >
                                    <TestCaseRejectIcon />
                                  </TestCaseTileActionButton>
                                </>
                              ) : null}
                              <TestCaseTileActionButton
                                className="is-run"
                                disabled={isRunningCase || isAcceptingCase || isRejectingCase || !projectId || !appTypeId || !session?.user.id}
                                onClick={() => void handleRunTestCase(testCase.id)}
                                title="Run test case in Test Runs"
                              >
                                <TestCaseRunIcon />
                              </TestCaseTileActionButton>
                              <div onClick={(event) => event.stopPropagation()}>
                                <CatalogActionMenu actions={tileActions} label={`${testCase.title} actions`} />
                              </div>
                            </div>
                          </div>
                          <div className="tile-card-header">
                            <div className="tile-card-title-group">
                              <strong>{testCase.title}</strong>
                              <span className="tile-card-kicker">
                                <TileCardRequirementIcon />
                                <span>{requirementTitle || "No requirement linked"}</span>
                              </span>
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
                              title={`${suiteCount} suite${suiteCount === 1 ? "" : "s"} linked to this case`}
                              tone={suiteCount ? "info" : "neutral"}
                            >
                              <TileCardSuiteIcon />
                            </TileCardFact>
                            <TileCardFact
                              label={String(history.length)}
                              title={`${history.length} recent run${history.length === 1 ? "" : "s"}`}
                              tone={history.length ? getTileCardTone(latest?.status || caseStatusValue) : "neutral"}
                            >
                              <TestCaseRunIcon />
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
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {!isLibraryLoading && filteredCases.length && catalogViewMode === "list" ? (
                <DataTable
                  columns={testCaseListColumns}
                  enableColumnResize
                  enableHeaderColumnReorder
                  emptyMessage="No test cases match the current search."
                  getRowClassName={(testCase) => (selectedTestCaseId === testCase.id && !isCreating ? "is-active-row" : "")}
                  getRowKey={(testCase) => testCase.id}
                  hideToolbarCopy
                  onRowClick={(testCase) => openLibraryCase(testCase.id)}
                  rows={filteredCases}
                  storageKey="qaira:test-cases:list-columns"
                />
              ) : null}
              {!isLibraryLoading && !filteredCases.length ? (
                testCases.length ? (
                  <div className="empty-state compact">No test cases match the current search.</div>
                ) : (
                  <div className="empty-state compact">
                    <div>No test cases exist for this app type yet.</div>
                    <button className="primary-button" disabled={!appTypeId} onClick={() => beginCreateCase()} type="button">Create first case</button>
                  </div>
                )
              ) : null}
            </TileBrowserPane>
          </Panel>
        )}
        detailView={(
          <Panel
            actions={caseHeaderActions}
            title="Test case workspace"
            subtitle={selectedTestCaseId || isCreating ? "Switch between case details and step editing without losing the selected context." : "Select a test case or create a new one."}
          >
            {selectedTestCaseId || isCreating ? (
              <div className="detail-stack">
                <div className="editor-accordion">
                  <div ref={caseSectionRef}>
                    <EditorAccordionSection
                      countLabel={isCreating ? "Draft" : caseDraft.status || defaultTestCaseStatus}
                      isExpanded={expandedSections.case}
                      onToggle={() => setExpandedSections((current) => ({ ...current, case: !current.case }))}
                      summary={caseSectionSummary}
                      title={isCreating ? "New test case" : "Selected test case"}
                    >
                      <form className="form-grid" onSubmit={(event) => void handleSaveCase(event)}>
                        {hasReadableCasePreview ? (
                          <div className="step-parameter-preview">
                            <span className="step-parameter-preview-label">Readable preview on this screen</span>
                            <strong>{readableCaseTitle || "No title written yet"}</strong>
                            <span>{readableCaseDescription || "Description, step cards, and section summaries will resolve saved values here without changing the stored authoring text."}</span>
                          </div>
                        ) : null}

                        <div className="record-grid">
                          <FormField label="Title" required>
                            <input
                              required
                              value={caseDraft.title}
                              onChange={(event) => setCaseDraft((current) => ({ ...current, title: event.target.value }))}
                            />
                          </FormField>
                          <FormField label="Status">
                            <select
                              value={caseDraft.status}
                              onChange={(event) => setCaseDraft((current) => ({ ...current, status: event.target.value }))}
                            >
                              {testCaseStatusOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </FormField>
                          <FormField label="Automated">
                            <select
                              value={caseDraft.automated}
                              onChange={(event) =>
                                setCaseDraft((current) => ({ ...current, automated: event.target.value as "yes" | "no" }))
                              }
                            >
                              {testCaseAutomatedOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </FormField>
                          <FormField label="Requirement">
                            <select
                              value={caseDraft.requirement_id}
                              onChange={(event) => setCaseDraft((current) => ({ ...current, requirement_id: event.target.value }))}
                            >
                              <option value="">No requirement</option>
                              {requirements.map((requirement: Requirement) => (
                                <option key={requirement.id} value={requirement.id}>{requirement.title}</option>
                              ))}
                            </select>
                          </FormField>
                          <FormField label="Priority">
                            <input
                              min="1"
                              max="5"
                              type="number"
                              value={caseDraft.priority}
                              onChange={(event) => setCaseDraft((current) => ({ ...current, priority: Number(event.target.value) || 3 }))}
                            />
                          </FormField>
                        </div>
                        <FormField label="Description">
                          <textarea
                            rows={4}
                            value={caseDraft.description}
                            onChange={(event) => setCaseDraft((current) => ({ ...current, description: event.target.value }))}
                          />
                        </FormField>
                        <FormField label="External references" hint="Ticket links or IDs, separated with commas.">
                          <input
                            value={caseDraft.externalReferencesText}
                            onChange={(event) => setCaseDraft((current) => ({ ...current, externalReferencesText: event.target.value }))}
                          />
                        </FormField>

                        {selectedCaseSuites.length ? (
                          <div className="detail-summary">
                            <strong>{isCreating ? "Suite link ready" : "Suite references"}</strong>
                            <span>
                              {isCreating
                                ? `This new test case will open in the full editor and save into the "${selectedCaseSuites[0].name}" suite.`
                                : `This test case is currently referenced in ${selectedCaseSuites.length} suite${selectedCaseSuites.length === 1 ? "" : "s"}.`}
                            </span>
                            <div className="selection-chip-row">
                              {selectedCaseSuites.map((suite) => (
                                <span className="selection-chip" key={suite.id}>
                                  {suite.name}
                                </span>
                              ))}
                            </div>
                            {!isCreating && selectedTestCase ? (
                              <div className="action-row">
                                <button className="ghost-button" onClick={handleOpenSuiteLinkModal} type="button">
                                  <AddIcon />
                                  <span>Manage suite links</span>
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : !isCreating && selectedTestCase ? (
                          <div className="detail-summary">
                            <strong>Suite references</strong>
                            <span>This test case is not linked to any suite yet.</span>
                            <div className="action-row">
                              <button className="ghost-button" onClick={handleOpenSuiteLinkModal} type="button">
                                <AddIcon />
                                <span>Link to suite</span>
                              </button>
                            </div>
                          </div>
                        ) : null}

                        <div className="action-row">
                          <button className="primary-button" disabled={createTestCase.isPending || updateTestCase.isPending} type="submit">
                            {isCreating ? (createTestCase.isPending ? "Creating…" : "Create test case") : (updateTestCase.isPending ? "Saving…" : "Save test case")}
                          </button>
                          {isCreating ? (
                            <button
                              className="ghost-button"
                              onClick={() => {
                                setCreateSuiteContextId("");
                                setIsCreating(false);
                                setDraftSteps([]);
                                setNewStepDraft(EMPTY_STEP_DRAFT);
                                setStepInsertIndex(null);
                                setStepInsertGroupContext(null);
                                setSelectedStepIds([]);
                              }}
                              type="button"
                            >
                              Cancel new case
                            </button>
                          ) : null}
                          {!isCreating && selectedTestCase ? (
                            <button className="ghost-button danger" onClick={() => void handleDeleteCase()} type="button">
                              Delete test case
                            </button>
                          ) : null}
                        </div>
                      </form>
                    </EditorAccordionSection>
                  </div>

                  <EditorAccordionSection
                    actions={(
                      <>
                        <button
                          className="ghost-button"
                          onClick={() => setIsVisualBuilderActive((current) => !current)}
                          type="button"
                        >
                          <TileCardStepsIcon />
                          <span>{isVisualBuilderActive ? "List view" : "Visual builder"}</span>
                        </button>
                        <button
                          className="ghost-button"
                          disabled={!displaySteps.length}
                          onClick={openCaseAutomationPreview}
                          type="button"
                        >
                          <AutomationCodeIcon />
                          <span>Automation code</span>
                        </button>
                      </>
                    )}
                    countLabel={stepCountLabel}
                    isExpanded={expandedSections.steps}
                    onToggle={() => setExpandedSections((current) => ({ ...current, steps: !current.steps }))}
                    summary={stepSectionSummary}
                    title={isCreating ? "Draft steps" : "Test steps"}
                  >
                    {isVisualBuilderActive ? (
                      <VisualTestBuilder testSteps={displaySteps} />
                    ) : (
                    <div className="step-editor step-editor--embedded">
                      <div className="step-editor-toolbar">
                        <label className="checkbox-field step-select-all">
                          <input
                            checked={allStepsSelected}
                            disabled={!displaySteps.length}
                            onChange={(event) =>
                              setSelectedStepIds(event.target.checked ? displaySteps.map((step) => step.id) : [])
                            }
                            type="checkbox"
                          />
                          Select all steps
                        </label>
                        <StepActionMenu
                          className="step-card-menu--inline step-card-menu--inline-right"
                          label="Test step actions"
                          openOnHover
                          previewActions={editorStepActions}
                          actions={editorStepActions}
                        />
                      </div>

      {copiedSteps.length ? null : null}

      {!isCreating && stepsQuery.isLoading ? <div className="empty-state compact">Loading steps…</div> : null}

      <div className="step-list">
                        {!displaySteps.length ? (
                          <>
                            <div className="step-empty-insert">
                              <StepIconButton ariaLabel="Add first step" onClick={() => activateStepInsert(0, null)} title="Add first step" type="button">
                                <StepInsertIcon />
                              </StepIconButton>
                            </div>
                            {renderStepInsertSlot(0, null)}
                          </>
                        ) : null}

                        {stepBlocks.map((block) => {
                          if (block.group_id) {
                            const firstStep = block.steps[0];
                            const lastStep = block.steps[block.steps.length - 1];
                            const isGroupExpanded = expandedStepGroupIds.includes(block.group_id);
                            const blockIndex = stepBlocks.findIndex((item) => item.key === block.key);
                            const canMoveGroupUp = blockIndex > 0;
                            const canMoveGroupDown = blockIndex < stepBlocks.length - 1;
                            const blockGroupContext: StepInsertionGroupContext = {
                              group_id: block.group_id,
                              group_name: block.group_name,
                              group_kind: block.group_kind || null,
                              reusable_group_id: block.reusable_group_id
                            };

                            return (
                              <Fragment key={block.key}>
                                {renderStepInsertSlot(Math.max(0, firstStep.step_order - 1))}
                                <div
                                  className={[
                                    isGroupExpanded ? "step-group-block is-expanded" : "step-group-block is-collapsed",
                                    block.group_kind === "reusable" ? "is-shared-group" : "is-local-group"
                                  ].join(" ")}
                                >
                                  <StepGroupHeader
                                    isExpanded={isGroupExpanded}
                                    kind={block.group_kind}
                                    name={block.group_name || "Step group"}
                                    canMoveUp={canMoveGroupUp}
                                    canMoveDown={canMoveGroupDown}
                                    onConvertToLocal={() =>
                                      void handleConvertStepGroup(
                                        block.group_id as string,
                                        block.group_name || "Step group",
                                        block.steps,
                                        "local"
                                      )
                                    }
                                    onConvertToShared={() =>
                                      void handleConvertStepGroup(
                                        block.group_id as string,
                                        block.group_name || "Step group",
                                        block.steps,
                                        "reusable"
                                      )
                                    }
                                    onToggle={() =>
                                      setExpandedStepGroupIds((current) =>
                                        current.includes(block.group_id as string)
                                          ? current.filter((id) => id !== block.group_id)
                                          : [...current, block.group_id as string]
                                      )
                                    }
                                    onMoveUp={() => void handleMoveStepGroup(block.group_id as string, "up")}
                                    onMoveDown={() => void handleMoveStepGroup(block.group_id as string, "down")}
                                    onPreviewCode={() => openGroupAutomationPreview(block.group_name || "Step group", block.steps)}
                                    onRemoveGroup={() => void handleRemoveStepGroup(block.group_id as string, block.steps, block.group_kind)}
                                    onUngroup={() => void handleUngroupStepGroup(block.group_id as string, block.group_kind)}
                                    onToggleSelect={(checked) => {
                                      const groupStepIds = block.steps.map((step) => step.id);
                                      if (checked) {
                                        setSelectedStepIds((current) => Array.from(new Set([...current, ...groupStepIds])));
                                      } else {
                                        setSelectedStepIds((current) => current.filter((id) => !groupStepIds.includes(id)));
                                      }
                                    }}
                                    selectionState={(() => {
                                      const groupStepIds = block.steps.map((step) => step.id);
                                      const selectedCount = groupStepIds.filter((id) => selectedStepIds.includes(id)).length;
                                      if (!selectedCount) {
                                        return "none";
                                      }
                                      if (selectedCount === groupStepIds.length) {
                                        return "all";
                                      }
                                      return "some";
                                    })()}
                                    stepCount={block.steps.length}
                                  />
                                  {isGroupExpanded ? (
                                    <div className="step-group-block-body">
                                      {block.steps.map((step) => {
                                        const stepIndex = displaySteps.findIndex((item) => item.id === step.id);

                                        return (
                                          <Fragment key={step.id}>
                                            {renderStepInsertSlot(Math.max(0, step.step_order - 1), blockGroupContext)}
                                            {renderStepCard(step, stepIndex, blockGroupContext)}
                                          </Fragment>
                                        );
                                      })}
                                      {renderStepInsertSlot(lastStep.step_order, blockGroupContext)}
                                    </div>
                                  ) : null}
                                </div>
                                {lastStep.id === displaySteps[displaySteps.length - 1]?.id ? renderStepInsertSlot(lastStep.step_order) : null}
                              </Fragment>
                            );
                          }

                          const step = block.steps[0];
                          const stepIndex = displaySteps.findIndex((item) => item.id === step.id);

                          return (
                            <Fragment key={block.key}>
                              {renderStepInsertSlot(Math.max(0, step.step_order - 1))}
                              {renderStepCard(step, stepIndex)}
                              {step.id === displaySteps[displaySteps.length - 1]?.id ? renderStepInsertSlot(step.step_order) : null}
                            </Fragment>
                          );
                        })}
                      </div>

                      {!displaySteps.length ? (
                        <div className="empty-state compact">
                          <div>
                            {isCreating
                              ? "No draft steps yet. Use the inline + action to add the first step or insert a shared group."
                              : "No steps yet for this test case. Use the inline + action to add one or insert a shared group."}
                          </div>
                          {stepInsertIndex === null ? (
                            <button className="ghost-button" onClick={() => activateStepInsert(0, null)} type="button">Add first step</button>
                          ) : null}
                        </div>
                      ) : null}

                      {!isCreating ? (
                        <div className="action-row step-editor-save-row">
                          <button className="primary-button" disabled={updateTestCase.isPending} onClick={() => void handleSaveCaseDirect()} type="button">
                            {updateTestCase.isPending ? "Saving…" : "Save test case"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    )}
                  </EditorAccordionSection>

                  {!isCreating ? (
                    <EditorAccordionSection
                      countLabel={automationTargetCaseIds.length ? `${automationTargetCaseIds.length} target${automationTargetCaseIds.length === 1 ? "" : "s"}` : "Ready"}
                      isExpanded={expandedSections.automation}
                      onToggle={() => setExpandedSections((current) => ({ ...current, automation: !current.automation }))}
                      summary={automationSectionSummary}
                      title="Automation builder"
                    >
                      <div className="automation-builder-panel">
                        <details className="automation-run-context-section">
                          <summary>
                            <ExecutionStepsIcon />
                            <span>Run context</span>
                          </summary>
                          <ExecutionContextSelector
                            appTypeId={appTypeId}
                            onConfigurationChange={setSelectedExecutionConfigurationId}
                            onDataSetChange={setSelectedExecutionDataSetId}
                            onEnvironmentChange={setSelectedExecutionEnvironmentId}
                            prefillFirstAvailable
                            projectId={projectId}
                            selectedConfigurationId={selectedExecutionConfigurationId}
                            selectedDataSetId={selectedExecutionDataSetId}
                            selectedEnvironmentId={selectedExecutionEnvironmentId}
                          />
                        </details>

                        <div className="record-grid automation-builder-form">
                          <FormField label="Start URL">
                            <input
                              onChange={(event) => setAutomationStartUrl(event.target.value)}
                              placeholder="Uses selected environment base URL when blank"
                              value={automationStartUrl}
                            />
                          </FormField>
                          <FormField label="Failure threshold">
                            <input
                              min={1}
                              max={50}
                              onChange={(event) => setAutomationFailureThreshold(Math.max(1, Number(event.target.value) || 1))}
                              type="number"
                              value={automationFailureThreshold}
                            />
                          </FormField>
                        </div>

                        <FormField label="Builder guidance">
                          <textarea
                            onChange={(event) => setAutomationContext(event.target.value)}
                            placeholder="Auth assumptions, preferred data tokens, flows to ignore, or edge cases to preserve."
                            rows={4}
                            value={automationContext}
                          />
                        </FormField>

                        {automationTargetCases.length ? (
                          <div className="selection-chip-row">
                            {automationTargetCases.map((testCase) => (
                              <span className="selection-chip" key={testCase.id}>
                                {testCase.display_id || testCase.title}
                              </span>
                            ))}
                          </div>
                        ) : null}

                        <div className="testops-action-row">
                          <button
                            className="primary-button"
                            disabled={!automationTargetCaseIds.length || buildSingleAutomation.isPending || buildBatchAutomation.isPending}
                            onClick={() => void handleBuildSelectedAutomation()}
                            type="button"
                          >
                            <TestCaseSparkIcon />
                            <span>
                              {buildSingleAutomation.isPending || buildBatchAutomation.isPending
                                ? "Automating..."
                                : automationTargetCaseIds.length > 1
                                  ? "Queue AI automation"
                                  : "Automate case with AI"}
                            </span>
                          </button>
                        </div>

                        <div className="stack-list automation-recorder-stack">
                          <div className="stack-item">
                            <div>
                              <strong>Recorder</strong>
                              <span>{recorderSession ? `Session ${recorderSession.id.slice(0, 8)} is ${recorderSession.status}.` : "Capture clicks, fills, tab navigation, and business API traffic for this case."}</span>
                            </div>
                            <div className="testops-recorder-actions">
                              <RecorderStartControls
                                disabled={!selectedTestCase || !testEngineIntegration}
                                hasSession={Boolean(recorderSession)}
                                isStarting={startRecorder.isPending}
                                mobileRemoteEnabled={mobileRemoteRecorderEnabled}
                                onStart={(options) => void handleStartRecorder(options)}
                              />
                              <button
                                className="primary-button"
                                disabled={!recorderSession || finishRecorder.isPending}
                                onClick={() => void handleFinishRecorder()}
                                type="button"
                              >
                                <AutomationCodeIcon />
                                <span>{finishRecorder.isPending ? "Stopping..." : "Stop and create steps"}</span>
                              </button>
                            </div>
                          </div>
                          {recorderSession ? (
                            <div className="stack-item">
                              <div>
                                <strong>{formatRecorderDisplayMode(recorderSession.display_mode)}</strong>
                                <span>{recorderSession.action_count || 0} actions · {recorderSession.network_count || 0} API candidates</span>
                              </div>
                              {recorderLiveUrl ? (
                                <a className="ghost-button compact" href={recorderLiveUrl} rel="noreferrer" target="_blank">
                                  <OpenIcon size={16} />
                                  <span>Open live view</span>
                                </a>
                              ) : null}
                              <StatusBadge value={recorderSession.status} />
                            </div>
                          ) : null}
                          {recorderLiveUrl ? (
                            <iframe
                              allow="clipboard-read; clipboard-write"
                              className="recorder-live-frame"
                              src={recorderLiveUrl}
                              title="QAira recorder live view"
                            />
                          ) : null}
                          <RecorderSessionInsights session={recorderSession} />
                        </div>

                        <AutomationLearningMemory entries={automationLearningCache} />
                      </div>
                    </EditorAccordionSection>
                  ) : null}

                  {!isCreating ? (
                    <EditorAccordionSection
                      countLabel={`${selectedHistory.length} record${selectedHistory.length === 1 ? "" : "s"}`}
                      isExpanded={expandedSections.history}
                      onToggle={() => setExpandedSections((current) => ({ ...current, history: !current.history }))}
                      summary={historySectionSummary}
                      title="Run history"
                    >
                      <div className="step-editor step-history">
                        <div className="stack-list">
                          {selectedHistory.map((result) => {
                            const execution = executionsById[result.execution_id];
                            const executionLabel = execution?.name?.trim() || `Run ${result.execution_id.slice(0, 8)}`;
                            const executionSummary = [
                              execution?.status ? `Run ${execution.status}` : null,
                              formatExecutionHistoryDate(result.created_at)
                            ].filter(Boolean).join(" · ");
                            const historyDetail =
                              result.error ||
                              (result.status === "passed"
                                ? "Passed in this run snapshot."
                                : result.status === "failed"
                                  ? "Failed in this run snapshot."
                                  : "Blocked in this run snapshot.");

                            return (
                              <div className="stack-item execution-history-item" key={result.id}>
                                <div>
                                  <strong>{executionLabel}</strong>
                                  <span>{executionSummary}</span>
                                  <span>{historyDetail}</span>
                                </div>
                                <div className="execution-history-item-actions">
                                  <StatusBadge value={result.status} />
                                  <button className="ghost-button" onClick={() => openExecutionHistoryResult(result)} type="button">
                                    Open run
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                          {!selectedHistory.length ? <div className="empty-state compact">No execution history yet for this test case.</div> : null}
                        </div>
                      </div>
                    </EditorAccordionSection>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="empty-state compact">Select a test case from the library, or start a new one for this app type.</div>
            )}
          </Panel>
        )}
        isDetailOpen={Boolean(selectedTestCaseId) || isCreating}
      />

      {isStepGroupModalOpen ? (
        <StepGroupModal
          isSaving={groupSteps.isPending || createSharedStepGroup.isPending}
          name={stepGroupName}
          onClose={() => {
            setIsStepGroupModalOpen(false);
            setStepGroupName("");
            setSaveAsReusableGroup(false);
          }}
          onNameChange={setStepGroupName}
          onSave={() => void handleConfirmStepGroup()}
          reusable={saveAsReusableGroup}
          selectedCount={selectedEditorSteps.length}
          setReusable={setSaveAsReusableGroup}
        />
      ) : null}

      {isSharedGroupPickerOpen ? (
        <SharedGroupPickerModal
          groups={filteredSharedGroups}
          isLoading={sharedStepGroupsQuery.isLoading}
          onClose={() => {
            setIsSharedGroupPickerOpen(false);
            setSelectedSharedGroupId("");
            setSharedGroupSearchTerm("");
          }}
          onConfirm={() => void handleInsertSharedGroup()}
          onSearchChange={setSharedGroupSearchTerm}
          searchValue={sharedGroupSearchTerm}
          selectedGroup={selectedSharedGroup}
          selectedGroupId={selectedSharedGroupId}
          setSelectedGroupId={setSelectedSharedGroupId}
        />
      ) : null}

      {isSuiteLinkModalOpen && selectedTestCase ? (
        <TestCaseSuiteLinkModal
          isSaving={updateTestCase.isPending}
          linkedSuiteIds={suiteLinkDraftIds}
          onChange={setSuiteLinkDraftIds}
          onClose={() => {
            setIsSuiteLinkModalOpen(false);
            setSuiteLinkDraftIds([]);
          }}
          onSave={() => void handleSaveSuiteLinks()}
          saveDisabled={!hasSuiteLinkDraftChanges}
          suites={suites}
          testCaseTitle={selectedTestCase.title}
        />
      ) : null}

      {isCaseParameterDialogOpen ? (
        <StepParameterDialog
          getInputState={(parameter) => resolveScopedParameterInputState(parameter.scope)}
          headerContent={parameterDialogHeaderContent}
          onChange={handleScopedParameterValueChange}
          onClose={() => setIsCaseParameterDialogOpen(false)}
          parameters={detectedStepParameters}
          subtitle="Detected scoped params from the current case steps. Values update the editor preview immediately and save to the matching case or suite scope."
          title="Test case parameter values"
          values={mergedScopedParameterValues}
        />
      ) : null}

      {editingAutomationStep ? (
        <StepAutomationDialog
          availableParameters={detectedStepParameters}
          getParameterScopeState={resolveScopedParameterInputState}
          onClose={() => setEditingAutomationStepId("")}
          onSaveResponseValue={handleScopedParameterValueChange}
          onSave={(input) => void handleSaveStepAutomation(editingAutomationStep.id, input)}
          parameterValues={mergedScopedParameterValues}
          step={{
            id: editingAutomationStep.id,
            step_order: editingAutomationStep.step_order,
            action: stepDrafts[editingAutomationStep.id]?.action ?? editingAutomationStep.action,
            expected_result: stepDrafts[editingAutomationStep.id]?.expected_result ?? editingAutomationStep.expected_result,
            step_type: stepDrafts[editingAutomationStep.id]?.step_type ?? editingAutomationStep.step_type,
            automation_code: stepDrafts[editingAutomationStep.id]?.automation_code ?? editingAutomationStep.automation_code,
            api_request: stepDrafts[editingAutomationStep.id]?.api_request ?? editingAutomationStep.api_request
          }}
          subtitle="Use @t for case data, @s for suite-shared data, and @r for run-level data previews."
          title={`Step ${editingAutomationStep.step_order} automation`}
        />
      ) : null}

      {codePreviewState ? (
        <CodePreviewDialog
          code={codePreviewState.code}
          onClose={() => setCodePreviewState(null)}
          subtitle={codePreviewState.subtitle}
          title={codePreviewState.title}
        />
      ) : null}

      {isCreateSuiteModalOpen ? (
        <TestCaseSuiteModal
          appTypeCases={testCases}
          isSaving={createSuite.isPending || assignSuiteCases.isPending}
          onClose={() => setIsCreateSuiteModalOpen(false)}
          onSubmit={handleCreateSuite}
          selectedCaseIds={selectedActionTestCaseIds}
          suites={suites}
        />
      ) : null}

      {isCreateExecutionModalOpen ? (
        <TestCaseExecutionModal
          appTypeId={appTypeId}
          assigneeOptions={assigneeOptions}
          canCreateExecution={Boolean(projectId && appTypeId && selectedActionCases.length && session?.user.id)}
          executionName={executionName}
          isSubmitting={createExecution.isPending}
          onAssigneeChange={setSelectedExecutionAssigneeId}
          onClose={closeCreateExecutionModal}
          onConfigurationChange={setSelectedExecutionConfigurationId}
          onDataSetChange={setSelectedExecutionDataSetId}
          onEnvironmentChange={setSelectedExecutionEnvironmentId}
          onExecutionNameChange={setExecutionName}
          onRemoveTestCase={(testCaseId) =>
            setSelectedActionTestCaseIds((current) => current.filter((id) => id !== testCaseId))
          }
          onSubmit={handleCreateExecution}
          projectId={projectId}
          selectedAssigneeId={selectedExecutionAssigneeId}
          selectedConfigurationId={selectedExecutionConfigurationId}
          selectedAppType={selectedAppType?.name || ""}
          selectedDataSetId={selectedExecutionDataSetId}
          selectedEnvironmentId={selectedExecutionEnvironmentId}
          selectedProject={selectedProject?.name || ""}
          testCases={selectedActionCases}
        />
      ) : null}

      {isImportModalOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (importTestCases.isPending) {
              return;
            }

            setImportBatches([]);
            setImportFileWarnings([]);
            setImportSourceSelection("auto");
            setIsImportModalOpen(false);
          }}
        >
          <div
            aria-labelledby="bulk-import-title"
            aria-modal="true"
            className="modal-card import-modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="import-modal-header">
              <div className="import-modal-title">
                <p className="eyebrow">Bulk Import</p>
                <h3 id="bulk-import-title">Import test cases from external sources</h3>
                <p>Queue CSV, JUnit XML, TestNG XML, or Postman collection files together. CSV imports support an <strong>external_references</strong> column for ticket links, while Postman requests import as API test cases even when the collection has no test scripts. Large imports are sent in smaller batches automatically.</p>
              </div>
              <button aria-label="Close bulk import dialog" className="ghost-button" disabled={importTestCases.isPending} onClick={() => {
                setImportBatches([]);
                setImportFileWarnings([]);
                setImportSourceSelection("auto");
                setIsImportModalOpen(false);
              }} type="button">
                Close
              </button>
            </div>

            <div className="import-modal-body">
              <div className="record-grid">
                <FormField label="Source type">
                  <select value={importSourceSelection} onChange={(event) => setImportSourceSelection(event.target.value as TestCaseImportSourceSelection)}>
                    {TEST_CASE_IMPORT_SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Import file">
                  <input accept=".csv,.xml,.json,text/csv,text/xml,application/xml,application/json" multiple onChange={(event) => void handleImportFile(event)} type="file" />
                </FormField>

                <FormField label="Default requirement">
                  <select value={importRequirementId} onChange={(event) => setImportRequirementId(event.target.value)}>
                    <option value="">No requirement</option>
                    {requirements.map((requirement) => (
                      <option key={requirement.id} value={requirement.id}>{requirement.title}</option>
                    ))}
                  </select>
                </FormField>
              </div>

              <div className="metric-strip compact">
                <div className="mini-card">
                  <strong>{importRows.length}</strong>
                  <span>Cases ready</span>
                </div>
                <div className="mini-card">
                  <strong>{importStepCount}</strong>
                  <span>Steps detected</span>
                </div>
                <div className="mini-card">
                  <strong>{importFileCount}</strong>
                  <span>Files queued</span>
                </div>
              </div>

              <div className="detail-summary">
                <strong>{importFileName || "No import file loaded yet"}</strong>
                <span>
                  {importSourceSummary
                    ? `${importSourceSummary} batch prepared. Missing suites are created automatically during import when a source references them.`
                    : "Use auto-detect or choose a source type before adding files to the batch queue."}
                </span>
              </div>

              {importBatches.length ? (
                <div className="table-wrap import-preview-table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>Source</th>
                        <th>Cases</th>
                        <th>Warnings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importBatches.map((batch) => (
                        <tr key={batch.id}>
                          <td>{batch.fileName}</td>
                          <td>{getTestCaseImportSourceLabel(batch.source)}</td>
                          <td>{batch.rows.length}</td>
                          <td>{batch.warnings.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {importWarnings.length ? (
                <div className="empty-state compact">
                  {importWarnings.slice(0, 4).map((warning) => (
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
                        <th>Step count</th>
                        <th>Groups</th>
                        <th>Suites</th>
                        <th>Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 5).map((row, index) => (
                        <tr key={`${row.title}-${index}`}>
                          <td>{row.title}</td>
                          <td>{formatReferenceList(row.external_references) || "—"}</td>
                          <td>{countImportedSteps(row)}</td>
                          <td>{countImportedGroups(row)}</td>
                          <td>{countImportedSuites(row)}</td>
                          <td>{getImportedStepPreviewLabel(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            <div className="action-row import-modal-actions">
              <button className="primary-button" disabled={!appTypeId || !importRows.length || importTestCases.isPending} onClick={() => void handleBulkImport()} type="button">
                {importTestCases.isPending ? "Queuing…" : `Queue ${importRows.length || ""} Test Cases`}
              </button>
              <button
                className="ghost-button"
                disabled={(!importBatches.length && !importWarnings.length) || importTestCases.isPending}
                onClick={() => {
                  setImportBatches([]);
                  setImportFileWarnings([]);
                  setImportSourceSelection("auto");
                }}
                type="button"
              >
                Clear preview
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAiCaseAuthoringOpen ? (
        <AiCaseAuthoringModal
          additionalContext={aiCaseAuthoringAdditionalContext}
          applyLabel={isCreating ? "Apply To Draft" : "Replace Saved Case"}
          closeDisabled={previewCaseAuthoring.isPending || updateTestCase.isPending}
          disableApply={!aiCaseAuthoringPreview || updateTestCase.isPending}
          disableGenerate={!appTypeId || !aiCaseAuthoringRequirementId || previewCaseAuthoring.isPending || !integrations.length}
          hasAutomationWarning={aiCaseAuthoringAutomationStepCount > 0}
          integrationId={integrationId}
          integrations={integrations}
          isApplying={updateTestCase.isPending}
          isCreating={isCreating}
          isPreviewing={previewCaseAuthoring.isPending}
          onAdditionalContextChange={setAiCaseAuthoringAdditionalContext}
          onApply={() => void handleApplyAiCaseAuthoring()}
          onClose={() => {
            setIsAiCaseAuthoringOpen(false);
            setAiCaseAuthoringPreview(null);
            setAiCaseAuthoringMessage("");
          }}
          onGenerate={() => void handlePreviewAiCaseAuthoring()}
          onIntegrationIdChange={setIntegrationId}
          onPreviewMessageDismiss={() => setAiCaseAuthoringMessage("")}
          onRequirementChange={setAiCaseAuthoringRequirementId}
          preview={aiCaseAuthoringPreview}
          previewMessage={aiCaseAuthoringMessage}
          previewTone={aiCaseAuthoringTone}
          requirementId={aiCaseAuthoringRequirementId}
          requirements={requirements}
          sourceDraft={aiCaseAuthoringSourceDraft}
        />
      ) : null}

      {isAiStudioOpen ? (
        <AiDesignStudioModal
          acceptLabel="Accept Into Test Case Library"
          additionalContext={aiAdditionalContext}
          allowMultipleRequirements={true}
          appTypeName={appTypes.find((item) => item.id === appTypeId)?.name || "No app type selected"}
          closeDisabled={previewDesignedCases.isPending || acceptDesignedCases.isPending || createGenerationJob.isPending}
          disableAccept={!aiPreviewCases.length || acceptDesignedCases.isPending}
          disablePreview={!aiRequirementIds.length || !appTypeId || previewDesignedCases.isPending || !integrations.length}
          disableSchedule={!aiRequirementIds.length || !appTypeId || createGenerationJob.isPending || !integrations.length}
          existingCases={aiExistingCases}
          existingCasesSubtitle="These reusable cases are already linked to one or more of the selected requirements in the current app type."
          existingCasesTitle="Linked test cases"
          externalLinksText={aiExternalLinksText}
          eyebrow="Test Cases"
          integrationId={integrationId}
          integrations={integrations}
          isAccepting={acceptDesignedCases.isPending}
          isPreviewing={previewDesignedCases.isPending}
          isScheduling={createGenerationJob.isPending}
          maxCases={maxCases}
          onAccept={() => void handleAcceptDesignedCases()}
          onAddImages={(files) => void handleAddAiReferenceImages(files)}
          onAdditionalContextChange={setAiAdditionalContext}
          onClose={() => {
            setIsAiStudioOpen(false);
            setAiPreviewCases([]);
            setAiPreviewMessage("");
          }}
          onExternalLinksTextChange={setAiExternalLinksText}
          onIntegrationIdChange={setIntegrationId}
          onParallelRequirementCountChange={setParallelRequirementLimit}
          onViewExistingCase={openExistingCaseFromAi}
          onPreview={() => void handlePreviewDesignedCases()}
          onSchedule={() => void handleScheduleDesignedCases()}
          onRemoveImage={(imageUrl) => setAiReferenceImages((current) => current.filter((image) => image.url !== imageUrl))}
          onRemovePreviewCase={(clientId) => setAiPreviewCases((current) => current.filter((candidate) => candidate.client_id !== clientId))}
          onRequirementSelectionChange={setAiRequirementIds}
          onTogglePreviewRequirement={(clientId, requirementId) => {
            const requirement = requirements.find((item) => item.id === requirementId);

            if (!requirement) {
              return;
            }

            setAiPreviewCases((current) => toggleRequirementOnPreviewCase(current, clientId, requirementId, requirement.title));
          }}
          onMaxCasesChange={setMaxCases}
          parallelRequirementCount={parallelRequirementLimit}
          previewCases={aiPreviewCases}
          previewMessage={aiPreviewMessage}
          onPreviewMessageDismiss={() => setAiPreviewMessage("")}
          previewTone={aiPreviewTone}
          referenceImages={aiReferenceImages}
          requirementHelpText="Select one or more requirements, provide extra context, then review the generated drafts before approving them into the reusable library."
          requirementLabel="Requirements"
          requirements={requirements}
          scheduleHelperText="Schedule batch AI generation for selected requirements. The worker processes up to five requirements at a time, backs off on LLM rate limits, and returns generated cases as drafts with green accept and red reject actions."
          selectedRequirementIds={aiSelectedRequirements.map((requirement) => requirement.id)}
        />
      ) : null}

      {linkedPreviewCase ? (
        <LinkedTestCaseModal
          appTypeName={appTypes.find((item) => item.id === appTypeId)?.name || ""}
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

function AutomationScriptLens({
  lens,
  steps,
  code,
  onEditStep
}: {
  lens: Exclude<TestCaseAuthoringLens, "manual">;
  steps: AuthoringStepProjection[];
  code: string;
  onEditStep: (stepId: string) => void;
}) {
  const title = lens === "api-script" ? "API script" : "UI automation script";
  const emptyCopy = lens === "api-script"
    ? "No API steps are present yet. Change a step type to API or import a Postman collection to author request-level coverage."
    : "No UI or mobile steps are present yet. Add web, Android, or iOS steps to create executable UI coverage.";

  return (
    <div className="automation-script-lens">
      <div className="automation-script-map" aria-label={`${title} step map`}>
        {steps.length ? (
          steps.map((step) => {
            const stepType = normalizeStepType(step.step_type);
            const hasSavedAutomation = stepHasAutomation(step);
            const request = normalizeApiRequest(step.api_request);
            const subtitle = stepType === "api" && request
              ? `${request.method || "GET"} ${request.url || "No URL"}`
              : step.expected_result || "No expected result written yet";

            return (
              <article className="automation-script-step" key={step.id}>
                <div className="automation-script-step-copy">
                  <div className="automation-script-step-head">
                    <span className={hasSavedAutomation ? "automation-script-step-status is-ready" : "automation-script-step-status"}>
                      {hasSavedAutomation ? "Ready" : "Generated"}
                    </span>
                    <strong>Step {step.step_order}</strong>
                    <span>{stepType.toUpperCase()}</span>
                  </div>
                  <p>{step.action || "No manual action written yet"}</p>
                  <small>{subtitle}</small>
                </div>
                <button className="ghost-button compact" onClick={() => onEditStep(step.id)} type="button">
                  <AutomationCodeIcon />
                  <span>Edit</span>
                </button>
              </article>
            );
          })
        ) : (
          <div className="empty-state compact">{emptyCopy}</div>
        )}
      </div>

      <div className="automation-script-code-panel">
        <div className="automation-script-code-head">
          <strong>{title}</strong>
          <span>{steps.length} mapped step{steps.length === 1 ? "" : "s"}</span>
        </div>
        <pre className="automation-script-code"><code>{code}</code></pre>
      </div>
    </div>
  );
}

function AutomationLearningMemory({ entries }: { entries: AutomationLearningCacheEntry[] }) {
  const topEntries = entries.slice(0, 6);
  const strongEntries = entries.filter((entry) => Number(entry.confidence) >= 0.8).length;

  return (
    <details className="automation-learning-memory">
      <summary className="automation-learning-memory-head">
        <div>
          <strong>Locator memory</strong>
          <span>
            {entries.length
              ? `${entries.length} learned locator${entries.length === 1 ? "" : "s"} · ${strongEntries} high confidence`
              : "No reusable locators learned for this scope yet"}
          </span>
        </div>
        <AutomationCodeIcon />
      </summary>

      {topEntries.length ? (
        <div className="automation-learning-grid">
          {topEntries.map((entry) => (
            <article className="automation-learning-card" key={entry.id}>
              <div className="automation-learning-card-head">
                <strong>{entry.locator_intent || "Locator"}</strong>
                <span>{Math.round(Number(entry.confidence || 0) * 100)}%</span>
              </div>
              <span className="automation-learning-page">{entry.page_key || entry.page_url || "Unknown page"}</span>
              <code>{entry.locator}</code>
              <div className="automation-learning-meta">
                <span>{entry.locator_kind || entry.source || "learned"}</span>
                <span>{entry.hit_count || 0} hit{entry.hit_count === 1 ? "" : "s"}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state compact">Run the recorder or AI builder once; learned locators will appear here and reduce future script repair work.</div>
      )}
    </details>
  );
}

function TestCaseSuiteModal({
  suites,
  appTypeCases,
  selectedCaseIds,
  onClose,
  onSubmit,
  isSaving
}: {
  suites: TestSuite[];
  appTypeCases: TestCase[];
  selectedCaseIds: string[];
  onClose: () => void;
  onSubmit: (input: { name: string; parent_id?: string; selectedIds: string[] }) => void;
  isSaving: boolean;
}) {
  const initialSelectedIds = useMemo(
    () => selectedCaseIds.filter((testCaseId) => appTypeCases.some((testCase) => testCase.id === testCaseId)),
    [appTypeCases, selectedCaseIds]
  );
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [localSelectedIds, setLocalSelectedIds] = useState<string[]>(() => initialSelectedIds);
  const initialSelectedIdsKey = initialSelectedIds.join("::");

  useEffect(() => {
    setLocalSelectedIds(initialSelectedIds);
  }, [initialSelectedIdsKey]);

  return (
    <div className="modal-backdrop" onClick={() => !isSaving && onClose()} role="presentation">
      <div
        aria-label="Create suite from test cases"
        aria-modal="true"
        className="modal-card suite-create-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="suite-create-header">
          <div className="suite-create-title">
            <h3>Create Suite</h3>
            <p>Choose reusable cases, keep their saved order with the arrow controls, and create the suite from this dialog.</p>
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
                  {suites.map((suite) => (
                    <option key={suite.id} value={suite.id}>{suite.name}</option>
                  ))}
                </select>
              </FormField>
            </div>

            <div className="suite-modal-picker-shell">
              <SuiteCasePicker
                cases={appTypeCases}
                description="Use bulk selection when needed, then set the saved suite order before creating it."
                emptyMessage="No test cases available in this app type yet."
                heading="Reusable test cases"
                onChange={setLocalSelectedIds}
                selectedCaseIds={localSelectedIds}
              />
            </div>
          </div>

          <div className="action-row suite-modal-actions">
            <button className="primary-button" disabled={isSaving} type="submit">
              {isSaving ? "Saving…" : "Create Suite"}
            </button>
            <button className="ghost-button" disabled={isSaving} onClick={onClose} type="button">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TestCaseSuiteLinkModal({
  testCaseTitle,
  suites,
  linkedSuiteIds,
  isSaving,
  saveDisabled,
  onChange,
  onSave,
  onClose
}: {
  testCaseTitle: string;
  suites: TestSuite[];
  linkedSuiteIds: string[];
  isSaving: boolean;
  saveDisabled: boolean;
  onChange: (suiteIds: string[]) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const linkedSuiteIdSet = useMemo(() => new Set(linkedSuiteIds), [linkedSuiteIds]);
  const linkedSuites = useMemo(
    () =>
      suites
        .filter((suite) => linkedSuiteIdSet.has(suite.id))
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name)),
    [linkedSuiteIdSet, suites]
  );
  const orderedSuites = useMemo(
    () =>
      suites.slice().sort((left, right) => {
        const leftRank = linkedSuiteIdSet.has(left.id) ? 0 : 1;
        const rightRank = linkedSuiteIdSet.has(right.id) ? 0 : 1;

        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        return left.name.localeCompare(right.name);
      }),
    [linkedSuiteIdSet, suites]
  );

  const handleToggleSuite = (suiteId: string) => {
    if (linkedSuiteIdSet.has(suiteId)) {
      onChange(linkedSuiteIds.filter((currentId) => currentId !== suiteId));
      return;
    }

    onChange([...linkedSuiteIds, suiteId]);
  };

  return (
    <div className="modal-backdrop" onClick={() => !isSaving && onClose()} role="presentation">
      <div
        aria-label="Manage suite references"
        aria-modal="true"
        className="modal-card suite-create-modal suite-link-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <div className="suite-create-header">
          <div className="suite-create-title">
            <h3>Suite references</h3>
            <p>Link or unlink "{testCaseTitle}" from suites. Linked suites stay pinned at the top for quick review.</p>
          </div>
          <button className="ghost-button" disabled={isSaving} onClick={onClose} type="button">
            Close
          </button>
        </div>

        <form
          className="suite-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <div className="suite-link-modal-body">
            <div className="suite-link-summary">
              <div className="detail-summary">
                <strong>{linkedSuites.length} linked suite{linkedSuites.length === 1 ? "" : "s"}</strong>
                <span>
                  {linkedSuites.length
                    ? "Use the unlink icon in the linked list or suite list below to remove a reference."
                    : "No suite links yet. Use the add icon below to attach this case to one or more suites."}
                </span>
              </div>

              {linkedSuites.length ? (
                <div className="suite-link-chip-row">
                  {linkedSuites.map((suite) => (
                    <div className="suite-link-chip" key={suite.id}>
                      <span className="suite-link-chip-label">{suite.name}</span>
                      <button
                        aria-label={`Unlink ${suite.name}`}
                        className="suite-link-chip-remove"
                        disabled={isSaving}
                        onClick={() => handleToggleSuite(suite.id)}
                        title={`Unlink ${suite.name}`}
                        type="button"
                      >
                        <SuiteUnlinkIcon size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state compact">This test case is not linked to any suites yet.</div>
              )}
            </div>

            <div className="suite-link-list-shell">
              <div className="suite-link-list-header">
                <strong>All suites</strong>
                <span>{orderedSuites.length} available</span>
              </div>

              {orderedSuites.length ? (
                <div className="suite-link-list">
                  {orderedSuites.map((suite, index) => {
                    const isLinked = linkedSuiteIdSet.has(suite.id);

                    return (
                      <div className={isLinked ? "suite-link-row is-linked" : "suite-link-row"} key={suite.id}>
                        <div className="suite-link-row-copy">
                          <strong>{suite.name}</strong>
                          {suite.display_id ? <span>{suite.display_id}</span> : null}
                        </div>
                        <div className="suite-link-row-actions">
                          {isLinked ? <span className="suite-link-row-status">Linked</span> : null}
                          <button
                            aria-label={`${isLinked ? "Unlink" : "Link"} ${suite.name}`}
                            className={isLinked ? "ghost-button suite-link-toggle is-linked" : "ghost-button suite-link-toggle"}
                            data-autofocus={index === 0 ? "true" : undefined}
                            disabled={isSaving}
                            onClick={() => handleToggleSuite(suite.id)}
                            title={`${isLinked ? "Unlink" : "Link"} ${suite.name}`}
                            type="button"
                          >
                            {isLinked ? <SuiteUnlinkIcon /> : <AddIcon />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state compact">Create a suite first to link this test case.</div>
              )}
            </div>
          </div>

          <div className="action-row suite-modal-actions">
            <button className="primary-button" disabled={isSaving || saveDisabled} type="submit">
              {isSaving ? "Saving…" : "Save links"}
            </button>
            <button className="ghost-button" disabled={isSaving} onClick={onClose} type="button">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TestCaseExecutionModal({
  testCases,
  selectedProject,
  selectedAppType,
  projectId,
  appTypeId,
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
  onRemoveTestCase,
  onClose,
  onSubmit
}: {
  testCases: TestCase[];
  selectedProject: string;
  selectedAppType: string;
  projectId: string;
  appTypeId: string;
  executionName: string;
  selectedAssigneeId: string;
  assigneeOptions: TestCaseExecutionAssigneeOption[];
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
  onRemoveTestCase: (testCaseId: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={() => !isSubmitting && onClose()} role="presentation">
      <div
        aria-labelledby="create-test-case-execution-title"
        aria-modal="true"
        className="modal-card execution-create-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <form className="execution-create-form" onSubmit={onSubmit}>
          <div className="execution-create-header">
            <div className="execution-create-title">
              <p className="eyebrow">Test Cases</p>
              <h3 id="create-test-case-execution-title">Create Run</h3>
              <p>The selected test cases will open directly in Test Runs without creating a suite first.</p>
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
              <FormField label="Assign to" hint="Sets the default owner for this run and the snapped test cases inside it.">
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
              <span>{selectedAppType ? `${selectedAppType} app type selected for this run.` : "Choose an app type to load test cases."}</span>
              <span>{testCases.length ? `${testCases.length} test cases selected for this run.` : "No test cases selected yet."}</span>
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

            <FormField label="Run scope" required>
              <div className="selection-summary-card">
                <div className="selection-summary-header">
                  <div>
                    <strong>{testCases.length ? `${testCases.length} test cases selected` : "No test cases selected yet"}</strong>
                    <span>These came from the checkbox selections in the test case library. Remove any chip here before creating the run.</span>
                  </div>
                </div>

                {testCases.length ? (
                  <div className="selection-chip-row">
                    {testCases.map((testCase) => (
                      <button key={testCase.id} className="selection-chip" disabled={isSubmitting} onClick={() => onRemoveTestCase(testCase.id)} type="button">
                        {testCase.title}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </FormField>
          </div>

          <div className="action-row execution-create-actions">
            <button className="primary-button" disabled={!canCreateExecution || isSubmitting} type="submit">
              {isSubmitting ? "Creating…" : "Create Run"}
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

function EditorAccordionSection({
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
              <EditorAccordionChevronIcon />
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
          <button className="editor-accordion-toggle-state" onClick={onToggle} type="button">
            {isExpanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>
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

function StepIconButton({
  children,
  ariaLabel,
  title,
  onClick,
  count = 0,
  disabled = false,
  tone = "ghost",
  type = "button"
}: {
  children: ReactNode;
  ariaLabel: string;
  title: string;
  onClick: () => void;
  count?: number;
  disabled?: boolean;
  tone?: "ghost" | "primary" | "danger";
  type?: "button" | "submit" | "reset";
}) {
  const className =
    tone === "primary"
      ? "step-action-button step-action-button--primary"
      : tone === "danger"
        ? "step-action-button step-action-button--danger"
        : "step-action-button";

  return (
    <button aria-label={ariaLabel} className={count ? `${className} has-count` : className} disabled={disabled} onClick={onClick} title={title} type={type}>
      {children}
      {count ? <span className="step-action-count">{count}</span> : null}
    </button>
  );
}

function StepIconShell({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
      {children}
    </svg>
  );
}

function StepAiIcon() {
  return (
    <StepIconShell>
      <path d="m12 3 1.7 4.4L18 9l-4.3 1.6L12 15l-1.7-4.4L6 9l4.3-1.6Z" />
      <path d="M19 14.5 20 17l2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1Z" />
      <path d="M4.5 14 5.2 16l2 .8-2 .8-.7 2-.8-2-2-.8 2-.8Z" />
    </StepIconShell>
  );
}

function StepMoveUpIcon() {
  return (
    <StepIconShell>
      <path d="m12 6-4 4" />
      <path d="m12 6 4 4" />
      <path d="M12 6v12" />
    </StepIconShell>
  );
}

function StepMoveDownIcon() {
  return (
    <StepIconShell>
      <path d="m12 18-4-4" />
      <path d="m12 18 4-4" />
      <path d="M12 6v12" />
    </StepIconShell>
  );
}

function StepSaveIcon() {
  return (
    <StepIconShell>
      <path d="M5 6.5A1.5 1.5 0 0 1 6.5 5h9l3.5 3.5V17.5A1.5 1.5 0 0 1 17.5 19h-11A1.5 1.5 0 0 1 5 17.5z" />
      <path d="M9 5v5h6V6" />
      <path d="M9 15h6" />
    </StepIconShell>
  );
}

function StepDeleteIcon() {
  return (
    <StepIconShell>
      <path d="M4 7h16" />
      <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
      <path d="M7 7l.8 11.1A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.9L17 7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </StepIconShell>
  );
}

function StepExpandAllIcon() {
  return (
    <StepIconShell>
      <path d="M12 12V4" />
      <path d="m8.5 7.5 3.5-3.5 3.5 3.5" />
      <path d="M12 12v8" />
      <path d="m8.5 16.5 3.5 3.5 3.5-3.5" />
    </StepIconShell>
  );
}

function StepCollapseAllIcon() {
  return (
    <StepIconShell>
      <path d="M12 4v8" />
      <path d="m8.5 8.5 3.5 3.5 3.5-3.5" />
      <path d="M12 20v-8" />
      <path d="m8.5 15.5 3.5-3.5 3.5 3.5" />
    </StepIconShell>
  );
}

function StepCopyIcon() {
  return (
    <StepIconShell>
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
    </StepIconShell>
  );
}

function StepInsertIcon() {
  return (
    <StepIconShell>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
      <path d="M7 5h10" />
      <path d="M7 19h10" />
    </StepIconShell>
  );
}

function StepInsertAboveIcon() {
  return (
    <StepIconShell>
      <path d="M12 19V7" />
      <path d="m8.5 10.5 3.5-3.5 3.5 3.5" />
      <path d="M6 4h12" />
      <path d="M8 15h8" />
    </StepIconShell>
  );
}

function StepInsertBelowIcon() {
  return (
    <StepIconShell>
      <path d="M12 5v12" />
      <path d="m8.5 13.5 3.5 3.5 3.5-3.5" />
      <path d="M8 9h8" />
      <path d="M6 20h12" />
    </StepIconShell>
  );
}

function StepPasteIcon() {
  return (
    <StepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 10v6" />
      <path d="m9.5 13.5 2.5 2.5 2.5-2.5" />
    </StepIconShell>
  );
}

function StepCutIcon() {
  return (
    <StepIconShell>
      <circle cx="6" cy="7" r="2" />
      <circle cx="6" cy="17" r="2" />
      <path d="M8 8.5 19 18" />
      <path d="M8 15.5 19 6" />
    </StepIconShell>
  );
}

function StepPasteAboveIcon() {
  return (
    <StepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 16V10" />
      <path d="m8.5 12.5 3.5-3.5 3.5 3.5" />
    </StepIconShell>
  );
}

function StepPasteBelowIcon() {
  return (
    <StepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 10v6" />
      <path d="m8.5 15.5 3.5 3.5 3.5-3.5" />
    </StepIconShell>
  );
}

function StepParameterIcon() {
  return (
    <StepIconShell>
      <path d="M5 7.5h14" />
      <path d="M7 12h10" />
      <path d="M9 16.5h6" />
      <path d="m5 5 2.5 2.5L5 10" />
    </StepIconShell>
  );
}

function StepKebabIcon() {
  return (
    <StepIconShell>
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </StepIconShell>
  );
}

function StepClearSelectionIcon() {
  return (
    <StepIconShell>
      <path d="M5 5l14 14" />
      <path d="M19 5 5 19" />
      <path d="M8 12h8" />
    </StepIconShell>
  );
}

function StepGroupIcon() {
  return (
    <StepIconShell>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
      <path d="M4 10h16" />
    </StepIconShell>
  );
}

function StepSharedGroupIcon() {
  return <SharedStepsIconGraphic size={16} />;
}

function StepGroupChevronIcon() {
  return (
    <StepIconShell>
      <path d="m7 10 5 5 5-5" />
    </StepIconShell>
  );
}

function ExecutionStepsIcon() {
  return (
    <StepIconShell>
      <path d="M8 7h10" />
      <path d="M8 12h10" />
      <path d="M8 17h10" />
      <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1" fill="currentColor" stroke="none" />
    </StepIconShell>
  );
}

function getStepKindMeta(groupKind?: TestStep["group_kind"] | null) {
  if (groupKind === "reusable") {
    return { label: "Shared group step", tone: "shared" as const };
  }

  if (groupKind === "local") {
    return { label: "Local group step", tone: "local" as const };
  }

  return { label: "Standard step", tone: "default" as const };
}

function StepKindIconBadge({
  label,
  tone
}: {
  label: string;
  tone: "default" | "shared" | "local";
}) {
  const className = tone === "shared" ? "step-kind-badge is-shared" : tone === "local" ? "step-kind-badge is-local" : "step-kind-badge is-standard";

  return (
    <span
      aria-label={label}
      className={className}
      title={label}
    >
      {tone === "shared" ? <SharedGroupLevelIcon kind="reusable" /> : tone === "local" ? <SharedGroupLevelIcon kind="local" /> : <StandardStepIcon />}
    </span>
  );
}

function StepUngroupIcon() {
  return (
    <StepIconShell>
      <path d="M5 7h6v6H5z" />
      <path d="M13 11h6v6h-6z" />
      <path d="m9 16-3 3" />
      <path d="m6 16 3 3" />
      <path d="m18 5-3 3" />
      <path d="m15 5 3 3" />
    </StepIconShell>
  );
}

function SuiteUnlinkIcon({
  size = 16,
  strokeWidth = 1.9
}: {
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M5 12h14" />
    </svg>
  );
}

const STEP_ACTION_HOVER_EXIT_DELAY_MS = 1000;

function StepActionMenu({
  className = "",
  label,
  actions,
  previewActions,
  openOnHover = false
}: {
  className?: string;
  label: string;
  actions: StepActionMenuAction[];
  previewActions?: StepActionMenuAction[];
  openOnHover?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hoverExitTimeoutRef = useRef<number | null>(null);

  const clearHoverExitTimeout = () => {
    if (hoverExitTimeoutRef.current === null) {
      return;
    }

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
    }, STEP_ACTION_HOVER_EXIT_DELAY_MS);
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

  useEffect(
    () => () => {
      if (hoverExitTimeoutRef.current !== null) {
        window.clearTimeout(hoverExitTimeoutRef.current);
      }
    },
    []
  );

  return (
    <div
      className={["step-card-menu", className].filter(Boolean).join(" ")}
      onMouseEnter={handleHoverEnter}
      onMouseLeave={handleHoverLeave}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={label}
        className="step-card-menu-trigger"
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        title={label}
        type="button"
      >
        <StepKebabIcon />
      </button>
      {openOnHover && previewActions?.length && isHovering && !isOpen ? (
        <div className="step-card-menu-panel is-horizontal" role="menu">
          {previewActions.map((action) => (
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
      {isOpen ? (
        <div className="step-card-menu-panel" ref={menuRef} role="menu">
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
                <span className="step-card-menu-item-label">{action.label}</span>
                {action.description ? <span className="step-card-menu-item-description">{action.description}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InlineStepInsertSlot({
  index,
  isActive,
  draft,
  onCancel,
  onChange,
  onSubmit
}: {
  index: number;
  isActive: boolean;
  draft: StepDraft;
  onCancel: () => void;
  onChange: (draft: StepDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!isActive) {
    return null;
  }

  return (
    <div className="step-insert-slot is-active">
      <form className="step-create step-create--inline" onSubmit={onSubmit}>
        <strong>{index === 0 ? "+ Add Step" : "+ Insert Step"}</strong>
        <FormField label="Action">
          <input
            autoFocus
            value={draft.action}
            onChange={(event) => onChange({ ...draft, action: event.target.value })}
          />
        </FormField>
        <FormField label="Expected result">
          <textarea
            rows={3}
            value={draft.expected_result}
            onChange={(event) => onChange({ ...draft, expected_result: event.target.value })}
          />
        </FormField>
        <div className="action-row">
          <button className="primary-button" type="submit">Save step</button>
          <button className="ghost-button" onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function StepGroupHeader({
  name,
  kind,
  stepCount,
  isExpanded,
  canMoveUp,
  canMoveDown,
  selectionState,
  onConvertToLocal,
  onConvertToShared,
  onToggle,
  onMoveUp,
  onMoveDown,
  onPreviewCode,
  onRemoveGroup,
  onUngroup,
  onToggleSelect
}: {
  name: string;
  kind: TestStep["group_kind"];
  stepCount: number;
  isExpanded: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  selectionState: "all" | "some" | "none";
  onConvertToLocal: () => void;
  onConvertToShared: () => void;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPreviewCode: () => void;
  onRemoveGroup: () => void;
  onUngroup: () => void;
  onToggleSelect: (checked: boolean) => void;
}) {
  const isSharedGroup = kind === "reusable";
  const unlinkTitle = isSharedGroup ? "Unlink shared group from this case" : "Ungroup steps";
  const removeTitle = isSharedGroup ? "Remove shared group from this case" : "Remove group and steps";
  const selectionRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!selectionRef.current) {
      return;
    }
    selectionRef.current.indeterminate = selectionState === "some";
  }, [selectionState]);

  return (
    <div className="step-group-header">
      <div
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${name}`}
        className="step-group-toggle"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <label className="checkbox-field step-group-select" onClick={(event) => event.stopPropagation()}>
          <input
            aria-label={`Select steps in ${name}`}
            checked={selectionState === "all"}
            onChange={(event) => onToggleSelect(event.target.checked)}
            ref={selectionRef}
            type="checkbox"
          />
        </label>
        <span aria-hidden="true" className={isExpanded ? "step-group-chevron is-expanded" : "step-group-chevron"}>
          <StepGroupChevronIcon />
        </span>
        <span className="step-group-title">
          <span className="step-group-title-row">
            <span aria-hidden="true" className={isSharedGroup ? "step-group-icon is-shared" : "step-group-icon is-local"}>
              <SharedGroupLevelIcon kind={kind} />
            </span>
            <strong>{name}</strong>
          </span>
        </span>
      </div>
      <div className="step-group-meta">
        <span className="step-group-count">
          {stepCount} step{stepCount === 1 ? "" : "s"}
        </span>
        <InlineStepToolButton
          ariaLabel={`Preview automation for ${name}`}
          className="step-inline-tool--group"
          onClick={onPreviewCode}
          title="Preview consolidated automation"
        >
          <AutomationCodeIcon />
        </InlineStepToolButton>
        <StepActionMenu
          className="step-group-header-actions step-card-menu--flat"
          label="Group actions"
          actions={[
            {
              label: "Move group up",
              icon: <StepMoveUpIcon />,
              onClick: onMoveUp,
              disabled: !canMoveUp
            },
            {
              label: "Move group down",
              icon: <StepMoveDownIcon />,
              onClick: onMoveDown,
              disabled: !canMoveDown
            },
            ...(isSharedGroup
              ? [{
                  label: "Convert to local group",
                  icon: <StepGroupIcon />,
                  onClick: onConvertToLocal
                }]
              : [{
                  label: "Convert to shared group",
                  icon: <StepSharedGroupIcon />,
                  onClick: onConvertToShared
                }]),
            {
              label: unlinkTitle,
              icon: <StepUngroupIcon />,
              onClick: onUngroup
            },
            {
              label: removeTitle,
              icon: <StepDeleteIcon />,
              onClick: onRemoveGroup,
              tone: "danger"
            }
          ]}
        />
      </div>
    </div>
  );
}

function EditableStepCard({
  step,
  draft,
  parameterValues,
  isExpanded,
  isSelected,
  isRephrasing,
  canPaste,
  canMoveUp,
  canMoveDown,
  onSave,
  onDraftChange,
  onCopy,
  onCut,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  onToggle,
  onToggleSelect,
  onMoveUp,
  onMoveDown,
  onChangeStepType,
  onEditAutomation,
  onRephrase,
  onPasteAbove,
  onPasteBelow
}: {
  step: TestStep;
  draft: StepDraft;
  parameterValues: Record<string, string>;
  isExpanded: boolean;
  isSelected: boolean;
  isRephrasing: boolean;
  canPaste: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSave: (input: StepDraft) => void;
  onDraftChange: (input: StepDraft) => void;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onToggle: () => void;
  onToggleSelect: (checked: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChangeStepType: (nextType: TestStep["step_type"]) => void;
  onEditAutomation: () => void;
  onRephrase: () => void;
  onPasteAbove: () => void;
  onPasteBelow: () => void;
}) {
  const stepKind = getStepKindMeta(step.group_kind);
  const isDirty =
    (draft.action || "").trim() !== (step.action || "").trim()
    || (draft.expected_result || "").trim() !== (step.expected_result || "").trim()
    || !areComparableStepAutomationEqual(draft, step);
  const stepActions: StepActionMenuAction[] = [
    {
      label: "Insert above",
      description: "Open a new step slot right above this step.",
      icon: <StepInsertAboveIcon />,
      onClick: onInsertAbove
    },
    {
      label: "Insert below",
      description: "Open a new step slot right below this step.",
      icon: <StepInsertBelowIcon />,
      onClick: onInsertBelow
    },
    ...(canPaste
      ? [{
          label: "Paste above",
          description: "Insert the clipboard steps before this step.",
          icon: <StepPasteAboveIcon />,
          onClick: onPasteAbove
        }, {
          label: "Paste below",
          description: "Insert the clipboard steps after this step.",
          icon: <StepPasteBelowIcon />,
          onClick: onPasteBelow
        }]
      : []),
    {
      label: "Copy step",
      description: "Place this step in the clipboard.",
      icon: <StepCopyIcon />,
      onClick: onCopy
    },
    {
      label: "Cut step",
      description: "Move this step after you paste it somewhere else.",
      icon: <StepCutIcon />,
      onClick: onCut
    },
    {
      label: "Move up",
      description: "Shift this step earlier in its current order.",
      icon: <StepMoveUpIcon />,
      onClick: onMoveUp,
      disabled: !canMoveUp
    },
    {
      label: "Move down",
      description: "Shift this step later in its current order.",
      icon: <StepMoveDownIcon />,
      onClick: onMoveDown,
      disabled: !canMoveDown
    },
    {
      label: "Save step",
      description: "Persist the current edits on this step.",
      icon: <StepSaveIcon />,
      onClick: () => onSave(draft),
      tone: "primary",
      disabled: !isDirty
    },
    {
      label: "Delete step",
      description: "Remove this step from the current test case.",
      icon: <StepDeleteIcon />,
      onClick: onDelete,
      tone: "danger"
    }
  ];

  return (
    <article
      className={[
        isExpanded ? "step-card is-expanded" : "step-card",
        step.group_kind === "reusable" ? "step-card--shared" : "",
        step.group_kind === "local" ? "step-card--grouped" : ""
      ].filter(Boolean).join(" ")}
    >
      <div className="step-card-top">
        <label className="checkbox-field step-card-select">
          <input
            aria-label={`Select step ${step.step_order}`}
            checked={isSelected}
            onChange={(event) => onToggleSelect(event.target.checked)}
            type="checkbox"
          />
        </label>
        <div className="step-card-type-tool">
          <StepTypePickerButton value={draft.step_type || step.step_type} onChange={onChangeStepType} />
        </div>
        <button
          aria-label={isExpanded ? `Hide step ${step.step_order} details` : `Show step ${step.step_order} details`}
          className="step-card-toggle"
          onClick={onToggle}
          type="button"
        >
          <div className="step-card-summary">
            <div className="step-card-summary-row">
              <div className="step-card-summary-top">
                <StepKindIconBadge label={stepKind.label} tone={stepKind.tone} />
                <strong>Step {step.step_order}</strong>
              </div>
              <StepParameterizedText
                className="step-card-parameterized"
                fallback="No action written yet"
                text={draft.action}
                values={parameterValues}
              />
            </div>
          </div>
        </button>
        <div className="step-inline-tools">
          <InlineStepToolButton
            ariaLabel={`Rephrase step ${step.step_order} with AI`}
            className={isRephrasing ? "is-active is-loading" : ""}
            disabled={isRephrasing}
            onClick={onRephrase}
            title={isRephrasing ? "AI is rephrasing this step" : "Rephrase step with AI"}
          >
            <StepAiIcon />
          </InlineStepToolButton>
          <InlineStepToolButton
            ariaLabel={`Edit automation for step ${step.step_order}`}
            className={stepHasAutomation(draft) ? "is-active" : ""}
            onClick={onEditAutomation}
            title="Edit step automation"
          >
            <AutomationCodeIcon />
          </InlineStepToolButton>
        </div>
        <StepActionMenu
          className="step-card-menu--floating"
          label={`Step ${step.step_order} actions`}
          openOnHover
          previewActions={stepActions}
          actions={stepActions}
        />
      </div>

      {isExpanded ? (
        <div className="step-card-body">
          <FormField label="Action">
            <input value={draft.action} onChange={(event) => onDraftChange({ ...draft, action: event.target.value })} />
          </FormField>
          <FormField label="Expected result">
            <textarea rows={3} value={draft.expected_result} onChange={(event) => onDraftChange({ ...draft, expected_result: event.target.value })} />
          </FormField>
        </div>
      ) : null}
    </article>
  );
}

function DraftStepCard({
  step,
  parameterValues,
  isSelected,
  isExpanded,
  isRephrasing,
  canPaste,
  canMoveUp,
  canMoveDown,
  onChange,
  onCopy,
  onCut,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  onToggle,
  onToggleSelect,
  onMoveUp,
  onMoveDown,
  onChangeStepType,
  onEditAutomation,
  onRephrase,
  onPasteAbove,
  onPasteBelow
}: {
  step: { id: string; step_order: number; action: string; expected_result: string; step_type: TestStep["step_type"]; automation_code: string; api_request: TestStep["api_request"]; group_id: string | null; group_name: string | null; group_kind: "local" | "reusable" | null; reusable_group_id: string | null };
  parameterValues: Record<string, string>;
  isSelected: boolean;
  isExpanded: boolean;
  isRephrasing: boolean;
  canPaste: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (input: StepDraft) => void;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onToggle: () => void;
  onToggleSelect: (checked: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChangeStepType: (nextType: TestStep["step_type"]) => void;
  onEditAutomation: () => void;
  onRephrase: () => void;
  onPasteAbove: () => void;
  onPasteBelow: () => void;
}) {
  const stepKind = getStepKindMeta(step.group_kind);
  const stepActions: StepActionMenuAction[] = [
    {
      label: "Insert above",
      description: "Open a new step slot right above this draft step.",
      icon: <StepInsertAboveIcon />,
      onClick: onInsertAbove
    },
    {
      label: "Insert below",
      description: "Open a new step slot right below this draft step.",
      icon: <StepInsertBelowIcon />,
      onClick: onInsertBelow
    },
    ...(canPaste
      ? [{
          label: "Paste above",
          description: "Insert the clipboard steps before this draft step.",
          icon: <StepPasteAboveIcon />,
          onClick: onPasteAbove
        }, {
          label: "Paste below",
          description: "Insert the clipboard steps after this draft step.",
          icon: <StepPasteBelowIcon />,
          onClick: onPasteBelow
        }]
      : []),
    {
      label: "Copy step",
      description: "Place this draft step in the clipboard.",
      icon: <StepCopyIcon />,
      onClick: onCopy
    },
    {
      label: "Cut step",
      description: "Move this draft step after you paste it somewhere else.",
      icon: <StepCutIcon />,
      onClick: onCut
    },
    {
      label: "Move up",
      description: "Shift this draft step earlier in its current order.",
      icon: <StepMoveUpIcon />,
      onClick: onMoveUp,
      disabled: !canMoveUp
    },
    {
      label: "Move down",
      description: "Shift this draft step later in its current order.",
      icon: <StepMoveDownIcon />,
      onClick: onMoveDown,
      disabled: !canMoveDown
    },
    {
      label: "Delete step",
      description: "Remove this draft step from the test case.",
      icon: <StepDeleteIcon />,
      onClick: onDelete,
      tone: "danger"
    }
  ];

  return (
    <article
      className={[
        isExpanded ? "step-card is-expanded" : "step-card",
        step.group_kind === "reusable" ? "step-card--shared" : "",
        step.group_kind === "local" ? "step-card--grouped" : ""
      ].filter(Boolean).join(" ")}
    >
      <div className="step-card-top">
        <label className="checkbox-field step-card-select">
          <input
            aria-label={`Select step ${step.step_order}`}
            checked={isSelected}
            onChange={(event) => onToggleSelect(event.target.checked)}
            type="checkbox"
          />
        </label>
        <div className="step-card-type-tool">
          <StepTypePickerButton value={step.step_type} onChange={onChangeStepType} />
        </div>
        <button
          aria-label={isExpanded ? `Hide step ${step.step_order} details` : `Show step ${step.step_order} details`}
          className="step-card-toggle"
          onClick={onToggle}
          type="button"
        >
          <div className="step-card-summary">
            <div className="step-card-summary-row">
              <div className="step-card-summary-top">
                <StepKindIconBadge label={stepKind.label} tone={stepKind.tone} />
                <strong>Step {step.step_order}</strong>
              </div>
              <StepParameterizedText
                className="step-card-parameterized"
                fallback="Draft step details"
                text={step.action || step.expected_result}
                values={parameterValues}
              />
            </div>
          </div>
        </button>
        <div className="step-inline-tools">
          <InlineStepToolButton
            ariaLabel={`Rephrase step ${step.step_order} with AI`}
            className={isRephrasing ? "is-active is-loading" : ""}
            disabled={isRephrasing}
            onClick={onRephrase}
            title={isRephrasing ? "AI is rephrasing this step" : "Rephrase step with AI"}
          >
            <StepAiIcon />
          </InlineStepToolButton>
          <InlineStepToolButton
            ariaLabel={`Edit automation for step ${step.step_order}`}
            className={stepHasAutomation(step) ? "is-active" : ""}
            onClick={onEditAutomation}
            title="Edit step automation"
          >
            <AutomationCodeIcon />
          </InlineStepToolButton>
        </div>
        <StepActionMenu
          className="step-card-menu--floating"
          label={`Step ${step.step_order} actions`}
          openOnHover
          previewActions={stepActions}
          actions={stepActions}
        />
      </div>

      {isExpanded ? (
        <div className="step-card-body">
          <FormField label="Action">
            <input
              value={step.action}
              onChange={(event) =>
                onChange({
                  action: event.target.value,
                  expected_result: step.expected_result,
                  step_type: step.step_type,
                  automation_code: step.automation_code,
                  api_request: step.api_request
                })
              }
            />
          </FormField>
          <FormField label="Expected result">
            <textarea
              rows={3}
              value={step.expected_result}
              onChange={(event) =>
                onChange({
                  action: step.action,
                  expected_result: event.target.value,
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

function StepGroupModal({
  name,
  reusable,
  selectedCount,
  isSaving,
  onNameChange,
  setReusable,
  onSave,
  onClose
}: {
  name: string;
  reusable: boolean;
  selectedCount: number;
  isSaving: boolean;
  onNameChange: (value: string) => void;
  setReusable: (value: boolean) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>();

  return (
    <div className="modal-backdrop" onClick={() => !isSaving && onClose()} role="presentation">
      <div
        aria-label="Create step group"
        aria-modal="true"
        className="modal-card suite-create-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <div className="suite-create-header">
          <div className="suite-create-title">
            <h3>Create Step Group</h3>
            <p>Name this group and decide whether it should stay local to this case or become a linked shared group used in other cases.</p>
          </div>
          <button className="ghost-button" disabled={isSaving} onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="form-grid">
          <FormField label="Group name" required>
            <input
              data-autofocus="true"
              required
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </FormField>

          <label className="checkbox-field">
            <input checked={reusable} onChange={(event) => setReusable(event.target.checked)} type="checkbox" />
            Save as shared group
          </label>

          <div className="detail-summary">
            <strong>{selectedCount} step{selectedCount === 1 ? "" : "s"} selected</strong>
            <span>{reusable ? "Shared groups stay linked across every test case that references them." : "Local groups only organize the current case."}</span>
          </div>
        </div>

        <div className="action-row">
          <button className="primary-button" disabled={isSaving} onClick={onSave} type="button">
            {isSaving ? "Saving…" : reusable ? "Create shared group" : "Create group"}
          </button>
          <button className="ghost-button" disabled={isSaving} onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function SharedGroupPickerModal({
  groups,
  selectedGroupId,
  selectedGroup,
  isLoading,
  searchValue,
  onSearchChange,
  setSelectedGroupId,
  onConfirm,
  onClose
}: {
  groups: SharedStepGroup[];
  selectedGroupId: string;
  selectedGroup: SharedStepGroup | null;
  isLoading: boolean;
  searchValue: string;
  onSearchChange: (value: string) => void;
  setSelectedGroupId: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>();

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-label="Insert shared step group"
        aria-modal="true"
        className="modal-card suite-create-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <div className="suite-create-header">
          <div className="suite-create-title">
            <h3>Insert Shared Group</h3>
            <p>Choose a shared group to insert into this case. Edits inside the shared block stay linked across every referencing test case.</p>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="form-grid">
          <FormField label="Search shared groups">
            <input
              data-autofocus="true"
              placeholder="Search by name or step text"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </FormField>

          <div className="stack-list">
            {isLoading ? <div className="empty-state compact">Loading shared groups…</div> : null}
            {!isLoading && groups.map((group) => (
              <label className="stack-item" key={group.id}>
                <div>
                  <span className="step-group-title-row">
                    <span aria-hidden="true" className="step-kind-badge is-shared">
                      <SharedStepsIconGraphic size={14} />
                    </span>
                    <strong>{group.name}</strong>
                  </span>
                  <span>{group.description || `${group.steps.length} reusable step${group.steps.length === 1 ? "" : "s"}`}</span>
                </div>
                <input
                  checked={selectedGroupId === group.id}
                  onChange={() => setSelectedGroupId(group.id)}
                  type="radio"
                />
              </label>
            ))}
            {!isLoading && !groups.length ? <div className="empty-state compact">No shared step groups match this search.</div> : null}
          </div>

          {selectedGroup ? (
            <div className="detail-summary">
              <div className="step-group-title-row">
                <span aria-hidden="true" className="step-kind-badge is-shared">
                  <SharedStepsIconGraphic size={14} />
                </span>
                <strong>{selectedGroup.name}</strong>
              </div>
              <span>
                {(selectedGroup.steps[0]?.action || selectedGroup.steps[0]?.expected_result || "No preview available")}
                {selectedGroup.steps.length > 1 ? ` · ${selectedGroup.steps.length} steps total` : ""}
              </span>
            </div>
          ) : null}
        </div>

        <div className="action-row">
          <button className="primary-button" disabled={!selectedGroupId} onClick={onConfirm} type="button">
            Insert selected group
          </button>
          <button className="ghost-button" onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
