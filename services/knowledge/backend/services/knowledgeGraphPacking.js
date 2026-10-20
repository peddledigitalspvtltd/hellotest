const {fail,number} = require('./knowledgeGraphContracts');
const {compactGraphEvidence} = require('./knowledgeGraphEvidence');

// Rebuild from the currently visible roots: pruning an intermediate node must
// also remove disconnected descendants and every old path mentioning it.
function reachableGraph({nodes,edges,seeds,hops,direction='both'}) {
  const byId=new Map(nodes.map(node=>[node.id,node])),rootIds=seeds.filter(id=>byId.has(id));
  const queue=rootIds.map(id=>({id,path:[id],path_edges:[],depth:0})),seen=new Set(rootIds),kept=new Map();
  while(queue.length){const current=queue.shift();if(current.depth>=hops)continue;
    for(const edge of edges){
      const next=edge.source===current.id&&direction!=='inbound'?edge.target:edge.target===current.id&&direction!=='outbound'?edge.source:null;
      if(!next||!byId.has(next)||!byId.has(edge.source)||!byId.has(edge.target))continue;
      if(!kept.has(edge.id))kept.set(edge.id,{...edge,depth:current.depth+1,path:[...current.path,next],path_edge_ids:[...current.path_edges,edge.id]});
      if(!seen.has(next)){seen.add(next);queue.push({id:next,path:[...current.path,next],path_edges:[...current.path_edges,edge.id],depth:current.depth+1});}
    }
  }
  const ids=new Set([...rootIds,...[...kept.values()].flatMap(edge=>[edge.source,edge.target])]);
  return {nodes:[...ids].map(id=>byId.get(id)),edges:[...kept.values()],seeds:rootIds};
}

/** Conservative shared envelope budget; no provider-specific token claim. */
function packGraph(graph,maxTokens=4000) {
  const limit=number(maxTokens,4000,256,8000),nodeMap=new Map(graph.nodes.map(node=>[node.id,node])),edgeMap=new Map(graph.edges.map(edge=>[edge.id,edge]));
  const proofMap=new Map(graph.evidence.map(hit=>[hit.citation.id,hit]));
  const state={nodes:new Set(),edges:new Set(),evidence:new Set(),paths:[]};
  const proofs=candidate=>[...candidate.evidence].map(id=>{
    const hit=proofMap.get(id),spans=[...candidate.edges].map(edgeId=>edgeMap.get(edgeId)).filter(edge=>edge.evidence_ids.includes(id)&&edge.witness_span).map(edge=>edge.witness_span);
    return spans.length?compactGraphEvidence(hit,spans):hit;
  });
  const draft=(candidate,final=false)=>{
    const result={...graph,seeds:graph.seeds.filter(id=>candidate.nodes.has(id)),nodes:[...candidate.nodes].map(id=>nodeMap.get(id)),edges:[...candidate.edges].map(id=>edgeMap.get(id)),evidence:proofs(candidate),
      ...(graph.paths?{paths:candidate.paths}:{}),limitations:{...graph.limitations},stats:{...graph.stats,node_count:candidate.nodes.size,edge_count:candidate.edges.size,evidence_count:candidate.evidence.size},
      budget:{max_tokens:limit,estimated_tokens:0,estimator:'utf8_bytes_upper_bound',truncated:!final,omitted:{nodes:graph.nodes.length-candidate.nodes.size,edges:graph.edges.length-candidate.edges.size,evidence:graph.evidence.length-candidate.evidence.size,paths:(graph.paths?.length||0)-candidate.paths.length}}};
    result.budget.truncated=Object.values(result.budget.omitted).some(value=>value>0);
    if(result.budget.truncated){result.limitations.partial=true;result.limitations.budget_reached=true;}
    // Include the estimator itself. Its decimal length stabilizes in two passes.
    for(let i=0;i<6;i++){const bytes=Buffer.byteLength(JSON.stringify(result),'utf8');if(bytes===result.budget.estimated_tokens)break;result.budget.estimated_tokens=bytes;}
    return result;
  };
  if(draft(state).budget.estimated_tokens>limit)throw fail('The graph token budget cannot hold its metadata. Increase token_budget.','KNOWLEDGE_GRAPH_BUDGET_TOO_SMALL');
  const consider=(edgeIds=[],path=null,nodeIds=[])=>{
    const candidate={nodes:new Set(state.nodes),edges:new Set(state.edges),evidence:new Set(state.evidence),paths:[...state.paths]};
    for(const id of edgeIds){const edge=edgeMap.get(id);if(!edge||!nodeMap.has(edge.source)||!nodeMap.has(edge.target))return false;
      for(const prior of edge.path_edge_ids||[])if(!edgeIds.includes(prior)&&!candidate.edges.has(prior))return false;
      candidate.edges.add(id);candidate.nodes.add(edge.source);candidate.nodes.add(edge.target);
      for(const proof of edge.evidence_ids){if(!proofMap.has(proof))return false;candidate.evidence.add(proof);}
    }
    for(const id of nodeIds){if(!nodeMap.has(id))return false;candidate.nodes.add(id);}
    if(path)candidate.paths.push(path);
    if(proofs(candidate).some(hit=>!hit))return false;
    if(draft(candidate).budget.estimated_tokens>limit)return false;
    Object.assign(state,candidate);return true;
  };
  // A trace's complete witnessed paths take priority over unrelated neighbours.
  for(const path of graph.paths||[])consider(path.edges,path,path.nodes);
  for(const id of graph.seeds)consider([],null,[id]);
  for(const edge of graph.edges)consider(edge.path_edge_ids||[edge.id]);
  return draft(state,true);
}
module.exports={reachableGraph,packGraph};
