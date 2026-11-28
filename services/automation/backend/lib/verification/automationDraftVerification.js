const { prepareVerificationSections, runVerificationPipeline } = require('./automationVerificationPipeline');
const { verifyRecordedAutomation } = require('./automationVerificationClient');

async function verifyDraft({ steps, resolver, startUrl, engine, signal, assertAccess, onProgress, liveValidation,
  mode = 'verify', executionDriver = 'native', repair }) {
  const reportBlocked = async (errorCode, message) => {
    const result = { status: 'blocked', phase: 'complete', mode, execution_driver: executionDriver, attempts: 0, error_code: errorCode, message };
    await onProgress({ phase: 'automation.agent.verification', message, details: { verification: result } });
    return result;
  };
  if (liveValidation?.status === 'blocked') return reportBlocked(
    'AUTOMATION_LIVE_VALIDATION_BLOCKED',
    'Live browser development encountered a blocker. Resolve it before verifying this draft.'
  );
  let prepared;
  try {
    prepared = prepareVerificationSections(steps, resolver);
  } catch (error) {
    if (error.code === 'AUTOMATION_VERIFICATION_EXPECTED_RESULT_UNCOVERED') return reportBlocked(error.code, error.message);
    return reportBlocked(error.code || 'AUTOMATION_VERIFICATION_UNSUPPORTED', 'Use the full case runner to verify this draft’s source and execution options.');
  }
  let dispatched = false, result;
  try {
    result = await runVerificationPipeline({
      mode, executionDriver, sourceState: 'draft', sections: prepared.sections, parameters: prepared.parameters,
      startUrl, signal, assertCurrent: assertAccess,
      diagnose: repair?.diagnose,
      commitRepair: repair?.commitRepair,
      run: async request => {
        dispatched = true;
        return verifyRecordedAutomation({ integration: engine, request, signal });
      },
      onProgress: summary => onProgress({ phase: 'automation.agent.verification', message: summary.message, details: { verification: summary } })
    });
  } catch (error) {
    if (dispatched && Object.isExtensible(error)) Object.assign(error, { effect_dispatched: true, outcome_unknown: true });
    throw error;
  }
  return { ...result, outcome_unknown: result.outcome_unknown === true || ['unknown', 'timed_out', 'cancelled'].includes(result.execution_status) };
}

module.exports = { verifyDraft };
