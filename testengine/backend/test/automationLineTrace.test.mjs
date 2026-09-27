import test from 'node:test';
import assert from 'node:assert/strict';
import { instrumentAutomationLines, createAutomationLineTracer } from '../dist/lib/automationLineTrace.js';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
test('line evidence follows executed awaits, loop iterations, nested calls and failures', async () => {
  const source = 'const label = "await ignored()";\nfor(let i=0;i<2;i++) await task(i);\nif(false) await task(99);\nawait task(await task(2));\nawait task(-1);\nawait task(100);';
  const results = [];
  const calls = [];
  const fn = new AsyncFunction('task', '__hellotestTrace', instrumentAutomationLines(source));
  await assert.rejects(fn(async value => { calls.push(value); if(value === -1) throw new Error('failure'); return value; }, createAutomationLineTracer(results, 2)), /failure/);
  assert.deepEqual(calls, [0,1,2,2,-1]);
  assert.deepEqual(results.map(({line,status,attempt}) => [line,status,attempt]), [[2,'passed',2],[2,'passed',2],[4,'passed',2],[4,'passed',2],[5,'failed',2]]);
});
test('line tracing preserves multiline object expressions, return values and rejection identity', async () => {
  const results = [];
  const fn = new AsyncFunction('__hellotestTrace', instrumentAutomationLines('return await Promise.resolve({\n a: 1, b: "}"\n});'));
  assert.deepEqual(await fn(createAutomationLineTracer(results, 1)), { a:1,b:'}' });
  assert.equal(results[0].line, 1);
});
test('anonymous reusable functions retain awaited line evidence', async () => {
  const results = [];
  const source = 'async function ({ task }) {\n return await task();\n}';
  const fn = new AsyncFunction('task', '__hellotestTrace', `return (${instrumentAutomationLines(source)})({task});`);
  assert.equal(await fn(async () => 'done', createAutomationLineTracer(results, 1)), 'done');
  assert.deepEqual(results.map(({line,status}) => [line,status]), [[2,'passed']]);
});
