import type { AgenticWorkflowRun, AiArtifactAssuranceAnalysis, AiArtifactAssuranceReview } from "@hellotest/platform/frontend/src/types";

export type SprintDraft = { client_id?: string; title: string; description?: string; authoring_mode?: string; gherkin_document?: string; steps?: Array<Record<string, unknown>> };
type Assessment = { client_id?: string; case_index?: number; analysis: AiArtifactAssuranceAnalysis; assurance_review?: AiArtifactAssuranceReview };
export type SprintAutomation = { client_id?: string; case_index?: number; title?: string; steps?: Array<Record<string, unknown>>; instructions?: Array<{step_order: number; action: string; expected_result: string; runtime: string}>; executable?: {filename: string; language: string; framework: string; code: string} | null; validation?: {status: string}; verification_status?: string };
export type SprintPacket = { story_id: string; story_revision?: string; story?: {title: string}; story_assurance?: {analysis: AiArtifactAssuranceAnalysis}; cases: SprintDraft[]; case_assurance?: Assessment[]; automation?: Array<SprintAutomation | null>; automation_input_required?: Array<{ case_index: number; message: string; required_context?: string[]; required_parameters?: string[]; blocked_steps?: Array<{ reason?: string; required_context?: string[]; required_parameters?: string[] }> }> };
type Target = { nodeId: string; storyIndex: number };
export type SprintDraftResult = { packet: SprintPacket; manualTarget?: Target; automationTarget?: Target };

/** Compose a review presentation from stage-owned outputs, never from private checkpoints. */
export function collectSprintDrafts(run: AgenticWorkflowRun): SprintDraftResult[] {
  const stories = new Map<string, SprintDraftResult>();
  for (const result of run.node_results) {
    if (result.status !== "completed" || result.node_type !== "artifactTask") continue;
    const nodeId = typeof result.node_id === "string" ? result.node_id : "";
    if (!nodeId) continue;
    const rows = (result.output as {data?: Partial<SprintPacket>[]} | undefined)?.data;
    if (!Array.isArray(rows)) continue;
    rows.forEach((row, storyIndex) => {
      if (typeof row.story_id !== "string" || !row.story_id) return;
      const key = `${row.story_id}:${row.story_revision || "legacy"}`;
      let entry = stories.get(key);
      if (!entry) { entry = {packet: {story_id: row.story_id, story_revision: row.story_revision, cases: []}}; stories.set(key, entry); }
      const packet = entry.packet;
      if (row.story) packet.story = row.story;
      if (row.story_assurance) packet.story_assurance = row.story_assurance;
      if (Array.isArray(row.cases)) {
        // A regenerated set invalidates the UI's earlier assessments and targets.
        if (JSON.stringify(row.cases) !== JSON.stringify(packet.cases)) {
          packet.case_assurance = undefined; packet.automation = undefined; packet.automation_input_required = undefined;
          entry.manualTarget = undefined; entry.automationTarget = undefined;
        }
        packet.cases = row.cases;
      }
      const matches = (items: Array<{client_id?: string; case_index?: number} | null>) => items.every((item, index) => !item
        || Boolean(packet.cases[item.case_index ?? index]) && (!item.client_id || item.client_id === packet.cases[item.case_index ?? index].client_id));
      if (Array.isArray(row.case_assurance) && matches(row.case_assurance)) {
        packet.case_assurance = row.case_assurance;
        entry.manualTarget = {nodeId, storyIndex};
      }
      if (Array.isArray(row.automation) && matches(row.automation)) {
        packet.automation = row.automation;
        packet.automation_input_required = row.automation_input_required || [];
        entry.automationTarget = {nodeId, storyIndex};
        // This node's private lineage also owns the assessed manual drafts.
        if (packet.case_assurance?.length) entry.manualTarget = entry.automationTarget;
      }
    });
  }
  return [...stories.values()].filter(entry => entry.packet.cases.length);
}
