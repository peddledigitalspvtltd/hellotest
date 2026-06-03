import { PlaywrightRunner } from "./playwright-runner.js";
import { AxiosApiRunner } from "./axios-api-runner.js";
import { AndroidWdioRunner } from "./android-wdio-runner.js";
import { UnifiedCaseExecutor } from "./unified-case-executor.js";
export const resolveRunner = (runCase) => {
    if (runCase.caseType === "web") {
        return new PlaywrightRunner();
    }
    if (runCase.caseType === "api") {
        return new AxiosApiRunner();
    }
    if (runCase.caseType === "android") {
        return new AndroidWdioRunner();
    }
    return new UnifiedCaseExecutor();
};
//# sourceMappingURL=runner-router.js.map