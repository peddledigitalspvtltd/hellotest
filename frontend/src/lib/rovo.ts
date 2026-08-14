export const ROVO_NATIVE_INTEGRATION_ID = "qaira-rovo-native";
export const QAIRA_ROVO_AGENT_KEY = "qaira-qa-agent";
export const QAIRA_ROVO_AGENT_NAME = "HelloTest QA Agent";

export function isRovoIntegrationId(value: string | null | undefined) {
  return String(value || "") === ROVO_NATIVE_INTEGRATION_ID;
}

export async function isQairaRovoAvailable() {
  return true;
}

export async function openQairaRovo(prompt?: string) {
  if (prompt) {
    window.sessionStorage.setItem("qaira.agentic.handoff", JSON.stringify({
      prompt,
      created_at: new Date().toISOString(),
      source: window.location.pathname
    }));
  }
  window.history.pushState({}, "", "/agentic-workflows");
  window.dispatchEvent(new PopStateEvent("popstate"));
}
