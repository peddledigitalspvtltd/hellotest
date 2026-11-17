#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { deploymentEnvironment } from '../build/capability-ui-contract.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function runtimeComposeArgs({ root = repository, envFile, project, withOps = false } = {}) {
  if (!project || !/^[a-z0-9][a-z0-9_-]{0,100}$/.test(project)) throw new Error('Choose the existing local Compose project name.');
  return ['compose', '--env-file', envFile, '--project-name', project,
    '-f', resolve(root, 'local-run/docker-compose.yml'),
    '-f', resolve(root, 'docker-compose.agentic-durable.yml'),
    '-f', resolve(root, 'local-run/docker-compose.temporal-dev.yml'),
    ...(withOps ? ['-f', resolve(root, 'local-run/docker-compose.ops-network.yml')] : []), '--profile', 'local-durable'];
}

export function runtimeCommands(command, { buildWorker = false } = {}) {
  switch (command) {
    case 'prepare': return [['config', '--quiet'], ['pull', 'temporal-dev'], ...(buildWorker ? [['build', 'agentic-durable']] : [])];
    case 'validate': return [['config', '--quiet']];
    // Keep independent type/bundle workloads out of the same memory window.
    case 'build': return [['config', '--quiet'], ['build', 'api'], ['build', 'frontend'], ['build', 'agentic-durable']];
    case 'migrate': return [['config', '--quiet'], ['run', '--rm', '--no-deps', 'api', 'npm', 'run', 'migrate']];
    case 'start': return [['config', '--quiet'], ['up', '-d', '--no-build', 'api', 'temporal-dev', 'agentic-durable']];
    case 'stop': return [['stop', 'agentic-durable', 'temporal-dev']];
    case 'status': return [['ps', 'api', 'temporal-dev', 'agentic-durable']];
    case 'logs': return [['logs', '--tail', '100', 'temporal-dev', 'agentic-durable']];
    default: throw new Error('Usage: node scripts/dev/local-workflow-runtime.mjs <prepare|validate|build|migrate|start|stop|status|logs> [--env-file path] [--project existing-name] [--with-ops] [--build-worker] [--ui-release reviewed-receipt.json]');
  }
}

export function main(argv = process.argv.slice(2), { execute = spawnSync } = {}) {
  const command = argv.shift();let envFile = resolve(process.env.HELLOTEST_ENV_DIR || resolve(repository, '.hellotest'), 'local.env');
  let project = process.env.COMPOSE_PROJECT_NAME || '', withOps = false, buildWorker = false, uiReceiptFile, activeUiOverlay = false;
  while (argv.length) {
    const option = argv.shift();
    if (option === '--env-file' && argv.length) envFile = resolve(argv.shift());
    else if (option === '--project' && argv.length) project = argv.shift();
    else if (option === '--with-ops') withOps = true;
    else if (option === '--build-worker') buildWorker = true;
    else if (option === '--ui-release' && argv.length) uiReceiptFile = resolve(argv.shift());
    else throw new Error('Unknown local workflow runtime option. Use the documented command and options.');
  }
  if (!existsSync(envFile)) throw new Error('The existing local environment file is required. Run ./hellotest.sh config --stack local first.');
  const existing = execute('docker', ['inspect', 'hellotest-local-api', '--format', '{{json .Config.Labels}}'], { encoding: 'utf8' });
  if (existing.status === 0) {
    try {
      const labels = JSON.parse(existing.stdout);
      const owner = labels['com.docker.compose.project'] || '';
      activeUiOverlay = String(labels['com.docker.compose.project.config_files'] || '').split(',').some(file => file.endsWith('/docker-compose.automation-ui.yml')); 
      if (project && owner && project !== owner) throw new Error('The selected project differs from the existing local API. Use its existing project identity to preserve its volumes.');
      project ||= owner;
    } catch (error) { if (error instanceof SyntaxError) { /* Require an explicit project below. */ } else throw error; }
  }
  if (!project) throw new Error('No existing local API project was found. Pass --project with the intended local Compose project name.');
  if (activeUiOverlay && ['start', 'migrate'].includes(command) && !uiReceiptFile) throw new Error('An Automation UI release overlay is active. Preserve it with --ui-release /path/to/reviewed-release.json; use the documented full-source promotion to remove it.');
  let uiEnvironment;
  if (uiReceiptFile) {
    if (!['start', 'migrate'].includes(command) || !activeUiOverlay) throw new Error('--ui-release preserves an already-applied UI release for start/migrate. Use the targeted release pipeline for initial rollout; build uses normal source images.');
    let receipt;try { receipt = JSON.parse(readFileSync(uiReceiptFile, 'utf8')); } catch { throw new Error('The reviewed UI release receipt could not be read.'); }
    const liveImages = execute('docker', ['inspect', 'hellotest-local-api', 'hellotest-local-frontend', '--format', '{{json .Image}}'], { encoding: 'utf8' });
    let ids;try { ids = liveImages.stdout.trim().split('\n').map(value => JSON.parse(value)); } catch { throw new Error('The applied UI release images could not be verified.'); }
    if (liveImages.status !== 0 || ![receipt.base?.api.id, receipt.release?.id].includes(ids[0]) || receipt.base?.frontend.id !== ids[1]) throw new Error('The UI receipt does not match the current API/frontend images. Review the active release before recreating services.');
    uiEnvironment = deploymentEnvironment(receipt, { rollback: ids[0] === receipt.base.api.id });
  }
  const networks = execute('docker', ['inspect', 'hellotest-local-api', '--format', '{{json .NetworkSettings.Networks}}'], { encoding: 'utf8' });
  if (networks.status === 0) try { withOps ||= Object.hasOwn(JSON.parse(networks.stdout), 'hellotest-ops'); } catch { /* Explicit --with-ops remains available. */ }
  const args = runtimeComposeArgs({ envFile, project, withOps });
  if (uiEnvironment) args.splice(-2, 0, '-f', resolve(repository, 'local-run/docker-compose.automation-ui.yml'));
  // Fixed local address makes required interpolation deterministic without
  // modifying the private environment file or selecting an external service.
  const env = { ...process.env, TEMPORAL_ADDRESS: 'temporal-dev:7233', HELLOTEST_SOURCE_CONTEXT: '..', ...uiEnvironment };
  for (const operation of runtimeCommands(command, { buildWorker })) {
    const result = execute('docker', [...args, ...operation], { cwd: repository, env, stdio: 'inherit' });
    if (result.error) throw new Error('Docker Compose could not start. Check Docker availability.');
    if (result.status !== 0) return result.status || 1;
  }
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message);process.exitCode = 1; }
}
