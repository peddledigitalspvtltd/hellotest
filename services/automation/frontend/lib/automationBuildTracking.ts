/** Replace untouched drafts with generated output while retaining concurrent edits. */
export function mergeRefreshedAutomationDrafts<T>(
  current: Record<string, T>,
  baseline: Record<string, T>,
  refreshed: Record<string, T>
): Record<string, T> {
  return Object.fromEntries(Object.entries(refreshed).map(([id, value]) => [
    id,
    Object.prototype.hasOwnProperty.call(current, id) && JSON.stringify(current[id]) !== JSON.stringify(baseline[id])
      ? current[id]
      : value
  ]));
}
