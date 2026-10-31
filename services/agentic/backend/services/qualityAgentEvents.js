const { randomUUID } = require('node:crypto');
const TYPES = new Set(['model_start', 'text', 'model_done', 'tool_start', 'tool_result', 'progress', 'status', 'error', 'done']);
const MAX_EVENTS = 8192, MAX_TEXT_BYTES = 512 * 1024, MAX_EVENT_BYTES = 32768;
const fail = message => Object.assign(new Error(message), { publicMessage: message, statusCode: 400, code: 'QUALITY_AGENT_EVENT_INVALID' });
const privateKey = /^(?:authorization|cookie|set-cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)$/i;
function scrub(value, depth = 0) {
  if (depth > 12) throw fail('Quality progress exceeded its nesting budget.');
  if (typeof value === 'string') return value.replace(/\u0000/g, '')
    .replace(/-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/(\b(?:Bearer|Basic)\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED_TOKEN]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_TOKEN]')
    .replace(/(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd)["']?\s*[:=]\s*)["']?[^\s,"';}]{1,}/gi, '$1[REDACTED_SECRET]');
  if (Array.isArray(value)) return value.map(item => scrub(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key)).map(([key, item]) => [key, privateKey.test(key) ? '[REDACTED_SECRET]' : scrub(item, depth + 1)]));
  return value;
}
function normalize(entry) {
  if (!TYPES.has(entry?.type)) throw fail('Choose a supported quality progress event.');
  const data = scrub(entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data) ? entry.data : {});
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_EVENT_BYTES) throw fail('Quality progress exceeded its event size budget.');
  return { type: entry.type, data };
}
function cursor(value = 0) {
  if (!/^(?:0|[1-9]\d{0,9})$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw fail('Use a valid quality progress cursor.');
  return Number(value);
}
// Keep a short recognition tail across provider/network boundaries. Re-scrub
// the bounded call transcript so an arbitrarily fragmented token/key can never
// be reconstructed from individually innocuous persisted text chunks.
function createTextRedactor() {
  let raw = '', emitted = '';
  const safe = () => scrub(raw.replace(/-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?(?:-----END(?: [A-Z0-9]+)? PRIVATE KEY-----|$)/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*){0,2}/g, '[REDACTED_TOKEN]'));
  function read(final) {
    const value = safe();
    if (!value.startsWith(emitted)) throw fail('The streamed output cannot be safely redacted across fragments.');
    const end = final ? value.length : Math.max(emitted.length, value.length - 64);
    const result = value.slice(emitted.length, end); emitted = value.slice(0, end); return result;
  }
  return { push(value) { raw += String(value || ''); if (raw.length > 131072) throw fail('The streamed model call exceeded its text budget.'); return read(false); }, finish() { return read(true); } };
}
function createQualityAgentEventLog({ db }) {
  return {
    async appendStreamEvent(row, input, options = {}) {
      let entry = normalize(input);
      return db.transaction(async () => {
        const current = await db.prepare("SELECT * FROM workspace_transactions WHERE id=? AND related_kind='quality_agent_run' FOR UPDATE").get(row.id);
        if (!current || current.project_id !== row.project_id || current.metadata.id !== row.metadata.id) return null;
        const active = ['queued', 'running'].includes(current.status) && !current.metadata.cancellation_requested;
        const lease = options.lease_token ?? row.metadata.lease_token;
        if (lease && current.metadata.lease_token !== lease) return null;
        if (!active && !(options.allow_terminal && current.metadata.run_status === row.metadata.run_status)) return null;
        let seq = Number(current.metadata.quality_event_seq) || 0;
        let textBytes = Number(current.metadata.quality_event_text_bytes) || 0;
        const bytes = entry.type === 'text' ? Buffer.byteLength(entry.data.text || '') : 0;
        // Reserve control-event slots. A bounded live transcript never blocks
        // recording the validated final outcome or an actionable error.
        if (entry.type === 'text' && (seq >= MAX_EVENTS - 256 || textBytes + bytes > MAX_TEXT_BYTES)) {
          if (current.metadata.quality_event_text_limited) return { skipped: true, limited: true };
          entry = { type: 'progress', data: { phase: 'stream_limit', message: 'Live output reached its display budget. The agent continues; its validated outcome remains available.' } };
        } else textBytes += bytes;
        if (seq >= MAX_EVENTS && !['done', 'error'].includes(entry.type)) return { skipped: true, limited: true };
        seq += 1;
        const envelope = { id: String(seq), seq, run_id: current.metadata.id, project_id: current.project_id,
          app_type_id: current.app_type_id || null, type: entry.type, data: entry.data, at: new Date().toISOString() };
        await db.prepare('INSERT INTO workspace_transaction_events(id,transaction_id,level,phase,message,details) VALUES(?,?,?,?,?,?)').run(
          randomUUID(), current.id, entry.type === 'error' || entry.type === 'done' && entry.data.status === 'failed' ? 'error' : entry.type === 'done' && entry.data.status === 'completed' ? 'success' : entry.type === 'done' && entry.data.status === 'cancelled' ? 'warning' : 'info', entry.type,
          String(entry.data.message || entry.data.summary || `Quality agent ${entry.type}`).slice(0, 1200), { quality_agent_event: envelope });
        await db.prepare('UPDATE workspace_transactions SET metadata=metadata || ?::jsonb WHERE id=?').run({ quality_event_seq: seq, quality_event_text_bytes: textBytes,
          ...(entry.data.phase === 'stream_limit' ? { quality_event_text_limited: true } : {}),
          ...(active && lease ? { lease_until: new Date(Date.now() + 60000).toISOString() } : {}) }, current.id);
        return envelope;
      })();
    },
    async listStreamEvents(row, after = 0, limit = 200) {
      after = cursor(after);
      const count = Math.max(1, Math.min(200, Number(limit) || 200));
      const current = await db.prepare("SELECT metadata,project_id,app_type_id FROM workspace_transactions WHERE id=? AND related_kind='quality_agent_run'").get(row.id);
      if (!current || current.project_id !== row.project_id || (current.app_type_id || null) !== (row.app_type_id || null) || current.metadata.id !== row.metadata.id) throw Object.assign(fail('Quality progress was not found in this scope.'), { statusCode: 404 });
      const last = Number(current?.metadata?.quality_event_seq) || 0;
      if (after > last) throw Object.assign(fail('The quality progress cursor belongs to a newer or different run.'), { statusCode: 409 });
      const rows = await db.prepare(`SELECT details->'quality_agent_event' AS event FROM workspace_transaction_events
        WHERE transaction_id=? AND details->'quality_agent_event' IS NOT NULL
          AND (details->'quality_agent_event'->>'seq')::bigint > ?
        ORDER BY (details->'quality_agent_event'->>'seq')::bigint LIMIT ?`).all(row.id, after, count);
      const items = rows.map(item => item.event);
      return { items, next_cursor: items.at(-1)?.seq ?? after, last_sequence: last, has_more: items.length > 0 && items.at(-1).seq < last };
    }
  };
}
module.exports = { createQualityAgentEventLog, normalize, scrub, cursor, createTextRedactor, TYPES, MAX_EVENTS, MAX_TEXT_BYTES };
