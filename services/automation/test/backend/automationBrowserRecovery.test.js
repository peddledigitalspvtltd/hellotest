const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { browserPromptContext } = require('../../backend/lib/automationBrowserContext');
const { browserRecoveryState, recordBrowserCheck, browserCheckPromptDetails, repeatedUnsuccessfulCheck, unsuccessfulBrowserCheck } = require('../../backend/lib/automationBrowserRecovery');

const receipt = (value, isError = false) => ({ isError, content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test/auth', ...value }) }] });
const page = () => ({ observation_id: 'auth-page', url: 'https://app.test/auth', accessibility: '- textbox "Email"', elements: [{ tag: 'input', accessible_role: 'textbox', accessible_name: 'Email', attributes: { id: 'email-input' }, locators_validated:true, locator_candidates: ['#email-input'] }] });
const initial = () => [{ tool: 'browser_snapshot', result: receipt({ ...page(), observation_id: 'initial', captured_at: '2026-10-17T00:00:00Z' }) }];
const tools = ['browser_assert', 'browser_validate_locator', 'browser_snapshot', 'browser_screenshot', 'browser_click'].map(name => ({ name, inputSchema: { type: 'object' } }));
const execution = { required: true, step_id: 'signup', expected_result: 'The signup email input is visible' };
const actor = (tool_calls, complete = false) => JSON.stringify({ stage: 'act', step_id: 'signup', section_complete: complete, tool_calls });
const check = locator => ({ name: 'browser_assert', arguments: { assertion: 'visible', locator } });

test('an unsupported native assertion subject requires correction after one attempt, while observed error changes reopen validation', () => {
  const request={name:'browser_assert',arguments:{assertion:'field_valid',locator:'#email-input'}};
  const validationPage=()=>({...page(),elements:[{...page().elements[0],attributes:{id:'email-input','aria-describedby':'email-hint'}},
    {tag:'span',attributes:{id:'email-hint',role:'alert'},displayed:true,text:'Invalid entry'}]});
  const observations=[{tool:'browser_snapshot',result:receipt(validationPage())}];
  const failure={tool:'browser_assert',execution_step_id:'signup',arguments:request.arguments,
    result:receipt({code:'BROWSER_ASSERTION_SUBJECT_UNSUPPORTED',message:'The validation subject is unsupported.',action_outcome:'not_attempted'},true)};
  recordBrowserCheck(failure,request,browserRecoveryState(observations,request));observations.push(failure);
  const blocked=repeatedUnsuccessfulCheck({request,observations,stepId:'signup'});
  assert.equal(blocked.code,'BROWSER_ASSERTION_SUBJECT_UNSUPPORTED');assert.equal(blocked.failed_check_count,1);
  assert.match(blocked.message,/No second browser check/);
  observations.push({tool:'browser_snapshot',result:receipt({...validationPage(),elements:[validationPage().elements[0],
    {...validationPage().elements[1],text:'',displayed:false}]})});
  assert.equal(repeatedUnsuccessfulCheck({request,observations,stepId:'signup'}),null,'changed associated validation evidence reopens the native check');
  assert.equal(repeatedUnsuccessfulCheck({request:{...request,arguments:{...request.arguments,assertion:'valid'}},observations,stepId:'signup'}),null,'a supported different mode is not the same failed subject');
});

test('the actor never repeats an unsupported native subject on unchanged evidence', async () => {
  let assertions=0,turns=0;
  const browser={tools,call:async name=>{
    if(name==='browser_assert'){assertions++;return receipt({code:'BROWSER_ASSERTION_SUBJECT_UNSUPPORTED',message:'Inspect the native control and error associations.',action_outcome:'not_attempted'},true);}
    return receipt(page());
  }};
  await assert.rejects(runAutomationBrowserAgent({browser,prompt:'Verify the configured field',execution,actorMode:true,parse:JSON.parse,
    initialObservations:initial(),maxTurns:4,maxCalls:8,complete:async()=>{turns++;return actor([{name:'browser_assert',arguments:{assertion:'field_valid',locator:'#email-input'}}]);}}),
    {code:'AUTOMATION_BROWSER_CHECK_STALLED'});
  assert.equal(assertions,1);assert.equal(turns,3,'one recovery response is allowed before the unchanged unsupported proposal stops');
});

test('zero-match locator validation is failed evidence in the current summary even when MCP itself succeeded', () => {
  const observation = { tool: 'browser_validate_locator', execution_step_id: 'signup', arguments: { locator: 'getByRole("textbox", {name:"Email *"})' }, result: receipt({ match_count: 0, unique: false }) };
  const context = browserPromptContext([...initial(), observation], 'signup');
  assert.equal(context.current.recent_section_receipts[0].failed, true);
  assert.equal(context.current.recent_section_receipts[0].match_count, 0);
  assert.equal(context.current.recent_section_receipts[0].unique, false);
  assert.equal(context.current.latest_failure.code, 'BROWSER_LOCATOR_NOT_UNIQUE');
  assert.equal(context.current.latest_failure.match_count, 0);
  assert.match(context.current.latest_failure.message, /matches 0 elements/);
});

test('actual bad locator failure refreshes page evidence and repeated unchanged validation does not spend another MCP call', async () => {
  const calls = []; let turns = 0;
  const browser = { tools, call: async (name, args) => {
    calls.push({ name, args });
    if (name === 'browser_validate_locator') return receipt({ match_count: 0, unique: false });
    if (name === 'browser_assert' && args.locator !== '#email-input') return receipt({ code: 'BROWSER_ASSERTION_NOT_SATISFIED', message: 'No element matches the observed role/name.', assertion_outcome: 'not_satisfied', action_outcome: 'not_attempted', retry_safe: true }, true);
    return receipt(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { ...page(), observation_id: `snapshot-${calls.length}`, captured_at: new Date().toISOString() });
  } };
  // The role alias matched at capture time but becomes stale before dispatch.
  const validate = { name: 'browser_validate_locator', arguments: { locator: 'getByRole("textbox", {name:"Email *"})' } };
  const result = await runAutomationBrowserAgent({ browser, prompt: 'Reach signup', execution, actorMode: true, generationMode: 'sequential', parse: JSON.parse, initialObservations: [{tool:'browser_snapshot',result:receipt({...page(),elements:page().elements.map(element=>({...element,locator_candidates:[...element.locator_candidates,validate.arguments.locator]}))})}], maxCalls: 8,
    complete: async prompt => {
      turns++;
      if (turns === 1) return actor([check(validate.arguments.locator)]);
      if (turns === 2 || turns === 3) return actor([validate]);
      assert.match(prompt, /AUTOMATION_BROWSER_REPEATED_CHECK/);
      assert.match(prompt, /"match_count":0/);
      assert.match(prompt, /"unique":false/);
      const line=prompt.split('\n').find(value=>value.startsWith('Current browser state and confirmed section progress'));
      const current=JSON.parse(line.slice(line.indexOf(': ')+2));
      const target=current.current_snapshot.targets.find(item=>item.name==='Email');
      assert.ok(target?.ref);
      return actor([check(target.ref)], true);
    }, onPartialBuild: async () => ({ generation_complete: true }) });
  assert.equal(calls.filter(item => item.name === 'browser_validate_locator').length, 1);
  assert.equal(calls.filter(item => item.name === 'browser_snapshot').length, 2);
  assert.equal(calls.filter(item => item.name === 'browser_assert').length, 2);
  assert.match(result.steps[0].automation_code, /email-input/);
  assert.doesNotMatch(result.steps[0].automation_code, /Email \*/);
});

test('recovery fingerprints ignore snapshot timestamps and clones cannot manufacture failed-check authority', () => {
  const observations = initial(), request = { name: 'browser_validate_locator', arguments: { locator: '#absent' } };
  const failure = { tool: request.name, execution_step_id: 'signup', arguments: request.arguments, result: receipt({ match_count: 0, unique: false }) };
  recordBrowserCheck(failure, request, browserRecoveryState(observations, request));
  observations.push(failure, { tool: 'browser_snapshot', result: receipt({ ...page(), observation_id: 'new-id', captured_at: '2099-01-01T00:00:00Z' }) });
  assert.equal(repeatedUnsuccessfulCheck({ request, observations, stepId: 'signup' }).match_count, 0);
  assert.equal(repeatedUnsuccessfulCheck({ request, observations: JSON.parse(JSON.stringify(observations)), stepId: 'signup' }), null);
  observations.push({ tool: 'browser_snapshot', result: receipt({ ...page(), accessibility: '- textbox "Email"\n- button "Continue"' }) });
  assert.equal(repeatedUnsuccessfulCheck({ request, observations, stepId: 'signup' }), null);
});

test('a confirmed mutation permits checking the changed state while a reconciled old mutation does not manufacture new state', () => {
  const observations = initial(), request = { name: 'browser_validate_locator', arguments: { locator: '#new-input' } };
  const failure = { tool: request.name, execution_step_id: 'signup', arguments: request.arguments, result: receipt({ match_count: 0, unique: false }) };
  recordBrowserCheck(failure, request, browserRecoveryState(observations, request)); observations.push(failure);
  observations.push({ tool: 'automation_action_reconciliation', mcp_call: false, result: receipt({ action_outcome: 'completed' }) });
  assert.ok(repeatedUnsuccessfulCheck({ request, observations, stepId: 'signup' }));
  observations.push({ tool: 'browser_click', action_id: 'actual-click', result: receipt({ action_outcome: 'completed' }) });
  assert.equal(repeatedUnsuccessfulCheck({ request, observations, stepId: 'signup' }), null);
});

test('an assertion can settle on one bounded retry, while another identical failed retry on unchanged evidence is suppressed', async () => {
  let turns = 0, assertions = 0;
  const browser = { tools, call: async name => {
    if (name === 'browser_assert') { assertions++; return receipt({ code: 'BROWSER_ASSERTION_NOT_SATISFIED', assertion_outcome: 'not_satisfied', action_outcome: 'not_attempted', retry_safe: true }, true); }
    return receipt(page());
  } };
  await assert.rejects(runAutomationBrowserAgent({ browser, prompt: 'Verify signup', execution, actorMode: true, parse: JSON.parse, initialObservations: initial(), maxTurns: 3, maxCalls: 10,
    complete: async prompt => { turns++; if (turns === 3) assert.match(prompt, /BROWSER_ASSERTION_NOT_SATISFIED/); return actor([check('#email-input')]); }
  }), error => error.code === 'AUTOMATION_BROWSER_EXECUTION_INCOMPLETE');
  assert.equal(turns, 3); assert.equal(assertions, 2);
});

test('rewriting expected prose cannot reopen two failed assertions on the same unchanged target', async () => {
  let turns = 0, assertions = 0, snapshots = 0;
  const request = value => ({ name: 'browser_assert', arguments: { assertion: 'text_contains', locator: '#signup-heading', value } });
  const signup = () => ({ ...page(), accessibility: '- heading "Set up your access"\n- alert: Password is required.',
    elements: [{ tag: 'h2', accessible_role: 'heading', accessible_name: 'Set up your access', text: 'Set up your access', locators_validated: true, locator_candidates: ['#signup-heading'] }] });
  const browser = { tools, call: async name => {
    if (name === 'browser_assert') { assertions++; return receipt({ code: 'BROWSER_ASSERTION_NOT_SATISFIED', assertion_outcome: 'not_satisfied', action_outcome: 'not_attempted', retry_safe: true }, true); }
    assert.equal(name, 'browser_snapshot'); snapshots++;
    return receipt({ ...signup(), observation_id: `new-${snapshots}`, captured_at: new Date().toISOString() });
  } };
  await assert.rejects(runAutomationBrowserAgent({ browser, prompt: 'Enter the configured email and confirm a verification code was sent', execution, actorMode: true, parse: JSON.parse,
    initialObservations: [{ tool: 'browser_snapshot', result: receipt({ ...signup(), observation_id: 'initial' }) }], maxTurns: 5, maxCalls: 8,
    complete: async prompt => {
      turns++;
      if (turns >= 4) {
        assert.match(prompt, /AUTOMATION_BROWSER_REPEATED_CHECK/);
        assert.match(prompt, /"failed_check_count":2/);
        assert.match(prompt, /"remaining_unchanged_state_retries":0/);
        assert.match(prompt, /Password is required/);
      }
      return actor([request(turns % 2 ? 'A verification code has been sent' : 'A message indicating a verification code has been sent')]);
    }, onPartialBuild: async () => assert.fail('an unsatisfied expected result cannot save the section')
  }), error => error.code === 'AUTOMATION_BROWSER_CHECK_STALLED');
  assert.equal(turns, 4); assert.equal(assertions, 2); assert.equal(snapshots, 2);
});

test('failed-target recovery permits a corrected target or mode and reopens checks after real state changes', () => {
  const observations = initial();
  const request = value => ({ name: 'browser_assert', arguments: { assertion: 'text_contains', locator: '#heading', value } });
  for (const value of ['Code sent', 'Verification sent']) {
    const actual = { tool: 'browser_assert', execution_step_id: 'signup', arguments: { assertion: 'text_contains', locator: '#heading', value: '[redacted]' }, result: receipt({ assertion_outcome: 'not_satisfied' }, true) };
    recordBrowserCheck(actual, request(value), browserRecoveryState(observations, request(value))); observations.push(actual);
  }
  assert.equal(repeatedUnsuccessfulCheck({ request: request('Different guess'), observations, stepId: 'signup' }).failed_check_count, 2);
  assert.equal(repeatedUnsuccessfulCheck({ request: { ...request('Code sent'), arguments: { ...request('Code sent').arguments, locator: '#status' } }, observations, stepId: 'signup' }), null);
  assert.equal(repeatedUnsuccessfulCheck({ request: { ...request('Code sent'), arguments: { assertion: 'visible', locator: '#heading' } }, observations, stepId: 'signup' }), null);
  assert.equal(repeatedUnsuccessfulCheck({ request: request('Different guess'), observations: structuredClone(observations), stepId: 'signup' }), null);
  observations.push({ tool: 'browser_snapshot', result: receipt({ ...page(), accessibility: '- status "Verification sent"' }) });
  assert.equal(repeatedUnsuccessfulCheck({ request: request('Code sent'), observations, stepId: 'signup' }), null);
  observations.pop(); observations.push({ tool: 'browser_fill', action_id: 'real-password-fill', result: receipt({ action_outcome: 'completed' }) });
  assert.equal(repeatedUnsuccessfulCheck({ request: request('Code sent'), observations, stepId: 'signup' }), null);
});

test('failure allowances are scoped to the active section and reset after an actual satisfied check', () => {
  const observations = initial(), request = { name: 'browser_assert', arguments: { assertion: 'text_contains', locator: '#status', value: 'Code sent' } };
  const record = satisfied => {
    const actual = { tool: request.name, execution_step_id: 'signup', arguments: { ...request.arguments, value: '[redacted]' },
      result: receipt({ assertion_outcome: satisfied ? 'satisfied' : 'not_satisfied' }, !satisfied) };
    recordBrowserCheck(actual, request, browserRecoveryState(observations, request)); observations.push(actual);
  };
  record(false); record(false);
  assert.ok(repeatedUnsuccessfulCheck({ request, observations, stepId: 'signup' }));
  assert.equal(repeatedUnsuccessfulCheck({ request, observations, stepId: 'another-section' }), null);
  record(true); record(false);
  assert.equal(repeatedUnsuccessfulCheck({ request, observations, stepId: 'signup' }), null);
  record(false);
  assert.equal(repeatedUnsuccessfulCheck({ request, observations, stepId: 'signup' }).failed_check_count, 2);
});

test('unrelated carousel changes and viewport movement cannot reopen failed checks on a uniquely grounded target', () => {
  const target = { tag: 'h2', accessible_role: 'heading', accessible_name: 'Set up access', text: 'Set up access', attributes: { id: 'signup-heading' }, displayed: true, disabled: false,
    locators_validated: true, locator_candidates: ['#signup-heading'], in_viewport: true };
  const snapshot = (slide, changes = {}) => ({ tool: 'browser_snapshot', result: receipt({ ...page(), title: `Feature ${slide}`, observation_id: `snapshot-${slide}`, fields_truncated: true, truncated: true,
    accessibility: `- heading "Set up access"\n- article "Feature ${slide}"`,
    elements: [{ ...target, in_viewport: slide % 2 === 0, ...changes }, { tag: 'article', text: `Feature ${slide}`, attributes: { id: 'carousel' } }] }) });
  const request = value => ({ name: 'browser_assert', arguments: { assertion: 'text_contains', locator: '#signup-heading', value } });
  const observations = [snapshot(0)];
  for (let index = 0; index < 2; index++) {
    const current = request(index ? 'Verification was sent' : 'Code was sent');
    const failure = { tool: current.name, execution_step_id: 'signup', arguments: { ...current.arguments, value: '[redacted]' }, result: receipt({ assertion_outcome: 'not_satisfied' }, true) };
    recordBrowserCheck(failure, current, browserRecoveryState(observations, current)); observations.push(failure, snapshot(index + 1));
  }
  assert.equal(repeatedUnsuccessfulCheck({ request: request('Another expected text'), observations, stepId: 'signup' }).failed_check_count, 2);
  for (const change of [{ text: 'Code was sent' }, { accessible_name: 'Verification sent' }, { displayed: false }, { disabled: true }, { checked: true }, { options: [{ value: 'sent', selected: true }] }, { attributes: { id: 'changed-heading' } }]) {
    observations.push(snapshot(3, change));
    assert.equal(repeatedUnsuccessfulCheck({ request: request('Code was sent'), observations, stepId: 'signup' }), null);
    observations.pop();
  }
  observations.push({ tool: 'browser_click', action_id: 'actual-form-submit', result: receipt({ action_outcome: 'completed' }) });
  assert.equal(repeatedUnsuccessfulCheck({ request: request('Code was sent'), observations, stepId: 'signup' }), null);
});

test('uncertain or missing locator grounding retains full recovery evidence, including native input values', () => {
  const target = { tag: 'input', attributes: { id: 'email' }, displayed: true, locators_validated: true, locator_candidates: ['#email'] };
  const request = { name: 'browser_assert', arguments: { assertion: 'visible', locator: '#email' } };
  const snapshot = (content, pageChanges = {}, elements = [target]) => [{ tool: 'browser_snapshot', result: receipt({ ...page(), accessibility: content, elements, ...pageChanges }) }];
  for (const [changes, elements] of [[{ partial: true }, [target]], [{ elements_truncated: true }, [target]], [{}, []], [{}, [{ ...target, locators_validated: false }]], [{}, [target, { ...target }]], [{}, [{ ...target, text_truncated: true }]]]) {
    assert.notEqual(browserRecoveryState(snapshot('before', changes, elements), request), browserRecoveryState(snapshot('after', changes, elements), request));
  }
  const valueRequest = { name: 'browser_assert', arguments: { assertion: 'value', locator: '#email', value: '@t.email' } };
  assert.notEqual(browserRecoveryState(snapshot('- textbox "Email": before'), valueRequest), browserRecoveryState(snapshot('- textbox "Email": after'), valueRequest));
  assert.notEqual(browserRecoveryState(snapshot('same', {}, [{ ...target, value: 'before' }]), valueRequest), browserRecoveryState(snapshot('same', {}, [{ ...target, value: 'after' }]), valueRequest));
});

test('private expected-check context uses original references and host privacy projection without changing retained receipts', () => {
  const make = () => ({ tool: 'browser_assert', execution_step_id: 'signup', arguments: { assertion: 'text_contains', locator: '#status', value: '[redacted]' }, result: receipt({ assertion_outcome: 'not_satisfied' }, true) });
  const request = value => ({ name: 'browser_assert', arguments: { assertion: 'text_contains', locator: '#status', value } });
  const referenced = make(); recordBrowserCheck(referenced, request('@t.password'), 'state');
  assert.deepEqual(browserCheckPromptDetails(referenced), { expected_reference: '@t.password' });
  const codeReference = make(); recordBrowserCheck(codeReference, request('params["t.password"]'), 'state');
  assert.deepEqual(browserCheckPromptDetails(codeReference), { expected_reference: 'params["t.password"]' });
  const expression = make(); recordBrowserCheck(expression, request('params["t.password"] + "private-literal"'), 'state');
  assert.deepEqual(browserCheckPromptDetails(expression), { expected_value_withheld: true });
  const withheld = make(); recordBrowserCheck(withheld, request('private-literal'), 'state');
  assert.deepEqual(browserCheckPromptDetails(withheld), { expected_value_withheld: true });
  const actual = make(), before = JSON.stringify(actual);
  recordBrowserCheck(actual, request('Code sent to private-literal'), 'state', { projectText: text => text.replaceAll('private-literal', '@t.email') });
  assert.deepEqual(browserCheckPromptDetails(actual), { expected_value: 'Code sent to @t.email', expected_value_redacted: true });
  const context = browserPromptContext([...initial(), actual], 'signup', { compactModel: true });
  assert.equal(context.current.latest_failure.attempted_check.expected_value, 'Code sent to @t.email');
  assert.equal(context.current.latest_failure.target_not_in_current_snapshot, true);
  assert.equal(context.current.latest_failure.locator, undefined);
  assert.equal(JSON.stringify(actual), before);
  assert.equal(browserCheckPromptDetails(structuredClone(actual)), null);
  assert.doesNotMatch(JSON.stringify(unsuccessfulBrowserCheck(actual)), /private-literal|expected_value|Code sent/);
  assert.doesNotMatch(JSON.stringify(context), /private-literal/);
});

test('URL and title check recovery ignores unrelated live DOM updates while respecting observed subjects and actions', () => {
  for (const assertion of ['url_contains', 'title']) {
    const observations = initial(), request = { name: 'browser_assert', arguments: { assertion, value: 'Expected' } };
    for (let index = 0; index < 2; index++) {
      const actual = { tool: request.name, execution_step_id: 'signup', arguments: { assertion, value: '[redacted]' }, result: receipt({ assertion_outcome: 'not_satisfied' }, true) };
      recordBrowserCheck(actual, request, browserRecoveryState(observations, request)); observations.push(actual);
      observations.push({ tool: 'browser_snapshot', result: receipt({ ...page(), accessibility: `- status "Clock ${index}"`, observation_id: `clock-${index}` }) });
    }
    assert.equal(repeatedUnsuccessfulCheck({ request, observations, stepId: 'signup' }).failed_check_count, 2);
    observations.push({ tool: 'browser_snapshot', result: receipt({ ...page(), ...(assertion === 'title' ? { title: 'Expected' } : { url: 'https://app.test/Expected' }) }) });
    assert.equal(repeatedUnsuccessfulCheck({ request, observations, stepId: 'signup' }), null);
    observations.pop(); observations.push({ tool: 'browser_click', action_id: 'actual-navigation', result: receipt({ action_outcome: 'completed' }) });
    assert.equal(repeatedUnsuccessfulCheck({ request, observations, stepId: 'signup' }), null);
  }
});

test('exhausted action budget permits exactly one completion-only model turn without another browser operation', async () => {
  let turns = 0, assertions = 0;
  const browser = { tools, call: async name => { assert.equal(name, 'browser_assert'); assertions++; return receipt({ assertion_outcome: 'satisfied' }); } };
  const result = await runAutomationBrowserAgent({ browser, prompt: 'Verify signup', execution, actorMode: true, parse: JSON.parse, initialObservations: initial(), maxTurns: 1, maxCalls: 1,
    complete: async prompt => { turns++; if (turns === 1) return actor([check('#email-input')]); assert.match(prompt, /"completion_only":true/); assert.match(prompt, /"browser_tool_calls_allowed":false/); assert.match(prompt, /"completion_available":true/); return actor([], true); },
    onPartialBuild: async () => ({ generation_complete: true }) });
  assert.equal(turns, 2); assert.equal(assertions, 1); assert.match(result.steps[0].automation_code, /toBeVisible/);
});

test('completion-only turn cannot erase an unsuccessful assertion or dispatch a new mutation and budget error retains the actual cause', async () => {
  for (const final of [actor([], true), actor([{ name: 'browser_click', arguments: { locator: '#submit' } }], true)]) {
    let turns = 0, browserCalls = 0;
    const browser = { tools, call: async name => { browserCalls++; assert.equal(name, 'browser_assert'); return receipt({ code: 'BROWSER_ASSERTION_NOT_SATISFIED', message: 'The signup email input is not visible.', assertion_outcome: 'not_satisfied', action_outcome: 'not_attempted', retry_safe: true }, true); } };
    await assert.rejects(runAutomationBrowserAgent({ browser, prompt: 'Verify signup', execution, actorMode: true, parse: JSON.parse, initialObservations: initial(), maxTurns: 1, maxCalls: 1,
      complete: async () => ++turns === 1 ? actor([check('#email-input')]) : final,
      onPartialBuild: async () => assert.fail('unsatisfied checks cannot save a section')
    }), error => error.code === 'AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED' && error.details.tool_calls === 1 && error.details.latest_browser_failure.code === 'BROWSER_ASSERTION_NOT_SATISFIED' && /email input is not visible/.test(error.message));
    assert.equal(turns, 2); assert.equal(browserCalls, 1);
  }
});

test('optional model screenshots use the same separate bounded allowance as host screenshots and preserve the action budget', async () => {
  const calls = [];
  const browser = { tools, call: async name => { calls.push(name); return receipt(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { mime_type: 'image/jpeg', optional: true }); } };
  const result = await runAutomationBrowserAgent({ browser, prompt: 'Verify signup', execution, actorMode: true, parse: JSON.parse, initialObservations: initial(), maxTurns: 1, maxCalls: 1,
    complete: async () => actor([{ name: 'browser_screenshot', arguments: {} }, check('#email-input')], true), onPartialBuild: async () => ({ generation_complete: true }) });
  assert.deepEqual(calls, ['browser_screenshot', 'browser_assert']); assert.match(result.steps[0].automation_code, /toBeVisible/);
});

test('malformed completion-only replies cannot open more model turns through the dependency feedback path', async () => {
  let turns = 0, browserCalls = 0;
  const browser = { tools, call: async () => { browserCalls++; return receipt({ assertion_outcome: 'satisfied' }); } };
  await assert.rejects(runAutomationBrowserAgent({ browser, prompt: 'Verify signup', execution, actorMode: true, parse: JSON.parse, initialObservations: initial(), maxTurns: 8, maxCalls: 1,
    complete: async () => ++turns === 1 ? actor([check('#email-input')]) : JSON.stringify({ blocked_steps: 'invalid dependency report' }),
    onPartialBuild: async () => ({ generation_complete: false, validation_errors: [{ code: 'INVALID_DEPENDENCY' }] })
  }), error => error.code === 'AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED');
  assert.equal(turns, 2); assert.equal(browserCalls, 1);
});

test('validation summaries omit expected input values and classify an ambiguous match without calling it success', () => {
  const observation = { tool: 'browser_validate_locator', arguments: { locator: '#email-input', value: 'private-expected-value' }, result: receipt({ match_count: 4, unique: false }) };
  const failure = unsuccessfulBrowserCheck(observation);
  assert.equal(failure.match_count, 4); assert.equal(failure.unique, false);
  assert.doesNotMatch(JSON.stringify(failure), /private-expected-value/);
});

test('skipped current-URL navigation is prominent on the next model turn while actual completion still requires a check', async () => {
  let turns=0,assertions=0;
  const browser={tools:[...tools,{name:'browser_navigate',inputSchema:{type:'object'}}],call:async name=>{assert.equal(name,'browser_assert');assertions++;return receipt({assertion_outcome:'satisfied'});}};
  await runAutomationBrowserAgent({browser,prompt:'Navigate to the signup screen',execution,actorMode:true,parse:JSON.parse,initialObservations:initial(),
    complete:async prompt=>{
      if(++turns===1)return actor([{name:'browser_navigate',arguments:{url:page().url}}]);
      const line=prompt.split('\n').find(value=>value.startsWith('Current browser state and confirmed section progress'));
      const current=JSON.parse(line.slice(line.indexOf(': ')+2));
      assert.equal(current.latest_failure.code,'AUTOMATION_NAVIGATION_ALREADY_REACHED');
      assert.equal(current.latest_failure.remaining_contract,'current_section_actions_and_expected_result_check');
      assert.match(current.latest_failure.message,/No navigation was performed/); assert.equal(current.recorded_section.completion_available,false);
      return actor([check('#email-input')],true);
    },onPartialBuild:async()=>({generation_complete:true})});
  assert.equal(turns,2);assert.equal(assertions,1);
});

test('navigation no-op guidance does not replace the original unsuccessful browser check',()=>{
  const failure={tool:'browser_validate_locator',execution_step_id:'signup',arguments:{locator:'#missing'},result:receipt({match_count:0,unique:false})};
  const noOp={tool:'automation_navigation_feedback',execution_step_id:'signup',mcp_call:false,result:receipt({code:'AUTOMATION_NAVIGATION_ALREADY_REACHED',message:'No navigation was performed.'})};
  const context=browserPromptContext([...initial(),failure,noOp],'signup');
  assert.equal(context.current.latest_failure.code,'BROWSER_LOCATOR_NOT_UNIQUE');assert.equal(context.current.latest_failure.recovery.code,'AUTOMATION_NAVIGATION_ALREADY_REACHED');
});
