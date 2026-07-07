import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

function readScrollState(node: HTMLDivElement) {
  const isScrollable = node.scrollHeight > node.clientHeight + 8;
  const isAwayFromTop = isScrollable && node.scrollTop > 24;

  return { isAwayFromTop, isScrollable };
}

function applyScrollState(
  node: HTMLDivElement,
  setIsScrollable: Dispatch<SetStateAction<boolean>>,
  setIsAwayFromTop: Dispatch<SetStateAction<boolean>>
) {
  const { isAwayFromTop, isScrollable } = readScrollState(node);

  setIsScrollable((current) => current === isScrollable ? current : isScrollable);
  setIsAwayFromTop((current) => current === isAwayFromTop ? current : isAwayFromTop);
}

function isScrollableElement(node: HTMLElement) {
  const styles = window.getComputedStyle(node);
  const overflowY = styles.overflowY;
  return /auto|scroll|overlay/.test(overflowY) && node.scrollHeight > node.clientHeight + 1;
}

function hasCompetingScrollableAncestor(target: HTMLElement, boundary: HTMLElement, panel: HTMLElement) {
  let current: HTMLElement | null = target;

  while (current && current !== panel) {
    if (current !== boundary && isScrollableElement(current)) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function normalizeWheelDelta(event: WheelEvent) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * window.innerHeight;
  }

  return event.deltaY;
}

function canScroll(node: HTMLDivElement, deltaY: number) {
  if (deltaY < 0) {
    return node.scrollTop > 0;
  }

  return node.scrollTop + node.clientHeight < node.scrollHeight - 1;
}

function findPageScrollHost(node: HTMLElement) {
  let current = node.parentElement;

  while (current) {
    if (isScrollableElement(current)) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

export function TileBrowserPane({
  children,
  className = ""
}: {
  children: ReactNode;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [isScrollable, setIsScrollable] = useState(false);
  const [isAwayFromTop, setIsAwayFromTop] = useState(false);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }

    let frame = 0;

    const syncViewport = () => {
      applyScrollState(node, setIsScrollable, setIsAwayFromTop);
    };

    const scheduleSync = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }

      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncViewport();
      });
    };

    scheduleSync();

    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => scheduleSync())
        : null;

    observer?.observe(node);

    const content = node.firstElementChild;
    if (content instanceof HTMLElement) {
      observer?.observe(content);
    }

    const panel = node.closest(".panel");
    const handlePanelWheel = (event: WheelEvent) => {
      if (!(event.target instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
        return;
      }

      if (event.defaultPrevented || event.ctrlKey) {
        return;
      }

      const deltaY = normalizeWheelDelta(event);

      if (!deltaY || Math.abs(deltaY) < Math.abs(event.deltaX)) {
        return;
      }

      if (hasCompetingScrollableAncestor(event.target, node, panel)) {
        return;
      }

      if (!canScroll(node, deltaY)) {
        return;
      }

      node.scrollTop += deltaY;
      applyScrollState(node, setIsScrollable, setIsAwayFromTop);
      event.preventDefault();
    };

    if (panel instanceof HTMLElement) {
      panel.addEventListener("wheel", handlePanelWheel, { passive: false });
    }

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }

      observer?.disconnect();

      if (panel instanceof HTMLElement) {
        panel.removeEventListener("wheel", handlePanelWheel);
      }
    };
  }, [children]);

  return (
    <div className={["tile-browser-pane", className].filter(Boolean).join(" ")}>
      <div
        className="tile-browser-pane-scroll"
        onScroll={(event) => {
          applyScrollState(event.currentTarget, setIsScrollable, setIsAwayFromTop);
        }}
        ref={scrollRef}
      >
        {children}
      </div>
      {isScrollable && isAwayFromTop ? (
        <div className="tile-browser-pane-footer is-scrollable">
          <button
            aria-label="Jump to top"
            className="tile-browser-pane-top-button is-ready"
            onClick={() => {
              const node = scrollRef.current;
              if (!node) {
                return;
              }

              node.scrollTo({ top: 0, behavior: "smooth" });
              findPageScrollHost(node)?.scrollTo({ top: 0, behavior: "smooth" });
              window.scrollTo({ top: 0, behavior: "smooth" });
              setIsAwayFromTop(false);
            }}
            title="Jump to top"
            type="button"
          >
            <ArrowUpIcon />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ArrowUpIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}
