export type AutomationMappedInstruction = {
  operation_id: string; label: string; args: string[]; kind: 'action' | 'assertion' | 'control' | 'custom' | 'setup'; depth: number; detail?: string;
};
export type AutomationInstructionMapping = {
  schema: 'hellotest.playwrightInstructions.v1'; step_id: string; source_sha256: string;
  operations: Array<{ operation_id: string; source_sha256: string; start: number; end: number; kind: AutomationMappedInstruction['kind']; depth: number }>;
  instructions: AutomationMappedInstruction[];
};
export const AUTOMATION_INSTRUCTION_MAPPING_SCHEMA: AutomationInstructionMapping['schema'];
export function automationSourceSha256(source: string): string;
export function validAutomationInstructionMapping(value: unknown, options: { source: string; stepId: string }): value is AutomationInstructionMapping;
export function mappedAutomationInstructions(value: unknown, options: { source: string; stepId: string }): Array<AutomationMappedInstruction & { text: string }> | null;
