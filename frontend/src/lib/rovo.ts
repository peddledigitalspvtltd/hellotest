export const ROVO_NATIVE_INTEGRATION_ID = "hellotest-rovo-native";
export const HELLOTEST_ROVO_AGENT_KEY = "hellotest-qa-agent";
export const HELLOTEST_ROVO_AGENT_NAME = "HelloTest QA Agent";

export function isRovoIntegrationId(value: string | null | undefined) {
  return String(value || "") === ROVO_NATIVE_INTEGRATION_ID;
}

export async function isHelloTestRovoAvailable() {
  return true;
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
