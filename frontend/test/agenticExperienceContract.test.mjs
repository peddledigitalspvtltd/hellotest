import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("agent workbench exposes every governed QA specialist as a first-class action", async () => {
  const component = await readSource("../src/components/AgenticExperience.tsx");
  const page = await readSource("../src/pages/AgenticWorkflowsPage.tsx");

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

  assert.match(component, /aria-label="AI interaction mode"/);
  assert.match(component, /\/>\s*Chat\s*</);
  assert.match(component, /\/>\s*Agent\s*</);
  assert.match(page, /<AgentCatalog/);
  assert.match(page, /<AgentActivityTimeline/);
  assert.match(page, /<AgenticOutcomePanel/);
  assert.match(page, /Turn into workflow/);
});

test("agent traces expose evidence and evaluation without hidden reasoning", async () => {
  const component = await readSource("../src/components/AgenticExperience.tsx");

  for (const stage of ["Intent understood", "Context built", "Guardrails applied", "Specialist analysis", "Outcome produced", "Output evaluated"]) {
    assert.match(component, new RegExp(stage));
  }

  for (const metric of ["Grounding", "Complete", "Traceable", "Guarded", "maturity"]) {
    assert.match(component, new RegExp(metric));
  }

  assert.match(component, /Human decision/);
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
  assert.match(storyStudio, /Proposal ready for selection and editing/);
  assert.match(storyStudio, /<AiFeatureComposer/);
  assert.match(richText, /Editable AI proposal/);
  assert.match(richText, /Accept replacement/);
  assert.match(insights, /Editable review sequence/);
  assert.match(insights, /Accept review plan/);
  assert.match(bugs, /Accept into Bug form/);
  assert.match(automation, /Accept plan/);
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

  for (const source of [bugs, automation, executions]) assert.match(source, /briefItems=/);
  for (const source of [storyPage, testCreate, testImprove]) assert.match(source, /showPromptEditor=\{false\}/);
  assert.match(contextPanel, /showPromptEditor \? \(/);
});
