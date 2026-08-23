import type { ExecutionContext, RunStep, RunnerStepResult } from "../models/execution.js";
import type { RunnerAdapter } from "./runner-adapter.js";
export declare class AndroidWdioRunner implements RunnerAdapter {
    private session;
    setup(context: ExecutionContext): Promise<void>;
    executeStep(step: RunStep, _context: ExecutionContext): Promise<RunnerStepResult>;
    captureArtifact(step: RunStep, _context: ExecutionContext): Promise<void>;
    teardown(_context: ExecutionContext): Promise<void>;
}
