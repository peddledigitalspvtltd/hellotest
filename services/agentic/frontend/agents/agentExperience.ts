import specialistProfiles from "../../shared/workflowSpecialists.json";
export type AgentCategory = "repository" | "planning" | "design" | "investigation" | "quality";
export type AgentExperience = {
  category: AgentCategory;
  outcome: string;
  inputs: string;
  output: string;
  destination: string;
  destinationLabel: string;
  destinationPermission: string;
  starters: string[];
};

export const AGENT_CATEGORIES: Array<{ id: AgentCategory; label: string }> = [
  { id: "quality", label: "Quality agents" },
  { id: "repository", label: "Build from source" },
  { id: "planning", label: "Plan & assess" },
  { id: "design", label: "Design & automate" },
  { id: "investigation", label: "Investigate & improve" }
];

export const AGENT_EXPERIENCES: Record<string, AgentExperience> = {
  object_repository: { category: "repository", outcome: "Find UI elements and review reusable locators for your application.", inputs: "Repository ZIP or GitHub", output: "Screens & locator candidates", destination: "/object-repository", destinationLabel: "Open Object Repository", destinationPermission: "automation.view", starters: [] },
  api_tests: { category: "repository", outcome: "Turn API contracts and route definitions into traceable test drafts.", inputs: "OpenAPI or API source code", output: "API test case drafts", destination: "/test-cases", destinationLabel: "Open Test Cases", destinationPermission: "testcase.view", starters: [] },
  repository_knowledge: { category: "repository", outcome: "Make repository documentation and code evidence searchable in Ask AI.", inputs: "Repository code & documentation", output: "Searchable knowledge documents", destination: "/knowledge-repo", destinationLabel: "Open Knowledge Repo", destinationPermission: "knowledge.view", starters: [] },
  component_tests: { category: "repository", outcome: "Identify component checks and the fixtures they need before execution.", inputs: "UI component source code", output: "Component test drafts & scaffolds", destination: "/test-cases", destinationLabel: "Open Test Cases", destinationPermission: "testcase.view", starters: [] },
  "quality-orchestrator": { category: "planning", outcome: "Identify release risks and decide which quality work should happen next.", inputs: "Stories, tests, runs & defects", output: "Prioritized quality plan", destination: "/projects", destinationLabel: "Open project workspace", destinationPermission: "project.view", starters: ["Build a release quality plan. Separate confirmed risks from missing evidence and prioritize the next three actions.", "Review current delivery readiness and recommend which specialist should investigate each unresolved risk."] },
  "story-architect": { category: "design", outcome: "Clarify acceptance boundaries and examples before a story reaches testing.", inputs: "Stories & project knowledge", output: "Acceptance criteria review", destination: "/stories", destinationLabel: "Open Stories", destinationPermission: "requirement.view", starters: ["Review current stories for ambiguous acceptance criteria and propose concrete Given/When/Then examples.", "Identify missing negative and edge-case acceptance boundaries in the selected stories."] },
  "test-designer": { category: "design", outcome: "Find missing coverage and propose a focused set of test scenarios.", inputs: "Stories, test cases & execution evidence", output: "Traceable scenario brief", destination: "/test-cases", destinationLabel: "Open Test Cases", destinationPermission: "testcase.view", starters: ["Propose a focused test set for the current story risks, including boundaries and negative scenarios. Explain existing coverage gaps.", "Review test cases for duplication, weak assertions and missing test data variations."] },
  "automation-engineer": { category: "design", outcome: "Assess automation readiness, reuse and fragile bindings before building.", inputs: "Automation, tests & run evidence", output: "Automation improvement plan", destination: "/automation", destinationLabel: "Open Automation", destinationPermission: "automation.view", starters: ["Review automation readiness and propose a bounded plan for reusable steps, test data and resilient locators.", "Identify automation candidates with the strongest evidence and explain setup blockers for each."] },
  "run-planner": { category: "planning", outcome: "Prioritize the cases that matter for the current release scope.", inputs: "Stories, test cases & run history", output: "Risk-based run recommendation", destination: "/executions", destinationLabel: "Open Runs", destinationPermission: "run.view", starters: ["Recommend a focused run for current delivery risks. Explain why each proposed test matters and what is excluded.", "Identify the smallest regression set that covers failed stories and recently affected areas."] },
  "failure-analyst": { category: "investigation", outcome: "Separate observed failure evidence from possible causes and next checks.", inputs: "Failed runs, cases & defects", output: "Failure investigation brief", destination: "/executions", destinationLabel: "Open Runs", destinationPermission: "run.view", starters: ["Analyze recent failures. Group symptoms, cite observed evidence and separate product, environment and data hypotheses.", "Find repeated failures and list the additional evidence needed to establish a root cause."] },
  "bug-reporter": { category: "investigation", outcome: "Prepare a reproducible defect outline from the strongest available evidence.", inputs: "Failure evidence, cases & stories", output: "Reviewable defect outline", destination: "/issues", destinationLabel: "Open Defects", destinationPermission: "feedback.view", starters: ["Prepare a defect outline from the strongest recent failure evidence, including reproduction steps, expected behavior and evidence gaps.", "Review whether a reported failure has enough evidence for a reproducible defect and list what is missing."] },
  "bug-triage": { category: "investigation", outcome: "Explain which defects deserve attention first and what needs clarification.", inputs: "Open defects & delivery evidence", output: "Defect prioritization brief", destination: "/issues", destinationLabel: "Open Defects", destinationPermission: "feedback.view", starters: ["Prioritize open defects using severity, affected stories and execution evidence. Explain uncertainty and the next triage action.", "Identify potentially related defects and evidence needed before treating them as duplicates."] },
  "quality-evaluator": { category: "planning", outcome: "Challenge quality claims against their sources and expose unresolved gaps.", inputs: "Stories, tests, runs & knowledge", output: "Evidence readiness review", destination: "/projects", destinationLabel: "Open project workspace", destinationPermission: "project.view", starters: ["Evaluate whether current quality claims are supported by evidence. List contradictions, missing coverage and required human decisions.", "Review the completeness and traceability of current quality artifacts without assuming passing tests prove release readiness."] },
  "repository-curator": { category: "investigation", outcome: "Review existing locators for duplication, instability and opportunities to reuse.", inputs: "Object Repository & automation evidence", output: "Repository maintenance brief", destination: "/object-repository", destinationLabel: "Open Object Repository", destinationPermission: "automation.view", starters: ["Review existing object locators for duplication and fragility. Prioritize source-backed maintenance proposals.", "Identify reusable screen objects and evidence required before changing any current locator."] }
};

for (const [id, profile] of Object.entries(specialistProfiles)) {
  if (AGENT_EXPERIENCES[id]) continue;
  const metadata = profile as typeof profile & { category?: AgentCategory; destination?: string; destinationPermission?: string };
  AGENT_EXPERIENCES[id] = {
    category: metadata.category || "planning", outcome: profile.description,
    inputs: profile.scopes.map(scope => scope.replace(/-/g, " ")).join(", "), output: "Verified evidence & reviewable proposals",
    destination: metadata.destination || "/projects", destinationLabel: "Open related workspace", destinationPermission: metadata.destinationPermission || "project.view",
    starters: [profile.prompt]
  };
}

export function agentReadinessLabel(status?: string) {
  return status === "ready_for_review" ? "Ready for review" : status === "limited_evidence" ? "Limited evidence" : status === "insufficient_evidence" ? "More evidence needed" : "Review required";
}
