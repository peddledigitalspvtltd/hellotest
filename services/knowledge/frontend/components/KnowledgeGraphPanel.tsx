import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { knowledgeApi, type KnowledgeGraph, type KnowledgeGraphNode } from "../api.client";
import { IconChartDots3, IconHistory, IconInfoCircle, IconRoute } from "@tabler/icons-react";
import { ContextGraphPanel } from "./ContextGraphPanel";
import { KnowledgeGraphExplorer } from "./KnowledgeGraphExplorer";
import type { KnowledgeSource } from "@hellotest/platform/frontend/src/types";
import "./KnowledgeGraphPanel.css";
import "./KnowledgeGraphExplorer.css";

const graphApi = knowledgeApi.knowledgeRepo.graph;
const message = (error: unknown) => error instanceof Error ? error.message : "The graph request could not finish.";
const label = (value: string) => value.replace(/_/g, " ").toLowerCase().replace(/^./, letter => letter.toUpperCase());
type Props = { projectId: string; appTypeId?: string; canManage: boolean; sources: KnowledgeSource[]; onOpenSource: (sourceId: string, revisionId?: string) => void };

function Aliases({ projectId, node }: { projectId: string; node: KnowledgeGraphNode }) {
  const cache = useQueryClient();
  const [draft, setDraft] = useState(node.aliases.join("\n"));
  const aliases = draft.split("\n").map(value => value.trim()).filter(Boolean);
  const save = useMutation({ mutationFn: () => graphApi.aliases(projectId, node.id, aliases, node.alias_revision || ""),
    onSuccess: () => { void cache.invalidateQueries({ queryKey: ["knowledge-graph-nodes", projectId] }); } });
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate(); };
  return <details className="knowledge-graph-aliases"><summary>Curated names for {node.title}</summary>
    <form onSubmit={submit} aria-label={`Aliases for ${node.title}`}><label>Aliases, one per line<textarea value={draft} maxLength={2500} rows={3} onChange={event => setDraft(event.target.value)} /></label>
      <p>Use alternate names for this same record. Native IDs remain distinct; ambiguous names are never merged automatically.</p>
      <button className="ghost-button compact" type="submit" disabled={save.isPending || aliases.length > 20 || JSON.stringify(aliases) === JSON.stringify(node.aliases)}>{save.isPending ? "Saving…" : "Save aliases"}</button>
      {save.error ? <p role="alert">{message(save.error)}</p> : save.isSuccess ? <p role="status">Aliases saved.</p> : null}
    </form></details>;
}

export default function KnowledgeGraphPanel({ projectId, appTypeId, canManage, sources, onOpenSource }: Props) {
  const cache = useQueryClient();
  const [mode, setMode] = useState<"knowledge" | "context">("knowledge");
  const [selected, setSelected] = useState<string[]>([]);
  const [choice, setChoice] = useState("");
  const [hops, setHops] = useState(2);
  const [cursor, setCursor] = useState<string | undefined>();
  const schema = useQuery({ queryKey: ["knowledge-graph-schema", projectId], queryFn: () => graphApi.schema(projectId), staleTime: 60_000, enabled:mode==='knowledge' });
  const resolved = useQuery({ queryKey: ["knowledge-graph-nodes", projectId, selected], queryFn: ({ signal }) => graphApi.resolve(projectId, selected, { signal }), enabled: mode==='knowledge'&&selected.length > 0 });
  const candidates = useQuery({ queryKey: ["knowledge-graph-candidates", projectId], queryFn: ({ signal }) => graphApi.candidates(projectId, { signal }), enabled: canManage&&mode==='knowledge' });
  const [built, setBuilt] = useState<{key:string;graph:KnowledgeGraph}|null>(null);
  const expand = useMutation({ mutationFn: ({ seeds, depth }: { seeds: string[]; depth: number; signature: string }) => graphApi.expand(projectId, seeds, depth), onSuccess: (graph, input) => setBuilt({key:input.signature,graph}) });
  const signature = JSON.stringify([selected, hops]);
  const graph = built?.key === signature ? built.graph : undefined;
  const reconcile = useMutation({ mutationFn: () => graphApi.reconcile(projectId, cursor), onSuccess: result => {
    setCursor(result.next_cursor || undefined);
    void cache.invalidateQueries({ queryKey: ["knowledge-graph-nodes", projectId] });
  } });
  const extract = useMutation({ mutationFn: () => graphApi.extract(projectId, selected), onSuccess: () => { void cache.invalidateQueries({ queryKey: ["knowledge-graph-candidates", projectId] }); } });
  const review = useMutation({ mutationFn: (input: { id: string; decision: "approve" | "reject"; revision: string }) => graphApi.review(projectId, input.id, input.decision, input.revision), onSuccess: () => {
    void cache.invalidateQueries({ queryKey: ["knowledge-graph-candidates", projectId] });
    setBuilt(null);
  } });
  const ready = sources.filter(source => source.extraction_status === "ready");
  const maxSeeds = Math.min(6, schema.data?.limits.max_seeds || 6);
  const add = () => { if (choice && !selected.includes(choice) && selected.length < maxSeeds) { setSelected([...selected, choice]); setChoice(""); } };
  const openGraph = (event: FormEvent) => { event.preventDefault(); setBuilt(null); expand.mutate({ seeds: [...selected], depth: hops, signature }); };
  const exploreNode = (id:string) => { const next=[id], nextSignature=JSON.stringify([next,hops]); setSelected(next);setBuilt(null);expand.mutate({seeds:next,depth:hops,signature:nextSignature}); };
  return <section className="knowledge-graph-panel" id="knowledge-panel-graph" role="tabpanel" aria-labelledby="knowledge-tab-graph">
    <div className="knowledge-graph-heading"><div className="knowledge-graph-title"><span className="knowledge-graph-eyebrow">PROJECT KNOWLEDGE</span><h3>Understand the connections</h3><p>Explore what your knowledge means, then follow the context behind a specific AI task.</p></div>
      <div className="knowledge-graph-mode" role="group" aria-label="Graph layer"><button type="button" aria-pressed={mode==='knowledge'} onClick={()=>setMode('knowledge')}><IconChartDots3 size={17}/>Knowledge graph</button><button type="button" aria-pressed={mode==='context'} onClick={()=>setMode('context')}><IconHistory size={17}/>Context graph</button></div>
    </div>
    {mode==='context'?<ContextGraphPanel projectId={projectId} appTypeId={appTypeId} onOpenSource={onOpenSource}/>:<>
    <div className="knowledge-graph-layer-heading"><div><strong>Facts with meaning and source evidence</strong><p>Typed relationships connect indexed records. Select a starting source to explore a bounded part of the graph.</p></div>{canManage ? <button type="button" className="ghost-button compact" onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>{reconcile.isPending ? "Updating…" : cursor ? "Update next graph batch" : "Update graph"}</button> : null}</div>
    <form className="knowledge-graph-controls" onSubmit={openGraph}>
      <label>Start from indexed sources<select value={choice} onChange={event => setChoice(event.target.value)}><option value="">Choose a source</option>{ready.filter(source => !selected.includes(source.id)).map(source => <option key={source.id} value={source.id}>{source.title} · {label(source.source_kind)}</option>)}</select></label>
      <button className="ghost-button" type="button" disabled={!choice || selected.length >= maxSeeds} onClick={add}>Add source</button>
      <label>Relationship depth<select value={hops} onChange={event => setHops(Number(event.target.value))}>{[1, 2, 3].map(depth => <option key={depth} value={depth}>{depth} {depth === 1 ? "hop" : "hops"}</option>)}</select></label>
      <button className="primary-button" type="submit" disabled={!selected.length || resolved.isFetching || expand.isPending}>{expand.isPending ? "Tracing…" : "Trace connections"}</button>
    </form>
    {selected.length ? <div className="knowledge-graph-selection" aria-label="Selected graph sources">{selected.map(sourceId => <button type="button" className="ghost-button compact" key={sourceId} onClick={() => setSelected(selected.filter(value => value !== sourceId))} aria-label={`Remove ${ready.find(source => source.id === sourceId)?.title || sourceId}`}>{ready.find(source => source.id === sourceId)?.title || sourceId} ×</button>)}</div> : <div className="knowledge-map-start-state"><span><IconChartDots3 size={32} stroke={1.3}/></span><h4>Start with a source. Discover its connections.</h4><p>Add an indexed Story, Test Case, document or other source above, then trace its relationships.</p><small>{ready.length} indexed {ready.length===1?'source is':'sources are'} available. Missing records can be added through Knowledge Repo.</small></div>}
    {resolved.data?.unresolved.length ? <p role="status">{resolved.data.unresolved.length} selected source(s) have no readable graph projection yet. {canManage ? "Update the graph and retry." : "Ask a Knowledge Repo manager to update the graph."}</p> : null}
    {[schema.error, resolved.error, expand.error, reconcile.error].filter(Boolean).map((error, index) => <p key={index} role="alert">{message(error)}</p>)}
    {reconcile.isSuccess ? <p role="status">{reconcile.data.processed} revisions checked.{reconcile.data.next_cursor ? " More revisions are available in the next batch." : " This graph batch is current."}</p> : null}
    {expand.isPending?<div className="knowledge-map-loading" role="status"><IconRoute size={18}/>Following readable relationships and source evidence…</div>:null}
    {graph ? <div className="knowledge-graph-results">
      <div className="knowledge-map-stats"><div><span>Connected records</span><strong>{graph.nodes.length}</strong><small>Sources in this bounded view</small></div><div><span>Verified relationships</span><strong>{graph.edges.length}</strong><small>Native links and reviewed evidence</small></div><div><span>Supporting fragments</span><strong>{graph.evidence.length}</strong><small>Exact source revisions, when returned</small></div></div>
      {graph.limitations.partial ? <div className="knowledge-graph-notice" role="status"><IconInfoCircle size={17}/><span>This is a partial graph. Traversal, evidence or access limits were reached; explore a narrower starting source to inspect more.</span></div> : null}
      {(graph.limitations.gaps || []).map(gap => <p className="knowledge-graph-gap" key={gap}>{gap}</p>)}
      <KnowledgeGraphExplorer nodes={graph.nodes} edges={graph.edges} evidence={graph.evidence} mode="knowledge" graphKey={signature} onOpenSource={onOpenSource} onExpandNode={exploreNode} relationDefinitions={schema.data?.relation_definitions}/>
      {!graph.edges.length?<p className="knowledge-graph-empty">No verified connections were found within these bounds. This does not establish that the sources are unrelated.</p>:null}
    </div> : null}
    {canManage ? <details className="knowledge-graph-curation"><summary>Manage graph evidence <small>Aliases and reviewed relationship suggestions</small></summary>
      {(resolved.data?.nodes || []).map(node => <Aliases key={`${node.id}:${node.alias_revision}`} projectId={projectId} node={node} />)}
      <div className="knowledge-graph-heading"><div><h4>Relationship suggestions</h4><p>Optional: one bounded model call reads selected source excerpts. Unsupported suggestions are discarded; approval requires current evidence.</p></div>
        <button type="button" className="ghost-button compact" onClick={() => extract.mutate()} disabled={selected.length < 2 || resolved.data?.nodes.length !== selected.length || extract.isPending}>{extract.isPending ? "Reading excerpts…" : "Suggest links"}</button>
      </div>
      {extract.error ? <p role="alert">{message(extract.error)}</p> : extract.isSuccess ? <p role="status">{extract.data.candidates.length} {extract.data.candidates.length === 1 ? "suggestion" : "suggestions"} prepared for review. {extract.data.rejected ? `${extract.data.rejected} unsupported, stale or already managed suggestions were discarded.` : ""}{extract.data.truncated ? " Selected excerpts were limited to the extraction budget." : ""}</p> : null}
      {candidates.isPending ? <p role="status">Loading relationship reviews…</p> : candidates.error ? <p role="alert">{message(candidates.error)}</p> : !candidates.data?.candidates.length ? <p>No relationship suggestions await review.</p> : <div className="knowledge-graph-candidates">{candidates.data.candidates.map(candidate => <article key={`${candidate.id}:${candidate.chunk_id}`}>
        <h4>{candidate.source_title} → {candidate.target_title}</h4><p>{label(candidate.relation_type)} · source revision {candidate.document_version}</p><blockquote>{candidate.excerpt}</blockquote>
        <div className="knowledge-graph-review-actions"><button type="button" className="ghost-button compact" onClick={() => onOpenSource(candidate.source_id, candidate.document_id)}>Inspect source</button>
          <button type="button" className="primary-button compact" disabled={review.isPending} onClick={() => review.mutate({ id: candidate.id, decision: "approve", revision: candidate.review_revision })}>Approve relationship</button>
          <button type="button" className="ghost-button compact" disabled={review.isPending} onClick={() => review.mutate({ id: candidate.id, decision: "reject", revision: candidate.review_revision })}>Reject</button></div>
      </article>)}</div>}
      {candidates.data?.truncated ? <p>Showing the first 100 readable suggestions. Review these to see the remaining queue.</p> : null}
      {review.error ? <p role="alert">{message(review.error)}</p> : review.isSuccess ? <p role="status">Relationship {review.data.status === "ACTIVE" ? "approved" : "rejected"}.</p> : null}
    </details> : null}
    </>}
  </section>;
}
