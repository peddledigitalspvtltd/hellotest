import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
test('local wrappers preserve Compose selection, argument boundaries and environment files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hellotest-local-compose-'));
  try {
    for (const name of ['local-run/bin', 'local-run/lib', 'scripts/lib', 'fake-bin']) mkdirSync(join(directory, name), { recursive: true });
    for (const name of ['local-run/bin/status.sh', 'local-run/bin/logs.sh', 'local-run/lib/compose.sh', 'scripts/lib/docker.sh']) cpSync(new URL(name, root), join(directory, name));
    writeFileSync(join(directory, 'local-run/.env.example'), 'EXAMPLE=initial\n');
    writeFileSync(join(directory, 'fake-bin/docker'), '#!/bin/sh\nif [ "$2" = version ]; then exit 0; fi\nprintf "%s\\n" "$PWD" "$@" > "$CAPTURE"\nexit "${FAKE_EXIT:-0}"\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${join(directory, 'fake-bin')}:${process.env.PATH}`, CAPTURE: join(directory, 'captured'), HELLOTEST_LOCAL_COMPOSE_FILE: 'custom stack.yml' };
    const run = (name, args = [], extra = {}) => spawnSync('sh', [join(directory, `local-run/bin/${name}.sh`), ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
    assert.equal(run('status').status, 0);
    assert.ok(existsSync(join(directory, 'local-run/.env')));
    assert.deepEqual(readFileSync(env.CAPTURE, 'utf8').trim().split('\n'), [join(directory, 'local-run'), 'compose', '--env-file', '.env', '-f', 'custom stack.yml', 'ps']);
    writeFileSync(join(directory, 'local-run/.env'), 'EXAMPLE=retained\n');
    assert.equal(run('logs', ['api', '--tail', '17']).status, 0);
    assert.deepEqual(readFileSync(env.CAPTURE, 'utf8').trim().split('\n').slice(-5), ['logs', '-f', 'api', '--tail', '17']);
    assert.equal(readFileSync(join(directory, 'local-run/.env'), 'utf8'), 'EXAMPLE=retained\n');
    assert.equal(run('status', [], { FAKE_EXIT: '9' }).status, 9);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
