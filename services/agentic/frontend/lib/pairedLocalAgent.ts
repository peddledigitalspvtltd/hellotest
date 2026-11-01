/** Browser-to-machine pairing. Never forward this token to the HelloTest API. */
export type PairedLocalAgent = { publicBaseUrl: string; token: string; localExecution?: boolean; agentId?: string };
export const PAIRED_AGENT_BASE_URL = "http://127.0.0.1:4311";
export const PAIRED_AGENT_TOKEN_KEY = "hellotest.repository-inspection.agent-token.v1";
let memoryToken = "";

export function getPairedAgentToken() {
  let saved = "";
  try { saved = localStorage.getItem(PAIRED_AGENT_TOKEN_KEY) || ""; } catch { /* Use this tab's pairing. */ }
  if (/^[a-f0-9]{64}$/.test(saved)) return saved;
  if (!memoryToken) memoryToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, "0")).join("");
  try { localStorage.setItem(PAIRED_AGENT_TOKEN_KEY, memoryToken); } catch { /* Storage is optional. */ }
  return memoryToken;
}

export async function probePairedLocalAgent(signal?: AbortSignal): Promise<PairedLocalAgent> {
  const token = getPairedAgentToken();
  let response: Response;
  try {
    response = await fetch(`${PAIRED_AGENT_BASE_URL}/api/v1/recorder/agent/status`, {
      cache: "no-store", credentials: "omit", headers: { "X-HelloTest-Agent-Token": token },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3500)]) : AbortSignal.timeout(3500)
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("The paired agent on this computer is unavailable. Start or update it from Local agent setup, allow local network access if prompted, then retry Run local.");
  }
  const status = await response.json().catch(() => null);
  if (!response.ok || status?.ready !== true || status?.service !== "hellotest-inspection-agent" || status?.protocol_version !== 1) {
    throw new Error(response.status === 401 || response.status === 403
      ? "The agent is not paired with this workspace. Restart it using Local agent setup."
      : "The paired browser is not ready. Restart the agent using Local agent setup.");
  }
  return { publicBaseUrl: PAIRED_AGENT_BASE_URL, token, agentId: status.agent_id, localExecution: status.capabilities?.local_execution === true && status.execution_protocol_version === 1 };
}

export type PairedLocalDispatch = { protocol_version: 1; execution_id: string; claim_url: string; grant_token: string; expires_at: string };
export async function submitPairedLocalRun(agent: PairedLocalAgent, dispatch: PairedLocalDispatch, trustedApiBase?: string) {
  if (dispatch.protocol_version !== 1 || !dispatch.execution_id || !dispatch.grant_token) throw new Error("This local run uses an unsupported dispatch protocol. Refresh HelloTest and try again.");
  const claim = new URL(dispatch.claim_url);
  const bases = [new URL("/api", window.location.origin)];
  if (trustedApiBase) bases.push(new URL(trustedApiBase, window.location.origin));
  const allowed = bases.some(base => {
    let prefix = base.pathname.replace(/\/+$/, "");
    if (!prefix.endsWith("/api")) prefix += "/api";
    return claim.origin === base.origin && claim.pathname === `${prefix}/executions/${encodeURIComponent(dispatch.execution_id)}/local-dispatch/claim` && !claim.username && !claim.password && !claim.search && !claim.hash;
  });
  if (!allowed) throw new Error("The local run authorization address does not belong to this workspace.");
  let response: Response;
  try {
    response = await fetch(`${agent.publicBaseUrl}/api/v1/local-executions`, {
      method: "POST", cache: "no-store", credentials: "omit",
      headers: { "Content-Type": "application/json", "X-HelloTest-Agent-Token": agent.token },
      body: JSON.stringify({ claim_url: dispatch.claim_url, grant_token: dispatch.grant_token, execution_id: dispatch.execution_id }),
      signal: AbortSignal.timeout(30000)
    });
  } catch {
    throw new Error(`Run ${dispatch.execution_id} was saved, but this browser could not confirm the paired agent accepted it. Retry Run local to reconnect the same run; no additional run will be created.`);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.accepted !== true || result.execution_id !== dispatch.execution_id) throw new Error(result?.message || `The paired agent did not accept saved run ${dispatch.execution_id}. Retry Run local to reconnect this run.`);
  return result as { accepted: true; execution_id: string; status: string; engine_run_ids?: string[] };
}

export async function cancelPairedLocalRun(executionId: string) {
  const agent = await probePairedLocalAgent();
  const response = await fetch(`${agent.publicBaseUrl}/api/v1/local-executions/${encodeURIComponent(executionId)}/cancel`, {
    method: "POST", credentials: "omit", headers: { "X-HelloTest-Agent-Token": agent.token }, signal: AbortSignal.timeout(10000)
  });
  if (!response.ok && response.status !== 404) throw new Error("The paired agent could not confirm cancellation. Check its terminal and the run status.");
}
