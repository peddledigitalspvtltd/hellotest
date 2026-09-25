import assert from "node:assert/strict";
import test from "node:test";
import { buildStoryAssuranceAnalysis, mergeAssuranceReview } from "../../frontend/lib/artifactAssurance.ts";

test("AI narrative cannot replace measured assurance scores, statuses, evidence or dimension identity", () => {
  const baseline = buildStoryAssuranceAnalysis({ title: "Save an address", description: "Customer can save an eligible address", acceptanceCriteria: [], gherkinScenarios: [], linkedCaseCount: 0, externalReferences: [], labels: [], hasDeliveryContext: false });
  const original = structuredClone(baseline);
  const dimension = baseline.dimensions[0];
  const refined = mergeAssuranceReview(baseline, {
    overall_score: 100, evidence_count: 999, summary: "Check address persistence after reload.",
    dimensions: [{ id: dimension.id, label: "Overridden", score: 100, status: "strong", evidence: ["invented"], explanation: "Acceptance does not say what happens after reload.", recommendation: "Add an observable persistence criterion." }, { id: "unknown", score: 100 }],
    limitations: ["No runtime evidence supplied."]
  });
  assert.equal(refined.overall_score, original.overall_score);
  assert.equal(refined.evidence_count, original.evidence_count);
  assert.deepEqual(refined.benchmark, original.benchmark);
  assert.equal(refined.dimensions.length, original.dimensions.length);
  assert.deepEqual({ ...refined.dimensions[0], explanation: dimension.explanation, recommendation: dimension.recommendation }, dimension);
  assert.match(refined.dimensions[0].explanation, /after reload/);
  assert.ok(refined.limitations.includes("No runtime evidence supplied."));
  assert.deepEqual(baseline, original);
  assert.strictEqual(mergeAssuranceReview(baseline), baseline);
});
