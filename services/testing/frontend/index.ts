import type { ServiceDefinition } from "@hellotest/platform/frontend/src/services/shared";

export const testingService: ServiceDefinition = {
  id: "testing",
  envKey: "VITE_TESTING_SERVICE_URL",
  matches: (pathname) => /^\/(?:issues|feedback|test-case-defects|test-case-modules|test-suites|suite-test-cases|test-cases|test-steps|shared-step-groups|test-environments|test-configurations|test-data-sets|executions|execution-schedules|execution-results)(?:\/|$)/.test(pathname)
};
