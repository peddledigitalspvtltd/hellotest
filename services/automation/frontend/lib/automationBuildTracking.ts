/** Replace untouched drafts with generated output while retaining concurrent edits. */
export function mergeRefreshedAutomationDrafts<T>(
  current: Record<string, T>,
  baseline: Record<string, T>,
  refreshed: Record<string, T>
): Record<string, T> {
  return Object.fromEntries(Object.entries(refreshed).map(([id, value]) => [
    id,
    Object.prototype.hasOwnProperty.call(current, id) && JSON.stringify(current[id]) !== JSON.stringify(baseline[id])
      ? current[id]
      : value
  ]));
}

/** Only a durable save receipt refreshes Plan. A validated preview is still a draft. */
export function automationSavedPlanReceipt(metadata: Record<string, unknown>, currentCaseId: string) {
  const outputs = Array.isArray(metadata.output_test_case_ids) ? metadata.output_test_case_ids.filter((value): value is string => typeof value === "string") : [];
  const savedSteps = Array.isArray(metadata.step_progress) ? metadata.step_progress.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)))
    .filter(step => step.instruction_status === "saved" && typeof step.test_case_id === "string") : [];
  const caseIds = [...new Set([...outputs, ...savedSteps.map(step => String(step.test_case_id))])];
  const caseId = caseIds.includes(currentCaseId) ? currentCaseId : "";
  const saved = savedSteps.filter(step => step.test_case_id === caseId).map(step => [step.step_id, step.saved_at || step.updated_at || step.preview_artifact_id || ""]);
  return { caseId, signature: JSON.stringify([caseId, outputs.includes(caseId), saved]) };
}
