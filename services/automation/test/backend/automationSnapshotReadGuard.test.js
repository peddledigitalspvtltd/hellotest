const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutomationSnapshotReadGuard } = require('../../backend/lib/automationSnapshotReadGuard');

const request = { name: 'browser_snapshot', arguments: {} };
const receipt = (value = {}, isError = false) => ({ isError, content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...value }) }] });
const page = () => ({ url: 'https://app.test/login', title: 'Sign in', scope: 'body', accessibility: '- textbox "Email"',
  elements: [{ tag: 'input', attributes: { id: 'email' }, checked: false, disabled: false, displayed: true, locators_validated: true, locator_candidates: ['#email'] }], partial: false });
const snapshot = (changes = {}, extra = {}) => ({ tool: 'browser_snapshot', arguments: {}, execution_step_id: 'login', result: receipt({ ...page(), observation_id: 'unique-' + Math.random(), captured_at: new Date().toISOString(), ...changes }), ...extra });
const inspect = (guard, observations, proposed = request, stepId = 'login') => guard.inspect({ request: proposed, observations, stepId });

test('allows a baseline and one unchanged refresh, then feedback and a terminal repeated proposal without another MCP call', () => {
  const guard = createAutomationSnapshotReadGuard(), observations = [];
  let mcpCalls = 0, decision;
  for (let turn = 0; turn < 4; turn++) {
    decision = inspect(guard, observations);
    if (!decision) { mcpCalls++; observations.push(snapshot()); }
    else if (!decision.stop) observations.push({ tool: 'automation_snapshot_feedback', mcp_call: false, result: receipt(decision.feedback, true) });
  }
  assert.equal(mcpCalls, 2);
  assert.equal(decision.stop, true);
  assert.equal(decision.feedback.code, 'AUTOMATION_BROWSER_SNAPSHOT_READ_STALLED');
  assert.equal(decision.feedback.action_outcome, 'not_attempted');
  assert.equal(decision.feedback.expected_result_verified, false);
});

test('snapshot provenance and object key order do not create fresh evidence', () => {
  const guard = createAutomationSnapshotReadGuard(), first = snapshot();
  const parsed = JSON.parse(first.result.content[0].text);
  const reordered = Object.fromEntries(Object.entries(parsed).reverse());
  const second = { ...snapshot(), result: receipt({ ...reordered, observation_id: 'new', captured_at: '2099-01-01' }) };
  assert.equal(inspect(guard, [first, second]).stop, false);
});

test('changed URL, field state, visible result, truncation or locator evidence reopens observation', () => {
  for (const changes of [
    { url: 'https://app.test/after' }, { accessibility: '- alert: Ready' }, { partial: true }, { elements_truncated: true },
    { elements: [{ ...page().elements[0], checked: true }] }, { elements: [{ ...page().elements[0], disabled: true }] },
    { elements: [{ ...page().elements[0], locator_candidates: ['#new-email'] }] },
    { elements: [{ tag: 'div', attributes: { role: 'alert' }, visible_text: 'New message', visible_text_truncated: false }] }
  ]) assert.equal(inspect(createAutomationSnapshotReadGuard(), [snapshot(), snapshot(changes)]), null);
});

test('scoped snapshots and other tools are never blocked by the full-page guard', () => {
  const guard = createAutomationSnapshotReadGuard(), observations = [snapshot(), snapshot()];
  assert.equal(inspect(guard, observations, { name: 'browser_snapshot', arguments: { locator: '#email' } }), null);
  assert.equal(inspect(guard, observations, { name: 'browser_assert', arguments: { assertion: 'visible', locator: '#email' } }), null);
});

test('real mutations, native checks, waits and scoped evidence reset the refresh allowance', () => {
  for (const tool of ['browser_fill', 'browser_click', 'browser_assert', 'browser_validate_locator', 'browser_wait_for', 'browser_snapshot']) {
    const barrier = { tool, arguments: tool === 'browser_snapshot' ? { locator: '#email' } : {}, result: receipt({ action_outcome: 'completed', ...(tool === 'browser_snapshot' ? page() : {}) }) };
    const guard = createAutomationSnapshotReadGuard();
    assert.equal(inspect(guard, [snapshot(), snapshot(), barrier, snapshot()]), null, tool);
    assert.equal(inspect(guard, [snapshot(), snapshot(), barrier, snapshot(), snapshot()]).stop, false, tool);
  }
});

test('optional screenshots preserve the baseline and cannot reopen a blocked full-page read', () => {
  const guard = createAutomationSnapshotReadGuard();
  const screenshot = () => ({ tool: 'browser_screenshot', result: receipt({ action_outcome: 'completed', mime_type: 'image/jpeg' }) });
  const observations = [snapshot(), screenshot()];
  assert.equal(inspect(guard, observations), null, 'one refresh remains available after bootstrap');
  observations.push(snapshot(), screenshot());
  assert.equal(inspect(guard, observations).stop, false);
  observations.push(screenshot());
  assert.equal(inspect(guard, observations).stop, true);
});

test('asynchronous failed native checks permit another snapshot without permitting an action replay', () => {
  const check = { tool: 'browser_assert', result: receipt({ code: 'BROWSER_ASSERTION_NOT_SATISFIED', action_outcome: 'not_attempted', assertion_outcome: 'not_satisfied' }, true) };
  assert.equal(inspect(createAutomationSnapshotReadGuard(), [snapshot(), snapshot(), check]), null);
});

test('feedback, reconciled actions and fabricated non-MCP receipts cannot reset unchanged evidence', () => {
  const observations = [snapshot(), snapshot(),
    { tool: 'automation_action_reconciliation', result: receipt({ action_outcome: 'completed' }), mcp_call: false },
    { tool: 'browser_assert', result: receipt({ assertion_outcome: 'satisfied' }), mcp_call: false },
    { tool: 'browser_unknown', result: receipt({ action_outcome: 'completed' }) }];
  assert.equal(inspect(createAutomationSnapshotReadGuard(), observations).stop, false);
  assert.equal(inspect(createAutomationSnapshotReadGuard(), [snapshot({}, { mcp_call: false }), snapshot({}, { mcp_call: false })]), null);
});

test('prior-section snapshots supply one baseline without consuming the current section refresh', () => {
  const guard = createAutomationSnapshotReadGuard(), prior = [snapshot({}, { execution_step_id: 'prior' }), snapshot({}, { execution_step_id: 'prior' })];
  assert.equal(inspect(guard, prior), null);
  assert.equal(inspect(guard, [...prior, snapshot()]).stop, false);
});

test('new evidence epochs receive their own feedback before a terminal repeat', () => {
  const guard = createAutomationSnapshotReadGuard(), observations = [snapshot(), snapshot()];
  assert.equal(inspect(guard, observations).stop, false);
  assert.equal(inspect(guard, observations).stop, true);
  observations.push({ tool: 'browser_wait_for', result: receipt({ action_outcome: 'completed' }) }, snapshot(), snapshot());
  assert.equal(inspect(guard, observations).stop, false);
});

test('missing, invalid or failed evidence cannot establish a complete repeated snapshot', () => {
  for (const last of [snapshot({ accessibility: undefined }), snapshot({ elements: undefined }),
    { tool: 'browser_snapshot', arguments: {}, result: receipt({ code: 'BROWSER_READ_UNAVAILABLE' }, true) }]) {
    assert.equal(inspect(createAutomationSnapshotReadGuard(), [snapshot(), snapshot(), last]), null);
  }
  for (const argumentsValue of [undefined, null, [], { locator: '' }, { extra: true }]) {
    assert.equal(inspect(createAutomationSnapshotReadGuard(), [snapshot(), snapshot()], { ...request, arguments: argumentsValue }), null);
  }
});

test('feedback contains no URL, private fields, snapshot contents or semantic fingerprints', () => {
  const secret = 'private-user-value@fixture.test';
  const observations = [snapshot({ accessibility: secret, url: 'https://app.test/path?source=' + secret }), snapshot({ accessibility: secret, url: 'https://app.test/path?source=' + secret })];
  const guard = createAutomationSnapshotReadGuard();
  const decision = inspect(guard, observations);
  assert.doesNotMatch(JSON.stringify(decision), /private-user|fixture\.test|https?:|fingerprint|[a-f0-9]{64}/);
  assert.match(decision.feedback.message, /native expected-result assertion/);
  assert.match(decision.feedback.message, /asynchronous state/);
  assert.equal(inspect(guard, observations).stop, true);
});

const scopedRequest=(locator='#email',frame)=>({name:'browser_snapshot',arguments:{locator,...(frame?{frame}:{})}});
const scopedSnapshot=(changes={},extra={})=>snapshot({scope:'#email',truncated:false,...changes},{arguments:{locator:'#email'},...extra});

test('the exact currently grounded element scope gets one unchanged refresh and then stops repeated reads',()=>{
 const guard=createAutomationSnapshotReadGuard(),observations=[scopedSnapshot(),scopedSnapshot()];
 const first=inspect(guard,observations,scopedRequest());assert.equal(first.stop,false);assert.equal(first.feedback.code,'AUTOMATION_BROWSER_SNAPSHOT_UNCHANGED');assert.equal(first.feedback.expected_result_verified,false);
 assert.equal(inspect(guard,observations,scopedRequest()).stop,true);
 assert.equal(inspect(guard,observations,scopedRequest('#other')),null,'A genuinely different scope still needs its own native grounding');
});

test('stable bounded Location-like scoped captures cannot bypass the guard through unchanged truncation flags',()=>{
 const locator='.custom-dropdown-main-container:has(#location)';
 for(const flags of [{partial:false,accessibility_truncated:false,elements_truncated:false,fields_truncated:true},
  {partial:true,truncated:true,fields_truncated:true,warnings:['Optional bounded evidence is incomplete.']}]){
  const observed=()=>scopedSnapshot({...flags,scope:locator},{arguments:{locator}}),guard=createAutomationSnapshotReadGuard(),rows=[observed(),observed()];
  const feedback=inspect(guard,rows,scopedRequest(locator));assert.equal(feedback.stop,false);assert.equal(feedback.feedback.expected_result_verified,false);assert.match(feedback.feedback.message,/missing or truncated/);
  assert.equal(inspect(guard,rows,scopedRequest(locator)).stop,true);
  assert.equal(inspect(createAutomationSnapshotReadGuard(),[observed(),scopedSnapshot({...flags,scope:locator,fields_truncated:false},{arguments:{locator}})],scopedRequest(locator)),null,'Changed completeness metadata permits a fresh read');
 }
});

test('scoped evidence preserves native frame/document identity and fresh grounding after any other snapshot',()=>{
 const frame=['#form'],state={frame_path:frame,frame_url:'https://app.test/form',frame_document_id:'document-one'};
 const child=(changes={})=>scopedSnapshot({...state,...changes},{arguments:{locator:'#email',frame}});
 const request=scopedRequest('#email',frame),guard=createAutomationSnapshotReadGuard();
 assert.equal(inspect(guard,[child(),child()],request).stop,false);
 assert.equal(inspect(createAutomationSnapshotReadGuard(),[child(),child({frame_document_id:'document-two'})],request),null);
 assert.equal(inspect(createAutomationSnapshotReadGuard(),[child(),child({frame_url:'https://foreign.test/form'})],request),null);
 for(const newer of [snapshot({frames:[{path:frame,url:'https://app.test/form',frame_document_id:'document-two'}]}),
  scopedSnapshot({scope:'#other'},{arguments:{locator:'#other'}}),scopedSnapshot({...state,frame_path:['#sibling']},{arguments:{locator:'#email',frame:['#sibling']}})]){
  assert.equal(inspect(createAutomationSnapshotReadGuard(),[child(),child(),newer],request),null,'Another snapshot replaces the current native target ledger; its old refs cannot be reused');
 }
});

test('changed or incomplete scoped state and real native work reopen the scoped read without outcome proof',()=>{
 for(const changes of [{url:'https://app.test/new'},{accessibility:'New result'},{elements:[{...page().elements[0],readonly:true}]},
  {partial:true},{truncated:true},{fields_truncated:true},{elements_truncated:true},{accessibility_truncated:true},{elements:[{...page().elements[0],locators_validated:false}]}]){
  assert.equal(inspect(createAutomationSnapshotReadGuard(),[scopedSnapshot(),scopedSnapshot(changes)],scopedRequest()),null);
 }
 for(const tool of ['browser_fill','browser_click','browser_assert','browser_wait_for','browser_validate_locator']){
  const barrier={tool,result:receipt({action_outcome:'completed'})};
  assert.equal(inspect(createAutomationSnapshotReadGuard(),[scopedSnapshot(),scopedSnapshot(),barrier],scopedRequest()),null,tool);
 }
 const failed={tool:'browser_snapshot',arguments:{locator:'#email'},result:receipt({code:'BROWSER_READ_UNAVAILABLE'},true)};
 assert.equal(inspect(createAutomationSnapshotReadGuard(),[scopedSnapshot(),scopedSnapshot(),failed],scopedRequest()),null);
});

test('synthetic scoped receipts and optional screenshots cannot manufacture a new evidence epoch or leak its data',()=>{
 const privateText='PRIVATE_SCOPE_VALUE',locator='[data-private="'+privateText+'"]',read=scopedRequest(locator);
 const first=scopedSnapshot({scope:locator,accessibility:privateText},{arguments:{locator}}),second=scopedSnapshot({scope:locator,accessibility:privateText},{arguments:{locator}});
 const screenshot={tool:'browser_screenshot',result:receipt({mime_type:'image/jpeg'})},guard=createAutomationSnapshotReadGuard();
 const decision=inspect(guard,[first,second,screenshot,{tool:'automation_snapshot_feedback',mcp_call:false,result:receipt({})}],read);
 assert.equal(decision.stop,false);assert.doesNotMatch(JSON.stringify(decision),/PRIVATE_SCOPE_VALUE|data-private|https?:|[a-f0-9]{64}/);
 assert.equal(inspect(createAutomationSnapshotReadGuard(),[{...first,mcp_call:false},{...second,mcp_call:false}],read),null);
 for(const args of [{locator:''},{locator:'#email',frame:[]},{locator:'#email',extra:true}])assert.equal(inspect(createAutomationSnapshotReadGuard(),[first,second],{name:'browser_snapshot',arguments:args}),null);
});
