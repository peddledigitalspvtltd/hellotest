// Consume `docker compose -f docker-compose.microservices.yml config --format json`.
// Validate resolved values without printing credentials or requiring live services.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { services } = JSON.parse(input);
const catalog = JSON.parse(await readFile(new URL('../../services/catalog.json', import.meta.url), 'utf8'));
const profiles = catalog.services.map(service => service.profile).filter(Boolean);
const migration = services['schema-migrate'];
assert.deepEqual(migration.command, ['node', 'src/migrate.js']);
assert.equal(migration.restart, 'no');
assert.ok(!migration.depends_on?.['schema-migrate']);
const engine = services['testengine-backend'];
assert.ok(engine, 'TestEngine worker must exist');
assert.ok(engine.networks.default.aliases.includes('testengine'), 'TestEngine discovery alias must match API integration fallback');
const engineSecret = engine.environment.TESTENGINE_SHARED_SECRET;
assert.ok(engineSecret, 'TestEngine must receive its shared secret');
const urls = JSON.parse(services.frontend.environment.HELLOTEST_SERVICE_URLS);
assert.ok(urls && !Array.isArray(urls) && typeof urls === 'object', 'Frontend service map must be an object');
assert.ok(Object.values(urls).every(url => typeof url === 'string'), 'Frontend service URLs must be strings');
assert.equal(Object.keys(services.frontend.depends_on || {}).length, 0, 'UI startup must not depend on optional APIs');
for (const profile of profiles) {
  const api = services[`${profile}-api`];
  assert.ok(api, `Missing ${profile} API`);
  assert.equal(api.environment.HELLOTEST_SCHEMA_MODE, 'verify');
  assert.equal(api.depends_on['schema-migrate'].condition, 'service_completed_successfully');
  assert.equal(api.environment.HELLOTEST_SERVICE_PROFILE, profile, `${profile} API must use its declared profile`);
  assert.ok(api.environment.TESTENGINE_SHARED_SECRET === engineSecret, `${profile} TestEngine authentication must agree`);
  assert.equal(api.environment.MINIO_ACCESS_KEY, services.minio.environment.MINIO_ROOT_USER, `${profile} storage user must agree`);
  assert.ok(api.environment.MINIO_SECRET_KEY === services.minio.environment.MINIO_ROOT_PASSWORD, `${profile} storage credential must agree`);
  assert.ok(api.environment.KNOWLEDGE_TIKA_URL, `${profile} must use the supported Tika configuration key`);
  assert.ok(api.environment.SESSION_SECRET, `${profile} must receive a session secret`);
  assert.ok(api.environment.SESSION_SECRET === services['manual-api'].environment.SESSION_SECRET, 'Profiles must share session verification');
  assert.match(JSON.stringify(api.healthcheck.test), /\/health\/ready/, `${profile} must use readiness for health`);
  const graceMs = [...api.healthcheck.start_period.matchAll(/([\d.]+)(ms|s|m|h)/g)]
    .reduce((total, [, value, unit]) => total + Number(value) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[unit]), 0);
  assert.ok(graceMs >= Number(api.environment.API_STARTUP_TIMEOUT_MS), `${profile} health grace must cover startup`);
  assert.ok(!Object.keys(api.depends_on || {}).some(name => profiles.some(owner => name === `${owner}-api`)), `${profile} startup must not depend on another API`);
}
for (const [name, service] of Object.entries(services)) {
  for (const port of service.ports || []) assert.equal(port.host_ip, '127.0.0.1', `${name} published ports must bind to loopback`);
}
console.log('PASS: microservices profiles, frontend map, independent API startup, readiness, storage and engine contracts');
