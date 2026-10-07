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
  if (!response || typeof response !== "object") return;
  const summary = response as { queued_for_engine_count?: number; unsupported_automated_case_count?: number; warnings?: string[] };
  if (typeof summary.queued_for_engine_count === "number" && (summary.queued_for_engine_count === 0 || Number(summary.unsupported_automated_case_count) > 0)) {
    throw new AutomationStartError({ ...receipt, retryAllowed: false }, new Error(summary.warnings?.join(" ") || "The engine did not accept every selected automation case. Review the saved run’s dispatch evidence."));
  }
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
