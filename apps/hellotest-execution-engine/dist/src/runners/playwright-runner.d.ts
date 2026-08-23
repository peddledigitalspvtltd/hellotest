import type { ExecutionContext, RunStep, RunnerStepResult } from "../models/execution.js";
import type { RunnerAdapter } from "./runner-adapter.js";
export declare class PlaywrightRunner implements RunnerAdapter {
    private browser;
    private context;
    private page;
    setup(_context: ExecutionContext): Promise<void>;
    executeStep(step: RunStep, _context: ExecutionContext): Promise<RunnerStepResult>;
    captureArtifact(_step: RunStep, _context: ExecutionContext): Promise<void>;
    teardown(_context: ExecutionContext): Promise<void>;
}
