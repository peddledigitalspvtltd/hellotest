import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const directory = mkdtempSync(resolve(tmpdir(), 'hellotest-gateway-'));
const prefix = `hellotest-gateway-check-${process.pid}`;
const network = `${prefix}-net`;
const containers = [];
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const request = (origin, path, options = {}) => fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(8000) });
async function expectImmediateProgress(origin, path) {
  const start = Date.now();
  const stream = await request(origin, path);
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /reading stories/);
  assert.ok(Date.now() - start < 1500, 'Progress must arrive before the final response');
  await reader.cancel();
}

try {
  docker('network', 'create', network);
  const backendScript = resolve(directory, 'backend.cjs');
  writeFileSync(backendScript, `require('node:http').createServer((req,res)=>{
    if(req.url==='/stream') {
      res.writeHead(200, {'content-type':'text/event-stream'});
      res.write('event: progress\\ndata: reading stories\\n\\n');
      setTimeout(()=>res.end('event: result\\ndata: complete\\n\\n'), 1800);
      return;
    }
    let body=''; req.on('data', chunk=>body+=chunk); req.on('end',()=>{
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({method:req.method,url:req.url,body,...(req.headers.cookie ? {cookie:req.headers.cookie} : {})}));
    });
  }).listen(3000, '0.0.0.0');`);
  for (const service of ['platform', 'manual', 'testing', 'knowledge', 'chatbot']) {
    const name = `${prefix}-${service}`;
    containers.push(name);
    docker('run', '-d', '--name', name, '--network', network, '--network-alias', `${service}-api`,
      ...(service === 'platform' ? ['--network-alias', 'api', '--network-alias', 'trace-api'] : []),
      '-v', `${backendScript}:/gateway-backend.cjs:ro`, '--entrypoint', 'node',
      process.env.GATEWAY_TEST_NODE_IMAGE || 'node:20-alpine', '/gateway-backend.cjs');
  }
  writeFileSync(resolve(directory, 'index.html'), '<h1>Gateway fixture</h1>');
  writeFileSync(resolve(directory, 'admin.html'), '<h1>Admin fixture</h1>');
  const gateway = `${prefix}-nginx`;
  containers.push(gateway);
  docker('run', '-d', '--name', gateway, '--network', network, '-p', '127.0.0.1::80', '-p', '127.0.0.1::81',
    '-v', `${resolve(root, 'services/platform/frontend/nginx.microservices.conf')}:/etc/nginx/conf.d/default.conf:ro`,
    '-v', `${resolve(root, 'services/platform/frontend/nginx.service-locations.conf')}:/etc/nginx/hellotest-service-locations.conf:ro`,
    '-v', `${directory}:/usr/share/nginx/html:ro`, '-v', `${directory}:/usr/share/nginx/admin:ro`,
    '--entrypoint', 'nginx', process.env.GATEWAY_TEST_NGINX_IMAGE || 'nginx:1.27-alpine', '-g', 'daemon off;');
  let ports = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', gateway));
  const base = port => `http://127.0.0.1:${ports[`${port}/tcp`][0].HostPort}`;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { if ((await request(base(80), '/services/manual/health')).ok) { ready = true; break; } } catch {}
    await pause(200);
  }
  assert.ok(ready, 'Gateway and manual upstream must start');
  for (const port of [80, 81]) {
    assert.equal((await request(base(port), '/')).status, 200);
    for (const path of ['/api/projects?project_id=a%20b', '/services/platform/projects?project_id=a%20b']) {
      const response = await request(base(port), path);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).url, '/projects?project_id=a%20b');
    }
    const dashboard = await request(base(port), '/api/ops-telemetry/grafana/api/user', { headers: { Cookie: 'hellotest_grafana=fixture-capability' } });
    assert.deepEqual(await dashboard.json(), { method: 'GET', url: '/ops-telemetry/grafana/api/user', body: '', cookie: 'hellotest_grafana=fixture-capability' });
    const response = await request(base(port), '/services/chatbot/knowledge/assistant/sessions/one', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"title":"Review"}'
    });
    assert.deepEqual(await response.json(), { method: 'PATCH', url: '/knowledge/assistant/sessions/one', body: '{"title":"Review"}' });
  }
  await expectImmediateProgress(base(80), '/services/chatbot/stream');
  docker('stop', '-t', '1', `${prefix}-chatbot`);
  const offline = await request(base(80), '/services/chatbot/knowledge');
  // Docker may reject the closed socket or let the bounded connect timeout expire.
  assert.ok([502, 504].includes(offline.status), 'An offline optional service must return a gateway error');
  assert.equal((await request(base(80), '/services/manual/requirements')).status, 200);
  assert.equal((await request(base(80), '/')).status, 200);
  assert.equal((await request(base(80), '/services/unknown/path')).status, 404);
  docker('stop', '-t', '1', `${prefix}-manual`);
  assert.equal((await request(base(80), '/api/auth/session')).status, 200, 'Platform identity survives a Manual outage');
  assert.equal((await request(base(80), '/services/testing/test-cases')).status, 200);
  assert.equal((await request(base(80), '/services/knowledge/knowledge/search')).status, 200, 'Knowledge survives a Chatbot outage');
  // Restart the UI while Chatbot is absent: no static DNS dependency may stop Nginx.
  docker('exec', gateway, 'nginx', '-t');
  docker('restart', gateway);
  // Docker may allocate different ephemeral host ports when a container restarts.
  ports = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', gateway));
  let restarted = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { if ((await request(base(80), '/')).status === 200) { restarted = true; break; } } catch {}
    await pause(200);
  }
  assert.ok(restarted, 'UI must restart even when optional services are absent');

  // Existing single-API deployments must deliver progress just as promptly.
  const monolithGateway = `${prefix}-monolith-nginx`;
  containers.push(monolithGateway);
  docker('run', '-d', '--name', monolithGateway, '--network', network, '-p', '127.0.0.1::80', '-p', '127.0.0.1::81',
    '-v', `${resolve(root, 'services/platform/frontend/nginx.conf')}:/etc/nginx/conf.d/default.conf:ro`,
    '-v', `${directory}:/usr/share/nginx/html:ro`, '-v', `${directory}:/usr/share/nginx/admin:ro`,
    '--entrypoint', 'nginx', process.env.GATEWAY_TEST_NGINX_IMAGE || 'nginx:1.27-alpine', '-g', 'daemon off;');
  let monolithPorts = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', monolithGateway));
  for (const port of [80, 81]) {
    const origin = `http://127.0.0.1:${monolithPorts[`${port}/tcp`][0].HostPort}`;
    let monolithReady = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { if ((await request(origin, '/api/health')).ok) { monolithReady = true; break; } } catch {}
      await pause(200);
    }
    assert.ok(monolithReady, 'Single-API gateway must start');
    await expectImmediateProgress(origin, '/api/stream');
    for (const path of ['/api?project_id=a%20b', '/api/projects?project_id=a%20b']) {
      const response = await request(origin, path, { method: 'PATCH', body: 'fixture-body' });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { method: 'PATCH', url: path.replace(/^\/api(?=\/|\?)/, path.startsWith('/api?') ? '/' : ''), body: 'fixture-body' });
    }
  }
  docker('rm', '-f', `${prefix}-platform`);
  docker('exec', monolithGateway, 'nginx', '-t');
  docker('restart', monolithGateway);
  monolithPorts = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', monolithGateway));
  for (const port of [80, 81]) {
    const origin = `http://127.0.0.1:${monolithPorts[`${port}/tcp`][0].HostPort}`;
    let shellReady = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { if ((await request(origin, '/')).status === 200) { shellReady = true; break; } } catch {}
      await pause(200);
    }
    assert.ok(shellReady, 'Both UI listeners must restart with no API DNS record');
    assert.ok([502, 504].includes((await request(origin, '/api/health')).status));
    assert.equal((await request(origin, '/')).status, 200);
  }
  console.log('PASS: both UI listeners, profile routing, PATCH/body/query forwarding, unbuffered progress in both deployment modes, and unavailable-service isolation');
} finally {
  for (const name of containers.reverse()) {
    try { docker('rm', '-f', name); } catch {}
  }
  try { docker('network', 'rm', network); } catch {}
  rmSync(directory, { recursive: true, force: true });
}
