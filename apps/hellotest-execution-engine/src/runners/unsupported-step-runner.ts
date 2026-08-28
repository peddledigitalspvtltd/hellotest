import type { ExecutionContext, RunStep, RunnerStepResult } from "../models/execution.js";
import type { RunnerAdapter } from "./runner-adapter.js";
import { UnsupportedStepError } from "./unsupported-step-error.js";

export class UnsupportedStepRunner implements RunnerAdapter {
  constructor(readonly error: UnsupportedStepError) {}

  async setup(_context: ExecutionContext): Promise<void> {
    return;
  }

  async executeStep(step: RunStep, _context: ExecutionContext): Promise<RunnerStepResult> {
    const timestamp = new Date().toISOString();
    return {
      stepId: step.stepId,
      status: "failed",
      startedAt: timestamp,
      endedAt: timestamp,
      durationMs: 0,
      note: this.error.message,
      data: {
        errorCode: this.error.code,
        stepType: this.error.stepType,
        runnerType: this.error.runnerType
      }
    };
  }

  async captureArtifact(_step: RunStep, _context: ExecutionContext): Promise<void> {
    return;
  }

  async teardown(_context: ExecutionContext): Promise<void> {
    return;
  }
}
