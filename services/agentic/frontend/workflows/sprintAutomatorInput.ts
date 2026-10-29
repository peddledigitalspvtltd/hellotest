import type { AgenticWorkflowNode } from "@hellotest/platform/frontend/src/types";

export const SPRINT_INPUT_DEFAULTS = {
  sprint_id: "", integration_id: "", max_cases_per_story: 5,
  authoring_mode: "structured", automation_start_url: "", generation_instructions: "",
};

export function isSprintAutomator(nodes: AgenticWorkflowNode[]) {
  return nodes.some(node => node.data.apiResource === "sprintStories")
    && nodes.some(node => node.data.kind === "artifactTask");
}

// Persist only the template's nonsecret configuration, never arbitrary trigger input.
export function sprintInputDefaults(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(SPRINT_INPUT_DEFAULTS).map(([key, fallback]) => {
    const value = input[key];
    return [key, typeof value === typeof fallback ? value : fallback];
  }));
}

export function restoredSprintInput(settings: Record<string, unknown>) {
  const saved = settings.sprint_input_defaults;
  return JSON.stringify(sprintInputDefaults(saved && typeof saved === "object" && !Array.isArray(saved)
    ? saved as Record<string, unknown> : {}), null, 2);
}
