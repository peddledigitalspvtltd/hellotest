export type RunCaseType = "web" | "api" | "android" | "unified";
export type RunnerType = "playwright" | "axios" | "appium" | "wdio" | "unified";
export type RunHookPhase = "beforeRun" | "afterRun" | "beforeSuite" | "afterSuite" | "beforeCase" | "afterCase";
export type RunHookFailBehavior = "fail-run" | "mark-blocked" | "continue";
export interface RunHook {
    id: string;
    name?: string;
    phase: RunHookPhase;
    scope: "run" | "suite" | "case";
    targetCaseId?: string | null;
    steps: RunStep[];
    failBehavior?: RunHookFailBehavior;
}
export interface RunStep {
    stepId: string;
    order: number;
    stepType: RunCaseType;
    runnerType: RunnerType;
    action: string;
    parameters?: Record<string, unknown>;
    expectedResult?: string | null;
    timeoutMs?: number;
}
export interface RetryConfig {
    attempts: number;
    intervalMs?: number;
    allowRetry?: boolean;
}
export interface RunCase {
    caseId: string;
    title?: string;
    caseType: RunCaseType;
    runnerType: RunnerType;
    steps: RunStep[];
    hooks?: RunHook[];
    retryConfig?: RetryConfig;
    timeoutMs?: number;
    metadata?: Record<string, unknown>;
}
export interface ParallelConfig {
    enabled: boolean;
    count: number;
}
export interface RunSuite {
    suiteId: string;
    title?: string;
    cases: RunCase[];
    hooks?: RunHook[];
    parallelConfig?: ParallelConfig;
}
export interface RunSnapshot {
    runId: string;
    projectId: string;
    title?: string;
    config: Record<string, unknown>;
    suites: RunSuite[];
    environment: Record<string, string>;
    runnerConfig: Record<string, unknown>;
    parallelConfig: ParallelConfig;
    browserConfig: Record<string, unknown>;
    deviceConfig: Record<string, unknown>;
    hooks?: RunHook[];
    createdAt: string;
}
export interface ExecutionContext {
    runVariables: Record<string, string>;
    caseVariables: Record<string, Record<string, string>>;
    shared: Record<string, string>;
    outputs: Record<string, unknown>;
}
export type ExecutionStatus = "passed" | "failed" | "blocked" | "running" | "queued";
export interface ExecutionResult {
    runId: string;
    status: ExecutionStatus;
    durationMs: number;
    startedAt: string;
    completedAt: string;
    suites: Array<{
        suiteId: string;
        status: ExecutionStatus;
        durationMs: number;
        cases: Array<{
            caseId: string;
            status: ExecutionStatus;
            durationMs: number;
        }>;
    }>;
}
export interface ExecutionArtifact {
    artifactId: string;
    runId: string;
    caseId?: string;
    stepId?: string;
    artifactType: string;
    objectKey: string;
    signedUrl?: string;
    createdAt: string;
}
export interface WorkerInfo {
    engineId: string;
    workerId: string;
    hostname?: string;
    capabilities: string[];
    startedAt: string;
    lastHeartbeatAt?: string;
}
export interface RunnerStepResult {
    stepId: string;
    status: ExecutionStatus;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    note?: string;
    data?: Record<string, unknown>;
    artifacts?: ExecutionArtifact[];
}
