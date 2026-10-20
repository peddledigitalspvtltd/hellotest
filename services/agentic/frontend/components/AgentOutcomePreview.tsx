import type { AgentOutcomePreview as Preview } from '../lib/assistantProgressStream';
import { AgentReportVisuals, AgentStructuredValue } from './AgentStructuredValue';

/** Validated intermediate output has no approval or write controls. */
export function AgentOutcomePreview({ value }: { value: Preview }) {
  return <section className="agent-outcome-panel agent-outcome-preview" aria-label="Review output in progress">
    <header><div><span>Validated draft · still in progress</span><strong>{value.headline || 'Evidence review'}</strong></div></header>
    <p>Draft content may change as the remaining checks and specialist handoffs finish. Approval is available with the saved final review.</p>
    {value.executive_summary && <AgentStructuredValue value={value.executive_summary} />}
    {value.findings?.length ? <details><summary>Findings so far · {value.findings.length}</summary>{value.findings.map((finding,index) => <article key={finding.id || index}><h4>{finding.title}</h4><AgentStructuredValue value={finding.detail} /></article>)}</details> : null}
    {value.artifacts?.length ? <details open><summary>Proposals so far · {value.artifacts.length}</summary>{value.artifacts.map((artifact,index) => <article key={index}><h4>{artifact.title}</h4><small>{artifact.kind.replace(/_/g,' ')} · {artifact.priority}</small><AgentStructuredValue value={artifact.description} /></article>)}</details> : null}
    <AgentReportVisuals sections={value.sections} tables={value.tables} charts={value.charts} />
  </section>;
}
