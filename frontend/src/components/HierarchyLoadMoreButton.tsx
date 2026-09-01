type HierarchyLoadMoreButtonProps = {
  actionLabel?: string;
  isLoading: boolean;
  loaded?: number;
  onLoad: () => void | Promise<unknown>;
  placement?: "inline" | "footer";
  scopeLabel: string;
  total?: number;
};

export function HierarchyLoadMoreButton({
  actionLabel = "Load more",
  isLoading,
  loaded,
  onLoad,
  placement = "inline",
  scopeLabel,
  total
}: HierarchyLoadMoreButtonProps) {
  const hasProgress = Number.isFinite(loaded) && Number.isFinite(total);
  const progress = hasProgress && Number(total) > Number(loaded)
    ? ` · ${loaded} of ${total} loaded`
    : Number.isFinite(loaded) && Number(loaded) > 0
      ? ` · ${loaded} loaded`
      : "";

  return (
    <button
      aria-busy={isLoading}
      aria-label={isLoading ? `Loading more ${scopeLabel}` : `${actionLabel} ${scopeLabel}`}
      className={`${placement === "footer" ? "primary-button" : "ghost-button"} compact hierarchy-load-more-button hierarchy-load-more-button--${placement}`}
      disabled={isLoading}
      onClick={() => void onLoad()}
      type="button"
    >
      {isLoading ? <><span aria-hidden="true" className="button-spinner" /><span>Loading…</span></> : `${actionLabel}${progress}`}
    </button>
  );
}

export function HierarchyAutoLoadSentinel({ isLoading, onLoad, scopeLabel }: {
  isLoading: boolean;
  onLoad: () => void | Promise<unknown>;
  scopeLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || isLoading) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void onLoad();
    }, { rootMargin: "320px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [isLoading, onLoad]);
  return <div aria-busy={isLoading} aria-label={`Loading more ${scopeLabel} on scroll`} className="hierarchy-auto-load-sentinel" ref={ref} role="status">
    {isLoading ? <><span aria-hidden="true" className="button-spinner" /><span>Loading more…</span></> : <span className="sr-only">More records load automatically on scroll.</span>}
  </div>;
}
import { useEffect, useRef } from "react";
