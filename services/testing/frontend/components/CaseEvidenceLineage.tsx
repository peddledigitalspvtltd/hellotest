import type { ExecutionResult } from "@hellotest/platform/frontend/src/types";
import { caseEvidenceLineage, type CaseChannelEvidence } from "../lib/caseLibrarySignals";

export function CaseEvidenceLineage({ history, channels, onOpen }: { history: ExecutionResult[]; channels?: CaseChannelEvidence; onOpen: (result: ExecutionResult) => void }) {
  const lineage = caseEvidenceLineage(history, channels);
  return <div className="case-evidence-lineage" aria-label="Latest manual and automation evidence">
    <small>Latest of manual or automation · {lineage.latest?.status || "No runs"}</small>
    {([['Manual', lineage.manual], ['Automation', lineage.automation]] as const).map(([label, result]) => result
      ? <button className="link-button" type="button" key={label} onClick={event => { event.stopPropagation(); onOpen(result); }}>{label}: {result.status}{result.source_display_id ? ` · ${result.source_display_id}` : ""}</button>
      : <span key={label}>{label}: {channels ? "no recorded outcome" : "not observed in the available history"}</span>)}
  </div>;
}
