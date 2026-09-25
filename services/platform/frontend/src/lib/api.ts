// Stable public client facade. Endpoint implementations belong to each capability.
import { manualApi } from "@hellotest/manual/frontend/api.client";
import { platformApi } from "@hellotest/platform/frontend/api.client";
import { chatbotApi } from "@hellotest/chatbot/frontend/api.client";
import { testingApi } from "@hellotest/testing/frontend/api.client";
import { agenticApi } from "@hellotest/agentic/frontend/api.client";
import { aiApi } from "@hellotest/ai/frontend/api.client";
import { dashboardApi } from "@hellotest/dashboard/frontend/api.client";
import { knowledgeApi } from "@hellotest/knowledge/frontend/api.client";
import { integrationApi } from "@hellotest/integration/frontend/api.client";
import { automationApi } from "@hellotest/automation/frontend/api.client";
import { traceApi } from "@hellotest/trace/frontend/api.client";
export type { PagedResult } from "./httpClient";
export type { AiStoryEvidenceSource } from "@hellotest/manual/frontend/api.client";
export type { HelloTestEntityScope } from "@hellotest/platform/frontend/api.client";
export { hellotestAuthSessionEvents } from "@hellotest/platform/frontend/api.client";
export type { JiraCreateFieldMetadata } from "@hellotest/integration/frontend/lib/jiraIssueContracts";
export type { JiraIssueCreateMetadata } from "@hellotest/integration/frontend/lib/jiraIssueContracts";
export type { JiraWorkflowStatus } from "@hellotest/integration/frontend/lib/jiraIssueContracts";
export type { JiraWorkflowStatusCatalog } from "@hellotest/integration/frontend/lib/jiraIssueContracts";
export type { JiraBugCreateMetadata } from "@hellotest/integration/frontend/lib/jiraIssueContracts";
export { sessionStorage } from "./httpClient";
export { HelloTestApiError } from "./httpClient";

export const api = {
  ...manualApi,
  ...platformApi,
  ...testingApi,
  ...agenticApi,
  ...aiApi,
  ...dashboardApi,
  ...knowledgeApi,
  ...integrationApi,
  ...automationApi,
  ...traceApi,
  knowledgeRepo: { ...knowledgeApi.knowledgeRepo, assistant: chatbotApi.assistant }
};
