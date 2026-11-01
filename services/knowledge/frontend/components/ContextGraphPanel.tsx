import { useEffect, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { IconClock, IconHistory, IconInfoCircle, IconRefresh, IconRoute } from '@tabler/icons-react';
import { knowledgeApi } from '../api.client';
import { graphDate, graphLabel } from '../lib/knowledgeGraphView';
import { KnowledgeGraphExplorer } from './KnowledgeGraphExplorer';
const message=(error:unknown)=>error instanceof Error?error.message:'Recorded context could not be loaded.';
type Props={projectId:string;appTypeId?:string;onOpenSource:(id:string,revisionId?:string)=>void};
export function ContextGraphPanel({projectId,appTypeId,onOpenSource}:Props) {
  const [traceId,setTraceId]=useState(''),[featureId,setFeatureId]=useState(''),[knownFeatures,setKnownFeatures]=useState<string[]>([]),[from,setFrom]=useState(''),[to,setTo]=useState(''),[dateError,setDateError]=useState(''),[range,setRange]=useState<{from?:string;to?:string}>({});
  useEffect(()=>{setTraceId('');setFeatureId('');setKnownFeatures([]);},[projectId,appTypeId]);
  const traces=useInfiniteQuery({queryKey:['knowledge-context-graph-traces',projectId,appTypeId,featureId,range],initialPageParam:'',queryFn:({pageParam,signal})=>knowledgeApi.knowledgeRepo.contextGraph.list(projectId,{...range,...(appTypeId?{app_type_id:appTypeId}:{}),...(featureId?{feature_id:featureId}:{}),limit:20,...(pageParam?{cursor:pageParam}:{})},{signal}),getNextPageParam:last=>last.next_cursor||undefined});
  const items=[...new Map((traces.data?.pages.flatMap(page=>page.items)||[]).map(item=>[item.trace_id||item.id,item])).values()];
  const selectedTrace=items.find(item=>(item.trace_id||item.id)===traceId);
  useEffect(()=>{const features=traces.data?.pages.flatMap(page=>page.items.map(item=>item.feature_id))||[];setKnownFeatures(previous=>features.some(id=>!previous.includes(id))?[...new Set([...previous,...features])].sort():previous);},[traces.data]);
  useEffect(()=>{if(!traceId&&items.length)setTraceId(items[0].trace_id||items[0].id);},[items,traceId]);
  const graph=useQuery({queryKey:['knowledge-context-graph',projectId,appTypeId,traceId],queryFn:({signal})=>knowledgeApi.knowledgeRepo.contextGraph.explore(projectId,traceId,appTypeId,{signal}),enabled:Boolean(selectedTrace),retry:false});
  const applyRange=(event:FormEvent)=>{
    event.preventDefault();const fromDate=from?new Date(from):null,toDate=to?new Date(to):null;
    if(fromDate&&Number.isNaN(fromDate.valueOf())||toDate&&Number.isNaN(toDate.valueOf())||fromDate&&toDate&&fromDate>toDate){setDateError('Choose a valid recorded-time range with the end after the start.');return;}
    setDateError('');setTraceId('');setRange({...fromDate?{from:fromDate.toISOString()}:{},...toDate?{to:toDate.toISOString()}:{}});
  };
  return <div className="knowledge-context-graph">
    <div className="knowledge-context-intro"><span className="knowledge-context-intro-icon"><IconHistory size={22}/></span><div><strong>The evidence behind an AI task</strong><p>Explore the task, retrieved context, permitted source versions and recorded events. A trace is a record of what the application observed.</p></div></div>
    <form className="knowledge-context-controls" onSubmit={applyRange}>
      <label className="knowledge-context-trace-choice">Recorded AI context<select aria-label="Recorded AI context" value={traceId} onChange={event=>setTraceId(event.target.value)} disabled={traces.isPending||!items.length}><option value="">{traces.isPending?'Loading recorded context…':'Choose a recorded task'}</option>{items.map(item=><option key={item.trace_id||item.id} value={item.trace_id||item.id}>{graphLabel(item.feature_id.replace(/^ai\./,''))} · {graphDate(item.recorded_at)}</option>)}</select></label>
      <label>AI feature<select aria-label="Filter recorded AI feature" value={featureId} onChange={event=>{setTraceId('');setFeatureId(event.target.value);}}><option value="">All recorded features</option>{knownFeatures.map(id=><option key={id} value={id}>{graphLabel(id.replace(/^ai\./,''))}</option>)}</select></label>
      <label>Recorded from<input aria-label="Context recorded from" type="datetime-local" value={from} onChange={event=>setFrom(event.target.value)}/></label>
      <label>Recorded until<input aria-label="Context recorded until" type="datetime-local" value={to} onChange={event=>setTo(event.target.value)}/></label>
      <button type="submit" className="ghost-button">Apply dates</button>
      <button type="button" className="ghost-button knowledge-context-refresh" aria-label="Refresh recorded context" title="Refresh recorded context" onClick={()=>{void traces.refetch();if(traceId)void graph.refetch();}}><IconRefresh size={17}/></button>
    </form>
    {dateError?<p role="alert" className="knowledge-graph-notice">{dateError}</p>:null}
    {traces.error?<div className="knowledge-graph-notice is-error" role="alert"><p>{message(traces.error)}</p><button type="button" className="ghost-button compact" onClick={()=>void traces.refetch()}>Retry recorded context</button></div>:null}
    {traces.hasNextPage?<button type="button" className="ghost-button compact knowledge-context-load-more" disabled={traces.isFetchingNextPage} onClick={()=>void traces.fetchNextPage()}>{traces.isFetchingNextPage?'Loading more…':'Load more recorded tasks'}</button>:null}
    {!traces.isPending&&!traces.error&&!items.length?<div className="knowledge-map-start-state"><span><IconRoute size={32} stroke={1.3}/></span><h4>No recorded context in this view</h4><p>{range.from||range.to?'Widen the date range to find another recorded task.':'Context appears after an authorized AI task retrieves project evidence. Knowledge graph connections remain available in the other view.'}</p><small>Only your permitted, retained traces are shown. Missing decisions or approvals are never inferred.</small></div>:null}
    {graph.isFetching&&traceId?<div className="knowledge-map-loading" role="status"><IconRefresh size={18}/>Loading the recorded task and its source evidence…</div>:null}
    {graph.error?<div className="knowledge-graph-notice is-error" role="alert"><p>{message(graph.error)}</p><button type="button" className="ghost-button compact" onClick={()=>void graph.refetch()}>Retry context graph</button></div>:null}
    {graph.data&&selectedTrace&&!graph.error&&!traces.error?<>
      <div className="knowledge-map-stats"><div><span>Recorded task</span><strong>{graphLabel(graph.data.trace.feature_id.replace(/^ai\./,''))}</strong><small><IconClock size={12}/>{graphDate(graph.data.trace.recorded_at)}</small></div><div><span>Connected records</span><strong>{graph.data.nodes.length}</strong><small>Permitted nodes in this trace</small></div><div><span>Recorded relationships</span><strong>{graph.data.edges.length}</strong><small>Observed lineage, not inferred causality</small></div></div>
      {graph.data.limitations.partial?<div className="knowledge-graph-notice" role="status"><IconInfoCircle size={17}/><span>This trace is a partial view. Some evidence is inaccessible, no longer current, or outside the returned bounds.</span></div>:null}
      {(graph.data.limitations.gaps||[]).map((gap,index)=><p className="knowledge-graph-gap" key={index}>{gap}</p>)}
      {typeof graph.data.limitations.model_input_limitation==='string'?<p className="knowledge-graph-gap">{graph.data.limitations.model_input_limitation}</p>:null}
      <KnowledgeGraphExplorer nodes={graph.data.nodes} edges={graph.data.edges} evidence={graph.data.evidence} mode="context" graphKey={traceId} onOpenSource={onOpenSource} timeline={graph.data.timeline}/>
    </>:null}
  </div>;
}
