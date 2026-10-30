import type { AgenticWorkflowRun, AiArtifactAssuranceAnalysis, AiArtifactAssuranceReview } from "@hellotest/platform/frontend/src/types";

export type SprintDraft = { client_id?: string; title: string; description?: string; authoring_mode?: string; gherkin_document?: string; parameter_values?: Record<string, string>; steps?: Array<Record<string, unknown>> };
type Assessment = { client_id?: string; case_index?: number; analysis: AiArtifactAssuranceAnalysis; assurance_review?: AiArtifactAssuranceReview };
export type SprintAutomation = { client_id?: string; case_index?: number; title?: string; steps?: Array<Record<string, unknown>>; instructions?: Array<{step_order: number; action: string; expected_result: string; runtime: string}>; executable?: {filename: string; language: string; framework: string; code: string} | null; validation?: {status: string}; verification_status?: string };
export type SprintPacket = { story_id: string; story_revision?: string; story?: {title: string}; story_assurance?: {analysis: AiArtifactAssuranceAnalysis}; cases: SprintDraft[]; case_assurance?: Assessment[]; automation?: Array<SprintAutomation | null>; automation_input_required?: Array<{ case_index: number; message: string; required_context?: string[]; required_parameters?: string[]; blocked_steps?: Array<{ reason?: string; required_context?: string[]; required_parameters?: string[] }> }>; automation_failures?: Array<{case_index: number; client_id?: string; code?: string; message: string; validation_feedback?: unknown; completed_sections?: number; total_sections?: number}>; automation_progress?: {completed: number; failed: number; needs_input: number; processed: number; total: number} };
type Target = { nodeId: string; storyIndex: number };
export type SprintDraftResult = { packet: SprintPacket; manualTarget?: Target; automationTarget?: Target };

/** Only saved native receipts identify Library records; draft IDs are not Library IDs. */
export function savedSprintCaseIds(run: AgenticWorkflowRun, accepted: Record<string, string> = {}, generatedNodeId?: string): string[] {
  const generated = generatedNodeId ? (run.node_results.find(item => item.node_id === generatedNodeId)?.output as {data?: Partial<SprintPacket>[]} | undefined)?.data : undefined;
  if (generatedNodeId && !Array.isArray(generated)) return [];
  const ids = run.node_results.filter(item => item.node_type === "artifactTask").flatMap(item => {
    const output = item.output as {data?: Partial<SprintPacket>[]; library_publication?: {receipts?: Array<{id?: string; kind?: string; saved?: boolean; story_id?: string; case_index?: number; client_id?: string}>}};
    return (output?.library_publication?.receipts || []).filter(receipt => {
      if (receipt.saved !== true || receipt.kind !== "manual") return false;
      if (!generatedNodeId) return true;
      const row = generated?.find(packet => packet.story_id === receipt.story_id);
      const draft = Number.isInteger(receipt.case_index) ? row?.cases?.[receipt.case_index!] : undefined;
      if (!draft || receipt.client_id && draft.client_id !== receipt.client_id) return false;
      const source = output?.data?.find(packet => packet.story_id === receipt.story_id);
      return Boolean(source && source.story_revision === row?.story_revision);
    }).map(receipt => receipt.id);
  });
  if (!generatedNodeId) ids.push(...Object.entries(accepted).filter(([key]) => key.endsWith(":manual")).map(([, id]) => id));
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim())))];
}

/** Bounded shareable links reuse the Library's authorized, paginated ID filter. */
export function sprintReviewLinks(run: Pick<AgenticWorkflowRun, "project_id" | "app_type_id">, caseIds: string[]): Array<{href: string; count: number}> {
  const ids = [...new Set(caseIds.filter(id => typeof id === "string" && id.trim()))];
  const links = [];
  // One hundred UUIDs fit common URL limits and stay below the catalog's 200-ID limit.
  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100);
    const params = new URLSearchParams({ project: run.project_id, review_cases: batch.join(",") });
    if (run.app_type_id) params.set("appType", run.app_type_id);
    links.push({href: `/test-cases?${params}`, count: batch.length});
  }
  return links;
}

/** Compose a review presentation from stage-owned outputs, never from private checkpoints. */
export function collectSprintDrafts(run: AgenticWorkflowRun): SprintDraftResult[] {
  const stories = new Map<string, SprintDraftResult>();
  for (const result of run.node_results) {
    if (result.node_type !== "artifactTask") continue;
    const nodeId = typeof result.node_id === "string" ? result.node_id : "";
    if (!nodeId) continue;
    // Public progress contains whole-case results only. Private recovery
    // checkpoints and partial step code are never a review presentation source.
    const rows = result.status === "completed"
      ? (result.output as {data?: Partial<SprintPacket>[]} | undefined)?.data
      : (result.progress as {completed_items?: Partial<SprintPacket>[]} | undefined)?.completed_items;
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
          packet.case_assurance = undefined; packet.automation = undefined; packet.automation_input_required = undefined; packet.automation_failures = undefined; packet.automation_progress = undefined;
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
        packet.automation_failures = Array.isArray(row.automation_failures) && matches(row.automation_failures) ? row.automation_failures : [];
        packet.automation_progress = row.automation_progress;
        if (result.status === "completed") entry.automationTarget = {nodeId, storyIndex};
        // This node's private lineage also owns the assessed manual drafts.
        if (packet.case_assurance?.length && entry.automationTarget) entry.manualTarget = entry.automationTarget;
      }
    });
  }
  return [...stories.values()].filter(entry => entry.packet.cases.length);
}
