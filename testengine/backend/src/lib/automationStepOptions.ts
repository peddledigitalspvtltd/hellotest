import type { EngineRunStep } from "../contracts/hellotest.js";

export const automationStepOptions = (step: Pick<EngineRunStep, "automation_code">) => {
  // Only an editor-owned leading directive is configuration. Strings and later
  // comments in executable source must never change execution semantics.
  const directive = String(step.automation_code || "").match(/^\s*\/\/\s*@hellotest-options\s+([^\r\n]*)/i)?.[1] || "";
  const flags = new Set(directive.split(/\s+/).filter(Boolean));
  const timeout = directive.match(/(?:^|\s)timeoutMs=(\d+)(?:\s|$)/i);
  const timeoutValue = timeout ? Number(timeout[1]) : NaN;
  const timeoutMs = Number.isInteger(timeoutValue) && timeoutValue >= 250 && timeoutValue <= 120_000 ? timeoutValue : undefined;
  return { skip: flags.has("skip"), optional: flags.has("optional"), screenshotOnFailure: flags.has("screenshotOnFailure"), ...(timeoutMs ? { timeoutMs } : {}) };
};

export const optionalStepFailureNote = (note?: string | null) =>
  `Optional section failed; execution continued.\n${note || "Inspect the section failure details."}`;
