import type { ServiceDefinition } from "@hellotest/platform/frontend/src/services/shared";

export const integrationService: ServiceDefinition = {
  id: "integration",
  envKey: "VITE_INTEGRATION_SERVICE_URL",
  matches: (pathname) => /^\/projects\/[^/]+\/sync(?:\/|$)|^\/ai-prompt-templates(?:\/|$)|^\/integrations(?:\/|$)/.test(pathname)
};
