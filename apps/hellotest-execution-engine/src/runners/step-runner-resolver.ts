import { AndroidWdioRunner } from "./android-wdio-runner.js";
import { AxiosApiRunner } from "./axios-api-runner.js";
import { PlaywrightRunner } from "./playwright-runner.js";
import type { RunnerAdapter } from "./runner-adapter.js";
import { UnsupportedStepError } from "./unsupported-step-error.js";
import { UnsupportedStepRunner } from "./unsupported-step-runner.js";

export interface StepRunnerSelection {
  stepType: unknown;
  runnerType?: unknown;
}

export const resolveStepRunner = ({ stepType, runnerType }: StepRunnerSelection): RunnerAdapter => {
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
