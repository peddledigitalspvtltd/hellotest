import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SearchIcon } from "./AppIcons";
import { InfoTooltip } from "./InfoTooltip";

const POPOVER_VIEWPORT_PADDING = 12;
const POPOVER_TRIGGER_GAP = 10;

export function CatalogSearchFilter({
  value,
  onChange,
  placeholder,
  ariaLabel,
  type = "text",
  activeFilterCount = 0,
  title = "Filters",
  subtitle,
  filterIcon,
  disabled = false,
  children
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  type?: "text" | "search";
  activeFilterCount?: number;
  title?: string;
  subtitle?: string;
  filterIcon?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputId = useId();
  const popoverId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const focusableTargets = () => Array.from(popoverRef.current?.querySelectorAll<HTMLElement>(
      "input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
    ) || []).filter((target) => target.offsetParent !== null && !target.closest("[hidden], [inert], [aria-hidden='true']"));
    const frameId = window.requestAnimationFrame(() => {
      const targets = focusableTargets();
      const field = targets.find((target) => target.matches("input, select, textarea"));
      (field || targets[0] || popoverRef.current)?.focus();
    });

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || (!popoverRef.current?.contains(target) && !buttonRef.current?.contains(target))) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
        buttonRef.current?.focus();
      } else if (event.key === "Tab") {
        const targets = focusableTargets();
        const first = targets[0];
        const last = targets[targets.length - 1];
        if (!first || (event.shiftKey && target === first) || (!event.shiftKey && target === last) || buttonRef.current?.contains(target) || target === popoverRef.current) {
          event.preventDefault();
          event.stopPropagation();
          (event.shiftKey ? last : first)?.focus();
        }
      }
    };

    window.addEventListener("mousedown", handleMouseDown);
    // Capture at the window before a containing dialog handles Escape or Tab.
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverStyle({});
      return;
    }

    const updatePopoverPosition = () => {
      const container = containerRef.current;
      const button = buttonRef.current;
      const popover = popoverRef.current;

      if (!container || !button || !popover) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const triggerRect = button.getBoundingClientRect();
      const popoverHeight = popover.offsetHeight;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const isCompactViewport = viewportWidth <= 720;
      const maxPopoverWidth = Math.max(240, viewportWidth - POPOVER_VIEWPORT_PADDING * 2);
      const popoverWidth = isCompactViewport
        ? Math.min(maxPopoverWidth, Math.max(containerRect.width, Math.min(320, maxPopoverWidth)))
        : Math.min(popover.offsetWidth, maxPopoverWidth);
      const anchorRect = isCompactViewport ? containerRect : triggerRect;
      const spaceBelow = viewportHeight - anchorRect.bottom - POPOVER_TRIGGER_GAP - POPOVER_VIEWPORT_PADDING;
      const spaceAbove = anchorRect.top - POPOVER_TRIGGER_GAP - POPOVER_VIEWPORT_PADDING;
      const shouldOpenAbove =
        !isCompactViewport &&
        spaceBelow < Math.min(popoverHeight, 260) &&
        spaceAbove > spaceBelow;
      const viewportMaxHeight = Math.max(120, viewportHeight - POPOVER_VIEWPORT_PADDING * 2);
      const availableHeight = shouldOpenAbove ? spaceAbove : spaceBelow;
      const maxHeight = Math.min(viewportMaxHeight, Math.max(120, Math.floor(availableHeight || viewportMaxHeight)));
      const effectiveHeight = Math.min(popoverHeight, maxHeight);
      const left = isCompactViewport
        ? Math.min(
            Math.max(POPOVER_VIEWPORT_PADDING, containerRect.left),
            Math.max(POPOVER_VIEWPORT_PADDING, viewportWidth - popoverWidth - POPOVER_VIEWPORT_PADDING)
          )
        : Math.min(
            Math.max(POPOVER_VIEWPORT_PADDING, triggerRect.right - popoverWidth),
            Math.max(POPOVER_VIEWPORT_PADDING, viewportWidth - popoverWidth - POPOVER_VIEWPORT_PADDING)
          );
      const top = shouldOpenAbove
        ? Math.max(POPOVER_VIEWPORT_PADDING, anchorRect.top - POPOVER_TRIGGER_GAP - effectiveHeight)
        : Math.min(anchorRect.bottom + POPOVER_TRIGGER_GAP, viewportHeight - POPOVER_VIEWPORT_PADDING - effectiveHeight);

      setPopoverStyle({
        left,
        maxHeight,
        overflowY: "auto",
        position: "fixed",
        right: "auto",
        top,
        width: popoverWidth
      });
    };

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);

    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [isOpen]);

  const popover = isOpen ? (
    <div
      aria-labelledby={inputId}
      className="catalog-filter-popover"
      id={popoverId}
      ref={popoverRef}
      role="dialog"
      style={popoverStyle}
      tabIndex={-1}
    >
      <div className="catalog-filter-popover-header">
        <div className="catalog-filter-popover-title-row">
          <strong>{title}</strong>
          {subtitle ? <InfoTooltip content={subtitle} label={`${title} information`} /> : null}
        </div>
      </div>
      {children}
    </div>
  ) : null;

  return (
    <div className="catalog-search-filter" ref={containerRef}>
      <div className="catalog-search-field">
        <span aria-hidden="true" className="catalog-search-leading-icon">
          <SearchIcon size={16} />
        </span>
        <input
          aria-label={ariaLabel || placeholder}
          disabled={disabled}
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type={type}
          value={value}
        />
        <button
          aria-controls={popoverId}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label={activeFilterCount ? `Open filters (${activeFilterCount} active)` : "Open filters"}
          className={activeFilterCount ? "catalog-filter-button is-active" : "catalog-filter-button"}
          disabled={disabled}
          onClick={() => setIsOpen((current) => !current)}
          ref={buttonRef}
          title={activeFilterCount ? `${title} (${activeFilterCount} active)` : title}
          type="button"
        >
          {filterIcon || <CatalogFilterIcon />}
          {activeFilterCount ? <span className="catalog-filter-badge">{activeFilterCount}</span> : null}
        </button>
      </div>

      {popover && typeof document !== "undefined" && document.body ? createPortal(popover, document.body) : popover}
    </div>
  );
}

function CatalogFilterIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16">
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </svg>
  );
}
