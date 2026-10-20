const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');
const { createPortableAutomationArtifact } = require('../../backend/lib/automationPortableArtifact');

const marker = { private_parameter_names: ['r.opaque_input'], parameter_overrides: ['r.opaque_input'] };
const privateValue = 'Private opaque field fixture 569';

test('a reviewed opaque secret stays private after its original empty environment or dataset is removed', () => {
  const configured = createBrowserParameterResolver({ materialize: false,
    environment: { variables: [{ key: 'r.opaque_input', value: '', is_secret: true }] }, buildParameterValues: { 'r.opaque_input': privateValue } });
  assert.ok(configured.privateParameterNames.includes('r.opaque_input'));
  const reopened = createBrowserParameterResolver({ materialize: false, caseValues: { 'r.opaque_input': privateValue, 'r.alias': privateValue, 't.public': 'Public fixture' }, caseOptions: marker });
  assert.equal(reopened.promptValues['r.opaque_input'], '@r.opaque_input');assert.equal(reopened.promptValues['r.alias'], '@r.alias');
  assert.equal(reopened.publicParameterValues['r.opaque_input'], undefined);assert.equal(reopened.publicParameterValues['r.alias'], undefined);
  assert.equal(reopened.resolve('browser_fill', { value: '@r.opaque_input' }).value, privateValue);
  assert.equal(reopened.projectPrivateText(`Captured ${privateValue}`), 'Captured [private parameter value]');
  assert.doesNotMatch(JSON.stringify(reopened.buildData({ testCaseId: 'automation' })), new RegExp(privateValue));
  const receipt = reopened.redactResult({ content: [{ type: 'text', text: JSON.stringify({ actual: privateValue }) }] });
  assert.doesNotMatch(JSON.stringify(receipt), new RegExp(privateValue));
  assert.doesNotMatch(JSON.stringify(marker), new RegExp(privateValue));
});

test('inherited private names do not require copying source options or values into the automation case', () => {
  const inherited = createBrowserParameterResolver({ materialize: false, caseValues: { 'r.opaque_input': privateValue }, privateParameterNames: ['r.opaque_input'] });
  assert.equal(inherited.publicParameterValues['r.opaque_input'], undefined);assert.equal(inherited.promptValues['r.opaque_input'], '@r.opaque_input');
  assert.equal(inherited.resolve('browser_assert', { value: '@r.opaque_input' }).value, privateValue);
});

test('portable exports honor persisted opaque private names and aliases while deliberate private empties remain runnable defaults', async () => {
  for (const test_data_options of [marker, JSON.stringify(marker)]) {
    const source = await createPortableAutomationArtifact({ testCase: { id: 'automation', title: 'Private marker export', test_data_options },
      updates: [{ step: { id: 'step', step_order: 1, action: 'Enter opaque input' }, automation_code: 'await page.locator("#input").fill("@r.opaque_input");' }],
      values: { 'r.opaque_input': privateValue, 'r.alias': privateValue, 't.public': 'Public fixture' } });
    assert.doesNotMatch(source, new RegExp(privateValue));assert.match(source, /Public fixture/);assert.match(source, /@r\.opaque_input/);
    assert.match(source, /QAIRA_DATA_JSON/);
  }
  const empty = await createPortableAutomationArtifact({ testCase: { id: 'automation', title: 'Empty private marker', test_data_options: marker }, updates: [], values: { 'r.opaque_input': '' } });
  const defaults = JSON.parse(empty.match(/const rows: DataValues\[\] = ([\s\S]*?);/)[1]);assert.deepEqual(defaults, [{ 'r.opaque_input': '' }]);
});
