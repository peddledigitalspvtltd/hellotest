import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));
const directory = resolve(process.env.HELLOTEST_ENV_DIR || resolve(root, '.hellotest'));
const envFile = resolve(directory, 'ops.env');
mkdirSync(directory, { recursive: true, mode: 0o700 });
if (!existsSync(envFile)) writeFileSync(envFile, `GRAFANA_ADMIN_PASSWORD=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
chmodSync(envFile, 0o600);
// The ops secret file owns Grafana credentials. An application-stack config
// inherited from the shell must not override them (including local defaults).
const environment = { ...process.env };
delete environment.GRAFANA_ADMIN_PASSWORD;
delete environment.GRAFANA_ADMIN_USER;
const docker = args => execFileSync('docker', args, { cwd: root, encoding: 'utf8', env: environment });
const compose = ['compose', '--env-file', envFile, '-f', 'docker-compose.ops.yml'];
const command = process.argv[2] || 'status';
if (!['up', 'status', 'down', 'prepare'].includes(command)) throw new Error('Use scripts/ops/stack.mjs up, status, down or prepare');
if (command === 'prepare') process.exit(0);
if (command === 'down') {
  // Stop without deleting the shared network attached to application containers.
  execFileSync('docker', [...compose, 'stop'], { cwd: root, stdio: 'inherit', env: environment });
}
if (command === 'up') {
  const pullPolicy = process.env.HELLOTEST_OPS_SKIP_IMAGE_PULL === '1' ? ['--pull', 'never'] : [];
  execFileSync('docker', [...compose, 'up', '-d', ...pullPolicy], { cwd: root, stdio: 'inherit', env: environment });
  // Attaching a network leaves the existing application processes running.
  for (const [name, alias] of [[process.env.OPS_API_CONTAINER || 'hellotest-local-api', 'api'], [process.env.OPS_FRONTEND_CONTAINER || 'hellotest-local-frontend', 'frontend']]) {
    try {
      const networks = JSON.parse(docker(['inspect', '--format', '{{json .NetworkSettings.Networks}}', name]));
      if (!networks['hellotest-ops']) docker(['network', 'connect', '--alias', alias, 'hellotest-ops', name]);
    } catch { console.error(`Application container ${name} is not attached; start it and run ops:up again.`); }
  }
  console.log(`Ops started. Grafana credentials are in ${envFile} (owner-readable only).`);
}
execFileSync('docker', [...compose, 'ps'], { cwd: root, stdio: 'inherit', env: environment });
