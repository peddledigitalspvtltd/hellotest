export type GraphViewNode = { id: string; kind: string; title: string; ref_id?: string; source_id?: string; observed_at?: string; aliases?: string[]; metadata?: Record<string, unknown>; source_version?: string | number; source_status?: string; evidence_state?: string; valid_from?: string | null; valid_to?: string | null };
export type GraphViewEdge = { id: string; source: string; target: string; type: string; provenance_type: string; evidence_ids: string[]; observed_at?: string; confidence?: number | null; valid_from?: string | null; valid_to?: string | null; metadata?: Record<string,unknown> };
export const graphLabel = (value: string) => String(value || '').replace(/[_.-]/g, ' ').toLowerCase().replace(/^./, letter => letter.toUpperCase());
export function graphNodeTitle(node: GraphViewNode) { return node.kind==='task'&&node.title===node.metadata?.feature_id ? graphLabel(node.title.replace(/^ai\./,'')) : node.title; }
export function graphKindLabel(kind: string) {
  return ({requirement:'Story',test_case:'Test Case',execution:'Test Run',bug:'Defect',knowledge_item:'Knowledge note',context_packet:'Context packet',decision_event:'Recorded event',source_evidence:'Source evidence',live_snapshot:'Project snapshot',product_help:'Product guide',policy_check:'Access policy check'} as Record<string,string>)[kind] || graphLabel(kind);
}
export function graphProofLabel(provenance: string) {
  return ({DETERMINISTIC:'Native relationship',HUMAN_VERIFIED:'Reviewed relationship',SOURCE_EXPLICIT:'Source assertion',OBSERVED_EVENT:'Recorded event'} as Record<string,string>)[provenance] || graphLabel(provenance);
}
export function graphDate(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Not recorded' : date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
}
export function canOpenGraphSource(node: GraphViewNode) { return Boolean(node.source_id && node.source_id !== 'hellotest-product-help' && !['product_help','live_snapshot'].includes(node.kind) && node.metadata?.indexed !== false); }
/** Display only persisted endpoints. Filtering changes the view, never the graph or its proof. */
export function filterGraph(nodes: GraphViewNode[], edges: GraphViewEdge[], filters: {query?: string; kind?: string; relation?: string; provenance?: string}) {
  const ids = new Set(nodes.map(node => node.id));
  const valid = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  const eligible = valid.filter(edge => (!filters.relation || edge.type === filters.relation) && (!filters.provenance || edge.provenance_type === filters.provenance));
  const query = filters.query?.trim().toLocaleLowerCase();
  const matching = new Set(nodes.filter(node => (!filters.kind || node.kind === filters.kind) && (!query || [node.title,node.id,node.ref_id,...(node.aliases || [])].filter(Boolean).join(' ').toLocaleLowerCase().includes(query))).map(node => node.id));
  const bounded = Boolean(query || filters.kind || filters.relation || filters.provenance);
  const shownEdges = bounded ? eligible.filter(edge => matching.has(edge.source) && matching.has(edge.target)) : eligible;
  const related = new Set(shownEdges.flatMap(edge => [edge.source,edge.target]));
  const shownNodes = nodes.filter(node => matching.has(node.id) && (!(filters.relation || filters.provenance) || related.has(node.id)));
  const shownIds = new Set(shownNodes.map(node => node.id));
  return {nodes:shownNodes,edges:shownEdges.filter(edge=>shownIds.has(edge.source)&&shownIds.has(edge.target)),omitted_edges:edges.length-valid.length};
}
/** Stable layered layout. Cycles retain their recorded direction; no causal links are inferred. */
export function layoutGraph(nodes: GraphViewNode[], edges: GraphViewEdge[]) {
  const sorted = [...nodes].sort((a,b) => a.id.localeCompare(b.id));
  const ids = new Set(sorted.map(node=>node.id)), incoming = new Map(sorted.map(node=>[node.id,0])), children = new Map(sorted.map(node=>[node.id,[] as string[]]));
  for (const edge of edges) if (ids.has(edge.source)&&ids.has(edge.target)&&edge.source!==edge.target) {
    incoming.set(edge.target,(incoming.get(edge.target)||0)+1); children.get(edge.source)!.push(edge.target);
  }
  const rank = new Map<string,number>(), queue = sorted.filter(node=>incoming.get(node.id)===0).map(node=>node.id);
  for(const id of queue)rank.set(id,0);
  for(let index=0;index<queue.length;index++) {
    const id=queue[index];
    for(const child of [...children.get(id)!].sort()) {
      rank.set(child,Math.max(rank.get(child)||0,(rank.get(id)||0)+1));
      incoming.set(child,incoming.get(child)!-1);if(incoming.get(child)===0)queue.push(child);
    }
  }
  const columns = new Map<number,GraphViewNode[]>();
  for(const node of sorted) {const column=Math.min(6,rank.get(node.id)||0);columns.set(column,[...(columns.get(column)||[]),node]);}
  const maxRows=Math.max(1,...[...columns.values()].map(group=>group.length));
  return sorted.map(node=>{const column=Math.min(6,rank.get(node.id)||0),group=columns.get(column)!;return {id:node.id,position:{x:column*330,y:(group.indexOf(node)+(maxRows-group.length)/2)*148}};});
}
