import { useCallback, useEffect, useRef, useState } from "react";
import type { AiProcessingSnapshot } from "@hellotest/platform/frontend/src/types";
import { manualApi, type AiRequirementGenerationJobResponse } from "../api.client";

export function useDurableAuthoringJob(projectId: string, onCheckpoint?: (job: AiRequirementGenerationJobResponse) => void) {
  const [job, setJob] = useState<AiRequirementGenerationJobResponse | null>(null);
  const current = useRef<{ id: string; projectId: string; stopped: boolean; cancelRequested: boolean } | null>(null);
  const checkpointCallback = useRef(onCheckpoint);
  checkpointCallback.current = onCheckpoint;
  useEffect(() => () => { if (current.current) current.current.stopped = true; }, [projectId]);
  const cancel = useCallback(async () => {
    const active = current.current;
    if (active) active.cancelRequested = true;
    if (active?.id) setJob(await manualApi.requirements.cancelGenerationJob(active.id, active.projectId));
  }, []);
  const run = useCallback(async <T,>(create: () => Promise<AiRequirementGenerationJobResponse>): Promise<T> => {
    const active = { id: "", projectId, stopped: false, cancelRequested: false };
    current.current = active;
    setJob(null);
    let next = await create();
    active.id = next.id;
    if (active.cancelRequested) next = await manualApi.requirements.cancelGenerationJob(active.id, active.projectId);
    while (!active.stopped) {
      setJob(next);
      checkpointCallback.current?.(next);
      if (next.status === "completed") return next.result_payload as T;
      if (["failed", "cancelled"].includes(next.status)) {
        throw Object.assign(new Error(next.last_error || (next.status === "cancelled" ? "Generation stopped. Saved proposals remain available." : "Generation could not complete.")), next.failure || {}, { code: next.error_code || next.failure?.code || "AI_JOB_CANCELLED" });
      }
      await new Promise(resolve => window.setTimeout(resolve, 2000));
      if (active.stopped) break;
      next = await manualApi.requirements.getGenerationJob(active.id, { project_id: projectId });
    }
    throw Object.assign(new Error("The workspace changed. Generation remains available in the saved job history."), { code: "AI_JOB_INTERRUPTED" });
  }, [projectId]);
  return { job, run, cancel, processing: job?.processing as AiProcessingSnapshot | undefined, failure: job?.failure, isRunning: Boolean(job && ["queued", "running"].includes(job.status)) };
}
