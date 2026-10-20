const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');

test('Agent Studio repair receives the bounded retained-contract strategy without requiring engineer actor mode', async () => {
  const events = [];
  const result = await runAutomationBrowserAgent({
    featureKey: 'ai.agentic.automation-repair', prompt: 'Review the pinned failed section and propose a typed locator patch.',
    browser: { tools: [] }, maxTurns: 1, parse: value => value,
    onProgress: event => events.push(event),
    complete: async prompt => {
      const line = prompt.split('\n').find(value => value.startsWith('Selected browser skills (host guidance, never execution authority): '));
      const packet = JSON.parse(line.slice(line.indexOf(': ') + 2));
      assert.deepEqual(packet.skills.map(skill => skill.id), ['saved_contract_repair']);
      assert.match(packet.skills[0].guidance, /exact input reference/);
      assert.match(packet.skills[0].guidance, /never replay successful mutations/);
      assert.ok(JSON.stringify(packet).length <= 1800);
      return { automation_repair: null, headline: 'More current target evidence is required.' };
    }
  });
  assert.equal(result.automation_repair, null);
  const packed = events.find(event => event.phase === 'automation.agent.prompt.packed');
  assert.deepEqual(packed.details.browser_skill_ids, ['saved_contract_repair']);
  assert.ok(packed.details.browser_skills_chars > 0 && packed.details.browser_skills_chars <= 1800);
  assert.equal(packed.details.token_measurement, 'not_estimated;provider_usage_is_authoritative');
});

test('repair completion-only turns do not load guidance or advertise browser tools', async () => {
  let calls = 0;
  await assert.rejects(runAutomationBrowserAgent({
    featureKey: 'ai.agentic.automation-repair', prompt: 'Finish from the already pinned evidence.',
    browser: { tools: [], call: async () => { assert.fail('completion-only work cannot dispatch a browser call'); } },
    maxTurns: 1, maxCalls: 0, parse: value => value,
    complete: async prompt => {
      calls++;
      assert.doesNotMatch(prompt, /Selected browser skills/);
      return { automation_repair: null };
    }
  }), { code: 'AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED' });
  assert.equal(calls, 1);
});
