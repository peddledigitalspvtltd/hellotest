type MonitoredActivity = { status: string; metadata: Record<string, unknown> } | null | undefined;

/** Watching is bounded; a user refresh or returning to the page starts a new observation window. */
export function automationActivityPollingDelay(activity: MonitoredActivity, explicit: boolean, startedAt: number, now = Date.now()): number | false {
  const elapsed = now - startedAt;
  if (elapsed >= 15 * 60_000) return false;
  if (activity && ["queued", "running", "pending"].includes(activity.status)) {
    const scheduled = Date.parse(String(activity.metadata.next_run_at || activity.metadata.scheduled_at || "")) - now;
    return scheduled > 0 ? Math.min(60_000, Math.max(3000, scheduled)) : 3000;
  }
  if (!activity && elapsed < 30_000) return 3000;
  return !explicit && elapsed < 60_000 ? 15_000 : false;
}

type ErrorRecord = Record<string, unknown>;
const record = (value: unknown): ErrorRecord => value && typeof value === "object" && !Array.isArray(value) ? value as ErrorRecord : {};
const records = (value: unknown) => Array.isArray(value) ? value.map(record) : [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0,20) : [];
const summary = (value: string) => /browserType\.launch/i.test(value)
  ? "Browser could not start before generation. Check Test Engine and retry."
  : value.trim().slice(0, 1200);

export type AutomationStepBuildError = {
  id: string; test_case_id: string; step_id?: string; manual_step_ids: string[]; message: string;
  code?: string; phase?: string; created_at?: string; resolved_at?: string; attempt?: number; tool?: string;
  action_id?: string; assertion?: string;
  required_context: string[]; required_parameters: string[];
  semantic_issues: AutomationSemanticIssue[];
  semantic_requirement?: "independent_field_validation_predicate";
};
const semanticIssueMessages = {
  action_not_supported: "The confirmed browser actions do not establish the requested manual action.",
  expected_result_not_covered: "The confirmed checks do not cover this expected result.",
  unrelated_assertion: "The confirmed check verifies a different outcome from this requirement.",
  weakened_expectation: "The confirmed checks weaken or change this expected result.",
  unmet_prerequisite: "A prerequisite for this requirement has not been established.",
  source_order_conflict: "The browser actions do not preserve the manual sequence.",
  insufficient_evidence: "More browser evidence is needed to establish this requirement.",
  unsupported_claim: "This requirement includes behavior without confirmed browser evidence."
} as const;
export type AutomationSemanticIssue = { code: keyof typeof semanticIssueMessages; obligation_id: string };
export function automationSemanticIssueMessage(issue: AutomationSemanticIssue, requirement?: AutomationStepBuildError["semantic_requirement"]): string {
  return requirement === "independent_field_validation_predicate" && issue.code === "expected_result_not_covered"
    ? "Check the field’s validation status and any relevant validation errors. Its entered value alone does not establish validity."
    : semanticIssueMessages[issue.code];
}
const semanticIssueKey = (issue: AutomationSemanticIssue) => JSON.stringify([issue.code,issue.obligation_id]);
const manualObligationId = (row: ErrorRecord) => {
  try { return `manual:${encodeURIComponent(text(row.manual_test_case_id))}:${encodeURIComponent(text(row.manual_step_id))}`; }
  catch { return ""; }
};

const actionId = (value: unknown) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(text(value)) ? text(value) : "";
const failureActionId = (value: ErrorRecord) => actionId(value.action_id)
  || actionId(text(value.id).match(/^automation\.agent\.action\.(?:failed|unknown):([^:]+):/)?.[1]);
const terminalPhase = (phase: string) => ["automation.failed", "automation.case.failed", "automation.llm.failed", "automation.agent.browser.failed", "automation.agent.browser.startup.failed", "automation.agent.save.failed"].includes(phase);
const terminalWrapperPhase = (phase: string) => ["automation.failed", "automation.case.failed"].includes(phase);
const genericFailureMessage = (value: string) => /^(?:This section could not finish building\.|This section needs additional context or configured test data\.|Browser inspection could not continue\.|Automation generation could not continue\.|The browser tool budget was reached before this section completed\. Review the last unsuccessful browser check; completed Plan sections remain saved\.|Automation build failed(?:\.|$| for case(?:\s|$)))/.test(value);
const genericFailureCode = (value?: string) => !value || value === "AUTOMATION_BUILD_INCOMPLETE";
const typedFailureCode = (value: string | undefined) => /^[A-Z][A-Z0-9_]{1,99}$/.test(value || "") && !genericFailureCode(value);

function outcomeStepId(row: ErrorRecord, metadata: ErrorRecord): string {
  const explicit = text(row.active_step_id) || text(row.failed_step_id) || text(row.step_id);
  if (explicit) return explicit;
  const active = records(metadata.step_progress).filter(step => step.test_case_id === row.test_case_id && step.status === "in_progress");
  return active.length === 1 ? text(active[0].step_id) : "";
}

function matchesCase(row: ErrorRecord, caseId: string | undefined, metadata: ErrorRecord): boolean {
  return !caseId || row.test_case_id === caseId || row.source_test_case_id === caseId
    || records(metadata.manual_step_progress).some(step => step.manual_test_case_id === caseId && step.test_case_id === row.test_case_id);
}

/** Older progress reducers treated a native satisfied assertion as a failed
 * mutation because it has no action_outcome. Correct that presentation only
 * from the original matching completed event, without editing retained data. */
export function automationActivityBrowserMetadata(metadata: ErrorRecord, events: unknown[] = []): ErrorRecord {
  const completed = new Set<string>();
  const identity = (caseId: string, stepId: string, id: string) => JSON.stringify([caseId, stepId, id]);
  for (const event of events.map(record)) {
    const details = record(event.details), id = actionId(details.action_id);
    const caseId = text(details.test_case_id), stepId = text(details.active_step_id) || text(details.step_id);
    if (event.phase === "automation.agent.action.completed" && details.tool === "browser_assert" && details.assertion_outcome === "satisfied"
      && (details.action_outcome === undefined || ["completed", "not_attempted"].includes(text(details.action_outcome)))
      && caseId && stepId && id) completed.add(identity(caseId, stepId, id));
  }
  if (!completed.size) return metadata;
  let changed = false;
  const project = (value: unknown) => records(value).map(row => {
    const caseId = text(row.test_case_id), stepId = text(row.step_id) || text(row.section_step_id);
    if (!Array.isArray(row.browser_actions)) return row;
    let rowChanged = false;
    const actions = records(row.browser_actions).map(action => {
      const id = actionId(action.action_id);
      if (action.tool !== "browser_assert" || action.status !== "failed" || action.assertion_outcome !== "satisfied"
        || action.action_outcome === "unknown" || !id || !completed.has(identity(caseId, stepId, id))) return action;
      changed = rowChanged = true;
      return { ...action, status: "completed" };
    });
    return rowChanged ? { ...row, browser_actions: actions } : row;
  });
  const sections = project(metadata.step_progress), manual = project(metadata.manual_step_progress);
  return changed ? { ...metadata, step_progress: sections, manual_step_progress: manual } : metadata;
}

/** Error details are public activity summaries; tool arguments, model payloads and expected inputs are never read here. */
export function automationActivityStepErrors(metadata: ErrorRecord, events: unknown[] = []): AutomationStepBuildError[] {
  metadata = automationActivityBrowserMetadata(metadata, events);
  const result: AutomationStepBuildError[] = [];
  const origins = new Map<AutomationStepBuildError, string>();
  const sections = records(metadata.step_progress);
  const manual = records(metadata.manual_step_progress);
  const add = (scope: ErrorRecord, value: ErrorRecord, fallbackMessage = "", origin = "event") => {
    const caseId = text(scope.test_case_id), stepId = text(scope.step_id) || text(scope.active_step_id);
    const manualIds = strings(scope.active_manual_step_ids).filter(id => manual.some(step => step.test_case_id === caseId && step.manual_step_id === id));
    if (!caseId || !stepId && !manualIds.length) return;
    if (stepId && !sections.some(step => step.test_case_id === caseId && step.step_id === stepId) && !manualIds.length) return;
    const message = summary(text(value.message) || text(value.reason) || fallbackMessage);
    if (!message) return;
    const code = text(value.error_code) || text(value.code);
    const phase = text(value.phase), action = failureActionId(value);
    const terminal = terminalPhase(phase) || origin === "outcome";
    const attempt = typeof value.attempt === "number" && Number.isInteger(value.attempt) && value.attempt > 0 ? value.attempt : undefined;
    const section = sections.find(row => row.test_case_id === caseId && row.step_id === stepId);
    const semantic = code.startsWith("AUTOMATION_SEMANTIC_REVIEW_");
    const issues = semantic ? [...new Map(records(value.semantic_issues).slice(0,20).flatMap(issue => {
      const id = text(issue.obligation_id), issueCode = text(issue.code);
      return Object.prototype.hasOwnProperty.call(semanticIssueMessages,issueCode)
        && (id === stepId || manual.some(row => row.test_case_id === caseId && manualObligationId(row) === id))
        ? [[JSON.stringify([issueCode,id]),{code:issueCode as AutomationSemanticIssue["code"],obligation_id:id}] as const] : [];
    })).values()] : [];
    const semanticRequirement = semantic && (value.semantic_requirement || value.requirement) === "independent_field_validation_predicate" ? "independent_field_validation_predicate" : undefined;
    const resolvedAt = text(value.resolved_at) || (section?.instruction_status === "saved" ? text(section.saved_at) || text(section.updated_at) || text(value.created_at) : "");
    // A wrapper or outcome without an attempt belongs to the most recent
    // matching terminal occurrence, rather than an earlier failed attempt.
    const candidates = terminal ? [...result].reverse() : result;
    const sameScope = (error: AutomationStepBuildError) => error.test_case_id === caseId && error.step_id === (stepId || undefined)
      && (Boolean(stepId) || error.manual_step_ids.join(",") === manualIds.join(","));
    const sameAttempt = (error: AutomationStepBuildError) => !attempt || !error.attempt || attempt === error.attempt;
    // Prefer an exact existing cause over the latest typed fallback when two
    // independent failures happen to share a code in the same attempt.
    const exactTerminalCause = (origin === "outcome" || terminalWrapperPhase(phase)) && candidates.find(error => sameScope(error) && sameAttempt(error)
      && (terminalPhase(error.phase || "") || origins.get(error) === "outcome") && error.message === message && (!code || !error.code || code === error.code));
    const previous = exactTerminalCause || candidates.find(error => {
      if (!sameScope(error)) return false;
      if (action && error.action_id) return action === error.action_id;
      if (!sameAttempt(error)) return false;
      // An unchanged rejected candidate stopping the build is one diagnosis.
      // Keep its actionable issues beside the final stop reason.
      if (code === "AUTOMATION_SEMANTIC_REVIEW_STALLED" && error.code === "AUTOMATION_SEMANTIC_REVIEW_REJECTED"
        || code === "AUTOMATION_SEMANTIC_REVIEW_REJECTED" && error.code === "AUTOMATION_SEMANTIC_REVIEW_STALLED") {
        if (issues.map(semanticIssueKey).sort().join("|") === error.semantic_issues.map(semanticIssueKey).sort().join("|")) return true;
      }
      // A case outcome can repeat the last failed browser operation without
      // its action id. Its exact typed code identifies that terminal cause;
      // retain earlier distinct actions and attach the summary to the latest.
      if (origin === "outcome" && code && code === error.code && /^automation\.agent\.action\.(?:failed|unknown)$/.test(error.phase || "")) return true;
      if (action || error.action_id) {
        // Historical rows may lack their original action id. Join only the
        // same typed occurrence; a second known action must remain separate.
        return code === error.code && phase === error.phase && (error.message === message || origins.get(error) === "durable");
      }
      if (error.message === message && (!code || !error.code || code === error.code)) return true;
      const priorTerminal = terminalPhase(error.phase || "") || origins.get(error) === "outcome";
      if (terminal || priorTerminal) {
        if (!terminal || !priorTerminal || code && error.code && code !== error.code && !genericFailureCode(code) && !genericFailureCode(error.code)) return false;
        // Typed final summaries and outer wrappers describe their matching
        // terminal cause even when each layer uses a different public message.
        // Two primary failures remain distinct; a shared code alone does not
        // identify independent provider or browser failures as one occurrence.
        if (code === error.code && typedFailureCode(code)
          && (origin === "outcome" || terminalWrapperPhase(phase) || terminalWrapperPhase(error.phase || ""))) return true;
        // Wrapper summaries and the final outcome describe one cause. Two
        // independent provider/network causes with no code must stay visible.
        return error.message === message || genericFailureMessage(error.message) || genericFailureMessage(message);
      }
      return (!code || !error.code || code === error.code) && (error.message === message || phase === error.phase && origins.get(error) === "durable");
    });
    if (previous) {
      if (action && !previous.action_id) previous.action_id = action;
      if (code && genericFailureCode(previous.code)) previous.code = code.slice(0,120);
      if (code === "AUTOMATION_SEMANTIC_REVIEW_STALLED" && previous.code === "AUTOMATION_SEMANTIC_REVIEW_REJECTED") {previous.code=code;previous.message=message;previous.phase=phase;}
      if (resolvedAt && !previous.resolved_at) previous.resolved_at = resolvedAt;
      if (attempt && !previous.attempt) previous.attempt = attempt;
      if (!previous.tool && /^browser_[a-z0-9_]{1,48}$/.test(text(value.tool))) previous.tool = text(value.tool);
      if (!previous.assertion && /^[a-z_]{1,50}$/.test(text(value.assertion))) previous.assertion = text(value.assertion);
      previous.required_context = [...new Set([...previous.required_context,...strings(value.required_context).map(summary)])];
      previous.required_parameters = [...new Set([...previous.required_parameters,...strings(value.required_parameters).map(summary)])];
      previous.semantic_issues = [...new Map([...previous.semantic_issues,...issues].map(issue => [semanticIssueKey(issue),issue])).values()];
      if (semanticRequirement) previous.semantic_requirement = semanticRequirement;
      if (origin === "outcome" && code && code === previous.code && (previous.action_id || typedFailureCode(code)
          && (terminalPhase(previous.phase || "") || origins.get(previous) === "outcome"))
        || genericFailureMessage(previous.message) && ((origin === "outcome" || origin === "dependency") || terminal && !genericFailureMessage(message))) previous.message = message;
      return;
    }
    const error: AutomationStepBuildError = { id: text(value.id) || `${caseId}:${stepId || manualIds.join(",")}:${result.length}`, test_case_id: caseId,
      ...(stepId ? {step_id:stepId} : {}), manual_step_ids: manualIds, message,
      ...(code ? {code:code.slice(0,120)} : {}), ...(phase ? {phase:phase.slice(0,120)} : {}),
      ...(text(value.created_at) ? {created_at:text(value.created_at)} : {}),
      ...(resolvedAt ? {resolved_at:resolvedAt} : {}), ...(attempt ? {attempt} : {}),
      ...(action ? {action_id:action} : {}), ...(/^[a-z_]{1,50}$/.test(text(value.assertion)) ? {assertion:text(value.assertion)} : {}),
      ...(/^browser_[a-z0-9_]{1,48}$/.test(text(value.tool)) ? {tool:text(value.tool)} : {}),
      required_context:strings(value.required_context).map(summary), required_parameters:strings(value.required_parameters).map(summary), semantic_issues:issues,
      ...(semanticRequirement ? {semantic_requirement:semanticRequirement} : {}) };
    result.push(error); origins.set(error,origin);
  };
  for (const section of sections) {
    for (const error of records(section.build_errors)) add(section,error,"","durable");
    if (section.dependency) add(section,{code:"AUTOMATION_DEPENDENCY_MISSING",phase:"automation.agent.dependencies",...record(section.dependency)},"","dependency");
  }
  for (const event of events.map(record)) {
    const details = record(event.details), phase = text(event.phase);
    for (const blocker of records(details.blocked_steps)) add({...details,...blocker},{...blocker,phase,created_at:event.created_at,attempt:details.attempt});
    for (const error of records(details.validation_errors)) add({...details,...error},{...error,phase,created_at:event.created_at,attempt:details.attempt});
    if (event.level === "error" || /\.(?:failed|unknown)$/.test(phase)) add(details,{...details,phase,id:event.id,created_at:event.created_at,message:event.message});
    else if (phase === "automation.agent.output.invalid" || phase === "automation.agent.semantic.rejected") add(details,{...details,phase,id:event.id,created_at:event.created_at,message:event.message});
  }
  for (const outcome of records(metadata.case_outcomes)) {
    for (const blocker of records(outcome.blocked_steps)) add({...outcome,...blocker},{code:"AUTOMATION_DEPENDENCY_MISSING",phase:"automation.agent.dependencies",...blocker});
    const stepId = outcomeStepId(outcome,metadata);
    if (stepId && outcome.code !== "AUTOMATION_DEPENDENCY_MISSING") add({...outcome,step_id:stepId},{...outcome,message:outcome.message || outcome.error},"","outcome");
  }
  for (const section of sections) for (const action of records(section.browser_actions)) {
    if (!["failed","unknown"].includes(text(action.status))) continue;
    const identity = failureActionId(action);
    if (result.some(error => error.test_case_id === section.test_case_id && error.step_id === section.step_id && (!identity || error.action_id === identity))) continue;
    add({...section,active_manual_step_ids:action.active_manual_step_ids},{...action,message:action.status === "unknown" ? "The browser action outcome could not be confirmed. Check the latest browser evidence before retrying this step." : "A browser action failed. Review the latest browser evidence and this step’s instructions before retrying."});
  }
  return result.slice(-100);
}

export function automationActivityFailureReasons(metadata: Record<string, unknown>, caseId?: string, stepErrors: AutomationStepBuildError[] = []): string[] {
  const outcomes = Array.isArray(metadata.case_outcomes) ? metadata.case_outcomes : [];
  const reasons = outcomes.flatMap(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (!matchesCase(row,caseId,metadata) || row.code === "AUTOMATION_DEPENDENCY_MISSING") return [];
    if (stepErrors.some(error => error.test_case_id === row.test_case_id && error.step_id === outcomeStepId(row,metadata))) return [];
    const message = typeof row.message === "string" ? row.message : typeof row.error === "string" ? row.error : "";
    return message.trim() ? [summary(message)] : [];
  });
  const scopedDependency = outcomes.some(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return row.code === "AUTOMATION_DEPENDENCY_MISSING" && matchesCase(row,caseId,metadata);
  });
  const scopedFailure = outcomes.some(value => { const row=record(value);return matchesCase(row,caseId,metadata) && stepErrors.some(error => error.test_case_id === row.test_case_id && error.step_id === outcomeStepId(row,metadata)); });
  if (!reasons.length && !scopedDependency && !scopedFailure && typeof metadata.error === "string" && metadata.error.trim()) reasons.push(summary(metadata.error));
  return [...new Set(reasons)].slice(0, 5);
}
