import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const defaultImage = 'hellotest/minio:RELEASE.2025-10-15T17-29-55Z';

function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hellotest-minio-start-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const name of [
    'local-run/bin/start.sh', 'local-run/lib/compose.sh', 'scripts/lib/docker.sh',
    'services/platform/backend/start.sh', 'scripts/deploy/capabilities.mjs',
    'services/platform/backend/src/runtime/capabilities.js', 'services/capabilities.json',
  ]) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    cpSync(new URL(name, root), join(directory, name));
  }
  mkdirSync(join(directory, 'fake-bin'));
  mkdirSync(join(directory, 'scripts/build'));
  writeFileSync(join(directory, 'local-run/.env.example'), 'TESTENGINE_AUTOSCALE=false\n');
  writeFileSync(join(directory, 'fake-bin/docker'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'compose' && args[1] === 'version') process.exit(0);
fs.appendFileSync(process.env.CAPTURE, JSON.stringify({ kind: 'docker', args, cwd: process.cwd(), image: process.env.MINIO_IMAGE, selection: process.env.HELLOTEST_ENABLED_CAPABILITIES }) + '\\n');
if (args.includes('config')) {
  if (process.env.CONFIG_EXIT) process.exit(Number(process.env.CONFIG_EXIT));
  if (args.includes('--services')) console.log(process.env.COMPOSE_SERVICES || 'api\\nminio');
  if (args.includes('--images')) {
    const envIndex = args.indexOf('--env-file');
    const envPath = path.resolve(envIndex >= 0 ? args[envIndex + 1] : '.env');
    const file = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const fromFile = file.match(/^MINIO_IMAGE=(.*)$/m)?.[1];
    console.log(process.env.MINIO_IMAGE || fromFile || ${JSON.stringify(defaultImage)});
  }
}
process.exit(args.includes('up') ? Number(process.env.UP_EXIT || 0) : 0);
`, { mode: 0o755 });
  writeFileSync(join(directory, 'scripts/build/minio.sh'), '#!/bin/sh\nexec "$MOCK_NODE" "$MOCK_HELPER"\n');
  writeFileSync(join(directory, 'helper.cjs'), `
require('node:fs').appendFileSync(process.env.CAPTURE, JSON.stringify({ kind: 'helper', cwd: process.cwd(), image: process.env.MINIO_IMAGE }) + '\\n');
process.exit(Number(process.env.HELPER_EXIT || 0));
`);
  const env = {
    ...process.env, PATH: `${join(directory, 'fake-bin')}:${process.env.PATH}`,
    CAPTURE: join(directory, 'captured.jsonl'), MOCK_NODE: process.execPath,
    MOCK_HELPER: join(directory, 'helper.cjs'), TESTENGINE_AUTOSCALE: 'false',
  };
  for (const key of ['MINIO_IMAGE', 'COMPOSE_FILE', 'HELLOTEST_LOCAL_COMPOSE_FILE', 'HELLOTEST_ENABLED_CAPABILITIES', 'COMPOSE_SERVICES', 'CONFIG_EXIT', 'UP_EXIT', 'HELPER_EXIT']) delete env[key];
  const run = (name, args = [], extra = {}) => {
    writeFileSync(env.CAPTURE, '');
    return spawnSync(name.endsWith('.mjs') ? process.execPath : 'sh', [join(directory, name), ...args], {
      cwd: tmpdir(), env: { ...env, ...extra }, encoding: 'utf8',
    });
  };
  const events = () => readFileSync(env.CAPTURE, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { directory, run, events };
}

for (const name of ['local-run/bin/start.sh', 'services/platform/backend/start.sh']) {
  test(`${name} prepares the effective MinIO image before starting Compose`, t => {
    const f = fixture(t);
    const composeDirectory = join(f.directory, name.startsWith('local-run') ? 'local-run' : 'services/platform/backend');
    writeFileSync(join(composeDirectory, '.env'), 'MINIO_IMAGE=registry.example.test/minio:from-env-file\nTESTENGINE_AUTOSCALE=false\n');
    const result = f.run(name);
    assert.equal(result.status, 0, result.stderr);
    const events = f.events();
    const helperIndex = events.findIndex(event => event.kind === 'helper');
    const upIndex = events.findIndex(event => event.args?.includes('up'));
    assert.ok(helperIndex >= 0 && upIndex > helperIndex);
    assert.deepEqual(events[helperIndex], { kind: 'helper', cwd: f.directory, image: 'registry.example.test/minio:from-env-file' });
    assert.equal(events[upIndex].cwd, composeDirectory);

    assert.equal(f.run(name, [], { MINIO_IMAGE: 'private.example.test/minio:override' }).status, 0);
    assert.equal(f.events().find(event => event.kind === 'helper').image, 'private.example.test/minio:override');
    assert.equal(f.events().find(event => event.args?.includes('up')).image, 'private.example.test/minio:override');
  });

  test(`${name} skips stacks without MinIO and propagates preparation/configuration failures`, t => {
    const f = fixture(t);
    assert.equal(f.run(name, [], { COMPOSE_SERVICES: 'api\nredis', HELLOTEST_LOCAL_COMPOSE_FILE: 'custom stack.yml' }).status, 0);
    assert.equal(f.events().some(event => event.kind === 'helper'), false);
    assert.equal(f.events().some(event => event.args?.includes('--images')), false);
    assert.equal(f.events().some(event => event.args?.includes('up')), true);
    assert.equal(f.run(name, [], { HELPER_EXIT: '17' }).status, 17);
    assert.equal(f.events().find(event => event.kind === 'helper').image, defaultImage);
    assert.equal(f.events().some(event => event.args?.includes('up')), false);
    assert.equal(f.run(name, [], { CONFIG_EXIT: '19' }).status, 19);
    assert.equal(f.events().some(event => event.kind === 'helper' || event.args?.includes('up')), false);
  });
}

test('capability starts prepare MinIO for expanded API dependencies and preserve selection/build options', t => {
  const f = fixture(t);
  writeFileSync(join(f.directory, '.env'), 'MINIO_IMAGE=registry.example.test/minio:from-root-env\n');
  const result = f.run('scripts/deploy/capabilities.mjs', ['--capabilities', 'automation', '--build']);
  assert.equal(result.status, 0, result.stderr);
  const events = f.events();
  assert.deepEqual(events.map(event => event.kind), ['docker', 'helper', 'docker']);
  assert.deepEqual(events[1], { kind: 'helper', cwd: f.directory, image: 'registry.example.test/minio:from-root-env' });
  assert.equal(events[2].cwd, f.directory);
  assert.equal(events[2].selection, 'automation');
  assert.deepEqual(events[2].args, ['compose', '-f', 'docker-compose.microservices.yml', 'up', '-d', '--build', 'frontend', 'platform-api', 'testing-api', 'integration-api', 'automation-api', 'testengine-backend']);

  assert.equal(f.run('scripts/deploy/capabilities.mjs', ['--capabilities', 'platform'], { MINIO_IMAGE: 'private.example.test/minio:override' }).status, 0);
  assert.equal(f.events().find(event => event.kind === 'helper').image, 'private.example.test/minio:override');
  assert.equal(f.events().find(event => event.args?.includes('up')).image, 'private.example.test/minio:override');
});

test('capability print/down never prepare MinIO and failed preparation prevents Compose up', t => {
  const f = fixture(t);
  const printed = f.run('scripts/deploy/capabilities.mjs', ['--capabilities', 'platform', '--print']);
  assert.equal(printed.status, 0, printed.stderr);
  assert.deepEqual(JSON.parse(printed.stdout).capabilities, ['platform']);
  assert.deepEqual(f.events(), []);
  assert.equal(f.run('scripts/deploy/capabilities.mjs', ['--down']).status, 0);
  assert.deepEqual(f.events().map(event => event.args), [['compose', '-f', 'docker-compose.microservices.yml', 'down']]);
  assert.equal(f.run('scripts/deploy/capabilities.mjs', [], { HELPER_EXIT: '17' }).status, 17);
  assert.equal(f.events().some(event => event.args?.includes('up')), false);
  assert.equal(f.run('scripts/deploy/capabilities.mjs', [], { CONFIG_EXIT: '19' }).status, 19);
  assert.equal(f.events().some(event => event.kind === 'helper' || event.args?.includes('up')), false);
  assert.equal(f.run('scripts/deploy/capabilities.mjs', [], { UP_EXIT: '23' }).status, 23);
});
