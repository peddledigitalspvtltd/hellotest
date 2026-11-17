import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { artifactInventory, hostCompatibility, hostRequirements, namespaceArtifacts, sha256, validateRelease, verifyOverlay } from '../build/capability-ui-contract.mjs';
import { assertLiveReleaseState, deploymentEnvironment, mergeAutomationUiMap, verifyHost } from '../deploy/automation-ui-release.mjs';
const require = createRequire(import.meta.url);

function fixture() {
  const buffers = { 'entry-one.js': Buffer.from('export const views = {};'), 'assets/screen-two.js': Buffer.from('export const Screen = {};'), 'assets/style-three.css': Buffer.from('.screen{display:block}') };
  const output = [
    { type: 'chunk', fileName: 'entry-one.js', imports: [], dynamicImports: ['assets/screen-two.js'], modules: { '\0hellotest-host:react': { renderedExports: ['useState', 'default'] }, '\0hellotest-host:auth': { renderedExports: ['useSession'] } } },
    { type: 'chunk', fileName: 'assets/screen-two.js', imports: ['entry-one.js'], dynamicImports: [], modules: { '\0hellotest-host:react': { renderedExports: ['memo'] } } },
    { type: 'asset', fileName: 'assets/style-three.css' }
  ];
  const artifacts = artifactInventory(output, path => buffers[path]);
  const manifest = { protocol: 1, capability: 'automation', version: '1.0.0', entry: 'entry-one.js', styles: ['assets/style-three.css'], host: hostRequirements(output), artifacts };
  return { manifest, files: Object.fromEntries(Object.entries(artifacts).map(([path, row]) => [path, { bytes: row.bytes, sha256: row.sha256 }])) };
}

test('the real bundle contract collects only rendered host exports and admits a complete hashed release', () => {
  const { manifest, files } = fixture();
  assert.deepEqual(manifest.host, { protocol: 1, modules: { auth: ['useSession'], react: ['memo', 'useState'] } });
  assert.equal(validateRelease(manifest, files), true);
  assert.deepEqual(hostCompatibility(manifest.host, { protocol: 1, modules: { auth: { useSession: true }, react: { useState() {}, memo() {} } } }), []);
  assert.deepEqual(hostCompatibility(manifest.host, { protocol: 1, modules: { react: { useState: undefined } } }), ['auth:module', 'react:memo', 'react:useState']);
  assert.deepEqual(hostCompatibility(manifest.host, { protocol: 2, modules: {} }), ['Host protocol 1 is required.']);
});

test('partial, altered, external, oversized or escaping release artifacts are rejected before layering', () => {
  for (const mutate of [
    value => { delete value.files['assets/screen-two.js']; },
    value => { value.files['entry-one.js'].sha256 = 'a'.repeat(64); },
    value => { value.manifest.artifacts['entry-one.js'].imports.push('https://other.invalid/entry.js'); },
    value => { value.manifest.entry = '../other/entry.js'; },
    value => { value.manifest.artifacts['entry-one.js'].bytes = 33 * 1024 * 1024; },
    value => { value.files['undeclared.js'] = { bytes: 1, sha256: 'b'.repeat(64) }; },
    value => { value.manifest.host = undefined; }
  ]) { const value = fixture();mutate(value);assert.throws(() => validateRelease(value.manifest, value.files)); }
});

test('the overlay preserves base layers/runtime/other owners and keeps every old hashed Automation chunk', () => {
  const base = { RootFS: { Layers: ['base', 'runtime'] }, Config: { User: 'node', Env: ['MODE=local'], Cmd: ['node', 'server.js'], WorkingDir: '/app' } };
  const release = structuredClone(base);release.RootFS.Layers.push('automation-assets');
  const before = { 'automation/manifest.json': { sha256: 'old' }, 'automation/entry-old.js': { sha256: 'retained' }, 'ai/entry.js': { sha256: 'ai' } };
  const after = { ...before, 'automation/manifest.json': { sha256: 'new' }, 'automation/entry-new.js': { sha256: 'new' } };
  assert.equal(verifyOverlay(base, release, before, after), true);
  assert.throws(() => verifyOverlay(base, release, before, { ...after, 'ai/entry.js': { sha256: 'changed' } }), /retained asset/);
  const missing = { ...after };delete missing['automation/entry-old.js'];assert.throws(() => verifyOverlay(base, release, before, missing), /retained asset/);
  const changed = structuredClone(release);changed.Config.Env.push('OTHER=true');assert.throws(() => verifyOverlay(base, changed, before, after), /runtime configuration/);
  changed.RootFS.Layers[0] = 'different';assert.throws(() => verifyOverlay(base, changed, before, after), /filesystem/);
});

test('enabling Automation preserves other runtime UI locations and blocks deployment until the captured host is compatible', t => {
  const folder = mkdtempSync(join(tmpdir(), 'capability-ui-release-'));t.after(() => rmSync(folder, { recursive: true, force: true }));
  const original = { ai: '/api/capability-ui/ai/manifest.json' }, map = mergeAutomationUiMap(original);
  assert.equal(original.automation, undefined);assert.equal(map.ai, original.ai);assert.equal(map.automation, '/api/capability-ui/automation/manifest.json');
  assert.throws(() => mergeAutomationUiMap({ ai: '//external.invalid' }));assert.throws(() => mergeAutomationUiMap({ ai: '/ui?token=private' }));
  const receipt = { protocol: 1, owner: 'automation', status: 'validated', base: { api: { reference: 'base-api' }, frontend: { reference: 'base-host' } }, release: { reference: 'ui-release' }, ui_map: map, original_ui_map: original, host: fixture().manifest.host };
  assert.throws(() => deploymentEnvironment(receipt), /deployed host/);
  const receiptFile = join(folder, 'release.json'), snapshotFile = join(folder, 'host.json');writeFileSync(receiptFile, JSON.stringify(receipt));
  writeFileSync(snapshotFile, JSON.stringify({ protocol: 1, modules: { auth: { useSession: true }, react: { useState: true } } }));
  assert.throws(() => verifyHost(receiptFile, snapshotFile), /react:memo/);
  writeFileSync(snapshotFile, JSON.stringify({ protocol: 1, modules: { auth: { useSession: true }, react: { useState: true, memo: true } } }));
  const verified = verifyHost(receiptFile, snapshotFile);
  assert.equal(verified.host_compatibility.snapshot_sha256, sha256(readFileSync(snapshotFile)));
  assert.deepEqual(deploymentEnvironment(verified), { HELLOTEST_AUTOMATION_UI_API_IMAGE: 'ui-release', HELLOTEST_AUTOMATION_UI_FRONTEND_IMAGE: 'base-host', HELLOTEST_AUTOMATION_UI_MAP: JSON.stringify(map) });
  assert.equal(JSON.parse(deploymentEnvironment(verified, { rollback: true }).HELLOTEST_AUTOMATION_UI_MAP).automation, undefined);
});

test('reviewable Docker/Compose overlays can replace only Automation artifacts and runtime UI selection', () => {
  const dockerfile = readFileSync(new URL('../../services/automation/Dockerfile.ui-release', import.meta.url), 'utf8');
  assert.doesNotMatch(dockerfile, /^RUN\s/m);
  assert.deepEqual(dockerfile.split('\n').filter(line => /^COPY\s/.test(line)), ['COPY --from=automation-assets --chown=node:node /capability-ui/automation/ /app/capability-ui/automation/']);
  const overlay = require('yaml').parse(readFileSync(new URL('../../local-run/docker-compose.automation-ui.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(overlay.services.api), ['image']);
  assert.deepEqual(Object.keys(overlay.services.frontend).sort(), ['environment', 'image']);
  assert.deepEqual(Object.keys(overlay.services.frontend.environment), ['HELLOTEST_CAPABILITY_UI_URLS']);
});


test('rollout refuses changed images or runtime maps instead of overwriting a later release', () => {
  const receipt = { base: { api: { id: 'api-base' }, frontend: { id: 'host-base' } }, release: { id: 'ui-release' }, original_ui_map: {}, ui_map: { automation: '/api/capability-ui/automation/manifest.json' }, host_compatibility: { status: 'verified' } };
  const api = { Image: 'api-base' }, host = { Image: 'host-base', Config: { Env: ['HELLOTEST_CAPABILITY_UI_URLS='] } };
  assert.equal(assertLiveReleaseState(receipt, api, host), true);
  assert.throws(() => assertLiveReleaseState(receipt, { Image: 'newer-api' }, host), /images changed/);
  const changedMap = structuredClone(host);changedMap.Config.Env = ['HELLOTEST_CAPABILITY_UI_URLS={"ai":"/api/capability-ui/ai/manifest.json"}'];
  assert.throws(() => assertLiveReleaseState(receipt, api, changedMap), /map changed/);
  const pending = structuredClone(receipt);pending.host_compatibility.status = 'pending';assert.throws(() => assertLiveReleaseState(pending, api, host), /not been verified/);
});


test('a complete byte-inventory namespace prevents old same-name chunks from being overwritten', () => {
  const original = fixture(), first = namespaceArtifacts(original.manifest.artifacts);
  const changed = structuredClone(original.manifest.artifacts);changed['assets/screen-two.js'].sha256 = 'f'.repeat(64);
  const second = namespaceArtifacts(changed);
  assert.notEqual(first.prefix, second.prefix);
  assert.ok(first.artifacts[first.prefix + '/entry-one.js'].imports.includes(first.prefix + '/assets/screen-two.js'));
  assert.deepEqual(first, namespaceArtifacts(original.manifest.artifacts), 'Identical bundle bytes keep a stable namespace');
});
