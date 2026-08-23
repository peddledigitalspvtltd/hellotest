export interface ClaimResponse {
    runId: string;
    jobId: string;
    payload?: Record<string, unknown>;
}
export declare class EngineApiClient {
    private readonly baseUrl;
    constructor(baseUrl?: string);
    claimRun(engineId: string): Promise<ClaimResponse | null>;
    loadRunSnapshot(runId: string): Promise<Record<string, unknown>>;
    sendHeartbeat(runId: string, engineId: string): Promise<boolean>;
}
