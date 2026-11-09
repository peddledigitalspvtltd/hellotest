const test = require('node:test');
const assert = require('node:assert/strict');
const { optionLocatorNameBinding, selectionLocatorNameBinding, canonicalIssuedOptionRequest, createOptionParameterBinding } = require('../../backend/lib/automationOptionParameterBinding');
const { createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');
const { recordBrowserOperation, recordedSectionRequests, actorOperationState } = require('../../backend/lib/automationBrowserRecording');
const { stampObservation, exactLinearCoverage, reconcileAction } = require('../../backend/lib/automationActionReconciliation');
const { compileRecordedProgram } = require('../../backend/lib/automationRecordedProgram');
const { createRetainedAssertionContract, retainedActionProgress } = require('../../backend/lib/automationRetainedAssertions');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { deriveProgramTools } = require('../../backend/lib/automationProgramTools');
const { prepareVerificationSections } = require('../../backend/lib/automationVerificationSections');
const name = 'First synthetic location', key = 'r.location';
const locator = value => `getByRole("option", ${JSON.stringify({ name: value, exact: true })})`;
const click = value => ({ name: 'browser_click', arguments: { locator: value } });
const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://fixture.test/', ...value }) }] });
const element = (value = name) => ({ tag: 'li', accessible_role: 'option', accessible_name: value,
  locators_validated: true, displayed: true, locator_candidates: [locator(value), '#choice'] });
const snapshot = (elements = [element()], extra = {}) => ({ tool: 'browser_snapshot', result: receipt({ observation_id: 'current', scope: 'body', elements, ...extra }) });
function fixture({ value = name, action = 'Select Location @r.location.', values = {}, privateNames = [] } = {}) {
  const resolver = createBrowserParameterResolver({ caseValues: { [key]: value, ...values }, privateParameterNames: privateNames });
  const obligations = [{ id: 'current', source: 'section', action, expected_result: 'Location retains @r.location.' }];
  const bindings = [{ obligation_id: 'current', action_parameters: resolver.referencedParameterNames([{ action, expected_result: '' }]), expected_result_parameters: [key] }];
  const privateKeys = new Set(resolver.privateParameterNames);
  const publicValues = new Map(bindings[0].action_parameters.filter(name => !privateKeys.has(name)).map(name => [name, resolver.promptValues[name]]));
  const policy = createOptionParameterBinding({ stepId: 'current', obligations, bindings, publicValues });
  return { resolver, obligations, policy };
}
function confirmed(request, page, extra = {}) {
  const observation = { tool: request.name, mcp_call: true, execution_step_id: 'current', action_id: 'single-click',
    result: receipt({ action_outcome: 'completed', ...extra }) };
  stampObservation(observation, request); recordBrowserOperation(observation, request, { snapshot: page }); return observation;
}

test('the option name binding grammar admits one whole scoped name and no other locator operation', () => {
  assert.deepEqual(optionLocatorNameBinding('page.getByRole("option", {exact:true,name:"@r.location"});'), { key, reference: '@r.location', name: '@r.location' });
  for (const candidate of ['getByRole("button",{name:"@r.location",exact:true})', 'getByRole("option",{name:"@r.location"})',
    'getByRole("option",{name:"@r.location",exact:false})', 'getByRole("option",{name:"Prefix @r.location",exact:true})',
    'getByRole("option",{name:"@r.location",exact:true}).first()', 'getByRole("option",{name:params["r.location"],exact:true})',
    'getByRole("option",{name:"@r.location",exact:true}); page.click("#other")', '[data-name="@r.location"]']) assert.equal(optionLocatorNameBinding(candidate), null, candidate);
});

test('two frozen public selections keep literal native dispatch and identical symbolic saved source', () => {
  const sources = [];
  for (const value of [name, 'Second "quoted" location @r.other']) {
    const { policy } = fixture({ value }), page = snapshot([element(value)]), original = click('#choice');
    const request = policy.canonicalize(original, { snapshot: page });
    assert.equal(request.arguments.locator, '#choice', 'native node/locator stays literal');
    assert.equal(original.arguments.locator, '#choice');
    const record = confirmed(request, page), operations = recordedSectionRequests([record], 'current');
    assert.equal(operations[0].arguments.locator, locator('@r.location'));
    const source = compileRecordedProgram([...operations, { name: 'browser_assert', arguments: { assertion: 'value', locator: '#location', value: '@r.location' } }]).source;
    assert.ok(!source.includes(value)); sources.push(source);
    const execution = { required: true, step_id: 'current', expected_result: 'Location retains @r.location.' }, payload = { steps: [{ step_id: 'current', automation_code: source }] };
    assert.equal(exactLinearCoverage({ payload, execution, observations: [record] }).missing_action_count, 0);
    assert.ok(reconcileAction({ payload, execution, request: click(locator('@r.location')), observations: [record] }));
    assert.equal(actorOperationState({ request, requestIndex: 0, batch: [request], observations: [record], stepId: 'current' }).reused, true);
  }
  assert.equal(sources[0], sources[1]);
});

test('host option correspondence cannot survive JSON/spread copies, changed snapshots or another section', () => {
  const { policy } = fixture(), page = snapshot(), request = policy.canonicalize(click('#choice'), { snapshot: page });
  assert.equal(canonicalIssuedOptionRequest(request).arguments.locator, locator('@r.location'));
  for (const copy of [structuredClone(request), { ...request, arguments: { ...request.arguments } }]) assert.equal(canonicalIssuedOptionRequest(copy), copy);
  assert.equal(canonicalIssuedOptionRequest(request, { stepId: 'other' }), request);
  assert.equal(canonicalIssuedOptionRequest(request, { snapshot: snapshot() }), request);
  page.result = receipt({ observation_id: 'changed', elements: [element()] });
  assert.equal(canonicalIssuedOptionRequest(request), request);
});

test('only explicitly authored public selections with complete unique native option evidence can bind', () => {
  const page = snapshot();
  for (const settings of [{ action: 'Click a fixed location.' }, { action: 'Verify @r.location.' }, { action: 'Do not select @r.location.' },
    { privateNames: [key] }, { values: { 'r.secret': name }, privateNames: ['r.secret'] }, { action: 'Choose @r.location and @r.other.', values: { 'r.other': name } }]) {
    const { policy } = fixture(settings), request = click('#choice');
    assert.equal(policy.canonicalize(request, { snapshot: page }), request);
    assert.throws(() => policy.resolveOptionRequest(click(locator('@r.location')), { snapshot: page }), { code: 'AUTOMATION_OPTION_PARAMETER_BINDING_INVALID' });
  }
  const { policy } = fixture();
  for (const bad of [snapshot([element(), element()]), snapshot([{ ...element(), accessible_name_truncated: true }]),
    snapshot([{ ...element(), locators_validated: false }]), snapshot([{ ...element(), accessible_role: 'button' }]),
    snapshot([{ ...element(), locator_candidates: ['#choice'] }]), snapshot([{ ...element(), accessible_name: 'Other' }])]) {
    const request = click('#choice'); assert.equal(policy.canonicalize(request, { snapshot: bad }), request);
    assert.throws(() => policy.resolveOptionRequest(click(locator('@r.location')), { snapshot: bad }), { code: 'AUTOMATION_OPTION_PARAMETER_BINDING_INVALID' });
  }
  const partial = snapshot([element()], { partial: true, fields_truncated: true });
  assert.notEqual(policy.canonicalize(click('#choice'), { snapshot: partial }).arguments.locator, locator('@r.location'), 'dispatch remains literal even for a complete uniquely grounded option inside partial page');
  assert.equal(canonicalIssuedOptionRequest(policy.canonicalize(click('#choice'), { snapshot: partial })).arguments.locator, locator('@r.location'));
});

test('native select proxy attestation binds scoped exact text without inventing option role or rewriting CSS', () => {
  const scope = '.select-wrapper:has(select#eventTemplate) > ul.dropdown-content';
  const scoped = text => `locator(${JSON.stringify(scope)}).getByText(${JSON.stringify(text)}, {"exact":true})`;
  assert.deepEqual(selectionLocatorNameBinding(scoped('@r.location')), { key, reference: '@r.location', name: '@r.location', scope });
  const sources = [];
  for (const value of [name, 'Second "quoted" template @r.other']) {
    const { policy } = fixture({ value, action: 'Choose onboarding template @r.location.' });
    const row = { tag: 'span', text: value, displayed: true, locators_validated: true, locator_candidates: ['#choice', scoped(value)],
      selection_option: { kind: 'native_select_proxy', menu_scope: scope, option_label: value } };
    const page = snapshot([row]), request = policy.canonicalize(click('#choice'), { snapshot: page });
    assert.equal(row.accessible_role, undefined); assert.equal(request.arguments.locator, '#choice');
    const observation = confirmed(request, page), operations = recordedSectionRequests([observation], 'current');
    assert.equal(operations[0].arguments.locator, scoped('@r.location'));
    const source = compileRecordedProgram([...operations, { name: 'browser_assert', arguments: { assertion: 'value', locator: '#template', value: '@r.location' } }]).source;
    assert.ok(!source.includes(value)); sources.push(source);
    const step = { id: 'current', step_type: 'web', automation_code: source };
    assert.equal(prepareVerificationSections([step], { resolve: (_name, args) => args }, { sourceOnly: true }).sections.length, 1);
    assert.equal(deriveProgramTools({ payload: { steps: [{ step_id: 'current', automation_code: source }] }, execution: { required: true, step_id: 'current' } })[0].arguments.locator, scoped('@r.location'));
    const payload = { steps: [{ step_id: 'current', automation_code: source }] }, execution = { required: true, step_id: 'current', expected_result: 'The template retains @r.location.' };
    assert.equal(exactLinearCoverage({ payload, execution, observations: [observation] }).missing_action_count, 0);
    assert.ok(reconcileAction({ payload, execution, request: click(scoped('@r.location')), observations: [observation] }));
    assert.equal(actorOperationState({ request, requestIndex: 0, batch: [request], observations: [observation], stepId: 'current' }).reused, true);
    const contract = createRetainedAssertionContract({ step });
    assert.equal(contract.status, 'available');
    assert.equal(retainedActionProgress({ contract, stepId: 'current', operations }).complete, true);
    const resolved = policy.resolveOptionRequest(click(scoped('@r.location')), { snapshot: page });
    assert.equal(resolved.arguments.locator, scoped(value));
    const wrongScope = '.select-wrapper:has(select#otherTemplate) > ul.dropdown-content';
    assert.throws(() => policy.resolveOptionRequest(click(scoped('@r.location').replace(scope, wrongScope)), { snapshot: page }), { code: 'AUTOMATION_OPTION_PARAMETER_BINDING_INVALID' });
    for (const changed of [{ selection_option: undefined }, { text_truncated: true }, { text: 'Other template' },
      { locator_candidates: ['#choice'] }, { selection_option: { kind: 'native_select_proxy', menu_scope: 'body', option_label: value } }]) {
      const invalidPage = snapshot([{ ...row, ...changed }]), proposed = click('#choice');
      assert.equal(policy.canonicalize(proposed, { snapshot: invalidPage }), proposed);
      assert.throws(() => policy.resolveOptionRequest(click(scoped('@r.location')), { snapshot: invalidPage }), { code: 'AUTOMATION_OPTION_PARAMETER_BINDING_INVALID' });
    }
  }
  assert.equal(sources[0], sources[1]);
  for (const invalid of ['locator("body").getByText("@r.location",{exact:true})', scoped('@r.location') + '.first()',
    scoped('prefix @r.location'), scoped('@r.location').replace('"exact":true', '"exact":false'),
    scoped('@r.location').replace('getByText', 'getByLabel')]) assert.equal(selectionLocatorNameBinding(invalid), null);
});

test('framed selection identity is preserved and stale document receipts cannot create source proof', () => {
  const { policy } = fixture(), extra = { frame_path: ['#work'], frame_url: 'https://fixture.test/frame', frame_document_id: 'doc1' }, page = snapshot([element()], extra);
  const wrong = click('#choice'); assert.equal(policy.canonicalize(wrong, { snapshot: page }), wrong);
  const original = { name: 'browser_click', arguments: { locator: '#choice', frame: ['#work'] } }, request = policy.canonicalize(original, { snapshot: page });
  const stale = confirmed(request, page, { ...extra, frame_document_id: 'doc2' }); assert.equal(recordedSectionRequests([stale], 'current').length, 0);
  const good = confirmed(request, page, extra); assert.equal(recordedSectionRequests([good], 'current')[0].arguments.locator, locator('@r.location'));
  assert.deepEqual(recordedSectionRequests([good], 'current')[0].arguments.frame, ['#work']);
});

test('a symbolic saved option is resolved only to its fresh observed literal alias and retained exact prefix', () => {
  const { policy } = fixture(), page = snapshot(), symbolic = click(locator('@r.location'));
  const resolved = policy.resolveOptionRequest(symbolic, { snapshot: page }); assert.equal(resolved.arguments.locator, locator(name));
  const request = policy.canonicalize(resolved, { snapshot: page }), observation = confirmed(request, page);
  const source = compileRecordedProgram([symbolic, { name: 'browser_assert', arguments: { assertion: 'value', locator: '#location', value: '@r.location' } }]).source;
  const contract = createRetainedAssertionContract({ step: { id: 'current', step_type: 'web', automation_code: source } });
  assert.equal(contract.status, 'available');
  assert.equal(retainedActionProgress({ contract, stepId: 'current', operations: recordedSectionRequests([observation], 'current') }).complete, true);
});

test('the real actor dispatches one literal option click, rejects forged selection references and saves only canonical reviewed source', async () => {
  const { policy, obligations } = fixture(), page = snapshot([element(), { tag: 'input', accessible_role: 'textbox', accessible_name: 'Location', attributes: { id: 'location' }, locators_validated: true, locator_candidates: ['#location'] }]);
  const calls = [], saves = []; let actors = 0, reviews = 0;
  const result = await runAutomationBrowserAgent({ actorMode: true, inputParameterBinding: policy, parse: JSON.parse, prompt: 'Select the authored location and prove its value.', maxTurns: 3,
    browser: { tools: ['browser_click', 'browser_snapshot', 'browser_assert'].map(name => ({ name, inputSchema: { type: 'object' } })),
      call: async (name, args) => { calls.push({ name, args }); return name === 'browser_snapshot' ? page.result : receipt(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' }); } },
    execution: { required: true, semantic_review_required: true, step_id: 'current', action: obligations[0].action, expected_result: obligations[0].expected_result, obligations, source_obligations: obligations },
    initialObservations: [{ ...page, execution_step_id: 'current' }], onPartialBuild: async payload => { saves.push(payload); return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"kind":"automation_section_semantic_review"')) { reviews++; const packet = JSON.parse(prompt.split('\n').at(-1)); return JSON.stringify({ decision: 'accept', obligations: packet.obligations.map(goal => ({ id: goal.id, action_operations: [1], assertion_operations: [2] })), issues: [] }); }
      actors++; return JSON.stringify({ section_complete: true, tool_calls: actors === 1 ? [click(locator('@r.forged'))]
        : [click(locator('@r.location')), { name: 'browser_assert', arguments: { assertion: 'value', locator: '#location', value: '@r.location' } }] });
    } });
  assert.equal(actors, 2); assert.equal(reviews, 1); assert.equal(saves.length, 1);
  assert.equal(calls.filter(x => x.name === 'browser_click').length, 1);
  assert.equal(calls.find(x => x.name === 'browser_click').args.locator, locator(name));
  assert.match(result.steps[0].automation_code, /@r\.location/); assert.ok(!result.steps[0].automation_code.includes(name));
});
