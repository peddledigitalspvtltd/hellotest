import type { TestStep } from "@hellotest/platform/frontend/src/types";

export type AutomationStepOptions = {
  screenshotOnFailure: boolean;
  optional: boolean;
  skip: boolean;
};

export function parseAutomationStepOptions(step: Pick<TestStep, "automation_code" | "action">): AutomationStepOptions {
  const code = step.automation_code || step.action || "";
  const optionMatch = code.match(/^\s*\/\/\s*@hellotest-options\s+([^\r\n]*)/i);
  const flags = new Set((optionMatch?.[1] || "").split(/\s+/).filter(Boolean));

  return {
    screenshotOnFailure: flags.has("screenshotOnFailure"),
    optional: flags.has("optional"),
    skip: flags.has("skip")
  };
}

export function applyAutomationStepOptions(code: string, options: AutomationStepOptions) {
  const cleaned = code.replace(/^\s*\/\/\s*@hellotest-options\s+[^\n]*\n?/i, "").trim();
  const flags = [
    options.screenshotOnFailure ? "screenshotOnFailure" : "",
    options.optional ? "optional" : "",
    options.skip ? "skip" : ""
  ].filter(Boolean);

  return flags.length ? `// @hellotest-options ${flags.join(" ")}\n${cleaned}` : cleaned;
}
