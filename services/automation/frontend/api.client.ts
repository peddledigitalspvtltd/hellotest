import { request } from "@hellotest/platform/frontend/src/lib/httpClient";



export type AutomationAuthoringState = { case_id:string;state:'idle'|'building'|'recording'|'conflict';build:{activity_id:string;status:string;phase?:string}|null;recording:{activity_id:string;status:string;phase?:string}|null;can_build:boolean;can_record:boolean };
export const automationApi = {
  authoringState: (caseId:string, signal?:AbortSignal) => request<AutomationAuthoringState>(`/test-cases/${encodeURIComponent(caseId)}/automation/authoring-state`,{signal,cache:'no-store'}),
localAgent: {
    status: () =>
      request<{
        launch_supported: boolean;
        web: { ready: boolean; base_url: string | null; health?: Record<string, unknown> | null; code?: string; message?: string };
        mobile: { ready: boolean; base_url: string | null; health?: Record<string, unknown> | null };
        appium: { ready: boolean; base_url: string | null; health?: Record<string, unknown> | null };
        recommended: {
          web_public_base_url: string;
          mobile_public_base_url: string;
          appium_server_url: string;
        };
      }>("/local-agent/status"),
    start: (input?: { target?: "playwright" | "web" }) =>
      request<{
        started: boolean;
        launch_supported: boolean;
        already_running?: boolean;
        base_url?: string;
        pid?: number;
        message: string;
      }>("/local-agent/start", {
        method: "POST",
        body: JSON.stringify(input || {})
      })
  }
};

