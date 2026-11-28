import type { AgenticWorkflowEdge, AgenticWorkflowNodeData } from "@hellotest/platform/frontend/src/types";
import { specialistDefaults } from "./specialistProfiles";
import { nativeTaskDefaults } from "./nativeTaskProfiles";
import { buildNodeDefaults, createFlowEdge, createWorkflowDraft, layoutWorkflow, type WorkflowDraft, type WorkflowNodeKind } from "./workflowGraph";

export type WorkflowTemplate = {
  id: "sprint-automator" | "spec-to-script";
  name: string;
  description: string;
};

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  { id: "sprint-automator", name: "Sprint Automator", description: "Turn Sprint Stories into assessed Test Cases, test data, and automation drafts." },
  { id: "spec-to-script", name: "SpecToScript", description: "Use Sprint Stories and optional repository evidence to build linked manual cases, API coverage, and automation drafts." },
];

type NodeDefinition = [id: string, kind: WorkflowNodeKind, data: AgenticWorkflowNodeData];

const stage = (source: string, target: string, ports: Partial<Pick<AgenticWorkflowEdge, "sourceHandle" | "targetHandle">> = {}) => ({
  ...createFlowEdge(source, target),
  id: `${source}-${target}`,
  ...ports,
});

const sourceStages: NodeDefinition[] = [
  ["repository-objects", "repositoryAgent", { label: "Build Object Repository", summary: "Find candidate UI objects and stable locators in the selected repository.", repositoryAgentType: "object_repository", repositoryOptional: true }],
  ["repository-api", "repositoryAgent", { label: "Discover API Test Cases", summary: "Read routes and contracts for candidate API scenarios and assertions.", repositoryAgentType: "api_tests", repositoryOptional: true }],
  ["repository-curator", "agent", {
    ...specialistDefaults("repository-curator"),
    label: "Object Repository Curator",
    repositoryOptional: true,
    prompt: "Review the upstream source findings and existing Object Repository for this application. Highlight reusable locators, ambiguity, and conflicts. Treat candidate locators as source evidence. Cite the target or finding when available. Return only relevant findings and review decisions for downstream Test Case design. Preserve existing repository entries.",
  }],
  ["repository-context", "aggregator", { label: "Collect repository findings", mergeMode: "waitAllAppend" }],
  ["source-barrier", "aggregator", { label: "Join Sprint and source branches", mergeMode: "chooseInput", mergeChooseInput: "1" }],
];

export function draftFromTemplate(template: WorkflowTemplate): { draft: WorkflowDraft; input: string } {
  const draft = createWorkflowDraft();
  const withSource = template.id === "spec-to-script";
  const definitions: NodeDefinition[] = [
    ["request", "trigger", { label: "Manual Sprint trigger" }],
    ["sprint-stories", "apiTool", {
      label: "Read all Sprint Stories",
      apiResource: withSource ? "workspaceSprintStories" : "sprintStories",
      apiPagination: "cursor", apiMethod: "GET", connectionId: "", apiUrl: "", timeoutMs: "70000", retryCount: "0", outputKey: "sprint_stories",
    }],
    ...(withSource ? sourceStages : []),
    ["each-story", "loop", {
      label: "For each Story", loopItemFailure: "continue", loopSourceKey: withSource ? "input.0.items" : "input.items",
      loopMaxIterations: "100", loopBatchSize: "1", loopAction: "workflow", timeoutMs: "3600000", outputKey: "story_packets",
    }],
    ["story-assurance", "artifactTask", { label: "AI Story Assurance", artifactTask: "story-assurance" }],
    ["test-case-generation", "artifactTask", { label: withSource ? "Generate Manual and API Test Cases" : "AI Test Case Generator", artifactTask: "test-case-generation",
      ...(withSource ? { generationInstructions: "Create readable manual cases grounded in the Story. Include API cases when the Story calls for a documented API behavior. Use relevant approved source evidence to ground the exact routes, assertions, and object references. Identify unresolved contracts and fixtures." } : {}) }],
    ["each-test-case", "loop", { label: "For each Test Case", loopItemFailure: "continue", loopSourceKey: "input.0.cases", loopMaxIterations: "10", loopBatchSize: "1", loopAction: "workflow", timeoutMs: "3600000", outputKey: "case_automation" }],
    ["test-case-assurance", "artifactTask", { label: "AI Test Case Quality Assurance", artifactTask: "test-case-assurance" }],
    ["test-data-generator", "artifactTask", { label: "AI Test Data Generator", artifactTask: "test-data-generator", testDataSource: "synthetic", testDataSetId: "" }],
    ["automation-engineer", "artifactTask", { label: "Automation Build Agent", artifactTask: "automation-engineer", automationSource: "sprint", ...(withSource ? { automationBrowserMode: "read_only" } : {}) }],
    ["sprint-output", "output", { label: "Sprint results and Library cases" }],
  ];
  draft.nodes = definitions.map(([id, kind, data], index) => ({
    id, type: "agenticStep", position: { x: 0, y: 0 },
    data: { ...buildNodeDefaults(kind, index), ...(kind === "artifactTask" ? nativeTaskDefaults(String(data.artifactTask)) : {}), ...data },
  }));
  draft.edges = [
    stage("request", "sprint-stories"),
    ...(withSource ? [
      stage("request", "repository-objects"),
      stage("request", "repository-api"),
      stage("repository-objects", "repository-curator"),
      stage("repository-curator", "repository-context"),
      stage("repository-api", "repository-context"),
      stage("sprint-stories", "source-barrier", { targetHandle: "input-1" }),
      stage("repository-context", "source-barrier", { targetHandle: "input-2" }),
    ] : []),
    stage(withSource ? "source-barrier" : "sprint-stories", "each-story"),
    stage("each-story", "story-assurance", { sourceHandle: "loop" }),
    stage("story-assurance", "test-case-generation"),
    stage("test-case-generation", "each-test-case"),
    stage("each-test-case", "test-case-assurance", { sourceHandle: "loop" }),
    stage("test-case-assurance", "test-data-generator"),
    stage("test-data-generator", "automation-engineer"),
    stage("automation-engineer", "each-test-case", { targetHandle: "continue" }),
    stage("each-test-case", "each-story", { sourceHandle: "done", targetHandle: "continue" }),
    stage("each-story", "sprint-output", { sourceHandle: "done" }),
  ];
  draft.name = template.name;
  draft.description = template.description;
  draft.nodes = layoutWorkflow(draft.nodes, draft.edges);
  draft.settings = {
    execution_mode: "review", maxDurationMs: 3600000, template_id: template.id, template_version: withSource ? 1 : 5,
    library_publication_mode: "automatic", requires_human_review: false, processing_mode: withSource ? "parallel" : "sequential",
    ...(withSource ? {
      max_parallel_nodes: 3,
      source_evidence_nodes: { objects: "repository-objects", curator: "repository-curator", api: "repository-api" },
    } : {}),
  };
  return { draft, input: JSON.stringify({ sprint_id: "" }, null, 2) };
}
