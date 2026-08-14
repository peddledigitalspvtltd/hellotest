import { ClearSelectionIcon, SelectAllIcon } from "./AppIcons";

type CatalogSelectionControlsProps = {
  allSelected: boolean;
  canSelectAll: boolean;
  selectedCount: number;
  onClear: () => void;
  onSelectAll: () => void;
  clearLabel?: string;
  selectAllLabel?: string;
};

export function CatalogSelectionControls({
  allSelected,
  canSelectAll,
  clearLabel = "Clear",
  onClear,
  onSelectAll,
  selectAllLabel = "Select all",
  selectedCount
}: CatalogSelectionControlsProps) {
  const hasSelection = selectedCount > 0;

  return (
    <div className="catalog-selection-controls" role="group" aria-label="Catalog selection">
      <button
        className="ghost-button catalog-selection-button"
        disabled={!canSelectAll || allSelected}
        onClick={onSelectAll}
        title={!canSelectAll ? "No visible records to select" : allSelected ? "All visible records are selected" : selectAllLabel}
        type="button"
      >
        <SelectAllIcon />
        <span>{selectAllLabel}</span>
      </button>
      <button
        className="ghost-button catalog-selection-button"
        disabled={!hasSelection}
        onClick={onClear}
        title={hasSelection ? clearLabel : "No selected records to clear"}
        type="button"
      >
        <ClearSelectionIcon />
        <span>{clearLabel}</span>
      </button>
    </div>
  );
}
