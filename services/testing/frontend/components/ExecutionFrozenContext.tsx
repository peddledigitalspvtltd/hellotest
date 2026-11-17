import { effectiveDataSummary } from "../lib/executionRunSummary";
import { type ReactNode } from "react";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";
import type { Execution, ExecutionDataSetSnapshot, KeyValueEntry } from "@hellotest/platform/frontend/src/types";

export function ExecutionContextSnapshotSummary({
  execution,
  onViewFull
}: {
  execution: Execution;
  onViewFull?: () => void;
}) {
  const environmentSummary = execution.test_environment?.snapshot;
  const configurationSummary = execution.test_configuration?.snapshot;
  const dataSetSummary = execution.test_data_set?.snapshot;
  const configurationTarget = [
    configurationSummary?.browser,
    configurationSummary?.mobile_os,
    configurationSummary?.platform_version
  ].filter(Boolean).join(" · ");

  return (
    <div className="execution-context-summary-shell">
      <div className="execution-context-summary-head">
        <div className="execution-context-summary-copy">
          <div className="execution-context-summary-title-row">
            <strong>Run context snapshot</strong>
            <InfoTooltip
              content="Environment, configuration, and test data were frozen when this run was created."
              label="Run context snapshot information"
            />
          </div>
        </div>
        {onViewFull ? (
          <button className="ghost-button" onClick={onViewFull} type="button">
            View full context
          </button>
        ) : null}
      </div>

      <div className="execution-context-cards">
        <div className="execution-context-card">
          <span>Environment snapshot</span>
          <strong>{environmentSummary?.name || execution.test_environment?.name || "No environment attached"}</strong>
          <small>{environmentSummary?.base_url || environmentSummary?.browser || "No environment snapshot details recorded."}</small>
        </div>
        <div className="execution-context-card">
          <span>Configuration snapshot</span>
          <strong>{configurationSummary?.name || execution.test_configuration?.name || "No configuration attached"}</strong>
          <small>{configurationTarget || (configurationSummary?.variables?.length ? `${configurationSummary.variables.length} variables available` : "No configuration snapshot details recorded.")}</small>
        </div>
        <div className="execution-context-card">
          <span>Run data override</span>
          <strong>{dataSetSummary?.name || execution.test_data_set?.name || "None"}</strong>
          <small>
            {dataSetSummary
              ? dataSetSummary.mode === "table"
                ? `${dataSetSummary.rows.length} table rows snapped`
                : `${dataSetSummary.rows.length} key/value pairs snapped`
              : effectiveDataSummary(execution).length ? `Effective inherited data: ${effectiveDataSummary(execution).map(item => `${item.name} (${item.rows} rows, ${item.cases} cases)`).join("; ")}` : "No inherited data in the frozen case scope."}
          </small>
        </div>
      </div>
    </div>
  );
}

export function ExecutionContextSnapshotModal({
  execution,
  onClose
}: {
  execution: Execution;
  onClose: () => void;
}) {
  const environmentSummary = execution.test_environment?.snapshot;
  const configurationSummary = execution.test_configuration?.snapshot;
  const dataSetSummary = execution.test_data_set?.snapshot;

  return (
    <div className="modal-backdrop modal-backdrop--scroll" onClick={onClose} role="presentation">
      <div
        aria-labelledby="execution-context-modal-title"
        aria-modal="true"
        className="modal-card execution-context-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="execution-context-modal-header">
          <div className="execution-context-modal-copy">
            <p className="dialog-context-label">Run context snapshot</p>
            <h2 className="dialog-title" id="execution-context-modal-title">{execution.name || "Selected run"}</h2>
            <p>Review the exact environment, configuration, and test data preserved with this run. Later edits to reusable resources do not change this snapshot.</p>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="execution-context-modal-body">
          <ExecutionContextSnapshotSummary execution={execution} />

          <div className="execution-context-modal-layout">
            <ExecutionContextSnapshotSection
              description="Base URL, browser, notes, and environment variables preserved for this run."
              title={environmentSummary?.name || execution.test_environment?.name || "No environment attached"}
            >
              {environmentSummary ? (
                <>
                  <ExecutionContextMetaGrid
                    items={[
                      { label: "Base URL", value: environmentSummary.base_url || "Not set" },
                      { label: "Browser", value: environmentSummary.browser || "Not set" },
                      {
                        label: "Variables",
                        value: `${environmentSummary.variables.length} variable${environmentSummary.variables.length === 1 ? "" : "s"}`
                      }
                    ]}
                  />
                  {environmentSummary.description ? (
                    <ExecutionContextSnapshotCopyBlock label="Description" value={environmentSummary.description} />
                  ) : null}
                  {environmentSummary.notes ? (
                    <ExecutionContextSnapshotCopyBlock label="Notes" value={environmentSummary.notes} />
                  ) : null}
                  <ExecutionContextVariableTable
                    emptyMessage="No environment variables were snapshotted for this run."
                    entries={environmentSummary.variables}
                    title="Environment variables"
                  />
                </>
              ) : (
                <div className="empty-state compact">No environment snapshot details were recorded for this run.</div>
              )}
            </ExecutionContextSnapshotSection>

            <ExecutionContextSnapshotSection
              description="Browser, mobile target, platform version, and configuration variables preserved with the run."
              title={configurationSummary?.name || execution.test_configuration?.name || "No configuration attached"}
            >
              {configurationSummary ? (
                <>
                  <ExecutionContextMetaGrid
                    items={[
                      { label: "Browser", value: configurationSummary.browser || "Not set" },
                      { label: "Mobile OS", value: configurationSummary.mobile_os || "Not set" },
                      { label: "Platform version", value: configurationSummary.platform_version || "Not set" },
                      {
                        label: "Variables",
                        value: `${configurationSummary.variables.length} variable${configurationSummary.variables.length === 1 ? "" : "s"}`
                      }
                    ]}
                  />
                  {configurationSummary.description ? (
                    <ExecutionContextSnapshotCopyBlock label="Description" value={configurationSummary.description} />
                  ) : null}
                  <ExecutionContextVariableTable
                    emptyMessage="No configuration variables were snapshotted for this run."
                    entries={configurationSummary.variables}
                    title="Configuration variables"
                  />
                </>
              ) : (
                <div className="empty-state compact">No configuration snapshot details were recorded for this run.</div>
              )}
            </ExecutionContextSnapshotSection>

            <ExecutionContextSnapshotSection
              description="The data rows below are the exact run data snapshot used for this run."
              title={dataSetSummary?.name || execution.test_data_set?.name || "None"}
            >
              {dataSetSummary ? (
                <>
                  <ExecutionContextMetaGrid
                    items={[
                      { label: "Mode", value: dataSetSummary.mode === "table" ? "Table data" : "Key/value data" },
                      { label: "Columns", value: String(dataSetSummary.columns.length) },
                      { label: "Rows", value: String(dataSetSummary.rows.length) }
                    ]}
                  />
                  {dataSetSummary.description ? (
                    <ExecutionContextSnapshotCopyBlock label="Description" value={dataSetSummary.description} />
                  ) : null}
                  <ExecutionContextDataTable snapshot={dataSetSummary} />
                </>
              ) : (
                <div className="empty-state compact">No test data snapshot details were recorded for this execution.</div>
              )}
            </ExecutionContextSnapshotSection>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ExecutionContextSnapshotSection({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="execution-context-modal-section">
      <div className="execution-context-modal-section-head">
        <div className="execution-context-modal-section-copy">
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export function ExecutionContextMetaGrid({
  items
}: {
  items: Array<{
    label: string;
    value: string;
  }>;
}) {
  return (
    <div className="execution-context-modal-meta">
      {items.map((item) => (
        <div className="execution-context-modal-meta-card" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function ExecutionContextSnapshotCopyBlock({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="execution-context-modal-copy-block">
      <strong>{label}</strong>
      <p>{value}</p>
    </div>
  );
}

export function ExecutionContextVariableTable({
  entries,
  title,
  emptyMessage
}: {
  entries: KeyValueEntry[];
  title: string;
  emptyMessage: string;
}) {
  return (
    <div className="resource-table-shell execution-context-table-shell">
      <div className="resource-table-toolbar">
        <strong>{title}</strong>
        <span className="count-pill">{entries.length} item{entries.length === 1 ? "" : "s"}</span>
      </div>
      {!entries.length ? <div className="empty-state compact resource-table-empty">{emptyMessage}</div> : null}
      {entries.length ? (
        <div className="table-wrap execution-context-table-wrap">
          <table className="data-table resource-data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th>Visibility</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={entry.id || `${entry.key}-${index}`}>
                  <td>{entry.key || "Untitled key"}</td>
                  <td>{entry.is_secret ? <span className="execution-context-hidden-value">{entry.has_stored_value ? "Stored secret" : "Hidden secret"}</span> : entry.value || "—"}</td>
                  <td>{entry.is_secret ? "Hidden" : "Visible"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function ExecutionContextDataTable({
  snapshot
}: {
  snapshot: ExecutionDataSetSnapshot;
}) {
  if (snapshot.mode === "table") {
    return (
      <div className="resource-table-shell execution-context-table-shell">
        <div className="resource-table-toolbar">
          <strong>Table snapshot</strong>
          <span className="count-pill">{snapshot.rows.length} row{snapshot.rows.length === 1 ? "" : "s"}</span>
        </div>
        {!snapshot.columns.length ? <div className="empty-state compact resource-table-empty">No columns were snapshotted for this data set.</div> : null}
        {snapshot.columns.length ? (
          <div className="table-wrap execution-context-table-wrap">
            <table className="data-table resource-data-table">
              <thead>
                <tr>
                  {snapshot.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshot.rows.length ? (
                  snapshot.rows.map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`}>
                      {snapshot.columns.map((column) => (
                        <td key={`${rowIndex}-${column}`}>{row[column] || "—"}</td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={snapshot.columns.length}>No rows were snapshotted for this data set.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="resource-table-shell execution-context-table-shell">
      <div className="resource-table-toolbar">
        <strong>Key/value snapshot</strong>
        <span className="count-pill">{snapshot.rows.length} pair{snapshot.rows.length === 1 ? "" : "s"}</span>
      </div>
      {!snapshot.rows.length ? <div className="empty-state compact resource-table-empty">No key/value rows were snapshotted for this data set.</div> : null}
      {snapshot.rows.length ? (
        <div className="table-wrap execution-context-table-wrap">
          <table className="data-table resource-data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  <td>{row.key || `Row ${rowIndex + 1}`}</td>
                  <td>{row.value || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
