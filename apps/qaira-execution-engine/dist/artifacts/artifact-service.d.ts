import type { ExecutionArtifact } from "../models/execution.js";
export declare const uploadArtifact: (input: {
    runId: string;
    caseId?: string;
    stepId?: string;
    artifactType: string;
    content: Buffer | string;
    contentType: string;
    fileName?: string;
}) => Promise<ExecutionArtifact>;
