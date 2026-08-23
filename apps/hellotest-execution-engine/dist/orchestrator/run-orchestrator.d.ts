import type { RunSnapshot, ExecutionResult } from "../models/execution.js";
import type { EngineApiClient } from "../backend-api-client.js";
export declare class RunOrchestrator {
    private readonly runId;
    private readonly snapshot;
    private readonly apiClient;
    private readonly logger;
    private readonly context;
    private readonly collector;
    private readonly queue;
    private readonly hooks;
    constructor(runId: string, snapshot: RunSnapshot, apiClient: EngineApiClient);
    execute(): Promise<ExecutionResult>;
    private executeSuite;
    private executeHooks;
}
