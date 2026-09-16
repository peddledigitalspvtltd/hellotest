import { useCapabilityAccess } from "../hooks/useCapabilityAccess";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { IconChevronDown, IconChevronUp, IconFilter } from "@tabler/icons-react";
import { SelectionToggleIcon, TestCaseIcon } from "./AppIcons";
import { CatalogSearchFilter } from "./CatalogSearchFilter";
import { richTextToPlainText } from "./RichTextEditor";
import type { TestCase, TestSuite } from "../types";
import "./SuiteCasePicker.css";

type SuiteCasePickerProps = {
  cases: TestCase[];
  selectedCaseIds: string[];
  onChange: (nextIds: string[]) => void;
  disabled?: boolean;
  heading?: string;
  description?: string;
  emptyMessage: string;
  moduleLabelByCaseId?: Record<string, string>;
  metadataByCaseId?: SuitePickerMetadataByCaseId;
};

type SuiteScopePickerProps = {
  projectId?: string;
  appTypeId?: string;
  suites: TestSuite[];
  selectedSuiteIds: string[];
  onChange: (nextIds: string[]) => void;
  heading?: string;
  description?: string;
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
  heading?: string;
  description?: string;
  emptyMessage: string;
  itemLabel: string;
  showCaseFilters?: boolean;
  showSelectionSummary?: boolean;
  disabled?: boolean;
  filterKeys: readonly SuitePickerFilterKey[];
  filterContent?: ReactNode;
  onFiltersOpenChange?: (open: boolean) => void;
  extraActiveFilterCount?: number;
  onClearExtraFilters?: () => void;
  selectionPending?: boolean;
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
      emptyMessage={emptyMessage}
      heading={heading}
      itemLabel="test case"
      items={items}
      onChange={onChange}
      selectedIds={selectedCaseIds}
      showCaseFilters
      showSelectionSummary={false}
      filterKeys={SUITE_CASE_FILTER_KEYS}
    />
  );
}

export function SuiteScopePicker(props: SuiteScopePickerProps) {
  return props.projectId ? <ScopedSuiteScopePicker {...props} projectId={props.projectId} /> : <LocalSuiteScopePicker {...props} />;
}

function ScopedSuiteScopePicker(props: SuiteScopePickerProps & { projectId: string }) {
  const { can } = useCapabilityAccess(props.projectId);
  return can("suite.view") ? <AuthorizedSuiteScopePicker {...props} /> : null;
}

function AuthorizedSuiteScopePicker({ projectId, appTypeId, suites, selectedSuiteIds, onChange, heading, description, emptyMessage }: SuiteScopePickerProps & { projectId: string }) {
  const { can } = useCapabilityAccess(projectId);
  const canFilterCases = can("testcase.view");
  const [caseSearch, setCaseSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [label, setLabel] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(caseSearch.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [caseSearch]);
  const hasServerFilters = canFilterCases && Boolean(debouncedSearch || moduleId || label.trim());
  const matching = useQuery({
    queryKey: ["suite-scope-picker", projectId, appTypeId || "", debouncedSearch, moduleId, label.trim()],
    queryFn: ({ signal }) => api.testSuites.list({ project_id: projectId, app_type_id: appTypeId || undefined,
      projection: "picker", case_search: debouncedSearch || undefined,
      module_id: moduleId || undefined, label: label.trim() || undefined }, { signal }),
    enabled: hasServerFilters, staleTime: 30_000, placeholderData: previous => previous, retry: false
  });
  const modules = useQuery({
    queryKey: ["test-case-picker-modules", projectId, appTypeId || ""],
    queryFn: () => api.testCaseModules.list({ project_id: projectId, app_type_id: appTypeId || undefined, projection: "summary" }),
    enabled: canFilterCases && filtersOpen, staleTime: 60_000, retry: false
  });
  const visibleSuites = hasServerFilters ? matching.data || [] : suites;
  const items = useMemo<OrderedSelectionPickerItem[]>(() => visibleSuites.map(suite => ({
    id: suite.id, displayId: suite.display_id || suite.id, title: suite.name,
    description: richTextToPlainText(suite.description || ""), labels: suite.labels || [],
    meta: `${suite.test_case_count ?? suite.test_case_ids?.length ?? 0} test cases`,
    metadata: { suite: [suite.display_id || suite.id, suite.name], label: suite.labels || [] }
  })), [visibleSuites]);
  const pending = canFilterCases && (caseSearch.trim() !== debouncedSearch || (hasServerFilters && (matching.isFetching || matching.isPlaceholderData)));
  const activeServerFilterCount = canFilterCases ? Number(Boolean(caseSearch.trim())) + Number(Boolean(moduleId)) + Number(Boolean(label.trim())) : 0;
  const clearServerFilters = () => {
    setCaseSearch("");
    setDebouncedSearch("");
    setModuleId("");
    setLabel("");
  };
  return <div className="suite-scope-server-picker">
    {pending ? <p role="status">Searching suite scope…</p> : null}
    {hasServerFilters && matching.isError ? <p role="alert">Suite filters couldn't be applied. <button className="ghost-button" type="button" onClick={() => void matching.refetch()}>Retry suite filters</button></p> : null}
    <OrderedSelectionPicker items={items} selectedIds={selectedSuiteIds} onChange={onChange}
      heading={heading} description={description} emptyMessage={pending ? "Searching suites…" : emptyMessage}
      itemLabel="suite" filterKeys={["suite", "label"]} selectionPending={pending}
      onFiltersOpenChange={setFiltersOpen} extraActiveFilterCount={activeServerFilterCount}
      onClearExtraFilters={clearServerFilters}
      filterContent={canFilterCases ? <div className="suite-scope-server-filters">
        <label className="catalog-filter-field"><span>Linked test cases and metadata</span><input type="search" aria-label="Search linked test cases and metadata" placeholder="Case, module, story, or shared step group" value={caseSearch} onChange={event => setCaseSearch(event.target.value)} /></label>
        <label className="catalog-filter-field"><span>Module</span><select aria-label="Filter suites by module" value={moduleId} onChange={event => setModuleId(event.target.value)}><option value="">All modules</option>{(modules.data || []).map(module => <option key={module.id} value={module.id}>{module.name}</option>)}</select></label>
        <label className="catalog-filter-field"><span>Label</span><input aria-label="Filter suites by label" value={label} onChange={event => setLabel(event.target.value)} placeholder="Exact label" /></label>
        {modules.isError ? <p role="alert">Module filters couldn't be loaded. <button className="ghost-button" type="button" onClick={() => void modules.refetch()}>Retry modules</button></p> : null}
      </div> : null} />
  </div>;
}

function LocalSuiteScopePicker({
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
          description: "",
          meta: `${suiteCaseIds.length} test case${suiteCaseIds.length === 1 ? "" : "s"}`,
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
      emptyMessage={emptyMessage}
      heading={heading}
      itemLabel="suite"
      items={items}
      onChange={onChange}
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
  showCaseFilters = false,
  showSelectionSummary = true,
  disabled = false,
  filterKeys,
  filterContent,
  onFiltersOpenChange,
  extraActiveFilterCount = 0,
  onClearExtraFilters,
  selectionPending = false
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
  const hasActiveFilters = Boolean(searchTerm.trim() || filterKey !== "all" || filterValue || extraActiveFilterCount);
  const activeMetadataFilterCount = Number(filterKey !== "all") + Number(Boolean(filterValue)) + extraActiveFilterCount;
  const selectionDisabled = disabled || selectionPending;
  const visibleSelectedCount = allVisibleItemIds.filter((itemId) => selectedIdSet.has(itemId)).length;

  const toggleItem = (itemId: string) => {
    if (selectionDisabled) return;

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
    if (selectionDisabled) return;
    onChange(Array.from(new Set([...selectedIds, ...allVisibleItemIds])));
  };

  const searchAndFilterControl = (
    <CatalogSearchFilter
      activeFilterCount={activeMetadataFilterCount}
      ariaLabel={`Search ${filterKey === "all" ? `${itemLabel}s` : FILTER_LABELS[filterKey]}`}
      disabled={disabled}
      filterIcon={<IconFilter aria-hidden="true" size={16} stroke={1.8} />}
      onChange={setSearchTerm}
      onOpenChange={onFiltersOpenChange}
      placeholder={filterKey === "all"
        ? `Search ${itemLabel}s and metadata...`
        : `Search associated ${FILTER_LABELS[filterKey].toLowerCase()} metadata...`}
      subtitle="Filter by metadata type and value."
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

        {filterContent}

        <div className="suite-reference-picker-filter-footer">
          <span aria-live="polite">Showing {filteredItems.length} of {items.length} {itemLabel}{items.length === 1 ? "" : "s"}</span>
          <button
            className="ghost-button"
            disabled={disabled || !activeMetadataFilterCount}
            onClick={() => {
              setFilterKey("all");
              setFilterValue("");
              onClearExtraFilters?.();
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
              disabled={selectionDisabled || !allVisibleItemIds.length || areAllVisibleItemsSelected}
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
                      <input checked={isSelected} disabled={selectionDisabled} onChange={() => toggleItem(item.id)} type="checkbox" />
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
                      {item.description ? <span>{item.description}</span> : null}
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
                        disabled={disabled || !isSelected || selectedIndex === selectedIds.length - 1}
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
    <div className="modal-case-picker suite-scope-picker">
      {heading || description ? <div className="suite-scope-picker-heading">
        {heading ? <strong>{heading}</strong> : null}
        {description ? <span>{description}</span> : null}
      </div> : null}

      <div className="suite-reference-picker-toolbar suite-reference-picker-toolbar--scope">
        {searchAndFilterControl}
        <div className="suite-case-picker-actions" aria-label="Suite selection actions">
          <button className="ghost-button" disabled={selectionDisabled || !allVisibleItemIds.length || areAllVisibleItemsSelected} onClick={selectVisibleItems} type="button">
            <SelectionToggleIcon checked />
            Select all
          </button>
          <button className="ghost-button" disabled={disabled || !selectedIds.length} onClick={() => onChange([])} type="button">
            <SelectionToggleIcon checked={false} />
            Clear
          </button>
        </div>
      </div>

      {showSelectionSummary ? <div className="suite-scope-picker-summary" aria-live="polite">
        <span>{selectedIds.length} {itemLabel}{selectedIds.length === 1 ? "" : "s"} selected</span>
        {hasActiveFilters ? <span>{filteredItems.length} shown · {visibleSelectedCount} selected here</span> : null}
      </div> : null}

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
                  <input checked={isSelected} disabled={selectionDisabled} onChange={() => toggleItem(item.id)} type="checkbox" />
                  <div className="suite-case-picker-option-copy">
                    <div className="suite-case-picker-option-title">
                      {isSelected ? <span className="suite-case-picker-order">{selectedIndex + 1}</span> : null}
                      <strong>{item.title}</strong>
                    </div>
                    {item.description ? <span>{item.description}</span> : null}
                    {item.labels?.length ? <span className="suite-case-picker-option-meta">Labels: {item.labels.join(", ")}</span> : null}
                    {item.moduleLabel ? <span className="suite-case-picker-option-meta">Module: {item.moduleLabel}</span> : null}
                    {item.meta ? <span className="suite-case-picker-option-meta">{item.meta}</span> : null}
                  </div>
                </label>

                <div className="suite-case-picker-option-actions" role="group" aria-label={`${item.title} ordering controls`}>
                  <button
                    aria-label={`Move ${item.title} up`}
                    className="ghost-button suite-case-picker-move"
                    disabled={disabled || !isSelected || selectedIndex === 0}
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
                    disabled={disabled || !isSelected || selectedIndex === selectedIds.length - 1}
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
