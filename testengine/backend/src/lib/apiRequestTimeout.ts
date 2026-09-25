// Match the authored API request contract and bound resource use in both
// direct-dispatch and queue execution, including reading the response body.
export function apiRequestTimeoutMs(value?: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(Math.max(1000, Math.min(120000, parsed)))
    : 30000;
}
