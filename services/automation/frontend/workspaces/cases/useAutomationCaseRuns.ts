import type { AutomationCasesActionPorts as ActionPorts } from './automationCasesTypes';

import { handoverAutomationRun } from "../../lib/automationExecution";
import { type AutomationRunReviewRequest } from "../../components/AutomationRunReviewDialog";
import { requireReadyAutomation, type AutomationReadiness } from "../../lib/automationReadiness";
import { AutomationStartError, confirmReviewedAutomationRun, retrySavedAutomationRun } from "../../lib/automationRunDispatch";

import { useMutation } from "@tanstack/react-query";

import { api } from "@hellotest/platform/frontend/src/lib/api";

export function useAutomationCaseRuns(ports:ActionPorts){
const {
    automatedCases,
    showError,
    setPendingRemoteRun,
    setRunReviewError,
    setRunReviewRequest,
    projectId,
    appTypeId,
    canRunLocalAutomation,
    canRunRemoteAutomation,
    session,
    selectedExecutionEnvironmentId,
    selectedExecutionConfigurationId,
    selectedExecutionDataSetId,
    inspectSavedPlans,
    queryClient,
    setSelectedAutomationCaseIds,
    navigate,
    showSuccess,
    message,
    pendingRemoteRun,
} = ports;
const requestAutomationRun = (mode: "local" | "remote", caseIds: string[]) => {
    const targets = [...new Set(caseIds)].filter(id => automatedCases.some(testCase => testCase.id === id));
    if (!targets.length) {
        showError(new Error("Select at least one automation case."), "Selection required.");
        return;
    }
    setPendingRemoteRun(null);
    setRunReviewError("");
    setRunReviewRequest({ mode, caseIds: targets, projectId, appTypeId, requestId: crypto.randomUUID() });
};
const runSelectedAutomationCases = useMutation({
    mutationFn: async ({ request, reviewed }: {
        request: AutomationRunReviewRequest;
        reviewed: AutomationReadiness[];
    }) => {
        if (request.mode === "local" && !canRunLocalAutomation)
            throw new Error("Permission required: automation.run.local");
        if (request.mode === "remote" && !canRunRemoteAutomation)
            throw new Error("Permission required: automation.run.remote");
        if (!session?.user.id || request.projectId !== projectId || request.appTypeId !== appTypeId)
            throw new Error("The workspace changed. Review your selection again.");
        const input = {
            project_id: request.projectId, app_type_id: request.appTypeId, test_case_ids: [...request.caseIds],
            name: reviewed.length === 1 ? `${reviewed[0].title} ${request.mode === "local" ? "Local" : "Remote"} Run` : `Automation ${request.mode} run · ${reviewed.length} cases`,
            created_by: session.user.id,
            test_environment_id: selectedExecutionEnvironmentId || undefined,
            test_configuration_id: selectedExecutionConfigurationId || undefined,
            test_data_set_id: selectedExecutionDataSetId || undefined
        };
        // Re-read immediately before snapshot creation. Catalog readiness and a
        // stale review must never dispatch an unfinished or changed plan.
        const current = await inspectSavedPlans(request.caseIds);
        requireReadyAutomation(current);
        if (current.some(item => { const previous = reviewed.find(result => result.id === item.id); return !previous || previous.revision !== item.revision || previous.updatedAt !== item.updatedAt || previous.planSignature !== item.planSignature; }))
            throw new Error("A saved plan changed during review. Recheck before starting.");
        const response = await handoverAutomationRun(api.executions, request.mode, input, request.requestId);
        return confirmReviewedAutomationRun(response, request, id => api.executions.get(id));
    },
    onSuccess: async ({ id, mode, count }) => {
        setRunReviewRequest(null);
        setPendingRemoteRun(null);
        setRunReviewError("");
        await Promise.all([queryClient.invalidateQueries({ queryKey: ["executions"] }), queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] })]);
        setSelectedAutomationCaseIds([]);
        navigate(`/executions?view=${mode === "local" ? "local-runs" : "suite-runs"}&execution=${id}`);
        showSuccess(`${mode === "local" ? "Local" : "Remote"} automation started with ${count} case${count === 1 ? "" : "s"}.`);
    },
    onError: error => {
        if (error instanceof AutomationStartError)
            setPendingRemoteRun(error.receipt);
        setRunReviewError(error instanceof Error ? error.message : "Unable to start this run.");
    }
});
const retryRemoteAutomationStart = useMutation({
    mutationFn: async () => {
        if (!pendingRemoteRun || !canRunRemoteAutomation || pendingRemoteRun.projectId !== projectId || pendingRemoteRun.appTypeId !== appTypeId)
            throw new Error("Return to the original workspace to retry this run.");
        return retrySavedAutomationRun(pendingRemoteRun, id => api.executions.get(id), id => api.executions.start(id, { execution_mode: "remote" }));
    },
    onSuccess: receipt => {
        setRunReviewRequest(null);
        setPendingRemoteRun(null);
        setRunReviewError("");
        void queryClient.invalidateQueries({ queryKey: ["executions"] });
        navigate(`/executions?view=suite-runs&execution=${receipt.id}`);
        showSuccess(receipt.alreadyStarted ? "Opened the saved run’s evidence." : "The saved automation run has started.");
    },
    onError: error => {
        if (error instanceof AutomationStartError)
            setPendingRemoteRun(error.receipt);
        setRunReviewError(error instanceof Error ? error.message : "The engine could not start this run.");
    }
});
return {requestAutomationRun,runSelectedAutomationCases,retryRemoteAutomationStart};
}

