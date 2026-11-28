// programGeneration: cohesive builder implementation; dependencies are explicit lazy ports.
function createProgramGeneration(ports) {
const exports = ports.exports;
const require = ports.require;


const buildPrompt = ({
  testCase,
  steps,
  cacheRows,
  knowledgeRows,
  capturedActions,
  capturedNetwork,
  buildContext,
  startUrl,
  additionalContext
}) => {
  // Shared native request templates belong to keyword generation. The model
  // boundary still applies the active specialist's prompt, model and policies,
  // and any matching published specialist block overrides these source blocks.
  const prompt = [
    ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.44"),
    "",
    ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.45"),
    ports.aiInstructionBlock("ai.automation.keyword_generation", "automationBuild.apiRuntime"),
    ports.runtimeSpecialistInstructions(steps.map(step => ports.inferAutomationStepType(step))),
    JSON.stringify({automation_case_type:ports.resolveAutomationCaseType(testCase,{steps,appTypeKind:testCase.app_type_kind}),runtime_specialists:[...new Set(steps.map(step=>ports.inferAutomationStepType(step)))].map(ports.runtimeSpecialist).filter(Boolean)}),
    "",
    ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.66"),
    "{",
    ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.67"),
    "}",
    "",
    [ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.5"),String(testCase.project_name || testCase.project_id || "Unknown project"),""].join(''),
    [ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.6"),String(testCase.app_type_name || testCase.app_type_id || "Unknown app"),ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.7"),String(testCase.app_type_kind || "web"),ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.8")].join(''),
    [ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.9"),String(testCase.title),""].join(''),
    [ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.10"),String(testCase.description || "No description provided."),""].join(''),
    [ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.11"),String((ports.safeJson(testCase.external_references, []) || []).join(", ") || "None"),""].join(''),
    [ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.12"),String((ports.safeJson(testCase.labels, []) || []).join(", ") || "None"),""].join(''),
    [ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.service.prompt.segment.13"),String(startUrl || "Not provided"),""].join(''),
    "",
    ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.89"),
    JSON.stringify(buildContext || { environment: null, configuration: null, data_set: null }),
    "",
    ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.90"),
    JSON.stringify(steps.map(ports.summarizeStep)),
    "",
    ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.91"),
    JSON.stringify(ports.summarizeScreenCatalog(cacheRows)),
    "",
    ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.92"),
    JSON.stringify(ports.summarizeCache(cacheRows)),
    "",
    ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.93"),
    JSON.stringify(ports.safeJson(testCase.parameter_values, {})),
    "",
    ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.prompt.94"),
    JSON.stringify(ports.summarizeKnowledge(knowledgeRows?.knowledge || knowledgeRows))
  ];

  if (capturedActions.length) {
    prompt.push("");
    prompt.push(ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.buildPrompt.95"));
    prompt.push(JSON.stringify(capturedActions));
  }

  if (capturedNetwork.length) {
    prompt.push("");
    prompt.push(ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.buildPrompt.96"));
    prompt.push(JSON.stringify(capturedNetwork));
  }

  if (additionalContext) {
    prompt.push("");
    prompt.push(ports.aiInstructionBlock("ai.automation.keyword_generation", "aiAutomationBuilder.buildPrompt.97"));
    prompt.push(additionalContext);
  }

  return prompt.join("\n");
};


const normalizeStepCandidate = (candidate, stepsById, stepsByOrder, appTypeKind) => {
  if (!ports.isPlainObject(candidate)) {
    return null;
  }

  const stepId = ports.normalizeText(candidate.step_id || candidate.id);
  const suppliedOrder = candidate.step_order ?? candidate.order;
  const stepOrder = Number(suppliedOrder);
  const step = stepId ? stepsById.get(stepId) : stepsByOrder.get(stepOrder);

  if (!step) {
    return null;
  }

  if (suppliedOrder !== undefined && stepOrder !== Number(step.step_order)) {
    throw new Error("Automation output changed a step position. Keep the supplied step IDs and sequence.");
  }
  const suppliedType = candidate.step_type ?? candidate.stepType;
  if (suppliedType !== undefined && !ports.normalizeTestStepType(suppliedType)) {
    throw new Error("Automation output contains an unsupported runtime. Use web, api, android or ios.");
  }
  const apiRequest = candidate.api_request ?? candidate.apiRequest;
  if (apiRequest && ports.normalizeTestStepType(suppliedType, ports.inferAutomationStepType(step, {appTypeKind})) === "api") {
    ports.validateGeneratedApiRequest(apiRequest, {stepOrder:step.step_order, existingRequest:step.api_request, expectedResult:step.expected_result, action:step.action});
  }

  return {
    step,
    step_type: ports.normalizeTestStepType(candidate.step_type || candidate.stepType, ports.inferAutomationStepType(step, {appTypeKind})),
    automation_code: ports.normalizeRichText(candidate.automation_code || candidate.automationCode || candidate.code),
    api_request: ports.normalizeApiRequest(candidate.api_request || candidate.apiRequest)
  };
};


const normalizeLlmBuild = (payload, steps, cacheRows, startUrl, grounding) => {
  const stepsById = new Map(steps.map((step) => [step.id, step]));
  const stepsByOrder = new Map(steps.map((step) => [Number(step.step_order || 0), step]));
  const candidates = Array.isArray(payload?.steps) ? payload.steps : [];
  const byStepId = new Map();

  candidates.forEach((candidate) => {
    const normalized = normalizeStepCandidate(candidate, stepsById, stepsByOrder, grounding?.automationCaseType || grounding?.appTypeKind);
    if (!normalized || byStepId.has(normalized.step.id)) throw new Error("Automation output contains an unknown or duplicate step. Retry generation.");
    const expectedType = grounding?.automationCaseType ? ports.automationStepType(normalized.step, grounding.automationCaseType) : ports.inferAutomationStepType(normalized.step, {appTypeKind:grounding?.appTypeKind});
    if (normalized.step_type !== expectedType) throw new Error("Automation output changed a step runtime. Keep web, API and native steps in their original runtime.");
    byStepId.set(normalized.step.id, normalized);
  });

  if (byStepId.size !== steps.length) throw new Error("Automation output is incomplete. Every manual step needs an executable mapping. Retry with more context.");
  const updates = steps.map((step) => {
    const candidate = byStepId.get(step.id);
    const stepType = candidate?.step_type || ports.normalizeTestStepType(step.step_type, "web");
    let automationCode = candidate?.automation_code;
    if (stepType !== "api") {
      try {automationCode=ports.normalizeGeneratedProgram(automationCode,{runtime:stepType});if(stepType==='web')ports.preserveGeneratedAssertions(step.automation_code,automationCode,{parameters:grounding?.parameters,resolveParameter:grounding?.resolveAssertionParameter});}
      catch(error){throw Object.assign(new Error(`Step ${step.step_order}: ${error.message}`),error.code==='AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'?{code:error.code}:{});}
      if(stepType==='web'&&grounding)ports.validateNavigationGrounding(automationCode,grounding.origins,{parameters:grounding.parameters,resolveText:grounding.resolveText});
      if (stepType === 'web' && ports.normalizeRichText(step.expected_result) && !require("../../lib/build/automationGeneratedProgram").hasExecutableAssertion(automationCode)) throw Object.assign(new Error(`Step ${step.step_order} needs an executable assertion for its authored expected result.`), { code: 'AUTOMATION_EXPECTED_RESULT_ASSERTION_REQUIRED' });
      const runtimeNames = stepType === "web" ? ["page", "expect", "web", "params", "capture", "playwrightPage"] : ["android", "ios", "mobile", "driver", "browser", "$", "params", "capture"];
      try { new (Object.getPrototypeOf(async function () {}).constructor)(...runtimeNames, automationCode); }
      catch { throw new Error(`Step ${step.step_order} contains invalid JavaScript. Retry generation.`); }
    }
    if (stepType === "api" && !candidate?.api_request?.url) throw new Error(`Step ${step.step_order} needs a complete API request.`);
    if (stepType === 'api' && grounding?.parameters) ports.assertApiParameterBindings(step, candidate.api_request, grounding.parameters);
    if (stepType === "api" && grounding?.apiOrigins) ports.validateApiRequestGrounding(candidate.api_request,grounding.apiOrigins,grounding.resolveText);

    return {
      step,
      step_type: stepType,
      automation_code: stepType === "api" ? null : automationCode,
      api_request: stepType === "api" ? candidate.api_request : null
    };
  }).filter((update) => update.automation_code || update.api_request);

  const learnedLocators = (Array.isArray(payload?.learned_locators) ? payload.learned_locators : [])
    .map((item) => ({
      page_url: ports.normalizeText(item?.page_url || item?.pageUrl),
      page_key: ports.normalizeText(item?.page_key || item?.pageKey) || ports.normalizeUrlKey(item?.page_url || startUrl),
      locator_intent: ports.normalizeText(item?.intent || item?.locator_intent || item?.name),
      locator: ports.normalizeText(item?.locator),
      locator_kind: ports.normalizeText(item?.kind || item?.locator_kind),
      confidence: Math.max(0, Math.min(1, ports.clampNumber(item?.confidence, 0.5))),
      metadata: ports.normalizeObject(item?.metadata)
    }))
    .filter((item) => item.page_key && item.locator_intent && item.locator)
    .filter(item=>!startUrl||!grounding||ports.scopeRepositoryToTarget([item],startUrl).length>0);

  return {
    summary: ports.normalizeRichText(payload?.summary) || "Automation generated for the manual test case.",
    base_url: ports.normalizeText(payload?.base_url || payload?.baseUrl),
    updates,
    learned_locators: learnedLocators
  };
};


function projectUpstreamSteps(steps, caseType, resolver) {
  return resolver.projectSteps(steps).map((projected, index) => {
    const step=steps[index], stepType=ports.automationStepType(step,caseType);
    return {
      ...projected, step_type:stepType,
      parameter_references:resolver.referencedParameterNames([{action:step.action,expected_result:step.expected_result}]),
      action:resolver.projectPrivateText(step.action,{preserveReferences:true}),
      expected_result:resolver.projectPrivateText(step.expected_result,{preserveReferences:true}),
      ...(stepType==='api'?{parameter_bindings:ports.apiParameterBindingContext(step,resolver.promptValues)}:{})
    };
  });
}

function browserModelCompletion({ integration, featureKey, resolver, assertAccess, signal, trace }) {
  return async ({ prompt, phase, step, nativeTools, referenceImages, timeoutMs, beforeDispatch }) => {
    await assertAccess();
    const input = resolver.redactUpstream(prompt);
    const actor = phase === 'upstream_browser_actor';
    const repair = phase === 'verification_repair';
    const content = referenceImages?.length
      ? require('@hellotest/platform/backend/src/utils/aiReferenceImages').imageUserContent(input, referenceImages)
      : undefined;
    return require('@hellotest/platform/backend/src/utils/llmTraceContext').run({
      ...trace, generation_scope: phase, generation_section_ids: step?.id ? [step.id] : [],
      automation_case_generation: true, automation_browser_loop: true, mcp_context_depth: 1
    }, () => ports.requestChatCompletion({
      integration, featureKey, prompt: input, content, signal,
      upstreamPhase: phase, browserActor: actor, browserReview: !actor,
      nativeTools: actor ? nativeTools : undefined,
      ...(Number.isFinite(timeoutMs) ? { timeoutMs: Math.max(1, timeoutMs) } : {}),
      ...(repair ? { timeoutMs: Math.max(1, Math.min(30_000, timeoutMs || 30_000)), maxAttempts: 1 } : {}),
      beforeDispatch: beforeDispatch || assertAccess
    }));
  };
}

async function generateWebProgram({ steps, automationCaseType, resolver, engine, promptContext, nativeContext, complete, brief, ...session }) {
  let projectedSteps, projectedBrief;
  try {
    projectedSteps = projectUpstreamSteps(steps, automationCaseType, resolver);
    projectedBrief = resolver.projectPrivateText(ports.normalizeRichText(brief), { preserveReferences: true });
  } catch (error) {
    await session.browser.close().catch(() => {});
    throw error;
  }
  return require('../../lib/upstream/automationUpstreamEngineer').buildWithUpstreamPlaywright({
    ...session,
    steps: projectedSteps,
    brief: projectedBrief,
    context: { ...promptContext, assertion_timeout_ms: engine.config?.assertion_timeout_ms, navigation_timeout_ms: engine.config?.navigation_timeout_ms },
    parameterBindings: resolver.upstreamBindings(), redact: resolver.redactUpstream, complete,
    validate: require('.././automationReadiness.service').inspectExecutablePlan,
    apiPrompt: step => buildPrompt({ ...nativeContext.prompt, steps: [step] }),
    normalizeApiBuild: (payload, required, captureBindings = []) => normalizeLlmBuild(payload, required, [], session.startUrl, {
      ...nativeContext.grounding,
      parameters: { ...nativeContext.grounding.parameters, ...Object.fromEntries(captureBindings.map(name => [name, ''])) }
    })
  });
}

function generateContractProgram({ featureKey, featureProfile, grounding, repositoryRows = [], validateMetadata, ...options }) {
  return ports.completeAutomationBuild({
    ...options,
    feedbackInstruction: ports.aiInstructionBlock(featureKey, 'automationBuild.completionFeedback'),
    validate: (payload, required) => normalizeLlmBuild(payload, required, repositoryRows, options.startUrl, grounding),
    validateOutcome: async payload => {
      validateMetadata?.(payload);
      await require('@hellotest/platform/backend/src/utils/aiFeatureRuntime').validateValue(payload, featureProfile);
    },
    parse: value => typeof value === 'string' ? ports.extractJsonPayload(value) : value
  });
}

function previewInstructions(steps) {
  return steps.map(step => ({
    step_id: step.id, step_order: step.step_order, action: step.action, expected_result: step.expected_result,
    runtime: step.step_type, ...(step.automation_instructions ? { automation_instructions: step.automation_instructions } : {})
  }));
}

function previewDraft(draft, steps, automationCaseType, resolver) {
  const { steps: authoredSteps, parameter_values: authoredValues, ...metadata } = draft;
  const normalizedValues = require('@hellotest/platform/backend/src/utils/stepParameterResolution').normalizeParameterLayer(authoredValues, 't');
  // An authored empty value is part of the test, including for a protected
  // credential field. Dataset cells and stored credentials stay external.
  const authoredBlanks = Object.fromEntries(resolver.emptyParameterNames.filter(name => normalizedValues[name] === '').map(name => [name, '']));
  const projectedMetadata = JSON.parse(resolver.projectPrivateText(JSON.stringify(metadata), { preserveReferences: true }));
  return {
    ...projectedMetadata, automation_case_type: automationCaseType,
    test_data_options: { ...ports.parseJsonValue(projectedMetadata.test_data_options, {}), automation_case_type: automationCaseType },
    parameter_values: { ...resolver.publicParameterValues, ...authoredBlanks }, automated: 'yes', status: 'draft', automation_status: 'incomplete', steps
  };
}

function authoredApiTargets(steps, resolver) {
  return steps.filter(step => step.step_type === 'api').flatMap(step => {
    const url = ports.normalizeApiRequest(step.api_request)?.url;
    return [step.action, url].filter(Boolean).map(value => resolver.projectText(value));
  });
}

const artifactProgressPhases = new Set([
  'automation.agent.section.started', 'automation.agent.section.completed', 'automation.agent.browser.startup_retry',
  'automation.agent.validation.blocked', 'automation.agent.verification'
]);

/** Develop an unsaved complete case using the same native completion, browser
 * inspection and portable source contracts as the Automation Engineer. No
 * partial section is published; the caller receives one validated whole case. */
async function previewAutomationDraft({ draft, runtime_parameter_values = {}, test_environment_id, test_data_set_id, expected_test_data_set_revision, project_id, app_type_id, app_type_kind = 'web', user_id, integration_id, additional_context, supporting_evidence, inspect_browser = false, allow_browser_actions = false, browser_driver, verification_mode, verification_driver, retry_browser_startup = false, presentation = 'detailed', signal, onProgress: report = async () => {} } = {}) {
  const detailed = presentation !== 'artifact';
  const onProgress = detailed ? report : async event => {
    if (artifactProgressPhases.has(event.phase)) await report(event);
  };
  if (!project_id || !app_type_id || !user_id || !draft || typeof draft !== 'object') throw Object.assign(new Error('Supply the project, application, actor and Test Case draft for automation preview.'), {statusCode:400});
  if (typeof inspect_browser !== 'boolean' || typeof allow_browser_actions !== 'boolean' || allow_browser_actions && !inspect_browser) throw Object.assign(new Error('Performing the authored browser steps requires an explicit browser build mode.'), {statusCode:400,code:'AUTOMATION_BUILD_OPTIONS_INVALID',effect_dispatched:false});
  const selectedDataSetId = test_data_set_id || (Array.isArray(draft.test_data_set_ids) && draft.test_data_set_ids.length === 1 ? draft.test_data_set_ids[0] : null);
  if (selectedDataSetId != null && (typeof selectedDataSetId !== 'string' || !/^[\w-]{1,255}$/.test(selectedDataSetId))) throw Object.assign(new Error('Choose a valid Test Data Set for automation preview.'),{statusCode:422});
  const options=require("../../lib/build/automationBuildPipelineOptions").normalizeBuildPipelineOptions({browser_driver,verification_mode,verification_driver,allow_browser_actions});
  const wantsVerification=options.verification_mode!=='generate_only';
  if(wantsVerification&&(!test_environment_id||!inspect_browser))throw Object.assign(
    new Error('Verifying a draft requires a selected Test Environment and interactive browser development.'),
    {code:'AUTOMATION_BUILD_OPTIONS_INVALID',statusCode:422});
  const previewPermissions=['automation.ai','automation.build', ...(test_environment_id ? ['environment.view'] : []), ...(selectedDataSetId ? ['data.view'] : []), ...(wantsVerification ? ['automation.run.local','run.create'] : [])];
  const access = await ports.getOptionalEvidenceAccess({id:user_id}, project_id, previewPermissions);
  if (!access['automation.ai'] || !access['automation.build']) throw Object.assign(new Error('Automation preview requires AI and build access.'), {statusCode:403});
  if (test_environment_id && !access['environment.view']) throw Object.assign(new Error('Viewing the selected Test Environment is required for Automation preview.'), {statusCode:403});
  if (selectedDataSetId && !access['data.view']) throw Object.assign(new Error('Viewing the selected Test Data Set is required for Automation preview.'), {statusCode:403});
  if (wantsVerification && (!access['automation.run.local'] || !access['run.create'])) throw Object.assign(new Error('Isolated verification requires local automation execution and run creation permissions.'), {code:'AUTOMATION_VERIFICATION_ACCESS_REQUIRED',statusCode:403});
  const application = await ports.db.prepare('SELECT id,type FROM app_types WHERE id=? AND project_id=?').get(app_type_id,project_id);
  if (!application) throw Object.assign(new Error('The selected application is unavailable in this project.'),{statusCode:404});
  app_type_kind = application.type || app_type_kind;
  const environment = await require("../../lib/build/automationBuildEnvironment").requireBuildEnvironment(test_environment_id, ports.testEnvironmentService.getTestEnvironment);
  if (environment && (environment.project_id !== project_id || environment.app_type_id && environment.app_type_id !== app_type_id)) throw Object.assign(new Error('The selected Test Environment must belong to this project and application.'), {statusCode:403});
  const source = Array.isArray(draft.steps) ? draft.steps : [];
  if (!source.length || source.length > 200) throw Object.assign(new Error('Automation preview needs between 1 and 200 authored Test Case steps.'),{statusCode:422});
  const platform = ports.resolveAutomationDraftSteps(draft, source, { appTypeKind:app_type_kind });
  const automationCaseType = platform.automation_case_type;
  const steps = platform.steps;
  const hasWeb=steps.some(step=>step.step_type==='web');
  if (inspect_browser && hasWeb && steps.some(step=>!['web','api'].includes(step.step_type))) throw Object.assign(
    new Error('Build browser and API sections together. Build native device sections separately using supplied selector evidence.'),
    {code:'AUTOMATION_UPSTREAM_RUNTIME_UNSUPPORTED',statusCode:422});
  if(wantsVerification&&steps.some(step=>step.step_type!=='web'))throw Object.assign(
    new Error('Isolated verification supports complete web plans. Use a configured Test Run for API or native device sections.'),
    {code:'AUTOMATION_VERIFICATION_UNSUPPORTED',statusCode:422});
  const startUrl=ports.normalizeAutomationStartUrl(environment?.base_url || draft.automation_start_url,{required:ports.requiresAutomationStartUrl({appTypeKind:automationCaseType,steps})});
  const executionContext={test_environment_id:environment?.id || test_environment_id || null,...(selectedDataSetId?{test_data_set_id:selectedDataSetId}:{})};
  if (new Set(steps.map(step=>step.id)).size !== steps.length) throw Object.assign(new Error('Draft step identifiers must be unique.'),{statusCode:422});
  const featureKey = 'ai.agentic.automation-engineer';
  const featureProfile=await require('@hellotest/platform/backend/services/aiConfiguration.service').resolve(featureKey);
  const integration = await ports.resolveLlmIntegration(integration_id,{userId:user_id,projectId:project_id,usageKey:featureKey});
  if (!integration) throw Object.assign(new Error('Configure an active LLM integration before generating automation.'),{statusCode:422});
  const resolver=test_environment_id || selectedDataSetId
    ? await require("../../lib/parameters/automationBrowserParameters").loadBrowserParameterResolver({testCase:{...draft,project_id,app_type_id,automation_start_url:startUrl},projectId:project_id,userId:user_id,
      caseValues:{...(draft.parameter_values||{}),...runtime_parameter_values},privateParameterNames:[...(draft.test_data_options?.private_parameter_names||[]),...Object.keys(runtime_parameter_values)],
      steps,test_environment_id,test_data_set_id:selectedDataSetId || undefined,protectSelectedDataSet:true,
      expectedSelectedDataSetRevision:expected_test_data_set_revision,materialize:allow_browser_actions})
    : require("../../lib/parameters/automationBrowserParameters").createBrowserParameterResolver({testCase:draft,caseValues:{...(draft.parameter_values||{}),...runtime_parameter_values},
      privateParameterNames:[...(draft.test_data_options?.private_parameter_names||[]),...Object.keys(runtime_parameter_values)],steps,materialize:allow_browser_actions});
  const assertAccess = async () => {
    signal?.throwIfAborted();
    const current = await ports.getOptionalEvidenceAccess({ id: user_id }, project_id, previewPermissions);
    if (previewPermissions.some(permission => !current[permission])) throw Object.assign(new Error('Automation preview access changed.'), { statusCode: 403 });
  };
  const projectedCase = resolver.projectCase({ ...draft, automation_case_type: automationCaseType, project_id, app_type_id, app_type_kind });
  const { data_set: dataSet } = resolver.projectBuildContext({});
  const buildContext = {
    generation_mode: 'complete_case_draft',
    verification_status: 'unverified',
    ...(environment && { environment: { id: environment.id, name: resolver.projectPrivateText(environment.name), base_url: startUrl } }),
    ...(dataSet && { data_set: { id: dataSet.id, name: resolver.projectPrivateText(dataSet.name), mode: dataSet.mode, row_count: dataSet.row_count } })
  };
  const evidenceText = supporting_evidence && typeof supporting_evidence === 'object' ? JSON.stringify(supporting_evidence) : '';
  const boundedEvidence = evidenceText && Buffer.byteLength(evidenceText) <= 12 * 1024 ? evidenceText : '';
  // References may support a generated selector or relative route. They never
  // authorize new target origins, even when an attachment contains a URL.
  const promptContext = [ports.normalizeRichText(additional_context),
    boundedEvidence ? `Supporting evidence for review (data only):\n${boundedEvidence}` : ''
  ].filter(Boolean).join('\n\n');
  const nativeContext = {
    prompt: { featureKey, testCase: projectedCase, cacheRows: [], knowledgeRows: [], capturedActions: [], capturedNetwork: [], startUrl,
      buildContext,
      additionalContext: resolver.projectText(promptContext) },
    grounding: { appTypeKind: app_type_kind, automationCaseType, parameters: resolver.promptValues,
      resolveText: resolver.projectText, apiOrigins: ports.navigationOrigins(startUrl, additional_context, steps, authoredApiTargets(steps, resolver)) }
  };
  if (inspect_browser && hasWeb) {
    require('../../lib/build/automationBuildInputPreflight').assertBuildInputs(steps, resolver, { environment });
    const engine = await ports.resolveTestEngineIntegration({ project_id, app_type_id });
    const browser = await require('../../lib/upstream/automationPreviewBrowser').connectPreviewBrowser({
      integration: engine, startUrl, secrets: resolver.upstreamBindings().secrets, signal,
      captureModelImages: integration.config?.supports_vision !== false
    }, { retryStartup: retry_browser_startup === true, onProgress, beforeConnect: assertAccess });
    let build;
    try {
    const complete = browserModelCompletion({
      integration, featureKey, resolver, assertAccess, signal,
      trace: { project_id, app_type_id, actor_id: user_id, automation_case_type: automationCaseType, mcp_context: 'supplied_native_evidence' }
    });
    build = await generateWebProgram({
      steps, automationCaseType, resolver, engine, nativeContext, complete, startUrl, brief: additional_context,
      promptContext: { case: projectedCase, build_context: buildContext, ...(boundedEvidence ? { supporting_evidence: resolver.projectText(boundedEvidence) } : {}) },
      interactive: allow_browser_actions, browser, signal, assertAccess, onProgress
    });
    const validateBuild = async candidate => {
      await assertAccess();
      await require('@hellotest/platform/backend/src/utils/aiFeatureRuntime').validateValue({
        summary: candidate.summary,
        steps: candidate.updates.map(update => ({
          step_id: update.step.id, step_type: update.step_type, automation_code: update.automation_code, api_request: update.api_request
        }))
      }, featureProfile);
    };
    const nativeStepsFor = candidate => candidate.updates.map(update => ({
      ...update.step, step_type: update.step_type, automation_code: update.automation_code,
      automation_instructions: update.automation_instructions, api_request: update.api_request
    }));
    await validateBuild(build);
    const repair = options.verification_mode === 'verify_repair'
      ? require('../../lib/build/automationSavedBuildVerificationHooks').createBuildVerificationRepair({
        assertAccess, parameterResolver: resolver, featureKey, parseResponse: ports.extractJsonPayload,
        completeRepair: ({ prompt, timeoutMs, generationScope, sectionId, beforeDispatch }) =>
          complete({ prompt, phase: generationScope, step: { id: sectionId }, timeoutMs, beforeDispatch }),
        getBuild: () => build,
        commitBuild: async repaired => {
          await validateBuild(repaired);
          build = repaired;
        }
      })
      : undefined;
    const verification = wantsVerification
      ? await require('../../lib/verification/automationDraftVerification').verifyDraft({
        steps: nativeStepsFor(build), resolver, startUrl, engine, signal, assertAccess, onProgress, repair,
        liveValidation: build.browser_evidence?.live_validation, mode: options.verification_mode, executionDriver: options.verification_driver
      })
      : undefined;
    const nativeSteps = nativeStepsFor(build);
    const nativeDraft = previewDraft(draft, nativeSteps, automationCaseType, resolver);
    const executable = await ports.createArtifactContent({ testCase: nativeDraft, updates: build.updates, values: resolver.exportParameterValues, baseURL: startUrl });
    return {draft:nativeDraft,steps:nativeSteps,parameter_values:nativeDraft.parameter_values,automation_start_url:startUrl,test_environment_id:executionContext.test_environment_id,execution_context:executionContext,summary:build.summary,instructions:previewInstructions(nativeSteps),executable:{filename:'automation.spec.ts',language:'typescript',framework:'playwright',code:executable},verification_status:verification?.status==='passed'?'verified':'unverified',...(verification?{verification}:{}),live_validation:build.browser_evidence?.live_validation,...(Array.isArray(build.browser_evidence?.sections)?{browser_checks:build.browser_evidence.sections}:{}),validation:{status:'passed',checks:['upstream_playwright_source','source_parameter_binding','expected_result_assertions','source_preserving_instruction_mapping',...(nativeSteps.some(step=>step.step_type==='api')?['native_api_contract']:[])]},generation_mode:'llm',build_engine:'upstream-playwright-v1',warnings:build.warnings||[],...(detailed ? { browser_evidence: build.browser_evidence } : {}),side_effects:{cases_saved:0,target_requests:1,browser_actions:build.side_effects?.browser_actions||0},completion_attempts:1,integration:{id:integration.id,name:integration.name,model:integration.model},parameter_bindings:{private_parameter_references:resolver.privateParameterNames,required_external_parameters:resolver.referencedParameterNames(nativeSteps).filter(name=>resolver.privateParameterNames.includes(name)&&!Object.hasOwn(nativeDraft.parameter_values,name))}};
    }catch(error){
      if(Object.isExtensible(error)){
        if(build?.side_effects?.browser_actions>0)error.effect_dispatched=true;
        resolver.redactError(error);
      }
      throw error;
    }
  }
  const promptSteps=resolver.projectSteps(steps).map((step,index)=>({
    ...JSON.parse(resolver.projectPrivateText(JSON.stringify(step),{preserveReferences:true})),
    ...ports.automationExpectedResultTemplate(steps[index],resolver),
    ...(step.step_type==='api'?{parameter_bindings:ports.apiParameterBindingContext(steps[index],resolver.promptValues)}:{})
  }));
  try {
    const prompt = buildPrompt({ ...nativeContext.prompt, steps: promptSteps,
      buildContext: { ...nativeContext.prompt.buildContext, browser_policy: { transport: 'not_requested', interaction_mode: 'not_configured' } }
    });
    const complete = async (input, remainingMs = ports.LLM_TIMEOUT_MS) => {
      await assertAccess();
      return ports.requestChatCompletion({integration,featureKey,prompt:input,signal,timeoutMs:Math.min(ports.LLM_TIMEOUT_MS,remainingMs)});
    };
    const validateMetadata = payload => {
      if (typeof payload?.summary !== 'string' || !payload.summary.trim()) throw Object.assign(new Error('The complete automation response needs its own nonempty summary.'), {code:'AI_MANAGED_SCHEMA_INVALID'});
    };
    const build = await generateContractProgram({
      featureKey, featureProfile, startUrl,
      grounding: { ...nativeContext.grounding, origins: nativeContext.grounding.apiOrigins },
      steps, displaySteps: promptSteps, sequential: false, availableParameters: resolver.availableParameterNames,
      validateMetadata, onProgress,
      generate: ({ feedback, feedbackInstruction }) => complete([prompt, feedbackInstruction, JSON.stringify(feedback)].join('\n\n'))
    });
    await assertAccess();
    const nativeSteps=build.updates.map(update=>({...update.step,step_type:update.step_type,automation_code:update.automation_code,api_request:update.api_request}));
    if (resolver.projectPrivateText(JSON.stringify(nativeSteps),{preserveReferences:true}) !== JSON.stringify(nativeSteps)) throw Object.assign(new Error('Generated automation contains a private input literal. Regenerate it using its exact scoped parameter reference.'),{
      code:'AUTOMATION_PRIVATE_VALUE_IN_SOURCE',statusCode:422,publicMessage:'Generated automation contains a private input literal. Regenerate it using its exact scoped parameter reference.'});
    for(const [index,step] of nativeSteps.entries()){
      if(step.step_type==='web')Object.assign(step,await require("../../lib/upstream/automationUpstreamSectionSource").mapGeneratedSectionInstructions({
        step,source:step.automation_code,guard:assertAccess,signal,
        complete:({prompt,phase})=>ports.requestChatCompletion({integration,featureKey,prompt,signal,upstreamPhase:phase,browserReview:true,beforeDispatch:assertAccess}),
        onProgress,identity:stepId=>({step_id:stepId,active_step_id:stepId})
      }));
      await onProgress({phase:'automation.agent.section.completed',message:`Completed section ${step.step_order}.`,details:{step_id:step.id,active_step_id:step.id,step_order:step.step_order,completed_sections:index+1,total_sections:nativeSteps.length,runtime:step.step_type}});
    }
    const nativeDraft = previewDraft(draft, nativeSteps, automationCaseType, resolver);
    const hasMobile=nativeSteps.some(step=>['android','ios'].includes(step.step_type));
    const executable = hasMobile ? null : await ports.createArtifactContent({testCase:nativeDraft,updates:build.updates,values:nativeDraft.parameter_values,baseURL:startUrl||''});
    return {draft:nativeDraft,steps:nativeSteps,parameter_values:nativeDraft.parameter_values,
      parameter_bindings:{private_parameter_references:resolver.privateParameterNames,required_external_parameters:resolver.referencedParameterNames(nativeSteps).filter(name=>(resolver.privateParameterNames.includes(name)||/^[ts]\./.test(name))&&!Object.hasOwn(nativeDraft.parameter_values,name))},
      automation_start_url:startUrl || null,test_environment_id:executionContext.test_environment_id,execution_context:executionContext,summary:resolver.projectPrivateText(build.summary),
      instructions:previewInstructions(nativeSteps),
      executable:executable?{filename:'automation.spec.ts',language:'typescript',framework:'playwright',code:executable}:null,
      verification_status:'unverified',validation:{status:'passed',checks:['native_request_contract','step_runtime_and_order','expected_result_assertions','existing_assertions_preserved','whole_case_completion',...(nativeSteps.some(step=>step.step_type==='web')?['source_preserving_instruction_mapping']:[])]},generation_mode:'llm',integration:{id:integration.id,name:integration.name,model:integration.model},completion_attempts:build.completion_attempts,
      ...(detailed ? { browser_evidence: { transport: 'not_requested', interaction_mode: 'not_configured', observation_count: 0 } } : {}),
      side_effects:{cases_saved:0,target_requests:0,browser_actions:0}};
  } catch(error) {
    resolver.redactError(error);
    for (const key of ['publicMessage','blocked_steps','validation_feedback']) if (error[key] != null) error[key] = typeof error[key] === 'string'
      ? resolver.projectPrivateText(error[key]) : JSON.parse(resolver.projectPrivateText(JSON.stringify(error[key])));
    throw error;
  }
}

exports.previewAutomationDraft = async input => {
  try { return await previewAutomationDraft(input); }
  catch (error) {
    if (Object.isExtensible(error)) {
      error.effect_dispatched ??= false;
      error.outcome_unknown ??= false;
    }
    throw error;
  }
};


const buildCaseCore = async ({
  test_case_id,
  paired_browser_bridge_id,
  integration_id,
  ai_feature,
  created_by,
  start_url,
  start_url_review,
  allow_browser_actions = false,
  verification_mode = "generate_only",
  browser_driver,
  verification_driver = "native",
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  test_suite_id,
  parameter_values,
  parameter_plan_key,
  captured_actions = [],
  captured_network = [],
  additional_context,
  agent_context,
  execution_guard,
  transaction_id
}) => {
  const pipelineOptions=require("../../lib/build/automationBuildPipelineOptions").normalizeBuildPipelineOptions({verification_mode,browser_driver,verification_driver,allow_browser_actions,paired_browser_bridge_id});
  await execution_guard?.ensureOwnership();
  let testCase = await ports.selectCaseWithScope.get(test_case_id);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  const access = await ports.getOptionalEvidenceAccess({ id: created_by }, testCase.project_id, ["automation.ai", "automation.build", "automation.view"]);
  if (!access["automation.ai"] || !access["automation.build"]) throw Object.assign(new Error("Automation AI is disabled or your build permission is no longer available."), { statusCode: 403 });
  const pairedBrowserScope = paired_browser_bridge_id ? {bridgeId:paired_browser_bridge_id,projectId:testCase.project_id,appTypeId:testCase.app_type_id,
    userId:created_by,caseId:test_case_id,jobId:transaction_id} : null;
  if (pairedBrowserScope) await require(".././pairedBrowserBridge.service").authorize(pairedBrowserScope);

  if(pipelineOptions.verification_mode!=="generate_only"){
    const runAccess=await ports.getOptionalEvidenceAccess({id:created_by},testCase.project_id,["automation.run.local","run.create"]);
    if(!runAccess["automation.run.local"]||!runAccess["run.create"])throw Object.assign(new Error("Isolated verification requires local automation execution and run creation permissions."),{statusCode:403,code:"AUTOMATION_VERIFICATION_ACCESS_REQUIRED"});
  }
  const resourcePermissions=[...(test_environment_id?["environment.view"]:[]),...(test_configuration_id?["configuration.view"]:[]),...(test_data_set_id?["data.view"]:[]),...(test_suite_id?["suite.view"]:[])];
  const resourceAccess=await ports.getOptionalEvidenceAccess({id:created_by},testCase.project_id,resourcePermissions);
  if(resourcePermissions.some(key=>!resourceAccess[key]))throw Object.assign(new Error("Selected execution context access is no longer available."),{statusCode:403});
  const buildParameterValues=require("../../lib/build/automationBuildParameterPlan").buildParameterValues(parameter_values||{});
  const reviewedParameterState=await require(".././automationBuildParameterPlan.service").loadState({testCase,userId:created_by,test_environment_id,test_configuration_id,test_data_set_id,test_suite_id,parameter_values:buildParameterValues,expectedKey:parameter_plan_key});
  test_suite_id ??= reviewedParameterState.plan.test_suite_id;
  let steps = await ports.selectStepsForCase.all(test_case_id);
  const selectedPlatform = ports.resolveAutomationCaseSteps(testCase, steps, { appTypeKind: testCase.app_type_kind });
  const automationCaseType = selectedPlatform.automation_case_type;

  if (['android','ios'].includes(automationCaseType) || selectedPlatform.steps.some((step) => ["android", "ios"].includes(step.step_type))) {
    await ports.mobileFeatureService.assertMobileFeatureEnabled();
    const mobileAccess = await ports.getOptionalEvidenceAccess({ id: created_by }, testCase.project_id, ["mobile.manage"]);
    if (!mobileAccess["mobile.manage"]) throw Object.assign(new Error("Mobile management permission is required to build native automation."), { statusCode: 403 });
  }

  const browserBuild=ports.requiresAutomationStartUrl({appTypeKind:automationCaseType,steps:selectedPlatform.steps});
  if(browserBuild&&selectedPlatform.steps.some(step=>!['web','api'].includes(step.step_type)))throw Object.assign(
    new Error('Build browser and API sections together. Build native device sections separately using supplied selector evidence.'),
    {code:'AUTOMATION_UPSTREAM_RUNTIME_UNSUPPORTED',statusCode:422,nonRetryable:true});
  const selectedStartUrl=ports.normalizeAutomationStartUrl(start_url!=null?start_url:testCase.automation_start_url,{required:browserBuild});
  const preparedTarget = await ports.automationCasePreparationService.prepareAutomationTarget({ testCaseId: test_case_id, createdBy: created_by, aiGenerated: true, startUrl:selectedStartUrl });
  if (preparedTarget.test_case_id !== test_case_id) {
    test_case_id = preparedTarget.test_case_id;
    testCase = await ports.selectCaseWithScope.get(test_case_id);
    steps = await ports.selectStepsForCase.all(test_case_id);
    ports.resolveAutomationCaseSteps(testCase, steps, { appTypeKind: testCase.app_type_kind });
  }
  const preparedPlatform = ports.resolveAutomationCaseSteps(testCase, steps, { appTypeKind: testCase.app_type_kind });
  if (preparedPlatform.automation_case_type !== automationCaseType) throw Object.assign(new Error('The linked automation case uses a different platform than the reviewed source. Open the automation case, review its steps and build using its selected type.'), { code: 'AUTOMATION_CASE_TYPE_CHANGED', statusCode: 409, nonRetryable: true });
  const reviewedPlatformKey = ports.storedAutomationCaseType(testCase);
  const reviewedNavigation = await require("../../lib/build/automationBuildStartUrl").resolveBuildStartUrl({testCase,steps,startUrl:selectedStartUrl,userId:created_by,startUrlReview:start_url_review});
  testCase=await ports.selectCaseWithScope.get(test_case_id);
  if (ports.storedAutomationCaseType(testCase) !== reviewedPlatformKey) throw Object.assign(new Error('The automation case type changed before generation started. Review the current platform and start a new build.'), { code: 'AUTOMATION_CASE_TYPE_CHANGED', statusCode: 409, nonRetryable: true });
  if((testCase.automation_start_url||null)!==reviewedNavigation.savedStartUrl)throw Object.assign(new Error('Start URL changed before generation started. Submit a new build with the current target.'),{statusCode:409,code:'AUTOMATION_START_URL_CHANGED'});
  const needsFlowPlanning=!steps.length;
  if(needsFlowPlanning)require("../../lib/build/automationFlowPlanning").assertFlowPlanningFeature(ports.buildFeature(ai_feature));
  const flowBrief=ports.normalizeRichText(additional_context)||ports.normalizeRichText(testCase.description);
  if(needsFlowPlanning&&!flowBrief)throw Object.assign(new Error('Describe the intended flow and expected outcome in Agent brief before building an empty automation case.'),{code:'AUTOMATION_FLOW_BRIEF_REQUIRED',statusCode:422,nonRetryable:true});
  await require(".././automationBuildTargets.service").registerTarget(transaction_id,test_case_id);
  const progress=async event=>{await execution_guard?.ensureOwnership();return require(".././automationAgentActivity.service").recordProgress(transaction_id,{...event,details:{test_case_id,...event.details},metadata:{current_phase:event.phase,phase_message:event.message}});};
  const progressionPolicy=allow_browser_actions===true&&browserBuild?'performed_generated_saved':'generated_saved';
  await progress({phase:'automation.agent.plan',message:needsFlowPlanning?'Preparing a manual flow from the agent brief.':`Queued ${steps.length} saved sections for generation.`,details:{progression_policy:progressionPolicy,flow_source:needsFlowPlanning?'agent_brief':'saved_sections',steps:steps.map(step=>({step_id:step.id,step_order:step.step_order,step_type:step.step_type,action:step.action,expected_result:step.expected_result})),manual_steps:[]}});

  const contextSelection = ports.normalizeAgentContext(agent_context);
  const cacheRows = access['automation.view'] && contextSelection.context_scopes.includes('automation')
    ? ports.scopeRepositoryToTarget(await ports.listLearningCacheRows({projectId:testCase.project_id||null,appTypeId:testCase.app_type_id||null,limit:ports.MAX_CACHE_ROWS}),browserBuild?selectedStartUrl:null)
    : [];
  const featureProfile=await require("@hellotest/platform/backend/services/aiConfiguration.service").resolve(ports.buildFeature(ai_feature));
  const featureConfiguration=featureProfile.config;
  const contextPolicy=featureConfiguration.context;
  const knowledgeRows = await ports.retrieveAgentContext({testCase,userId:created_by,selection:contextSelection,prompt:additional_context,policy:contextPolicy,signal:execution_guard?.signal});
  if(!test_data_set_id && (await ports.getOptionalEvidenceAccess({id:created_by},testCase.project_id,["data.view"]))["data.view"]) {
    test_data_set_id=(await ports.db.prepare("SELECT test_data_set_id FROM test_case_data_sets WHERE test_case_id = ? ORDER BY sort_order, test_data_set_id LIMIT 1").get(test_case_id))?.test_data_set_id;
  }
  const capturedActions = ports.normalizeCapturedActions(captured_actions);
  const capturedNetwork = ports.normalizeCapturedNetwork(captured_network);
  const buildContext = await ports.resolveBuildContext({
    testCase,
    test_environment_id,
    test_configuration_id,
    test_data_set_id
  });
  buildContext.linked_manual_cases = await ports.loadAutomationManualContext({caseId:test_case_id,projectId:testCase.project_id,userId:created_by});
  const { requireGroundedManualCoverage } = require('../../lib/build/automationBuildCompletion');
  let manualLineage = browserBuild && steps.length ? requireGroundedManualCoverage(steps, buildContext.linked_manual_cases) : undefined;
  const manualLinkIds=(await ports.db.prepare('SELECT manual_test_case_id FROM automation_case_links WHERE automation_test_case_id = ? ORDER BY manual_test_case_id').all(test_case_id)).map(row=>row.manual_test_case_id);
  buildContext.story_context = contextPolicy.mode !== "none" && contextSelection.context_scopes.includes("stories") ? await ports.loadAutomationStoryContext({ caseId: test_case_id, projectId: testCase.project_id, userId: created_by }) : {stories:[],related_stories:[]};
  buildContext.retrieval = {transport:knowledgeRows.context_transport,scopes:contextSelection.context_scopes,limitations:knowledgeRows.limitations,coverage:knowledgeRows.coverage,reviewed_context:knowledgeRows.reviewed_context,supplemental_limitations:knowledgeRows.supplemental_limitations};
  buildContext.case_metadata = {id:testCase.id,title:testCase.title,description:testCase.description,automation_case_type:automationCaseType,allowed_step_types:selectedPlatform.allowed_step_types,authoring_mode:testCase.authoring_mode,gherkin_document:testCase.gherkin_document,preconditions:testCase.preconditions,priority:testCase.priority,labels:ports.safeJson(testCase.labels,[])};
  let navigation = ports.resolveAutomationStartUrl({startUrl:selectedStartUrl,caseUrl:testCase.automation_start_url,environmentUrl:buildContext.environment?.base_url,steps,required:browserBuild});
  let startUrl = navigation.url;
  buildContext.browser_policy={transport:browserBuild?'playwright_mcp':'not_requested',interaction_mode:browserBuild&&startUrl?(allow_browser_actions===true?'interactive':'read_only'):'not_configured',entry_url:startUrl,entry_origin:startUrl?new URL(startUrl).origin:null,target_source:navigation.source,entry_url_is_authoritative:browserBuild,verification_status:'unverified'};
  let integration = null;
  let build = null;

  await ports.appendEvent(transaction_id, {
    phase: "automation.context",
    message: `Packed ${steps.length} manual step${steps.length === 1 ? "" : "s"} with ${cacheRows.length} cached locator learning item${cacheRows.length === 1 ? "" : "s"} and ${Array.isArray(knowledgeRows?.knowledge) ? knowledgeRows.knowledge.length : 0} active knowledge item${Array.isArray(knowledgeRows?.knowledge) && knowledgeRows.knowledge.length === 1 ? "" : "s"}.`,
    details: {
      test_case_id,
      step_count: steps.length,
      cache_hits: cacheRows.length,
      knowledge_items: Array.isArray(knowledgeRows?.knowledge) ? knowledgeRows.knowledge.length : 0,
      captured_actions: capturedActions.length,
      captured_network: capturedNetwork.length,
      test_environment_id: buildContext.environment?.id || null,
      test_configuration_id: buildContext.configuration?.id || null,
      test_data_set_id: buildContext.data_set?.id || null,
      browser_entry_source:navigation.source,browser_entry_step_id:navigation.step_id||null,
      browser_interaction_mode:buildContext.browser_policy.interaction_mode
    }
  });

  try {
    integration = await ports.resolveLlmIntegration(integration_id, {
      userId: created_by,
      projectId: testCase.project_id,
      usageKey: ports.buildFeature(ai_feature)
    });
  } catch (error) {
    throw error;
  }

  if (!integration) throw new Error("No active LLM integration is configured. Select a model and retry the automation build.");
  const parameterContext=await ports.loadAutomationParameterContext({testCase,projectId:testCase.project_id,userId:created_by});
  const browserParameters=await require("../../lib/parameters/automationBrowserParameters").loadBrowserParameterResolver({testCase,projectId:testCase.project_id,userId:created_by,caseValues:parameterContext.runtime_parameter_values,privateParameterNames:parameterContext.private_parameter_names,parameterOverrides:parameterContext.parameter_overrides,steps:[...steps,...buildContext.linked_manual_cases.flatMap(item=>item.steps)],test_environment_id,test_configuration_id,test_data_set_id,test_suite_id,buildParameterValues,defaultMissingInputs:true});
  if(reviewedParameterState&&reviewedParameterState.inputSourceKey!==browserParameters.inputSourceKey)throw Object.assign(new Error('Reviewed build parameters changed before generation started. Review the current inputs before rebuilding.'),{statusCode:409,code:'AUTOMATION_PARAMETER_PLAN_CHANGED',nonRetryable:true,failure_stage:'context',automation_stage:'context',generation_provider_requests:0,browser_actions:0});
  if(reviewedParameterState){
    const plans=require("../../lib/build/automationBuildParameterPlan");
    if(reviewedParameterState.plan.resolved_test_case_id===testCase.id){
      const reviewedCase=reviewedParameterState.dataAccess?testCase:{id:testCase.id,app_type_id:testCase.app_type_id,project_id:testCase.project_id};
      plans.assertParameterPlanKey(reviewedParameterState.plan.parameter_plan_key,plans.parameterPlanKey({testCase:reviewedCase,steps,manualCases:buildContext.linked_manual_cases,parameterSourceKey:parameterContext.source_key,inputSourceKey:browserParameters.inputSourceKey}));
    }else{
      const linkedSource=buildContext.linked_manual_cases.find(item=>item.id===reviewedParameterState.plan.resolved_test_case_id);
      const goals=source=>JSON.stringify(source.map(({id,step_order,action,expected_result,step_type})=>({id,step_order,action,expected_result,step_type})));
      if(!linkedSource||goals(linkedSource.steps)!==goals(reviewedParameterState.sourceSteps))throw Object.assign(new Error('The reviewed manual steps changed before their automation target was prepared. Review the current inputs before rebuilding.'),{statusCode:409,code:'AUTOMATION_PARAMETER_PLAN_CHANGED',nonRetryable:true,failure_stage:'context',generation_provider_requests:0,browser_actions:0});
    }
  }
  let dataSnapshot=await require("../../lib/build/automationBuildDataSnapshot").prepareBuildDataSnapshot({testCase,projectId:testCase.project_id,userId:created_by,generatedValues:browserParameters.generatedCaseValues,authoredValues:browserParameters.reviewedCaseValues,authoredTemplates:buildParameterValues,defaultedValues:browserParameters.defaultedCaseValues,parameterOverrides:parameterContext.parameter_overrides,privateNames:browserParameters.privateParameterNames});
  const inputContext={selection:{test_environment_id,test_configuration_id,test_data_set_id,test_suite_id},source_key:browserParameters.inputSourceKey};
  const progressiveState={steps:structuredClone(steps),parameter_context_key:parameterContext.source_key,input_context:inputContext,data_snapshot:dataSnapshot};
  const buildIdentity={manual_context:buildContext.linked_manual_cases,manual_link_ids:manualLinkIds,parameter_context_key:parameterContext.source_key,input_context:inputContext,data_snapshot:dataSnapshot,project_id:testCase.project_id,app_type_id:testCase.app_type_id,case_start_url:reviewedNavigation.savedStartUrl,case_platform_key:ports.storedAutomationCaseType(testCase)};
  const promptCase=browserParameters.projectCase(testCase);
  const projectBuildSteps=source=>browserParameters.projectSteps(source).map((step,index)=>{const type=ports.automationStepType(step,automationCaseType);return {...step,step_type:type,...ports.automationExpectedResultTemplate(source[index],browserParameters),...(type==='api'?{parameter_bindings:ports.apiParameterBindingContext(source[index],browserParameters.promptValues)}:{})};});
  let promptSteps=projectBuildSteps(steps);
  navigation=ports.resolveAutomationStartUrl({startUrl:selectedStartUrl,caseUrl:testCase.automation_start_url,environmentUrl:browserParameters.projectText(buildContext.environment?.base_url),steps:promptSteps,required:browserBuild});
  startUrl=navigation.url;
  buildContext.browser_policy={...buildContext.browser_policy,interaction_mode:browserBuild&&startUrl?(allow_browser_actions===true?'interactive':'read_only'):'not_configured',entry_url:startUrl,entry_origin:startUrl?new URL(startUrl).origin:null};
  const promptBuildContext=browserParameters.projectBuildContext(buildContext);
  for(const manualCase of promptBuildContext.linked_manual_cases){
    const sourceCase=buildContext.linked_manual_cases.find(item=>item.id===manualCase.id);
    for(const step of manualCase.steps){
      const sourceStep=sourceCase?.steps.find(item=>item.id===step.id);
      Object.assign(step,ports.automationExpectedResultTemplate(sourceStep,browserParameters));
    }
  }
  if(transaction_id)try{
    const artifact=await require(".././automationAgentActivity.service").createBuildData(transaction_id,browserParameters.buildData({testCaseId:test_case_id,steps,manualCases:buildContext.linked_manual_cases}));
    await progress({phase:'automation.agent.data',message:'Prepared the linked case data for this build.',details:artifact});
  }catch(error){
    if([401,403].includes(error.statusCode)||error.name==='AbortError'||['BATCH_LEASE_LOST','BATCH_JOB_LEASE_LOST'].includes(error.code))throw error;
    await ports.appendEvent(transaction_id,{phase:'automation.agent.data.unavailable',level:'warning',message:'The optional resolved-data display could not be stored. Generation continues with the same configured data.'}).catch(()=>{});
  }
  if(browserBuild){
    const configuredBudget = Number(process.env.AUTOMATION_BUILDER_CASE_TIMEOUT_MS);
    const deadlineMs = Date.now() + (configuredBudget > 0 ? Math.max(240_000, Math.min(1_800_000, configuredBudget)) : 1_800_000);
    const assertAccess=async()=>{await execution_guard?.ensureOwnership();const permissions=[...new Set(['automation.ai','automation.build',...resourcePermissions,...(cacheRows.length?['automation.view']:[]),...(buildContext.linked_manual_cases.length?['testcase.view']:[]),...(buildContext.story_context.stories.length?['requirement.view']:[]),...browserParameters.required_permissions,...(browserParameters.availableParameterNames.length?['data.view']:[])])];const access=await ports.getOptionalEvidenceAccess({id:created_by},testCase.project_id,permissions);if(permissions.some(key=>!access[key]))throw Object.assign(new Error('Automation build or data access changed. Existing edits were retained.'),{statusCode:403});};
    const assertInputs = () => require('../../lib/build/automationBuildInputPreflight').assertBuildInputs(
      steps.map(step => ({ ...step, step_type: ports.automationStepType(step, automationCaseType) })), browserParameters, buildContext);
    if (steps.length) assertInputs();
    await assertAccess();
    const engine=await ports.resolveBuildBrowserIntegration(testCase,pairedBrowserScope);
    let pendingBrowserPreview;
    const browser=await require("../../lib/upstream/automationPreviewBrowser").connectPreviewBrowser({integration:engine,startUrl,buildId:transaction_id,secrets:browserParameters.upstreamBindings().secrets,signal:execution_guard?.signal,captureModelImages:integration.config?.supports_vision!==false,
      capturePreview:Boolean(transaction_id),onPreview:transaction_id?async preview=>{pendingBrowserPreview=preview;}:undefined},
      {retryStartup:true,onProgress:progress,beforeConnect:assertAccess});
    let initialNavigation;
    try{
    if(!steps.length){
      const planning=require("../../lib/build/automationFlowPlanning");
      const applicationEvidence=await planning.observeUpstreamEntry({browser,startUrl,redact:browserParameters.redactUpstream,assertAccess,signal:execution_guard?.signal,onNavigation:result=>{initialNavigation=result;}});
      const proposed=await planning.planAutomationFlow({featureKey:ports.buildFeature(ai_feature),allowedTypes:['web'],deadlineMs,context:{user_request:browserParameters.projectPrivateText(flowBrief,{preserveReferences:true}),case:promptCase,build_context:promptBuildContext,application_evidence:applicationEvidence},complete:async (input, timeoutMs)=>{await assertAccess();return ports.requestChatCompletion({integration,featureKey:ports.buildFeature(ai_feature),prompt:input,signal:execution_guard?.signal,timeoutMs:Math.min(ports.LLM_TIMEOUT_MS,timeoutMs),browserReview:true,beforeDispatch:assertAccess});},parse:ports.extractJsonPayload,onProgress:progress,signal:execution_guard?.signal,requiredParameterNames:browserParameters.referencedParameterNames([{action:flowBrief,expected_result:''}]),referencedParameterNames:browserParameters.referencedParameterNames});
      requireGroundedManualCoverage(proposed.map((step, index) => ({ ...step, id: `planned-${index + 1}` })), buildContext.linked_manual_cases, { beforeDispatch: false });
      steps=await require(".././automationFlowPlan.service").saveFlowPlan({testCase,steps:proposed,userId:created_by,executionGuard:execution_guard,assertSources:async()=>{const currentManual=await ports.loadAutomationManualContext({caseId:test_case_id,projectId:testCase.project_id,userId:created_by,lock:true});const currentParameters=await ports.loadAutomationParameterContext({testCase,projectId:testCase.project_id,userId:created_by,lock:true});if(ports.manualContextKey(currentManual)!==ports.manualContextKey(buildContext.linked_manual_cases)||currentParameters.source_key!==parameterContext.source_key)throw Object.assign(new Error('The manual context changed during flow planning.'),{statusCode:409,code:'AUTOMATION_FLOW_BASELINE_CHANGED'});}});
      browserParameters.registerStepReferences(steps);
      assertInputs();
      dataSnapshot=await require("../../lib/build/automationBuildDataSnapshot").prepareBuildDataSnapshot({testCase,projectId:testCase.project_id,userId:created_by,generatedValues:browserParameters.generatedCaseValues,authoredValues:browserParameters.reviewedCaseValues,authoredTemplates:buildParameterValues,defaultedValues:browserParameters.defaultedCaseValues,parameterOverrides:parameterContext.parameter_overrides,privateNames:browserParameters.privateParameterNames});
      Object.assign(progressiveState,{steps:structuredClone(steps),data_snapshot:dataSnapshot});buildIdentity.data_snapshot=dataSnapshot;
      await progress({phase:'automation.agent.flow.planned',message:`Prepared ${steps.length} authored sections for upstream Playwright MCP.`,details:{steps:steps.map(step=>({step_id:step.id,step_order:step.step_order,action:step.action,expected_result:step.expected_result,step_type:step.step_type})),verification_status:'unverified'}});
    }
    manualLineage ??= requireGroundedManualCoverage(steps, buildContext.linked_manual_cases, { beforeDispatch: false });
    await progress({phase:'automation.agent.plan',message:`Queued ${steps.length} sections with grounded linked manual-step coverage.`,details:{generation_mode:'sequential',progression_policy:progressionPolicy,steps:steps.map(step=>({step_id:step.id,step_order:step.step_order,step_type:step.step_type,action:step.action,expected_result:step.expected_result})),manual_steps:manualLineage.manualSteps.map(step=>({manual_step_id:step.id,manual_test_case_id:step.test_case_id,step_order:step.step_order,action:step.action,expected_result:step.expected_result})),manual_coverage:manualLineage.manualCoverage,unmapped_manual_step_ids:manualLineage.unmappedManualStepIds,verification_status:'unverified'}});
    const featureKey = ports.buildFeature(ai_feature);
    const complete = browserModelCompletion({
      integration, featureKey, resolver: browserParameters, assertAccess, signal: execution_guard?.signal,
      trace: { project_id: testCase.project_id, actor_id: created_by, session_id: transaction_id, test_case_id,
        automation_case_type: automationCaseType,
        mcp_context: knowledgeRows.knowledge.length ? 'retrieved' : knowledgeRows.context_transport === 'not_required' ? 'not_required' : 'unavailable',
        on_llm_trace: transaction_id ? record => ports.appendEvent(transaction_id,
          require('@hellotest/platform/backend/src/utils/agentModelTrace').modelTraceEvent(record, { name: 'Automation Build Agent', caseId: test_case_id })) : undefined
      }
    });
    let result;
    try {
      result = await generateWebProgram({
        steps: manualLineage.steps, automationCaseType, resolver: browserParameters, engine, startUrl, brief: additional_context,
        promptContext: { case: promptCase, build_context: promptBuildContext, repository: ports.summarizeCache(cacheRows),
          knowledge: ports.summarizeKnowledge(knowledgeRows.knowledge), case_title: browserParameters.projectPrivateText(testCase.title) },
        nativeContext: {
          prompt: { featureKey, testCase: promptCase, cacheRows: [], knowledgeRows, capturedActions: [], capturedNetwork,
            buildContext: promptBuildContext, startUrl, additionalContext: browserParameters.projectText(ports.normalizeRichText(additional_context)) },
          grounding: { appTypeKind: testCase.app_type_kind, automationCaseType, parameters: browserParameters.promptValues,
            resolveText: browserParameters.projectText,
            apiOrigins: ports.navigationOrigins(startUrl, additional_context, steps, authoredApiTargets(promptSteps, browserParameters), capturedNetwork, knowledgeRows.knowledge, promptBuildContext) }
        },
        interactive: allow_browser_actions === true, browser, initialNavigation, complete, assertAccess, onProgress: progress, signal: execution_guard?.signal, deadlineMs,
        onObservation:async observation=>{
          await assertAccess();
          if(!transaction_id)return null;
          const preview=pendingBrowserPreview;pendingBrowserPreview=undefined;
          if(preview?.tool===observation.tool)observation={...observation,url:preview.url,observed_at:preview.observed_at,result:{...observation.result,content:[...(observation.result?.content||[]),...preview.content]}};
          try{
            const evidence=await require(".././automationAgentActivity.service").createBrowserEvidence(transaction_id,{observation,testCaseId:test_case_id,attempt:1,active_step_id:observation.active_step_id,active_manual_step_ids:observation.active_manual_step_ids||[],interactionMode:allow_browser_actions===true?'interactive':'read_only',transport:'upstream_playwright_mcp'});
            if(evidence)await progress({phase:'automation.agent.observation',message:'Captured application evidence from upstream Playwright MCP. Execution remains unverified.',details:evidence});
            return evidence;
          }catch(error){
            const diagnostics=require("../../lib/build/automationProgressDiagnostics");
            if(diagnostics.isCriticalAutomationError(error))throw error;
            diagnostics.reportDiagnosticFailure({activityId:transaction_id,operation:'upstream_browser_evidence',error});
            await ports.appendEvent(transaction_id,{phase:'automation.agent.observation.unavailable',level:'warning',message:'The latest optional application observation could not be retained. Native browser work continues without replay.'}).catch(()=>{});
            return null;
          }
        },
        onSection:async(update,evidence)=>{
        const original=steps.find(step=>step.id===update.step.id);update.step=original;
        const activeManualStepIds=manualLineage.manualCoverage.filter(row=>row.section_step_id===original.id).map(row=>row.manual_step_id);
        let preview;
        try {
          preview=await require(".././automationAgentActivity.service").createSectionPreview(transaction_id,{testCaseId:test_case_id,step:original,update,attempt:1,evidence,modelCallScope:'section_attempt',manualCoverage:manualLineage.manualCoverage,manualSpecification:manualLineage.manualSpecification,generationProvenance:{source_origin:'model_generated',compiler:'normalized_runtime_v1',review_status:'not_performed'}});
        } catch (error) {
          const diagnostics = require('../../lib/build/automationProgressDiagnostics');
          if (diagnostics.isCriticalAutomationError(error) || execution_guard?.signal?.aborted) throw execution_guard?.signal?.reason || error;
          diagnostics.reportDiagnosticFailure({ activityId:transaction_id, operation:'upstream_section_preview', error });
        }
        await ports.applyBuild({build:{updates:[update],...buildIdentity},executionGuard:execution_guard,createdBy:created_by,progressiveState,partial:true});
        await progress({phase:'automation.agent.section.saved',message:update.step_type==='api'?`Saved API section ${original.step_order} from its configured contract.`:`Saved section ${original.step_order} from upstream Playwright MCP.`,details:{...preview,...(!preview?{preview_status:'unavailable'}:{}),step_id:original.id,step_ids:[original.id],active_step_id:original.id,active_manual_step_ids:activeManualStepIds,instruction_status:'saved',development_status:'completed',saved_at:new Date().toISOString(),verification_status:'unverified',browser_driver:'playwright_mcp_upstream',runtime:update.step_type}});
      }});
      let stepUpdates=await ports.applyBuild({build:{...result,...buildIdentity},executionGuard:execution_guard,createdBy:created_by,progressiveState});
      const verificationHooks=require("../../lib/build/automationSavedBuildVerificationHooks").createSavedBuildVerificationHooks({
        assertBuildAccess:assertAccess,getVerificationAccess:permissions=>ports.getOptionalEvidenceAccess({id:created_by},testCase.project_id,permissions),
        parameterResolver:browserParameters,featureKey:ports.buildFeature(ai_feature),signal:execution_guard?.signal,parseResponse:ports.extractJsonPayload,
        completeRepair:({prompt,timeoutMs,generationScope,sectionId,beforeDispatch})=>complete({prompt,phase:generationScope,step:{id:sectionId},timeoutMs,beforeDispatch}),
        getBuild:()=>result,commitBuild:async repaired=>{stepUpdates=await ports.applyBuild({build:{...repaired,...buildIdentity},executionGuard:execution_guard,createdBy:created_by,progressiveState});result=repaired;return progressiveState;}
      });
      const verification=await require(".././automationSavedBuildVerification.service").verifySavedBuild({options:pipelineOptions,liveValidation:result.browser_evidence?.live_validation,testCase,startUrl,state:progressiveState,activityId:transaction_id,parameterResolver:browserParameters,manualLinkIds,manualContext:buildIdentity.manual_context,signal:execution_guard?.signal},{...verificationHooks,readCase:id=>ports.selectCaseWithScope.get(id),readSteps:id=>ports.selectStepsForCase.all(id),readManualLinkIds:async id=>(await ports.db.prepare('SELECT manual_test_case_id FROM automation_case_links WHERE automation_test_case_id=? ORDER BY manual_test_case_id').all(id)).map(row=>row.manual_test_case_id),readManualContext:id=>ports.loadAutomationManualContext({caseId:id,projectId:testCase.project_id,userId:created_by}),manualContextKey: ports.manualContextKey,readParameters:currentCase=>ports.loadAutomationParameterContext({testCase:currentCase,projectId:testCase.project_id,userId:created_by}),readInputs:(currentCase,params,selection)=>require("../../lib/parameters/automationBrowserParameters").loadBrowserParameterResolver({testCase:currentCase,projectId:testCase.project_id,userId:created_by,caseValues:params.runtime_parameter_values,privateParameterNames:params.private_parameter_names,parameterOverrides:params.parameter_overrides,...selection,materialize:false}),prepareRun:async()=>request=>require("../../lib/verification/automationVerificationClient").verifyRecordedAutomation({integration:engine,request,signal:execution_guard?.signal}),onProgress:summary=>progress({phase:'automation.agent.verification',message:summary.message,details:{verification:summary}})});
      let artifact;const warnings=[...(result.warnings||[])];
      if(transaction_id)try{artifact=await ports.workspaceTransactionService.createTransactionArtifact(transaction_id,{file_name:`${testCase.display_id||testCase.id}-automation.spec.ts`,mime_type:'text/typescript; charset=utf-8',content:await ports.createArtifactContent({testCase,updates:result.updates,values:browserParameters.exportParameterValues,sensitiveNames:browserParameters.privateParameterNames,baseURL:startUrl})});}catch(error){if(execution_guard?.signal?.aborted||[401,403].includes(error.statusCode))throw error;warnings.push('Instructions were saved. The optional downloadable source artifact could not be stored.');}
      return {test_case_id,source_test_case_id:preparedTarget.source_test_case_id,title:testCase.title,automated:'yes',automation_status:'ready',generated_step_count:stepUpdates.length,completion_attempts:1,verification_status:verification.status==='passed'?'verified':'unverified',verification,warnings,learned_locator_count:0,cache_hits:0,fallback_used:false,integration:{id:integration.id,name:integration.name,model:integration.model},summary:result.summary,artifact_id:artifact?.id||null,step_updates:stepUpdates,manual_coverage:manualLineage.manualCoverage,build_engine:'upstream-playwright-v1',browser_evidence:result.browser_evidence,live_validation:result.browser_evidence?.live_validation};
    }catch(error){
      await require("../../lib/browser/automationBrowserDiagnosticArtifact").retainBrowserDiagnostic({
        error, transactionId:transaction_id, assertAccess,
        createArtifact:(id,input)=>ports.workspaceTransactionService.createTransactionArtifact(id,input), appendEvent: ports.appendEvent
      });
      browserParameters.redactError(error);error.automation_test_case_id=test_case_id;error.source_test_case_id=preparedTarget.source_test_case_id;error.active_manual_step_ids=manualLineage.manualCoverage.filter(row=>row.section_step_id===error.active_step_id).map(row=>row.manual_step_id);throw error;}
    }finally{pendingBrowserPreview=undefined;await browser.close();}
  }
  // Web sections have already returned through the upstream MCP generator.
  // The remaining path generates API/native contracts without a browser host.
  let prompt = buildPrompt({ featureKey:ports.buildFeature(ai_feature), testCase:promptCase, steps:promptSteps, cacheRows, knowledgeRows, capturedActions, capturedNetwork, buildContext:promptBuildContext, startUrl, additionalContext:browserParameters.projectText(ports.normalizeRichText(additional_context)) });
  const savedSectionIds=new Set();
  let generationRequested=false,completionAttempt=1,completionActiveStepId=null,completionActiveManualStepIds=[],completionSectionAttempt=null,completionSectionIds=[];
  const generationModelCalls=new Map();
  let planningFlow=needsFlowPlanning;
  const caseBudgetMs=Math.max(240_000,Math.min(1_800_000,Number(process.env.AUTOMATION_BUILDER_CASE_TIMEOUT_MS)||Math.max(240_000,steps.length*120_000)));
  const buildStartedAt=Date.now();
  let completionDeadline=buildStartedAt+caseBudgetMs;
  const annotateBuildFailure=error=>{
    Object.assign(error,{automation_test_case_id:test_case_id,source_test_case_id:preparedTarget.source_test_case_id,saved_step_ids:[...savedSectionIds],saved_sections:savedSectionIds.size});
    if(completionActiveStepId){error.active_step_id=completionActiveStepId;error.active_manual_step_ids=completionActiveManualStepIds;}
    return error;
  };
  const assertBuildContextAccess=async()=>{
    await execution_guard?.ensureOwnership();
    const permissions=[...new Set(['automation.ai','automation.build',...resourcePermissions,...(cacheRows.length?['automation.view']:[]),...(buildContext.linked_manual_cases.length?['testcase.view']:[]),...(buildContext.story_context.stories.length?['requirement.view']:[]),...browserParameters.required_permissions,...(browserParameters.availableParameterNames.length?['data.view']:[])])];
    const access=await ports.getOptionalEvidenceAccess({id:created_by},testCase.project_id,permissions);
    if(permissions.some(permission=>!access[permission]))throw Object.assign(new Error('Automation build or test context access changed. Existing instructions were retained.'),{statusCode:403});
  };
  const completeBuild=async(input,remainingMs=ports.LLM_TIMEOUT_MS,traceOptions={})=>{
    await assertBuildContextAccess();
    const specialist=ports.runtimeSpecialist(promptSteps.find(step=>step.id===completionActiveStepId)?.step_type);
    const instructions=ports.runtimeSpecialistInstructions(specialist?[specialist.id]:planningFlow?selectedPlatform.allowed_step_types:promptSteps.map(step=>step.step_type));
    const attempt=completionAttempt;
    if(!planningFlow&&!generationModelCalls.has(attempt))generationModelCalls.set(attempt,[]);
    return require('@hellotest/platform/backend/src/utils/llmTraceContext').run({
      project_id:testCase.project_id,actor_id:created_by,session_id:transaction_id,completion_attempt:attempt,test_case_id,
      generation_scope:traceOptions.generationScope||(planningFlow?'flow_plan':completionActiveStepId?'section_attempt':'case_attempt'),
      generation_section_ids:completionSectionIds,section_attempt:completionSectionAttempt,
      on_llm_trace:transaction_id?record=>{
        if(!planningFlow&&record.status==='succeeded'&&record.dispatched&&typeof record.call_id==='string')generationModelCalls.set(attempt,[...new Set([...(generationModelCalls.get(attempt)||[]),record.call_id])]);
        return ports.appendEvent(transaction_id,require('@hellotest/platform/backend/src/utils/agentModelTrace').modelTraceEvent(record,{name:specialist?.name||'Automation engineer',caseId:test_case_id}));
      }:undefined,
      automation_case_generation:true,automation_specialist:specialist?.id||null,automation_case_type:automationCaseType,automation_actor_phase:false,automation_browser_loop:false,
      mcp_context_depth:1,mcp_context:knowledgeRows.knowledge.length?'retrieved':knowledgeRows.context_transport==='not_required'?'not_required':'unavailable'
    },()=>{
      generationRequested=true;
      return ports.requestChatCompletion({integration,featureKey:ports.buildFeature(ai_feature),prompt:[instructions,input].filter(Boolean).join('\n\n'),signal:execution_guard?.signal,timeoutMs:Math.min(ports.LLM_TIMEOUT_MS,remainingMs),maxAttempts:traceOptions.generationScope==='verification_repair'?1:undefined,beforeDispatch:traceOptions.beforeDispatch||assertBuildContextAccess,
        onJsonRetry:details=>progress({phase:'automation.agent.model.json.retry',message:'The model provider rejected its JSON output. Retaining completed sections while correcting that response.',details:{...details,active_step_id:completionActiveStepId}}),
        onCapacityWait:details=>progress({phase:'automation.agent.model.capacity.wait',message:'The model provider requested a short wait. Retaining completed sections before retrying that model request.',details:{...details,active_step_id:completionActiveStepId}})});
    });
  };
  try {
    await ports.appendEvent(transaction_id,{phase:'automation.agent.context',message:'Generating API or native automation from the supplied case and repository context.'});
    if(needsFlowPlanning){
      const flowPlanning=require("../../lib/build/automationFlowPlanning"),planningCase={...promptCase};
      for(const field of ['title','description','gherkin_document','preconditions'])if(typeof testCase[field]==='string')planningCase[field]=flowPlanning.projectFlowPlanningBrief(testCase[field],browserParameters);
      const draftFlow=await flowPlanning.planAutomationFlow({featureKey:ports.buildFeature(ai_feature),allowedTypes:selectedPlatform.allowed_step_types,complete:completeBuild,parse:ports.extractJsonPayload,deadlineMs:completionDeadline,signal:execution_guard?.signal,onProgress:progress,
        requiredParameterNames:browserParameters.referencedParameterNames([{action:flowBrief,expected_result:''}]),referencedParameterNames:browserParameters.referencedParameterNames,
        context:{user_request:flowPlanning.projectFlowPlanningBrief(flowBrief,browserParameters),case:planningCase,build_context:promptBuildContext,repository:ports.summarizeCache(cacheRows),knowledge:ports.summarizeKnowledge(knowledgeRows.knowledge)}});
      try{steps=await require(".././automationFlowPlan.service").saveFlowPlan({testCase,steps:draftFlow,userId:created_by,executionGuard:execution_guard,assertSources:async()=>{
        const currentManual=await ports.loadAutomationManualContext({caseId:test_case_id,projectId:testCase.project_id,userId:created_by,lock:true});
        const currentParameters=await ports.loadAutomationParameterContext({testCase,projectId:testCase.project_id,userId:created_by,lock:true});
        if(ports.manualContextKey(currentManual)!==ports.manualContextKey(buildContext.linked_manual_cases)||currentParameters.source_key!==parameterContext.source_key)throw Object.assign(new Error('Linked case context or test parameters changed while the manual flow was being planned.'),{code:'AUTOMATION_FLOW_BASELINE_CHANGED',statusCode:409,nonRetryable:true});
      }});}catch(error){error.automation_stage='save';throw error;}
      browserParameters.registerStepReferences(steps);
      promptSteps=projectBuildSteps(steps);
      dataSnapshot=await require("../../lib/build/automationBuildDataSnapshot").prepareBuildDataSnapshot({testCase,projectId:testCase.project_id,userId:created_by,generatedValues:browserParameters.generatedCaseValues,authoredValues:browserParameters.reviewedCaseValues,authoredTemplates:buildParameterValues,defaultedValues:browserParameters.defaultedCaseValues,parameterOverrides:parameterContext.parameter_overrides,privateNames:browserParameters.privateParameterNames});
      Object.assign(progressiveState,{steps:structuredClone(steps),data_snapshot:dataSnapshot});buildIdentity.data_snapshot=dataSnapshot;
      prompt=buildPrompt({featureKey:ports.buildFeature(ai_feature),testCase:promptCase,steps:promptSteps,cacheRows,knowledgeRows,capturedActions,capturedNetwork,buildContext:promptBuildContext,startUrl,additionalContext:browserParameters.projectText(ports.normalizeRichText(additional_context))});
      if(!process.env.AUTOMATION_BUILDER_CASE_TIMEOUT_MS)completionDeadline=buildStartedAt+Math.min(1_800_000,Math.max(caseBudgetMs,steps.length*120_000));
      planningFlow=false;
      if(transaction_id)try{const artifact=await require(".././automationAgentActivity.service").createBuildData(transaction_id,browserParameters.buildData({testCaseId:test_case_id,steps,manualCases:buildContext.linked_manual_cases}));await progress({phase:'automation.agent.data',message:'Prepared the fixed test data for the planned sections.',details:artifact});}
      catch(error){if([401,403].includes(error.statusCode)||error.name==='AbortError'||['BATCH_LEASE_LOST','BATCH_JOB_LEASE_LOST'].includes(error.code))throw error;await ports.appendEvent(transaction_id,{phase:'automation.agent.data.unavailable',level:'warning',message:'The optional planned-data display could not be stored. Generation continues with the same fixed values.'}).catch(()=>{});}
      await progress({phase:'automation.agent.flow.planned',message:`Prepared ${steps.length} draft native actions.`,details:{flow_source:'agent_brief',total_sections:steps.length,verification_status:'unverified'}});
    }
    build=await generateContractProgram({
      featureKey: ports.buildFeature(ai_feature), featureProfile, startUrl, repositoryRows: cacheRows,
      steps, manualSteps: buildContext.linked_manual_cases.flatMap(item=>item.steps.map(step=>({...step,test_case_id:item.id}))),
      displaySteps: promptSteps,
      displayManualSteps: promptBuildContext.linked_manual_cases.flatMap(item=>item.steps.map(step=>({...step,test_case_id:item.id}))),
      sequential: steps.some(step=>ports.automationStepType(step,automationCaseType)==='api') || buildContext.linked_manual_cases.length>0,
      progressionPolicy, availableParameters: browserParameters.availableParameterNames,
      grounding: { appTypeKind: testCase.app_type_kind, automationCaseType,
        apiOrigins: ports.navigationOrigins(startUrl, additional_context, steps, authoredApiTargets(promptSteps, browserParameters), capturedNetwork, knowledgeRows.knowledge, promptBuildContext),
        origins: ports.buildNavigationOrigins({startUrl, additionalContext: additional_context}),
        parameters: browserParameters.promptValues, resolveText: browserParameters.projectText,
        resolveAssertionParameter: key=>browserParameters.resolve('browser_assert',{value:require("../../lib/parameters/automationBrowserParameters").parameterReference(key)}).value
      },
      onProgress:async event=>{await execution_guard?.ensureOwnership();return progress(event);},
      onSaveSection:async({step,normalized,attempt})=>{
        try{
          await assertBuildContextAccess();
          await ports.applyBuild({build:{...normalized,...buildIdentity},executionGuard:execution_guard,createdBy:created_by,progressiveState,partial:true});
          savedSectionIds.add(step.id);
          const receipt={instruction_status:'saved',development_status:'completed',saved_at:new Date().toISOString()};
          try{await progress({phase:'automation.agent.section.saved',message:`Saved section ${step.step_order} instructions to Plan.`,details:{...receipt,attempt,step_id:step.id,step_ids:[step.id],verification_status:'unverified'}});}
          catch(error){if([401,403].includes(error.statusCode)||error.name==='AbortError'||['BATCH_LEASE_LOST','BATCH_JOB_LEASE_LOST'].includes(error.code))throw error;}
          return receipt;
        }catch(error){error.automation_stage='save';throw error;}
      },
      onValidatedSection:async({step,normalized,attempt,manualCoverage})=>{
        await execution_guard?.ensureOwnership();
        return require(".././automationAgentActivity.service").createSectionPreview(transaction_id,{testCaseId:test_case_id,step,update:normalized.updates.find(item=>item.step.id===step.id),attempt,manualCoverage,repositoryRows:cacheRows,modelCallIds:generationModelCalls.get(attempt)||[],modelCallScope:completionActiveStepId?'section_attempt':'case_attempt',generationProvenance:{source_origin:'model_generated',compiler:'normalized_runtime_v1',review_status:'not_performed'},manualSpecification:buildContext.linked_manual_cases.flatMap(item=>item.steps.map(source=>({...source,manual_test_case_id:item.id,manual_step_id:source.id})))});
      },
      generate:async({attempt,sectionAttempt,activeStepId,activeManualStepIds=[],completionOnly=false,feedback,feedbackInstruction})=>{
        completionAttempt=attempt;completionActiveStepId=activeStepId||null;completionActiveManualStepIds=activeManualStepIds;completionSectionAttempt=sectionAttempt||null;completionSectionIds=(feedback.required_sections||[]).map(step=>step.step_id);
        if(Date.now()>=completionDeadline)throw Object.assign(new Error('Automation agent reached its completion deadline. Existing instructions were retained.'),{code:'AUTOMATION_BUILD_DEADLINE',statusCode:422});
        if(completionOnly||!(feedback.required_sections||[]).length){
          const metadataPrompt=[ports.aiInstructionBlock(ports.buildFeature(ai_feature),'automationBuild.metadataCompletion'),feedbackInstruction,JSON.stringify({phase:'metadata_completion',case:{id:promptCase.id,title:promptCase.title},feedback})].filter(Boolean).join('\n\n');
          return completeBuild(metadataPrompt,completionDeadline-Date.now(),{generationScope:'case_metadata'});
        }
        const requestedSectionIds=new Set((feedback.required_sections||[]).map(step=>step.step_id));
        const requestPrompt=feedback.generation_mode==='sequential'?buildPrompt({featureKey:ports.buildFeature(ai_feature),testCase:promptCase,steps:promptSteps.filter(step=>requestedSectionIds.has(step.id)),cacheRows,knowledgeRows,capturedActions,capturedNetwork,buildContext:{...promptBuildContext,generation_scope:{mode:'sequential',active_step_id:activeStepId,active_manual_step_ids:activeManualStepIds}},startUrl,additionalContext:browserParameters.projectText(ports.normalizeRichText(additional_context))}):prompt;
        return completeBuild([requestPrompt,feedbackInstruction,JSON.stringify(feedback)].filter(Boolean).join('\n\n'),completionDeadline-Date.now());
      }});
    Object.assign(build,buildIdentity);
    await ports.appendEvent(transaction_id,{phase:'automation.llm.completed',message:`Generated ${build.updates.length} complete step mappings. Run the case to verify behavior.`,details:{generated_steps:build.updates.length}});
  }catch(error){
    if(execution_guard?.signal.aborted)throw execution_guard.signal.reason;
    if(error.code==='AUTOMATION_PARAMETER_MISSING'&&completionActiveStepId){
      error.code='AUTOMATION_DEPENDENCY_MISSING';error.blocked_steps=[{step_id:completionActiveStepId,dependency_type:'parameter',reason:'A required automation input has no configured value.',required_context:[],required_parameters:error.parameter_reference?[error.parameter_reference]:[]}];
      await progress({level:'warning',phase:'automation.agent.dependencies',message:error.message,details:{blocked_steps:error.blocked_steps,saved_sections:savedSectionIds.size,saved_step_ids:[...savedSectionIds]}});
    }
    annotateBuildFailure(error);
    const failureProgress=require("../../lib/build/automationBuildFailureProgress").buildFailureProgress(error,{modelStarted:generationRequested||generationModelCalls.size>0});
    error.failure_stage=failureProgress.details.failure_stage;await progress(failureProgress);throw error;
  }

  let stepUpdates;
  try{await assertBuildContextAccess();stepUpdates=await ports.applyBuild({build,executionGuard:execution_guard,createdBy:created_by,progressiveState});}
  catch(error){if(execution_guard?.signal.aborted)throw execution_guard.signal.reason;error.automation_stage='save';error.failure_stage='save';annotateBuildFailure(error);await progress({phase:'automation.agent.save.failed',level:'error',message:'Final completion could not be saved. Previously saved sections remain in Plan; current edits were preserved.',details:{error_code:error.code||null,failure_stage:'save'}}).catch(()=>{});throw error;}
  const warnings=[];
  const verificationHooks = require("../../lib/build/automationSavedBuildVerificationHooks").createSavedBuildVerificationHooks({
    assertBuildAccess: assertBuildContextAccess,
    getVerificationAccess: permissions => ports.getOptionalEvidenceAccess({id: created_by}, testCase.project_id, permissions),
    parameterResolver: browserParameters, featureKey: ports.buildFeature(ai_feature), signal: execution_guard?.signal,
    parseResponse: ports.extractJsonPayload,
    completeRepair: ({prompt, timeoutMs, generationScope, beforeDispatch}) => completeBuild(prompt, timeoutMs, {generationScope, beforeDispatch}),
    getBuild: () => build,
    commitBuild: async repaired => {
      stepUpdates = await ports.applyBuild({build: repaired, executionGuard: execution_guard, createdBy: created_by, progressiveState});
      build = repaired;
      return progressiveState;
    }
  });
  const verification = await require(".././automationSavedBuildVerification.service").verifySavedBuild({
    options: pipelineOptions, testCase, startUrl, state: progressiveState, activityId: transaction_id,
    parameterResolver: browserParameters, manualLinkIds, manualContext: buildIdentity.manual_context,
    signal: execution_guard?.signal
  }, {
    ...verificationHooks,
    readCase: id => ports.selectCaseWithScope.get(id),
    readSteps: id => ports.selectStepsForCase.all(id),
    readManualLinkIds: async id => (await ports.db.prepare('SELECT manual_test_case_id FROM automation_case_links WHERE automation_test_case_id = ? ORDER BY manual_test_case_id').all(id)).map(row => row.manual_test_case_id),
    readManualContext: id => ports.loadAutomationManualContext({caseId: id, projectId: testCase.project_id, userId: created_by}),
    manualContextKey: ports.manualContextKey,
    readParameters: currentCase => ports.loadAutomationParameterContext({testCase: currentCase, projectId: testCase.project_id, userId: created_by}),
    readInputs: (currentCase, params, selection) => require("../../lib/parameters/automationBrowserParameters").loadBrowserParameterResolver({
      testCase: currentCase, projectId: testCase.project_id, userId: created_by,
      caseValues: params.runtime_parameter_values, privateParameterNames: params.private_parameter_names,
      parameterOverrides: params.parameter_overrides, ...selection, materialize: false
    }),
    prepareRun: async () => {
      const integration = await ports.resolveBuildBrowserIntegration(testCase,pairedBrowserScope);
      return request => require("../../lib/verification/automationVerificationClient").verifyRecordedAutomation({
        integration, request, signal: execution_guard?.signal
      });
    },
    onProgress: summary => progress({phase: 'automation.agent.verification', message: summary.message, details: {verification: summary}})
  });
  let learnedCount=0;
  try {learnedCount+=await ports.persistLearning({testCase,learnedLocators:build.learned_locators,capturedActions,capturedNetwork,transactionId:transaction_id,integrationId:integration_id});}
  catch {warnings.push("Instructions were saved, but locator learning could not be saved.");}
  let artifact = null;

  if (transaction_id) {
    try {artifact = await ports.workspaceTransactionService.createTransactionArtifact(transaction_id, {
      file_name: `${String(testCase.display_id || testCase.id).replace(/[^A-Za-z0-9_-]+/g, "-")}-automation.spec.ts`,
      mime_type: "text/typescript; charset=utf-8",
      content: await ports.createArtifactContent({testCase,updates:build.updates,repositoryRows:cacheRows,values:browserParameters.exportParameterValues,sensitiveNames:browserParameters.privateParameterNames,baseURL:startUrl})
    });}catch{warnings.push("Instructions were saved, but the downloadable source artifact could not be created. Source remains available in the case.");}
  }
  for(const message of warnings)await ports.appendEvent(transaction_id,{level:"warning",phase:"automation.agent.saved.warning",message,details:{test_case_id}}).catch(()=>{});

  await progress({
    level: stepUpdates.length ? "success" : "warning",
    phase: "automation.case.updated",
    message: stepUpdates.length
      ? `Associated generated automation with "${testCase.title}".`
      : `No step automation was associated with "${testCase.title}".`,
    details: {
      test_case_id,
      updated_steps: stepUpdates.length,
      step_ids:build.updates.map(update=>update.step.id),
      manual_coverage:build.manual_coverage,
      learned_locator_count: learnedCount,
      artifact_id: artifact?.id || null
    }
  }).catch(()=>{});

  return {
    test_case_id,
    source_test_case_id: preparedTarget.source_test_case_id,
    title: testCase.title,
    automated: stepUpdates.length ? "yes" : testCase.automated || "no",
    automation_status: stepUpdates.length ? "ready" : testCase.automation_status || "not_automated",
    generated_step_count: stepUpdates.length,
    completion_attempts: build.completion_attempts,
    verification_status: verification.status==='passed'?'verified':'unverified',
    verification,
    warnings,
    learned_locator_count: learnedCount,
    cache_hits: cacheRows.length,
    fallback_used: false,
    fallback_reason: null,
    integration: integration
      ? {
          id: integration.id,
          name: integration.name,
          model: integration.model
        }
      : null,
    summary: build.summary,
    artifact_id: artifact?.id || null,
    step_updates: stepUpdates
  };
};
return { buildPrompt, normalizeStepCandidate, normalizeLlmBuild, buildCaseCore };
}
module.exports = { createProgramGeneration };
