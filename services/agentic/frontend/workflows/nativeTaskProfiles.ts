import profiles from "../../shared/workflowNativeTasks.json";
import type { AgenticWorkflowNodeData } from "@hellotest/platform/frontend/src/types";

export const nativeTaskProfiles = profiles;
export function nativeTaskDefaults(id: string): AgenticWorkflowNodeData {
  const profile = profiles[id as keyof typeof profiles];
  return profile ? { artifactTask: id, label: profile.label, summary: profile.description,
    task: profile.task, instructions: profile.instructions, guardrails: profile.guardrails,
    ...("readinessPolicy" in profile ? { readinessPolicy: profile.readinessPolicy } : {}),
    ...(id === "automation-engineer" ? { inspectBrowser: true, automationBrowserMode: "perform_steps" } : {}) } : {};
}

/** An explicit reset replaces guidance without changing execution settings. */
export function nativeTaskResetPatch(id: string): Partial<AgenticWorkflowNodeData> {
  const defaults = nativeTaskDefaults(id);
  return { task: defaults.task, instructions: defaults.instructions, guardrails: defaults.guardrails, prompt: "",
    ...(id === "test-case-generation" ? { generationInstructions: "" } : {}) };
}

/** Backfill old definitions without replacing any saved or intentionally empty guidance. */
export function withNativeTaskDefaults(data: AgenticWorkflowNodeData): AgenticWorkflowNodeData {
  if (data.kind !== "artifactTask") return data;
  const defaults = nativeTaskDefaults(String(data.artifactTask || ""));
  return { ...defaults, ...data,
    ...(data.artifactTask === "automation-engineer" && data.automationBrowserMode == null
      ? { automationBrowserMode: data.inspectBrowser === false ? "offline" : "read_only" } : {}),
    instructions: typeof data.instructions === "string" ? data.instructions
      : typeof data.prompt === "string" && data.prompt.trim() ? data.prompt : defaults.instructions };
}
