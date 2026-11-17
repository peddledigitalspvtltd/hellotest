import type { AiProcessingSnapshot, AiDesignedTestCaseCandidate, AiAuthoredTestCasePreview } from "../types";

export type AiDesignPreviewResponse = {
  processing?: AiProcessingSnapshot;
  generated: number;
  cases: AiDesignedTestCaseCandidate[];
  integration: {
    id: string;
    name: string;
    type: string;
    model?: string | null;
  };
  requirements: Array<{
    id: string;
    title: string;
  }>;
  app_type: {
    id: string;
    name: string;
  };
};

export type AiCaseAuthoringPreviewResponse = {
  processing?: AiProcessingSnapshot;
  integration: {
    id: string;
    name: string;
    type: string;
    model?: string | null;
  };
  requirement: {
    id: string;
    title: string;
  } | null;
  app_type: {
    id: string;
    name: string;
  };
  case: AiAuthoredTestCasePreview;
};
