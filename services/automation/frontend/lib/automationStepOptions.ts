import type { TestStep } from "@hellotest/platform/frontend/src/types";

export type AutomationStepOptions = {
  screenshotOnFailure: boolean;
  optional: boolean;
  skip: boolean;
  timeoutMs: number | null;
};

export function parseAutomationStepOptions(step: Pick<TestStep, "automation_code" | "action">): AutomationStepOptions {
  const code = step.automation_code || step.action || "";
  const optionMatch = code.match(/^\s*\/\/\s*@hellotest-options\s+([^\r\n]*)/i);
  const flags = new Set((optionMatch?.[1] || "").split(/\s+/).filter(Boolean));
  const timeout = optionMatch?.[1].match(/(?:^|\s)timeoutMs=(\d+)(?:\s|$)/i);
  const parsedTimeout = timeout ? Number(timeout[1]) : NaN;

  return {
    screenshotOnFailure: flags.has("screenshotOnFailure"),
    optional: flags.has("optional"),
    skip: flags.has("skip"),
    timeoutMs: Number.isInteger(parsedTimeout) && parsedTimeout >= 250 && parsedTimeout <= 120000 ? parsedTimeout : null
  };
}

export function applyAutomationStepOptions(code: string, options: AutomationStepOptions) {
  const cleaned = code.replace(/^\s*\/\/\s*@hellotest-options\s+[^\n]*\n?/i, "").trim();
  const flags = [
    options.screenshotOnFailure ? "screenshotOnFailure" : "",
    options.optional ? "optional" : "",
    options.skip ? "skip" : "",
    options.timeoutMs && Number.isInteger(options.timeoutMs) && options.timeoutMs >= 250 && options.timeoutMs <= 120000 ? `timeoutMs=${options.timeoutMs}` : ""
  ].filter(Boolean);

  return flags.length ? `// @hellotest-options ${flags.join(" ")}\n${cleaned}` : cleaned;
}
