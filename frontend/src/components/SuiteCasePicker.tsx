import { useMemo, useState } from "react";
import { IconChevronDown, IconChevronUp, IconSearch } from "@tabler/icons-react";
import { TestCaseIcon } from "./AppIcons";
import { richTextToPlainText } from "./RichTextEditor";
import type { TestCase, TestSuite } from "../types";

type SuiteCasePickerProps = {
  cases: TestCase[];
  selectedCaseIds: string[];
  onChange: (nextIds: string[]) => void;
  disabled?: boolean;
  heading: string;
  description: string;
  emptyMessage: string;
  moduleLabelByCaseId?: Record<string, string>;
};

type SuiteScopePickerProps = {
  suites: TestSuite[];
  selectedSuiteIds: string[];
  onChange: (nextIds: string[]) => void;
  heading: string;
  description: string;
  emptyMessage: string;
};

type OrderedSelectionPickerItem = {
  id: string;
  displayId?: string;
  title: string;
  description: string;
  meta?: string;
  labels?: string[];
  moduleLabel?: string;
};

type OrderedSelectionPickerProps = {
  items: OrderedSelectionPickerItem[];
  selectedIds: string[];
  onChange: (nextIds: string[]) => void;
  heading: string;
  description: string;
  emptyMessage: string;
  itemLabel: string;
  selectedHint: string;
  emptyHint: string;
  showCaseFilters?: boolean;
  showSelectionSummary?: boolean;
  disabled?: boolean;
};

const moveItem = <T,>(items: T[], fromIndex: number, toIndex: number) => {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }

  const next = [...items];
  const [movedItem] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, movedItem);
  return next;
};

export function SuiteCasePicker({
  cases,
  selectedCaseIds,
  onChange,
  disabled = false,
  heading,
  description,
  emptyMessage,
  moduleLabelByCaseId = {}
}: SuiteCasePickerProps) {
  const items = useMemo<OrderedSelectionPickerItem[]>(
    () =>
      cases.map((testCase) => ({
        id: testCase.id,
        displayId: testCase.display_id || testCase.id,
        title: testCase.title,
        description: richTextToPlainText(testCase.description) || "No description yet for this test case.",
        labels: testCase.labels || [],
        moduleLabel: moduleLabelByCaseId[testCase.id] || ""
      })),
    [cases, moduleLabelByCaseId]
  );

  return (
    <OrderedSelectionPicker
      description={description}
      disabled={disabled}
      emptyHint=""
      emptyMessage={emptyMessage}
      heading={heading}
      itemLabel="test case"
      items={items}
      onChange={onChange}
      selectedHint=""
      selectedIds={selectedCaseIds}
      showCaseFilters
      showSelectionSummary={false}
    />
  );
}

export function SuiteScopePicker({
  suites,
  selectedSuiteIds,
  onChange,
  heading,
  description,
  emptyMessage
}: SuiteScopePickerProps) {
  const items = useMemo<OrderedSelectionPickerItem[]>(
    () =>
      suites.map((suite) => ({
        id: suite.id,
        title: suite.name,
        description: suite.labels?.length ? `Labels: ${suite.labels.join(", ")}` : "Reusable suite",
        meta: "Captured as a suite snapshot for this run."
      })),
    [suites]
  );

  return (
    <OrderedSelectionPicker
      description={description}
      emptyHint="Select one or more suites to build the execution scope."
      emptyMessage={emptyMessage}
      heading={heading}
      itemLabel="suite"
      items={items}
      onChange={onChange}
      selectedHint="Checked suites stay pinned to the top and will be used in this order for the execution snapshot."
      selectedIds={selectedSuiteIds}
    />
  );
}

function OrderedSelectionPicker({
  items,
  selectedIds,
  onChange,
  heading,
  description,
  emptyMessage,
  itemLabel,
  selectedHint,
  emptyHint,
  showCaseFilters = false,
  showSelectionSummary = true,
  disabled = false
}: OrderedSelectionPickerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const filteredItems = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return items.filter((item) => {
      const itemLabels = item.labels || [];
      const itemModule = String(item.moduleLabel || "");
      const searchHaystack = [
        item.displayId || "",
        item.id,
        item.title,
        item.description,
        item.meta || "",
        itemModule,
        ...itemLabels
      ].join(" ").toLowerCase();

      if (search && !searchHaystack.includes(search)) {
        return false;
      }

      return true;
    });
  }, [items, searchTerm]);
  const allVisibleItemIds = useMemo(() => filteredItems.map((item) => item.id), [filteredItems]);
  const selectedItems = useMemo(
    () => selectedIds.map((id) => itemById.get(id)).filter((item): item is OrderedSelectionPickerItem => Boolean(item)),
    [itemById, selectedIds]
  );
  const orderedItems = useMemo(
    () => [
      ...selectedItems.filter((item) => allVisibleItemIds.includes(item.id)),
      ...filteredItems.filter((item) => !selectedIds.includes(item.id))
    ],
    [allVisibleItemIds, filteredItems, selectedIds, selectedItems]
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const areAllVisibleItemsSelected = Boolean(allVisibleItemIds.length) && allVisibleItemIds.every((itemId) => selectedIdSet.has(itemId));
  const hasActiveFilters = Boolean(searchTerm.trim());
  const visibleSelectedCount = allVisibleItemIds.filter((itemId) => selectedIdSet.has(itemId)).length;

  const toggleItem = (itemId: string) => {
    if (disabled) return;

    if (selectedIdSet.has(itemId)) {
      onChange(selectedIds.filter((id) => id !== itemId));
      return;
    }

    onChange([...selectedIds, itemId]);
  };

  const moveSelectedItem = (itemId: string, direction: "up" | "down") => {
    if (disabled) return;

    const currentIndex = selectedIds.indexOf(itemId);

    if (currentIndex === -1) {
      return;
    }

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    onChange(moveItem(selectedIds, currentIndex, targetIndex));
  };

  const selectVisibleItems = () => {
    if (disabled) return;
    onChange(Array.from(new Set([...selectedIds, ...allVisibleItemIds])));
  };

  if (showCaseFilters) {
    return (
      <div className="modal-case-picker suite-reference-case-picker">
        <div className="suite-reference-picker-heading">
          <div>
            <strong>{heading}</strong>
            {description ? <span>{description}</span> : null}
          </div>
        </div>

        <div className="suite-reference-picker-toolbar">
          <label className="suite-reference-picker-search">
            <IconSearch aria-hidden="true" size={16} stroke={1.8} />
            <span className="sr-only">Search test cases</span>
            <input
              aria-label="Search test cases"
              disabled={disabled}
              placeholder="Search test cases by ID, name, or description..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>
          <div className="suite-reference-picker-selection-actions" aria-label="Reusable test case selection actions">
            <button
              className="ghost-button"
              disabled={disabled || !allVisibleItemIds.length || areAllVisibleItemsSelected}
              onClick={selectVisibleItems}
              type="button"
            >
              Select all
            </button>
            <span aria-hidden="true" className="suite-reference-picker-action-divider" />
            <button className="ghost-button" disabled={disabled || !selectedIds.length} onClick={() => onChange([])} type="button">
              Clear
            </button>
          </div>
        </div>

        {!items.length ? <div className="empty-state compact">{emptyMessage}</div> : null}
        {items.length && !orderedItems.length ? <div className="empty-state compact">No test cases match the current search.</div> : null}

        {orderedItems.length ? (
          <div className="suite-reference-case-table" role="table" aria-label="Reusable test cases">
            <div className="suite-reference-case-table-header" role="row">
              <span aria-hidden="true" />
              <span role="columnheader">Test case details</span>
              <span role="columnheader">Order</span>
            </div>
            <div className="suite-reference-case-table-body" role="rowgroup">
              {orderedItems.map((item) => {
                const selectedIndex = selectedIds.indexOf(item.id);
                const isSelected = selectedIndex >= 0;

                return (
                  <div
                    className={isSelected ? "suite-reference-case-row is-selected" : "suite-reference-case-row"}
                    key={item.id}
                    role="row"
                  >
                    <label className="suite-reference-case-checkbox" title={`${isSelected ? "Remove" : "Select"} ${item.title}`}>
                      <input checked={isSelected} disabled={disabled} onChange={() => toggleItem(item.id)} type="checkbox" />
                      <span className="sr-only">{isSelected ? "Remove" : "Select"} {item.title}</span>
                    </label>
                    <div className="suite-reference-case-copy" role="cell">
                      <div className="suite-reference-case-title">
                        <span className="suite-reference-case-id">
                          <TestCaseIcon size={15} strokeWidth={1.8} />
                          <span>{item.displayId || item.id}</span>
                        </span>
                        <strong>{item.title}</strong>
                      </div>
                      <span>{item.description}</span>
                      {item.labels?.length ? <small>Labels: {item.labels.join(", ")}</small> : null}
                      {item.moduleLabel ? <small>Module: {item.moduleLabel}</small> : null}
                    </div>
                    <div className="suite-reference-case-order" role="cell" aria-label={`${item.title} ordering controls`}>
                      <button
                        aria-label={`Move ${item.title} up`}
                        className="ghost-button"
                        disabled={disabled || !isSelected || selectedIndex === 0}
                        onClick={() => moveSelectedItem(item.id, "up")}
                        type="button"
                      >
                        <IconChevronUp aria-hidden="true" size={16} stroke={1.8} />
                      </button>
                      <button
                        aria-label={`Move ${item.title} down`}
                        className="ghost-button"
                        disabled={disabled || !isSelected || selectedIndex === selectedItems.length - 1}
                        onClick={() => moveSelectedItem(item.id, "down")}
                        type="button"
                      >
                        <IconChevronDown aria-hidden="true" size={16} stroke={1.8} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="modal-case-picker">
      <div className="suite-case-picker-toolbar">
        <div>
          <strong>{heading}</strong>
          {description ? <span>{description}</span> : null}
        </div>
        <div className="suite-case-picker-actions">
          <button className="ghost-button" disabled={!allVisibleItemIds.length || areAllVisibleItemsSelected} onClick={selectVisibleItems} type="button">
            Select all
          </button>
          <button className="ghost-button" disabled={!selectedIds.length} onClick={() => onChange([])} type="button">
            Clear
          </button>
        </div>
      </div>

      {showSelectionSummary ? (
        <div className="detail-summary suite-case-picker-summary">
          <strong>{selectedItems.length} {itemLabel}{selectedItems.length === 1 ? "" : "s"} selected</strong>
          <span>
            {hasActiveFilters
              ? `${visibleSelectedCount} selected in the current filtered list.`
              : selectedItems.length
                ? selectedHint
                : emptyHint}
          </span>
        </div>
      ) : null}

      {!items.length ? <div className="empty-state compact">{emptyMessage}</div> : null}
      {items.length && !orderedItems.length ? <div className="empty-state compact">No {itemLabel}s match the current filters.</div> : null}

      {orderedItems.length ? (
        <div className="suite-case-picker-list suite-case-picker-list--ordered">
          {orderedItems.map((item) => {
            const selectedIndex = selectedIds.indexOf(item.id);
            const isSelected = selectedIndex >= 0;

            return (
              <div className={isSelected ? "suite-case-picker-option is-selected" : "suite-case-picker-option"} key={item.id}>
                <label className="suite-case-picker-option-label">
                  <input checked={isSelected} onChange={() => toggleItem(item.id)} type="checkbox" />
                  <div className="suite-case-picker-option-copy">
                    <div className="suite-case-picker-option-title">
                      {isSelected ? <span className="suite-case-picker-order">{selectedIndex + 1}</span> : null}
                      <strong>{item.title}</strong>
                    </div>
                    <span>{item.description}</span>
                    {item.labels?.length ? <span className="suite-case-picker-option-meta">Labels: {item.labels.join(", ")}</span> : null}
                    {item.moduleLabel ? <span className="suite-case-picker-option-meta">Module: {item.moduleLabel}</span> : null}
                    {item.meta ? <span className="suite-case-picker-option-meta">{item.meta}</span> : null}
                  </div>
                </label>

                <div className="suite-case-picker-option-actions" role="group" aria-label={`${item.title} ordering controls`}>
                  <button
                    aria-label={`Move ${item.title} up`}
                    className="ghost-button suite-case-picker-move"
                    disabled={!isSelected || selectedIndex === 0}
                    onClick={(event) => {
                      event.preventDefault();
                      moveSelectedItem(item.id, "up");
                    }}
                    type="button"
                  >
                    <SuiteCasePickerArrowIcon direction="up" />
                  </button>
                  <button
                    aria-label={`Move ${item.title} down`}
                    className="ghost-button suite-case-picker-move"
                    disabled={!isSelected || selectedIndex === selectedItems.length - 1}
                    onClick={(event) => {
                      event.preventDefault();
                      moveSelectedItem(item.id, "down");
                    }}
                    type="button"
                  >
                    <SuiteCasePickerArrowIcon direction="down" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SuiteCasePickerArrowIcon({ direction }: { direction: "up" | "down" }) {
  return direction === "up"
    ? <IconChevronUp aria-hidden="true" size={16} stroke={1.8} />
    : <IconChevronDown aria-hidden="true" size={16} stroke={1.8} />;
}
