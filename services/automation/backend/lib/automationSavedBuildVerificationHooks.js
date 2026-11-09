const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { createVerificationRepairContext } = require('./automationVerificationRepairContext');

/** Shared domain hooks for both saved-build paths. The verification pipeline
 * retains authority over replay safety, one locator repair and unchanged oracles;
 * commitBuild retains the domain source/data/context locks. */
function createSavedBuildVerificationHooks({ assertBuildAccess, getVerificationAccess, parameterResolver,
  featureKey, completeRepair, parseResponse, getBuild, commitBuild, signal }) {
  const assertAccess = async () => {
    signal?.throwIfAborted();
    await assertBuildAccess();
    const permissions = await getVerificationAccess(['automation.run.local', 'run.create']);
    if (!permissions['automation.run.local'] || !permissions['run.create']) {
      throw Object.assign(new Error('Verification access changed.'), { statusCode: 403 });
    }
    signal?.throwIfAborted();
  };
  return {
    assertAccess,
    diagnose: async ({ sections, failure, snapshot }) => {
      await assertAccess();
      const section = sections.find(row => row.step_id === failure.step_id);
      const packet = { requirement: { step_id: section.step_id, action: section.action, expected_result: section.expected_result },
        failed_operation: section.operations[failure.operation_index - 1], failure, snapshot };
      const projected = JSON.parse(parameterResolver.redactResult({ content: [{ type: 'text', text: JSON.stringify(packet) }] }).content[0].text);
      const repairContext = createVerificationRepairContext({ featureKey, requirement: projected.requirement,
        failedOperation: projected.failed_operation, failure: projected.failure, snapshot: projected.snapshot });
      if (!repairContext.packet.current_snapshot.targets.length) return {};
      const prompt = [aiInstructionBlock(featureKey, 'automationBrowserAgent.verificationRepair'), JSON.stringify(repairContext.packet)].join('\n\n');
      const response = await completeRepair({ prompt, timeoutMs: 30_000, generationScope: 'verification_repair',
        sectionId: section.step_id, beforeDispatch: assertAccess });
      await assertAccess();
      return repairContext.resolveProposal(parseResponse(response));
    },
    commitRepair: async ({ before, after }) => {
      await assertAccess();
      const build = getBuild();
      const sources = new Map(after.map(row => [row.step_id, row.automation_code]));
      const repaired = { ...build, updates: build.updates.map(update => ({ ...update,
        automation_code: sources.get(update.step.id) || update.automation_code })) };
      const replaced = new Set();
      for (let section = 0; section < before.length; section++) {
        for (let index = 0; index < before[section].operations.length; index++) {
          if (before[section].operations[index].arguments.locator !== after[section].operations[index].arguments.locator) {
            replaced.add(before[section].operations[index].arguments.locator);
          }
        }
      }
      repaired.learned_locators = (repaired.learned_locators || []).filter(row => !replaced.has(row.locator));
      return commitBuild(repaired);
    }
  };
}

module.exports = { createSavedBuildVerificationHooks };
