import type { ExecutionContext, RunStep, RunnerStepResult } from "../models/execution.js";
import type { RunnerAdapter } from "./runner-adapter.js";
import { UnsupportedStepError } from "./unsupported-step-error.js";
export declare class UnsupportedStepRunner implements RunnerAdapter {
    readonly error: UnsupportedStepError;
    constructor(error: UnsupportedStepError);
    setup(_context: ExecutionContext): Promise<void>;
    executeStep(step: RunStep, _context: ExecutionContext): Promise<RunnerStepResult>;
    captureArtifact(_step: RunStep, _context: ExecutionContext): Promise<void>;
    teardown(_context: ExecutionContext): Promise<void>;
}
