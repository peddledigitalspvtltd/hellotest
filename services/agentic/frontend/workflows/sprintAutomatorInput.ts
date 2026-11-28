import type { AgenticWorkflowNode } from "@hellotest/platform/frontend/src/types";

export const SPRINT_INPUT_DEFAULTS = { sprint_id: "" };
const legacyDefaults = { integration_id: "", max_cases_per_story: 5, authoring_mode: "structured", automation_start_url: "", generation_instructions: "" };

export function isSprintAutomator(nodes: AgenticWorkflowNode[]) {
  return nodes.some(node => ["sprintStories", "workspaceSprintStories"].includes(String(node.data.apiResource)))
    && nodes.some(node => node.data.kind === "artifactTask");
}

// Save references only. GitHub credentials stay in the project's managed connection.
export function sprintRepositorySource(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (source.type !== "github" || typeof source.repository_url !== "string" || source.repository_url.length > 512) return undefined;
  let url: URL;
  try { url = new URL(source.repository_url.trim()); } catch { return undefined; }
  if (url.origin !== "https://github.com" || url.username || url.password || url.search || url.hash
      || !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)) return undefined;
  const ref = typeof source.ref === "string" && /^[\w./-]{1,255}$/.test(source.ref.trim()) ? source.ref.trim() : undefined;
  const integrationId = typeof source.integration_id === "string" && /^[\w:-]{1,255}$/.test(source.integration_id) ? source.integration_id : undefined;
  return { type: "github", repository_url: url.href, ...(ref ? { ref } : {}), ...(integrationId ? { integration_id: integrationId } : {}) };
}

// Scope and optional source belong to the trigger. Task configuration belongs to the node.
export function sprintInputDefaults(input: Record<string, unknown>) {
  const source = sprintRepositorySource(input.source);
  return { sprint_id: typeof input.sprint_id === "string" ? input.sprint_id : "", ...(source ? { source } : {}) };
}

export function restoredSprintInput(settings: Record<string, unknown>) {
  const saved = settings.sprint_input_defaults;
  const values = saved && typeof saved === "object" && !Array.isArray(saved) ? saved as Record<string, unknown> : {};
  // Read old nonsecret settings once so opening an existing workflow can migrate them.
  const legacy = Object.fromEntries(Object.entries(legacyDefaults).filter(([key, fallback]) => typeof values[key] === typeof fallback).map(([key]) => [key, values[key]]));
  return JSON.stringify({ ...sprintInputDefaults(values), ...legacy }, null, 2);
}

/** Preserve saved node customizations while moving legacy trigger settings to their owner. */
export function migrateSprintConfiguration(nodes: AgenticWorkflowNode[], input: Record<string, unknown>) {
  if (!isSprintAutomator(nodes)) return { nodes, input };
  const migrated = nodes.map(node => {
    if (node.data.kind !== "artifactTask") return node;
    const data = { ...node.data };
    const inherit = (key: string, value: unknown) => { if (data[key] === undefined && value !== undefined) data[key] = value; };
    // Empty used to mean "inherit trigger model", so retain that effective model.
    if (typeof input.integration_id === "string" && input.integration_id && !data.llmIntegrationId) data.llmIntegrationId = input.integration_id;
    if (data.artifactTask === "test-case-generation") {
      inherit("maxCasesPerStory", input.max_cases_per_story ?? 5);
      inherit("authoringMode", input.authoring_mode ?? "structured");
      inherit("generationInstructions", input.generation_instructions ?? "");
    }
    if (data.artifactTask === "automation-engineer") inherit("automationStartUrl", input.automation_start_url ?? "");
    return { ...node, data };
  });
  const scopeInput = { ...input };
  Object.keys(legacyDefaults).forEach(key => delete scopeInput[key]);
  return { nodes: migrated, input: scopeInput };
}
