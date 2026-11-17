import { parseAutomationStepDraft } from "../../lib/automationStepDraft";
import { parseAutomationStepOptions } from "../../lib/automationStepOptions";
import { type AutomationAgentActivityRecord } from "../../components/AutomationAgentActivity";
import { caseParameterSaveOptions } from "@hellotest/platform/frontend/src/shared/lib/parameterPrivacy";
import { useCallback } from "react";
import { automationCaseMappingStatus } from "../../lib/automationStepPersistence";
import { automationSavedPlanReceipt, mergeRefreshedAutomationDrafts } from "../../lib/automationBuildTracking";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import { getRoutableId } from "@hellotest/platform/frontend/src/shared/lib/urlSelection";
import { parseStepParameterName, type StepParameterScope } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import type { TestCase, TestStep } from "@hellotest/platform/frontend/src/types";
import { type AutomationCaseSectionKey, type AutomationWorkspaceTab, automationCaseDetailQueryKey, normalizeAutomationParameterValues } from "../../lib/automationWorkspaceSupport";
import type { AutomationCaseScope } from './useAutomationCaseScope';
import type { AutomationCaseState } from './useAutomationCaseState';
import type { AutomationCaseModel } from './useAutomationCaseModel';
export function useAutomationCaseServices(input: AutomationCaseScope & AutomationCaseState & AutomationCaseModel) {
    const {projectId, appTypeId, selectedCaseId, setSearchParams, activeCase, startUrl, automatedCases, setBatchStartUrl, setBatchBuildTargetIds, setIsBatchAgentOpen, queryClient, closingCaseRouteRef, setIsParameterDialogOpen, setActiveAutomationWorkspaceTab, setSelectedCaseId, automationBuildDraftBaselineRef, automationDraftStore, automatedSteps, currentAutomationSelectionRef, reviewBuildSource, setStepDrafts, setStepOptionDrafts, setStepCodeDrafts, agentBuildTracking, agentBuildStatus, latestAgentActivityRef, reviewBuildActivity, authoring, handledAgentActivityRef, refreshingAgentActivityRef, navigate, canUpdateAutomationCase, session, selectedParameterSuite, activeCaseSuiteIds, setSuiteParameterValues, visiblePrivateNames, setPrivateCaseParameterDraft, caseParameterPrivacyScope, caseParameterOverrideDraftRef, setTestCaseParameterValues, searchParams, setAutomationStudioStep, setExpandedCaseSections, caseSelection, setMessageTone, setMessage, lastAutomationCaseDraftSeedRef, testCaseParameterValues, privateCaseParameterDraft, canViewTestData, suiteParameterValues, canEditAutomationSuiteLinks, setSuiteLinkDraftIds, setApiSourceDrafts, unsavedAutomationStepIds, setSectionClipboard} = input;
    const agentBriefScope = `${projectId}:${appTypeId}:${selectedCaseId}`;
    const selectBuildMethod = (method: "agent" | "record") => setSearchParams(current => { const next = new URLSearchParams(current); next.set("build_method", method); return next; }, { replace: true });
    const openAutomationBuild = (ids: string[]) => {
        const savedUrls = ids.map(id => activeCase?.id === id ? startUrl.trim() : automatedCases.find(testCase => testCase.id === id)?.automation_start_url?.trim() || "");
        setBatchStartUrl(savedUrls.length && savedUrls.every(url => url === savedUrls[0]) ? savedUrls[0] : "");
        setBatchBuildTargetIds(ids);
        setIsBatchAgentOpen(true);
    };
    const invalidateAutomationData = () => {
        for (const key of ["test-cases", "test-case-detail", "global-test-cases", "global-test-case-results", "test-case-metrics",
            "test-case-picker", "test-case-picker-selected", "design-test-cases", "design-run-scope-cases", "test-steps",
            "automation-learning-cache", "automation-repository-context", "workspace-transactions", "test-case-suites",
            "test-case-modules", "test-suites", "execution-results", "execution-history"]) {
            void queryClient.invalidateQueries({ queryKey: [key] });
        }
    };
    const selectAutomationCase = useCallback((testCaseId: string) => {
        closingCaseRouteRef.current = "";
        const targetCase = automatedCases.find((testCase) => testCase.id === testCaseId) || null;
        setIsParameterDialogOpen(false);
        setActiveAutomationWorkspaceTab("steps");
        setSelectedCaseId(testCaseId);
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete("repository");
            next.delete("agent_activity");
            next.set("case", getRoutableId(targetCase) || testCaseId);
            return next;
        }, { replace: true });
    }, [automatedCases, setSearchParams]);
    const rememberAutomationBuildDrafts = () => {
        automationBuildDraftBaselineRef.current = { projectId, caseId: selectedCaseId, steps: automationDraftStore.read("steps"), options: automationDraftStore.read("options"), code: automationDraftStore.read("code"), evidence: Object.fromEntries(automatedSteps.map(step => [step.id, step.step_type === "api" ? JSON.stringify(step.api_request || {}, null, 2) : step.automation_code || ""])) };
    };
    const openGeneratedAutomationPlan = async (outputCaseId: string, outputProjectId = projectId, sourceCaseIds = [selectedCaseId], focusPlan = true) => {
        const previous = automationBuildDraftBaselineRef.current;
        const baseline = previous.projectId === outputProjectId && previous.caseId === outputCaseId ? previous : {
            steps: Object.fromEntries(automatedSteps.map(step => [step.id, parseAutomationStepDraft(step)])),
            options: Object.fromEntries(automatedSteps.map(step => [step.id, parseAutomationStepOptions(step)])),
            code: Object.fromEntries(automatedSteps.map(step => [step.id, step.automation_code || ""])),
            evidence: Object.fromEntries(automatedSteps.map(step => [step.id, step.step_type === "api" ? JSON.stringify(step.api_request || {}, null, 2) : step.automation_code || ""]))
        };
        const [detail, freshSteps] = await Promise.all([
            api.testCases.get(outputCaseId, { project_id: outputProjectId }),
            api.testSteps.list({ test_case_id: outputCaseId })
        ]);
        queryClient.setQueryData(automationCaseDetailQueryKey(outputProjectId, outputCaseId), detail);
        queryClient.setQueryData(["test-steps", "automation-workspace", outputCaseId], freshSteps);
        if (currentAutomationSelectionRef.current.projectId !== outputProjectId
            || ![outputCaseId, ...sourceCaseIds].includes(currentAutomationSelectionRef.current.selectedCaseId))
            return;
        const outputChanged = currentAutomationSelectionRef.current.selectedCaseId !== outputCaseId;
        const refreshedSteps = Object.fromEntries(freshSteps.map((step) => [step.id, parseAutomationStepDraft(step)]));
        const refreshedOptions = Object.fromEntries(freshSteps.map((step) => [step.id, parseAutomationStepOptions(step)]));
        const refreshedCode = Object.fromEntries(freshSteps.map((step) => [step.id, step.automation_code || ""]));
        reviewBuildSource({ changes: freshSteps.flatMap(step => {
                const before = baseline.evidence[step.id];
                const after = step.step_type === "api" ? JSON.stringify(step.api_request || {}, null, 2) : step.automation_code || "";
                return before !== undefined && before !== after ? [{ id: step.id, title: step.action || `Step ${step.step_order}`, before, after }] : [];
            }) });
        setStepDrafts((current) => outputChanged ? refreshedSteps : mergeRefreshedAutomationDrafts(current, baseline.steps, refreshedSteps));
        setStepOptionDrafts((current) => outputChanged ? refreshedOptions : mergeRefreshedAutomationDrafts(current, baseline.options, refreshedOptions));
        setStepCodeDrafts((current) => outputChanged ? refreshedCode : mergeRefreshedAutomationDrafts(current, baseline.code, refreshedCode));
        automationBuildDraftBaselineRef.current = { projectId: outputProjectId, caseId: outputCaseId, steps: refreshedSteps, options: refreshedOptions, code: refreshedCode, evidence: Object.fromEntries(freshSteps.map(step => [step.id, step.step_type === "api" ? JSON.stringify(step.api_request || {}, null, 2) : step.automation_code || ""])) };
        if (!outputChanged && !["build", "steps"].includes(currentAutomationSelectionRef.current.workspaceTab))
            return;
        if (focusPlan) {
            selectAutomationCase(outputCaseId);
            setActiveAutomationWorkspaceTab("steps");
        }
    };
    const handleAutomationAgentActivity = async (transaction: AutomationAgentActivityRecord) => {
        if (transaction.project_id !== projectId || transaction.app_type_id !== appTypeId)
            return;
        const tracking = agentBuildTracking;
        if (tracking?.caseIds.includes(selectedCaseId) && ["queued", "running"].includes(agentBuildStatus) && tracking.transactionId !== transaction.id)
            return;
        latestAgentActivityRef.current = transaction;
        const inputs = Array.isArray(transaction.metadata.input_test_case_ids) ? transaction.metadata.input_test_case_ids.filter((id): id is string => typeof id === "string") : [selectedCaseId];
        const outputs = Array.isArray(transaction.metadata.output_test_case_ids) ? transaction.metadata.output_test_case_ids.filter((id): id is string => typeof id === "string") : [];
        const caseIds = [...new Set([...inputs, ...outputs])];
        const completed = transaction.status === 'completed', cancelled = transaction.metadata.cancelled === true, failed = ['failed', 'cancelled', 'canceled'].includes(transaction.status);
        const status = cancelled ? 'cancelled' : failed || transaction.metadata.outcome_status === 'incomplete' ? 'failed' : transaction.metadata.outcome_status === 'partial' ? 'paused' : completed ? 'completed' : transaction.status === 'running' ? 'running' : 'queued';
        const unfinished = Array.isArray(transaction.metadata.retry_test_case_ids) ? transaction.metadata.retry_test_case_ids.filter((id): id is string => typeof id === 'string') : failed ? inputs.filter(id => !outputs.includes(id)) : [];
        reviewBuildActivity({ tracking: { transactionId: transaction.id, projectId, caseIds, scheduledAt: typeof transaction.metadata.scheduled_at === 'string' ? transaction.metadata.scheduled_at : null, startedAt: tracking?.transactionId === transaction.id ? tracking.startedAt : Date.now() }, status, receipt: typeof transaction.metadata.phase_message === 'string' ? transaction.metadata.phase_message : transaction.description || 'Agent activity recorded.', outputIds: outputs, retryIds: cancelled ? [] : unfinished });
        authoring.buildUpdated(transaction.id, status);
        const saved = automationSavedPlanReceipt(transaction.metadata, selectedCaseId);
        const receipt = `${transaction.id}:${saved.signature}`;
        if (saved.caseId && !handledAgentActivityRef.current.has(receipt) && !refreshingAgentActivityRef.current.has(receipt)) {
            refreshingAgentActivityRef.current.add(receipt);
            try {
                await openGeneratedAutomationPlan(saved.caseId, projectId, caseIds, false);
                handledAgentActivityRef.current.add(receipt);
                reviewBuildSource({ error: "" });
                invalidateAutomationData();
            }
            catch {
                if (currentAutomationSelectionRef.current.projectId === projectId && currentAutomationSelectionRef.current.selectedCaseId === saved.caseId)
                    reviewBuildSource({ error: "Saved instructions could not be loaded into Plan. Your drafts are retained." });
            }
            finally {
                refreshingAgentActivityRef.current.delete(receipt);
            }
        }
    };
    const openLinkedManualCase = (automationCase: TestCase, manualCaseIdOverride?: string) => {
        const manualCaseId = manualCaseIdOverride || automationCase.manual_test_case_ids?.[0] || automationCase.manual_test_case_id || automationCase.id;
        navigate(`/test-cases?case=${encodeURIComponent(manualCaseId)}`);
    };
    const resolveParameterInputState = (scope: StepParameterScope) => {
        if (!canUpdateAutomationCase || (scope === "s" && !hasPermission(session, "suite.update", projectId)))
            return { disabled: true, hint: "Update access is required to edit these parameters." };
        if (scope === "s" && !selectedParameterSuite) {
            return {
                disabled: true,
                hint: activeCaseSuiteIds.length ? "Choose a linked suite before editing @s values." : "Link this automation case to a suite before editing @s values."
            };
        }
        if (scope === "r") {
            return { hint: "Saved as an automation case default. Explicit run values can replace it during execution." };
        }
        return {};
    };
    const handleParameterValueChange = (name: string, value: string) => {
        const parsed = parseStepParameterName(name);
        if (!parsed || resolveParameterInputState(parsed.scope).disabled) {
            return;
        }
        if (parsed.scope === "s") {
            setSuiteParameterValues((current) => ({ ...current, [parsed.name]: value }));
            return;
        }
        if (visiblePrivateNames.has(parsed.name))
            setPrivateCaseParameterDraft(current => ({ scope: caseParameterPrivacyScope, names: [...new Set([...(current.scope === caseParameterPrivacyScope ? current.names : []), parsed.name])] }));
        if (caseParameterOverrideDraftRef.current.scope !== caseParameterPrivacyScope)
            caseParameterOverrideDraftRef.current = { scope: caseParameterPrivacyScope, names: new Set() };
        caseParameterOverrideDraftRef.current.names.add(parsed.name);
        setTestCaseParameterValues((current) => ({ ...current, [parsed.name]: value }));
    };
    const closeAutomationCaseWorkspace = () => {
        // Route updates can arrive after local state; do not reopen the old case.
        closingCaseRouteRef.current = searchParams.get("case") || "";
        setIsParameterDialogOpen(false);
        setAutomationStudioStep(null);
        setActiveAutomationWorkspaceTab("steps");
        setSelectedCaseId("");
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete("case");
            return next;
        }, { replace: true });
    };
    const selectAutomationWorkspaceTab = (tab: AutomationWorkspaceTab) => {
        setActiveAutomationWorkspaceTab(tab);
        const section: AutomationCaseSectionKey | null = tab === "details" || tab === "data" || tab === "hooks"
            ? "case"
            : tab === "runs" || tab === "history" ? "history" : ["repository", "suites", "defects"].includes(tab) ? null : tab as AutomationCaseSectionKey;
        if (section) {
            setExpandedCaseSections((current) => ({ ...current, [section]: true }));
        }
    };
    const toggleAutomationStep = (stepId: string) => {
        caseSelection.toggleExpandedStep(stepId);
    };
    const showSuccess = (text: string) => {
        setMessageTone("success");
        setMessage(text);
    };
    const showError = (error: unknown, fallback: string) => {
        setMessageTone("error");
        setMessage(error instanceof Error ? error.message : fallback);
    };
    const flushAutomationBuildParameters = async (caseIds: string[]) => {
        if (!activeCase || !caseIds.includes(activeCase.id))
            return;
        if (lastAutomationCaseDraftSeedRef.current?.caseKey !== `case:${projectId}:${activeCase.id}`)
            throw new Error("Wait for this case's Test Params to finish loading.");
        const same = (left: Record<string, string>, right: Record<string, string>) => JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());
        const ownValues = normalizeAutomationParameterValues(testCaseParameterValues, "t");
        const options = caseParameterSaveOptions(activeCase.test_data_options, ownValues, activeCase.parameter_values, visiblePrivateNames, caseParameterOverrideDraftRef.current.scope === caseParameterPrivacyScope ? caseParameterOverrideDraftRef.current.names : [], privateCaseParameterDraft.scope === caseParameterPrivacyScope ? privateCaseParameterDraft.names : []);
        const priorityChanged = (options.parameter_overrides || []).join("\0") !== [...(activeCase.test_data_options?.parameter_overrides || [])].sort().join("\0");
        const privacyChanged = (options.private_parameter_names || []).join("\0") !== [...(activeCase.test_data_options?.private_parameter_names || [])].sort().join("\0");
        if (!same(ownValues, normalizeAutomationParameterValues(activeCase.parameter_values, "t")) || priorityChanged || privacyChanged) {
            if (!canUpdateAutomationCase || !canViewTestData)
                throw new Error("Case update and Test Data access are required to use edited Test Params.");
            const response = await api.testCases.update(activeCase.id, { parameter_values: ownValues, test_data_options: options, expected_revision: activeCase.revision });
            queryClient.setQueriesData<TestCase>({ queryKey: automationCaseDetailQueryKey(projectId, activeCase.id) }, current => current ? { ...current, parameter_values: ownValues, test_data_options: options, ...(response.revision ? { revision: response.revision } : {}) } : current);
        }
        if (selectedParameterSuite && activeCaseSuiteIds.includes(selectedParameterSuite.id) && !same(normalizeAutomationParameterValues(suiteParameterValues, "s"), normalizeAutomationParameterValues(selectedParameterSuite.parameter_values, "s"))) {
            if (!hasPermission(session, "suite.update", projectId))
                throw new Error("Suite update access is required to use edited Suite Params.");
            await api.testSuites.update(selectedParameterSuite.id, { parameter_values: normalizeAutomationParameterValues(suiteParameterValues, "s") });
            await queryClient.invalidateQueries({ queryKey: ["test-case-suites"] });
        }
    };
    const saveAutomationSuiteLinks = async (ids: string[]) => {
        if (!activeCase || !canEditAutomationSuiteLinks)
            return;
        const caseId = activeCase.id;
        const response = await api.testCases.update(caseId, { suite_ids: ids, expected_revision: activeCase.revision });
        queryClient.setQueryData<TestCase>(automationCaseDetailQueryKey(projectId, caseId), current => current ? { ...current, suite_ids: ids, suite_id: ids[0] || null, revision: response.revision } : current);
        if (currentAutomationSelectionRef.current.selectedCaseId === caseId)
            setSuiteLinkDraftIds(ids);
        await Promise.all([queryClient.invalidateQueries({ queryKey: automationCaseDetailQueryKey(projectId, caseId), exact: true }), queryClient.invalidateQueries({ queryKey: ["test-case-suites"] }), queryClient.invalidateQueries({ queryKey: ["test-cases"] })]);
    };
    const syncAutomationStepDrafts = (step: TestStep) => {
        setStepDrafts((current) => ({ ...current, [step.id]: parseAutomationStepDraft(step) }));
        setStepCodeDrafts((current) => ({ ...current, [step.id]: step.automation_code || "" }));
        setApiSourceDrafts((current) => { const next = { ...current }; delete next[step.id]; return next; });
        setStepOptionDrafts((current) => ({ ...current, [step.id]: parseAutomationStepOptions(step) }));
    };
    const refreshAutomationStepAfterSave = async (caseId: string, stepId: string) => {
        const steps = await api.testSteps.list({ test_case_id: caseId });
        queryClient.setQueryData(["test-steps", "automation-workspace", caseId], steps);
        const saved = steps.find((candidate) => candidate.id === stepId);
        if (!saved)
            throw new Error("The step was saved but could not be reloaded. Refresh the case to continue.");
        await api.testCases.update(caseId, { automated: "yes", automation_status: automationCaseMappingStatus(steps) });
        return saved;
    };
    const copyAutomationSections = (ids: string[], standalone = false) => {
        if (!activeCase)
            return;
        if (unsavedAutomationStepIds.some(id => ids.includes(id))) {
            showError(new Error("Save the selected section changes before copying."), "Unable to copy sections.");
            return;
        }
        setSectionClipboard({ projectId, caseId: activeCase.id, appTypeId, ids, standalone });
        showSuccess("Sections copied. Choose Paste sections or Paste after group.");
    };
    return { agentBriefScope, selectBuildMethod, openAutomationBuild, invalidateAutomationData, selectAutomationCase, rememberAutomationBuildDrafts, openGeneratedAutomationPlan, handleAutomationAgentActivity, openLinkedManualCase, resolveParameterInputState, handleParameterValueChange, closeAutomationCaseWorkspace, selectAutomationWorkspaceTab, toggleAutomationStep, showSuccess, showError, flushAutomationBuildParameters, saveAutomationSuiteLinks, syncAutomationStepDrafts, refreshAutomationStepAfterSave, copyAutomationSections };
}
export type AutomationCaseServices = ReturnType<typeof useAutomationCaseServices>;
