import { reviewedAutomationStartUrl } from "../../lib/automationStartUrl";
import { useMutation } from "@tanstack/react-query";
import { type RecorderStartOptions } from "../../components/RecorderStartControls";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import type { AutomationCaseScope } from './useAutomationCaseScope';
import type { AutomationCaseState } from './useAutomationCaseState';
import type { AutomationCaseModel } from './useAutomationCaseModel';
import type { AutomationCaseServices } from './useAutomationCaseServices';
export function useAutomationCaseRecorderActions(input: AutomationCaseScope & AutomationCaseState & AutomationCaseModel & AutomationCaseServices) {
    const {canUseRecorder, activeCase, recorderSession, canRecordCurrentPlan, startUrl, automationStartUrlRequired, flushAutomationBuildParameters, authoring, projectId, appTypeId, recordingTargetStepId, selectedExecutionEnvironmentId, selectedExecutionConfigurationId, selectedExecutionDataSetId, selectedParameterSuiteId, mergedParameterValues, visiblePrivateNames, testCaseParameterValues, suiteParameterValues, privateCaseParameterDraft, caseParameterPrivacyScope, caseParameterOverrideDraftRef, rememberAutomationBuildDrafts, showSuccess, invalidateAutomationData, showError, builderContext, setRecordingTargetStepId, openGeneratedAutomationPlan, setActiveAutomationWorkspaceTab} = input;
    const startRecorder = useMutation({
        mutationFn: async (options: RecorderStartOptions) => {
            if (!canUseRecorder)
                throw new Error('Permission required: automation.recorder');
            if (!activeCase)
                throw new Error('Select an automation case first.');
            if (recorderSession)
                throw new Error('Finish the current recording before starting another.');
            if (!canRecordCurrentPlan)
                throw new Error('Recording is unavailable for this runtime or your permissions.');
            const requestedStartUrl = reviewedAutomationStartUrl(startUrl, automationStartUrlRequired);
            await flushAutomationBuildParameters([activeCase.id]);
            await authoring.syncAuthoringState(activeCase.id);
            const origin = { caseId: activeCase.id, projectId, appTypeId, targetStepId: recordingTargetStepId, environmentId: selectedExecutionEnvironmentId, configurationId: selectedExecutionConfigurationId, dataSetId: selectedExecutionDataSetId, suiteId: selectedParameterSuiteId };
            const privateValues = Object.entries(mergedParameterValues).filter(([name]) => visiblePrivateNames.has(name)).map(([, value]) => value);
            const operationId = authoring.beginRecording(origin, options, privateValues);
            try {
                authoring.recordingDraftChanged(activeCase.id,operationId,{caseValues:testCaseParameterValues,suiteValues:suiteParameterValues,privateNames:privateCaseParameterDraft.scope===caseParameterPrivacyScope?privateCaseParameterDraft.names:[],overrideNames:caseParameterOverrideDraftRef.current.scope===caseParameterPrivacyScope?[...caseParameterOverrideDraftRef.current.names].sort():[]});
                rememberAutomationBuildDrafts();
                const session = await api.testCases.startRecorderSession(origin.caseId, { start_url: requestedStartUrl, recorder_mode: options.recorder_mode, recorder_target: options.recorder_target, engine_base_url: options.engine_base_url, recorder_public_base_url: options.recorder_public_base_url, reuse_existing: options.recorder_mode === 'local' && options.recorder_target === 'web', test_suite_id: origin.suiteId || undefined, test_environment_id: origin.environmentId || undefined, test_configuration_id: origin.configurationId || undefined, test_data_set_id: origin.dataSetId || undefined, target_step_id: origin.targetStepId || undefined });
                return { session, operationId };
            }
            catch (error) {
                authoring.recordingStartRejected(operationId, error);
                throw error;
            }
        },
        onSuccess: ({ session, operationId }, options) => { authoring.recordingStarted(operationId, session); showSuccess(session.reused ? 'Reused the open local Playwright browser and started a fresh recording.' : `${options.recorder_mode === 'remote' ? 'Remote' : 'Local'} ${options.recorder_target === 'mobile' ? 'device' : 'browser'} recorder started. Actions will appear in playback order.`); invalidateAutomationData(); },
        onError: error => showError(error, 'Unable to start the recorder.')
    });
    const finishRecorder = useMutation({
        mutationFn: async (mode: "discard" | void) => {
            const discarded = mode === "discard";
            if (!canUseRecorder)
                throw new Error('Permission required: automation.recorder');
            const captured = authoring.activeRecording()?.recording;
            if (!activeCase || !captured?.session?.id)
                throw new Error('Return to the original recording before saving.');
            const { origin, session, options } = captured;
            if (origin.projectId !== projectId || origin.appTypeId !== appTypeId || activeCase.id !== origin.caseId)
                throw new Error('Return to the recording’s original project, application and automation case before saving.');
            if (!discarded && selectedParameterSuiteId !== origin.suiteId)
                throw new Error('Select the recording’s original suite before saving its parameter bindings.');
            if (!discarded) await flushAutomationBuildParameters([origin.caseId]);
            const sessionId = authoring.beginRecordingSave(origin.caseId);
            try {
                const excludedActions = new Set(captured.excludedActionIndices || []);
                const context = {
                    transaction_id: session.transaction_id, target_step_id: origin.targetStepId || undefined,
                    recorder_mode: options.recorder_mode, recorder_target: options.recorder_target, engine_base_url: options.engine_base_url
                };
                const response = await api.testCases.finishRecorderSession(origin.caseId, sessionId, discarded ? { ...context, included_action_indices: [] } : {
                    ...context, additional_context: builderContext || undefined, test_environment_id: origin.environmentId || undefined,
                    test_configuration_id: origin.configurationId || undefined, test_data_set_id: origin.dataSetId || undefined,
                    ...(excludedActions.size ? { excluded_action_indices: [...excludedActions] } : {}),
                    parameter_bindings: Object.entries(captured.parameterBindings).filter(([index, reference]) => reference && !excludedActions.has(Number(index))).map(([index, reference]) => ({ source_action_index: Number(index), parameter_reference: reference }))
                });
                return { response, origin, sessionId, discarded };
            }
            catch (error) {
                authoring.recordingSaveRejected(origin.caseId, sessionId);
                throw error;
            }
        },
        onSuccess: async ({ response, origin, sessionId, discarded }) => {
            authoring.recordingSaved(origin.caseId, sessionId);
            setRecordingTargetStepId('');
            showSuccess((discarded ? 'Recording discarded. The saved plan is available in Instructions.' : response.idempotent_replay ? 'This recording was already saved. The saved plan is available in Instructions.' : response.generated_step_count ? `Captured ${response.learned_locator_count} repository objects and updated ${response.generated_step_count} automation steps.` : 'Recorder stopped. No supported interactions were captured.') + (response.warnings?.length ? ' ' + response.warnings.join(' ') : ''));
            invalidateAutomationData();
            if (response.generated_step_count && response.test_case_id) {
                try {
                    await openGeneratedAutomationPlan(response.test_case_id, origin.projectId, [origin.caseId]);
                }
                catch (error) {
                    showError(error, 'Recorder output was saved, but the updated plan could not be loaded. Reopen the case.');
                }
            }
            else
                setActiveAutomationWorkspaceTab('steps');
        }, onError: error => showError(error, 'Unable to finish recorder session.')
    });
    return { startRecorder, finishRecorder };
}
export type AutomationCaseRecorderActions = ReturnType<typeof useAutomationCaseRecorderActions>;
