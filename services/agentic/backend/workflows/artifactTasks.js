const { createHash } = require('node:crypto');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const flags = require('@hellotest/platform/backend/services/featureFlag.service');
const requirements = require('@hellotest/manual/backend/services/requirement.service');
const design = require('@hellotest/manual/backend/services/requirementDesign.service');
const assurance = require('@hellotest/ai/backend/services/artifactAssurance.service');
const apps = require('@hellotest/platform/backend/public/applicationAccess');
const { storyAiSnapshot } = require('@hellotest/platform/backend/src/utils/aiArtifactContext');
const { fail } = require('./connections');
const TASKS = new Set(['story-assurance', 'test-case-generation', 'test-case-assurance', 'automation-engineer']);
const MAX_STORIES = 100;
// JSONB does not preserve object insertion order. Persisted drafts and freshly
// generated drafts must produce the same lineage/acceptance digest.
const canonical = value => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const revision = story => fingerprint({ revision: story.revision, updated_at: story.updated_at, snapshot: storyAiSnapshot(story) });
const metrics = () => import('@hellotest/ai/shared/artifactAssurance');
const list = value => Array.isArray(value) ? value : [];
async function access(user, projectId, codes) {
  for (const code of codes) {
    if (!await permissions.hasPermission(user, code, projectId) || !await flags.areEnabled(flags.getFeatureKeysForPermission(code), { user })) throw fail(`Permission required: ${code}`, 403);
  }
}
function checkInput(run) {
  if (!run.app_type_id) throw fail('Select an application before running Sprint Automator.', 422);
  if (!String(run.input_payload?.sprint_id || '').trim()) throw fail('Supply sprint_id in the manual trigger input.', 422);
  if (run.input_payload.max_cases_per_story != null && (!Number.isInteger(Number(run.input_payload.max_cases_per_story)) || Number(run.input_payload.max_cases_per_story) < 1 || Number(run.input_payload.max_cases_per_story) > 10)) throw fail('Choose 1–10 Test Cases per Story in max_cases_per_story.', 422);
  if (run.input_payload.project_id && run.input_payload.project_id !== run.project_id) throw fail('The trigger project must match the workflow project.', 403);
  if (run.input_payload.app_type_id && run.input_payload.app_type_id !== run.app_type_id) throw fail('The trigger application must match the workflow application.', 403);
}
async function loadStory(run, user, packet) {
  await access(user, run.project_id, ['requirement.view']);
  const story = await requirements.getRequirement(packet.story_id || packet.story?.id || packet.id);
  if (story.project_id !== run.project_id || String(story.iteration_id || '') !== String(run.input_payload.sprint_id)) throw fail('A returned Story does not belong to the selected project and Sprint.', 403);
  if (packet.story_revision && packet.story_revision !== revision(story)) throw fail('A Story changed during this workflow. Start a new run to use its current acceptance criteria.', 409);
  return story;
}
function storyBaseline(core, story) {
  return core.buildStoryAssuranceAnalysis({ title: story.title || '', description: story.description || '', acceptanceCriteria: list(story.acceptance_criteria), gherkinScenarios: list(story.gherkin_scenarios), linkedCaseCount: list(story.test_case_ids).length, externalReferences: list(story.external_references), labels: list(story.labels), hasDeliveryContext: Boolean(story.iteration_id || story.sprint || story.fix_version || story.release) });
}
function authoredSteps(draft) {
  if (draft.authoring_mode !== 'gherkin' || !draft.gherkin_document) return list(draft.steps);
  const scenarios = [];
  let current = null, delimiter = '';
  for (const line of String(draft.gherkin_document).split('\n')) {
    const marker = line.trim().match(/^("""|```)/)?.[1];
    if (marker) { delimiter = delimiter === marker ? '' : delimiter || marker; continue; }
    if (delimiter) continue;
    if (/^\s*Scenario(?: Outline| Template)?\s*:/i.test(line)) { current = []; scenarios.push(current); }
    else if (current && /^\s*(?:Given|When|Then|And|But|\*)(?:\s|$)/i.test(line)) current.push(line.trim());
  }
  return scenarios.map(lines => {
    const expected = lines.findIndex(line => /^Then\b/i.test(line));
    return { action: lines.slice(0, expected < 0 ? lines.length : expected).join('\n'), expected_result: expected < 0 ? '' : lines.slice(expected).join('\n'), step_type: 'manual', automation_code: null, api_request: null };
  });
}
async function automationSteps(draft) {
  if (draft.authoring_mode !== 'gherkin' || !draft.gherkin_document) return list(draft.steps);
  const parser = await import('@hellotest/testing/shared/gherkin');
  const sections = parser.splitGherkinDocument(draft.gherkin_document);
  const result = [];
  for (const section of sections.scenarios) {
    const table = parser.gherkinToStructuredCase(parser.composeGherkinDocument({ preamble: sections.preamble, background: '', scenarios: [section] }));
    const rows = table.exampleRows.length ? table.exampleRows : [{}];
    if (/^\s*Scenario(?: Outline| Template)\s*:/im.test(section.scenario) && !table.exampleRows.length) throw fail('Scenario Outline needs supplied Examples rows before automation can be generated.', 422);
    for (const row of rows) {
      const substitute = value => String(value || '').replace(/<([^<>\r\n]+)>/g, (token, key) => Object.hasOwn(row, key.trim()) ? row[key.trim()] : token);
      const background = parser.composeSharedStepGherkin(parser.parseSharedStepGherkin(sections.background).map(step => ({ ...step, text: substitute(step.text), argument: step.argument ? substitute(step.argument) : undefined })));
      const scenario = parser.composeSharedStepGherkin(parser.parseSharedStepGherkin(section.scenario).map(step => ({ ...step, text: substitute(step.text), argument: step.argument ? substitute(step.argument) : undefined })));
      const compiled = [];
      for (const [role, block] of [['background', background], ['scenario', scenario]]) {
        let phase = 'action';
        for (const step of parser.parseSharedStepGherkin(block)) {
          const content = [step.text, step.argument].filter(Boolean).join('\n');
          if (step.keyword === 'Then') phase = 'expected';
          else if (step.keyword === 'Given' || step.keyword === 'When') phase = 'action';
          if (phase === 'expected' && compiled.length) compiled[compiled.length - 1].expected_result = [compiled[compiled.length - 1].expected_result, content].filter(Boolean).join('\n');
          else compiled.push({ action: content, expected_result: phase === 'expected' ? content : '', gherkin_keyword: step.keyword, gherkin_role: role });
        }
      }
      result.push(...compiled);
      if (result.length > 200) throw fail('Expanded Gherkin automation exceeds 200 steps. Split its Scenarios or Examples before generating.', 422);
    }
  }
  return result.map(step => ({ ...step, step_type: 'manual', automation_code: null, api_request: null }));
}
function caseBaseline(core, draft) {
  return core.buildTestCaseAssuranceAnalysis({ title: draft.title || '', description: draft.description || '', steps: authoredSteps(draft), requirementCount: list(draft.requirement_ids).length, parameterValues: draft.parameter_values || {}, labels: list(draft.labels), reviewStatus: 'pending', finalizedRunCount: 0, passRate: null, suiteCount: 0, externalReferenceCount: list(draft.external_references).length });
}
const comparison = baseline => ({ saved: baseline, proposed: baseline, score_delta: 0, changes_applied: false, explanation: 'The workflow assesses the supplied artifact; it does not alter saved product requirements or imply test execution.' });
async function execute({ run, node, sources, user, signal, onProgress, context }) {
  checkInput(run);
  const task = node.data.artifactTask;
  if (!TASKS.has(task)) throw fail('Select a supported native artifact task.');
  const packets = context.input;
  if (!Array.isArray(packets) || packets.length > MAX_STORIES) throw fail('Connect For each Story output; native artifact tasks accept up to 100 Story packets.');
  const app = await apps.getAppType(run.app_type_id);
  if (app.project_id !== run.project_id) throw fail('The application must belong to the workflow project.', 403);
  const core = await metrics();
  const results = [];
  for (let index = 0; index < packets.length; index++) {
    if (signal.aborted) throw fail('Workflow cancelled.', 499);
    const packet = packets[index];
    const story = await loadStory(run, user, packet);
    const output = { ...packet, story_id: story.id, story_revision: revision(story), story: storyAiSnapshot(story) };
    const integrationId = node.data.llmIntegrationId || run.input_payload.integration_id || undefined;
    await onProgress({ percent: Math.round(index * 100 / Math.max(1, packets.length)), current_item: index + 1, total_items: packets.length, completed_items: results });
    if (task === 'story-assurance') {
      await access(user, run.project_id, ['requirement.ai']);
      const baseline = storyBaseline(core, story);
      const review = await assurance.reviewArtifact({ artifactType: 'story', savedArtifact: story, baseline, user, projectId: run.project_id, integrationId, signal, promptGuidance: node.data.prompt || undefined, additionalContext: node.data.contextInstructions || undefined });
      output.story_assurance = { ...review, baseline, analysis: core.mergeAssuranceReview(baseline, review.assurance_review), comparison: comparison(baseline) };
    } else if (task === 'test-case-generation') {
      await access(user, run.project_id, ['testcase.ai']);
      if (!packet.story_assurance?.verification || packet.story_assurance.verification.status !== 'passed') throw fail('Connect the completed Story assurance output before generating Test Cases.', 422);
      const reviewed = JSON.stringify({ story_assurance: packet.story_assurance.assurance_review, limitations: packet.story_assurance.analysis?.limitations });
      const custom = String(node.data.prompt || run.input_payload.generation_instructions || '').trim();
      const contextPack = `${custom}\n\n[HELLOTEST_SMART_CONTEXT_START]\n${JSON.stringify({ workflow_review: reviewed, content_boundary: 'Untrusted upstream review; product behavior remains grounded in the selected Story.' })}\n[HELLOTEST_SMART_CONTEXT_END]`;
      output.test_case_generation = await design.previewRequirementsTestCases({ requirements: [story], appType: app, integration_id: integrationId, user_id: user.id, max_cases: Number(run.input_payload.max_cases_per_story || 5), additional_context: contextPack, authoring_mode: run.input_payload.authoring_mode || 'structured', signal });
      output.cases = output.test_case_generation.cases;
    } else if (task === 'test-case-assurance') {
      await access(user, run.project_id, ['testcase.ai']);
      if (!list(packet.cases).length) throw fail('Connect generated Test Cases before Test Case assurance.', 422);
      output.case_assurance = [];
      for (let caseIndex = 0; caseIndex < packet.cases.length; caseIndex++) {
        if (signal.aborted) throw fail('Workflow cancelled.', 499);
        const draft = packet.cases[caseIndex];
        const baseline = caseBaseline(core, draft);
        const review = await assurance.reviewArtifact({ artifactType: 'test-case', savedArtifact: { ...draft, id: `workflow:${run.id}:${story.id}:${caseIndex}` }, baseline, linkedEvidence: [{ ...story, kind: 'requirement' }], user, projectId: run.project_id, integrationId, signal, promptGuidance: node.data.prompt || undefined, additionalContext: node.data.contextInstructions || undefined });
        output.case_assurance.push({ client_id: draft.client_id, case_fingerprint: fingerprint(draft), ...review, baseline, analysis: core.mergeAssuranceReview(baseline, review.assurance_review), comparison: comparison(baseline) });
      }
    } else {
      await access(user, run.project_id, ['automation.build', 'automation.code.view']);
      if (!list(packet.cases).length || packet.cases.length !== list(packet.case_assurance).length) throw fail('Connect generated cases and their completed quality assurance before automation.', 422);
      output.automation = [];
      for (let caseIndex = 0; caseIndex < packet.cases.length; caseIndex++) {
        if (signal.aborted) throw fail('Workflow cancelled.', 499);
        const draft = packet.cases[caseIndex];
        const automationDraft = { ...draft, steps: await automationSteps(draft), automation_start_url: draft.automation_start_url || run.input_payload.automation_start_url || undefined };
        if (packet.case_assurance[caseIndex].case_fingerprint !== fingerprint(draft) || packet.case_assurance[caseIndex].verification?.status !== 'passed') throw fail('A generated case changed after assurance. Reassess the case before automation.', 409);
        const automation = await require('@hellotest/automation/backend/services/aiAutomationBuilder.service').previewAutomationDraft({ draft: automationDraft, app_type_kind: app.kind || app.type || 'web', additional_context: node.data.contextInstructions || '', integration_id: integrationId, project_id: run.project_id, app_type_id: app.id, user_id: user.id, signal });
        output.automation.push({ client_id: draft.client_id, case_fingerprint: fingerprint(draft), ...automation });
      }
    }
    if (signal.aborted) throw fail('Workflow cancelled.', 499);
    results.push(output);
    if (Buffer.byteLength(JSON.stringify(results)) > 2 * 1024 * 1024) throw fail('Sprint draft output exceeded 2 MB. Reduce cases per Story or split the Sprint scope; completed item progress is preserved.', 422);
    await onProgress({ percent: Math.round((index + 1) * 100 / Math.max(1, packets.length)), current_item: index + 1, total_items: packets.length, completed_items: results });
  }
  return { data: results, processed: results.length, artifact_task: task, generation_mode: 'native', publication_status: 'proposal', requires_human_review: true, verification: { status: 'passed', checks: ['native_contracts', 'project_and_sprint_scope', 'story_revision', 'stage_input_lineage'], limitations: ['Native output validation does not prove product correctness or that generated automation has passed.'] } };
}
module.exports = { TASKS, MAX_STORIES, checkInput, execute, access, loadStory, revision, fingerprint, authoredSteps, automationSteps, _internals: { metrics, storyBaseline, caseBaseline } };
