import { parse } from "acorn";

const MAX_SOURCE_LENGTH = 64_000;
const MAX_STATEMENTS = 250;
const MAX_RECOVERY_ATTEMPTS = 2;
const MAX_RECOVERY_DELAY_MS = 5_000;
const locatorMethods = new Set(["locator", "getByRole", "getByLabel", "getByPlaceholder", "getByText", "getByTestId", "getByTitle", "getByAltText"]);
const locatorIndices = new Set(["first", "last", "nth"]);
const readMethods = new Set(["textContent", "innerText", "inputValue", "getAttribute", "count", "isVisible", "isHidden", "isEnabled", "isDisabled", "isChecked"]);
const matchers = new Set(["toBeVisible", "toBeHidden", "toBeEnabled", "toBeDisabled", "toBeChecked", "toBeAttached", "toHaveText", "toContainText", "toHaveURL", "toHaveTitle", "toHaveAttribute", "toHaveCount", "toHaveValue", "toHaveValues", "toHaveClass", "toHaveCSS", "toHaveJSProperty", "toBe", "toEqual", "toContain", "toMatch"]);
const member = (node: any): string | undefined => node?.type === "MemberExpression" && !node.computed && !node.optional ? node.property.name : undefined;

type ReadOnlyProgram = { assertion_count: number; maximum_wait_ms: number };

/** Prove a small read-only assertion grammar, rather than guessing that an
 * arbitrary script is safe because a mutation name is absent from its text.
 * Unknown helpers, captures, evaluation callbacks and navigation never confer
 * replay permission. Native Playwright assertions already retry internally. */
export function inspectReadOnlyAutomationProgram(source: unknown, assertionTimeoutMs: number): ReadOnlyProgram | null {
  if (typeof source !== "string" || !source.trim() || source.length > MAX_SOURCE_LENGTH) return null;
  let tree: any;
  try { tree = parse(source, { ecmaVersion: "latest", allowAwaitOutsideFunction: true }); }
  catch { return null; }
  if (tree.body.length > MAX_STATEMENTS) return null;
  const aliases = new Set<string>();
  let assertions = 0, maximumWait = 0;
  const page = (node: any): boolean => node?.type === "Identifier" && ["page", "playwrightPage"].includes(node.name);
  const value = (node: any, depth = 0): boolean => {
    if (!node || depth > 12) return false;
    if (node.type === "Literal") return node.value === null || ["string", "boolean", "number"].includes(typeof node.value) || Boolean(node.regex);
    if (node.type === "Identifier") return node.name === "undefined";
    if (node.type === "TemplateLiteral") return node.expressions.length === 0;
    if (node.type === "UnaryExpression") return ["-", "+", "!"].includes(node.operator) && value(node.argument, depth + 1);
    if (node.type === "ArrayExpression") return node.elements.every((item: any) => value(item, depth + 1));
    if (node.type === "MemberExpression") return !node.optional && node.computed && node.object?.name === "params" && node.property?.type === "Literal" && typeof node.property.value === "string";
    return node.type === "ObjectExpression" && node.properties.every((property: any) => property.type === "Property" && property.kind === "init" && !property.computed && !property.method && !property.shorthand && value(property.value, depth + 1));
  };
  const locator = (node: any, depth = 0): boolean => {
    if (!node || depth > 12) return false;
    if (node.type === "Identifier") return aliases.has(node.name);
    if (node.type !== "CallExpression" || node.optional || node.callee?.type !== "MemberExpression") return false;
    const method = member(node.callee);
    if (locatorMethods.has(method || "")) return (page(node.callee.object) || locator(node.callee.object, depth + 1)) && node.arguments.length >= 1 && node.arguments.length <= 2 && node.arguments.every((item: any) => value(item));
    return locatorIndices.has(method || "") && locator(node.callee.object, depth + 1) && node.arguments.length === (method === "nth" ? 1 : 0) && node.arguments.every((item: any) => value(item));
  };
  const read = (node: any): boolean => {
    if (node?.type === "AwaitExpression") return read(node.argument);
    if (value(node)) return true;
    if (node?.type !== "CallExpression" || node.optional || node.callee?.type !== "MemberExpression" || !node.arguments.every((item: any) => value(item))) return false;
    const method = member(node.callee);
    return page(node.callee.object) ? ["title", "url"].includes(method || "") && node.arguments.length === 0 : readMethods.has(method || "") && locator(node.callee.object);
  };
  const wait = (options: any) => {
    if (options?.type !== "ObjectExpression") return assertionTimeoutMs;
    const timeout = options.properties.find((property: any) => (property.key?.name ?? property.key?.value) === "timeout")?.value;
    // A disabled, dynamic or unbounded assertion timeout cannot authorize an
    // extra whole-section attempt inside the run's finite recovery allowance.
    return timeout ? timeout.type === "Literal" && Number.isFinite(timeout.value) && timeout.value > 0 ? timeout.value : Infinity : assertionTimeoutMs;
  };
  for (const statement of tree.body) {
    if (statement.type === "EmptyStatement") continue;
    if (statement.type === "VariableDeclaration" && statement.kind === "const") {
      for (const declaration of statement.declarations) {
        if (declaration.id.type !== "Identifier" || ["page", "playwrightPage", "expect", "params"].includes(declaration.id.name) || aliases.has(declaration.id.name) || !locator(declaration.init)) return null;
        aliases.add(declaration.id.name);
      }
      continue;
    }
    const expression = statement.type === "ExpressionStatement" && statement.expression;
    const call = expression?.type === "AwaitExpression" && expression.argument;
    if (call?.type !== "CallExpression" || call.optional || !matchers.has(member(call.callee) || "") || !call.arguments.every((item: any) => value(item))) return null;
    let expectation = call.callee.object;
    if (member(expectation) === "not") expectation = expectation.object;
    if (expectation?.type !== "CallExpression" || expectation.optional) return null;
    let timeout = wait(call.arguments.at(-1));
    if (expectation.callee?.type === "Identifier" && expectation.callee.name === "expect") {
      if (expectation.arguments.length !== 1 || !(page(expectation.arguments[0]) || locator(expectation.arguments[0]) || read(expectation.arguments[0]))) return null;
    } else if (expectation.callee?.object?.name === "expect" && member(expectation.callee) === "poll") {
      const callback = expectation.arguments[0];
      if (expectation.arguments.length < 1 || expectation.arguments.length > 2 || callback?.type !== "ArrowFunctionExpression" || callback.params.length || !read(callback.body) || expectation.arguments[1] && !value(expectation.arguments[1])) return null;
      timeout = wait(expectation.arguments[1]);
    } else return null;
    assertions++;
    maximumWait += timeout;
  }
  return assertions && Number.isFinite(maximumWait) ? { assertion_count: assertions, maximum_wait_ms: maximumWait } : null;
}

export type AutomationRecoveryReason = "disabled" | "section_not_read_only" | "non_transient_failure" | "run_stopped" | "run_budget_exhausted" | "retry_limit_reached" | "read_only_assertion_timeout";
export type AutomationRecoveryDecision = { retry: boolean; reason: AutomationRecoveryReason; delay_ms: number; limit: number };
export type AutomationRecoverySummary = {
  strategy: "read_only_assertion_retry";
  status: "not_needed" | "recovered" | "failed" | "blocked";
  attempts: number;
  source_changed: false;
  reason?: AutomationRecoveryReason;
  retry_limit?: number;
  first_failure_attempt?: 1;
  first_failure_line?: number;
};

/** Failure classification never turns uncertainty, lost authority or invalid
 * source into a transient condition. Error text is only a compatibility input
 * after the complete source has independently proved safe to repeat. */
export function transientReadFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const fault = error as Error & { code?: string; statusCode?: number; action_outcome?: string; retry_safe?: boolean; nonRetryable?: boolean; matcherResult?: { pass?: boolean; timeout?: number } };
  if (["AbortError", "SyntaxError", "ReferenceError", "TypeError", "RangeError"].includes(error.name) || fault.nonRetryable || fault.retry_safe === false || fault.action_outcome === "unknown" || [401, 403].includes(fault.statusCode || 0)
    || /AUTH|FORBIDDEN|PERMISSION|POLICY|LEASE|CANCEL|INVALID|OUTCOME_UNKNOWN/.test(fault.code || "")
    || /strict mode violation|not a valid selector|invalid selector|target (?:page|browser|context).*closed|(?:page|browser|context) has been closed/i.test(error.message)) return false;
  return error.name === "TimeoutError" || Boolean(fault.matcherResult?.pass === false && Number(fault.matcherResult.timeout) > 0)
    || /(?:timed out \d+ms waiting for expect\(|Timeout:\s*\d+ms)/i.test(error.message);
}

/** The caller owns the browser and clock. This pure policy owns whether an
 * entire failed section can be replayed and its bounded recovery allowance. */
export function automationRecoveryDecision({ source, error, requestedAttempts, completedRetries, assertionTimeoutMs, recoveryWaitMs, remainingMs, stopped = false }: {
  source: unknown; error: unknown; requestedAttempts: number; completedRetries: number; assertionTimeoutMs: number; recoveryWaitMs: number; remainingMs: number; stopped?: boolean;
}): AutomationRecoveryDecision {
  const limit = Number.isFinite(requestedAttempts) ? Math.min(MAX_RECOVERY_ATTEMPTS, Math.max(0, Math.floor(requestedAttempts))) : 0;
  const denied = (reason: AutomationRecoveryReason): AutomationRecoveryDecision => ({ retry: false, reason, delay_ms: 0, limit });
  if (!limit) return denied("disabled");
  if (stopped) return denied("run_stopped");
  if (completedRetries >= limit) return denied("retry_limit_reached");
  const program = inspectReadOnlyAutomationProgram(source, assertionTimeoutMs);
  if (!program) return denied("section_not_read_only");
  if (!transientReadFailure(error)) return denied("non_transient_failure");
  const delay = Math.min(MAX_RECOVERY_DELAY_MS, Math.max(0, Number.isFinite(recoveryWaitMs) ? recoveryWaitMs : 0) * (completedRetries + 1));
  if (!Number.isFinite(remainingMs) || remainingMs < delay + program.maximum_wait_ms) return denied("run_budget_exhausted");
  return { retry: true, reason: "read_only_assertion_timeout", delay_ms: delay, limit };
}
