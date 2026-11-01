const { createHash } = require('node:crypto');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const flags = require('@hellotest/platform/backend/services/featureFlag.service');
const requirements = require('@hellotest/manual/backend/services/requirement.service');
const design = require('@hellotest/manual/backend/services/requirementDesign.service');
const assurance = require('@hellotest/ai/backend/services/artifactAssurance.service');
const apps = require('@hellotest/platform/backend/public/applicationAccess');
const { storyAiSnapshot } = require('@hellotest/platform/backend/src/utils/aiArtifactContext');
const { normalizeParameterLayer } = require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const { referenceKey, parameterReference, createBrowserParameterResolver } = require('@hellotest/automation/backend/lib/automationBrowserParameters');
const { fail } = require('./connections');
const { safeMessage, failureInfo } = require('./runtimeEvents');
const automationInputs = require('./automationNodeInputs');
const { generationOptions,pinnedGenerationOptions } = require('./generationNodeOptions');
const modelTrace = require('@hellotest/platform/backend/src/utils/llmTraceContext');
const executionConfiguration = require('@hellotest/platform/backend/src/utils/aiExecutionConfiguration');
const TASK_DEFAULTS = require('../../shared/workflowNativeTasks.json');
const TASKS = new Set(['story-assurance', 'test-case-generation', 'test-case-assurance', 'automation-engineer']);
const taskUsageKey = task => TASK_DEFAULTS[task]?.featureKey;
const MAX_STORIES = 100;
const assertActive = signal => { if (signal?.aborted) throw fail('Workflow cancelled.', 499); };
// JSONB does not preserve object insertion order. Persisted drafts and freshly
// generated drafts must produce the same lineage/acceptance digest.
const canonical = value => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const revision = story => fingerprint({ revision: story.revision, updated_at: story.updated_at, snapshot: storyAiSnapshot(story) });
const metrics = () => import('@hellotest/ai/shared/artifactAssurance');
const list = value => Array.isArray(value) ? value : [];
// Behavioral guidance belongs to the saved node. Domain authorization, source
// lineage and executable-source validation remain enforced by their services.
function taskGuidance(node) {
  const data = node.data || {};
  const defaults = TASK_DEFAULTS[data.artifactTask] || {};
  return [
    ['Task', data.task ?? defaults.task], ['Instructions', data.instructions ?? data.prompt ?? defaults.instructions],
    ['Guardrails', data.guardrails ?? defaults.guardrails],
    ['Review criteria', require('./nodeAiConfiguration').reviewCriteria(data)]
  ].filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([label, value]) => `${label}:\n${value.trim()}`).join('\n\n');
}
function taskResult(task, packet) {
  const row = { story_id: packet.story_id, story_revision: packet.story_revision, story:{id:packet.story_id,title:packet.story?.title || packet.story_id} };
  if (task === 'story-assurance') row.story_assurance = packet.story_assurance;
  if (task === 'test-case-generation') Object.assign(row, {cases:packet.cases,test_case_generation:packet.test_case_generation});
  if (task === 'test-case-assurance') row.case_assurance = list(packet.case_assurance).map((review,index) => ({...review,title:packet.cases?.[index]?.title,case_index:index}));
  if (task === 'automation-engineer') Object.assign(row, {
    automation:list(packet.automation).map((automation,index)=>automation ? {...automation,title:packet.cases?.[index]?.title,case_index:index} : null),
    automation_input_required:packet.automation_input_required || [],
    automation_failures:packet.automation_failures || [],
    ...(packet.automation_progress ? { automation_progress: packet.automation_progress } : {})
  });
  return row;
}
async function access(user, projectId, codes) {
  for (const code of codes) {
    if (!await permissions.hasPermission(user, code, projectId) || !await flags.areEnabled(flags.getFeatureKeysForPermission(code), { user })) throw fail(`Permission required: ${code}`, 403);
  }
}
function checkSprintInput(run) {
  const sprint = run.input_payload?.sprint_id;
  if (typeof sprint !== 'string' || !sprint.trim() || sprint !== sprint.trim() || sprint.length > 255 || /[\u0000-\u001f\u007f]/.test(sprint)) throw fail('Supply sprint_id as a Sprint ID of 1–255 visible characters without surrounding whitespace in the manual trigger input.', 422);
  if (run.input_payload.project_id && run.input_payload.project_id !== run.project_id) throw fail('The trigger project must match the workflow project.', 403);
  return sprint;
}
function checkInput(run, { generationNode } = {}) {
  if (!run.app_type_id) throw fail('Select an application before running Sprint Automator.', 422);
  checkSprintInput(run);
  if (Object.hasOwn(run.input_payload, 'integration_id')) {
    const integration = run.input_payload.integration_id;
    if (typeof integration !== 'string' || !integration.trim() || integration !== integration.trim() || integration.length > 255 || /[\u0000-\u001f\u007f]/.test(integration)) throw fail('Supply integration_id as a model connection ID of 1–255 visible characters without surrounding whitespace, or omit it to use the configured model.', 422);
  }
  if (generationNode) generationOptions(generationNode.data,run.input_payload);
  else pinnedGenerationOptions(run);
  if (run.input_payload.app_type_id && run.input_payload.app_type_id !== run.app_type_id) throw fail('The trigger application must match the workflow application.', 403);
  if (run.input_payload.automation_start_url != null) automationInputs.validateNodeOptions({automationStartUrl:run.input_payload.automation_start_url});
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
function assertReview(review, label) {
  if (review?.verification?.status !== 'passed' || !String(review.assurance_review?.summary || '').trim()) throw fail(`${label} did not return a complete evidence-grounded native review. No downstream draft was generated.`, 422);
}
function assertDrafts(cases, storyId, maxCases = 10) {
  if (!Array.isArray(cases) || !cases.length || cases.length > maxCases) throw fail('The native generator did not return the requested bounded Test Case drafts.', 422);
  const clientIds = new Set();
  for (const draft of cases) {
    if (!draft || !String(draft.title || '').trim() || !String(draft.description || '').trim()
      || !String(draft.client_id || '').trim() || clientIds.has(draft.client_id)
      || !Array.isArray(draft.requirement_ids) || draft.requirement_ids.length !== 1 || draft.requirement_ids[0] !== storyId) throw fail('Each generated Test Case must have a unique draft identity and trace only to its selected Story.', 422);
    clientIds.add(draft.client_id);
    if (draft.authoring_mode === 'gherkin') {
      if (!/^\s*Feature\s*:\s*\S/im.test(draft.gherkin_document || '') || !/^\s*Scenario(?: Outline| Template)?\s*:\s*\S/im.test(draft.gherkin_document || '') || !/^\s*Then\s+\S/im.test(draft.gherkin_document || '')) throw fail('The native generator returned an incomplete Gherkin draft.', 422);
    } else if (!Array.isArray(draft.steps) || !draft.steps.length || draft.steps.length > 30 || draft.steps.some(step => !String(step?.action || '').trim() || !String(step?.expected_result || '').trim())) throw fail('The native generator returned incomplete Test Case actions or expected results.', 422);
  }
}
function taskContext(node, run, packet, story, {includeStoryContent=true}={}) {
  return {
    workflow_scope: { project_id: run.project_id, app_type_id: run.app_type_id, sprint_id: run.input_payload.sprint_id, story_id: story.id, story_revision: revision(story) },
    selected_story: { ref: `requirement:${story.id}`, story_revision:revision(story), ...(includeStoryContent?{content:storyAiSnapshot(story)}:{content_source:'native_artifact_input'}) },
    supplied_context: String(node.data.contextInstructions || '').trim(),
    ...(packet.story_assurance ? { story_assurance: packet.story_assurance.assurance_review, story_assurance_limitations: packet.story_assurance.analysis?.limitations || [] } : {}),
    content_provenance: { selected_story: 'authorized_current_record', supplied_context: 'user_supplied', upstream_reviews: 'model_generated', scope_owner: 'workflow_runtime' }
  };
}
function automationInputGap(error, draft, storyId, caseIndex) {
  const messages = {
    AUTOMATION_DEPENDENCY_MISSING: 'Provide the missing application context, fixture contract or test-data references before generating this case’s automation.',
    AUTOMATION_START_URL_REQUIRED: 'Supply automation_start_url in the workflow input before generating browser automation.',
    AUTOMATION_START_URL_INVALID: 'Set automation_start_url to a complete HTTP or HTTPS address without credentials or parameter placeholders.'
  };
  if (!Object.hasOwn(messages, error?.code) || [401, 403, 408, 429, 499].includes(error.statusCode) || error.statusCode >= 500 || error.name === 'AbortError' || error.outcome_unknown) return null;
  const clean = value => typeof value === 'string' && value.trim() ? safeMessage(value).slice(0, 600) : '';
  const texts = values => [...new Set(list(values).map(clean).filter(Boolean))].slice(0, 10);
  const blocked = list(error.blocked_steps).slice(0, 20).filter(item => item && typeof item === 'object').map(item => ({
    ...(typeof item.step_id === 'string' && /^[\w:-]{1,255}$/.test(item.step_id) ? { step_id: item.step_id } : {}),
    reason: clean(item.reason) || messages[error.code],
    required_context: texts(item.required_context), required_parameters: texts(item.required_parameters)
  }));
  return { case_index: caseIndex, client_id: draft.client_id, case_fingerprint: fingerprint(draft), story_id: storyId,
    code: error.code, message: messages[error.code], blocked_steps: blocked,
    required_context: [...new Set(blocked.flatMap(item => item.required_context))].slice(0, 10),
    required_parameters: [...new Set(blocked.flatMap(item => item.required_parameters))].slice(0, 10) };
}
// Case-specific generation failures do not discard a Sprint's other cases.
// Provider/transport/access/cancellation errors remain systemic and stop work.
function automationCaseFailure(error, draft, storyId, caseIndex) {
  if (error?.outcome_unknown || error?.transactionOutcomeUnknown || error?.name === 'AbortError'
    || [401,403,408,429,499].includes(error?.statusCode) || error?.statusCode >= 500) return null;
  if (!new Set(['AUTOMATION_BUILD_INCOMPLETE', 'AUTOMATION_GENERATED_SOURCE_INVALID', 'AUTOMATION_PRIVATE_VALUE_IN_SOURCE',
    'AUTOMATION_UNGROUNDED_API_TARGET', 'AUTOMATION_UNGROUNDED_NAVIGATION', 'AUTOMATION_PARAMETER_INVALID',
    'AUTOMATION_PARAMETER_MISSING', 'AUTOMATION_CASE_STEPS_INVALID', 'AI_MANAGED_SCHEMA_INVALID', 'AI_INVALID_JSON']).has(error?.code)) return null;
  const detail = failureInfo(error);
  return { case_index:caseIndex,client_id:draft.client_id,case_fingerprint:fingerprint(draft),story_id:storyId,
    code:error.code,status:'failed',message:safeMessage(error.publicMessage || error.message,detail.message),retryable:true,
    ...(detail.validation_feedback ? { validation_feedback:detail.validation_feedback } : {}),
    ...(detail.completed_sections == null ? {} : { completed_sections:detail.completed_sections,total_sections:detail.total_sections }) };
}
function draftParameterInputGap(draft, steps, storyId, caseIndex) {
  // Native case authoring explicitly marks unavailable inputs. Those markers
  // are evidence gaps, not configured values for the automation resolver.
  // Empty values and embedded/literal marker text remain authored test data.
  const source = draft.parameter_values;
  const values = normalizeParameterLayer(source && typeof source === 'object' && !Array.isArray(source) ? source : {}, 't');
  const resolver = createBrowserParameterResolver({ testCase: draft, caseValues: values, steps, materialize: false });
  const available = new Set(resolver.availableParameterNames), required = new Set();
  const placeholder = value => /^\[\s*(?:missing|required)\s*:[^\]\r\n]*\]$/i.test(value.trim());
  // Use the native whole-reference grammar and legacy namespace precedence.
  // Analyze declarations without substituting their values: the native
  // runtime intentionally does not rescan inserted values as new references.
  const target = value => {
    const key = referenceKey(value);
    if (!key || !value.startsWith('@') || /^@[tsr]\./i.test(value)) return key;
    return available.has(key) ? key : available.has(`t.${key.slice(2)}`) ? `t.${key.slice(2)}` : key;
  };
  const unresolved = new Map();
  for (const start of Object.keys(values)) {
    const path = [], visited = new Set();
    let current = start, missing = false;
    while (current) {
      if (unresolved.has(current)) { missing = unresolved.get(current); break; }
      if (visited.has(current)) { missing = true; break; }
      if (!Object.hasOwn(values, current)) {
        // Run bindings may be captured by an earlier automation section.
        missing = !available.has(current) && !current.startsWith('r.');
        if (missing) required.add(current);
        break;
      }
      visited.add(current); path.push(current);
      if (placeholder(values[current])) { missing = true; break; }
      current = target(values[current]);
    }
    for (const key of path) { unresolved.set(key, missing); if (missing) required.add(key); }
  }
  for (const key of resolver.buildData({ steps }).missing_parameter_references) if (/^[ts]\./.test(key)) required.add(key);
  if (!required.size) return null;
  return automationInputGap({ code: 'AUTOMATION_DEPENDENCY_MISSING', statusCode: 422, blocked_steps: [{
    reason: 'Configure the named Test Case inputs with reviewed application context, fixture contracts or test-data references. Missing values, self-references and circular references do not supply the required inputs.',
    required_parameters: [...required].sort().map(parameterReference), required_context: []
  }] }, draft, storyId, caseIndex);
}
function assuranceAutomationInputGap(review, draft, storyId, caseIndex) {
  const readiness = review.assurance_review?.automation_readiness;
  if (readiness?.status === 'ready' && typeof readiness.summary === 'string' && readiness.summary.trim()
    && Array.isArray(readiness.evidence_refs) && readiness.evidence_refs.length && readiness.evidence_refs.every(ref => typeof ref === 'string' && ref.trim())
    && Array.isArray(readiness.missing_context) && !readiness.missing_context.length) return null;
  const kinds = new Set(['api_contract', 'authentication', 'test_data', 'fixture', 'application_context', 'other']);
  const blocked = list(readiness?.missing_context).slice(0, 8).filter(item => item && kinds.has(item.kind)).map(item => ({
    step_id: list(item.step_refs)[0], reason: item.reason,
    required_context: [item.kind], required_parameters: []
  }));
  if (!blocked.length) blocked.push({
    reason: 'Test Case assurance has not established automation input readiness. Reassess the case with the required application contracts and fixture context before generating automation.',
    required_context: ['Assessed automation input readiness'], required_parameters: []
  });
  return automationInputGap({ code: 'AUTOMATION_DEPENDENCY_MISSING', statusCode: 422, blocked_steps: blocked }, draft, storyId, caseIndex);
}
async function execute({ run, node, sources, user, signal, onProgress, context }) {
  assertActive(signal);
  const task = node.data.artifactTask;
  checkInput(run,{generationNode:task==='test-case-generation'?node:undefined});
  if (!TASKS.has(task)) throw fail('Select a supported native artifact task.');
  if (task === 'automation-engineer') automationInputs.validateNodeOptions(node.data);
  const readinessPolicy = node.data.readinessPolicy ?? TASK_DEFAULTS['automation-engineer'].readinessPolicy ?? 'verify-inputs';
  if (task === 'automation-engineer' && !['verify-inputs','require-ready'].includes(readinessPolicy)) throw fail('Choose verify-inputs or require-ready for automation readiness.');
  const packets = context.input;
  if (!Array.isArray(packets) || packets.length > MAX_STORIES) throw fail('Connect For each Story output; native artifact tasks accept up to 100 Story packets.');
  const app = await apps.getAppType(run.app_type_id);
  if (app.project_id !== run.project_id) throw fail('The application must belong to the workflow project.', 403);
  const core = await metrics();
  const results = [];
  const checkpointKey = task === 'automation-engineer' ? fingerprint({ node: node.data,
    input:packets.map(packet=>({story_id:packet?.story_id,story_revision:packet?.story_revision,cases:list(packet?.cases).map(fingerprint),case_assurance:packet?.case_assurance})) }) : null;
  const savedCheckpoint = run.node_results?.find(item=>item.node_id===node.id)?.progress?.automation_checkpoint;
  const resumable = savedCheckpoint?.schema_version === 1 && savedCheckpoint.input_fingerprint === checkpointKey ? savedCheckpoint.stories : [];
  const checkpointStories = new Map(list(resumable).map(item=>[item.story_id,item]));
  const checkpointProgress = async (packet, storyIndex, caseIndex, totalCases) => {
    packet.automation_progress = { completed:packet.automation.filter(Boolean).length,failed:list(packet.automation_failures).length,
      needs_input:list(packet.automation_input_required).length,processed:caseIndex + 1,total:totalCases };
    const processed = [...results,packet];
    for (const item of processed) {
      const previous = checkpointStories.get(item.story_id), automation = [...list(previous?.automation)];
      for (const [index,value] of item.automation.entries()) automation[index]=value;
      // Resuming an early failed case must not erase later complete cases
      // recorded by the original pass, even if this retry is interrupted too.
      const later = key=>list(previous?.[key]).filter(row=>row.case_index>=item.automation.length);
      checkpointStories.set(item.story_id,{story_id:item.story_id,story_revision:item.story_revision,automation,
        automation_input_required:[...item.automation_input_required,...later('automation_input_required')],
        automation_failures:[...item.automation_failures,...later('automation_failures')],automation_progress:item.automation_progress});
    }
    const progress = {percent:Math.round((storyIndex + (caseIndex + 1) / Math.max(1,totalCases)) * 100 / Math.max(1,packets.length)),
      current_item:storyIndex+1,total_items:packets.length,current_case:caseIndex+1,total_cases:totalCases,
      completed_items:processed.map(item=>taskResult(task,item)),automation_checkpoint:{schema_version:1,input_fingerprint:checkpointKey,
        stories:[...checkpointStories.values()]}};
    if (Buffer.byteLength(JSON.stringify(progress)) > 4 * 1024 * 1024) throw fail('Automation progress exceeded its checkpoint budget. Reduce cases per Story or split the Sprint; completed checkpoints are retained.',422);
    await onProgress(progress);
  };
  const seenStories = new Set();
  for (let index = 0; index < packets.length; index++) {
    assertActive(signal);
    const packet = packets[index];
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw fail('Each native task input must be a recorded Story packet.', 422);
    const story = await loadStory(run, user, packet);
    assertActive(signal);
    if (seenStories.has(story.id)) throw fail('The native task input contains a duplicate Story. Use the complete For each Story output once.', 409);
    seenStories.add(story.id);
    if (task !== 'story-assurance' && packet.story_revision !== revision(story)) throw fail('Connect the revision-pinned output of the preceding native task.', 409);
    const output = { ...packet, story_id: story.id, story_revision: revision(story), story: storyAiSnapshot(story) };
    // Rerunning an earlier stage invalidates every result derived from its old
    // review or cases. A stale downstream draft must never look newly assessed.
    if (task === 'story-assurance') for (const key of ['test_case_generation', 'cases', 'case_assurance', 'automation', 'automation_input_required', 'automation_failures', 'automation_progress']) delete output[key];
    if (task === 'test-case-generation') for (const key of ['case_assurance', 'automation', 'automation_input_required', 'automation_failures', 'automation_progress']) delete output[key];
    if (task === 'test-case-assurance') for (const key of ['automation', 'automation_input_required', 'automation_failures', 'automation_progress']) delete output[key];
    const integrationId = node.data.llmIntegrationId || run.input_payload.integration_id || undefined;
    if (task !== 'automation-engineer') await onProgress({ percent: Math.round(index * 100 / Math.max(1, packets.length)), current_item: index + 1, total_items: packets.length, completed_items: results.map(packet=>taskResult(task,packet)) });
    // This stage already owns a freshly authorized, revision-pinned Story and
    // the exact case lineage supplied below. The shared gateway must not add a
    // second generic project retrieval to these scoped model requests. Native
    // design may still explicitly retrieve its own Story-scoped context.
    await modelTrace.run({project_id:run.project_id,app_type_id:run.app_type_id,actor_id:user.id,
      mcp_context_depth:1,mcp_context:'supplied_native_evidence',
      evidence_scope:{sprint_id:run.input_payload.sprint_id,story_id:story.id},
      native_evidence:{story_id:story.id,story_revision:revision(story),artifact_task:task}}, async () => {
    if (task === 'story-assurance') {
      await access(user, run.project_id, ['requirement.ai']);
      const baseline = storyBaseline(core, story);
      const review = await assurance.reviewArtifact({ artifactType: 'story', savedArtifact: story, baseline, user, projectId: run.project_id, integrationId, signal, promptGuidance: executionConfiguration.current() ? undefined : taskGuidance(node) || undefined, additionalContext: node.data.contextInstructions || undefined });
      assertActive(signal);
      assertReview(review, 'Story assurance');
      output.story_assurance = { ...review, story_id: story.id, story_revision: revision(story), baseline, analysis: core.mergeAssuranceReview(baseline, review.assurance_review), comparison: comparison(baseline) };
    } else if (task === 'test-case-generation') {
      await access(user, run.project_id, ['testcase.ai']);
      if (!packet.story_assurance?.verification || packet.story_assurance.verification.status !== 'passed') throw fail('Connect the completed Story assurance output before generating Test Cases.', 422);
      assertReview(packet.story_assurance, 'Story assurance');
      if (packet.story_assurance.story_id && packet.story_assurance.story_id !== story.id || packet.story_assurance.story_revision && packet.story_assurance.story_revision !== revision(story)) throw fail('Story assurance belongs to a different Story revision.', 409);
      const generation = generationOptions(node.data,run.input_payload);
      const custom = [generation.instructions, executionConfiguration.current() ? '' : taskGuidance(node)].filter(value => typeof value === 'string' && value.trim()).join('\n\n');
      const contextPack = `${custom}\n\n[HELLOTEST_SMART_CONTEXT_START]\n${JSON.stringify(taskContext(node, run, packet, story,{includeStoryContent:false}))}\n[HELLOTEST_SMART_CONTEXT_END]`;
      output.test_case_generation = await design.previewRequirementsTestCases({ requirements: [story], appType: app, integration_id: integrationId, user_id: user.id, max_cases: generation.maxCases, additional_context: contextPack, authoring_mode: generation.authoringMode, evidence_scope: { sprint_id: run.input_payload.sprint_id, story_id: story.id }, signal });
      assertActive(signal);
      output.cases = output.test_case_generation.cases;
      assertDrafts(output.cases, story.id, generation.maxCases);
      output.test_case_generation.verification = { status: 'passed', checks: ['native_case_contract', 'selected_story_traceability'], limitations: ['Draft schema validation does not establish complete coverage or observed product behavior.'] };
    } else if (task === 'test-case-assurance') {
      await access(user, run.project_id, ['testcase.ai']);
      if (!list(packet.cases).length) throw fail('Connect generated Test Cases before Test Case assurance.', 422);
      assertDrafts(packet.cases, story.id);
      output.case_assurance = [];
      for (let caseIndex = 0; caseIndex < packet.cases.length; caseIndex++) {
        assertActive(signal);
        const draft = packet.cases[caseIndex];
        const baseline = caseBaseline(core, draft);
        const review = await assurance.reviewArtifact({ artifactType: 'test-case', assessAutomationReadiness: true, savedArtifact: { ...draft, id: `workflow:${run.id}:${story.id}:${caseIndex}` }, baseline, linkedEvidence: [{ ...story, kind: 'requirement' }], user, projectId: run.project_id, integrationId, signal, promptGuidance: executionConfiguration.current() ? undefined : taskGuidance(node) || undefined, additionalContext: JSON.stringify(taskContext(node, run, packet, story,{includeStoryContent:false})) });
        assertActive(signal);
        assertReview(review, 'Test Case assurance');
        output.case_assurance.push({ client_id: draft.client_id, case_fingerprint: fingerprint(draft), ...review, baseline, analysis: core.mergeAssuranceReview(baseline, review.assurance_review), comparison: comparison(baseline) });
      }
    } else {
      await access(user, run.project_id, ['automation.build', 'automation.code.view']);
      if (!list(packet.cases).length || packet.cases.length !== list(packet.case_assurance).length) throw fail('Connect generated cases and their completed quality assurance before automation.', 422);
      assertDrafts(packet.cases, story.id);
      output.automation = [];
      output.automation_input_required = [];
      output.automation_failures = [];
      const previous = list(resumable).find(item=>item.story_id===story.id && item.story_revision===revision(story));
      for (let caseIndex = 0; caseIndex < packet.cases.length; caseIndex++) {
        assertActive(signal);
        const draft = packet.cases[caseIndex];
        if (packet.case_assurance[caseIndex].case_fingerprint !== fingerprint(draft) || packet.case_assurance[caseIndex].verification?.status !== 'passed') throw fail('A generated case changed after assurance. Reassess the case before automation.', 409);
        const inputs = await automationInputs.resolveNodeInputs({run,node,user,access});
        const previouslyBuilt = previous?.automation?.[caseIndex];
        if (previouslyBuilt?.case_fingerprint === fingerprint(draft) && previouslyBuilt.validation?.status === 'passed'
          && previouslyBuilt.verification_status === 'unverified' && list(previouslyBuilt.steps).length) {
          output.automation.push(previouslyBuilt);
          await checkpointProgress(output,index,caseIndex,packet.cases.length);
          continue;
        }
        let steps;
        try { steps = await automationSteps(draft); }
        catch (error) {
          if (![400,422].includes(error.statusCode) || error.outcome_unknown || signal?.aborted) throw error;
          error.code = 'AUTOMATION_CASE_STEPS_INVALID';
          output.automation.push(null);output.automation_failures.push(automationCaseFailure(error,draft,story.id,caseIndex));
          await checkpointProgress(output,index,caseIndex,packet.cases.length);
          continue;
        }
        const supplied = automationInputs.caseInputs(draft,steps,inputs);
        const automationDraft = supplied.draft;
        const inputGap = draftParameterInputGap(supplied.inputDraft, automationDraft.steps, story.id, caseIndex)
          || (readinessPolicy === 'require-ready' ? assuranceAutomationInputGap(packet.case_assurance[caseIndex], draft, story.id, caseIndex) : null);
        if (inputGap) {
          output.automation.push(null);
          output.automation_input_required.push({...inputGap,case_fingerprint:fingerprint(draft)});
          await checkpointProgress(output,index,caseIndex,packet.cases.length);
          continue;
        }
        const automationContext = [executionConfiguration.current() ? '' : taskGuidance(node), JSON.stringify({ ...taskContext(node, run, packet, story),
          readiness_policy:readinessPolicy,
          case_assurance: packet.case_assurance[caseIndex].assurance_review, case_assurance_limitations: packet.case_assurance[caseIndex].analysis?.limitations || [] })].filter(Boolean).join('\n\n');
        let automation;
        try {
          automation = await require('@hellotest/automation/backend/services/aiAutomationBuilder.service').previewAutomationDraft({ draft: automationDraft, runtime_parameter_values:supplied.runtimeValues, app_type_kind: app.kind || app.type || 'web', additional_context: automationContext, integration_id: integrationId, project_id: run.project_id, app_type_id: app.id, user_id: user.id, inspect_browser: node.data.inspectBrowser !== false, signal });
          assertActive(signal);
          if (automation?.validation?.status !== 'passed' || !Array.isArray(automation.steps) || automation.steps.length !== automationDraft.steps.length) {
            throw Object.assign(fail('The native automation generator did not return a complete validated draft for every authored step.',422),{code:'AUTOMATION_BUILD_INCOMPLETE'});
          }
        } catch (error) {
          assertActive(signal);
          error = supplied.redactError(error);
          const gap = automationInputGap(error, draft, story.id, caseIndex);
          const failed = !gap && automationCaseFailure(error,draft,story.id,caseIndex);
          if (!gap && !failed) throw error;
          output.automation.push(null);
          if (gap) output.automation_input_required.push(gap);
          else output.automation_failures.push(failed);
          await checkpointProgress(output,index,caseIndex,packet.cases.length);
          continue;
        }
        assertActive(signal);
        output.automation.push(supplied.project({ ...automation, client_id: draft.client_id, case_fingerprint: fingerprint(draft),
          parameter_values:supplied.publicInputs.parameter_values,parameter_bindings:{...automation.parameter_bindings,...supplied.publicInputs,
            private_parameter_references:[...new Set([...list(automation.parameter_bindings?.private_parameter_references),...supplied.publicInputs.private_parameter_references])] } }));
        await checkpointProgress(output,index,caseIndex,packet.cases.length);
      }
    }
    });
    assertActive(signal);
    results.push(output);
    if (Buffer.byteLength(JSON.stringify(results)) > 2 * 1024 * 1024) throw fail('Sprint draft output exceeded 2 MB. Reduce cases per Story or split the Sprint scope; completed item progress is preserved.', 422);
    if (task !== 'automation-engineer') await onProgress({ percent: Math.round((index + 1) * 100 / Math.max(1, packets.length)), current_item: index + 1, total_items: packets.length, completed_items: results.map(packet=>taskResult(task,packet)) });
  }
  const inputGaps = results.flatMap(packet => list(packet.automation_input_required));
  const failedCases = results.flatMap(packet=>list(packet.automation_failures));
  const metadata = { processed: results.length, artifact_task: task, generation_mode: 'native', publication_status: 'proposal', requires_human_review: true,
    ...(task === 'automation-engineer' ? {readiness_policy:readinessPolicy} : {}),
    ...(failedCases.length ? {outcome:'automation_partial',failed_case_count:failedCases.length,input_required_count:inputGaps.length,
      message:`Automation could not complete ${failedCases.length} Test Case${failedCases.length===1?'':'s'}. Completed cases are retained; inspect each failed case before retrying.`}
      : inputGaps.length ? { outcome: 'automation_input_required', input_required_count: inputGaps.length, message: `Automation needs additional input for ${inputGaps.length} Test Case${inputGaps.length === 1 ? '' : 's'}. Assessed manual drafts remain available for review and acceptance.` } : results.length ? {} : { outcome: 'no_stories', message: 'No Stories matched the selected Sprint. No AI task or artifact write was performed.' }),
    verification: { status: inputGaps.length || failedCases.length ? 'needs_input' : results.length ? 'passed' : 'not_required', checks: results.length ? ['native_contracts', 'project_and_sprint_scope', 'story_revision', 'stage_input_lineage'] : [], limitations: ['Native output validation does not prove product correctness or that generated automation has passed.'] } };
  return {__workflow_result:{output:{...metadata,data:results.map(packet=>taskResult(task,packet))},context:{...metadata,data:results}}};
}
module.exports = { TASKS, taskUsageKey, MAX_STORIES, checkInput, checkSprintInput, execute, access, loadStory, revision, fingerprint, authoredSteps, automationSteps, _internals: { metrics, storyBaseline, caseBaseline, assertDrafts, taskGuidance, taskResult } };
