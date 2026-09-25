import type { ServiceDefinition } from "@hellotest/platform/frontend/src/services/shared";

export const chatbotService: ServiceDefinition = {
  id: "chatbot",
  envKey: "VITE_CHATBOT_SERVICE_URL",
  matches: (pathname) => /^\/knowledge\/assistant(?:\/|$)/.test(pathname)
};
