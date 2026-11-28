import type { AgenticWorkflowFailureDetails, AgenticWorkflowFailureResolution, AgenticWorkflowRun, AiArtifactAssuranceAnalysis, AiArtifactAssuranceReview, StepApiRequest } from "@hellotest/platform/frontend/src/types";

export type SprintDraft = { client_id?: string; title: string; description?: string; authoring_mode?: string; gherkin_document?: string; parameter_values?: Record<string, string>; steps?: Array<Record<string, unknown>> };
type CaseFailure = { case_index: number; client_id?: string; code?: string; message: string };
type Assessment = { client_id?: string; case_index?: number; analysis: AiArtifactAssuranceAnalysis; assurance_review?: AiArtifactAssuranceReview; verification?: {status?: string; limitations?: string[]}; failure?: {code?: string; message?: string} };
export type SprintLiveValidation = { status: "blocked" | "observed" | "not_run"; reason?: string; stopped_at_step_id?: string; stopped_at_step_order?: number };
export type AutomationArtifactSection = {
  id?: string; step_order?: number; action?: string; expected_result?: string; step_type?: string; runtime?: string;
  api_request?: StepApiRequest | null;
  automation_instructions?: {instructions?: Array<{operation_id: string; label: string; args: string[]; detail?: string}>};
};
export type SprintAutomation = { client_id?: string; case_index?: number; title?: string; steps?: AutomationArtifactSection[]; instructions?: AutomationArtifactSection[]; executable?: {filename: string; language: string; framework: string; code: string} | null; validation?: {status: string}; verification_status?: string; verification?: {
  status?: string; verification_id?: string; message?: string; repair_count?: number;
  failure?: { step_id?: string; operation_index?: number };
}; live_validation?: SprintLiveValidation;
  browser_checks?: Array<{step_id: string; expected_result_evidence: 'blocked' | 'preview_only' | 'no_authored_expected_result' | 'native_check_observed' | 'source_assertions_pending_execution'}>;
  execution_evidence?: {grounding: 'blocked' | 'observed' | 'entry_inspected' | 'not_established'; verification: 'passed' | 'not_requested' | 'live_validation_blocked' | 'failed' | 'blocked' | 'receipt_missing' | 'unsupported'} };
export function automationVerificationId(draft?: SprintAutomation | null) {
  const id = draft?.verification?.verification_id;
  if (draft?.verification_status === 'verified' && draft.verification?.status === 'passed'
    && draft.live_validation?.status !== 'blocked' && typeof id === 'string' && id.trim()) return id;
}

export function automationExecutionIssue(draft?: SprintAutomation | null) {
  if (draft?.live_validation?.status === 'blocked') return 'Live validation blocked';
  switch (draft?.execution_evidence?.verification || draft?.verification?.status) {
    case 'failed': return 'Isolated verification failed';
    case 'blocked': return 'Isolated verification blocked';
    case 'receipt_missing': return 'Verification receipt unavailable';
    case 'unsupported': return 'Verification requires a configured Test Run for this case runtime';
    default: return undefined;
  }
}
export type SprintTestData = { status: string; source: "synthetic" | "dataset" | "manual_case"; test_data_set_id?: string; test_data_set_name?: string; parameter_values?: Record<string, string>; parameter_sources?: Record<string, {source: string; test_data_set_id?: string}>; private_parameter_names?: string[]; existing_parameter_count?: number; model_calls_attempted?: number; missing_parameters?: string[]; deterministic_fallbacks?: Array<{parameter: string; reason: string}>; message?: string;
  dataset_selection?: 'manual_case' | 'workflow_node'; dataset_row_count?: number; referenced_parameter_count?: number; parameter_step_orders?: Record<string, number[]>;
  missing_parameter_details?: Array<{parameter: string; reason: string; step_orders: number[]}>; deferred_runtime_parameters?: string[];
  failure?: {code?: string; message?: string} };
export const isPreparedCaseData = (value: unknown): value is SprintTestData => Boolean(value && typeof value === 'object' && 'status' in value
  && (value.status === 'ready' || value.status === 'needs_input') && 'source' in value
  && (value.source === 'dataset' || value.source === 'synthetic' || value.source === 'manual_case'));
export type SprintPacket = { story_id: string; story_revision?: string; story?: {title: string}; story_assurance?: {analysis?: AiArtifactAssuranceAnalysis; failure?: {message?: string}}; test_case_generation?: {failure?: {message?: string}; verification?: {status?: string; limitations?: string[]}}; cases: SprintDraft[]; case_assurance?: Array<Assessment | null>; case_assurance_failures?: Array<CaseFailure | null>; test_data?: Array<SprintTestData | null>; automation?: Array<SprintAutomation | null>; automation_input_required?: Array<{ case_index: number; message: string; review_prior_actions?: boolean; required_context?: string[]; required_parameters?: string[]; blocked_steps?: Array<{ reason?: string; required_context?: string[]; required_parameters?: string[] }> } | null>; automation_failures?: Array<{case_index: number; client_id?: string; code?: string; message: string; validation_feedback?: unknown; completed_sections?: number; total_sections?: number; outcome_unknown?: boolean; reconciliation_required?: boolean; resolution?: AgenticWorkflowFailureResolution} | null>; automation_progress?: {completed: number; failed: number; needs_input: number; processed: number; total: number; active_case_index?: number; active_phase?: string; active_message?: string; active_step_order?: number; completed_sections?: number; total_sections?: number} };
type StageRow = Omit<Partial<SprintPacket>, "case_assurance" | "test_data"> & {case_index?: number; client_id?: string; case_assurance?: Assessment | Array<Assessment | null>; test_data?: SprintTestData | Array<SprintTestData | null> | Record<string, SprintTestData>};
export type SprintAutomationRow = Pick<StageRow, 'case_index' | 'automation' | 'automation_input_required' | 'automation_failures'> & { title?: string };
type Target = { nodeId: string; storyIndex: number; iterationPath?: Array<string | number> };
export type SprintDraftResult = { packet: SprintPacket; manualTargets: Array<Target | undefined>; automationTargets: Array<Target | undefined> };
const terminalResults = new Set(["completed", "failed", "cancelled", "interrupted"]);

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
    if (!nodeId || typeof result.status !== "string" || !terminalResults.has(result.status)) continue;
    const recordedRows = (result.output as {data?: StageRow[]} | undefined)?.data
      ?? (result.progress as {completed_items?: StageRow[]} | undefined)?.completed_items;
    const rows = Array.isArray(recordedRows) ? recordedRows : [];
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
        else if (isPreparedCaseData(row.test_data)) {
          if (scoped) packet.test_data = mergeIndexed(packet.test_data, [row.test_data], caseIndex);
        } else {
          const byCase = row.test_data;
          const matched = packet.cases.map((draft, index) => draft.client_id && isPreparedCaseData(byCase[draft.client_id])
            ? byCase[draft.client_id] : packet.test_data?.[index] || null);
          if (matched.some(Boolean)) packet.test_data = matched;
        }
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
    // A terminal transport or validation failure can precede the artifact
    // response. Bind it using the server's case identity and failure receipt.
    const failure = result.status === "failed" ? result.error_details as AgenticWorkflowFailureDetails | undefined : undefined;
    const identity = failure?.artifact;
    if (identity?.artifact_task !== "automation-engineer" || !identity.case_client_id
      || identity.case_index == null || !Number.isSafeInteger(identity.case_index) || !failure?.message) continue;
    const caseIndex = identity.case_index;
    const matches = [...stories.values()].filter(({packet}) => packet.story_id === identity.story_id
      && packet.cases[caseIndex]?.client_id === identity.case_client_id);
    if (matches.length !== 1) continue;
    const { packet } = matches[0];
    if (packet.automation?.[caseIndex] || packet.automation_input_required?.[caseIndex] || packet.automation_failures?.[caseIndex]) continue;
    const {message,code,resolution,completed_sections,total_sections,validation_feedback,outcome_unknown,reconciliation_required} = failure;
    const diagnostics = Object.fromEntries(Object.entries({code,resolution,completed_sections,total_sections,validation_feedback,outcome_unknown,reconciliation_required})
      .filter(([, value]) => value !== undefined));
    packet.automation_failures = mergeIndexed(packet.automation_failures, [{case_index:caseIndex,client_id:identity.case_client_id,message,...diagnostics}]);
    const completed = packet.automation?.filter(Boolean).length || 0;
    const failed = packet.automation_failures.filter(Boolean).length;
    const needsInput = packet.automation_input_required?.filter(Boolean).length || 0;
    packet.automation_progress = {completed,failed,needs_input:needsInput,processed:completed+failed+needsInput,total:packet.cases.length};
  }
  return [...stories.values()].filter(entry => entry.packet.cases.length || entry.packet.story_assurance?.failure || entry.packet.test_case_generation?.failure);
}
