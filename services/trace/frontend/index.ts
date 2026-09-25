import type { ServiceDefinition } from "@hellotest/platform/frontend/src/services/shared";

export const traceService: ServiceDefinition = {
  id: "trace",
  envKey: "VITE_TRACE_SERVICE_URL",
  matches: (pathname) => /^\/(?:ops-telemetry|metrics)(?:\/|$)/.test(pathname)
};
