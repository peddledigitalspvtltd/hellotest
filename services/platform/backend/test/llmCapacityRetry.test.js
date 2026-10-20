const test = require('node:test');
const assert = require('node:assert/strict');
const { createLlmProviderError } = require('../src/utils/upstreamLlmError');
const { retryLlmCapacity, readLlmRetryAfterMs, isLlmCapacityError, durationMs } = require('../src/utils/llmCapacityRetry');

const capacity = (delay = 1) => createLlmProviderError({ status: 429, detail: 'Rate limit reached on tokens per minute (TPM): Limit 8000, Used 6511, Requested 7623. Please try again in 46.005s.', retryAfterMs: delay });

test('provider retry hints preserve explicit seconds, dates and fractional reset durations', () => {
  const now = Date.UTC(2026, 9, 18, 12);
  assert.equal(readLlmRetryAfterMs({ headers: new Headers({ 'retry-after': '46.005' }), now }), 46005);
  assert.equal(readLlmRetryAfterMs({ headers: { 'Retry-After': new Date(now + 3000).toUTCString() }, now }), 3000);
  assert.equal(readLlmRetryAfterMs({ headers: new Headers({ 'retry-after': '-1' }), now }), null);
  assert.equal(readLlmRetryAfterMs({ headers: new Headers({ 'retry-after': '0' }), now }), 0);
  assert.equal(durationMs('2m59.56s'), 179560); assert.equal(durationMs('1h 2m 3s'), 3723000); assert.equal(durationMs('15ms'), 15);
  for (const text of ['garbage46s', '-1s', '1e3s', 'NaN', '']) assert.equal(durationMs(text), null);
  assert.equal(readLlmRetryAfterMs({ headers: { 'x-ratelimit-reset-tokens': '7.66s', 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-requests': '1d', 'x-ratelimit-remaining-requests': '99' } }), 7660);
  assert.equal(readLlmRetryAfterMs({ headers: { 'x-ratelimit-reset-tokens': '7.66s', 'x-ratelimit-remaining-tokens': '1' } }), null);
  assert.equal(readLlmRetryAfterMs({ detail: 'Please try again in 46.005s.' }), 46005);
  assert.equal(readLlmRetryAfterMs({ detail: 'Please try again in 46.005s.', headers: { 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '1d' } }), 86400000);
});

test('all valid provider minima are combined without letting rounded headers shorten fractional waits',()=>{
 const now=Date.UTC(2026,9,18,12);
 assert.equal(readLlmRetryAfterMs({headers:{'retry-after':'1'},detail:'Please try again in 1.185s.'}),1185);
 assert.equal(readLlmRetryAfterMs({headers:{'retry-after':'17'},detail:'Please try again in 16.44s.'}),17000);
 assert.equal(readLlmRetryAfterMs({headers:{'retry-after':'0.5'},detail:'Please try again in 899.999999ms.'}),900);
 assert.equal(readLlmRetryAfterMs({headers:{'retry-after':'1','x-ratelimit-remaining-tokens':'0','x-ratelimit-reset-tokens':'2.125s'},detail:'Please try again in 1.185s.'}),2125);
 assert.equal(readLlmRetryAfterMs({headers:{'retry-after':new Date(now+1000).toUTCString()},detail:'Retry after 1.185s.',now}),1185);
 for(const invalid of ['invalid','-1','Infinity'])assert.equal(readLlmRetryAfterMs({headers:{'retry-after':invalid},detail:'Please try again in 1.185s.'}),1185);
 assert.equal(readLlmRetryAfterMs({headers:{'retry-after':'1','x-ratelimit-remaining-requests':'99','x-ratelimit-reset-requests':'1d'},detail:'Please try again in 1.185s.'}),1185);
 assert.equal(readLlmRetryAfterMs({headers:{'retry-after':'1','x-ratelimit-remaining-requests':'0','x-ratelimit-reset-requests':'1d'},detail:'Please try again in 1.185s.'}),86400000);
 assert.equal(readLlmRetryAfterMs({detail:'Retry in 0.5s. Please try again in 1.185s.'}),1185);
});

test('transient minute limits, oversized requests and exhausted billing/daily quota remain distinct', () => {
  const short = capacity(); assert.equal(short.code, 'LLM_RATE_LIMITED'); assert.equal(short.providerRejected, true); assert.equal(short.retryable, true);
  for (const detail of ['{"error":{"code":"insufficient_quota"}}', 'billing_hard_limit_reached', 'Limit reached on tokens per day (TPD)', 'credits exhausted']) {
    const error = createLlmProviderError({ status: 429, detail, headers: { 'retry-after': '1' } });
    assert.equal(error.code, 'LLM_QUOTA_EXCEEDED'); assert.equal(error.nonRetryable, true); assert.equal(isLlmCapacityError(error), false);
  }
  for (const detail of ['Rate limit reached on tokens per minute (TPM): Limit 8,000, Requested 8,100', 'Request too large for this model']) {
    const error = createLlmProviderError({ status: 429, detail });
    assert.equal(error.code, 'LLM_RATE_LIMIT_REQUEST_TOO_LARGE'); assert.equal(error.nonRetryable, true);
  }
  for (const status of [401, 403, 413, 429]) {
    const error = createLlmProviderError({ status, detail: 'organization secret-org Bearer private-provider-key' });
    assert.doesNotMatch(error.message, /secret-org|private-provider-key/);
    if ([401, 403].includes(status)) { assert.equal(error.code, 'LLM_AUTHENTICATION_FAILED'); assert.equal(error.nonRetryable, true); assert.equal(error.retryable, false); assert.equal(error.upstreamStatusCode, status); assert.equal(error.statusCode, 502); }
    if (status === 413) { assert.equal(error.code, 'LLM_REQUEST_TOO_LARGE'); assert.equal(error.nonRetryable, true); assert.equal(error.retryable, false); assert.equal(error.upstreamStatusCode, 413); assert.doesNotMatch(error.message, /TPM|context/i); }
  }
  assert.equal(isLlmCapacityError({ message: 'token limit reached', statusCode: 502 }), false);
});

test('only rejected provider requests retry while retaining the same caller browser state', async () => {
  let calls = 0; const state = { browser_operations: 3, input: 'frozen-data' }, waits = [];
  const result = await retryLlmCapacity(async ({ attempt, timeoutMs }) => {
    calls++; assert.equal(attempt, calls); assert.ok(timeoutMs <= 5000 && timeoutMs > 1000); assert.equal(state.browser_operations, 3);
    if (calls < 3) throw capacity(); return { next_action: 'assert', state };
  }, { timeoutMs: 5000, onWait: event => waits.push(event) });
  assert.equal(calls, 3); assert.equal(waits.length, 2); assert.equal(result.state, state); assert.equal(state.browser_operations, 3);
  assert.deepEqual(waits.map(row => row.attempt), [2, 3]);
  assert.deepEqual(waits.map(row=>row.delay_ms),[1001,1001]);
  assert.deepEqual(waits.map(row=>row.provider_minimum_delay_ms),[1,1]);
});

const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('the complete padded wait elapses before retry under the unchanged original deadline',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
 let calls=0;const waits=[],timeouts=[];
 const pending=retryLlmCapacity(async({timeoutMs})=>{calls++;timeouts.push(timeoutMs);if(calls===1)throw capacity(1185);return 'accepted';},
  {timeoutMs:5000,onWait:event=>waits.push(event)});
 await flush();assert.equal(calls,1);assert.equal(waits[0].delay_ms,2185);assert.equal(waits[0].provider_minimum_delay_ms,1185);
 t.mock.timers.tick(2184);await flush();assert.equal(calls,1);
 t.mock.timers.tick(1);assert.equal(await pending,'accepted');
 assert.deepEqual(timeouts,[5000,2815]);assert.equal(calls,2);
});

test('padded waits cannot exceed the original deadline and callback time is charged to it',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
 const error=capacity(1000);let calls=0,waits=0;
 await assert.rejects(retryLlmCapacity(async()=>{calls++;throw error;},{timeoutMs:2500,onWait:()=>{waits++;}}),value=>value===error);
 assert.equal(calls,1);assert.equal(waits,0,'a raw hint that fits cannot bypass the full padded wait and dispatch reserve');
 calls=0;
 await assert.rejects(retryLlmCapacity(async()=>{calls++;throw error;},{timeoutMs:4000,onWait:()=>{waits++;t.mock.timers.tick(1500);}}),value=>value===error);
 assert.equal(calls,1);assert.equal(waits,1,'time spent publishing wait progress cannot extend the deadline');
});

test('near-cap padding honors the provider minimum while longer waits remain ineligible',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
 let calls=0;const waits=[];
 const pending=retryLlmCapacity(async()=>{if(++calls===1)throw capacity(59500);return 'accepted';},{onWait:event=>waits.push(event)});
 await flush();assert.equal(waits[0].provider_minimum_delay_ms,59500);assert.equal(waits[0].delay_ms,60000);
 t.mock.timers.tick(59999);await flush();assert.equal(calls,1);
 t.mock.timers.tick(1);assert.equal(await pending,'accepted');assert.equal(calls,2);
 for(const minimum of [60001,86400000]){
  let rejectedCalls=0;const error=capacity(minimum);
  await assert.rejects(retryLlmCapacity(async()=>{rejectedCalls++;throw error;},{onWait:()=>assert.fail('long provider waits must not be shortened')}),value=>value===error);
  assert.equal(rejectedCalls,1);
 }
});

test('abort during the padded portion cancels promptly without dispatching another request',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
 const controller=new AbortController(),reason=Object.assign(new Error('lease lost'),{code:'BATCH_JOB_LEASE_LOST'});let calls=0;
 const pending=retryLlmCapacity(async()=>{calls++;throw capacity(900);},{timeoutMs:5000,signal:controller.signal});
 const rejected=assert.rejects(pending,error=>error===reason);
 await flush();t.mock.timers.tick(901);await flush();assert.equal(calls,1);
 controller.abort(reason);await rejected;t.mock.timers.tick(10000);await flush();assert.equal(calls,1);
});

test('unknown outcomes, successful output, missing hints, oversized requests and quota are never retried', async () => {
  const errors = [new Error('Unknown transport acknowledgement'), Object.assign(new Error('timeout'), { code: 'DEPENDENCY_TIMEOUT', statusCode: 504 }),
    createLlmProviderError({ status: 401, retryAfterMs: 1 }), createLlmProviderError({ status: 403, retryAfterMs: 1 }),
    createLlmProviderError({ status: 413, detail: 'The request size is over the provider allowance', retryAfterMs: 1 }),
    createLlmProviderError({ status: 429, detail: 'insufficient_quota', retryAfterMs: 1 }),
    createLlmProviderError({ status: 429, detail: 'Request too large', retryAfterMs: 1 }),
    createLlmProviderError({ status: 429, detail: 'Rate limit' }), capacity(61000), capacity(3000)];
  for (const error of errors) {
    let calls = 0; await assert.rejects(retryLlmCapacity(async () => { calls++; throw error; }, { timeoutMs: 2000 }), value => value === error); assert.equal(calls, 1);
  }
  let calls = 0; assert.equal(await retryLlmCapacity(async () => { calls++; return 'completed'; }), 'completed'); assert.equal(calls, 1);
});

test('capacity waiting is cancelled promptly under the original signal and cannot exceed its attempt cap', async () => {
  const controller = new AbortController(), reason = Object.assign(new Error('lease lost'), { code: 'BATCH_JOB_LEASE_LOST' });
  let calls = 0;
  const pending = retryLlmCapacity(async () => { calls++; throw capacity(1000); }, { timeoutMs: 5000, signal: controller.signal, onWait: () => controller.abort(reason) });
  await assert.rejects(pending, error => error === reason); assert.equal(calls, 1);
  calls = 0; await assert.rejects(retryLlmCapacity(async () => { calls++; throw capacity(); }, { timeoutMs: 5000, maxAttempts: 99 }), { code: 'LLM_RATE_LIMITED' }); assert.equal(calls, 3);
});
