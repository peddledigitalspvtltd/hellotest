import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

const countMatches = (source, pattern) => source.match(pattern)?.length || 0;

test("agent workbench exposes every governed QA specialist as a first-class action", async () => {
  const component = await readSource("../src/components/AgenticExperience.tsx");
  const page = await readSource("../src/pages/AgenticWorkflowsPage.tsx");
  const directory = await readSource("../src/agents/AgentDirectory.tsx");

  for (const specialist of [
    "Quality Orchestrator",
    "Story Architect",
    "Test Design Agent",
    "Automation Engineer",
    "Smart Run Planner",
    "Failure Analyst",
    "Bug Reporter",
    "Bug Triage Agent",
    "Quality Evaluator",
    "Object Repository Curator"
  ]) {
    assert.match(component, new RegExp(specialist));
  }

  assert.match(component, /aria-label="Review format"/);
  assert.match(component, /\/>\s*Question\s*</);
  assert.match(component, /\/>\s*Review brief\s*</);
  assert.match(directory, /HELLOTEST_AGENT_CATALOG\.map/);
  assert.match(page, /<AgentDirectory/);
  assert.match(page, /onOpenSpecialist=\{openAgentWorkbench\}/);
  assert.match(page, /<AgentActivityTimeline/);
  assert.match(page, /<AgenticOutcomePanel/);
  assert.match(page, /Create workflow draft/);
  assert.match(page, /setAssistantContextScopes\(agent\.contextScopes\)/);
  assert.match(component, /contextScopes: \["stories", "test-cases", "knowledge"\]/);
});

test("AI Agents has a dedicated sidebar catalog and opens a focused specialist Workbench", async () => {
  const [page, sections, shell] = await Promise.all([
    readSource("../src/pages/AgenticWorkflowsPage.tsx"),
    readSource("../src/lib/workspaceSections.ts"),
    readSource("../src/components/AppShell.tsx")
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
  const component = await readSource("../src/components/AgenticExperience.tsx");

  for (const stage of ["Intent understood", "Context built", "Guardrails applied", "Specialist analysis", "Outcome produced", "Output evaluated"]) {
    assert.match(component, new RegExp(stage));
  }

  for (const metric of ["Grounding", "Complete", "Traceable", "Guarded", "Evidence review diagnostics"]) {
    assert.match(component, new RegExp(metric));
  }

  assert.match(component, /Human decision/);
  assert.match(component, /Decision summary/);
  assert.match(component, /Evidence-backed findings/);
  assert.match(component, /Specialist deliverables/);
  assert.match(component, /Evidence gaps/);
  assert.match(component, /Why this evidence was selected/);
  assert.doesNotMatch(component, /chain.of.thought/i);
});

test("shared AI surfaces reuse the governed process rail", async () => {
  const files = await Promise.all([
    readSource("../src/components/StoryAiStudioShell.tsx"),
    readSource("../src/components/AiInsightPreviewDialog.tsx"),
    readSource("../src/pages/IssuesPage.tsx"),
    readSource("../src/pages/AutomationPage.tsx"),
    readSource("../src/pages/ExecutionsPage.tsx")
  ]);

  for (const source of files) assert.match(source, /AgenticProcessRail/);
});

test("every AI output is review-first, editable, selectable, and explicitly accepted", async () => {
  const [experience, storyStudio, richText, insights, bugs, automation, executions] = await Promise.all([
    readSource("../src/components/AgenticExperience.tsx"),
    readSource("../src/components/StoryAiStudioShell.tsx"),
    readSource("../src/components/RichTextEditor.tsx"),
    readSource("../src/components/AiInsightPreviewDialog.tsx"),
    readSource("../src/pages/IssuesPage.tsx"),
    readSource("../src/pages/AutomationPage.tsx"),
    readSource("../src/pages/ExecutionsPage.tsx")
  ]);

  assert.match(experience, /export function AiFeatureComposer/);
  assert.match(experience, /Accept agent output/);
  assert.match(experience, /A person can edit, select, accept, or discard/);
  assert.match(storyStudio, /Proposal ready/);
  assert.match(storyStudio, /<AiFeatureComposer/);
  assert.match(richText, /Editable AI proposal/);
  assert.match(richText, /Accept replacement/);
  assert.match(insights, /Editable review sequence/);
  assert.match(insights, /Accept review plan/);
  assert.match(bugs, /Accept into Bug form/);
  assert.match(automation, /What should the agent automate\?/);
  assert.match(automation, /Build step plan/);
  assert.match(automation, /aria-label="Automation step plan"/);
  assert.match(automation, /Save section/);
  assert.match(executions, /Accept reviewed summary/);
  assert.match(executions, /Create AI Smart Run/);
});

test("feature AI surfaces expose an explicit run brief and avoid duplicate mission inputs", async () => {
  const [experience, storyShell, storyPage, testCreate, testImprove, bugs, automation, executions, contextPanel] = await Promise.all([
    readSource("../src/components/AgenticExperience.tsx"),
    readSource("../src/components/StoryAiStudioShell.tsx"),
    readSource("../src/pages/RequirementsPage.tsx"),
    readSource("../src/components/AiDesignStudioModal.tsx"),
    readSource("../src/components/AiCaseAuthoringModal.tsx"),
    readSource("../src/pages/IssuesPage.tsx"),
    readSource("../src/pages/AutomationPage.tsx"),
    readSource("../src/pages/ExecutionsPage.tsx"),
    readSource("../src/components/AiPromptContextPanel.tsx")
  ]);

  assert.match(experience, /Agent run brief/);
  assert.match(storyShell, /Evidence context/);
  assert.match(storyShell, /Output contract/);
  assert.match(storyShell, /Human gate/);

  for (const source of [bugs, executions]) assert.match(source, /briefItems=/);
  assert.match(automation, /value=\{agentMission\}/);
  assert.match(automation, /Additional guidance & execution context/);
  assert.match(automation, /agentBuildReceipt/);
  assert.match(storyPage, /showPromptEditor=\{false\}/);
  assert.match(testImprove, /<AiDesignStudioModal/);
  assert.match(testImprove, /allowMultipleRequirements=\{false\}/);
  assert.match(testImprove, /sourceCase=\{sourceCase\}/);
  assert.match(testCreate, /showPromptEditor\s*\/>/);
  assert.match(testCreate, /Generation Context/);
  assert.match(contextPanel, /showPromptEditor \? \(/);
});

test("core AI authoring flows share the compact context, draft, and generation-flow workspace", async () => {
  const [experience, storyShell, insights, bugs, contextPanel, api] = await Promise.all([
    readSource("../src/components/AgenticExperience.tsx"),
    readSource("../src/components/StoryAiStudioShell.tsx"),
    readSource("../src/components/AiInsightPreviewDialog.tsx"),
    readSource("../src/pages/IssuesPage.tsx"),
    readSource("../src/components/AiPromptContextPanel.tsx"),
    readSource("../src/lib/api.ts")
  ]);

  assert.match(experience, /orientation\?: "horizontal" \| "vertical"/);
  assert.match(experience, /orientation === "vertical" \? profileDefinition\.heading/);
  assert.match(experience, /aria-live="polite"[^>]*className="agent-process-rail__trace"[^>]*role="status"/);
  assert.match(experience, /export function AiEvidenceFlyout/);
  assert.match(experience, /createPortal\(flyout, document\.body\)/);
  assert.match(experience, /aria-haspopup="dialog"/);

  assert.match(storyShell, /story-studio-workbench/);
  assert.match(storyShell, /story-studio-output-workspace/);
  assert.match(storyShell, /orientation="vertical"/);
  assert.match(storyShell, /Proposal ready/);
  assert.match(storyShell, /showModeSwitcher=\{false\}/);
  assert.match(storyShell, /showProviderSelector=\{false\}/);

  assert.match(bugs, /ai-bug-authoring-workbench/);
  assert.match(bugs, /orientation="vertical"/);
  assert.match(bugs, /bounded evidence reference/);
  assert.match(bugs, /This does not measure model certainty/);
  assert.match(bugs, /reference_photos: aiReferenceImages/);
  assert.match(bugs, /showModeSwitcher=\{false\}/);
  assert.match(bugs, /aiDraftMessageTone === "warning" \? "warning-message"/);
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
  assert.match(insights, /no Bug fields were changed/i);
  assert.match(insights, /disabled=\{Boolean\(onAccept\)/);

  assert.match(contextPanel, /linked page content is not fetched/);
  assert.match(contextPanel, /unsupported provider will show a fallback or error/);
});

test("AI context uses accessible tabs while keeping inactive context panels mounted", async () => {
  const contextPanel = await readSource("../src/components/AiPromptContextPanel.tsx");

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

test("AI authoring settings are grouped into progressive disclosures", async () => {
  const [shell, stories, testCreate, testImprove] = await Promise.all([
    readSource("../src/components/StoryAiStudioShell.tsx"),
    readSource("../src/pages/RequirementsPage.tsx"),
    readSource("../src/components/AiDesignStudioModal.tsx"),
    readSource("../src/components/AiCaseAuthoringModal.tsx")
  ]);

  assert.match(shell, /export function StoryAiSettingsGroup/);
  assert.match(shell, /<details[^>]*className="story-studio-settings-group"/);
  assert.match(shell, /<summary>/);
  assert.match(shell, /story-studio-settings-group__body/);

  assert.match(stories, /<StoryAiSettingsGroup/);
  assert.match(stories, /title="Generation setup"/);
  assert.match(stories, /title="Context sources"/);
  assert.match(testCreate, /ai-test-generator-context/);
  assert.match(testCreate, /ai-test-generator-workspace/);
  assert.match(testCreate, /ai-test-generator-intelligence/);
  assert.match(testImprove, /<AiDesignStudioModal/);
  assert.match(testImprove, /studioTitle=\{isCreating \? "AI Draft Test Case" : "AI Improve Test Case"\}/);
  assert.match(testImprove, /sourceCase=\{sourceCase\}/);
});

test("draft browsing is opt-in and opens as an overlay instead of a permanent column", async () => {
  const [shell, styles] = await Promise.all([
    readSource("../src/components/StoryAiStudioShell.tsx"),
    readSource("../src/components/StoryAiStudioShell.css")
  ]);

  assert.match(shell, /useState\(false\)/);
  assert.match(shell, /aria-expanded=\{isQueueOpen\}/);
  assert.match(shell, /Browse \$\{entityLabel\} drafts/);
  assert.match(shell, /\{isQueueOpen \? \(\s*<section[^>]*story-studio-queue-pane/s);
  assert.match(styles, /\.story-studio-queue-pane\s*\{[^}]*position:\s*absolute/s);
  assert.match(styles, /\.story-studio-workbench\s*\{[^}]*grid-template-columns:\s*clamp\([^;]+minmax\(0, 1fr\)[^;]+clamp\(/s);
  assert.match(styles, /\.story-studio-output-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
});

test("compact AI workspaces show four focused phases with evidence in an on-demand flyout", async () => {
  const [experience, storyShell, insights, bugs] = await Promise.all([
    readSource("../src/components/AgenticExperience.tsx"),
    readSource("../src/components/StoryAiStudioShell.tsx"),
    readSource("../src/components/AiInsightPreviewDialog.tsx"),
    readSource("../src/pages/IssuesPage.tsx")
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
  for (const source of [storyShell, insights, bugs]) assert.match(source, /presentation="focused"/);
});

test("feature rails use truthful profiles, backend stage snapshots, and an awaiting-review gate", async () => {
  const experience = await readSource("../src/components/AgenticExperience.tsx");

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

test("Bug authoring defers supporting evidence and draft reasoning until requested", async () => {
  const bugs = await readSource("../src/pages/IssuesPage.tsx");

  assert.match(bugs, /<AiEvidenceButton[^>]*label="Review evidence setup"/);
  assert.match(bugs, /Evidence and impacted scope/);
  assert.match(bugs, /eyebrow="Bug creation · Input evidence"/);
  assert.match(bugs, /eyebrow="Bug creation · Decision evidence"/);
  assert.match(bugs, /title="Bug proposal evidence"/);
  assert.doesNotMatch(bugs, /<details className="ai-bug-input-disclosure">/);
  assert.doesNotMatch(bugs, /<details className="ai-bug-review-details">/);
  assert.doesNotMatch(bugs, /<summary>Evidence and reasoning<\/summary>/);
  assert.match(bugs, /aiDraftPreview \? <button[^>]*>Accept into Bug form<\/button> : null/);
});

test("AI triage review groups findings, actions, and run details into accessible tabs", async () => {
  const insights = await readSource("../src/components/AiInsightPreviewDialog.tsx");

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
