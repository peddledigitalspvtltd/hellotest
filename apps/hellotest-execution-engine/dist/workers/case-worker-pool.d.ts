import type { RunCase } from "../models/execution.js";
export declare class CaseWorkerPool {
    private readonly maxConcurrency;
    private readonly enabled;
    constructor(enabled: boolean, parallelCount: number);
    executeCases<T>(cases: RunCase[], executeCase: (runCase: RunCase) => Promise<T>): Promise<T[]>;
}
