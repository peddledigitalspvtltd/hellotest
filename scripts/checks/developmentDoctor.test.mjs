import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { collectDoctorSnapshot, evaluateDoctorSnapshot, runDoctorCli, satisfiesNodeEngine } from '../dev/doctor.mjs';

function checkout() {
  const root = resolve('/doctor-test');
  const documents = new Map();
  const links = new Map();
  const reads = [];
  const commands = [];
  const existing = new Set([join(root, '.env.development.local')]);
  const set = (path, value) => documents.set(join(root, path), value);
  for (const [directory, dependency] of [
    ['.', 'typescript'], ['services/platform/backend', 'fastify'],
    ['services/platform/frontend', 'react'], ['testengine/backend', 'tsx'],
    ['local-run/mobile-engine', 'webdriverio']
  ]) {
    set(join(directory, 'package.json'), { dependencies: { [dependency]: '^1.0.0' } });
    set(join(directory, 'package-lock.json'), { packages: { [`node_modules/${dependency}`]: { version: '1.0.0' } } });
    set(join(directory, 'node_modules', dependency, 'package.json'), { name: dependency, version: '1.0.0' });
  }
  Object.assign(documents.get(join(root, 'package.json')), { engines: { node: '>=20' }, workspaces: ['services/*'] });
  set('services/automation/package.json', { name: '@hellotest/automation' });
  links.set(join(root, 'node_modules/@hellotest/automation'), join(root, 'services/automation'));
  const options = {
    root,
    nodeVersion: '22.22.0',
    files: {
      exists: (path) => documents.has(path) || existing.has(path),
      json: (path) => {
        assert.match(path, /package(?:-lock)?\.json$/u, 'Only package metadata may be read');
        reads.push(path);
        if (!documents.has(path)) throw new Error('Missing metadata');
        return documents.get(path);
      },
      directories: (path) => {
        assert.equal(path, join(root, 'services'));
        return ['automation', 'platform'];
      },
      realpath: (path) => {
        if (links.has(path)) return links.get(path);
        if (documents.has(join(path, 'package.json'))) return path;
        throw new Error('Missing link');
      }
    },
    run: async (command, args, cwd) => {
      commands.push([command, args]);
      assert.equal(cwd, root);
      if (command === 'npm') return { ok: true, stdout: '10.9.4\n' };
      if (command === 'docker' && args[0] === '--version') return { ok: true, stdout: 'Docker version 28.5.0, build test\n' };
      if (command === 'docker' && args[0] === 'compose') return { ok: true, stdout: 'v2.39.4\n' };
      throw new Error('Unexpected process invocation');
    }
  };
  return { root, documents, links, reads, commands, options, set };
}

test('doctor collects required installations and workspace links without reading environment contents', async () => {
  const fixture = checkout();
  const snapshot = await collectDoctorSnapshot(fixture.options);
  const report = evaluateDoctorSnapshot(snapshot);
  assert.equal(report.ok, true);
  assert.equal(snapshot.workspaceCount, 1);
  assert.deepEqual(snapshot.envFiles, ['.env.development.local']);
  assert.equal(snapshot.dependencies.length, 5);
  assert.deepEqual(fixture.commands, [
    ['npm', ['--version']], ['docker', ['--version']], ['docker', ['compose', 'version', '--short']]
  ]);
  assert.equal(fixture.reads.some((path) => path.includes('.env')), false);
  assert.match(report.checks.find((check) => check.id === 'env-files').summary, /does not load them automatically/u);
});

test('required missing packages, stale lock versions and broken workspace links fail with scoped remedies', async () => {
  const fixture = checkout();
  fixture.documents.delete(join(fixture.root, 'services/platform/frontend/node_modules/react/package.json'));
  fixture.set('testengine/backend/node_modules/tsx/package.json', { name: 'tsx', version: '0.9.0' });
  fixture.links.set(join(fixture.root, 'node_modules/@hellotest/automation'), join(fixture.root, 'old-checkout'));
  const snapshot = await collectDoctorSnapshot(fixture.options);
  const report = evaluateDoctorSnapshot(snapshot);
  assert.equal(report.ok, false);
  assert.deepEqual(report.checks.filter((check) => check.status === 'fail').map((check) => check.id), ['dependencies.frontend', 'dependencies.testengine', 'workspaces']);
  assert.match(report.checks.find((check) => check.id === 'dependencies.frontend').remedy, /setup:frontend/u);
  assert.match(report.checks.find((check) => check.id === 'dependencies.testengine').details[0], /package-lock.json/u);
  assert.equal(await runDoctorCli([], { collect: async () => snapshot, output() {} }), 1);
});

test('an ancestor install cannot hide a missing independently installed backend dependency', async () => {
  const fixture = checkout();
  fixture.documents.delete(join(fixture.root, 'services/platform/backend/node_modules/fastify/package.json'));
  fixture.set('node_modules/fastify/package.json', { name: 'fastify', version: '1.0.0' });
  const report = evaluateDoctorSnapshot(await collectDoctorSnapshot(fixture.options));
  assert.equal(report.checks.find((check) => check.id === 'dependencies.backend').status, 'fail');
});

test('missing manifests, npm and unsupported Node fail even when Docker is absent', async () => {
  const fixture = checkout();
  fixture.documents.delete(join(fixture.root, 'local-run/mobile-engine/package.json'));
  const snapshot = await collectDoctorSnapshot({ ...fixture.options, nodeVersion: '18.20.0', run: async () => ({ ok: false }) });
  const report = evaluateDoctorSnapshot(snapshot);
  for (const id of ['node', 'node.development', 'npm', 'dependencies.mobile']) {
    assert.equal(report.checks.find((check) => check.id === id).status, 'fail');
  }
  assert.equal(report.checks.find((check) => check.id === 'docker').status, 'warn');
});

test('Node runtime minimum and developer TypeScript support are checked separately', async () => {
  assert.equal(satisfiesNodeEngine('v22.18.0', '>=22.18'), true);
  assert.equal(satisfiesNodeEngine('22.17.9', '>=22.18.0'), false);
  assert.equal(satisfiesNodeEngine('20.19.0', '>=20'), true);
  assert.equal(satisfiesNodeEngine('22.18.0', '^22'), false);
  const fixture = checkout();
  const report = evaluateDoctorSnapshot(await collectDoctorSnapshot({ ...fixture.options, nodeVersion: '20.19.0' }));
  assert.equal(report.checks.find((check) => check.id === 'node').status, 'pass');
  assert.equal(report.checks.find((check) => check.id === 'node.development').status, 'fail');
  assert.equal(report.ok, false);
});

test('optional Docker failure never leaks command output or fails required setup', async () => {
  const fixture = checkout();
  const snapshot = await collectDoctorSnapshot({ ...fixture.options, run: async (command) => {
    if (command === 'npm') return { ok: true, stdout: 'SECRET_TOKEN=unrelated npm 10.9.4\n' };
    throw new Error('SECRET_TOKEN=private CLI configuration');
  } });
  const output = [];
  const code = await runDoctorCli(['--json'], { collect: async () => snapshot, output: (value) => output.push(value) });
  assert.equal(code, 0);
  assert.equal(output.length, 1);
  assert.equal(output[0].includes('SECRET_TOKEN'), false);
  const report = JSON.parse(output[0]);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.ok, true);
  assert.deepEqual(report.checks.filter((check) => check.status === 'warn').map((check) => check.id), ['docker', 'compose']);
});

test('Compose legacy fallback uses only version commands', async () => {
  const fixture = checkout();
  const calls = [];
  const snapshot = await collectDoctorSnapshot({ ...fixture.options, run: async (command, args) => {
    calls.push([command, args]);
    if (command === 'npm') return { ok: true, stdout: '10.9.4' };
    if (command === 'docker' && args[0] === '--version') return { ok: true, stdout: 'Docker version 28.5.0' };
    if (command === 'docker-compose') return { ok: true, stdout: 'docker-compose version 1.29.2' };
    return { ok: false };
  } });
  assert.equal(snapshot.composeLegacy, true);
  assert.equal(snapshot.compose, '1.29.2');
  assert.deepEqual(calls.at(-1), ['docker-compose', ['--version']]);
});

test('help and unknown flags do not perform any probes', async () => {
  let probes = 0;
  const output = [];
  const errors = [];
  const ports = { collect: async () => { probes++; throw new Error('Must not probe'); }, output: (value) => output.push(value), error: (value) => errors.push(value) };
  assert.equal(await runDoctorCli(['--help'], ports), 0);
  assert.match(output[0], /Exit 0/u);
  assert.equal(await runDoctorCli(['--install'], ports), 2);
  assert.match(errors[0], /Unknown doctor option/u);
  assert.equal(probes, 0);
});

test('all Node debugger ports bind and attach through loopback while PostgreSQL task stays intact', () => {
  const launch = JSON.parse(readFileSync(new URL('../../.vscode/launch.json', import.meta.url), 'utf8'));
  for (const [name, port] of [['Backend API', 9230], ['Test Engine', 9231], ['Mobile Engine', 9232]]) {
    const start = launch.configurations.find((configuration) => configuration.name === name);
    assert.ok(start.runtimeArgs.includes(`--inspect=127.0.0.1:${port}`));
    const attach = launch.configurations.find((configuration) => configuration.name === `${name} (Attach ${port})`);
    assert.equal(attach.address, '127.0.0.1');
    assert.equal(attach.port, port);
  }
  assert.equal(launch.configurations.find((configuration) => configuration.name === 'Backend API').preLaunchTask, 'postgres:up');
  const tasks = JSON.parse(readFileSync(new URL('../../.vscode/tasks.json', import.meta.url), 'utf8'));
  assert.ok(tasks.tasks.some((task) => task.label === 'postgres:up'));
  assert.ok(launch.configurations.some((configuration) => configuration.name === 'Frontend'));
});
