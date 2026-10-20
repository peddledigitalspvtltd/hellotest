import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '@hellotest/platform/frontend/src/shared/hooks/useDialogFocus';
import { traceApi } from '../api.client';
import { useCapabilityAccess } from '@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess';
import { CopyIcon } from '@hellotest/platform/frontend/src/platform/components/AppIcons';
import { modelCallUsageFacts } from '../lib/modelCallUsage';
import type { LlmTrace } from '../llmTraceTypes';
import './LlmTraces.css';

function modelScopeLabel(scope: LlmTrace['capture']['generation_scope']) {
  if (scope === 'case_attempt') return 'Case generation';
  if (scope === 'section_attempt') return 'Section generation';
  if (scope === 'section_semantic_review') return 'Outcome review';
  if (scope === 'case_metadata') return 'Completion metadata';
  if (scope === 'flow_plan') return 'Flow planning';
  return 'Model call';
}

function modelScopeDescription(scope: LlmTrace['capture']['generation_scope']) {
  if (scope === 'section_attempt') return 'This request develops the selected section.';
  if (scope === 'section_semantic_review') return 'This request checks the selected section against its pinned manual requirements.';
  if (scope === 'case_metadata') return 'This request completes coverage or response metadata for retained instructions.';
  if (scope === 'flow_plan') return 'This request prepares the case flow before section development.';
  return 'A request may develop several sections.';
}

function ModelPayload({ kind, payload, collapsed }: { kind: 'Request' | 'Response'; payload: unknown; collapsed: boolean }) {
  const content = payload == null ? '' : JSON.stringify(payload, null, 2);
  const [notice, setNotice] = useState('');
  const [copying, setCopying] = useState(false);
  useEffect(() => { setNotice(''); }, [content]);
  async function copyPayload() {
    setCopying(true);
    setNotice('');
    try {
      await navigator.clipboard.writeText(content);
      setNotice(`${kind} copied`);
    } catch {
      setNotice('Copy unavailable. Select the text and copy it.');
    } finally {
      setCopying(false);
    }
  }
  return <details open={!collapsed}>
    <summary>{kind === 'Request' ? 'Request to model' : 'Response from model'}</summary>
    <div className="llm-trace-payload-toolbar">
      <span role="status" className="llm-trace-copy-notice">{notice}</span>
      <button className="ghost-button compact" type="button" disabled={!content || copying} onClick={() => void copyPayload()} aria-label={`Copy ${kind.toLowerCase()}`}>
        <CopyIcon size={15} />{copying ? 'Copying…' : `Copy ${kind.toLowerCase()}`}
      </button>
    </div>
    <pre>{content || (kind === 'Request' ? 'No request body was retained.' : 'No response body was received.')}</pre>
  </details>;
}

export function ModelCallDetails({ projectId, traceId, collapsedPayloads = false }: { projectId: string; traceId: string; collapsedPayloads?: boolean }) {
  const detail = useQuery({ queryKey: ['llm-trace', projectId, traceId], queryFn: ({ signal }) => traceApi.llmTraces.detail(projectId, traceId, signal), enabled: Boolean(projectId && traceId), retry: false,
    refetchInterval: query => query.state.data?.status === 'running' ? 5000 : false });
  const trace = detail.data;
  return <section className="llm-trace-detail" aria-label="Selected AI call">
      {detail.isLoading && <p role="status">Loading call details…</p>}{detail.isError && <p role="alert">This trace is unavailable or has expired. <button className="ghost-button compact" type="button" onClick={() => void detail.refetch()}>Retry details</button></p>}
      {trace && <>
        {trace.status !== 'running' && trace.capture?.request_stage?.endsWith('_preflight') && <p className="llm-traces-note">Request validation stopped before a request was sent to the model.</p>}
        <dl className="llm-trace-facts">{Object.entries({ 'Purpose': modelScopeLabel(trace.capture?.generation_scope), 'Call ID': trace.id, 'Request ID': trace.request_id, 'Distributed trace': trace.trace_id, 'Workflow run': trace.run_id, 'Node': trace.node_id, 'Agent session': trace.session_id, 'Provider request': trace.provider_request_id, 'HTTP status': trace.http_status, 'Error': trace.error_code, 'Correction of': trace.correction_of }).filter(([, value]) => value != null).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
        {trace.capture?.redacted && <p className="llm-traces-note">Sensitive fields and hidden provider reasoning have been removed from this capture.</p>}
        {(trace.capture?.request_truncated || trace.capture?.response_truncated) && <p role="status">This capture reached the display storage limit. The provider call used the original payload.</p>}
        {trace.content_access ? <div className="llm-trace-payloads"><ModelPayload key={`${traceId}:request`} kind="Request" payload={trace.request_payload} collapsed={collapsedPayloads} /><ModelPayload key={`${traceId}:response`} kind="Response" payload={trace.response_payload} collapsed={collapsedPayloads} /></div> : <p>Workspace administrator access is required to inspect prompt and response content.</p>}
      </>}

  </section>;
}

/** Payloads stay in the trace service; activity events contain references only. */
export function ActivityModelCalls({ projectId, sessionId, live = false }: { projectId: string; sessionId: string; live?: boolean }) {
  const { can } = useCapabilityAccess(projectId);
  const [cursor, setCursor] = useState<string[]>(['']);
  const allowed = can('ops.view');
  const query = useQuery({ queryKey: ['activity-model-call-list', projectId, sessionId, cursor.at(-1)],
    queryFn: ({ signal }) => traceApi.llmTraces.list({ project_id: projectId, session_id: sessionId, cursor: cursor.at(-1), since: new Date(Date.now() - 14 * 86400000).toISOString() }, signal),
    enabled: Boolean(allowed && projectId && sessionId), retry: false, refetchInterval: live ? 3000 : false });
  if (!allowed) return <p>Model call viewing permission is required to inspect requests and responses.</p>;
  return <section className="activity-model-calls" aria-label="Activity model calls">
    {query.isLoading && <p role="status">Loading model calls…</p>}
    {query.isError && <p role="alert">Model calls could not be loaded. <button className="ghost-button compact" type="button" onClick={() => void query.refetch()}>Retry model calls</button></p>}
    {query.data && !query.data.items.length && <p>No retained model calls are available for this activity.</p>}
    {query.data?.items.map(call => <ActivityModelCall key={call.id} projectId={projectId} call={call} />)}
    {(cursor.length > 1 || query.data?.next_cursor) && <div className="llm-traces-pagination"><button className="ghost-button compact" type="button" disabled={cursor.length === 1 || query.isFetching} onClick={() => setCursor(current => current.slice(0, -1))}>Newer calls</button><button className="ghost-button compact" type="button" disabled={!query.data?.next_cursor || query.isFetching} onClick={() => setCursor(current => [...current, query.data!.next_cursor!])}>Older calls</button></div>}
  </section>;
}

export type EngineerModelPayloadProps = {
  projectId: string; sessionId: string; caseId: string; stepId?: string; attempt?: number;
  modelCallIds?: string[]; kind: 'request' | 'response'; live?: boolean;
};

/** Exact originating calls are supplied by protected previews. Older activities
 * fall back to server-correlated case/attempt calls, never invented step calls. */
export function EngineerModelPayload({ projectId, sessionId, caseId, stepId, attempt, modelCallIds = [], kind, live = false }: EngineerModelPayloadProps) {
  const { can } = useCapabilityAccess(projectId);
  const allowed = can('ops.view');
  const ids = [...new Set(modelCallIds.filter(id => /^[A-Za-z0-9_-]{1,200}$/.test(id)))].slice(0,20);
  const idsKey = JSON.stringify(ids);
  const generationAttempt = Number.isSafeInteger(attempt) && attempt! > 0 && attempt! <= 100 ? attempt : undefined;
  const scope = JSON.stringify([projectId,sessionId,caseId,stepId,generationAttempt,idsKey]);
  const [navigation,setNavigation] = useState<{scope:string;cursors:string[];selected:string}>({scope,cursors:[''],selected:''});
  const current = navigation.scope === scope ? navigation : {scope,cursors:[''],selected:''};
  const [since] = useState(() => new Date(Date.now()-14*86400000).toISOString());
  const query = useQuery({queryKey:['engineer-model-calls',projectId,sessionId,caseId,generationAttempt,idsKey,current.cursors.at(-1),since],
    queryFn:({signal})=>traceApi.llmTraces.list({project_id:projectId,session_id:sessionId,test_case_id:caseId,completion_attempt:generationAttempt,trace_ids:ids.length?idsKey:undefined,since,cursor:current.cursors.at(-1)},signal),
    enabled:Boolean(allowed&&projectId&&sessionId&&caseId),retry:false,refetchInterval:live?3000:false});
  const calls = query.isError ? [] : query.data?.items || [];
  const selected = calls.find(call=>call.id===current.selected) || calls[0];
  if(!allowed)return <p>Model call viewing permission is required to inspect requests and responses.</p>;
  if(!projectId||!sessionId||!caseId)return <p>Select a generation activity and case to inspect its retained model calls.</p>;
  return <section className="engineer-model-payload" aria-label={`Section model ${kind}`}>
    <p className="llm-traces-note">{ids.length?'Recorded model calls associated with this validated section.':`Case-level model calls for this ${generationAttempt?'generation attempt':'activity'}; an exact section-to-call reference was not retained.`} {modelScopeDescription(selected?.capture?.generation_scope)} These calls do not verify test execution.</p>
    {query.isPending&&<p role="status">Loading model {kind}…</p>}
    {query.isError&&<p role="alert">Model calls are unavailable within your access or retention period. <button className="ghost-button compact" type="button" onClick={()=>void query.refetch()}>Retry model calls</button></p>}
    {query.data&&!query.isError&&!calls.length&&<p>No retained model call matches this case{generationAttempt?` and generation attempt ${generationAttempt}`:''}{ids.length?' and its recorded source references':''}.</p>}
    {!!calls.length&&<label className="engineer-model-call-select">Model call<select aria-label="Selected section model call" value={selected?.id||''} onChange={event=>setNavigation({...current,selected:event.target.value})}>{calls.map(call=><option key={call.id} value={call.id}>{modelScopeLabel(call.capture?.generation_scope)} · {call.effective_model||call.requested_model||'Configured model'} · {call.status} · {call.started_at?new Date(call.started_at).toLocaleTimeString():call.id.slice(0,8)}</option>)}</select></label>}
    {selected&&<EngineerCallPayload key={`${scope}:${selected.id}`} projectId={projectId} sessionId={sessionId} caseId={caseId} attempt={generationAttempt} callId={selected.id} kind={kind} live={live}/>}
    {(current.cursors.length>1||query.data?.next_cursor)&&<div className="llm-traces-pagination"><button className="ghost-button compact" type="button" disabled={current.cursors.length===1||query.isFetching} onClick={()=>setNavigation({scope,cursors:current.cursors.slice(0,-1),selected:''})}>Newer calls</button><button className="ghost-button compact" type="button" disabled={!query.data?.next_cursor||query.isFetching} onClick={()=>setNavigation({scope,cursors:[...current.cursors,query.data!.next_cursor!],selected:''})}>Older calls</button></div>}
  </section>;
}

function EngineerCallPayload({projectId,sessionId,caseId,attempt,callId,kind,live}: Omit<EngineerModelPayloadProps,'stepId'|'modelCallIds'> & {callId:string}) {
  const detail=useQuery({queryKey:['engineer-model-call',projectId,sessionId,caseId,attempt,callId],queryFn:async({signal})=>{
    const trace=await traceApi.llmTraces.detail(projectId,callId,signal);
    if(trace.project_id!==projectId||trace.session_id!==sessionId||trace.capture?.test_case_id&&trace.capture.test_case_id!==caseId||attempt&&trace.capture?.completion_attempt&&trace.capture.completion_attempt!==attempt)throw new Error('This model call does not belong to the selected generation context.');
    return trace;
  },retry:false,refetchInterval:query=>live&&query.state.data?.status==='running'?3000:false});
  const trace=detail.isError?undefined:detail.data;
  return <div className="engineer-model-call-body">
    {detail.isPending&&<p role="status">Loading retained model {kind}…</p>}
    {detail.isError&&<p role="alert">This model call is unavailable or no longer matches the selected case. <button className="ghost-button compact" type="button" onClick={()=>void detail.refetch()}>Retry details</button></p>}
    {trace&&<>
      <p className="llm-traces-note">{modelScopeLabel(trace.capture?.generation_scope)}{trace.capture?.section_attempt||trace.capture?.completion_attempt||attempt?` · Attempt ${trace.capture?.section_attempt||trace.capture?.completion_attempt||attempt}`:''}{trace.capture?.generation_scope==='case_attempt'&&trace.capture?.generation_section_count?` · Shared context for ${trace.capture.generation_section_count} sections`:''} · {trace.status}{trace.http_status?` · HTTP ${trace.http_status}`:''}</p>
      <dl className="llm-trace-facts" aria-label="Reported usage for this model call">{modelCallUsageFacts(trace).map(fact=><div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
      {trace.capture?.request_stage?.endsWith('_preflight')&&trace.status!=='running'&&<p role="status">Validation stopped before this request was sent to the model.</p>}
      {trace.capture?.redacted&&<p className="llm-traces-note">Sensitive fields and hidden provider reasoning were removed.</p>}
      {(kind==='request'?trace.capture?.request_truncated:trace.capture?.response_truncated)&&<p role="status">The retained {kind} reached the capture limit. The original provider payload was not changed.</p>}
      {trace.content_access?<div className="llm-trace-payloads engineer-model-payloads"><ModelPayload key={`${callId}:${kind}`} kind={kind==='request'?'Request':'Response'} payload={kind==='request'?trace.request_payload:trace.response_payload} collapsed={false}/></div>:<p>Workspace administrator access is required to inspect prompt and response content.</p>}
    </>}
  </div>;
}

function ActivityModelCall({ projectId, call }: { projectId: string; call: import('../llmTraceTypes').LlmTrace }) {
  const [open, setOpen] = useState(false);
  return <details className="activity-model-call" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span><strong>{call.effective_model || call.requested_model || 'Configured model'}</strong><small>{modelScopeLabel(call.capture?.generation_scope)} · {call.feature || call.operation} · Attempt {call.capture?.section_attempt || call.capture?.completion_attempt || call.attempt || 1}{call.started_at ? ` · ${new Date(call.started_at).toLocaleTimeString()}` : ''}</small></span><span className="activity-model-call-status" data-status={call.status}>{call.status}{call.http_status ? ` · ${call.http_status}` : ''}</span></summary>
    {open && <ModelCallDetails projectId={projectId} traceId={call.id} collapsedPayloads />}
  </details>;
}

export function ModelCallDrawer({ projectId, traceId, onClose }: { projectId: string; traceId: string; onClose: () => void }) {
  const titleId = useId();
  const ref = useDialogFocus<HTMLDivElement>({ onClose });
  return createPortal(<div className="llm-call-drawer-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={ref} className="llm-call-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
    <header><h2 id={titleId}>Model call</h2><button className="ghost-button compact" type="button" onClick={onClose}>Close details</button></header>
    <ModelCallDetails projectId={projectId} traceId={traceId} />
  </div></div>, document.body);
}

export function SessionModelCalls({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const [selected, setSelected] = useState('');
  const [cursors, setCursors] = useState<string[]>(['']);
  const [since] = useState(() => new Date(Date.now() - 14 * 86400000).toISOString());
  const query = useQuery({ queryKey: ['activity-model-calls', projectId, sessionId, since, cursors.at(-1)], queryFn: ({ signal }) => traceApi.llmTraces.list({ project_id: projectId, session_id: sessionId, since, cursor: cursors.at(-1) }, signal), enabled: Boolean(projectId && sessionId), retry: false, refetchInterval: 15000 });
  const calls = query.data?.items || [];
  const active = calls.find(call => call.id === selected) || calls[0];
  return <section className="agent-model-calls" aria-label="Activity model calls">
    {query.isLoading && <p role="status">Loading this activity's model calls…</p>}
    {query.isError && <p role="alert">Model calls are unavailable within your access. <button type="button" onClick={() => void query.refetch()}>Retry calls</button></p>}
    {query.data && !calls.length && <p>No retained model calls were recorded for this activity.</p>}
    {!!calls.length && <><nav aria-label="Choose activity model call">{calls.map(call => <button className="ghost-button compact" type="button" key={call.id} aria-pressed={active?.id === call.id} onClick={() => setSelected(call.id)}>{call.feature || call.operation} · {call.effective_model || call.requested_model || 'Model'}</button>)}</nav>{active && <ModelCallDetails projectId={projectId} traceId={active.id} />}</>}
    {(cursors.length > 1 || query.data?.next_cursor) && <div className="llm-traces-pagination"><button type="button" disabled={cursors.length === 1 || query.isFetching} onClick={() => { setSelected(''); setCursors(current => current.slice(0,-1)); }}>Previous calls</button><button type="button" disabled={!query.data?.next_cursor || query.isFetching} onClick={() => { setSelected(''); setCursors(current => [...current, query.data!.next_cursor!]); }}>More calls</button></div>}
  </section>;
}
