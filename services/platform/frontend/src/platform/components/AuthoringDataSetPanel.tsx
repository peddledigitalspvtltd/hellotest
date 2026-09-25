import { IconDownload } from "@tabler/icons-react";
import type { TestDataSet } from "../../types";
import { RichTextContent } from "./RichTextEditor";
import "./AuthoringDataSetPanel.css";

type LinkedDataSet = Pick<TestDataSet, "id" | "name" | "description" | "mode" | "columns" | "rows">;

/** One authoring layout for test cases and shared groups, in either editor mode. */
export function AuthoringDataSetPanel({ dataSet, gherkin = false, singleIteration = false,
  selectedRowIndex = 0, canView, canLink, canCreate, onCreate, onLink, onUnlink,
  isLoading = false, linkedDataSetId, error, onRetry,
  onManageParameters, onDownloadTemplate, hasParameters, overrideSharedSteps, onOverrideSharedStepsChange
}: {
  dataSet?: LinkedDataSet | null;
  gherkin?: boolean;
  singleIteration?: boolean;
  selectedRowIndex?: number;
  isLoading?: boolean;
  linkedDataSetId?: string | null;
  error?: string;
  onRetry?: () => void;
  canView: boolean;
  canLink: boolean;
  canCreate: boolean;
  onCreate: () => void;
  onLink: () => void;
  onUnlink: () => void;
  onManageParameters: () => void;
  onDownloadTemplate: () => void;
  hasParameters: boolean;
  overrideSharedSteps?: boolean;
  onOverrideSharedStepsChange?: (checked: boolean) => void;
}) {
  const iterations = singleIteration || dataSet?.mode === "key_value" ? 1 : Math.max(1, dataSet?.rows.length || 0);
  const invalidRow = singleIteration && dataSet?.mode === "table" && !dataSet.rows[selectedRowIndex];
  return <div className="authoring-data-set-panel test-case-data-sets-workspace test-case-data-sets-workspace--compact">
    <div className="authoring-data-set-toolbar">
      <button className="link-button template-download-action" disabled={!hasParameters} onClick={onDownloadTemplate} type="button"
        title={hasParameters ? "Download all used parameters as CSV columns, with an empty row to fill in." : "Add parameters to the title or steps to download a template."}>
        <IconDownload size={15} aria-hidden="true" /> Download Test Params Template
      </button>
    </div>
    {!canView ? <div className="test-case-data-set-inline-empty">
      <strong>Test Data Is Unavailable</strong>
      <span>Test Data access is required to view or link reusable data sets.</span>
    </div> : !dataSet && (isLoading || error || linkedDataSetId) ? <div className="test-case-data-set-inline-empty" role={error ? "alert" : "status"}>
      <strong>{isLoading ? linkedDataSetId ? "Loading Linked Test Data…" : "Loading Data Sets…" : error || "Linked Test Data Is Unavailable"}</strong>
      {!isLoading && onRetry ? <button className="link-button" onClick={onRetry} type="button">Retry</button> : null}
      {!isLoading && linkedDataSetId ? (canLink ? (<button className="link-button" disabled={!canLink} onClick={onLink} type="button">Change Data Set</button>) : null) : null}
    </div> : dataSet ? <article className="test-case-data-set-card test-case-data-set-card--single">
      <header>
        <div className="authoring-data-set-copy">
          <span className="test-case-data-set-kicker">{gherkin ? "Examples source" : dataSet.mode === "table" ? "Tabular data set" : "Key-value data set"}</span>
          <strong>{dataSet.name}</strong>
        </div>
        <div className="test-case-data-set-actions">
          <span className="test-case-iteration-badge">{iterations} {iterations === 1 ? "iteration" : "iterations"}</span>
          {canLink && onOverrideSharedStepsChange ? <label className="authoring-data-set-override"
            title="When selected, this test case's data set can replace values supplied by linked Shared Step Groups.">
            <input type="checkbox" checked={overrideSharedSteps !== false} disabled={!canLink}
              onChange={(event) => onOverrideSharedStepsChange(event.target.checked)} />
            <span>Override Shared Groups Test Data</span>
          </label> : null}
          {canLink ? (<button className="link-button" disabled={!canLink} onClick={onLink} type="button">Change</button>) : null}
          {canLink ? (<button aria-label={`Unlink ${dataSet.name}`} className="link-button danger" disabled={!canLink} onClick={onUnlink} type="button">Unlink</button>) : null}
        </div>
      </header>
      {dataSet.description ? <div className="authoring-data-set-description"><RichTextContent value={dataSet.description} /></div> : null}
      {singleIteration ? <div className="authoring-data-set-row">
        <small>{invalidRow ? "The saved data row is unavailable. Link a data set with exactly one row." : dataSet.mode === "table" && dataSet.rows.length > 1
          ? `Existing link uses row ${selectedRowIndex + 1} only. To replace it, link a data set with exactly one row.`
          : "One row supplies the same group data to every linked test case, unless its shared-group override is enabled."}</small>
      </div> : null}
    </article> : <div className="test-case-data-set-inline-empty">
      <strong>{gherkin ? "No Examples Test Data Linked" : "No Data Sets Defined"}</strong>
      <span>
        {canCreate ? (<button className="link-button" disabled={!canCreate} onClick={onCreate} type="button">Create Data Set</button>) : null}
        {canCreate && canLink ? <span aria-hidden="true">or</span> : null}
        {canLink ? (<button className="link-button" disabled={!canLink} onClick={onLink} type="button">Link Existing Data Set</button>) : null}
      </span>
      <small>{singleIteration ? "Link a data set with exactly one table row, or a key/value data set, to supply this group's defaults." : "Without a linked data set, this test case executes once using its parameter defaults."}</small>
    </div>}
    <div className="test-case-data-set-secondary-actions">
      <button className="link-button" onClick={onManageParameters} type="button">Manage Test Params</button>
      {canView && dataSet ? (canCreate ? (<button className="link-button" disabled={!canCreate} onClick={onCreate} type="button">Create a replacement data set</button>) : null) : null}
    </div>
  </div>;
}
