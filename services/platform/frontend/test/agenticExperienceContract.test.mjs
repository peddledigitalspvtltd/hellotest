import { readApiSources } from "./helpers/readApiSources.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

const countMatches = (source, pattern) => source.match(pattern)?.length || 0;

test("agent workbench exposes every governed QA specialist as a first-class action", async () => {
  const component = await readSource("../../../agentic/frontend/components/AgenticExperience.tsx");
  const page = await readSource("../../../agentic/frontend/pages/AgenticWorkflowsPage.tsx");
  const directory = await readSource("../../../agentic/frontend/agents/AgentDirectory.tsx");

  for (const specialist of [
    "Quality Orchestrator",
    "Story Architect",
    "Test Design Agent",
    "Automation Engineer",
    "Smart Run Planner",
    "Failure Analyst",
    "Defect Reporter",
    "Defect Triage Agent",
    "Quality Evaluator",
    "Object Repository Curator"
  ]) {
    const catalog = await readSource("../../../agentic/shared/workflowSpecialists.json");
    assert.match(catalog, new RegExp(specialist));
  }

  assert.match(component, /Start review/);
  assert.doesNotMatch(component, /aria-label="Review format"/);
  assert.match(directory, /HELLOTEST_AGENT_CATALOG\.map/);
  assert.match(page, /<AgentDirectory/);
  assert.match(page, /onOpenSpecialist=\{openAgentWorkbench\}/);
  assert.match(page, /<AgentActivityTimeline/);
  assert.match(page, /<AgenticOutcomePanel/);
  assert.doesNotMatch(page, /Plan a reusable workflow/);
  assert.match(component, /label: "Model calls"/);
  assert.match(page, /setAssistantContextScopes\(agent\.contextScopes\)/);
  assert.match(component, /contextScopes: profile.scopes/);
});

test("AI Agents has a dedicated sidebar catalog and opens a focused specialist Workbench", async () => {
  const [page, sections, shell] = await Promise.all([
    readSource("../../../agentic/frontend/pages/AgenticWorkflowsPage.tsx"),
    readSource("../src/platform/lib/workspaceSections.ts"),
    readSource("../src/platform/components/AppShell.tsx")
  ]);

  assert.match(sections, /view=agents`, label: "AI Agents"/);
  assert.match(shell, /isNavigationDestinationActive\(subItem\.to, location\.pathname, location\.search\)/);
  assert.match(page, /Turn repository source and project evidence into useful quality work/);
  assert.match(page, /Your task/);
  assert.doesNotMatch(page, /on the beach, on a hike, or while you sleep/);
  assert.match(page, /activeSurface === "agents"/);
  assert.match(page, /activeSurface === "workbench"/);
  assert.match(page, /next\.set\("agent", agent\.id\)/);
  assert.doesNotMatch(page, /<AgentWorkflowJourney/);
});

test("agent traces expose evidence and evaluation without hidden reasoning", async () => {
  const component = await readSource("../../../agentic/frontend/components/AgenticExperience.tsx");

  for (const stage of ["Intent understood", "Context built", "Guardrails applied", "Specialist analysis", "Outcome produced", "Output evaluated"]) {
    assert.match(component, new RegExp(stage));
  }

  assert.doesNotMatch(component, /Evidence review diagnostics|className="agent-outcome-evidence"/);

  assert.match(component, /Human decision/);
  assert.match(component, /Outcome summary/);
  assert.match(component, /Findings and supporting evidence/);
  assert.match(component, /Drafts and supporting reports/);
  assert.match(component, /Evidence gaps/);
  assert.match(component, /Why this evidence was selected/);
  assert.doesNotMatch(component, /chain.of.thought/i);
});

test("shared AI surfaces reuse the governed process rail", async () => {
  const files = await Promise.all([
    readSource("../../../ai/frontend/components/StoryAiStudioShell.tsx"),
    readSource("../../../ai/frontend/components/AiInsightPreviewDialog.tsx"),
    readSource("../../../testing/frontend/pages/IssuesPage.tsx"),
    readSource("../../../testing/frontend/pages/ExecutionsPage.tsx")
  ]);

  for (const [index, source] of files.entries()) assert.match(source, index === 2 ? /<StoryAiStudioShell/ : index === 0 ? /<AiGenerationProgress/ : /AgenticProcessRail/);
  assert.match(files[2], /processProfile="bug-create"/);
});

test("every AI output is review-first, editable, selectable, and explicitly accepted", async () => {
  const [experience, storyStudio, richText, insights, bugs, automation, executions] = await Promise.all([
    readSource("../../../agentic/frontend/components/AgenticExperience.tsx"),
    readSource("../../../ai/frontend/components/StoryAiStudioShell.tsx"),
    readSource("../src/platform/components/RichTextEditor.tsx"),
    readSource("../../../ai/frontend/components/AiInsightPreviewDialog.tsx"),
    readSource("../../../testing/frontend/pages/IssuesPage.tsx"),
    readSource("../../../automation/frontend/pages/AutomationPage.tsx"),
    readSource("../../../testing/frontend/pages/ExecutionsPage.tsx")
  ]);

  assert.match(experience, /export function AiFeatureComposer/);
  assert.match(experience, /<AgentArtifactReview[^>]*approvalBlocked=\{review.blockedReason\}/);
  const artifactReview = await readSource("../../../agentic/frontend/agents/AgentArtifactReview.tsx");
  assert.match(artifactReview, /Accept and create/);
  assert.match(artifactReview, /Accept and update Story/);
  assert.match(artifactReview, /!canAccept \|\| !valid/);
  assert.match(experience, /A person can edit, select, accept, or discard/);
  assert.match(storyStudio, /Proposal ready/);
  assert.doesNotMatch(storyStudio, /<AiFeatureComposer/);
  assert.match(storyStudio, /ai-test-generator-footer/);
  assert.match(richText, /Editable AI proposal/);
  assert.match(richText, /Accept replacement/);
  assert.match(insights, /Editable review sequence/);
  assert.match(insights, /Accept review plan/);
  assert.match(bugs, /Accept into Defect form/);
  assert.match(automation, /Build instructions \(optional\)/);
  assert.match(automation, /submitLabel=\{agentScheduledAt \? "Schedule build" : "Build plan"\}/);
  assert.match(automation, /aria-label="Automation step plan"/);
  assert.match(automation, /Save section/);
  assert.match(executions, /Accept reviewed summary/);
  assert.match(executions, /Create AI Smart Run/);
});

test("feature AI surfaces expose an explicit run brief and avoid duplicate mission inputs", async () => {
  const [experience, storyShell, storyPage, testCreate, testImprove, bugs, automation, executions, contextPanel] = await Promise.all([
    readSource("../../../agentic/frontend/components/AgenticExperience.tsx"),
    readSource("../../../ai/frontend/components/StoryAiStudioShell.tsx"),
    readSource("../../../manual/frontend/pages/RequirementsPage.tsx"),
    readSource("../../../ai/frontend/components/AiDesignStudioModal.tsx"),
    readSource("../../../ai/frontend/components/AiCaseAuthoringModal.tsx"),
    readSource("../../../testing/frontend/pages/IssuesPage.tsx"),
    readSource("../../../automation/frontend/pages/AutomationPage.tsx"),
    readSource("../../../testing/frontend/pages/ExecutionsPage.tsx"),
    readSource("../../../ai/frontend/components/AiPromptContextPanel.tsx")
  ]);

  assert.match(experience, /Agent run brief/);
  assert.match(storyShell, /contextLabel/);
  assert.match(storyShell, /ai-test-generator-authoring-tabs/);
  assert.match(storyShell, /Saved changes require your review/);

  assert.match(executions, /briefItems=/);
  for (const prop of ["contextLabel", "outputLabel", "approvalLabel"]) assert.match(bugs, new RegExp(`${prop}=`));
  assert.match(automation, /value=\{agentMission\}/);
  assert.match(automation, /Additional guidance & execution context/);
  assert.match(automation, /agentBuildReceipt/);
  assert.match(storyPage, /showPromptEditor\s*\/>/);
  assert.match(testImprove, /<AiDesignStudioModal/);
  assert.match(testImprove, /allowMultipleRequirements=\{false\}/);
  assert.match(testImprove, /sourceCase=\{sourceCase\}/);
  assert.match(testCreate, /<AiIntentCanvas/);
  assert.match(testCreate, /showPromptEditor=\{false\}/);
  assert.match(testCreate, /Generation Context/);
  assert.match(contextPanel, /showPromptEditor \? \(/);
});

test("core AI authoring flows share the compact context, draft, and generation-flow workspace", async () => {
  const [experience, storyShell, insights, bugs, contextPanel, api] = await Promise.all([
    readSource("../../../agentic/frontend/components/AgenticExperience.tsx"),
    readSource("../../../ai/frontend/components/StoryAiStudioShell.tsx"),
    readSource("../../../ai/frontend/components/AiInsightPreviewDialog.tsx"),
    readSource("../../../testing/frontend/pages/IssuesPage.tsx"),
    readSource("../../../ai/frontend/components/AiPromptContextPanel.tsx"),
    readApiSources()
  ]);

  assert.match(experience, /orientation\?: "horizontal" \| "vertical"/);
  assert.match(experience, /orientation === "vertical" \? profileDefinition\.heading/);
  assert.match(experience, /aria-live="polite"[^>]*className="agent-process-rail__trace"[^>]*role="status"/);
  assert.match(experience, /export function AiEvidenceFlyout/);
  assert.match(experience, /createPortal\(flyout, document\.body\)/);
  assert.match(experience, /aria-haspopup="dialog"/);

  assert.match(storyShell, /story-studio-workbench/);
  assert.match(storyShell, /story-studio-output-workspace/);
  assert.match(storyShell, /<AiGenerationProgress/);
  assert.match(storyShell, /Proposal ready/);
  assert.match(storyShell, /ai-test-generator-authoring-tabs/);
  assert.match(storyShell, /is-intelligence-collapsed/);

  assert.match(bugs, /<StoryAiStudioShell/);
  assert.match(bugs, /processProfile="bug-create"/);
  assert.match(bugs, /bounded evidence reference/);
  assert.match(bugs, /This does not measure model certainty/);
  assert.match(bugs, /reference_photos: aiReferenceImages/);
  assert.match(bugs, /showOutputFormat=\{false\}/);
  assert.match(bugs, /aiDraftMessageTone === "error" \? "error" : "warning-message"/);
  assert.match(bugs, /aiDraftMessage && aiDraftMessageTone === "error" \? "failed"/);
  for (const evidenceSource of [
    /aiLinkedCaseIds\.length/,
    /aiLinkedRequirementIds\.length/,
    /aiReferenceImages\.length/,
    /aiBugExternalLinks\.length/,
    /\(aiLinkedRunId \? 1 : 0\)/,
    /\(aiEvidence\.trim\(\) \? 1 : 0\)/,
    /\(aiAdditionalContext\.trim\(\) \? 1 : 0\)/
  ]) assert.match(bugs, evidenceSource);
  assert.match(bugs, /hasAiBugEvidenceContext = aiBugEvidenceSourceCount > 0/);
  assert.match(api, /reference_photos\?: AiDesignImageInput\[\]/);

  assert.match(insights, /ai-insight-preview-workbench/);
  assert.match(insights, /Acknowledge review/);
  assert.match(insights, /no Defect fields were changed/i);
  assert.match(insights, /disabled=\{Boolean\(onAccept\)/);

  assert.match(contextPanel, /linked page content is not fetched/);
  assert.match(contextPanel, /Reference images/);
});

test("AI context uses accessible tabs while keeping inactive context panels mounted", async () => {
  const contextPanel = await readSource("../../../ai/frontend/components/AiPromptContextPanel.tsx");

  assert.match(contextPanel, /aria-label="Context types"[^>]*role="tablist"/);
  assert.match(contextPanel, /aria-controls=\{`\$\{tabIdPrefix\}-\$\{tab\.id\}-panel`\}/);
  assert.match(contextPanel, /aria-selected=\{activeContextTab === tab\.id\}/);
  assert.match(contextPanel, /role="tab"/);
  assert.match(contextPanel, /tabIndex=\{activeContextTab === tab\.id \? 0 : -1\}/);
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) assert.match(contextPanel, new RegExp(`"${key}"`));

  for (const panel of ["text", "files", "links", "images"]) {
    assert.match(contextPanel, new RegExp(`hidden=\\{activeContextTab !== "${panel}"\\}`));
    assert.match(contextPanel, new RegExp("id=\\{`\\$\\{tabIdPrefix\\}-" + panel + "-panel`\\}"));
  }
  assert.equal(countMatches(contextPanel, /role="tabpanel"/g), 4);
  assert.doesNotMatch(contextPanel, /activeContextTab === "(?:files|links|images)"\s*\?\s*\(/);
});

test("AI authoring settings use visible context and engine sections", async () => {
  const [shell, stories, testCreate, testImprove] = await Promise.all([
    readSource("../../../ai/frontend/components/StoryAiStudioShell.tsx"),
    readSource("../../../manual/frontend/pages/RequirementsPage.tsx"),
    readSource("../../../ai/frontend/components/AiDesignStudioModal.tsx"),
    readSource("../../../ai/frontend/components/AiCaseAuthoringModal.tsx")
  ]);

  assert.match(shell, /export function StoryAiSettingsGroup/);
  assert.match(shell, /<section[^>]*className=\{`story-studio-settings-group ai-test-generator-section/);
  assert.match(shell, /story-studio-settings-group__body/);

  assert.match(stories, /<StoryAiSettingsGroup/);
  assert.match(stories, /title="Intelligence Engine"/);
  assert.match(stories, /title="Generation Context"/);
  assert.match(testCreate, /ai-test-generator-context/);
  assert.match(testCreate, /ai-test-generator-workspace/);
  assert.match(testCreate, /<AiContextPeek[^>]*open=\{contextOpen\}/);
  assert.match(testImprove, /<AiDesignStudioModal/);
  assert.match(testImprove, /studioTitle=\{isCreating \? "AI Draft Test Case" : "AI Improve Test Case"\}/);
  assert.match(testImprove, /sourceCase=\{sourceCase\}/);
});

test("Story drafts use a focused artifact outline with cited evidence in the inspector", async () => {
  const [shell, content, styles] = await Promise.all([
    readSource("../../../ai/frontend/components/StoryAiStudioShell.tsx"),
    readSource("../../../ai/frontend/components/StoryAiStudioContent.tsx"),
    readSource("../../../ai/frontend/components/StoryAiStudioShell.css")
  ]);
  assert.match(shell, /useState\(false\)/);
  assert.doesNotMatch(shell, /intelligenceOpen|Intelligence Status/);
  assert.match(shell, /evidencePlacement: "inspector"/);
  assert.match(shell, /activeContent: inspector/);
  assert.match(content, /ai-artifact-outline/);
  assert.match(content, /ai-artifact-detail story-studio-inspector-scroll/);
  assert.match(content, /onActivateDraft\(draft\.id\)/);
  assert.match(styles, /grid-template-columns: 300px minmax\(0, 1fr\)/);
  assert.match(shell, /statusContent: null/);
  assert.match(shell, /ai-test-generator-toast/);
});

test("compact AI workspaces show four focused phases with evidence in an on-demand flyout", async () => {
  const [experience, storyShell, insights, bugs] = await Promise.all([
    readSource("../../../agentic/frontend/components/AgenticExperience.tsx"),
    readSource("../../../ai/frontend/components/StoryAiStudioShell.tsx"),
    readSource("../../../ai/frontend/components/AiInsightPreviewDialog.tsx"),
    readSource("../../../testing/frontend/pages/IssuesPage.tsx")
  ]);
  const focusedStart = experience.indexOf("const FOCUSED_PROCESS_STAGES");
  const focusedEnd = experience.indexOf("export function AgenticProcessRail", focusedStart);
  const focusedStages = experience.slice(focusedStart, focusedEnd);

  assert.ok(focusedStart >= 0 && focusedEnd > focusedStart, "focused process-stage definition should be present");
  assert.equal(countMatches(focusedStages, /\{ id: /g), 4);
  for (const label of ["Brief", "Context", "Generate", "Review"]) {
    assert.match(focusedStages, new RegExp(`label: "${label}"`));
  }
  assert.match(experience, /presentation\?: "detailed" \| "focused"/);
  assert.match(experience, /presentation === "focused"\s*\?\s*FOCUSED_PROCESS_STAGES/);
  assert.match(experience, /<AiEvidenceFlyout/);
  assert.match(experience, /View full run evidence/);
  assert.doesNotMatch(experience, /<details[^>]*agent-process-rail__details/);
  assert.match(insights, /presentation="focused"/);
  assert.match(storyShell, /<AiGenerationProgress/);
  assert.match(bugs, /<StoryAiStudioShell/);
});

test("feature rails use truthful profiles, backend stage snapshots, and an awaiting-review gate", async () => {
  const experience = await readSource("../../../agentic/frontend/components/AgenticExperience.tsx");

  for (const profile of ["story-create", "story-complete", "bug-create", "smart-run", "bug-triage"]) {
    assert.match(experience, new RegExp(`"${profile}"`));
  }
  assert.match(experience, /processing\?: AgenticProcessingSnapshot/);
  assert.match(experience, /processing\?\.active_stage_id/);
  assert.match(experience, /processing\?\.status_label/);
  assert.match(experience, /role="progressbar"/);
  assert.match(experience, /snapshots\.every\(\(item\) => item\.status === "complete"\)/);
  assert.doesNotMatch(experience, /setInterval\([^)]*runningTrace/);
});

test("Defect authoring defers supporting evidence and draft reasoning until requested", async () => {
  const bugs = await readSource("../../../testing/frontend/pages/IssuesPage.tsx");

  assert.match(bugs, /<AiEvidenceButton[^>]*label="Review evidence setup"/);
  assert.match(bugs, /Evidence and impacted scope/);
  assert.match(bugs, /eyebrow="Defect creation · Input evidence"/);
  assert.match(bugs, /eyebrow="Defect creation · Decision evidence"/);
  assert.match(bugs, /title="Defect proposal evidence"/);
  assert.doesNotMatch(bugs, /<details className="ai-bug-input-disclosure">/);
  assert.doesNotMatch(bugs, /<details className="ai-bug-review-details">/);
  assert.doesNotMatch(bugs, /<summary>Evidence and reasoning<\/summary>/);
  assert.match(bugs, /aiBugMode === "improve" \? "Apply selected fields" : "Accept into Defect form"/);
});

test("Shared AI insight review groups findings, actions, and run details into accessible tabs", async () => {
  const insights = await readSource("../../../ai/frontend/components/AiInsightPreviewDialog.tsx");

  for (const [id, label] of [["findings", "Findings"], ["actions", "Actions"], ["details", "Run details"]]) {
    assert.match(insights, new RegExp(`id: "${id}", label: "${label}"`));
    assert.match(insights, new RegExp(`activeReviewView === "${id}"`));
    assert.match(insights, new RegExp(`\\$\\{reviewTabsId\\}-${id}-panel`));
  }
  assert.match(insights, /aria-label="Review content"[^>]*role="tablist"/);
  assert.match(insights, /aria-controls=\{`\$\{reviewTabsId\}-\$\{view\.id\}-panel`\}/);
  assert.match(insights, /aria-selected=\{activeReviewView === view\.id\}/);
  assert.match(insights, /role="tab"/);
  assert.match(insights, /role="tabpanel"/);
  assert.match(insights, /<AiRunBrief[^>]*[\s\S]*?collapsible/);
});
