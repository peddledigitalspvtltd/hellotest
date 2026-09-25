import { platformService } from "@hellotest/platform/frontend/index";
import { testingService } from "@hellotest/testing/frontend/index";
import { knowledgeService } from "@hellotest/knowledge/frontend/index";
import { agenticService } from "@hellotest/agentic/frontend/index";
import { aiService } from "@hellotest/ai/frontend/index";
import { automationService } from "@hellotest/automation/frontend/index";
import { chatbotService } from "@hellotest/chatbot/frontend/index";
import { dashboardService } from "@hellotest/dashboard/frontend/index";
import { integrationService } from "@hellotest/integration/frontend/index";
import { manualService } from "@hellotest/manual/frontend/index";
import { traceService } from "@hellotest/trace/frontend/index";

// Manual is the fallback, so keep it last. Every more specific bounded
// context owns its route matching rule in its own folder.
export const serviceDefinitions = [
  chatbotService,
  knowledgeService,
  agenticService,
  automationService,
  traceService,
  dashboardService,
  integrationService,
  aiService,
  testingService,
  platformService,
  manualService
] as const;

export type { HelloTestService, ServiceDefinition } from "./shared";
