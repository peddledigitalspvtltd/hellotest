import type { ExecutionContext, RunStep, RunnerStepResult } from "../models/execution.js";
export interface RunnerAdapter {
    setup(context: ExecutionContext): Promise<void>;
    executeStep(step: RunStep, context: ExecutionContext): Promise<RunnerStepResult>;
    captureArtifact(step: RunStep, context: ExecutionContext): Promise<void>;
    teardown(context: ExecutionContext): Promise<void>;
}
