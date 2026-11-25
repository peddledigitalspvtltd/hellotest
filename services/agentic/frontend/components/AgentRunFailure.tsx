import type { AgenticAssistantSavedSessionResponse } from "@hellotest/platform/frontend/src/types";

const failureRemedies: Record<string, string> = {
  AGENT_OUTPUT_INVALID: "Narrow the task or add evidence for the requested finding or draft, then retry.",
  AGENT_OUTCOME_FINDING_REFERENCE_INVALID: "Review the evidence scope and request drafts linked to specific findings.",
  AGENT_OUTCOME_FINDING_UNRESOLVED: "Provide source evidence for the open finding or narrow the requested drafts.",
  AGENT_DEADLINE: "Retry with a narrower scope or check the model connection.",
  AUTOMATION_START_URL_REQUIRED: "Open Automation Engineer and supply the application Start URL."
};

export function AgentRunFailure({ session, canViewDiagnostics }: { session: AgenticAssistantSavedSessionResponse; canViewDiagnostics: boolean }) {
  const metadata = session.transaction.metadata;
  const failure = session.failure_details;
  const code = failure?.code || (typeof metadata.error_code === "string" ? metadata.error_code : "");
  const actualError = [...session.events].reverse().find(event => event.level === "error" && event.phase !== "failed");
  const errorMessage = failure?.message || (typeof metadata.error_message === "string" ? metadata.error_message : "") || actualError?.message || session.message;
  const usage = metadata.model_usage as { total_tokens?: number | null } | undefined;
  const modelCalls = typeof metadata.model_calls === "number" ? metadata.model_calls : undefined;
  const rejectedDraft = typeof metadata.rejected_draft === "string" ? metadata.rejected_draft : "";
  const checks = failure?.validation_errors || [];
  const remedy = failureRemedies[code] || (failure?.category === "validation" ? "Review the highlighted requirements and retry with the missing inputs." : "Review the saved activity to see which step needs attention.");

  return <section className="agent-specialist-ready" aria-label="Review failure">
    <h3>{session.provenance.cancelled ? "Review cancelled" : "This review could not finish"}</h3>
    <p>{errorMessage}</p>
    {code && <p><code>{code}</code></p>}
    {checks.length > 0 && <ul>{checks.map((check, index) => <li key={index}>
      {check.path && <><code>{check.path}</code>{" · "}</>}{check.message || check.issue || check.required_property || check.keyword || "Review the output contract."}
    </li>)}</ul>}
    {(typeof usage?.total_tokens === "number" || typeof modelCalls === "number") && <p>{[
      typeof modelCalls === "number" ? `${modelCalls} model call${modelCalls === 1 ? "" : "s"}` : "",
      typeof usage?.total_tokens === "number" ? `${usage.total_tokens.toLocaleString()} tokens` : ""
    ].filter(Boolean).join(" · ")}</p>}
    <p>{remedy}</p>
    {session.guardrail_rules?.length ? <details><summary>Recorded guardrails</summary><ul>{session.guardrail_rules.map(rule => <li key={rule.id}>{rule.enforcement === "code" ? "Code-enforced" : "Prompt instruction"} · {rule.text}</li>)}</ul></details> : null}
    {canViewDiagnostics && rejectedDraft && <details><summary>Rejected draft</summary><pre>{rejectedDraft}</pre></details>}
  </section>;
}
