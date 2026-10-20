const obs = require('@hellotest/platform/backend/src/obsDb');
const transactions = require('@hellotest/platform/backend/services/workspaceTransaction.service');

function mergeTargets(current = [], added = []) {
  return [...new Set([...current, ...added].filter(id => typeof id === 'string' && id.length > 0))];
}

/** Targets come from authorized case preparation, never model-generated IDs. */
async function registerTarget(transactionId, testCaseId) {
  if (!transactionId) return;
  return obs.transaction(async () => {
    const row = await obs.prepare('SELECT metadata FROM workspace_transactions WHERE id=? FOR UPDATE').get(transactionId);
    if (!row) throw new Error('The automation activity is no longer available.');
    await transactions.updateTransaction(transactionId, {
      metadata: { output_test_case_ids: mergeTargets(row.metadata?.output_test_case_ids, [testCaseId]) }
    });
  })();
}

module.exports = { mergeTargets, registerTarget };
