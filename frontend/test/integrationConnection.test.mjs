import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
function load(file, api = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports, require: () => ({ api }), Date, setTimeout, clearTimeout, AbortController });
  return module.exports;
}
const { buildIntegrationConnectionInput, integrationConnectionHint } = load('../src/lib/integrationConnection.ts');
test('saved-profile test payloads contain only identity and type', () => {
  const value = buildIntegrationConnectionInput({ type: 'llm', api_key: '********', model: 'test' }, { id: 'saved', type: 'llm' }, true);
  assert.equal(JSON.stringify(value), JSON.stringify({ integration_id: 'saved', type: 'llm' }));
});
test('draft tests strip masked secrets, keep overrides and never attach another provider ID', () => {
  const value = buildIntegrationConnectionInput({ type: 'email', username: 'new-user', config: { password: '••••••', host: 'new-host' } }, { id: 'saved', type: 'email' });
  assert.equal(value.integration_id, 'saved'); assert.equal(value.config.password, undefined); assert.equal(value.config.host, 'new-host');
  assert.equal(buildIntegrationConnectionInput({ type: 'github' }, { id: 'saved', type: 'email' }).integration_id, undefined);
  assert.equal(Object.keys(integrationConnectionHint).length, 10);
});
test('native agent availability checks feature, project and server access, never guesses true', async () => {
  let reads = 0;
  const api = { featureFlags: { snapshot: async options => { assert.equal(options.fresh, true); assert.ok(options.signal); return { flags: { 'hellotest.ai.agentic_workflows': true } }; } }, agenticWorkflows: { list: async (query, options) => { reads++; assert.equal(query.project_id, 'p'); assert.equal(options.fresh, true); assert.ok(options.signal); return []; } } };
  const { testHelloTestRovoConnection } = load('../src/lib/rovo.ts', api);
  assert.equal((await testHelloTestRovoConnection({ projectId: '', canView: true })).available, false);
  assert.equal((await testHelloTestRovoConnection({ projectId: 'p', canView: false })).available, false);
  assert.equal(reads, 0);
  const result = await testHelloTestRovoConnection({ projectId: 'p', canView: true });
  assert.equal(result.available, true); assert.match(result.detail, /AI provider separately/); assert.equal(reads, 1);
  api.featureFlags.snapshot = async () => ({ flags: {} });
  assert.equal((await testHelloTestRovoConnection({ projectId: 'p', canView: true })).available, false);
  assert.equal(reads, 1);
});
