import { parseAutomationKeywordCall } from "./automationKeywordInputs";

/** Describe supported calls without changing, evaluating or dropping their source. */
export function summarizeAutomationInstruction(line: string) {
  if (!/^\s*(?:await\s+)?(?:web|api|mobile|android|ios)\.\w+\([\s\S]*\)\s*;?\s*$/.test(line) || /\);\s*\S/.test(line)) return null;
  const call = parseAutomationKeywordCall(line);
  if (!call) return null;
  const [platform, operation] = call.keyword.split(".");
  if (!operation || !["web", "api", "mobile", "android", "ios"].includes(platform)) return null;
  const aliases: Record<string, string> = { goto: "Open URL", expectText: "Expect text", expectVisible: "Expect visible", expectValue: "Expect value", expectStatus: "Expect status", expectJson: "Expect JSON", tapByText: "Tap text" };
  const words = operation.replace(/([a-z])([A-Z])/g, "$1 $2");
  return { label: aliases[operation] || words[0].toUpperCase() + words.slice(1), args: call.args.filter(value => value !== "") };
}
