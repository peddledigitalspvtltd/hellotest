import "./AgenticAuthoringCanvas.css";

/** Honest field-level comparison. No model-generated claim about correctness. */
export function AiProposalCompare({ fields }: { fields: Array<{ label: string; before: string; after: string }> }) {
  return <section className="ai-proposal-compare" aria-label="Current and proposed content">
    <header><span>Current</span><span>Proposal</span></header>
    {fields.map(field => <div className="ai-proposal-compare__field" data-changed={field.before.trim() !== field.after.trim() || undefined} key={field.label}>
      <strong>{field.label}<small>{field.before.trim() === field.after.trim() ? "Unchanged" : "Changed"}</small></strong>
      <pre>{field.before || "Not set"}</pre><pre>{field.after || "Not set"}</pre>
    </div>)}
  </section>;
}
