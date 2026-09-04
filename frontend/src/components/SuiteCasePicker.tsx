import { useMemo, useState } from "react";
import { IconChevronDown, IconChevronUp, IconFilter } from "@tabler/icons-react";
import { SelectionToggleIcon, TestCaseIcon } from "./AppIcons";
import { CatalogSearchFilter } from "./CatalogSearchFilter";
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
  metadataByCaseId?: SuitePickerMetadataByCaseId;
};

type SuiteScopePickerProps = {
  suites: TestSuite[];
  selectedSuiteIds: string[];
  onChange: (nextIds: string[]) => void;
  heading: string;
  description: string;
  emptyMessage: string;
  testCases?: TestCase[];
  metadataByCaseId?: SuitePickerMetadataByCaseId;
};

export type SuitePickerFilterKey = "test-case" | "module" | "requirement" | "label" | "suite" | "shared-step-group";

export type SuitePickerCaseMetadata = {
  modules?: string[];
  requirements?: string[];
  suites?: string[];
  sharedStepGroups?: string[];
};

export type SuitePickerMetadataByCaseId = Record<string, SuitePickerCaseMetadata>;

const FILTER_LABELS: Record<SuitePickerFilterKey, string> = {
  "test-case": "Test case",
  module: "Module",
  requirement: "Requirement",
  label: "Label",
  suite: "Suite",
  "shared-step-group": "Shared step group"
};

const SUITE_CASE_FILTER_KEYS: SuitePickerFilterKey[] = ["module", "requirement", "label", "shared-step-group"];
const RUN_SCOPE_FILTER_KEYS: SuitePickerFilterKey[] = ["test-case", "module", "requirement", "label", "suite", "shared-step-group"];

const normalizeMetadataValue = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase();

const uniqueMetadataValues = (values: Array<string | null | undefined>) => {
  const valuesByKey = new Map<string, string>();

  values.forEach((value) => {
    const trimmedValue = String(value ?? "").trim();
    const normalizedValue = normalizeMetadataValue(trimmedValue);

    if (normalizedValue && !valuesByKey.has(normalizedValue)) {
      valuesByKey.set(normalizedValue, trimmedValue);
    }
  });

  return Array.from(valuesByKey.values());
};

type OrderedSelectionPickerItem = {
  id: string;
  displayId?: string;
  title: string;
  description: string;
  meta?: string;
  labels?: string[];
  moduleLabel?: string;
  metadata: Partial<Record<SuitePickerFilterKey, string[]>>;
  associatedMetadata?: Array<Partial<Record<SuitePickerFilterKey, string[]>>>;
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
  filterKeys: readonly SuitePickerFilterKey[];
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
  moduleLabelByCaseId = {},
  metadataByCaseId = {}
}: SuiteCasePickerProps) {
  const items = useMemo<OrderedSelectionPickerItem[]>(
    () =>
      cases.map((testCase) => {
        const metadata: OrderedSelectionPickerItem["metadata"] = {
          "test-case": [testCase.display_id || testCase.id, testCase.title],
          module: metadataByCaseId[testCase.id]?.modules || (moduleLabelByCaseId[testCase.id] ? [moduleLabelByCaseId[testCase.id]] : []),
          requirement: metadataByCaseId[testCase.id]?.requirements || [],
          label: testCase.labels || [],
          suite: metadataByCaseId[testCase.id]?.suites || [],
          "shared-step-group": metadataByCaseId[testCase.id]?.sharedStepGroups || []
        };

        return {
          id: testCase.id,
          displayId: testCase.display_id || testCase.id,
          title: testCase.title,
          description: richTextToPlainText(testCase.description) || "No description yet for this test case.",
          labels: testCase.labels || [],
          moduleLabel: moduleLabelByCaseId[testCase.id] || "",
          metadata,
          associatedMetadata: [metadata]
        };
      }),
    [cases, metadataByCaseId, moduleLabelByCaseId]
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
      filterKeys={SUITE_CASE_FILTER_KEYS}
    />
  );
}

export function SuiteScopePicker({
  suites,
  selectedSuiteIds,
  onChange,
  heading,
  description,
  emptyMessage,
  testCases = [],
  metadataByCaseId = {}
}: SuiteScopePickerProps) {
  const testCaseById = useMemo(() => new Map(testCases.map((testCase) => [testCase.id, testCase])), [testCases]);
  const items = useMemo<OrderedSelectionPickerItem[]>(
    () =>
      suites.map((suite) => {
        const suiteCaseIds = uniqueMetadataValues([
          ...(suite.test_case_ids || []),
          ...testCases
            .filter((testCase) => (testCase.suite_ids || [testCase.suite_id]).filter(Boolean).includes(suite.id))
            .map((testCase) => testCase.id)
        ]);
        const suiteReference = suite.display_id ? `${suite.display_id} · ${suite.name}` : suite.name;
        const associatedMetadata: Array<Partial<Record<SuitePickerFilterKey, string[]>>> = suiteCaseIds.map((caseId) => {
          const testCase = testCaseById.get(caseId);
          const caseMetadata = metadataByCaseId[caseId] || {};

          return {
            suite: uniqueMetadataValues([suiteReference, ...(caseMetadata.suites || [])]),
            "test-case": [testCase
              ? `${testCase.display_id || testCase.id} · ${testCase.title}`
              : caseId],
            module: uniqueMetadataValues(caseMetadata.modules || []),
            requirement: uniqueMetadataValues(caseMetadata.requirements || []),
            label: uniqueMetadataValues([...(suite.labels || []), ...(testCase?.labels || [])]),
            "shared-step-group": uniqueMetadataValues(caseMetadata.sharedStepGroups || [])
          } satisfies Partial<Record<SuitePickerFilterKey, string[]>>;
        });
        if (!associatedMetadata.length) {
          associatedMetadata.push({
            suite: [suiteReference],
            label: uniqueMetadataValues(suite.labels || [])
          });
        }
        const collectAssociatedMetadata = (key: SuitePickerFilterKey) => uniqueMetadataValues(
          associatedMetadata.flatMap((metadata) => metadata[key] || [])
        );

        return {
          id: suite.id,
          displayId: suite.display_id || suite.id,
          title: suite.name,
          description: suite.labels?.length ? `Labels: ${suite.labels.join(", ")}` : "Reusable suite",
          meta: `${suiteCaseIds.length} test case${suiteCaseIds.length === 1 ? "" : "s"} · Captured as a suite snapshot for this run.`,
          labels: suite.labels || [],
          metadata: {
            suite: collectAssociatedMetadata("suite"),
            "test-case": collectAssociatedMetadata("test-case"),
            module: collectAssociatedMetadata("module"),
            requirement: collectAssociatedMetadata("requirement"),
            label: collectAssociatedMetadata("label"),
            "shared-step-group": collectAssociatedMetadata("shared-step-group")
          },
          associatedMetadata
        };
      }),
    [metadataByCaseId, suites, testCaseById, testCases]
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
      filterKeys={RUN_SCOPE_FILTER_KEYS}
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
  disabled = false,
  filterKeys
}: OrderedSelectionPickerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterKey, setFilterKey] = useState<"all" | SuitePickerFilterKey>("all");
  const [filterValue, setFilterValue] = useState("");
  const availableFilterValues = useMemo(() => {
    if (filterKey === "all") return [];
    return uniqueMetadataValues(items.flatMap((item) => item.metadata[filterKey] || []))
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }, [filterKey, items]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const filteredItems = useMemo(() => {
    const search = normalizeMetadataValue(searchTerm);
    const selectedFilterValue = normalizeMetadataValue(filterValue);

    return items.filter((item) => {
      const itemLabels = item.labels || [];
      const itemModule = String(item.moduleLabel || "");
      const metadataRecords = item.associatedMetadata?.length ? item.associatedMetadata : [item.metadata];
      const metadataValues = filterKey === "all"
        ? Object.values(item.metadata).flatMap((values) => values || [])
        : item.metadata[filterKey] || [];
      const matchingMetadataRecords = filterKey === "all" || !selectedFilterValue
        ? metadataRecords
        : metadataRecords.filter((metadata) =>
            (metadata[filterKey] || []).some((value) => normalizeMetadataValue(value) === selectedFilterValue)
          );

      if (selectedFilterValue && !matchingMetadataRecords.length) {
        return false;
      }

      const baseSearchValues = [item.displayId || "", item.id, item.title, item.description, item.meta || "", itemModule, ...itemLabels];
      const searchValues = filterKey === "all"
        ? [...baseSearchValues, ...metadataValues]
        : selectedFilterValue
          ? [
              ...baseSearchValues,
              ...matchingMetadataRecords.flatMap((metadata) => [
                ...(metadata[filterKey] || []),
                ...(metadata["test-case"] || [])
              ])
            ]
          : matchingMetadataRecords.flatMap((metadata) => metadata[filterKey] || []);
      const searchHaystack = searchValues.map(normalizeMetadataValue).join(" ");

      if (search && !searchHaystack.includes(search)) {
        return false;
      }

      return true;
    });
  }, [filterKey, filterValue, items, searchTerm]);
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
    [allVisibleItemIds, filteredItems, selectedIds, selectedItems, showCaseFilters]
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const areAllVisibleItemsSelected = Boolean(allVisibleItemIds.length) && allVisibleItemIds.every((itemId) => selectedIdSet.has(itemId));
  const hasActiveFilters = Boolean(searchTerm.trim() || filterKey !== "all" || filterValue);
  const activeMetadataFilterCount = Number(filterKey !== "all") + Number(Boolean(filterValue));
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

  const searchAndFilterControl = (
    <CatalogSearchFilter
      activeFilterCount={activeMetadataFilterCount}
      ariaLabel={`Search ${filterKey === "all" ? `${itemLabel}s` : FILTER_LABELS[filterKey]}`}
      disabled={disabled}
      filterIcon={<IconFilter aria-hidden="true" size={16} stroke={1.8} />}
      onChange={setSearchTerm}
      placeholder={filterKey === "all"
        ? `Search ${itemLabel}s and metadata...`
        : `Search associated ${FILTER_LABELS[filterKey].toLowerCase()} metadata...`}
      subtitle="Choose a metadata type and an optional value. Search is scoped to the selected metadata type."
      title={`Filter ${itemLabel}s`}
      value={searchTerm}
    >
      <div className="catalog-filter-grid suite-reference-picker-filter-grid">
        <label className="catalog-filter-field">
          <span>Metadata type</span>
          <select
            aria-label="Filter search metadata"
            disabled={disabled}
            onChange={(event) => {
              setFilterKey(event.target.value as "all" | SuitePickerFilterKey);
              setFilterValue("");
            }}
            value={filterKey}
          >
            <option value="all">All metadata</option>
            {filterKeys.map((key) => <option key={key} value={key}>{FILTER_LABELS[key]}</option>)}
          </select>
        </label>

        {filterKey !== "all" ? (
          <label className="catalog-filter-field">
            <span>{FILTER_LABELS[filterKey]} value</span>
            <select aria-label={`Choose ${FILTER_LABELS[filterKey]}`} disabled={disabled} onChange={(event) => setFilterValue(event.target.value)} value={filterValue}>
              <option value="">Any {FILTER_LABELS[filterKey].toLowerCase()}</option>
              {availableFilterValues.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        ) : null}

        <div className="suite-reference-picker-filter-footer">
          <span aria-live="polite">Showing {filteredItems.length} of {items.length} {itemLabel}{items.length === 1 ? "" : "s"}</span>
          <button
            className="ghost-button"
            disabled={disabled || !activeMetadataFilterCount}
            onClick={() => {
              setFilterKey("all");
              setFilterValue("");
            }}
            type="button"
          >
            Clear filters
          </button>
        </div>
      </div>
    </CatalogSearchFilter>
  );

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
          {searchAndFilterControl}
          <div className="suite-reference-picker-selection-actions" aria-label="Reusable test case selection actions">
            <button
              className="ghost-button"
              disabled={disabled || !allVisibleItemIds.length || areAllVisibleItemsSelected}
              onClick={selectVisibleItems}
              type="button"
            >
              <SelectionToggleIcon checked />
              Select all
            </button>
            <span aria-hidden="true" className="suite-reference-picker-action-divider" />
            <button className="ghost-button" disabled={disabled || !selectedIds.length} onClick={() => onChange([])} type="button">
              <SelectionToggleIcon checked={false} />
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
                      {item.metadata.requirement?.length ? <small>Requirements: {item.metadata.requirement.join(", ")}</small> : null}
                      {item.metadata["shared-step-group"]?.length ? <small>Shared Step Groups: {item.metadata["shared-step-group"].join(", ")}</small> : null}
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
            <SelectionToggleIcon checked />
            Select all
          </button>
          <button className="ghost-button" disabled={!selectedIds.length} onClick={() => onChange([])} type="button">
            <SelectionToggleIcon checked={false} />
            Clear
          </button>
        </div>
      </div>

      <div className="suite-reference-picker-toolbar suite-reference-picker-toolbar--scope">
        {searchAndFilterControl}
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
                  <input checked={isSelected} disabled={disabled} onChange={() => toggleItem(item.id)} type="checkbox" />
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
