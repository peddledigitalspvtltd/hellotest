const { isDeepStrictEqual } = require('node:util');
const { compileRecordedProgram } = require('./automationRecordedProgram');
const { isInteractiveOperation: interaction } = require('./automationVerificationContract');
/** Only interactive action locators can change. Every assertion and navigation
 * stays byte-identical in the operation ledger and must pass the fresh rerun. */
function applyLocatorRepair(sections, failure, proposal, snapshot) {
    if (!proposal || Object.keys(proposal).sort().join(',') !== 'locator,operation_index,step_id' || proposal.step_id !== failure.step_id || proposal.operation_index !== failure.operation_index || typeof proposal.locator !== 'string' || proposal.locator.length > 2000)
        return null;
    const section = sections.find(row => row.step_id === proposal.step_id), operation = section?.operations[proposal.operation_index - 1];
    if (!operation?.arguments.locator || !interaction(operation))
        return null;
    const targets = (snapshot?.elements || []).filter(row => row.locators_validated === true && row.locator_candidates?.includes(proposal.locator));
    if (targets.length !== 1 || proposal.locator === operation.arguments.locator)
        return null;
    const candidate = structuredClone(sections), row = candidate.find(item => item.step_id === proposal.step_id);
    // Repair only actions using this exact old locator in the same section.
    // An assertion sharing that locator remains the original oracle; if it no
    // longer resolves or passes, the rerun cannot commit this candidate.
    for (const item of row.operations)
        if (interaction(item) && item.arguments.locator === operation.arguments.locator)
            item.arguments.locator = proposal.locator;
    const compiled = compileRecordedProgram(row.operations);
    if (!compiled)
        return null;
    row.automation_code = compiled.source;
    for (let s = 0; s < sections.length; s++)
        for (let n = 0; n < sections[s].operations.length; n++) {
            const before = sections[s].operations[n], after = candidate[s].operations[n];
            if (!interaction(before) && !isDeepStrictEqual(before, after))
                return null;
            if (!isDeepStrictEqual({ ...before, arguments: { ...before.arguments, locator: undefined } }, { ...after, arguments: { ...after.arguments, locator: undefined } }))
                return null;
        }
    return candidate;
}
module.exports = { applyLocatorRepair };
