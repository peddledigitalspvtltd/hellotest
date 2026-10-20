import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { compileRecordedProgram } from '../dist/lib/automationVerificationProgram.js';
import { runAutomationVerification, validateAutomationVerificationRequest, registerAutomationVerification } from '../dist/lib/automationVerification.js';
import { runAutomationVerificationCli } from '../dist/lib/automationVerificationCli.js';

const operation = (name, args) => ({ name, arguments: args });
function request(origin, operations, extra = {}) {
  return { schema_version: 1, verification_id: randomUUID(), lease_token: randomUUID(), start_url: `${origin}/form`,
    execution_driver: 'playwright_test_cli', parameters: { 'r.input': 'private fixture value " ; $(never-a-shell) @r.literal' },
    sections: [{ step_id: 'form', automation_code: compileRecordedProgram(operations).source, operations }],
    replay_policy: { mode: 'authorized_run', allow_mutations: true }, timeout_ms: 15_000, ...extra };
}

test('only the explicit native and Playwright Test CLI drivers are accepted', () => {
  const rows = [operation('browser_assert', { assertion: 'visible', locator: '#name' })];
  for (const execution_driver of [undefined, 'native', 'playwright_test_cli']) assert.doesNotThrow(() => validateAutomationVerificationRequest(request('https://fixture.test', rows, { execution_driver })));
  for (const execution_driver of ['cli', 'shell', 'mcp', {}, null]) assert.throws(() => validateAutomationVerificationRequest(request('https://fixture.test', rows, { execution_driver })), { code: 'AUTOMATION_VERIFICATION_CONTRACT_INVALID' });
});

test('real pinned Playwright Test CLI retains native closed-program, data, proxy and failure semantics', { timeout: 60_000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'qaira-cli-verification-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let submitted = 0, forbiddenRequests = 0, forms = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/private') { forbiddenRequests++; res.end('private'); return; }
    if (req.url === '/submit') { submitted++; res.end('ok'); return; }
    if (req.url === '/form') forms++;
    res.setHeader('content-type', 'text/html');
    res.end(`<label for="name">Name</label><input id="name" required><button id="save" onclick="fetch('/submit',{method:'POST'}).then(()=>document.querySelector('#result').textContent='Saved')">Save</button><p id="result">Ready</p><img src="http://127.0.0.2:${server.address().port}/private">`);
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://cli.fixture.test:${server.address().port}`;
  const previousAliases = process.env.RECORDER_TARGET_ORIGIN_ALIASES, previousHosts = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_TARGET_ORIGIN_ALIASES = JSON.stringify({ [origin]: `http://127.0.0.1:${server.address().port}` });
  delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  t.after(() => { if (previousAliases === undefined) delete process.env.RECORDER_TARGET_ORIGIN_ALIASES; else process.env.RECORDER_TARGET_ORIGIN_ALIASES = previousAliases; if (previousHosts === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previousHosts; });
  const options = { temporaryRoot: directory, artifactRoot: path.join(directory, 'artifacts') };
  const operations = [operation('browser_fill', { locator: '#name', value: '@r.input' }),
    operation('browser_assert', { assertion: 'value', locator: '#name', value: '@r.input' }),
    operation('browser_assert', { assertion: 'field_valid', locator: '#name' }),
    operation('browser_click', { locator: '#save' }),
    operation('browser_assert', { assertion: 'text', locator: '#result', value: 'Saved' }),
    operation('browser_assert', { assertion: 'url', value: `${origin}/form` })];
  const success = await runAutomationVerificationCli(request(origin, operations), options);
  assert.equal(success.status, 'passed', JSON.stringify(success));
  assert.equal(success.verification_status, 'verified'); assert.equal(success.execution_driver, 'playwright_test_cli');
  assert.equal(success.completed_operations, 6); assert.equal(success.completed_interactions, 2); assert.equal(success.assertion_count, 4);
  assert.equal(success.replay_safe, false); assert.equal(submitted, 1); assert.equal(forbiddenRequests, 0, 'CLI uses the same proxy; an unreviewed private resource cannot bypass it');
  assert.deepEqual(await readdir(directory), [], 'private input/source/reporter files are deleted after the CLI exits');

  const missing = [operation('browser_fill', { locator: '#missing', value: '@r.input' }), operation('browser_assert', { assertion: 'visible', locator: '#name' })];
  const cliFailure = await runAutomationVerificationCli(request(origin, missing), options);
  const nativeFailure = await runAutomationVerification(request(origin, missing, { execution_driver: 'native' }), options);
  for (const failure of [cliFailure, nativeFailure]) {
    assert.equal(failure.status, 'failed'); assert.equal(failure.verification_status, 'unverified'); assert.equal(failure.completed_operations, 0);
    assert.equal(failure.failure.code, 'AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED'); assert.equal(failure.failure.action_outcome, 'not_attempted');
    assert.ok(failure.snapshot.elements.some(element => element.locator_candidates?.includes('#name')));
  }
  assert.equal(submitted, 1, 'neither lane repeats a submission after a lookup failure');
  assert.ok((await readdir(directory)).every(name => name === 'artifacts'));

  const timed = await runAutomationVerificationCli(request(origin, [operation('browser_assert', { assertion: 'visible', locator: '#never' })], { timeout_ms: 100 }), options);
  assert.equal(timed.status, 'timed_out', JSON.stringify(timed)); assert.equal(timed.verification_status, 'unverified');
  assert.equal(timed.failure.action_outcome, 'not_attempted'); assert.equal(submitted, 1);
  assert.equal(forbiddenRequests, 0);

  const app = Fastify();
  await registerAutomationVerification(app, async (req, reply) => { if (req.headers.authorization !== 'host') return reply.code(401).send({ code: 'UNAUTHORIZED' }); }, { artifactRoot: options.artifactRoot });
  t.after(() => app.close());
  const endpointInput = request(origin, [operation('browser_assert', { assertion: 'text', locator: '#result', value: 'Ready' })]);
  const priorForms = forms;
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/automation/verify', payload: endpointInput })).statusCode, 401);
  assert.equal(forms, priorForms, 'denied CLI dispatch cannot launch a browser');
  const dispatch = () => app.inject({ method: 'POST', url: '/api/v1/automation/verify', headers: { authorization: 'host' }, payload: endpointInput });
  const first = await dispatch(), repeated = await dispatch();
  assert.equal(first.statusCode, 200); assert.equal(first.json().status, 'passed', first.body);
  assert.equal(first.json().execution_driver, 'playwright_test_cli'); assert.deepEqual(repeated.json(), first.json());
  assert.equal(forms, priorForms + 1, 'a repeated immutable CLI dispatch returns its cached receipt without replay');
  const conflict = structuredClone(endpointInput); conflict.parameters['r.input'] = 'changed';
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/automation/verify', headers: { authorization: 'host' }, payload: conflict })).statusCode, 409);
  assert.equal(forms, priorForms + 1); assert.equal(submitted, 1);
});

test('cancel before CLI startup has no browser interaction and invalid source never reaches a child', async () => {
  const controller = new AbortController(); controller.abort();
  const input = request('https://fixture.test', [operation('browser_assert', { assertion: 'visible', locator: '#name' })]);
  const result = await runAutomationVerificationCli(input, { signal: controller.signal });
  assert.equal(result.status, 'cancelled'); assert.equal(result.failure.action_outcome, 'not_attempted'); assert.equal(result.replay_safe, true);
  input.sections[0].automation_code += '; process.exit(0);';
  await assert.rejects(runAutomationVerificationCli(input), { code: 'AUTOMATION_VERIFICATION_CONTRACT_INVALID' });
});

test('cancelling a live CLI process keeps an uncertain interaction unknown and removes private files', { timeout: 20_000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'qaira-cli-cancel-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const controller = new AbortController();
  let submissions = 0, capturedPermissions;
  const server = http.createServer((req, res) => {
    if (req.url === '/submit') {
      submissions++;
      controller.abort(); // Browser has begun the interaction; no receipt exists.
      res.end('ok'); return;
    }
    res.setHeader('content-type', 'text/html');
    res.end('<button id="save" onclick="fetch(\'/submit\',{method:\'POST\'}).then(()=>document.body.innerHTML=\'<p id=result>Saved</p>\')">Save</button>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const previousHosts = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS, previousNodeOptions = process.env.NODE_OPTIONS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  process.env.NODE_OPTIONS = '--require /must-not-be-inherited-by-cli.cjs';
  t.after(() => { if (previousHosts === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previousHosts; if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previousNodeOptions; });
  const inspection = setInterval(async () => {
    const name = (await readdir(directory)).find(name => name.startsWith('hellotest-verification-cli-'));
    if (!name) return;
    try {
      capturedPermissions = { directory: (await stat(path.join(directory, name))).mode & 0o777, input: (await stat(path.join(directory, name, 'request.json'))).mode & 0o777 };
    } catch { /* Files may be cleaned up between stat calls. */ }
  }, 10); t.after(() => clearInterval(inspection));
  const input = request(origin, [operation('browser_click', { locator: '#save' }), operation('browser_assert', { assertion: 'text', locator: '#result', value: 'Saved' })]);
  const result = await runAutomationVerificationCli(input, { signal: controller.signal, temporaryRoot: directory });
  clearInterval(inspection);
  assert.equal(submissions, 1, 'the CLI starts despite a hostile inherited NODE_OPTIONS and never retries the interaction');
  assert.equal(result.status, 'unknown'); assert.equal(result.verification_status, 'unverified'); assert.equal(result.failure.action_outcome, 'unknown'); assert.equal(result.replay_safe, false);
  assert.deepEqual(capturedPermissions, { directory: 0o700, input: 0o600 });
  assert.deepEqual(await readdir(directory), []);
});
