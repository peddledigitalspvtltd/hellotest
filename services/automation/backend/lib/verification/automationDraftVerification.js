const { prepareVerificationSections, runVerificationPipeline } = require('./automationVerificationPipeline');
const { verifyRecordedAutomation } = require('./automationVerificationClient');

async function verifyDraft({ steps, resolver, startUrl, engine, signal, assertAccess, onProgress, liveValidation }) {
  const reportBlocked = async (errorCode, message) => {
    const result = { status: 'blocked', phase: 'complete', mode: 'verify', attempts: 0, error_code: errorCode, message };
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
    return reportBlocked(error.code || 'AUTOMATION_VERIFICATION_UNSUPPORTED', 'Use the full case runner to verify this draft’s source and execution options.');
  }
  let dispatched = false, result;
  try {
    result = await runVerificationPipeline({
      mode: 'verify', sections: prepared.sections, parameters: prepared.parameters,
      startUrl, signal, assertCurrent: assertAccess,
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
  return { ...result, outcome_unknown: dispatched && (!result.execution_status || ['unknown', 'timed_out'].includes(result.execution_status)) };
}

module.exports = { verifyDraft };
