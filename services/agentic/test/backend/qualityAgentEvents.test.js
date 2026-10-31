const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, cursor, createTextRedactor, createQualityAgentEventLog, MAX_TEXT_BYTES } = require('../../backend/services/qualityAgentEvents');

test('progress sanitization preserves whitespace and protocol identities while stripping nested credentials', () => {
  const entry = normalize({ type: 'text', data: { call_id: 'run:decision:1', text: '  next\n password="private-value" Bearer very-private-token Authorization: Basic dXNlcjpwYXNz',
    nested: { authorization: 'Basic private', api_key: 'secret', value: false, count: 0, missing: null } } });
  assert.equal(entry.data.call_id, 'run:decision:1'); assert.match(entry.data.text, /^  next\n/);
  assert.doesNotMatch(JSON.stringify(entry), /private-value|very-private-token|Basic private|dXNlcjpwYXNz|"api_key":"secret"/);
  assert.deepEqual([entry.data.nested.value, entry.data.nested.count, entry.data.nested.missing], [false, 0, null]);
  assert.throws(() => normalize({ type: 'thinking', data: { text: 'hidden reasoning' } }), /supported/);
  assert.throws(() => normalize({ type: 'text', data: { text: 'x'.repeat(32769) } }), /size budget/);
});

test('fragmented credentials cannot be reassembled from a persisted public model transcript', () => {
  const secret = '  observed\n Authorization: Bearer confidential-value password="other-private-value", Basic dXNlcjpwYXNz ' +
    'eyJabcdefghijklm.nopqrstuvwxyz.abcdefghijklm -----BEGIN PRIVATE KEY-----\n' + 'K'.repeat(1000) + '\n-----END PRIVATE KEY-----\n';
  for (const width of [1, 7, 63, 127]) {
    const redactor = createTextRedactor(); let output = '';
    for (let index = 0; index < secret.length; index += width) output += redactor.push(secret.slice(index, index + width));
    output += redactor.finish();
    assert.match(output, /^  observed\n/); assert.doesNotMatch(output, /confidential-value|other-private-value|dXNlcjpwYXNz|eyJabcdefghijklm|KKKK/);
  }
  const plain = createTextRedactor(); const text = '  Ordinary evidence 🌍\n'.repeat(20);
  assert.equal(plain.push(text) + plain.finish(), text);
});

test('resume cursors accept complete integer sequence IDs only', () => {
  assert.equal(cursor(), 0); assert.equal(cursor('12'), 12);
  for (const value of ['-1', '01', '1.5', 'Infinity', '9e3', '2\n', {}, true, '10000000000']) assert.throws(() => cursor(value));
});

function fixture() {
  const current = { id: 'transaction', project_id: 'project', app_type_id: null, status: 'running', metadata: { id: 'run-12345', run_status: 'running', lease_token: 'lease' } };
  const saved = [];
  const db = { transaction: callback => async () => callback(), prepare: sql => ({
    get: async () => structuredClone(current),
    run: async (...args) => { if (sql.startsWith('INSERT')) saved.push(structuredClone(args.at(-1).quality_agent_event)); else if (sql.startsWith('UPDATE')) Object.assign(current.metadata, args[0]); },
    all: async (_id, after, limit) => saved.filter(event => event.seq > after).slice(0, limit).map(event => ({ event })),
  }) };
  return { log: createQualityAgentEventLog({ db }), current, saved, row: structuredClone(current) };
}

test('event append honors lease/cancellation guards and resumes stable records across readers', async () => {
  const f = fixture();
  assert.equal((await f.log.appendStreamEvent(f.row, { type: 'model_start', data: { call_id: 'call' } })).seq, 1);
  assert.equal((await f.log.appendStreamEvent(f.row, { type: 'text', data: { call_id: 'call', text: 'answer' } })).seq, 2);
  const page = await f.log.listStreamEvents(f.row, 1);
  assert.deepEqual(page.items.map(item => [item.id, item.run_id, item.project_id]), [['2', 'run-12345', 'project']]);
  f.current.metadata.lease_token = 'another-worker';
  assert.equal(await f.log.appendStreamEvent(f.row, { type: 'text', data: { text: 'late' } }), null);
  f.current.status = 'failed'; f.current.metadata.run_status = 'cancelled';
  assert.equal(await f.log.appendStreamEvent(f.row, { type: 'done', data: {} }, { allow_terminal: true }), null);
  const cancelled = structuredClone(f.current); cancelled.metadata.lease_token = null; f.current.metadata.lease_token = null;
  assert.equal((await f.log.appendStreamEvent(cancelled, { type: 'done', data: { status: 'cancelled' } }, { allow_terminal: true })).seq, 3);
  await assert.rejects(f.log.listStreamEvents(f.row, 4), error => error.statusCode === 409);
});

test('transcript budgets emit one visible limit marker without blocking final outcome events', async () => {
  const f = fixture(); f.current.metadata.quality_event_text_bytes = MAX_TEXT_BYTES;
  const marker = await f.log.appendStreamEvent(f.row, { type: 'text', data: { text: 'over budget' } });
  assert.equal(marker.type, 'progress'); assert.equal(marker.data.phase, 'stream_limit');
  assert.deepEqual(await f.log.appendStreamEvent(f.row, { type: 'text', data: { text: 'more' } }), { skipped: true, limited: true });
  f.current.status = 'completed'; f.current.metadata.run_status = 'completed'; f.current.metadata.lease_token = null;
  const final = await f.log.appendStreamEvent(structuredClone(f.current), { type: 'done', data: { status: 'completed' } }, { allow_terminal: true });
  assert.equal(final.type, 'done'); assert.equal(final.seq, 2);
});
