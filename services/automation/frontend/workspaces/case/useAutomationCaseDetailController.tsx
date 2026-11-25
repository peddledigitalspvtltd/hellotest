
import { automationAgentSelection } from "@hellotest/ai/frontend/components/AutomationAgentSetup";
import { resolveAutomationCaseType } from "../../lib/automationRuntime";
import { mapExecutionHooksToRunHooks } from "@hellotest/testing/frontend/lib/runHooks";
import { useEffect } from "react";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { mergeAutomationMetadataFields, mergeAutomationMetadataValue } from "../../lib/automationMetadataDraft";
import { findByRoutableId } from "@hellotest/platform/frontend/src/shared/lib/urlSelection";
import type { TestCase } from "@hellotest/platform/frontend/src/types";
import { normalizeAutomationParameterValues, type AutomationCaseDraft } from "../../lib/automationWorkspaceSupport";
import { useAutomationCaseScope } from './useAutomationCaseScope';
import { useAutomationCaseState } from './useAutomationCaseState';
import { useAutomationCaseModel } from './useAutomationCaseModel';
import { useAutomationCaseServices } from './useAutomationCaseServices';
import { useAutomationCaseBuildActions } from './useAutomationCaseBuildActions';
import { useAutomationCasePlanActions } from './useAutomationCasePlanActions';
import { useAutomationCaseDataActions } from './useAutomationCaseDataActions';
import { useAutomationCaseRunActions } from './useAutomationCaseRunActions';
import { useAutomationCaseRecorderActions } from './useAutomationCaseRecorderActions';
export function useAutomationCaseDetailController(defaultTab?: Parameters<typeof useAutomationCaseState>[1]) {
    const scope = useAutomationCaseScope();
    const state = useAutomationCaseState(scope, defaultTab);
    const model = useAutomationCaseModel({ ...scope, ...state });
    const services = useAutomationCaseServices({ ...scope, ...state, ...model });
    const base = { ...scope, ...state, ...model, ...services };
    const buildActions = useAutomationCaseBuildActions(base);
    const planActions = useAutomationCasePlanActions(base);
    const dataActions = useAutomationCaseDataActions(base);
    const runActions = useAutomationCaseRunActions(base);
    const recorderActions = useAutomationCaseRecorderActions(base);
    const {setBuildAgentSelection, projectId, appTypeId, selectedCaseId, currentAutomationSelectionRef, activeAutomationWorkspaceTab, setRunReviewRequest, setPendingRemoteRun, setRunReviewError, resetBuildReview, setIsBatchAgentOpen, setBatchBuildTargetIds, session, reviewBuildSource, latestAgentActivityRef, startUrlCaseScopeRef, setStartUrl, activeCase, setPrivateCaseParameterDraft, caseParameterPrivacyScope, canUseAutomationAi, canRecordCurrentPlan, canViewObjectRepository, setActiveAutomationWorkspaceTab, featureFlagsQuery, appTypesQuery, appTypes, setAppTypeId, setSelectedCaseId, setIsParameterDialogOpen, searchParams, closingCaseRouteRef, automatedCases, testCasesQuery, lastAutomationRouteRef, lastAutomationCaseDraftSeedRef, setTestCaseParameterValues, setSuiteLinkDraftIds, setCaseRequirementIds, setCaseModuleIds, setCaseDataSetId, setAutomationManualLinkDraftIds, setExecutionHookDraft, setSelectedExecutionDataSetId, setSelectedExecutionEnvironmentId, automatedSteps, selectedRuntimeType, setCaseDraft, setOverrideSharedSteps, activeCaseSuiteIds, setSelectedParameterSuiteId, setSuiteParameterValues, selectedParameterSuiteId, selectedParameterSuite, lastAutomationSuiteParameterSeedRef, canViewAutomationCode, automationStepView, setAutomationStepView, setStepCodeDrafts, selectBuildMethod, setSectionGroupDialog, caseSelection, setAutomationGroupName, setSaveAutomationGroupAsShared, groupAutomationSteps, ungroupAutomationSteps, recorderSession, startRecorder, finishRecorder, showError, executionHookDraft, authoring, recording, recordingRestoreRef, setSelectedExecutionConfigurationId, setRecordingTargetStepId, automatedStepsQuery, testCaseParameterValues, suiteParameterValues, privateCaseParameterDraft, caseParameterOverrideDraftRef, recordingDraftRestoreRef, isBatchAgentOpen, scheduleAiAutomation, agentBuildTracking, agentBuildStatus} = { ...base, ...buildActions, ...planActions, ...dataActions, ...runActions, ...recorderActions };
    useEffect(() => setBuildAgentSelection(automationAgentSelection()), [projectId, appTypeId, selectedCaseId]);
    currentAutomationSelectionRef.current = { projectId, selectedCaseId, workspaceTab: activeAutomationWorkspaceTab };
    useEffect(() => {
        setRunReviewRequest(null);
        setPendingRemoteRun(null);
        setRunReviewError("");
        resetBuildReview();
        setIsBatchAgentOpen(false);
        setBatchBuildTargetIds([]);
    }, [projectId, appTypeId, session?.user.id]);
    useEffect(() => { reviewBuildSource({ error: "" }); latestAgentActivityRef.current = null; }, [projectId, appTypeId, selectedCaseId]);
    useEffect(() => {
        const scope = `${projectId}:${appTypeId}:${selectedCaseId}`;
        if (startUrlCaseScopeRef.current === scope)
            return;
        // Wait for the selected detail instead of borrowing a previous case's URL.
        setStartUrl("");
        if (!selectedCaseId || activeCase?.id === selectedCaseId) {
            startUrlCaseScopeRef.current = scope;
            setStartUrl(activeCase?.id === selectedCaseId ? activeCase.automation_start_url || "" : "");
        }
    }, [projectId, appTypeId, selectedCaseId, activeCase?.id, activeCase?.automation_start_url]);
    useEffect(() => {
        setPrivateCaseParameterDraft(current => current.scope === caseParameterPrivacyScope ? current : { scope: caseParameterPrivacyScope, names: [] });
    }, [caseParameterPrivacyScope]);
    useEffect(() => {
        if (activeAutomationWorkspaceTab === "build" && !canUseAutomationAi && !canRecordCurrentPlan
            || activeAutomationWorkspaceTab === "repository" && !canViewObjectRepository)
            setActiveAutomationWorkspaceTab("steps");
    }, [activeAutomationWorkspaceTab, canUseAutomationAi, canRecordCurrentPlan, canViewObjectRepository, session, projectId, featureFlagsQuery.data]);
    useEffect(() => {
        if (appTypesQuery.isPending) {
            return;
        }
        const scopedAppTypes = projectId ? appTypes.filter((appType) => String(appType.project_id) === String(projectId)) : appTypes;
        if (!scopedAppTypes.length) {
            setAppTypeId("");
            return;
        }
        if (!scopedAppTypes.some((appType) => appType.id === appTypeId)) {
            setAppTypeId(scopedAppTypes[0].id);
            setSelectedCaseId("");
            setIsParameterDialogOpen(false);
        }
    }, [appTypeId, appTypes, appTypesQuery.isPending, projectId, setAppTypeId]);
    useEffect(() => {
        const requestedCaseId = searchParams.get("case") || "";
        if (!requestedCaseId)
            closingCaseRouteRef.current = "";
        if (requestedCaseId && closingCaseRouteRef.current === requestedCaseId)
            return;
        const requestedCase = findByRoutableId(automatedCases, requestedCaseId);
        if (testCasesQuery.isLoading
            || testCasesQuery.isFetching) {
            return;
        }
        // Consume a URL selection once. React can render a local close/open before
        // the router commits; replaying the old URL would undo the user's action.
        const routeKey = `${projectId}:${appTypeId}:${requestedCaseId}`;
        if (lastAutomationRouteRef.current === routeKey)
            return;
        lastAutomationRouteRef.current = routeKey;
        if (!requestedCaseId)
            return;
        if (requestedCase) {
            setSelectedCaseId(requestedCase.id);
        }
    }, [automatedCases, "cases", searchParams, selectedCaseId, testCasesQuery.isFetching, testCasesQuery.isLoading, projectId, appTypeId]);
    useEffect(() => {
        if (!selectedCaseId) {
            if (lastAutomationCaseDraftSeedRef.current) {
                setTestCaseParameterValues({});
                setSuiteLinkDraftIds([]);
                setCaseRequirementIds([]);
                setCaseModuleIds([]);
                setCaseDataSetId("");
                setAutomationManualLinkDraftIds([]);
                setExecutionHookDraft([]);
                setSelectedExecutionDataSetId("");
                setSelectedExecutionEnvironmentId("");
                lastAutomationCaseDraftSeedRef.current = null;
            }
            return;
        }
        if (!activeCase || activeCase.id !== selectedCaseId)
            return;
        const caseKey = `case:${projectId}:${activeCase.id}`;
        const previous = lastAutomationCaseDraftSeedRef.current?.caseKey === caseKey
            ? lastAutomationCaseDraftSeedRef.current.detail
            : null;
        const draftFromCase = (testCase: TestCase): AutomationCaseDraft => ({
            automationCaseType: resolveAutomationCaseType(testCase, automatedSteps, selectedRuntimeType),
            title: testCase.title || "",
            description: testCase.description || "",
            status: testCase.status || "active",
            priority: String(testCase.priority || 3)
        });
        const suitesFromCase = (testCase: TestCase) => testCase.suite_ids || (testCase.suite_id ? [testCase.suite_id] : []);
        const requirementsFromCase = (testCase: TestCase) => testCase.requirement_ids || (testCase.requirement_id ? [testCase.requirement_id] : []);
        const manualCasesFromCase = (testCase: TestCase) => testCase.manual_test_case_ids?.length
            ? testCase.manual_test_case_ids
            : testCase.manual_test_case_id ? [testCase.manual_test_case_id] : [];
        const nextDraft = draftFromCase(activeCase);
        const nextParameters = normalizeAutomationParameterValues(activeCase.parameter_values, "t");
        const nextDataSetId = activeCase.test_data_set_ids?.[0] || "";
        setCaseDraft((current) => previous ? mergeAutomationMetadataFields(current, draftFromCase(previous), nextDraft) : nextDraft);
        setTestCaseParameterValues((current) => previous ? mergeAutomationMetadataFields(current, normalizeAutomationParameterValues(previous.parameter_values, "t"), nextParameters) : nextParameters);
        setSuiteLinkDraftIds((current) => previous ? mergeAutomationMetadataValue(current, suitesFromCase(previous), suitesFromCase(activeCase)) : suitesFromCase(activeCase));
        setCaseRequirementIds((current) => previous ? mergeAutomationMetadataValue(current, requirementsFromCase(previous), requirementsFromCase(activeCase)) : requirementsFromCase(activeCase));
        setCaseModuleIds((current) => previous ? mergeAutomationMetadataValue(current, previous.module_ids || [], activeCase.module_ids || []) : activeCase.module_ids || []);
        setOverrideSharedSteps(current => previous ? mergeAutomationMetadataValue(current, (previous.test_data_options?.override_shared_sections ?? previous.test_data_options?.override_shared_steps) !== false, (activeCase.test_data_options?.override_shared_sections ?? activeCase.test_data_options?.override_shared_steps) !== false) : (activeCase.test_data_options?.override_shared_sections ?? activeCase.test_data_options?.override_shared_steps) !== false);
        setCaseDataSetId((current) => previous ? mergeAutomationMetadataValue(current, previous.test_data_set_ids?.[0] || "", nextDataSetId) : nextDataSetId);
        setExecutionHookDraft(current => previous ? mergeAutomationMetadataValue(current, mapExecutionHooksToRunHooks(previous.execution_hooks), mapExecutionHooksToRunHooks(activeCase.execution_hooks)) : mapExecutionHooksToRunHooks(activeCase.execution_hooks));
        setAutomationManualLinkDraftIds((current) => previous ? mergeAutomationMetadataValue(current, manualCasesFromCase(previous), manualCasesFromCase(activeCase)) : manualCasesFromCase(activeCase));
        setSelectedExecutionDataSetId((current) => previous ? mergeAutomationMetadataValue(current, previous.test_data_set_ids?.[0] || "", nextDataSetId) : nextDataSetId);
        setSelectedExecutionEnvironmentId(current => previous ? mergeAutomationMetadataValue(current, previous.test_data_options?.test_environment_id || "", activeCase.test_data_options?.test_environment_id || "") : activeCase.test_data_options?.test_environment_id || "");
        lastAutomationCaseDraftSeedRef.current = { caseKey, detail: activeCase };
    }, [activeCase, projectId, selectedCaseId]);
    useEffect(() => {
        if (!activeCaseSuiteIds.length) {
            setSelectedParameterSuiteId("");
            setSuiteParameterValues({});
            return;
        }
        if (!activeCaseSuiteIds.includes(selectedParameterSuiteId)) {
            setSelectedParameterSuiteId(activeCaseSuiteIds.length === 1 ? activeCaseSuiteIds[0] : "");
        }
    }, [activeCaseSuiteIds, selectedParameterSuiteId]);
    useEffect(() => {
        if (!selectedParameterSuite) {
            setSuiteParameterValues({});
            lastAutomationSuiteParameterSeedRef.current = null;
            return;
        }
        const next = normalizeAutomationParameterValues(selectedParameterSuite.parameter_values, "s");
        const previous = lastAutomationSuiteParameterSeedRef.current?.suiteId === selectedParameterSuite.id
            ? lastAutomationSuiteParameterSeedRef.current.values : null;
        setSuiteParameterValues((current) => previous ? mergeAutomationMetadataFields(current, previous, next) : next);
        lastAutomationSuiteParameterSeedRef.current = { suiteId: selectedParameterSuite.id, values: next };
    }, [selectedParameterSuite?.id, selectedParameterSuite?.parameter_values]);
    useEffect(() => {
        if (!canViewAutomationCode && automationStepView === "code") {
            setAutomationStepView("keyword");
        }
        if (!canViewAutomationCode)
            setStepCodeDrafts({});
    }, [automationStepView, canViewAutomationCode]);
    useEffect(() => {
        if (searchParams.get("agent_activity") && selectedCaseId) {
            setActiveAutomationWorkspaceTab("build");
            selectBuildMethod("agent");
        }
    }, [searchParams.get("agent_activity"), selectedCaseId]);
    useEffect(() => {
        setSectionGroupDialog(null);
        caseSelection.selectSteps([]);
        setAutomationGroupName("");
        setSaveAutomationGroupAsShared(false);
    }, [activeCase?.id, projectId]);
    const openSectionGroupDialog = (mode: "group" | "shared" | "local" | "ungroup", stepIds: string[], name = "", groupId?: string) => {
        groupAutomationSteps.reset();
        ungroupAutomationSteps.reset();
        setAutomationGroupName(name);
        setSaveAutomationGroupAsShared(mode === "shared");
        setSectionGroupDialog({ mode, stepIds, groupId });
    };
    const requestAutomationRun = (mode: "local" | "remote", caseIds: string[]) => {
        if (recorderSession || startRecorder.isPending || finishRecorder.isPending) {
            showError(new Error("Finish the recording before running the saved plan."), "Recording in progress.");
            return;
        }
        if (activeCase && caseIds.includes(activeCase.id) && JSON.stringify(executionHookDraft) !== JSON.stringify(mapExecutionHooksToRunHooks(activeCase.execution_hooks))) {
            showError(new Error("Save the changed Before / After cases before starting a run."), "Unsaved Before / After cases");
            return;
        }
        const targets = [...new Set(caseIds)].filter(id => automatedCases.some(testCase => testCase.id === id));
        if (!targets.length) {
            showError(new Error("Select at least one automation case."), "Selection required.");
            return;
        }
        setPendingRemoteRun(null);
        setRunReviewError("");
        setRunReviewRequest({ mode, caseIds: targets, projectId, appTypeId, requestId: crypto.randomUUID() });
    };
    useEffect(()=>{
        if(selectedCaseId){const controller=new AbortController();void authoring.syncAuthoringState(selectedCaseId,controller.signal).catch(()=>{});return()=>controller.abort();}
    },[selectedCaseId,projectId,appTypeId]);
    useEffect(()=>{
        const saved=recording;
        if(!saved||saved.origin.caseId!==activeCase?.id||saved.origin.projectId!==projectId||saved.origin.appTypeId!==appTypeId){recordingRestoreRef.current='';recordingDraftRestoreRef.current='';return;}
        if(recordingRestoreRef.current===saved.operationId)return;
        const origin=saved.origin;setSelectedParameterSuiteId(origin.suiteId);setSelectedExecutionEnvironmentId(origin.environmentId);setSelectedExecutionConfigurationId(origin.configurationId);setSelectedExecutionDataSetId(origin.dataSetId);setRecordingTargetStepId(origin.targetStepId);selectBuildMethod('record');
        recordingRestoreRef.current=saved.operationId;
    },[recording?.operationId,activeCase?.id,projectId,appTypeId]);
    useEffect(()=>{if(automatedStepsQuery.data)caseSelection.reconcileSteps(automatedSteps.map(step=>step.id));},[automatedStepsQuery.data]);
    useEffect(()=>{
        const saved=recording;
        if(!saved||saved.origin.caseId!==activeCase?.id||selectedParameterSuiteId!==saved.origin.suiteId
          ||lastAutomationCaseDraftSeedRef.current?.caseKey!==`case:${projectId}:${activeCase.id}`
          ||saved.origin.suiteId&&lastAutomationSuiteParameterSeedRef.current?.suiteId!==saved.origin.suiteId)return;
        const draft={caseValues:testCaseParameterValues,suiteValues:suiteParameterValues,
          privateNames:privateCaseParameterDraft.scope===caseParameterPrivacyScope?privateCaseParameterDraft.names:[],
          overrideNames:caseParameterOverrideDraftRef.current.scope===caseParameterPrivacyScope?[...caseParameterOverrideDraftRef.current.names].sort():[]};
        if(recordingDraftRestoreRef.current!==saved.operationId&&saved.parameterDraft){
            const retained=saved.parameterDraft;
            if(JSON.stringify(draft)!==JSON.stringify(retained)){
                setTestCaseParameterValues({...retained.caseValues});setSuiteParameterValues({...retained.suiteValues});
                setPrivateCaseParameterDraft({scope:caseParameterPrivacyScope,names:[...retained.privateNames]});
                caseParameterOverrideDraftRef.current={scope:caseParameterPrivacyScope,names:new Set(retained.overrideNames)};
                return;
            }
        }
        recordingDraftRestoreRef.current=saved.operationId;
        if(JSON.stringify(draft)!==JSON.stringify(saved.parameterDraft)){
            try{authoring.recordingDraftChanged(saved.origin.caseId,saved.operationId,draft);}
            catch(error){showError(error,'This parameter draft could not be retained across navigation.');}
        }
    },[recording?.operationId,recording?.parameterDraft,activeCase?.id,selectedParameterSuiteId,testCaseParameterValues,suiteParameterValues,privateCaseParameterDraft,caseParameterPrivacyScope]);
    const batchAgentDialogRef = useDialogFocus<HTMLDivElement>({ active: isBatchAgentOpen, closeDisabled: scheduleAiAutomation.isPending, onClose: () => setIsBatchAgentOpen(false) });
    const currentAuthoringState=authoring.caseState(selectedCaseId);
const activeAgentBuildStatus=currentAuthoringState.phase==="building"?(currentAuthoringState.build.status==="submitting"?"queued":currentAuthoringState.build.status):agentBuildTracking?.projectId===projectId&&agentBuildTracking.caseIds.includes(selectedCaseId)?agentBuildStatus:"idle";
const authoringNotice=currentAuthoringState.phase==="conflict"?currentAuthoringState.message:currentAuthoringState.phase==="record_starting"?"The recorder is starting. Wait for its receipt before starting another operation.":currentAuthoringState.phase==="record_saving"?"The recording is being saved.":currentAuthoringState.phase==="recording"?"Finish this recording before building another plan.":currentAuthoringState.phase==="building"?"This case has an active build. Review or stop that activity before recording.":"";
const canBuildCurrentPlan=currentAuthoringState.phase==="idle";
const canStartRecording=canRecordCurrentPlan && currentAuthoringState.phase==="idle" && !authoring.activeRecording();
    const automationPageHeader = {
        eyebrow: "Automation",
        title: "Automation",
        description: "From behavior to executable evidence."
    };
    return { authoringNotice,currentAuthoringState,canStartRecording,canBuildCurrentPlan,...base, ...buildActions, ...planActions, ...dataActions, ...runActions, ...recorderActions, openSectionGroupDialog, requestAutomationRun, batchAgentDialogRef, activeAgentBuildStatus, automationPageHeader };
}
export type AutomationCaseDetailController = ReturnType<typeof useAutomationCaseDetailController>;
