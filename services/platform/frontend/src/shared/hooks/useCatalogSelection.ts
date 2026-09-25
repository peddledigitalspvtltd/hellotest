import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

type CatalogSelection = {
  allVisibleSelected: boolean;
  clear: () => void;
  selectedIds: string[];
  selectAllVisible: () => void;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  toggle: (id: string) => void;
};

/**
 * Owns catalog selection independently from the visual representation.
 * Tile and list views can therefore share one selection contract without
 * duplicating pruning, select-all, and toggle behavior.
 */
export function useCatalogSelection(availableIds: readonly string[], visibleIds: readonly string[]): CatalogSelection {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const availableIdSet = useMemo(() => new Set(availableIds), [availableIds]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    setSelectedIds((current) => {
      const next = current.filter((id) => availableIdSet.has(id));
      return next.length === current.length ? current : next;
    });
  }, [availableIdSet]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((candidate) => candidate !== id)
      : [...current, id]);
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedIds((current) => Array.from(new Set([...current, ...visibleIds])));
  }, [visibleIds]);

  const clear = useCallback(() => setSelectedIds([]), []);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIdSet.has(id));

  return {
    allVisibleSelected,
    clear,
    selectedIds,
    selectAllVisible,
    setSelectedIds,
    toggle
  };
}
