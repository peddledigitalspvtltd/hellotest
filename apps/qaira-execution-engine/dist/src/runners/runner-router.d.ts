import type { RunCase } from "../models/execution.js";
import { PlaywrightRunner } from "./playwright-runner.js";
import { AxiosApiRunner } from "./axios-api-runner.js";
import { AndroidWdioRunner } from "./android-wdio-runner.js";
import { UnifiedCaseExecutor } from "./unified-case-executor.js";
export declare const resolveRunner: (runCase: RunCase) => PlaywrightRunner | AxiosApiRunner | AndroidWdioRunner | UnifiedCaseExecutor;
