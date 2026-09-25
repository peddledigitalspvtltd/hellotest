import { useEffect, useRef, useState } from "react";

type ScrollLoadProps = {
  isLoading: boolean;
  onLoad: () => void | Promise<unknown>;
  scopeLabel: string;
  error?: unknown;
  onRetry?: () => void | Promise<unknown>;
  progressKey?: string | number;
};

type HierarchyLoadMoreButtonProps = ScrollLoadProps & {
  actionLabel?: string;
  loaded?: number;
  placement?: "inline" | "footer";
  total?: number;
};

// Existing catalog callers get automatic pagination without changing their
// loading/cursor ownership. Only failed requests require an explicit action.
export function HierarchyLoadMoreButton({
  actionLabel,
  loaded,
  error,
  progressKey,
  ...props
}: HierarchyLoadMoreButtonProps) {
  return <HierarchyAutoLoadSentinel
    {...props}
    error={error || (actionLabel?.toLowerCase().startsWith("retry") ? true : undefined)}
    progressKey={progressKey ?? loaded}
  />;
}

const scrollContainer = (node: HTMLElement) => {
  let parent = node.parentElement;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    // Some catalog wrappers use overflow:auto but grow with their content. They
    // are not scroll viewports; rooting the observer there loads offscreen pages.
    if (/(auto|scroll|overlay)/.test(getComputedStyle(parent).overflowY)
      && parent.scrollHeight > parent.clientHeight + 1) return parent;
    parent = parent.parentElement;
  }
  return null;
};

export function HierarchyAutoLoadSentinel({
  isLoading,
  onLoad,
  scopeLabel,
  error,
  onRetry,
  progressKey
}: ScrollLoadProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const inFlight = useRef<number | null>(null);
  const generation = useRef(0);
  const requestSequence = useRef(0);
  const callbacks = useRef({ onLoad, onRetry });
  callbacks.current = { onLoad, onRetry };
  const [requestError, setRequestError] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const hasError = Boolean(error || requestError);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    generation.current += 1;
    inFlight.current = null;
    setRequestError(false);
  }, [progressKey]);

  useEffect(() => {
    const node = ref.current;
    if (!node || isLoading || hasError) return;
    const observer = new IntersectionObserver((entries) => {
      if (inFlight.current || !entries.some((entry) => entry.isIntersecting)) return;
      const requestId = ++requestSequence.current;
      const requestGeneration = generation.current;
      inFlight.current = requestId;
      Promise.resolve().then(() => mounted.current && requestGeneration === generation.current ? callbacks.current.onLoad() : undefined).then((result) => {
        // TanStack fetchNextPage resolves with a query result on failure.
        if (result && typeof result === "object" && "isError" in result && result.isError) {
          throw new Error("The next page could not be loaded.");
        }
      }).catch(() => {
        if (mounted.current && requestGeneration === generation.current) setRequestError(true);
      }).finally(() => {
        if (inFlight.current === requestId) inFlight.current = null;
      });
    }, { root: scrollContainer(node), rootMargin: "240px 0px", threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [isLoading, hasError, progressKey, retryAttempt]);

  const retry = async () => {
    if (inFlight.current || isLoading) return;
    const requestId = ++requestSequence.current;
    const requestGeneration = generation.current;
    inFlight.current = requestId;
    try {
      const result = await (callbacks.current.onRetry || callbacks.current.onLoad)();
      if (result && typeof result === "object" && "isError" in result && result.isError) {
        throw new Error("The next page could not be loaded.");
      }
      if (mounted.current && requestGeneration === generation.current) {
        setRequestError(false);
        setRetryAttempt((value) => value + 1);
      }
    } catch {
      if (mounted.current && requestGeneration === generation.current) setRequestError(true);
    } finally {
      if (inFlight.current === requestId) inFlight.current = null;
    }
  };

  return <div className="hierarchy-auto-load-sentinel" ref={ref}>
    <span aria-live="polite" role="status">
      {isLoading ? `Loading more ${scopeLabel}…` : hasError ? `More ${scopeLabel} couldn't be loaded. Your current records are still available.` : null}
    </span>
    {hasError && !isLoading ? <button className="ghost-button compact" onClick={() => void retry()} type="button">Retry</button> : null}
  </div>;
}
