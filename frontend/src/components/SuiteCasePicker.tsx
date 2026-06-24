import { useMemo } from "react";
import type { TestCase, TestSuite } from "../types";

type SuiteCasePickerProps = {
  cases: TestCase[];
  selectedCaseIds: string[];
  onChange: (nextIds: string[]) => void;
  heading: string;
  description: string;
  emptyMessage: string;
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
  title: string;
  description: string;
  meta?: string;
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
  heading,
  description,
  emptyMessage
}: SuiteCasePickerProps) {
  const items = useMemo<OrderedSelectionPickerItem[]>(
    () =>
      cases.map((testCase) => ({
        id: testCase.id,
        title: testCase.title,
        description: testCase.description || "No description yet for this test case."
      })),
    [cases]
  );

  return (
    <OrderedSelectionPicker
      description={description}
      emptyHint="Select cases to assign them into this suite."
      emptyMessage={emptyMessage}
      heading={heading}
      itemLabel="test case"
      items={items}
      onChange={onChange}
      selectedHint="Checked cases stay pinned to the top and will be saved in this order."
      selectedIds={selectedCaseIds}
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
        description: suite.parent_id ? "Nested suite" : "Root suite",
        meta: suite.parent_id ? "Captured with its parent hierarchy preserved." : "Captured as a top-level suite snapshot."
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
  emptyHint
}: OrderedSelectionPickerProps) {
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const allItemIds = useMemo(() => items.map((item) => item.id), [items]);
  const selectedItems = useMemo(
    () => selectedIds.map((id) => itemById.get(id)).filter((item): item is OrderedSelectionPickerItem => Boolean(item)),
    [itemById, selectedIds]
  );
  const orderedItems = useMemo(
    () => [
      ...selectedItems,
      ...items.filter((item) => !selectedIds.includes(item.id))
    ],
    [items, selectedIds, selectedItems]
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const areAllItemsSelected = Boolean(items.length) && selectedItems.length === items.length;

  const toggleItem = (itemId: string) => {
    if (selectedIdSet.has(itemId)) {
      onChange(selectedIds.filter((id) => id !== itemId));
      return;
    }

    onChange([...selectedIds, itemId]);
  };

  const moveSelectedItem = (itemId: string, direction: "up" | "down") => {
    const currentIndex = selectedIds.indexOf(itemId);

    if (currentIndex === -1) {
      return;
    }

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    onChange(moveItem(selectedIds, currentIndex, targetIndex));
  };

  return (
    <div className="modal-case-picker">
      <div className="suite-case-picker-toolbar">
        <div>
          <strong>{heading}</strong>
          <span>{description}</span>
        </div>
        <div className="suite-case-picker-actions">
          <button className="ghost-button" disabled={!items.length || areAllItemsSelected} onClick={() => onChange(allItemIds)} type="button">
            Select all
          </button>
          <button className="ghost-button" disabled={!selectedIds.length} onClick={() => onChange([])} type="button">
            Clear
          </button>
        </div>
      </div>

      <div className="detail-summary suite-case-picker-summary">
        <strong>{selectedItems.length} {itemLabel}{selectedItems.length === 1 ? "" : "s"} selected</strong>
        <span>
          {selectedItems.length ? selectedHint : emptyHint}
        </span>
      </div>

      {!items.length ? <div className="empty-state compact">{emptyMessage}</div> : null}

      {items.length ? (
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
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16">
      {direction === "up" ? <path d="m7 14 5-5 5 5" /> : <path d="m7 10 5 5 5-5" />}
    </svg>
  );
}
