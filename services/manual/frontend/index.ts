import type { ServiceDefinition } from "@hellotest/platform/frontend/src/services/shared";

export const manualService: ServiceDefinition = {
  id: "manual",
  envKey: "VITE_MANUAL_SERVICE_URL",
  matches: () => true
};
