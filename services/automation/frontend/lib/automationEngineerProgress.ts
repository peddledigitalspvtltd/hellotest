type ProgressStep = { instruction_status?: string; development_status?: string };

export function engineerStepFinished(step: ProgressStep, strict: boolean): boolean {
  return step.instruction_status === "saved" && (!strict || step.development_status === "completed");
}

/** A later cursor cannot reveal work until every earlier step has a durable completion receipt. */
export function engineerProgressFrontier(steps: ProgressStep[], strict: boolean): number {
  const first = steps.findIndex(step => !engineerStepFinished(step, strict));
  return first >= 0 ? first : Math.max(0, steps.length - 1);
}
