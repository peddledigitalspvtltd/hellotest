/** Refresh saved values without discarding fields changed since the last read. */
export function mergeAutomationMetadataValue<T>(current: T, previous: T, incoming: T): T {
  return JSON.stringify(current) === JSON.stringify(previous) ? incoming : current;
}

export function mergeAutomationMetadataFields<T extends Record<string, unknown>>(current: T, previous: T, incoming: T): T {
  const next = { ...incoming };
  const keys = new Set([...Object.keys(current), ...Object.keys(previous), ...Object.keys(incoming)]);
  for (const key of keys) {
    if (JSON.stringify(current[key]) === JSON.stringify(previous[key])) continue;
    if (Object.prototype.hasOwnProperty.call(current, key)) Object.assign(next, { [key]: current[key] });
    else delete next[key];
  }
  return next;
}
