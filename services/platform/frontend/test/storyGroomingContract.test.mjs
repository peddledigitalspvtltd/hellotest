import { readApiSources } from "./helpers/readApiSources.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

function topLevelTypeBlock(source, typeName) {
  const marker = `export type ${typeName} = {`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${typeName} should be exported`);
  const end = source.indexOf("\n};", start);
  assert.ok(end > start, `${typeName} should have a complete type block`);
  return source.slice(start, end + 3);
}

function nestedTypeBlock(source, key) {
  const marker = `  ${key}: {`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${key} should be present`);
  const end = source.indexOf("\n  };", start);
  assert.ok(end > start, `${key} should have a complete section contract`);
  return source.slice(start, end + 5);
}

test("Story grooming exposes an optional seven-section walkthrough without breaking the readiness contract", async () => {
  const types = await readSource("../src/types.ts");
  const api = await readApiSources();

  for (const status of ["ready-for-planning", "needs-clarification", "not-ready"]) {
    assert.match(types, new RegExp(`StoryGroomingReadinessStatus[^;]+${status}`));
  }
  for (const status of ["met", "partial", "missing"]) {
    assert.match(types, new RegExp(`StoryGroomingReadinessCheckStatus[^;]+${status}`));
  }

  for (const optionalArray of [
    "stakeholders",
    "outcomes",
    "success_measures",
    "acceptance_criteria",
    "dependencies",
    "constraints",
    "edge_cases",
    "security_and_privacy",
    "observability"
  ]) {
    assert.match(types, new RegExp(`${optionalArray}\\?: string\\[\\]`), optionalArray);
  }

  const walkthrough = topLevelTypeBlock(types, "StoryGroomingWalkthrough");
  const expectedSections = {
    purpose: ["summary", "why_needed", "expected_outcomes", "evidence_refs"],
    user_journey: ["summary", "actors", "trigger", "steps", "alternate_paths", "evidence_refs"],
    business_impact: ["summary", "stakeholders", "value_outcomes", "success_measures", "evidence_refs"],
    solution_design: ["overview", "behaviors", "rules", "dependencies", "constraints", "evidence_refs"],
    implementation: ["overview", "components", "data", "integrations", "quality_requirements", "evidence_refs"],
    validation: ["summary", "acceptance_criteria", "test_scenarios", "linked_test_coverage", "evidence_refs"],
    remaining: ["summary", "gaps", "questions", "decisions", "actions", "risks", "evidence_refs"]
  };

  for (const [sectionName, fields] of Object.entries(expectedSections)) {
    const section = nestedTypeBlock(walkthrough, sectionName);
    for (const field of fields) {
      assert.match(section, new RegExp(`\\b${field}: (?:string|string\\[\\])`), `${sectionName}.${field}`);
    }
  }
  assert.match(nestedTypeBlock(walkthrough, "user_journey"), /use_cases\?: string\[\]/);
  assert.match(nestedTypeBlock(walkthrough, "validation"), /edge_cases\?: string\[\]/);

  assert.match(types, /walkthrough\?: StoryGroomingWalkthrough/);
  assert.match(types, /scope\?: StoryGroomingScope/);
  assert.match(types, /readiness\?: StoryGroomingReadiness/);
  assert.match(types, /checks\?: StoryGroomingReadinessCheck\[\]/);
  assert.match(types, /external_references: number/);
  assert.match(api, /previewGrooming: \(id: string, input: \{ project_id: string; integration_id\?: string; prompt_guidance\?: string; additional_context\?: string; proposed_change\?: Record<string, unknown> \}\)/);
});

test("Story grooming prompt requires an evidence-grounded end-to-end walkthrough and forbids invention", async () => {
  const registry = await readSource("../../../integration/frontend/lib/aiPromptRegistry.ts");
  const start = registry.indexOf('key: "ai.requirement.grooming"');
  const end = registry.indexOf("\n  },", start);
  const groomingPrompt = registry.slice(start, end);

  assert.ok(start >= 0 && end > start, "Story grooming prompt should be registered");
  for (const requirement of [
    /decision-ready, end-to-end feature walkthrough/i,
    /only the selected Story and bounded delivery evidence/i,
    /plain-language purpose and why the feature is needed/i,
    /actors, trigger, ordered user journey/i,
    /business impact, stakeholders, value outcomes, and measurable success/i,
    /solution design[^.]+distinct from implementation/i,
    /validation with acceptance criteria, test scenarios, and linked coverage/i,
    /Finish with what remains: gaps, questions, decisions, actions, risks/i,
    /Definition of Ready status/i,
    /Every asserted fact must cite/i,
    /return empty content when a topic is unsupported/i,
    /never repeat the Story description as filler/i,
    /never invent controls, architecture, components, or delivery scope/i,
    /keep each section concise, distinct, and ordered by review importance/i
  ]) {
    assert.match(groomingPrompt, requirement);
  }
});

test("Story grooming uses six accessible, mounted review tabs with roving keyboard focus", async () => {
  const component = await readSource("../../../ai/frontend/components/StoryGroomingWorkspace.tsx");

  for (const [key, label] of [
    ["story", "Story"],
    ["business", "Business"],
    ["solution", "Solution"],
    ["validation", "Validation"],
    ["remaining", "Remaining"],
    ["evidence", "Evidence"]
  ]) {
    assert.match(component, new RegExp(`key: "${key}"[^\\n]+shortLabel: "${label}"`));
    assert.match(component, new RegExp(`hidden=\\{activeTab !== "${key}"\\}`));
    assert.match(component, new RegExp(`id="story-grooming-panel-${key}"`));
    assert.match(component, new RegExp(`aria-labelledby="story-grooming-tab-${key}"`));
  }

  assert.match(component, /aria-label="Grooming brief sections"[^>]*role="tablist"/);
  assert.match(component, /aria-controls=\{`story-grooming-panel-\$\{tab\.key\}`\}/);
  assert.match(component, /aria-selected=\{activeTab === tab\.key\}/);
  assert.match(component, /tabIndex=\{activeTab === tab\.key \? 0 : -1\}/);
  assert.match(component, /role="tab"/);
  assert.equal(component.match(/role="tabpanel"/g)?.length, 6);
  assert.match(component, /const normalizedIndex = \(index \+ TABS\.length\) % TABS\.length/);
  assert.match(component, /tabRefs\.current\[normalizedIndex\]\?\.focus\(\)/);
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
    assert.match(component, new RegExp(`event\\.key === "${key}"`));
  }
});

test("Story tab explains purpose and why, then presents an ordered evidence-backed journey", async () => {
  const component = await readSource("../../../ai/frontend/components/StoryGroomingWorkspace.tsx");

  assert.match(component, /walkthrough\?\.purpose\?\.summary/);
  assert.match(component, /walkthrough\?\.purpose\?\.why_needed/);
  assert.match(component, /walkthrough\?\.purpose\?\.expected_outcomes/);
  assert.match(component, /!hasWalkthrough \? meaningfulText\(grooming\.layman\.explanation\) : ""/);
  assert.match(component, /Purpose and why/);
  assert.match(component, /Why it is needed/);
  assert.match(component, /User and operational journey/);
  assert.match(component, /walkthrough\?\.user_journey\?\.actors/);
  assert.match(component, /walkthrough\?\.user_journey\?\.trigger/);
  assert.match(component, /walkthrough\?\.user_journey\?\.steps/);
  assert.match(component, /walkthrough\?\.user_journey\?\.use_cases/);
  assert.match(component, /walkthrough\?\.user_journey\?\.alternate_paths/);
  assert.match(component, /\{ title: "Ordered journey", items: journeySteps, ordered: true \}/);
  assert.match(component, /\{ title: "Use cases", items: journeyUseCases \}/);
  assert.match(component, /\{ title: "Alternate and recovery paths", items: alternatePaths \}/);
  assert.match(component, /The available Story evidence is not specific enough[^<]+without guessing/);
  assert.match(component, /Needs source confirmation/);
});

test("Business, solution, validation, and remaining tabs keep their outcomes relevant and distinct", async () => {
  const component = await readSource("../../../ai/frontend/components/StoryGroomingWorkspace.tsx");

  for (const businessField of ["stakeholders", "value_outcomes", "success_measures"]) {
    assert.match(component, new RegExp(`walkthrough\\?\\.business_impact\\?\\.${businessField}`));
  }
  assert.match(component, /Connect the change to measurable value/);

  assert.match(component, /01 · Solution design/);
  assert.match(component, /Define behavior, rules, and boundaries/);
  for (const designField of ["behaviors", "rules", "dependencies", "constraints"]) {
    assert.match(component, new RegExp(`walkthrough\\?\\.solution_design\\?\\.${designField}`));
  }
  assert.match(component, /02 · Implementation/);
  assert.match(component, /Identify components, data, integrations, and quality needs/);
  for (const implementationField of ["components", "data", "integrations", "quality_requirements"]) {
    assert.match(component, new RegExp(`walkthrough\\?\\.implementation\\?\\.${implementationField}`));
  }

  assert.match(component, /Define observable proof before delivery starts/);
  for (const validationField of ["acceptance_criteria", "test_scenarios", "edge_cases", "linked_test_coverage"]) {
    assert.match(component, new RegExp(`walkthrough\\?\\.validation\\?\\.${validationField}`));
  }
  assert.match(component, /Acceptance is not observable yet/);
  assert.match(component, /Coverage evidence is missing/);

  assert.match(component, /Close the remaining decisions before planning/);
  for (const remainingField of ["gaps", "questions", "decisions", "actions", "risks"]) {
    assert.match(component, new RegExp(`walkthrough\\?\\.remaining\\?\\.${remainingField}`));
  }
  for (const label of ["Open questions", "Decisions needed", "Observed risks", "Documented assumptions", "Readiness gaps", "Next actions"]) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /resolvedDecisionKeys/);
});

test("Story grooming suppresses filler, exposes categorical readiness, and discloses evidence limits", async () => {
  const component = await readSource("../../../ai/frontend/components/StoryGroomingWorkspace.tsx");

  assert.match(component, /const LEGACY_FILLER = \[/);
  assert.match(component, /const cleanItems = \(items\?: string\[\]\)/);
  assert.match(component, /groups\.filter\(\(group\) => group\.items\.length\)/);
  assert.match(component, /if \(!visible\.length\) return null/);
  assert.match(component, /function MissingState/);
  for (const status of ["ready-for-planning", "needs-clarification", "not-ready"]) {
    assert.match(component, new RegExp(`"${status}"`));
  }
  assert.match(component, /item\.status === "met"[^\n]+item\.status === "partial"[^\n]+: "missing"/);
  assert.match(component, /Planning readiness/);
  assert.match(component, /Story or its supporting evidence changed after the brief was generated/);

  assert.match(component, /attachment bodies and external-link contents were not read/i);
  assert.match(component, /advisory and did not update the Story/i);
  assert.match(component, /response\.request_id/);
  assert.match(component, /response\.input_fingerprint/);
  assert.match(component, /response\.requires_human_review/);
  assert.match(component, /response\.generation_mode === "hybrid"/);
  assert.match(component, /response\.fallback_reason/);
  assert.match(component, /response\.fallback_sections/);
  assert.match(component, /Fallback detail/);
  assert.match(component, /context\.unavailable_sources/);
  assert.match(component, /context\.partial_sources/);
  assert.match(component, /status !== "missing" \? <EvidenceRefs refs=\{item\.evidence_refs\} sources=\{sources\} \/> : null/);
  assert.match(component, /grooming\.scope\?\.evidence_refs/);
  assert.match(component, /const EVIDENCE_GROUPS/);
  assert.match(component, /Story evidence/);
  assert.match(component, /Linked work/);
  assert.match(component, /Pointers and metadata/);
  assert.match(component, /className="story-grooming-source-group"/);
  assert.match(component, /aria-label=\{`\$\{group\.label\} sources`\}[^>]+role="region"[^>]+tabIndex=\{0\}/);

  assert.doesNotMatch(component, /analysis confidence/i);
  assert.doesNotMatch(component, /story-grooming-confidence/);
  assert.doesNotMatch(component, /MetricMethodologyInfo/);
});

test("Story grooming keeps the six-tab layout compact and horizontally scrollable on small screens", async () => {
  const styles = await readSource("../../../ai/frontend/components/StoryGroomingWorkspace.css");

  assert.match(styles, /\.story-grooming-container\s*\{[^}]*container:\s*story-grooming \/ inline-size/s);
  assert.match(styles, /\.story-grooming-workspace\s*\{[^}]*gap:\s*12px/s);
  assert.match(styles, /\.story-grooming-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)[^}]*gap:\s*4px/s);
  assert.match(styles, /\.story-grooming-tabs button\s*\{[^}]*min-height:\s*42px[^}]*padding:\s*7px 9px/s);
  assert.match(styles, /\.story-grooming-panel\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(styles, /@container story-grooming \(max-width: 680px\)[\s\S]*\.story-grooming-tabs\s*\{[^}]*display:\s*flex[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*x proximity/s);
  assert.match(styles, /@container story-grooming \(max-width: 680px\)[\s\S]*\.story-grooming-tabs button\s*\{[^}]*min-width:\s*126px[^}]*flex:\s*1 0 126px/s);
  assert.match(styles, /:root\[data-theme="dark"\][\s\S]*\.story-grooming-tabs button\.active[\s\S]*color:\s*#85b8ff/s);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("Story grooming retains the last successful brief when a refresh fails", async () => {
  const page = await readSource("../../../manual/frontend/pages/RequirementsPage.tsx");

  assert.match(page, /storyGroomingByRequirementId/);
  assert.match(page, /onSuccess: \(response, variables\) => \{/);
  assert.match(page, /\[response\.requirement\.id\]: response/);
  assert.match(page, /storyGroomingByRequirementId\[selectedRequirement\.id\] \|\| null/);
  assert.match(page, /storyGroomingContextChangedByRequirementId/);
  assert.match(page, /previewStoryGrooming\.error instanceof Error && storyGroomingMutationMatchesSelection/);
  assert.match(page, /integration_id: storyGroomingIntegrationId \|\| storyGroomingDefaultIntegrationId/);
  assert.match(page, /prompt_guidance: storyGroomingPromptGuidance \?\? getPrompt\("ai\.requirement\.grooming"\)/);
  assert.match(page, /supportingContextChanged=\{storyGroomingReviewContextChanged \|\| Boolean\(storyGroomingContextChangedByRequirementId\[selectedRequirement\.id\]\)\}/);
});

test("Story grooming prompt guidance stays within the backend contract", async () => {
  const registry = await readSource("../../../integration/frontend/lib/aiPromptRegistry.ts");
  const settings = await readSource("../pages/SettingsPage.tsx");

  assert.match(registry, /key: "ai\.requirement\.grooming"[\s\S]*?maxLength: 4_000/);
  assert.match(registry, /override\.length <= registryItem\.maxLength/);
  assert.match(settings, /const promptWithLengthError = useMemo/);
  assert.match(settings, /maxLength=\{prompt\.maxLength\}/);
  assert.match(settings, /4,000 characters or fewer|toLocaleString\(\).*characters/);
  assert.match(settings, /Used as evidence-bound guidance, not as instructions that can override grounding rules/);
});
