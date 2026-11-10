const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');

function fixture({ resolve = async () => ({ id: 'model', model: 'fixture-model', base_url: 'https://provider.example.test' }), fetch }) {
  const filename = require.resolve('../../backend/services/aiTestDataGeneration.service');
  const local = createRequire(filename), module = { exports: {} };
  const dependencies = {
    '@hellotest/platform/backend/src/utils/aiInstructionBlocks': { aiInstructionBlock: () => 'Return the native JSON response contract.' },
    '@hellotest/integration/backend/services/aiLlmSelection.service': { resolveLlmIntegrationForUsage: resolve },
    '@hellotest/platform/backend/src/utils/llmHttpClient': { fetchLlmWithRetry: fetch },
    '@hellotest/platform/backend/src/security/aiTextPolicy': { sanitizeAiText: text => ({ text }) }
  };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(id => dependencies[id] || local(id), module, module.exports);
  return module.exports;
}
const input = { projectId: 'project', userId: 'actor', prompt: 'A fictional department name', sampleCount: 2 };

test('synthetic data cancellation reaches the in-flight provider request and keeps its original reason', async () => {
  const controller = new AbortController(), reason = Object.assign(new Error('Workflow deadline elapsed'), { code: 'DEADLINE_EXCEEDED' });
  let started;
  const dispatched = new Promise(resolve => { started = resolve; });
  const service = fixture({ fetch: async (_url, init) => {
    assert.equal(init.signal, controller.signal);
    started();
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  } });
  const pending = service.preview({ ...input, signal: controller.signal });
  await dispatched;
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
});

test('already cancelled generation does not resolve a model or dispatch a request', async () => {
  const controller = new AbortController(); controller.abort();
  const service = fixture({ resolve: async () => assert.fail('Cancelled work must not resolve an integration.'), fetch: async () => assert.fail('Cancelled work must not dispatch.') });
  await assert.rejects(service.preview({ ...input, signal: controller.signal }), { name: 'AbortError' });
});

test('permission revocation and rejected provider credentials retain their authorization failure', async () => {
  const denied = Object.assign(new Error('Project access was revoked'), { statusCode: 403 });
  const forbidden = fixture({ resolve: async () => { throw denied; }, fetch: async () => assert.fail('Revoked access must not dispatch.') });
  await assert.rejects(forbidden.preview(input), error => error === denied);
  const rejected = fixture({ fetch: async () => new Response('', { status: 401 }) });
  await assert.rejects(rejected.preview(input), { statusCode: 401 });
});
