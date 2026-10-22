import type { AiArtifactAssuranceAnalysis, AiArtifactAssuranceDimension, AiArtifactAssuranceInsight, AiArtifactAssuranceReview } from "@hellotest/platform/frontend/src/types";

type AssuranceStep = {
  id?: string;
  action?: string | null;
  expected_result?: string | null;
  step_type?: string | null;
  automation_code?: string | null;
  api_request?: unknown;
};

export declare function buildStoryAssuranceAnalysis(input: {
  title: string;
  description: string;
  gherkinScenarios?: string[];
  acceptanceCriteria?: string[];
  linkedCaseCount: number;
  externalReferences?: string[];
  labels?: string[];
  hasDeliveryContext: boolean;
}): AiArtifactAssuranceAnalysis;

export declare function buildTestCaseAssuranceAnalysis(input: {
  title: string;
  description: string;
  steps: AssuranceStep[];
  requirementCount: number;
  labels?: string[];
  parameterValues?: Record<string, string>;
  reviewStatus: string;
  finalizedRunCount?: number;
  passRate?: number | null;
  suiteCount?: number;
  externalReferenceCount?: number;
}): AiArtifactAssuranceAnalysis;

export declare function mergeAssuranceReview(
  baseline: AiArtifactAssuranceAnalysis,
  review?: AiArtifactAssuranceReview | null
): AiArtifactAssuranceAnalysis;
