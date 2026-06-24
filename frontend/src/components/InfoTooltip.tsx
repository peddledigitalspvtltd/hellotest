import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_PADDING = 12;
const TRIGGER_GAP = 8;

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
  const [isOpen, setIsOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement | HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();

  useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverStyle({});
      return;
    }

    const updatePosition = () => {
      const triggerNode = triggerRef.current;
      const popoverNode = popoverRef.current;

      if (!triggerNode || !popoverNode) {
        return;
      }

      const triggerRect = triggerNode.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const popoverWidth = Math.min(Math.max(popoverNode.offsetWidth || 280, 240), viewportWidth - VIEWPORT_PADDING * 2);
      const popoverHeight = popoverNode.offsetHeight || 120;
      const openAbove = triggerRect.bottom + TRIGGER_GAP + popoverHeight > viewportHeight - VIEWPORT_PADDING
        && triggerRect.top > popoverHeight + TRIGGER_GAP + VIEWPORT_PADDING;
      const left = Math.min(
        Math.max(VIEWPORT_PADDING, triggerRect.left + triggerRect.width / 2 - popoverWidth / 2),
        Math.max(VIEWPORT_PADDING, viewportWidth - popoverWidth - VIEWPORT_PADDING)
      );
      const top = openAbove
        ? Math.max(VIEWPORT_PADDING, triggerRect.top - TRIGGER_GAP - popoverHeight)
        : Math.min(triggerRect.bottom + TRIGGER_GAP, viewportHeight - VIEWPORT_PADDING - Math.min(popoverHeight, viewportHeight - VIEWPORT_PADDING * 2));

      setPopoverStyle({
        left,
        maxHeight: Math.max(120, viewportHeight - VIEWPORT_PADDING * 2),
        overflowY: "auto",
        top,
        width: popoverWidth
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  if (!content) {
    return null;
  }

  const commonTriggerProps = {
    "aria-controls": popoverId,
    "aria-expanded": isOpen,
    "aria-label": label,
    className: ["info-tooltip-trigger", className].filter(Boolean).join(" "),
    onBlur: () => trigger === "button" && setIsOpen(false),
    onFocus: () => trigger === "button" && setIsOpen(true),
    onMouseEnter: () => setIsOpen(true),
    onMouseLeave: () => setIsOpen(false),
    title: label
  };
  const triggerNode = trigger === "span" ? (
    <span
      {...commonTriggerProps}
      aria-hidden="true"
      ref={(node) => {
        triggerRef.current = node;
      }}
    >
      <InfoGlyph />
    </span>
  ) : (
    <button
      {...commonTriggerProps}
      onClick={(event) => {
        event.stopPropagation();
        setIsOpen((current) => !current);
      }}
      ref={(node) => {
        triggerRef.current = node;
      }}
      type="button"
    >
      <InfoGlyph />
    </button>
  );
  const popover = isOpen ? (
    <div
      className="info-tooltip-popover"
      id={popoverId}
      ref={popoverRef}
      role="dialog"
      style={popoverStyle}
    >
      {title ? <strong className="info-tooltip-title">{title}</strong> : null}
      <div className="info-tooltip-content">{content}</div>
    </div>
  ) : null;

  return (
    <>
      {triggerNode}
      {popover && typeof document !== "undefined" && document.body ? createPortal(popover, document.body) : popover}
    </>
  );
}

export function InfoCopy({
  children,
  label = "More information",
  title,
  className = ""
}: {
  children?: ReactNode;
  label?: string;
  title?: ReactNode;
  className?: string;
}) {
  if (!children) {
    return null;
  }

  return (
    <span className={["info-copy", className].filter(Boolean).join(" ")}>
      <InfoTooltip content={children} label={label} title={title} />
    </span>
  );
}

function InfoGlyph() {
  return (
    <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 16 16" width="14">
      <path d="M8 7.1v4.4" />
      <path d="M8 4.7h.01" />
    </svg>
  );
}
