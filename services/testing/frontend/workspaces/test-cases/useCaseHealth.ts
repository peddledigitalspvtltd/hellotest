import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type { TestCaseImpactPreviewResponse, TestCaseReviewStatus } from '@hellotest/platform/frontend/src/types';
import { buildGherkinQualitySteps, calculateTestCaseAiQualityScore, buildTestCaseQualitySuggestions } from "./testCaseWorkspaceUtils";
import { type TestCaseDraft, type StepDraft } from "./testCaseWorkspaceTypes";
import { useEffect, useMemo } from "react";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { assessTestCaseReviewReadiness } from "@hellotest/ai/frontend/lib/aiAssurance";
import { buildTestCaseAssuranceAnalysis, mergeAssuranceReview } from "@hellotest/ai/frontend/lib/artifactAssurance";
import { parseReferenceList } from "@hellotest/platform/frontend/src/shared/lib/externalReferences";
import type { ExecutionResult, Requirement, TestCase, TestStep, TestSuite } from "@hellotest/platform/frontend/src/types";

export interface useCaseHealthInputs {
  projectId: string;
  canViewTestData: boolean;
  canUseTestCaseAi: boolean;
  canViewAutomationCode: boolean;
  getPrompt: (key: string) => string;
  isCreating: boolean;
  caseDraft: TestCaseDraft;
  linkedDataSetDraftIds: string[];
  overrideSharedGroupData: boolean;
  testCaseParameterValues: Record<string, string>;
  stepDrafts: Record<string, StepDraft>;
  createSuiteContextId: string;
  setIsTestCaseImpactPreviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  testCaseAssuranceIntegrationId: string;
  testCaseAssurancePromptGuidance: string | undefined;
  testCaseAssuranceContext: string;
  testCaseAssuranceContextBusy: boolean;
  selectedTestCaseResultsQuery: UseQueryResult<ExecutionResult[], Error>;
  previewTestCaseImpact: UseMutationResult<TestCaseImpactPreviewResponse, Error, { testCaseId: string; input: Parameters<typeof api.testCases.previewImpact>[1]; }, unknown>;
  previewTestCaseChangeImpact: UseMutationResult<TestCaseImpactPreviewResponse, Error, { testCaseId: string; input: Parameters<typeof api.testCases.previewImpact>[1]; }, unknown>;
  requirements: Requirement[];
  suites: TestSuite[];
  testCaseAssuranceDefaultIntegrationId: string;
  testCaseImpactDefaultIntegrationId: string;
  displaySteps: TestStep[];
  historyByCaseId: Record<string, ExecutionResult[]>;
  selectedTestCase: TestCase | null;
  linkedDataSetSensitiveParameterNames: Set<string>;
  selectedReviewStatus: TestCaseReviewStatus;
  visibleTestCaseParameterValues: Record<string, string>;
}

export function useCaseHealth({ projectId, canViewTestData, canUseTestCaseAi, canViewAutomationCode, getPrompt, isCreating, caseDraft, linkedDataSetDraftIds, overrideSharedGroupData, testCaseParameterValues, stepDrafts, createSuiteContextId, setIsTestCaseImpactPreviewOpen, testCaseAssuranceIntegrationId, testCaseAssurancePromptGuidance, testCaseAssuranceContext, testCaseAssuranceContextBusy, selectedTestCaseResultsQuery, previewTestCaseImpact, previewTestCaseChangeImpact, requirements, suites, testCaseAssuranceDefaultIntegrationId, testCaseImpactDefaultIntegrationId, displaySteps, historyByCaseId, selectedTestCase, linkedDataSetSensitiveParameterNames, selectedReviewStatus, visibleTestCaseParameterValues }: useCaseHealthInputs) {
const selectedRequirement = requirements.find((item) => item.id === caseDraft.requirement_id) || null;

const caseDraftLabels = useMemo(() => parseReferenceList(caseDraft.labelsText), [caseDraft.labelsText]);

const gherkinQualitySteps = useMemo(() => buildGherkinQualitySteps(caseDraft.gherkin_document), [caseDraft.gherkin_document]);

const qualityAnalysisSteps = useMemo(
    () => caseDraft.authoring_mode === "gherkin"
      ? gherkinQualitySteps
      : canViewAutomationCode
        ? displaySteps
        : displaySteps.map((step) => ({ ...step, automation_code: "", api_request: null })),
    [canViewAutomationCode, caseDraft.authoring_mode, displaySteps, gherkinQualitySteps]
  );

const computedCaseAiQualityScore = useMemo(
    () =>
      calculateTestCaseAiQualityScore({
        title: caseDraft.title,
        description: caseDraft.description,
        steps: qualityAnalysisSteps,
        requirementId: caseDraft.requirement_id,
        labels: caseDraftLabels,
        parameterValues: testCaseParameterValues
      }),
    [caseDraft.description, caseDraft.requirement_id, caseDraft.title, caseDraftLabels, qualityAnalysisSteps, testCaseParameterValues]
  );

const caseQualitySuggestions = useMemo(
    () =>
      buildTestCaseQualitySuggestions({
        title: caseDraft.title,
        description: caseDraft.description,
        steps: qualityAnalysisSteps,
        requirementId: caseDraft.requirement_id,
        labels: caseDraftLabels,
        parameterValues: testCaseParameterValues,
        authoringMode: caseDraft.authoring_mode
      }),
    [caseDraft.authoring_mode, caseDraft.description, caseDraft.requirement_id, caseDraft.title, caseDraftLabels, qualityAnalysisSteps, testCaseParameterValues]
  );

const testCaseReviewReadiness = useMemo(() => {
    const reviewSteps = caseDraft.authoring_mode === "gherkin"
      ? gherkinQualitySteps
      : displaySteps.map((step) => ({
          action: stepDrafts[step.id]?.action ?? step.action ?? "",
          expected_result: stepDrafts[step.id]?.expected_result ?? step.expected_result ?? ""
        }));
    const completeStepCount = reviewSteps.filter((step) =>
      richTextToPlainText(step.action || "").trim()
      && richTextToPlainText(step.expected_result || "").trim()
    ).length;

    return assessTestCaseReviewReadiness({
      qualityScore: computedCaseAiQualityScore,
      stepCount: reviewSteps.length,
      completeStepCount,
      requirementCount: caseDraft.requirement_id ? 1 : 0,
      reviewStatus: isCreating ? "not_requested" : selectedReviewStatus,
      suggestions: caseQualitySuggestions
    });
  }, [caseDraft.authoring_mode, caseDraft.requirement_id, caseQualitySuggestions, computedCaseAiQualityScore, displaySteps, gherkinQualitySteps, isCreating, selectedReviewStatus, stepDrafts]);

const selectedTestCaseAssuranceProposedChange = useMemo(() => ({
    title: caseDraft.title,
    description: richTextToPlainText(caseDraft.description),
    status: caseDraft.status,
    priority: caseDraft.priority,
    automated: caseDraft.automated,
    requirement_id: caseDraft.requirement_id,
    module_id: caseDraft.module_id,
    author_id: caseDraft.author_id,
    reviewer_id: caseDraft.reviewer_id,
    authoring_mode: caseDraft.authoring_mode,
    gherkin_document: caseDraft.gherkin_document,
    test_case_type: caseDraft.test_case_type,
    ...(canViewTestData ? { test_data_set_ids: linkedDataSetDraftIds, test_data_options: { ...selectedTestCase?.test_data_options, private_parameter_names: [...linkedDataSetSensitiveParameterNames].sort(), override_shared_steps: overrideSharedGroupData } } : {}),
    external_references: parseReferenceList(caseDraft.externalReferencesText),
    labels: caseDraftLabels,
    parameter_values: visibleTestCaseParameterValues,
    steps: caseDraft.authoring_mode === "gherkin" ? gherkinQualitySteps : displaySteps.map((step) => ({
      id: step.id,
      step_order: step.step_order,
      step_type: stepDrafts[step.id]?.step_type ?? step.step_type,
      action: richTextToPlainText(stepDrafts[step.id]?.action ?? step.action ?? ""),
      expected_result: richTextToPlainText(stepDrafts[step.id]?.expected_result ?? step.expected_result ?? ""),
      automation_code: canViewAutomationCode ? stepDrafts[step.id]?.automation_code ?? step.automation_code ?? "" : undefined,
      api_request: canViewAutomationCode ? stepDrafts[step.id]?.api_request ?? step.api_request ?? null : undefined
    }))
  }), [canViewTestData, linkedDataSetDraftIds, overrideSharedGroupData, caseDraft.module_id, caseDraft.author_id, caseDraft.reviewer_id, caseDraft.authoring_mode, caseDraft.gherkin_document, caseDraft.test_case_type, gherkinQualitySteps, canViewAutomationCode, caseDraft.automated, caseDraft.description, caseDraft.externalReferencesText, caseDraft.priority, caseDraft.requirement_id, caseDraft.status, caseDraft.title, caseDraftLabels, displaySteps, stepDrafts, visibleTestCaseParameterValues, selectedTestCase?.test_data_options, linkedDataSetSensitiveParameterNames]);

const selectedTestCaseAssuranceSteps = useMemo(
    () => caseDraft.authoring_mode === "gherkin" ? gherkinQualitySteps : selectedTestCaseAssuranceProposedChange.steps,
    [caseDraft.authoring_mode, gherkinQualitySteps, selectedTestCaseAssuranceProposedChange.steps]
  );

const selectedTestCaseAssuranceFingerprint = useMemo(
    () => JSON.stringify(selectedTestCaseAssuranceProposedChange),
    [selectedTestCaseAssuranceProposedChange]
  );

useEffect(() => {
    setIsTestCaseImpactPreviewOpen(false);
  }, [selectedTestCase?.id, selectedTestCaseAssuranceFingerprint]);

const testCaseAssuranceRequestMatchesDraft = Boolean(
    selectedTestCase
    && previewTestCaseImpact.variables?.testCaseId === selectedTestCase.id
    && previewTestCaseImpact.variables.input.review_purpose === "assurance"
    && JSON.stringify(previewTestCaseImpact.variables.input.proposed_change) === selectedTestCaseAssuranceFingerprint
    && (previewTestCaseImpact.variables.input.additional_context || "") === testCaseAssuranceContext
    && previewTestCaseImpact.variables.input.prompt_guidance === (testCaseAssurancePromptGuidance ?? getPrompt("ai.quality.test_case_assurance"))
    && (previewTestCaseImpact.variables.input.integration_id || "") === (testCaseAssuranceIntegrationId || testCaseAssuranceDefaultIntegrationId)
  );

const testCaseAssurancePreviewMatchesDraft = Boolean(
    testCaseAssuranceRequestMatchesDraft
    && selectedTestCase
    && previewTestCaseImpact.data?.test_case?.id === selectedTestCase.id
  );

const isTestCaseAssuranceDraftChanged = Boolean(
    selectedTestCase
    && (previewTestCaseImpact.data?.assurance_review || previewTestCaseImpact.data?.assurance)
    && previewTestCaseImpact.data.test_case.id === selectedTestCase.id
    && previewTestCaseImpact.variables?.testCaseId === selectedTestCase.id
    && !testCaseAssurancePreviewMatchesDraft
  );

const testCaseImpactRequestMatchesDraft = Boolean(
    selectedTestCase
    && previewTestCaseChangeImpact.variables?.testCaseId === selectedTestCase.id
    && JSON.stringify(previewTestCaseChangeImpact.variables.input.proposed_change) === selectedTestCaseAssuranceFingerprint
    && (previewTestCaseChangeImpact.variables.input.additional_context || "") === testCaseAssuranceContext
    && previewTestCaseChangeImpact.variables.input.prompt_guidance === (testCaseAssurancePromptGuidance ?? getPrompt("ai.test_case.change_impact"))
    && (previewTestCaseChangeImpact.variables.input.integration_id || "") === (testCaseAssuranceIntegrationId || testCaseImpactDefaultIntegrationId)
  );

const selectedTestCaseImpactPreview = testCaseImpactRequestMatchesDraft
    ? previewTestCaseChangeImpact.data
    : null;

const runTestCaseImpactAnalysis = (force = false) => {
    if (!selectedTestCase || !projectId || !canUseTestCaseAi || previewTestCaseChangeImpact.isPending || testCaseAssuranceContextBusy) return;
    if (!force && testCaseImpactRequestMatchesDraft && previewTestCaseChangeImpact.data) return;
    previewTestCaseChangeImpact.reset();
    previewTestCaseChangeImpact.mutate({
      testCaseId: selectedTestCase.id,
      input: {
        project_id: projectId,
        review_purpose: "change-impact",
        proposed_change: selectedTestCaseAssuranceProposedChange,
        integration_id: testCaseAssuranceIntegrationId || testCaseImpactDefaultIntegrationId || undefined,
        prompt_guidance: testCaseAssurancePromptGuidance ?? getPrompt("ai.test_case.change_impact"),
        additional_context: testCaseAssuranceContext,
        assurance_baseline: selectedTestCaseLocalAssurance
      }
    });
  };

const runTestCaseAssuranceAnalysis = (openImpactPreview = false) => {
    if (!selectedTestCase || !projectId || !canUseTestCaseAi || previewTestCaseImpact.isPending || testCaseAssuranceContextBusy) return;
    setIsTestCaseImpactPreviewOpen(openImpactPreview);
    previewTestCaseImpact.reset();
    previewTestCaseImpact.mutate({
      testCaseId: selectedTestCase.id,
      input: {
        project_id: projectId,
        review_purpose: "assurance",
        proposed_change: selectedTestCaseAssuranceProposedChange,
        integration_id: testCaseAssuranceIntegrationId || testCaseAssuranceDefaultIntegrationId || undefined,
        prompt_guidance: (testCaseAssurancePromptGuidance ?? getPrompt("ai.quality.test_case_assurance")),
        additional_context: testCaseAssuranceContext,
        assurance_baseline: selectedTestCaseLocalAssurance
      }
    });
  };

const openTestCaseImpactPreview = () => {
    setIsTestCaseImpactPreviewOpen(true);
    runTestCaseImpactAnalysis();
  };

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

const selectedHistory = useMemo(() => {
    if (!selectedTestCase) return [];
    const selectedCaseReferences = new Set(
      [selectedTestCase.id, selectedTestCase.display_id].filter(Boolean).map(String)
    );
    const source = selectedTestCaseResultsQuery.data ?? historyByCaseId[selectedTestCase.id] ?? [];
    return source
      .filter((result) => [result.test_case_id, result.test_case_display_id]
        .filter(Boolean)
        .some((reference) => selectedCaseReferences.has(String(reference))))
      .slice()
      .sort((left, right) => {
        const leftTime = Date.parse(String(left.updated_at || left.created_at || "")) || 0;
        const rightTime = Date.parse(String(right.updated_at || right.created_at || "")) || 0;
        if (leftTime !== rightTime) return rightTime - leftTime;
        return String(right.id || "").localeCompare(String(left.id || ""));
      });
  }, [historyByCaseId, selectedTestCase, selectedTestCaseResultsQuery.data]);

const selectedCaseHealthMetrics = useMemo(() => {
    const latestCaseResultByRun = new Map<string, ExecutionResult>();
    selectedHistory.forEach((result) => {
      const resultWithRunAliases = result as ExecutionResult & {
        run_id?: string | null;
        test_run_id?: string | null;
        executionId?: string | null;
        runId?: string | null;
      };
      const executionId = [
        resultWithRunAliases.execution_id,
        resultWithRunAliases.run_id,
        resultWithRunAliases.test_run_id,
        resultWithRunAliases.executionId,
        resultWithRunAliases.runId
      ].map((value) => String(value || "").trim()).find(Boolean) || "";
      if (!executionId || (!latestCaseResultByRun.has(executionId) && latestCaseResultByRun.size >= 25)) return;

      const current = latestCaseResultByRun.get(executionId);
      if (!current) {
        latestCaseResultByRun.set(executionId, result);
        return;
      }

      const currentTime = Date.parse(String(current.updated_at || current.created_at || ""));
      const resultTime = Date.parse(String(result.updated_at || result.created_at || ""));
      if (
        (Number.isFinite(resultTime) && (!Number.isFinite(currentTime) || resultTime >= currentTime))
        || (!Number.isFinite(resultTime) && !Number.isFinite(currentTime))
      ) {
        latestCaseResultByRun.set(executionId, result);
      }
    });

    const finalizedRuns = [...latestCaseResultByRun.values()]
      .filter((result) => ["passed", "failed", "blocked"].includes(String(result.status || "").toLowerCase()));
    const passedRuns = finalizedRuns.filter((result) => String(result.status || "").toLowerCase() === "passed").length;
    const authoredBehaviorSteps = caseDraft.authoring_mode === "gherkin"
      ? gherkinQualitySteps
      : displaySteps.map((step) => ({
          action: stepDrafts[step.id]?.action ?? step.action ?? "",
          expected_result: stepDrafts[step.id]?.expected_result ?? step.expected_result ?? ""
        }));
    const completeSteps = authoredBehaviorSteps.filter((step) =>
      richTextToPlainText(step.action || "").trim()
      && richTextToPlainText(step.expected_result || "").trim()
    ).length;
    const stepCompleteness = authoredBehaviorSteps.length
      ? Math.round((completeSteps / authoredBehaviorSteps.length) * 100)
      : 0;
    const passRate = finalizedRuns.length ? Math.round((passedRuns / finalizedRuns.length) * 100) : null;

    return {
      authoring: computedCaseAiQualityScore,
      finalizedRuns: finalizedRuns.length,
      passedRuns,
      stepCompleteness,
      passRate
    };
  }, [caseDraft.authoring_mode, computedCaseAiQualityScore, displaySteps, gherkinQualitySteps, selectedHistory, stepDrafts]);

const authoredBehaviorUnitCount = caseDraft.authoring_mode === "gherkin"
    ? gherkinQualitySteps.length
    : displaySteps.length;

const selectedTestCaseLocalAssurance = useMemo(
    () => buildTestCaseAssuranceAnalysis({
      title: selectedTestCaseAssuranceProposedChange.title,
      description: selectedTestCaseAssuranceProposedChange.description,
      steps: selectedTestCaseAssuranceSteps,
      requirementCount: selectedTestCaseAssuranceProposedChange.requirement_id ? 1 : 0,
      labels: selectedTestCaseAssuranceProposedChange.labels,
      parameterValues: selectedTestCaseAssuranceProposedChange.parameter_values,
      reviewStatus: selectedReviewStatus,
      finalizedRunCount: selectedCaseHealthMetrics.finalizedRuns,
      passRate: selectedCaseHealthMetrics.passRate,
      suiteCount: selectedCaseSuites.length,
      externalReferenceCount: selectedTestCaseAssuranceProposedChange.external_references.length
    }),
    [selectedCaseHealthMetrics.finalizedRuns, selectedCaseHealthMetrics.passRate, selectedCaseSuites.length, selectedReviewStatus, selectedTestCaseAssuranceProposedChange, selectedTestCaseAssuranceSteps]
  );

const selectedTestCaseAssurance = mergeAssuranceReview(selectedTestCaseLocalAssurance,
    testCaseAssurancePreviewMatchesDraft ? previewTestCaseImpact.data?.assurance_review || previewTestCaseImpact.data?.assurance : null);

const selectedTestCaseAssuranceSource: "local" | "ai" | "fallback" = testCaseAssurancePreviewMatchesDraft && previewTestCaseImpact.data?.fallback_used
    ? "fallback"
    : testCaseAssurancePreviewMatchesDraft && (previewTestCaseImpact.data?.assurance_review || previewTestCaseImpact.data?.assurance) ? "ai" : "local";

return { computedCaseAiQualityScore, caseQualitySuggestions, testCaseReviewReadiness, selectedTestCaseAssuranceProposedChange, testCaseAssuranceRequestMatchesDraft, testCaseAssurancePreviewMatchesDraft, isTestCaseAssuranceDraftChanged, testCaseImpactRequestMatchesDraft, selectedTestCaseImpactPreview, runTestCaseImpactAnalysis, runTestCaseAssuranceAnalysis, openTestCaseImpactPreview, selectedHistory, selectedCaseHealthMetrics, authoredBehaviorUnitCount, selectedTestCaseAssurance, selectedTestCaseAssuranceSource };
}
