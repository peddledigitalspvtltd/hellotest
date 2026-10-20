const { isDeepStrictEqual } = require('node:util');
const { parse } = require('acorn');
const { deriveProgramTools } = require('./automationProgramTools');
const { compileRecordedProgram } = require('./automationRecordedProgram');
const { referenceKey } = require('./automationBrowserParameters');
const { normalizeLegacyFieldValidationSyntax } = require('./automationFieldValidity');
const { verificationFailure: fail } = require('./automationVerificationContract');
const syntax = value => Array.isArray(value) ? value.map(syntax) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !['start', 'end', 'loc', 'raw'].includes(key)).map(([key, item]) => [key, syntax(item)])) : value;
const ast = source => syntax(parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true }));
function prepareVerificationSections(steps, resolver, { allowLegacyFieldValidationRequirements = false } = {}) {
    if (!Array.isArray(steps) || !steps.length || steps.length > 50)
        throw fail('AUTOMATION_VERIFICATION_UNSUPPORTED', 'Verification supports one to fifty complete linear web sections.');
    const parameters = Object.create(null), sections = [];
    for (const step of steps) {
        const flags = new Set(String(step.automation_code || '').match(/^\s*\/\/\s*@hellotest-options\s+([^\r\n]*)/i)?.[1].split(/\s+/) || []);
        if (step.step_type !== 'web' || typeof step.automation_code !== 'string' || flags.has('skip') || flags.has('optional'))
            throw fail('AUTOMATION_VERIFICATION_UNSUPPORTED', 'This case includes source or execution options that the isolated verifier cannot reproduce faithfully.');
        const operations = deriveProgramTools({ payload: { steps: [{ step_id: step.id, automation_code: step.automation_code }] }, execution: { required: true, step_id: step.id } });
        // Preserve the saved representation of whole parameter bindings. Lowering
        // recognizes params["r.name"] as @r.name; restore that expression only when
        // it occurs in this exact statement, then require full AST equivalence.
        if (operations) {
            const statements = parse(step.automation_code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true }).body.filter(node => node.type === 'ExpressionStatement');
            if (statements.length === operations.length)
                for (let index = 0; index < operations.length; index++) {
                    const operation = operations[index], field = operation.name === 'browser_press_key' ? 'key' : 'value', key = referenceKey(operation.arguments[field]);
                    if (!key)
                        continue;
                    const pending = [statements[index]], bindings = [];
                    while (pending.length) {
                        const node = pending.pop();
                        if (!node || typeof node !== 'object')
                            continue;
                        if (node.type === 'MemberExpression' && node.computed && node.object?.name === 'params' && node.property?.type === 'Literal' && referenceKey(`params[${JSON.stringify(node.property.value)}]`) === key)
                            bindings.push(node);
                        for (const value of Object.values(node))
                            if (Array.isArray(value))
                                pending.push(...value);
                            else if (value && typeof value === 'object')
                                pending.push(value);
                    }
                    if (bindings.length === 1)
                        operation.arguments[field] = `params[${JSON.stringify(key)}]`;
                }
        }
        const compiled = operations && compileRecordedProgram(operations);
        if (!compiled)
            throw fail('AUTOMATION_VERIFICATION_UNSUPPORTED', 'The saved instructions are outside the closed, faithfully replayable Playwright contract.');
        const sourceSyntax = ast(step.automation_code);
        // A retained-requirement read may recognize the one exact older field
        // reader. The isolated verifier still requires exact current source by
        // default; this compatibility path never executes or rewrites saved code.
        const comparableSource = allowLegacyFieldValidationRequirements ? normalizeLegacyFieldValidationSyntax(sourceSyntax) : sourceSyntax;
        // Both shipped compiler layouts are exact contracts. Accept the previous
        // inline layout without rewriting saved code; new sections share repeated
        // locator queries and fixed validation readers. Arbitrary helper/alias
        // layouts still fail this complete-program AST comparison.
        const inline = compileRecordedProgram(operations, { layout: 'inline' });
        if (!isDeepStrictEqual(comparableSource, ast(compiled.source)) && (!inline || !isDeepStrictEqual(comparableSource, ast(inline.source))))
            throw fail('AUTOMATION_VERIFICATION_UNSUPPORTED', 'The saved instructions are outside the closed, faithfully replayable Playwright contract.');
        for (const operation of operations) {
            const field = operation.name === 'browser_press_key' ? 'key' : 'value', value = operation.arguments[field], key = referenceKey(value);
            if (key) {
                const resolved = resolver.resolve(operation.name, operation.arguments)[field];
                if (typeof resolved !== 'string')
                    throw fail('AUTOMATION_VERIFICATION_DATA_MISSING', 'A fixed browser input is unavailable.');
                parameters[key] = resolved;
            }
        }
        sections.push({ step_id: step.id, automation_code: step.automation_code, operations, step_type: step.step_type, step_order: step.step_order, group_id: step.group_id, group_kind: step.group_kind, group_name: step.group_name, reusable_group_id: step.reusable_group_id, action: step.action || '', expected_result: step.expected_result || '' });
    }
    if (!sections.some(section => section.operations.some(operation => operation.name === 'browser_assert')))
        throw fail('AUTOMATION_VERIFICATION_UNSUPPORTED', 'Verification requires an executable expected-result assertion.');
    return { sections, parameters };
}
module.exports = { prepareVerificationSections };
