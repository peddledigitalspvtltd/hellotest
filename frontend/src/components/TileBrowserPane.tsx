import { useLayoutEffect, useRef, type ReactNode } from "react";

const MAX_REMEMBERED_SCROLL_POSITIONS = 40;
const scrollPositions = new Map<string, number>();

const rememberScrollPosition = (key: string, position: number) => {
  scrollPositions.delete(key);
  scrollPositions.set(key, position);
  while (scrollPositions.size > MAX_REMEMBERED_SCROLL_POSITIONS) {
    const oldestKey = scrollPositions.keys().next().value;
    if (!oldestKey) break;
    scrollPositions.delete(oldestKey);
  }
};

export function TileBrowserPane({
  children,
  className = "",
  scrollKey
}: {
  children: ReactNode;
  className?: string;
  scrollKey?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || !scrollKey) return;

    const target = scrollPositions.get(scrollKey) || 0;
    let restoreFrame = 0;
    let scrollFrame = 0;
    let attempts = 0;
    const restore = () => {
      container.scrollTop = Math.min(target, Math.max(0, container.scrollHeight - container.clientHeight));
      attempts += 1;
      if (Math.abs(container.scrollTop - target) > 1 && attempts < 12) restoreFrame = window.requestAnimationFrame(restore);
    };
    const onScroll = () => {
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = window.requestAnimationFrame(() => rememberScrollPosition(scrollKey, container.scrollTop));
    };

    restoreFrame = window.requestAnimationFrame(restore);
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(restoreFrame);
      window.cancelAnimationFrame(scrollFrame);
      container.removeEventListener("scroll", onScroll);
      rememberScrollPosition(scrollKey, container.scrollTop);
    };
  }, [scrollKey]);

  return (
    <div className={["tile-browser-pane", className].filter(Boolean).join(" ")}>
      <div className="tile-browser-pane-scroll" data-scroll-key={scrollKey || undefined} ref={scrollRef}>
        {children}
      </div>
    </div>
  );
}
