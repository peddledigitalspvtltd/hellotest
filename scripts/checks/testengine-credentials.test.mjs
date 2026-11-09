import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const root = new URL('../../', import.meta.url);
const yaml = createRequire(new URL('../../services/platform/backend/package.json', import.meta.url))('yaml');
const dockerAvailable = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
const canonical = 'canonical-engine-fixture-credential-at-least-32';
const alias = 'legacy-engine-fixture-credential-at-least-32';
function environment(values) {
  const env = { ...process.env, MOBILE_ENGINE_SHARED_SECRET: 'mobile-fixture-credential-at-least-32', ...values };
  for (const name of ['TESTENGINE_SHARED_SECRET', 'HELLOTEST_TESTENGINE_SECRET']) if (!Object.hasOwn(values, name)) delete env[name];
  return env;
}
function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} configuration failed: ${result.stderr}`);
  return result.stdout;
}
function compose(file, env) { return JSON.parse(run('docker', ['compose', '--env-file', '/dev/null', '-f', file, 'config', '--format', 'json'], env)); }

test('standalone engines use the API canonical credential with legacy alias fallback', { skip: !dockerAvailable }, () => {
  for (const values of [{ TESTENGINE_SHARED_SECRET: canonical }, { HELLOTEST_TESTENGINE_SECRET: alias }, { TESTENGINE_SHARED_SECRET: canonical, HELLOTEST_TESTENGINE_SECRET: alias }]) {
    const env = environment(values), expected = values.TESTENGINE_SHARED_SECRET || values.HELLOTEST_TESTENGINE_SECRET;
    for (const file of ['testengine/docker-compose.yml', 'testengine/docker-compose.deploy.yml']) {
      const config = compose(file, env);
      for (const name of ['testengine-api', 'testengine-web', 'testengine-android']) {
        assert.equal(config.services[name].environment.TESTENGINE_SHARED_SECRET, expected, `${file} ${name}`);
      }
    }
  }
});

test('generated Compose and Kubernetes stacks share the same browser/queue credential across API and engine', { skip: !dockerAvailable }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'hellotest-engine-credentials-'));
  try {
    for (const values of [{ TESTENGINE_SHARED_SECRET: canonical }, { HELLOTEST_TESTENGINE_SECRET: alias }, { TESTENGINE_SHARED_SECRET: canonical, HELLOTEST_TESTENGINE_SECRET: alias }]) {
      const env = { ...environment(values), HELLOTEST_ISOLATED_OUT_DIR: directory }, expected = values.TESTENGINE_SHARED_SECRET || values.HELLOTEST_TESTENGINE_SECRET;
      run('bash', ['scripts/deploy/provider-stack.sh', 'compose', 'config'], env);
      const config = compose(join(directory, 'docker-compose.isolated.yml'), env);
      assert.equal(config.services.api.environment.TESTENGINE_SHARED_SECRET, expected);
      assert.equal(config.services.testengine.environment.TESTENGINE_SHARED_SECRET, expected);
      run('bash', ['scripts/deploy/provider-stack.sh', 'k8s', 'config'], env);
      const manifests = yaml.parseAllDocuments(readFileSync(join(directory, 'hellotest-isolated.k8s.yaml'), 'utf8')).map(document => document.toJSON());
      assert.equal(manifests.find(item => item.kind === 'Secret').stringData['testengine-secret'], expected);
      for (const name of ['api', 'testengine']) {
        const container = manifests.find(item => item.kind === 'Deployment' && item.metadata.name === name).spec.template.spec.containers[0];
        const entry = container.env.find(item => item.name === 'TESTENGINE_SHARED_SECRET' || name === 'testengine' && item.name === 'HELLOTEST_TESTENGINE_SECRET');
        assert.equal(entry.valueFrom.secretKeyRef.key, 'testengine-secret');
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
