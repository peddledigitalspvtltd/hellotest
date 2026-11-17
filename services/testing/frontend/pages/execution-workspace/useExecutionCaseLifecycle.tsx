import { type ExecutionCaseInstanceView } from "../../components/ExecutionRunListCard";
import { executionStepText } from "../../components/ExecutionRunnerStep";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { getExecutionResultDurationMs, type ExecutionCaseLifecycleAction } from "../../lib/executionCaseLifecycle";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { selectLatestExecutionResultInstances } from "../../lib/executionResultMetrics";
import { deriveCaseStatusFromSteps, parseExecutionLogs, stringifyExecutionLogs, type ExecutionStepEvidence, type ExecutionStepStatus } from "../../lib/executionLogs";
import { resolveStepParameterText } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { type Execution, type ExecutionCaseSnapshot, type ExecutionResult, type TestStep, type SessionPayload } from "@hellotest/platform/frontend/src/types";
import { ExecutionCaseView, executionResultMatchesCaseInstance, mergeExecutionEvidencePatch } from "./executionWorkspaceModel";

export interface ExecutionCaseLifecycleScope {
  selectedExecution: Execution | null;
  snapshotCases: ExecutionCaseSnapshot[];
  executionCaseOrder: ExecutionCaseView[];
  selectedTestCaseId: string;
  selectedExecutionCaseInstance: ExecutionCaseInstanceView;
  executionResults: ExecutionResult[];
  stepsByCaseId: Record<string, TestStep[]>;
  isExecutionLocked: boolean;
  stepNotes: Record<string, string>;
  isExecutionStarted: boolean;
  stepStatuses: Record<string, ExecutionStepStatus>;
  selectedSteps: TestStep[];
  bulkSelectedStepIds: string[];
  resultForCaseInstance: (instance?: ExecutionCaseInstanceView | null | undefined) => ExecutionResult | null;
  selectedExecutionCaseSnapshot: ExecutionCaseSnapshot | null;
  selectedExecutionStartMode: "local" | "remote" | "manual";
  executionStepParameterValues: Record<string, string>;
}

export interface ExecutionCaseLifecycleCache {
  queryClient: QueryClient;
  refreshExecutionScope: (executionId?: string) => Promise<void>;
}

export interface ExecutionCaseLifecycleAccess {
  session: SessionPayload | null;
  canManageRunResults: boolean;
  canExecuteRuns: boolean;
}

export interface ExecutionCaseLifecycleFeedback {
  showError: (error: unknown, fallback: string) => void;
  setLinkingDefectStepId: Dispatch<SetStateAction<string>>;
  showSuccess: (text: string) => void;
  setBulkSelectedStepIds: Dispatch<SetStateAction<string[]>>;
  setLiveNow: Dispatch<SetStateAction<number>>;
}

export interface ExecutionCaseLifecycleOptions {
  scope: ExecutionCaseLifecycleScope;
  cache: ExecutionCaseLifecycleCache;
  access: ExecutionCaseLifecycleAccess;
  feedback: ExecutionCaseLifecycleFeedback;
}

export function useExecutionCaseLifecycle({ scope, cache, access, feedback }: ExecutionCaseLifecycleOptions) {
  const { selectedExecution, snapshotCases, executionCaseOrder, selectedTestCaseId, selectedExecutionCaseInstance, executionResults, stepsByCaseId, isExecutionLocked, stepNotes, isExecutionStarted, stepStatuses, selectedSteps, bulkSelectedStepIds, resultForCaseInstance, selectedExecutionCaseSnapshot, selectedExecutionStartMode, executionStepParameterValues } = scope;
  const { queryClient, refreshExecutionScope } = cache;
  const { session, canManageRunResults, canExecuteRuns } = access;
  const { showError, setLinkingDefectStepId, showSuccess, setBulkSelectedStepIds, setLiveNow } = feedback;
const [caseLifecycleAction, setCaseLifecycleAction] = useState<string | null>(null);

const createResult = useMutation({ mutationFn: api.executionResults.create });

const updateResult = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.executionResults.update>[1] }) =>
      api.executionResults.update(id, input)
  });

const resolvePersistedCaseDurationMs = (_caseInstanceKey: string, existing?: ExecutionResult) =>
    getExecutionResultDurationMs(existing);

const persistCaseResult = async (
    testCaseId: string,
    patches: {
      stepStatusesPatch?: Record<string, ExecutionStepStatus>;
      stepNotesPatch?: Record<string, string>;
      stepEvidencePatch?: Record<string, ExecutionStepEvidence | null>;
    },
    options: { refresh?: boolean; instance?: ExecutionCaseInstanceView | null } = {}
  ) => {
    const shouldRefresh = options.refresh !== false;
    const scopedAppTypeId = selectedExecution?.app_type_id;
    const currentCaseSnapshot = snapshotCases.find((snapshot) => snapshot.test_case_id === testCaseId);
    const currentCase = executionCaseOrder.find((testCase) => testCase.id === testCaseId);
    const targetInstance = options.instance
      || (selectedTestCaseId === testCaseId ? selectedExecutionCaseInstance : null)
      || currentCase?.data_set_instances[0]
      || null;

    if (!selectedExecution || !testCaseId || !scopedAppTypeId || !currentCaseSnapshot || !targetInstance) {
      return;
    }

    const fresh =
      queryClient.getQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id]) || executionResults;
    const existing = selectLatestExecutionResultInstances(fresh)
      .find((item) => executionResultMatchesCaseInstance(item, targetInstance));
    if (existing?.derived) throw new Error("Linked automation coverage is read-only. Open the source automation result to manage its evidence.");
    const prev = parseExecutionLogs(existing?.logs || null);
    const mergedStatuses = { ...(prev.stepStatuses || {}), ...(patches.stepStatusesPatch || {}) };
    const mergedNotes = { ...(prev.stepNotes || {}), ...(patches.stepNotesPatch || {}) };
    const mergedEvidence = mergeExecutionEvidencePatch(prev.stepEvidence || {}, patches.stepEvidencePatch);

    const caseStepIds = (stepsByCaseId[testCaseId] || [])
      .slice()
      .sort((left, right) => left.step_order - right.step_order)
      .map((step) => step.id);
    const hasStatusChanges = Object.keys(patches.stepStatusesPatch || {}).length > 0;
    const allStepsResolved = caseStepIds.length > 0 && caseStepIds.every((id) => ["passed", "failed", "blocked"].includes(mergedStatuses[id]));
    const aggregateStatus = hasStatusChanges
      ? allStepsResolved ? deriveCaseStatusFromSteps(caseStepIds, mergedStatuses) : "running"
      : existing?.status || "pending";
    const logs = stringifyExecutionLogs({
      stepStatuses: mergedStatuses,
      stepNotes: mergedNotes,
      stepEvidence: mergedEvidence,
      stepDefects: prev.stepDefects || {},
      stepApiDetails: prev.stepApiDetails || {},
      stepWebDetails: prev.stepWebDetails || {},
      stepCaptures: prev.stepCaptures || {}
    });
    const durationMs = resolvePersistedCaseDurationMs(targetInstance.instance_key, existing);

    if (existing) {
      const updateResponse = await updateResult.mutateAsync({
        id: existing.id,
        input: {
          status: aggregateStatus,
          logs,
          error: aggregateStatus === "failed" ? "Step failed during run" : "",
          expected_revision: existing.revision
        }
      });
      queryClient.setQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id], (current = []) =>
        current.map((item) =>
          item.id === existing.id
            ? {
                ...item,
                status: aggregateStatus,
                duration_ms: existing.duration_ms,
                logs,
                error: aggregateStatus === "failed" ? "Step failed during run" : null,
                case_defects: updateResponse.case_defects,
                defects: updateResponse.defects,
                revision: updateResponse.revision
              }
            : item
        )
      );
      if (shouldRefresh) {
        await refreshExecutionScope(selectedExecution.id);
      }
      return existing.id;
    }

    const shouldCreate =
      Object.keys(patches.stepStatusesPatch || {}).length > 0
      || Object.keys(patches.stepNotesPatch || {}).length > 0
      || Object.keys(patches.stepEvidencePatch || {}).length > 0;
    if (!shouldCreate) {
      return;
    }

    const response = await createResult.mutateAsync({
      execution_id: selectedExecution.id,
      test_case_id: testCaseId,
      app_type_id: scopedAppTypeId,
      status: aggregateStatus,
      duration_ms: durationMs ?? undefined,
      logs,
      error: aggregateStatus === "failed" ? "Step failed during run" : undefined,
      test_data_set_id: targetInstance.test_data_set_id || undefined,
      test_data_set_name: targetInstance.test_data_set_name || undefined,
      data_set_iteration_index: targetInstance.data_set_iteration_index ?? undefined,
      data_set_iteration_key: targetInstance.data_set_iteration_key || undefined,
      data_set_row_snapshot: targetInstance.data_set_row_snapshot || undefined,
      external_references: currentCaseSnapshot.external_references || [],
      defects: [],
      executed_by: session!.user.id
    });

    queryClient.setQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id], (current = []) => [
      {
        id: response.id,
        execution_id: selectedExecution.id,
        test_case_id: testCaseId,
        test_case_title: currentCaseSnapshot.test_case_title,
        suite_id: currentCaseSnapshot.suite_id,
        suite_name: currentCaseSnapshot.suite_name,
        app_type_id: scopedAppTypeId,
        status: aggregateStatus,
        duration_ms: durationMs,
        error: aggregateStatus === "failed" ? "Step failed during run" : null,
        logs,
        test_data_set_id: targetInstance.test_data_set_id,
        test_data_set_name: targetInstance.test_data_set_name,
        data_set_iteration_index: targetInstance.data_set_iteration_index,
        data_set_iteration_key: targetInstance.data_set_iteration_key,
        data_set_row_snapshot: targetInstance.data_set_row_snapshot,
        external_references: currentCaseSnapshot.external_references || [],
        case_defects: [],
        defects: [],
        revision: response.revision,
        executed_by: session!.user.id
      },
      ...current
    ]);
    if (shouldRefresh) {
      await refreshExecutionScope(selectedExecution.id);
    }
    return response.id;
  };

const handleStepDefectsChange = async (step: TestStep, defectIds: string[]) => {
    if (!selectedExecution || !selectedTestCaseId || isExecutionLocked || isSelectedResultDerived) {
      return;
    }
    if (!canManageRunResults) {
      showError(new Error("Permission required: result.manage"), "Unable to update step defect links");
      return;
    }

    setLinkingDefectStepId(step.id);
    try {
      const existingResultId = selectedExecutionResult?.id;
      const createdResultId = existingResultId
        ? undefined
        : await persistCaseResult(
          selectedTestCaseId,
          { stepNotesPatch: { [step.id]: stepNotes[step.id] || "" } },
          { refresh: false }
        );
      const resultId = existingResultId || createdResultId;

      if (!resultId) {
        throw new Error("A test case result could not be created for this step.");
      }

      const cachedResult = queryClient
        .getQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id])
        ?.find((item) => item.id === resultId);
      const linkResponse = await api.executionResults.linkStepDefects(resultId, {
        step_id: step.id,
        defect_ids: [...new Set(defectIds)].slice(0, 50),
        expected_revision: cachedResult?.revision
      });
      queryClient.setQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id], (current = []) =>
        current.map((item) => item.id === resultId
          ? { ...item, revision: linkResponse.revision, defects: linkResponse.defects, step_defects: linkResponse.step_defects }
          : item)
      );
      await refreshExecutionScope(selectedExecution.id);
      showSuccess(defectIds.length ? "Step defect links updated." : "Step defect links cleared.");
    } catch (error) {
      showError(error, "Unable to update step defect links");
    } finally {
      setLinkingDefectStepId("");
    }
  };

const handleRecordStep = async (stepId: string, status: "passed" | "failed") => {
    if (!selectedExecution || !selectedTestCaseId) {
      return;
    }
    if (!canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked || !canRecordSelectedCase || caseLifecycleAction) {
      showError(new Error("Start or resume the case before recording step results."), "Unable to record step result");
      return;
    }

    const updatedStepStatuses = { ...stepStatuses, [stepId]: status };
    const currentSteps = selectedSteps.map((step) => step.id);
    const allResolved = currentSteps.length > 0 && currentSteps.every((id) => updatedStepStatuses[id]);

    try {
      await persistCaseResult(selectedTestCaseId, { stepStatusesPatch: { [stepId]: status } });
      showSuccess(`Step marked ${status}.`);

      if (allResolved) showSuccess("All steps recorded. Save comments, then choose Next case when ready.");
    } catch (error) {
      showError(error, "Unable to record step result");
    }
  };

const pendingStepNoteSavesRef = useRef(new Set<Promise<boolean>>());

const handleSaveStepNote = async (stepId: string, note: string) => {
    if (!selectedExecution || !selectedTestCaseId) {
      return;
    }
    if (!canManageRunResults) {
      showError(new Error("Permission required: result.manage"), "Unable to save step note");
      return;
    }

    const save = persistCaseResult(selectedTestCaseId, { stepNotesPatch: { [stepId]: note } })
      .then(() => true, error => { showError(error, "Unable to save step note"); return false; });
    pendingStepNoteSavesRef.current.add(save);
    try { await save; } finally { pendingStepNoteSavesRef.current.delete(save); }

  };

const handleBulkStepStatus = async (status: "passed" | "failed", scope: "selected" | "all") => {
    if (!selectedExecution || !selectedTestCaseId || !selectedSteps.length) {
      return;
    }
    if (!canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked || !canRecordSelectedCase || caseLifecycleAction) {
      showError(new Error("Start or resume the case before recording step results."), "Unable to update steps");
      return;
    }

    const targetIds =
      scope === "all"
        ? selectedSteps.map((step) => step.id)
        : bulkSelectedStepIds.filter((id) => selectedSteps.some((step) => step.id === id));

    if (!targetIds.length) {
      showError(null, scope === "selected" ? "Select at least one step." : "No steps to update.");
      return;
    }

    const patch = targetIds.reduce<Record<string, ExecutionStepStatus>>((acc, id) => {
      acc[id] = status;
      return acc;
    }, {});

    try {
      await persistCaseResult(selectedTestCaseId, { stepStatusesPatch: patch });
      setBulkSelectedStepIds([]);
      showSuccess(`${targetIds.length} step${targetIds.length === 1 ? "" : "s"} marked ${status}.`);
    } catch (error) {
      showError(error, "Unable to update steps");
    }
  };

const selectedExecutionCase = executionCaseOrder.find((testCase) => testCase.id === selectedTestCaseId) || null;

const selectedExecutionResult = selectedExecutionCase
    ? resultForCaseInstance(selectedExecutionCaseInstance)
    : null;

const isSelectedResultDerived = selectedExecutionResult?.derived === true;

const isSelectedCaseAutomated = selectedExecutionCaseSnapshot?.automated === 'yes';

const isSelectedCaseTimerActive = selectedExecutionResult?.status === "running" && Boolean(selectedExecutionResult.timer_started_at);

const canRecordSelectedCase = !isSelectedCaseAutomated && !isSelectedResultDerived && selectedExecutionResult?.status === "running" && Boolean(selectedExecutionResult.started_at || selectedExecutionStartMode !== "manual");

const selectedExecutionCaseEffectiveUser = selectedExecutionCase?.assigned_user || selectedExecution?.assigned_user || null;

const selectedExecutionCaseExplicitAssigneeId = selectedExecutionCase?.assignment_source === "case" ? selectedExecutionCase.assigned_to || "" : "";

const selectedExecutionCaseReadableTitle = selectedExecutionCase
    ? resolveStepParameterText(selectedExecutionCase.title, executionStepParameterValues) || selectedExecutionCase.title
    : "";

const selectedExecutionCaseReadableDescription = selectedExecutionCase
    ? executionStepText(selectedExecutionCase.description, executionStepParameterValues)
    : "";

const ensureSelectedCaseResult = async () => {
    if (!selectedExecution || !selectedExecutionCaseInstance) throw new Error("Select a case row first.");
    const result = await api.executionResults.ensure({
      execution_id: selectedExecution.id,
      test_case_id: selectedExecutionCaseInstance.test_case_id,
      data_set_iteration_index: selectedExecutionCaseInstance.data_set_iteration_index ?? undefined,
      data_set_iteration_key: selectedExecutionCaseInstance.data_set_iteration_key || undefined
    });
    await refreshExecutionScope(selectedExecution.id);
    return result;
  };

const handleCaseLifecycle = async (action: ExecutionCaseLifecycleAction) => {
    if (!selectedExecution || !selectedExecutionCaseInstance || caseLifecycleAction) return;
    if (isSelectedCaseAutomated) {
      showError(new Error('TestEngine starts and reports this automated case. Check its queue and engine results.'), 'Automated case');
      return;
    }
    if (isSelectedResultDerived) {
      showError(new Error("Open the linked automation result to inspect its evidence, or create a separate manual run."), "This outcome comes from automation");
      return;
    }
    const executionId = selectedExecution.id;
    setCaseLifecycleAction(action);
    try {
      await api.executionResults.transition({
        execution_id: executionId,
        test_case_id: selectedExecutionCaseInstance.test_case_id,
        data_set_iteration_index: selectedExecutionCaseInstance.data_set_iteration_index ?? undefined,
        data_set_iteration_key: selectedExecutionCaseInstance.data_set_iteration_key || undefined,
        expected_revision: selectedExecutionResult?.revision,
        expected_result_id: selectedExecutionResult?.id,
        action
      });
      await refreshExecutionScope(executionId);
      setLiveNow(Date.now());
    } catch (error) {
      showError(error, "Unable to update case run");
      await refreshExecutionScope(executionId);
    } finally {
      setCaseLifecycleAction(null);
    }
  };

const prepareCaseForBulkResult = async (instance: ExecutionCaseInstanceView) => {
    if (!selectedExecution) throw new Error("Select a run first.");
    const fresh = queryClient.getQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id]) || executionResults;
    const existing = selectLatestExecutionResultInstances(fresh).find((result) => executionResultMatchesCaseInstance(result, instance));
    if (existing?.status === "running" && existing.started_at) return existing;
    const result = await api.executionResults.transition({
      execution_id: selectedExecution.id, test_case_id: instance.test_case_id,
      data_set_iteration_index: instance.data_set_iteration_index,
      data_set_iteration_key: instance.data_set_iteration_key,
      expected_revision: existing?.revision, expected_result_id: existing?.id,
      action: existing?.status === "paused" ? "resume" : "start"
    });
    queryClient.setQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id], (current = []) => [result, ...current.filter(item => item.id !== result.id)]);
    return result;
  };

const persistCaseOutcomeOnly = async (testCaseId: string, status: "passed" | "failed", targetInstance: ExecutionCaseInstanceView) => {
    if (!selectedExecution) return;
    const existing = await prepareCaseForBulkResult(targetInstance);
    await api.executionResults.transition({ execution_id: selectedExecution.id, test_case_id: testCaseId,
      data_set_iteration_index: targetInstance.data_set_iteration_index, data_set_iteration_key: targetInstance.data_set_iteration_key,
      expected_revision: existing.revision, expected_result_id: existing.id, action: status === "passed" ? "pass" : "fail" });
  };
  return { caseLifecycleAction, setCaseLifecycleAction, createResult, updateResult, resolvePersistedCaseDurationMs, persistCaseResult, handleStepDefectsChange, handleRecordStep, pendingStepNoteSavesRef, handleSaveStepNote, handleBulkStepStatus, selectedExecutionCase, selectedExecutionResult, isSelectedResultDerived, isSelectedCaseAutomated, isSelectedCaseTimerActive, canRecordSelectedCase, selectedExecutionCaseEffectiveUser, selectedExecutionCaseExplicitAssigneeId, selectedExecutionCaseReadableTitle, selectedExecutionCaseReadableDescription, ensureSelectedCaseResult, handleCaseLifecycle, prepareCaseForBulkResult, persistCaseOutcomeOnly };
}
