import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';
import { buildPlaywrightArtifact, createPlaywrightExecutionOptions } from '../../../../services/automation/shared/playwrightArtifact.mjs';
import { assertTypeScriptExportCompiles } from '../../../../services/automation/test/browser/playwrightExportFixture.mjs';

const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const { createBrowserParameterResolver } = require('../../../../services/automation/backend/lib/automationBrowserParameters.js');
const { browserCurrentSnapshotObservation, browserPromptContext } = require('../../../../services/automation/backend/lib/automationBrowserContext.js');
const { canonicalReviewEvidence } = require('../../../../services/automation/backend/lib/automationReviewEvidence.js');
const { recordedSectionRequests } = require('../../../../services/automation/backend/lib/automationBrowserRecording.js');
const actorState = prompt => JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
const execution = { required: true, semantic_review_required: true, step_id: 'full-name', action: 'Enter the configured @r.name',
  expected_result: 'The configured full name is entered and the field reports Name accepted without submitting the form' };
const actor = (tool_calls, section_complete = false) => JSON.stringify({ stage: 'act', step_id: execution.step_id, section_complete, tool_calls });

async function replay(t, source, origin, values, section = execution) {
  const directory = await mkdtemp(path.join(tmpdir(), 'qaira-input-value-export-'));t.after(() => rm(directory, { recursive: true, force: true }));
  const artifact = buildPlaywrightArtifact({ testCase: { id: 'input-value', title: 'Verify a configured native input value', automation_start_url: `${origin}/profile` },
    steps: [{ id: section.step_id, step_order: 1, step_type: 'web', action: section.action, expected_result: section.expected_result, automation_code: source }],
    rows: [values], sectionRows: [[values]], executionOptions: createPlaywrightExecutionOptions({ screenshot_on_success: false, screenshot_on_failure: false }) });
  assert.match(artifact, /@playwright\/test/);assert.doesNotMatch(artifact, /Export limitation:|Standalone export blocked:/);
  const spec = path.join(directory, 'input-value.spec.ts');await writeFile(spec, artifact);assertTypeScriptExportCompiles([spec]);
  await writeFile(spec, artifact.replace("'@playwright/test'", JSON.stringify(fileURLToPath(new URL('../../node_modules/playwright/test.mjs', import.meta.url)))));
  const config = path.join(directory, 'playwright.config.cjs');
  await writeFile(config, 'module.exports=' + JSON.stringify({ testDir: directory, testMatch: 'input-value.spec.ts', outputDir: path.join(directory, 'results'),
    workers: 1, reporter: 'json', use: { headless: true, launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} } }));
  const result = await new Promise((resolve, reject) => {
    let output = '', errors = '';
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/playwright/cli.js', import.meta.url)), 'test', '--config', config],
      { env: { ...process.env, QAIRA_BASE_URL: '', QAIRA_DATA_JSON: JSON.stringify(values) } });
    t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
    child.stdout.on('data', chunk => { output += chunk; });child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);child.on('close', code => resolve({ code, output, errors }));
  });
  assert.equal(result.code, 0, result.output + '\n' + result.errors);
  const report = JSON.parse(result.output);assert.equal(report.stats.expected, 1);assert.equal(report.stats.unexpected, 0);
}

// The actor/reviewer responses are scripted. Chrome, MCP, input events, native
// assertions, protected compilation and separate-process artifact replay are real.
test('native input text-check correction preserves the configured binding and replays a value check without refilling or submitting', { timeout: 90_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify();let fills = 0, submissions = 0;
  app.get('/profile', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Profile</title><main>
    <h1>Profile details</h1><form action="/submit" method="post"><label>Full name<input id="name" data-testid="profile-name" name="name" type="text" required minlength="2"></label>
    <p role="status" data-testid="name-validation">Enter a name</p><button type="submit">Save profile</button></form></main>
    <script>document.querySelector('#name').addEventListener('input',async event=>{
      const field=event.target;await fetch('/fixture/input-observed');
      document.querySelector('[data-testid="name-validation"]').textContent=field.validity.valid?'Name accepted':'Name is invalid';
    });</script>`));
  app.get('/fixture/input-observed', async () => { fills++;return { observed: true }; });
  app.post('/submit', async () => { submissions++;return { submitted: true }; });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });t.after(() => app.close());
  const session = await connectAutomationBrowser({ integration: { base_url: origin }, startUrl: `${origin}/profile`, allowBrowserActions: true });t.after(() => session.close());
  const params = createBrowserParameterResolver({ caseValues: { 'r.name': 'Fixture Person' } });
  session.projectPromptText = params.projectText;session.projectPrivateText = params.projectPrivateText;
  const callBrowser = session.call, calls = [], observations = [], events = [];
  session.call = async (name, args) => {
    const resolved = params.resolve(name, args);calls.push({ name, original: { ...args }, resolved: { ...resolved } });
    return params.redactResult(await callBrowser(name, resolved));
  };
  let turns = 0, reviews = 0, saves = 0, beforeWrong, liveAfterFill;
  const built = await runAutomationBrowserAgent({ browser: session, startUrl: `${origin}/profile`, execution, actorMode: true, generationMode: 'sequential',
    prompt: JSON.stringify({ current_section: execution, parameter_data: { values: params.promptValues } }), parse: JSON.parse, maxTurns: 5, maxCalls: 10,
    onObservation: observation => observations.push(observation), onProgress: event => events.push(event),
    onPartialBuild: async () => { saves++;assert.equal(reviews, 1);assert.equal(fills, 1);assert.equal(submissions, 0);return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"phase":"semantic_review"')) {
        reviews++;const packet = JSON.parse(prompt.split('\n').at(-1));
        assert.deepEqual(packet.unsuccessful_checks, []);assert.deepEqual(packet.unsuccessful_actions, []);
        assert.equal(packet.latest_failure, null);
        const operations = packet.confirmed_operations;
        assert.deepEqual(operations.map(operation => operation.name), ['browser_navigate', 'browser_fill', 'browser_assert', 'browser_assert']);
        assert.equal(operations[2].arguments.assertion, 'value');assert.equal(operations[2].arguments.value, params.publicParameterValues['r.name']);
        assert.equal(operations[3].arguments.assertion, 'text_content');assert.equal(operations[3].arguments.value, 'Name accepted');
        // This local application emits Name accepted only after native field
        // validity succeeds. The second predicate supplies separate field
        // validation evidence; no absence is inferred from sampled targets.
        assert.match(packet.obligations[0].expected_result, /field reports Name accepted/);
        return JSON.stringify({ decision: 'accept', obligations: [{ id: execution.step_id, action_operations: [1, 2], assertion_operations: [3, 4] }], issues: [] });
      }
      turns++;const current = actorState(prompt), name = current.current_snapshot.targets.find(target => target.name === 'Full name');assert.ok(name);
      assert.equal(name.assertion_subject, 'input_value');assert.equal(name.preferred_value_assertion, 'value');
      if (turns === 1) return actor([{ name: 'browser_fill', arguments: { locator: name.ref, value: '@r.name' } }]);
      if (turns === 2) {
        assert.equal(fills, 1);
        beforeWrong = { calls: calls.length, snapshots: calls.filter(call => call.name === 'browser_snapshot').length,
          evidence: canonicalReviewEvidence({ observations, stepId: execution.step_id }) };
        liveAfterFill = browserCurrentSnapshotObservation(observations);
        return actor([{ name: 'browser_assert', arguments: { assertion: 'text', locator: name.ref, value: '@r.name' } }]);
      }
      assert.equal(turns, 3);assert.equal(calls.length, beforeWrong.calls);assert.equal(calls.filter(call => call.name === 'browser_snapshot').length, beforeWrong.snapshots);
      assert.equal(browserCurrentSnapshotObservation(observations), liveAfterFill);
      assert.deepEqual(canonicalReviewEvidence({ observations, stepId: execution.step_id }), beforeWrong.evidence);
      assert.equal(current.latest_failure.kind, 'assertion_subject');assert.equal(current.latest_failure.value_assertion_contract.assertion, 'value');
      assert.equal(current.pending_contract.next_required, 'correct_assertion_subject_with_discovered_contract');
      assert.equal(current.pending_contract.expected_result_check, 'required');assert.equal(current.pending_contract.completion_available, false);
      const status = current.current_snapshot.targets.find(target => target.text === 'Name accepted' || target.name === 'Name accepted');assert.ok(status);
      return actor([{ name: 'browser_assert', arguments: { assertion: 'value', locator: name.ref, value: '@r.name' } },
        { name: 'browser_assert', arguments: { assertion: 'text_content', locator: status.ref, value: 'Name accepted' } }], true);
    }
  });
  assert.equal(turns, 3);assert.equal(reviews, 1);assert.equal(saves, 1);assert.equal(fills, 1);assert.equal(submissions, 0);
  assert.equal(calls.filter(call => call.name === 'browser_fill').length, 1);
  assert.deepEqual(calls.filter(call => call.name === 'browser_assert').map(call => call.original.assertion), ['value', 'text_content']);
  assert.equal(calls.find(call => call.name === 'browser_assert').original.value, '@r.name');
  assert.ok(!observations.some(observation => observation.tool === 'browser_assert' && observation.result.isError));
  assert.ok(!events.some(event => event.phase === 'automation.agent.action.failed'));
  assert.equal(browserPromptContext(observations, execution.step_id, { compactModel: true }).current.latest_failure, undefined);
  assert.equal(recordedSectionRequests(observations, execution.step_id).filter(operation => operation.name === 'browser_fill')[0].arguments.value, '@r.name');
  const source = built.steps[0].automation_code;
  assert.match(source, /\.fill\("@r\.name"\)/);assert.match(source, /\.toHaveValue\("@r\.name"\)/);assert.match(source, /\.toHaveText\("Name accepted"\)/);
  assert.doesNotMatch(source, /innerText|Fixture Person|\.click\(/);
  await session.close();
  await replay(t, source, origin, params.publicParameterValues);
  assert.equal(fills, 2, 'development and the explicit fresh-context replay each enter the configured value once');
  assert.equal(submissions, 0, 'no account or form submission is necessary to verify entered data');
});

test('literal empty text cannot fake a native blank value; real clearing and value verification survive standalone replay', { timeout: 90_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify();let fills = 0, submissions = 0;
  app.get('/profile', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Profile</title><main>
    <form action="/submit" method="post"><label>Full name<input data-testid="profile-name" name="name" type="text" value="Initially nonempty fixture input" oninput="fetch('/fixture/input-observed')"></label>
    <button type="submit">Save profile</button></form></main>`));
  app.get('/fixture/input-observed', async () => { fills++;return { observed: true }; });
  app.post('/submit', async () => { submissions++;return {}; });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });t.after(() => app.close());
  const session = await connectAutomationBrowser({ integration: { base_url: origin }, startUrl: `${origin}/profile`, allowBrowserActions: true });t.after(() => session.close());
  session.projectPromptText = value => value;session.projectPrivateText = value => value;
  const callBrowser = session.call, calls = [], observations = [];
  session.call = async (name, args) => { calls.push({ name, args });return callBrowser(name, args); };
  const blankExecution = { ...execution, action: 'Clear the Full name input', expected_result: 'The Full name input value is empty.' };
  let turns = 0, reviews = 0, saves = 0, callsBeforeWrong;
  const built = await runAutomationBrowserAgent({ browser: session, startUrl: `${origin}/profile`, execution: blankExecution,
    actorMode: true, generationMode: 'sequential', prompt: 'Clear the Full name input and verify its empty native value.', parse: JSON.parse, maxTurns: 5, maxCalls: 10,
    onObservation: observation => observations.push(observation), onPartialBuild: async () => { saves++;assert.equal(fills, 1);assert.equal(submissions, 0);return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"phase":"semantic_review"')) {
        reviews++;const packet = JSON.parse(prompt.split('\n').at(-1));
        assert.deepEqual(packet.unsuccessful_checks, []);
        assert.deepEqual(packet.confirmed_operations.map(operation => operation.name), ['browser_navigate', 'browser_fill', 'browser_assert']);
        assert.equal(packet.confirmed_operations[1].arguments.value, '');assert.equal(packet.confirmed_operations[2].arguments.assertion, 'value');
        assert.equal(packet.confirmed_operations[2].arguments.value, '');
        return JSON.stringify({ decision: 'accept', obligations: [{ id: execution.step_id, action_operations: [1, 2], assertion_operations: [3] }], issues: [] });
      }
      turns++;const current = actorState(prompt), name = current.current_snapshot.targets.find(target => target.name === 'Full name');assert.ok(name);
      if (turns === 1) {
        callsBeforeWrong = calls.length;
        // A native input's inner text is empty even with its initial nonempty
        // value. The incorrect check must never reach MCP or become proof.
        return actor([{ name: 'browser_assert', arguments: { assertion: 'text', locator: name.ref, value: '' } }]);
      }
      if (turns === 2) {
        assert.equal(calls.length, callsBeforeWrong);assert.equal(fills, 0);
        assert.equal(current.latest_failure.kind, 'assertion_subject');assert.equal(current.latest_failure.value_assertion_contract.assertion, 'value');
        assert.equal(current.verification_boundary, undefined, 'host argument/subject correction is not an actual failed verification');
        return actor([{ name: 'browser_fill', arguments: { locator: name.ref, value: '' } }]);
      }
      assert.equal(turns, 3);assert.equal(fills, 1);
      return actor([{ name: 'browser_assert', arguments: { assertion: 'value', locator: name.ref, value: '' } }], true);
    }
  });
  assert.equal(turns, 3);assert.equal(reviews, 1);assert.equal(saves, 1);assert.equal(fills, 1);assert.equal(submissions, 0);
  assert.deepEqual(calls.filter(call => call.name === 'browser_assert').map(call => call.args), [{ assertion: 'value', locator: 'getByTestId("profile-name")', value: '' }]);
  assert.equal(observations.filter(observation => observation.tool === 'automation_assertion_feedback').length, 1);
  assert.ok(!observations.some(observation => observation.tool === 'browser_assert' && observation.result.isError));
  const source = built.steps[0].automation_code;assert.match(source, /\.fill\(""\)/);assert.match(source, /\.toHaveValue\(""\)/);
  assert.doesNotMatch(source, /\.toHaveText\(""\)|Initially nonempty fixture input/);
  await session.close();await replay(t, source, origin, {}, blankExecution);
  assert.equal(fills, 2, 'development and fresh exported replay each clear the initial nonempty value once');assert.equal(submissions, 0);
});
