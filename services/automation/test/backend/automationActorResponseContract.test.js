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
  assert.deepEqual(contract.envelope,{stage:'act',step_id:'current'});
  assert.ok(contract.choices.some(choice => choice.section_complete === false));
  for(const choice of contract.choices){assert.equal(Object.hasOwn(choice,'stage'),false);assert.equal(Object.hasOwn(choice,'step_id'),false);}
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
 assert.match(contract.question,/ONE flat JSON choice, not this contract\/menu/);
 assert.match(rules,/broader constraints never authorize later actions/);
 assert.match(rules,/Visible inputs\/data grant no fill/);
 assert.match(rules,/section_complete:true with final checks, no ack turn/);
 assert.match(rules,/Host review follows actual success/);
 assert.match(rules,/every outcome\/literal/);
 assert.match(rules,/scoped input\/recipient refs/);
 assert.match(rules,/Vanished notices\/other-target failures prove no absence/);
 assert.match(rules,/Sent code is not delivered email; never repeat submission/);
 assert.match(rules,/host validation \+ independent review/);
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
  assert.match(contract.rules.join('\n'),/no browser\/context\/discovery requests/);
  assert.doesNotMatch(contract.rules.join('\n'),/Batch the remaining supported actions|same response/);
});

test('compact common identity preserves every explicit decision and the exact authored active goal within a bounded prompt',()=>{
 const goal={action:'Enter @r.email only; preserve the reviewed tenant and do not submit.',expected_result:'The exact @r.email value remains and the tenant is unchanged.'};
 const contract=automationActorResponseContract({stepId:'current',activeGoal:goal,canRequestContext:true,canRecoverPrerequisite:true,deferredTools:['browser_fill']});
 assert.deepEqual(contract.active_goal,goal);assert.equal(contract.active_goal_scope,'current_section');
 for(const choice of contract.choices.filter(choice=>Array.isArray(choice.tool_calls))){
  const result=normalize(choice);assert.equal(result.issues,undefined);
  assert.equal(result.response.stage,contract.envelope.stage);assert.equal(result.response.step_id,contract.envelope.step_id);
  assert.equal(result.response.section_complete,choice.section_complete);assert.equal(result.response.tool_calls,choice.tool_calls);
  assert.equal(Object.hasOwn(result.response,'assertion_outcome'),false);
 }
 const discovery=contract.choices.find(choice=>choice.tool_catalog_request);
 assert.ok(Array.isArray(discovery.tool_catalog_request)&&discovery.tool_catalog_request.length>0);
 const base=automationActorResponseContract({stepId:'current',canRequestContext:true,canRecoverPrerequisite:true,deferredTools:['browser_fill']});
 assert.ok(Buffer.byteLength(JSON.stringify(base))<=1900,'The full decision menu stays below the measured provider-capacity budget (previously2644bytes).');
});

test('copied decision menus are rejected before accompanying tools while flat choices and legacy source remain valid',()=>{
 const contract=automationActorResponseContract({stepId:'current',canRequestContext:true,deferredTools:['browser_hover']});
 for(const copy of [contract,{question:contract.question,envelope:contract.envelope,choices:contract.choices},
  {question:contract.question,choices:contract.choices,rules:contract.rules},
  {...contract,tool_calls:[fill()],section_complete:true}]){
  const before=structuredClone(copy),result=normalize(copy);
  assert.deepEqual(result.issues,[{field:'response',expected:'ONE flat JSON choice, not the contract/menu'}]);
  assert.equal(result.response,undefined);assert.deepEqual(copy,before);
  assert.doesNotMatch(JSON.stringify(result.issues),/observed-email|@t\.email/);
 }
 const flat={question:'Optional explanation',section_complete:true,tool_calls:[fill()]};
 assert.equal(normalize(flat).issues,undefined);assert.equal(normalize(flat).response.tool_calls,flat.tool_calls);
 const legacy={stage:'source',steps:[{step_id:'current',automation_code:'await web.expectVisible("#email");'}],notes:{question:contract.question,choices:contract.choices}};
 assert.equal(normalize(legacy).response,legacy,'A nested application note is not a copied top-level actor menu.');
});
