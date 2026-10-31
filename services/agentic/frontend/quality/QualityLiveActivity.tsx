import { useMemo } from 'react';
import { IconCheck, IconInfoCircle, IconRefresh, IconTool, IconSparkles, IconX } from '@tabler/icons-react';
import type { QualityAgentEvent, QualityLiveState, QualityStreamState } from '../lib/qualityProgressStream';

type Activity = { id: string; kind: 'model' | 'tool' | 'notice'; title: string; text: string; status: string; summary?: string; truncated?: boolean; at?: string };
const text = (value: unknown, limit = 2000) => typeof value === 'string' ? value.slice(0, limit) : '';
function activities(events: QualityAgentEvent[]) {
  const items: Activity[] = [], byId = new Map<string, Activity>();
  for (const event of events) {
    const value = event.data;
    if (['model_start', 'text', 'model_done'].includes(event.type)) {
      const id = text(value.call_id, 200) || `model-${event.seq}`;
      let item = byId.get(id);
      if (!item) { item = { id, kind: 'model', title: value.stage === 'assessment' || value.phase === 'assessment' ? 'Evidence assessment' : 'Agent model turn', text: '', status: 'running', at: event.at }; byId.set(id, item); items.push(item); }
      if (event.type === 'text') {
        const combined = item.text + text(value.text, 24000); item.text = combined.slice(-48000);
        item.truncated = item.truncated || value.preview_truncated === true || combined.length > 48000;
      }
      if (event.type === 'model_done') { item.status = text(value.status) || 'completed'; item.summary = value.finish_reason ? `Finish reason: ${text(value.finish_reason, 80)}` : undefined; }
    } else if (['tool_start', 'tool_result'].includes(event.type)) {
      const id = text(value.tool_call_id || value.tool_id || value.call_id, 200) || `tool-${event.seq}`;
      let item = byId.get(id);
      if (!item) { item = { id, kind: 'tool', title: text(value.name, 120) || 'Browser operation', text: '', status: 'running', at: event.at }; byId.set(id, item); items.push(item); }
      if (value.name) item.title = text(value.name, 120);
      item.summary = text(value.summary || value.message);
      if (event.type === 'tool_result') item.status = text(value.status, 30) || 'completed';
    } else if (event.type === 'error') {
      const detail: Record<string, unknown> = value.error && typeof value.error === 'object' && !Array.isArray(value.error) ? value.error as Record<string, unknown> : {};
      const code = text(detail.code || value.code, 100);
      items.push({ id: `notice-${event.seq}`, kind: 'notice', title: `Execution notice${code ? ` · ${code}` : ''}`, status: 'failed', text: text(value.message || value.summary || detail.message), at: event.at });
    } else if (event.type === 'progress' && value.phase === 'stream_limit') {
      items.push({ id: `notice-${event.seq}`, kind: 'notice', title: 'Live text preview limit', status: 'limited', text: text(value.message || value.summary) || 'The live text preview reached its display budget. The run continues and its validated outcome remains available.', at: event.at });
    } else if (event.type === 'done' && ['failed', 'cancelled', 'interrupted'].includes(String(value.status))) {
      for (const item of byId.values()) if (item.status === 'running') {
        item.status = 'interrupted';
        item.summary = value.status === 'cancelled' ? 'Stopped before a completion event was recorded.' : 'The run stopped before a completion event was recorded.';
      }
    }
  }
  return items.slice(-40);
}
export function QualityLiveActivity({ state, connection, active, onReconnect }: { state: QualityLiveState; connection: QualityStreamState; active: boolean; onReconnect: () => void }) {
  const items = useMemo(() => activities(state.events), [state.events]);
  const connected = connection.status === 'live';
  return <section className="quality-live-activity" aria-label="Agent live activity">
    <header><div><span className="quality-kicker"><IconSparkles size={14} />Agent activity</span><h3>{active ? 'Working with the observed evidence' : 'Recorded agent activity'}</h3></div><span className={`quality-stream-state is-${connection.status}`} role="status"><span />{connected ? 'Live connection' : connection.status === 'reconnecting' ? 'Reconnecting' : connection.status === 'connecting' ? 'Connecting' : connection.status === 'closed' ? 'Recorded' : 'Status polling'}</span></header>
    <p className="quality-live-explanation">Model output is provisional while it streams. Validated findings and the final assessment appear separately below.</p>
    {connection.message && <div className="quality-stream-notice"><p>{connection.message}</p>{connection.status === 'unavailable' && <button type="button" className="quality-text-button" onClick={onReconnect}><IconRefresh size={14} />Reconnect activity</button>}</div>}
    {!items.length ? <p className="quality-live-empty">{active ? 'Waiting for the first recorded model turn or browser operation. The run continues in the background.' : 'No model or tool events were recorded for this run.'}</p> : <ol className="quality-live-list" aria-label="Recorded model turns and tool operations">{items.map(item => <li key={item.id} className={`quality-live-card is-${item.kind} is-${item.status}`}>
      <header><span className="quality-live-icon">{item.kind === 'tool' ? <IconTool size={15} /> : item.kind === 'model' ? <IconSparkles size={15} /> : item.status === 'limited' ? <IconInfoCircle size={15} /> : <IconX size={15} />}</span><strong>{item.title}</strong><span className="quality-live-card-status">{item.status === 'completed' ? <IconCheck size={13} /> : item.status === 'failed' ? <IconX size={13} /> : <span className={active && item.status === 'running' ? 'quality-pulse' : ''} />}{item.status === 'running' && !active ? 'Partial record' : item.status === 'running' ? 'In progress' : item.status}</span></header>
      {item.summary && <p>{item.summary}</p>}
      {item.kind === 'model' && <details open={active || items.length <= 3}><summary>Provisional model output{item.truncated ? ' · recent text' : ''}</summary><pre tabIndex={0} aria-label="Provisional model output">{item.text || 'This turn has not emitted displayable text.'}</pre></details>}
      {item.kind === 'notice' && <p>{item.text}</p>}
      {item.truncated && <small>The recent text preview is bounded. Use Model calls to inspect the recorded request and response.</small>}
    </li>)}</ol>}
    {(state.omitted > 0 || items.length >= 40) && <p className="quality-live-retention">Showing the recent activity window. Final validated output and model-call records remain separate.</p>}
  </section>;
}
