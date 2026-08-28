import { resolveStepRunner } from "./step-runner-resolver.js";
export class UnifiedCaseExecutor {
    async setup(_context) {
        return;
    }
    async executeStep(step, context) {
        const runner = resolveStepRunner(step);
        await runner.setup(context);
        try {
            return await runner.executeStep(step, context);
        }
        finally {
            await runner.teardown(context);
        }
    }
    async captureArtifact(_step, _context) {
        return;
    }
    async teardown(_context) {
        return;
    }
}
//# sourceMappingURL=unified-case-executor.js.map