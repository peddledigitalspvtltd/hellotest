import type { TestDataSet } from "@hellotest/platform/frontend/src/types";
import { AddIcon, SearchIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";

export function TestDataSetPickerDialog({
  singleIteration = false,
  canCreateDataSet,
  dataSets,
  isLoading,
  error,
  onRetry,
  search,
  selectedId,
  onSearchChange,
  onSelect,
  onCreateNew,
  onConfirm,
  onClose
}: {
  singleIteration?: boolean;
  canCreateDataSet: boolean;
  dataSets: TestDataSet[];
  isLoading: boolean;
  error?: string;
  onRetry?: () => void;
  search: string;
  selectedId: string;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onCreateNew: () => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLFormElement>({ onClose });
  const query = search.trim().toLowerCase();
  const canSelectDataSet = (dataSet: TestDataSet) => !singleIteration || dataSet.mode === "key_value" || dataSet.rows.length === 1;
  const canConfirm = dataSets.some((dataSet) => dataSet.id === selectedId && canSelectDataSet(dataSet));
  const filteredDataSets = dataSets.filter((dataSet) => !query || [
    dataSet.name,
    dataSet.description || "",
    dataSet.mode,
    ...dataSet.columns
  ].join(" ").toLowerCase().includes(query));

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <form
        aria-labelledby="link-data-set-title"
        aria-modal="true"
        className="modal-card test-data-set-picker-dialog"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (canConfirm) onConfirm();
        }}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="test-data-set-picker-header">
          <div>
            <span className="eyebrow">Reusable execution data</span>
            <h2 className="dialog-title" id="link-data-set-title">Link Existing Data Set</h2>
            <p>{singleIteration ? "Link exactly one table row or one key/value data set. All linked test cases inherit the same group data." : "Select one data set for this Test Case. Every table row becomes an independent execution iteration."}</p>
          </div>
          <DialogCloseButton label="Close data set picker" onClick={onClose} />
        </header>

        <div className="test-data-set-picker-toolbar">
          <label className="catalog-search test-case-data-set-search">
            <SearchIcon />
            <input
              aria-label="Search existing data sets"
              data-autofocus="true"
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search by name, description, format, or column"
              type="search"
              value={search}
            />
          </label>
          <span className="count-pill">{filteredDataSets.length} available</span>
        </div>

        <div className="test-data-set-picker-options" role="radiogroup" aria-label="Available data sets">
          {filteredDataSets.map((dataSet) => {
            const iterations = dataSet.mode === "key_value" ? 1 : singleIteration ? dataSet.rows.length : Math.max(1, dataSet.rows.length);
            const isSelected = dataSet.id === selectedId;
            const isAvailable = canSelectDataSet(dataSet);
            return (
              <label className={`test-data-set-picker-option${isSelected ? " is-selected" : ""}${!isAvailable ? " is-unavailable" : ""}`} key={dataSet.id}>
                <input checked={isSelected} disabled={!isAvailable} name="linked-data-set" onChange={() => onSelect(dataSet.id)} type="radio" value={dataSet.id} />
                <span className="test-data-set-picker-option-copy">
                  <span>
                    <strong>{dataSet.name}</strong>
                    <small>{dataSet.app_type_id ? "Current app scope" : "Project-wide"}</small>
                  </span>
                  {!isAvailable ? <small className="test-data-set-picker-validation">Shared Step Groups require exactly one table row. This data set has {dataSet.rows.length}.</small> : null}
                  <p>{dataSet.description ? richTextToPlainText(dataSet.description) : "No description provided."}</p>
                  <span className="test-data-set-picker-option-meta">
                    <span>{dataSet.mode === "table" ? "Table" : "Key/value"}</span>
                    <span>{iterations} {singleIteration && dataSet.mode === "table" ? (iterations === 1 ? "row" : "rows") : (iterations === 1 ? "iteration" : "iterations")}</span>
                    <span>{dataSet.columns.length} {dataSet.columns.length === 1 ? "column" : "columns"}</span>
                  </span>
                </span>
              </label>
            );
          })}
          {isLoading ? <LoadingState label="Loading data sets" /> : null}
          {error ? <div className="empty-state compact test-data-set-picker-empty" role="alert">
            <strong>{error}</strong>
            {onRetry ? <button className="ghost-button" onClick={onRetry} type="button">Retry</button> : null}
          </div> : null}
          {!isLoading && !error && !dataSets.length ? (
            <div className="empty-state compact test-data-set-picker-empty">
              <strong>No reusable data sets exist yet.</strong>
              <span>Create one with the full Test Data editor, then it will be selected automatically.</span>
              {canCreateDataSet ? (<button className="ghost-button" disabled={!canCreateDataSet} onClick={onCreateNew} type="button"><AddIcon /> Create Data Set</button>) : null}
            </div>
          ) : null}
          {!isLoading && dataSets.length > 0 && !filteredDataSets.length ? (
            <div className="empty-state compact">No data sets match “{search.trim()}”.</div>
          ) : null}
        </div>

        <footer className="test-data-set-picker-footer">
          {canCreateDataSet ? (<button className="link-button" disabled={!canCreateDataSet} onClick={onCreateNew} type="button">Create a new data set instead</button>) : null}
          <span />
          <button className="ghost-button" onClick={onClose} type="button">Cancel</button>
          <button className="primary-button" disabled={!canConfirm} type="submit">Link Data Set</button>
        </footer>
      </form>
    </div>
  );
}
