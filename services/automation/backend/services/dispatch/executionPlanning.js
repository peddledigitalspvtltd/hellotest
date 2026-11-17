// executionPlanning: cohesive builder implementation; dependencies are explicit lazy ports.
function createExecutionPlanning(ports) {
const exports = ports.exports;
const require = ports.require;


async function planExecutionDispatch(execution, options = {}) {
  const [project, appType] = await Promise.all([
    ports.selectProject.get(execution.project_id),
    execution.app_type_id ? ports.selectAppType.get(execution.app_type_id) : Promise.resolve(null)
  ]);

  if (!project) {
    throw new Error("Execution project not found");
  }

  const stepsByCaseId = new Map();

  for (const stepSnapshot of execution.step_snapshots || []) {
    const current = stepsByCaseId.get(stepSnapshot.test_case_id) || [];
    current.push(stepSnapshot);
    stepsByCaseId.set(stepSnapshot.test_case_id, current);
  }

  const warnings = [];
  const eligibleCases = [];
  let automatedCaseCount = 0;
  let manualCaseCount = 0;
  let unsupportedAutomatedCaseCount = 0;
  const allowIncompleteAutomation = options.allowIncompleteAutomation === true;
  const allowApiCasesWithoutAutomation = options.allowApiCasesWithoutAutomation === true;

  for (const caseSnapshot of execution.case_snapshots || []) {
    const dataSetIterations = ports.resolveExecutionDataSetIterations(execution, caseSnapshot);
    // New runs freeze automation identity. Besides avoiding one authoring read
    // per case, this keeps execution independent of later edits or deletion.
    const caseRecord = caseSnapshot.automated == null
      ? await ports.selectTestCaseDispatchMetadata.get(caseSnapshot.test_case_id)
      : null;
    const savedSteps = stepsByCaseId.get(caseSnapshot.test_case_id) || [];
    const isAutomated = (caseSnapshot.automated ?? caseRecord?.automated) === 'yes';
    if (!isAutomated && (!allowApiCasesWithoutAutomation || !savedSteps.length
      || savedSteps.some(step => !ports.normalizeApiRequest(step.api_request)?.url))) {
      manualCaseCount += 1;
      continue;
    }
    // A run keeps its frozen case type and steps even when the authoring case
    // changes later. Application kind is only a legacy inference input.
    let resolved;
    try { resolved = ports.resolveAutomationCaseSteps(caseSnapshot, savedSteps, { appTypeKind: appType?.type }); }
    catch (error) {
      // A manual draft is never blocked by automation-only platform metadata.
      if (isAutomated) throw error;
      manualCaseCount += 1;
      continue;
    }
    const { automation_case_type: appTypeKind, steps: rawSteps } = resolved;
    const isApiOnlyRunnableCase = allowApiCasesWithoutAutomation
      && ports.normalizeText(appTypeKind)?.toLowerCase() === "api"
      && rawSteps.length > 0
      && rawSteps.every((stepSnapshot) =>
        ports.resolveEngineStepType(stepSnapshot.step_type, appTypeKind) === "api"
        && Boolean(ports.normalizeApiRequest(stepSnapshot.api_request)?.url)
      );

    if (!isAutomated && !isApiOnlyRunnableCase) {
      manualCaseCount += 1;
      continue;
    }

    automatedCaseCount += 1;

    if (!isApiOnlyRunnableCase && caseSnapshot.automated == null && caseRecord?.automation_status && caseRecord.automation_status !== "ready") {
      warnings.push(`${caseSnapshot.test_case_title}: automation is incomplete because a required repository object is missing or still needs review.`);
      if (!allowIncompleteAutomation) {
        unsupportedAutomatedCaseCount += 1;
        continue;
      }
    }

    if (!rawSteps.length) {
      unsupportedAutomatedCaseCount += 1;
      warnings.push(`${caseSnapshot.test_case_title}: automated case has no snapped steps to queue.`);
      continue;
    }

    const stepWarnings = [];
    const normalizedSteps = rawSteps.map((stepSnapshot) => {
      const stepType = ports.resolveEngineStepType(stepSnapshot.step_type, appTypeKind);

      if (!stepType) {
        stepWarnings.push(
          `${caseSnapshot.test_case_title}: step ${stepSnapshot.step_order} is not part of the current engine-supported API, web, or mobile path.`
        );
        return null;
      }

      return {
        id: stepSnapshot.snapshot_step_id,
        order: stepSnapshot.step_order,
        step_type: stepType,
        engine_class: ports.resolveStepEngineClass({ step_type: stepType }, appTypeKind),
        action: ports.normalizeText(stepSnapshot.action),
        expected_result: ports.normalizeText(stepSnapshot.expected_result),
        automation_code: ports.normalizeRichText(stepSnapshot.automation_code),
        // Inspect authored fields before permissive legacy normalization can
        // replace an unsupported method or discard an invalid assertion.
        api_request: stepType === "api" ? stepSnapshot.api_request : null,
        shared_parameter_values: ports.normalizeStringRecord(stepSnapshot.shared_parameter_values),
    group_name: ports.normalizeText(stepSnapshot.group_name),
        group_kind: stepSnapshot.group_kind === "local" || stepSnapshot.group_kind === "reusable"
          ? stepSnapshot.group_kind
          : null
      };
    }).filter(Boolean);

    if (stepWarnings.length || normalizedSteps.length !== rawSteps.length) {
      unsupportedAutomatedCaseCount += 1;
      warnings.push(...stepWarnings);
      continue;
    }

    // Run admission checks whether the saved code can execute. Assertion
    // quality is enforced during generation; a case may keep its assertions
    // in a later section of the same ordered plan.
    const executablePlan = await require(".././automationReadiness.service").prepareExecutablePlan(normalizedSteps, { requireExpectedAssertions: false });
    const executableIssues = executablePlan.issues;
    if (executableIssues.length) {
      unsupportedAutomatedCaseCount += 1;
      warnings.push(...executableIssues.map(issue => `${caseSnapshot.test_case_title}: ${issue}`));
      continue;
    }
    const runnableSteps = executablePlan.steps.map(step => step.step_type === 'api'
      ? { ...step, api_request: ports.normalizeApiRequest(step.api_request) } : step);

    for (const dataSetIteration of dataSetIterations) {
      eligibleCases.push({
        engine_run_id: ports.uuid(),
        case_snapshot: caseSnapshot,
        case_record: caseRecord,
        data_set_iteration: dataSetIteration,
        envelope: null,
        steps: runnableSteps
      });
    }
  }

  return {
    execution,
    project,
    appType,
    automated_case_count: automatedCaseCount,
    eligible_automated_case_count: eligibleCases.length,
    manual_case_count: manualCaseCount,
    unsupported_automated_case_count: unsupportedAutomatedCaseCount,
    warnings: ports.summarizeWarnings(warnings),
    stepsByCaseId,
    eligibleCases: eligibleCases.sort((left, right) =>
      Number(left.case_snapshot.sort_order || 0) - Number(right.case_snapshot.sort_order || 0)
    )
  };
}


async function settleExecutionIfComplete(executionId) {
  const requiredCases = (await ports.selectExecutionCaseIds.all(executionId))
    .filter((row) => ports.normalizeText(row.test_case_id));

  if (!requiredCases.length) {
    return;
  }

  const latestResults = await ports.selectLatestResultsForExecution.all(executionId);
  const executionContext = await ports.selectExecutionDataSetContext.get(executionId);
  const legacyDataSetSnapshot = ports.normalizeJsonValue(executionContext?.test_data_set_snapshot, null);
  const legacyExecution = executionContext?.test_data_set_id || legacyDataSetSnapshot
    ? {
        test_data_set: {
          id: executionContext?.test_data_set_id || legacyDataSetSnapshot?.id || null,
          name: legacyDataSetSnapshot?.name || "Deleted data set",
          snapshot: legacyDataSetSnapshot
        }
      }
    : null;
  const latestStatusByIteration = new Map(latestResults.map((result) => [
    `${ports.normalizeText(result.test_case_id)}:${Number.isInteger(result.data_set_iteration_index) ? result.data_set_iteration_index : -1}`,
    ports.normalizeText(result.status)
  ]));
  const coveredCases=new Map(latestResults.filter(row=>row.derived&&row.covers_entire_case).map(row=>[row.test_case_id,row.status]));
  const requiredIterationKeys = requiredCases.flatMap((caseSnapshot) => {
    const testCaseId = ports.normalizeText(caseSnapshot.test_case_id);
    const dataSet = ports.resolveCaseDataSetContext(legacyExecution, caseSnapshot);
    const rows = dataSet?.snapshot?.mode === "table" && Array.isArray(dataSet.snapshot.rows)
      ? dataSet.snapshot.rows
      : [];
    const iterationIndexes = dataSet
      ? rows.length ? rows.map((_row, index) => index) : [0]
      : [-1];
    return iterationIndexes.map((iterationIndex) => {
      const key=`${testCaseId}:${iterationIndex}`;
      if(coveredCases.has(testCaseId)&&(!latestStatusByIteration.has(key)||latestStatusByIteration.get(key)==="pending")) latestStatusByIteration.set(key,coveredCases.get(testCaseId));
      return key;
    });
  });

  if (
    requiredIterationKeys.some((key) => !latestStatusByIteration.has(key))
    || requiredIterationKeys.some((key) => !ports.isFinalResultStatus(latestStatusByIteration.get(key)))
  ) {
    return;
  }

  const nextExecutionStatus = requiredIterationKeys.every((key) => latestStatusByIteration.get(key) === "passed")
    ? "completed"
    : "failed";

  await ports.settleExecutionStatus.run(nextExecutionStatus, executionId);
}


async function queueExecutionDispatch({ plan, integration, initiatedBy }) {
  if (!plan.eligibleCases.length) {
    return {
      automated_case_count: plan.automated_case_count,
      queued_for_engine_count: 0,
      manual_case_count: plan.manual_case_count,
      unsupported_automated_case_count: plan.unsupported_automated_case_count,
      warnings: plan.warnings
    };
  }

  const concurrencyLimit = Math.max(1, Math.min(32, ports.normalizeInteger(process.env.TESTENGINE_DISPATCH_CONCURRENCY, 5) || 5));
  const repositories = new Map();
  const environmentCache = new Map();
  const prepared = [];
  for (let i = 0; i < plan.eligibleCases.length; i += concurrencyLimit) {
    const chunk = plan.eligibleCases.slice(i, i + concurrencyLimit);
    prepared.push(...await Promise.all(chunk.map(async (item) => {
      const caseId = item.case_snapshot.test_case_id;
      if (!repositories.has(caseId)) repositories.set(caseId, ports.listObjectRepositoryForEnvelope({
        projectId: plan.execution.project_id, appTypeId: plan.execution.app_type_id, testCaseId: caseId
      }));
      const objectRepository = await repositories.get(caseId);
      const envelope = await ports.buildEngineEnvelope({
        engineRunId: item.engine_run_id,
        execution: plan.execution,
        project: plan.project,
        appType: plan.appType,
        caseSnapshot: item.case_snapshot,
        steps: item.steps,
        stepsByCaseId: plan.stepsByCaseId,
        integration,
        objectRepository,
        dataSetIteration: item.data_set_iteration,
        initiatedBy, environmentCache
      });
      const orchestrationSteps = [...item.steps, ...(envelope.hooks || []).flatMap(hook => hook.steps)];
      const orchestrationClass = ports.resolveOrchestrationClass(orchestrationSteps, plan.appType?.type || "web");
      const stepEngineClasses = ports.resolveStepEngineClasses(orchestrationSteps, plan.appType?.type || "web");
      const integrationConfig = integration?.config && typeof integration.config === "object" && !Array.isArray(integration.config)
        ? integration.config
        : {};
      const engineWorkerCaps = ports.resolveIntegrationEngineWorkerCaps(integrationConfig);
      const engineMaxWorkers = engineWorkerCaps[orchestrationClass] || ports.getQueueMaxWorkers(orchestrationClass);
      envelope.engine_worker_caps = engineWorkerCaps;
      envelope.step_engine_classes = stepEngineClasses;
      envelope.orchestration_class = orchestrationClass;
      return { item, envelope, orchestrationClass, stepEngineClasses, engineMaxWorkers };
    })));
  }

  // Publish the entire suite together. Otherwise a worker may lease case two
  // while case one's asynchronous envelope/receipt is still being prepared,
  // observe no prior job, and run serial cases in the wrong order. Transactions
  // also prevent a failing handoff from leaving runnable partial suites behind.
  await ports.obsDb.transaction(async () => {
    for (const { item, envelope, orchestrationClass, stepEngineClasses, engineMaxWorkers } of prepared) {
      const transaction = await ports.workspaceTransactionService.createTransaction({
        project_id: plan.execution.project_id,
        app_type_id: plan.execution.app_type_id || null,
        category: "automation",
        action: "testengine_run",
        status: "queued",
        title: `Automated handoff for ${item.case_snapshot.test_case_title}`,
        description: "Queued for Test Engine execution.",
        metadata: {
          source: "hellotest",
          engine_run_id: item.engine_run_id,
          execution_id: plan.execution.id,
          test_case_id: item.case_snapshot.test_case_id,
          data_set_iteration_index: item.data_set_iteration?.index ?? null,
          data_set_iteration_key: item.data_set_iteration?.key || null,
          engine_host: ports.normalizeEngineHostUrl(integration.base_url),
          queue_mode: "hellotest-pull",
          orchestration_class: orchestrationClass,
          step_engine_classes: stepEngineClasses,
          engine_max_workers: engineMaxWorkers,
          active_web_engine: envelope.web_engine?.active || "playwright",
          live_view_url: ports.buildProviderLiveViewUrl(integration, envelope.web_engine?.active || "playwright")
        },
        related_kind: "testengine_run",
        related_id: item.engine_run_id,
        created_by: initiatedBy || plan.execution.created_by || null,
        started_at: new Date().toISOString()
      });

      await ports.workspaceTransactionService.appendTransactionEvent(transaction.id, {
        level: "info",
        phase: "dispatch.queued",
        message: `Queued ${item.case_snapshot.test_case_title} for Test Engine execution.`,
        details: {
          execution_id: plan.execution.id,
          test_case_id: item.case_snapshot.test_case_id,
          engine_run_id: item.engine_run_id
        }
      });

      await ports.insertJob.run(
        ports.uuid(),
        item.engine_run_id,
        integration.id || null,
        plan.execution.project_id,
        plan.execution.app_type_id || null,
        plan.appType?.type || "web",
        orchestrationClass,
        engineMaxWorkers,
        plan.execution.id,
        item.case_snapshot.test_case_id,
        item.case_snapshot.test_case_title,
        transaction.id,
        ports.normalizeEngineHostUrl(integration.base_url),
        envelope,
        {
          captured_values: {},
          logs: ports.parseStructuredLogs(null)
        },
        "queued",
        0,
        null,
        null,
        null,
        null,
        null,
        initiatedBy || plan.execution.created_by || null
      );
    }
  })();

  return {
    automated_case_count: plan.automated_case_count,
    queued_for_engine_count: plan.eligibleCases.length,
    manual_case_count: plan.manual_case_count,
    unsupported_automated_case_count: plan.unsupported_automated_case_count,
    warnings: plan.warnings
  };
}


const localPlaywrightIntegration = (integration, engineHost) => ({
  ...(integration || {}),
  base_url: engineHost,
  config: {
    ...(integration?.config || {}),
    active_web_engine: "playwright",
    headless: integration?.config?.headless === true,
    video_mode: ports.normalizeText(integration?.config?.video_mode) || "on",
    trace_mode: ports.normalizeText(integration?.config?.trace_mode) || "on",
    max_video_attachment_mb: integration?.config?.max_video_attachment_mb ?? 16,
    web_session_mode: "new",
    web_session_reuse_key: null,
    connect_over_cdp_endpoint: null,
    playwright_cdp_endpoint: null,
    live_view_url: `${engineHost}/api/v1/live-session?provider=playwright`
  }
});


// Prepare the same frozen engine contract used by remote workers. The browser
// delivers the grant to its paired runner; the API never connects to loopback.
// callbackFor provides a per-run credential, never the shared engine secret.
async function preparePairedLocalDispatch({ plan, integration, initiatedBy, callbackFor, liveBaseUrl = "http://127.0.0.1:4311", pairedDispatchId } = {}) {
  if (typeof callbackFor !== 'function') throw new Error('Paired local execution requires a scoped callback provider.');
  let parsedHost;
  try { parsedHost = new URL(liveBaseUrl); } catch { /* Rejected below. */ }
  if (!parsedHost || !['http:', 'https:'].includes(parsedHost.protocol) || parsedHost.username || parsedHost.password
    || parsedHost.search || parsedHost.hash || !['localhost', '127.0.0.1', '[::1]'].includes(parsedHost.hostname) || parsedHost.pathname !== '/') {
    throw new Error('Paired local execution requires a browser-reachable loopback runner origin.');
  }
  const engineHost = parsedHost.origin;
  if (!ports.normalizeText(pairedDispatchId)) throw new Error('Paired local execution requires a dispatch identity.');
  const directIntegration = localPlaywrightIntegration(integration, engineHost);
  const envelopes = [];
  const repositories = new Map();
  const environmentCache = new Map();
  for (const item of plan?.eligibleCases || []) {
    const caseId = item.case_snapshot.test_case_id;
    if (!repositories.has(caseId)) repositories.set(caseId, await ports.listObjectRepositoryForEnvelope({
      projectId: plan.execution.project_id,
      appTypeId: plan.execution.app_type_id,
      testCaseId: caseId
    }));
    const envelope = await ports.buildEngineEnvelope({
      engineRunId: item.engine_run_id,
      execution: plan.execution,
      project: plan.project,
      appType: plan.appType,
      caseSnapshot: item.case_snapshot,
      steps: item.steps,
      stepsByCaseId: plan.stepsByCaseId,
      integration: directIntegration,
      objectRepository: repositories.get(caseId),
      dataSetIteration: item.data_set_iteration,
      initiatedBy, environmentCache
    });
    envelope.callback = await callbackFor(item, envelope);
    envelopes.push(envelope);
  }
  for (let index = 0; index < envelopes.length; index += 1) {
    const envelope = envelopes[index], item = plan.eligibleCases[index];
    const orchestrationClass = ports.resolveOrchestrationClass([...item.steps, ...(envelope.hooks || []).flatMap(hook => hook.steps)], plan.appType?.type || 'web');
    const liveViewUrl = orchestrationClass === 'api' ? null : ports.buildProviderLiveViewUrl(directIntegration, 'playwright');
    const transaction = await ports.workspaceTransactionService.createTransaction({
      project_id: plan.execution.project_id,
      app_type_id: plan.execution.app_type_id || null,
      category: 'automation',
      action: 'testengine_run',
      status: 'queued',
      title: `Local run for ${item.case_snapshot.test_case_title}`,
      description: 'Prepared for execution on the paired user machine.',
      metadata: {
        source: 'hellotest.local-run',
        queue_mode: 'paired-local',
        paired_dispatch_id: pairedDispatchId,
        engine_run_id: item.engine_run_id,
        execution_id: plan.execution.id,
        test_case_id: item.case_snapshot.test_case_id,
        data_set_iteration_index: envelope.data_set?.iteration?.index ?? null,
        data_set_iteration_key: envelope.data_set?.iteration?.key || null,
        engine_host: engineHost,
        orchestration_class: orchestrationClass,
        active_web_engine: 'playwright',
        live_view_url: liveViewUrl,
        artifact_policy: envelope.artifact_policy,
        capture_failure_override: ports.hasFailureScreenshotOverride(envelope.steps, envelope.hooks)
      },
      related_kind: 'testengine_run',
      related_id: item.engine_run_id,
      created_by: initiatedBy || plan.execution.created_by || null
    });
    await ports.workspaceTransactionService.appendTransactionEvent(transaction.id, {
      level: 'info', phase: 'local-run.prepared',
      message: `Prepared ${item.case_snapshot.test_case_title} for the paired local runner.`,
      details: { execution_id: plan.execution.id, test_case_id: item.case_snapshot.test_case_id, engine_run_id: item.engine_run_id }
    });
  }
  return {
    envelopes,
    automated_case_count: plan?.automated_case_count || 0,
    local_run_count: envelopes.length,
    queued_for_engine_count: 0,
    manual_case_count: plan?.manual_case_count || 0,
    unsupported_automated_case_count: plan?.unsupported_automated_case_count || 0,
    warnings: plan?.warnings || []
  };
}


async function runExecutionDirectLocal({ plan, integration, initiatedBy, engineBaseUrl } = {}) {
  if (!plan?.eligibleCases?.length) {
    return {
      automated_case_count: plan?.automated_case_count || 0,
      local_run_count: 0,
      manual_case_count: plan?.manual_case_count || 0,
      unsupported_automated_case_count: plan?.unsupported_automated_case_count || 0,
      warnings: plan?.warnings || []
    };
  }
  const selectedCaseCount = Array.isArray(plan.execution?.case_snapshots)
    ? plan.execution.case_snapshots.length
    : new Set(plan.eligibleCases.map(item => item.case_snapshot.test_case_id)).size;
  if (plan.eligibleCases.length > 1 || selectedCaseCount > 1) {
    throw Object.assign(new Error('Multiple cases or data rows require the paired local agent to preserve suite ordering, concurrency limits and captured outputs. Connect the local agent in this browser and run the suite again.'), {
      code:'PAIRED_LOCAL_EXECUTION_REQUIRED',statusCode:409
    });
  }

  const engineHost = ports.normalizeEngineHostUrl(engineBaseUrl || integration?.base_url);
  if (!engineHost) {
    throw new Error("Local run requires a local Test Engine URL. Start HelloTest local-run or the local runner service first.");
  }

  const activeWebEngine = "playwright";
  const directIntegration = localPlaywrightIntegration(integration, engineHost);
  const callback = ports.buildDirectCallback({...directIntegration,config:{...directIntegration.config,callback_secret:null}});
  const dispatchSecret = ports.resolveTestEngineSecret();
  const environmentCache = new Map();

  for (const item of plan.eligibleCases) {
    const objectRepository = await ports.listObjectRepositoryForEnvelope({
      projectId: plan.execution.project_id,
      appTypeId: plan.execution.app_type_id,
      testCaseId: item.case_snapshot.test_case_id
    });
    const baseEnvelope = await ports.buildEngineEnvelope({
      engineRunId: item.engine_run_id,
      execution: plan.execution,
      project: plan.project,
      appType: plan.appType,
      caseSnapshot: item.case_snapshot,
      steps: item.steps,
      stepsByCaseId: plan.stepsByCaseId,
      integration: directIntegration,
      objectRepository,
      dataSetIteration: item.data_set_iteration,
      initiatedBy, environmentCache
    });
    const envelope = {
      ...baseEnvelope,
      callback
    };
    const {usesExpressionParameterBindings}=await ports.parameterMode;
    if([...envelope.steps,...(envelope.hooks||[]).flatMap(hook=>hook.steps||[])].some(step=>usesExpressionParameterBindings(step.automation_code))) {
      const health=await ports.resilientHttpRequest(`${engineHost}/health`,{method:'GET',redirect:'error'}, {
        dependency:'test-engine',operation:'run.parameter-expressions-preflight',deadlineMs:2500,maxAttempts:1,maxResponseBytes:65536
      });
      const status=await ports.readBoundedResponseJson(health,{maxBytes:65536,label:'Local Playwright capabilities'});
      if(!health.ok||status?.capabilities?.parameter_expressions_v1!==true)throw Object.assign(new Error('Update the local Playwright runner before running this saved native parameter program. It requires parameter_expressions_v1; no browser actions were dispatched.'),{
        code:'LOCAL_AGENT_UPGRADE_REQUIRED',statusCode:409
      });
    }
    const orchestrationClass = ports.resolveOrchestrationClass([...item.steps, ...(envelope.hooks || []).flatMap(hook => hook.steps)], plan.appType?.type || "web");
    const isApiOnlyRun = orchestrationClass === "api";
    const liveViewUrl = ports.buildProviderLiveViewUrl(directIntegration, activeWebEngine);
    const transactionMetadata = {
      source: "hellotest.local-run",
      engine_run_id: item.engine_run_id,
      execution_id: plan.execution.id,
      test_case_id: item.case_snapshot.test_case_id,
      data_set_iteration_index: item.data_set_iteration?.index ?? null,
      data_set_iteration_key: item.data_set_iteration?.key || null,
      engine_host: engineHost,
      queue_mode: "direct-local",
      orchestration_class: orchestrationClass,
      active_web_engine: activeWebEngine,
      live_view_url: isApiOnlyRun ? null : liveViewUrl,
      callback_url: callback.url,
      artifact_policy: envelope.artifact_policy,
      capture_failure_override: ports.hasFailureScreenshotOverride(envelope.steps, envelope.hooks)
    };
    const transaction = await ports.workspaceTransactionService.createTransaction({
      project_id: plan.execution.project_id,
      app_type_id: plan.execution.app_type_id || null,
      category: "automation",
      action: "testengine_run",
      status: "running",
      title: `Local run for ${item.case_snapshot.test_case_title}`,
      description: isApiOnlyRun
        ? "Running immediately on the local Test Engine API runner."
        : "Running immediately on the local Playwright host recorder.",
      metadata: transactionMetadata,
      related_kind: "testengine_run",
      related_id: item.engine_run_id,
      created_by: initiatedBy || plan.execution.created_by || null,
      started_at: new Date().toISOString()
    });

    await ports.workspaceTransactionService.appendTransactionEvent(transaction.id, {
      level: "info",
      phase: "local-run.started",
      message: `Started ${item.case_snapshot.test_case_title} on the ${isApiOnlyRun ? "local API runner" : "local Playwright runner"}.`,
      details: {
        execution_id: plan.execution.id,
        test_case_id: item.case_snapshot.test_case_id,
        engine_run_id: item.engine_run_id,
        engine_host: engineHost,
        live_view_url: isApiOnlyRun ? null : liveViewUrl
      }
    });

    let response;
    try {
      response = await ports.resilientHttpRequest(`${engineHost}/api/v1/runs`, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-hellotest-testengine-secret": dispatchSecret
        },
        body: JSON.stringify(envelope)
      }, {
        dependency: "test-engine",
        operation: "run.dispatch",
        deadlineMs: ports.DIRECT_DISPATCH_TIMEOUT_MS,
        maxAttempts: 1,
        maxResponseBytes: 1024 * 1024,
        maxConcurrent: 32,
        failureThreshold: 6,
        resetTimeoutMs: 15_000
      });
    } catch (error) {
      await ports.updateQueueTransaction(transaction.id, {
        status: "running",
        metadata: {...transactionMetadata,acknowledgement:"unknown",failure_code:"LOCAL_DISPATCH_UNCERTAIN"}
      });
      const message = "The local runner acknowledgement was lost. Keep this run receipt and inspect incoming results before starting another run.";
      throw Object.assign(new Error(message), {code:"LOCAL_DISPATCH_UNCERTAIN",statusCode:502,publicMessage:message});
    }

    const payload = await ports.readBoundedResponseJson(response, {
      maxBytes: 1024 * 1024,
      label: "Test Engine response"
    }).catch(() => null);
    if (!response.ok) {
      const failure = ports.serviceError(ports.SERVICE_ERROR_CODES.UPSTREAM_REJECTED, {
        dependency: "test-engine",
        operation: "run.dispatch",
        retryable: response.status === 429 || response.status >= 500,
        statusCode: response.status === 429 || response.status >= 500 ? 503 : 502,
        upstreamStatus: response.status
      });
      failure.publicMessage = [401, 403].includes(response.status)
        ? "The local runner rejected the HelloTest credentials. Restart the host recorder using the same HELLOTEST_TESTENGINE_SECRET as the HelloTest API, then check the runner connection."
        : response.status === 429
          ? "The local runner is at capacity. Wait for its current cases to finish before retrying this case."
          : "The local runner could not start this case. Check its terminal or local-run/artifacts/host-recorder/launcher.log for startup errors, and ensure the runner matches this HelloTest version.";
      await ports.updateQueueTransaction(transaction.id, {
        status: "failed",
        metadata: {
          ...transactionMetadata,
          failure: failure.code,
          upstream_status: response.status
        },
        completed_at: new Date().toISOString()
      });
      throw failure;
    }
  }

  return {
    automated_case_count: plan.automated_case_count,
    local_run_count: plan.eligibleCases.length,
    queued_for_engine_count: 0,
    manual_case_count: plan.manual_case_count,
    unsupported_automated_case_count: plan.unsupported_automated_case_count,
    warnings: plan.warnings
  };
}


async function queueSingleStepDispatch({
  execution,
  caseSnapshot,
  stepSnapshot,
  integration,
  initiatedBy,
  capturedValues = {},
  existingLogs = null,
  dataSetIteration = null
} = {}) {
  if (!execution || !caseSnapshot || !stepSnapshot) {
    throw new Error("Execution, test case, and step snapshots are required for step handoff");
  }

  const [project, appType] = await Promise.all([
    ports.selectProject.get(execution.project_id),
    execution.app_type_id ? ports.selectAppType.get(execution.app_type_id) : Promise.resolve(null)
  ]);

  if (!project) {
    throw new Error("Execution project not found");
  }

  if (!integration) {
    throw new Error("Configure an active Test Engine integration for this project before running web automation steps.");
  }

  const stepType = ports.resolveEngineStepType(stepSnapshot.step_type, appType?.type || null);

  if (stepType !== "web") {
    throw new Error("Only web execution steps can be handed off to Test Engine from the execution console");
  }

  const savedStep = {
    id: stepSnapshot.snapshot_step_id,
    order: stepSnapshot.step_order,
    step_type: stepType,
    action: ports.normalizeText(stepSnapshot.action),
    expected_result: ports.normalizeText(stepSnapshot.expected_result),
    automation_code: ports.normalizeRichText(stepSnapshot.automation_code),
    api_request: null,
    shared_parameter_values: ports.normalizeStringRecord(stepSnapshot.shared_parameter_values),
    group_name: ports.normalizeText(stepSnapshot.group_name),
    group_kind: stepSnapshot.group_kind === "local" || stepSnapshot.group_kind === "reusable"
      ? stepSnapshot.group_kind
      : null
  };
  const executablePlan = await require(".././automationReadiness.service").prepareExecutablePlan([savedStep], { requireExpectedAssertions: false });
  if (executablePlan.issues.length) throw Object.assign(new Error(`Automation is not executable. ${executablePlan.issues.join(' ')}`), {
    code: 'AUTOMATION_SAVED_PLAN_INVALID', statusCode: 422, validation_feedback: executablePlan.issues
  });
  const step = executablePlan.steps[0];
  const engineRunId = ports.uuid();
  const objectRepository = await ports.listObjectRepositoryForEnvelope({
    projectId: execution.project_id,
    appTypeId: execution.app_type_id,
    testCaseId: caseSnapshot.test_case_id
  });
  const envelope = await ports.buildEngineEnvelope({
    engineRunId,
    execution,
    project,
    appType,
    caseSnapshot,
    steps: [step],
    integration,
    objectRepository,
    dataSetIteration,
    initiatedBy
  });
  const activeWebEngine = envelope.web_engine?.active || "playwright";
  const orchestrationClass = ports.resolveOrchestrationClass([step, ...(envelope.hooks || []).flatMap(hook => hook.steps)], appType?.type || "web");
  const stepEngineClasses = ports.resolveStepEngineClasses([step], appType?.type || "web");
  const integrationConfig = integration?.config && typeof integration.config === "object" && !Array.isArray(integration.config)
    ? integration.config
    : {};
  const engineWorkerCaps = ports.resolveIntegrationEngineWorkerCaps(integrationConfig);
  const engineMaxWorkers = engineWorkerCaps[orchestrationClass] || ports.getQueueMaxWorkers(orchestrationClass);
  envelope.engine_worker_caps = engineWorkerCaps;
  envelope.step_engine_classes = stepEngineClasses;
  envelope.orchestration_class = orchestrationClass;
  const liveViewUrl = ports.buildProviderLiveViewUrl(integration, activeWebEngine);
  const transaction = await ports.workspaceTransactionService.createTransaction({
    project_id: execution.project_id,
    app_type_id: execution.app_type_id || null,
    category: "automation",
    action: "testengine_run",
    status: "queued",
    title: `Live step handoff for ${caseSnapshot.test_case_title}`,
    description: `Queued step ${step.order} for Test Engine execution.`,
    metadata: {
      source: "hellotest.execution-console",
      single_step: true,
      engine_run_id: engineRunId,
      execution_id: execution.id,
      test_case_id: caseSnapshot.test_case_id,
      data_set_iteration_index: dataSetIteration?.index ?? null,
      data_set_iteration_key: dataSetIteration?.key || null,
      step_id: step.id,
      engine_host: ports.normalizeEngineHostUrl(integration.base_url),
      queue_mode: "hellotest-pull",
      orchestration_class: orchestrationClass,
      step_engine_classes: stepEngineClasses,
      engine_max_workers: engineMaxWorkers,
      active_web_engine: activeWebEngine,
      live_view_url: liveViewUrl
    },
    related_kind: "testengine_run",
    related_id: engineRunId,
    created_by: initiatedBy || execution.created_by || null,
    started_at: new Date().toISOString()
  });
  const jobId = ports.uuid();
  const runtimeLogs = ports.parseStructuredLogs(existingLogs);
  const runtimeCapturedValues = ports.normalizeFrozenCapturedValues(capturedValues, execution.parameter_scope_default);
  delete runtimeLogs.stepStatuses[step.id];

  await ports.workspaceTransactionService.appendTransactionEvent(transaction.id, {
    level: "info",
    phase: "dispatch.step-queued",
    message: `Queued ${caseSnapshot.test_case_title} step ${step.order} for Test Engine execution.`,
    details: {
      execution_id: execution.id,
      test_case_id: caseSnapshot.test_case_id,
      step_id: step.id,
      engine_run_id: engineRunId
    }
  });

  await ports.insertJob.run(
    jobId,
    engineRunId,
    integration.id || null,
    execution.project_id,
    execution.app_type_id || null,
    appType?.type || "web",
    orchestrationClass,
    engineMaxWorkers,
    execution.id,
    caseSnapshot.test_case_id,
    caseSnapshot.test_case_title,
    transaction.id,
    ports.normalizeEngineHostUrl(integration.base_url),
    envelope,
    {
      captured_values: runtimeCapturedValues,
      logs: runtimeLogs
    },
    "queued",
    0,
    null,
    null,
    null,
    null,
    null,
    initiatedBy || execution.created_by || null
  );

  return {
    job_id: jobId,
    engine_run_id: engineRunId,
    transaction_id: transaction.id,
    active_web_engine: activeWebEngine,
    live_view_url: liveViewUrl
  };
}
return { planExecutionDispatch, settleExecutionIfComplete, queueExecutionDispatch, localPlaywrightIntegration, preparePairedLocalDispatch, runExecutionDirectLocal, queueSingleStepDispatch };
}
module.exports = { createExecutionPlanning };
