const { verificationFailure: fail, isVerificationRecord: record, isInteractiveOperation: interaction } = require('./automationVerificationContract');
function validateVerificationReceipt(receipt, verificationId, sections, executionDriver = 'native') {
    const invalid = () => { throw fail('AUTOMATION_VERIFICATION_INVALID_RECEIPT', 'The verifier did not return a complete, matching execution receipt.'); };
    const operations = sections.flatMap(section => section.operations.map((operation, index) => ({ step_id: section.step_id, operation_index: index + 1, operation })));
    if (!record(receipt) || receipt.schema_version !== 1 || receipt.verification_id !== verificationId || receipt.browser !== 'chromium'
        || receipt.execution_driver !== undefined && receipt.execution_driver !== executionDriver
        || executionDriver === 'playwright_test_cli' && receipt.execution_driver !== 'playwright_test_cli'
        || !['passed', 'failed', 'skipped', 'unknown', 'cancelled', 'timed_out'].includes(receipt.status)
        || !['verified', 'unverified'].includes(receipt.verification_status) || typeof receipt.replay_safe !== 'boolean'
        || !Number.isSafeInteger(receipt.completed_operations) || receipt.completed_operations < 0 || receipt.completed_operations > operations.length
        || !Number.isSafeInteger(receipt.completed_interactions) || !Number.isSafeInteger(receipt.assertion_count)
        || !Number.isSafeInteger(receipt.duration_ms) || receipt.duration_ms < 0)
        invalid();
    const prefix = operations.slice(0, receipt.completed_operations);
    if (receipt.completed_interactions !== prefix.filter(row => interaction(row.operation)).length
        || receipt.assertion_count !== prefix.filter(row => row.operation.name === 'browser_assert').length
        || receipt.replay_safe && receipt.completed_interactions !== 0)
        invalid();
    if (receipt.status === 'passed') {
        if (receipt.verification_status !== 'verified' || receipt.completed_operations !== operations.length || receipt.failure !== undefined)
            invalid();
        return receipt;
    }
    if (receipt.verification_status !== 'unverified')
        invalid();
    const failure = receipt.failure;
    // Cancellation before browser startup legitimately has no active operation.
    if (!failure) {
        if (receipt.status !== 'cancelled' || receipt.completed_operations !== 0)
            invalid();
        return receipt;
    }
    if (!record(failure) || !Number.isSafeInteger(failure.operation_index) || typeof failure.code !== 'string' || !/^[A-Z][A-Z0-9_]{1,99}$/.test(failure.code)
        || !['not_attempted', 'unknown', 'completed'].includes(failure.action_outcome)
        || receipt.status === 'unknown' && (failure.action_outcome !== 'unknown' || receipt.replay_safe)
        || receipt.status !== 'unknown' && failure.action_outcome === 'unknown')
        invalid();
    if (receipt.status === 'skipped') {
        const firstUnsafe = operations.find(row => interaction(row.operation));
        if (receipt.completed_operations !== 0 || !firstUnsafe || failure.step_id !== firstUnsafe.step_id || failure.operation_index !== firstUnsafe.operation_index
            || failure.operation_kind !== firstUnsafe.operation.name || failure.code !== 'AUTOMATION_VERIFICATION_RESET_REQUIRED' || failure.action_outcome !== 'not_attempted')
            invalid();
    }
    else if (failure.operation_index === 0) {
        if (receipt.completed_operations !== 0 || failure.step_id !== sections[0].step_id || failure.operation_kind !== 'browser_navigate')
            invalid();
    }
    else {
        const next = operations[receipt.completed_operations];
        if (!next || failure.step_id !== next.step_id || failure.operation_index !== next.operation_index || failure.operation_kind !== next.operation.name)
            invalid();
    }
    return receipt;
}
module.exports = { validateVerificationReceipt };
