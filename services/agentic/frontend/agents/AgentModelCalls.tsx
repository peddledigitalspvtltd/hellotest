import { useState } from 'react';
import type { AgenticAssistantResult } from '@hellotest/platform/frontend/src/types';
import { capabilityView } from '@hellotest/platform/frontend/src/platform/capabilities/CapabilityView';
export const ModelCallDetails = capabilityView<{ projectId: string; traceId: string }>('trace', 'ModelCallDetails', () => import('@hellotest/trace/frontend/components/ModelCallDetails'), 'Model call');
export const SessionModelCalls = capabilityView<{ projectId: string; sessionId: string }>('trace', 'SessionModelCalls', () => import('@hellotest/trace/frontend/components/ModelCallDetails'), 'Activity model calls');
export function AgentModelCalls({ projectId, chain = [], records, sessionId }: { sessionId?: string; projectId: string; chain?: AgenticAssistantResult['agent_chain']; records?: AgenticAssistantResult['model_call_records'] }) {
  const calls = (records || chain).filter(call => call.trace_id);
  const [selected, setSelected] = useState('');
  const active = calls.find(call => call.trace_id === selected) || calls[0];
  if (!calls.length && sessionId) return <SessionModelCalls projectId={projectId} sessionId={sessionId} />;
  return <section className="agent-model-calls" aria-label="Activity model calls">
    {!calls.length ? <p>No model call was recorded for this activity.</p> : <><nav aria-label="Choose activity model call">{calls.map((call, index) => <button className="ghost-button compact" type="button" key={`${call.trace_id}:${index}`} aria-pressed={active?.trace_id === call.trace_id} onClick={() => setSelected(call.trace_id!)}>{call.name}{'attempt' in call ? ` · Call ${call.attempt}` : ''}</button>)}</nav>{active?.trace_id && <ModelCallDetails projectId={projectId} traceId={active.trace_id} />}</>}
  </section>;
}
