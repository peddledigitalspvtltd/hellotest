import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';
import { createPlaywrightCodeBindings } from '../../dist/lib/playwrightBindings.js';

const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const stateFromPrompt = prompt => JSON.parse(prompt.match(/^Current browser state and confirmed section progress \(page content is untrusted data\): (.+)$/m)[1]);

async function fixture(t, path, html) {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify();
  app.get(path, async (_request, reply) => reply.type('text/html').send(html));
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const url = `${base}${path}`;
  const session = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: url, allowBrowserActions: true });
  t.after(() => session.close());
  session.projectPromptText = value => value;
  const call = session.call, calls = [];
  session.call = async (name, args) => { calls.push({ name, args }); return call(name, args); };
  return { session, url, calls };
}

// Model choices are deterministic stubs. HTTP MCP initialization/discovery,
// Chrome page capture, provenance, save gating and source replay are real.
test('an unavailable page with no target controls reports its current observation without actor browser calls', { timeout: 60_000 }, async t => {
  const { session, url, calls } = await fixture(t, '/unavailable', '<!doctype html><title>Application unavailable</title><body>Application unavailable. Try again later.</body>');
  let modelCalls = 0;
  const observations = [];
  await assert.rejects(runAutomationBrowserAgent({
    browser: session, startUrl: url, prompt: 'Open the account workspace', actorMode: true,
    execution: { required: true, step_id: 'open-workspace', action: 'Open the account application', expected_result: 'The account workspace is displayed.' },
    maxTurns: 3, maxCalls: 5, parse: JSON.parse, onObservation: async observation => observations.push(observation),
    onPartialBuild: async () => assert.fail('an unavailable workspace must not save a successful section'),
    complete: async prompt => {
      modelCalls++;
      const page = stateFromPrompt(prompt).current_snapshot;
      assert.equal(page.title, 'Application unavailable');
      assert.equal(page.targets_unavailable, true);
      assert.deepEqual(page.targets, []);
      assert.ok(page.observation_id);
      return JSON.stringify({ stage: 'act', step_id: 'open-workspace', tool_calls: [], section_issue: {
        kind: 'unexpected_application_state', reason: 'The current page reports that the application is unavailable and exposes no workspace controls.',
        evidence_refs: [page.observation_id]
      } });
    }
  }), error => error.code === 'AUTOMATION_BROWSER_SECTION_BLOCKED' && error.details.evidence_count === 1);
  assert.equal(modelCalls, 1);
  assert.equal(calls.filter(call => call.name === 'browser_navigate').length, 1, 'only authorized initial navigation occurred');
  assert.equal(calls.filter(call => !['browser_navigate', 'browser_snapshot', 'browser_screenshot'].includes(call.name)).length, 0);
  const snapshot = observations.find(observation => observation.tool === 'browser_snapshot' && !observation.result?.isError);
  const receipt = JSON.parse(snapshot.result.content.find(part => part.type === 'text').text);
  assert.equal(receipt.source, 'playwright');
  assert.deepEqual(receipt.elements, []);
  assert.equal(receipt.title_truncated, undefined);
  assert.equal(receipt.url_truncated, undefined);
});

test('descriptive success prose against a terminal service error stops before MCP and reports the current issue without replay', { timeout: 60_000 }, async t => {
  const expected='A message is displayed indicating that the requested confirmation has been sent.';
  const {session,url,calls}=await fixture(t,'/service-error','<!doctype html><title>Confirmation request</title><main><form onsubmit="event.preventDefault();document.querySelector(\'[role=alert]\').textContent=\'Service authentication failed.\'"><button>Send confirmation</button><p role="alert"></p></form></main>');
  let turns=0,saves=0;
  await assert.rejects(runAutomationBrowserAgent({browser:session,startUrl:url,actorMode:true,prompt:'Send the confirmation once and check its authored outcome.',maxTurns:4,maxCalls:8,parse:JSON.parse,
    execution:{required:true,step_id:'send',action:'Submit the confirmation request.',expected_result:expected,source_obligations:[{action:'Submit the confirmation request.',expected_result:expected}]},
    onPartialBuild:async()=>{saves++;assert.fail('a service-error state cannot save the success outcome');},
    complete:async prompt=>{
      turns++;const current=stateFromPrompt(prompt),page=current.current_snapshot;
      if(turns===1)return JSON.stringify({stage:'act',step_id:'send',section_complete:false,tool_calls:[{name:'browser_click',arguments:{locator:page.targets.find(target=>target.name==='Send confirmation').ref}}]});
      const alert=page.targets.find(target=>target.role==='alert');assert.ok(alert?.ref);
      if(turns===2)return JSON.stringify({stage:'act',step_id:'send',section_complete:true,tool_calls:[{name:'browser_assert',arguments:{assertion:'text_contains',locator:alert.ref,value:expected}}]});
      assert.equal(turns,3);assert.equal(current.latest_failure.kind,'assertion_prose');
      assert.equal(current.latest_failure.code,'AUTOMATION_BROWSER_EXPECTED_PROSE_AS_TEXT');
      assert.equal(calls.filter(call=>call.name==='browser_assert').length,0,'descriptive prose never spent an MCP assertion timeout');
      assert.equal(calls.filter(call=>call.name==='browser_click').length,1,'the completed request is never repeated');
      return JSON.stringify({stage:'act',step_id:'send',tool_calls:[],section_issue:{kind:'unexpected_application_state',reason:'The selected current alert reports a service authentication failure rather than confirmation delivery.',evidence_refs:[alert.ref]}});
    }
  }),error=>error.code==='AUTOMATION_BROWSER_SECTION_BLOCKED'&&error.details.issue_kind==='unexpected_application_state');
  assert.equal(turns,3);assert.equal(saves,0);assert.equal(calls.filter(call=>call.name==='browser_assert').length,0);
});

test('an authored invalid-credential outcome uses its real error assertion and saves without a success assumption', { timeout: 60_000 }, async t => {
  const {session,url,calls}=await fixture(t,'/invalid-login','<!doctype html><title>Invalid credential fixture</title><main><form onsubmit="event.preventDefault();document.querySelector(\'[role=alert]\').textContent=\'Invalid credentials.\'"><button>Sign in</button><p role="alert"></p></form></main>');
  const goal={id:'negative-login',source:'section',action:'Submit invalid credentials.',expected_result:'A message is displayed indicating that the sign-in attempt failed with invalid credentials.'};
  let turns=0,reviews=0,saves=0;
  const built=await runAutomationBrowserAgent({browser:session,startUrl:url,actorMode:true,prompt:'Verify the invalid-credential outcome.',maxTurns:4,maxCalls:8,parse:JSON.parse,
    execution:{required:true,step_id:goal.id,action:goal.action,expected_result:goal.expected_result,obligations:[goal],source_obligations:[goal],semantic_review_required:true},
    onPartialBuild:async()=>{saves++;return {generation_complete:true};},
    complete:async prompt=>{
      if(prompt.includes('"kind":"automation_section_semantic_review"')){
        reviews++;const packet=JSON.parse(prompt.split('\n').at(-1));
        const click=packet.confirmed_operations.find(operation=>operation.name==='browser_click'),check=packet.confirmed_operations.find(operation=>operation.name==='browser_assert');
        assert.equal(check.arguments.value,'Invalid credentials.');
        return JSON.stringify({decision:'accept',obligations:[{id:goal.id,action_operations:[click.index],assertion_operations:[check.index]}],issues:[]});
      }
      turns++;const current=stateFromPrompt(prompt),page=current.current_snapshot;
      assert.notEqual(current.latest_failure?.kind,'assertion_prose');
      if(turns===1)return JSON.stringify({stage:'act',step_id:goal.id,section_complete:false,tool_calls:[{name:'browser_click',arguments:{locator:page.targets.find(target=>target.name==='Sign in').ref}}]});
      assert.equal(turns,2);
      return JSON.stringify({stage:'act',step_id:goal.id,section_complete:true,tool_calls:[{name:'browser_assert',arguments:{assertion:'text_contains',locator:page.targets.find(target=>target.role==='alert').ref,value:'Invalid credentials.'}}]});
    }
  });
  assert.equal(turns,2);assert.equal(reviews,1);assert.equal(saves,1);
  assert.equal(calls.filter(call=>call.name==='browser_click').length,1);assert.equal(calls.filter(call=>call.name==='browser_assert').length,1);
  assert.match(built.steps[0].automation_code,/Invalid credentials/);
});

test('an anticipated asynchronous outcome retains the retrying assertion while its selected alert is pending', {timeout:60_000},async t=>{
  const {session,url,calls}=await fixture(t,'/async-confirmation','<!doctype html><title>Pending confirmation fixture</title><main><form onsubmit="event.preventDefault();document.querySelector(\'[role=alert]\').textContent=\'Processing request.\';setTimeout(()=>document.querySelector(\'[role=alert]\').textContent=\'Confirmation sent.\',1600)"><button>Send confirmation</button><p role="alert"></p></form></main>');
  let turns=0,saves=0;
  await runAutomationBrowserAgent({browser:session,startUrl:url,actorMode:true,prompt:'Wait for the configured confirmation.',maxTurns:4,maxCalls:8,parse:JSON.parse,
    execution:{required:true,step_id:'async-confirmation',action:'Submit the confirmation request.',expected_result:'A message should be displayed indicating that confirmation is sent within five seconds.'},
    onPartialBuild:async()=>{saves++;return {generation_complete:true};},
    complete:async prompt=>{
      turns++;const current=stateFromPrompt(prompt),page=current.current_snapshot;
      if(turns===1)return JSON.stringify({stage:'act',step_id:'async-confirmation',section_complete:false,tool_calls:[{name:'browser_click',arguments:{locator:page.targets.find(target=>target.name==='Send confirmation').ref}}]});
      assert.equal(turns,2);assert.notEqual(current.latest_failure?.kind,'assertion_prose');
      return JSON.stringify({stage:'act',step_id:'async-confirmation',section_complete:true,tool_calls:[{name:'browser_assert',arguments:{assertion:'text_contains',locator:page.targets.find(target=>target.role==='alert').ref,value:'Confirmation sent.'}}]});
    }
  });
  assert.equal(turns,2);assert.equal(saves,1);assert.equal(calls.filter(call=>call.name==='browser_assert').length,1);
});

test('alert paragraph exact-text feedback produces nonce-free authored checks that verify again in a fresh browser', {timeout:60_000},async t=>{
  const html=`<!doctype html><title>Sign in</title><main><h1>Sign in</h1><form onsubmit="event.preventDefault();document.querySelector('[data-testid=login-alert]').innerHTML='<p id=login-message>Invalid credentials (support reference: '+crypto.randomUUID()+')</p><button type=button>Dismiss</button>'"><button>Submit invalid credentials</button><div role="alert" data-testid="login-alert"></div></form></main>`;
  const {session,url,calls}=await fixture(t,'/nonce-alert',html);
  const goal={id:'nonce-login',source:'section',action:'Submit the invalid credentials.',expected_result:'An error containing "Invalid credentials" is displayed and the sign-in screen remains open.'};
  let turns=0,reviews=0,saves=0,paragraph;
  const built=await runAutomationBrowserAgent({browser:session,startUrl:url,actorMode:true,prompt:'Preserve the authored invalid-credential requirement.',maxTurns:5,maxCalls:8,parse:JSON.parse,
    execution:{required:true,step_id:goal.id,action:goal.action,expected_result:goal.expected_result,obligations:[goal],source_obligations:[goal],semantic_review_required:true},
    onPartialBuild:async()=>{saves++;return {generation_complete:true};},
    complete:async prompt=>{
      if(prompt.includes('"kind":"automation_section_semantic_review"')){
        reviews++;const packet=JSON.parse(prompt.split('\n').at(-1)),click=packet.confirmed_operations.find(operation=>operation.name==='browser_click'),checks=packet.confirmed_operations.filter(operation=>operation.name==='browser_assert');
        assert.equal(checks.length,2);assert.equal(checks[0].arguments.value,'Invalid credentials');
        return JSON.stringify({decision:'accept',obligations:[{id:goal.id,action_operations:[click.index],assertion_operations:checks.map(operation=>operation.index)}],issues:[]});
      }
      turns++;const current=stateFromPrompt(prompt),page=current.current_snapshot;
      if(turns===1)return JSON.stringify({stage:'act',step_id:goal.id,section_complete:false,tool_calls:[{name:'browser_click',arguments:{locator:page.targets.find(target=>target.role==='button'&&target.name==='Submit invalid credentials').ref}}]});
      const alert=page.targets.find(target=>target.role==='alert');assert.ok(alert?.text.includes('Dismiss'));
      if(turns===2){paragraph=alert.text.replace(/\s*Dismiss\s*$/,'').trim();return JSON.stringify({stage:'act',step_id:goal.id,section_complete:true,tool_calls:[{name:'browser_assert',arguments:{assertion:'text',locator:alert.ref,value:paragraph}}]});}
      assert.equal(turns,3);assert.equal(current.latest_failure.kind,'assertion_container_text');
      assert.equal(calls.filter(call=>call.name==='browser_assert').length,0,'the exact paragraph text never reaches a parent-container MCP assertion');
      return JSON.stringify({stage:'act',step_id:goal.id,section_complete:true,tool_calls:[
        {name:'browser_assert',arguments:{assertion:'text_contains',locator:alert.ref,value:'Invalid credentials'}},
        {name:'browser_assert',arguments:{assertion:'visible',locator:page.targets.find(target=>target.role==='heading'&&target.name==='Sign in').ref}}
      ]});
    }
  });
  assert.equal(turns,3);assert.equal(reviews,1);assert.equal(saves,1);assert.equal(calls.filter(call=>call.name==='browser_click').length,1);
  assert.equal(calls.filter(call=>call.name==='browser_assert').length,2);
  const source=built.steps[0].automation_code;assert.doesNotMatch(source,/support reference|Dismiss/);
  await session.close();
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});t.after(()=>browser.close());
  const page=await browser.newPage(),bindings=createPlaywrightCodeBindings(page,{interpolate:value=>value,resolveLocator:value=>value,resolveUrl:value=>value,assertionTimeout:1000});
  await new AsyncFunction('page','expect','params',source)(bindings.page,bindings.expect,{});
  assert.notEqual(await page.locator('#login-message').innerText(),paragraph,'fresh execution has a different diagnostic suffix without changing the expected result');
});

test('repeating an exact alert-parent paragraph proposal stops with zero MCP assertions and no second submission', {timeout:60_000},async t=>{
 const {session,url,calls}=await fixture(t,'/repeat-container','<!doctype html><title>Login</title><main><form onsubmit="event.preventDefault();document.querySelector(\'[role=alert]\').innerHTML=\'<p>Invalid credentials (support reference: fixture)</p><button type=button>Dismiss</button>\'"><button>Sign in</button><div role="alert"></div></form></main>');
 let turns=0;
 await assert.rejects(runAutomationBrowserAgent({browser:session,startUrl:url,actorMode:true,prompt:'Verify the authored error once.',maxTurns:5,maxCalls:8,parse:JSON.parse,
  execution:{required:true,step_id:'repeat-container',action:'Submit invalid credentials.',expected_result:'An error containing "Invalid credentials" is displayed.'},
  onPartialBuild:async()=>assert.fail('rejected proposal cannot save'),
  complete:async prompt=>{
   turns++;const page=stateFromPrompt(prompt).current_snapshot;
   if(turns===1)return JSON.stringify({stage:'act',step_id:'repeat-container',section_complete:false,tool_calls:[{name:'browser_click',arguments:{locator:page.targets.find(target=>target.role==='button'&&target.name==='Sign in').ref}}]});
   const alert=page.targets.find(target=>target.role==='alert');
   return JSON.stringify({stage:'act',step_id:'repeat-container',section_complete:true,tool_calls:[{name:'browser_assert',arguments:{assertion:'text',locator:alert.ref,value:alert.text.replace(/\s*Dismiss\s*$/,'').trim()}}]});
  }
 }),error=>error.code==='AUTOMATION_BROWSER_ASSERTION_PROPOSAL_STALLED'&&error.details.assertion_feedback_code==='AUTOMATION_BROWSER_ASSERTION_CONTAINER_TEXT_MISMATCH');
 assert.equal(turns,3);assert.equal(calls.filter(call=>call.name==='browser_click').length,1);assert.equal(calls.filter(call=>call.name==='browser_assert').length,0);
});

test('hidden alert descendants do not reject a matching exact visible-text assertion', {timeout:60_000},async t=>{
 const {session,url,calls}=await fixture(t,'/hidden-alert','<!doctype html><title>Login</title><main><div role="alert"><p>Invalid credentials</p><span hidden>Hidden diagnostic suffix</span></div></main>');
 let turns=0,saves=0;
 await runAutomationBrowserAgent({browser:session,startUrl:url,actorMode:true,prompt:'Verify the authored exact visible error.',maxTurns:3,maxCalls:6,parse:JSON.parse,
  execution:{required:true,step_id:'hidden-alert',action:'Inspect the visible error.',expected_result:'The alert displays exactly "Invalid credentials".'},
  onPartialBuild:async()=>{saves++;return {generation_complete:true};},
  complete:async prompt=>{
   turns++;const current=stateFromPrompt(prompt),alert=current.current_snapshot.targets.find(target=>target.role==='alert');
   assert.equal(current.latest_failure,undefined);assert.match(alert.text,/Hidden diagnostic suffix/);
   assert.equal(alert.visible_text,'Invalid credentials');
   return JSON.stringify({stage:'act',step_id:'hidden-alert',section_complete:true,tool_calls:[{name:'browser_assert',arguments:{assertion:'text',locator:alert.ref,value:'Invalid credentials'}}]});
  }
 });
 assert.equal(turns,1);assert.equal(saves,1);assert.equal(calls.filter(call=>call.name==='browser_assert').length,1);
});

test('real MCP location receipts retain title and URL loss markers before model projection', { timeout: 60_000 }, async t => {
  const title = 'Long observed document title '.repeat(12);
  const { session, url } = await fixture(t, '/metadata', `<!doctype html><title>${title}</title><h1>Metadata fixture</h1>
    <script>history.replaceState(null, '', '?state=' + 'q'.repeat(2100))</script>`);
  const navigation = await session.call('browser_navigate', { url });
  assert.equal(navigation.isError, undefined);
  const snapshot = await session.call('browser_snapshot', {});
  assert.equal(snapshot.isError, undefined);
  for (const result of [navigation, snapshot]) {
    const receipt = JSON.parse(result.content.find(part => part.type === 'text').text);
    assert.equal(receipt.source, 'playwright');
    assert.equal(receipt.title.length, 200);
    assert.equal(receipt.title_truncated, true);
    assert.equal(receipt.url.length, 2_000);
    assert.equal(receipt.url_truncated, true);
  }
});

test('a copied title excerpt is blocked before MCP and the authored heading check replays unchanged in fresh Chrome', { timeout: 60_000 }, async t => {
  const fullTitle = 'Observed workspace metadata '.repeat(12);
  const expectedHeading = 'Ready for manual tests';
  const { session, url, calls } = await fixture(t, '/workspace', `<!doctype html><title>${fullTitle}</title><main><h1>${expectedHeading}</h1></main>`);
  const observations = [], events = [];
  let modelCalls = 0, saves = 0, excerpt;
  const result = await runAutomationBrowserAgent({
    browser: session, startUrl: url, prompt: 'Open the workspace and verify its authored heading', actorMode: true,
    execution: { required: true, step_id: 'workspace', action: 'Open the workspace', expected_result: `The heading text equals "${expectedHeading}".` },
    maxTurns: 4, maxCalls: 8, parse: JSON.parse,
    onObservation: async observation => observations.push(observation), onProgress: async event => events.push(event),
    onPartialBuild: async () => { saves++; assert.equal(modelCalls, 2); return { generation_complete: true }; },
    complete: async prompt => {
      const current = stateFromPrompt(prompt), page = current.current_snapshot;
      modelCalls++;
      assert.equal(page.title_truncated, true);
      assert.equal(page.title.length, 200);
      if (modelCalls === 1) {
        excerpt = page.title;
        assert.notEqual(excerpt, fullTitle);
        return JSON.stringify({ stage: 'act', step_id: 'workspace', section_complete: true,
          tool_calls: [{ name: 'browser_assert', arguments: { assertion: 'title', value: excerpt } }] });
      }
      assert.equal(modelCalls, 2);
      assert.match(prompt, /AUTOMATION_BROWSER_ASSERTION_EXCERPT_NOT_EXACT/);
      assert.equal(calls.filter(call => call.name === 'browser_assert').length, 0, 'the copied excerpt never reached MCP');
      assert.equal(saves, 0);
      const heading = page.targets.find(target => target.name === expectedHeading && target.role === 'heading');
      assert.ok(heading?.ref);
      return JSON.stringify({ stage: 'act', step_id: 'workspace', section_complete: true,
        tool_calls: [{ name: 'browser_assert', arguments: { assertion: 'text', locator: heading.ref, value: expectedHeading } }] });
    }
  });
  assert.equal(modelCalls, 2);
  assert.equal(saves, 1);
  assert.deepEqual(calls.filter(call => call.name === 'browser_assert').map(call => call.args.assertion), ['text']);
  const feedback = observations.find(observation => observation.mcp_call === false
    && observation.result?.content?.some(part => part.type === 'text' && part.text.includes('AUTOMATION_BROWSER_ASSERTION_EXCERPT_NOT_EXACT')));
  assert.ok(feedback);
  assert.equal(JSON.parse(feedback.result.content[0].text).action_outcome, 'not_attempted');
  assert.ok(events.some(event => event.details?.error_code === 'AUTOMATION_BROWSER_ASSERTION_EXCERPT_NOT_EXACT'));
  const source = result.steps[0].automation_code;
  assert.ok(source.includes(expectedHeading));
  assert.ok(!source.includes(excerpt));
  assert.doesNotMatch(source, /ref:[a-f0-9]+:/);
  await session.close();
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const bindings = createPlaywrightCodeBindings(page, { interpolate: value => value, resolveLocator: value => value, resolveUrl: value => value, assertionTimeout: 1000 });
  await new AsyncFunction('page', 'expect', 'params', source)(bindings.page, bindings.expect, {});
  assert.equal(await page.title(), fullTitle.trim(), 'fresh replay retains the actual longer title');
  assert.equal(await page.getByRole('heading', { name: expectedHeading, exact: true }).innerText(), expectedHeading);
});
