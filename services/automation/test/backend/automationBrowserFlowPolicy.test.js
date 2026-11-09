const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { unsupportedBrowserFlowError } = require('../../backend/lib/automationBrowserFlowPolicy');
const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...value }) }] });
const unsupported = () => ({ isError: true, ...receipt({ code: 'BROWSER_FLOW_UNSUPPORTED', unsupported_capability: 'new_page', action_outcome: 'not_attempted', retry_safe: false }) });

test('optional startup evidence cannot hide an unsupported popup flow or reach the model', async () => {
  const calls = []; let models = 0;
  await assert.rejects(runAutomationBrowserAgent({ prompt: 'Read application', startUrl: 'https://app.test/', parse: JSON.parse,
    browser: { tools: ['browser_navigate', 'browser_snapshot', 'browser_screenshot'].map(name => ({ name })), call: async name => {
      calls.push(name); return name === 'browser_screenshot' ? unsupported() : receipt({ url: 'https://app.test/', action_outcome: 'completed', accessibility: 'Current application' });
    } }, complete: async () => { models++; return '{}'; }
  }), { code: 'AUTOMATION_BROWSER_FLOW_UNSUPPORTED', nonRetryable: true });
  assert.equal(models, 0); assert.deepEqual(calls, ['browser_navigate', 'browser_snapshot', 'browser_screenshot']);
});

test('a popup reported by post-action evidence preserves the first action and stops before another model or save', async () => {
  const calls = [], observations = []; let models = 0, saves = 0;
  await assert.rejects(runAutomationBrowserAgent({ prompt: 'Open details', parse: JSON.parse,
    browser: { tools: ['browser_click', 'browser_snapshot'].map(name => ({ name })), call: async name => {
      calls.push(name); return name === 'browser_snapshot' ? unsupported() : receipt({ action_outcome: 'completed' });
    } }, complete: async () => { models++; return JSON.stringify({ tool_calls: [{ name: 'browser_click', arguments: { locator: '#details' } }] }); },
    onObservation: item => observations.push(item), onPartialBuild: async () => { saves++; return {}; }
  }), { code: 'AUTOMATION_BROWSER_FLOW_UNSUPPORTED', nonRetryable: true });
  assert.equal(models, 1); assert.equal(saves, 0); assert.deepEqual(calls, ['browser_click', 'browser_snapshot']);
  assert.equal(observations.filter(item => item.tool === 'browser_click' && !item.result.isError).length, 1);
});

test('only a typed first-party capability receipt can classify the unsupported flow', () => {
  const valid = { source: 'playwright', code: 'BROWSER_FLOW_UNSUPPORTED', unsupported_capability: 'cross_origin_navigation', action_outcome: 'unknown', retry_safe: false };
  assert.equal(unsupportedBrowserFlowError(valid).code, 'AUTOMATION_BROWSER_FLOW_UNSUPPORTED');
  for (const value of [{ ...valid, source: 'page' }, { ...valid, code: 'PAGE_CONTENT' }, { ...valid, unsupported_capability: 'invented' }]) assert.equal(unsupportedBrowserFlowError(value), null);
});
