import type { AgenticWorkflowRun, AiArtifactAssuranceAnalysis, AiArtifactAssuranceReview } from "@hellotest/platform/frontend/src/types";

export type SprintDraft = { client_id?: string; title: string; description?: string; authoring_mode?: string; gherkin_document?: string; parameter_values?: Record<string, string>; steps?: Array<Record<string, unknown>> };
type CaseFailure = { case_index: number; client_id?: string; code?: string; message: string };
type Assessment = { client_id?: string; case_index?: number; analysis: AiArtifactAssuranceAnalysis; assurance_review?: AiArtifactAssuranceReview; verification?: {status?: string; limitations?: string[]}; failure?: {code?: string; message?: string} };
export type SprintLiveValidation = { status: "blocked" | "observed" | "not_run"; reason?: string; stopped_at_step_id?: string; stopped_at_step_order?: number };
export type SprintAutomation = { client_id?: string; case_index?: number; title?: string; steps?: Array<Record<string, unknown>>; instructions?: Array<{step_order: number; action: string; expected_result: string; runtime: string}>; executable?: {filename: string; language: string; framework: string; code: string} | null; validation?: {status: string}; verification_status?: string; live_validation?: SprintLiveValidation };
export type SprintTestData = { status: string; source: "synthetic" | "dataset"; test_data_set_id?: string; test_data_set_name?: string; parameter_values?: Record<string, string>; parameter_sources?: Record<string, {source: string; test_data_set_id?: string}>; private_parameter_names?: string[]; existing_parameter_count?: number; model_calls_attempted?: number; missing_parameters?: string[]; deterministic_fallbacks?: Array<{parameter: string; reason: string}>; message?: string };
export type SprintPacket = { story_id: string; story_revision?: string; story?: {title: string}; story_assurance?: {analysis?: AiArtifactAssuranceAnalysis; failure?: {message?: string}}; test_case_generation?: {failure?: {message?: string}; verification?: {status?: string; limitations?: string[]}}; cases: SprintDraft[]; case_assurance?: Array<Assessment | null>; case_assurance_failures?: Array<CaseFailure | null>; test_data?: Array<SprintTestData | null>; automation?: Array<SprintAutomation | null>; automation_input_required?: Array<{ case_index: number; message: string; required_context?: string[]; required_parameters?: string[]; blocked_steps?: Array<{ reason?: string; required_context?: string[]; required_parameters?: string[] }> } | null>; automation_failures?: Array<{case_index: number; client_id?: string; code?: string; message: string; validation_feedback?: unknown; completed_sections?: number; total_sections?: number; outcome_unknown?: boolean; reconciliation_required?: boolean} | null>; automation_progress?: {completed: number; failed: number; needs_input: number; processed: number; total: number; active_case_index?: number; active_phase?: string; active_message?: string; active_step_order?: number; completed_sections?: number; total_sections?: number} };
type StageRow = Omit<Partial<SprintPacket>, "case_assurance" | "test_data"> & {case_index?: number; client_id?: string; case_assurance?: Assessment | Array<Assessment | null>; test_data?: SprintTestData | Array<SprintTestData | null>};
type Target = { nodeId: string; storyIndex: number; iterationPath?: Array<string | number> };
export type SprintDraftResult = { packet: SprintPacket; manualTargets: Array<Target | undefined>; automationTargets: Array<Target | undefined> };

function mergeIndexed<T>(previous: Array<T | null> | undefined, incoming: Array<T | null>, fallbackIndex?: number): Array<T | null> {
  const merged = [...(previous || [])];
  incoming.forEach((item, index) => {
    const itemIndex = item && typeof item === "object" ? (item as {case_index?: number}).case_index : undefined;
    const targetIndex = Number.isInteger(itemIndex) ? itemIndex as number : incoming.length === 1 && Number.isInteger(fallbackIndex) ? fallbackIndex as number : index;
    merged[targetIndex] = item;
  });
  return merged;
}

/** A loop node's latest result is only its final batch; earlier batches own saved drafts too. */
export function sprintTaskRecords(run: AgenticWorkflowRun): Array<Record<string, unknown>> {
  return run.node_results.filter(item => item.node_type === "artifactTask").flatMap(item => [
    ...(Array.isArray(item.iterations) ? item.iterations.filter(record => record && typeof record === "object").map(record => ({ ...record, node_id: item.node_id, node_type: item.node_type })) : []),
    item,
  ]);
}

/** Only saved native receipts identify Library records; draft IDs are not Library IDs. */
export function savedSprintCaseIds(run: AgenticWorkflowRun, accepted: Record<string, string> = {}, generatedNodeId?: string): string[] {
  const records = sprintTaskRecords(run);
  const generated = generatedNodeId ? records.filter(item => item.node_id === generatedNodeId).flatMap(item => {
    const data = (item.output as {data?: Partial<SprintPacket>[]} | undefined)?.data;
    return Array.isArray(data) ? data : [];
  }) : undefined;
  if (generatedNodeId && !generated?.length) return [];
  const ids = records.flatMap(item => {
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
  for (const result of sprintTaskRecords(run)) {
    const nodeId = typeof result.node_id === "string" ? result.node_id : "";
    if (!nodeId) continue;
    // Public progress contains whole-case results only. Private recovery
    // checkpoints and partial step code are never a review presentation source.
    const rows = result.status === "completed"
      ? (result.output as {data?: StageRow[]} | undefined)?.data
      : (result.progress as {completed_items?: StageRow[]} | undefined)?.completed_items;
    if (!Array.isArray(rows)) continue;
    rows.forEach((row, storyIndex) => {
      const target: Target = { nodeId, storyIndex, ...(Array.isArray(result.iteration_path) ? { iterationPath: result.iteration_path as Array<string | number> } : {}) };
      if (typeof row.story_id !== "string" || !row.story_id) return;
      const key = `${row.story_id}:${row.story_revision || "legacy"}`;
      let entry = stories.get(key);
      if (!entry) { entry = {packet: {story_id: row.story_id, story_revision: row.story_revision, cases: []}, manualTargets: [], automationTargets: []}; stories.set(key, entry); }
      const packet = entry.packet;
      if (row.story) packet.story = row.story;
      if (row.story_assurance) packet.story_assurance = row.story_assurance;
      if (row.test_case_generation) packet.test_case_generation = row.test_case_generation;
      if (Array.isArray(row.cases)) {
        // A regenerated set invalidates the UI's earlier assessments and targets.
        if (JSON.stringify(row.cases) !== JSON.stringify(packet.cases)) {
          packet.case_assurance = undefined; packet.case_assurance_failures = undefined; packet.test_data = undefined; packet.automation = undefined; packet.automation_input_required = undefined; packet.automation_failures = undefined; packet.automation_progress = undefined;
          entry.manualTargets = []; entry.automationTargets = [];
        }
        packet.cases = row.cases;
      }
      const caseIndex = row.case_index;
      const scoped = Number.isInteger(caseIndex);
      // A case-level row must still refer to the exact currently generated case.
      if (scoped && (!packet.cases[caseIndex!] || !row.client_id || row.client_id !== packet.cases[caseIndex!].client_id)) return;
      const matches = (items: Array<{client_id?: string; case_index?: number} | null>) => items.every((item, index) => {
        const itemIndex = item?.case_index ?? (scoped && items.length === 1 ? caseIndex! : index);
        return !item || Boolean(packet.cases[itemIndex]) && (!item.client_id || item.client_id === packet.cases[itemIndex].client_id);
      });
      const reviews = Array.isArray(row.case_assurance) ? row.case_assurance : scoped && row.case_assurance ? [row.case_assurance] : null;
      if (reviews && matches(reviews)) {
        packet.case_assurance = mergeIndexed(packet.case_assurance, reviews, caseIndex);
        reviews.forEach((review, index) => {
          if (!review) return;
          const reviewIndex = review.case_index ?? (scoped && reviews.length === 1 ? caseIndex! : index);
          if (result.status === "completed") entry.manualTargets[reviewIndex] = target;
          if (review.failure || review.verification?.status && review.verification.status !== "passed") {
            packet.case_assurance_failures = mergeIndexed(packet.case_assurance_failures, [{case_index: reviewIndex, client_id: packet.cases[reviewIndex].client_id,
              code: review.failure?.code, message: review.failure?.message || review.verification?.limitations?.[0] || "Test Case assurance needs another review."}]);
          } else if (review.verification?.status === "passed" && packet.case_assurance_failures) packet.case_assurance_failures[reviewIndex] = null;
        });
      }
      if (Array.isArray(row.case_assurance_failures) && matches(row.case_assurance_failures)) {
        packet.case_assurance_failures = scoped
          ? mergeIndexed(packet.case_assurance_failures, row.case_assurance_failures.length ? row.case_assurance_failures : [null], caseIndex)
          : mergeIndexed(undefined, row.case_assurance_failures);
      }
      if (row.test_data) {
        if (Array.isArray(row.test_data)) packet.test_data = row.test_data;
        else if (scoped) packet.test_data = mergeIndexed(packet.test_data, [row.test_data], caseIndex);
      }
      if (Array.isArray(row.automation) && matches(row.automation)) {
        packet.automation = mergeIndexed(packet.automation, row.automation, caseIndex);
        if (Array.isArray(row.automation_input_required) && matches(row.automation_input_required)) packet.automation_input_required = mergeIndexed(packet.automation_input_required, scoped && !row.automation_input_required.length ? [null] : row.automation_input_required, caseIndex);
        else packet.automation_input_required ||= [];
        if (Array.isArray(row.automation_failures) && matches(row.automation_failures)) packet.automation_failures = mergeIndexed(packet.automation_failures, scoped && !row.automation_failures.length ? [null] : row.automation_failures, caseIndex);
        else packet.automation_failures ||= [];
        packet.automation_progress = row.automation_progress;
        if (result.status === "completed") row.automation.forEach((automation, index) => {
          const targetIndex = automation?.case_index ?? (scoped && row.automation!.length === 1 ? caseIndex! : index);
          entry.automationTargets[targetIndex] = automation ? target : undefined;
          // A nested case checkpoint owns only this case's assessment and build.
          if (packet.case_assurance?.[targetIndex]) entry.manualTargets[targetIndex] = target;
        });
      }
      const hasCaseOutcome = scoped && [row.automation, row.automation_input_required, row.automation_failures].some(items =>
        Array.isArray(items) && matches(items) && items.some((item, index) => item
          && (item.case_index ?? (items.length === 1 ? caseIndex! : index)) === caseIndex));
      if (scoped && !hasCaseOutcome && row.automation_progress && result.status === "failed" && typeof result.error === "string" && result.error.trim()) {
        // Terminal transport/budget failures can stop before the stage emits a
        // case outcome. Its last public progress row still owns the exact case.
        // Later publication failures remain node diagnostics, not build outcomes.
        const diagnostic = Array.isArray(result.logs) ? [...result.logs].reverse().find(log => log?.event === "node_failed"
          && log.origin?.node_id === nodeId && log.message === result.error
          && (!Array.isArray(result.iteration_path) || JSON.stringify(log.origin?.iteration_path) === JSON.stringify(result.iteration_path))) : undefined;
        packet.automation_failures = mergeIndexed(packet.automation_failures, [{ case_index: caseIndex!, client_id: row.client_id, message: result.error,
          ...(typeof diagnostic?.code === "string" ? { code: diagnostic.code } : {}),
          ...(typeof diagnostic?.outcome_unknown === "boolean" ? { outcome_unknown: diagnostic.outcome_unknown } : {}),
          ...(typeof diagnostic?.reconciliation_required === "boolean" ? { reconciliation_required: diagnostic.reconciliation_required } : {}) }]);
      }
      if (scoped && (row.automation_progress || Array.isArray(row.automation))) {
        const completed = packet.automation?.filter(Boolean).length || 0, failed = packet.automation_failures?.filter(Boolean).length || 0,
          needsInput = packet.automation_input_required?.filter(Boolean).length || 0;
        packet.automation_progress = { ...row.automation_progress, completed, failed, needs_input: needsInput,
          processed: completed + failed + needsInput, total: packet.cases.length };
      }
    });
  }
  return [...stories.values()].filter(entry => entry.packet.cases.length || entry.packet.story_assurance?.failure || entry.packet.test_case_generation?.failure);
}
