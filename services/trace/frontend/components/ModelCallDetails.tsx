import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '@hellotest/platform/frontend/src/shared/hooks/useDialogFocus';
import { traceApi } from '../api.client';
import './LlmTraces.css';

export function ModelCallDetails({ projectId, traceId }: { projectId: string; traceId: string }) {
  const detail = useQuery({ queryKey: ['llm-trace', projectId, traceId], queryFn: ({ signal }) => traceApi.llmTraces.detail(projectId, traceId, signal), enabled: Boolean(projectId && traceId), retry: false,
    refetchInterval: query => query.state.data?.status === 'running' ? 5000 : false });
  const trace = detail.data;
  return <section className="llm-trace-detail" aria-label="Selected AI call">
      {detail.isLoading && <p role="status">Loading call details…</p>}{detail.isError && <p role="alert">This trace is unavailable or has expired. <button className="ghost-button compact" type="button" onClick={() => void detail.refetch()}>Retry details</button></p>}
      {trace && <>
        <dl className="llm-trace-facts">{Object.entries({ 'Call ID': trace.id, 'Request ID': trace.request_id, 'Distributed trace': trace.trace_id, 'Workflow run': trace.run_id, 'Node': trace.node_id, 'Agent session': trace.session_id, 'Provider request': trace.provider_request_id, 'HTTP status': trace.http_status, 'Error': trace.error_code, 'Correction of': trace.correction_of }).filter(([, value]) => value != null).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
        {trace.capture?.redacted && <p className="llm-traces-note">Sensitive fields and hidden provider reasoning have been removed from this capture.</p>}
        {(trace.capture?.request_truncated || trace.capture?.response_truncated) && <p role="status">This capture reached the display storage limit. The provider call used the original payload.</p>}
        {trace.content_access ? <div className="llm-trace-payloads"><details open><summary>Request to model</summary><pre>{JSON.stringify(trace.request_payload, null, 2)}</pre></details><details open><summary>Response from model</summary><pre>{trace.response_payload == null ? 'No response body was received.' : JSON.stringify(trace.response_payload, null, 2)}</pre></details></div> : <p>Workspace administrator access is required to inspect prompt and response content.</p>}
      </>}

  </section>;
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
