const printable = (value) => {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return value === undefined || value === null ? "unknown" : String(value);
};
export class UnsupportedStepError extends Error {
    code = "UNSUPPORTED_STEP_TYPE";
    stepType;
    runnerType;
    constructor(stepType, runnerType) {
        const normalizedStepType = printable(stepType);
        const normalizedRunnerType = printable(runnerType);
        super(`Unsupported execution step type '${normalizedStepType}' for runner '${normalizedRunnerType}'. `
            + "Expected a concrete web, api, or android step type.");
        this.name = "UnsupportedStepError";
        this.stepType = normalizedStepType;
        this.runnerType = normalizedRunnerType;
    }
}
//# sourceMappingURL=unsupported-step-error.js.map