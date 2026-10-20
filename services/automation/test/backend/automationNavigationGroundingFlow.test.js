const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { browserCurrentSnapshotObservation } = require('../../backend/lib/automationBrowserContext');
const { canonicalReviewEvidence } = require('../../backend/lib/automationReviewEvidence');
const { recordedSectionRequests } = require('../../backend/lib/automationBrowserRecording');

const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...value }) }] });
const snapshot = () => receipt({ observation_id: 'live-registration-form', url: 'https://app.test/auth', title: 'Sign in', scope: 'body',
  accessibility: '- heading "Create an account"\n- textbox "Full name"', elements: [
    { tag: 'h2', accessible_role: 'heading', accessible_name: 'Create an account', text: 'Create an account', displayed: true, locators_validated: true, locator_candidates: ['#registration-heading'] },
    { tag: 'input', accessible_role: 'textbox', accessible_name: 'Full name', displayed: true, locators_validated: true, locator_candidates: ['#full-name'] }
  ] });
const stateFrom = prompt => JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
const actor = tool_calls => JSON.stringify({ stage: 'act', step_id: 'registration', section_complete: true, tool_calls });

test('host navigation grounding preserves the live form and tool budget when rejecting an invented route', async () => {
  const initial = { tool: 'browser_snapshot', result: snapshot() }, observations = [initial], calls = [], events = [], saved = [];
  const catalog = ['browser_navigate', 'browser_assert', 'browser_snapshot'].map(name => ({ name, inputSchema: { type: 'object', additionalProperties: true } }));
  const originalSchema = structuredClone(catalog);
  let actors = 0, reviews = 0, beforeRejection;
  const result = await runAutomationBrowserAgent({
    browser: { tools: catalog, startUrl: 'https://app.test/', call: async (name, args) => {
      calls.push({ name, args });return name === 'browser_snapshot' ? snapshot() : receipt({ url: 'https://app.test/auth', assertion_outcome: 'satisfied' });
    } },
    actorMode: true, generationMode: 'sequential', execution: { required: true, semantic_review_required: true, step_id: 'registration',
      action: 'Open the registration page', expected_result: 'The registration form is displayed' },
    prompt: 'Complete the current manual requirement', parse: JSON.parse, maxCalls: 2, initialObservations: observations,
    onObservation: observation => observations.push(observation), onProgress: event => events.push(event),
    onPartialBuild: async payload => { saved.push(payload);return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"phase":"semantic_review"')) {
        reviews++;const packet = JSON.parse(prompt.split('\n').at(-1));
        assert.deepEqual(packet.confirmed_operations.map(item => item.name), ['browser_assert', 'browser_assert']);
        return JSON.stringify({ decision: 'accept', obligations: [{ id: 'registration', action_operations: [], assertion_operations: [1, 2] }], issues: [] });
      }
      const state = stateFrom(prompt);actors++;
      assert.ok(state.navigation_policy.grounded_urls.some(row => row.url === 'https://app.test/' && row.source === 'configured_start'));
      const encodedCatalog = JSON.parse(prompt.match(/^Tool catalog: (.+)$/m)[1]);assert.deepEqual(encodedCatalog, originalSchema);
      if (actors === 1) {
        beforeRejection = canonicalReviewEvidence({ observations, stepId: 'registration' });
        return actor([{ name: 'browser_navigate', arguments: { url: 'https://app.test/signup' } }]);
      }
      assert.equal(calls.length, 0, 'ungrounded URL never reaches MCP');
      assert.equal(browserCurrentSnapshotObservation(observations), initial, 'live snapshot identity is retained');
      assert.equal(state.current_snapshot.observation_id, 'live-registration-form');
      assert.deepEqual(canonicalReviewEvidence({ observations, stepId: 'registration' }), beforeRejection, 'no host action/failure epoch is manufactured');
      const budget = JSON.parse(prompt.match(/^Browser tool budget: (.+)$/m)[1]);assert.equal(budget.remaining_tool_calls, 2);
      const denied = observations.find(item => item.tool === 'automation_navigation_feedback');
      assert.equal(denied.mcp_call, false);assert.equal(JSON.parse(denied.result.content[0].text).code, 'AUTOMATION_NAVIGATION_URL_NOT_GROUNDED');
      return actor([{ name: 'browser_assert', arguments: { assertion: 'visible', locator: '#registration-heading' } },
        { name: 'browser_assert', arguments: { assertion: 'visible', locator: '#full-name' } }]);
    }
  });
  assert.equal(actors, 2);assert.equal(reviews, 1);assert.equal(saved.length, 1);
  assert.equal(calls.filter(item => item.name === 'browser_navigate').length, 0);
  assert.ok(events.every(event => event.details?.tool !== 'browser_navigate'));
  assert.equal(recordedSectionRequests(observations, 'registration').some(item => item.name === 'browser_navigate'), false);
  assert.doesNotMatch(result.steps[0].automation_code, /signup|goto/);
});
