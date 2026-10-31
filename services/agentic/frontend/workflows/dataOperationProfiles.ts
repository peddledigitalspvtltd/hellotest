import catalog from "../../shared/workflowDataOperations.json";
import type { AgenticWorkflowNodeData } from "@hellotest/platform/frontend/src/types";

export const dataOperationProfiles = catalog;
export function dataOperationDefaults(id: string): AgenticWorkflowNodeData {
  const profile = catalog[id as keyof typeof catalog];
  return profile ? { dataOperation: id, label: profile.label, summary: profile.description, dataSourceKey: "input", ...profile.defaults } : {};
}
