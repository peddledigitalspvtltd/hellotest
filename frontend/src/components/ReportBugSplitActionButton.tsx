import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { IconBug as BugIcon, IconChevronDown } from "@tabler/icons-react";
import "./report-bug-split-action.css";

export function ReportBugSplitActionButton({
  canUseAi = false,
  className = "",
  disabled = false,
  onReportBug,
  onReportBugWithAi
}: {
  canUseAi?: boolean;
  className?: string;
  disabled?: boolean;
  onReportBug: () => void;
  onReportBugWithAi?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<"above" | "below">("below");
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuItemRef = useRef<HTMLButtonElement | null>(null);
  const showAiAction = canUseAi && Boolean(onReportBugWithAi);
  const canOpenMenu = showAiAction && !disabled;

  useEffect(() => {
    if (canOpenMenu || !isOpen) return;
    setIsOpen(false);
  }, [canOpenMenu, isOpen]);

  useEffect(() => {
    if (!isOpen || !canOpenMenu) {
      setMenuStyle(null);
      return;
    }

    const updateMenuPosition = () => {
      const trigger = rootRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;

      const viewportPadding = 12;
      const triggerRect = trigger.getBoundingClientRect();
      const availableWidth = Math.max(1, window.innerWidth - viewportPadding * 2);
      const preferredWidth = Math.max(triggerRect.width, menu.scrollWidth);
      const menuWidth = Math.min(preferredWidth, availableWidth);
      const menuHeight = menu.offsetHeight;
      const spaceBelow = window.innerHeight - triggerRect.bottom - viewportPadding;
      const spaceAbove = triggerRect.top - viewportPadding;
      const shouldOpenAbove = menuHeight > spaceBelow && spaceAbove > spaceBelow;
      const left = Math.min(
        Math.max(viewportPadding, triggerRect.right - menuWidth),
        Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding)
      );
      const top = shouldOpenAbove
        ? Math.max(viewportPadding, triggerRect.top - menuHeight - 8)
        : Math.min(
            triggerRect.bottom + 8,
            Math.max(viewportPadding, window.innerHeight - menuHeight - viewportPadding)
          );

      setMenuPlacement(shouldOpenAbove ? "above" : "below");
      setMenuStyle({
        left,
        maxWidth: "calc(100vw - 24px)",
        opacity: 1,
        top,
        width: menuWidth
      });
    };

    updateMenuPosition();
    const frameId = window.requestAnimationFrame(updateMenuPosition);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateMenuPosition);
    if (rootRef.current) resizeObserver?.observe(rootRef.current);
    if (menuRef.current) resizeObserver?.observe(menuRef.current);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [canOpenMenu, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const closeOnFocusOutside = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsOpen(false);
      window.requestAnimationFrame(() => toggleRef.current?.focus());
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("focusin", closeOnFocusOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("focusin", closeOnFocusOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const frameId = window.requestAnimationFrame(() => menuItemRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, [isOpen]);

  const handleToggleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!canOpenMenu || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    setIsOpen(true);
  };

  const menu = isOpen && canOpenMenu ? (
    <div
      className="issue-report-split-menu report-bug-split-menu"
      data-placement={menuPlacement}
      id={menuId}
      ref={menuRef}
      role="menu"
      style={menuStyle || { opacity: 0, pointerEvents: "none" }}
    >
      <button
        aria-label="Report Bug using AI"
        className="issue-report-split-ai-option"
        onClick={() => {
          setIsOpen(false);
          onReportBugWithAi?.();
        }}
        ref={menuItemRef}
        role="menuitem"
        type="button"
      >
        <BugIcon />
        <strong>Report Bug using AI</strong>
      </button>
    </div>
  ) : null;

  return (
    <div
      className={[
        "report-bug-split-action-button",
        "issue-report-split",
        showAiAction ? "" : "is-single",
        disabled ? "is-disabled" : "",
        isOpen ? "is-open" : "",
        className
      ].filter(Boolean).join(" ")}
      data-component="report-bug-split-action"
      ref={rootRef}
    >
      <button
        className="issue-report-split-main report-bug-split-main"
        disabled={disabled}
        onClick={() => {
          setIsOpen(false);
          onReportBug();
        }}
        type="button"
      >
        <BugIcon />
        <span>Report Bug</span>
      </button>
      {showAiAction ? (
        <>
          <button
            aria-expanded={isOpen}
            aria-controls={isOpen ? menuId : undefined}
            aria-haspopup="menu"
            aria-label="Choose bug reporting method"
            className="issue-report-split-toggle report-bug-split-toggle"
            disabled={disabled}
            onKeyDown={handleToggleKeyDown}
            onClick={() => setIsOpen((current) => !current)}
            ref={toggleRef}
            type="button"
          >
            <IconChevronDown aria-hidden="true" size={16} stroke={2} />
          </button>
        </>
      ) : null}
      {menu && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
    </div>
  );
}
