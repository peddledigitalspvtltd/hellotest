import type { RunnerStepResult } from "../models/execution.js";
export declare class ResultCollector {
    private readonly runId;
    private readonly logger;
    private readonly events;
    constructor(runId: string);
    private record;
    saveStepStarted(stepId: string, caseId: string, suiteId: string): void;
    saveStepCompleted(result: RunnerStepResult, caseId: string, suiteId: string): void;
    saveStepFailed(result: RunnerStepResult, caseId: string, suiteId: string): void;
    saveCaseStarted(caseId: string, suiteId: string): void;
    saveCaseCompleted(caseId: string, suiteId: string, status: string, durationMs: number): void;
    saveSuiteCompleted(suiteId: string, status: string, durationMs: number): void;
    saveRunCompleted(status: string, durationMs: number): void;
    getEvents(): Record<string, unknown>[];
}
