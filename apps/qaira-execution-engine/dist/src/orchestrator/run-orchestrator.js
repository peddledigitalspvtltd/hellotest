import { createChildLogger } from "../logger.js";
import { ExecutionContextManager } from "../context/execution-context-manager.js";
import { resolveRunner } from "../runners/runner-router.js";
import { CaseWorkerPool } from "../workers/case-worker-pool.js";
import { ResultCollector } from "../results/result-collector.js";
export class RunOrchestrator {
    runId;
    snapshot;
    apiClient;
    logger = createChildLogger({ component: "RunOrchestrator" });
    context;
    collector;
    queue;
    hooks;
    constructor(runId, snapshot, apiClient) {
        this.runId = runId;
        this.snapshot = snapshot;
        this.apiClient = apiClient;
        this.context = new ExecutionContextManager(snapshot.environment || {});
        this.collector = new ResultCollector(runId);
        this.queue = new CaseWorkerPool(!!snapshot.parallelConfig?.enabled, snapshot.parallelConfig?.count || 1);
        this.hooks = [];
    }
    async execute() {
        const runStartedAt = Date.now();
        this.logger.info({ runId: this.runId, suiteCount: this.snapshot.suites.length }, "Starting run execution");
        await this.executeHooks("beforeRun", this.snapshot.hooks || []);
        const suiteResults = [];
        let runStatus = "passed";
        for (const suite of this.snapshot.suites) {
            const suiteStart = Date.now();
            await this.executeHooks("beforeSuite", suite.hooks || []);
            const caseResults = await this.executeSuite(suite);
            const suiteStatus = caseResults.some((item) => item.status !== "passed") ? "failed" : "passed";
            if (suiteStatus === "failed") {
                runStatus = "failed";
            }
            await this.executeHooks("afterSuite", suite.hooks || []);
            const suiteDuration = Date.now() - suiteStart;
            suiteResults.push({ suiteId: suite.suiteId, status: suiteStatus, durationMs: suiteDuration, cases: caseResults });
        }
        await this.executeHooks("afterRun", this.snapshot.hooks || []);
        const runDuration = Date.now() - runStartedAt;
        this.collector.saveRunCompleted(runStatus, runDuration);
        return {
            runId: this.runId,
            status: runStatus,
            durationMs: runDuration,
            startedAt: new Date(runStartedAt).toISOString(),
            completedAt: new Date().toISOString(),
            suites: suiteResults
        };
    }
    async executeSuite(suite) {
        const executeCase = async (runCase) => {
            this.context.createCaseIsolation(runCase.caseId);
            this.collector.saveCaseStarted(runCase.caseId, suite.suiteId);
            const runner = resolveRunner(runCase);
            await runner.setup(this.context.getContext());
            let caseStatus = "passed";
            let elapsedMs = 0;
            const caseStart = Date.now();
            try {
                for (const step of runCase.steps) {
                    this.collector.saveStepStarted(step.stepId, runCase.caseId, suite.suiteId);
                    const stepStart = Date.now();
                    const result = await runner.executeStep(step, this.context.getContext());
                    elapsedMs += Date.now() - stepStart;
                    if (result.status !== "passed") {
                        caseStatus = result.status;
                        this.collector.saveStepFailed(result, runCase.caseId, suite.suiteId);
                        break;
                    }
                    this.collector.saveStepCompleted(result, runCase.caseId, suite.suiteId);
                }
            }
            catch (error) {
                caseStatus = "failed";
                this.logger.error({ error, runId: this.runId, caseId: runCase.caseId }, "Case execution failed");
            }
            finally {
                elapsedMs = Date.now() - caseStart;
                await runner.teardown(this.context.getContext());
                this.collector.saveCaseCompleted(runCase.caseId, suite.suiteId, caseStatus, elapsedMs);
            }
            return { caseId: runCase.caseId, status: caseStatus, durationMs: elapsedMs };
        };
        const caseResults = await this.queue.executeCases(suite.cases, executeCase);
        return caseResults;
    }
    async executeHooks(phase, hooks) {
        const active = hooks.filter((hook) => hook.phase === phase);
        if (active.length === 0) {
            return;
        }
        for (const hook of active) {
            for (const step of hook.steps) {
                const runner = resolveRunner({
                    caseId: hook.targetCaseId || `${this.runId}-${hook.id}`,
                    caseType: step.stepType,
                    runnerType: step.runnerType,
                    steps: [step]
                });
                await runner.setup(this.context.getContext());
                await runner.executeStep(step, this.context.getContext());
                await runner.teardown(this.context.getContext());
            }
        }
    }
}
//# sourceMappingURL=run-orchestrator.js.map