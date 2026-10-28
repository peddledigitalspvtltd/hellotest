import type { WorkflowDraft } from "./workflowGraph";
import { specialistDefaults } from "./specialistProfiles";
import {
  createWorkflowDraft,
  createFlowEdge,
  buildNodeDefaults,
} from "./workflowGraph";

export type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  category: "Reviews" | "Source agents" | "Data flow";
  agent?: string;
  source?: string;
  task?: string;
};
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  { id: "sprint-automator", name: "Sprint Automator", category: "Data flow", description: "Read Sprint Stories, generate and assess Test Cases, save them into the Library as AI generated and pending review, and prepare automation when its inputs are ready." },
  {
    id: "foreach",
    name: "Process a list of items",
    category: "Data flow",
    description:
      "Map each item into a consistent result and inspect the collected output.",
  },
  {
    id: "custom",
    name: "Your own AI review",
    category: "Reviews",
    description:
      "Write your task, select a model and review the answer with its project sources.",
  },
  {
    id: "release",
    name: "Release readiness",
    category: "Reviews",
    description:
      "Review story coverage, then recommend an evidence-based test plan.",
  },
  {
    id: "story",
    name: "Story assurance",
    category: "Reviews",
    agent: "story-architect",
    description:
      "Find acceptance gaps and missing boundaries before development.",
    task: "Review the requested stories for missing acceptance criteria, ambiguous boundaries and coverage gaps. Cite permitted project evidence.",
  },
  {
    id: "failure",
    name: "Failure investigation",
    category: "Reviews",
    agent: "failure-analyst",
    description:
      "Review failed runs and separate observed evidence from hypotheses.",
    task: "Investigate failures in the requested run scope. Cite observed failures, identify likely causes and recommend verification steps. Do not change run results.",
  },
  {
    id: "objects",
    name: "Build UI object repository",
    category: "Source agents",
    source: "object_repository",
    description:
      "Inspect source files, discover UI objects and review stable locators.",
  },
  {
    id: "api",
    name: "Build API test cases",
    category: "Source agents",
    source: "api_tests",
    description:
      "Read routes and contracts, extract scenarios and review test drafts.",
  },
  {
    id: "knowledge",
    name: "Build repository knowledge",
    category: "Source agents",
    source: "repository_knowledge",
    description:
      "Analyze repository structure and prepare source-linked documentation.",
  },
  {
    id: "components",
    name: "Build component tests",
    category: "Source agents",
    source: "component_tests",
    description:
      "Inspect UI components and derive reviewable component test contracts.",
  },
];

export function draftFromTemplate(template: WorkflowTemplate): {
  draft: WorkflowDraft;
  input?: string;
} {
  const draft = createWorkflowDraft();
  draft.name = template.name;
  draft.description = template.description;
  if (template.id === "release") return { draft };
  if (template.id === "sprint-automator") {
    const definitions: Array<[string, string, Record<string, unknown>]> = [
      ["request", "trigger", { label: "Manual Sprint trigger" }],
      ["sprint-stories", "apiTool", { label: "Read all Sprint Stories", apiResource: "sprintStories", apiPagination: "cursor", apiMethod: "GET", connectionId: "", apiUrl: "", timeoutMs: "70000", retryCount: "0", outputKey: "sprint_stories" }],
      ["each-story", "loop", { label: "For each Story", loopSourceKey: "input.items", loopMaxIterations: "100", loopAction: "storyPackets", timeoutMs: "70000", outputKey: "story_packets" }],
      ["story-assurance", "artifactTask", { label: "AI Story Assurance", artifactTask: "story-assurance" }],
      ["test-case-generation", "artifactTask", { label: "AI Test Case Generator", artifactTask: "test-case-generation" }],
      ["test-case-assurance", "artifactTask", { label: "AI Test Case Quality Assurance", artifactTask: "test-case-assurance" }],
      ["automation-engineer", "artifactTask", { label: "AI Automation Engineer", artifactTask: "automation-engineer" }],
      ["sprint-output", "output", { label: "Sprint results and Library cases" }],
    ];
    draft.nodes = definitions.map(([id, kind, data], index) => ({ id, type: "agenticStep", position: { x: 80 + index * 310, y: 140 }, data: { ...buildNodeDefaults(kind as Parameters<typeof buildNodeDefaults>[0], index), ...data } }));
    draft.edges = draft.nodes.slice(1).map((node, index) => createFlowEdge(draft.nodes[index].id, node.id));
    draft.settings = { execution_mode: "review", maxDurationMs: 3600000, template_id: "sprint-automator", library_publication_mode: "automatic", requires_human_review: false, processing_mode: "sequential" };
    return { draft, input: JSON.stringify({ sprint_id: "", integration_id: "", max_cases_per_story: 5, authoring_mode: "structured", automation_start_url: "", generation_instructions: "" }, null, 2) };
  }
  if (["foreach", "custom"].includes(template.id)) {
    const task = {
      id: `task-${template.id}`,
      type: "agenticStep",
      position: { x: 390, y: 140 },
      data: buildNodeDefaults(
        template.id === "foreach" ? "loop" : "customAI",
        1,
      ),
    };
    draft.nodes = [
      draft.nodes[0],
      task,
      { ...draft.nodes[3], position: { x: 710, y: 140 } },
    ];
    draft.edges = [
      createFlowEdge(draft.nodes[0].id, task.id),
      createFlowEdge(task.id, draft.nodes[2].id),
    ];
    return {
      draft,
      input:
        template.id === "foreach"
          ? JSON.stringify(
              {
                items: [
                  { title: "Review acceptance criteria", priority: "High" },
                  { title: "Check regression coverage", priority: "Medium" },
                ],
              },
              null,
              2,
            )
          : undefined,
    };
  }
  const task = {
    id: `task-${template.id}`,
    type: "agenticStep",
    position: { x: 390, y: 140 },
    data: template.source
      ? {
          label: template.name,
          kind: "repositoryAgent",
          repositoryAgentType: template.source,
          timeoutMs: "180000",
          retryCount: "0",
        }
      : {
          ...specialistDefaults(template.agent || "quality-evaluator"),
          label: template.name,
          kind: "agent",
          agentId: template.agent,
          prompt: template.task,
          knowledgeScope: "stories,test-cases,runs,bugs,knowledge",
          timeoutMs: "70000",
          retryCount: "1",
        },
  };
  draft.nodes = [
    draft.nodes[0],
    task,
    { ...draft.nodes[3], position: { x: 710, y: 140 } },
  ];
  draft.edges = [
    createFlowEdge(draft.nodes[0].id, task.id),
    createFlowEdge(task.id, draft.nodes[2].id),
  ];
  return {
    draft,
    ...(template.source
      ? {
          input: JSON.stringify(
            {
              source: {
                type: "github",
                repository_url: "",
                ref: "",
                integration_id: "",
              },
            },
            null,
            2,
          ),
        }
      : {}),
  };
}
