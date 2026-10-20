import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { IconChevronDown, IconChevronUp, IconSearch, IconX } from "@tabler/icons-react";
import { platformApi } from "@hellotest/platform/frontend/api.client";
import { testingApi } from "../api.client";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import type { TestCase } from "@hellotest/platform/frontend/src/types";
import { HierarchyAutoLoadSentinel } from "./HierarchyLoadMoreButton";
import { TestAutomationIcon, SelectionToggleIcon, TestCaseIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { CatalogSearchFilter } from "@hellotest/platform/frontend/src/shared/components/CatalogSearchFilter";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import "./TestCasePicker.css";

export type TestCasePickerFilters = {
  module_id?: string;
  unassigned_module?: boolean;
  suite_id?: string;
  requirement_id?: string;
  label?: string;
  shared_step_group_id?: string;
  automated?: "yes" | "no";
  status?: string;
};

export type TestCaseSelectionResolution = {
  selectionKey: string;
  pending: boolean;
  error: unknown;
  unavailableIds: string[];
};

export type TestCasePickerProps = {
  projectId: string;
  appTypeId?: string;
  selectedIds: string[];
  onChange: (ids: string[], selectedItems: TestCase[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  initialItems?: TestCase[];
  heading?: string;
  emptyMessage?: string;
  filters?: TestCasePickerFilters;
  allowReorder?: boolean;
  presentation?: "default" | "inline" | "impact";
  selectionContext?: "module" | "run" | "suite";
  onItemsResolved?: (selectedItems: TestCase[]) => void;
  onSelectionResolutionChange?: (resolution: TestCaseSelectionResolution) => void;
};

const PAGE_SIZE = 25;
const EMPTY_ITEMS: TestCase[] = [];

function CaseIdentity({ item, fallback }: { item?: TestCase; fallback: string }) {
  const isAutomation = item?.automated === "yes";
  const Icon = isAutomation ? TestAutomationIcon : TestCaseIcon;
  return <span className="test-case-picker-id"><Icon size={15} strokeWidth={1.8} />{item?.display_id || fallback}<span className="test-case-picker-kind">{isAutomation ? "Automation" : item ? "Manual" : "Loading"}</span></span>;
}

// A new project/application gets its own label cache. Within that scope, selected
// IDs and labels survive searches and page changes independently of result rows.
export function TestCasePicker(props: TestCasePickerProps) {
  const { can } = useCapabilityAccess(props.projectId);
  if (!can("testcase.view")) return null;
  return <ScopedTestCasePicker key={JSON.stringify([props.projectId, props.appTypeId])} {...props} />;
}

function ScopedTestCasePicker({
  projectId, appTypeId, selectedIds, onChange, multiple = true, disabled = false,
  initialItems = EMPTY_ITEMS, heading = "Test cases", emptyMessage = "No test cases match this search.",
  filters, allowReorder = false, presentation = "default", selectionContext = "module", onItemsResolved, onSelectionResolutionChange
}: TestCasePickerProps) {
  const controlId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const selectVisibleRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [impactOpen, setImpactOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moduleFilter, setModuleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [automationFilter, setAutomationFilter] = useState<"" | "yes" | "no">("");
  const [knownItems, setKnownItems] = useState(() => new Map(initialItems.map(item => [item.id, item])));
  const isImpact = presentation === "impact";
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedIndexById = useMemo(() => new Map(selectedIds.map((id, index) => [id, index])), [selectedIds]);
  const selectedIdsKey = JSON.stringify(selectedIds);
  const filterKey = JSON.stringify([
    filters?.module_id, filters?.suite_id, filters?.requirement_id,
    filters?.label, filters?.shared_step_group_id, filters?.automated,
    filters?.status, filters?.unassigned_module, moduleFilter, statusFilter, automationFilter
  ]);
  const scopeKey = JSON.stringify([projectId, appTypeId, filterKey, debouncedSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  const catalog = useInfiniteQuery({
    queryKey: ["test-case-picker", projectId, appTypeId || "", filterKey, debouncedSearch],
    queryFn: ({ pageParam, signal }) => testingApi.testCases.listPage({
      project_id: projectId, app_type_id: appTypeId || undefined, ...filters,
      module_id: filters?.module_id || (moduleFilter !== "__unassigned__" ? moduleFilter || undefined : undefined),
      unassigned_module: filters?.unassigned_module || (!filters?.module_id && moduleFilter === "__unassigned__") || undefined,
      status: filters?.status || statusFilter || undefined,
      automated: filters?.automated || automationFilter || undefined,
      projection: "picker", include_total: false, page_size: PAGE_SIZE,
      search: debouncedSearch || undefined, cursor: pageParam
    }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page, _pages, _lastParam, pageParams) => {
      const cursor = page.next_cursor;
      return !page.is_last && cursor && !pageParams.includes(cursor) ? cursor : undefined;
    },
    enabled: Boolean(projectId && (!isImpact || impactOpen)),
    staleTime: 30_000,
    placeholderData: previous => previous,
    retry: false
  });
  const modules = useQuery({
    queryKey: ["test-case-picker-modules", projectId, appTypeId || ""],
    queryFn: () => testingApi.testCaseModules.list({ project_id: projectId, app_type_id: appTypeId || undefined, projection: "summary" }),
    enabled: Boolean(projectId && filtersOpen && !filters?.module_id), staleTime: 60_000, retry: false
  });
  const metadata = useQuery({
    queryKey: ["domain-metadata"], queryFn: platformApi.metadata.domain,
    enabled: filtersOpen && !filters?.status, staleTime: 30_000
  });
  const items = useMemo(() => Array.from(new Map(
    (catalog.data?.pages.flatMap(page => page.items) || []).map(item => [item.id, item])
  ).values()), [catalog.data]);
  const itemById = useMemo(() => new Map([
    ...knownItems, ...initialItems.map(item => [item.id, item] as const),
    ...items.map(item => [item.id, item] as const)
  ]), [initialItems, items, knownItems]);
  const missingIds = selectedIds.filter(id => !itemById.has(id));
  const missingIdsKey = JSON.stringify([...new Set(missingIds)].sort());
  const selectedLookup = useQuery({
    queryKey: ["test-case-picker-selected", projectId, appTypeId || "", missingIdsKey],
    queryFn: async ({ signal }) => {
      const ids: string[] = JSON.parse(missingIdsKey);
      const resolved: TestCase[] = [];
      // Hydrate only the saved selection, never the surrounding catalog.
      for (let offset = 0; offset < ids.length; offset += 200) {
        const batch = ids.slice(offset, offset + 200);
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          const page = await testingApi.testCases.listPage({
            project_id: projectId, app_type_id: appTypeId || undefined,
            ids: batch.join(","), projection: "picker", include_total: false,
            page_size: PAGE_SIZE, cursor
          }, { signal });
          resolved.push(...page.items);
          const next = !page.is_last ? page.next_cursor : undefined;
          if (!page.is_last && (!next || seen.has(next))) {
            throw new Error("Selected test case names could not be completed. Retry the selection lookup.");
          }
          cursor = next || undefined;
          if (cursor) seen.add(cursor);
        } while (cursor);
      }
      return resolved;
    },
    enabled: Boolean(projectId && missingIds.length),
    staleTime: 30_000,
    retry: false
  });

  useEffect(() => {
    const received = [...initialItems, ...items, ...(selectedLookup.data || [])];
    if (!received.length) return;
    setKnownItems(current => {
      if (received.every(item => current.get(item.id) === item)) return current;
      const next = new Map(current);
      received.forEach(item => next.set(item.id, item));
      return next;
    });
  }, [initialItems, items, selectedLookup.data]);

  const selectedItems = useMemo(() => selectedIds.flatMap(id => {
    const item = itemById.get(id);
    return item ? [item] : [];
  }), [selectedIdsKey, itemById]);
  const resolvedCallback = useRef(onItemsResolved);
  resolvedCallback.current = onItemsResolved;
  const lastResolved = useRef<TestCase[] | null>(null);
  useEffect(() => {
    if (lastResolved.current?.length === selectedItems.length
      && selectedItems.every((item, index) => item === lastResolved.current?.[index])) return;
    lastResolved.current = selectedItems;
    resolvedCallback.current?.(selectedItems);
  }, [selectedItems]);

  const resolutionCallback = useRef(onSelectionResolutionChange);
  resolutionCallback.current = onSelectionResolutionChange;
  const resolvedLookupIds = useMemo(() => new Set(selectedLookup.data?.map(item => item.id) || []), [selectedLookup.data]);
  const unavailableIds = selectedLookup.isSuccess
    ? missingIds.filter(id => !resolvedLookupIds.has(id))
    : [];
  const unavailableIdsKey = JSON.stringify(unavailableIds);
  useEffect(() => {
    resolutionCallback.current?.({
      selectionKey: selectedIdsKey,
      pending: Boolean(missingIds.length && (selectedLookup.isPending || selectedLookup.isFetching)),
      error: missingIds.length ? selectedLookup.error : null,
      unavailableIds: JSON.parse(unavailableIdsKey)
    });
  }, [selectedIdsKey, missingIdsKey, selectedLookup.isPending, selectedLookup.isFetching, selectedLookup.error, unavailableIdsKey]);

  useLayoutEffect(() => { if (viewport.current) viewport.current.scrollTop = 0; }, [scopeKey]);
  const isChangingSearch = search.trim() !== debouncedSearch || catalog.isPlaceholderData;
  const isInline = presentation === "inline";
  const hasLocalFilter = Boolean(debouncedSearch || moduleFilter || statusFilter || automationFilter);
  const inlineRows = useMemo(() => {
    const visibleById = new Map(items.map(item => [item.id, item]));
    // In the unfiltered list, retain the complete selection in its saved order,
    // including selections from another page. Filtering never drops selections.
    const selected = selectedIds
      .filter(id => !hasLocalFilter || visibleById.has(id))
      .map(id => ({ id, item: itemById.get(id) }));
    return [...selected, ...items.filter(item => !selectedIdSet.has(item.id)).map(item => ({ id: item.id, item }))];
  }, [hasLocalFilter, items, itemById, selectedIdsKey, selectedIdSet]);
  const visibleIds = useMemo(() => isInline || isImpact ? inlineRows.map(row => row.id) : items.map(item => item.id), [inlineRows, isInline, isImpact, items]);
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  const visibleSelectedCount = visibleIds.filter(id => selectedIdSet.has(id)).length;
  const allVisibleSelected = Boolean(visibleIds.length) && visibleSelectedCount === visibleIds.length;
  useEffect(() => {
    if (selectVisibleRef.current) selectVisibleRef.current.indeterminate = visibleSelectedCount > 0 && !allVisibleSelected;
  }, [allVisibleSelected, visibleSelectedCount]);
  const commitSelection = (ids: string[]) => {
    if (disabled) return;
    const next = [...new Set(ids)];
    onChange(next, next.flatMap(id => { const item = itemById.get(id); return item ? [item] : []; }));
  };
  const toggle = (id: string) => commitSelection(selectedIdSet.has(id)
    ? selectedIds.filter(selected => selected !== id)
    : multiple ? [...selectedIds, id] : [id]);
  const move = (index: number, delta: number) => {
    const next = [...selectedIds];
    const destination = index + delta;
    if (destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    commitSelection(next);
  };

  if (isImpact) return <details className="form-field impact-checkbox-field impact-select-dropdown test-case-picker--impact" onToggle={event => setImpactOpen(event.currentTarget.open)}>
    <summary className="impact-select-summary">
      <span className="form-field-label" id={`${controlId}-heading`}>{heading}</span>
      <span>{selectedIds.length ? `${selectedIds.length} selected` : "Select…"}</span>
    </summary>
    <div className="impact-select-popover">
      <div className="impact-checkbox-heading">
        <span aria-live="polite">{selectedIds.length} selected</span>
        <div className="impact-checkbox-actions">
          {multiple ? <><button className="impact-checkbox-action" type="button"
            disabled={disabled || isChangingSearch || !visibleIds.length || allVisibleSelected}
            onClick={() => commitSelection([...selectedIds, ...visibleIds])}><SelectionToggleIcon checked />Select all</button><span aria-hidden="true">|</span></> : null}
          <button className="impact-checkbox-action" type="button" disabled={disabled || !selectedIds.length}
            onClick={() => commitSelection([])}><SelectionToggleIcon checked={false} />Clear</button>
        </div>
      </div>
      <div className="impact-checkbox-picker">
        <label className="impact-checkbox-search">
          <IconSearch aria-hidden="true" size={17} />
          <input type="search" aria-label={`Search ${heading.toLowerCase()}`} placeholder="Search test cases..." value={search} disabled={disabled}
            onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} />
        </label>
        <div className="impact-checkbox-list" ref={viewport} role="group" aria-labelledby={`${controlId}-heading`} aria-busy={catalog.isFetching || isChangingSearch}>
          {catalog.isLoading ? <p className="test-case-picker-status" role="status">Loading test cases…</p> : null}
          {catalog.isError && !items.length ? <p className="test-case-picker-status" role="alert">Test cases couldn't be loaded. <button className="impact-checkbox-action" type="button" onClick={() => void catalog.refetch()}>Retry test cases</button></p> : null}
          {inlineRows.map(({ id, item }) => <label className={`impact-checkbox-option${selectedIdSet.has(id) ? " is-selected" : ""}`} key={id}>
            <input type={multiple ? "checkbox" : "radio"} name={`${controlId}-case`} checked={selectedIdSet.has(id)} disabled={disabled || isChangingSearch} onChange={() => toggle(id)} />
            <span><strong>{item?.title || id}</strong><CaseIdentity item={item} fallback={id} /></span>
          </label>)}
          {!catalog.isLoading && !catalog.isError && !inlineRows.length ? <div className="empty-state compact">{emptyMessage}</div> : null}
          {selectedLookup.isLoading ? <p className="test-case-picker-status" role="status">Loading selected test case names…</p> : null}
          {selectedLookup.isError ? <p className="test-case-picker-status" role="alert">Selected names couldn't be loaded. Your selection is retained. <button className="impact-checkbox-action" type="button" onClick={() => void selectedLookup.refetch()}>Retry selected cases</button></p> : null}
          {isChangingSearch ? <p className="test-case-picker-status" role="status">Searching test cases…</p> : null}
          {catalog.isError && items.length && !catalog.isFetchNextPageError ? <p className="test-case-picker-status" role="alert">Search couldn't be updated. <button className="impact-checkbox-action" type="button" onClick={() => void catalog.refetch()}>Retry search</button></p> : null}
          {impactOpen && catalog.hasNextPage && !isChangingSearch ? <HierarchyAutoLoadSentinel
            isLoading={catalog.isFetchingNextPage} onLoad={() => catalog.fetchNextPage()}
            error={catalog.isFetchNextPageError} onRetry={() => catalog.fetchNextPage()}
            scopeLabel="test cases" progressKey={`${scopeKey}:${catalog.data?.pages.length || 0}`}
          /> : null}
        </div>
      </div>
    </div>
  </details>;

  const filterFields = <>
    {!filters?.module_id ? <label>Current module<select aria-label="Filter test cases by module" value={moduleFilter} disabled={disabled} onChange={event => setModuleFilter(event.target.value)}>
      <option value="">All modules</option>
      <option value="__unassigned__">Unassigned module</option>
      {(modules.data || []).map(module => <option key={module.id} value={module.id}>{module.display_id ? `${module.display_id} · ` : ""}{module.name}</option>)}
    </select></label> : null}
    {!filters?.status ? <label>Status<select aria-label="Filter test cases by status" value={statusFilter} disabled={disabled} onChange={event => setStatusFilter(event.target.value)}>
      <option value="">All statuses</option>
      {(metadata.data?.test_cases?.statuses || []).map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
    </select></label> : null}
    {!filters?.automated ? <label>Case type<select aria-label="Filter test cases by automation" disabled={disabled} value={automationFilter} onChange={event => setAutomationFilter(event.target.value as "" | "yes" | "no")}><option value="">All cases</option><option value="no">Manual cases</option><option value="yes">Automation cases</option></select></label> : null}
    {isInline ? <button className="ghost-button" type="button" disabled={disabled || (!moduleFilter && !statusFilter && !automationFilter)} onClick={() => { setModuleFilter(""); setStatusFilter(""); setAutomationFilter(""); }}>Clear filters</button> : null}
    {modules.isError ? <p role="alert">Module filters couldn't be loaded. <button className="ghost-button" type="button" onClick={() => void modules.refetch()}>Retry modules</button></p> : null}
  </>;

  return <section className={`test-case-picker${isInline ? " test-case-picker--inline" : ""}`} aria-labelledby={`${controlId}-heading`}>
    <header className="test-case-picker-heading">
      <strong id={`${controlId}-heading`}>{heading}</strong>
      <span aria-live="polite">{selectedIds.length} selected</span>
    </header>
    <div className="test-case-picker-toolbar" onKeyDown={event => {
      if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type === "search") event.preventDefault();
    }}>
      {isInline ? <CatalogSearchFilter
        value={search} onChange={setSearch} onOpenChange={setFiltersOpen}
        placeholder="Search ID or title…" ariaLabel="Search test cases" type="search"
        activeFilterCount={Number(Boolean(moduleFilter)) + Number(Boolean(statusFilter)) + Number(Boolean(automationFilter))}
        title="Filter Test Cases" disabled={disabled}
      ><div className="test-case-picker-filter-fields">{filterFields}</div></CatalogSearchFilter> : <label className="test-case-picker-search">
        <IconSearch aria-hidden="true" size={17} />
        <span className="sr-only">Search test cases</span>
        <input type="search" value={search} disabled={disabled} placeholder="Search test cases…" onChange={event => setSearch(event.target.value)} />
      </label>}
      {multiple ? <button className="ghost-button" type="button"
        aria-label={isInline ? "Select all visible Test Cases" : undefined}
        disabled={disabled || isChangingSearch || !visibleIds.length || allVisibleSelected}
        onClick={() => commitSelection([...selectedIds, ...visibleIds])}>{isInline ? <><SelectionToggleIcon checked /><span className="test-case-picker-select-wide">Select all visible</span><span className="test-case-picker-select-compact" aria-hidden="true">Select all</span></> : "Select shown"}</button> : null}
      <button className="ghost-button" type="button" disabled={disabled || !selectedIds.length} onClick={() => commitSelection([])}>{isInline ? <SelectionToggleIcon checked={false} /> : null}Clear</button>
    </div>
    {!isInline ? <details className="test-case-picker-filters" onToggle={event => setFiltersOpen(event.currentTarget.open)}>
      <summary>Filters{moduleFilter || statusFilter || automationFilter ? " · Active" : ""}</summary>
      <div>
        {filterFields}
      </div>
    </details> : null}
    {!isInline && selectedIds.length ? <details className="test-case-picker-selection" open={allowReorder || undefined}>
      <summary>Selected test cases · {selectedIds.length}</summary>
      <ol>
        {selectedIds.map((id, index) => {
          const item = itemById.get(id);
          const label = item?.title || id;
          return <li key={id}>
            <span className="test-case-picker-selected-label"><CaseIdentity item={item} fallback={id} /><span>{label}</span></span>
            <div className="test-case-picker-selected-actions">
              {allowReorder && multiple ? <>
                <button type="button" className="ghost-button" aria-label={`Move ${label} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}><IconChevronUp aria-hidden="true" size={16} /></button>
                <button type="button" className="ghost-button" aria-label={`Move ${label} down`} disabled={disabled || index === selectedIds.length - 1} onClick={() => move(index, 1)}><IconChevronDown aria-hidden="true" size={16} /></button>
              </> : null}
              <button type="button" className="ghost-button" aria-label={`Remove ${label}`} disabled={disabled} onClick={() => commitSelection(selectedIds.filter(selected => selected !== id))}><IconX aria-hidden="true" size={15} /></button>
            </div>
          </li>;
        })}
      </ol>
      {selectedLookup.isLoading ? <p role="status">Loading selected test case names…</p> : null}
      {selectedLookup.isError ? <p role="alert">Selected names couldn't be loaded. Your selection is retained. <button className="ghost-button" type="button" onClick={() => void selectedLookup.refetch()}>Retry selected cases</button></p> : null}
    </details> : null}
    <div className="test-case-picker-results" ref={viewport} aria-busy={catalog.isFetching || isChangingSearch} role={isInline ? "table" : undefined} aria-label={isInline ? `Test Cases available for this ${selectionContext}` : undefined}>
      {isInline ? <div className="test-case-picker-inline-header" role="row">
        <span role="columnheader"><input aria-label="Select all visible Test Cases" ref={selectVisibleRef} type="checkbox" checked={allVisibleSelected} disabled={disabled || isChangingSearch || !visibleIds.length} onChange={event => commitSelection(event.target.checked ? [...selectedIds, ...visibleIds] : selectedIds.filter(id => !visibleIdSet.has(id)))} /></span>
        <span role="columnheader">Test Case</span><span role="columnheader">Status</span><span role="columnheader">Order</span>
      </div> : null}
      {catalog.isLoading ? <p className="test-case-picker-status" role="status">Loading test cases…</p> : null}
      {catalog.isError && !items.length ? <p className="test-case-picker-status" role="alert">Test cases couldn't be loaded. <button className="ghost-button" type="button" onClick={() => void catalog.refetch()}>Retry test cases</button></p> : null}
      {!catalog.isLoading && !catalog.isError && !items.length ? <p className="test-case-picker-status">{emptyMessage}</p> : null}
      {isInline ? inlineRows.map(({ id, item }) => {
        const index = selectedIndexById.get(id) ?? -1;
        const selected = index >= 0;
        const label = item?.title || id;
        return <div className={`test-case-picker-row${selected ? " is-selected" : ""}`} key={id} role="row" onClick={event => {
          if (isChangingSearch || (event.target instanceof Element && event.target.closest("button, input"))) return;
          toggle(id);
        }}>
          <span role="cell"><input aria-label={`${selected ? "Remove" : "Add"} ${item?.display_id || id} ${selected ? "from" : "to"} the new ${selectionContext}`} type={multiple ? "checkbox" : "radio"} name={`${controlId}-case`} checked={selected} disabled={disabled || isChangingSearch} onChange={() => toggle(id)} /></span>
          <span className="test-case-picker-copy" role="cell"><CaseIdentity item={item} fallback={id} /><strong>{label}</strong></span>
          <span className="test-case-picker-inline-status" role="cell">{item?.status ? <StatusBadge value={item.status} /> : "—"}</span>
          <span className="test-case-picker-inline-order" role="cell">
            {selected ? <><span aria-label={`Selection position ${index + 1}`}>{index + 1}</span>{allowReorder && multiple ? <>
              <button type="button" className="ghost-button" aria-label={`Move ${label} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}><IconChevronUp aria-hidden="true" size={16} /></button>
              <button type="button" className="ghost-button" aria-label={`Move ${label} down`} disabled={disabled || index === selectedIds.length - 1} onClick={() => move(index, 1)}><IconChevronDown aria-hidden="true" size={16} /></button>
            </> : null}</> : "—"}
          </span>
        </div>;
      }) : items.map(item => <label className={`test-case-picker-row${selectedIdSet.has(item.id) ? " is-selected" : ""}`} key={item.id}>
        <input type={multiple ? "checkbox" : "radio"} name={`${controlId}-case`} checked={selectedIdSet.has(item.id)} disabled={disabled || isChangingSearch} onChange={() => toggle(item.id)} />
        <span className="test-case-picker-copy">
          <CaseIdentity item={item} fallback={item.id} />
          <strong>{item.title}</strong>
          {item.description ? <span className="test-case-picker-description">{richTextToPlainText(item.description)}</span> : null}
          {item.labels?.length ? <small>{item.labels.join(" · ")}</small> : null}
        </span>
      </label>)}
      {isInline && selectedLookup.isLoading ? <p className="test-case-picker-status" role="status">Loading selected test case names…</p> : null}
      {isInline && selectedLookup.isError ? <p className="test-case-picker-status" role="alert">Selected names couldn't be loaded. Your selection is retained. <button className="ghost-button" type="button" onClick={() => void selectedLookup.refetch()}>Retry selected cases</button></p> : null}
      {unavailableIds.length ? <p className="test-case-picker-status" role="alert">{unavailableIds.length} selected Test Case{unavailableIds.length === 1 ? " is" : "s are"} unavailable in this scope. Remove the unavailable selection or choose another case.</p> : null}
      {isChangingSearch ? <p className="test-case-picker-status" role="status">Searching test cases…</p> : null}
      {catalog.isError && items.length && !catalog.isFetchNextPageError ? <p className="test-case-picker-status" role="alert">Search couldn't be updated. <button className="ghost-button" type="button" onClick={() => void catalog.refetch()}>Retry search</button></p> : null}
      {catalog.hasNextPage && !isChangingSearch ? <HierarchyAutoLoadSentinel
        isLoading={catalog.isFetchingNextPage} onLoad={() => catalog.fetchNextPage()}
        error={catalog.isFetchNextPageError} onRetry={() => catalog.fetchNextPage()}
        scopeLabel="test cases" progressKey={`${scopeKey}:${catalog.data?.pages.length || 0}`}
      /> : null}
    </div>
  </section>;
}
