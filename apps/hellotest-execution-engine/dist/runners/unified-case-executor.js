import { resolveRunner } from "./runner-router.js";
export class UnifiedCaseExecutor {
    async setup(_context) {
        return;
    }
    async executeStep(step, context) {
        const runner = resolveRunner({ caseId: step.stepId, caseType: step.stepType, runnerType: step.runnerType, steps: [step] });
        await runner.setup(context);
        const result = await runner.executeStep(step, context);
        await runner.teardown(context);
        return result;
    }
    async captureArtifact(_step, _context) {
        return;
    }
    async teardown(_context) {
        return;
    }
}
//# sourceMappingURL=unified-case-executor.js.map