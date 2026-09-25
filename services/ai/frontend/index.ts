import type { ServiceDefinition } from "@hellotest/platform/frontend/src/services/shared";

export const aiService: ServiceDefinition = {
  id: "ai",
  envKey: "VITE_AI_SERVICE_URL",
  matches: (pathname) => /^\/ai(?:\/|$)|\/ai-(?:impact-preview|failure-clusters)(?:\/|$)/.test(pathname)
};
