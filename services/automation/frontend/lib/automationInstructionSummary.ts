import { buildReadableAutomationInstructions, type AutomationReadableContext } from "./automationReadableInstructions";

/** A single supported action for older consumers; full programs use the shared presentation model. */
export function summarizeAutomationInstruction(source: string, context: AutomationReadableContext = {}) {
  const instructions = buildReadableAutomationInstructions(source, context);
  const instruction = instructions.length === 1 ? instructions[0] : null;
  return instruction && ["action", "assertion"].includes(instruction.kind) && !instruction.depth
    ? { label: instruction.label, args: instruction.args }
    : null;
}
