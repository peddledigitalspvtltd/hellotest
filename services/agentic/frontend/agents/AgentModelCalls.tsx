import { useState } from 'react';
import type { AgenticAssistantResult } from '@hellotest/platform/frontend/src/types';
import { capabilityView } from '@hellotest/platform/frontend/src/platform/capabilities/CapabilityView';
import { agentOutcomeCalls } from '../lib/agentOutcomeView';
export const ModelCallDetails = capabilityView<{ projectId: string; traceId: string }>('trace', 'ModelCallDetails', () => import('@hellotest/trace/frontend/components/ModelCallDetails'), 'Model call');
export const SessionModelCalls = capabilityView<{ projectId: string; sessionId: string }>('trace', 'SessionModelCalls', () => import('@hellotest/trace/frontend/components/ModelCallDetails'), 'Activity model calls');
export function AgentModelCalls({ projectId, chain = [], records, sessionId, execution }: { sessionId?: string; projectId: string; chain?: AgenticAssistantResult['agent_chain']; records?: AgenticAssistantResult['model_call_records']; execution?: AgenticAssistantResult['model_execution'] }) {
  const calls = agentOutcomeCalls(records, chain);
  const [selected, setSelected] = useState('');
  const activeIndex = calls.findIndex((call, index) => (call.trace_id || `untraced-${index}`) === selected);
  const active = calls[Math.max(0, activeIndex)];
  if (!calls.length && sessionId) return <SessionModelCalls projectId={projectId} sessionId={sessionId} />;
  return <section className="agent-model-calls" aria-label="Activity model calls">
    <p>Recorded requests include generation and correction attempts. A completed model call does not establish that its outcome passed review.</p>
    {execution && <dl className="agent-outcome-facts"><div><dt>Model</dt><dd>{execution.effective_model || 'Not recorded'}</dd></div><div><dt>Calls used</dt><dd>{execution.model_calls} of {execution.max_model_calls}</dd></div><div><dt>Total tokens</dt><dd>{typeof execution.usage?.total_tokens === 'number' ? execution.usage.total_tokens.toLocaleString() : 'Not fully reported'}</dd></div><div><dt>Agent version</dt><dd>{execution.agent_version}</dd></div></dl>}
    {!calls.length ? <p>No model call was recorded for this activity.</p> : <><nav aria-label="Choose activity model call">{calls.map((call, index) => <button className="ghost-button compact" type="button" key={call.trace_id || `untraced-${index}`} aria-pressed={active === call} onClick={() => setSelected(call.trace_id || `untraced-${index}`)}>{call.name}{call.attempt != null ? ` · Call ${call.attempt}` : ''} · {call.status.replace(/_/g, ' ')}</button>)}</nav>{active?.trace_id ? <ModelCallDetails projectId={projectId} traceId={active.trace_id} /> : <p role="status">This attempt has no retained call capture. Its request and response cannot be inspected here.</p>}</>}
  </section>;
}
