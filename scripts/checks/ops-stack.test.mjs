import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = fileURLToPath(new URL('../ops/stack.sh', import.meta.url));
const wrapper = fileURLToPath(new URL('../ops/stack.mjs', import.meta.url));
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hellotest-ops-no-node-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  for (const tool of ['sh', 'dirname', 'mkdir', 'chmod', 'od', 'tr']) {
    const path = tool === 'sh' && process.env.OPS_TEST_SHELL || execFileSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim();
    symlinkSync(path, join(bin, tool));
  }
  writeFileSync(join(bin, 'docker'), `#!/bin/sh
set -eu
[ "\${GRAFANA_ADMIN_USER-unset}" = unset ] && [ "\${GRAFANA_ADMIN_PASSWORD-unset}" = unset ] || exit 98
if [ "$1" = compose ] && [ "$2" = version ]; then exit 0; fi
printf '<%s>' "$@" >> "$OPS_TRACE"
printf '\\n' >> "$OPS_TRACE"
case "$1" in
  compose) case "$*" in *' up -d'*) exit "\${OPS_TEST_FAILURE:-0}" ;; esac ;;
  inspect) [ "\${OPS_TEST_MISSING:-0}" != 1 ] || exit 1; [ "\${OPS_TEST_ATTACHED:-0}" != 1 ] || printf 'attached\\n' ;;
  network) [ "$2" = connect ] || exit 99 ;;
  *) exit 97 ;;
esac
`, { mode: 0o755 });
  const env = { ...process.env, PATH: bin, HELLOTEST_ENV_DIR: join(directory, 'private config'), OPS_TRACE: join(directory, 'docker.trace'), GRAFANA_ADMIN_PASSWORD: 'wrong-app-password', GRAFANA_ADMIN_USER: 'wrong-app-user' };
  const run = (command, overrides = {}, nodeWrapper = false) => spawnSync(nodeWrapper ? process.execPath : join(bin, 'sh'), [nodeWrapper ? wrapper : launcher, command], { env: { ...env, ...overrides }, cwd: directory, encoding: 'utf8' });
  const trace = () => existsSync(env.OPS_TRACE) ? readFileSync(env.OPS_TRACE, 'utf8') : '';
  const resetTrace = () => writeFileSync(env.OPS_TRACE, '');
  return { env, run, trace, resetTrace, credentialFile: join(env.HELLOTEST_ENV_DIR, 'ops.env') };
}

test('monitoring prepares private, persistent credentials without Node or Docker, including paths with spaces', t => {
  const { run, trace, credentialFile } = fixture(t);
  const prepared = run('prepare');
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(trace(), '', 'prepare must not contact Docker');
  const credentials = readFileSync(credentialFile, 'utf8');
  assert.match(credentials, /^GRAFANA_ADMIN_PASSWORD=[0-9a-f]{64}\n$/);
  assert.equal(statSync(credentialFile).mode & 0o777, 0o600);
  assert.equal(statSync(join(credentialFile, '..')).mode & 0o777, 0o700);
  assert.equal(run('prepare').status, 0);
  assert.equal(readFileSync(credentialFile, 'utf8'), credentials, 'retries must retain the password');
  assert.ok(!prepared.stdout.includes(credentials.trim()));
});

test('Docker-only startup attaches applications once and honors offline startup', t => {
  const { run, trace, resetTrace } = fixture(t);
  const started = run('up', { HELLOTEST_OPS_SKIP_IMAGE_PULL: '1', OPS_API_CONTAINER: 'custom-api', OPS_FRONTEND_CONTAINER: 'custom-frontend' });
  assert.equal(started.status, 0, started.stderr);
  assert.match(trace(), /<up><-d><--pull><never>/);
  assert.match(trace(), /<network><connect><--alias><api><hellotest-ops><custom-api>/);
  assert.match(trace(), /<network><connect><--alias><frontend><hellotest-ops><custom-frontend>/);
  assert.match(trace(), /<ps>/);
  resetTrace();
  assert.equal(run('up', { OPS_TEST_ATTACHED: '1' }).status, 0);
  assert.doesNotMatch(trace(), /<network>/, 'attached application containers must not be reconnected or restarted');
});

test('ops errors propagate, missing applications are recoverable and down retains networks and volumes', t => {
  const { run, trace, resetTrace } = fixture(t);
  assert.equal(run('up', { OPS_TEST_FAILURE: '19' }).status, 19);
  assert.doesNotMatch(trace(), /<inspect>|<network>|<ps>/);
  resetTrace();
  const missing = run('up', { OPS_TEST_MISSING: '1' });
  assert.equal(missing.status, 0);
  assert.match(missing.stderr, /not attached; start it/);
  resetTrace();
  assert.equal(run('down').status, 0);
  assert.match(trace(), /<stop>/);
  assert.doesNotMatch(trace(), /<down>|<rm>|<network>/);
});

test('legacy Node entrypoint delegates status and preserves failures without changing credentials', t => {
  const { run, trace, credentialFile } = fixture(t);
  assert.equal(run('prepare').status, 0);
  const credentials = readFileSync(credentialFile, 'utf8');
  const status = run('status', {}, true);
  assert.equal(status.status, 0, status.stderr);
  assert.match(trace(), /<ps>/);
  assert.equal(readFileSync(credentialFile, 'utf8'), credentials);
  assert.equal(run('up', { OPS_TEST_FAILURE: '19' }, true).status, 19);
  assert.equal(run('unknown').status, 1);
});
