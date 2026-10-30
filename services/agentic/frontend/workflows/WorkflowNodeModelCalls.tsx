import { useState } from 'react';
import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import type { LlmTrace, LlmTracePage } from '@hellotest/trace/client';
import { useCapabilityAccess } from '@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess';
import { agenticApi } from '../api.client';
import { WorkflowDataView } from './WorkflowDataView';
import './WorkflowNodeModelCalls.css';

const displayNumber = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : 'Not reported';
const label = (call: LlmTrace) => [call.feature || call.operation, call.capture?.generation_scope?.replace(/_/g, ' ')].filter(Boolean).join(' · ');

export function WorkflowNodeModelCalls({ projectId, runId, nodeId, live = false }: { projectId: string; runId?: string; nodeId: string; live?: boolean }) {
  const { can, isLoading } = useCapabilityAccess(projectId);
  const allowed = can('ops.view');
  const query = useInfiniteQuery<LlmTracePage, Error, InfiniteData<LlmTracePage>, readonly unknown[], string>({ queryKey: ['workflow-node-model-calls', projectId, runId, nodeId],
    initialPageParam: '', getNextPageParam: page => page.next_cursor || undefined,
    queryFn: ({ signal, pageParam }) => agenticApi.agenticWorkflows.nodeModelCalls(runId!, nodeId, pageParam || undefined, signal),
    enabled: Boolean(allowed && projectId && runId && nodeId), retry: false, refetchInterval: live ? 3000 : false });
  if (!runId) return <p className="studio-empty">Execute this node to inspect its model calls.</p>;
  if (isLoading) return <p role="status">Checking model call access…</p>;
  if (!allowed) return <p className="studio-empty">Model call viewing permission is required to inspect this node's calls.</p>;
  const calls = query.isError ? [] : [...new Map((query.data?.pages.flatMap(page => page.items) || []).map(call => [call.id, call])).values()];
  const total = query.data?.pages[0]?.summary.calls;
  return <section className="studio-model-calls" aria-label="Node model calls">
    <header><h3>Model calls</h3>{typeof total === 'number' && <span>{total} {total === 1 ? 'call' : 'calls'}</span>}</header>
    <p className="studio-caption">Requests in execution order, including planning, repairs and successor agents. Captures are retained for 14 days.</p>
    {query.isPending && <p role="status">Loading this node's model calls…</p>}
    {query.isError && <p role="alert">Model calls could not be loaded. <button type="button" className="ghost-button compact" onClick={() => void query.refetch()}>Retry model calls</button></p>}
    {query.data && !query.isError && !calls.length && <p className="studio-empty">{live ? 'No retained model calls yet. Calls appear here as this node runs.' : 'No retained model calls were recorded for this node. The node may not use a model, or its captures may have expired.'}</p>}
    {calls.map((call, index) => <NodeModelCall key={call.id} projectId={projectId} runId={runId} nodeId={nodeId} call={call} number={index + 1} live={live} />)}
    {query.hasNextPage && <button type="button" className="ghost-button" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading more calls…' : `Show more calls${typeof total === 'number' ? ` (${calls.length} of ${total})` : ''}`}</button>}
  </section>;
}

function NodeModelCall({ projectId, runId, nodeId, call, number, live }: { projectId: string; runId: string; nodeId: string; call: LlmTrace; number: number; live: boolean }) {
  const [open, setOpen] = useState(false);
  return <details className="studio-model-call" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span><strong>Model call {number}</strong><small>{call.effective_model || call.requested_model || 'Configured model'}{call.started_at ? ` · ${new Date(call.started_at).toLocaleTimeString()}` : ''}</small><small>{label(call)}</small></span><span className="studio-model-call-status" data-status={call.status}>{call.status}</span></summary>
    {open && <NodeModelCallDetails projectId={projectId} runId={runId} nodeId={nodeId} callId={call.id} live={live} number={number} />}
  </details>;
}

function NodeModelCallDetails({ projectId, runId, nodeId, callId, live, number }: { projectId: string; runId: string; nodeId: string; callId: string; live: boolean; number: number }) {
  const detail = useQuery({ queryKey: ['workflow-node-model-call', projectId, runId, nodeId, callId],
    queryFn: async ({ signal }) => {
      const call = await agenticApi.agenticWorkflows.nodeModelCall(runId, nodeId, callId, signal);
      if (call.project_id !== projectId || call.run_id !== runId || call.node_id !== nodeId || call.id !== callId) throw new Error('This call does not belong to the selected workflow node.');
      return call;
    }, retry: false, refetchInterval: query => live && query.state.data?.status === 'running' ? 3000 : false });
  const call = detail.isError ? undefined : detail.data;
  return <div className="studio-model-call-body">
    {detail.isPending && <p role="status">Loading request and response…</p>}
    {detail.isError && <p role="alert">This call is unavailable within your access or retention period. <button type="button" className="ghost-button compact" onClick={() => void detail.refetch()}>Retry call details</button></p>}
    {call && <>
      <dl className="studio-model-call-facts">{Object.entries({ 'Input tokens': displayNumber(call.usage?.prompt_tokens ?? call.usage?.input_tokens), 'Output tokens': displayNumber(call.usage?.completion_tokens ?? call.usage?.output_tokens), 'Total tokens': displayNumber(call.usage?.total_tokens), 'Duration': call.duration_ms == null ? 'Not recorded' : `${call.duration_ms.toLocaleString()} ms`, 'HTTP status': call.http_status, 'Attempts': call.attempt, 'Error': call.error_code }).filter(([, value]) => value != null).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
      {call.capture?.request_stage?.endsWith('_preflight') && call.status !== 'running' && <p className="studio-caption">Validation stopped before this request was sent to the model.</p>}
      {call.capture?.redacted && <p className="studio-caption">Sensitive fields and hidden provider reasoning have been removed.</p>}
      {(call.capture?.request_truncated || call.capture?.response_truncated) && <p className="studio-notice">This retained capture reached its storage limit. The provider received the original payload.</p>}
      {call.content_access ? <>
        <h4>Request to model</h4><WorkflowDataView value={call.request_payload} defaultMode="json" jsonLabel={`Model call ${number} request JSON`} copyJsonLabel={`Copy model call ${number} request JSON`} empty="No request payload was retained." />
        <h4>Response from model</h4><WorkflowDataView value={call.response_payload} defaultMode="json" jsonLabel={`Model call ${number} response JSON`} copyJsonLabel={`Copy model call ${number} response JSON`} empty={call.status === 'running' ? 'Waiting for the model response…' : 'No response payload was received.'} />
      </> : <p className="studio-empty">Prompt and response content requires workspace administrator access and permission to view this node's source data.</p>}
      <details><summary>Call references</summary><dl className="studio-model-call-facts">{Object.entries({ 'AI feature': call.feature, 'Configuration source': call.capture?.configuration_source?.replace(/_/g, ' '), 'Configuration version': call.capture?.configuration_version, 'Configuration fingerprint': call.capture?.configuration_hash, 'Call ID': call.id, 'Agent session': call.session_id, 'Correction of': call.correction_of, 'Provider request': call.provider_request_id }).filter(([, value]) => value != null).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></details>
    </>}
  </div>;
}
