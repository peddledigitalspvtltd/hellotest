/** Shared default for native Build checks, isolated verification and Run.
 * Explicit authored/configured matcher timeouts remain authoritative. */
export const DEFAULT_AUTOMATION_ASSERTION_TIMEOUT_MS = 10_000;
export const MIN_AUTOMATION_ASSERTION_TIMEOUT_MS = 250;
export const MAX_AUTOMATION_ASSERTION_TIMEOUT_MS = 120_000;
export const DEFAULT_AUTOMATION_TOOL_TIMEOUT_MS = 25_000;
export const AUTOMATION_ASSERTION_TOOL_MARGIN_MS = 5_000;

/** Match ordinary Run configuration normalization. Wire contracts still
 * validate that a supplied policy is already a bounded integer. */
export function normalizeAutomationAssertionTimeoutMs(value?: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value)
    : typeof value === 'string' && value.trim() ? Number.parseInt(value.trim(), 10) : Number.NaN;
  return Math.min(MAX_AUTOMATION_ASSERTION_TIMEOUT_MS, Math.max(MIN_AUTOMATION_ASSERTION_TIMEOUT_MS,
    Number.isFinite(numeric) ? numeric : DEFAULT_AUTOMATION_ASSERTION_TIMEOUT_MS));
}
export const validAutomationAssertionTimeoutMs = (value: unknown): value is number => Number.isSafeInteger(value)
  && Number(value) >= MIN_AUTOMATION_ASSERTION_TIMEOUT_MS && Number(value) <= MAX_AUTOMATION_ASSERTION_TIMEOUT_MS;

// These closed compiler predicates have an explicit 8000ms poll in saved
// source. Keep MCP equivalent without changing or migrating their programs.
export const FIXED_NATIVE_PREDICATE_TIMEOUT_MS = 8_000;
const fixedPredicates = new Set(["valid", "invalid", "field_valid", "input_type"]);
export const nativeAutomationAssertionTimeoutMs = (assertion: string, configured?: unknown) => fixedPredicates.has(assertion)
  ? FIXED_NATIVE_PREDICATE_TIMEOUT_MS : normalizeAutomationAssertionTimeoutMs(configured);
export const nativeAutomationAssertionToolTimeoutMs = (assertion: string, configured?: unknown) => Math.max(DEFAULT_AUTOMATION_TOOL_TIMEOUT_MS,
  nativeAutomationAssertionTimeoutMs(assertion, configured) + AUTOMATION_ASSERTION_TOOL_MARGIN_MS);
