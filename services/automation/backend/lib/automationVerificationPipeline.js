const { randomUUID } = require('node:crypto');
const { fingerprint, verificationFailure: fail, isInteractiveOperation: interaction } = require('./automationVerificationContract');
const { validateVerificationReceipt } = require('./automationVerificationReceipt');
const { prepareVerificationSections } = require('./automationVerificationSections');
const { applyLocatorRepair } = require('./automationVerificationLocatorRepair');
const { isCriticalAutomationError } = require('./automationProgressDiagnostics');
/** One explicit verification, at most one diagnosis and one bounded repair.
 * No whole-case provider regeneration, silent data changes or uncertain replay. */
async function runVerificationPipeline({ mode = 'generate_only', driver = 'mcp', executionDriver = 'native', sections, parameters, startUrl, signal, run, prepareRun, diagnose, commitRepair, assertCurrent = async () => { }, onProgress = async () => { } }) {
    if (!['native', 'playwright_test_cli'].includes(executionDriver))
        throw fail('AUTOMATION_VERIFICATION_DRIVER_INVALID', 'Choose a supported isolated execution driver.');
    let current = structuredClone(sections), attempts = 0, repairs = 0;
    let summary = { mode, status: 'not_requested', phase: 'complete', attempts, repair_count: repairs, driver, execution_driver: executionDriver, browser: 'chromium', source_fingerprint: fingerprint(current), message: 'Instructions are saved; a separate run has not been requested.' };
    if (mode === 'generate_only')
        return summary;
    const report = async (status, phase, message, extra = {}) => { summary = { ...summary, status, phase, message, attempts, repair_count: repairs, ...extra }; await onProgress(structuredClone(summary)); };
    const execute = async (policy) => {
        await assertCurrent();
        attempts++;
        const verificationId = randomUUID();
        await report('running', attempts === 1 ? 'verify' : 'rerun', attempts === 1 ? 'Running the saved instructions in a fresh browser.' : 'Running the bounded locator repair in a fresh browser.', { verification_id: verificationId });
        // Resolve read-only transport dependencies before the final freshness
        // check. Progress persistence and integration lookup can both await.
        const dispatch = prepareRun ? await prepareRun() : run;
        await assertCurrent();
        const receipt = await dispatch({ schema_version: 1, verification_id: verificationId, lease_token: randomUUID(), start_url: startUrl, execution_driver: executionDriver, parameters: structuredClone(parameters), sections: current.map(({ step_id, automation_code, operations }) => ({ step_id, automation_code, operations })), timeout_ms: 60000, replay_policy: policy });
        await assertCurrent();
        validateVerificationReceipt(receipt, verificationId, current, executionDriver);
        const failure = receipt.failure;
        summary = { ...summary, completed_operations: Number(receipt.completed_operations) || 0, assertion_count: Number(receipt.assertion_count) || 0, duration_ms: Number(receipt.duration_ms) || 0, ...(failure ? { failure: { step_id: failure.step_id, operation_index: failure.operation_index, code: failure.code, action_outcome: failure.action_outcome } } : { failure: undefined }) };
        return receipt;
    };
    try {
        let receipt = await execute({ mode: 'authorized_run', allow_mutations: true });
        if (receipt.status === 'passed' && receipt.verification_status === 'verified') {
            await report('passed', 'complete', 'The exact saved instructions passed an isolated Chromium run.');
            return summary;
        }
        if (mode !== 'verify_repair' || !receipt.failure || ['unknown', 'cancelled', 'timed_out'].includes(receipt.status)) {
            await report(receipt.status === 'skipped' ? 'blocked' : 'failed', 'complete', 'The isolated run did not pass. Confirmed generation remains saved.');
            return summary;
        }
        const failure = receipt.failure;
        // Never repair an oracle or an unknown mutation. A lookup failed before the
        // interaction is the only first version repair boundary.
        const failedOperation = current.find(section => section.step_id === failure.step_id)?.operations[failure.operation_index - 1];
        if (!failedOperation || !interaction(failedOperation) || failure.action_outcome !== 'not_attempted' || failure.code !== 'AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED' || !receipt.snapshot) {
            await report('blocked', 'complete', 'This failure needs review; its assertion, data or application behavior cannot be changed automatically.');
            return summary;
        }
        if (receipt.completed_interactions !== 0 || receipt.replay_safe !== true) {
            await report('blocked', 'complete', 'A locator lookup failed without safe replay evidence. Another run needs a verified fixture reset; no model repair or source change was attempted.');
            return summary;
        }
        await report('running', 'diagnose', 'Reviewing the failed operation against its authored requirement and current browser evidence.');
        let proposal;
        try {
            proposal = await diagnose({ sections: structuredClone(current), failure: structuredClone(failure), snapshot: structuredClone(receipt.snapshot) });
        }
        catch (error) {
            if (error instanceof SyntaxError || error?.code === 'AI_INVALID_JSON')
                throw fail('AUTOMATION_VERIFICATION_REPAIR_INVALID', 'The locator diagnosis did not return a supported repair proposal.');
            throw error;
        }
        const candidate = applyLocatorRepair(current, failure, proposal, receipt.snapshot);
        if (!candidate) {
            await report('blocked', 'complete', 'No supported locator repair was established from the observed evidence.', { error_code: 'AUTOMATION_VERIFICATION_REPAIR_INVALID' });
            return summary;
        }
        const previous = current;
        current = candidate;
        repairs = 1;
        await report('running', 'repair', 'Prepared one locator correction while preserving actions, data and assertions.');
        receipt = await execute({ mode: 'authorized_run', allow_mutations: true });
        if (receipt.status === 'passed' && receipt.verification_status === 'verified') {
            await assertCurrent();
            await commitRepair({ before: previous, after: current });
            await assertCurrent();
            await report('passed', 'complete', 'The bounded locator repair passed an isolated run and was saved.', { source_fingerprint: fingerprint(current) });
        }
        else
            await report('failed', 'complete', 'The repaired candidate did not pass. Original saved instructions were retained.', { source_fingerprint: fingerprint(previous) });
        return summary;
    }
    catch (error) {
        if (signal?.aborted || isCriticalAutomationError(error))
            throw signal?.reason || error;
        await report('blocked', 'complete', 'Verification could not establish a current execution result. Saved generation remains available.', { error_code: /^[A-Z][A-Z0-9_]{1,99}$/.test(error?.code || '') ? error.code : 'AUTOMATION_VERIFICATION_UNAVAILABLE' });
        return summary;
    }
}
module.exports = { prepareVerificationSections, applyLocatorRepair, runVerificationPipeline, fingerprint, validateVerificationReceipt };
