const assert = require('node:assert/strict');
const test = require('node:test');
const integrations = require('../../../integration/backend/services/integration.service');
const { resetServiceResilienceState } = require('../src/utils/resilientHttpClient');
const { normalizeGithubSource, downloadGithubSource, MAX_ARCHIVE_BYTES, DOWNLOAD_BUDGET_MS } = require('../../../agentic/backend/agents/repositorySource');

const sha = 'a'.repeat(40);
const token = 'private-repository-token';
const source = { type: 'github', repository_url: 'https://github.com/acme/repository', ref: 'release/one' };
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
const commit = () => new Response(sha, { headers: { 'content-type': 'application/vnd.github.sha' } });
const redirect = (location = `https://codeload.github.com/acme/repository/legacy.zip/${sha}`) => new Response(null, { status: 302, headers: { location } });
const archive = () => new Response(zip, { headers: { 'content-type': 'application/zip' } });
const profile = (patch = {}) => ({ type: 'github', base_url: 'https://api.github.com', api_key: token, config: { project_id: 'project-a', owner: 'acme', repo: 'repository' }, ...patch });

function network(t, responses) {
  resetServiceResilienceState();
  const calls = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    calls.push({ url, ...init });
    const next = responses.shift();
    assert.ok(next, 'Unexpected outbound request');
    return typeof next === 'function' ? next(url, init) : next;
  });
  return calls;
}

test('normalizes repository URL and ignores arbitrary credential/source fields', () => {
  assert.deepEqual(normalizeGithubSource({ ...source, repository_url: 'https://github.com/Acme/Repository.git/', api_key: token, target: 'https://outside.example' }), {
    type: 'github', name: 'Acme/Repository', repository_url: 'https://github.com/Acme/Repository', owner: 'Acme', repo: 'Repository', ref: 'release/one'
  });
});

test('rejects foreign hosts, credentials, traversal, encoded paths and non-repository URLs before fetching', async t => {
  const calls = network(t, []);
  for (const repository_url of [
    'http://github.com/acme/repository', 'https://github.com.evil.test/acme/repository', 'https://api.github.com/acme/repository',
    'https://token@github.com/acme/repository', 'https://github.com:8443/acme/repository', 'https://github.com/acme/repository?token=secret',
    'https://github.com/acme/repository#main', 'https://github.com/acme/repository/tree/main', 'https://github.com/acme/../repository',
    'https://github.com/acme/%2e%2e', 'https://github.com\\outside.example/acme/repository', 'https://github.com/acme/repository\n',
    'file:///tmp/source.zip', 'https://127.0.0.1/acme/repository'
  ]) await assert.rejects(downloadGithubSource({ ...source, repository_url }), { statusCode: 400 });
  assert.equal(calls.length, 0);
});

test('rejects unsafe or invalid revisions without silently trimming or rewriting them', () => {
  for (const ref of ['../main', 'main?token=secret', 'main%2Fother', 'main\\other', ' main', 'main ', 'main\n', 'refs//main', '.hidden', 'main.lock', 'main@{1}', 'main~1', '@', 'x'.repeat(256), {}, 12]) {
    assert.throws(() => normalizeGithubSource({ ...source, ref }), { statusCode: 400 });
  }
  for (const ref of ['main', 'release/1.2', 'v1.0.0', sha, 'refs/heads/main']) assert.equal(normalizeGithubSource({ ...source, ref }).ref, ref);
});

test('public repository resolves its default branch and pins a bounded anonymous ZIP download', async t => {
  const calls = network(t, [json({ full_name: 'acme/repository', default_branch: 'main' }), commit(), redirect(), archive()]);
  const result = await downloadGithubSource({ ...source, ref: undefined });
  assert.deepEqual(result, { buffer: zip, source: { type: 'github', name: 'acme/repository', repository_url: source.repository_url, ref: 'main', commit_sha: sha } });
  assert.equal(calls.length, 4);
  assert.equal(calls[1].headers.Accept, 'application/vnd.github.sha');
  assert.ok(calls[1].url.endsWith('/commits/main'));
  assert.ok(calls[2].url.endsWith(`/zipball/${sha}`));
  assert.ok(calls.every(call => call.method === 'GET' && call.redirect === 'manual' && call.signal && !call.headers.Authorization));
});

test('private repository uses only its matching project profile and drops credentials on signed redirect', async t => {
  const signed = `https://codeload.github.com/acme/repository/legacy.zip/${sha}?token=short-lived-secret`;
  t.mock.method(integrations, 'getIntegration', async id => { assert.equal(id, 'saved'); return profile(); });
  const calls = network(t, [commit(), redirect(signed), archive()]);
  const result = await downloadGithubSource({ ...source, integration_id: 'saved' }, { projectId: 'project-a' });
  assert.equal(calls[0].url, 'https://api.github.com/repos/acme/repository/commits/release%2Fone');
  assert.equal(calls[0].headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[1].headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[2].url, signed);
  assert.deepEqual(Object.keys(calls[2].headers).sort(), ['Accept', 'User-Agent']);
  assert.ok(!JSON.stringify(result.source).includes(token) && !JSON.stringify(result.source).includes('short-lived-secret'));
  assert.equal(result.source.integration_id, undefined);
});

test('credentials cannot be redirected to a foreign project, repository, API host or global profile', async t => {
  const cases = [
    profile({ type: 'llm' }), profile({ config: { project_id: 'other-project', owner: 'acme', repo: 'repository' } }),
    profile({ config: { owner: 'acme', repo: 'repository' } }), profile({ config: { project_id: 'project-a', owner: 'other', repo: 'repository' } }),
    profile({ config: { project_id: 'project-a', owner: 'acme', repo: 'other' } }), profile({ base_url: 'https://github.enterprise.example/api/v3' }),
    profile({ base_url: 'https://api.github.com/other' }), profile({ base_url: 'https://api.github.com?token=unsafe' }),
    profile({ api_key: '********' }), profile({ api_key: 'Bearer secret\r\nInjected: yes' })
  ];
  const calls = network(t, []);
  for (const stored of cases) {
    t.mock.method(integrations, 'getIntegration', async () => stored);
    await assert.rejects(downloadGithubSource({ ...source, integration_id: 'saved' }, { projectId: 'project-a' }), error => error.statusCode === 400 || error.statusCode === 403);
  }
  assert.equal(calls.length, 0);
});

test('a saved profile requires project scope before reading credentials', async t => {
  t.mock.method(integrations, 'getIntegration', async () => assert.fail('Do not load unscoped credentials'));
  await assert.rejects(downloadGithubSource({ ...source, integration_id: 'saved' }), { statusCode: 403 });
});

test('missing profile errors do not expose underlying database details', async t => {
  t.mock.method(integrations, 'getIntegration', async () => { throw new Error(`Database error ${token}`); });
  await assert.rejects(downloadGithubSource({ ...source, integration_id: 'saved' }, { projectId: 'project-a' }), error => error.statusCode === 403 && !error.message.includes(token));
});

test('archive redirects reject foreign hosts, embedded credentials, wrong repository and wrong revision', async t => {
  for (const location of [
    `http://codeload.github.com/acme/repository/legacy.zip/${sha}`, `https://codeload.github.com.evil.test/acme/repository/legacy.zip/${sha}`,
    `https://user:pass@codeload.github.com/acme/repository/legacy.zip/${sha}`, `https://codeload.github.com:8443/acme/repository/legacy.zip/${sha}`,
    `https://codeload.github.com/other/repository/legacy.zip/${sha}`, `https://codeload.github.com/acme/repository/legacy.zip/${'b'.repeat(40)}`,
    `https://codeload.github.com/acme/repository/legacy.zip/${sha}#fragment`, 'https://127.0.0.1/private', '/archive.zip'
  ]) {
    const calls = network(t, [commit(), redirect(location)]);
    await assert.rejects(downloadGithubSource(source), { statusCode: 502 });
    assert.equal(calls.length, 2);
  }
});

test('does not follow metadata redirects or more than one archive redirect', async t => {
  let calls = network(t, [redirect('https://outside.example')]);
  await assert.rejects(downloadGithubSource({ ...source, ref: undefined }), { statusCode: 422 });
  assert.equal(calls.length, 1);
  calls = network(t, [commit(), redirect(), redirect('https://outside.example')]);
  await assert.rejects(downloadGithubSource(source), { statusCode: 422 });
  assert.equal(calls.length, 3);
});

for (const [status, expected] of [[401, /access token/], [403, /Contents read/], [404, /revision/], [409, /no readable commit/], [422, /existing branch/]]) {
  test(`GitHub ${status} is actionable, redacted and never retried as a transient failure`, async t => {
    const calls = network(t, [json({ message: token }, status)]);
    await assert.rejects(downloadGithubSource(source), error => error.statusCode === 422 && expected.test(error.message) && !error.message.includes(token));
    assert.equal(calls.length, 1);
  });
}

test('distinguishes exhausted GitHub rate allowance from permission failure without retrying 403', async t => {
  const calls = network(t, [json({}, 403, { 'x-ratelimit-remaining': '0' })]);
  await assert.rejects(downloadGithubSource(source), { statusCode: 429, code: 'REPOSITORY_SOURCE_RATE_LIMIT' });
  assert.equal(calls.length, 1);
});

test('retries a transient GET once and retains the pinned commit', async t => {
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive));
  const calls = network(t, [json({}, 503, { 'retry-after': '0' }), commit(), redirect(), archive()]);
  const result = await downloadGithubSource(source);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, calls[1].url);
  assert.equal(result.source.commit_sha, sha);
});

test('exhausted transient status uses at most two attempts and does not expose provider bodies', async t => {
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive));
  const calls = network(t, [json({ message: token }, 503, { 'retry-after': '0' }), json({ message: token }, 503)]);
  await assert.rejects(downloadGithubSource(source), error => error.statusCode === 502 && !error.message.includes(token));
  assert.equal(calls.length, 2);
});

test('rejects an incorrect commit identity, malformed SHA response and non-ZIP archive', async t => {
  let calls = network(t, [new Response('b'.repeat(40))]);
  await assert.rejects(downloadGithubSource({ ...source, ref: sha }), /different commit/);
  assert.equal(calls.length, 1);
  calls = network(t, [json({ sha })]);
  await assert.rejects(downloadGithubSource(source), /valid commit identity/);
  assert.equal(calls.length, 1);
  network(t, [commit(), new Response('<html>Sign in</html>')]);
  await assert.rejects(downloadGithubSource(source), /invalid ZIP/);
});

test('rejects a changed default-branch repository identity and malformed metadata', async t => {
  for (const response of [json({ full_name: 'other/repository', default_branch: 'main' }), json({ full_name: 'acme/repository', default_branch: '../private' }), new Response('invalid JSON')]) {
    const calls = network(t, [response]);
    await assert.rejects(downloadGithubSource({ ...source, ref: undefined }));
    assert.equal(calls.length, 1);
  }
});

test('rejects an oversized declared archive and cancels its stream before reading', async t => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const calls = network(t, [commit(), new Response(body, { headers: { 'content-length': String(MAX_ARCHIVE_BYTES + 1) } })]);
  await assert.rejects(downloadGithubSource(source), { statusCode: 413, code: 'REPOSITORY_SOURCE_TOO_LARGE' });
  assert.equal(cancelled, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].signal.aborted, true);
});

test('enforces archive limit during chunked streaming and cancels unread bytes', async t => {
  let sent = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { sent++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; }
  });
  const calls = network(t, [commit(), new Response(body)]);
  await assert.rejects(downloadGithubSource(source), { statusCode: 413 });
  assert.equal(cancelled, true);
  assert.ok(sent <= Math.ceil(MAX_ARCHIVE_BYTES / (1024 * 1024)) + 2, `Only bounded chunks should be requested: ${sent}`);
  assert.equal(calls.length, 2);
});

test('pre-cancelled acquisition never reads saved credentials or calls GitHub', async t => {
  const controller = new AbortController(); controller.abort(new Error(token));
  const calls = network(t, []);
  t.mock.method(integrations, 'getIntegration', async () => assert.fail('No credential lookup after cancellation'));
  await assert.rejects(downloadGithubSource({ ...source, integration_id: 'saved' }, { signal: controller.signal, projectId: 'project-a' }), error => error.statusCode === 499 && !error.message.includes(token));
  assert.equal(calls.length, 0);
});

test('cancellation aborts an in-flight HTTP request without retrying', async t => {
  const controller = new AbortController();
  const calls = network(t, [(_url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    queueMicrotask(() => controller.abort());
  })]);
  await assert.rejects(downloadGithubSource(source, { signal: controller.signal }), { statusCode: 499 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true);
});

test('cancellation also aborts archive streaming after HTTP headers arrive', async t => {
  const controller = new AbortController();
  const calls = network(t, [commit(), (_url, init) => new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(zip);
      init.signal.addEventListener('abort', () => stream.error(new DOMException('Cancelled', 'AbortError')), { once: true });
      queueMicrotask(() => controller.abort());
    }
  }))]);
  await assert.rejects(downloadGithubSource(source, { signal: controller.signal }), { statusCode: 499 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].signal.aborted, true);
});

test('cancellation releases a pending profile lookup and never uses its eventual token', async t => {
  const controller = new AbortController();
  let resolveProfile;
  t.mock.method(integrations, 'getIntegration', () => new Promise(resolve => { resolveProfile = resolve; }));
  const calls = network(t, []);
  const pending = downloadGithubSource({ ...source, integration_id: 'saved' }, { projectId: 'project-a', signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { statusCode: 499 });
  resolveProfile(profile());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 0);
});

test('overall 60-second budget also bounds credential resolution', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.method(integrations, 'getIntegration', () => new Promise(() => {}));
  const calls = network(t, []);
  const pending = downloadGithubSource({ ...source, integration_id: 'saved' }, { projectId: 'project-a' });
  const rejected = assert.rejects(pending, { statusCode: 504, code: 'REPOSITORY_SOURCE_TIMEOUT' });
  t.mock.timers.tick(DOWNLOAD_BUDGET_MS);
  await rejected;
  assert.equal(calls.length, 0);
});
