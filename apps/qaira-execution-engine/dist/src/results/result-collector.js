import { createChildLogger } from "../logger.js";
export class ResultCollector {
    runId;
    logger = createChildLogger({ component: "ResultCollector" });
    events = [];
    constructor(runId) {
        this.runId = runId;
    }
    record(event) {
        this.events.push(event);
        this.logger.info({ runId: this.runId, ...event }, "Result event recorded");
    }
    saveStepStarted(stepId, caseId, suiteId) {
        this.record({ type: "step.started", runId: this.runId, suiteId, caseId, stepId, timestamp: new Date().toISOString() });
    }
    saveStepCompleted(result, caseId, suiteId) {
        this.record({ type: "step.completed", runId: this.runId, suiteId, caseId, ...result });
    }
    saveStepFailed(result, caseId, suiteId) {
        this.record({ type: "step.failed", runId: this.runId, suiteId, caseId, ...result });
    }
    saveCaseStarted(caseId, suiteId) {
        this.record({ type: "case.started", runId: this.runId, suiteId, caseId, timestamp: new Date().toISOString() });
    }
    saveCaseCompleted(caseId, suiteId, status, durationMs) {
        this.record({ type: "case.completed", runId: this.runId, suiteId, caseId, status, durationMs, timestamp: new Date().toISOString() });
    }
    saveSuiteCompleted(suiteId, status, durationMs) {
        this.record({ type: "suite.completed", runId: this.runId, suiteId, status, durationMs, timestamp: new Date().toISOString() });
    }
    saveRunCompleted(status, durationMs) {
        this.record({ type: "run.completed", runId: this.runId, status, durationMs, timestamp: new Date().toISOString() });
    }
    getEvents() {
        return [...this.events];
    }
}
//# sourceMappingURL=result-collector.js.map