import { probePairedLocalAgent, submitPairedLocalRun, type PairedLocalDispatch } from "@hellotest/agentic/frontend/lib/pairedLocalAgent";
import type { ExecutionStartResponse } from "./executionStartSummary";

type DispatchResult = ExecutionStartResponse & { id: string; execution_mode?: "local"; engine_base_url?: string; acknowledgement?: "unknown"; local_dispatch?: PairedLocalDispatch };
type Pending = { requestId: string; receipt?: DispatchResult };
const pending = new Map<string, Pending>();
const active = new Map<string, Promise<DispatchResult>>();
const PREFIX = "hellotest.paired-local-run.v1:";

/** Persist the receipt before contacting localhost so a lost acknowledgment can only reconnect this run. */
export async function startPairedLocalExecution(
  path: string,
  input: Record<string, unknown>,
  request: (path: string, input: Record<string, unknown>) => Promise<DispatchResult>,
  trustedApiBase?: string
): Promise<DispatchResult> {
  let owner = String(input.created_by || "");
  try { owner = JSON.parse(localStorage.getItem("hellotest.session") || "null")?.user?.id || owner; } catch { /* Input creator still scopes new runs. */ }
  const flightKey = JSON.stringify([owner, path, input]);
  const inFlight = active.get(flightKey);
  if (inFlight) return inFlight;
  const work = (async () => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(flightKey));
    const key = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
    const agent = await probePairedLocalAgent();
    if (!agent.localExecution || !agent.agentId) throw new Error("Your browser is paired with an older inspection agent. Open Local agent setup, stop its terminal, and run the updated setup command. Your pairing is preserved; the updated agent also executes saved cases and suites on this computer.");
    let intent = pending.get(key);
    if (!intent) {
      try { intent = JSON.parse(sessionStorage.getItem(PREFIX + key) || "null") as Pending | null || undefined; } catch { /* Memory retry remains available. */ }
      if (!intent?.requestId) intent = { requestId: crypto.randomUUID() };
      pending.set(key, intent);
    }
    const remember = () => { try { sessionStorage.setItem(PREFIX + key, JSON.stringify(intent)); } catch { /* Memory retry remains available. */ } };
    remember();
    // An accepted agent retains this receipt past the initial claim deadline.
    // Reconnect it first; renewing at the API could hide a completed attempt.
    if (!intent.receipt) {
      intent.receipt = await request(path, { ...input, local_transport: "paired-agent", paired_origin: window.location.origin, local_agent_id: agent.agentId, request_id: intent.requestId });
      remember();
    }
    const receipt = intent.receipt;
    if (!receipt.local_dispatch || receipt.local_dispatch.execution_id !== receipt.id) throw new Error(`Run ${receipt.id || ""} was saved without a valid paired-agent authorization. Refresh HelloTest before retrying.`);
    await submitPairedLocalRun(agent, receipt.local_dispatch, trustedApiBase);
    try { sessionStorage.setItem("hellotest.paired-local-execution:" + receipt.id, "1"); } catch { /* Storage is optional. */ }
    pending.delete(key);
    try { sessionStorage.removeItem(PREFIX + key); } catch { /* Storage is optional. */ }
    return { ...receipt, started: true };
  })();
  active.set(flightKey, work);
  try { return await work; } finally { active.delete(flightKey); }
}
