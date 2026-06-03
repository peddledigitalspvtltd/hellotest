import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ColumnsIcon, DragHandleIcon, PinIcon } from "./AppIcons";
import { InfoTooltip } from "./InfoTooltip";
import { api } from "../lib/api";

export type DataTableColumn<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
  headerRender?: () => ReactNode;
  canToggle?: boolean;
  defaultVisible?: boolean;
  canReorder?: boolean;
  canResize?: boolean;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  preferenceLabel?: string;
};

type StoredColumnPreference = {
  visibleColumnKeys?: string[];
  orderedColumnKeys?: string[];
  columnWidths?: Record<string, number>;
};

type NormalizedColumnPreference = {
  visibleColumnKeys: string[];
  orderedColumnKeys: string[];
  columnWidths: Record<string, number>;
};

let workspacePreferenceCache: Record<string, unknown> | null = null;
let workspacePreferenceRequest: Promise<Record<string, unknown>> | null = null;

const DEFAULT_COLUMN_WIDTH = 160;
const DEFAULT_MIN_COLUMN_WIDTH = 72;
const DEFAULT_MAX_COLUMN_WIDTH = 640;

const clampColumnWidth = <T,>(column: DataTableColumn<T>, width: number) => {
  const minWidth = column.minWidth || DEFAULT_MIN_COLUMN_WIDTH;
  const maxWidth = column.maxWidth || DEFAULT_MAX_COLUMN_WIDTH;
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
};

const readStoredColumnPreference = (storageKey: string) => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as StoredColumnPreference : null;
  } catch {
    return null;
  }
};

const writeStoredColumnPreference = (storageKey: string, value: NormalizedColumnPreference) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(value));
};

const loadWorkspacePreferenceCache = async () => {
  if (workspacePreferenceCache) {
    return workspacePreferenceCache;
  }

  if (!workspacePreferenceRequest) {
    workspacePreferenceRequest = api.settings
      .getWorkspacePreferences()
      .then((response) => {
        workspacePreferenceCache = response.preferences || {};
        return workspacePreferenceCache;
      })
      .catch(() => {
        workspacePreferenceCache = {};
        return workspacePreferenceCache;
      })
      .finally(() => {
        workspacePreferenceRequest = null;
      });
  }

  return workspacePreferenceRequest;
};

const saveWorkspacePreference = async (storageKey: string, value: NormalizedColumnPreference) => {
  const nextCache = {
    ...(workspacePreferenceCache || {}),
    [storageKey]: value
  };

  workspacePreferenceCache = nextCache;
  await api.settings.updateWorkspacePreferences({
    preferences: {
      [storageKey]: value
    }
  });
};

const getDefaultVisibleColumnKeys = <T,>(columns: Array<DataTableColumn<T>>) =>
  columns.filter((column) => column.canToggle !== false && column.defaultVisible !== false).map((column) => column.key);

const getDefaultOrderedColumnKeys = <T,>(columns: Array<DataTableColumn<T>>) => columns.map((column) => column.key);

const getColumnPreferenceLabel = <T,>(column: DataTableColumn<T>) => column.preferenceLabel || column.label || column.key;

const normalizeColumnPreference = <T,>(
  columns: Array<DataTableColumn<T>>,
  input?: StoredColumnPreference | null
): NormalizedColumnPreference => {
  const allColumnKeys = getDefaultOrderedColumnKeys(columns);
  const configurableColumnKeySet = new Set(columns.filter((column) => column.canToggle !== false).map((column) => column.key));
  const defaultVisibleColumnKeys = getDefaultVisibleColumnKeys(columns);
  const candidateVisibleKeys = Array.isArray(input?.visibleColumnKeys)
    ? input.visibleColumnKeys.filter((key): key is string => typeof key === "string" && configurableColumnKeySet.has(key))
    : defaultVisibleColumnKeys;
  const orderedKeysSource = Array.isArray(input?.orderedColumnKeys)
    ? input.orderedColumnKeys.filter((key): key is string => typeof key === "string")
    : allColumnKeys;
  const orderedColumnKeys = [
    ...new Set([...orderedKeysSource.filter((key) => allColumnKeys.includes(key)), ...allColumnKeys])
  ];
  const columnWidths = Object.entries(input?.columnWidths || {}).reduce<Record<string, number>>((accumulator, [key, width]) => {
    const column = columns.find((candidate) => candidate.key === key);
    if (column && typeof width === "number" && Number.isFinite(width)) {
      accumulator[key] = clampColumnWidth(column, width);
    }
    return accumulator;
  }, {});

  return {
    visibleColumnKeys: configurableColumnKeySet.size
      ? (candidateVisibleKeys.length ? [...new Set(candidateVisibleKeys)] : [defaultVisibleColumnKeys[0] || Array.from(configurableColumnKeySet)[0]])
      : [],
    orderedColumnKeys,
    columnWidths
  };
};

const moveColumnKey = (keys: string[], draggedKey: string, targetKey: string) => {
  if (draggedKey === targetKey) {
    return keys;
  }

  const nextKeys = keys.filter((key) => key !== draggedKey);
  const targetIndex = nextKeys.indexOf(targetKey);

  if (targetIndex === -1) {
    nextKeys.push(draggedKey);
    return nextKeys;
  }

  nextKeys.splice(targetIndex, 0, draggedKey);
  return nextKeys;
};

export function DataTable<T>({
  columns,
  rows,
  emptyMessage,
  storageKey,
  getRowKey,
  onRowClick,
  getRowClassName,
  hideToolbarCopy = false,
  hideVisibleColumnPreview = true,
  enableHeaderColumnReorder = false,
  enableColumnResize = false
}: {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  emptyMessage: string;
  storageKey?: string;
  getRowKey?: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  getRowClassName?: (row: T) => string;
  hideToolbarCopy?: boolean;
  hideVisibleColumnPreview?: boolean;
  enableHeaderColumnReorder?: boolean;
  enableColumnResize?: boolean;
}) {
  const [isColumnConfigOpen, setIsColumnConfigOpen] = useState(false);
  const [draggedColumnKey, setDraggedColumnKey] = useState("");
  const [sortState, setSortState] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [columnPreference, setColumnPreference] = useState<NormalizedColumnPreference>(() =>
    normalizeColumnPreference(columns, storageKey ? readStoredColumnPreference(storageKey) : null)
  );
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => columnPreference.columnWidths);
  const [isPreferenceHydrated, setIsPreferenceHydrated] = useState(!storageKey);
  const columnConfigRef = useRef<HTMLDivElement | null>(null);
  const lastSavedPreferenceRef = useRef<string>("");

  useEffect(() => {
    setColumnPreference((current) => normalizeColumnPreference(columns, current));
  }, [columns]);

  useEffect(() => {
    setColumnWidths(columnPreference.columnWidths);
  }, [columnPreference.columnWidths]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    let isActive = true;
    const localPreference = readStoredColumnPreference(storageKey);

    if (localPreference) {
      setColumnPreference(normalizeColumnPreference(columns, localPreference));
    }

    void loadWorkspacePreferenceCache().then((preferences) => {
      if (!isActive) {
        return;
      }

      const remotePreference = preferences[storageKey];
      if (remotePreference && typeof remotePreference === "object" && !Array.isArray(remotePreference)) {
        const normalizedRemotePreference = normalizeColumnPreference(columns, remotePreference as StoredColumnPreference);
        setColumnPreference(normalizedRemotePreference);
        writeStoredColumnPreference(storageKey, normalizedRemotePreference);
      } else if (localPreference) {
        const normalizedLocalPreference = normalizeColumnPreference(columns, localPreference);
        void saveWorkspacePreference(storageKey, normalizedLocalPreference).catch(() => undefined);
      }

      setIsPreferenceHydrated(true);
    });

    return () => {
      isActive = false;
    };
  }, [columns, storageKey]);

  useEffect(() => {
    if (!storageKey || !isPreferenceHydrated) {
      return;
    }

    writeStoredColumnPreference(storageKey, columnPreference);

    const serializedPreference = JSON.stringify(columnPreference);
    if (lastSavedPreferenceRef.current === serializedPreference) {
      return;
    }

    lastSavedPreferenceRef.current = serializedPreference;
    void saveWorkspacePreference(storageKey, columnPreference).catch(() => undefined);
  }, [columnPreference, isPreferenceHydrated, storageKey]);

  useEffect(() => {
    if (!isColumnConfigOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (columnConfigRef.current?.contains(target)) {
        return;
      }
      setIsColumnConfigOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsColumnConfigOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isColumnConfigOpen]);

  const columnByKey = useMemo(
    () =>
      columns.reduce<Record<string, DataTableColumn<T>>>((accumulator, column) => {
        accumulator[column.key] = column;
        return accumulator;
      }, {}),
    [columns]
  );
  const configurableColumns = useMemo(() => columns.filter((column) => column.canToggle !== false), [columns]);
  const visibleColumnKeySet = useMemo(() => new Set(columnPreference.visibleColumnKeys), [columnPreference.visibleColumnKeys]);
  const orderedColumns = useMemo(
    () => columnPreference.orderedColumnKeys.map((key) => columnByKey[key]).filter(Boolean),
    [columnByKey, columnPreference.orderedColumnKeys]
  );
  const activeColumns = useMemo(
    () => orderedColumns.filter((column) => column.canToggle === false || visibleColumnKeySet.has(column.key)),
    [orderedColumns, visibleColumnKeySet]
  );
  const visibleColumnPreview = useMemo(
    () =>
      activeColumns
        .filter((column) => column.canToggle !== false)
        .slice(0, 4)
        .map((column) => getColumnPreferenceLabel(column)),
    [activeColumns]
  );

  const updateColumnPreference = (updater: (current: NormalizedColumnPreference) => NormalizedColumnPreference) => {
    setColumnPreference((current) => normalizeColumnPreference(columns, updater(current)));
  };

  const moveColumn = (draggedKey: string, targetKey: string) => {
    updateColumnPreference((current) => ({
      ...current,
      orderedColumnKeys: moveColumnKey(current.orderedColumnKeys, draggedKey, targetKey)
    }));
  };

  const getColumnWidth = (column: DataTableColumn<T>) =>
    enableColumnResize ? columnWidths[column.key] || column.width || DEFAULT_COLUMN_WIDTH : undefined;

  const handleColumnResizePointerDown = (column: DataTableColumn<T>, event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!enableColumnResize || column.canResize === false) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const headerCell = event.currentTarget.closest("th") as HTMLTableCellElement | null;
    const startWidth = clampColumnWidth(column, getColumnWidth(column) || headerCell?.getBoundingClientRect().width || DEFAULT_COLUMN_WIDTH);
    const startX = event.clientX;
    let nextWidth = startWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      nextWidth = clampColumnWidth(column, startWidth + moveEvent.clientX - startX);
      setColumnWidths((current) => current[column.key] === nextWidth ? current : { ...current, [column.key]: nextWidth });
    };

    const finishResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      document.body.classList.remove("is-resizing-data-table-column");
      updateColumnPreference((current) => ({
        ...current,
        columnWidths: {
          ...current.columnWidths,
          [column.key]: nextWidth
        }
      }));
    };

    document.body.classList.add("is-resizing-data-table-column");
    setColumnWidths((current) => current[column.key] === startWidth ? current : { ...current, [column.key]: startWidth });
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  };

  const resizeColumnByKeyboard = (column: DataTableColumn<T>, delta: number) => {
    const nextWidth = clampColumnWidth(column, (getColumnWidth(column) || DEFAULT_COLUMN_WIDTH) + delta);
    setColumnWidths((current) => ({ ...current, [column.key]: nextWidth }));
    updateColumnPreference((current) => ({
      ...current,
      columnWidths: {
        ...current.columnWidths,
        [column.key]: nextWidth
      }
    }));
  };

  const toggleColumn = (columnKey: string) => {
    updateColumnPreference((current) => {
      const isVisible = current.visibleColumnKeys.includes(columnKey);
      if (isVisible) {
        if (current.visibleColumnKeys.length === 1) {
          return current;
        }

        return {
          ...current,
          visibleColumnKeys: current.visibleColumnKeys.filter((key) => key !== columnKey)
        };
      }

      return {
        ...current,
        visibleColumnKeys: [...current.visibleColumnKeys, columnKey]
      };
    });
  };

  const resetColumns = () => {
    updateColumnPreference(() => normalizeColumnPreference(columns));
  };

  const sortedRows = useMemo(() => {
    if (!sortState) {
      return rows;
    }

    const sortColumn = columns.find((column) => column.key === sortState.key);
    if (!sortColumn?.sortValue) {
      return rows;
    }

    const directionMultiplier = sortState.direction === "asc" ? 1 : -1;

    return rows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const leftValue = sortColumn.sortValue?.(left.row);
        const rightValue = sortColumn.sortValue?.(right.row);
        const isLeftBlank = leftValue === null || leftValue === undefined || leftValue === "";
        const isRightBlank = rightValue === null || rightValue === undefined || rightValue === "";

        if (isLeftBlank || isRightBlank) {
          if (isLeftBlank && isRightBlank) {
            return left.index - right.index;
          }

          return isLeftBlank ? 1 : -1;
        }

        const comparison =
          typeof leftValue === "number" && typeof rightValue === "number"
            ? leftValue - rightValue
            : String(leftValue).localeCompare(String(rightValue), undefined, {
                numeric: true,
                sensitivity: "base"
              });

        return comparison ? comparison * directionMultiplier : left.index - right.index;
      })
      .map(({ row }) => row);
  }, [columns, rows, sortState]);

  const toggleSort = (column: DataTableColumn<T>) => {
    if (!column.sortValue) {
      return;
    }

    setSortState((current) => {
      if (current?.key !== column.key) {
        return { key: column.key, direction: "asc" };
      }

      if (current.direction === "asc") {
        return { key: column.key, direction: "desc" };
      }

      return null;
    });
  };

  return (
    <div className="data-table-shell">
      {configurableColumns.length ? (
        <div className="data-table-toolbar">
          {!hideToolbarCopy ? (
            <div className="data-table-toolbar-copy">
              <div className="data-table-toolbar-title-row">
                <strong>Grid layout</strong>
                <InfoTooltip
                  content={`${columnPreference.visibleColumnKeys.length} of ${configurableColumns.length} details visible.`}
                  label="Grid layout information"
                />
              </div>
            </div>
          ) : <span />}
          <div className="data-table-toolbar-meta">
            {!hideVisibleColumnPreview && visibleColumnPreview.length ? (
              <div aria-label="Visible columns" className="data-table-visible-columns">
                {visibleColumnPreview.map((columnLabel) => (
                  <span className="data-table-visible-column-chip" key={columnLabel}>{columnLabel}</span>
                ))}
              </div>
            ) : null}
            <div className="data-table-config" ref={columnConfigRef}>
              <button
                aria-expanded={isColumnConfigOpen}
                aria-haspopup="menu"
                aria-label="Column configuration"
                className="ghost-button data-table-config-trigger"
                onClick={() => setIsColumnConfigOpen((current) => !current)}
                title="Column configuration"
                type="button"
              >
                <ColumnsIcon />
                <span className="data-table-config-count">{columnPreference.visibleColumnKeys.length}</span>
              </button>
              {isColumnConfigOpen ? (
                <div className="data-table-config-panel" role="menu">
                  <div className="data-table-config-head">
                    <div className="data-table-config-title-row">
                      <strong>Column configuration</strong>
                      <InfoTooltip
                        content="Show or hide details, then drag rows to reorder how list view appears."
                        label="Column configuration information"
                      />
                    </div>
                  </div>
                  <div className="data-table-config-options">
                    {orderedColumns.map((column) => {
                      const columnLabel = getColumnPreferenceLabel(column);
                      const isVisible = visibleColumnKeySet.has(column.key);
                      const isPinned = column.canToggle === false;
                      const isLastVisibleColumn = isVisible && columnPreference.visibleColumnKeys.length === 1;

                      return (
                        <div
                          className={[
                            "data-table-config-option",
                            draggedColumnKey === column.key ? "is-dragging" : "",
                            isVisible ? "is-visible" : ""
                          ].filter(Boolean).join(" ")}
                          draggable={column.canReorder !== false}
                          key={column.key}
                          onDragEnd={() => setDraggedColumnKey("")}
                          onDragOver={(event) => {
                            if (!draggedColumnKey || draggedColumnKey === column.key || column.canReorder === false) {
                              return;
                            }
                            event.preventDefault();
                          }}
                          onDragStart={() => setDraggedColumnKey(column.key)}
                          onDrop={(event) => {
                            if (!draggedColumnKey || column.canReorder === false) {
                              return;
                            }

                            event.preventDefault();
                            updateColumnPreference((current) => ({
                              ...current,
                              orderedColumnKeys: moveColumnKey(current.orderedColumnKeys, draggedColumnKey, column.key)
                            }));
                            setDraggedColumnKey("");
                          }}
                        >
                          <span aria-hidden="true" className="data-table-config-drag-handle">
                            <DragHandleIcon />
                          </span>
                          <div className="data-table-config-option-copy">
                            <strong>{columnLabel}</strong>
                          </div>
                          {isPinned ? (
                            <span aria-label="Pinned column" className="data-table-config-option-state" title="Pinned column">
                              <PinIcon />
                            </span>
                          ) : (
                            <label className="data-table-config-toggle">
                              <input
                                checked={isVisible}
                                disabled={isLastVisibleColumn}
                                onChange={() => toggleColumn(column.key)}
                                type="checkbox"
                              />
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="data-table-config-actions">
                    <button className="link-button" onClick={resetColumns} type="button">
                      Reset defaults
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {!rows.length ? <div className="empty-state">{emptyMessage}</div> : null}

      {rows.length ? (
        <div className="table-wrap catalog-table-wrap">
          <table className={["data-table catalog-data-table", enableColumnResize ? "is-resizable" : ""].filter(Boolean).join(" ")}>
            {enableColumnResize ? (
              <colgroup>
                {activeColumns.map((column) => (
                  <col key={column.key} style={{ width: `${getColumnWidth(column)}px` }} />
                ))}
              </colgroup>
            ) : null}
            <thead>
              <tr>
                {activeColumns.map((column) => (
                  <th
                    className={[
                      enableHeaderColumnReorder && column.canReorder !== false ? "is-draggable-column" : "",
                      draggedColumnKey === column.key ? "is-header-dragging" : ""
                    ].filter(Boolean).join(" ")}
                    key={column.key}
                    onDragOver={(event) => {
                      if (!enableHeaderColumnReorder || !draggedColumnKey || draggedColumnKey === column.key || column.canReorder === false) {
                        return;
                      }
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      if (!enableHeaderColumnReorder || !draggedColumnKey || column.canReorder === false) {
                        return;
                      }

                      event.preventDefault();
                      moveColumn(draggedColumnKey, column.key);
                      setDraggedColumnKey("");
                    }}
                    aria-sort={
                      sortState?.key === column.key
                        ? (sortState.direction === "asc" ? "ascending" : "descending")
                        : undefined
                    }
                    style={enableColumnResize ? { width: `${getColumnWidth(column)}px` } : undefined}
                  >
                    <div className="data-table-column-header">
                      <div
                        className="data-table-column-drag-area"
                        draggable={enableHeaderColumnReorder && column.canReorder !== false}
                        onDragEnd={() => setDraggedColumnKey("")}
                        onDragStart={(event) => {
                          if (!enableHeaderColumnReorder || column.canReorder === false) {
                            return;
                          }
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", column.key);
                          setDraggedColumnKey(column.key);
                        }}
                      >
                        {column.headerRender ? column.headerRender() : (
                          column.sortValue ? (
                            <button
                              className="data-table-header-sort-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleSort(column);
                              }}
                              title={`Sort by ${getColumnPreferenceLabel(column)}`}
                              type="button"
                            >
                              <span className="data-table-header-label">{column.label}</span>
                              {sortState?.key === column.key ? (
                                <span aria-hidden="true" className="data-table-sort-indicator">
                                  {sortState.direction === "asc" ? "Asc" : "Desc"}
                                </span>
                              ) : null}
                            </button>
                          ) : <span className="data-table-header-label">{column.label}</span>
                        )}
                      </div>
                      {enableColumnResize && column.canResize !== false ? (
                        <span
                          aria-label={`Resize ${getColumnPreferenceLabel(column)} column`}
                          aria-orientation="vertical"
                          aria-valuemax={column.maxWidth || DEFAULT_MAX_COLUMN_WIDTH}
                          aria-valuemin={column.minWidth || DEFAULT_MIN_COLUMN_WIDTH}
                          aria-valuenow={getColumnWidth(column)}
                          className="data-table-column-resize-handle"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowLeft") {
                              event.preventDefault();
                              resizeColumnByKeyboard(column, -16);
                            }
                            if (event.key === "ArrowRight") {
                              event.preventDefault();
                              resizeColumnByKeyboard(column, 16);
                            }
                          }}
                          onPointerDown={(event) => handleColumnResizePointerDown(column, event)}
                          role="separator"
                          tabIndex={0}
                          title={`Resize ${getColumnPreferenceLabel(column)} column`}
                        />
                      ) : null}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, index) => {
                const rowClassName = [getRowClassName?.(row), onRowClick ? "is-clickable-row" : ""].filter(Boolean).join(" ");

                return (
                  <tr
                    className={rowClassName}
                    key={getRowKey ? getRowKey(row, index) : index}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {activeColumns.map((column) => (
                      <td key={column.key}>{column.render(row)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
