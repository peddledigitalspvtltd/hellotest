import { probePairedLocalAgent } from "@hellotest/agentic/frontend/lib/pairedLocalAgent";

/** A local Engineer controls the paired machine through an outbound, scoped MCP bridge. */
export async function preparePairedBrowserBuild<T extends { browser_location?: "local" | "remote"; scheduled_at?: string; test_case_ids?: string[]; test_case_id?: string; project_id?: string; app_type_id?: string }>(input: T, request: (path: string, input: Record<string, unknown>) => Promise<unknown>) {
  const { browser_location, ...payload } = input;
  if (browser_location !== "local") return payload;
  if (input.scheduled_at) throw new Error("Builds on this computer must start now. Clear the schedule or choose a remote build browser.");
  const agent = await probePairedLocalAgent();
  if (!agent.agentId || !agent.localExecution) throw new Error("Update your paired agent from Local agent setup before building on this computer.");
  const bridge = await request("/automation/browser-bridges", { test_case_id: input.test_case_id, test_case_ids: input.test_case_ids, project_id: input.project_id, app_type_id: input.app_type_id, local_agent_id: agent.agentId, paired_origin: window.location.origin }) as { id: string; token: string; poll_url: string; result_url: string; expires_at: string };
  const response = await fetch(`${agent.publicBaseUrl}/api/v1/local-browser-bridges`, { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json", "X-HelloTest-Agent-Token": agent.token }, body: JSON.stringify(bridge), signal: AbortSignal.timeout(15000) });
  const accepted = await response.json().catch(() => null);
  if (!response.ok || accepted?.accepted !== true || accepted.bridge_id !== bridge.id) throw new Error(accepted?.message || "The paired agent did not connect the local build browser. Check Local agent setup and retry.");
  return { ...payload, paired_browser_bridge_id: bridge.id };
}
