import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');

function load(file, imports, globals = {}) {
  const module = { exports: {} }, source = ts.transpileModule(readFileSync(new URL(`../../frontend/${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', 'module', ...Object.keys(globals), source)(name => {
    if (!Object.hasOwn(imports, name)) throw new Error(`Unexpected activity dependency ${name}`);
    return imports[name];
  }, module.exports, module, ...Object.values(globals));
  return module.exports;
}
function client(fetch) {
  const session = { token: 'fixture-token', revision: 1 };
  const api = load('lib/automationActivityStream.ts', {
    '@hellotest/platform/frontend/src/lib/httpClient': { API_BASE_URL: '', readRequestSession: () => ({ ...session }), request: async () => ({}), toQueryString: value => '?' + new URLSearchParams(value) },
    '@hellotest/platform/frontend/src/platform/lib/serviceEndpoints': { resolveServiceBase: () => 'https://service.example.test' }
  }, { fetch });
  return { ...api, session };
}
const snapshot = (status = 'running', events = [{ id: 'event-1', message: 'Saved section' }]) => ({ id: 'activity', project_id: 'project', status, events, events_next_offset: events.length });
const frame = (value, cursor = 1) => `id: ${cursor}\nevent: activity\ndata: ${JSON.stringify(value)}\n\n`;
function response(text, size = 19) {
  const bytes = new TextEncoder().encode(text);let offset = 0;
  return new Response(new ReadableStream({ pull(controller) { if (offset >= bytes.length) { controller.close(); return; } controller.enqueue(bytes.slice(offset, offset += size)); } }), { headers: { 'content-type': 'text/event-stream' } });
}

test('activity client consumes chunked UTF-8 frames with scoped auth/cursors and preserves complete status', async () => {
  const calls = [], seen = [];
  const api = client(async (url, options) => { calls.push({ url, options });return response(frame(snapshot('running', [{ id: 'event-1', message: 'Étape saved' }]), 4) + frame(snapshot('completed'), 5) + 'event: complete\ndata: {}\n\n'); });
  const controller = new AbortController(), result = await api.streamAutomationBuildActivity('activity', value => seen.push(value), controller.signal, 3);
  assert.deepEqual(result, { cursor: 5, complete: true });assert.equal(seen.length, 2);assert.equal(seen[0].events[0].message, 'Étape saved');
  assert.match(calls[0].url, /\/activity\/events\?after=3$/);assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-token');
  assert.equal(calls[0].options.headers['Last-Event-ID'], '3');assert.equal(calls[0].options.cache, 'no-store');
});

test('activity client refuses wrong-scope, rewound, invalid and oversized frames before publishing', async () => {
  for (const source of [frame({ ...snapshot(), id: 'another-activity' }), frame(snapshot(), 0), 'id: 2\nevent: activity\ndata: {invalid}\n\n', 'data: ' + 'x'.repeat(4 * 1024 * 1024 + 1)]) {
    const api = client(async () => response(source, 8192)), seen = [];
    await assert.rejects(api.streamAutomationBuildActivity('activity', value => seen.push(value), new AbortController().signal, 1));
    assert.deepEqual(seen, []);
  }
});

test('session replacement interrupts activity delivery rather than publishing another credential scope', async () => {
  const api = client(async () => response(frame(snapshot()) + frame(snapshot('completed'), 2))), seen = [];
  await assert.rejects(api.streamAutomationBuildActivity('activity', value => { seen.push(value);api.session.revision++; }, new AbortController().signal), { name: 'AbortError' });
  assert.equal(seen.length, 1);
});

test('merging reconnect pages deduplicates durable IDs and does not carry another activity history', () => {
  const api = client(async () => response(''));
  const first = snapshot(), second = { ...snapshot(), events: [{ id: 'event-1', message: 'Updated' }, { id: 'event-2' }] };
  const merged = api.mergeAutomationActivity(first, second);
  assert.deepEqual(merged.events.map(value => value.id), ['event-1', 'event-2']);assert.equal(merged.events[0].message, 'Updated');
  assert.deepEqual(api.mergeAutomationActivity(first, { ...second, id: 'other', events: [] }).events, []);
});

function hookFixture(overrides) {
  const effects = [], states = [], refs = [], seen = [], unavailable = [], timers = [];
  let stateIndex = 0, refIndex = 0, polls = 0;
  const api = client(async () => response(''));
  const ports = {
    ...api,
    streamAutomationBuildActivity: overrides.stream,
    getAutomationActivity: async (...args) => { polls++;return overrides.poll(...args); }
  };
  const react = {
    useRef: value => refs[refIndex++] ||= { current: value },
    useState: initial => { const at = stateIndex++;states[at] ??= initial;return [states[at], value => { states[at] = typeof value === 'function' ? value(states[at]) : value; }]; },
    useEffect: setup => effects.push(setup)
  };
  const { useAutomationActivityStream } = load('hooks/useAutomationActivityStream.ts', { react, '../lib/automationActivityStream': ports }, { setTimeout: callback => { timers.push(callback);return timers.length; } });
  useAutomationActivityStream({ activityId: 'activity', onActivity: value => seen.push(value), onUnavailable: error => { seen.length = 0;unavailable.push(error); } });
  const cleanup = effects[0]();
  return { states, seen, unavailable, timers, cleanup, get polls() { return polls; }, settle: async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); } };
}

test('the hook clears a revoked snapshot and stops reconnect/poll work on both stream and fallback authorization failures', async () => {
  for (const at of ['stream', 'poll']) {
    const failure = Object.assign(new Error('Access changed'), { statusCode: 403 });
    const f = hookFixture({ stream: async (_id, publish) => { if (at === 'poll') publish(snapshot());throw at === 'stream' ? failure : new Error('Connection ended'); }, poll: async () => { throw failure; } });
    await f.settle();assert.equal(f.states[0], 'unavailable');assert.equal(f.unavailable.length, 1);assert.equal(f.seen.length, 0);
    assert.equal(f.polls, at === 'stream' ? 0 : 1);assert.equal(f.timers.length, 0);f.cleanup();
  }
});

test('the hook polls transient disconnects and aborts scoped cleanup without replacing saved work', async () => {
  const f = hookFixture({ stream: async () => { throw new Error('Temporary stream failure'); }, poll: async () => snapshot() });
  await f.settle();assert.equal(f.states[0], 'polling');assert.equal(f.polls, 1);assert.equal(f.seen.length, 1);assert.equal(f.unavailable.length, 0);
  f.cleanup();f.timers[0]();await f.settle();assert.equal(f.polls, 1);
});

test('the hook stops cleanly after completion and clears old view state on session replacement', async () => {
  for (const mode of ['completed', 'session']) {
    const f = hookFixture({ stream: async (_id, publish) => { publish(snapshot());if (mode === 'session') throw new DOMException('Session changed', 'AbortError');return { complete: true, cursor: 1 }; }, poll: async () => assert.fail('Do not poll terminal/session-replaced work') });
    await f.settle();assert.equal(f.states[0], mode === 'completed' ? 'idle' : 'unavailable');assert.equal(f.polls, 0);
    assert.equal(f.unavailable.length, mode === 'completed' ? 0 : 1);f.cleanup();
  }
});
