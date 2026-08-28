import type { RunCase } from "../models/execution.js";
import type { RunnerAdapter } from "./runner-adapter.js";
export declare const resolveRunner: (runCase: RunCase) => RunnerAdapter;
