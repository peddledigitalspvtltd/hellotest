import type { Execution } from "@hellotest/platform/frontend/src/types";

type CaseIdentity = { test_case_id: string; data_set_iteration_index?: number | null; data_set_iteration_key?: string | null };

export function caseLiveViewSession(execution: Pick<Execution, "status" | "live_sessions"> | null | undefined, selectedCase: CaseIdentity | null | undefined) {
  if (execution?.status !== "running" || !selectedCase) return null;
  return execution.live_sessions?.find(session => {
    if (session.test_case_id !== selectedCase.test_case_id) return false;
    if ((session.data_set_iteration_index ?? null) !== (selectedCase.data_set_iteration_index ?? null)) return false;
    if ((session.data_set_iteration_key ?? null) !== (selectedCase.data_set_iteration_key ?? null)) return false;
    try {
      const url = new URL(session.url);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
        && url.pathname === "/api/v1/live-session" && url.searchParams.get("run_id") === session.engine_run_id;
    } catch { return false; }
  }) || null;
}
