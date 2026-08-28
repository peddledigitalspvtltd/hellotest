import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Knowledge RAG types and API keep ingestion, retrieval, collection, and assistant contracts centralized", async () => {
  const [types, api] = await Promise.all([
    readSource("../src/types.ts"),
    readSource("../src/lib/api.ts")
  ]);

  for (const typeName of [
    "KnowledgeIngestionRequest",
    "KnowledgeIngestionResponse",
    "KnowledgeSource",
    "KnowledgeDocument",
    "KnowledgeCollection",
    "KnowledgeSearchResponse",
    "KnowledgeCitation",
    "KnowledgeProcessingNotice",
    "KnowledgeAssistantIntegration",
    "KnowledgeAssistantMessage",
    "KnowledgeAssistantSession",
    "KnowledgeOverview"
  ]) {
    assert.match(types, new RegExp(`export type ${typeName}`));
  }
  assert.match(types, /KnowledgeSelectedRecords[\s\S]*requirements: string\[\][\s\S]*test_cases: string\[\][\s\S]*executions: string\[\][\s\S]*bugs: string\[\]/);
  assert.match(types, /"product_help"/);
  assert.match(types, /KnowledgeProcessingNotice[\s\S]*code\?: string \| null[\s\S]*message\?: string \| null[\s\S]*source_id\?: string \| null[\s\S]*input_index\?: number \| null/);
  assert.match(types, /errors\?: KnowledgeProcessingNotice\[\][\s\S]*warnings\?: KnowledgeProcessingNotice\[\]/);

  const start = api.indexOf("knowledgeRepo:");
  const section = api.slice(start, api.indexOf("issues:", start));
  for (const endpoint of [
    "/knowledge/ingestions",
    "/knowledge/search",
    "/knowledge/sources",
    "/knowledge/collections",
    "/knowledge/assistant/integrations",
    "/knowledge/assistant/sessions"
  ]) {
    assert.match(section, new RegExp(endpoint.replaceAll("/", "\\/")));
  }
  assert.match(section, /projects\/\$\{projectId\}\/knowledge\/overview/);
  assert.match(section, /formData\.set\("file", file\)/);
  assert.match(section, /formData\.set\("extracted_text", extractedText\.trim\(\)\)/);
  assert.match(section, /Idempotency-Key/);
  assert.match(section, /deleteSource:[\s\S]*\/knowledge\/sources\/\$\{id\}[\s\S]*method: "DELETE"/);
  assert.match(section, /downloadSource:[\s\S]*requestBlob/);
  assert.match(section, /createSession:[\s\S]*integration_id\?: string/);
  assert.match(section, /sendMessage:[\s\S]*integration_id\?: string/);
  assert.match(section, /sendMessage:[\s\S]*210_000/);
});

test("Context Studio builds exact application-record scopes and distinguishes stored media from indexed text", async () => {
  const studio = await readSource("../src/components/KnowledgeContextStudio.tsx");

  for (const sourceKey of ["requirements", "test_cases", "executions", "bugs"]) {
    assert.match(studio, new RegExp(`key: "${sourceKey}"`));
  }
  for (const state of ["extractable", "needs_caption", "needs_transcript", "needs_text", "unsupported", "too_large"]) {
    assert.match(studio, new RegExp(`"${state}"`));
  }
  assert.match(studio, /URLs are stored as references only/);
  assert.match(studio, /A stored file is not marked searchable until text has been extracted, chunked, embedded, and indexed/);
  assert.match(studio, /Process context/);
  assert.match(studio, /selected_records: selectedRecords/);
  assert.doesNotMatch(studio, /integration_id: selectedIntegration\?\.id/);
});

test("Context Studio exposes hybrid retrieval, citations, reusable collections, exact job states, and source readiness", async () => {
  const studio = await readSource("../src/components/KnowledgeContextStudio.tsx");

  assert.match(studio, /"hybrid"/);
  assert.match(studio, /Search & validate/);
  assert.match(studio, /Citable source/);
  assert.match(studio, /Save .*source.* to collection/);
  assert.match(studio, /Context collections/);
  assert.match(studio, /Source inventory/);
  assert.match(studio, /Indexed & searchable/);
  assert.match(studio, /Caption required/);
  assert.match(studio, /Transcript required/);
  assert.match(studio, /\["completed", "completed_with_warnings", "failed"\]/);
  assert.match(studio, /processed_count \?\? job\.processed_sources/);
  assert.match(studio, /const warningMessages = \(job\.warnings \|\| \[\]\)\.map\(processingNoticeText\)/);
  assert.match(studio, /const errorMessages = \(job\.errors \|\| \[\]\)\.map\(processingNoticeText\)/);
  assert.match(studio, /typeof notice === "string"/);
  assert.match(studio, /job\.config\?\.title/);
  assert.match(studio, /api\.knowledgeRepo\.deleteSource\(id\)/);
  assert.match(studio, /buildAttemptRef/);
  assert.match(studio, /max_extractable_bytes/);
  assert.match(studio, /result\.source_kind !== "product_help"/);
  assert.match(studio, /setSelectedSearchSources\(\[\]\);[\s\S]*searchMutation\.mutate\(\)/);
  assert.doesNotMatch(studio, /job\.error(?!s)/);
});

test("Floating assistant selects project-safe configured models and renders grounded/refused states with citations", async () => {
  const [assistant, shell] = await Promise.all([
    readSource("../src/components/GroundedAssistant.tsx"),
    readSource("../src/components/AppShell.tsx")
  ]);

  assert.match(assistant, /hasPermission\(session, "knowledge\.view", projectId\)/);
  assert.match(assistant, /areFeatureFlagsEnabled\(featureFlagsQuery\.data, \["hellotest\.ai\.knowledge"\]\)/);
  assert.match(assistant, /if \(!canUseAssistant\) return null/);
  assert.match(assistant, /Current project only/);
  assert.match(assistant, /all project sources \+ HelloTest help/);
  assert.match(assistant, /const apiSourceKinds = requestSourceKinds\.length === DEFAULT_ASSISTANT_SOURCE_KINDS\.length/);
  assert.match(assistant, /"product_help"/);
  assert.match(assistant, /requestSourceKinds\.includes\("text"\) \? \["knowledge_item"\]/);
  assert.match(assistant, /source_kinds: apiSourceKinds/);
  assert.match(assistant, /api\.knowledgeRepo\.assistant\.listIntegrations\(projectId\)/);
  assert.match(assistant, /integration\.scope === "workspace"/);
  assert.match(assistant, /integration\.scope === "project" && integration\.project_id === projectId/);
  assert.match(assistant, /integration\.is_default/);
  assert.match(assistant, /ASSISTANT_LLM_SELECTION_STORAGE_PREFIX/);
  assert.match(assistant, /session\?\.user\.id[\s\S]*projectId/);
  assert.match(assistant, /aria-label="Answer model"/);
  assert.match(assistant, /grounded-assistant-model-select[\s\S]*Start a new assistant chat/);
  assert.match(assistant, /integration_id: integrationId/);
  assert.match(assistant, /integrationId: requestIntegrationId/);
  assert.match(assistant, /retry\?\.integrationId \|\| selectedIntegrationId/);
  assert.match(assistant, /citation\.title \|\| citation\.label/);
  assert.match(assistant, /grounding_status/);
  assert.match(assistant, /Request blocked/);
  assert.match(assistant, /Insufficient context/);
  assert.doesNotMatch(assistant, /api\.integrations\.list/);
  assert.doesNotMatch(assistant, /loading-state-spinner/);
  assert.doesNotMatch(assistant.toLowerCase(), /chain.of.thought/);
  assert.match(assistant, /scopeGenerationRef/);
  assert.match(assistant, /requestControllerRef\.current\?\.abort\(\)/);
  assert.match(assistant, /if \(isStale\(\)\) return/);
  assert.match(assistant, /signal: controller\.signal/);
  assert.match(assistant, /client_turn_id: clientTurnId/);
  assert.match(assistant, /api\.knowledgeRepo\.downloadSource/);
  assert.match(assistant, /citation\.uri \|\| citation\.source_uri/);
  assert.match(assistant, /Retry this turn/);
  assert.match(assistant, /grounded-assistant-agent-status/);
  assert.match(shell, /<GroundedAssistant \/>/);
});

test("Knowledge embeddings and governed assistant prompt are configurable without moving secrets", async () => {
  const [integrations, registry, styles, assistantStyles] = await Promise.all([
    readSource("../src/pages/IntegrationsPage.tsx"),
    readSource("../src/lib/aiPromptRegistry.ts"),
    readSource("../src/components/KnowledgeContextStudio.css"),
    readSource("../src/components/GroundedAssistant.css")
  ]);

  assert.match(integrations, /embedding_model: string/);
  assert.match(integrations, /embedding_base_url: string/);
  assert.match(integrations, /llm_project_id: typeof config\.project_id === "string" \? config\.project_id : ""/);
  assert.match(integrations, /draft\.llm_project_id\.trim\(\) \? \{ project_id: draft\.llm_project_id\.trim\(\) \} : \{\}/);
  assert.match(integrations, /embedding_model: draft\.embedding_model\.trim\(\) \|\| null/);
  assert.match(integrations, /embedding_base_url: draft\.embedding_base_url\.trim\(\) \|\| null/);
  assert.match(integrations, /Secrets continue to use the API Key field/);
  assert.match(registry, /key: "ai\.knowledge\.assistant"/);
  assert.match(registry, /Project-grounded Ask HelloTest assistant/);
  assert.match(styles, /:root\[data-theme="dark"\]/);
  assert.match(styles, /@media \(max-width: 620px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(assistantStyles, /@media \(max-width: 620px\)/);
  assert.match(assistantStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(assistantStyles, /\.grounded-assistant-model-select/);
  assert.match(assistantStyles, /\.grounded-assistant-agent-status/);
  assert.match(assistantStyles, /position: sticky/);
});
