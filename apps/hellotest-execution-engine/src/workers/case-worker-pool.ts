import type { RunCase } from "../models/execution.js";

export class CaseWorkerPool {
  private readonly maxConcurrency: number;
  private readonly enabled: boolean;

  constructor(enabled: boolean, parallelCount: number) {
    this.enabled = enabled;
    this.maxConcurrency = enabled ? Math.max(1, parallelCount) : 1;
  }

  async executeCases<T>(cases: RunCase[], executeCase: (runCase: RunCase) => Promise<T>): Promise<T[]> {
    const results: T[] = [];

    if (this.maxConcurrency === 1) {
      for (const runCase of cases) {
        results.push(await executeCase(runCase));
      }
      return results;
    }

    const parallelCases = cases.filter((runCase) => runCase.caseType !== "unified");
    const unifiedCases = cases.filter((runCase) => runCase.caseType === "unified");

    const queue = [...parallelCases];
    const workers = Array.from({ length: this.maxConcurrency }, async () => {
      while (queue.length > 0) {
        const runCase = queue.shift();
        if (!runCase) {
          break;
        }
        results.push(await executeCase(runCase));
      }
    });

    await Promise.all(workers);

    for (const runCase of unifiedCases) {
      results.push(await executeCase(runCase));
    }

    return results;
  }
}
