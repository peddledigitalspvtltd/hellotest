import type { ExecutionContext, RunStep, RunnerStepResult } from "../models/execution.js";
import type { RunnerAdapter } from "./runner-adapter.js";
import { resolveRunner } from "./runner-router.js";

export class UnifiedCaseExecutor implements RunnerAdapter {
  async setup(_context: ExecutionContext): Promise<void> {
    return;
  }

  async executeStep(step: RunStep, context: ExecutionContext): Promise<RunnerStepResult> {
    const runner = resolveRunner({ caseId: step.stepId, caseType: step.stepType, runnerType: step.runnerType, steps: [step] } as any);
    await runner.setup(context);
    const result = await runner.executeStep(step, context);
    await runner.teardown(context);
    return result;
  }

  async captureArtifact(_step: RunStep, _context: ExecutionContext): Promise<void> {
    return;
  }

  async teardown(_context: ExecutionContext): Promise<void> {
    return;
  }
}
