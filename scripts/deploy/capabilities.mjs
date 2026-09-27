#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { resolveCapabilities } = require('../../services/platform/backend/src/runtime/capabilities');
const args = process.argv.slice(2);
let selection = process.env.HELLOTEST_ENABLED_CAPABILITIES || 'all';
let print = false, build = false, down = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--capabilities' && args[i + 1]) selection = args[++i];
  else if (args[i] === '--print') print = true;
  else if (args[i] === '--build') build = true;
  else if (args[i] === '--down') down = true;
  else throw new Error(`Unknown argument: ${args[i]}. Use --capabilities automation,chatbot [--build] [--print], or --down.`);
}
const enabled = resolveCapabilities(selection);
const services = ['frontend', ...[...enabled].map(name => `${name}-api`)];
if (enabled.has('knowledge')) services.push('tika');
if (enabled.has('automation')) services.push('testengine-backend');
const command = ['compose', '-f', 'docker-compose.microservices.yml', ...(down ? ['down'] : ['up', '-d', ...(build ? ['--build'] : []), ...services])];
if (print) console.log(JSON.stringify({ capabilities: [...enabled], command: ['docker', ...command] }, null, 2));
else {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const options = {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, HELLOTEST_ENABLED_CAPABILITIES: selection }
  };
  // Every selected API inherits MinIO through x-api-common.depends_on.
  // Resolve its effective image through Compose, including .env overrides.
  if (!down && services.some(service => service.endsWith('-api'))) {
    const image = spawnSync('docker', ['compose', '-f', 'docker-compose.microservices.yml', 'config', '--images', 'minio'], {
      ...options, stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8'
    });
    if (image.error) throw image.error;
    if (image.status !== 0) process.exit(image.status ?? 1);
    const prepared = spawnSync('sh', ['scripts/build/minio.sh'], {
      ...options, env: { ...options.env, MINIO_IMAGE: image.stdout.trim() }
    });
    if (prepared.error) throw prepared.error;
    if (prepared.status !== 0) process.exit(prepared.status ?? 1);
  }
  const result = spawnSync('docker', command, options);
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
