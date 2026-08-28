import type { RunCase } from "../models/execution.js";
import type { RunnerAdapter } from "./runner-adapter.js";
import { resolveStepRunner } from "./step-runner-resolver.js";
import { UnifiedCaseExecutor } from "./unified-case-executor.js";

export const resolveRunner = (runCase: RunCase): RunnerAdapter => {
  if (runCase.caseType === "unified") {
    return new UnifiedCaseExecutor();
  }

  return resolveStepRunner({
    stepType: runCase.caseType,
    runnerType: runCase.runnerType
  });
};
