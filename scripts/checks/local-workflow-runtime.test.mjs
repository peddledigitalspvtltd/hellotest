import test from 'node:test';
import assert from 'node:assert/strict';
import { main, runtimeComposeArgs, runtimeCommands } from '../dev/local-workflow-runtime.mjs';

test('local durable runtime uses the existing project and explicit local overlay without changing production defaults', () => {
  const args = runtimeComposeArgs({ root: '/repository', envFile: '/private/local.env', project: 'local-run', withOps: true });
  assert.deepEqual(args.slice(0, 5), ['compose', '--env-file', '/private/local.env', '--project-name', 'local-run']);
  assert.ok(args.includes('/repository/docker-compose.agentic-durable.yml'));
  assert.ok(args.includes('/repository/local-run/docker-compose.temporal-dev.yml'));
  assert.ok(args.includes('/repository/local-run/docker-compose.ops-network.yml'));
  assert.deepEqual(args.slice(-2), ['--profile', 'local-durable']);
  assert.throws(() => runtimeComposeArgs({ envFile: '/private/local.env', project: 'unsafe project' }));
});

test('preparation does not restart the app and stop preserves all app services and persistent volumes', () => {
  for (const buildWorker of [false, true]) {
    const operations = runtimeCommands('prepare', { buildWorker });
    assert.ok(operations.every(args => !['up', 'down', 'stop', 'restart'].includes(args[0])));
    assert.ok(operations.every(args => !args.includes('api') && !args.includes('frontend')));
  }
  assert.deepEqual(runtimeCommands('stop'), [['stop', 'agentic-durable', 'temporal-dev']]);
  assert.deepEqual(runtimeCommands('start').at(-1), ['up', '-d', '--no-build', 'api', 'temporal-dev', 'agentic-durable']);
  assert.throws(() => runtimeCommands('down'), /Usage/);
});

test('local overlay preserves existing development credential compatibility while production keeps strict secret validation', async () => {
  const { readFileSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { parse } = require('yaml');
  const overlay = parse(readFileSync(new URL('../../local-run/docker-compose.temporal-dev.yml', import.meta.url), 'utf8'));
  const production = parse(readFileSync(new URL('../../docker-compose.agentic-durable.yml', import.meta.url), 'utf8'));
  const local = overlay.services['agentic-durable'].environment;
  assert.equal(local.NODE_ENV, 'development'); assert.equal(local.APP_MODE, 'local');
  const api = parse(readFileSync(new URL('../../local-run/docker-compose.yml', import.meta.url), 'utf8')).services.api.environment;
  for (const key of ['TESTENGINE_SHARED_SECRET', 'HELLOTEST_TESTENGINE_SECRET', 'MOBILE_ENGINE_SHARED_SECRET', 'HELLOTEST_LOCAL_RUN_ENGINE_URL', 'HELLOTEST_LOCAL_CALLBACK_BASE_URL']) assert.equal(local[key], api[key], `${key} must match the API, not fall back to a different worker identity`);
  for (const key of ['TESTENGINE_SHARED_SECRET', 'HELLOTEST_TESTENGINE_SECRET', 'MOBILE_ENGINE_SHARED_SECRET']) assert.equal(production.services['agentic-durable'].environment[key], '${' + key + ':-}');
  assert.equal(Object.hasOwn(local, 'SESSION_SECRET'), false, 'The local overlay must retain the same existing API encryption key');
  assert.equal(Object.hasOwn(production.services['agentic-durable'].environment, 'NODE_ENV'), false);
  assert.match(readFileSync(new URL('../../services/agentic/Dockerfile.durable', import.meta.url), 'utf8'), /ENV NODE_ENV=production/);
  const { resolveSessionSecret } = require('../../services/platform/backend/src/security/runtimeSecrets');
  const originalMode = process.env.NODE_ENV, originalSecret = process.env.SESSION_SECRET;
  try {
    process.env.SESSION_SECRET = 'legacy-local-fixture'; process.env.NODE_ENV = local.NODE_ENV;
    assert.equal(resolveSessionSecret(), 'legacy-local-fixture');
    process.env.NODE_ENV = 'production'; assert.throws(resolveSessionSecret, /at least 32 characters/);
  } finally {
    if (originalMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalMode;
    if (originalSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = originalSecret;
  }
});


test('memory-limited local build executes API, frontend and durable images serially without starting app services', async t => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const folder = mkdtempSync(join(tmpdir(), 'local-workflow-build-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const envFile = join(folder, 'local.env');writeFileSync(envFile, '# local fixture; no private settings\n');
  const operations = [];
  const execute = (command, args, options) => {
    assert.equal(command, 'docker');
    if (args[0] === 'inspect') return { status: 0, stdout: args.includes('{{json .Config.Labels}}') ? '{"com.docker.compose.project":"local-run"}' : '{}' };
    assert.equal(args[0], 'compose');assert.equal(args[2], envFile);assert.equal(args[4], 'local-run');
    assert.ok(args.some(value => value.endsWith('/local-run/docker-compose.temporal-dev.yml')));
    assert.ok(args.some(value => value.endsWith('/local-run/docker-compose.ops-network.yml')));
    assert.equal(options.env.TEMPORAL_ADDRESS, 'temporal-dev:7233');
    const operation = args.slice(args.indexOf('local-durable') + 1);operations.push(operation);
    return { status: 0 };
  };
  assert.equal(main(['build', '--env-file', envFile, '--project', 'local-run', '--with-ops'], { execute }), 0);
  assert.deepEqual(operations, [['config', '--quiet'], ['build', 'api'], ['build', 'frontend'], ['build', 'agentic-durable']]);
  assert.ok(operations.every(operation => !['up', 'start', 'restart', 'stop', 'down'].includes(operation[0])));
});

test('serial build stops on its first failure and never proceeds to a later image', async t => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const folder = mkdtempSync(join(tmpdir(), 'local-workflow-failure-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const envFile = join(folder, 'local.env');writeFileSync(envFile, '# local fixture\n');
  const operations = [];
  const execute = (_command, args) => {
    if (args[0] === 'inspect') return { status: 0, stdout: args.includes('{{json .Config.Labels}}') ? '{"com.docker.compose.project":"local-run"}' : '{}' };
    const operation = args.slice(args.indexOf('local-durable') + 1);operations.push(operation);
    return { status: operation.at(-1) === 'frontend' ? 7 : 0 };
  };
  assert.equal(main(['build', '--env-file', envFile, '--project', 'local-run'], { execute }), 7);
  assert.deepEqual(operations, [['config', '--quiet'], ['build', 'api'], ['build', 'frontend']]);
});

test('an active UI overlay cannot be silently dropped, and the reviewed receipt preserves it on workflow start', async t => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const folder = mkdtempSync(join(tmpdir(), 'local-active-ui-'));t.after(() => rmSync(folder, { recursive: true, force: true }));
  const envFile = join(folder, 'local.env'), receiptFile = join(folder, 'release.json');writeFileSync(envFile, '# fixture\n');
  const receipt = { protocol: 1, owner: 'automation', status: 'validated', base: { api: { id: 'base-id', reference: 'base-api' }, frontend: { id: 'host-id', reference: 'reviewed-host' } }, release: { id: 'release-id', reference: 'reviewed-ui-api' }, original_ui_map: {}, ui_map: { automation: '/api/capability-ui/automation/manifest.json' }, host_compatibility: { status: 'verified' } };
  writeFileSync(receiptFile, JSON.stringify(receipt));const operations = [];
  const execute = (_command, args, options) => {
    if (args[0] === 'inspect') {
      if (args.includes('{{json .Config.Labels}}')) return { status: 0, stdout: '{"com.docker.compose.project":"local-run","com.docker.compose.project.config_files":"/repo/local-run/docker-compose.automation-ui.yml"}' };
      if (args.includes('{{json .Image}}')) return { status: 0, stdout: '"release-id"\n"host-id"\n' };
      return { status: 0, stdout: '{}' };
    }
    assert.ok(args.some(value => value.endsWith('/local-run/docker-compose.automation-ui.yml')));
    assert.equal(options.env.HELLOTEST_AUTOMATION_UI_API_IMAGE, 'reviewed-ui-api');assert.equal(options.env.HELLOTEST_AUTOMATION_UI_FRONTEND_IMAGE, 'reviewed-host');
    assert.equal(options.env.HELLOTEST_AUTOMATION_UI_MAP, JSON.stringify(receipt.ui_map));
    operations.push(args.slice(args.indexOf('local-durable') + 1));return { status: 0 };
  };
  assert.throws(() => main(['start', '--env-file', envFile], { execute }), /overlay is active/);assert.equal(operations.length, 0);
  assert.equal(main(['start', '--env-file', envFile, '--ui-release', receiptFile], { execute }), 0);
  assert.deepEqual(operations, [['config', '--quiet'], ['up', '-d', '--no-build', 'api', 'temporal-dev', 'agentic-durable']]);
  assert.throws(() => main(['build', '--env-file', envFile, '--ui-release', receiptFile], { execute }), /normal source images/);
});
