import type { TestStep } from "@hellotest/platform/frontend/src/types";
import type { AutomationSourceProposal, AutomationSourceProposalInput } from "@hellotest/testing/frontend/api.client";
import { automationSourceSha256 } from "../../shared/automationInstructionMapping.mjs";

export const SOURCE_PROPOSAL_PERMISSIONS = ["automation.build", "automation.ai", "automation.view", "automation.code.view", "testcase.view", "data.view", "ops.view"];
export const canReviewAutomationSourceProposal = (role: string | undefined, can: (permission: string) => boolean) =>
  role === "admin" && SOURCE_PROPOSAL_PERMISSIONS.every(can);

export function validateAutomationSourceProposal(value: AutomationSourceProposal, transactionId: string, input: AutomationSourceProposalInput) {
  if (!value || value.schema_version !== 1 || value.kind !== "automation_source_proposal"
    || value.test_case_id !== input.test_case_id || value.step_id !== input.step_id || value.target_transaction_id !== transactionId
    || value.source_call_id !== input.source_call_id || value.evidence_transaction_id !== (input.evidence_transaction_id || transactionId)
    || value.validation_status !== "validated" || value.save_status !== "not_saved" || value.verification_status !== "unverified"
    || value.side_effects?.browser_actions !== 0 || value.side_effects?.cases_saved !== 0
    || typeof value.automation_code !== "string" || !value.automation_code.trim() || value.automation_code.length > 256 * 1024
    || !/^[a-f0-9]{64}$/.test(value.baseline_sha256) || !/^[a-f0-9]{64}$/.test(value.baseline_source_sha256) || !/^[a-f0-9]{64}$/.test(value.generation_manifest?.source_sha256) || value.proposed_source_sha256 !== automationSourceSha256(value.automation_code)) {
    throw new Error("The source proposal does not match this section and retained evidence. Generate it again before reviewing.");
  }
  return value;
}

/** Opening the existing editor creates a local draft; its normal Save remains authoritative. */
export function automationProposalEditorStep(step: TestStep | undefined, proposal: AutomationSourceProposal, draft?: string): TestStep {
  if (!step || step.id !== proposal.step_id || step.test_case_id !== proposal.test_case_id
    || automationSourceSha256(step.automation_code || "") !== proposal.baseline_source_sha256) {
    throw new Error("This section changed after the proposal was generated. Refresh it and generate a new proposal.");
  }
  if (draft !== undefined && draft !== (step.automation_code || "")) throw new Error("Review your unsaved source changes before opening this proposal.");
  return { ...step, automation_code: proposal.automation_code, automation_instructions: proposal.automation_instructions || null };
}
