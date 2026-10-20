const vm = require("node:vm");
const { normalizeGeneratedProgram } = require('../lib/automationGeneratedProgram');

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
      if (!request || typeof request.url !== "string" || !request.url.trim()) issues.push(`${prefix}: an API request URL is required.`);
      if (request?.method && !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(request.method)) issues.push(`${prefix}: the HTTP method is unsupported.`);
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
    }
    catch (error) { issues.push(`${prefix}: invalid JavaScript (${error.message}).`); }
  }
  if (steps.length && !active) issues.push("All automation steps are skipped.");
  return issues;
}

module.exports = { inspectExecutablePlan };
