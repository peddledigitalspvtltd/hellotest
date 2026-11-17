#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deploymentEnvironment, hostCompatibility, sha256, validateRelease, verifyOverlay } from '../build/capability-ui-contract.mjs';
import { runtimeComposeArgs } from '../dev/local-workflow-runtime.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const remotePath = '/api/capability-ui/automation/manifest.json';
function parseUiMap(raw) { try { return JSON.parse(raw || '{}'); } catch { throw new Error('The existing capability UI map must contain valid JSON.'); } }
export function mergeAutomationUiMap(raw) {
  const map = typeof raw === 'string' ? parseUiMap(raw) : raw;
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('The existing capability UI map must be an object.');
  for (const value of Object.values(map)) if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[?#\\]/.test(value)) throw new Error('Capability UI locations must be same-origin paths without private query parameters.');
  return { ...map, automation: remotePath };
}
export { deploymentEnvironment };
const inspectAssets = String.raw`
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.argv[1],files={};let count=0;
function walk(dir){for(const row of fs.readdirSync(dir,{withFileTypes:true})){const absolute=path.join(dir,row.name);if(row.isSymbolicLink())throw new Error('Symlink asset rejected');if(row.isDirectory())walk(absolute);else{if(!row.isFile()||++count>20000)throw new Error('Invalid asset inventory');const stat=fs.statSync(absolute);if(stat.size>32*1024*1024)throw new Error('Artifact exceeds serving limit');const bytes=fs.readFileSync(absolute);files[path.relative(root,absolute).replaceAll(path.sep,'/')]={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};}}}
walk(root);const manifest=fs.existsSync(path.join(root,'manifest.json'))?JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')):null;process.stdout.write(JSON.stringify({files,manifest}));
`;
function execute(args, { capture = false } = {}) {
  const result = spawnSync('docker', args, { cwd: repository, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`Docker release operation failed (${args[0]}). No app service was started or replaced.`);
  return result.stdout;
}
const image = reference => JSON.parse(execute(['image', 'inspect', reference], { capture: true }))[0];
const environment = container => Object.fromEntries(container.Config.Env.map(row => [row.slice(0, row.indexOf('=')), row.slice(row.indexOf('=') + 1)]));
const pinnedReference = (kind, id) => {
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error('Docker must report an immutable image ID.');
  return `hellotest-reviewed-${kind}:sha256-${id.slice(7)}`;
};
function assets(reference, root) {
  return JSON.parse(execute(['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '256m', '--cpus', '1', '--user', 'node', '--entrypoint', 'node', reference, '-e', inspectAssets, root], { capture: true }));
}
export function buildRelease({ apiImage, frontendImage, outputDirectory }) {
  if (!apiImage || !frontendImage || !outputDirectory) throw new Error('Supply --api-image, --frontend-image and --out; use the reviewed running image IDs.');
  const base = { api: image(apiImage), frontend: image(frontendImage) };
  const [runningApi, runningFront] = JSON.parse(execute(['inspect', 'hellotest-local-api', 'hellotest-local-frontend'], { capture: true }));
  if (runningApi.Image !== base.api.Id || runningFront.Image !== base.frontend.Id) throw new Error('The supplied images do not match the reviewed running API/frontend.');
  const originalMap = parseUiMap(environment(runningFront).HELLOTEST_CAPABILITY_UI_URLS);
  const uiMap = mergeAutomationUiMap(originalMap);
  const apiReference = pinnedReference('api', base.api.Id), frontendReference = pinnedReference('frontend', base.frontend.Id);
  execute(['tag', base.api.Id, apiReference]); execute(['tag', base.frontend.Id, frontendReference]);
  const staging = `hellotest-automation-ui-build:${randomUUID()}`;
  execute(['build', '--pull=false', '--target', 'capability-ui', '--file', 'services/platform/backend/Dockerfile', '--build-arg', 'HELLOTEST_CAPABILITY=automation', '--build-arg', 'HELLOTEST_DEBUG_SOURCEMAPS=false', '--tag', staging, '.']);
  const built = image(staging), assetReference = pinnedReference('automation-assets', built.Id);
  execute(['tag', built.Id, assetReference]);
  const next = assets(assetReference, '/capability-ui/automation');
  validateRelease(next.manifest, next.files);
  const manifestHash = next.files['manifest.json'].sha256;
  const releaseReference = `local-run-api:automation-ui-${manifestHash.slice(0, 16)}-${base.api.Id.slice(7, 19)}`;
  execute(['build', '--pull=false', '--file', 'services/automation/Dockerfile.ui-release', '--build-arg', `AUTOMATION_UI_ASSET_IMAGE=${assetReference}`, '--build-arg', `VALIDATED_API_BASE=${apiReference}`, '--build-arg', `VALIDATED_API_BASE_ID=${base.api.Id}`, '--build-arg', `AUTOMATION_UI_MANIFEST_SHA256=${manifestHash}`, '--tag', releaseReference, '.']);
  const release = image(releaseReference), before = assets(apiReference, '/app/capability-ui'), after = assets(releaseReference, '/app/capability-ui');
  verifyOverlay(base.api, release, before.files, after.files);
  for (const [file, expected] of Object.entries(next.files)) if (after.files['automation/' + file]?.sha256 !== expected.sha256) throw new Error('The layered release does not contain the validated artifact bytes.');
  if (image(apiReference).Id !== base.api.Id || image(frontendReference).Id !== base.frontend.Id || image(assetReference).Id !== built.Id) throw new Error('An immutable release reference changed during preparation.');
  const receipt = {
    protocol: 1, owner: 'automation', status: 'validated',
    base: { api: { id: base.api.Id, reference: apiReference }, frontend: { id: base.frontend.Id, reference: frontendReference } },
    release: { id: release.Id, reference: releaseReference, manifest_sha256: manifestHash, asset_image_id: built.Id },
    original_ui_map: originalMap, ui_map: uiMap, host: next.manifest.host, host_compatibility: { status: 'pending_browser_snapshot' },
    retained_base_assets: Object.keys(before.files).length - 1,
    overlay: 'local-run/docker-compose.automation-ui.yml',
    checks: { base_filesystem_layers_preserved: true, runtime_configuration_unchanged: true, other_capabilities_unchanged: true, old_hashed_assets_retained: true, new_artifact_hashes_verified: true },
    source: Object.fromEntries(['package-lock.json', 'services/platform/frontend/package-lock.json', 'scripts/build/capability-ui.mjs', 'scripts/build/capability-ui-contract.mjs', 'services/automation/Dockerfile.ui-release'].map(file => [file, sha256(readFileSync(resolve(repository, file)))]))
  };
  const output = resolve(outputDirectory);mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'release.json'), JSON.stringify(receipt, null, 2) + '\n');
  writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(next.manifest, null, 2) + '\n');
  writeFileSync(resolve(output, 'host-requirements.json'), JSON.stringify(receipt.host, null, 2) + '\n');
  console.log(JSON.stringify({ status: receipt.status, receipt: resolve(output, 'release.json'), release_image: releaseReference, host_check: 'pending; no app service started or replaced' }));
  return receipt;
}
export function verifyHost(receiptFile, snapshotFile) {
  const receipt = JSON.parse(readFileSync(receiptFile, 'utf8')), snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8'));
  if (receipt.protocol !== 1 || receipt.owner !== 'automation' || receipt.status !== 'validated') throw new Error('A validated Automation release receipt is required.');
  const missing = hostCompatibility(receipt.host, snapshot);
  if (missing.length) throw new Error('The deployed host lacks required modules or exports: ' + missing.join(', '));
  receipt.host_compatibility = { status: 'verified', snapshot_sha256: sha256(readFileSync(snapshotFile)), missing: [] };
  writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
export function assertLiveReleaseState(receipt, api, frontend, { rollback = false } = {}) {
  if (![receipt.base.api.id, receipt.release.id].includes(api.Image) || frontend.Image !== receipt.base.frontend.id) throw new Error('The running images changed since this release was reviewed.');
  const currentMap = parseUiMap(environment(frontend).HELLOTEST_CAPABILITY_UI_URLS);
  const canonical = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
  if (![canonical(receipt.original_ui_map), canonical(receipt.ui_map)].includes(canonical(currentMap))) throw new Error('The runtime capability UI map changed since review; preserve that configuration before continuing.');
  if (!rollback && receipt.host_compatibility?.status !== 'verified') throw new Error('The deployed host module contract has not been verified.');
  return true;
}
export function rolloutRelease(receiptFile, { envFile = resolve(repository, '.hellotest/local.env'), rollback = false } = {}) {
  if (!existsSync(envFile)) throw new Error('Use the existing private local environment file.');
  const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
  const releaseEnvironment = deploymentEnvironment(receipt, { rollback });
  const [api, frontend] = JSON.parse(execute(['inspect', 'hellotest-local-api', 'hellotest-local-frontend'], { capture: true }));
  assertLiveReleaseState(receipt, api, frontend, { rollback });
  const project = api.Config.Labels['com.docker.compose.project'];
  if (!project || frontend.Config.Labels['com.docker.compose.project'] !== project || environment(api).TEMPORAL_ADDRESS !== 'temporal-dev:7233') throw new Error('This rollout helper requires the reviewed existing local durable composition.');
  if (image(receipt.base.api.reference).Id !== receipt.base.api.id || image(receipt.base.frontend.reference).Id !== receipt.base.frontend.id || image(receipt.release.reference).Id !== receipt.release.id) throw new Error('An inspected release image reference changed.');
  const args = runtimeComposeArgs({ envFile: resolve(envFile), project, withOps: Object.hasOwn(api.NetworkSettings.Networks, 'hellotest-ops') });
  args.splice(-2, 0, '-f', resolve(repository, receipt.overlay));
  const env = { ...process.env, TEMPORAL_ADDRESS: 'temporal-dev:7233', HELLOTEST_SOURCE_CONTEXT: '..', ...releaseEnvironment };
  for (const operation of [['config', '--quiet'], ['up', '-d', '--no-build', '--pull', 'never', '--no-deps', '--wait', '--wait-timeout', '240', 'api', 'frontend']]) {
    const result = spawnSync('docker', [...args, ...operation], { cwd: repository, stdio: 'inherit', env });
    if (result.error || result.status !== 0) throw new Error('Targeted UI rollout did not complete. Inspect API/frontend health before retrying; the receipt retains the previous images and UI map.');
  }
  receipt.last_rollout = { mode: rollback ? 'rollback' : 'apply', status: 'compose_health_verified', at: new Date().toISOString() };
  writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
function main(args) {
  const command = args.shift(), options = {};
  while (args.length) { const key = args.shift();if (!/^--(?:api-image|frontend-image|out|receipt|snapshot|env-file)$/.test(key) || !args.length) throw new Error('Invalid release option.');options[key.slice(2)] = args.shift(); }
  if (command === 'build') return buildRelease({ apiImage: options['api-image'], frontendImage: options['frontend-image'], outputDirectory: options.out });
  if (['apply', 'rollback'].includes(command) && options.receipt) return rolloutRelease(resolve(options.receipt), { ...(options['env-file'] ? { envFile: options['env-file'] } : {}), rollback: command === 'rollback' });
  if (command === 'verify-host' && options.receipt && options.snapshot) { verifyHost(resolve(options.receipt), resolve(options.snapshot)); console.log('Deployed host module/export requirements verified.'); return; }
  throw new Error('Usage: automation-ui-release.mjs build --api-image ID --frontend-image ID --out DIRECTORY | verify-host --receipt FILE --snapshot FILE | apply|rollback --receipt FILE [--env-file existing-local.env]');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) try { main(process.argv.slice(2)); } catch (error) { console.error(error.message);process.exitCode = 1; }
