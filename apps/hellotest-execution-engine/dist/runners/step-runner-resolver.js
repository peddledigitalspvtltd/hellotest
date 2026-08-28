import { AndroidWdioRunner } from "./android-wdio-runner.js";
import { AxiosApiRunner } from "./axios-api-runner.js";
import { PlaywrightRunner } from "./playwright-runner.js";
import { UnsupportedStepError } from "./unsupported-step-error.js";
import { UnsupportedStepRunner } from "./unsupported-step-runner.js";
export const resolveStepRunner = ({ stepType, runnerType }) => {
    if (stepType === "web") {
        return new PlaywrightRunner();
    }
    if (stepType === "api") {
        return new AxiosApiRunner();
    }
    if (stepType === "android") {
        return new AndroidWdioRunner();
    }
    return new UnsupportedStepRunner(new UnsupportedStepError(stepType, runnerType));
};
//# sourceMappingURL=step-runner-resolver.js.map