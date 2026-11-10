export type PendingAutomationRun = { id: string; caseIds: string[]; projectId: string; appTypeId: string; mode: "local" | "remote"; retryAllowed?: boolean };
export class AutomationStartError extends Error {
  readonly receipt: PendingAutomationRun;
  constructor(receipt: PendingAutomationRun, cause: unknown) {
    super(`Run ${receipt.id} was saved, but the engine did not confirm a start. ${cause instanceof Error ? cause.message : "Check the engine connection."}`);
    this.name = "AutomationStartError";
    this.receipt = receipt;
  }
}

/** Keep the durable execution after a dispatch error; retry never creates another run. */
export async function startRemoteAutomationRun(receipt: PendingAutomationRun, start: (id: string) => Promise<unknown>) {
  try { assertAutomationDispatchAccepted(await start(receipt.id), receipt); return receipt; }
  catch (error) { if (error instanceof AutomationStartError) throw error; throw new AutomationStartError(receipt, error); }
}

export function assertAutomationDispatchAccepted(response: unknown, receipt: PendingAutomationRun) {
  const summary = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const countFields = ["automated_case_count", "queued_for_engine_count", "local_run_count", "manual_case_count", "unsupported_automated_case_count"];
  const validCounts = countFields.every(key => summary[key] === undefined || typeof summary[key] === "number" && Number.isSafeInteger(summary[key]) && Number(summary[key]) >= 0);
  const selectedCount = new Set(receipt.caseIds).size;
  const dispatchedCount = summary[receipt.mode === "local" ? "local_run_count" : "queued_for_engine_count"];
  const expectedCount = Math.max(selectedCount, Number(summary.automated_case_count) || 0);
  // A paired-agent reconnect returns the original grant without reconstructing
  // counts. Its transport has already verified acceptance of this same run.
  const replay = receipt.mode === "local" && summary.idempotent_replay === true
    && (summary.local_dispatch as { execution_id?: unknown } | undefined)?.execution_id === receipt.id
    && countFields.every(key => summary[key] === undefined);
  const complete = replay || typeof dispatchedCount === "number" && dispatchedCount >= expectedCount
    && (summary.automated_case_count === undefined || Number(summary.automated_case_count) >= selectedCount);
  if (summary.started === true && selectedCount > 0 && validCounts && complete
    && (summary.id === undefined || summary.id === receipt.id)
    && (summary.execution_mode === undefined || summary.execution_mode === receipt.mode)
    && !(Number(summary[receipt.mode === "local" ? "queued_for_engine_count" : "local_run_count"]) > 0)
    && (summary.acknowledgement === undefined || summary.acknowledgement === "accepted")
    && summary.accepted !== false && !["failed", "rejected"].includes(String(summary.status))
    && !(Number(summary.unsupported_automated_case_count) > 0)) return;
  const warnings = Array.isArray(summary.warnings) ? summary.warnings.filter((warning): warning is string => typeof warning === "string" && Boolean(warning.trim())).join(" ") : "";
  throw new AutomationStartError({ ...receipt, retryAllowed: false }, new Error(warnings || "The engine did not accept every selected automation case. Review the saved run’s dispatch evidence."));
}

/** A lost HTTP response can hide a successful start. Inspect durable state first. */
export async function retrySavedAutomationRun(receipt: PendingAutomationRun, read: (id: string) => Promise<{ id: string; project_id: string; app_type_id?: string | null; status: string | null }>, start: (id: string) => Promise<unknown>) {
  const current = await read(receipt.id);
  if (current.id !== receipt.id || current.project_id !== receipt.projectId || current.app_type_id !== receipt.appTypeId) throw new Error("The saved execution is outside this application.");
  const status = String(current.status || "").trim().toLowerCase();
  if (!status) throw new Error("The saved execution has no current status. Open its evidence before retrying.");
  if (status !== "queued") return { ...receipt, alreadyStarted: true };
  return { ...await startRemoteAutomationRun(receipt, start), alreadyStarted: false };
}

/** Creation owns initial dispatch. Read its receipt, never start it a second time. */
export async function verifyCreatedAutomationRun(receipt: PendingAutomationRun, read: (id: string) => Promise<{ id: string; project_id: string; app_type_id?: string | null; status: string | null }>) {
  let current;
  try { current = await read(receipt.id); }
  catch (error) { throw new AutomationStartError({ ...receipt, retryAllowed: false }, error); }
  if (current.id !== receipt.id || current.project_id !== receipt.projectId || current.app_type_id !== receipt.appTypeId) throw new AutomationStartError({ ...receipt, retryAllowed: false }, new Error("The saved execution is outside this application."));
  if (current.status === "queued") throw new AutomationStartError(receipt, new Error("The saved execution is still queued. Check its evidence or resume this same run."));
  if (!["running", "completed", "completed_with_errors", "paused"].includes(String(current.status))) throw new AutomationStartError({ ...receipt, retryAllowed: false }, new Error("Open the saved execution to inspect its current outcome."));
  return receipt;
}
