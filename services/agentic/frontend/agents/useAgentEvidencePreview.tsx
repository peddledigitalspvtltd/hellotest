import { useEffect, useState } from "react";
import evidenceFields from "@hellotest/contracts/agents/evidenceScopeFields.json";
import { agenticApi } from "../api.client";

export type EvidencePreviewInput = {
  project_id: string;
  app_type_id?: string;
  agent_id: string;
  agent_version?: number;
  prompt: string;
  context_scopes: string[];
  inputs: Record<string, unknown>;
};
export type EvidencePreviewResult = {
  status: "checked" | "unavailable";
  scopes: Array<{ scope: string; required_confirmation: boolean; available: number | null; preview_count: number | null }>;
};
const evidenceNames: Record<string, string> = {
  stories: "Stories", "test-cases": "Test Cases", runs: "Runs", bugs: "Defects", automation: "Automation objects", knowledge: "Knowledge"
};

export function useAgentEvidencePreview(input: EvidencePreviewInput, enabled: boolean) {
  const evidenceInputs = Object.fromEntries(evidenceFields.flatMap(field => typeof input.inputs[field.key] === "string" ? [[field.key, input.inputs[field.key]]] : []));
  const key = JSON.stringify({ ...input, inputs: evidenceInputs });
  const [review, setReview] = useState<{ key: string; result: EvidencePreviewResult }>();
  useEffect(() => {
    if (!enabled || !input.prompt.trim()) return;
    const controller = new AbortController();
    const save = (value?: EvidencePreviewResult) => {
      if (controller.signal.aborted) return;
      const result = value && Array.isArray(value.scopes) ? value : { status: "unavailable" as const, scopes: [] };
      setReview({ key, result });
    };
    const timer = window.setTimeout(() => {
      void agenticApi.agenticWorkflows.evidencePreview(JSON.parse(key), controller.signal).then(save, () => save());
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key, enabled]);

  const summary = enabled && review?.key === key ? review.result : undefined;
  const pending = Boolean(enabled && input.prompt.trim() && !summary);
  const confirmedMissing = Boolean(summary?.scopes.some(row => row.required_confirmation));
  const submitLabel = confirmedMissing ? "Start with limited evidence" : "Start review";
  const panel = pending ? <p role="status">Checking evidence available to this review…</p> : summary && <section className="agent-specialist-ready" aria-label="Evidence preview">
    <h3>Evidence preview</h3>
    {summary.status === "unavailable" ? <p>The evidence check is unavailable. The review can check evidence when it starts.</p> : <>
      <ul>{summary.scopes.map(row => <li key={row.scope}><strong>{evidenceNames[row.scope] || row.scope}</strong> · {
        row.available == null ? row.scope === "knowledge" ? "Checked during retrieval" : "Unavailable in this scope"
          : `${row.available} available${row.preview_count != null ? ` · ${row.preview_count} selected for preview` : ""}`
      }</li>)}</ul>
      {confirmedMissing && <p>One or more priority scopes have no matching records. Change the evidence scope or confirm that the review can start with limited evidence.</p>}
      <p>The review selects its final evidence when it starts.</p>
    </>}
  </section>;
  return { pending, submitLabel, panel };
}
