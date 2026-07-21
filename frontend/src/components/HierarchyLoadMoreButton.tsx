import { useEffect, useRef } from "react";

type HierarchyLoadMoreButtonProps = {
  batchSize: number;
  isLoading?: boolean;
  loaded?: number;
  onLoad: () => void | Promise<unknown>;
  scopeLabel: string;
  total?: number;
};

export function HierarchyLoadMoreButton({ batchSize, isLoading = false, loaded, onLoad, scopeLabel, total }: HierarchyLoadMoreButtonProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadLockedRef = useRef(false);
  const hasProgress = Number.isFinite(loaded) && Number.isFinite(total);
  const progress = hasProgress ? ` (${loaded}/${total})` : "";

  useEffect(() => {
    loadLockedRef.current = false;
  }, [loaded, total]);

  useEffect(() => {
    const sentinel = sentinelRef.current;

    if (!sentinel || isLoading || (hasProgress && Number(loaded) >= Number(total))) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || loadLockedRef.current) {
          return;
        }

        loadLockedRef.current = true;
        Promise.resolve(onLoad()).catch(() => {
          loadLockedRef.current = false;
        });
      },
      { rootMargin: "320px 0px", threshold: 0.01 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasProgress, isLoading, loaded, onLoad, total]);

  return (
    <div
      aria-label={isLoading ? `Loading more ${scopeLabel}` : `More ${scopeLabel} load automatically on scroll`}
      aria-live="polite"
      className="hierarchy-auto-load-sentinel"
      ref={sentinelRef}
      role="status"
    >
      <span className={isLoading ? "hierarchy-auto-load-spinner is-loading" : "hierarchy-auto-load-spinner"} aria-hidden="true" />
      <span>{isLoading ? `Loading ${batchSize} more…` : `Scroll to load ${batchSize} more${progress}`}</span>
    </div>
  );
}
