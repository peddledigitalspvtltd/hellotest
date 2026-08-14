type SelectionId = string | number | null | undefined;

export function normalizeSelectionIds(ids: SelectionId[]) {
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

export function setSelectionIds(
  currentIds: SelectionId[],
  candidateIds: SelectionId[],
  selected: boolean
) {
  const current = normalizeSelectionIds(currentIds);
  const candidates = normalizeSelectionIds(candidateIds);
  if (!candidates.length) return current;
  if (selected) return [...new Set([...current, ...candidates])];
  const candidateSet = new Set(candidates);
  return current.filter((id) => !candidateSet.has(id));
}

export function getSelectionState(
  currentIds: SelectionId[],
  candidateIds: SelectionId[]
) {
  const selected = new Set(normalizeSelectionIds(currentIds));
  const candidates = normalizeSelectionIds(candidateIds);
  const selectedCount = candidates.reduce(
    (count, candidateId) => count + Number(selected.has(candidateId)),
    0
  );

  return {
    candidateCount: candidates.length,
    selectedCount,
    isAllSelected: candidates.length > 0 && selectedCount === candidates.length,
    isPartiallySelected: selectedCount > 0 && selectedCount < candidates.length
  };
}
