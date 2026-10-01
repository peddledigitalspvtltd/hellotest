import { SelectionToggleIcon } from "../../platform/components/AppIcons";

type CatalogSelectionControlsProps = {
  allSelected: boolean;
  canSelectAll: boolean;
  selectedCount: number;
  onClear: () => void;
  onSelectAll: () => void;
  clearLabel?: string;
  selectAllLabel?: string;
  showLabels?: boolean;
};

export function CatalogSelectionControls({
  allSelected,
  canSelectAll,
  clearLabel = "Clear",
  onClear,
  onSelectAll,
  selectAllLabel = "Select all",
  showLabels = false,
  selectedCount
}: CatalogSelectionControlsProps) {
  const hasSelection = selectedCount > 0;

  return (
    <div className="catalog-selection-controls" role="group" aria-label="Catalog selection">
      <button
        aria-label={selectAllLabel}
        className="ghost-button catalog-selection-button"
        disabled={!canSelectAll || allSelected}
        onClick={onSelectAll}
        title={!canSelectAll ? "No visible records to select" : allSelected ? "All visible records are selected" : selectAllLabel}
        type="button"
      >
        <SelectionToggleIcon checked />
        <span className={showLabels ? undefined : "sr-only"}>{selectAllLabel}</span>
      </button>
      <button
        aria-label={clearLabel}
        className="ghost-button catalog-selection-button"
        disabled={!hasSelection}
        onClick={onClear}
        title={hasSelection ? clearLabel : "No selected records to clear"}
        type="button"
      >
        <SelectionToggleIcon checked={false} />
        <span className={showLabels ? undefined : "sr-only"}>{clearLabel}</span>
      </button>
    </div>
  );
}
