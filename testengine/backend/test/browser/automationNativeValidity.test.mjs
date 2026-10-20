import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { registerAutomationMcp, assertAutomationBrowserCondition, readNativeConstraintValidity, readFieldValidationState, validateAutomationBrowserAssertion } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';
import { buildPlaywrightArtifact, createPlaywrightExecutionOptions } from '../../../../services/automation/shared/playwrightArtifact.mjs';
import { assertTypeScriptExportCompiles } from '../../../../services/automation/test/browser/playwrightExportFixture.mjs';
const require = createRequire(import.meta.url);
const { parseExpressionAt } = require('acorn');
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent');
const { createBrowserParameterResolver } = require('../../../../services/automation/backend/lib/automationBrowserParameters');
const { nativeConstraintValiditySource } = require('../../../../services/automation/backend/lib/automationNativeValidity');
const { fieldValidationStateSource } = require('../../../../services/automation/backend/lib/automationFieldValidity');
const { createRetainedAssertionContract } = require('../../../../services/automation/backend/lib/automationRetainedAssertions');
const { compileRecordedProgram } = require('../../../../services/automation/backend/lib/automationRecordedProgram');
const { normalizeGeneratedProgram } = require('../../../../services/automation/backend/lib/automationGeneratedProgram');
const { exactLinearCoverage } = require('../../../../services/automation/backend/lib/automationActionReconciliation');
const { deriveProgramTools } = require('../../../../services/automation/backend/lib/automationProgramTools');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !['start', 'end', 'loc', 'raw'].includes(key)).map(([key, item]) => [key, stable(item)])) : value;
const parsed = result => JSON.parse(result.content.find(part => part.type === 'text').text);

async function replay(t, source, execution, values) {
  const directory = await mkdtemp(path.join(tmpdir(), 'qaira-native-validity-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifact = buildPlaywrightArtifact({ testCase: { id: 'native-validity', title: 'Native control constraints' },
    steps: [{ id: execution.step_id, step_order: 1, step_type: 'web', action: execution.action, expected_result: execution.expected_result, automation_code: source }],
    rows: [values], sectionRows: [[values]], executionOptions: createPlaywrightExecutionOptions({ screenshot_on_success: false, screenshot_on_failure: false }) });
  assert.doesNotMatch(artifact, /Export limitation:|Standalone export blocked:/);
  const spec = path.join(directory, 'validity.spec.ts');await writeFile(spec, artifact);assertTypeScriptExportCompiles([spec]);
  // Resolve the installed Playwright Test implementation without rewriting the
  // actual exported spec or adding a package installation.
  const forwarding = path.join(directory, 'node_modules/@playwright/test');await mkdir(forwarding, { recursive: true });
  await writeFile(path.join(forwarding, 'package.json'), JSON.stringify({ name: '@playwright/test', type: 'module', exports: './index.mjs' }));
  await writeFile(path.join(forwarding, 'index.mjs'), `export * from ${JSON.stringify(pathToFileURL(fileURLToPath(new URL('../../node_modules/playwright/test.mjs', import.meta.url))).href)};`);
  const config = path.join(directory, 'playwright.config.cjs');await writeFile(config, 'module.exports=' + JSON.stringify({ testDir: directory, testMatch: 'validity.spec.ts',
    workers: 1, retries: 0, reporter: 'json', outputDir: path.join(directory, 'results'), use: { headless: true,
      launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} } }));
  const output = await new Promise((resolve, reject) => {
    let stdout = '', stderr = '';
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/playwright/cli.js', import.meta.url)), 'test', '--config', config],
      { env: { ...process.env, QAIRA_BASE_URL: '', QAIRA_DATA_JSON: '{}' } });
    t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
    child.stdout.on('data', chunk => { stdout += chunk; });child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);child.on('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(output.code, 0, output.stdout + '\n' + output.stderr);
  const report = JSON.parse(output.stdout);assert.equal(report.stats.expected, 1);assert.equal(report.stats.unexpected, 0);
}

test('compact generated sections reuse two field queries and one validation reader through real MCP and fresh Playwright CLI replay', { timeout: 150_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  let session, submissions = 0;
  const app = Fastify();t.after(async () => { await session?.close();await app.close(); });
  app.get('/form', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Compact field checks</title><form>
    <label>Name<input id="name" required aria-describedby="optional-hint"></label>
    <label>Password<input id="password" type="password" required aria-errormessage="password-error"></label><p id="password-error" hidden></p>
    </form><script>document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();fetch('/submit',{method:'POST'})})</script>`));
  app.post('/submit', async () => { submissions++;return {}; });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base = await app.listen({host:'127.0.0.1',port:0});
  const requests = [{ name: 'browser_navigate', arguments: { url: `${base}/form` } },
    ...['name','password'].flatMap(name => [{name:'browser_fill',arguments:{locator:'#'+name,value:'@r.'+name}},
      {name:'browser_assert',arguments:{assertion:'value',locator:'#'+name,value:'@r.'+name}},
      {name:'browser_assert',arguments:{assertion:'field_valid',locator:'#'+name}}])];
  const resolver = createBrowserParameterResolver({caseValues:{'r.name':'MCP Fixture Name','r.password':'MCP-fixture-password'}});
  session = await connectAutomationBrowser({integration:{base_url:base},startUrl:`${base}/form`,allowBrowserActions:true});
  for(const request of requests){const result=await session.call(request.name,resolver.resolve(request.name,request.arguments));assert.notEqual(result.isError,true,JSON.stringify(result));}
  const compact=compileRecordedProgram(requests),inline=compileRecordedProgram(requests,{layout:'inline'});
  assert.equal(compact.assertion_count,4);assert.equal(compact.operation_count,7);
  assert.equal(compact.source.split('function readFieldValidationState').length-1,1);
  assert.equal(compact.source.split('page.locator("#name")').length-1,1);
  assert.equal(compact.source.split('page.locator("#password")').length-1,1);
  assert.ok(compact.source.length<inline.source.length*0.6);assert.doesNotMatch(compact.source,/MCP Fixture|MCP-fixture-password/);
  await session.close();
  await replay(t,compact.source,{step_id:'compact-fields',action:'Enter name and password',expected_result:'Both configured values are retained without field errors'},
    {'r.name':'Fresh Replay Name','r.password':'Fresh-replay-password'});
  assert.equal(submissions,0,'read-only polls never submit the form');
});

test('native constraint validity is read-only through real MCP, source validation, compilation and unchanged standalone Chrome replay', { timeout: 150_000 }, async t => {
  assert.deepEqual(stable(parseExpressionAt(readNativeConstraintValidity.toString(), 0, { ecmaVersion: 'latest' })),
    stable(parseExpressionAt(nativeConstraintValiditySource, 0, { ecmaVersion: 'latest' })), 'independently packaged readers have exactly the same syntax');
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  let browser, session, inputs = 0, invalidEvents = 0, submissions = 0;
  const app = Fastify();t.after(async () => { await session?.close();await browser?.close();await app.close(); });
  app.get('/form', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Native constraints</title><main><h1>Native constraints</h1><form>
    <label>Full name<input id="name" data-testid="native-name" required></label>
    <label>Email<input id="email" type="email" value="not-an-email"></label>
    <label>Custom<input id="custom" value="private-fixture-value"></label>
    <label>Required<input id="required" required></label>
    <label>Bio<textarea id="bio" required>Existing biography</textarea></label>
    <label>Choice<select id="choice" required><option value="">Choose</option><option value="x" selected>Selected</option></select></label>
    <input id="readonly" readonly required><input id="disabled" disabled required><input id="hidden" type="hidden" required>
    <fieldset id="fieldset"><legend>Group</legend></fieldset><output id="output">Result</output><button id="button" type="button">Only a button</button><div id="plain">Plain text</div>
    </form></main><script>
    document.querySelector('#custom').setCustomValidity('private-fixture-validation-message');
    document.addEventListener('invalid',()=>fetch('/invalid-event',{method:'POST'}),true);
    document.querySelector('#name').addEventListener('input',()=>fetch('/input-event',{method:'POST'}));
    document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();fetch('/submit-event',{method:'POST'})});
    </script>`));
  app.post('/input-event', async () => { inputs++;return {}; });app.post('/invalid-event', async () => { invalidEvents++;return {}; });app.post('/submit-event', async () => { submissions++;return {}; });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()), { launchBrowser: async options => {
    browser = await chromium.launch(options);return browser;
  } });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  session = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: `${base}/form`, allowBrowserActions: true });
  const schema = session.tools.find(tool => tool.name === 'browser_assert');
  assert.ok(schema.inputSchema.properties.assertion.enum.includes('valid'));assert.ok(schema.inputSchema.properties.assertion.enum.includes('invalid'));
  assert.match(schema.description, /willValidate/);assert.match(schema.description, /server\/business/);
  const parameters = createBrowserParameterResolver({ caseValues: { 'r.name': 'Initial Fixture Name' } }), originalCall = session.call, calls = [], observations = [];
  session.projectPromptText = parameters.projectText;session.projectPrivateText = parameters.projectPrivateText;
  session.call = async (name, args) => { calls.push({ name, args: { ...args } });return parameters.redactResult(await originalCall(name, parameters.resolve(name, args))); };
  const execution = { required: true, step_id: 'native-constraints', action: 'Enter the configured full name and inspect native constraints without submitting.',
    expected_result: 'The configured full name is entered and valid. Email, Custom and Required are invalid. Bio and Choice are valid.' };
  let turns = 0, saves = 0;
  const built = await runAutomationBrowserAgent({ browser: session, startUrl: `${base}/form`, execution, actorMode: true, generationMode: 'sequential', parse: JSON.parse,
    prompt: 'Use configured @r.name for the Full name input. Inspect each specified native constraint without submitting.', maxTurns: 3, maxCalls: 14,
    onObservation: async observation => observations.push(observation), onPartialBuild: async payload => {
      saves++;const source = payload.steps[0].automation_code;assert.equal(normalizeGeneratedProgram(source), source);
      const coverage = exactLinearCoverage({ payload, execution, observations });assert.equal(coverage.supported, true);assert.equal(coverage.missing_action_count, 0);
      assert.equal(coverage.missing_source_action_count, undefined);
      assert.deepEqual(deriveProgramTools({ payload, execution }).filter(tool => tool.name === 'browser_assert').map(tool => tool.arguments.assertion),
        ['value', 'valid', 'invalid', 'invalid', 'invalid', 'valid', 'valid']);
      return { generation_complete: true };
    }, complete: async prompt => {
      turns++;const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
      const ref = label => current.current_snapshot.targets.find(target => target.name === label)?.ref;
      const tool_calls = turns === 1 ? [{ name: 'browser_fill', arguments: { locator: ref('Full name'), value: '@r.name' } }] : [
        { name: 'browser_assert', arguments: { assertion: 'value', locator: ref('Full name'), value: '@r.name' } },
        ...[['Full name','valid'],['Email','invalid'],['Custom','invalid'],['Required','invalid'],['Bio','valid'],['Choice','valid']].map(([label, assertion]) => ({ name: 'browser_assert', arguments: { assertion, locator: ref(label) } }))
      ];
      return JSON.stringify({ stage: 'act', step_id: execution.step_id, tool_calls, section_complete: turns === 2 });
    } });
  assert.equal(saves, 1);assert.equal(turns, 2);assert.equal(calls.filter(call => call.name === 'browser_fill').length, 1);
  const page = browser.contexts()[0].pages()[0];
  const noValue = parsed(await originalCall('browser_assert', { assertion: 'valid', locator: '#name', value: '' }));assert.equal(noValue.code, 'BROWSER_TOOL_INVALID_ARGUMENTS');
  for (const selector of ['#readonly', '#plain']) for (const assertion of ['valid', 'invalid']) {
    const result = await originalCall('browser_assert', { assertion, locator: selector });assert.equal(result.isError, true);assert.equal(parsed(result).code, 'BROWSER_ASSERTION_SUBJECT_UNSUPPORTED');
  }
  for (const selector of ['#readonly','#disabled','#hidden','#fieldset','#output','#button','#plain']) for (const assertion of ['valid','invalid'])
    await assert.rejects(assertAutomationBrowserCondition(page,{assertion,locator:selector},{deadline:Date.now()+150,origin:base}),error=>error.code==='BROWSER_ASSERTION_SUBJECT_UNSUPPORTED');
  await assert.rejects(assertAutomationBrowserCondition(page,{assertion:'valid',locator:'#required'},{deadline:Date.now()+40,origin:base}),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED');
  await assert.rejects(assertAutomationBrowserCondition(page,{assertion:'invalid',locator:'#missing'},{deadline:Date.now()+40,origin:base}),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED');
  await assert.rejects(assertAutomationBrowserCondition(page,{assertion:'valid',locator:'input'},{deadline:Date.now()+150,origin:base}),error=>error.code==='BROWSER_ASSERTION_AMBIGUOUS');
  const safe = parsed(await originalCall('browser_assert', { assertion: 'invalid', locator: '#custom' }));
  assert.equal(safe.validation_scope, 'selected_control_only');assert.doesNotMatch(JSON.stringify(safe), /private-fixture|validationMessage|"value"/);
  assert.equal(inputs, 1);assert.equal(invalidEvents, 0);assert.equal(submissions, 0);
  const source = built.steps[0].automation_code;assert.match(source, /willValidate/);assert.doesNotMatch(source, /checkValidity|reportValidity|validationMessage/);
  await session.close();
  await replay(t, source, execution, { 'r.name': 'Changed Replay Name' });
  assert.equal(inputs, 2, 'one actual input in generation and one in fresh changed-data replay');assert.equal(invalidEvents, 0);assert.equal(submissions, 0);
});

test('field validation observes native and explicitly associated errors without validation events, with identical standalone Chrome semantics', { timeout: 150_000 }, async t => {
  assert.deepEqual(stable(parseExpressionAt(readFieldValidationState.toString(), 0, { ecmaVersion: 'latest' })),
    stable(parseExpressionAt(fieldValidationStateSource, 0, { ecmaVersion: 'latest' })), 'independently packaged field readers have identical syntax');
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  let browser, session, inputs = 0, invalidEvents = 0, submissions = 0;
  const app = Fastify();t.after(async () => { await session?.close();await browser?.close();await app.close(); });
  app.get('/form', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Declared field validation</title><main><h1>Declared field validation</h1><form>
    <label>Full name<input id="name" required aria-errormessage="hidden-error" aria-describedby="hint"></label>
    <span id="hint">Name as shown on the account</span><span id="hidden-error" hidden>private-hidden-error</span>
    <input id="native-invalid" required><input id="custom-invalid" value="private-value">
    <input id="aria-invalid" value="private-value" aria-invalid="true">
    <input id="visible-error" value="private-value" aria-errormessage="empty-error error"><span id="empty-error"></span><span id="error">private-visible-error</span>
    <input id="described-error" value="private-value" aria-describedby="hint alert"><span id="alert" role="alert">private-alert-error</span>
    <input id="live-hint" value="private-value" aria-describedby="live-status"><span id="live-status" aria-live="polite">Name accepted</span>
    <input id="hidden-child" value="private-value" aria-errormessage="hidden-child-error"><span id="hidden-child-error"><span hidden>private-nonrendered-error</span></span>
    <input id="dangling" value="private-value" aria-errormessage="absent"><input id="dangling-description" value="private-value" aria-describedby="absent">
    <input id="missing-hint-error" value="private-value" aria-describedby="absent alert">
    <input id="missing-hint-invalid" value="private-value" aria-describedby="absent" aria-invalid="true">
    <input id="missing-hint-native-invalid" required aria-describedby="absent">
    <input id="duplicate-description" value="private-value" aria-describedby="duplicate">
    <input id="long-error-association" value="private-value" aria-errormessage="${'x'.repeat(250)}">
    <input id="duplicate-ref" value="private-value" aria-errormessage="duplicate"><span id="duplicate" hidden></span><span id="duplicate">private-duplicate-error</span>
    <input id="icon-only" value="private-value" aria-errormessage="icon-error"><span id="icon-error"><svg width="20" height="20"><title>private-icon-error</title><circle cx="10" cy="10" r="8"></circle></svg></span>
    <input id="label-only" value="private-value" aria-errormessage="label-error"><span id="label-error" aria-label="private-label-error" style="display:inline-block;width:10px;height:10px"></span>
    <input id="display-contents" value="private-value" aria-errormessage="contents-error"><span id="contents-error" style="display:contents">private-rendered-error</span>
    <input id="readonly" readonly><input id="disabled" disabled><input id="hidden" type="hidden"><input id="checkbox" type="checkbox">
    <textarea id="bio">Biography</textarea><select id="choice"><option selected>One</option></select><div id="plain">Plain text</div>
    <div id="shadow-host"></div><span id="outside-only" hidden></span>
    </form></main><script>
      document.querySelector('#custom-invalid').setCustomValidity('private-native-error');
      const root=document.querySelector('#shadow-host').attachShadow({mode:'open'});
      root.innerHTML='<input id="shadow-input" value="private-shadow-value" aria-errormessage="shadow-error"><span id="shadow-error" hidden>private-shadow-error</span><input id="shadow-dangling" value="private-value" aria-errormessage="outside-only">';
      document.addEventListener('invalid',()=>fetch('/invalid-event',{method:'POST'}),true);
      document.querySelector('#name').addEventListener('input',()=>fetch('/input-event',{method:'POST'}));
      document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();fetch('/submit-event',{method:'POST'})});
    </script>`));
  app.post('/input-event', async () => { inputs++;return {}; });app.post('/invalid-event', async () => { invalidEvents++;return {}; });app.post('/submit-event', async () => { submissions++;return {}; });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()), { launchBrowser: async options => { browser = await chromium.launch(options);return browser; } });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  session = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: `${base}/form`, allowBrowserActions: true });
  const schema = session.tools.find(tool => tool.name === 'browser_assert');assert.ok(schema.inputSchema.properties.assertion.enum.includes('field_valid'));
  assert.equal(validateAutomationBrowserAssertion({assertion:'field_valid',locator:'#name'}),true);
  assert.equal(validateAutomationBrowserAssertion({assertion:'field_valid',locator:'#name',value:''}),false);
  assert.equal(validateAutomationBrowserAssertion({assertion:'field_valid'}),false);
  const navigation = await session.call('browser_navigate',{url:`${base}/form`});assert.notEqual(navigation.isError,true,JSON.stringify(navigation));
  const captured = parsed(await session.call('browser_snapshot',{}));
  assert.equal(captured.elements.find(row=>row.attributes.id==='name').attributes['aria-errormessage'],'hidden-error');
  assert.equal(captured.elements.find(row=>row.attributes.id==='aria-invalid').attributes['aria-invalid'],'true');
  const truncatedReference = captured.elements.find(row=>row.attributes.id==='long-error-association');
  assert.equal(truncatedReference.attributes['aria-errormessage'].length,200);assert.ok(truncatedReference.truncated_attributes.includes('aria-errormessage'));
  assert.doesNotMatch(JSON.stringify(captured),/"value"\s*:\s*"private-value"/,'validation metadata does not expose the entered field value');
  await session.call('browser_fill',{locator:'#name',value:'Initial Name'});
  const safe = parsed(await session.call('browser_assert',{assertion:'field_valid',locator:'#name'}));
  assert.equal(safe.assertion_outcome,'satisfied');assert.equal(safe.assertion_subject,'field_validation_state');assert.equal(safe.validation_scope,'selected_field_only');
  assert.doesNotMatch(JSON.stringify(safe),/private-|Initial Name|"value"|validationMessage/);
  const unsupported = await session.call('browser_assert',{assertion:'field_valid',locator:'#dangling'});
  assert.equal(unsupported.isError,true);assert.equal(parsed(unsupported).code,'BROWSER_ASSERTION_SUBJECT_UNSUPPORTED');
  const page = browser.contexts()[0].pages()[0], check = (selector, timeout = 150) => assertAutomationBrowserCondition(page,{assertion:'field_valid',locator:selector},{deadline:Date.now()+timeout,origin:base});
  for (const selector of ['#name','#live-hint','#hidden-child','#bio','#choice','#shadow-input','#dangling-description']) assert.equal((await check(selector)).assertion_outcome,'satisfied',selector);
  for (const selector of ['#native-invalid','#custom-invalid','#aria-invalid','#visible-error','#described-error','#icon-only','#label-only','#missing-hint-error','#missing-hint-invalid','#missing-hint-native-invalid']) await assert.rejects(check(selector,35),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED',selector);
  for (const selector of ['#dangling','#duplicate-ref','#duplicate-description','#readonly','#disabled','#hidden','#checkbox','#plain','#shadow-dangling','#display-contents']) await assert.rejects(check(selector),error=>error.code==='BROWSER_ASSERTION_SUBJECT_UNSUPPORTED',selector);
  for (const token of ['true','grammar','spelling','unknown']) {
    await page.locator('#aria-invalid').evaluate((node,value)=>node.setAttribute('aria-invalid',value),token);
    await assert.rejects(check('#aria-invalid',35),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED');
  }
  for (const token of ['','false',' FALSE ']) {
    await page.locator('#aria-invalid').evaluate((node,value)=>node.setAttribute('aria-invalid',value),token);
    assert.equal((await check('#aria-invalid')).assertion_outcome,'satisfied');
  }
  for (const role of ['unknown alert','section alert']) {
    await page.locator('#alert').evaluate((node,value)=>node.setAttribute('role',value),role);
    await assert.rejects(check('#described-error',35),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED');
  }
  await page.locator('#alert').evaluate(node=>node.setAttribute('role','status alert'));
  assert.equal((await check('#described-error')).assertion_outcome,'satisfied','the first recognized concrete role controls fallback semantics');
  await page.locator('#hidden-child-error').evaluate(node=>{node.id='\u00a0';node.innerHTML='private-non-ascii-id-error';});
  await page.locator('#hidden-child').evaluate(node=>node.setAttribute('aria-errormessage','\u00a0'));
  await assert.rejects(check('#hidden-child',35),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED','non-ASCII whitespace remains part of its valid ID');
  await page.locator('#name').evaluate(node=>node.style.visibility='hidden');
  await assert.rejects(check('#name',35),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED');
  await page.locator('#name').evaluate(node=>node.style.visibility='');
  for (const references of [Array(33).fill('empty-error').join(' '),'x'.repeat(257)]) {
    await page.locator('#dangling').evaluate((node,value)=>node.setAttribute('aria-errormessage',value),references);
    await assert.rejects(check('#dangling'),error=>error.code==='BROWSER_ASSERTION_SUBJECT_UNSUPPORTED');
  }
  // Native-only mode intentionally keeps its narrower established meaning.
  assert.equal((await assertAutomationBrowserCondition(page,{assertion:'valid',locator:'#visible-error'},{deadline:Date.now()+150,origin:base})).assertion_outcome,'satisfied');
  assert.equal(inputs,1);assert.equal(invalidEvents,0);assert.equal(submissions,0);
  const requests = [{name:'browser_navigate',arguments:{url:`${base}/form`}},{name:'browser_fill',arguments:{locator:'#name',value:'@r.name'}},
    {name:'browser_assert',arguments:{assertion:'value',locator:'#name',value:'@r.name'}},{name:'browser_assert',arguments:{assertion:'field_valid',locator:'#name'}}];
  const source = compileRecordedProgram(requests).source, execution={required:true,step_id:'field-valid',action:'Enter full name',expected_result:'Full name entered without errors'};
  assert.equal(normalizeGeneratedProgram(source),source);
  assert.deepEqual(deriveProgramTools({payload:{steps:[{step_id:execution.step_id,step_type:'web',automation_code:source}]},execution}),requests);
  await session.close();
  await replay(t,source,execution,{'r.name':'Changed Replay Name'});
  assert.equal(inputs,2,'only generation fill and changed-data standalone fill dispatch input');assert.equal(invalidEvents,0);assert.equal(submissions,0);
});

test('a password entry with a mismatched optional hint preserves exact value plus field validation through MCP and fresh exported replay', { timeout: 150_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  let browser, session, inputs = 0, invalidEvents = 0, submissions = 0;
  const app = Fastify();t.after(async () => { await session?.close();await browser?.close();await app.close(); });
  app.get('/auth', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Sign Up</title><main><h1>Create account</h1><form>
    <label for="password-input">Password</label><div id="password-input-shell"><input id="password-input" name="password" type="password" aria-describedby="password-input-hint"></div>
    <p id="password-input-shell-hint">Minimum 6 characters</p><button type="submit">Sign Up</button>
    <span id="field-error" role="alert" hidden>private-password-error</span>
    </form></main><script>
      document.querySelector('#password-input').addEventListener('input',()=>fetch('/input-event',{method:'POST'}));
      document.addEventListener('invalid',()=>fetch('/invalid-event',{method:'POST'}),true);
      document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();fetch('/submit-event',{method:'POST'})});
    </script>`));
  app.post('/input-event', async () => { inputs++;return {}; });app.post('/invalid-event', async () => { invalidEvents++;return {}; });app.post('/submit-event', async () => { submissions++;return {}; });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()), { launchBrowser: async options => { browser = await chromium.launch(options);return browser; } });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  session = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: `${base}/auth`, allowBrowserActions: true });
  const navigation = await session.call('browser_navigate',{url:`${base}/auth`});assert.notEqual(navigation.isError,true,JSON.stringify(navigation));
  const filled = await session.call('browser_fill',{locator:'#password-input',value:'private-fixture-password'});assert.notEqual(filled.isError,true);
  const value = await session.call('browser_assert',{assertion:'value',locator:'#password-input',value:'private-fixture-password'});assert.equal(parsed(value).assertion_outcome,'satisfied');
  const field = await session.call('browser_assert',{assertion:'field_valid',locator:'#password-input'});assert.notEqual(field.isError,true,JSON.stringify(field));assert.equal(parsed(field).assertion_outcome,'satisfied');
  assert.doesNotMatch(JSON.stringify(field),/private-fixture-password|private-password-error|validationMessage/);
  const page = browser.contexts()[0].pages()[0], check = () => assertAutomationBrowserCondition(page,{assertion:'field_valid',locator:'#password-input'},{deadline:Date.now()+100,origin:base});
  await page.locator('#password-input').evaluate(node=>node.setAttribute('aria-describedby','password-input-hint field-error'));
  await page.locator('#field-error').evaluate(node=>node.hidden=false);
  await assert.rejects(check(),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED','an absent hint never bypasses a later associated validation error');
  await page.locator('#field-error').evaluate(node=>node.hidden=true);
  await page.locator('#password-input').evaluate(node=>node.setAttribute('aria-invalid','true'));
  await assert.rejects(check(),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED','missing hint does not bypass aria-invalid');
  await page.locator('#password-input').evaluate(node=>{node.removeAttribute('aria-invalid');node.setCustomValidity('private-native-password-error');});
  await assert.rejects(check(),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED','missing hint does not bypass native or custom constraints');
  await page.locator('#password-input').evaluate(node=>{node.setCustomValidity('');node.setAttribute('aria-errormessage','missing-error');});
  await assert.rejects(check(),error=>error.code==='BROWSER_ASSERTION_SUBJECT_UNSUPPORTED','unresolved explicit error references are still unsupported');
  assert.equal(inputs,1);assert.equal(invalidEvents,0);assert.equal(submissions,0);
  const requests = [{name:'browser_navigate',arguments:{url:`${base}/auth`}},{name:'browser_fill',arguments:{locator:'#password-input',value:'@r.password'}},
    {name:'browser_assert',arguments:{assertion:'value',locator:'#password-input',value:'@r.password'}},{name:'browser_assert',arguments:{assertion:'field_valid',locator:'#password-input'}}];
  const source = compileRecordedProgram(requests).source, execution={required:true,step_id:'password',action:'Enter the password',expected_result:'The password is entered without errors.'};
  assert.equal(normalizeGeneratedProgram(source),source);
  assert.deepEqual(deriveProgramTools({payload:{steps:[{step_id:execution.step_id,step_type:'web',automation_code:source}]},execution}),requests);
  await session.close();
  await replay(t,source,execution,{'r.password':'private-changed-replay-password'});
  assert.equal(inputs,2);assert.equal(invalidEvents,0);assert.equal(submissions,0);
});

test('a stale saved password subject stops the real MCP actor before filling a different current target', { timeout: 60_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  let browser,session,inputs=0;const app=Fastify();t.after(async()=>{await session?.close();await browser?.close();await app.close();});
  app.get('/auth',async(_request,reply)=>reply.type('text/html').send(`<!doctype html><title>Sign Up</title><main><h1>Create account</h1>
    <label for="password-input-shell">Password *</label><div id="password-input-shell"><input id="password-input" name="password" type="password" placeholder="Password*" aria-describedby="password-input-hint"></div>
    <p id="password-input-shell-hint">Minimum 6 characters</p><script>document.querySelector('input').addEventListener('input',()=>fetch('/input-event',{method:'POST'}));</script></main>`));
  app.post('/input-event',async()=>{inputs++;return {};});
  await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()),{launchBrowser:async options=>{browser=await chromium.launch(options);return browser;}});
  const base=await app.listen({host:'127.0.0.1',port:0});session=await connectAutomationBrowser({integration:{base_url:base},startUrl:`${base}/auth`,allowBrowserActions:true});
  const nav=await session.call('browser_navigate',{url:`${base}/auth`});assert.notEqual(nav.isError,true);
  const snapshot=await session.call('browser_snapshot',{});assert.notEqual(snapshot.isError,true);
  const oldLocator='getByLabel("Password *", {exact:true})',savedOperations=[{name:'browser_fill',arguments:{locator:oldLocator,value:'@r.password'}},
    {name:'browser_assert',arguments:{assertion:'value',locator:oldLocator,value:'@r.password'}},{name:'browser_assert',arguments:{assertion:'field_valid',locator:oldLocator}}];
  const source=compileRecordedProgram(savedOperations).source,contract=createRetainedAssertionContract({step:{id:'password',step_type:'web',automation_code:source}});
  const originalCall=session.call,calls=[],observations=[];let actors=0,saves=0;session.projectPromptText=value=>value;
  session.call=async(name,args)=>{calls.push(name);return originalCall(name,args);};
  await assert.rejects(runAutomationBrowserAgent({browser:session,actorMode:true,generationMode:'sequential',parse:JSON.parse,maxCalls:4,maxTurns:3,
    initialObservations:[{tool:'browser_snapshot',result:snapshot}],prompt:'Enter @r.password and retain the saved field validation.',
    execution:{required:true,step_id:'password',action:'Enter the password using @r.password',expected_result:'The password is entered without errors.',retained_assertion_contract:contract},
    complete:async prompt=>{actors++;const current=JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);const target=current.current_snapshot.targets.find(row=>row.tag==='input'&&row.input_type==='password');assert.ok(target);
      return JSON.stringify({stage:'act',step_id:'password',section_complete:false,tool_calls:[{name:'browser_fill',arguments:{locator:target.ref,value:'@r.password'}}]});},
    onObservation:row=>observations.push(row),onPartialBuild:async()=>{saves++;return {generation_complete:true};}
  }),{code:'AUTOMATION_RETAINED_SUBJECT_REVIEW_REQUIRED'});
  assert.deepEqual(calls,['browser_validate_locator']);assert.equal(actors,1);assert.equal(saves,0);assert.equal(inputs,0);
  assert.equal(await browser.contexts()[0].pages()[0].locator('#password-input').inputValue(),'');
  assert.equal(parsed(observations[0].result).match_count,0);assert.doesNotMatch(JSON.stringify(observations),/getByLabel|@r\.password/);
});
