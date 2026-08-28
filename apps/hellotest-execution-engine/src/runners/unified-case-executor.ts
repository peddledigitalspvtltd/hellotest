import type { ExecutionContext, RunStep, RunnerStepResult } from "../models/execution.js";
import type { RunnerAdapter } from "./runner-adapter.js";
import { resolveStepRunner } from "./step-runner-resolver.js";

export class UnifiedCaseExecutor implements RunnerAdapter {
  async setup(_context: ExecutionContext): Promise<void> {
    return;
  }

  async executeStep(step: RunStep, context: ExecutionContext): Promise<RunnerStepResult> {
    const runner = resolveStepRunner(step);
    await runner.setup(context);
    try {
      return await runner.executeStep(step, context);
    } finally {
      await runner.teardown(context);
    }
  }

  async captureArtifact(_step: RunStep, _context: ExecutionContext): Promise<void> {
    return;
  }

  async teardown(_context: ExecutionContext): Promise<void> {
    return;
  }
}
