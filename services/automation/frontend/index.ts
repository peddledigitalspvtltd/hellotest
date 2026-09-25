import type { ServiceDefinition } from "@hellotest/platform/frontend/src/services/shared";

export const automationService: ServiceDefinition = {
  id: "automation",
  envKey: "VITE_AUTOMATION_SERVICE_URL",
  matches: (pathname) => /^\/(?:api\/testengine|testengine\/|automation-generator|api\/engine|api\/runs|local-agent)/.test(pathname)
};
