export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
// Covers bounded model generation, context retrieval and response validation.
// The API/proxy allows 210s; give it time to return its actionable error first.
export const AI_REQUEST_TIMEOUT_MS = 180_000;

export function getRequestTimeout(path: string, method = "GET"): number {
  const route = path.split("?", 1)[0];
  const generates = method.toUpperCase() === "POST" && (
    /\/(?:ai-(?:create-preview|optimize-preview|description-rephrase|gherkin-preview|groom-preview|impact-preview|authoring-preview|step-rephrase|draft-preview|triage-preview|failure-clusters|analysis|assessment|generate-preview|improve)|smart-plan-preview|design-test-cases-preview|generate-test-cases|dashboard-design-preview|release-notes)$/.test(route)
    || route === "/ai/rich-text-rephrase"
    || route === "/agentic-assistant/sessions"
    || /^\/knowledge\/assistant\/sessions\/[^/]+\/messages$/.test(route)
  );
  return generates ? AI_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS;
}
