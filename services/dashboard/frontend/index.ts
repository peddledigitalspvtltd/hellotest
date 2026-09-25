import type { ServiceDefinition } from "@hellotest/platform/frontend/src/services/shared";

export const dashboardService: ServiceDefinition = {
  id: "dashboard",
  envKey: "VITE_DASHBOARD_SERVICE_URL",
  matches: (pathname) => /^\/(?:analytics|quality-dashboards)(?:\/|$)|^\/ai\/quality-insights(?:\/|$)/.test(pathname)
};
