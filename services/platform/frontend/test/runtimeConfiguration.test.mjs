import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const hasJq = spawnSync('jq', ['--version']).status === 0;
test('image entrypoint serializes default and custom configuration and rejects malformed maps', { skip: !hasJq && 'jq runs in the nginx image' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'hellotest-config-'));
  try {
    mkdirSync(join(directory, 'html')); mkdirSync(join(directory, 'admin'));
    const script = readFileSync(new URL('../docker-entrypoint.sh', import.meta.url), 'utf8').replaceAll('/usr/share/nginx', directory);
    const entrypoint = join(directory, 'entrypoint.sh'); writeFileSync(entrypoint, script);
    for (const urls of ['', '{"chatbot":"/services/chatbot"}', '{"ai":"https://ai.example.test"}']) {
      const base = '/api/quoted"\\path';
      const ui = { dashboard: '/services/dashboard/capability-ui/dashboard/manifest.json' };
      const result = spawnSync('sh', [entrypoint], { env: { ...process.env, HELLOTEST_API_BASE_URL: base, HELLOTEST_SERVICE_URLS: urls, HELLOTEST_CAPABILITY_UI_URLS: JSON.stringify(ui) }, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      for (const app of ['html', 'admin']) {
        const window = { __HELLOTEST_CONFIG__: { WORKSPACE_BASE_URL: '/workspace' } };
        vm.runInNewContext(readFileSync(join(directory, app, 'runtime-config.js'), 'utf8'), { window });
        assert.equal(window.__HELLOTEST_CONFIG__.API_BASE_URL, base);
        assert.equal(window.__HELLOTEST_CONFIG__.WORKSPACE_BASE_URL, '/workspace');
        assert.deepEqual(JSON.parse(JSON.stringify(window.__HELLOTEST_CONFIG__.SERVICE_URLS)), JSON.parse(urls || '{}'));
        assert.deepEqual(JSON.parse(JSON.stringify(window.__HELLOTEST_CONFIG__.CAPABILITY_UI_URLS)), ui);
      }
    }
    for (const ui of ['[]', 'null', '{"dashboard":32}', '{"dashboard":"https://other.example/ui.json"}', '{"dashboard":"//other.example/ui.json"}']) {
      for (const app of ['html', 'admin']) rmSync(join(directory, app, 'runtime-config.js'));
      const result = spawnSync('sh', [entrypoint], { env: { ...process.env, HELLOTEST_SERVICE_URLS: '{}', HELLOTEST_CAPABILITY_UI_URLS: ui }, encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      for (const app of ['html', 'admin']) {
        assert.equal(existsSync(join(directory, app, 'runtime-config.js')), false);
        writeFileSync(join(directory, app, 'runtime-config.js'), '');
      }
    }
    for (const urls of ['{} trailing', '[]', 'null', '{"ai":32}']) {
      for (const app of ['html', 'admin']) rmSync(join(directory, app, 'runtime-config.js'));
      const result = spawnSync('sh', [entrypoint], { env: { ...process.env, HELLOTEST_SERVICE_URLS: urls }, encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(join(directory, 'html', 'runtime-config.js')), false);
      // Leave placeholders for the next malformed case's cleanup.
      for (const app of ['html', 'admin']) writeFileSync(join(directory, app, 'runtime-config.js'), '');
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
