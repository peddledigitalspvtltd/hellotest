import type { AgenticProcessingSnapshot, AgenticProcessStageId } from "@hellotest/ai/agent-experience";
import contract from "../../shared/generationStages.json";

// A synchronous response supplies no live server phase updates. Keep all work
// unconfirmed while the request is pending; elapsed time is only a duration.
export function pendingAuthoringProcessing(): AgenticProcessingSnapshot {
  return {
    active_stage_id: "intake", completed_stage_count: 0, total_stage_count: contract.stages.length,
    progress_mode: "indeterminate", status_label: "Request sent; awaiting server-reported stages.",
    stages: (contract.stages as AgenticProcessStageId[]).map((id, index) => ({ id,
      status: index === 0 ? "running" : "queued", detail: "Awaiting confirmation from the server." }))
  };
}
