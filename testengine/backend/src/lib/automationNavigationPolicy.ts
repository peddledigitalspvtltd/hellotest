/** Match TestEngine Run's existing navigation configuration contract. An
 * omitted Build policy retains the original native 25s tool allowance. */
export const DEFAULT_AUTOMATION_NAVIGATION_TIMEOUT_MS = 30_000;
export const MIN_AUTOMATION_NAVIGATION_TIMEOUT_MS = 1_000;
export const MAX_AUTOMATION_NAVIGATION_TIMEOUT_MS = 600_000;
export function normalizeAutomationNavigationTimeoutMs(value?: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value)
    : typeof value === 'string' && value.trim() ? Number.parseInt(value.trim(), 10) : Number.NaN;
  return Math.max(MIN_AUTOMATION_NAVIGATION_TIMEOUT_MS, Math.min(MAX_AUTOMATION_NAVIGATION_TIMEOUT_MS,
    Number.isFinite(numeric) ? numeric : DEFAULT_AUTOMATION_NAVIGATION_TIMEOUT_MS));
}
export const validAutomationNavigationTimeoutMs = (value: unknown): value is number => Number.isSafeInteger(value)
  && Number(value) >= MIN_AUTOMATION_NAVIGATION_TIMEOUT_MS && Number(value) <= MAX_AUTOMATION_NAVIGATION_TIMEOUT_MS;
export const nativeAutomationNavigationToolTimeoutMs = (configured?: number) => configured === undefined ? 25_000 : Math.max(25_000, configured + 5_000);
