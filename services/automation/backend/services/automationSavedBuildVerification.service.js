const {
  prepareVerificationSections,
  runVerificationPipeline,
  fingerprint
} = require('../lib/automationVerificationPipeline');
const { isCriticalAutomationError, reportDiagnosticFailure } = require('../lib/automationProgressDiagnostics');
const { storedAutomationCaseType } = require('@hellotest/platform/backend/src/utils/automationCaseType');

const caseFields = Object.freeze([
  'title', 'description', 'app_type_id', 'project_id', 'automation_start_url', 'execution_hooks'
]);

const sourceChanged = () => Object.assign(
  new Error('The saved source or its requirement changed during verification.'),
  { code: 'AUTOMATION_VERIFICATION_SOURCE_CHANGED' }
);

function savedState(state) {
  const snapshot = structuredClone(state);
  return {
    ...snapshot,
    sourceFingerprint: fingerprint(snapshot.steps.map(step => ({ ...step, step_id: step.id })))
  };
}

/**
 * Verify exactly the saved build. Data access, authorization, browser execution,
 * model diagnosis and persistence are ports supplied by the existing domain
 * services. This module owns their ordering and source-freshness policy only.
 *
 * A repaired baseline advances only after the domain commit succeeds. It never
 * follows a mutable UI/build object while an external verifier is running.
 */
async function verifySavedBuild(input, ports) {
  const { options, testCase, startUrl, parameterResolver, manualLinkIds, manualContext } = input;
  let summary = {
    mode: options.verification_mode,
    driver: 'mcp',
    execution_driver: options.verification_driver,
    status: 'not_requested',
    phase: 'complete',
    attempts: 0,
    repair_count: 0,
    message: 'Instructions are saved; a separate run has not been requested.'
  };
  if (options.verification_mode === 'generate_only') return summary;

  const now = ports.now || Date.now;
  const startedAt = now();
  const timings = { preparation_duration_ms: 0, source_check_duration_ms: 0, source_check_count: 0 };
  const elapsed = start => Math.max(0, now() - start);
  const assertAccess = async () => {
    input.signal?.throwIfAborted();
    await ports.assertAccess();
    input.signal?.throwIfAborted();
  };
  const report = async value => {
    summary = { ...value, ...timings };
    try {
      await ports.onProgress?.(structuredClone(summary));
    } catch (error) {
      if (input.signal?.aborted || isCriticalAutomationError(error)) throw input.signal?.reason || error;
      (ports.reportDiagnosticFailure || reportDiagnosticFailure)({
        activityId: input.activityId, operation: 'verification_progress', error
      });
    }
  };

  try {
    await assertAccess();
    let expected = savedState(input.state);
    const expectedLinks = JSON.stringify([...manualLinkIds]);
    const expectedManual = ports.manualContextKey(manualContext);
    const baselineCase = structuredClone(await ports.readCase(testCase.id));
    if (!baselineCase || baselineCase.id !== testCase.id
      || baselineCase.project_id !== testCase.project_id
      || baselineCase.app_type_id !== testCase.app_type_id) throw sourceChanged();

    const { hasConfiguredCaseExecutionHooks } = await import('../../shared/automationCaseExecutionHooks.mjs');
    if (hasConfiguredCaseExecutionHooks(baselineCase.execution_hooks)) {
      throw Object.assign(new Error('This case has linked Before/After cases. Use the full case runner to verify their setup, main sections and cleanup together.'), {
        code: 'AUTOMATION_VERIFICATION_LINKED_CASES_REQUIRED'
      });
    }
    if (expected.steps.some(step => step.group_kind && step.group_kind !== 'local' || step.reusable_group_id)) {
      throw Object.assign(new Error('Reusable execution groups require the full case runner.'), {
        code: 'AUTOMATION_VERIFICATION_UNSUPPORTED'
      });
    }
    const prepared = prepareVerificationSections(expected.steps, parameterResolver);
    timings.preparation_duration_ms = elapsed(startedAt);

    const assertCurrent = async () => {
      const checkStartedAt = now();
      try {
        await assertAccess();
        const [currentCase, currentSteps] = await Promise.all([
          ports.readCase(testCase.id), ports.readSteps(testCase.id)
        ]);
        if (!currentCase || caseFields.some(key => JSON.stringify(currentCase[key] ?? null) !== JSON.stringify(baselineCase[key] ?? null))
          || storedAutomationCaseType(currentCase) !== storedAutomationCaseType(baselineCase)
          || fingerprint(currentSteps.map(step => ({ ...step, step_id: step.id }))) !== expected.sourceFingerprint) {
          throw sourceChanged();
        }
        const [links, manual] = await Promise.all([
          ports.readManualLinkIds(testCase.id), ports.readManualContext(testCase.id)
        ]);
        if (JSON.stringify(links) !== expectedLinks || ports.manualContextKey(manual) !== expectedManual) {
          throw sourceChanged();
        }
        const parameters = await ports.readParameters(currentCase);
        const inputs = await ports.readInputs(currentCase, parameters, expected.input_context.selection);
        if (parameters.source_key !== expected.parameter_context_key || inputs.inputSourceKey !== expected.input_context.source_key) {
          throw Object.assign(new Error('The frozen test data changed during verification.'), {
            code: 'AUTOMATION_VERIFICATION_DATA_CHANGED'
          });
        }
      } finally {
        timings.source_check_count++;
        timings.source_check_duration_ms += elapsed(checkStartedAt);
      }
    };

    const result = await runVerificationPipeline({
      mode: options.verification_mode,
      executionDriver: options.verification_driver,
      sections: prepared.sections,
      parameters: prepared.parameters,
      startUrl,
      signal: input.signal,
      assertCurrent,
      run: ports.run,
      prepareRun: ports.prepareRun,
      onProgress: report,
      diagnose: async request => {
        await assertCurrent();
        const proposal = await ports.diagnose(request);
        await assertCurrent();
        return proposal;
      },
      commitRepair: async candidate => {
        await assertCurrent();
        const committedState = await ports.commitRepair(candidate);
        const next = savedState(committedState);
        if (next.sourceFingerprint !== fingerprint(candidate.after)) throw sourceChanged();
        expected = next;
      }
    });
    return { ...result, ...timings };
  } catch (error) {
    if (input.signal?.aborted || isCriticalAutomationError(error)) throw input.signal?.reason || error;
    const errorCode = /^[A-Z][A-Z0-9_]{1,99}$/.test(error?.code || '')
      ? error.code : 'AUTOMATION_VERIFICATION_UNAVAILABLE';
    await report({
      ...summary,
      status: 'blocked',
      error_code: errorCode,
      message: errorCode === 'AUTOMATION_VERIFICATION_LINKED_CASES_REQUIRED'
        ? error.message : 'Saved generation is available; this case could not be prepared for isolated verification.'
    });
    return summary;
  }
}

module.exports = { verifySavedBuild };
