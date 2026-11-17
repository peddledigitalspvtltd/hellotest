import {memo,useState,type ReactNode} from 'react';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import {request,toQueryString,readRequestSession} from '@hellotest/platform/frontend/src/lib/httpClient';
import {useAuth} from '@hellotest/platform/frontend/src/auth/AuthContext';
import type {AgentDescriptor,AgentStatus,AgentSystem} from '@hellotest/contracts/agents';
import './AgentActivity.css';
export type AgentRun={id:string;system:AgentSystem;source_run_id:string;agent_id:string;descriptor:AgentDescriptor;descriptor_hash:string;status:AgentStatus;native_status:string;progress:number;title:string;updated_at:string;started_at?:string;completed_at?:string;payload:{source_kind?:string;native_run_id?:string;transaction_id?:string;requires_human_review:boolean;prompt_hash?:string;prompt_template_version?:string}};
type Event={id:string;phase:string;level:string;message:string;occurred_at:string;payload:{status?:AgentStatus;duration_ms?:number}};
const labels:Record<AgentStatus,string>={queued:'Queued',running:'Running',waiting:'Needs input',succeeded:'Completed',partial:'Partial',failed:'Failed',cancelled:'Cancelled',unknown:'Outcome unknown'};
const systemNames:Record<AgentSystem,string>={workflow:'Workflow',repository:'Repository',quality:'Quality',automation:'Automation'};
export const agentActivityKeys={all:['agent-activity'] as const,list:(projectId:string,appTypeId?:string,system?:AgentSystem,actorScope='anonymous')=>['agent-activity',actorScope,projectId,appTypeId||'',system||'all'] as const,detail:(id:string,actorScope='anonymous')=>['agent-activity',actorScope,'run',id] as const};
const ActivityRow=memo(function ActivityRow({run,selected,onSelect}:{run:AgentRun;selected:boolean;onSelect:(run:AgentRun)=>void}){
  return <li><button type="button" aria-pressed={selected} className={`agent-activity-row is-${run.status}`} onClick={()=>onSelect(run)}>
    <span><strong>{run.title}</strong><small>{systemNames[run.system]} · {run.descriptor.name}</small></span>
    <span className="agent-activity-status">{labels[run.status]}{['queued','running'].includes(run.status)?` · ${run.progress}%`:''}</span>
    <time dateTime={run.updated_at}>{new Date(run.updated_at).toLocaleString()}</time>
  </button></li>;
});
export type AgentActivityProps={projectId:string;appTypeId?:string;system?:AgentSystem;initialSourceRunId?:string;onSelect?:(run:AgentRun)=>void;renderDetail?:(run:AgentRun)=>ReactNode;compact?:boolean};
export function AgentActivity({projectId,appTypeId,system,initialSourceRunId,onSelect,renderDetail,compact=false}:AgentActivityProps){
  const {session,isLoading}=useAuth();
  const requestSession=readRequestSession(),signedIn=Boolean(session?.user.id&&requestSession.token&&!isLoading),actorScope=`${session?.user.id||'anonymous'}:${requestSession.revision}`;
  const scopedRequest=async<T,>(path:string,signal:AbortSignal)=>{if(!signedIn)throw new DOMException('Agent activity requires a current session.','AbortError');const value=await request<T>(path,{signal,cache:'no-store'});if(signal.aborted||readRequestSession().revision!==requestSession.revision)throw new DOMException('Agent activity session changed.','AbortError');return value;};
  const [selectedId,setSelectedId]=useState<string|undefined>();
  const runs=useInfiniteQuery({initialPageParam:'',getNextPageParam:(page:{next_cursor?:string|null})=>page.next_cursor||undefined,queryKey:agentActivityKeys.list(projectId,appTypeId,system,actorScope),queryFn:({signal,pageParam})=>scopedRequest<{items:AgentRun[];has_more:boolean;next_cursor?:string|null;coverage:Array<{system:AgentSystem;more_available:boolean}>;pending?:{more_available:boolean}}>(`/agent-runs${toQueryString({project_id:projectId,app_type_id:appTypeId,system,limit:compact?10:30,cursor:pageParam||undefined})}`,signal),enabled:Boolean(projectId)&&signedIn,refetchInterval:query=>query.state.data?.pages.some(page=>page.items.some(run=>['queued','running'].includes(run.status)))?2000:10000,retry:1});
  const items=Array.from(new Map((runs.data?.pages.flatMap(page=>page.items)||[]).map(run=>[run.id,run])).values()),selected=!signedIn||runs.isError?null:items.find(run=>run.id===selectedId)||(selectedId===undefined?items.find(run=>run.source_run_id===initialSourceRunId):null)||null;
  const detail=useQuery({queryKey:agentActivityKeys.detail(selected?.id||'',actorScope),queryFn:({signal})=>scopedRequest<{run:AgentRun;events:Event[];events_limited:boolean}>(`/agent-runs/${encodeURIComponent(selected!.id)}`,signal),enabled:Boolean(selected)&&signedIn,refetchInterval:selected&&['queued','running'].includes(selected.status)?2000:false,retry:1});
  const choose=(run:AgentRun)=>{setSelectedId(run.id);onSelect?.(run);};
  return <section className={`agent-activity${compact?' is-compact':''}`} aria-label="Agent activity across runtimes">
    <header><div><h3>Agent activity</h3><p>{system?`${systemNames[system]} activity`:'Workflow, repository, quality and automation activity'} · Completed means the agent finished; proposed changes still require review.</p></div><button type="button" onClick={()=>void runs.refetch()} disabled={!signedIn||runs.isFetching}>Refresh</button></header>
    {!signedIn?<p role="status">{isLoading?'Checking agent activity access…':'Sign in to view agent activity.'}</p>:runs.isPending?<p role="status">Loading agent activity…</p>:runs.isError?<p role="alert">{runs.error instanceof Error?runs.error.message:'Agent activity is unavailable.'}</p>:!items.length?<p>No agent runs in this scope yet.</p>:<ul className="agent-activity-list">{items.map(run=><ActivityRow key={run.id} run={run} selected={selected?.id===run.id} onSelect={choose}/>)}</ul>}
    {signedIn&&!runs.isError&&runs.data?.pages[0]?.pending?.more_available?<p role="status">Retained native history is being synchronized. Refresh to see newly projected runs.</p>:null}
    {signedIn&&!runs.isError&&runs.hasNextPage?<button type="button" disabled={runs.isFetchingNextPage} onClick={()=>void runs.fetchNextPage()}>{runs.isFetchingNextPage?'Loading history…':'Load older activity'}</button>:null}
    {selected?<section className="agent-activity-detail" aria-label="Selected agent run"><header><h4>{selected.title}</h4><button type="button" onClick={()=>setSelectedId('')}>Close details</button></header>
      {detail.isError?<p role="alert">This run is unavailable under current access. Refresh activity.</p>:<><p><strong>{labels[detail.data?.run.status||selected.status]}</strong> · {selected.descriptor.objective}</p><dl><dt>Output</dt><dd>{selected.descriptor.output.contract} · Review required</dd><dt>Instruction version</dt><dd>{selected.descriptor.instructions.version}</dd>{selected.payload.prompt_template_version?<><dt>Prompt version</dt><dd>{selected.payload.prompt_template_version}</dd></>:null}</dl>
        <ol className="agent-activity-events">{detail.data?.events.map(event=><li key={event.id}><strong>{event.message}</strong><time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleTimeString()}</time>{typeof event.payload.duration_ms==='number'?<span>{event.payload.duration_ms} ms</span>:null}</li>)}</ol>
        {detail.data?.events_limited?<p>Showing the first retained event batch.</p>:null}{renderDetail?.(detail.data?.run||selected)}</>}
    </section>:null}
  </section>;
}
export default AgentActivity;

/** Native workspaces load cross-runtime history on demand, preserving the
 * current run's controls and avoiding background history requests when closed. */
export function AgentActivityDisclosure(props: AgentActivityProps) {
  const [open, setOpen] = useState(false);
  return <details className="agent-activity-disclosure" onToggle={event => setOpen(event.currentTarget.open)}><summary>Agent activity history</summary>{open ? <AgentActivity {...props} compact /> : null}</details>;
}
