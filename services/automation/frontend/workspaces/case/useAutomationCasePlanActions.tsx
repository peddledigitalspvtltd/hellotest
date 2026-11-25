import { parseAutomationStepDraft, buildAutomationStepAction, buildAutomationApiRequest, buildAutomationCodeFromDraft } from "../../lib/automationStepDraft";
import { parseApiRequestDraftSource } from "../../lib/apiRequestSource";
import { applyAutomationStepOptions, parseAutomationStepOptions } from "../../lib/automationStepOptions";
import { useMutation } from "@tanstack/react-query";
import { automationMappingIsComplete } from "../../lib/automationPlan";
import { automationCaseMappingStatus, automationMappingFieldsEqual, isAutomationStepMapped, resolveAutomationMappingSave, getAutomationStepReorder } from "../../lib/automationStepPersistence";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { excludeSensitiveStepParameterValues } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import type { StepApiRequest, TestStep, TestStepType } from "@hellotest/platform/frontend/src/types";
import type { AutomationCaseScope } from './useAutomationCaseScope';
import type { AutomationCaseState } from './useAutomationCaseState';
import type { AutomationCaseModel } from './useAutomationCaseModel';
import type { AutomationCaseServices } from './useAutomationCaseServices';
export function useAutomationCasePlanActions(input: AutomationCaseScope & AutomationCaseState & AutomationCaseModel & AutomationCaseServices) {
    const {activeCase, sectionGroupDialog, automationGroupName, saveAutomationGroupAsShared, setSectionGroupDialog, caseSelection, setAutomationGroupName, setSaveAutomationGroupAsShared, showSuccess, queryClient, showError, automatedSteps, setIsSharedGroupLibraryOpen, canEditAutomationCode, automationDraftStore, refreshAutomationStepAfterSave, syncAutomationStepDrafts, setApiSourceDrafts, setAutomationStudioStep, canUseAutomationAi, appTypeId, agentMission, testCaseParameterValues, visiblePrivateNames, sectionClipboard, projectId, unsavedAutomationStepIds, setStepDrafts, setStepCodeDrafts, setStepOptionDrafts} = input;
    const groupAutomationSteps = useMutation({
        mutationFn: async () => {
            if (!activeCase || !sectionGroupDialog?.stepIds.length)
                throw new Error("Select automation sections first.");
            return api.testSteps.group({ test_case_id: activeCase.id, step_ids: sectionGroupDialog.stepIds,
                name: automationGroupName.trim(), group_id: sectionGroupDialog.groupId,
                kind: saveAutomationGroupAsShared ? "reusable" : "local", create_shared_group: saveAutomationGroupAsShared });
        },
        onSuccess: () => {
            setSectionGroupDialog(null);
            caseSelection.selectSteps([]);
            setAutomationGroupName("");
            setSaveAutomationGroupAsShared(false);
            showSuccess("Automation sections grouped successfully.");
            void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
            void queryClient.invalidateQueries({ queryKey: ["shared-step-groups"] });
        },
        onError: error => showError(error, "Unable to group automation sections.")
    });
    const ungroupAutomationSteps = useMutation({
        mutationFn: (groupId: string) => {
            if (!activeCase)
                throw new Error("Select an automation case first.");
            return api.testSteps.ungroup({ test_case_id: activeCase.id, group_id: groupId });
        },
        onSuccess: () => {
            setSectionGroupDialog(null);
            showSuccess("Group removed; its automation sections remain in place.");
            void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
        },
        onError: (error) => showError(error, "Unable to ungroup automation steps.")
    });
    const insertAutomationSharedGroup = useMutation({
        mutationFn: (sharedGroupId: string) => {
            if (!activeCase)
                throw new Error("Select an automation case first.");
            return api.testSteps.insertSharedGroup({
                test_case_id: activeCase.id,
                shared_step_group_id: sharedGroupId,
                insert_after_step_id: automatedSteps[automatedSteps.length - 1]?.id
            });
        },
        onSuccess: () => {
            setIsSharedGroupLibraryOpen(false);
            showSuccess("Shared Section Group inserted.");
            void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
        },
        onError: (error) => showError(error, "Unable to insert the Shared Section Group.")
    });
    const updateAutomationStep = useMutation({
        mutationFn: async (step: TestStep) => {
            if (!canEditAutomationCode)
                throw new Error("Permission required: automation.build and automation.code.view");
            const draft = automationDraftStore.read("steps")[step.id] || parseAutomationStepDraft(step);
            const existingDraft = parseAutomationStepDraft(step);
            const mappingUnchanged = automationMappingFieldsEqual(draft, existingDraft);
            const savedOptions = parseAutomationStepOptions(step);
            const options = automationDraftStore.read("options")[step.id] || savedOptions;
            const optionsUnchanged = JSON.stringify(options) === JSON.stringify(savedOptions);
            const currentCode = automationDraftStore.read("code")[step.id] ?? step.automation_code ?? "";
            const mappingSave = resolveAutomationMappingSave({ currentCode, previousMappingCode: buildAutomationCodeFromDraft(existingDraft), nextMappingCode: automationMappingIsComplete(draft) ? buildAutomationCodeFromDraft(draft) : "", mappingUnchanged });
            if (mappingSave.requiresProgramEditor)
                throw new Error("Use Edit instructions or Source to change this recorded or custom program. Its existing instructions have been preserved.");
            const authoredCode = mappingSave.code;
            const automation_code = !authoredCode.trim() ? "" : mappingUnchanged && optionsUnchanged ? authoredCode : applyAutomationStepOptions(authoredCode, options);
            await api.testSteps.update(step.id, {
                action: buildAutomationStepAction({ ...draft, name: draft.name.trim() || step.action || "" }),
                expected_result: draft.expected_result,
                step_type: draft.step_type,
                automation_code,
                api_request: mappingUnchanged ? step.api_request : automationMappingIsComplete(draft) ? buildAutomationApiRequest(draft, step.api_request) : null
            });
            return refreshAutomationStepAfterSave(step.test_case_id, step.id);
        },
        onSuccess: (updated) => {
            syncAutomationStepDrafts(updated);
            showSuccess("Automation step updated.");
            void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
        },
        onError: (error) => showError(error, "Unable to update automation step.")
    });
    const updateAutomationStepCode = useMutation({
        mutationFn: async (step: TestStep) => {
            if (!canEditAutomationCode)
                throw new Error("Permission required: automation.build and automation.code.view");
            if (step.step_type === "api") {
                const source = automationDraftStore.read("api")[step.id];
                const draft = automationDraftStore.read("steps")[step.id] || parseAutomationStepDraft(step);
                const savedOptions = parseAutomationStepOptions(step);
                const options = automationDraftStore.read("options")[step.id] || savedOptions;
                await api.testSteps.update(step.id, { action: buildAutomationStepAction(draft), expected_result: draft.expected_result,
                    ...(source !== undefined ? { api_request: parseApiRequestDraftSource(source) } : {}),
                    ...(JSON.stringify(options) !== JSON.stringify(savedOptions) ? { automation_code: applyAutomationStepOptions(step.automation_code || "", options) } : {}) });
                setApiSourceDrafts((current) => { const next = { ...current }; delete next[step.id]; return next; });
                return refreshAutomationStepAfterSave(step.test_case_id, step.id);
            }
            const code = (automationDraftStore.read("code")[step.id] ?? step.automation_code ?? "").trim();
            const codeChanged = code !== (step.automation_code || "").trim();
            const automation_code = code ? applyAutomationStepOptions(code, automationDraftStore.read("options")[step.id] || parseAutomationStepOptions(step)) : "";
            const draft = automationDraftStore.read("steps")[step.id] || parseAutomationStepDraft(step);
            await api.testSteps.update(step.id, {
                action: buildAutomationStepAction(draft),
                expected_result: draft.expected_result,
                automation_code,
                ...(codeChanged ? { api_request: null } : {})
            });
            return refreshAutomationStepAfterSave(step.test_case_id, step.id);
        },
        onSuccess: (updated) => {
            syncAutomationStepDrafts(updated);
            showSuccess("Automation code updated.");
            void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
        },
        onError: (error) => showError(error, "Unable to update automation code.")
    });
    const saveAutomationStudioStep = useMutation({
        mutationFn: async ({ step, input }: {
            step: TestStep;
            input: {
                step_type: TestStepType;
                automation_code: string;
                api_request: StepApiRequest | null;
            };
        }) => {
            if (!canEditAutomationCode)
                throw new Error("Permission required: automation.build and automation.code.view");
            const draft = automationDraftStore.read("steps")[step.id] || parseAutomationStepDraft(step);
            await api.testSteps.update(step.id, {
                ...input,
                action: buildAutomationStepAction(draft),
                expected_result: draft.expected_result
            });
            return refreshAutomationStepAfterSave(step.test_case_id, step.id);
        },
        onSuccess: (updated) => {
            syncAutomationStepDrafts(updated);
            setAutomationStudioStep(null);
            showSuccess(isAutomationStepMapped(updated) ? "Step automation saved." : "Step saved without an executable mapping.");
            void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
        },
        onError: (error) => showError(error, "Unable to save automation step.")
    });
    const rephraseAutomationStep = useMutation({
        mutationFn: async (step: TestStep) => {
            if (!canEditAutomationCode) {
                throw new Error("Permission required: automation.build and automation.code.view");
            }
            if (!canUseAutomationAi) {
                throw new Error("Permission required: automation.ai");
            }
            if (!appTypeId || !activeCase) {
                throw new Error("Select an automation case before using step AI.");
            }
            const response = await api.testCases.rephraseStep({
                app_type_id: appTypeId,
                requirement_id: activeCase.requirement_id || undefined,
                ai_feature: "ai.automation.step_rephrase",
                additional_context: agentMission || undefined,
                test_case: {
                    title: activeCase.title,
                    description: activeCase.description || "",
                    parameter_values: excludeSensitiveStepParameterValues(testCaseParameterValues, visiblePrivateNames)
                },
                step: {
                    step_order: step.step_order,
                    step_type: step.step_type,
                    action: step.action,
                    expected_result: step.expected_result
                }
            });
            await api.testSteps.update(step.id, {
                action: response.step.action || step.action || "",
                expected_result: response.step.expected_result || step.expected_result || ""
            });
            return refreshAutomationStepAfterSave(step.test_case_id, step.id);
        },
        onSuccess: (updated) => {
            syncAutomationStepDrafts(updated);
            showSuccess("AI improved the automation step text.");
            void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
        },
        onError: (error) => showError(error, "Unable to improve automation step.")
    });
    const reorderAutomationStep = useMutation({
        mutationFn: ({ stepId, direction }: {
            stepId: string;
            direction: "up" | "down";
        }) => {
            if (!activeCase)
                throw new Error("Select an automation case first.");
            const order = getAutomationStepReorder(automatedSteps, stepId, direction);
            if (!order)
                throw new Error("This section cannot move further within its flow.");
            return api.testSteps.reorder(activeCase.id, order.stepIds);
        },
        onSuccess: () => {
            showSuccess("Automation steps reordered.");
            void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
        },
        onError: (error) => showError(error, "Unable to reorder automation step.")
    });
    const pasteAutomationSections = useMutation({
        mutationFn: async (afterId?: string) => {
            if (!canEditAutomationCode || !activeCase || !sectionClipboard || sectionClipboard.projectId !== projectId || sectionClipboard.appTypeId !== appTypeId)
                throw new Error("Copy sections within the same application first.");
            if (unsavedAutomationStepIds.length)
                throw new Error("Save section changes before pasting.");
            return api.testSteps.duplicate({ test_case_id: activeCase.id, source_test_case_id: sectionClipboard.caseId, step_ids: sectionClipboard.ids, as_standalone: sectionClipboard.standalone, insert_after_step_id: afterId || automatedSteps[automatedSteps.length - 1]?.id });
        }, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["test-steps"] }); void queryClient.invalidateQueries({ queryKey: ["test-cases"] }); showSuccess("Sections pasted."); }, onError: error => showError(error, "Unable to paste sections.")
    });
    const deleteAutomationStep = useMutation({
        mutationFn: async (step: TestStep) => {
            if (!canEditAutomationCode)
                throw new Error("Permission required: automation.build and automation.code.view");
            await api.testSteps.update(step.id, { automation_code: "", api_request: null });
            return refreshAutomationStepAfterSave(step.test_case_id, step.id);
        },
        onSuccess: (updated) => {
            syncAutomationStepDrafts(updated);
            showSuccess("Automation removed from the step; its description and group are preserved.");
            void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
        },
        onError: (error) => showError(error, "Unable to remove automation from step.")
    });
    const removeAutomationPlanStep = useMutation({
        mutationFn: async (step: TestStep) => {
            if (!canEditAutomationCode)
                throw new Error("Permission required: automation.build and automation.code.view");
            if (step.group_id && step.reusable_group_id) {
                const siblings = await api.testSteps.list({ test_case_id: step.test_case_id });
                // Removing one member makes this instance a local variation. Keep the
                // reusable definition and the linked manual plan intact.
                await api.testSteps.group({
                    test_case_id: step.test_case_id,
                    step_ids: siblings.filter((candidate) => candidate.group_id === step.group_id).map((candidate) => candidate.id),
                    group_id: step.group_id,
                    name: step.group_name || "Step group",
                    kind: "local"
                });
            }
            await api.testSteps.delete(step.id);
            const steps = await api.testSteps.list({ test_case_id: step.test_case_id });
            queryClient.setQueryData(["test-steps", "automation-workspace", step.test_case_id], steps);
            await api.testCases.update(step.test_case_id, { automated: "yes", automation_status: automationCaseMappingStatus(steps) });
            return step.id;
        },
        onSuccess: (stepId) => {
            setStepDrafts((current) => { const next = { ...current }; delete next[stepId]; return next; });
            setStepCodeDrafts((current) => { const next = { ...current }; delete next[stepId]; return next; });
            setStepOptionDrafts((current) => { const next = { ...current }; delete next[stepId]; return next; });
            caseSelection.expandSteps(caseSelection.state.expandedStepIds.filter(id=>id!==stepId));
            caseSelection.selectSteps(caseSelection.state.stepIds.filter(id=>id!==stepId));
            setAutomationStudioStep((current) => current?.id === stepId ? null : current);
            showSuccess("Step removed from the automation plan.");
            void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
        },
        onError: (error) => showError(error, "Unable to remove the plan step.")
    });
    return { groupAutomationSteps, ungroupAutomationSteps, insertAutomationSharedGroup, updateAutomationStep, updateAutomationStepCode, saveAutomationStudioStep, rephraseAutomationStep, reorderAutomationStep, pasteAutomationSections, deleteAutomationStep, removeAutomationPlanStep };
}
export type AutomationCasePlanActions = ReturnType<typeof useAutomationCasePlanActions>;
