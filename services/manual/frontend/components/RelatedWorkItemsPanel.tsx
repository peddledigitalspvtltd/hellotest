import { useDeferredValue, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { HierarchyLoadMoreButton } from "@hellotest/testing/frontend/components/HierarchyLoadMoreButton";
import { IconArrowUpRight, IconCheck, IconChartBar, IconLayoutGrid, IconLink, IconList, IconPlus, IconSearch, IconUnlink, IconUser } from "@tabler/icons-react";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import "./RelatedWorkItemsPanel.css";

export type RelatedWorkItem = {
  id: string;
  key?: string;
  displayId?: string | null;
  title: string;
  description?: string | null;
  relation: string;
  status?: string | null;
  sprint?: string | null;
  owner?: string | null;
  icon?: ReactNode;
  onOpen?: () => void;
  canUnlink?: boolean;
};

export type RelatedWorkLinking = {
  scopeKey: string;
  loadCandidates: (input: { search: string; cursor?: string }) => Promise<{ items: RelatedWorkItem[]; nextCursor?: string }>;
  onLink: (item: RelatedWorkItem) => Promise<void>;
};

export function RelatedWorkItemsPanel({
  title = "Related Delivery Work Mapping", description = "Review upstream and downstream relationships, then add connections without losing the current context.",
  ariaLabel = "Related work items", eyebrow = "TRACEABILITY STREAM", items, onUnlink, linking,
  addLabel = "Add link", isLoading = false, notice, children
}: {
  title?: string; description?: string; ariaLabel?: string; eyebrow?: string;
  items: RelatedWorkItem[];
  onUnlink?: (item: RelatedWorkItem) => Promise<void>;
  linking?: RelatedWorkLinking;
  addLabel?: string; isLoading?: boolean; notice?: ReactNode; children?: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [relation, setRelation] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [isLinking, setIsLinking] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pendingRef = useRef(false);
  const deferredSearch = useDeferredValue(search.trim());
  const candidatesQuery = useInfiniteQuery({
    queryKey: ["related-work-candidates", linking?.scopeKey, deferredSearch],
    queryFn: ({ pageParam }) => linking!.loadCandidates({ search: deferredSearch, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page, _pages, _param, params) => page.nextCursor && !params.includes(page.nextCursor) ? page.nextCursor : undefined,
    enabled: Boolean(isLinking && linking), staleTime: 30_000
  });
  const candidateItems = isLinking ? candidatesQuery.data?.pages.flatMap(page => page.items) || [] : [];
  const linkedIds = new Set(items.map(item => item.id));
  const available = [...new Map(candidateItems.filter(item => !linkedIds.has(item.id)).map(item => [item.id, item])).values()];
  const displayedItems = isLinking ? [...items, ...available] : items;
  const statuses = [...new Set(displayedItems.map(item => item.status).filter((value): value is string => Boolean(value)))].sort();
  const relations = [...new Set(displayedItems.map(item => item.relation))].sort();
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return displayedItems.filter(item => (!status || item.status === status) && (!relation || item.relation === relation)
      && (!query || [item.displayId, item.id, item.title, item.description, item.owner, item.sprint, item.relation, item.status].some(value => value?.toLocaleLowerCase().includes(query))));
  }, [displayedItems, search, status, relation]);
  const changeLink = async (item: RelatedWorkItem, shouldLink: boolean) => {
    const action = shouldLink ? linking?.onLink : onUnlink;
    if (!action || pendingRef.current) return;
    pendingRef.current = true;
    setPendingId(item.key || item.id); setError("");
    try { await action(item); }
    catch (cause) { setError(cause instanceof Error ? cause.message : `The item could not be ${shouldLink ? "linked" : "unlinked"}. Please try again.`); }
    finally { pendingRef.current = false; setPendingId(null); }
  };
  const toggleLinking = () => {
    if (pendingRef.current) return;
    setIsLinking(current => !current); setSearch(""); setStatus(""); setRelation(""); setError("");
  };
  return <section className="related-work" aria-label={ariaLabel}>
    <header className="related-work-hero">
      <span className="related-work-hero-icon" aria-hidden="true"><IconChartBar size={30} stroke={1.7} /></span>
      <div className="related-work-intro"><div className="related-work-intro-meta"><span className="related-work-eyebrow">{eyebrow}</span><span>Upstream / Downstream sync</span></div><h2>{title}</h2><p>{description}</p></div>
      <div className="related-work-hero-actions"><span className="related-work-total">{items.length} linked</span>
        {linking ? <button className="related-work-add" disabled={pendingId !== null} onClick={toggleLinking} aria-expanded={isLinking} type="button">{isLinking ? <IconCheck size={18} /> : <IconPlus size={18} />}<span>{isLinking ? "Done linking" : addLabel}</span></button> : null}
      </div>
    </header>
    {notice}
    <div className={isLinking ? "related-work-table is-linking" : "related-work-table"}>
      {isLinking ? <p className="related-work-linking-note" role="status">Link or unlink items below. Each change saves immediately.</p> : null}
      {error ? <p className="related-work-error" role="alert">{error}</p> : null}
      <div className="related-work-toolbar">
        <label className="related-work-search"><IconSearch size={20} aria-hidden="true" /><input aria-label={isLinking ? `Search ${ariaLabel.toLowerCase()} to link` : `Search ${ariaLabel.toLowerCase()}`} onChange={event => setSearch(event.target.value)} placeholder="Search ID, title, status, or owner" type="search" value={search} /></label>
        <select aria-label={`Filter ${ariaLabel.toLowerCase()} by status`} onChange={event => setStatus(event.target.value)} value={status}><option value="">All statuses</option>{statuses.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <select aria-label={`Filter ${ariaLabel.toLowerCase()} by relation`} onChange={event => setRelation(event.target.value)} value={relation}><option value="">All relations</option>{relations.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <div className="related-work-view" role="group" aria-label={`${ariaLabel} view`}><span>View</span><button aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")} type="button"><IconList size={20} /><span>List</span></button><button aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")} type="button"><IconLayoutGrid size={20} /><span>Grid</span></button></div>
      </div>
      <div className={`related-work-items is-${view}`} aria-busy={isLoading || (isLinking && candidatesQuery.isFetching)}>
        {visible.map(item => <article className="related-work-item" data-linked={linkedIds.has(item.id)} key={item.key || item.id}>
          <span className="related-work-item-icon" aria-hidden="true">{item.icon || <IconLink size={22} />}</span>
          <div className="related-work-item-copy"><div className="related-work-item-meta"><span className="related-work-id">{item.displayId || item.id}</span><span className="related-work-relation"><IconLink size={16} aria-hidden="true" />{item.relation}</span>{item.status ? <StatusBadge value={item.status} label={item.status.replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase())} /> : null}{item.sprint ? <span className="related-work-sprint">{item.sprint}</span> : null}</div>
            <h3>{item.title}</h3>{item.description ? <p>{item.description}</p> : null}
          </div>
          <div className="related-work-item-actions"><span className="related-work-owner"><IconUser size={16} aria-hidden="true" />{item.owner || "Unassigned"}</span>{item.onOpen ? <button aria-label={`Open ${item.title}`} onClick={item.onOpen} type="button"><IconArrowUpRight size={18} /><span>Open in HelloTest</span></button> : null}{linkedIds.has(item.id) ? onUnlink && item.canUnlink !== false ? <button className="related-work-unlink" aria-label={`Unlink ${item.title}`} disabled={pendingId !== null || isLoading} onClick={() => void changeLink(item, false)} type="button"><IconUnlink size={18} /><span>{pendingId === (item.key || item.id) ? "Removing…" : "Unlink"}</span></button> : null : linking ? <button className="related-work-link" aria-label={`Link ${item.title}`} disabled={pendingId !== null || isLoading} onClick={() => void changeLink(item, true)} type="button"><IconLink size={18} /><span>{pendingId === (item.key || item.id) ? "Linking…" : "Link"}</span></button> : null}</div>
        </article>)}
        {!visible.length ? <div className="related-work-empty" role="status">{isLoading || (isLinking && candidatesQuery.isLoading) ? "Loading items…" : isLinking ? "No items match these filters." : items.length ? "No linked items match these filters." : "No items are linked yet."}{(search || status || relation) && !isLoading ? <button onClick={() => { setSearch(""); setStatus(""); setRelation(""); }} type="button">Clear filters</button> : null}</div> : null}
      </div>
      {isLinking && (candidatesQuery.hasNextPage || candidatesQuery.isError) ? <HierarchyLoadMoreButton isLoading={candidatesQuery.isFetching} error={candidatesQuery.isError ? candidatesQuery.error : undefined} onLoad={() => candidatesQuery.fetchNextPage()} onRetry={() => candidatesQuery.isFetchNextPageError ? candidatesQuery.fetchNextPage() : candidatesQuery.refetch()} progressKey={`${linking?.scopeKey}:${deferredSearch}:${candidatesQuery.data?.pages.length}`} scopeLabel="items available to link" /> : null}
      <footer className="related-work-footer">Showing {visible.length} of {displayedItems.length} {isLinking ? "available and linked" : "linked"} {displayedItems.length === 1 ? "item" : "items"}</footer>
    </div>
    {children}
  </section>;
}

