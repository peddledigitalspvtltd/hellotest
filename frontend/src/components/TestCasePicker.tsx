import { useCapabilityAccess } from "../hooks/useCapabilityAccess";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { IconChevronDown, IconChevronUp, IconSearch, IconX } from "@tabler/icons-react";
import { api } from "../lib/api";
import { richTextToPlainText } from "./RichTextEditor";
import type { TestCase } from "../types";
import { HierarchyAutoLoadSentinel } from "./HierarchyLoadMoreButton";
import { TestCaseIcon } from "./AppIcons";
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
  onItemsResolved?: (selectedItems: TestCase[]) => void;
};

const PAGE_SIZE = 25;
const EMPTY_ITEMS: TestCase[] = [];

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
  filters, allowReorder = false, onItemsResolved
}: TestCasePickerProps) {
  const controlId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moduleFilter, setModuleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [knownItems, setKnownItems] = useState(() => new Map(initialItems.map(item => [item.id, item])));
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedIdsKey = JSON.stringify(selectedIds);
  const filterKey = JSON.stringify([
    filters?.module_id, filters?.suite_id, filters?.requirement_id,
    filters?.label, filters?.shared_step_group_id, filters?.automated,
    filters?.status, filters?.unassigned_module, moduleFilter, statusFilter
  ]);
  const scopeKey = JSON.stringify([projectId, appTypeId, filterKey, debouncedSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  const catalog = useInfiniteQuery({
    queryKey: ["test-case-picker", projectId, appTypeId || "", filterKey, debouncedSearch],
    queryFn: ({ pageParam, signal }) => api.testCases.listPage({
      project_id: projectId, app_type_id: appTypeId || undefined, ...filters,
      module_id: filters?.module_id || (moduleFilter !== "__unassigned__" ? moduleFilter || undefined : undefined),
      unassigned_module: filters?.unassigned_module || (!filters?.module_id && moduleFilter === "__unassigned__") || undefined,
      status: filters?.status || statusFilter || undefined,
      projection: "picker", include_total: false, page_size: PAGE_SIZE,
      search: debouncedSearch || undefined, cursor: pageParam
    }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page, _pages, _lastParam, pageParams) => {
      const cursor = page.next_cursor;
      return !page.is_last && cursor && !pageParams.includes(cursor) ? cursor : undefined;
    },
    enabled: Boolean(projectId),
    staleTime: 30_000,
    placeholderData: previous => previous,
    retry: false
  });
  const modules = useQuery({
    queryKey: ["test-case-picker-modules", projectId, appTypeId || ""],
    queryFn: () => api.testCaseModules.list({ project_id: projectId, app_type_id: appTypeId || undefined, projection: "summary" }),
    enabled: Boolean(projectId && filtersOpen && !filters?.module_id), staleTime: 60_000, retry: false
  });
  const metadata = useQuery({
    queryKey: ["domain-metadata"], queryFn: api.metadata.domain,
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
          const page = await api.testCases.listPage({
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

  useLayoutEffect(() => { if (viewport.current) viewport.current.scrollTop = 0; }, [scopeKey]);
  const isChangingSearch = search.trim() !== debouncedSearch || catalog.isPlaceholderData;
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

  return <section className="test-case-picker" aria-labelledby={`${controlId}-heading`}>
    <header className="test-case-picker-heading">
      <strong id={`${controlId}-heading`}>{heading}</strong>
      <span aria-live="polite">{selectedIds.length} selected</span>
    </header>
    <div className="test-case-picker-toolbar">
      <label className="test-case-picker-search">
        <IconSearch aria-hidden="true" size={17} />
        <span className="sr-only">Search test cases</span>
        <input type="search" value={search} disabled={disabled} placeholder="Search test cases…" onChange={event => setSearch(event.target.value)} />
      </label>
      {multiple ? <button className="ghost-button" type="button"
        disabled={disabled || isChangingSearch || !items.length || items.every(item => selectedIdSet.has(item.id))}
        onClick={() => commitSelection([...selectedIds, ...items.map(item => item.id)])}>Select shown</button> : null}
      <button className="ghost-button" type="button" disabled={disabled || !selectedIds.length} onClick={() => commitSelection([])}>Clear</button>
    </div>
    <details className="test-case-picker-filters" onToggle={event => setFiltersOpen(event.currentTarget.open)}>
      <summary>Filters{moduleFilter || statusFilter ? " · Active" : ""}</summary>
      <div>
        {!filters?.module_id ? <label>Current module<select aria-label="Filter test cases by module" value={moduleFilter} disabled={disabled} onChange={event => setModuleFilter(event.target.value)}>
          <option value="">All modules</option>
          <option value="__unassigned__">Unassigned module</option>
          {(modules.data || []).map(module => <option key={module.id} value={module.id}>{module.display_id ? `${module.display_id} · ` : ""}{module.name}</option>)}
        </select></label> : null}
        {!filters?.status ? <label>Status<select aria-label="Filter test cases by status" value={statusFilter} disabled={disabled} onChange={event => setStatusFilter(event.target.value)}>
          <option value="">All statuses</option>
          {(metadata.data?.test_cases?.statuses || []).map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
        </select></label> : null}
      </div>
      {modules.isError ? <p role="alert">Module filters couldn't be loaded. <button className="ghost-button" type="button" onClick={() => void modules.refetch()}>Retry modules</button></p> : null}
    </details>
    {selectedIds.length ? <details className="test-case-picker-selection" open={allowReorder || undefined}>
      <summary>Selected test cases · {selectedIds.length}</summary>
      <ol>
        {selectedIds.map((id, index) => {
          const item = itemById.get(id);
          const label = item?.title || id;
          return <li key={id}>
            <span className="test-case-picker-selected-label"><small>{item?.display_id || id}</small><span>{label}</span></span>
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
    <div className="test-case-picker-results" ref={viewport} aria-busy={catalog.isFetching || isChangingSearch}>
      {catalog.isLoading ? <p className="test-case-picker-status" role="status">Loading test cases…</p> : null}
      {catalog.isError && !items.length ? <p className="test-case-picker-status" role="alert">Test cases couldn't be loaded. <button className="ghost-button" type="button" onClick={() => void catalog.refetch()}>Retry test cases</button></p> : null}
      {!catalog.isLoading && !catalog.isError && !items.length ? <p className="test-case-picker-status">{emptyMessage}</p> : null}
      {items.map(item => <label className={`test-case-picker-row${selectedIdSet.has(item.id) ? " is-selected" : ""}`} key={item.id}>
        <input type={multiple ? "checkbox" : "radio"} name={`${controlId}-case`} checked={selectedIdSet.has(item.id)} disabled={disabled || isChangingSearch} onChange={() => toggle(item.id)} />
        <span className="test-case-picker-copy">
          <span className="test-case-picker-id"><TestCaseIcon size={15} strokeWidth={1.8} />{item.display_id || item.id}</span>
          <strong>{item.title}</strong>
          {item.description ? <span className="test-case-picker-description">{richTextToPlainText(item.description)}</span> : null}
          {item.labels?.length ? <small>{item.labels.join(" · ")}</small> : null}
        </span>
      </label>)}
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
