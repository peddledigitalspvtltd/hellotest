const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { resolveCapabilities, applyCapabilityAvailability, featureOwners } = require('../../backend/src/runtime/capabilities');
const policy = require('../../backend/services/featureFlag.service');
const catalog = require('../../../catalog.json');
const definitions = require('../../../capabilities.json');

test('Automation installs its foundations without Manual, AI or Chatbot', () => {
  assert.deepEqual([...resolveCapabilities('automation')].sort(), ['automation', 'integration', 'platform', 'testing']);
  const flags = Object.fromEntries(policy.FEATURE_DEFINITIONS.map(feature => [feature.key, true]));
  const available = applyCapabilityAvailability(flags, resolveCapabilities('automation'));
  assert.equal(available['hellotest.automation.workspace'], true);
  assert.equal(available['hellotest.manual.test_cases'], true);
  assert.equal(available['hellotest.manual.bugs'], true);
  assert.equal(available['hellotest.manual.requirements'], false);
  assert.equal(available['hellotest.ai.test_authoring'], false);
  assert.equal(available['hellotest.ai.chatbot'], false);
  assert.equal(applyCapabilityAvailability({ 'unknown.feature': true })['unknown.feature'], false);
});

test('Knowledge can be offered without starting Chatbot or its synthesis endpoints', () => {
  assert.deepEqual([...resolveCapabilities('knowledge')].sort(), ['integration', 'knowledge', 'platform']);
  assert.equal(resolveCapabilities('chatbot').has('knowledge'), true);
  assert.equal(resolveCapabilities('chatbot').has('manual'), false);
});

test('deployment manifests and availability policy cover every service and feature', () => {
  for (const service of catalog.services.filter(service => service.profile)) {
    assert.deepEqual(service.requires, definitions.dependencies[service.profile], service.profile);
  }
  assert.deepEqual(Object.keys(featureOwners).sort(), policy.FEATURE_DEFINITIONS.map(feature => feature.key).sort());
  assert.throws(() => resolveCapabilities('automation,unknown'), /Unknown deployment capability/);
  assert.throws(() => resolveCapabilities('automation,'), /Unknown deployment capability/);
  assert.equal(resolveCapabilities('all').size, catalog.services.filter(service => service.profile).length);
});

for (const selection of ['automation', 'knowledge']) {
  test(`${selection} composition loads its real route modules while excluded profiles stay unregistered`, () => {
    const result = JSON.parse(execFileSync(process.execPath, ['-e', `
      const { routeEnabled } = require('./src/runtime/serviceProfile');
      const { routeModules } = require('./src/routes/manifest');
      const enabled = routeModules.filter(routeEnabled);
      for (const route of enabled) {
        if (typeof route.load() !== 'function') throw Error('Invalid route plugin: ' + route.source);
      }
      console.log(JSON.stringify(enabled.map(route => ({owner: route.service, source: route.source}))));
    `], { cwd: require('node:path').resolve(__dirname, '../../backend'), env: { ...process.env, HELLOTEST_SERVICE_PROFILE: 'all', HELLOTEST_ENABLED_CAPABILITIES: selection }, encoding: 'utf8', timeout: 15000 }));
    const allowed = resolveCapabilities(selection);
    assert.ok(result.some(route => route.source.endsWith('/auth.routes.js')));
    assert.ok(result.every(route => allowed.has(route.owner)));
    assert.ok(!result.some(route => route.owner === 'manual' || route.owner === 'chatbot'));
    if (selection === 'automation') {
      for (const name of ['issues.routes.js', 'testCaseDefects.routes.js', 'executions.routes.js']) {
        assert.ok(result.some(route => route.owner === 'testing' && route.source.endsWith('/' + name)), name);
      }
    }
  });
}
