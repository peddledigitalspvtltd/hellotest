import { caseParameterSaveOptions } from "@hellotest/platform/frontend/src/shared/lib/parameterPrivacy";
import { mapCaseHooksToExecutionHooks } from "@hellotest/testing/frontend/lib/runHooks";
import { useMutation } from "@tanstack/react-query";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import type { TestCase } from "@hellotest/platform/frontend/src/types";
import { automationCaseDetailQueryKey, normalizeAutomationParameterValues } from "../../lib/automationWorkspaceSupport";
import type { AutomationCaseScope } from './useAutomationCaseScope';
import type { AutomationCaseState } from './useAutomationCaseState';
import type { AutomationCaseModel } from './useAutomationCaseModel';
import type { AutomationCaseServices } from './useAutomationCaseServices';
export function useAutomationCaseDataActions(input: AutomationCaseScope & AutomationCaseState & AutomationCaseModel & AutomationCaseServices) {
    const {canUpdateAutomationCase, isAutomationCaseDetailReady, activeCase, caseDraft, detailIncompatibleRuntimes, selectedParameterSuite, session, projectId, suiteParameterValues, canViewTestData, testCaseParameterValues, suiteLinkDraftIds, caseRequirementIds, caseDataSetId, visiblePrivateNames, caseParameterOverrideDraftRef, caseParameterPrivacyScope, privateCaseParameterDraft, overrideSharedSteps, automationManualLinkDraftIds, executionHookDraft, caseModuleIds, automationModules, queryClient, showError, showSuccess, canRemoveAutomationCase, setSelectedCaseId, setSearchParams, invalidateAutomationData, flushAutomationBuildParameters, setIsParameterDialogOpen, currentAutomationSelectionRef} = input;
    const dataSettingsChanged = Boolean(activeCase && (
        caseDataSetId !== (activeCase.test_data_set_ids?.[0] || "") ||
        overrideSharedSteps !== ((activeCase.test_data_options?.override_shared_sections ?? activeCase.test_data_options?.override_shared_steps) !== false)
    ));
    const suiteParameterDraftChanged = Boolean(selectedParameterSuite && JSON.stringify(Object.entries(
        normalizeAutomationParameterValues(suiteParameterValues, "s")).sort()) !== JSON.stringify(Object.entries(
        normalizeAutomationParameterValues(selectedParameterSuite.parameter_values, "s")).sort()));
    const saveAutomationDataSettings = useMutation({
        mutationFn: async () => {
            if (!activeCase || !isAutomationCaseDetailReady || !canViewTestData || !canUpdateAutomationCase)
                throw new Error("Wait for editable test data settings.");
            const caseId = activeCase.id;
            const test_data_set_ids = caseDataSetId ? [caseDataSetId] : [];
            const test_data_options = { ...activeCase.test_data_options, override_shared_sections: overrideSharedSteps, shared_data_kind: "sections" as const };
            const response = await api.testCases.update(caseId, { test_data_set_ids, test_data_options, expected_revision: activeCase.revision });
            queryClient.setQueryData<TestCase>(automationCaseDetailQueryKey(projectId, caseId), current => current ? {
                ...current, test_data_set_ids, test_data_options, revision: response.revision ?? current.revision
            } : current);
            void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
        },
        onSuccess: () => showSuccess("Data settings saved."),
        onError: error => showError(error, "Unable to save data settings.")
    });
    const saveAutomationParameters = useMutation({
        mutationFn: async () => {
            if (!activeCase || !isAutomationCaseDetailReady || !canViewTestData)
                throw new Error("Wait for the case’s Test Params to load.");
            const caseId = activeCase.id;
            await flushAutomationBuildParameters([caseId]);
            return caseId;
        },
        onSuccess: caseId => {
            if (currentAutomationSelectionRef.current.selectedCaseId === caseId) setIsParameterDialogOpen(false);
            showSuccess("Test Params saved.");
        }
    });
    const updateAutomationCase = useMutation({
        mutationFn: async () => {
            if (!canUpdateAutomationCase) {
                throw new Error("Automation authoring and Test Case update permissions are required.");
            }
            if (!isAutomationCaseDetailReady || !activeCase) {
                throw new Error("Wait for the complete automation case details before saving.");
            }
            if (!caseDraft.automationCaseType)
                throw new Error("Select an automation case type.");
            if (detailIncompatibleRuntimes.length)
                throw new Error(`The selected case type does not support ${detailIncompatibleRuntimes.join(", ")} steps. Choose Unified or update the plan first.`);
            const caseId = activeCase.id;
            const asEntries = (values?: Record<string, string>) => JSON.stringify(Object.entries(values || {}).sort());
            const parameterPatch = canViewTestData ? (() => {
                const values = normalizeAutomationParameterValues(testCaseParameterValues, "t");
                const saved = normalizeAutomationParameterValues(activeCase.parameter_values, "t");
                const options = caseParameterSaveOptions(activeCase.test_data_options, values, activeCase.parameter_values, visiblePrivateNames,
                    caseParameterOverrideDraftRef.current.scope === caseParameterPrivacyScope ? caseParameterOverrideDraftRef.current.names : [],
                    privateCaseParameterDraft.scope === caseParameterPrivacyScope ? privateCaseParameterDraft.names : []);
                const savedOptions = activeCase.test_data_options;
                const sameNames = (left?: string[], right?: string[]) => JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
                const optionsChanged = !sameNames(options.parameter_overrides, savedOptions?.parameter_overrides)
                    || !sameNames(options.private_parameter_names, savedOptions?.private_parameter_names)
                    || overrideSharedSteps !== ((savedOptions?.override_shared_sections ?? savedOptions?.override_shared_steps) !== false);
                return {
                    ...(asEntries(values) !== asEntries(saved) ? { parameter_values: values } : {}),
                    ...(caseDataSetId !== (activeCase.test_data_set_ids?.[0] || "") ? { test_data_set_ids: caseDataSetId ? [caseDataSetId] : [] } : {}),
                    ...(optionsChanged ? { test_data_options: { ...options, override_shared_sections: overrideSharedSteps, shared_data_kind: "sections" as const } } : {})
                };
            })() : {};
            const editedSuiteParameters = canViewTestData && selectedParameterSuite && hasPermission(session, "suite.update", projectId)
                ? normalizeAutomationParameterValues(suiteParameterValues, "s") : null;
            const selectedSuiteParameterTarget = selectedParameterSuite && editedSuiteParameters
                && asEntries(editedSuiteParameters) !== asEntries(normalizeAutomationParameterValues(selectedParameterSuite.parameter_values, "s"))
                ? { id: selectedParameterSuite.id, parameterValues: editedSuiteParameters } : null;
            const response = await api.testCases.update(caseId, {
                title: caseDraft.title.trim(),
                description: caseDraft.description.trim(),
                status: caseDraft.status.trim() || "active",
                priority: Number(caseDraft.priority) || 3,
                automation_case_type: caseDraft.automationCaseType,
                ...parameterPatch,
                suite_id: suiteLinkDraftIds[0] || "",
                suite_ids: suiteLinkDraftIds,
                requirement_id: caseRequirementIds[0] || "",
                requirement_ids: caseRequirementIds,
                automated: "yes",
                manual_test_case_ids: automationManualLinkDraftIds,
                execution_hooks: mapCaseHooksToExecutionHooks(executionHookDraft),
                expected_revision: activeCase.revision
            });
            const followUps = [
                ...(activeCase.module_ids || []).filter((id) => !caseModuleIds.includes(id)).map((moduleId) => ({
                    label: `Module ${automationModules.find((item) => item.id === moduleId)?.name || moduleId} could not be unlinked.`,
                    save: () => api.testCaseModules.removeCases(moduleId, [caseId])
                })),
                ...caseModuleIds.filter((id) => !activeCase.module_ids?.includes(id)).map((moduleId) => ({
                    label: `Module ${automationModules.find((item) => item.id === moduleId)?.name || moduleId} could not be linked.`,
                    save: () => api.testCaseModules.assignCases(moduleId, [caseId], true)
                })),
                ...(selectedSuiteParameterTarget ? [{
                        label: "Suite parameter values could not be saved.",
                        save: () => api.testSuites.update(selectedSuiteParameterTarget.id, { parameter_values: selectedSuiteParameterTarget.parameterValues })
                    }] : [])
            ];
            const results = await Promise.allSettled(followUps.map((item) => item.save()));
            const followUpFailures = results.flatMap((result, index) => result.status === "rejected" ? [followUps[index].label] : []);
            return { caseId, response, followUpFailures };
        },
        onSuccess: async ({ caseId, followUpFailures }) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: automationCaseDetailQueryKey(projectId, caseId), exact: true }),
                queryClient.invalidateQueries({ queryKey: ["test-cases"] }),
                queryClient.invalidateQueries({ queryKey: ["test-case-metrics"] }),
                queryClient.invalidateQueries({ queryKey: ["test-case-modules"] }),
                queryClient.invalidateQueries({ queryKey: ["test-case-suites"] })
            ]);
            if (followUpFailures.length) {
                showError(new Error(`Case details were saved. ${followUpFailures.join(" ")} Your remaining changes are retained; save again to retry.`), "Case saved; linked records need attention.");
            }
            else
                showSuccess("Automation case updated.");
        },
        onError: (error) => showError(error, "Unable to update automation case.")
    });
    const saveAutomationHooks = useMutation({
        mutationFn: async () => {
            if (!activeCase || !isAutomationCaseDetailReady || !canUpdateAutomationCase)
                throw new Error("Wait for editable automation case details.");
            const caseId = activeCase.id;
            await api.testCases.update(caseId, { execution_hooks: mapCaseHooksToExecutionHooks(executionHookDraft), expected_revision: activeCase.revision });
            return caseId;
        },
        onSuccess: async (caseId) => { await queryClient.invalidateQueries({ queryKey: automationCaseDetailQueryKey(projectId, caseId), exact: true }); showSuccess("Before / After cases saved."); },
        onError: error => showError(error, "Unable to save Before / After cases.")
    });
    const deleteAutomationCase = useMutation({
        mutationFn: async (testCase: TestCase) => {
            if (!canRemoveAutomationCase)
                throw new Error("Permission to remove this automation case is required.");
            await api.testCases.delete(testCase.id);
            return { preservedManual: Boolean(testCase.manual_test_case_id || testCase.manual_test_case_ids?.length) };
        },
        onSuccess: ({ preservedManual }) => {
            showSuccess(preservedManual ? "Automation case removed. Its manual test case was preserved." : "Automation case deleted.");
            setSelectedCaseId("");
            undefined;
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("case");
                return next;
            }, { replace: true });
            invalidateAutomationData();
        },
        onError: (error) => showError(error, "Unable to delete automation case.")
    });
    return { updateAutomationCase, saveAutomationHooks, deleteAutomationCase, dataSettingsChanged, saveAutomationDataSettings, saveAutomationParameters, suiteParameterDraftChanged };
}
export type AutomationCaseDataActions = ReturnType<typeof useAutomationCaseDataActions>;
