import { resolveStepRunner } from "./step-runner-resolver.js";
import { UnifiedCaseExecutor } from "./unified-case-executor.js";
export const resolveRunner = (runCase) => {
    if (runCase.caseType === "unified") {
        return new UnifiedCaseExecutor();
    }
    return resolveStepRunner({
        stepType: runCase.caseType,
        runnerType: runCase.runnerType
    });
};
//# sourceMappingURL=runner-router.js.map