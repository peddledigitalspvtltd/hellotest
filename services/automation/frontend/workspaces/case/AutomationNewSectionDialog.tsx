import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@hellotest/platform/frontend/src/lib/api';
import { AddIcon } from '@hellotest/platform/frontend/src/platform/components/AppIcons';
import { richTextToPlainText } from '@hellotest/platform/frontend/src/platform/components/RichTextEditor';
import { GherkinStepTextField } from '@hellotest/testing/frontend/components/GherkinStepTextField';
import type { TestStep, TestStepType } from '@hellotest/platform/frontend/src/types';
import { AutomationOverlay } from '../../components/AutomationOverlay';
import { emptyAutomationStepDraft, buildAutomationStepAction, buildAutomationApiRequest, buildAutomationCodeFromDraft } from '../../lib/automationStepDraft';
import { automationMappingIsComplete, isAutomationPrecondition } from '../../lib/automationPlan';
import { cacheCreatedAutomationStep, getAutomationStepInsertion, isAutomationStepMapped, refreshCreatedAutomationStep } from '../../lib/automationStepPersistence';
import { getDefaultAutomationStepType } from '../../lib/automationRuntime';
import { automationQueryKeys } from '../../lib/automationQueryKeys';
import type { AutomationCaseDetailController } from './useAutomationCaseDetailController';
export type NewSectionRequest={precondition:boolean;placement:Parameters<typeof getAutomationStepInsertion>[1]};
type Ports=Pick<AutomationCaseDetailController,'activeCase'|'automatedSteps'|'allowedStepTypes'|'activeAutomationCaseType'|'canEditAutomationCode'|'queryClient'|'currentAutomationSelectionRef'|'syncAutomationStepDrafts'|'caseSelection'|'refreshAutomationStepAfterSave'|'showSuccess'|'showError'|'detectedStepParameters'|'mergedParameterValues'>;
export function AutomationNewSectionDialog({request,onClose,...ports}:Ports&{request:NewSectionRequest;onClose:()=>void}){
const {automatedSteps, activeAutomationCaseType, allowedStepTypes, canEditAutomationCode, activeCase, queryClient, currentAutomationSelectionRef, syncAutomationStepDrafts, caseSelection, refreshAutomationStepAfterSave, showError, showSuccess, detectedStepParameters, mergedParameterValues}=ports;
const [newStepIsPrecondition,setNewStepIsPrecondition]=useState(request.precondition);
const [newStepPlacement,setNewStepPlacement]=useState(request.placement);
const [newStepDraft,setNewStepDraft]=useState(()=>{const type=getDefaultAutomationStepType(automatedSteps,activeAutomationCaseType);return emptyAutomationStepDraft(allowedStepTypes.includes(type)?type:allowedStepTypes[0]||type);});
const target=newStepPlacement.mode!=='end'?automatedSteps.find(step=>step.id===newStepPlacement.stepId):null;
const newStepPlacementLabel=target?`${newStepPlacement.mode==='before'?'Insert before':'Add after'} ${target.group_name||target.action||`step ${target.step_order}`}`:'';
    const createAutomationStep = useMutation({
        mutationFn: async () => {
            if (!canEditAutomationCode)
                throw new Error("Permission required: automation.build and automation.code.view");
            if (!activeCase)
                throw new Error("Select an automation case first.");
            if (newStepIsPrecondition && automatedSteps.some(isAutomationPrecondition))
                throw new Error("Edit the existing precondition section to add setup instructions.");
            if (!newStepDraft.name.trim() && !automationMappingIsComplete(newStepDraft))
                throw new Error("Describe the step before adding it.");
            const hasMapping = automationMappingIsComplete(newStepDraft);
            const automation_code = hasMapping ? buildAutomationCodeFromDraft(newStepDraft) : "";
            const { insertionIndex, groupSource } = getAutomationStepInsertion(automatedSteps, newStepPlacement, newStepIsPrecondition);
            const groupId = newStepIsPrecondition ? groupSource?.group_id || `preconditions-${crypto.randomUUID()}` : groupSource?.group_id || undefined;
            const input = {
                test_case_id: activeCase.id,
                step_order: insertionIndex + 1,
                action: buildAutomationStepAction(newStepDraft),
                expected_result: newStepDraft.expected_result,
                step_type: newStepDraft.step_type,
                automation_code,
                api_request: hasMapping ? buildAutomationApiRequest(newStepDraft) || undefined : undefined,
                group_id: groupId,
                group_name: newStepIsPrecondition ? "Preconditions" : groupSource?.group_name || undefined,
                group_kind: groupId ? groupSource?.group_kind || "local" as const : undefined,
                reusable_group_id: groupId ? groupSource?.reusable_group_id || undefined : undefined
            };
            const created = await api.testSteps.create(input);
            return { created: { ...input, id: created.id }, previousSteps: automatedSteps };
        },
        onSuccess: async ({ created, previousSteps }) => {
            // Creation has committed. Keep its ID and clear this submission before
            // any reload or readiness update can fail and suggest another insertion.
            queryClient.setQueryData<TestStep[]>(automationQueryKeys.steps(created.test_case_id), (cached) => cacheCreatedAutomationStep(cached || previousSteps, created));
            if (currentAutomationSelectionRef.current.selectedCaseId === created.test_case_id) {
                syncAutomationStepDrafts(created);
                caseSelection.expandSteps([created.id]);
                setNewStepDraft(emptyAutomationStepDraft(created.step_type));
                setNewStepIsPrecondition(false);
                onClose();
                setNewStepPlacement({ mode: "end", stepId: "" });
            }
            const result = await refreshCreatedAutomationStep(created, (saved) => refreshAutomationStepAfterSave(saved.test_case_id, saved.id));
            if (result.refreshError) {
                queryClient.setQueryData<TestStep[]>(automationQueryKeys.steps(created.test_case_id), (cached) => cacheCreatedAutomationStep(cached || previousSteps, created));
                const detail = result.refreshError instanceof Error ? result.refreshError.message : "The saved plan could not be refreshed.";
                showError(new Error(`The section was added. Its plan refresh or readiness update failed: ${detail} Reopen this case to refresh the saved section.`), "Section saved; refresh needs attention.");
            }
            else {
                showSuccess(isAutomationStepMapped(result.step) ? "Automation section added." : "Section added. Select its keyword and inputs to map automation.");
            }
            void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
        },
        onError: (error) => showError(error, "Unable to add automation step.")
    });
return <AutomationOverlay title={newStepIsPrecondition ? "Add precondition" : "Add section"} subtitle={newStepPlacementLabel ? richTextToPlainText(newStepPlacementLabel) : "Describe the action and expected outcome."} icon={<AddIcon size={20}/>} closeDisabled={createAutomationStep.isPending} onClose={onClose} variant="dialog"><section className="automation-new-section" id="automation-new-step-composer" aria-label="Add plan section">
                      <div className="automation-plan-heading"><strong>{newStepIsPrecondition ? "New precondition" : "New section"}</strong><select aria-label="New step section" onChange={(event) => { setNewStepIsPrecondition(event.target.value === "precondition"); setNewStepPlacement({ mode: "end", stepId: "" }); }} value={newStepIsPrecondition ? "precondition" : "step"}><option value="step">Test section</option><option value="precondition" disabled={automatedSteps.some(isAutomationPrecondition)}>Precondition</option></select></div>
                      {newStepPlacementLabel ? <span className="muted">{richTextToPlainText(newStepPlacementLabel)} <button className="ghost-button compact" onClick={() => setNewStepPlacement({ mode: "end", stepId: "" })} type="button">Reset placement</button></span> : null}
                      <div className="automation-plan-behavior-fields"><label className="form-field"><span>Section name</span><GherkinStepTextField ariaLabel="New step action" availableParameters={detectedStepParameters} parameterValues={mergedParameterValues} onChange={(name) => setNewStepDraft((current) => ({ ...current, name }))} placeholder="For example, sign in with valid credentials" value={newStepDraft.name}/></label><label className="form-field"><span>Expected result</span><GherkinStepTextField ariaLabel="New step expected result" availableParameters={detectedStepParameters} parameterValues={mergedParameterValues} onChange={(expected_result) => setNewStepDraft((current) => ({ ...current, expected_result }))} placeholder="Describe the outcome" value={newStepDraft.expected_result}/></label></div>
                      <div className="automation-plan-actions"><select aria-label="New step type" onChange={(event) => setNewStepDraft((current) => ({ ...emptyAutomationStepDraft(event.target.value as TestStepType), name: current.name, expected_result: current.expected_result }))} value={newStepDraft.step_type}>{allowedStepTypes.map((type) => <option key={type} value={type}>{type.toUpperCase()}</option>)}</select><button className="primary-button compact" disabled={!newStepDraft.name.trim() || createAutomationStep.isPending} onClick={() => createAutomationStep.mutate()} type="button"><AddIcon size={14}/>{createAutomationStep.isPending ? "Adding…" : newStepIsPrecondition ? "Add precondition" : "Add section"}</button></div>
                    </section></AutomationOverlay>;
}
