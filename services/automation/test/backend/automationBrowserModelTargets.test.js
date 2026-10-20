const test = require('node:test');
const assert = require('node:assert/strict');
const { projectModelSnapshot, resolveModelToolRequest, modelTargetForLocator, browserExcerptAssertionFeedback } = require('../../backend/lib/automationBrowserModelTargets');
const {browserPromptContext}=require('../../backend/lib/automationBrowserContext');

const element = (name, candidates, extra = {}) => ({ tag: 'input', accessible_role: 'textbox', accessible_name: name,
  locator_candidates: candidates, locators_validated: true, displayed: true, disabled: false, ...extra });
const snapshot = (elements, extra = {}) => ({ tool: 'browser_snapshot', result: { content: [{ type: 'text', text: JSON.stringify({
  source: 'playwright', observation_id: 'actual-snapshot', url: 'https://app.test/auth', title: 'Sign up', scope: 'body', elements, ...extra }) }] } });

test('a grounded record scope remains preferred over a globally unique control ID', () => {
  const scoped = 'tr[data-row-id="record-a"] > td:nth-of-type(2) > button';
  const current = snapshot([element('Delete', ['getByTestId("delete")', scoped], {
    tag: 'button', accessible_role: 'button', attributes: { 'data-testid': 'delete' },
    record_scoped_locator: scoped, context_text: 'Record A Delete'
  })]);
  const target = projectModelSnapshot(current).targets[0];
  assert.equal(target.context_text, 'Record A Delete');
  assert.equal(resolveModelToolRequest({ name: 'browser_click', arguments: { locator: target.ref } }, current).arguments.locator, scoped);
  assert.equal(resolveModelToolRequest({ name: 'browser_click', arguments: { locator: 'getByTestId("delete")' } }, current).arguments.locator, scoped);
  for (const assertion of ['hidden', 'count']) assert.equal(resolveModelToolRequest({ name: 'browser_assert', arguments: {
    locator: 'getByTestId("delete")', assertion, ...(assertion === 'count' ? { value: '0' } : {})
  } }, current).arguments.locator, 'getByTestId("delete")', 'negative scope cannot be silently narrowed');
  assert.doesNotMatch(JSON.stringify(target), /data-row-id|record_scoped_locator/);
});

test('unvalidated or privacy-masked record scope metadata cannot change a target binding', () => {
  for (const scoped of ['#invented-record button', 'tr[data-id="[private parameter value]"] > button']) {
    const current = snapshot([element('Delete', ['getByTestId("delete")', ...(scoped.includes('private') ? [scoped] : [])], {
      tag: 'button', accessible_role: 'button', attributes: { 'data-testid': 'delete' }, record_scoped_locator: scoped
    })]);
    const target = projectModelSnapshot(current).targets[0];
    assert.equal(resolveModelToolRequest({ name: 'browser_click', arguments: { locator: target.ref } }, current).arguments.locator, 'getByTestId("delete")');
  }
});

test('field validation declarations become bounded current evidence and reference links without exposing control values',()=>{
 const current=snapshot([
  element('Password',['#password'],{attributes:{id:'password',type:'password','aria-invalid':'true','aria-errormessage':'error-id'},value:'PRIVATE_CONTROL_VALUE'}),
  element('', ['#error-id'],{tag:'span',accessible_role:'alert',attributes:{id:'error-id'},text:'Required field'}),
  element('Long declaration',['#long'],{attributes:{'aria-invalid':'x'.repeat(200)},truncated_attributes:['aria-invalid']}),
  element('Unknown declaration',['#unknown'])
 ]);
 const projected=projectModelSnapshot(current),[field,error,long,unknown]=projected.targets;
 assert.equal(field.aria_invalid,'true');assert.deepEqual(field.field_relationships.error_refs,[error.ref]);assert.equal(field.field_relationships.relationship_refs_incomplete,false);
 assert.equal(long.aria_invalid.length,30);assert.equal(long.aria_invalid_truncated,true);assert.equal(unknown.aria_invalid,undefined);
 assert.doesNotMatch(JSON.stringify(projected),/PRIVATE_CONTROL_VALUE|error-id|#password/);
});

test('a clipped URL is not a new exact URL oracle, while authored URL values and references remain unchanged', () => {
  const url = 'https://app.test/shortened?state=part';
  const current = snapshot([], { url, url_truncated: true });
  const request = { name: 'browser_assert', arguments: { assertion: 'url', value: url } };
  const execution = { step_id: 'current', expected_result: 'The registration form is displayed' };
  const result = browserExcerptAssertionFeedback({ request, snapshot: current, execution });
  assert.equal(result.code, 'AUTOMATION_BROWSER_ASSERTION_EXCERPT_NOT_EXACT');
  assert.deepEqual(result.excerpt_fields, ['url']);assert.doesNotMatch(JSON.stringify(result), /app\.test|state=part/);
  assert.equal(browserExcerptAssertionFeedback({ request, snapshot: current, execution: { ...execution, expected_result: `URL is ${url}` } }), null);
  assert.equal(browserExcerptAssertionFeedback({ request: { ...request, arguments: { assertion: 'url', value: '@t.target' } }, snapshot: current, execution }), null);
  assert.equal(browserExcerptAssertionFeedback({ request, snapshot: snapshot([], { url }), execution }), null);
});

test('copied descriptive outcome prose against its selected complete terminal-error alert receives read-only correction',()=>{
 const expected='A message is displayed indicating that the requested confirmation has been sent.';
 const current=snapshot([element('', ['#feedback'], {tag:'p',accessible_role:'alert',text:'Authentication failed. PRIVATE_SERVICE_DIAGNOSTIC',displayed:true})]);
 const ref=projectModelSnapshot(current).targets[0].ref;
 const execution={step_id:'send',action:'Submit the request.',expected_result:expected,source_obligations:[{expected_result:expected,action:'Submit the request.'}]};
 for(const locator of [ref,'#feedback'])for(const assertion of ['text','text_contains']){
  const feedback=browserExcerptAssertionFeedback({request:{name:'browser_assert',arguments:{assertion,locator,value:expected}},snapshot:current,execution});
  assert.equal(feedback.code,'AUTOMATION_BROWSER_EXPECTED_PROSE_AS_TEXT');
  assert.equal(feedback.action_outcome,'not_attempted');assert.equal(feedback.retry_safe,true);
  assert.deepEqual(feedback.evidence_refs,[ref]);assert.match(feedback.message,/section_issue/);
  assert.doesNotMatch(JSON.stringify(feedback),/PRIVATE_SERVICE_DIAGNOSTIC|requested confirmation has been sent/);
 }
});

test('descriptive-text feedback never reclassifies literal, negative, asynchronous or ungrounded outcomes',()=>{
 const expected='A message is displayed indicating that the requested confirmation has been sent.';
 const base={tag:'p',accessible_role:'alert',text:'Authentication failed.',displayed:true};
 const check=(expectedResult=expected,extra={},requestExtra={},executionExtra={})=>{
  const current=snapshot([element('', ['#feedback'], {...base,...extra})]);
  return browserExcerptAssertionFeedback({request:{name:'browser_assert',arguments:{assertion:'text_contains',locator:'#feedback',value:expectedResult,...requestExtra}},snapshot:current,
   execution:{step_id:'send',action:'Submit the request.',expected_result:expectedResult,...executionExtra}});
 };
 for(const value of [
  '"'+expected+'"',
  'A message is displayed indicating that authentication failed.',
  'A message should be displayed indicating that the confirmation arrives within five minutes.',
  'A message will be displayed indicating that the requested confirmation has been sent.',
  'Confirmation sent',
  '@r.message'
 ])assert.equal(check(value),null,value);
 assert.equal(check(expected,{}, {}, {action:'Verify the following message exactly.'}),null);
 assert.equal(check(expected,{text:'Processing request after an earlier failure.'}),null,'in-progress outcomes retain ordinary bounded assertions');
 assert.equal(check(expected,{text:'An unrelated warning is displayed.'}),null);
 assert.equal(check(expected,{accessible_role:'status'}),null);
 assert.equal(check(expected,{text_truncated:true}),null);
 assert.equal(check(expected,{displayed:false}),null);
 assert.equal(check(expected,{}, {locator:'#not-observed'}),null);
 assert.equal(check(expected,{}, {assertion:'text_content_contains'}),null,'visible text cannot stand in for native textContent, including hidden children');
 assert.equal(check(expected,{text:expected}),null,'the actual expected text is allowed even though its phrasing resembles prose');
 assert.equal(check(expected,{}, {}, {source_obligations:[{action:'Submit',expected_result:'Confirmation is displayed.'}]}),null,'resolved or model-authored prose is not original authored intent');
});

test('descriptive assertion feedback remains current correction context until a real check succeeds',()=>{
 const current=snapshot([element('', ['#feedback'], {tag:'p',accessible_role:'alert',text:'Authentication failed.'})]);
 const expected='A message is displayed indicating that the requested confirmation has been sent.';
 const feedback=browserExcerptAssertionFeedback({request:{name:'browser_assert',arguments:{assertion:'text_contains',locator:'#feedback',value:expected}},snapshot:current,execution:{step_id:'current',expected_result:expected}});
 const observations=[current,{tool:'automation_assertion_feedback',execution_step_id:'current',mcp_call:false,result:{isError:true,content:[{type:'text',text:JSON.stringify(feedback)}]}}];
 const context=browserPromptContext(observations,'current',{compactModel:true});
 assert.equal(context.current.latest_failure.kind,'assertion_prose');
 assert.equal(context.current.latest_failure.code,'AUTOMATION_BROWSER_EXPECTED_PROSE_AS_TEXT');
 assert.deepEqual(context.current.latest_failure.evidence_refs,feedback.evidence_refs);
 assert.equal(context.current.latest_failure.action_outcome,'not_attempted');
 observations.push({tool:'browser_assert',execution_step_id:'current',arguments:{assertion:'visible',locator:'#feedback'},result:{content:[{type:'text',text:JSON.stringify({source:'playwright',assertion_outcome:'satisfied'})}]}});
 assert.equal(browserPromptContext(observations,'current',{compactModel:true}).current.latest_failure,undefined);
});

test('an exact message substring cannot stand in for the complete selected alert container',()=>{
 const wanted='Invalid credentials (support reference: VOLATILE_FIXTURE_DETAIL)';
 const current=snapshot([element('', ['#feedback'], {tag:'div',accessible_role:'alert',text:wanted+'\nDismiss',visible_text:wanted+'\nDismiss'})]);
 const ref=projectModelSnapshot(current).targets[0].ref;
 const execution={step_id:'login',expected_result:'An error containing "Invalid credentials" is displayed and the sign-in screen remains open.'};
 const request={name:'browser_assert',arguments:{assertion:'text',locator:ref,value:wanted}};
 const feedback=browserExcerptAssertionFeedback({request,snapshot:current,execution});
 assert.equal(feedback.code,'AUTOMATION_BROWSER_ASSERTION_CONTAINER_TEXT_MISMATCH');
 assert.equal(feedback.action_outcome,'not_attempted');assert.deepEqual(feedback.evidence_refs,[ref]);
 assert.match(feedback.message,/every authored clause and quoted literal/);
 assert.doesNotMatch(JSON.stringify(feedback),/VOLATILE_FIXTURE_DETAIL|Invalid credentials|Dismiss/);
 assert.equal(request.arguments.assertion,'text');assert.equal(request.arguments.value,wanted,'feedback does not rewrite its operator or expected value');
 const observations=[current,{tool:'automation_assertion_feedback',execution_step_id:'login',mcp_call:false,result:{content:[{type:'text',text:JSON.stringify(feedback)}]}}];
 assert.equal(browserPromptContext(observations,'login',{compactModel:true}).current.latest_failure.kind,'assertion_container_text');
});

test('container text feedback preserves exact whole-copy, async, partial and other-subject checks',()=>{
 const wanted='Invalid credentials (support reference: fixture)';
 const expected='An error containing "Invalid credentials" is displayed.';
 const check=(target={},args={},execution={})=>browserExcerptAssertionFeedback({
  request:{name:'browser_assert',arguments:{assertion:'text',locator:'#feedback',value:wanted,...args}},
  snapshot:snapshot([element('', ['#feedback'], {tag:'div',accessible_role:'alert',text:wanted+' Dismiss',visible_text:wanted+' Dismiss',...target})]),
  execution:{step_id:'login',expected_result:expected,...execution}});
 assert.equal(check({text:wanted,visible_text:wanted}),null,'a stronger exact assertion whose complete subject matches remains allowed');
 assert.equal(check({visible_text:undefined}),null,'textContent cannot establish a visible mismatch');
 assert.equal(check({visible_text:wanted}),null,'hidden descendants in textContent cannot reject a matching visible assertion');
 assert.equal(check({}, {assertion:'text_contains'}),null);
 assert.equal(check({}, {assertion:'text_content'}),null,'visible snapshot text is not a textContent oracle');
 assert.equal(check({visible_text_truncated:true}),null);
 assert.equal(check({displayed:false}),null);
 assert.equal(check({accessible_role:'status'}),null);
 assert.equal(check({visible_text:wanted+' Retrying request'}),null);
 assert.equal(check({}, {}, {expected_result:'The error eventually contains "Invalid credentials".'}),null);
 assert.equal(check({}, {}, {expected_result:'An error is displayed.'}),null,'a model-chosen fragment cannot create an authored literal');
 assert.equal(check({}, {value:'Other text'}),null);
 assert.equal(check({}, {}, {source_obligations:[{expected_result:'A different outcome is required.'}]}),null,'projected goals cannot substitute for original source literals');
});

test('alert visible-text projection preserves host completeness without inferring it from textContent',()=>{
 const full='Invalid credentials '+'x'.repeat(180);
 const current=snapshot([
  element('', ['#long'], {tag:'div',accessible_role:'alert',visible_text:full}),
  element('', ['#upstream'], {tag:'div',accessible_role:'alert',visible_text:'Invalid credentials',visible_text_truncated:true}),
  element('', ['#legacy'], {tag:'div',accessible_role:'alert',text:'Invalid credentials Hidden diagnostic'}),
  element('', ['#status'], {tag:'div',accessible_role:'status',visible_text:'Invalid credentials'})
 ]);
 const page=projectModelSnapshot(current);
 assert.equal(page.targets[0].visible_text.length,180);assert.equal(page.targets[0].visible_text_truncated,true);
 assert.equal(page.targets[1].visible_text_truncated,true);
 assert.equal(page.targets[2].visible_text,undefined,'older receipts do not acquire visible-text authority');
 assert.equal(page.targets[3].visible_text,undefined,'additional visible text is bounded to the alert contract');
});

test('current snapshot exposes one opaque target while the host resolves its exact validated portable locator', () => {
  const role = 'getByRole("textbox", { name: "Email", exact: true })';
  const current = snapshot([element('Email', [role, 'getByLabel("Email *", { exact: true })', '#email-input'])]);
  const projected = projectModelSnapshot(current);
  assert.equal(projected.targets.length, 1);
  assert.match(projected.targets[0].ref, /^ref:[a-f0-9]{12}:1$/);
  assert.equal(projected.targets[0].name, 'Email');
  assert.doesNotMatch(JSON.stringify(projected), /getBy|email-input|Email \*/);
  const request = { name: 'browser_fill', occurrence: 2, arguments: { locator: projected.targets[0].ref, value: '@t.email' } };
  assert.deepEqual(resolveModelToolRequest(request, current), { ...request, arguments: { locator: role, value: '@t.email' } });
  assert.equal(modelTargetForLocator('#email-input', current), projected.targets[0].ref);
  assert.equal(modelTargetForLocator('getByRole("textbox", { name: "Email *" })', current), null);
});

test('a new snapshot or a JSON copy cannot authorize an earlier target reference', () => {
  const original = snapshot([element('Email', ['#email'])]);
  const ref = projectModelSnapshot(original).targets[0].ref;
  const request = { name: 'browser_click', arguments: { locator: ref } };
  for (const other of [snapshot([element('Email', ['#email'])]), structuredClone(original), null]) {
    assert.throws(() => resolveModelToolRequest(request, other), error => error.code === 'AUTOMATION_BROWSER_TARGET_REF_STALE' && error.retry_safe && error.action_outcome === 'not_attempted');
  }
  assert.equal(resolveModelToolRequest(request, original).arguments.locator, '#email');
});

test('model mutations and invented bindings cannot modify host target authority', () => {
  const current = snapshot([element('Email', ['#email'])]);
  const projected = projectModelSnapshot(current), ref = projected.targets[0].ref;
  projected.targets[0].ref = 'ref:000000000000:1';
  projected.targets[0].locator = '#password';
  projected.bindings = { [ref]: '#password' };
  assert.equal(resolveModelToolRequest({ name: 'browser_fill', arguments: { locator: ref }, bindings: projected.bindings }, current).arguments.locator, '#email');
  assert.equal(projectModelSnapshot(current).targets[0].ref, ref);
  assert.throws(() => resolveModelToolRequest({ arguments: { locator: ref.replace(/:1$/, ':9') } }, current), { code: 'AUTOMATION_BROWSER_TARGET_REF_INVALID' });
});

test('replacing evidence on the same observation invalidates old references', () => {
  const current = snapshot([element('Email', ['#email'])]);
  const ref = projectModelSnapshot(current).targets[0].ref;
  current.result.content[0].text = JSON.stringify({ observation_id: 'new-state', elements: [element('Password', ['#password'])] });
  assert.throws(() => resolveModelToolRequest({ arguments: { locator: ref } }, current), { code: 'AUTOMATION_BROWSER_TARGET_REF_STALE' });
});

test('only actually validated bounded candidates become references, and captured form values stay out of projection', () => {
  const current = snapshot([
    element('Private field', ['#secret'], { attributes: { value: 'never-disclose', type: 'password' }, value: 'never-disclose', text: 'never-disclose' }),
    element('Notes', ['#notes'], { tag: 'textarea', text: 'private-note' }),
    element('Bad cached candidate', ['#cached'], { locators_validated: false }),
    element('Oversized', ['x'.repeat(2_001)]),
    element('Heading', ['#heading'], { tag: 'h2', accessible_role: 'heading', text: 'Create account' })
  ]);
  const projected = projectModelSnapshot(current);
  assert.equal(projected.targets.length, 3);
  assert.doesNotMatch(JSON.stringify(projected), /never-disclose|private-note|cached|Oversized/);
  assert.equal(projected.targets[2].text, 'Create account');
  assert.equal(projectModelSnapshot(snapshot([element('Old runner', ['#old'], { locators_validated: undefined })])).targets_unavailable, true);
});

test('legacy raw portable locators pass through without rewriting or weakening their contract', () => {
  for (const request of [{ name: 'browser_assert', arguments: { locator: '#email', assertion: 'visible' } }, { name: 'browser_navigate', arguments: { url: 'https://app.test' } }]) {
    assert.equal(resolveModelToolRequest(request, null), request);
  }
  for (const locator of ['ref:', 'ref:bad:1', 'ref:000000000000:0', 'ref:000000000000:9999']) {
    assert.throws(() => resolveModelToolRequest({ arguments: { locator } }, null), error => error.code === 'AUTOMATION_BROWSER_TARGET_REF_INVALID' && !error.message.includes(locator));
  }
});

test('bounded native accessibility retains non-actionable outcome text and prioritizes the current main content', () => {
  const current = snapshot([element('Email', ['#email'])], { accessibility: '- complementary: ' + 'marketing '.repeat(500) + '\n- main:\n  - heading "Signup"\n  - paragraph: Account created\n- status: Confirmation email sent' });
  const page = projectModelSnapshot(current);
  assert.match(page.accessibility, /Account created/);
  assert.match(page.accessibility, /Confirmation email sent/);
  assert.doesNotMatch(page.accessibility, /marketing/);
  const long = projectModelSnapshot(snapshot([], { accessibility: '- main:\n' + 'middle '.repeat(2_000) + '\n- status: Complete' }));
  assert.ok(long.accessibility.length <= 3_500);
  assert.equal(long.accessibility_truncated, true);
  assert.match(long.accessibility, /status: Complete$/);
});

test('page and target text excerpts carry field-specific loss markers while exact values remain unmarked', () => {
  const current = snapshot([
    element('N'.repeat(181), ['#heading'], { tag: 'h2', accessible_role: 'heading', text: 'T'.repeat(181) }),
    element('', ['#password'], { attributes: { type: 'password', placeholder: 'P'.repeat(181) } }),
    element('Exact', ['#exact'], { tag: 'h2', accessible_role: 'heading', text: 'Exact text' })
  ], { title: 'D'.repeat(201), url: 'https://app.test/' + 'u'.repeat(2_001) });
  const page = projectModelSnapshot(current);
  assert.equal(page.title.length, 200);
  assert.equal(page.title_truncated, true);
  assert.equal(page.url.length, 2_000);
  assert.equal(page.url_truncated, true);
  assert.equal(page.targets[0].name.length, 180);
  assert.equal(page.targets[0].name_truncated, true);
  assert.equal(page.targets[0].text.length, 180);
  assert.equal(page.targets[0].text_truncated, true);
  assert.equal(page.targets[1].placeholder.length, 180);
  assert.equal(page.targets[1].placeholder_truncated, true);
  assert.equal(page.targets[2].name_truncated, undefined);
  assert.equal(page.targets[2].text_truncated, undefined);
  assert.equal(projectModelSnapshot(snapshot([])).title_truncated, undefined);
  assert.equal(resolveModelToolRequest({ arguments: { locator: page.targets[0].ref } }, current).arguments.locator, '#heading');
});

test('upstream field truncation survives projection even when the captured excerpt is short', () => {
  const page = projectModelSnapshot(snapshot([
    element('Name excerpt', ['#named'], { accessible_name_truncated: true, tag: 'h2', text: 'Text excerpt', text_truncated: true }),
    element('', ['#label'], { label: 'Label excerpt', label_truncated: true }),
    element('', ['#placeholder'], { attributes: { placeholder: 'Placeholder excerpt', type: 'tex' }, truncated_attributes: ['placeholder', 'type'] })
  ], { title: 'Title excerpt', title_truncated: true, url: 'https://app.test/part', url_truncated: true }));
  assert.equal(page.title_truncated, true);
  assert.equal(page.url_truncated, true);
  assert.equal(page.targets[0].name_truncated, true);
  assert.equal(page.targets[0].text_truncated, true);
  assert.equal(page.targets[1].name_truncated, true);
  assert.equal(page.targets[2].placeholder_truncated, true);
  assert.equal(page.targets[2].input_type_truncated, true);
  assert.equal(page.targets[2].assertion_subject, undefined);
});

test('new exact expectations copied from marked excerpts receive safe unattempted feedback without weakening checks', () => {
  const current = snapshot([element('Named excerpt', ['#heading'], { tag: 'h2', accessible_name_truncated: true, text: 'Content excerpt', text_truncated: true })],
    { title: 'Title excerpt', title_truncated: true });
  const page = projectModelSnapshot(current), execution = { step_id: 'step', action: 'Open the detail screen', expected_result: 'The detail screen is displayed' };
  for (const args of [
    { assertion: 'title', value: page.title }, { assertion: 'title_normalized', value: page.title },
    { assertion: 'text', locator: page.targets[0].ref, value: page.targets[0].text },
    { assertion: 'text', locator: '#heading', value: page.targets[0].name }
  ]) {
    const request = { name: 'browser_assert', arguments: args }, before = structuredClone(request);
    const feedback = browserExcerptAssertionFeedback({ request, snapshot: current, execution });
    assert.equal(feedback.code, 'AUTOMATION_BROWSER_ASSERTION_EXCERPT_NOT_EXACT');
    assert.equal(feedback.action_outcome, 'not_attempted');
    assert.equal(feedback.attempted_assertion, args.assertion);
    assert.equal(feedback.step_id, 'step');
    assert.deepEqual(request, before);
    assert.doesNotMatch(JSON.stringify(feedback), /Title excerpt|Named excerpt|Content excerpt|#heading/);
  }
});

test('authored exact expectations, configured references and non-equality predicates retain their original semantics', () => {
  const current = snapshot([element('Explicit text', ['#heading'], { tag: 'h2', text: 'Explicit text', text_truncated: true })], { title: 'Explicit title', title_truncated: true });
  const request = args => ({ name: 'browser_assert', arguments: args });
  for (const execution of [
    { expected_result: 'The title must equal "Explicit title".' },
    { source_obligations: [{ expected_result: 'Expect "Explicit title" even when the actual title differs.' }] },
    { obligations: [{ action: 'Verify the title "Explicit title".' }] }
  ]) assert.equal(browserExcerptAssertionFeedback({ request: request({ assertion: 'title', value: 'Explicit title' }), snapshot: current, execution }), null);
  assert.equal(browserExcerptAssertionFeedback({ request: request({ assertion: 'text', locator: '#heading', value: 'Explicit text' }), snapshot: current,
    execution: { source_obligations: [{ expected_result: 'Text equals "Explicit text".' }] } }), null);
  for (const args of [
    { assertion: 'title', value: '@t.expectedTitle' }, { assertion: 'title', value: 'params["t.expectedTitle"]' },
    { assertion: 'text_contains', locator: '#heading', value: 'Explicit text' },
    { assertion: 'title', value: 'Independent expected title' }, { assertion: 'text', locator: '#unknown', value: 'Explicit text' }
  ]) assert.equal(browserExcerptAssertionFeedback({ request: request(args), snapshot: current }), null);
  const exact = snapshot([element('Exact', ['#exact'], { tag: 'h2', text: 'Exact' })], { title: 'Exact title' });
  assert.equal(browserExcerptAssertionFeedback({ request: request({ assertion: 'title', value: 'Exact title' }), snapshot: exact }), null);
  assert.equal(browserExcerptAssertionFeedback({ request: request({ assertion: 'title', value: 'Explicit title' }), snapshot: null }), null);
});

test('a password field without a native role/name remains identifiable by its observed placeholder without inventing an accessible name', () => {
  const current = snapshot([element('', ['getByPlaceholder("Password*", { exact: true })', '#password'], {
    accessible_role: undefined, attributes: { type: 'password', placeholder: 'Password*', value: 'secret' }
  })]);
  const target = projectModelSnapshot(current).targets[0];
  assert.equal(target.name, undefined);
  assert.equal(target.role, undefined);
  assert.equal(target.placeholder, 'Password*');
  assert.equal(target.input_type, 'password');
  assert.doesNotMatch(JSON.stringify(target), /secret|#password|getBy/);
  assert.equal(resolveModelToolRequest({ name: 'browser_fill', arguments: { locator: target.ref, value: '@t.password' } }, current).arguments.locator, 'getByPlaceholder("Password*", { exact: true })');
});

test('observed native button types distinguish navigation controls from form submission without inventing types', () => {
  const current = snapshot([
    element('Create account', ['#open-registration'], { tag: 'button', accessible_role: 'button', attributes: { type: 'button' } }),
    element('Create account', ['#submit-registration'], { tag: 'button', accessible_role: 'button', attributes: { type: 'submit', value: 'private-submit-value' } }),
    element('Reset form', ['#reset'], { tag: 'button', accessible_role: 'button', attributes: { type: 'reset' } }),
    element('Custom button', ['#custom'], { tag: 'div', accessible_role: 'button', attributes: { type: 'submit' } }),
    element('Unspecified button', ['#unspecified'], { tag: 'button', accessible_role: 'button', attributes: {} })
  ]);
  const projected = projectModelSnapshot(current);
  assert.deepEqual(projected.targets.map(target => target.input_type), ['button', 'submit', 'reset', undefined, undefined]);
  assert.equal(projected.targets[3].role, 'button');
  assert.doesNotMatch(JSON.stringify(projected), /private-submit-value|#open-registration|#submit-registration/);
  assert.equal(resolveModelToolRequest({ name: 'browser_click', arguments: { locator: projected.targets[0].ref } }, current).arguments.locator, '#open-registration');
  assert.equal(resolveModelToolRequest({ name: 'browser_click', arguments: { locator: projected.targets[1].ref } }, current).arguments.locator, '#submit-registration');
});

test('only known native text-entry controls expose a current-value assertion subject', () => {
  const current = snapshot([
    element('Name', ['#name'], { attributes: { type: 'text' } }),
    element('Notes', ['#notes'], { tag: 'textarea' }),
    element('Terms', ['#terms'], { attributes: { type: 'checkbox' }, accessible_role: 'checkbox' }),
    element('Attachment', ['#file'], { attributes: { type: 'file' } }),
    element('Custom editor', ['#editor'], { tag: 'div', accessible_role: 'textbox' }),
    element('Submit', ['#submit'], { tag: 'button', attributes: { type: 'submit' }, accessible_role: 'button' })
  ]);
  const projected = projectModelSnapshot(current);
  assert.deepEqual(projected.targets.map(target => target.assertion_subject), ['input_value', 'input_value', undefined, undefined, undefined, undefined]);
  assert.deepEqual(projected.targets.map(target => target.preferred_value_assertion), ['value', 'value', undefined, undefined, undefined, undefined]);
  assert.doesNotMatch(JSON.stringify(projected), /#name|#notes|#terms/);
});

test('checkbox state and captured select options reach the actor without copying field values or changing target authority', () => {
  const options = [
    { label: 'Choose country', value: '', selected: true, disabled: true },
    { label: 'India', value: '  IN\t', selected: false, disabled: false },
    { label: 'Private configured choice', value: '@t.country', selected: false, disabled: false },
    { label: 'Long identifier', value_excerpt: 'observed-prefix', value_truncated: true, selected: false, disabled: false }
  ];
  const current = snapshot([
    element('Terms', ['#terms'], { accessible_role: 'checkbox', attributes: { type: 'checkbox', value: 'private-checkbox-value' }, checked: false }),
    element('Country', ['#country'], { tag: 'select', accessible_role: 'combobox', value: 'private-selected-value', options, options_truncated: true }),
    element('Already selected', ['#selected'], { checked: true })
  ]);
  const projected = projectModelSnapshot(current);
  assert.equal(projected.targets[0].checked, false);
  assert.equal(projected.targets[2].checked, true);
  assert.deepEqual(projected.targets[1].options, options);
  assert.equal(projected.targets[1].options_truncated, true);
  assert.doesNotMatch(JSON.stringify(projected), /private-checkbox-value|private-selected-value|#country|#terms/);
  const request = { name: 'browser_select_option', arguments: { locator: projected.targets[1].ref, value: projected.targets[1].options[1].value } };
  assert.deepEqual(resolveModelToolRequest(request, current), { name: request.name, arguments: { locator: '#country', value: '  IN\t' } });
  projected.targets[1].options[1].value = 'invented';
  assert.equal(projectModelSnapshot(current).targets[1].options[1].value, '  IN\t');
});

test('option metadata stays bounded and never promotes truncated values into exact option inputs', () => {
  const longValue = 'x'.repeat(121);
  const current = snapshot([element('Country', ['#country'], { tag: 'select', options_truncated: false, options: [
    { label: 'Oversized'.repeat(20), value: longValue, selected: false, disabled: false },
    { label: 'Partial', value: 'not-an-exact-value', value_truncated: true },
    ...Array.from({ length: 20 }, (_, index) => ({ label: `Choice ${index}`, value: `${index}`, selected: false, disabled: false }))
  ] })]);
  const target = projectModelSnapshot(current).targets[0];
  assert.equal(target.options.length, 12);
  assert.equal(target.options_truncated, true);
  assert.equal(target.options[0].label.length, 80);
  assert.equal(target.options[0].label_truncated, true);
  assert.equal(target.options[0].value, undefined);
  assert.equal(target.options[0].value_excerpt.length, 120);
  assert.equal(target.options[0].value_truncated, true);
  assert.equal(target.options[1].value, undefined);
  assert.equal(target.options[1].value_truncated, true);
  assert.equal(target.options[1].value_excerpt, 'not-an-exact-value');
  assert.equal(projectModelSnapshot(snapshot([element('Not a select', ['#input'], { options: [{ value: 'private-input-value' }] })])).targets[0].options, undefined);
  const complete = projectModelSnapshot(snapshot([element('Empty select', ['#empty'], { tag: 'select', options: [], options_truncated: false })])).targets[0];
  assert.deepEqual(complete.options, []);
  assert.equal(complete.options_truncated, false);
});

test('missing, failed or malformed snapshot evidence cannot authorize references while legacy portable requests remain unchanged', () => {
  const portable = { name: 'browser_assert', arguments: { locator: '#email', assertion: 'visible' } };
  for (const current of [null, { tool: 'browser_snapshot', result: { isError: true } },
    { tool: 'browser_snapshot', result: { content: [{ type: 'text', text: 'not JSON' }] } },
    { tool: 'browser_snapshot', result: { content: [{ type: 'text', text: JSON.stringify({ elements: [] }) }] } }]) {
    assert.equal(projectModelSnapshot(current), null);
    assert.equal(resolveModelToolRequest(portable, current), portable);
    assert.throws(() => resolveModelToolRequest({ arguments: { locator: 'ref:000000000000:1' } }, current), { code: 'AUTOMATION_BROWSER_TARGET_REF_STALE' });
  }
});

test('validated explicit test IDs take precedence over dynamic names independently of candidate order', () => {
  const role = 'getByRole("button", { name: "Submit order 41", exact: true })';
  const label = 'getByLabel("Submit order 41", { exact: true })';
  const testId = 'getByTestId("submit-order")';
  for (const candidates of [[role, testId, '#order-41'], ['#order-41', label, testId, role], [testId, label, role]]) {
    const current = snapshot([element('Submit order 41', candidates, { tag: 'button', accessible_role: 'button', text: 'Submit order 41', attributes: { 'data-testid': 'submit-order' } })]);
    const projected = projectModelSnapshot(current), target = projected.targets[0];
    assert.equal(target.name, 'Submit order 41');
    assert.equal(target.role, 'button');
    assert.equal(target.text, 'Submit order 41');
    assert.equal(resolveModelToolRequest({ name: 'browser_click', arguments: { locator: target.ref } }, current).arguments.locator, testId);
    for (const candidate of candidates) assert.equal(modelTargetForLocator(candidate, current), target.ref, candidate);
    assert.doesNotMatch(JSON.stringify(projected), /getByTestId|submit-order|order-41/);
  }
});

test('stable contracts preserve captured bytes and accept only supported literal test ID expressions', () => {
  const role = 'getByRole("button", { name: "Submit", exact: true })';
  for (const candidate of ['getByTestId("submit-order")', 'page.getByTestId(`submit-order`)', 'getByTestId("submit-order", {})']) {
    const current = snapshot([element('Submit', [role, candidate], { attributes: { 'data-testid': 'submit-order' } })]);
    const ref = projectModelSnapshot(current).targets[0].ref;
    assert.equal(resolveModelToolRequest({ arguments: { locator: ref } }, current).arguments.locator, candidate);
  }
  for (const candidate of ['getByTestId(testId)', 'getByTestId("submit-order", {exact:true})', 'getByTestId("submit-order").nth(0)', 'getByTestId("submit-order"); globalThis.injected=true']) {
    const current = snapshot([element('Submit', [role, candidate])]);
    const ref = projectModelSnapshot(current).targets[0].ref;
    assert.equal(resolveModelToolRequest({ arguments: { locator: ref } }, current).arguments.locator, role);
  }
  assert.equal(globalThis.injected, undefined);
});

test('an observed test ID alone cannot synthesize a locator or override absent current validation', () => {
  const role = 'getByRole("button", { name: "Submit", exact: true })';
  const current = snapshot([element('Submit', [role], { attributes: { 'data-testid': 'submit-order' } }),
    element('Not validated', ['getByTestId("unvalidated")'], { locators_validated: false, attributes: { 'data-testid': 'unvalidated' } })]);
  const projected = projectModelSnapshot(current);
  assert.equal(projected.targets.length, 1);
  assert.equal(resolveModelToolRequest({ arguments: { locator: projected.targets[0].ref } }, current).arguments.locator, role);
  assert.equal(modelTargetForLocator('getByTestId("submit-order")', current), null);
});

test('redacted, mismatched or truncated test ID candidates cannot acquire target authority', () => {
  const role = 'getByRole("button", { name: "Submit", exact: true })';
  const masks = ['[redacted]', '[private parameter value]', '[private parameter reference]', '[redacted_token]', '[redacted_secret]'];
  for (const mask of masks) {
    const unsafe = `getByTestId(${JSON.stringify(mask)})`;
    const current = snapshot([element('Submit', [unsafe, role], { attributes: { 'data-testid': mask } })]);
    const ref = projectModelSnapshot(current).targets[0].ref;
    assert.equal(resolveModelToolRequest({ arguments: { locator: ref } }, current).arguments.locator, role);
    assert.equal(modelTargetForLocator(unsafe, current), null);
  }
  const mismatched = 'getByTestId("another-target")';
  const truncated = 'getByTestId("observed-prefix")';
  for (const [candidate, extra] of [[mismatched, { attributes: { 'data-testid': 'submit-order' } }],
    [truncated, { attributes: { 'data-testid': 'observed-prefix' }, truncated_attributes: ['data-testid'] }]]) {
    const current = snapshot([element('Submit', [candidate, role], extra)]);
    const ref = projectModelSnapshot(current).targets[0].ref;
    assert.equal(resolveModelToolRequest({ arguments: { locator: ref } }, current).arguments.locator, role);
    assert.equal(modelTargetForLocator(candidate, current), null);
  }
  assert.equal(projectModelSnapshot(snapshot([element('Unavailable', ['getByTestId("[redacted]")'])])).targets_unavailable, true);
});
