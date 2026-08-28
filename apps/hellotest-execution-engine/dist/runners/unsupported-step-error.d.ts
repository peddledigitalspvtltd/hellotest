export declare class UnsupportedStepError extends Error {
    readonly code = "UNSUPPORTED_STEP_TYPE";
    readonly stepType: string;
    readonly runnerType: string;
    constructor(stepType: unknown, runnerType: unknown);
}
