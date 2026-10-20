import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { useWorkspaceResource } from "@hellotest/platform/frontend/src/platform/hooks/useWorkspaceData";
import { testingApi } from "../api.client";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import {
  canPreviewAutomationCode as resolveCanPreviewAutomationCode,
  canViewAutomationCode as resolveCanViewAutomationCode
} from "@hellotest/automation/frontend/lib/automationAccess";
import { buildCaseAutomationCode } from "@hellotest/automation/frontend/lib/stepAutomation";
import {
  buildDataSetParameterDefinitions,
  buildStepParameterDefinitionsFromValues,
  buildDataSetParameterValues,
  collectSensitiveDataSetParameterNames,
  collectStepParameters,
  combineStepParameterValues,
  excludeSensitiveStepParameterValues,
  filterStepParameterValues,
  mergeStepParameterDefinitions,
  normalizeStepParameterValues,
  resolveStepParameterText
} from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { evaluateTestDataTemplate, hasTestDataGeneratorTemplate } from "../lib/testDataGenerators";
import type { Requirement, TestCase, TestStep, TestSuite } from "@hellotest/platform/frontend/src/types";
import { DisplayIdBadge } from "@hellotest/platform/frontend/src/shared/components/DisplayIdBadge";
import "./LinkedTestCaseModal.css";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { StepParameterDialog } from "./StepParameterDialog";
import { casePrivateParameterNames, collectPrivateParameterNames } from "@hellotest/platform/frontend/src/shared/lib/parameterPrivacy";
import { StepParameterizedText } from "./StepParameterizedText";
import { AutomationCodeIcon, CodePreviewDialog } from "@hellotest/automation/frontend/components/StepAutomationEditor";
import { RichTextContent } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { CollapseExpandIcon, TestCaseIcon, TestDataIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { GherkinEditor } from "./GherkinEditor";
import { setGherkinFeatureTitle } from "../lib/gherkin";

const linkedCaseHistoryDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const normalizeCaseParameterPreviewValues = (values?: TestCase["parameter_values"]) =>
  normalizeStepParameterValues((values || {}) as Record<string, string>, "t");

const normalizeSuiteParameterPreviewValues = (values?: TestSuite["parameter_values"]) =>
  normalizeStepParameterValues((values || {}) as Record<string, string>, "s");

const ignoreReadOnlyGherkinChange = () => undefined;

const formatLinkedHistoryDate = (value?: string | null) => {
  if (!value) {
    return "Recent run";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : linkedCaseHistoryDateFormatter.format(parsed);
};

export function LinkedTestCaseModal({
  appTypeName,
  projectName,
  requirements,
  selectedSuite,
  suites,
  testCase,
  onClose
}: {
  appTypeName: string;
  projectName: string;
  requirements: Requirement[];
  selectedSuite?: TestSuite | null;
  suites: TestSuite[];
  testCase: TestCase;
  onClose: () => void;
}) {
  const { session } = useAuth();
  const [projectId] = useCurrentProject();
  const { can } = useCapabilityAccess(projectId);
  const canViewRunHistory = can("result.view");
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const canViewAutomationCode = resolveCanViewAutomationCode(session, featureFlagsQuery.data, projectId);
  const canPreviewAutomationCode = resolveCanPreviewAutomationCode(session, featureFlagsQuery.data, projectId);
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose });
  const [expandedSections, setExpandedSections] = useState({
    details: true,
    steps: true,
    history: false
  });
  const [isParameterDialogOpen, setIsParameterDialogOpen] = useState(false);
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [parameterPreviewRevision, setParameterPreviewRevision] = useState(0);
  const parameterPreviewCacheRef = useRef<Map<string, string>>(new Map());
  const [codePreviewState, setCodePreviewState] = useState<{ title: string; subtitle: string; code: string } | null>(null);

  const testCaseDetailQuery = useQuery({
    queryKey: ["linked-test-case-modal-detail", testCase.id],
    queryFn: () => testingApi.testCases.get(testCase.id),
    enabled: Boolean(testCase.id),
    initialData: testCase.detail_complete === true ? testCase : undefined,
    staleTime: 30_000
  });
  const canonicalTestCase = testCaseDetailQuery.data?.detail_complete === true
    ? testCaseDetailQuery.data
    : testCase.detail_complete === true ? testCase : null;
  const resolvedTestCase = canonicalTestCase || testCase;
  const isTestCaseDetailLoading = Boolean(
    !canonicalTestCase && (testCaseDetailQuery.isPending || testCaseDetailQuery.isFetching)
  );
  const isTestCaseDetailUnavailable = Boolean(!canonicalTestCase && testCaseDetailQuery.isError);
  const stepsQuery = useQuery({
    queryKey: ["linked-test-case-modal-steps", testCase.id],
    queryFn: () => testingApi.testSteps.list({ test_case_id: testCase.id }),
    enabled: Boolean(testCase.id)
  });
  const historyQuery = useWorkspaceResource(
    ["linked-test-case-modal-history", testCase.id, resolvedTestCase.app_type_id || ""],
    signal => testingApi.executionResults.list({ project_id: projectId, test_case_id: testCase.id, app_type_id: resolvedTestCase.app_type_id || undefined }, { signal }),
    canViewRunHistory, Boolean(testCase.id)
  );

  const linkedRequirementTitles = useMemo(
    () =>
      requirements
        .filter((requirement) => (resolvedTestCase.requirement_ids || [resolvedTestCase.requirement_id]).filter(Boolean).includes(requirement.id))
        .map((requirement) => requirement.title),
    [requirements, resolvedTestCase.requirement_id, resolvedTestCase.requirement_ids]
  );
  const primaryRequirementId = resolvedTestCase.requirement_ids?.[0] || resolvedTestCase.requirement_id;
  const linkedRequirementTitle = requirements.find((requirement) => requirement.id === primaryRequirementId)?.title || "";
  const linkedSuiteTitles = useMemo(
    () =>
      suites
        .filter((suite) => (resolvedTestCase.suite_ids || [resolvedTestCase.suite_id]).filter(Boolean).includes(suite.id))
        .map((suite) => suite.name),
    [resolvedTestCase.suite_id, resolvedTestCase.suite_ids, suites]
  );
  const steps = asArray(stepsQuery.data);
  const stepBlocks = steps.reduce<Array<{ key: string; name?: string; steps: TestStep[] }>>((blocks, step) => {
    const previous = blocks[blocks.length - 1];
    if (step.group_id && previous?.key === step.group_id) previous.steps.push(step);
    else blocks.push({ key: step.group_id || step.id, name: step.group_id ? step.group_name || "Step group" : undefined, steps: [step] });
    return blocks;
  }, []);
  const history = asArray(historyQuery.data);
  const linkedDataSetId = resolvedTestCase.test_data_set_ids?.[0] || "";
  const linkedDataSet = resolvedTestCase.test_data_sets?.find((dataSet) => dataSet.id === linkedDataSetId)
    || resolvedTestCase.test_data_sets?.[0]
    || null;
  const linkedDataSetDefaultParameterValues = useMemo(
    () => buildDataSetParameterValues(linkedDataSet),
    [linkedDataSet]
  );
  const linkedDataSetParameterDefinitions = useMemo(
    () => buildDataSetParameterDefinitions(linkedDataSet, linkedDataSet?.name),
    [linkedDataSet]
  );
  const linkedDataSetSensitiveParameterNames = useMemo(
    () => collectPrivateParameterNames([normalizeCaseParameterPreviewValues(resolvedTestCase.parameter_values), linkedDataSetDefaultParameterValues, normalizeSuiteParameterPreviewValues(selectedSuite?.parameter_values)], [
      ...collectSensitiveDataSetParameterNames(linkedDataSet), ...casePrivateParameterNames(resolvedTestCase)
    ]),
    [linkedDataSet, linkedDataSetDefaultParameterValues, resolvedTestCase.parameter_values, resolvedTestCase.test_data_options?.private_parameter_names, resolvedTestCase.effective_private_parameter_names, selectedSuite?.parameter_values]
  );
  const caseParameterOverrides = useMemo(
    () => excludeSensitiveStepParameterValues(
      normalizeCaseParameterPreviewValues(resolvedTestCase.parameter_values),
      linkedDataSetSensitiveParameterNames
    ),
    [linkedDataSetSensitiveParameterNames, resolvedTestCase.parameter_values]
  );
  const hasGherkinDocument = resolvedTestCase.authoring_mode === "gherkin" && Boolean(resolvedTestCase.gherkin_document?.trim());
  const detectedParameters = useMemo(
    () => mergeStepParameterDefinitions(
      collectStepParameters(
        [
          ...steps.map((step) => ({
            id: step.id,
            action: step.action,
            expected_result: step.expected_result,
            automation_code: canViewAutomationCode ? step.automation_code : null,
            api_request: canViewAutomationCode ? step.api_request : null
          })),
          ...(hasGherkinDocument ? [{
            id: `${resolvedTestCase.id}:gherkin`,
            action: resolvedTestCase.gherkin_document || "",
            expected_result: "",
            automation_code: null,
            api_request: null
          }] : [])
        ]
      ).map((parameter) => ({ ...parameter, source: "authoring" as const })),
      linkedDataSetParameterDefinitions,
      buildStepParameterDefinitionsFromValues(caseParameterOverrides),
      buildStepParameterDefinitionsFromValues(normalizeSuiteParameterPreviewValues(selectedSuite?.parameter_values)),
      buildStepParameterDefinitionsFromValues(parameterValues)
    ).map(parameter => linkedDataSetSensitiveParameterNames.has(parameter.name) ? {...parameter, sensitive: true} : parameter),
    [canViewAutomationCode, hasGherkinDocument, linkedDataSetParameterDefinitions, linkedDataSetSensitiveParameterNames, caseParameterOverrides, selectedSuite?.parameter_values, parameterValues, resolvedTestCase.gherkin_document, resolvedTestCase.id, steps]
  );
  const resolvedParameterValues = useMemo(() => {
    const cache = parameterPreviewCacheRef.current;
    const scopeKey = `${resolvedTestCase.id}\u0000${linkedDataSetId || "no-data-set"}`;
    const activeCacheKeys = new Set<string>();
    const resolved = Object.entries(excludeSensitiveStepParameterValues(parameterValues, linkedDataSetSensitiveParameterNames)).reduce<Record<string, string>>((next, [name, value]) => {
      if (!hasTestDataGeneratorTemplate(value)) {
        next[name] = value;
        return next;
      }

      const cacheKey = `${scopeKey}\u0000${name}\u0000${value}`;
      activeCacheKeys.add(cacheKey);
      if (!cache.has(cacheKey)) {
        cache.set(cacheKey, evaluateTestDataTemplate(value));
      }
      next[name] = cache.get(cacheKey) || "";
      return next;
    }, {});

    Array.from(cache.keys()).forEach((cacheKey) => {
      if (!activeCacheKeys.has(cacheKey)) cache.delete(cacheKey);
    });

    return resolved;
  }, [linkedDataSetId, linkedDataSetSensitiveParameterNames, parameterPreviewRevision, parameterValues, resolvedTestCase.id]);
  const refreshParameterPreviews = () => {
    parameterPreviewCacheRef.current.clear();
    setParameterPreviewRevision((current) => current + 1);
  };
  const resolvedTestCaseTitle = resolveStepParameterText(resolvedTestCase.title, resolvedParameterValues);
  const resolvedTestCaseDescription = resolveStepParameterText(resolvedTestCase.description, resolvedParameterValues);
  const stepSummary = steps.length
    ? `Starts with: ${steps[0]?.action || steps[0]?.expected_result || "No step preview yet."}`
    : "No steps added yet for this reusable test case.";
  const historySummary = history.length
    ? "Review the latest recorded outcomes and preserved run evidence for this reusable test case."
    : "No run history has been recorded for this reusable test case yet.";
  const parameterDialogHeaderContent = (
    <div className="step-parameter-dialog-context">
      <div className="step-parameter-dialog-context-card">
        <strong>Scope guide</strong>
        <span>`@t` shows Test Params and `@s` shows the values saved on the active suite context for this workspace.</span>
      </div>
      {linkedDataSet ? (
        <div className="step-parameter-dialog-context-card">
          <strong>Inherited Data Set</strong>
          <span>{linkedDataSet.name} · values come from its first row and remain read-only in this linked view.</span>
        </div>
      ) : null}
      {selectedSuite ? (
        <div className="step-parameter-dialog-context-card">
          <strong>Suite context</strong>
          <span>{selectedSuite.name} · suite-shared values resolve from this suite while you review the linked case here.</span>
        </div>
      ) : null}
    </div>
  );

  useEffect(() => {
    setExpandedSections({
      details: true,
      steps: true,
      history: false
    });
    setIsParameterDialogOpen(false);
    setCodePreviewState(null);
    parameterPreviewCacheRef.current.clear();
  }, [selectedSuite?.id, testCase.id]);

  useEffect(() => {
    if (!canPreviewAutomationCode) setCodePreviewState(null);
  }, [canPreviewAutomationCode]);

  useEffect(() => {
    if (!canonicalTestCase) {
      setParameterValues({});
      setIsParameterDialogOpen(false);
      return;
    }

    setParameterValues(
      combineStepParameterValues(
        buildDataSetParameterValues(
          canonicalTestCase.test_data_sets?.find((dataSet) => dataSet.id === canonicalTestCase.test_data_set_ids?.[0])
            || canonicalTestCase.test_data_sets?.[0]
            || null
        ),
        excludeSensitiveStepParameterValues(
          normalizeCaseParameterPreviewValues(canonicalTestCase.parameter_values),
          collectSensitiveDataSetParameterNames(
            canonicalTestCase.test_data_sets?.find((dataSet) => dataSet.id === canonicalTestCase.test_data_set_ids?.[0])
              || canonicalTestCase.test_data_sets?.[0]
              || null
          )
        ),
        normalizeSuiteParameterPreviewValues(selectedSuite?.parameter_values)
      )
    );
  }, [
    canonicalTestCase?.id,
    canonicalTestCase?.parameter_values,
    canonicalTestCase?.revision,
    canonicalTestCase?.test_data_set_ids,
    canonicalTestCase?.test_data_sets,
    canonicalTestCase?.updated_at,
    selectedSuite?.id,
    selectedSuite?.parameter_values,
    selectedSuite?.revision,
    selectedSuite?.updated_at
  ]);

  useEffect(() => {
    setParameterValues((current) => {
      const next = filterStepParameterValues(current, detectedParameters);
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);

      if (currentKeys.length === nextKeys.length && currentKeys.every((key) => current[key] === next[key])) {
        return current;
      }

      return next;
    });
  }, [detectedParameters]);

  return (
    <>
      <div className="modal-backdrop modal-backdrop--scroll" onClick={onClose} role="presentation">
        <div
          aria-label={`Test case workspace for ${resolvedTestCaseTitle}`}
          aria-modal="true"
          className="modal-card linked-test-case-modal linked-test-case-workspace-modal linked-case-preview"
          onClick={(event) => event.stopPropagation()}
          ref={dialogRef}
          role="dialog"
          tabIndex={-1}
        >
          <header className="linked-case-preview-header">
            <div className="linked-case-preview-heading">
              <div className="linked-case-preview-identity"><TestCaseIcon size={17} /><DisplayIdBadge value={resolvedTestCase.display_id || resolvedTestCase.id} /><StatusBadge value={resolvedTestCase.status || "draft"} /></div>
              <h2 title={resolvedTestCaseTitle}>{resolvedTestCaseTitle || "Untitled test case"}</h2>
              <p>{projectName || "No project"} · {appTypeName || "No app type"}{selectedSuite ? ` · ${selectedSuite.name}` : ""}</p>
            </div>
                      <button
                        className="ghost-button linked-case-params-button"
                        disabled={!canonicalTestCase}
                        onClick={() => canonicalTestCase && setIsParameterDialogOpen(true)}
                        title={isTestCaseDetailLoading ? "Loading complete Test Params" : isTestCaseDetailUnavailable ? "Complete Test Params could not be loaded" : "Preview Test Params"}
                        type="button"
                      >
                        <TestDataIcon size={16} />
                        <span>
                          {isTestCaseDetailLoading
                            ? "Loading Test Params…"
                            : isTestCaseDetailUnavailable
                              ? "Test Params unavailable"
                              : detectedParameters.length ? `Test Params · ${detectedParameters.length}` : "Test Params"}
                        </span>
                      </button>
            <DialogCloseButton label="Close test case workspace" onClick={onClose} />
          </header>
          <div className="linked-test-case-workspace-body linked-case-preview-body">
                    {isTestCaseDetailLoading ? (
                      <LoadingState
                        description="Loading the saved details and parameter values."
                        label="Loading complete test case details"
                      />
                    ) : null}
                    {isTestCaseDetailUnavailable ? (
                      <div className="empty-state compact" role="alert">
                        <div>Test case details could not be loaded.</div>
                        <button className="ghost-button compact" onClick={() => void testCaseDetailQuery.refetch()} type="button">Retry details</button>
                      </div>
                    ) : null}
                    <div className="editor-accordion linked-case-preview-sections">
                      <LinkedTestCaseSection
                        countLabel={resolvedTestCase.status || "draft"}
                        isExpanded={expandedSections.details}
                        onToggle={() => setExpandedSections((current) => ({ ...current, details: !current.details }))}
                        summary={resolvedTestCaseTitle || "Untitled test case"}
                        title="Selected test case"
                      >
                        <div className="stack-list">
                          <div className="stack-item">
                            <div>
                              <strong>Status</strong>
                              <span>{resolvedTestCase.status || "draft"}</span>
                            </div>
                            <StatusBadge value={resolvedTestCase.status || "draft"} />
                          </div>
                          <div className="stack-item">
                            <div>
                              <strong>Scope</strong>
                              <span>{projectName || "No project"} · {appTypeName || "No app type"}</span>
                            </div>
                          </div>
                          <div className="stack-item">
                            <div>
                              <strong>Description</strong>
                              <RichTextContent value={resolvedTestCaseDescription} fallback="No description available for this reusable test case." />
                            </div>
                          </div>
                          <div className="stack-item">
                            <div>
                              <strong>Priority</strong>
                              <span>{`P${resolvedTestCase.priority ?? 3}`}</span>
                            </div>
                          </div>
                          <div className="stack-item">
                            <div>
                              <strong>Linked suites</strong>
                              <span>{linkedSuiteTitles.length ? linkedSuiteTitles.join(" · ") : "Not linked to a suite."}</span>
                            </div>
                          </div>
                          <div className="stack-item">
                            <div>
                              <strong>Stories</strong>
                              <span>{linkedRequirementTitles.length ? linkedRequirementTitles.join(" · ") : "No linked story."}</span>
                            </div>
                          </div>
                        </div>
                      </LinkedTestCaseSection>

                      <LinkedTestCaseSection
                        actions={canPreviewAutomationCode ? (
                          <button className="ghost-button" disabled={!steps.length} onClick={() => setCodePreviewState({
                            title: `${resolvedTestCaseTitle || "Test case"} automation`,
                            subtitle: "This consolidated view is read-only. Edit automation from the original test case workspace.",
                            code: buildCaseAutomationCode(resolvedTestCase.title || "Test case", steps)
                          })} type="button">
                            <AutomationCodeIcon />
                            <span>Automation code</span>
                          </button>
                        ) : undefined}
                        countLabel={hasGherkinDocument ? "Gherkin" : `${steps.length} step${steps.length === 1 ? "" : "s"}`}
                        isExpanded={expandedSections.steps}
                        onToggle={() => setExpandedSections((current) => ({ ...current, steps: !current.steps }))}
                        summary={hasGherkinDocument ? "Read the saved Background, Scenarios, and Examples with resolved Test Params." : stepSummary}
                        title={hasGherkinDocument ? "Gherkin specification" : "Test steps"}
                      >
                        {hasGherkinDocument ? (
                          <GherkinEditor
                            compact
                            featureTitle={linkedRequirementTitle || resolvedTestCaseTitle}
                            featureTitleLocked={Boolean(linkedRequirementTitle)}
                            availableParameters={detectedParameters}
                            onChange={ignoreReadOnlyGherkinChange}
                            parameterValues={resolvedParameterValues}
                            readOnly
                            value={linkedRequirementTitle ? setGherkinFeatureTitle(resolvedTestCase.gherkin_document || "", linkedRequirementTitle) : resolvedTestCase.gherkin_document || ""}
                          />
                        ) : <div className="stack-list">
                          {stepsQuery.isLoading ? <LoadingState label="Loading steps" /> : null}
                          {!stepsQuery.isLoading && stepBlocks.map((block) => {
                            const content = block.steps.map((step) => (
                              <div className="stack-item" key={step.id}>
                                <div className="linked-test-case-step-copy">
                                  <strong>{`Step ${step.step_order}`}</strong>
                                  <StepParameterizedText fallback="No action" text={step.action} values={resolvedParameterValues} />
                                  <StepParameterizedText fallback="No expected result" text={step.expected_result} values={resolvedParameterValues} />
                                </div>
                              </div>
                            ));
                            return block.name ? (
                              <details className="linked-test-case-step-group" key={block.key}>
                                <summary><strong>{block.name}</strong><span>{block.steps.length} step{block.steps.length === 1 ? "" : "s"}</span></summary>
                                <div className="stack-list">{content}</div>
                              </details>
                            ) : content;
                          })}
                          {!stepsQuery.isLoading && !steps.length ? <div className="empty-state compact">No steps are attached to this test case yet.</div> : null}
                        </div>}
                      </LinkedTestCaseSection>

                      {canViewRunHistory ? <LinkedTestCaseSection
                        countLabel={`${history.length} record${history.length === 1 ? "" : "s"}`}
                        isExpanded={expandedSections.history}
                        onToggle={() => setExpandedSections((current) => ({ ...current, history: !current.history }))}
                        summary={historySummary}
                        title="Run history"
                      >
                        <div className="stack-list">
                          {historyQuery.isLoading ? <LoadingState label="Loading run history" /> : null}
                          {!historyQuery.isLoading && history.map((result) => {
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
                                  <strong>{formatLinkedHistoryDate(result.created_at)}</strong>
                                  <span>{historyDetail}</span>
                                </div>
                                <StatusBadge value={result.status} />
                              </div>
                            );
                          })}
                          {!historyQuery.isLoading && !history.length ? <div className="empty-state compact">No run history yet for this test case.</div> : null}
                        </div>
                      </LinkedTestCaseSection> : null}
                    </div>
          </div>
        </div>
      </div>

      {isParameterDialogOpen && canonicalTestCase ? (
        <StepParameterDialog
          defaultValues={linkedDataSetDefaultParameterValues}
          getInputState={(parameter) => ({
            disabled: true,
            hint: parameter.sensitive ? "Hidden by the linked Data Set. Only the parameter name is shown in steps." : undefined
          })}
          headerContent={parameterDialogHeaderContent}
          onChange={ignoreReadOnlyGherkinChange}
          onClose={() => setIsParameterDialogOpen(false)}
          onRefreshPreviews={refreshParameterPreviews}
          overrideValues={caseParameterOverrides}
          parameters={detectedParameters}
          previewValues={resolvedParameterValues}
          subtitle="Review materialized Test Params inherited from the linked Data Set and saved Test Case overrides."
          title="Test Params"
          values={parameterValues}
        />
      ) : null}

      {canPreviewAutomationCode && codePreviewState ? (
        <CodePreviewDialog
          code={codePreviewState.code}
          onClose={() => setCodePreviewState(null)}
          subtitle={codePreviewState.subtitle}
          title={codePreviewState.title}
        />
      ) : null}
    </>
  );
}

function LinkedTestCaseSection({
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
        <button aria-expanded={isExpanded} className="editor-accordion-toggle" onClick={onToggle} type="button">
          <div className="editor-accordion-toggle-main">
            <span aria-hidden="true" className={isExpanded ? "editor-accordion-icon is-expanded" : "editor-accordion-icon"}>
              <LinkedTestCaseChevronIcon />
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

function LinkedTestCaseChevronIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
