import type { AiArtifactAssuranceAnalysis, AiArtifactAssuranceDimension, AiArtifactAssuranceInsight, AiArtifactAssuranceReview } from "@hellotest/platform/frontend/src/types";

type AssuranceStep = {
  id?: string;
  action?: string | null;
  expected_result?: string | null;
  step_type?: string | null;
  automation_code?: string | null;
  api_request?: unknown;
};

import * as core from "../../shared/artifactAssurance.mjs";

export function buildStoryAssuranceAnalysis(input: {
  title: string;
  description: string;
  gherkinScenarios?: string[];
  acceptanceCriteria?: string[];
  linkedCaseCount: number;
  externalReferences?: string[];
  labels?: string[];
  hasDeliveryContext: boolean;
}): AiArtifactAssuranceAnalysis {
  return core.buildStoryAssuranceAnalysis(input);
}

export function buildTestCaseAssuranceAnalysis(input: {
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
}): AiArtifactAssuranceAnalysis {
  return core.buildTestCaseAssuranceAnalysis(input);
}

export function mergeAssuranceReview(
  baseline: AiArtifactAssuranceAnalysis,
  review?: AiArtifactAssuranceReview | null
): AiArtifactAssuranceAnalysis {
  return core.mergeAssuranceReview(baseline, review);
}
