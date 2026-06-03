import type { ExecutionContext } from "../models/execution.js";
export declare class ExecutionContextManager {
    private readonly context;
    constructor(initialValues?: Record<string, string>);
    setRunVariable(key: string, value: string): void;
    setSharedVariable(key: string, value: string): void;
    setCaseVariable(caseId: string, key: string, value: string): void;
    getRunVariable(key: string): string | undefined;
    getCaseVariable(caseId: string, key: string): string | undefined;
    resolveTemplate(value: string, caseId?: string): string;
    extractJsonPath(path: string, source: unknown): string | undefined;
    setStepOutput(stepId: string, output: unknown): void;
    getStepOutput(stepId: string): unknown;
    createCaseIsolation(caseId: string): void;
    getContext(): ExecutionContext;
}
