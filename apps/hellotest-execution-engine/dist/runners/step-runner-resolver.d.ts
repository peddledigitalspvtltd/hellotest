import type { RunnerAdapter } from "./runner-adapter.js";
export interface StepRunnerSelection {
    stepType: unknown;
    runnerType?: unknown;
}
export declare const resolveStepRunner: ({ stepType, runnerType }: StepRunnerSelection) => RunnerAdapter;
