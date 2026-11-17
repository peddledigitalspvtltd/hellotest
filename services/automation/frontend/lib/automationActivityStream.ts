import type { WorkspaceTransaction, WorkspaceTransactionEvent } from '@hellotest/platform/frontend/src/types';
import { API_BASE_URL, readRequestSession, request, toQueryString } from '@hellotest/platform/frontend/src/lib/httpClient';
import { resolveServiceBase } from '@hellotest/platform/frontend/src/platform/lib/serviceEndpoints';

export type AutomationActivity = WorkspaceTransaction & { events?: WorkspaceTransactionEvent[]; events_next_offset?: number; events_has_more?: boolean; events_total?: number };
export const getAutomationActivity = (id: string, signal?: AbortSignal) => request<AutomationActivity>(`/test-cases/automation/jobs/${encodeURIComponent(id)}`, { signal, cache: 'no-store' });

/** Credentials, routing and session replacement use the platform client policy.
 * The cursor represents durable append-only activity rows, not model output. */
export async function streamAutomationBuildActivity(id: string, onActivity: (activity: AutomationActivity) => void, signal: AbortSignal, after = 0): Promise<{ cursor: number; complete: boolean }> {
  const path = `/test-cases/automation/jobs/${encodeURIComponent(id)}/events`, session = readRequestSession();
  const response = await fetch(`${resolveServiceBase(path, API_BASE_URL)}${path}${toQueryString({ after })}`, {
    headers: { Accept: 'text/event-stream', ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}), 'Last-Event-ID': String(after) }, signal, cache: 'no-store'
  });
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body?.cancel();
    throw Object.assign(new Error('The activity stream is unavailable.'), { statusCode: response.status });
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', name = '', data: string[] = [], frameId = '', cursor = after, complete = false, reconnect = false;
  const active = () => {
    signal.throwIfAborted();
    if (readRequestSession().revision !== session.revision) throw new DOMException('The session changed.', 'AbortError');
  };
  const dispatch = () => {
    if (name === 'complete') complete = true;
    if (['reconnect', 'unavailable'].includes(name)) reconnect = true;
    if (name === 'activity' && data.length) {
      const snapshot = JSON.parse(data.join('\n')) as AutomationActivity, next = Number(frameId);
      if (snapshot.id !== id || !Number.isSafeInteger(next) || next < cursor || next > 1000000 || !Array.isArray(snapshot.events)) throw new Error('Invalid activity stream scope or cursor.');
      active(); onActivity(snapshot); cursor = next;
    }
    name = ''; data = []; frameId = '';
  };
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (!complete && !reconnect) {
      active(); const chunk = await reader.read(); active();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length + data.reduce((sum, value) => sum + value.length, 0) > 4 * 1024 * 1024) throw new Error('The activity frame exceeds its supported size.');
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        const line = buffer.slice(0, at).replace(/\r$/, ''); buffer = buffer.slice(at + 1);
        if (!line) dispatch();
        else if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('id:')) frameId = line.slice(3).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
    }
    return { cursor, complete };
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export function mergeAutomationActivity(previous: AutomationActivity | null, next: AutomationActivity): AutomationActivity {
  const events = new Map((previous?.id === next.id ? previous.events || [] : []).map(event => [event.id, event]));
  for (const event of next.events || []) events.set(event.id, event);
  return { ...next, events: [...events.values()].slice(-2000) };
}
