import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const ts = require('typescript');
const mod = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../../frontend/lib/qualityProgressStream.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(mod);
const envelope = (seq, type = 'text', data = { call_id: 'call', text: 'provisional' }, patch = {}) => ({ id: String(seq), seq, type, run_id: 'run-1', project_id: 'project', app_type_id: 'app', data, ...patch });
const frame = value => `id: ${value.seq}\nevent: agent\ndata: ${JSON.stringify(value)}\n\n`;
const response = chunks => new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });

test('SSE parser handles every character boundary, split CRLF, multiline data, comments and colons inside strings', () => {
  const frames = []; let heartbeats = 0;
  const parser = mod.createQualitySseParser(value => frames.push(value), () => heartbeats++);
  const text = ': keepalive\r\nid: 7\r\nevent: agent\r\ndata: {"message":\r\ndata: "https://example.test:443/a"}\r\n\r\n';
  for (const char of text) parser.push(char);
  assert.equal(heartbeats, 1); assert.equal(frames.length, 1); assert.equal(frames[0].id, '7');
  assert.deepEqual(JSON.parse(frames[0].data), { message: 'https://example.test:443/a' });
  const cr = []; const crParser = mod.createQualitySseParser(value => cr.push(value));
  crParser.push('event: agent\rdata: {"seq":8}\r\r'); crParser.finish(); assert.equal(cr.length, 1);
});

test('incomplete trailing events are discarded and never acknowledged on stream loss', () => {
  const frames = [], parser = mod.createQualitySseParser(value => frames.push(value));
  parser.push('id: 1\nevent: agent\ndata: {"seq":1}'); parser.finish(); assert.deepEqual(frames, []);
  parser.push('id: 2\nevent: agent\ndata: {"seq":2}\n\n'); assert.equal(frames.length, 1); assert.equal(frames[0].id, '2');
});

test('logical events and snapshot validation reject foreign run identities and invalid cursors', () => {
  assert.throws(() => mod.qualityEvent({ event: 'agent', id: '1', data: JSON.stringify(envelope(1, 'text', {}, { run_id: 'foreign' })) }, 'run-1'), /another run/);
  assert.throws(() => mod.qualityEvent({ event: 'agent', id: 'bad', data: JSON.stringify({ ...envelope(1), seq: 'bad' }) }, 'run-1'), /cursor/);
  assert.throws(() => mod.qualitySnapshot({ event: 'progress', data: JSON.stringify({ id: 'foreign', status: 'running' }) }, 'run-1'), /does not match/);
  assert.equal(mod.qualitySnapshot({ event: 'progress', data: JSON.stringify({ id: 'run-1', status: 'completed' }) }, 'run-1').status, 'completed');
});

test('reconnect resumes after only a complete delivered event and deduplicates replayed IDs', async () => {
  const cursors = [], events = [], states = [], snapshots = [];
  const chunks = [response([frame(envelope(1, 'model_start', { call_id: 'call' })), 'id: 2\nevent: agent\ndata: {"seq":']), response([frame(envelope(1)), frame(envelope(2)), frame(envelope(3, 'done', {})), 'event: progress\ndata: {"id":"run-1","status":"completed"}\n\n'])];
  await mod.streamQualityProgress({ runId: 'run-1', signal: new AbortController().signal, sessionRevision: () => 1, retryDelayMs: 0,
    connect: async cursor => { cursors.push(cursor); return chunks.shift(); }, onSnapshot: value => snapshots.push(value), options: { onEvent: value => events.push(value), onState: value => states.push(value.status) } });
  assert.deepEqual(cursors, ['', '1']); assert.deepEqual(events.map(value => value.seq), [1, 2, 3]); assert.equal(snapshots[0].status, 'completed');
  assert.ok(states.includes('reconnecting')); assert.equal(states.at(-1), 'closed');
});

test('a terminal snapshot drains the remaining recorded model events before closing', async () => {
  const events = [];
  await mod.streamQualityProgress({ runId: 'run-1', signal: new AbortController().signal, sessionRevision: () => 1, onSnapshot() {},
    connect: async () => response(['event: progress\ndata: {"id":"run-1","status":"completed"}\n\n', frame(envelope(1)), frame(envelope(2, 'done', {})), 'event: complete\ndata: {}\n\n']), options: { onEvent: value => events.push(value) } });
  assert.deepEqual(events.map(value => value.seq), [1, 2]);
});

test('stream decoder preserves UTF-8 split inside code points', async () => {
  const bytes = new TextEncoder().encode(frame(envelope(1, 'text', { text: 'Café 测试' })) + frame(envelope(2, 'done', {})));
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const events = [];
  await mod.streamQualityProgress({ runId: 'run-1', signal: new AbortController().signal, sessionRevision: () => 1, onSnapshot() {}, connect: async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }), options: { onEvent: value => events.push(value) } });
  assert.equal(events[0].data.text, 'Café 测试');
});

test('access denial is never retried and session replacement aborts before another request', async () => {
  let calls = 0;
  await assert.rejects(mod.streamQualityProgress({ runId: 'run-1', signal: new AbortController().signal, sessionRevision: () => 1, onSnapshot() {}, connect: async () => { calls++; return new Response('', { status: 403 }); } }));
  assert.equal(calls, 1);
  let revision = 1;
  await assert.rejects(mod.streamQualityProgress({ runId: 'run-1', signal: new AbortController().signal, sessionRevision: () => revision, onSnapshot() {}, connect: async () => { revision = 2; return response([frame(envelope(1))]); } }), { name: 'AbortError' });
});

test('stream cancellation stops an idle request without issuing another request', async () => {
  const controller = new AbortController(); let calls = 0;
  const task = mod.streamQualityProgress({ runId: 'run-1', signal: controller.signal, sessionRevision: () => 1, onSnapshot() {}, connect: async (_cursor, signal) => { calls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true })); } });
  controller.abort(); await assert.rejects(task, { name: 'AbortError' }); assert.equal(calls, 1);
});

test('activity state is bounded, compacts deltas and ignores duplicate or stale delivery', () => {
  let state = mod.emptyQualityLiveState();
  for (let seq = 1; seq <= 1000; seq++) state = mod.appendQualityEvent(state, envelope(seq));
  assert.equal(state.events.length, 1); assert.equal(state.lastSeq, 1000);
  assert.equal(mod.appendQualityEvent(state, envelope(999)), state);
  state = mod.appendQualityEvent(state, envelope(1001, 'text', { call_id: 'call', text: 'x'.repeat(25000) }));
  assert.equal(state.events[0].data.text.length, 24000); assert.equal(state.events[0].data.preview_truncated, true);
  for (let seq = 1002; seq < 1402; seq++) state = mod.appendQualityEvent(state, envelope(seq, 'tool_start', { tool_id: String(seq) }));
  assert.equal(state.events.length, 300); assert.ok(state.omitted > 0);
});
