type GroupedStep = { group?: { id: string } };

/** The destination is the step's final, zero-based position, in either direction. */
export function canMoveGherkinStep<T>(steps: readonly T[], from: number, to: number): boolean {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= steps.length || to >= steps.length) return false;
  const groupId = (steps[from] as GroupedStep).group?.id;
  if (groupId) {
    // A linked group's member stays within its original contiguous instance.
    const lower = Math.min(from, to);
    const upper = Math.max(from, to);
    return steps.slice(lower, upper + 1).every((step) => (step as GroupedStep).group?.id === groupId);
  }
  const remaining = steps.filter((_, index) => index !== from);
  const before = (remaining[to - 1] as GroupedStep | undefined)?.group?.id;
  const after = (remaining[to] as GroupedStep | undefined)?.group?.id;
  // Standalone steps can cross a whole group, but cannot split that group.
  return !before || before !== after;
}

export function moveGherkinStep<T>(steps: T[], from: number, to: number): T[] {
  if (from === to || !canMoveGherkinStep(steps, from, to)) return steps;
  const next = [...steps];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Translate a before/after row drop into the moved step's final position. */
export function gherkinDropPosition(from: number, row: number, after: boolean): number {
  const insertion = row + (after ? 1 : 0);
  return insertion - (from < insertion ? 1 : 0);
}
