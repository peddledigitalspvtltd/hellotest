// recorderImport: cohesive builder implementation; dependencies are explicit lazy ports.
function createRecorderImport(ports) {
const exports = ports.exports;
const require = ports.require;


const selectStaleRecorderTransactions = ports.obsDb.prepare(`
  SELECT *
  FROM workspace_transactions
  WHERE action = 'test_case_recorder'
    AND status = 'running'
    AND started_at IS NOT NULL
    AND started_at < ?
  ORDER BY started_at ASC
  LIMIT ?
`);


const applyRecorderSteps = async ({ testCase, stepCandidates, recorderMappings = [], createdBy, targetStepId, expectedSteps }) => {
  const caseSteps = await ports.selectStepsForCase.all(testCase.id);
  if (!targetStepId) return require(".././webRecorderPersistence.service").persistWebRecorderPlan({
    caseId: testCase.id, candidates: ports.orderRecorderCandidates(stepCandidates), expectedSteps: expectedSteps || caseSteps
  }, {
    transaction: callback => ports.db.transaction(callback)(),
    lockCase: id => ports.db.prepare('SELECT id FROM test_cases WHERE id = ? FOR UPDATE').get(id),
    readSteps: id => ports.db.prepare('SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY step_order ASC, id ASC FOR UPDATE').all(id),
    updateStep: ports.testStepService.updateTestStep,
    createStep: ports.testStepService.createTestStep,
    deleteStep: id => ports.db.prepare('DELETE FROM test_steps WHERE id = ?').run(id),
    reorderStep: (id, order) => ports.db.prepare('UPDATE test_steps SET step_order = ? WHERE id = ?').run(order, id),
    updateCaseReadiness: async id => {
      const issues = await require("../../lib/recording/automationRecorderReadiness").recordedPlanIssues(await ports.selectStepsForCase.all(id));
      return issues.length ? ports.markTestCaseAutomationIncomplete.run(id) : ports.markTestCaseAutomationReady.run(ports.normalizeText(createdBy), id);
    }
  });
  return require(".././webRecorderPersistence.service").persistWebRecorderSection({
    caseId: testCase.id, targetStepId, candidates: ports.orderRecorderCandidates(stepCandidates),
    automationCode: ports.createRecorderAutomationCode(stepCandidates), expectedSteps: expectedSteps || caseSteps
  }, {
    transaction: callback => ports.db.transaction(callback)(),
    lockCase: id => ports.db.prepare('SELECT id FROM test_cases WHERE id = ? FOR UPDATE').get(id),
    readSteps: id => ports.db.prepare('SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY step_order ASC, id ASC FOR UPDATE').all(id),
    updateStep: ports.testStepService.updateTestStep
  });
};


async function preflightRecorderUploadBindings({ testCase, actions, steps, parameterBindings, createdBy, metadata, targetStepId }) {
  if (!actions.some(action => action.type === 'upload' && action.source === 'page-recorder')) return;
  const sourceSteps = targetStepId ? steps.filter(step => step.id === targetStepId) : steps;
  const context = await ports.loadAutomationParameterContext({ testCase, projectId: testCase.project_id, userId: createdBy });
  const resolver = await require("../../lib/parameters/automationBrowserParameters").loadBrowserParameterResolver({
    testCase, projectId: testCase.project_id, userId: createdBy, caseValues: context.runtime_parameter_values,
    privateParameterNames: context.private_parameter_names, parameterOverrides: context.parameter_overrides,
    steps: sourceSteps, materialize: false, allowUnselectedSuite: true, test_suite_id: metadata.test_suite_id || undefined,
    test_environment_id: metadata.test_environment_id || undefined, test_configuration_id: metadata.test_configuration_id || undefined,
    test_data_set_id: metadata.test_data_set_id || undefined
  });
  const repository = { locatorExpression: (await import("../../../shared/automationProgramCompatibility.mjs")).playwrightRepositoryLocatorExpression };
  const candidates = ports.buildRecorderStepCandidates(actions, repository);
  require("../../lib/recording/automationRecorderParameters").bindRecorderParameterCandidates({ actions, candidates, resolver, parameterBindings,
    mappings: ports.buildFallbackRecorderMappings(sourceSteps.filter(step => ports.inferAutomationStepType(step) === 'web'), candidates),
    rebuildCandidate: (action, order) => ports.buildRecorderStepCandidate(action, order, repository) });
}


const finalizeRecorderBuild = async ({
  testCase,
  session,
  createdBy,
  transactionId,
  capturedActions,
  capturedNetwork,
  integrationId,
  additionalContext,
  targetStepId,
  parameterSelection = {},
  parameterBindings = [],
  recordingImport,
  expectedPlanKey
}) => {
  capturedActions = require("../../lib/recording/automationRecorderReplayPlan").prepareRecorderReplayActions(capturedActions);
  const caseSteps = await ports.selectStepsForCase.all(testCase.id);
  if (expectedPlanKey && expectedPlanKey !== require("../../lib/recording/automationRecorderPlan").recorderPlanFingerprint(caseSteps)) {
    const saved = recordingImport && await require(".././recordingImport.service").load(recordingImport);
    if (saved) return saved;
    throw Object.assign(new Error('The case changed while preparing this recording. Existing instructions were retained.'), { code: 'AUTOMATION_RECORDER_CASE_CHANGED', statusCode: 409 });
  }
  const existingSteps = targetStepId ? caseSteps.filter((step) => step.id === targetStepId) : caseSteps;
  const parameterContext=await ports.loadAutomationParameterContext({testCase,projectId:testCase.project_id,userId:createdBy});
  const recorderParameters=await require("../../lib/parameters/automationBrowserParameters").loadBrowserParameterResolver({testCase,projectId:testCase.project_id,userId:createdBy,
    caseValues:parameterContext.runtime_parameter_values,privateParameterNames:parameterContext.private_parameter_names,parameterOverrides:parameterContext.parameter_overrides,
    steps:existingSteps,materialize:false,allowUnselectedSuite:true,...parameterSelection});
  const {bindRecorderParameterCandidates,recorderPromptProjector}=require("../../lib/recording/automationRecorderParameters");
  const projectPrompt=recorderPromptProjector({actions:capturedActions,resolver:recorderParameters});
  const repositoryModel = await ports.buildRecorderRepositoryModel({
    testCase,
    capturedActions,
    integrationId,
    userId: createdBy,
    transactionId,
    platform: "web",
    allowAiNaming: false,
    projectPrompt
  });
  repositoryModel.locatorExpression = (await import("../../../shared/automationProgramCompatibility.mjs")).playwrightRepositoryLocatorExpression;
  let stepCandidates = ports.buildRecorderStepCandidates(capturedActions, repositoryModel);
  let recorderMappings = [];
  let mappingSource = existingSteps.length ? "fallback" : "created";
  let aiMappingFallbackReason = null;

  await ports.appendEvent(transactionId, {
    phase: "recorder.steps.mapping",
    message: targetStepId
      ? `Preparing ${stepCandidates.length} recorded interaction${stepCandidates.length === 1 ? "" : "s"} for the selected section.`
      : `Preparing to replace the Web plan with ${stepCandidates.length} recorded interaction${stepCandidates.length === 1 ? "" : "s"}.`,
    details: {
      recorder_session_id: session.id,
      manual_step_count: existingSteps.length,
      captured_actions: capturedActions.length,
      captured_network: capturedNetwork.length,
      generated_step_candidates: stepCandidates.length,
      target_step_id: targetStepId || null
    }
  }).catch(() => null);

  // The destination is explicit: either the complete Web plan or one section.
  // Deterministic alignment retains unique existing symbolic bindings without
  // putting a model request in the recorder's critical save path.
  recorderMappings = ports.buildFallbackRecorderMappings(existingSteps.filter(step => ports.inferAutomationStepType(step) === 'web'), stepCandidates);
  mappingSource = targetStepId ? 'selected_section' : 'recorded';

  const bound=bindRecorderParameterCandidates({candidates:stepCandidates,mappings:recorderMappings,actions:capturedActions,resolver:recorderParameters,parameterBindings,
    rebuildCandidate:(action,order)=>ports.buildRecorderStepCandidate(action,order,repositoryModel)});
  stepCandidates=bound.candidates;recorderMappings=bound.mappings;
  // Recorder targets use the same strict native source contract as generated
  // programs before any saved step is replaced.
  for (const candidate of stepCandidates) candidate.automation_code = ports.normalizeGeneratedProgram(candidate.automation_code);
  const warnings=repositoryModel.repository_warning ? [repositoryModel.repository_warning] : [];
  let appliedSteps;
  const savePlan = async () => {
    appliedSteps = await applyRecorderSteps({ testCase, stepCandidates, recorderMappings, createdBy, targetStepId, expectedSteps: caseSteps });
    if (appliedSteps.length) {
      const readinessIssues = await require("../../lib/recording/automationRecorderReadiness").recordedPlanIssues(await ports.selectStepsForCase.all(testCase.id));
      if (targetStepId) {
        if (readinessIssues.length) await ports.markTestCaseAutomationIncomplete.run(testCase.id);
        else await ports.markTestCaseAutomationReady.run(ports.normalizeText(createdBy), testCase.id);
      }
      if (readinessIssues.length) warnings.push(`The recording was saved. Complete these instructions before running: ${readinessIssues.join(' ')}`);
    }
    return { test_case_id: testCase.id, source_test_case_id: recordingImport?.sourceTestCaseId || null,
      title: testCase.title, automated: appliedSteps.length ? 'yes' : testCase.automated || 'no',
      automation_status: appliedSteps.length ? (await ports.selectCaseWithScope.get(testCase.id))?.automation_status || 'incomplete' : testCase.automation_status || 'not_automated',
      generated_step_count: appliedSteps.length, created_step_count: appliedSteps.filter(step => step.operation === 'created').length,
      updated_step_count: appliedSteps.filter(step => step.operation === 'updated').length, learned_locator_count: 0, warnings: [...warnings],
      cache_hits: 0, fallback_used: false, fallback_reason: null, integration: null, api_test_case: null,
      recorder_session: { id: session.id, action_count: capturedActions.length, network_count: capturedNetwork.length },
      summary: appliedSteps.length ? targetStepId ? 'Recorded instructions replaced the selected section instructions.' : 'Recorded steps replaced the automation web plan.' : 'Recorder stopped cleanly, but no supported interactions were captured.',
      step_updates: appliedSteps.map(({ automation_code, ...step }) => step) };
  };
  const committed = recordingImport
    ? await require(".././recordingImport.service").commit(recordingImport, testCase.id, savePlan)
    : await savePlan();
  if (committed.idempotent_replay) return committed;
  let learnedCount=0;
  try { learnedCount = await ports.persistLearning({
    testCase,
    learnedLocators: [],
    capturedActions,
    capturedNetwork,
    transactionId,
    repositoryModel,
    integrationId
  }); } catch { warnings.push('The recording was saved, but repository learning could not be updated.'); }
  const apiCase = null;
  let artifact = null;

  if (transactionId && appliedSteps.length) {
    try { artifact = await ports.workspaceTransactionService.createTransactionArtifact(transactionId, {
      file_name: `${String(testCase.display_id || testCase.id).replace(/[^A-Za-z0-9_-]+/g, "-")}-recorder-keywords.spec.ts`,
      mime_type: "text/typescript; charset=utf-8",
      content: await ports.createArtifactContent({
        testCase,
        values:recorderParameters.exportParameterValues,
        sensitiveNames:recorderParameters.privateParameterNames,
        repositoryRows: await ports.listLearningCacheRows({projectId:testCase.project_id,appTypeId:testCase.app_type_id,limit:ports.MAX_CACHE_ROWS}),
        updates: appliedSteps.map((step) => ({
          step: {
            id: step.step_id,
            step_order: step.step_order,
            action: step.action
          },
          automation_code: step.automation_code,
          api_request: null
        }))
      })
    }); } catch { warnings.push('The recording was saved, but the downloadable source artifact could not be created. The saved plan remains available.'); }
  }

  await ports.appendEvent(transactionId, {
    level: appliedSteps.length ? "success" : "warning",
    phase: "recorder.completed",
    message: appliedSteps.length
      ? targetStepId
        ? `Recorder updated the selected section for "${testCase.title}".`
        : `Recorder saved ${appliedSteps.length} recorded web step${appliedSteps.length === 1 ? "" : "s"} for "${testCase.title}".`
      : `Recorder stopped for "${testCase.title}", but no supported interactions were available to create web keyword steps.`,
    details: {
      recorder_session_id: session.id,
      mapping_source: mappingSource,
      ai_mapping_fallback_reason: aiMappingFallbackReason,
      manual_step_count: existingSteps.length,
      updated_steps: appliedSteps.filter((step) => step.operation === "updated").length,
      created_steps: appliedSteps.filter((step) => step.operation === "created").length,
      learned_locator_count: learnedCount,
      api_test_case_id: null,
      api_step_count: 0,
      captured_api_evidence_count: capturedNetwork.length,
      artifact_id: artifact?.id || null
    }
  }).catch(()=>{warnings.push('The recording was saved, but its activity event could not be updated.');});

  await ports.updateTransaction(transactionId, {
    status: "completed",
    description: appliedSteps.length
      ? targetStepId
        ? 'Recorder replaced the selected section instructions.'
        : `Recorder replaced the web plan with ${appliedSteps.length} recorded step${appliedSteps.length === 1 ? "" : "s"}.`
      : "Recorder stopped without supported interactions to convert.",
    metadata: {
      current_phase: "recorder.completed",
      progress_percent: 100,
      processed_items: appliedSteps.length,
      generated_steps: appliedSteps.length,
      mapped_manual_steps: appliedSteps.filter((step) => step.operation === "updated").length,
      mapping_source: mappingSource,
      ai_mapping_fallback_reason: aiMappingFallbackReason,
      learned_locator_count: learnedCount,
      api_test_case_id: null,
      api_step_count: 0,
      captured_api_evidence_count: capturedNetwork.length,
      artifact_id: artifact?.id || null,
      warnings
    },
    completed_at: new Date().toISOString()
  }).catch(()=>{warnings.push('The recording was saved, but its activity status could not be updated.');});

  return {
    test_case_id: testCase.id,
    title: testCase.title,
    automated: appliedSteps.length ? "yes" : testCase.automated || "no",
    automation_status: appliedSteps.length ? (await ports.selectCaseWithScope.get(testCase.id))?.automation_status || "incomplete" : testCase.automation_status || "not_automated",
    generated_step_count: appliedSteps.length,
    created_step_count: appliedSteps.filter((step) => step.operation === "created").length,
    updated_step_count: appliedSteps.filter((step) => step.operation === "updated").length,
    learned_locator_count: learnedCount,
    warnings,
    api_test_case: apiCase,
    cache_hits: 0,
    fallback_used: Boolean(aiMappingFallbackReason),
    fallback_reason: aiMappingFallbackReason,
    integration: null,
    summary: appliedSteps.length
      ? targetStepId
        ? 'Recorded instructions replaced the selected section instructions.'
        : 'Recorded steps replaced the automation web plan.'
      : "Recorder stopped cleanly, but no supported interactions were captured.",
    artifact_id: artifact?.id || null,
    step_updates: appliedSteps.map(({ automation_code, operation, source_action_index, ...step }) => ({
      ...step,
      operation,
      source_action_index
    }))
  };
};


exports.cleanupOrphanRecorderSessions = async ({ limit = 25 } = {}) => {
  const cutoff = new Date(Date.now() - ports.RECORDER_ORPHAN_TTL_MS).toISOString();
  const transactions = await selectStaleRecorderTransactions.all(cutoff, Math.max(1, Math.min(100, Number(limit) || 25)));
  let stopped = 0;
  let checked = 0;

  for (const transaction of transactions) {
    const metadata = ports.parseTransactionMetadata(transaction);
    const sessionId = ports.normalizeText(metadata.recorder_session_id);
    const mobileRecorder = ports.normalizeText(metadata.recorder_target) === "mobile";
    const baseUrl = mobileRecorder
      ? ports.normalizeText(metadata.mobile_engine_base_url)
      : ports.normalizeText(metadata.engine_base_url);
    const readRecorderEngineJson = mobileRecorder ? ports.readMobileEngineJson : ports.readEngineJson;

    if (!sessionId || !baseUrl) {
      continue;
    }

    checked += 1;

    try {
      const sessionPath = mobileRecorder ? "/api/v1/mobile/recorder/sessions" : "/api/v1/recorder/sessions";
      const session = await readRecorderEngineJson(`${baseUrl}${sessionPath}/${encodeURIComponent(sessionId)}`);
      const shouldStop = session?.status === "running" && ports.isRecorderSessionPastOrphanTtl(session, transaction);

      if (!shouldStop && session?.status === "running") {
        continue;
      }

      if (shouldStop) {
        await readRecorderEngineJson(`${baseUrl}${sessionPath}/${encodeURIComponent(sessionId)}/stop`, {
          method: "POST"
        }).catch(() => null);
        stopped += 1;
      }

      const message = shouldStop
        ? "Recorder session was auto-stopped after more than 3 minutes without live-view or input activity."
        : "Recorder session was already stopped while HelloTest still had the process marked as running.";

      await ports.appendEvent(transaction.id, {
        level: "warning",
        phase: "recorder.orphan.cleaned",
        message,
        details: {
          recorder_session_id: sessionId,
          engine_base_url: baseUrl,
          last_activity_at: session?.last_activity_at || null,
          recorder_status: shouldStop ? "auto-stopped" : session?.status || "unknown",
          orphan_ttl_ms: ports.RECORDER_ORPHAN_TTL_MS
        }
      });
      await ports.updateTransaction(transaction.id, {
        status: "failed",
        description: message,
        metadata: {
          current_phase: "recorder.orphan.cleaned",
          progress_percent: 100,
          recorder_status: shouldStop ? "auto-stopped" : session?.status || "unknown",
          last_activity_at: session?.last_activity_at || null,
          orphan_ttl_ms: ports.RECORDER_ORPHAN_TTL_MS
        },
        completed_at: new Date().toISOString()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to inspect recorder session";
      await ports.appendEvent(transaction.id, {
        level: "warning",
        phase: "recorder.orphan.inspect_failed",
        message,
        details: {
          recorder_session_id: sessionId,
          engine_base_url: baseUrl
        }
      }).catch(() => null);
    }
  }

  return {
    checked,
    stopped
  };
};


exports.startRecorderSession = async ({
  test_case_id,
  start_url,
  recorder_mode,
  local_transport,
  recorder_target,
  engine_base_url,
  recorder_public_base_url,
  reuse_existing,
  test_environment_id,
  test_configuration_id,
  test_data_set_id,
  test_suite_id,
  target_step_id,
  created_by
} = {}) => {
  const testCaseId = ports.normalizeText(test_case_id);

  if (!testCaseId) {
    throw new Error("test_case_id is required");
  }

  const testCase = await ports.selectCaseWithScope.get(testCaseId);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  const steps = await ports.selectStepsForCase.all(testCaseId);
  const platform = ports.resolveAutomationCaseSteps(testCase, steps, { appTypeKind: testCase.app_type_kind });
  if (platform.automation_case_type === 'api') throw Object.assign(new Error('API automation uses the request editor or API Automation Engineer. Browser recording is unavailable for API-only cases.'), { statusCode: 422, code: 'AUTOMATION_RECORDER_RUNTIME_MISMATCH' });
  const targetStepId = ports.normalizeText(target_step_id);

  if (targetStepId && !steps.some((step) => step.id === targetStepId)) {
    throw new Error("The selected recorder target step does not belong to this test case.");
  }
  const buildContext = await ports.resolveBuildContext({
    testCase,
    test_environment_id,
    test_configuration_id,
    test_data_set_id
  });
  const paired = local_transport === "paired-agent" && ports.normalizeText(recorder_mode) === "local";
  const integration = paired ? { base_url: null, config: {} } : await ports.resolveTestEngineIntegration(testCase);
  const recorderMode = ports.normalizeText(recorder_mode) === "local" ? "local" : "remote";
  const targetStep = targetStepId ? platform.steps.find((step) => step.id === targetStepId) : null;
  if (targetStep?.step_type === "api") throw new Error("Use the request editor for API steps; choose a Web or native step for recording.");
  const recorderTarget = targetStep ? (ports.isMobileAppType(targetStep.step_type) ? "mobile" : "web")
    : ports.isMobileRecorderTarget(recorder_target) || ports.isMobileAppType(platform.automation_case_type)
      || (platform.steps.some((step) => ports.isMobileAppType(step.step_type)) && !platform.steps.some((step) => step.step_type === "web")) ? "mobile" : "web";
  if (!platform.allowed_step_types.some(type => recorderTarget === 'mobile' ? ['android','ios'].includes(type) : type === 'web')) throw Object.assign(new Error('The selected recorder does not match this automation case type.'), { statusCode: 422, code: 'AUTOMATION_RECORDER_RUNTIME_MISMATCH' });
  let recorderSuiteId=null;
  if(test_suite_id){
    const parameters=await ports.loadAutomationParameterContext({testCase,projectId:testCase.project_id,userId:created_by});
    const selected=await require("../../lib/parameters/automationBrowserParameters").loadBrowserParameterResolver({testCase,projectId:testCase.project_id,userId:created_by,
      caseValues:parameters.runtime_parameter_values,privateParameterNames:parameters.private_parameter_names,parameterOverrides:parameters.parameter_overrides,
      test_suite_id,materialize:false,steps});
    recorderSuiteId=selected.test_suite_id;
  }
  const mobilePlatform = recorderTarget === "mobile" ? ports.resolveMobileRecorderPlatform({ applicationPlatform: platform.automation_case_type, steps: platform.steps, targetStepId, configuration: buildContext.configuration || integration.config }) : null;

  if (recorderTarget === "mobile") {
    await ports.mobileFeatureService.assertMobileFeatureEnabled();
    const access = await ports.getOptionalEvidenceAccess({ id: created_by }, testCase.project_id, ["mobile.manage"]);
    if (!access["mobile.manage"]) throw Object.assign(new Error("Mobile management permission is required to record native automation."), { statusCode: 403 });
  }

  if (recorderTarget === "mobile" && recorderMode === "remote" && !ports.hasRemoteMobileProvider(integration)) {
    throw new Error("Configure a mobile cloud provider connection before starting remote mobile recording.");
  }

  if (paired && recorderTarget !== "web") throw Object.assign(new Error("The paired browser recorder supports Web cases. Use the configured device recorder for native steps."), { statusCode: 422 });
  const localBaseUrl = !paired && recorderMode === "local" && recorderTarget === "web" ? ports.normalizeLocalEngineBaseUrl(engine_base_url) : null;
  const baseUrl = String(localBaseUrl || integration.base_url || "").replace(/\/+$/, "");
  const mobileBaseUrl = (recorderTarget === "mobile" && recorderMode === "local"
    ? ports.normalizeText(engine_base_url) || ports.resolveMobileEngineBaseUrl(integration, recorderMode)
    : ports.resolveMobileEngineBaseUrl(integration, recorderMode)).replace(/\/+$/, "");
  const publicBaseUrl = String(
    recorderTarget === "mobile"
      ? ports.normalizeText(recorder_public_base_url) || mobileBaseUrl
      : recorderMode === "local"
      ? ports.normalizeText(recorder_public_base_url) || ports.resolveRecorderPublicBaseUrl(integration, baseUrl, recorderMode)
      : ports.resolveRecorderPublicBaseUrl(integration, baseUrl, recorderMode)
    || baseUrl
  ).replace(/\/+$/, "");
  const resolvedStartUrl = ports.normalizeText(start_url) || testCase.automation_start_url || buildContext.environment?.base_url || null;
  const sessionEndpoint = recorderTarget === "mobile"
    ? `${mobileBaseUrl}/api/v1/mobile/recorder/sessions`
    : `${baseUrl}/api/v1/recorder/sessions`;
  const sessionPayload = {
      start_url: resolvedStartUrl,
      reuse_existing: recorderMode === "local" && recorderTarget === "web" && reuse_existing !== false,
      purpose: "automation-recording",
      recorder_mode: recorderMode,
      platform_name: mobilePlatform || undefined,
      platform_version: recorderTarget === "mobile" ? buildContext.configuration?.targets?.find((target) => target.mobile_os?.toLowerCase() === mobilePlatform)?.version || buildContext.configuration?.platform_version || undefined : undefined,
      provider: recorderTarget === "mobile" ? integration.config?.mobile_cloud_provider || "local-appium" : undefined,
      config: recorderTarget === "mobile" ? integration.config || {} : undefined,
      test_case: {
        id: testCase.id,
        title: testCase.title,
        description: testCase.description || "",
        steps: steps.map(ports.summarizeStep)
      }
    };
  const reservation = await require('.././automationAuthoringAdmission.service').withRecorder({testCase},()=>ports.workspaceTransactionService.createTransaction({
    project_id:testCase.project_id,app_type_id:testCase.app_type_id,category:'automation_build',action:'test_case_recorder',status:'running',
    title:`Recorder session for ${testCase.title}`,description:'Preparing the recorder connection.',related_kind:'test_case',related_id:testCase.id,created_by,
    metadata:{test_case_id:testCase.id,current_phase:'recorder.starting',target_step_id:targetStepId||null,recorder_target:recorderTarget,recorder_mode:recorderMode},started_at:new Date().toISOString()
  }));
  let session;
  try {
    session = paired ? { id: ports.uuid(), status: "running", started_at: new Date().toISOString(), paired_prepare: true }
    : await (recorderTarget === "mobile" ? ports.readMobileEngineJson : ports.readEngineJson)(sessionEndpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sessionPayload)
    });
  } catch(error) {
    const rejected = Number(error?.upstreamStatus) >= 400 && Number(error?.upstreamStatus) < 500;
    const notDispatched = ['DEPENDENCY_CIRCUIT_OPEN', 'DEPENDENCY_CONFIGURATION_ERROR'].includes(error?.code);
    if (rejected || notDispatched) {
      await ports.workspaceTransactionService.updateTransaction(reservation.id,{status:'failed',description:'The recorder connection could not start. Existing instructions were retained.',completed_at:new Date().toISOString()}).catch(()=>null);
      throw error;
    }
    // A lost POST acknowledgement is not proof that the browser/device failed
    // to start. Keep the ownership reservation; a retry must not create another.
    await ports.workspaceTransactionService.updateTransaction(reservation.id,{status:'running',description:'The recorder start outcome is unknown. Reconcile the connected recorder before starting another authoring operation.',metadata:{current_phase:'recorder.start_unknown'}}).catch(()=>null);
    throw Object.assign(new Error('The recorder start outcome is unknown. Review its activity before starting another session.'),{code:'AUTOMATION_RECORDER_START_UNKNOWN',statusCode:409,nonRetryable:true,details:{activity_id:reservation.id,operation:'recording',status:'running',phase:'recorder.start_unknown'}});
  }

  let transaction;
  try { transaction = await ports.workspaceTransactionService.updateTransaction(reservation.id,{
    project_id: testCase.project_id || null,
    app_type_id: testCase.app_type_id || null,
    category: "automation_build",
    action: "test_case_recorder",
    status: "running",
    title: `Recorder session for ${testCase.title}`,
    description: recorderTarget === "mobile"
      ? `A Mobile Engine recorder session is capturing ${mobilePlatform === "ios" ? "iOS" : "Android"} interactions.`
      : "A local Test Engine browser recorder session is capturing user actions and API requests.",
    metadata: {
      current_phase: "recorder.running",
      progress_percent: 20,
      test_case_id: testCase.id,
      automation_case_type: platform.automation_case_type,
      test_environment_id: buildContext.environment?.id || null,
      test_configuration_id: buildContext.configuration?.id || null,
      test_data_set_id: buildContext.data_set?.id || null,
      test_suite_id: recorderSuiteId,
      recorder_session_id: session.id,
      recorder_plan_key: require("../../lib/recording/automationRecorderPlan").recorderPlanFingerprint(steps),
      ...(paired ? { local_transport: "paired-agent", recorder_case_revision: Number(testCase.revision) || 0 } : {}),
      recorder_started_at: session.started_at || new Date().toISOString(),
      recorder_last_activity_at: session.last_activity_at || session.started_at || null,
      engine_base_url: baseUrl,
      mobile_engine_base_url: recorderTarget === "mobile" ? mobileBaseUrl : null,
      recorder_mode: recorderMode,
      recorder_target: recorderTarget,
      platform_name: mobilePlatform,
      recorder_public_base_url: publicBaseUrl,
      target_step_id: targetStepId || null
    },
    related_kind: "test_case",
    related_id: testCase.id,
    created_by,
    started_at: new Date().toISOString()
  });

  } catch (error) {
    // A browser without its ownership receipt cannot be recovered by the UI.
    // Release it immediately when establishing the start receipt fails.
    let stopped = paired;
    if (!paired) try {
      await (recorderTarget === 'mobile' ? ports.readMobileEngineJson : ports.readEngineJson)(`${sessionEndpoint}/${encodeURIComponent(session.id)}/stop`, { method: 'POST' });
      stopped = true;
    } catch { /* Retain the reservation when the stop acknowledgement is lost. */ }
    await ports.workspaceTransactionService.updateTransaction(reservation.id,stopped
      ? {status:'failed',description:'The recorder ownership receipt could not be completed. The recorder was stopped.',completed_at:new Date().toISOString()}
      : {status:'running',description:'The recorder ownership update failed and its stop outcome is unknown.',metadata:{current_phase:'recorder.stop_unknown',recorder_session_id:session.id,engine_base_url:baseUrl,mobile_engine_base_url:recorderTarget==='mobile'?mobileBaseUrl:null,recorder_target:recorderTarget}}).catch(()=>null);
    throw error;
  }

  await ports.appendEvent(transaction.id, {
    phase: "recorder.started",
    message: session.live_view_path || session.live_view_url
      ? `Started a ${recorderTarget} recorder session with a HelloTest live view.`
      : `Started a ${recorderTarget} recorder session.`,
    details: {
      recorder_session_id: session.id,
      engine_base_url: baseUrl,
      mobile_engine_base_url: recorderTarget === "mobile" ? mobileBaseUrl : null,
      recorder_mode: recorderMode,
      recorder_target: recorderTarget,
      platform_name: mobilePlatform,
      target_step_id: targetStepId || null,
      display_mode: session.display_mode || null,
      live_view_available: Boolean(session.live_view_path || session.live_view_url),
      reused_existing_session: session.reused === true,
      start_url: resolvedStartUrl,
      test_environment_id: buildContext.environment?.id || null,
      test_configuration_id: buildContext.configuration?.id || null,
      test_data_set_id: buildContext.data_set?.id || null
    }
  }).catch(() => null);

  return {
    ...session,
    ...(paired ? { paired_session_payload: sessionPayload, paired_recording_id: session.id } : {}),
    transaction_id: transaction.id,
    engine_base_url: baseUrl,
    recorder_target: recorderTarget,
    platform_name: mobilePlatform,
    target_step_id: targetStepId || null,
    live_view_url: paired ? null : ports.buildEngineUrl(publicBaseUrl, session.live_view_url || session.live_view_path),
    status_url: paired ? undefined : ports.buildEngineUrl(
      publicBaseUrl,
      session.status_url || (recorderTarget === "mobile"
        ? `/api/v1/mobile/recorder/sessions/${session.id}`
        : `/api/v1/recorder/sessions/${session.id}`)
    )
  };
};


exports.finishRecorderSession = async ({
  test_case_id,
  recorder_session_id,
  transaction_id,
  integration_id,
  additional_context,
  agent_context,
  recorder_mode,
  paired_recording_id,
  captured_session,
  recorder_target,
  engine_base_url,
  target_step_id,
  included_action_indices,
  excluded_action_indices,
  parameter_bindings,
  created_by
} = {}) => {
  const testCaseId = ports.normalizeText(test_case_id);
  const sessionId = ports.normalizeText(recorder_session_id);

  if (!testCaseId || !sessionId) {
    throw new Error("test_case_id and recorder_session_id are required");
  }
  if (excluded_action_indices != null && (!Array.isArray(excluded_action_indices)
    || excluded_action_indices.length > ports.MAX_CAPTURED_ACTIONS
    || excluded_action_indices.some(index => !Number.isSafeInteger(index) || index < 0)
    || included_action_indices != null)) {
    throw Object.assign(new Error("Choose either included or excluded recorded actions using their capture indices."), {
      statusCode: 422, code: "AUTOMATION_RECORDER_ACTION_SELECTION_INVALID"
    });
  }
  const discard = Array.isArray(included_action_indices) && included_action_indices.length === 0;

  let testCase = await ports.selectCaseWithScope.get(testCaseId);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  const pairedInput = captured_session != null;
  const transactionId = ports.normalizeText(transaction_id);
  const transaction = transactionId
    ? await ports.workspaceTransactionService.getTransaction(transactionId).catch(() => null)
    : null;
  const metadata = ports.parseTransactionMetadata(transaction);
  const paired = metadata.local_transport === "paired-agent";
  if (transaction && (transaction.created_by !== created_by || transaction.project_id !== testCase.project_id || transaction.action !== 'test_case_recorder')) throw Object.assign(new Error('This recording belongs to another user or project.'), { statusCode: 403, code: 'AUTOMATION_RECORDER_SCOPE_MISMATCH' });
  if (transaction && (metadata.test_case_id !== testCaseId || metadata.recorder_session_id !== (paired ? paired_recording_id : sessionId))) throw new Error("The recorder transaction does not belong to this case and session.");
  let targetStepId = ports.normalizeText(target_step_id) || ports.normalizeText(metadata.target_step_id);
  if (transaction && targetStepId !== ports.normalizeText(metadata.target_step_id)) throw Object.assign(new Error('The selected recorder target differs from the section where recording started.'), { statusCode: 409, code: 'AUTOMATION_RECORDER_TARGET_CHANGED' });
  const recordingImport = { projectId: testCase.project_id, sourceCaseId: testCaseId, userId: created_by, sessionId,
    transactionId, recordingId: paired_recording_id, targetStepId, parameterBindings: parameter_bindings || [],
    includedActionIndices: included_action_indices, excludedActionIndices: excluded_action_indices, additionalContext: additional_context, capture: captured_session };
  const savedImport = await require(".././recordingImport.service").load(recordingImport);
  if (savedImport) return savedImport;
  if (!transaction) throw Object.assign(new Error('The recording receipt is unavailable. Retry saving from the tab where this recording started.'), { statusCode: transactionId ? 503 : 400, code: 'AUTOMATION_RECORDER_TRANSACTION_REQUIRED' });
  const engineIntegration = pairedInput ? { base_url: null, config: {} } : await ports.resolveTestEngineIntegration(testCase);
  const targetSteps = await ports.selectStepsForCase.all(testCaseId);
  if (paired && !pairedInput) throw Object.assign(new Error("Read the stopped recording from the paired agent before saving."), { statusCode: 400 });
  if (!discard && metadata.recorder_plan_key && metadata.recorder_plan_key !== require("../../lib/recording/automationRecorderPlan").recorderPlanFingerprint(targetSteps)) {
    // A concurrent identical save may have committed after the first lookup.
    const committed = await require(".././recordingImport.service").load(recordingImport);
    if (committed) return committed;
    throw Object.assign(new Error('The case plan changed while recording. Refresh the plan before saving. Existing instructions were retained.'), { code: 'AUTOMATION_RECORDER_CASE_CHANGED', statusCode: 409 });
  }
  const pairedCapture = pairedInput ? require("../../lib/build/automationPairedRecorder").validatePairedRecording({ transaction, metadata, testCase, steps: targetSteps, sessionId, recordingId: paired_recording_id, capture: captured_session, userId: created_by, discard }) : null;
  const platform = discard ? null : ports.resolveAutomationCaseSteps(testCase, targetSteps, { appTypeKind: testCase.app_type_kind });
  if (platform && (platform.automation_case_type === 'api' || metadata.automation_case_type && metadata.automation_case_type !== platform.automation_case_type)) throw Object.assign(new Error('The automation case type no longer matches this recording. Existing steps were retained; review the platform before saving recorded actions.'), { statusCode: 409, code: 'AUTOMATION_CASE_TYPE_CHANGED' });

  if (!discard && targetStepId && !targetSteps.some((step) => step.id === targetStepId)) {
    throw new Error("The selected recorder target step does not belong to this test case.");
  }
  const requestedTarget = ports.normalizeText(metadata.recorder_target) || ports.normalizeText(recorder_target);
  const target = requestedTarget ? (ports.isMobileRecorderTarget(requestedTarget) ? "mobile" : "web")
    : ports.isMobileAppType(platform?.automation_case_type || testCase.app_type_kind) || platform?.steps.some((step) => step.id === targetStepId && ports.isMobileAppType(step.step_type)) ? "mobile" : "web";
  if (platform && !platform.allowed_step_types.some(type => target === 'mobile' ? ['android','ios'].includes(type) : type === 'web')) throw Object.assign(new Error('The recording runtime is incompatible with this automation case type.'), { statusCode: 422, code: 'AUTOMATION_RECORDER_RUNTIME_MISMATCH' });
  if (target === "mobile") {
    await ports.mobileFeatureService.assertMobileFeatureEnabled();
    const access = await ports.getOptionalEvidenceAccess({ id: created_by }, testCase.project_id, ["mobile.manage"]);
    if (!access["mobile.manage"]) throw Object.assign(new Error("Mobile management permission is required to save native automation."), { statusCode: 403 });
  }
  const localBaseUrl = !paired && ports.normalizeText(recorder_mode) === "local" && target !== "mobile" ? ports.normalizeLocalEngineBaseUrl(engine_base_url) : null;
  const baseUrl = String(localBaseUrl || metadata.engine_base_url || engineIntegration.base_url || "").replace(/\/+$/, "");
  const mobileBaseUrl = String(metadata.mobile_engine_base_url || ports.resolveMobileEngineBaseUrl(engineIntegration, ports.normalizeText(recorder_mode) || metadata.recorder_mode || "remote")).replace(/\/+$/, "");
  const sessionBaseUrl = target === "mobile" ? mobileBaseUrl : baseUrl;
  const sessionPath = target === "mobile" ? "/api/v1/mobile/recorder/sessions" : "/api/v1/recorder/sessions";
  const readRecorderEngineJson = target === "mobile" ? ports.readMobileEngineJson : ports.readEngineJson;
  let session = paired ? pairedCapture : await readRecorderEngineJson(`${sessionBaseUrl}${sessionPath}/${sessionId}`);
  // Stop flushes pending input events; compile the returned frozen capture,
  // including the final field value, rather than an earlier polling response.
  if (!paired && session.status === 'running') session = await readRecorderEngineJson(`${sessionBaseUrl}${sessionPath}/${sessionId}/stop`, { method: 'POST' });
  if (discard) {
    if (!['stopped','failed'].includes(session.status)) throw Object.assign(new Error("The recorder has not confirmed that it stopped. Retry discard from this recording."), {
      statusCode: 409, code: "AUTOMATION_RECORDER_STOP_UNCONFIRMED"
    });
    const receipt = await require(".././recordingImport.service").commit(recordingImport, testCaseId, async () => ({
      test_case_id: testCaseId, generated_step_count: 0, learned_locator_count: 0, discarded: true, warnings: []
    }));
    if (!receipt.idempotent_replay) {
      const warnings = [];
      await ports.updateTransaction(transactionId, {
        status: "cancelled", description: "Recording discarded.", metadata: { ...metadata, current_phase: "recorder.discarded" },
        completed_at: new Date().toISOString()
      }).catch(() => warnings.push("The recording stopped, but its activity status could not be updated."));
      return { ...receipt, warnings };
    }
    return receipt;
  }
  const mobilePlatform = target === "mobile" ? ports.resolveMobileRecorderPlatform({ applicationPlatform: testCase.app_type_kind, steps: targetSteps, targetStepId, recordedPlatform: session.platform || session.platform_name || metadata.platform_name }) : null;
  const allCapturedActions = ports.normalizeCapturedActions(session.actions || []);
  if ((session.action_count || session.actions?.length || 0) > allCapturedActions.length) throw new Error(`This recording exceeds the ${ports.MAX_CAPTURED_ACTIONS}-action build limit. Record a smaller flow or split it into reusable groups; incomplete recordings will not replace the plan.`);
  const selectedActionIndices = Array.isArray(included_action_indices) ? new Set(included_action_indices.map(Number)) : null;
  const excludedActionIndices = new Set(excluded_action_indices || []);
  if (selectedActionIndices || excludedActionIndices.size) {
    const recordedIndices = new Set(allCapturedActions.map((action) => action.index));
    if ([...(selectedActionIndices || excludedActionIndices)].some((index) => !Number.isSafeInteger(index) || !recordedIndices.has(index))) {
      throw Object.assign(new Error("The selected recorder actions are no longer available. Refresh the recording before saving."), { code: "AUTOMATION_RECORDER_ACTIONS_CHANGED", statusCode: 409 });
    }
  }
  // Selection is a subset of the recording, not a new action order. Preserve
  // capture chronology and deduplicate before compiling code.
  const capturedActions = allCapturedActions.filter(action =>
    (!selectedActionIndices || selectedActionIndices.has(action.index)) && !excludedActionIndices.has(action.index));
  // Reject unsupported context or missing element contracts before creating a
  // linked automation target. The frozen capture and saved plan stay intact.
  if (target === 'web') require("../../lib/recording/automationRecorderReplayPlan").prepareRecorderReplayActions(capturedActions);
  if (target === 'web' && capturedActions.some(action => action.type === 'upload' && action.source === 'page-recorder')) await preflightRecorderUploadBindings({ testCase, actions: capturedActions, steps: targetSteps,
    parameterBindings: parameter_bindings || [], createdBy: created_by, metadata, targetStepId });
  if (target === 'mobile') require("../../domain/mobileRecorderPlan").buildMobileRecorderPlan({
    caseId: testCase.id, applicationPlatform: testCase.app_type_kind, existingSteps: targetSteps,
    capturedActions, targetStepId, platform: mobilePlatform
  });
  const capturedNetwork = ports.normalizeCapturedNetwork(session.network || []);
  const preparedTarget = capturedActions.length
    ? await ports.automationCasePreparationService.prepareAutomationTarget({ testCaseId, createdBy: created_by, targetStepId, startUrl:session.start_url||metadata.start_url||null })
    : { test_case_id: testCaseId, source_test_case_id: null, target_step_id: targetStepId };
  if (preparedTarget.test_case_id !== testCaseId) {
    testCase = await ports.selectCaseWithScope.get(preparedTarget.test_case_id);
    targetStepId = preparedTarget.target_step_id;
  }
  recordingImport.sourceTestCaseId = preparedTarget.source_test_case_id;


  if (target === "mobile") {
    const expectedMobileSteps = preparedTarget.test_case_id === testCaseId ? targetSteps : await ports.selectStepsForCase.all(testCase.id);
    let mobileReadinessIssues = [];
    const repositoryModel = await ports.buildRecorderRepositoryModel({
      testCase,
      capturedActions,
      integrationId: integration_id,
      userId: created_by,
      transactionId,
      platform: mobilePlatform
    });
    // The receipt and native plan/readiness share one commit. A concurrent or
    // lost-response retry returns that receipt without overwriting later edits.
    // Repository preparation above may use external services; none belongs in
    // this database save boundary.
    const committed = await require(".././recordingImport.service").commit(recordingImport, testCase.id, async () => {
      const stepUpdates = await ports.persistMobileRecorderPlan({
        caseId: testCase.id,
        expectedSteps: expectedMobileSteps,
        applicationPlatform: testCase.app_type_kind,
        capturedActions,
        targetStepId,
        repositoryReferences: repositoryModel.byActionIndex,
        platform: mobilePlatform
      }, {
        transaction: (callback) => ports.db.transaction(callback)(),
        lockCase: (caseId) => ports.db.prepare("SELECT id FROM test_cases WHERE id = ? FOR UPDATE").get(caseId),
        readSteps: (caseId) => ports.db.prepare("SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY step_order ASC, id ASC FOR UPDATE").all(caseId),
        updateStep: ports.testStepService.updateTestStep,
        createStep: ports.testStepService.createTestStep,
        updateCaseReadiness: async (caseId) => {
          mobileReadinessIssues = await require("../../lib/recording/automationRecorderReadiness").recordedPlanIssues(await ports.selectStepsForCase.all(caseId));
          return mobileReadinessIssues.length ? ports.markTestCaseAutomationIncomplete.run(caseId) : ports.markTestCaseAutomationReady.run(ports.normalizeText(created_by), caseId);
        }
      });
      return {
        test_case_id: testCase.id,
        source_test_case_id: preparedTarget.source_test_case_id,
        generated_step_count: stepUpdates.length,
        created_step_count: stepUpdates.filter((step) => step.operation === "created").length,
        updated_step_count: stepUpdates.filter((step) => step.operation === "updated").length,
        learned_locator_count: 0,
        warnings: [
          ...(repositoryModel.repository_warning ? [repositoryModel.repository_warning] : []),
          ...(mobileReadinessIssues.length ? [`The recording was saved. Complete these instructions before running: ${mobileReadinessIssues.join(' ')}`] : [])
        ],
        message: stepUpdates.length
          ? `Mobile recorder stopped and ${mobilePlatform === "ios" ? "iOS" : "Android"} keyword steps were saved.`
          : `Mobile recorder stopped. No ${mobilePlatform === "ios" ? "iOS" : "Android"} actions were captured.`,
        // The native source is saved on the steps, not duplicated into a retry
        // receipt that may otherwise contain captured input literals.
        step_updates: stepUpdates.map(({ automation_code, ...step }) => step),
        recorder_session: {
          id: session.id,
          platform_name: mobilePlatform,
          action_count: capturedActions.length,
          network_count: capturedNetwork.length
        }
      };
    });
    if (committed.idempotent_replay) return committed;
    const warnings = [...committed.warnings];
    let learnedCount = 0;
    try { learnedCount = await ports.persistLearning({
      testCase,
      learnedLocators: [],
      capturedActions,
      capturedNetwork,
      transactionId,
      repositoryModel,
      integrationId: integration_id
    }); } catch { warnings.push('The recording was saved, but repository learning could not be updated.'); }
    await ports.workspaceTransactionService.updateTransaction(transactionId, {
      status: "completed",
      metadata: {
        ...metadata,
        current_phase: "recorder.mobile.completed",
        progress_percent: 100,
        recorder_session_id: session.id,
        platform_name: mobilePlatform,
        action_count: capturedActions.length,
        learned_locator_count: learnedCount,
        updated_step_count: committed.updated_step_count,
        created_step_count: committed.created_step_count,
        warnings
      },
      completed_at: new Date().toISOString()
    }).catch(() => { warnings.push('The recording was saved, but its activity status could not be updated.'); });
    await ports.appendEvent(transactionId, {
      level: committed.generated_step_count && !mobileReadinessIssues.length ? "success" : "warning",
      phase: "recorder.mobile.steps.created",
      message: committed.generated_step_count
        ? `Mobile recorder saved ${committed.generated_step_count} ${mobilePlatform === "ios" ? "iOS" : "Android"} keyword step${committed.generated_step_count === 1 ? "" : "s"}.`
        : `Mobile recorder stopped without captured ${mobilePlatform === "ios" ? "iOS" : "Android"} actions.`,
      details: {
        recorder_session_id: session.id,
        action_count: capturedActions.length,
        learned_locator_count: learnedCount,
        step_count: committed.generated_step_count
      }
    }).catch(() => { warnings.push('The recording was saved, but its activity event could not be updated.'); });
    return {
      ...committed,
      learned_locator_count: learnedCount,
      warnings
    };
  }

  const result = await finalizeRecorderBuild({
    testCase,
    session,
    createdBy: created_by,
    transactionId: transaction_id,
    capturedActions,
    capturedNetwork,
    integrationId: integration_id,
    additionalContext: additional_context,
    targetStepId,
    parameterSelection:{test_environment_id:metadata.test_environment_id||undefined,test_configuration_id:metadata.test_configuration_id||undefined,test_data_set_id:metadata.test_data_set_id||undefined,test_suite_id:metadata.test_suite_id||undefined},
    parameterBindings: parameter_bindings || [],
    recordingImport,
    expectedPlanKey: preparedTarget.test_case_id === testCaseId ? metadata.recorder_plan_key : undefined
  });

  return {
    ...result,
    test_case_id: testCase.id,
    source_test_case_id: preparedTarget.source_test_case_id,
    recorder_session: {
      id: session.id,
      action_count: capturedActions.length,
      network_count: capturedNetwork.length
    }
  };
};
return { selectStaleRecorderTransactions, applyRecorderSteps, preflightRecorderUploadBindings, finalizeRecorderBuild };
}
module.exports = { createRecorderImport };
