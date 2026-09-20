import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Defect creation and triage render feature-specific processing with evidence in flyouts", async () => {
  const [issues, insightDialog] = await Promise.all([
    readSource("../src/pages/IssuesPage.tsx"),
    readSource("../src/components/AiInsightPreviewDialog.tsx")
  ]);

  assert.match(issues, /profile="bug-create"/);
  assert.match(issues, /profile="bug-triage"/);
  assert.match(issues, /aiDraftPreview\?\.processing/);
  assert.match(issues, /previewAiBugTriage\.data\?\.processing/);
  assert.match(issues, /eyebrow="Defect creation · Input evidence"/);
  assert.match(issues, /eyebrow="Defect creation · Decision evidence"/);
  assert.match(issues, /recommendation\.evidence_refs/);
  assert.match(issues, /boundaryOmissions=\{asArray\(previewAiBugTriage\.data\?\.boundaries\?\.omissions\)\}/);
  assert.doesNotMatch(issues, /<details className="ai-bug-/);

  assert.match(insightDialog, /finding\.evidence\?\.length \? \(/);
  assert.match(insightDialog, /<AiEvidenceButton[^>]*label="View finding evidence"/);
  assert.match(insightDialog, /<AiEvidenceFlyout/);
  assert.match(insightDialog, /boundaryOmissions\.map/);
  assert.match(insightDialog, /onAccept \? \(/);
  assert.match(insightDialog, /<ol className="ai-insight-preview-review-actions">/);
  assert.match(insightDialog, /data-selected=\{\(onAccept && selectedFindingIds\.includes/);
});

test("Defect draft requests honor the prompt registry and preserve the bounded evidence contract", async () => {
  const [issues, api, types] = await Promise.all([
    readSource("../src/pages/IssuesPage.tsx"),
    readSource("../src/lib/api.ts"),
    readSource("../src/types.ts")
  ]);

  assert.match(issues, /getLlmIntegrationId\("ai\.bug\.draft"\)/);
  assert.match(issues, /getPrompt\("ai\.bug\.draft"\)/);
  assert.match(issues, /getLlmIntegrationId\("ai\.bug\.triage"\)/);
  assert.match(issues, /getPrompt\("ai\.bug\.triage"\)/);
  assert.match(issues, /Object\.entries\(aiDraftPreview\.boundaries\.omitted\)/);
  assert.match(issues, /boundaries\.content_omissions/);
  assert.match(api, /prompt_guidance\?: string/);
  assert.match(api, /integration_id\?: string/);
  assert.match(types, /evidence_sources: AiEvidenceSource\[\]/);
  assert.match(types, /field_evidence: Record<string, string\[\]>/);
  assert.match(types, /fallback_fields: string\[\]/);
  assert.match(types, /content_omissions: Array/);
  assert.match(types, /processing: AiProcessingSnapshot/);
});

test("human edits invalidate generated Defect field evidence before acceptance", async () => {
  const [issues, types] = await Promise.all([
    readSource("../src/pages/IssuesPage.tsx"),
    readSource("../src/types.ts")
  ]);

  assert.match(types, /export type AiBugDraftEditableField/);
  assert.match(types, /human_edited_fields: AiBugDraftEditableField\[\]/);
  assert.match(types, /stale_field_evidence: Partial<Record<AiBugDraftEditableField, string\[\]>>/);
  assert.match(types, /stale_gaps: Partial<Record<AiBugDraftEditableField, AiEvidenceGap\[\]>>/);
  assert.match(types, /stale_fallback_fields: AiBugDraftEditableField\[\]/);
  assert.match(issues, /const updateAiBugDraftField =/);
  assert.match(issues, /staleFieldEvidence\[field\] = \[\.\.\.\(current\.field_evidence\[field\] \|\| \[\]\)\]/);
  assert.match(issues, /field_evidence: \{ \.\.\.current\.field_evidence, \[field\]: \[\] \}/);
  assert.match(issues, /gaps: current\.gaps\.filter\(\(gap\) => gap\.field !== field\)/);
  assert.match(issues, /fallback_fields: current\.fallback_fields\.filter\(\(fallbackField\) => fallbackField !== field\)/);
  assert.match(issues, /stage\.id === "specialist" \|\| stage\.id === "evaluation"/);
  assert.match(issues, /Generated evaluation is historical and does not validate human-edited fields/);
  assert.match(issues, /const humanEditedFields = \[\.\.\.new Set\(\[\.\.\.reviewState\.human_edited_fields, field\]\)\]/);
  assert.match(issues, /human_edited_fields: humanEditedFields/);
  for (const field of ["title", "severity", "priority", "message", "steps_to_reproduce", "expected_result", "actual_result", "environment", "build", "labels"]) {
    assert.match(issues, new RegExp(`updateAiBugDraftField\\("${field}"`));
  }
  assert.match(issues, /Human-edited · unverified/);
  assert.match(issues, /Active AI evidence attribution was removed for the current value/);
  assert.match(issues, /Original proposal only — stale/);
  assert.match(issues, /without AI evidence attribution/);
  assert.match(issues, /does not support the current values of human-edited fields/);
});

test("Defect authoring controls expose checkbox semantics, stable pane focus, contrast, and mobile safe area", async () => {
  const [issues, issueStyles, modalStyles] = await Promise.all([
    readSource("../src/pages/IssuesPage.tsx"),
    readSource("../src/pages/IssuesPage.css"),
    readSource("../src/modal-system.css")
  ]);

  assert.match(issues, /aria-labelledby=\{labelId\} className="impact-checkbox-list" role="group"/);
  assert.doesNotMatch(issues, /role="listbox"/);
  assert.match(issues, /aria-controls=\{controlsId\}/);
  assert.match(issues, /id=\{aiBugContextPaneId\}/);
  assert.match(issues, /restoreAiBugContextToggleFocusRef/);
  assert.match(issues, /aiBugContextPaneToggleRef\.current\?\.focus\(\)/);
  assert.match(issueStyles, /:root\[data-theme="dark"\] \.ai-bug-evidence-sources article > span \{\s*color: #85b8ff;/);
  assert.match(modalStyles, /\.ai-authoring-dialog--bugs \.ai-bug-draft-footer \{\s*padding-bottom: max\(10px, env\(safe-area-inset-bottom\)\) !important;/);
});

test("Defect creation is project scoped and AI review can yield space to findings", async () => {
  const [issues, insightDialog, insightStyles] = await Promise.all([
    readSource("../src/pages/IssuesPage.tsx"),
    readSource("../src/components/AiInsightPreviewDialog.tsx"),
    readSource("../src/components/AiInsightPreviewDialog.css")
  ]);

  assert.match(issues, /const buildIssuePayload = \(draft: IssueDraft, userId: string, projectId: string, can: \(permission: string\) => boolean\) => \(\{\s*project_id: projectId,/);
  assert.match(issues, /buildIssuePayload\(draft, session\.user\.id, projectId, can\)/);
  assert.match(issues, /value=\{selectedItem\.display_id \|\| selectedItem\.jira_bug_key \|\| selectedItem\.id\}/);
  assert.match(issues, /closedIssueIdRef\.current = selectedIssueId/);
  assert.match(issues, /closedIssueIdRef\.current === requestedIssueId/);
  assert.match(insightDialog, /isFlowPaneCollapsed/);
  assert.match(insightDialog, /Collapse AI process and provenance/);
  assert.match(insightStyles, /\.ai-insight-preview-dialog\.is-flow-pane-collapsed \.ai-insight-preview-workbench/);
});
