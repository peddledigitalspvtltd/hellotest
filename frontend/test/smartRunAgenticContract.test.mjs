import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Smart Run uses the feature-specific agentic rail and a truthful review snapshot", async () => {
  const page = await readSource("../src/pages/ExecutionsPage.tsx");
  const modalStart = page.indexOf("export function ExecutionCreateModal");
  const modalEnd = page.indexOf("function CreateExecutionScheduleModal", modalStart);
  const modal = page.slice(modalStart, modalEnd);

  assert.match(page, /AgenticProcessRail, AiEvidenceButton, AiEvidenceFlyout, AiFeatureComposer/);
  assert.match(modal, /profile="smart-run"/);
  assert.match(modal, /presentation="focused"/);
  assert.match(modal, /processing=\{smartExecutionPreview\?\.processing\}/);
  assert.match(page, /if \(event\.target !== event\.currentTarget\) return;/);
  assert.match(modal, /showModeSwitcher=\{false\}/);
  assert.match(modal, /showProviderSelector=\{false\}/);
  assert.match(modal, /<AiFeatureComposer[\s\S]*?\bembedded\b/);
  assert.match(modal, /mode="agent"/);
  assert.match(modal, /No run has been created|does not create a run/);
  assert.match(modal, /Human review required|Human selection required/);
});

test("Smart Run can rank deterministically without an LLM and sends governed prompt guidance when present", async () => {
  const page = await readSource("../src/pages/ExecutionsPage.tsx");
  const api = await readSource("../src/lib/api.ts");
  const modalStart = page.indexOf("export function ExecutionCreateModal");
  const modalEnd = page.indexOf("function CreateExecutionScheduleModal", modalStart);
  const modal = page.slice(modalStart, modalEnd);
  const generateStart = modal.indexOf("const canGenerateSmartPlan");
  const generateEnd = modal.indexOf("const libraryCaseById", generateStart);

  assert.doesNotMatch(modal.slice(generateStart, generateEnd), /integrations\.length/);
  assert.doesNotMatch(modal, /disabled=\{!projectId \|\| !appTypeId \|\| !integrations\.length/);
  assert.match(page, /prompt_guidance: getPrompt\("ai\.execution\.smart_plan"\) \|\| undefined/);
  assert.match(api, /scope_description\?: string; additional_context\?: string; prompt_guidance\?: string/);
  assert.match(modal, /No direct LLM integration is configured[\s\S]*deterministic risk ranking/);
});

test("Smart Run evidence opens in plan and case flyouts instead of expanding inline", async () => {
  const [page, styles] = await Promise.all([
    readSource("../src/pages/ExecutionsPage.tsx"),
    readSource("../src/execution-run-builder.css")
  ]);
  const modalStart = page.indexOf("export function ExecutionCreateModal");
  const modalEnd = page.indexOf("function CreateExecutionScheduleModal", modalStart);
  const modal = page.slice(modalStart, modalEnd);

  assert.match(modal, /setSmartEvidenceView\(\{ kind: "plan" \}\)/);
  assert.match(modal, /setSmartEvidenceView\(\{ kind: "case", caseId: testCase\.test_case_id \}\)/);
  assert.match(modal, /<AiEvidenceFlyout/);
  assert.match(modal, /activeSmartEvidenceRefs\.has\(record\.ref\)/);
  assert.match(modal, /className="execution-smart-impact-selector"/);
  assert.match(modal, /<article[\s\S]*className=\{\[[\s\S]*"execution-smart-impact-card"/);
  assert.doesNotMatch(modal, /className="execution-smart-provenance"/);
  assert.doesNotMatch(modal, /execution-smart-signal-chip is-evidence/);
  assert.match(styles, /\.execution-smart-evidence-records/);
  assert.match(styles, /\.execution-smart-evidence-boundary/);
});

test("Smart Run frontend contract carries processing, provenance, fingerprints, and real evidence refs", async () => {
  const [types, page, api] = await Promise.all([
    readSource("../src/types.ts"),
    readSource("../src/pages/ExecutionsPage.tsx"),
    readSource("../src/lib/api.ts")
  ]);
  const start = types.indexOf("export type SmartExecutionImpactCase");
  const end = types.indexOf("export type TestSuite", start);
  const smartTypes = types.slice(start, end);

  assert.match(smartTypes, /evidence_refs\?: string\[\]/);
  assert.match(smartTypes, /reason_source\?: "model" \| "deterministic"/);
  assert.match(smartTypes, /evidence\?: Array<AiEvidenceSource/);
  assert.match(smartTypes, /processing\?: AiProcessingSnapshot/);
  assert.match(smartTypes, /input_fingerprint\?: string/);
  assert.match(smartTypes, /acceptance_token: string/);
  assert.match(smartTypes, /requires_human_review\?: boolean/);
  assert.match(smartTypes, /partial_sources: string\[\]/);
  assert.match(smartTypes, /generation_mode\?: "hybrid" \| "deterministic"/);
  assert.match(page, /acceptance_token: smartExecutionPreview\.acceptance_token/);
  assert.match(page, /input_fingerprint: smartExecutionPreview\.input_fingerprint/);
  assert.match(page, /smart_plan: acceptedSmartPlan \|\| undefined/);
  assert.doesNotMatch(page, /default_suite: executionCreateMode === "smart"/);
  assert.match(page, /in Direct impacted scope/);
  assert.match(api, /smart_plan\?: \{ acceptance_token: string; request_id: string; input_fingerprint: string; selected_test_case_ids: string\[\] \}/);
  assert.match(api, /transaction_id\?: string/);
});

test("Smart Run labels direct impacted scope without inventing a Default suite", async () => {
  const page = await readSource("../src/pages/ExecutionsPage.tsx");
  const modalStart = page.indexOf("export function ExecutionCreateModal");
  const modalEnd = page.indexOf("function CreateExecutionScheduleModal", modalStart);
  const modal = page.slice(modalStart, modalEnd);

  assert.match(modal, /Direct impacted scope/);
  assert.match(modal, /no existing suite membership is invented or changed/);
  assert.doesNotMatch(modal, /staged under (?:the built-in )?Default/);
});

test("Test Run tile tracks and identifiers stay bounded", async () => {
  const [page, styles, badge] = await Promise.all([
    readSource("../src/pages/ExecutionsPage.tsx"),
    readSource("../src/styles.css"),
    readSource("../src/components/DisplayIdBadge.tsx")
  ]);

  assert.match(page, /tile-browser-grid execution-run-tile-grid/);
  assert.match(styles, /\.execution-run-tile-grid \{[\s\S]*?repeat\(auto-fill,/);
  assert.match(styles, /\.execution-run-tile-grid \.tile-card-select-row \.display-id-badge code \{[\s\S]*?text-overflow: ellipsis/);
  assert.match(badge, /title=\{title \|\| formattedValue\}/);
});
