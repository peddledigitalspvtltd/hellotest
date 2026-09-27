#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const runtimes = [
  ['workspace', '.', 'setup:capabilities'],
  ['backend', 'services/platform/backend', 'setup:backend'],
  ['frontend', 'services/platform/frontend', 'setup:frontend'],
  ['testengine', 'testengine/backend', 'setup:testengine'],
  ['mobile', 'local-run/mobile-engine', 'setup:mobile']
];
const envFiles = ['.env', '.env.development.local', 'services/platform/backend/.env', 'services/platform/frontend/.env', 'services/platform/frontend/.env.local', 'testengine/backend/.env', 'local-run/mobile-engine/.env', 'local-run/.env', 'testengine/.env'];
const packageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const defaultFiles = {
  exists: existsSync,
  json: (path) => JSON.parse(readFileSync(path, 'utf8')),
  directories: (path) => readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  realpath: realpathSync
};

async function runVersionCommand(command, args, root) {
  try {
    const { stdout } = await execute(command, args, { cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 8192, windowsHide: true });
    return { ok: true, stdout };
  } catch { return { ok: false }; } // Never echo stderr: local CLI configuration can contain credentials.
}

const version = (result) => result?.ok ? String(result.stdout || '').match(/\bv?(\d+\.\d+\.\d+)\b/)?.[1] || null : null;

export function satisfiesNodeEngine(nodeVersion, range) {
  // The root manifest deliberately declares a simple minimum. Fail explicitly
  // if that contract changes rather than guessing at unsupported semver syntax.
  const minimum = String(range || '').match(/^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  const actual = String(nodeVersion).match(/^v?(\d+)\.(\d+)\.(\d+)(?:$|[-+])/);
  if (!minimum || !actual) return false;
  for (let index = 1; index <= 3; index++) {
    const difference = Number(actual[index]) - Number(minimum[index] || 0);
    if (difference) return difference > 0;
  }
  return true;
}

/** Collect metadata with injectable filesystem/command ports. No module imports,
 * .env reads, network probes, Docker daemon calls, installs or filesystem writes. */
export async function collectDoctorSnapshot({ root = repositoryRoot, nodeVersion = process.versions.node, files = defaultFiles, run = runVersionCommand } = {}) {
  const json = (path) => { try { return files.json(path); } catch { return null; } };
  const rootManifest = json(join(root, 'package.json'));
  const dependencies = runtimes.map(([id, directory, setup]) => {
    const manifest = directory === '.' ? rootManifest : json(join(root, directory, 'package.json'));
    const lock = json(join(root, directory, 'package-lock.json'));
    const names = Object.keys({ ...manifest?.dependencies, ...manifest?.devDependencies }).sort();
    const missing = [], stale = [];
    for (const name of names) {
      const installed = packageName.test(name) ? json(join(root, directory, 'node_modules', name, 'package.json')) : null;
      if (!installed || installed.name !== name) missing.push(name);
      else if (lock?.packages?.[`node_modules/${name}`]?.version && installed.version !== lock.packages[`node_modules/${name}`].version) stale.push(name);
    }
    return { id, setup, manifestFound: Boolean(manifest), count: names.length, missing, stale };
  });

  const workspaceIssues = [];
  let workspaceCount = 0;
  const workspaces = rootManifest?.workspaces?.packages || rootManifest?.workspaces;
  if (!Array.isArray(workspaces) || !workspaces.length) workspaceIssues.push('Root workspace declarations are unavailable.');
  for (const pattern of Array.isArray(workspaces) ? workspaces : []) {
    let directories;
    try {
      if (pattern.endsWith('/*') && !pattern.slice(0, -2).includes('*')) {
        const parent = pattern.slice(0, -2);
        directories = files.directories(join(root, parent)).map((name) => join(parent, name)).filter((path) => files.exists(join(root, path, 'package.json')));
      } else if (!pattern.includes('*')) directories = [pattern];
      else throw new Error('Unsupported workspace pattern');
    } catch { workspaceIssues.push(`Unable to inspect workspace pattern ${pattern}.`); continue; }
    for (const directory of directories) {
      const manifest = json(join(root, directory, 'package.json'));
      if (!manifest?.name || !packageName.test(manifest.name)) { workspaceIssues.push(`Invalid workspace manifest: ${directory}.`); continue; }
      workspaceCount++;
      try {
        if (files.realpath(join(root, 'node_modules', manifest.name)) !== files.realpath(join(root, directory))) workspaceIssues.push(`Incorrect workspace link: ${manifest.name}.`);
      } catch { workspaceIssues.push(`Missing workspace link: ${manifest.name}.`); }
    }
  }
  if (!workspaceCount && !workspaceIssues.length) workspaceIssues.push('No workspace packages were found.');

  const probe = async (command, args) => { try { return version(await run(command, args, root)); } catch { return null; } };
  const [npm, docker] = await Promise.all([probe('npm', ['--version']), probe('docker', ['--version'])]);
  let compose = docker ? await probe('docker', ['compose', 'version', '--short']) : null;
  let composeLegacy = false;
  if (docker && !compose) { compose = await probe('docker-compose', ['--version']); composeLegacy = Boolean(compose); }
  return { nodeVersion, engineRange: rootManifest?.engines?.node, npm, docker, compose, composeLegacy, dependencies,
    workspaceCount, workspaceIssues, envFiles: envFiles.filter((path) => files.exists(join(root, path))) };
}

/** Pure report policy: required failures determine exit status; Docker is optional. */
export function evaluateDoctorSnapshot(snapshot) {
  const checks = [];
  const add = (id, status, summary, details = [], remedy) => checks.push({ id, status, summary, ...(details.length ? { details } : {}), ...(remedy ? { remedy } : {}) });
  const nodeOkay = satisfiesNodeEngine(snapshot.nodeVersion, snapshot.engineRange);
  add('node', nodeOkay ? 'pass' : 'fail', `Node ${snapshot.nodeVersion}; required ${snapshot.engineRange || 'engines.node in package.json'}.`, [], nodeOkay ? undefined : 'Use the Node version range declared in the root package.json.');
  const developmentNodeOkay = satisfiesNodeEngine(snapshot.nodeVersion, '>=22.18.0');
  add('node.development', developmentNodeOkay ? 'pass' : 'fail', 'Development requires Node >=22.18.0 for native TypeScript imports in frontend tests.', [], developmentNodeOkay ? undefined : 'Use Node 22.18 or newer for development, even when the runtime engine minimum is satisfied.');
  add('npm', snapshot.npm ? 'pass' : 'fail', snapshot.npm ? `npm ${snapshot.npm}.` : 'npm CLI is unavailable or did not return a version.', [], snapshot.npm ? undefined : 'Make npm available on PATH.');
  for (const item of snapshot.dependencies) {
    const okay = item.manifestFound && !item.missing.length && !item.stale.length;
    add(`dependencies.${item.id}`, okay ? 'pass' : 'fail', okay ? `${item.id}: ${item.count} declared packages installed.` : `${item.id}: dependency installation needs attention.`, [
      ...(!item.manifestFound ? ['Package manifest is missing or invalid.'] : []),
      ...item.missing.map((name) => `Missing or invalid: ${name}`), ...item.stale.map((name) => `Does not match package-lock.json: ${name}`)
    ], okay ? undefined : `Run npm run ${item.setup} after reviewing your checkout.`);
  }
  add('workspaces', snapshot.workspaceIssues.length ? 'fail' : 'pass', `${snapshot.workspaceCount} workspace links checked.`, snapshot.workspaceIssues, snapshot.workspaceIssues.length ? 'Run npm run setup:capabilities to restore workspace links.' : undefined);
  add('docker', snapshot.docker ? 'pass' : 'warn', snapshot.docker ? `Docker CLI ${snapshot.docker}; daemon not contacted.` : 'Optional Docker CLI is unavailable. Native development can continue.');
  add('compose', snapshot.compose ? 'pass' : 'warn', snapshot.compose ? `Docker Compose ${snapshot.compose}${snapshot.composeLegacy ? ' (legacy CLI)' : ''}; no containers inspected or changed.` : 'Optional Docker Compose CLI is unavailable.');
  add('env-files', 'info', 'Optional .env files checked by existence only. Node does not load them automatically.', snapshot.envFiles.length ? snapshot.envFiles : ['No optional .env files found.'], 'Explicitly load the intended environment in your start command or debugger. Vite manages its frontend environment separately.');
  return { schemaVersion: 1, ok: !checks.some((check) => check.status === 'fail'), checks };
}

const help = `Usage: npm run doctor -- [--json | --help]
Read-only checks for Node >=22.18/npm, installed packages and workspace links.
Docker/Compose CLI checks are optional; no daemon or application is contacted.
.env contents are never read or loaded. No packages or containers are changed.
--json  Print a JSON report (use npm run --silent doctor -- --json).
--help  Show this help without running checks.
Exit 0: required checks passed; 1: required check failed; 2: invalid arguments.
`;

export async function runDoctorCli(args, { collect = collectDoctorSnapshot, output = console.log, error = console.error } = {}) {
  if (args.some((arg) => !['--json', '--help'].includes(arg))) { error('Unknown doctor option. Use --help.'); return 2; }
  if (args.includes('--help')) { output(help); return 0; }
  const report = evaluateDoctorSnapshot(await collect());
  if (args.includes('--json')) output(JSON.stringify(report, null, 2));
  else for (const check of report.checks) {
    output(`${check.status.toUpperCase()} ${check.id}: ${check.summary}`);
    for (const detail of check.details || []) output(`  ${detail}`);
    if (check.remedy) output(`  ${check.remedy}`);
  }
  return report.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await runDoctorCli(process.argv.slice(2)); }
  catch { console.error('Doctor could not inspect this checkout. Check read permissions and package manifests.'); process.exitCode = 1; }
}
