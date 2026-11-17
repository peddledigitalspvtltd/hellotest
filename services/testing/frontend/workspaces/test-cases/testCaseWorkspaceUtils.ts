import { type TestCaseDraft, type StepDraft, type AuthoringStepProjection, type DraftTestStep, type CopiedTestStep, type StepInsertionGroupContext, type TestCaseEditorSectionKey } from "./testCaseWorkspaceTypes";
import { gherkinToStructuredCase, mergeGherkinStepMetadata, splitGherkinDocument, structuredCaseToGherkin } from "./../../lib/gherkin";
import { annotateGherkinStepGroups, collectBehaviorRowGroups } from "./../../lib/gherkinBehavior";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { formatTileCardLabel } from "@hellotest/platform/frontend/src/shared/components/TileCardPrimitives";
import { type ImportedTestCaseRow } from "./../../lib/testCaseImport";
import { normalizeApiRequest, normalizeAutomationCode, normalizeStepType, resolveStepAutomationCode } from "@hellotest/automation/frontend/lib/stepAutomation";
import { normalizeStepParameterValues, type StepParameterScope } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import type { AiAuthoredTestCasePreview, Integration, TestCase, TestStep } from "@hellotest/platform/frontend/src/types";

export const stepClipboardScopeKey = (step: Pick<TestStep, "group_id" | "group_name" | "group_kind" | "reusable_group_id">) => {
  if ((step.group_name || "").trim().toLowerCase() === "preconditions") return "preconditions";
  if (step.reusable_group_id) return `shared:${step.reusable_group_id}`;
  if (step.group_id) return `group:${step.group_id}`;
  return "test-steps";
};

export const stepInsertionContextFromStep = (
  step?: Pick<TestStep, "group_id" | "group_name" | "group_kind" | "reusable_group_id"> | null
): StepInsertionGroupContext | null => step?.group_id ? {
  group_id: step.group_id,
  group_name: step.group_name || null,
  group_kind: step.group_kind || null,
  reusable_group_id: step.reusable_group_id || null
} : null;

export const TEST_CASE_RENDER_BATCH_SIZE = 240;

export const TEST_CASE_DETAIL_STALE_TIME_MS = 30_000;

export const TEST_CASE_COPY_HYDRATION_BATCH_SIZE = 4;

export const normalizeDeliveryScopeValue = (value: unknown) => String(value || "").trim().toLocaleLowerCase();

export const testCaseDetailQueryKey = (projectId: string, testCaseId: string) =>
  ["test-case-detail", projectId || "unselected", testCaseId] as const;

export const isLegacyInlineAutomationBuilderEnabled = () => false;

export const TEST_CASE_REVIEW_STATUS_LABELS: Record<NonNullable<TestCase["review_status"]>, string> = {
  not_requested: "Not requested",
  pending: "Pending",
  accepted: "Accepted",
  changes_requested: "Changes requested"
};

export const TEST_CASE_WORKFLOW_STATUS_OPTIONS = [
  { value: "ai-generated", label: "AI Generated" },
  { value: "draft", label: "Draft" },
  { value: "pending-review", label: "Pending for review" },
  { value: "active", label: "Active" },
  { value: "ready", label: "Ready" },
  { value: "automated", label: "Automated" },
  { value: "retired", label: "Retired" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" }
];

export const TEST_CASE_TYPE_OPTIONS: Array<{ value: NonNullable<TestCase["test_case_type"]>; label: string; description: string }> = [
  { value: "functional", label: "Functional", description: "Validates a user or system behavior." },
  { value: "regression", label: "Regression", description: "Protects an established behavior from change." },
  { value: "smoke", label: "Smoke", description: "Checks a critical path quickly." },
  { value: "integration", label: "Integration", description: "Validates boundaries between systems or services." },
  { value: "acceptance", label: "Acceptance", description: "Confirms a business outcome or acceptance criterion." },
  { value: "exploratory", label: "Exploratory", description: "Guides investigation without a rigid script." },
  { value: "performance", label: "Performance", description: "Measures response, throughput, or stability." },
  { value: "security", label: "Security", description: "Validates controls, permissions, and abuse resistance." },
  { value: "accessibility", label: "Accessibility", description: "Checks inclusive interaction and assistive support." },
  { value: "ios", label: "iOS", description: "Validates behavior specific to the iOS application." }
];

export const TEST_CASE_WORKFLOW_STATUS_LABELS = Object.fromEntries(
  TEST_CASE_WORKFLOW_STATUS_OPTIONS.map((option) => [option.value, option.label])
) as Record<string, string>;

export const getTestCaseWorkflowStatus = (testCase: TestCase, latestStatus?: string | null, fallbackStatus = "active") => {
  const normalizedLatest = String(latestStatus || "").toLowerCase();

  if (testCase.ai_generation_source === "scheduler" && testCase.ai_generation_review_status === "pending") {
    return "ai-generated";
  }

  if ((testCase.review_status || "not_requested") === "pending") {
    return "pending-review";
  }

  if (normalizedLatest === "failed" || normalizedLatest === "blocked") {
    return "failed";
  }

  if (normalizedLatest === "passed") {
    return "passed";
  }

  if (testCase.automated === "yes") {
    return "automated";
  }

  const normalizedStatus = String(testCase.status || fallbackStatus || "active").toLowerCase();
  return TEST_CASE_WORKFLOW_STATUS_LABELS[normalizedStatus] ? normalizedStatus : "active";
};

export const formatTestCaseWorkflowStatus = (value: string) =>
  TEST_CASE_WORKFLOW_STATUS_LABELS[value] || formatTileCardLabel(value, "Active");

export const formatCompactDuration = (durationMs: number | null) => {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
    return "No runs";
  }
  if (durationMs < 1_000) {
    return `${Math.round(durationMs)}ms`;
  }
  if (durationMs < 60_000) {
    const seconds = durationMs / 1_000;
    return `${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)}s`;
  }
  const minutes = durationMs / 60_000;
  return `${minutes >= 10 ? Math.round(minutes) : minutes.toFixed(1)}m`;
};

export const getTestCaseExecutionTypeLabel = (steps: Array<Pick<TestStep, "step_type" | "api_request">> = []) => {
  if (!steps.length) {
    return "Web";
  }

  const types = new Set(steps.map((step) => normalizeStepType(step.step_type)));
  const hasApi = Array.from(types).some((type) => type === "api") || steps.some((step) => Boolean(step.api_request));
  const hasWeb = types.has("web");
  const hasMobile = types.has("android") || types.has("ios");

  if (hasMobile && (hasWeb || hasApi || types.size > 1)) {
    return "Unified";
  }

  if (hasMobile) {
    return "Mobile";
  }

  if (hasApi && !hasWeb) {
    return "API";
  }

  return "Web";
};

export const createEmptyCaseDraft = (
  defaultStatus = "active",
  defaultAutomated: "yes" | "no" = "no",
  currentUserId = "",
  defaultType = "functional"
): TestCaseDraft => ({
  title: "",
  description: "",
  externalReferencesText: "",
  labelsText: "",
  automated: defaultAutomated,
  priority: 3,
  status: defaultStatus,
  requirement_id: "",
  module_id: "",
  author_id: currentUserId,
  reviewer_id: "",
  authoring_mode: "structured",
  test_case_type: defaultType,
  gherkin_document: ""
});

export const EMPTY_STEP_DRAFT: StepDraft = {
  action: "",
  expected_result: "",
  step_type: "web",
  automation_code: "",
  api_request: null
};

export const executionHistoryDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

export const createDefaultTestCaseSections = (): Record<TestCaseEditorSectionKey, boolean> => ({
  case: true,
  preconditions: true,
  steps: true,
  dataSets: true,
  automation: false,
  history: false
});

export const createCreateModeTestCaseSections = (): Record<TestCaseEditorSectionKey, boolean> => ({
  case: true,
  preconditions: true,
  steps: true,
  dataSets: true,
  automation: false,
  history: false
});

export const createDraftStepId = () =>
  globalThis.crypto?.randomUUID?.() || `draft-step-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const buildCaseStepsFromGherkin = (value: string, previousSteps: DraftTestStep[]): DraftTestStep[] => {
  const converted = gherkinToStructuredCase(value);
  const createStep = (): DraftTestStep => ({ id: createDraftStepId(), action: "", expected_result: "", step_type: "web", automation_code: "", api_request: null, group_id: null, group_name: null, group_kind: null, reusable_group_id: null });
  const isPrecondition = (step: DraftTestStep) => (step.group_name || "").toLowerCase() === "preconditions";
  const preconditions = mergeGherkinStepMetadata(converted.preconditions, previousSteps.filter(isPrecondition), createStep)
    .map((step) => ({ ...step, group_name: "Preconditions", group_kind: "local" as const }));
  const groupMembership = splitGherkinDocument(value).scenarios.flatMap((scenario) => collectBehaviorRowGroups(scenario.scenario));
  const main = mergeGherkinStepMetadata(converted.steps, previousSteps.filter((step) => !isPrecondition(step)), createStep)
    .map((step, index) => {
      const group = groupMembership[index];
      if (!group) return step;
      const previousGroup = previousSteps.find((item) => item.group_id === group.id);
      return { ...step, group_id: group.id, group_name: group.name, group_kind: "reusable" as const, reusable_group_id: previousGroup?.reusable_group_id || step.reusable_group_id };
    });
  return [...preconditions, ...main];
};

export const buildGroupedCaseGherkin = (input: Omit<Parameters<typeof structuredCaseToGherkin>[0], "steps"> & { steps?: Array<Partial<TestStep>> }) => {
  const groups = (input.steps || []).reduce<Array<{ id: string; name: string; steps: Array<Partial<TestStep>> }>>((result, step) => {
    if (!step.group_id || step.group_kind !== "reusable") return result;
    const previous = result[result.length - 1];
    if (previous?.id === step.group_id) previous.steps.push(step);
    else result.push({ id: step.group_id, name: step.group_name || "Shared Step Group", steps: [step] });
    return result;
  }, []);
  return annotateGherkinStepGroups(structuredCaseToGherkin(input), groups.map((group) => ({
    id: group.id, name: group.name,
    lines: splitGherkinDocument(structuredCaseToGherkin({ title: input.title, steps: group.steps })).scenarios[0]?.scenario.split("\n").slice(1) || []
  })));
};

export const createDraftGroupId = () =>
  globalThis.crypto?.randomUUID?.() || `draft-group-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const buildGherkinQualitySteps = (document: string) => splitGherkinDocument(document).scenarios.map((item) => {
  const behaviorLines = item.scenario
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(?:Given|When|Then|And|But|\*)\b/i.test(line));
  const expectedIndex = behaviorLines.findIndex((line) => /^Then\b/i.test(line));
  const actionLines = behaviorLines.slice(0, expectedIndex < 0 ? behaviorLines.length : expectedIndex);
  const expectedLines = expectedIndex < 0 ? [] : behaviorLines.slice(expectedIndex);
  return {
    action: actionLines.join("\n"),
    expected_result: expectedLines.join("\n"),
    step_type: "web" as const,
    automation_code: null,
    api_request: null
  };
});

export const calculateTestCaseAiQualityScore = ({
  title,
  description,
  steps,
  requirementId,
  labels,
  parameterValues
}: {
  title: string;
  description?: string | null;
  steps: Array<Pick<TestStep, "action" | "expected_result" | "step_type" | "automation_code" | "api_request">> | DraftTestStep[];
  requirementId?: string | null;
  labels?: string[];
  parameterValues?: Record<string, string>;
}) => {
  let score = 8;
  const plainTitle = richTextToPlainText(title);
  const plainDescription = richTextToPlainText(description || "");
  const meaningfulSteps = steps.filter((step) => richTextToPlainText(step.action || "").trim() || richTextToPlainText(step.expected_result || "").trim());
  const completeSteps = meaningfulSteps.filter((step) => richTextToPlainText(step.action || "").trim() && richTextToPlainText(step.expected_result || "").trim());
  const automationReadySteps = meaningfulSteps.filter((step) => {
    const hasAutomationCode = "automation_code" in step && richTextToPlainText(step.automation_code || "").trim();
    const hasApiRequest = "api_request" in step && step.api_request;
    return hasAutomationCode || hasApiRequest;
  });
  const parameterCount = Object.keys(parameterValues || {}).filter((key) => key.trim()).length;

  if (plainTitle.length >= 8) score += 12;
  if (plainTitle.length >= 28) score += 4;
  if (plainDescription.length >= 40) score += 14;
  if (plainDescription.length >= 120) score += 6;
  if (requirementId) score += 12;
  if (labels?.length) score += Math.min(10, labels.length * 4);
  if (meaningfulSteps.length) score += Math.min(22, meaningfulSteps.length * 5);
  if (meaningfulSteps.length && completeSteps.length === meaningfulSteps.length) score += 14;
  if (parameterCount) score += Math.min(8, parameterCount * 4);
  if (automationReadySteps.length) score += Math.min(8, automationReadySteps.length * 3);

  return Math.max(0, Math.min(100, score));
};

export const buildTestCaseQualitySuggestions = ({
  title,
  description,
  steps,
  requirementId,
  labels,
  parameterValues,
  authoringMode = "structured"
}: {
  title: string;
  description?: string | null;
  steps: Array<Pick<TestStep, "action" | "expected_result" | "step_type" | "automation_code" | "api_request">> | DraftTestStep[];
  requirementId?: string | null;
  labels?: string[];
  parameterValues?: Record<string, string>;
  authoringMode?: "structured" | "gherkin";
}) => {
  const suggestions: string[] = [];
  const plainTitle = richTextToPlainText(title);
  const plainDescription = richTextToPlainText(description || "");
  const meaningfulSteps = steps.filter((step) => richTextToPlainText(step.action || "").trim() || richTextToPlainText(step.expected_result || "").trim());
  const incompleteSteps = meaningfulSteps.filter((step) => !richTextToPlainText(step.action || "").trim() || !richTextToPlainText(step.expected_result || "").trim());
  const parameterCount = Object.keys(parameterValues || {}).filter((key) => key.trim()).length;

  if (plainTitle.length < 28) suggestions.push("Make the title describe the business condition and expected outcome.");
  if (plainDescription.length < 120) suggestions.push("Add a richer description with scope, entry criteria, and validation intent.");
  if (!requirementId) suggestions.push("Link the test case to a story so coverage remains traceable.");
  if (!labels?.length) suggestions.push("Add labels for area, risk, platform, or release slicing.");
  if (authoringMode === "gherkin") {
    if (!meaningfulSteps.length) suggestions.push("Add at least one Scenario with an action and an observable Then outcome.");
    if (incompleteSteps.length) suggestions.push("Give every Scenario both an action and an observable Then outcome.");
  } else {
    if (meaningfulSteps.length < 3) suggestions.push("Add enough ordered steps to make the case independently executable.");
    if (incompleteSteps.length) suggestions.push("Complete both action and expected result for every step.");
  }
  if (!parameterCount) suggestions.push("Capture reusable Test Params where the case depends on specific values.");

  return suggestions;
};

export const TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY = "hellotest.testCaseParameterDrafts.v1";

export const SUITE_PARAMETER_DRAFT_STORAGE_KEY = "hellotest.suiteParameterDrafts.v1";

export const RUN_PARAMETER_PREVIEW_STORAGE_KEY = "hellotest.runParameterPreviewDrafts.v1";

export const TEST_CASE_RUN_POLL_INTERVAL_MS = 20_000;

export const normalizeScopedParameterValues = (
  values?: Record<string, unknown> | null,
  scope: StepParameterScope = "t"
) => normalizeStepParameterValues((values || {}) as Record<string, string>, scope);

export const normalizeTestCaseParameterValues = (values?: Record<string, unknown> | null) =>
  normalizeScopedParameterValues(values, "t");

export const normalizeSuiteParameterValues = (values?: Record<string, unknown> | null) =>
  normalizeScopedParameterValues(values, "s");

export const normalizeRunParameterValues = (values?: Record<string, unknown> | null) =>
  normalizeScopedParameterValues(values, "r");

export const serializeScopedParameterValues = (
  values?: Record<string, unknown> | null,
  scope: StepParameterScope = "t"
) =>
  JSON.stringify(
    Object.entries(normalizeScopedParameterValues(values, scope))
      .sort(([left], [right]) => left.localeCompare(right))
  );

export const serializeTestCaseParameterValues = (values?: Record<string, unknown> | null) =>
  serializeScopedParameterValues(values, "t");

export const areTestCaseParameterValuesEqual = (
  left?: Record<string, unknown> | null,
  right?: Record<string, unknown> | null
) => serializeTestCaseParameterValues(left) === serializeTestCaseParameterValues(right);

export const areSuiteParameterValuesEqual = (
  left?: Record<string, unknown> | null,
  right?: Record<string, unknown> | null
) => serializeScopedParameterValues(left, "s") === serializeScopedParameterValues(right, "s");

export const readStoredParameterDrafts = (storageKey: string, scope: StepParameterScope = "t") => {
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

export const writeStoredParameterDrafts = (storageKey: string, drafts: Record<string, Record<string, string>>) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(drafts));
  } catch {
    // Ignore storage failures and keep the in-memory editor responsive.
  }
};

export const readStoredTestCaseParameterDrafts = () => readStoredParameterDrafts(TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, "t");

export const readStoredSuiteParameterDrafts = () => readStoredParameterDrafts(SUITE_PARAMETER_DRAFT_STORAGE_KEY, "s");

export const readStoredRunParameterDrafts = () => readStoredParameterDrafts(RUN_PARAMETER_PREVIEW_STORAGE_KEY, "r");

export const readStoredParameterDraft = (
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

export const hasStoredParameterDraft = (
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

export const writeStoredParameterDraft = (
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

export const clearStoredParameterDraft = (
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

export const readStoredTestCaseParameterDraft = (scopeKey: string) => readStoredParameterDraft(TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "t");

export const hasStoredTestCaseParameterDraft = (scopeKey: string) => hasStoredParameterDraft(TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "t");

export const writeStoredTestCaseParameterDraft = (scopeKey: string, values: Record<string, string>) =>
  writeStoredParameterDraft(TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, values, "t");

export const clearStoredTestCaseParameterDraft = (scopeKey: string) => clearStoredParameterDraft(TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "t");

export const readStoredSuiteParameterDraft = (scopeKey: string) => readStoredParameterDraft(SUITE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "s");

export const hasStoredSuiteParameterDraft = (scopeKey: string) => hasStoredParameterDraft(SUITE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "s");

export const writeStoredSuiteParameterDraft = (scopeKey: string, values: Record<string, string>) =>
  writeStoredParameterDraft(SUITE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, values, "s");

export const clearStoredSuiteParameterDraft = (scopeKey: string) => clearStoredParameterDraft(SUITE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "s");

export const readStoredRunParameterDraft = (scopeKey: string) => readStoredParameterDraft(RUN_PARAMETER_PREVIEW_STORAGE_KEY, scopeKey, "r");

export const writeStoredRunParameterDraft = (scopeKey: string, values: Record<string, string>) =>
  writeStoredParameterDraft(RUN_PARAMETER_PREVIEW_STORAGE_KEY, scopeKey, values, "r");

export const clearStoredRunParameterDraft = (scopeKey: string) => clearStoredParameterDraft(RUN_PARAMETER_PREVIEW_STORAGE_KEY, scopeKey, "r");

export const buildTestCaseParameterDraftScopeKey = ({
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

export const buildSuiteParameterDraftScopeKey = (suiteId?: string | null) => (suiteId ? `suite:${suiteId}` : "");

export const buildRunParameterDraftScopeKey = (appTypeId?: string | null) => `run:${appTypeId || "global"}`;

export const buildAuthoringLensCode = (title: string, steps: AuthoringStepProjection[], emptyMessage: string) => {
  if (!steps.length) {
    return `// ${emptyMessage}`;
  }

  const caseTitle = title.trim() || "Test case";
  const blocks = steps.map((step) => {
    const stepType = normalizeStepType(step.step_type);
    const stepLabel = [`Step ${step.step_order}`, stepType.toUpperCase()].join(" · ");
    const action = richTextToPlainText(step.action || "").trim();
    const expected = richTextToPlainText(step.expected_result || "").trim();

    return [
      `// ${stepLabel}`,
      action ? `// Manual action: ${action}` : "",
      expected ? `// Expected result: ${expected}` : "",
      resolveStepAutomationCode(step)
    ].filter(Boolean).join("\n");
  });

  return [`// Test case: ${caseTitle}`, ...blocks].join("\n\n");
};

export const normalizeDraftSteps = (steps: DraftTestStep[]) =>
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
    .filter((step) => richTextToPlainText(step.action).trim() || richTextToPlainText(step.expected_result).trim());

export function stripAutomationStepFields<T extends { automation_code?: unknown; api_request?: unknown }>(step: T) {
  const { automation_code: _automationCode, api_request: _apiRequest, ...manualFields } = step;
  return manualFields;
}

export function importedRowHasProtectedAutomation(row: ImportedTestCaseRow) {
  const containsProtectedValue = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some(containsProtectedValue);
    return Object.entries(value).some(([key, child]) => {
      if (key === "automation_code") return Boolean(String(child || "").trim());
      if (key === "api_request") return Boolean(child && typeof child === "object" && Object.keys(child).length);
      return containsProtectedValue(child);
    });
  };

  return containsProtectedValue(row);
}

export const buildDraftStepsFromAiAuthoringPreview = (preview: AiAuthoredTestCasePreview): DraftTestStep[] =>
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

export const buildPersistedStepsFromAiAuthoringPreview = (preview: AiAuthoredTestCasePreview) =>
  preview.steps.map((step, index) => ({
    step_order: index + 1,
    step_type: normalizeStepType(step.step_type),
    action: step.action || undefined,
    expected_result: step.expected_result || undefined
  }));

export const normalizeCopiedSteps = (
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

export const materializeCopiedSteps = (steps: CopiedTestStep[]) => {
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

export const formatBulkStepActionLabel = (
  step: Pick<TestStep, "action" | "group_id" | "group_name" | "group_kind" | "reusable_group_id">,
  sharedGroupNameById: Record<string, string>
) => {
  const action = step.action || "";

  if (step.reusable_group_id) {
    const sharedName = sharedGroupNameById[step.reusable_group_id] || step.group_name || "Shared Step Group";
    return `[Shared Step Group: ${sharedName}]${action ? ` ${action}` : ""}`;
  }

  if (step.group_id || (step.group_kind === "local" && step.group_name)) {
    return `[Group: ${step.group_name || "Grouped steps"}]${action ? ` ${action}` : ""}`;
  }

  return action;
};

export const formatExecutionHistoryDate = (value?: string | null) => {
  if (!value) {
    return "Recent run";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : executionHistoryDateFormatter.format(parsed);
};

export function resolveScopedIntegration(integrations: Integration[], type: Integration["type"], projectId: string) {
  const active = integrations.filter((integration) => integration.type === type && integration.is_active);
  const scoped = projectId
    ? active.find((integration) => String(integration.config?.project_id || "") === projectId)
    : null;

  return scoped || active.find((integration) => !String(integration.config?.project_id || "").trim()) || active[0] || null;
}

export function formatRecorderDisplayMode(value?: string | null) {
  return value === "browser-live-view" ? "Live view" : value === "local-browser-with-live-view" ? "Local browser + live view" : "Recorder";
}

export const formatModuleCaseUpdatedAt = (value?: string | null) => {
  if (!value) return "—";
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) return value;
  const elapsedMs = Math.max(0, Date.now() - updatedAt.getTime());
  const elapsedHours = Math.floor(elapsedMs / 3_600_000);
  if (elapsedHours < 1) return "Just now";
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays === 1) return "Yesterday";
  if (elapsedDays < 14) return `${elapsedDays}d ago`;
  return updatedAt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

export const buildStepBlocks = <T extends { id: string; group_id?: string | null }>(items: T[]) =>
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
