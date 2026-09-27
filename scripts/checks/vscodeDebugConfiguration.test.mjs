import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../..', import.meta.url));
const launch = JSON.parse(readFileSync(join(root, '.vscode/launch.json'), 'utf8'));
const tasks = JSON.parse(readFileSync(join(root, '.vscode/tasks.json'), 'utf8')).tasks;
const taskByName = new Map(tasks.map(task => [task.label, task]));
const profiles = new Map(launch.configurations.map(profile => [profile.name, profile]));

test('debugger profiles share the private environment and explicit on-demand infrastructure', () => {
  assert.equal(profiles.size, launch.configurations.length);
  assert.equal(taskByName.size, tasks.length);
  for (const profile of profiles.values()) {
    if (profile.preLaunchTask) assert.ok(taskByName.has(profile.preLaunchTask));
    if (profile.type === 'pwa-node' && profile.request === 'launch') {
      assert.equal(profile.envFile, '${workspaceFolder}/.env.development.local');
      for (const key of Object.keys(profile.env)) assert.ok(['NODE_ENV', 'PORT', 'ARTIFACT_ROOT'].includes(key), `Keep ${key} in the development environment file`);
    }
  }
  for (const compound of launch.compounds) for (const name of compound.configurations) assert.ok(profiles.has(name));
  for (const task of tasks) assert.notEqual(task.runOptions?.runOn, 'folderOpen');
  const infrastructure = taskByName.get('postgres:up');
  assert.equal(profiles.get('Backend API').preLaunchTask, infrastructure.label);
  assert.equal(infrastructure.dependsOn, 'minio:prepare');
  assert.ok(infrastructure.args.includes('--wait'));
  assert.deepEqual(infrastructure.args.slice(-2), ['postgres', 'minio']);
  assert.deepEqual(infrastructure.args.slice(0, 3), ['compose', '--env-file', '.env.development.local']);
  const stop = taskByName.get('debug:infra:stop');
  assert.deepEqual(stop.args.slice(-3), ['stop', 'postgres', 'minio']);
  assert.equal(stop.dependsOn, undefined);
  for (const [name, port] of [['Frontend', '5173'], ['Admin Frontend', '5174']]) {
    const profile = profiles.get(name);
    const task = taskByName.get(profile.preLaunchTask);
    assert.equal(new URL(profile.url).port, port);
    assert.equal(task.args[task.args.indexOf('--port') + 1], port);
    assert.ok(task.args.includes('--strictPort'));
    assert.equal(task.isBackground, true);
    assert.ok(new RegExp(task.problemMatcher.background.endsPattern).test(`  ➜  Local:   http://localhost:${port}/`));
    assert.equal(new RegExp(task.problemMatcher.background.beginsPattern).test('  ➜  press h + enter to show help'), false);
    const matcher = task.problemMatcher.pattern;
    const problem = 'src/example.ts:12:3: Unexpected token'.match(new RegExp(matcher.regexp));
    assert.equal(problem[matcher.file], 'src/example.ts');
    assert.equal(problem[matcher.line], '12');
    assert.equal(problem[matcher.message], 'Unexpected token');
  }
  assert.equal(new URL(profiles.get('Admin Frontend').url).pathname, '/admin/');
  assert.doesNotThrow(() => JSON.parse(readFileSync(join(root, '.vscode/settings.json'), 'utf8')));
});

test('MinIO debugger task passes the resolved image and propagates failures without launching infrastructure', t => {
  const directory = mkdtempSync(join(tmpdir(), 'hellotest-vscode-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'bin'));
  mkdirSync(join(directory, 'scripts/build'), { recursive: true });
  writeFileSync(join(directory, 'bin/docker'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$DOCKER_ARGS"\n[ "${CONFIG_EXIT:-0}" = 0 ] || exit "$CONFIG_EXIT"\nprintf "%s\\n" "$RESOLVED_IMAGE"\n', { mode: 0o755 });
  writeFileSync(join(directory, 'scripts/build/minio.sh'), '#!/bin/sh\nprintf "%s" "$MINIO_IMAGE" > "$HELPER_IMAGE"\nexit "${HELPER_EXIT:-0}"\n');
  const task = taskByName.get('minio:prepare');
  const env = { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}`, DOCKER_ARGS: join(directory, 'docker-args'), HELPER_IMAGE: join(directory, 'helper-image'), RESOLVED_IMAGE: 'registry.example.test/minio:custom' };
  const run = extra => spawnSync(task.command, task.args, { cwd: directory, env: { ...env, ...extra }, encoding: 'utf8' });
  const result = run({});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(env.HELPER_IMAGE, 'utf8'), env.RESOLVED_IMAGE);
  assert.deepEqual(readFileSync(env.DOCKER_ARGS, 'utf8').trim().split('\n'), ['compose', '--env-file', '.env.development.local', '-f', 'services/platform/backend/docker-compose.yml', 'config', '--images', 'minio']);
  assert.equal(run({ HELPER_EXIT: '17' }).status, 17);
  writeFileSync(env.HELPER_IMAGE, 'not called');
  assert.equal(run({ CONFIG_EXIT: '19' }).status, 19);
  assert.equal(readFileSync(env.HELPER_IMAGE, 'utf8'), 'not called');
});

test('current-file Node and TypeScript profiles run only the selected test without watchers', t => {
  const directory = mkdtempSync(join(tmpdir(), 'hellotest-vscode-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [name, extension, declaration] of [
    ['Node Test (Current File)', 'mjs', "const expected = 'test';"],
    ['TypeScript Test (Current File)', 'mts', "const expected: string = 'test';"],
  ]) {
    const profile = profiles.get(name);
    assert.equal(profile.program, '${file}');
    assert.ok(profile.runtimeArgs.includes('--test'));
    assert.ok(profile.runtimeArgs.includes('--test-concurrency=1'));
    assert.equal(profile.runtimeArgs.some(arg => arg.startsWith('--watch')), false);
    assert.equal(profile.preLaunchTask, undefined);
    const file = join(directory, `current file.test.${extension}`);
    writeFileSync(file, `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n${declaration}\ntest('selected current file', () => assert.equal(process.env.NODE_ENV, expected));\n`);
    const env = { ...process.env, ...profile.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(profile.runtimeExecutable, [...profile.runtimeArgs, file], {
      cwd: profile.cwd.replace('${workspaceFolder}', root), env, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /selected current file/);
  }
});
