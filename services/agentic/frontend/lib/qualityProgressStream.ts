import type { QualityAgentRun } from './qualityAgentContracts';

export type QualityAgentEvent = {
  id: string;
  seq: number;
  run_id: string;
  project_id?: string;
  app_type_id?: string | null;
  type: string;
  at?: string;
  data: Record<string, unknown>;
};
export type QualityStreamState = { status: 'connecting' | 'live' | 'reconnecting' | 'closed' | 'unavailable'; attempt?: number; message?: string };
export type QualityStreamOptions = {
  after?: string;
  onEvent?: (event: QualityAgentEvent) => void;
  onState?: (state: QualityStreamState) => void;
};
export type QualitySseFrame = { event: string; data: string; id?: string; retry?: number };

/** Network reads are arbitrary byte boundaries, never SSE event boundaries. */
export function createQualitySseParser(onFrame: (frame: QualitySseFrame) => void, onHeartbeat?: () => void) {
  let buffer = '', event = 'message', data: string[] = [], id: string | undefined, size = 0, retry: number | undefined;
  const dispatch = () => {
    if (data.length) onFrame({ event, data: data.join('\n'), ...(id !== undefined ? { id } : {}), ...(retry !== undefined ? { retry } : {}) });
    event = 'message'; data = []; size = 0; id = undefined; retry = undefined;
  };
  const line = (value: string) => {
    if (!value) { dispatch(); return; }
    if (value.startsWith(':')) { onHeartbeat?.(); return; }
    const boundary = value.indexOf(':');
    const field = boundary < 0 ? value : value.slice(0, boundary);
    const content = boundary < 0 ? '' : value.slice(boundary + 1).replace(/^ /, '');
    if (field === 'event') event = content;
    if (field === 'data') { size += content.length; if (size > 4 * 1024 * 1024) throw new Error('A progress event exceeded its supported size.'); data.push(content); }
    if (field === 'id' && !content.includes('\0')) id = content;
    if (field === 'retry' && /^\d+$/.test(content)) retry = Math.min(15000, Math.max(500, Number(content)));
  };
  return {
    push(value: string) {
      buffer += value;
      // A CRLF delimiter can itself be split between network chunks. Retain a
      // trailing CR until the following read to avoid dispatching it twice.
      let cursor = 0;
      for (let index = 0; index < buffer.length; index++) {
        if (buffer[index] !== '\n' && buffer[index] !== '\r') continue;
        if (buffer[index] === '\r' && index === buffer.length - 1) break;
        line(buffer.slice(cursor, index));
        if (buffer[index] === '\r' && buffer[index + 1] === '\n') index++;
        cursor = index + 1;
      }
      buffer = buffer.slice(cursor);
      if (buffer.length > 4 * 1024 * 1024) throw new Error('A progress event exceeded its supported size.');
    },
    finish() {
      if (buffer.endsWith('\r')) line(buffer.slice(0, -1));
      // SSE dispatch requires an empty terminating line. A cut-off final event
      // is deliberately discarded so reconnect can replay its durable ID.
      buffer = ''; event = 'message'; data = []; size = 0; id = undefined;
    },
  };
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function qualityEvent(frame: QualitySseFrame, runId: string): QualityAgentEvent | null {
  if (['heartbeat', 'progress', 'snapshot', 'complete', 'unavailable'].includes(frame.event)) return null;
  const raw: unknown = JSON.parse(frame.data);
  if (!object(raw)) return null;
  const nested = object(raw.data) ? raw.data : object(raw.payload) ? raw.payload : raw;
  const id = frame.id || (typeof raw.id === 'string' ? raw.id : '');
  const seq = Number(raw.seq ?? raw.sequence ?? id);
  if (!id || !Number.isSafeInteger(seq) || seq < 1) throw new Error('The progress event has an invalid cursor.');
  if (raw.run_id !== runId) throw new Error('Progress belongs to another run.');
  return { id, seq, run_id: runId, type: typeof raw.type === 'string' ? raw.type : frame.event, data: nested,
    ...(typeof raw.project_id === 'string' ? { project_id: raw.project_id } : {}), ...(raw.app_type_id === null || typeof raw.app_type_id === 'string' ? { app_type_id: raw.app_type_id } : {}), ...(typeof raw.at === 'string' ? { at: raw.at } : {}) };
}
export function qualitySnapshot(frame: QualitySseFrame, runId: string): QualityAgentRun | null {
  if (!['progress', 'snapshot'].includes(frame.event)) return null;
  const raw: unknown = JSON.parse(frame.data);
  const value = object(raw) && object(raw.run) ? raw.run : raw;
  if (!object(value) || value.id !== runId || !['queued', 'running', 'completed', 'cancelled', 'failed'].includes(String(value.status))) throw new Error('The progress snapshot does not match this run.');
  return value as unknown as QualityAgentRun;
}

const MAX_EVENTS = 300;
export type QualityLiveState = { events: QualityAgentEvent[]; lastSeq: number; omitted: number };
export const emptyQualityLiveState = (): QualityLiveState => ({ events: [], lastSeq: 0, omitted: 0 });
export function appendQualityEvent(state: QualityLiveState, event: QualityAgentEvent): QualityLiveState {
  if (event.seq <= state.lastSeq) return state;
  const events = [...state.events, event];
  let omitted = state.omitted;
  // Provider deltas can be a handful of characters. Compact adjacent chunks
  // without losing the stable model/tool cards or rendering on every token.
  const prior = state.events[state.events.length - 1];
  if (event.type === 'text' && prior?.type === 'text' && prior.data.call_id === event.data.call_id && typeof prior.data.text === 'string' && typeof event.data.text === 'string') {
    const text = prior.data.text + event.data.text;
    events.splice(events.length - 2, 2, { ...event, data: { ...event.data, text: text.slice(-24000), ...(text.length > 24000 ? { preview_truncated: true } : prior.data.preview_truncated ? { preview_truncated: true } : {}) } });
  }
  if (events.length > MAX_EVENTS) { omitted += events.length - MAX_EVENTS; events.splice(0, events.length - MAX_EVENTS); }
  return { events, lastSeq: event.seq, omitted };
}

type StreamInput = {
  runId: string;
  onSnapshot: (run: QualityAgentRun) => void;
  options?: QualityStreamOptions;
  signal: AbortSignal;
  sessionRevision: () => unknown;
  connect: (cursor: string, signal: AbortSignal) => Promise<Response>;
  retryDelayMs?: number;
  idleTimeoutMs?: number;
};
function aborted() { return new DOMException('Progress observation stopped.', 'AbortError'); }
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); };
    const cancel = () => { cleanup(); reject(aborted()); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
export async function streamQualityProgress(input: StreamInput): Promise<void> {
  const { signal, options = {}, runId } = input;
  const revision = input.sessionRevision();
  let cursor = options.after || '', sequence = Number(cursor) || 0, retry = input.retryDelayMs ?? 750;
  let retries = 0;
  const active = () => { if (signal.aborted || input.sessionRevision() !== revision) throw aborted(); };
  while (true) {
    active();
    options.onState?.({ status: retries ? 'reconnecting' : 'connecting', attempt: retries });
    const connection = new AbortController();
    const stop = () => connection.abort(); signal.addEventListener('abort', stop, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const heartbeat = () => { clearTimeout(timer); timer = setTimeout(() => connection.abort(), input.idleTimeoutMs ?? 45000); };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let terminal = false;
    try {
      heartbeat();
      const response = await input.connect(cursor, connection.signal);
      active();
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        throw Object.assign(new Error('Live activity is unavailable. Saved run status remains available.'), { status: response.status });
      }
      options.onState?.({ status: 'live' });
      const decoder = new TextDecoder();
      const parser = createQualitySseParser(frame => {
        active();
        if (frame.event === 'complete') { terminal = true; return; }
        if (frame.event === 'unavailable') throw Object.assign(new Error('Live activity became unavailable. Saved status remains available.'), { status: 503 });
        const snapshot = qualitySnapshot(frame, runId);
        if (snapshot) { input.onSnapshot(snapshot); if (!['running', 'queued'].includes(snapshot.status)) terminal = true; return; }
        const event = qualityEvent(frame, runId);
        if (!event || event.seq <= sequence) return;
        options.onEvent?.(event);
        // Advance only after validated delivery. A partial frame or failed
        // scope check must be replayed, never silently acknowledged.
        sequence = event.seq; cursor = event.id;
        if (event.type === 'done') terminal = true;
      }, heartbeat);
      reader = response.body.getReader();
      while (!signal.aborted) {
        const chunk = await reader.read(); active();
        if (chunk.done) break;
        heartbeat(); parser.push(decoder.decode(chunk.value, { stream: true }));
      }
      parser.push(decoder.decode()); parser.finish();
      if (terminal) { options.onState?.({ status: 'closed' }); return; }
      throw new Error('The activity connection ended before the run finished.');
    } catch (failure) {
      active();
      const status = failure && typeof failure === 'object' && 'status' in failure ? Number(failure.status) : 0;
      if ([400, 401, 403, 404, 410].includes(status) || retries >= 7) {
        options.onState?.({ status: 'unavailable', message: status === 403 ? 'Access to live activity changed. Reload the saved run to check access.' : 'Live activity disconnected. Saved status continues to refresh.' });
        throw failure;
      }
      retries++;
      options.onState?.({ status: 'reconnecting', attempt: retries, message: 'Reconnecting from the last recorded event. Saved status continues to refresh.' });
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', stop); connection.abort();
      await reader?.cancel().catch(() => undefined); reader?.releaseLock();
    }
    await pause(Math.min(15000, retry * 2 ** Math.min(retries - 1, 4)), signal);
  }
}
