import type { RunnerStepResult, RunCase, RunSuite } from "../models/execution.js";
import { createChildLogger } from "../logger.js";

export class ResultCollector {
  private readonly runId: string;
  private readonly logger = createChildLogger({ component: "ResultCollector" });
  private readonly events: Array<Record<string, unknown>> = [];

  constructor(runId: string) {
    this.runId = runId;
  }

  private record(event: Record<string, unknown>) {
    this.events.push(event);
    this.logger.info({ runId: this.runId, ...event }, "Result event recorded");
  }

  saveStepStarted(stepId: string, caseId: string, suiteId: string) {
    this.record({ type: "step.started", runId: this.runId, suiteId, caseId, stepId, timestamp: new Date().toISOString() });
  }

  saveStepCompleted(result: RunnerStepResult, caseId: string, suiteId: string) {
    this.record({ type: "step.completed", runId: this.runId, suiteId, caseId, ...result });
  }

  saveStepFailed(result: RunnerStepResult, caseId: string, suiteId: string) {
    this.record({ type: "step.failed", runId: this.runId, suiteId, caseId, ...result });
  }

  saveCaseStarted(caseId: string, suiteId: string) {
    this.record({ type: "case.started", runId: this.runId, suiteId, caseId, timestamp: new Date().toISOString() });
  }

  saveCaseCompleted(caseId: string, suiteId: string, status: string, durationMs: number) {
    this.record({ type: "case.completed", runId: this.runId, suiteId, caseId, status, durationMs, timestamp: new Date().toISOString() });
  }

  saveSuiteCompleted(suiteId: string, status: string, durationMs: number) {
    this.record({ type: "suite.completed", runId: this.runId, suiteId, status, durationMs, timestamp: new Date().toISOString() });
  }

  saveRunCompleted(status: string, durationMs: number) {
    this.record({ type: "run.completed", runId: this.runId, status, durationMs, timestamp: new Date().toISOString() });
  }

  getEvents() {
    return [...this.events];
  }
}
