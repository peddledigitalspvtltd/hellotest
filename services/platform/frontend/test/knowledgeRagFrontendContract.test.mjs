import { readApiSources } from "./helpers/readApiSources.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Knowledge RAG types and API keep ingestion, retrieval, collection, and assistant contracts centralized", async () => {
  const [types, api] = await Promise.all([
    readSource("../src/types.ts"),
    readApiSources()
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
    "KnowledgeAnswerStructure",
    "KnowledgeAssistantMessage",
    "KnowledgeAssistantSession",
    "KnowledgeOverview"
  ]) {
    assert.match(types, new RegExp(`export type ${typeName}`));
  }
  assert.match(types, /KnowledgeSelectedRecords[\s\S]*requirements: string\[\][\s\S]*test_cases: string\[\][\s\S]*executions: string\[\][\s\S]*bugs: string\[\]/);
  assert.match(types, /"product_help"/);
  assert.match(types, /KnowledgeProcessingNotice[\s\S]*code\?: string \| null[\s\S]*message\?: string \| null[\s\S]*source_id\?: string \| null[\s\S]*input_index\?: number \| null[\s\S]*retryable\?: boolean[\s\S]*error_fingerprint\?: string \| null/);
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
  assert.match(section, /retry: \(id: string\)[\s\S]*\/knowledge\/ingestions\/\$\{id\}\/retry[\s\S]*method: "POST"/);
  assert.match(section, /deleteSource:[\s\S]*\/knowledge\/sources\/\$\{id\}[\s\S]*method: "DELETE"/);
  assert.match(section, /downloadSource:[\s\S]*requestBlob/);
  assert.match(section, /createSession:[\s\S]*integration_id\?: string/);
  assert.match(section, /sendMessage:[\s\S]*integration_id\?: string/);
  assert.match(section, /sendMessage:[\s\S]*210_000/);
});

test("Context Studio builds exact application-record scopes and distinguishes stored media from indexed text", async () => {
  const studio = await readSource("../../../knowledge/frontend/components/KnowledgeContextStudio.tsx");

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
  const studio = await readSource("../../../knowledge/frontend/components/KnowledgeContextStudio.tsx");

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
  assert.match(studio, /Retry retained source/);
  assert.match(studio, /api\.knowledgeRepo\.ingestions\.retry\(id\)/);
  assert.match(studio, /error_fingerprint\.trim\(\)\.slice\(0, 12\)/);
  assert.match(studio, /typeof notice === "string"/);
  assert.match(studio, /job\.config\?\.title/);
  assert.match(studio, /api\.knowledgeRepo\.deleteSource\(id\)/);
  assert.match(studio, /buildAttemptRef/);
  assert.match(studio, /max_extractable_bytes/);
  assert.match(studio, /result\.source_kind !== "product_help"/);
  assert.match(studio, /setSelectedSearchSources\(\[\]\);[\s\S]*searchMutation\.mutate\(\)/);
  assert.match(studio, /<LoadingState/);
  assert.match(studio, /Recent embedding fallback/);
  assert.match(studio, /Context refresh recommended/);
  assert.doesNotMatch(studio, /loading-state-spinner/);
  assert.doesNotMatch(studio, /job\.error(?!s)/);
});

test("Floating assistant selects project-safe configured models and renders grounded/refused states with citations", async () => {
  const [assistant, shell] = await Promise.all([
    readSource("../../../chatbot/frontend/components/GroundedAssistant.tsx"),
    readSource("../src/platform/components/AppShell.tsx")
  ]);

  assert.match(assistant, /hasPermission\(session, "knowledge\.view", projectId\)/);
  assert.match(assistant, /areFeatureFlagsEnabled\(featureFlagsQuery\.data, \["hellotest\.ai\.knowledge", "hellotest\.ai\.chatbot"\]\)/);
  assert.match(assistant, /if \(!canUseAssistant\) return null/);
  assert.match(assistant, /Sources are limited to this project/);
  assert.match(assistant, /live project \+ all Knowledge Repository sources/);
  assert.match(assistant, /<KnowledgeTurnProgress events=\{progressEvents\}/);
  assert.match(assistant, /chatbotApi\.assistant\.streamMessage/);
  assert.match(assistant, /message\.retrieval\.context_route\?\.input_type/);
  assert.match(assistant, /message\.retrieval\.context_route\?\.query_category/);
  assert.match(assistant, /message\.retrieval\?\.answer_structure/);
  assert.match(assistant, /Structured grounded answer/);
  assert.match(assistant, /Evidence plan/);
  assert.match(assistant, /message\.retrieval\.live_context_count/);
  assert.match(assistant, /Each answer connects its findings to the sources you can review/);
  assert.match(assistant, /const apiSourceKinds = useMemo\(\(\) => sourceKinds\.length === DEFAULT_ASSISTANT_SOURCE_KINDS\.length/);
  assert.match(assistant, /const requestApiSourceKinds = requestSourceKinds\.length === DEFAULT_ASSISTANT_SOURCE_KINDS\.length/);
  assert.match(assistant, /"product_help"/);
  assert.match(assistant, /sourceKinds\.includes\("text"\) \? \["knowledge_item"\]/);
  assert.match(assistant, /source_kinds: requestApiSourceKinds/);
  assert.match(assistant, /<SmartContextWorkbench/);
  assert.match(assistant, /reviewed_context: requestSmartContext\.contextText/);
  assert.match(assistant, /Evidence only · no model/);
  assert.match(assistant, /chatbotApi\.assistant\.listIntegrations\(projectId\)/);
  assert.match(assistant, /integration\.scope === "workspace"/);
  assert.match(assistant, /integration\.scope === "project" && integration\.project_id === projectId/);
  assert.match(assistant, /integration\.is_default/);
  assert.match(assistant, /resolveAiLlmDefault\(\{ preferences: promptRegistryQuery\.data\?\.preferences, usageKey: "ai\.knowledge\.assistant", projectId/);
  assert.match(assistant, /userSelectedIntegration\.current \? current : nextIntegrationId/);
  assert.doesNotMatch(assistant, /localStorage\.setItem/);
  assert.match(assistant, /if \(isOpen\) void promptRegistryQuery\.refetch\(\)/);
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
  assert.match(assistant, /knowledgeApi\.knowledgeRepo\.downloadSource/);
  assert.match(assistant, /knowledgeCitationHref\(citation\)/);
  assert.match(assistant, /Retry this turn/);
  assert.match(assistant, /resumePendingKnowledgeTurn/);
  assert.match(shell, /<GroundedAssistant \/>/);
});

test("Smart Context is reviewable, project-governed, and restricted to approved AI and agentic workflows", async () => {
  const [workbench, promptPanel, experience, workflows, sharedSteps, richText, testData, dashboard, issues, storyStudio, executions, api, designStudio] = await Promise.all([
    readSource("../../../ai/frontend/components/SmartContextWorkbench.tsx"),
    readSource("../../../ai/frontend/components/AiPromptContextPanel.tsx"),
    readSource("../../../agentic/frontend/components/AgenticExperience.tsx"),
    readSource("../../../agentic/frontend/pages/AgenticWorkflowsPage.tsx"),
    readSource("../../../testing/frontend/pages/SharedStepsPage.tsx"),
    readSource("../src/platform/components/RichTextEditor.tsx"),
    readSource("../../../testing/frontend/pages/TestEnvironmentPage.tsx"),
    readSource("../../../dashboard/frontend/components/CustomQualityDashboard.tsx"),
    readSource("../../../testing/frontend/pages/IssuesPage.tsx"),
    readSource("../../../ai/frontend/components/StoryAiStudioShell.tsx"),
    readSource("../../../testing/frontend/pages/ExecutionsPage.tsx"),
    readApiSources(),
    readSource("../../../ai/frontend/lib/aiDesignStudio.ts")
  ]);

  assert.match(workbench, /useCapabilityAccess\(projectId\)/);
  assert.match(workbench, /can\("knowledge\.view"\)/);
  assert.match(workbench, /knowledgeApi\.knowledgeRepo\.search\(\{[\s\S]*mode: "hybrid"/);
  assert.match(workbench, /Project ACL enforced/);
  assert.match(workbench, /Retrieved evidence/);
  assert.match(workbench, /type="checkbox"/);
  assert.match(workbench, /Select all/);
  assert.match(workbench, /aria-label="Editable Smart Context"/);
  assert.match(workbench, /Only this reviewed pack is applied/);
  assert.match(workbench, /HELLOTEST_SMART_CONTEXT_START/);
  assert.match(workbench, /sourceIds, sourceKinds, chunkIds/);

  assert.match(promptPanel, /<SmartContextWorkbench/);
  assert.match(experience, /enableSmartContext \? \([\s\S]*<SmartContextWorkbench/);
  assert.match(issues, /<AiPromptContextPanel[\s\S]*promptScope="bug_creation"/);
  assert.doesNotMatch(issues, /<SmartContextWorkbench/);
  assert.doesNotMatch(issues, /aiBugTriageSmartContext/);
  assert.match(storyStudio, /\{settingsPane\}/);
  assert.match(promptPanel, /<SmartContextWorkbench/);
  assert.match(executions, /label="Change intent"[\s\S]*Smart Run Drafts/);
  assert.doesNotMatch(executions.slice(executions.indexOf("export function ExecutionCreateModal"), executions.indexOf("function CreateExecutionScheduleModal")), /agentName="Smart Run Planner"/);
  assert.doesNotMatch(sharedSteps, /<SmartContextWorkbench/);
  assert.doesNotMatch(richText, /<SmartContextWorkbench/);
  assert.doesNotMatch(testData, /<SmartContextWorkbench/);
  assert.doesNotMatch(dashboard, /<SmartContextWorkbench/);
  assert.match(workflows, /smart_context: canUseKnowledge && assistantSmartContext \?/);
  assert.match(workflows, /source_ids: assistantSmartContext\.sourceIds/);
  assert.match(workflows, /reviewed_context: assistantSmartContext\.contextText/);
  assert.match(await readSource("../../../agentic/frontend/workflows/WorkflowNodeInspector.tsx"), /knowledgeQuery: selection\.query/);
  assert.match(api, /smart_context\?: \{[\s\S]*source_ids\?: string\[\][\s\S]*reviewed_context\?: string/);
  assert.match(api, /sendMessage:[\s\S]*smart_context\?:/);
  assert.match(designStudio, /export const replaceSmartContextPack/);
  assert.match(designStudio, /const base = stripSmartContextPack\(current\)/);
});

test("Knowledge retrieval reuses the governed LLM configuration without separate embedding controls", async () => {
  const [integrations, registry, styles, assistantStyles] = await Promise.all([
    readSource("../../../integration/frontend/pages/IntegrationsPage.tsx"),
    readSource("../../../integration/frontend/lib/aiPromptRegistry.ts"),
    readSource("../../../knowledge/frontend/components/KnowledgeContextStudio.css"),
    readSource("../../../chatbot/frontend/components/GroundedAssistant.css")
  ]);

  assert.doesNotMatch(integrations, /embedding_model: string/);
  assert.doesNotMatch(integrations, /embedding_base_url: string/);
  assert.match(integrations, /llm_project_id: typeof config\.project_id === "string" \? config\.project_id : ""/);
  assert.match(integrations, /draft\.llm_project_id\.trim\(\) \? \{ project_id: draft\.llm_project_id\.trim\(\) \} : \{\}/);
  assert.match(integrations, /Knowledge retrieval reuses this LLM model, Base URL, and API key/);
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
