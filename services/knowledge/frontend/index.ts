import type { ServiceDefinition } from "@hellotest/platform/frontend/src/services/shared";

export const knowledgeService: ServiceDefinition = {
  id: "knowledge",
  envKey: "VITE_KNOWLEDGE_SERVICE_URL",
  matches: (pathname) => /^\/knowledge(?:\/|$)|^\/projects\/[^/]+\/knowledge(?:\/|$)|^\/v1\/context(?:\/|$)/.test(pathname)
};
