import type { AgentReviewRequest } from "@hellotest/contracts/agents";
import { consumeAssistantProgress, type AgentProgress } from "./assistantProgressStream";
import type { AgenticAssistantMode, AgenticAssistantSessionResponse } from "@hellotest/platform/frontend/src/types";
import { AI_REQUEST_TIMEOUT_MS } from "@hellotest/platform/frontend/src/platform/lib/requestTimeout";
import { API_BASE_URL, readRequestSession, request, toQueryString } from "@hellotest/platform/frontend/src/lib/httpClient";
import { resolveServiceBase } from "@hellotest/platform/frontend/src/platform/lib/serviceEndpoints";

export const requestAgentReview = (input: AgentReviewRequest, options?: { signal?: AbortSignal; onProgress?: (event: AgentProgress) => void }) => {
      if (!options?.onProgress) return request<AgenticAssistantSessionResponse>("/agentic-assistant/sessions", {
        method: "POST", body: JSON.stringify(input), signal: options?.signal
      }, AI_REQUEST_TIMEOUT_MS);
      return (async () => {
        const controller=new AbortController();
        const abort=()=>controller.abort();
        options.signal?.addEventListener("abort",abort,{once:true});
        if(options.signal?.aborted)controller.abort();
        const timer=setTimeout(abort,AI_REQUEST_TIMEOUT_MS);
        try {
          const path="/agentic-assistant/sessions";
          const token=readRequestSession().token;
          const response=await fetch(`${resolveServiceBase(path,API_BASE_URL)}${path}`,{
            method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream",...(token?{Authorization:`Bearer ${token}`}:{})},
            body:JSON.stringify(input),signal:controller.signal
          });
          if(!response.ok) {const failure=await response.json().catch(()=>({}));throw new Error(failure.message || failure.error || `Review request failed (${response.status}).`);}
          if(!response.headers.get("content-type")?.includes("text/event-stream"))return response.json() as Promise<AgenticAssistantSessionResponse>;
          return await consumeAssistantProgress<AgenticAssistantSessionResponse>(response,options.onProgress,controller.signal);
        } finally {clearTimeout(timer);options.signal?.removeEventListener("abort",abort);}
      })();
    };

export type AgentEvidenceScopeOption = { id: string; label: string; description?: string };
export const evidenceScopeOptions = (query: { project_id: string; app_type_id?: string; field: string; search?: string; limit?: number; story_id?: string; test_case_id?: string; execution_id?: string; release_id?: string; sprint_id?: string }, options?: { signal?: AbortSignal }) => request<{ items: AgentEvidenceScopeOption[]; has_more: boolean }>(`/agentic-workflows/evidence-scope/options${toQueryString(query)}`, { signal: options?.signal, cache: "no-store" });
