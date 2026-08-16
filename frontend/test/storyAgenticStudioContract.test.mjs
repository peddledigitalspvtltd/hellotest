import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Story creation and completion use the shared focused agent process with backend snapshots", async () => {
  const [shell, page] = await Promise.all([
    readSource("../src/components/StoryAiStudioShell.tsx"),
    readSource("../src/pages/RequirementsPage.tsx")
  ]);

  assert.match(shell, /processing\?: AgenticProcessingSnapshot/);
  assert.match(shell, /processing=\{processing\}/);
  assert.match(shell, /profile=\{mode === "create" \? "story-create" : "story-complete"\}/);
  assert.match(shell, /orientation="vertical"/);
  assert.match(shell, /presentation="focused"/);
  assert.match(shell, /Proposal ready · review required/);
  assert.match(shell, /Processing complete · no proposal/);
  assert.match(shell, /Processing is complete; edit and accept only what you want to keep/);

  assert.match(page, /const storyAiProcessing = storyAiEnvelope\?\.processing/);
  assert.match(page, /processing=\{storyAiProcessing\}/);
  assert.match(page, /reviewStatus=\{storyAiReviewStatus\}/);
  assert.match(page, /contextState=\{storyAiContextState\}/);
  assert.match(page, /agentStatus=\{storyAiAgentStatus\}/);
  assert.doesNotMatch(page, /contextLabel=\{`\$\{requirementAiMode === "improve" \? "Selected Story" : "Project knowledge"\}/);
});

test("Story evidence opens in the shared flyout instead of expanding inline", async () => {
  const content = await readSource("../src/components/StoryAiStudioContent.tsx");

  assert.match(content, /AiEvidenceButton/);
  assert.match(content, /AiEvidenceFlyout/);
  assert.match(content, /View cited evidence/);
  assert.match(content, /View evidence boundary/);
  assert.match(content, /Cited by this proposal/);
  assert.match(content, /Available but not cited/);
  assert.match(content, /Limitations to review/);
  assert.match(content, /Deterministic readiness/);
  assert.match(content, /Field grounding/);
  assert.match(content, /draft\.fieldEvidence/);
  assert.match(content, /Run ID/);
  assert.match(content, /Input snapshot/);
  assert.match(content, /setIsEvidenceOpen\(false\)/);
  assert.doesNotMatch(content, /<details[^>]+(?:evidence|provenance)/i);
});

test("Story UI keeps generated proposals separate from acceptance and avoids unsupported Gherkin", async () => {
  const page = await readSource("../src/pages/RequirementsPage.tsx");

  assert.match(page, /title: !suggestion\.no_changes_proposed && suggestion\.title !== selectedRequirementForAi!/);
  assert.match(page, /description: !suggestion\.no_changes_proposed/);
  assert.match(page, /normalizeAiAcceptanceCriteria\(suggestion\.acceptance_criteria\)\.length > 0/);
  assert.match(page, /const evidencedDraftsForGherkin = draftsForGherkin\.filter/);
  assert.match(page, /Gherkin was not generated because no evidence-backed acceptance criteria were available/);
  assert.match(page, /commandBar=\{\(requirementAiMode === "create" \? requirementCreationDrafts\.length > 0 : Boolean\(optimizationSuggestion\)\)/);
  assert.match(page, /Only selected drafts enter the Story library after explicit acceptance/);
  assert.match(page, /Only selected generated fields are applied to the existing Story after explicit acceptance/);
  assert.match(page, /submittedRequirementCreationJob/);
  assert.match(page, /queued in the backend/);
  assert.match(page, /Progress will update from the persisted job state/);
  assert.match(page, /fieldEvidence: candidate\.field_evidence/);
  assert.match(page, /fieldEvidence: optimizationSuggestion\.field_evidence/);
});

test("Story API types expose stable evidence, limitations, progress, and review state", async () => {
  const api = await readSource("../src/lib/api.ts");

  assert.match(api, /export type AiStoryEvidenceSource = AiEvidenceSource/);
  assert.match(api, /evidence\?: AiStoryEvidenceSource\[\]/);
  assert.match(api, /limitations\?: string\[\]/);
  assert.match(api, /processing\?: AiProcessingSnapshot/);
  assert.match(api, /review_status\?: "awaiting_review"/);
  assert.match(api, /requires_human_review\?: boolean/);
  assert.match(api, /preview_only\?: boolean/);
  assert.match(api, /unsupported_fields\?: string\[\]/);
  assert.match(api, /request_id\?: string/);
  assert.match(api, /input_fingerprint\?: string/);
});
