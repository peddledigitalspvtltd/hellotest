import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadTsModule } from './helpers/loadTsModule.mjs';
const source = fileURLToPath(new URL('../src/platform/capabilities/loadCapability.ts', import.meta.url));

function fixture(map = {}, fetch = () => { throw new Error('Unexpected network call'); }) {
  const window = { __HELLOTEST_CONFIG__: { CAPABILITY_UI_URLS: map }, __HELLOTEST_UI_HOST__: { protocol: 1 }, location: { origin: 'https://hellotest.example' } };
  return loadTsModule(source, { window, fetch, URL, AbortSignal, setTimeout, clearTimeout });
}

test('combined development uses the owning local view without fetching a release', async () => {
  const view = () => null;
  const loader = fixture();
  assert.equal(await loader.loadCapabilityView('dashboard', 'OverviewPage', async () => ({ OverviewPage: view })), view);
});

test('remote failures remain failures and a retry fetches the deployment again', async () => {
  let calls = 0, localCalls = 0;
  const loader = fixture({ dashboard: '/services/dashboard/capability-ui/dashboard/manifest.json' }, async () => { calls++; return { ok: false, status: 503 }; });
  const load = () => loader.loadCapabilityView('dashboard', 'OverviewPage', async () => { localCalls++; return {}; });
  await assert.rejects(load(), /503/);
  await assert.rejects(load(), /503/);
  assert.equal(calls, 2);
  assert.equal(localCalls, 0, 'An outage must not silently substitute another implementation');
});

test('only same-origin, compatible, owner-matching releases may execute', () => {
  for (const url of ['https://other.example/ui.json', '//other.example/ui.json', 'javascript:alert(1)', '']) {
    assert.throws(() => fixture({ dashboard: url }).capabilityUiUrl('dashboard'));
  }
  const { validateCapabilityManifest } = fixture();
  const valid = { protocol: 1, capability: 'dashboard', version: '1.2.0', entry: 'entry-hash.js', styles: ['assets/style-hash.css'] };
  const base = 'https://hellotest.example/services/dashboard/capability-ui/dashboard/manifest.json';
  assert.equal(validateCapabilityManifest(valid, 'dashboard', base), valid);
  for (const changed of [{ protocol: 2 }, { capability: 'manual' }, { entry: '../private.js' }, { entry: 'https://other.example/app.js' }, { styles: ['//other.example/style.css'] }, { styles: [null] }]) {
    assert.throws(() => validateCapabilityManifest({ ...valid, ...changed }, 'dashboard', base));
  }
});
