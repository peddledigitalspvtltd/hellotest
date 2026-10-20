const test = require('node:test');
const assert = require('node:assert/strict');
const { automationActorResponseContract, normalizeAutomationActorResponse } = require('../../backend/lib/automationActorResponseContract');

const fill = () => ({ name: 'browser_fill', arguments: { locator: 'ref:observed-email', value: '@t.email' } });
const normalize = value => normalizeAutomationActorResponse(value, { stepId: 'current' });

test('missing actor envelope fields are mechanical defaults and never infer inputs, assertions or completion', () => {
  const input = { tool_calls: [fill()] }, before = structuredClone(input);
  const result = normalize(input);
  assert.deepEqual(result.response, { ...input, stage: 'act', step_id: 'current', section_complete: false });
  assert.deepEqual(input, before);
  assert.equal(result.response.tool_calls, input.tool_calls, 'tool arguments are retained rather than synthesized');
  assert.equal(result.response.tool_calls[0].arguments.value, '@t.email');
  assert.equal(Object.hasOwn(result.response, 'automation_code'), false);
  assert.equal(Object.hasOwn(result.response, 'assertion_outcome'), false);
  const explicit = normalize({ stage: 'act', step_id: 'current', section_complete: true, tool_calls: [fill()] });
  assert.equal(explicit.response.section_complete, true, 'an explicit completion request remains subject to real host checks');
});

test('only absent metadata is defaulted; explicit conflicts and malformed action intent are rejected', () => {
  for (const response of [
    null, [], 'act',
    { stage: 'plan', tool_calls: [fill()] }, { stage: 'act', step_id: 'other', tool_calls: [fill()] },
    { tool_calls: [fill()], section_complete: 'true' }, { tool_calls: [fill()], section_complete: 1 },
    { tool_calls: { name: 'browser_fill', arguments: {} } }, { tool_calls: [null] },
    { tool_calls: [{ name: 'browser_fill', arguments: '@t.email' }] }, { tool_calls: [{ arguments: {} }] }
  ]) {
    const result = normalize(response);
    assert.ok(result.issues?.length, JSON.stringify(response));
    assert.equal(result.response, undefined);
    assert.doesNotMatch(JSON.stringify(result.issues), /observed-email|@t\.email/);
  }
});

test('one host-control disposition keeps precedence over accompanying actions without inventing a second decision', () => {
  for (const control of [
    { actor_context_request: { parameter_names: ['t.email'] } },
    { tool_catalog_request: ['browser_hover'] },
    { section_issue: { kind: 'unmet_prerequisite', reason: 'Observed dependency unavailable', evidence_refs: ['current-page'] } }
  ]) {
    const result = normalize({ ...control, tool_calls: [fill()] });
    assert.equal(result.issues, undefined, 'the host control branch preempts actions without a format-repair turn');
    for (const key of Object.keys(control)) assert.deepEqual(result.response[key], control[key]);
  }
  assert.ok(normalize({ actor_context_request: {}, tool_catalog_request: ['browser_hover'] }).issues);
  assert.ok(normalize({ actor_context_request: {}, section_issue: {} }).issues);
});

test('documented section issue with an empty tool array remains a valid report envelope', () => {
  const report = { stage: 'act', step_id: 'current', tool_calls: [], section_issue: {
    kind: 'unmet_prerequisite', reason: 'The current page requires an unavailable configured account.', evidence_refs: ['current-page']
  } };
  const result = normalize(report);
  assert.equal(result.issues, undefined);
  assert.notEqual(result.response.section_complete, true, 'an issue does not imply a completion request');
  assert.deepEqual(result.response.section_issue, report.section_issue);
});

test('legacy typed source stays a proposal for the existing compiler and is never rewritten into an inferred action', () => {
  const response = { stage: 'source', steps: [{ step_id: 'current', automation_code: 'await page.locator("#email").fill(params["t.email"]);' }] };
  assert.equal(normalize(response).response, response);
  assert.equal(normalize(response).response.tool_calls, undefined);
  assert.equal(normalize(response).response.section_complete, undefined);
  assert.ok(normalize({ ...response, step_id: 'other' }).issues, 'explicit conflicting identity is not silently corrected');
  const implicit = { steps: response.steps, tool_calls: [] };
  assert.equal(normalize(implicit).response, implicit);
  assert.equal(normalize(implicit).response.stage, undefined, 'legacy source with an empty tools array retains the existing lowering path');
});

test('current decision contract offers only available host decisions and does not advertise executable or arbitrary schemas', () => {
  const contract = automationActorResponseContract({ stepId: 'current', canRequestContext: true, deferredTools: ['browser_hover'] });
  assert.ok(contract.question);
  assert.ok(contract.choices.some(choice => choice.stage === 'act' && choice.step_id === 'current' && choice.section_complete === false));
  for (const choice of contract.choices) for (const tool of choice.tool_calls || []) {
    assert.ok(tool.arguments && typeof tool.arguments === 'object' && !Array.isArray(tool.arguments), 'decision examples must demonstrate an actual argument object');
  }
  assert.ok(contract.choices.some(choice => choice.section_complete === true && choice.tool_calls.length === 0));
  assert.ok(contract.choices.some(choice=>choice.section_complete===true&&choice.tool_calls?.length),'a final real check can request review in its actual batch instead of spending an acknowledgement turn');
  assert.ok(contract.choices.some(choice => Object.hasOwn(choice, 'actor_context_request')));
  assert.ok(contract.choices.some(choice => Object.hasOwn(choice, 'tool_catalog_request')));
  assert.ok(contract.choices.some(choice => Object.hasOwn(choice, 'section_issue')));
  assert.equal(Object.hasOwn(contract, 'output_schema'), false);
  assert.equal(Object.hasOwn(contract, 'inputSchema'), false);
  for (const choice of contract.choices) assert.equal(Object.hasOwn(choice, 'automation_code'), false);
  const unavailable = automationActorResponseContract({ stepId: 'current' });
  assert.ok(!unavailable.choices.some(choice => Object.hasOwn(choice, 'actor_context_request') || Object.hasOwn(choice, 'tool_catalog_request')));
});

test('the active-section contract preserves broader constraints while preventing available data from selecting later actions',()=>{
 const contract=automationActorResponseContract({stepId:'current'}),rules=contract.rules.join('\n');
 assert.match(contract.question,/pinned active section action and expected result only/);
 assert.match(rules,/broader user request\/flow supplies constraints and context/);
 assert.match(rules,/not permission to execute later actions now/);
 assert.match(rules,/visible input or available parameter does not request a fill/);
 assert.match(rules,/set section_complete:true in the same response/);
 assert.match(rules,/without a separate acknowledgement turn/);
 assert.match(rules,/Host review follows actual success/);
 assert.match(rules,/Preserve every authored outcome and literal/);
 const finalChoice=contract.choices.find(choice=>choice.section_complete===true&&choice.tool_calls?.length),normal=normalize(finalChoice);
 assert.equal(normal.response.section_complete,true);assert.deepEqual(normal.response.tool_calls,finalChoice.tool_calls);
 assert.equal(Object.hasOwn(normal.response,'assertion_outcome'),false,'the decision shape does not create success evidence');
});

test('completion-only decision contracts offer completion or an observed issue without asking for impossible browser actions', () => {
  const contract = automationActorResponseContract({ stepId: 'current', canRequestContext: true, deferredTools: ['browser_hover'], completionOnly: true });
  assert.ok(contract.choices.some(choice => choice.section_complete === true));
  assert.ok(contract.choices.some(choice => Object.hasOwn(choice, 'section_issue')));
  assert.ok(contract.choices.every(choice => !Object.hasOwn(choice, 'actor_context_request') && !Object.hasOwn(choice, 'tool_catalog_request')));
  assert.ok(contract.choices.every(choice => !Array.isArray(choice.tool_calls) || choice.tool_calls.length === 0));
  assert.match(contract.rules.join('\n'),/no further browser actions, context or discovery requests/);
  assert.doesNotMatch(contract.rules.join('\n'),/Batch the remaining supported actions|same response/);
});
