import type { useDeleteConfirmation } from "@hellotest/platform/frontend/src/shared/components/DeleteConfirmationDialog";
import { buildStepBlocks } from "./testCaseWorkspaceUtils";
import type { AiStepRephraseResponse } from "@hellotest/platform/frontend/src/types";
import type { QueryClient, UseMutationResult } from '@tanstack/react-query';
import { EMPTY_STEP_DRAFT, createDraftStepId, stripAutomationStepFields } from "./testCaseWorkspaceUtils";
import { type TestCaseDraft, type StepDraft, type DraftTestStep, type CopiedTestStep, type StepInsertionGroupContext, type CutStepSource } from "./testCaseWorkspaceTypes";
import { FormEvent, useEffect } from "react";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { normalizeApiRequest, normalizeAutomationCode, normalizeStepType, stepHasAutomation } from "@hellotest/automation/frontend/lib/stepAutomation";
import type { TestCase, TestStep } from "@hellotest/platform/frontend/src/types";

export interface useCaseStepEditingInputs {
  queryClient: QueryClient;
  appTypeId: string;
  canEditAutomationCode: boolean;
  confirmDelete: ReturnType<typeof useDeleteConfirmation>["confirmDelete"];
  selectedTestCaseId: string;
  isCreating: boolean;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  setMessageTone: React.Dispatch<React.SetStateAction<"error" | "success">>;
  caseDraft: TestCaseDraft;
  newStepDraft: StepDraft;
  setNewStepDraft: React.Dispatch<React.SetStateAction<StepDraft>>;
  stepInsertIndex: number | null;
  setStepInsertIndex: React.Dispatch<React.SetStateAction<number | null>>;
  stepInsertGroupContext: StepInsertionGroupContext | null;
  setStepInsertGroupContext: React.Dispatch<React.SetStateAction<StepInsertionGroupContext | null>>;
  draftSteps: DraftTestStep[];
  setDraftSteps: React.Dispatch<React.SetStateAction<DraftTestStep[]>>;
  selectedStepIds: string[];
  setSelectedStepIds: React.Dispatch<React.SetStateAction<string[]>>;
  copiedSteps: CopiedTestStep[];
  cutStepSource: CutStepSource | null;
  setExpandedStepIds: React.Dispatch<React.SetStateAction<string[]>>;
  stepDrafts: Record<string, StepDraft>;
  setStepDrafts: React.Dispatch<React.SetStateAction<Record<string, StepDraft>>>;
  setRephrasingStepId: React.Dispatch<React.SetStateAction<string>>;
  integrationId: string;
  rephraseStepWithAi: UseMutationResult<AiStepRephraseResponse, Error, { app_type_id: string; ai_feature?: "ai.case_authoring.step_rephrase" | "ai.automation.step_rephrase"; requirement_id?: string; integration_id?: string; additional_context?: string; test_case?: { title?: string; description?: string; parameter_values?: Record<string, string>; }; step: { step_order?: number; step_type?: TestStep["step_type"]; action?: string | null; expected_result?: string | null; }; }, unknown>;
  createStep: { mutateAsync: (input: Parameters<typeof api.testSteps.create>[0]) => ReturnType<typeof api.testSteps.create> };
  updateStep: UseMutationResult<{ updated: boolean; }, Error, { id: string; input: Parameters<typeof api.testSteps.update>[1]; }, unknown>;
  reorderSteps: UseMutationResult<{ reordered: boolean; }, Error, { testCaseId: string; stepIds: string[]; }, unknown>;
  deleteStep: UseMutationResult<{ deleted: boolean; }, Error, string, unknown>;
  steps: TestStep[];
  displaySteps: TestStep[];
  showSuccess: (text: string) => void;
  showError: (error: unknown, fallback: string) => void;
  selectedTestCase: TestCase | null;
  visibleTestCaseParameterValues: Record<string, string>;
  refreshSharedGroups: () => Promise<void>;
  resolveStepInsertIndex: (items: Array<{ id: string; }>) => number;
  getInsertionGroupContext: (items: Array<Pick<TestStep, "group_id" | "group_name" | "group_kind" | "reusable_group_id">>, insertionIndex: number) => { group_id: string | null; group_name: string | null; group_kind: "local" | "reusable" | null; reusable_group_id: string | null; } | null;
  cancelStepInsert: () => void;
  handleSaveCaseAndSteps: (stepOverrides?: Record<string, StepDraft>, successMessage?: string) => Promise<boolean>;
}

export function useCaseStepEditing({ queryClient, appTypeId, canEditAutomationCode, confirmDelete, selectedTestCaseId, isCreating, setMessage, setMessageTone, caseDraft, newStepDraft, setNewStepDraft, stepInsertIndex, setStepInsertIndex, stepInsertGroupContext, setStepInsertGroupContext, draftSteps, setDraftSteps, selectedStepIds, setSelectedStepIds, copiedSteps, cutStepSource, setExpandedStepIds, stepDrafts, setStepDrafts, setRephrasingStepId, integrationId, rephraseStepWithAi, createStep, updateStep, reorderSteps, deleteStep, steps, displaySteps, showSuccess, showError, selectedTestCase, visibleTestCaseParameterValues, refreshSharedGroups, resolveStepInsertIndex, getInsertionGroupContext, cancelStepInsert, handleSaveCaseAndSteps }: useCaseStepEditingInputs) {
const handleCreateStep = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedDraft = {
      action: newStepDraft.action.trim(),
      expected_result: newStepDraft.expected_result.trim(),
      step_type: normalizeStepType(newStepDraft.step_type),
      automation_code: normalizeAutomationCode(newStepDraft.automation_code),
      api_request: normalizeApiRequest(newStepDraft.api_request)
    };

    if (!normalizedDraft.action && !normalizedDraft.expected_result) {
      setMessageTone("error");
      setMessage("Add an action or expected result before creating a step.");
      return;
    }

    if (isCreating) {
      const draftId = createDraftStepId();
      const insertionIndex = resolveStepInsertIndex(draftSteps);
      const insertionGroupContext =
        stepInsertIndex !== null && stepInsertGroupContext
          ? stepInsertGroupContext
          : getInsertionGroupContext(displaySteps, insertionIndex);

      setDraftSteps((current) => {
        const next = [...current];
        next.splice(insertionIndex, 0, {
          id: draftId,
          ...normalizedDraft,
          group_id: insertionGroupContext?.group_id || null,
          group_name: insertionGroupContext?.group_name || null,
          group_kind: insertionGroupContext?.group_kind || null,
          reusable_group_id: insertionGroupContext?.reusable_group_id || null
        });
        return next;
      });
      setExpandedStepIds((current) => [...new Set([...current, draftId])]);
      setNewStepDraft(EMPTY_STEP_DRAFT);
      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      showSuccess("Draft step added to the new test case.");
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      const insertionIndex = resolveStepInsertIndex(steps);
      const insertionGroupContext =
        stepInsertIndex !== null && stepInsertGroupContext
          ? stepInsertGroupContext
          : getInsertionGroupContext(displaySteps, insertionIndex);
      const nextStepOrder = insertionIndex + 1;
      const stepInput = {
        test_case_id: selectedTestCaseId,
        step_order: nextStepOrder,
        action: normalizedDraft.action || undefined,
        expected_result: normalizedDraft.expected_result || undefined,
        step_type: normalizedDraft.step_type,
        automation_code: normalizedDraft.automation_code || undefined,
        api_request: normalizedDraft.api_request || undefined,
        group_id: insertionGroupContext?.group_id || undefined,
        group_name: insertionGroupContext?.group_name || undefined,
        group_kind: insertionGroupContext?.group_kind || undefined,
        reusable_group_id: insertionGroupContext?.reusable_group_id || undefined
      };
      const response = await createStep.mutateAsync(
        canEditAutomationCode ? stepInput : stripAutomationStepFields(stepInput)
      );
      setNewStepDraft(EMPTY_STEP_DRAFT);
      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      setExpandedStepIds((current) => [...new Set([...current, response.id])]);
      showSuccess("Step added.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (insertionGroupContext?.reusable_group_id) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to add step");
    }
  };

useEffect(() => {
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
  }, [isCreating, selectedTestCaseId]);

const handleUpdateStep = async (step: TestStep, input: StepDraft) => {
    const normalizedInput = {
      action: input.action,
      expected_result: input.expected_result,
      step_type: normalizeStepType(input.step_type),
      automation_code: normalizeAutomationCode(input.automation_code),
      api_request: normalizeApiRequest(input.api_request)
    };

    setStepDrafts((current) => ({
      ...current,
      [step.id]: normalizedInput
    }));
    await handleSaveCaseAndSteps({ [step.id]: normalizedInput }, "Test case and step edits saved.");
  };

const handleReorderStep = async (stepId: string, direction: "up" | "down") => {
    if (!selectedTestCaseId) {
      return;
    }

    const currentIndex = steps.findIndex((step) => step.id === stepId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= steps.length) {
      return;
    }

    const currentStep = steps[currentIndex];
    const targetStep = steps[targetIndex];

    let reordered: TestStep[] = [];

    if (currentStep.group_id) {
      if (targetStep.group_id !== currentStep.group_id) {
        return;
      }

      reordered = [...steps];
      const [movedStep] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, movedStep);
    } else {
      const blocks = buildStepBlocks(steps);
      const blockIndex = blocks.findIndex((block) => block.steps.some((step) => step.id === stepId));
      const swapIndex = direction === "up" ? blockIndex - 1 : blockIndex + 1;

      if (blockIndex === -1 || swapIndex < 0 || swapIndex >= blocks.length) {
        return;
      }

      const reorderedBlocks = [...blocks];
      const [movedBlock] = reorderedBlocks.splice(blockIndex, 1);
      reorderedBlocks.splice(swapIndex, 0, movedBlock);
      const newOrderIds = reorderedBlocks.flatMap((block) => block.steps.map((step) => step.id));
      const stepById = new Map(steps.map((step) => [step.id, step]));
      reordered = newOrderIds.map((id) => stepById.get(id)).filter(Boolean) as TestStep[];
    }

    try {
      await reorderSteps.mutateAsync({
        testCaseId: selectedTestCaseId,
        stepIds: reordered.map((step) => step.id)
      });
      showSuccess("Step order updated.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (currentStep.reusable_group_id) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to reorder steps");
    }
  };

const handleMoveStepGroup = async (groupId: string, direction: "up" | "down") => {
    if (!groupId) {
      return;
    }

    const items = displaySteps;
    const blocks = buildStepBlocks(items);
    const blockIndex = blocks.findIndex((block) => block.group_id === groupId);
    const swapIndex = direction === "up" ? blockIndex - 1 : blockIndex + 1;

    if (blockIndex === -1 || swapIndex < 0 || swapIndex >= blocks.length) {
      return;
    }

    const reorderedBlocks = [...blocks];
    const [movedBlock] = reorderedBlocks.splice(blockIndex, 1);
    reorderedBlocks.splice(swapIndex, 0, movedBlock);
    const newOrderIds = reorderedBlocks.flatMap((block) => block.steps.map((step) => step.id));

    if (isCreating) {
      setDraftSteps((current) => {
        const stepById = new Map(current.map((step) => [step.id, step]));
        return newOrderIds.map((id) => stepById.get(id)).filter(Boolean) as DraftTestStep[];
      });
      showSuccess("Step group order updated.");
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      await reorderSteps.mutateAsync({
        testCaseId: selectedTestCaseId,
        stepIds: newOrderIds
      });
      showSuccess("Step group order updated.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      showError(error, "Unable to move step group");
    }
  };

const handleDeleteStep = async (stepId: string) => {
    const targetStep = displaySteps.find((step) => step.id === stepId) || null;

    if (!isCreating && targetStep && stepHasAutomation(targetStep) && !canEditAutomationCode) {
      showError(new Error("Automation build and code access are required to delete an automated step."), "Unable to delete step");
      return;
    }

    if (isCreating) {
      setDraftSteps((current) => current.filter((step) => step.id !== stepId));
      if (copiedSteps.length || cutStepSource?.stepIds.length) {
        setSelectedStepIds([]);
      } else {
        setSelectedStepIds((current) => current.filter((id) => id !== stepId));
      }
      setExpandedStepIds((current) => current.filter((id) => id !== stepId));
      showSuccess("Draft step removed.");
      return;
    }

    if (!(await confirmDelete({ message: "Delete this step?" }))) {
      return;
    }

    try {
      await deleteStep.mutateAsync(stepId);
      if (copiedSteps.length || cutStepSource?.stepIds.length) {
        setSelectedStepIds([]);
      } else {
        setSelectedStepIds((current) => current.filter((id) => id !== stepId));
      }
      setExpandedStepIds((current) => current.filter((id) => id !== stepId));
      showSuccess("Step deleted.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (targetStep?.reusable_group_id) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to delete step");
    }
  };

const handleDeleteSelectedSteps = async () => {
    const targetIds = selectedStepIds.filter((id) => displaySteps.some((step) => step.id === id));

    if (!targetIds.length) {
      showError(new Error("Select one or more steps to delete."), "Unable to delete selected steps");
      return;
    }

    const targetSteps = displaySteps.filter((step) => targetIds.includes(step.id));
    if (!isCreating && targetSteps.some((step) => stepHasAutomation(step)) && !canEditAutomationCode) {
      showError(new Error("Automation build and code access are required to delete automated steps."), "Unable to delete selected steps");
      return;
    }

    const countLabel = `${targetIds.length} selected step${targetIds.length === 1 ? "" : "s"}`;

    if (!(await confirmDelete({ message: `Delete ${countLabel}?` }))) {
      return;
    }

    if (isCreating) {
      setDraftSteps((current) => current.filter((step) => !targetIds.includes(step.id)));
      setSelectedStepIds([]);
      setExpandedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      cancelStepInsert();
      showSuccess(`${countLabel} deleted.`);
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      await api.testSteps.deleteMany({ test_case_id: selectedTestCaseId, step_ids: targetIds });

      setSelectedStepIds([]);
      setExpandedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      cancelStepInsert();
      showSuccess(`${countLabel} deleted.`);
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (targetSteps.some((step) => step.reusable_group_id)) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to delete selected steps");
    }
  };

const handleUpdateDraftStep = (stepId: string, input: StepDraft) => {
    setDraftSteps((current) =>
      current.map((step) =>
        step.id === stepId
          ? {
              ...step,
              action: input.action,
              expected_result: input.expected_result,
              step_type: normalizeStepType(input.step_type),
              automation_code: normalizeAutomationCode(input.automation_code),
              api_request: normalizeApiRequest(input.api_request)
            }
          : step
      )
    );
  };

const handleRephraseStepWithAi = async (step: TestStep) => {
    if (!appTypeId) {
      showError(new Error("Select an app type before asking AI to rephrase a step."), "Unable to rephrase step");
      return;
    }

    const currentDraft = stepDrafts[step.id] || {
      action: step.action || "",
      expected_result: step.expected_result || "",
      step_type: normalizeStepType(step.step_type),
      automation_code: normalizeAutomationCode(step.automation_code),
      api_request: normalizeApiRequest(step.api_request)
    };

    if (!currentDraft.action.trim() && !currentDraft.expected_result.trim()) {
      showError(new Error("Write an action or expected result before asking AI to rephrase this step."), "Unable to rephrase step");
      return;
    }

    setRephrasingStepId(step.id);

    try {
      const response = await rephraseStepWithAi.mutateAsync({
        app_type_id: appTypeId,
        requirement_id: caseDraft.requirement_id || undefined,
        integration_id: integrationId || undefined,
        test_case: {
          title: caseDraft.title || selectedTestCase?.title || "",
          description: caseDraft.description || selectedTestCase?.description || "",
          parameter_values: visibleTestCaseParameterValues
        },
        step: {
          step_order: step.step_order,
          step_type: normalizeStepType(currentDraft.step_type || step.step_type),
          action: currentDraft.action,
          expected_result: currentDraft.expected_result
        }
      });
      const nextDraft: StepDraft = {
        ...currentDraft,
        action: response.step.action || "",
        expected_result: response.step.expected_result || "",
        step_type: normalizeStepType(response.step.step_type || currentDraft.step_type)
      };

      if (isCreating) {
        handleUpdateDraftStep(step.id, nextDraft);
      } else {
        await updateStep.mutateAsync({
          id: step.id,
          input: {
            action: nextDraft.action,
            expected_result: nextDraft.expected_result,
            step_type: nextDraft.step_type
          }
        });
        setStepDrafts((current) => ({
          ...current,
          [step.id]: nextDraft
        }));
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
        if (step.reusable_group_id) {
          await refreshSharedGroups();
        }
      }

      showSuccess(`Step ${step.step_order} rephrased with AI.`);
    } catch (error) {
      showError(error, "Unable to rephrase step");
    } finally {
      setRephrasingStepId("");
    }
  };

return { handleCreateStep, handleUpdateStep, handleReorderStep, handleMoveStepGroup, handleDeleteStep, handleDeleteSelectedSteps, handleUpdateDraftStep, handleRephraseStepWithAi };
}
