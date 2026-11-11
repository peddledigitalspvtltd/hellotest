const test = require('node:test');
const assert = require('node:assert/strict');
const tasks = require('../../backend/workflows/artifactTasks');
const { resolveAutomationDraftSteps } = require('@hellotest/platform/backend/src/utils/automationCaseType');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const flags = require('@hellotest/platform/backend/services/featureFlag.service');
const apps = require('@hellotest/platform/backend/public/applicationAccess');
const stories = require('@hellotest/manual/backend/services/requirement.service');
const builder = require('@hellotest/automation/backend/services/aiAutomationBuilder.service');
const journal = require('../../backend/workflows/operationJournal');
const { failureInfo, withNode } = require('../../backend/workflows/runtimeEvents');

const story = { id: 'story', project_id: 'project', iteration_id: 'sprint', title: 'Search the catalog',
  description: 'Search the published catalog and inspect the requested item.', acceptance_criteria: ['The requested item is displayed.'] };
const step = (action, step_type) => ({ action, expected_result: 'The documented result is displayed.', ...(step_type ? { step_type } : {}) });
const variants = [
  { name: 'authored manual browser steps', steps: [step('Open https://catalog.example/', 'manual'), step('Search for the requested product', 'manual')], browser: true },
  { name: 'browser steps without a saved runtime', steps: [step('Open the product page')], browser: true },
  { name: 'explicit browser steps', steps: [step('Open the product page', 'web')], browser: true },
  { name: 'inferred HTTP steps', steps: [step('GET https://catalog.example/products/one', 'manual')], browser: false },
  { name: 'explicit HTTP steps', steps: [step('GET https://catalog.example/products/one', 'api')], browser: false },
  { name: 'mixed HTTP and manual browser steps', steps: [step('GET https://catalog.example/products/one', 'api'), step('Open the product page', 'manual')], browser: true },
  { name: 'native Android steps', automation_case_type: 'android', steps: [step('Launch the catalog application', 'android')], browser: false },
  { name: 'browser Gherkin', authoring_mode: 'gherkin', gherkin_document: 'Feature: Search\nScenario: Find a product\nGiven I open https://catalog.example/\nWhen I enter the product code\nThen the matching product is visible', steps: [], browser: true },
  { name: 'API Gherkin with a non-browser fixture', authoring_mode: 'gherkin', gherkin_document: 'Feature: Catalog API\nBackground: Existing product\nGiven an existing product record is available\nScenario: Read product\nWhen I GET https://catalog.example/products/one\nThen status equals 200', steps: [], browser: false },
];

for (const path of ['case-loop', 'legacy-story-packet']) {
  test(`${path} honors saved browser mode using the native runtime, with effect receipts for inferred browser actions`, async t => {
    t.mock.method(permissions, 'hasPermission', async () => true);
    t.mock.method(flags, 'areEnabled', async () => true);
    t.mock.method(apps, 'getAppType', async () => ({ id: 'app', project_id: 'project', kind: 'web' }));
    t.mock.method(stories, 'getRequirement', async () => story);
    const calls = [], effects = [];
    t.mock.method(builder, 'previewAutomationDraft', async input => {
      calls.push(input);
      const platform = resolveAutomationDraftSteps(input.draft, input.draft.steps, { appTypeKind: input.app_type_kind });
      return { steps: platform.steps, validation: { status: 'passed' }, verification_status: 'unverified' };
    });
    t.mock.method(journal, 'invoke', async (input, dispatch) => { effects.push(input); return dispatch(); });

    for (const variant of variants) {
      for (const mode of ['perform_steps', 'read_only', 'offline']) {
        await t.test(`${variant.name}: ${mode}`, async () => {
          calls.length = 0; effects.length = 0;
          const draft = { client_id: 'case', title: variant.name, description: 'Exercise the documented catalog behavior.',
            authoring_mode: 'structured', requirement_ids: [story.id], parameter_values: {}, ...variant };
          delete draft.name; delete draft.browser;
          const packet = { story_id: story.id, story_revision: tasks.revision(story), cases: [draft],
            case_assurance: [{ case_fingerprint: tasks.fingerprint(draft), verification: { status: 'passed' },
              assurance_review: { summary: 'The selected case is ready for a code-generation assessment.' } }] };
          const run = { id: 'run', project_id: 'project', app_type_id: 'app', input_payload: { sprint_id: 'sprint' },
            ...(path === 'case-loop' ? { loop_owner: 'each-test-case', iteration_index: 0,
              iteration_path: ['each-story', 0, 'each-test-case', 0] } : {}) };
          const node = { id: 'automation', data: { kind: 'artifactTask', artifactTask: 'automation-engineer',
            automationBrowserMode: mode, automationStartUrl: 'https://catalog.example/' } };
          const result = await tasks.execute({ run, node, sources: [], user: { id: 'actor' }, signal: new AbortController().signal,
            onProgress: async () => {}, context: { input: [packet], ...(path === 'case-loop' ? { item: draft } : {}) } });
          assert.equal(calls.length, 1, 'The complete case is generated exactly once.');
          const interactive = mode === 'perform_steps' && variant.browser;
          assert.equal(calls[0].allow_browser_actions, interactive);
          assert.equal(calls[0].inspect_browser, mode !== 'offline');
          assert.equal(effects.length, Number(interactive), 'Every permitted browser mutation is covered by the operation journal.');
          if (interactive) {
            assert.equal(effects[0].input.story_id, story.id);
            assert.equal(effects[0].input.case_fingerprint, tasks.fingerprint(draft));
            assert.deepEqual(effects[0].run.iteration_path.slice(-3), ['automation', story.id, 0]);
          }
          assert.equal(result.__workflow_result.output.verification.status, 'passed');
        });
      }
    }
  });
}

test('case-scoped native source failure retains exact Story/case attribution and its uncertain operation receipt', async t => {
  const fixture = progressFixture(t, [step('Click the search field and verify focus.', 'web')]);
  const first = { ...fixture.draft, client_id: 'case-first' }, selected = { ...fixture.draft, client_id: 'case-second' };
  fixture.packet.cases = [first, selected];
  fixture.packet.case_assurance = [first, selected].map(draft => ({ case_fingerprint: tasks.fingerprint(draft), verification: { status: 'passed' }, assurance_review: { summary: 'Ready.' } }));
  fixture.run.iteration_index = 1;fixture.run.iteration_path = ['each-story', 0, 'each-test-case', 1];
  fixture.node.data.automationBrowserMode = 'perform_steps';
  const failure = Object.assign(new Error('PRIVATE_NATIVE_SOURCE'), { code: 'AUTOMATION_UPSTREAM_SOURCE_INVALID', statusCode: 422,
    publicMessage: 'Automation section 5 failed executable source validation.', section_order: 5,
    operation_id: 'op-source-validation', outcome_unknown: true, nonRetryable: true, retryable: false });
  const dispatch=t.mock.method(builder,'previewAutomationDraft',async()=>{throw failure;});
  const receipt=t.mock.method(journal,'invoke',async(_input,send)=>send());
  await assert.rejects(tasks.execute({ run: fixture.run, node: fixture.node, sources: [], user: { id: 'actor' }, signal: new AbortController().signal,
    onProgress: async()=>{}, context:{ input:[fixture.packet],item:selected } }), error => {
      assert.equal(error,failure,'Attribution does not replace the native error or receipt.');
      assert.equal(error.effect_dispatched,true);assert.equal(error.operation_id,'op-source-validation');assert.equal(error.outcome_unknown,true);
      assert.equal(Object.getOwnPropertyDescriptor(error,'workflow_artifact').enumerable,false);
      const publicFailure=failureInfo(withNode(error,fixture.run,fixture.node));
      assert.deepEqual(publicFailure.artifact,{artifact_task:'automation-engineer',story_id:'story',case_index:1,case_client_id:'case-second'});
      assert.deepEqual(publicFailure.origin.iteration_path,['each-story',0,'each-test-case',1]);
      assert.equal(publicFailure.category,'outcome_unknown');assert.equal(publicFailure.failure_category,'validation');
      assert.equal(publicFailure.reconciliation_required,true);assert.equal(publicFailure.retryable,false);
      assert.doesNotMatch(JSON.stringify(publicFailure),/PRIVATE_NATIVE_SOURCE/);
      return true;
    });
  assert.equal(dispatch.mock.callCount(),1);assert.equal(receipt.mock.callCount(),1);
});

function progressFixture(t, steps) {
  t.mock.method(permissions, 'hasPermission', async () => true);
  t.mock.method(flags, 'areEnabled', async () => true);
  t.mock.method(apps, 'getAppType', async () => ({ id: 'app', project_id: 'project', kind: 'web' }));
  t.mock.method(stories, 'getRequirement', async () => story);
  const draft = { client_id: 'case', title: 'Search the catalog', description: 'Exercise the published catalog.',
    authoring_mode: 'structured', requirement_ids: [story.id], parameter_values: {}, steps };
  const packet = { story_id: story.id, story_revision: tasks.revision(story), cases: [draft],
    case_assurance: [{ case_fingerprint: tasks.fingerprint(draft), verification: { status: 'passed' }, assurance_review: { summary: 'Ready.' } }] };
  return { draft, packet, run: { id: 'run', project_id: 'project', app_type_id: 'app', input_payload: { sprint_id: 'sprint' },
    loop_owner: 'each-test-case', iteration_index: 0, iteration_path: ['each-story', 0, 'each-test-case', 0] },
  node: { id: 'automation', data: { kind: 'artifactTask', artifactTask: 'automation-engineer', automationBrowserMode: 'read_only', automationStartUrl: 'https://catalog.example/' } } };
}

test('case draft checkpoints retain live-validation blockers through private-value projection without claiming execution', async t => {
  const fixture = progressFixture(t, [step('Open the catalog', 'manual')]);
  fixture.draft.parameter_values = { 'r.session_token': 'PRIVATE_SESSION_TOKEN' };
  fixture.draft.test_data_options = { private_parameter_names: ['r.session_token'] };
  fixture.packet.case_assurance[0].case_fingerprint = tasks.fingerprint(fixture.draft);
  t.mock.method(builder, 'previewAutomationDraft', async input => ({
    steps: resolveAutomationDraftSteps(input.draft, input.draft.steps).steps,
    validation: { status: 'passed' }, verification_status: 'unverified',
    live_validation: { status: 'blocked', reason: 'The application returned HTTP 503 for PRIVATE_SESSION_TOKEN.', stopped_at_step_id: 'draft-step-1', stopped_at_step_order: 1 }
  }));
  const returned = await tasks.execute({ run: fixture.run, node: fixture.node, sources: [], user: { id: 'actor' }, signal: new AbortController().signal,
    onProgress: async () => {}, context: { input: [fixture.packet], item: fixture.draft } });
  const publicDraft = returned.__workflow_result.output.data[0].automation[0];
  const checkpointDraft = returned.__workflow_result.context.data[0].automation_by_case[fixture.draft.client_id];
  assert.deepEqual(checkpointDraft.live_validation, publicDraft.live_validation);
  assert.equal(publicDraft.live_validation.status, 'blocked');
  assert.equal(publicDraft.live_validation.stopped_at_step_order, 1);
  assert.match(publicDraft.live_validation.reason, /HTTP 503/);
  assert.doesNotMatch(JSON.stringify(publicDraft), /PRIVATE_SESSION_TOKEN/);
  assert.equal(publicDraft.verification_status, 'unverified');
  assert.deepEqual(returned.__workflow_result.output.data[0].automation_progress, { completed: 1, failed: 0, needs_input: 0, processed: 1, total: 1 });
});

test('24-section case progress uses native section counts and retains its normalized active step across sparse tool events', async t => {
  const fixture = progressFixture(t, Array.from({ length: 24 }, (_, i) => ({ id: `section-${i + 1}`, step_order: 100 + i, ...step(`Inspect catalog item ${i + 1}`, 'manual') })));
  const progress = [];
  t.mock.method(builder, 'previewAutomationDraft', async input => {
    await input.onProgress({ phase: 'automation.agent.section.started', percent: 12.4, details: { active_step_id: 'section-8' } });
    await input.onProgress({ phase: 'automation.agent.section.completed', details: { step_id: 'section-8', completed_sections: 8, total_sections: 24 } });
    await input.onProgress({ phase: 'automation.agent.upstream.tool', details: { active_step_id: 'section-9' } });
    await input.onProgress({ phase: 'automation.agent.upstream.tool', details: {} });
    await input.onProgress({ phase: 'automation.agent.upstream.tool', details: { active_step_id: 'unknown-section', step_order: 24 } });
    await input.onProgress({ phase: 'automation.agent.section.completed', details: { completed_sections: 2, total_sections: 999 } });
    await input.onProgress({ phase: 'automation.agent.section.completed', details: { completed_sections: 999, total_sections: 999 } });
    return { steps: resolveAutomationDraftSteps(input.draft, input.draft.steps).steps, validation: { status: 'passed' }, verification_status: 'unverified' };
  });
  await tasks.execute({ run: fixture.run, node: fixture.node, sources: [], user: { id: 'actor' }, signal: new AbortController().signal,
    onProgress: async event => progress.push(event), context: { input: [fixture.packet], item: fixture.draft } });
  assert.equal(progress[0].automation_progress.active_step_order, 1, 'Saved non-sequential order is normalized exactly as the native builder normalizes it.');
  assert.equal(progress[1].percent, 12, 'Explicit progress is available before native completion counts arrive.');
  assert.deepEqual(progress.slice(2, 7).map(event => event.percent), [33, 33, 33, 33, 33]);
  assert.deepEqual(progress.slice(3, 7).map(event => event.automation_progress.active_step_order), [9, 9, 9, 9], 'Sparse events and unknown IDs cannot erase or invent a step.');
  assert.equal(progress[6].automation_progress.completed_sections, 8, 'Late older section events cannot move progress backwards.');
  assert.equal(progress[7].percent, 99, 'The preview cannot finish the case solely through a section event.');
  assert.equal(progress[7].automation_progress.completed_sections, 24);
  assert.equal(progress[7].automation_progress.total_sections, 24, 'The authored native plan bounds all reported counts.');
  assert.ok(progress.slice(0, -1).every(event => event.automation_progress.processed === 0));
  assert.equal(progress.at(-1).percent, 100);
  assert.equal(progress.at(-1).completed_items[0].automation_progress.processed, 1);
});

for (const path of ['case-loop', 'legacy-story-packet']) {
  test(`${path} preview failure never claims that incomplete automation source was saved to Plan`, async t => {
    const fixture = progressFixture(t, [step('Open the catalog', 'manual')]);
    const progress = [];
    t.mock.method(builder, 'previewAutomationDraft', async input => {
      await input.onProgress({ phase: 'automation.agent.browser.failed', message: 'Section 2 could not finish. Previously saved sections remain in Plan.',
        details: { saved_sections: 1, active_step_id: 'unknown-section' } });
      throw Object.assign(new Error('Native browser transport disconnected.'), { code: 'ECONNRESET' });
    });
    await assert.rejects(tasks.execute({ run: path === 'case-loop' ? fixture.run : { ...fixture.run, loop_owner: undefined, iteration_path: undefined },
      node: fixture.node, sources: [], user: { id: 'actor' }, signal: new AbortController().signal, onProgress: async event => progress.push(event),
      context: { input: [fixture.packet], ...(path === 'case-loop' ? { item: fixture.draft } : {}) } }), { code: 'ECONNRESET' });
    const failure = progress.flatMap(event => [event.automation_progress, ...(event.completed_items || []).map(item => item.automation_progress)])
      .find(event => event?.active_phase === 'automation.agent.browser.failed');
    assert.ok(failure);
    assert.doesNotMatch(failure.active_message, /saved sections|remain in Plan/i);
    assert.match(failure.active_message, /manual case and test data are unchanged/);
  });
}
