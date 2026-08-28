export class UnsupportedStepRunner {
    error;
    constructor(error) {
        this.error = error;
    }
    async setup(_context) {
        return;
    }
    async executeStep(step, _context) {
        const timestamp = new Date().toISOString();
        return {
            stepId: step.stepId,
            status: "failed",
            startedAt: timestamp,
            endedAt: timestamp,
            durationMs: 0,
            note: this.error.message,
            data: {
                errorCode: this.error.code,
                stepType: this.error.stepType,
                runnerType: this.error.runnerType
            }
        };
    }
    async captureArtifact(_step, _context) {
        return;
    }
    async teardown(_context) {
        return;
    }
}
//# sourceMappingURL=unsupported-step-runner.js.map