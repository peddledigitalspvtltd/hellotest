import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 20000 }).trim();
const fetchWithDeadline = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(4000) });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const endpoints = {
  haproxy: [8404, '/health'], prometheus: [9090, '/-/ready'], grafana: [3000, '/api/health'],
  loki: [3100, '/ready'], jaeger: [16686, '/api/services'], alloy: [12345, '/-/ready'],
  'otel-collector': [13133, '/'], alertmanager: [9093, '/-/ready']
};
const origins = {};
for (const [name, [port]] of Object.entries(endpoints)) {
  const bindings = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', `hellotest-ops-${name}`));
  origins[name] = `http://127.0.0.1:${bindings[`${port}/tcp`][0].HostPort}`;
}
async function waitReady(name) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if ((await fetchWithDeadline(origins[name] + endpoints[name][1])).ok) return; } catch {}
    await pause(1000);
  }
  throw new Error(`${name} did not become ready`);
}
origins.grafana += '/api/ops-telemetry/grafana';
await Promise.all(Object.keys(endpoints).map(waitReady));
console.log('PASS: all eight ops services respond to readiness requests');
// Allow the first 30-second scrape after an application deployment.
let applicationScraped = false;
for (let attempt = 0; attempt < 45; attempt++) {
  const targets = await (await fetchWithDeadline(`${origins.prometheus}/api/v1/targets`)).json();
  applicationScraped = targets.data.activeTargets.some(target => target.labels.job === 'hellotest-api' && target.health === 'up');
  if (applicationScraped) break;
  await pause(2000);
}
assert.ok(applicationScraped, 'real application metrics must be scraped');
const managers = await (await fetchWithDeadline(`${origins.prometheus}/api/v1/alertmanagers`)).json();
assert.equal(managers.data.activeAlertmanagers.length, 1);
const directory = process.env.HELLOTEST_ENV_DIR || fileURLToPath(new URL('../../.hellotest', import.meta.url));
const config = readFileSync(resolve(directory, 'ops.env'), 'utf8');
const password = config.match(/^GRAFANA_ADMIN_PASSWORD=(.+)$/m)[1];
const username = config.match(/^GRAFANA_ADMIN_USER=(.+)$/m)?.[1] || 'admin';
const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
for (const id of ['prometheus', 'loki', 'jaeger']) {
  // Jaeger's frontend datasource uses Grafana's authenticated proxy rather
  // than the backend-plugin health RPC exposed by Prometheus and Loki.
  const route = id === 'jaeger' ? '/api/datasources/proxy/uid/jaeger/api/services' : `/api/datasources/uid/${id}/health`;
  const response = await fetchWithDeadline(`${origins.grafana}${route}`, { headers: { Authorization: auth } });
  assert.ok(response.ok, `Grafana ${id} datasource must be healthy`);
}
console.log('PASS: application scraping, alert routing, and all Grafana datasources');

const bindings = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', 'hellotest-ops-otel-collector'));
const otlp = `http://127.0.0.1:${bindings['4318/tcp'][0].HostPort}`;
const traceId = randomBytes(16).toString('hex');
const spanId = randomBytes(8).toString('hex');
const start = BigInt(Date.now()) * 1000000n;
const resource = { attributes: [{ key: 'service.name', value: { stringValue: 'hellotest-ops-verification' } }] };
const result = await fetchWithDeadline(`${otlp}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resourceSpans: [{ resource, scopeSpans: [{ spans: [{ traceId, spanId, name: 'ops-delivery-check', startTimeUnixNano: String(start), endTimeUnixNano: String(start + 1000000n), kind: 1 }] }] }] }) });
assert.ok(result.ok, 'Collector must accept a trace');
let delivered = false;
for (let attempt = 0; attempt < 30; attempt++) {
  const found = await fetchWithDeadline(`${origins.jaeger}/api/traces/${traceId}`);
  if (found.ok && (await found.json()).data?.length) { delivered = true; break; }
  await pause(1000);
}
assert.ok(delivered, 'Collector must deliver traces to Jaeger');
const labels = await (await fetchWithDeadline(`${origins.loki}/loki/api/v1/labels`)).json();
assert.ok(labels.data.includes('container'), 'Alloy must deliver container logs to Loki');
console.log('PASS: Collector → Jaeger trace delivery and Alloy → Loki container logs');

if (process.argv.includes('--faults')) {
  // Explicit opt-in: disrupt only this ops stack; never stop an app or database.
  for (const name of Object.keys(endpoints)) {
    docker('stop', '-t', '3', `hellotest-ops-${name}`);
    try {
      for (const url of ['http://127.0.0.1:3000/health/ready', 'http://127.0.0.1:8080/']) {
        assert.ok((await fetchWithDeadline(url)).ok, `Application remains available with ${name} stopped`);
      }
      for (const remaining of Object.keys(endpoints).filter(value => value !== name)) {
        assert.ok((await fetchWithDeadline(origins[remaining] + endpoints[remaining][1])).ok, `${remaining} remains ready with ${name} stopped`);
      }
      console.log(`PASS: application and other ops services remain available with ${name} stopped`);
    } finally {
      docker('start', `hellotest-ops-${name}`);
      await waitReady(name);
    }
  }
}
