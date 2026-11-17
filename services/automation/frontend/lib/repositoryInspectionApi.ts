import { API_BASE_URL, request, toQueryString } from "@hellotest/platform/frontend/src/lib/httpClient";
import { resolveServiceBase } from "@hellotest/platform/frontend/src/platform/lib/serviceEndpoints";
import type { RecorderSessionResponse } from "@hellotest/platform/frontend/src/types";

export const repositoryInspectionApi = {
    localAgentSetup: async (input: { project_id: string; origin: string; agent_token: string }, options?: { signal?: AbortSignal }) => {
      const setup = await request<{ download_url: string; expires_at: string }>("/repository-inspection/local-agent/setup", { method: "POST", body: JSON.stringify(input), signal: options?.signal });
      const serviceBase = resolveServiceBase("/repository-inspection", API_BASE_URL);
      return { ...setup, download_url: new URL(`${serviceBase}/${setup.download_url.replace(/^\//, "")}`, window.location.origin).href };
    },
    capabilities: (projectId: string, options?: { signal?: AbortSignal }) =>
      request<{ remote: { available: boolean; reason: string | null }; local: { base_url: string; setup_command: string } }>(`/repository-inspection/capabilities${toQueryString({ project_id: projectId })}`, { signal: options?.signal, cache: "no-store" }),
    start: async (input: { project_id: string; app_type_id?: string; start_url?: string }) => {
      const session = await request<RecorderSessionResponse>("/repository-inspection/sessions", { method: "POST", body: JSON.stringify(input) }, 90_000);
      const resolve = (path: string | null | undefined) => path ? new URL(`${resolveServiceBase(path, API_BASE_URL)}/${path.replace(/^\//, "")}`, window.location.origin).href : undefined;
      return { ...session, recorder_mode: "remote" as const, status_url: resolve(session.status_url), live_view_url: resolve(session.live_view_url) };
    }
  };
