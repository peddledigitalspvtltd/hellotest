import { api } from "./api";

export const ROVO_NATIVE_INTEGRATION_ID = "hellotest-rovo-native";
export const HELLOTEST_ROVO_AGENT_KEY = "hellotest-qa-agent";
export const HELLOTEST_ROVO_AGENT_NAME = "HelloTest QA Agent";

export function isRovoIntegrationId(value: string | null | undefined) {
  return String(value || "") === ROVO_NATIVE_INTEGRATION_ID;
}

export type NativeAgentConnection = {
  available: boolean;
  summary: string;
  detail: string;
  checked_at: string;
  latency_ms: number;
};

/** This native entry opens the workflow studio; availability is not an LLM credential test. */
export async function testHelloTestRovoConnection({ projectId, canView, signal }: {
  projectId: string;
  canView: boolean;
  signal?: AbortSignal;
}): Promise<NativeAgentConnection> {
  const started = Date.now();
  const result = (available: boolean, summary: string, detail: string): NativeAgentConnection => ({
    available, summary, detail, checked_at: new Date().toISOString(), latency_ms: Math.max(1, Date.now() - started)
  });
  if (!projectId) return result(false, "Select a project", "Agent availability is checked for your current project.");
  if (!canView) return result(false, "Access unavailable", "Your current role does not allow viewing agentic workflows in this project.");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 8_000);
  try {
    const flags = await api.featureFlags.snapshot({ signal: controller.signal, fresh: true });
    if (flags.flags?.["hellotest.ai.agentic_workflows"] !== true) {
      return result(false, "Agent workflows are disabled", "Enable Agentic Workflows for this workspace before opening the agent.");
    }
    const workflows = await api.agenticWorkflows.list({ project_id: projectId }, { signal: controller.signal, fresh: true });
    if (!Array.isArray(workflows)) throw new Error("Invalid workflow response");
    return result(true, "Workspace access verified", "The workflow studio is reachable for your account and project. Test your selected AI provider separately to verify model credentials and generation.");
  } catch (error) {
    if (signal?.aborted) throw error;
    return result(false, controller.signal.aborted ? "Connection check timed out" : "Workspace access could not be verified",
      controller.signal.aborted ? "The workspace did not respond within 8 seconds. Try again." : "Check your workspace connection, project access and feature settings, then try again.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

export async function openHelloTestRovo(prompt?: string) {
  if (prompt) {
    window.sessionStorage.setItem("hellotest.agentic.handoff", JSON.stringify({
      prompt,
      created_at: new Date().toISOString(),
      source: window.location.pathname
    }));
  }
  window.history.pushState({}, "", "/agentic-workflows");
  window.dispatchEvent(new PopStateEvent("popstate"));
}
