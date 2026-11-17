import { useId, useMemo, useState } from "react";
import { SearchIcon, SelectionToggleIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";

export type ImpactPickerOption = {
  id: string;
  displayId?: string | null;
  title: string;
  meta?: string;
};

export function ImpactCheckboxPicker({
  disabled,
  emptyText,
  items,
  label,
  onChange,
  placeholder,
  selectedIds
}: {
  disabled?: boolean;
  emptyText: string;
  items: ImpactPickerOption[];
  label: string;
  onChange: (ids: string[]) => void;
  placeholder: string;
  selectedIds: string[];
}) {
  const [search, setSearch] = useState("");
  const labelId = useId().replace(/:/g, "");
  const normalizedSearch = search.trim().toLowerCase();
  const visibleItems = useMemo(
    () =>
      items.filter((item) =>
        !normalizedSearch ||
        [item.id, item.displayId || "", item.title, item.meta || ""]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch)
      ),
    [items, normalizedSearch]
  );
  const visibleIds = visibleItems.map((item) => item.id);
  const areAllVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const toggleItem = (id: string, checked: boolean) => {
    onChange(checked ? [...new Set([...selectedIds, id])] : selectedIds.filter((selectedId) => selectedId !== id));
  };

  return (
    <details className="form-field impact-checkbox-field impact-select-dropdown">
      <summary className="impact-select-summary">
        <span className="form-field-label" id={labelId}>{label}</span>
        <span>{selectedIds.length ? `${selectedIds.length} selected` : "Select…"}</span>
      </summary>
      <div className="impact-select-popover">
      <div className="impact-checkbox-heading">
        <span>{selectedIds.length} selected</span>
        <div className="impact-checkbox-actions">
          <button
            className="impact-checkbox-action"
            disabled={disabled || !visibleIds.length || areAllVisibleSelected}
            onClick={() => onChange([...new Set([...selectedIds, ...visibleIds])])}
            type="button"
          >
            <SelectionToggleIcon checked />
            Select all
          </button>
          <span aria-hidden="true">|</span>
          <button
            className="impact-checkbox-action"
            disabled={disabled}
            onClick={() => onChange([])}
            type="button"
          >
            <SelectionToggleIcon checked={false} />
            Clear
          </button>
        </div>
      </div>
      <div className="impact-checkbox-picker">
        <label className="impact-checkbox-search">
          <SearchIcon />
          <input
            aria-label={`Search ${label.toLowerCase()}`}
            disabled={disabled}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={placeholder}
            value={search}
          />
        </label>
        <div aria-labelledby={labelId} className="impact-checkbox-list" role="group">
          {visibleItems.map((item) => {
            const isChecked = selectedIds.includes(item.id);

            return (
              <label className={isChecked ? "impact-checkbox-option is-selected" : "impact-checkbox-option"} key={item.id}>
                <input
                  checked={isChecked}
                  disabled={disabled}
                  onChange={(event) => toggleItem(item.id, event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <strong>{item.title}</strong>
                  <small>{[item.displayId || item.id, item.meta].filter(Boolean).join(" · ")}</small>
                </span>
              </label>
            );
          })}
          {!visibleItems.length ? <div className="empty-state compact">{items.length ? "No records match this search." : emptyText}</div> : null}
        </div>
      </div>
      </div>
    </details>
  );
}

