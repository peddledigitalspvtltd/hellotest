import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { traceApi } from '../api.client';
import './LlmTraces.css';

const duration = (value: number | null | undefined) => value == null ? '—' : `${(value / 1000).toFixed(2)}s`;
const label = (value: string) => value.replace(/[._-]/g, ' ');

export function LlmTraces({ projectId }: { projectId: string }) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('');
  const [status, setStatus] = useState(''), [hours, setHours] = useState(24);
  const [cursors, setCursors] = useState<string[]>(['']);
  const [since, setSince] = useState(() => new Date(Date.now() - 86400000).toISOString());
  const selected = params.get('llm_trace') || '';
  const runId = params.get('run_id') || '', sessionId = params.get('session_id') || '';
  useEffect(() => { const timer = setTimeout(() => setFilter(search), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setCursors(['']); setSince(new Date(Date.now() - hours * 3600000).toISOString()); }, [projectId, filter, status, hours, runId, sessionId]);
  const query = useQuery({
    queryKey: ['llm-traces', projectId, filter, status, since, cursors.at(-1), runId, sessionId],
    queryFn: ({ signal }) => traceApi.llmTraces.list({ project_id: projectId, search: filter, status, since, cursor: cursors.at(-1), run_id: runId, session_id: sessionId }, signal),
    enabled: Boolean(projectId), retry: false, staleTime: 10000, refetchInterval: 15000, refetchIntervalInBackground: false
  });
  const detail = useQuery({ queryKey: ['llm-trace', projectId, selected], queryFn: ({ signal }) => traceApi.llmTraces.detail(projectId, selected, signal), enabled: Boolean(projectId && selected), retry: false,
    refetchInterval: query => query.state.data?.status === 'running' ? 5000 : false });
  const select = (id: string) => setParams(current => { const next = new URLSearchParams(current); if (id) next.set('llm_trace', id); else next.delete('llm_trace'); return next; }, { replace: true });
  const summary = query.data?.summary;
  const trace = detail.data;
  return <section className="llm-traces" aria-label="AI request traces">
    <div className="llm-traces-toolbar">
      <label>Search calls<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Feature, model, request or run ID" /></label>
      <label>Outcome<select value={status} onChange={event => setStatus(event.target.value)}><option value="">All outcomes</option><option value="succeeded">Response received</option><option value="failed">Failed</option><option value="invalid">Invalid response</option><option value="cancelled">Cancelled</option><option value="running">Running</option></select></label>
      <label>Period<select value={hours} onChange={event => setHours(Number(event.target.value))}><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option><option value={336}>Last 14 days</option></select></label>
      <button className="ghost-button" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? 'Refreshing…' : 'Refresh calls'}</button>
    </div>
    {(runId || sessionId) && <p>Filtered to {runId ? `workflow run ${runId}` : `agent session ${sessionId}`}. <button className="ghost-button compact" type="button" onClick={() => setParams(current => { const next = new URLSearchParams(current); next.delete('run_id'); next.delete('session_id'); return next; })}>Show all calls</button></p>}
    {summary && <div className="llm-traces-metrics" aria-label="AI performance for selected filters">
      <article><span>Model calls</span><strong>{summary.calls}</strong></article><article><span>Failed / invalid</span><strong>{summary.failures}</strong></article>
      <article><span>Average latency</span><strong>{duration(summary.average_ms)}</strong></article><article><span>p95 latency</span><strong>{duration(summary.p95_ms)}</strong></article>
      <article><span>Reported tokens</span><strong>{Number(summary.total_tokens).toLocaleString()}</strong><small>{summary.usage_unknown ? `${summary.usage_unknown} calls without usage` : 'Provider reported'}</small></article>
    </div>}
    <p className="llm-traces-note">Each row is a provider call. Receiving a response does not establish task correctness. Requests and responses are redacted, bounded, and retained for 14 days.</p>
    {query.isError && <p role="alert">Unable to load AI calls. Refresh to retry.</p>}
    {query.isLoading && <p role="status">Loading AI calls…</p>}
    {query.data && !query.data.items.length && <p role="status">No model calls match this scope. Run an AI feature, agent, or workflow to capture its requests here.</p>}
    {!!query.data?.items.length && <div className="llm-traces-table"><table className="data-table"><thead><tr><th>Feature / operation</th><th>Model</th><th>Outcome</th><th>Latency</th><th>Tokens</th><th>Started</th></tr></thead><tbody>{query.data.items.map(item => <tr key={item.id} className={selected === item.id ? 'is-selected' : ''}>
      <td><button className="llm-traces-open" type="button" onClick={() => select(item.id)}>{label(item.feature || item.operation)}</button><small>{item.node_id ? `Node ${item.node_id}` : item.run_id ? 'Workflow call' : item.session_id ? 'Agent call' : item.integration_name}</small></td>
      <td>{item.effective_model || item.requested_model || 'Not reported'}</td><td><span className={`status-badge ${item.status === 'succeeded' ? 'completed' : item.status === 'running' ? 'running' : 'failed'}`}>{item.status === 'succeeded' ? 'Response received' : label(item.status)}</span></td>
      <td>{duration(item.duration_ms)}</td><td>{item.usage?.total_tokens?.toLocaleString() ?? '—'}</td><td>{new Date(item.started_at).toLocaleString()}</td>
    </tr>)}</tbody></table></div>}
    <div className="llm-traces-pagination"><button className="ghost-button compact" type="button" disabled={cursors.length === 1 || query.isFetching} onClick={() => setCursors(previous => previous.slice(0, -1))}>Previous</button><span>Page {cursors.length}</span><button className="ghost-button compact" type="button" disabled={!query.data?.next_cursor || query.isFetching} onClick={() => setCursors(previous => [...previous, query.data!.next_cursor!])}>Next</button></div>
    {selected && <section className="llm-trace-detail" aria-label="Selected AI call">
      <header><h3>Request &amp; response</h3><button className="ghost-button compact" type="button" onClick={() => select('')}>Close details</button></header>
      {detail.isLoading && <p role="status">Loading call details…</p>}{detail.isError && <p role="alert">This trace is unavailable or has expired. <button className="ghost-button compact" type="button" onClick={() => void detail.refetch()}>Retry details</button></p>}
      {trace && <>
        <dl className="llm-trace-facts">{Object.entries({ 'Call ID': trace.id, 'Request ID': trace.request_id, 'Distributed trace': trace.trace_id, 'Workflow run': trace.run_id, 'Node': trace.node_id, 'Agent session': trace.session_id, 'Provider request': trace.provider_request_id, 'HTTP status': trace.http_status, 'Error': trace.error_code, 'Correction of': trace.correction_of }).filter(([, value]) => value != null).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
        {trace.capture?.redacted && <p className="llm-traces-note">Sensitive fields and hidden provider reasoning have been removed from this capture.</p>}
        {(trace.capture?.request_truncated || trace.capture?.response_truncated) && <p role="status">This capture reached the display storage limit. The provider call used the original payload.</p>}
        {trace.content_access ? <div className="llm-trace-payloads"><details open><summary>Request to model</summary><pre>{JSON.stringify(trace.request_payload, null, 2)}</pre></details><details open><summary>Response from model</summary><pre>{trace.response_payload == null ? 'No response body was received.' : JSON.stringify(trace.response_payload, null, 2)}</pre></details></div> : <p>Workspace administrator access is required to inspect prompt and response content.</p>}
      </>}
    </section>}
  </section>;
}
