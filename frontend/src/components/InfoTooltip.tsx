import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";

type TooltipPosition = {
  left: number;
  top: number;
  width: number;
};

export function InfoTooltip({
  content,
  label = "More information",
  title,
  className = "",
  trigger = "button"
}: {
  content?: ReactNode;
  label?: string;
  title?: ReactNode;
  className?: string;
  trigger?: "button" | "span";
}) {
  const generatedId = useId();
  const tooltipId = `info-tooltip-${generatedId.replace(/:/g, "")}`;
  const triggerRef = useRef<HTMLButtonElement | HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ left: 12, top: 12, width: 300 });

  const updatePosition = useCallback(() => {
    const target = triggerRef.current;
    if (!target || typeof window === "undefined") return;
    const rect = target.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 8;
    const width = Math.min(320, Math.max(220, window.innerWidth - viewportPadding * 2));
    const measuredHeight = popoverRef.current?.getBoundingClientRect().height || 120;
    const preferredTop = rect.bottom + gap;
    const top = preferredTop + measuredHeight <= window.innerHeight - viewportPadding
      ? preferredTop
      : Math.max(viewportPadding, rect.top - measuredHeight - gap);
    const left = Math.min(
      Math.max(viewportPadding, rect.left + rect.width / 2 - width / 2),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
    );
    setPosition({ left, top, width });
  }, []);

  useLayoutEffect(() => {
    if (isOpen) updatePosition();
  }, [isOpen, content, title, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    const handleViewportChange = () => updatePosition();
    const handlePointerDown = (event: PointerEvent) => {
      const node = event.target as Node | null;
      if (node && (triggerRef.current?.contains(node) || popoverRef.current?.contains(node))) return;
      setIsOpen(false);
      setIsPinned(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      setIsPinned(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, updatePosition]);

  if (content === undefined && title === undefined) return null;

  const togglePinned = () => {
    setIsPinned((current) => {
      const next = !current;
      setIsOpen(next);
      return next;
    });
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    togglePinned();
  };
  const sharedProps = {
    "aria-describedby": isOpen ? tooltipId : undefined,
    "aria-label": label,
    className: ["info-tooltip-trigger", className].filter(Boolean).join(" "),
    onBlur: () => {
      if (!isPinned) setIsOpen(false);
    },
    onClick: (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      togglePinned();
    },
    onFocus: () => setIsOpen(true),
    onMouseEnter: () => setIsOpen(true),
    onMouseLeave: () => {
      if (!isPinned) setIsOpen(false);
    }
  };
  const icon = (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 8.5v5M10 6.25h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );

  return (
    <>
      {trigger === "span" ? (
        <span
          {...sharedProps}
          onKeyDown={handleKeyDown}
          ref={(node) => { triggerRef.current = node; }}
          role="button"
          tabIndex={0}
        >
          {icon}
        </span>
      ) : (
        <button
          {...sharedProps}
          ref={(node) => { triggerRef.current = node; }}
          type="button"
        >
          {icon}
        </button>
      )}
      {isOpen && typeof document !== "undefined" ? createPortal(
        <div
          className="info-tooltip-popover"
          id={tooltipId}
          ref={popoverRef}
          role="tooltip"
          style={{
            left: position.left,
            maxHeight: "min(22rem, calc(100dvh - 1.5rem))",
            maxWidth: "calc(100vw - 1.5rem)",
            overflowY: "auto",
            top: position.top,
            width: position.width
          } as CSSProperties}
        >
          {title ? <strong className="info-tooltip-title">{title}</strong> : null}
          {content !== undefined ? <div className="info-tooltip-content">{content}</div> : null}
        </div>,
        document.body
      ) : null}
    </>
  );
}
