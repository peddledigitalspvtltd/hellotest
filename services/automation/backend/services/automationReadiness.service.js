const vm = require("node:vm");
const { normalizeGeneratedProgram, hasExecutableAssertion } = require('../lib/automationGeneratedProgram');
const { validateGeneratedApiRequest, inferAutomationStepType } = require('@hellotest/platform/backend/src/utils/testStepAutomation');

// Historical manual/untyped rows use the existing inferred runtime policy.
// Unknown explicit runtimes must not bypass Web/API validation.
function executableStepType(step) {
  const type = String(step.step_type || '').trim().toLowerCase();
  if (['web', 'api', 'android', 'ios'].includes(type)) return type;
  return !type || type === 'manual' ? inferAutomationStepType(step) : null;
}

/** Build quality may require authored assertions. Run admission checks whether
 * the saved instructions can execute; prose expectations cannot add checks. */
function inspectExecutablePlan(steps, { requireExpectedAssertions = true } = {}) {
  const issues = [];
  let active = 0;
  for (const step of steps) {
    const source = String(step.automation_code || "");
    const flags = source.match(/^\s*\/\/\s*@hellotest-options\s+([^\r\n]*)/i)?.[1].split(/\s+/) || [];
    if (flags.includes("skip")) continue;
    active += 1;
    const prefix = `Step ${step.order || step.step_order || "?"}`;
    const stepType = executableStepType(step);
    if (!stepType) { issues.push(`${prefix}: unsupported automation runtime ${String(step.step_type)}.`); continue; }
    if (stepType === "api") {
      const request = step.api_request;
      try { validateGeneratedApiRequest(request, { stepOrder: step.order || step.step_order, expectedResult: requireExpectedAssertions ? step.expected_result : undefined }); }
      catch (error) { issues.push(`${prefix}: ${error.message}`); }
      continue;
    }
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "").trim();
    if (!executable) { issues.push(`${prefix}: executable instructions are missing.`); continue; }
    try {
      let body=source;
      if (stepType === 'web') {
        try { body=normalizeGeneratedProgram(source); }
        catch (error) {
          // Anonymous reusable functions are valid runtime expressions too.
          try { body=normalizeGeneratedProgram(`(${source});`); }
          catch { throw error; }
        }
      }
      new vm.Script(`(async function () {\n${body}\n})`, { filename: `automation-step-${step.id || "unknown"}.js` });
      if (requireExpectedAssertions && stepType === 'web' && String(step.expected_result || '').trim() && !hasExecutableAssertion(body)) {
        issues.push(`${prefix}: the expected result needs an executable assertion in its saved instructions.`);
      }
    }
    catch (error) { issues.push(error.code==='AUTOMATION_RUNNER_MATCHER_UNSUPPORTED'?`${prefix}: ${error.message}`:`${prefix}: invalid JavaScript (${error.message}).`); }
  }
  if (steps.length && !active) issues.push("All automation steps are skipped.");
  return issues;
}

/** Run the linked source as saved, including whatever assertions it contains.
 * Missing instructions, invalid syntax and unsupported runtimes still block.
 * Frozen expectations remain specification and never manufacture assertions. */
async function prepareExecutablePlan(steps, { requireExpectedAssertions = false } = {}) {
  const { canonicalizeSavedLocatorWrappers } = await import('../../shared/automationProgramCompatibility.mjs');
  let normalizedLocatorCount = 0;
  const prepared = steps.map(step => {
    const type = executableStepType(step);
    const typed = type && step.step_type !== type ? { ...step, step_type: type } : step;
    if (type !== 'web' || typeof step.automation_code !== 'string') return typed;
    const normalized = canonicalizeSavedLocatorWrappers(step.automation_code);
    normalizedLocatorCount += normalized.changed;
    return normalized.changed ? { ...typed, automation_code: normalized.source } : typed;
  });
  return { steps: prepared, issues: inspectExecutablePlan(prepared, { requireExpectedAssertions }), normalizedLocatorCount };
}

module.exports = { inspectExecutablePlan, prepareExecutablePlan };
