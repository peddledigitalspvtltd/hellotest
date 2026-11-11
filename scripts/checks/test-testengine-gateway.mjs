import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run after `npm --prefix testengine/backend run build`. These are disposable
// workers and a real HAProxy; no application API, database or browser is used.
const root = fileURLToPath(new URL('../..', import.meta.url));
const directory = mkdtempSync(resolve(tmpdir(), 'hellotest-engine-gateway-'));
const prefix = `hellotest-engine-gateway-${process.pid}`;
const network = `${prefix}-net`;
const containers = [];
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gatewayImage = process.env.TESTENGINE_GATEWAY_TEST_IMAGE || 'haproxy:2.9-alpine';
const workerImage = process.env.TESTENGINE_GATEWAY_WORKER_TEST_IMAGE || 'local-run-testengine-web-worker';
const config = resolve(root, 'local-run/testengine-gateway/haproxy.cfg');
const endpoint = '/api/v1/automation/playwright-mcp';
const secret = 'isolated-gateway-fixture-shared-secret-with-32-characters';
const headers = { 'x-hellotest-testengine-secret': secret, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const request = (origin, path, options = {}) => fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(8000) });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const baseUrl = name => {
  const ports = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', name));
  return `http://127.0.0.1:${ports['4301/tcp'][0].HostPort}`;
};
const eventually = async (description, check) => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* Container startup and health transitions are asynchronous. */ }
    await pause(250);
  }
  throw new Error(`Timed out: ${description}`);
};

try {
  docker('run', '--rm', '-v', `${config}:/gateway.cfg:ro`, '--entrypoint', 'haproxy', gatewayImage, '-c', '-f', '/gateway.cfg');
  docker('network', 'create', network);
  const fixture = resolve(directory, 'worker.mjs');
  writeFileSync(fixture, `
    import Fastify from 'fastify';
    import { registerTestEngineReadiness } from './dist/lib/testEngineReadiness.js';
    import { registerAutomationPlaywrightMcp } from './dist/lib/automationPlaywrightMcp.js';
    import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from './dist/lib/testEngineSecurity.js';
    const app=Fastify(), state={queueReady:true, shuttingDown:false, runtime:true};
    const sharedSecret=resolveTestEngineSharedSecret({NODE_ENV:'production',TESTENGINE_SHARED_SECRET:${JSON.stringify(secret)}});
    registerTestEngineReadiness(app,{sharedSecret,isShuttingDown:()=>state.shuttingDown,
      isTelemetryInitialized:()=>true,isRuntimeInitialized:()=>state.runtime&&app.hasDecorator('playwrightMcpRuntime'),
      getQueueHealth:()=>({ready:state.queueReady,status:state.queueReady?'ready':'degraded'}), serviceName:()=>process.env.FIXTURE_WORKER});
    await registerAutomationPlaywrightMcp(app,createPrivilegedRunGuard(sharedSecret),{validateTarget:async()=>({address:'127.0.0.1',port:80}),maxSessions:1});
    app.post('/fixture/state',async request=>Object.assign(state,request.body));
    await app.listen({port:4301,host:'0.0.0.0'});
    process.once('SIGTERM',()=>void app.close());
  `);
  const workers = [];
  for (const slot of ['a', 'b']) {
    const name = `${prefix}-worker-${slot}`;
    containers.push(name);
    docker('run', '-d', '--name', name, '--network', network, '--network-alias', 'testengine-web-worker',
      '-p', '127.0.0.1::4301', '-e', `FIXTURE_WORKER=${slot}`,
      '-v', `${resolve(root, 'testengine/backend/dist')}:/app/dist:ro`, '-v', `${fixture}:/app/worker.mjs:ro`,
      '--entrypoint', 'node', workerImage, '/app/worker.mjs');
    workers.push(baseUrl(name));
  }
  const gateway = `${prefix}-gateway`;
  containers.push(gateway);
  docker('run', '-d', '--name', gateway, '--network', network, '-p', '127.0.0.1::4301',
    '-v', `${config}:/usr/local/etc/haproxy/haproxy.cfg:ro`, gatewayImage);
  const origin = baseUrl(gateway);
  await eventually('queue backend readiness', async () => (await request(origin, '/health/ready')).status === 200);
  await eventually('browser transport backend readiness', async () => (await request(origin, '/health/transport')).status === 200);
  const initialized = await request(origin, endpoint, { method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'gateway-isolation-fixture', version: '1' },
      _meta: { hellotest: { start_url: 'https://example.test/' } }
    } }) });
  assert.equal(initialized.status, 200);
  assert.equal((await initialized.json()).result.protocolVersion, '2025-03-26');
  const session = initialized.headers.get('mcp-session-id');
  const cookie = initialized.headers.get('set-cookie')?.split(';')[0];
  assert.ok(session && cookie, 'MCP initialization must retain its worker affinity');
  const sessionHeaders = { ...headers, cookie, 'mcp-session-id': session };
  const call = (method, params = {}, id = 2) => request(origin, endpoint, { method: 'POST', headers: sessionHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params }) });
  assert.equal((await call('notifications/initialized', {}, null)).status, 202);
  for (const worker of workers) assert.equal((await request(worker, '/fixture/state', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queueReady: false })
  })).status, 200);
  await eventually('ordinary admission removed after queue failure', async () => (await request(origin, '/health/ready')).status === 503);
  assert.equal((await request(origin, '/health/transport')).status, 200);
  assert.equal((await call('ping')).status, 200);
  const listed = await call('tools/list');
  assert.equal(listed.status, 200);
  assert.ok((await listed.json()).result.tools.some(tool => tool.name === 'browser_click'));
  const denied = await request(origin, endpoint, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
  assert.equal(denied.status, 401);
  assert.equal((await request(origin, endpoint, { method: 'DELETE', headers: sessionHeaders })).status, 204);
  assert.equal((await call('ping')).status, 404, 'DELETE must reach the original worker and close the original session');
  for (const worker of workers) await request(worker, '/fixture/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runtime: false }) });
  await eventually('transport withdrawn after runtime failure', async () => (await request(origin, '/health/transport')).status === 503);
  console.log('PASS: real HAProxy validates; queue outage blocks job admission while native MCP session affinity, calls, authentication and DELETE remain intact; runtime failure withdraws transport.');
} finally {
  for (const name of containers.reverse()) { try { docker('rm', '-f', name); } catch {} }
  try { docker('network', 'rm', network); } catch {}
  rmSync(directory, { recursive: true, force: true });
}
