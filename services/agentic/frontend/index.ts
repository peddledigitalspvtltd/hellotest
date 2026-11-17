import type { ServiceDefinition } from "@hellotest/platform/frontend/src/services/shared";

export const agenticService: ServiceDefinition = {
  id: "agentic",
  envKey: "VITE_AGENTIC_SERVICE_URL",
  matches: (pathname) => /^\/(?:agentic-|agent-runs|repository-agents|repository-inspection)/.test(pathname)
};
