const vm = require("node:vm");
const { normalizeGeneratedProgram, hasExecutableAssertion } = require('../lib/automationGeneratedProgram');
const { validateGeneratedApiRequest } = require('@hellotest/platform/backend/src/utils/testStepAutomation');

/** Compile source without executing it before an engine job is allocated. */
function inspectExecutablePlan(steps) {
  const issues = [];
  let active = 0;
  for (const step of steps) {
    const source = String(step.automation_code || "");
    const flags = source.match(/^\s*\/\/\s*@hellotest-options\s+([^\r\n]*)/i)?.[1].split(/\s+/) || [];
    if (flags.includes("skip")) continue;
    active += 1;
    const prefix = `Step ${step.order || step.step_order || "?"}`;
    if (step.step_type === "api") {
      const request = step.api_request;
      try { validateGeneratedApiRequest(request, { stepOrder: step.order || step.step_order, expectedResult: step.expected_result }); }
      catch (error) { issues.push(`${prefix}: ${error.message}`); }
      continue;
    }
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "").trim();
    if (!executable) { issues.push(`${prefix}: executable instructions are missing.`); continue; }
    try {
      let body=source;
      if (step.step_type === 'web') {
        try { body=normalizeGeneratedProgram(source); }
        catch (error) {
          // Anonymous reusable functions are valid runtime expressions too.
          try { body=normalizeGeneratedProgram(`(${source});`); }
          catch { throw error; }
        }
      }
      new vm.Script(`(async function () {\n${body}\n})`, { filename: `automation-step-${step.id || "unknown"}.js` });
      if (step.step_type === 'web' && String(step.expected_result || '').trim() && !hasExecutableAssertion(body)) {
        issues.push(`${prefix}: the expected result needs an executable assertion in its saved instructions.`);
      }
    }
    catch (error) { issues.push(`${prefix}: invalid JavaScript (${error.message}).`); }
  }
  if (steps.length && !active) issues.push("All automation steps are skipped.");
  return issues;
}

module.exports = { inspectExecutablePlan };
