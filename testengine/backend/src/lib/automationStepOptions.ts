import type { EngineRunStep } from "../contracts/hellotest.js";

export const automationStepOptions = (step: Pick<EngineRunStep, "automation_code">) => {
  // Only an editor-owned leading directive is configuration. Strings and later
  // comments in executable source must never change execution semantics.
  const flags = new Set(String(step.automation_code || "").match(/^\s*\/\/\s*@hellotest-options\s+([^\r\n]*)/i)?.[1].split(/\s+/) || []);
  return { skip: flags.has("skip"), optional: flags.has("optional"), screenshotOnFailure: flags.has("screenshotOnFailure") };
};

export const optionalStepFailureNote = (note?: string | null) =>
  `Optional section failed; execution continued.\n${note || "Inspect the section failure details."}`;
