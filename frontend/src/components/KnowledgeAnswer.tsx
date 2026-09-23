import type { KnowledgeAssistantMessage, KnowledgeCitation } from "../types";
import { knowledgeCitationHref, knowledgeCitationLocation, validateKnowledgeAnswer } from "../lib/knowledgeAnswer";
import { KnowledgeFormattedText } from "./KnowledgeFormattedText";

export function KnowledgeAnswer({ message, onEvidenceOpen }: { message: KnowledgeAssistantMessage; onEvidenceOpen: (citation: KnowledgeCitation) => void }) {
  const answer = validateKnowledgeAnswer(message);
  if (!answer) return null;
  const sources = Array.from(answer.citations.values());
  const evidenceLinks = (ids: string[]) => <span className="knowledge-claim-citations">{ids.map((id) => {
    const citation = answer.citations.get(id);
    if (!citation) return null;
    const href = knowledgeCitationHref(citation);
    const number = sources.findIndex((source) => (source.evidence_id || source.id) === id) + 1;
    const title = [citation.title || citation.label || "Source", knowledgeCitationLocation(citation)].filter(Boolean).join(" · ");
    return href && !href.startsWith("/knowledge-repo?") ? <a aria-label={`Source ${number}: ${title}`} href={href} key={id} rel="noreferrer" target={href.startsWith("/") ? undefined : "_blank"} title={title}>[{number}]</a> : <button aria-label={`Show source ${number}: ${title}`} key={id} onClick={() => onEvidenceOpen(citation)} title={title} type="button">[{number}]</button>;
  })}</span>;
  const payload = answer.presentation.payload;
  const tableColumns = (payload.columns || []) as Array<{ key: string; label: string }>;
  const tableRows = (payload.rows || []) as Array<{ cells: Record<string, string>; evidence_ids: string[] }>;
  const items = (payload.items || []) as Array<{ date: string; title: string; description?: string; label: string; value: string; unit?: string; evidence_ids: string[]; evidence_id: string }>;
  const nodes = (payload.nodes || []) as Array<{ id: string; label: string; type: string; evidence_ids: string[] }>;
  const edges = (payload.edges || []) as Array<{ source: string; target: string; type: string; evidence_ids: string[] }>;
  const limitations = [
    answer.limitations.authorization_partial ? "Some source content is outside your access scope." : "",
    answer.limitations.budget_partial ? "Retrieval stopped at its time or context limit." : "",
    answer.limitations.stale_sources?.length ? `${answer.limitations.stale_sources.length} source${answer.limitations.stale_sources.length === 1 ? " may be" : "s may be"} out of date.` : "",
    answer.limitations.unavailable_sources ? `${answer.limitations.unavailable_sources} source${answer.limitations.unavailable_sources === 1 ? " was" : "s were"} unavailable.` : ""
  ].filter(Boolean);
  return <div className="knowledge-validated-answer" aria-label="Evidence-linked answer">
    {answer.partial ? <div className="knowledge-answer-limit" role="status"><strong>Partial retrieval · limited evidence</strong><span>These findings cover the sources available for this turn. Review the limits below before treating them as a complete project assessment.</span></div> : null}
    {!answer.claims.length && answer.summary ? <KnowledgeFormattedText className="knowledge-answer-summary" text={answer.summary} /> : null}
    {answer.claims.length ? <div className="knowledge-answer-overview"><strong>What the evidence shows</strong><span>{answer.claims.length} finding{answer.claims.length === 1 ? "" : "s"} · {sources.length} cited source{sources.length === 1 ? "" : "s"}</span></div> : null}
    {answer.claims.length ? <ul className="knowledge-answer-claims">{answer.claims.map((claim) => <li key={claim.id}>{claim.classification === "INTERPRETATION" ? <span className="knowledge-interpretation-label">Interpretation</span> : null}<KnowledgeFormattedText text={claim.text} />{evidenceLinks(claim.evidenceIds)}</li>)}</ul> : null}
    {["TABLE", "COMPARISON"].includes(answer.presentation.type) ? <div className="knowledge-answer-table-scroll" tabIndex={0} role="region" aria-label={answer.presentation.type === "COMPARISON" ? "Evidence comparison" : "Evidence table"}><table><thead><tr>{tableColumns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}<th scope="col">Evidence</th></tr></thead><tbody>{tableRows.map((row, index) => <tr key={index}>{tableColumns.map((column) => <td key={column.key}>{row.cells[column.key]}</td>)}<td>{evidenceLinks(row.evidence_ids)}</td></tr>)}</tbody></table></div> : null}
    {answer.presentation.type === "TIMELINE" ? <ol className="knowledge-answer-timeline">{items.map((item, index) => <li key={index}><time>{item.date}</time><div><strong>{item.title}</strong>{item.description ? <p>{item.description}</p> : null}{evidenceLinks(item.evidence_ids)}</div></li>)}</ol> : null}
    {answer.presentation.type === "METRIC" ? <div className="knowledge-answer-metrics">{items.map((item, index) => <div key={index}><span>{item.label}</span><strong>{item.value} {item.unit}</strong>{evidenceLinks(item.evidence_ids)}</div>)}</div> : null}
    {answer.presentation.type === "RELATIONSHIP_GRAPH" ? <ul className="knowledge-answer-relationships">{edges.map((edge, index) => <li key={index}><span>{nodes.find((node) => node.id === edge.source)?.label}</span><span aria-label="relationship"> → {edge.type.replace(/_/g, " ").toLowerCase()} → </span><span>{nodes.find((node) => node.id === edge.target)?.label}</span>{evidenceLinks(edge.evidence_ids)}</li>)}</ul> : null}
    {["DOCUMENT_RESULTS", "IMAGE_RESULTS"].includes(answer.presentation.type) ? <ul className="knowledge-answer-documents">{items.map((item) => { const source = answer.citations.get(item.evidence_id); return source ? <li key={item.evidence_id}><strong>{source.title || source.label || "Source"}</strong><span>{knowledgeCitationLocation(source)}</span>{evidenceLinks([item.evidence_id])}</li> : null; })}</ul> : null}
    {limitations.length || answer.gaps.length ? <div className="knowledge-answer-limitations"><strong>Evidence limits</strong><ul>{[...new Set([...limitations, ...answer.gaps])].map((gap, index) => <li key={index}>{gap}</li>)}</ul></div> : null}
    {sources.some((source) => source.freshness) ? <div className="knowledge-answer-freshness">{sources.filter((source) => source.freshness?.current === false || source.freshness?.stale).map((source) => <span key={source.id}>{source.title || source.label || "Source"} · {source.freshness?.stale ? "May be out of date" : "Historical revision"}{source.freshness?.effective_from ? ` · ${new Date(source.freshness.effective_from).toLocaleDateString()}` : ""}</span>)}</div> : null}
  </div>;
}
