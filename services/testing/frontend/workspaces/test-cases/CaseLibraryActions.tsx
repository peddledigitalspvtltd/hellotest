import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSplitActionMenu } from "@hellotest/platform/frontend/src/shared/hooks/useSplitActionMenu";
import { ChevronDownIcon, ChevronRightIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";

export function TestCaseActionIcon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16">
      {children}
    </svg>
  );
}

export function TestCaseImportIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </TestCaseActionIcon>
  );
}

export function TestCaseExportIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M12 21V9" />
      <path d="m17 14-5-5-5 5" />
      <path d="M5 3h14" />
    </TestCaseActionIcon>
  );
}

export function TestCaseSparkIcon() {
  return (
    <TestCaseActionIcon>
      <path d="m12 3 1.8 4.7L18 9.5l-4.2 1.8L12 16l-1.8-4.7L6 9.5l4.2-1.8Z" />
    </TestCaseActionIcon>
  );
}

export function TestCaseCreateIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </TestCaseActionIcon>
  );
}

export function TestCaseDropdownIcon() {
  return (
    <TestCaseActionIcon>
      <path d="m6 9 6 6 6-6" />
    </TestCaseActionIcon>
  );
}

export type TestCaseSplitAction = {
  label: string;
  description?: string;
  icon: ReactNode;
  disabled?: boolean;
  visible?: boolean;
  onClick: () => void;
};

export function TestCaseSplitActionButton({
  label,
  icon,
  iconOnly = false,
  className = "",
  tone = "blue",
  disabled,
  visible = true,
  onClick,
  menuLabel,
  actions
}: {
  label: string;
  icon: ReactNode;
  iconOnly?: boolean;
  className?: string;
  tone?: "blue" | "green";
  disabled?: boolean;
  visible?: boolean;
  onClick: () => void;
  menuLabel: string;
  actions: TestCaseSplitAction[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const permittedActions = actions.filter(action => action.visible !== false);
  const primaryAction = visible ? { label, icon, disabled, onClick } : permittedActions[0];
  const menuActions = visible ? permittedActions : permittedActions.slice(1);
  const canOpenMenu = menuActions.length > 0;
  const { menuStyle } = useSplitActionMenu(isOpen && canOpenMenu, triggerRef, menuRef);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const menu = isOpen && canOpenMenu ? (
    <div data-split-action-menu className={["run-action-dropdown test-case-action-dropdown", tone === "green" ? "test-case-run-action-dropdown" : ""].filter(Boolean).join(" ")} ref={menuRef} role="menu" style={menuStyle}>
      {menuActions.map((action) => (
        <button
          disabled={action.disabled}
          key={action.label}
          onClick={() => {
            setIsOpen(false);
            action.onClick();
          }}
          role="menuitem"
          type="button"
        >
          <span className="run-action-option-icon">{action.icon}</span>
          <strong>{action.label}</strong>
        </button>
      ))}
    </div>
  ) : null;

  if (!primaryAction) return null;

  return (
    <div className={["create-run-action-button", tone === "blue" ? "test-case-split-action-button" : "test-case-run-split-action-button", canOpenMenu ? "" : "is-single", iconOnly ? "is-explorer-compact" : "", className].filter(Boolean).join(" ")} ref={triggerRef}>
      <button aria-label={iconOnly ? primaryAction.label : undefined} className="run-action-main issue-report-split-main" disabled={primaryAction.disabled} onClick={primaryAction.onClick} title={iconOnly ? primaryAction.label : undefined} type="button">
        {primaryAction.icon}
        {iconOnly ? null : <span>{primaryAction.label}</span>}
      </button>
      {canOpenMenu ? (
        <button
          aria-expanded={isOpen}
          aria-haspopup="menu"
          aria-label={menuLabel}
          className="run-action-toggle"
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          <TestCaseDropdownIcon />
        </button>
      ) : null}
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

export function TestCaseDeleteIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M7 7v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </TestCaseActionIcon>
  );
}

export function TestCaseRunIcon() {
  return (
    <TestCaseActionIcon>
      <path d="m9 7 8 5-8 5z" fill="currentColor" stroke="none" />
    </TestCaseActionIcon>
  );
}

export function DeferredTestCaseCatalogValue({ field }: { field: string }) {
  const guidance = `Open this test case to load ${field}.`;
  return <span aria-label={guidance} title={guidance}>On open</span>;
}

export function ModuleChevronIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <span aria-hidden="true" className="hierarchy-toggle-glyph" data-state={isExpanded ? "expanded" : "collapsed"}>
      {isExpanded ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
    </span>
  );
}

export function ModulePencilIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M4 20h4" />
      <path d="M14.5 5.5 18.5 9.5" />
      <path d="m6 18 10.5-10.5a2.1 2.1 0 0 1 3 3L9 21H6z" />
    </TestCaseActionIcon>
  );
}

export function TestCaseFlowMapIcon() {
  return (
    <TestCaseActionIcon>
      <rect height="4" rx="1" width="7" x="8.5" y="3.5" />
      <rect height="4" rx="1" width="7" x="3" y="16.5" />
      <rect height="4" rx="1" width="7" x="14" y="16.5" />
      <path d="M12 7.5v4.5" />
      <path d="M6.5 16.5V12H17.5v4.5" />
    </TestCaseActionIcon>
  );
}

export function TestCaseAcceptIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M6 12.5 10 16l8-8" />
    </TestCaseActionIcon>
  );
}

export function TestCaseRejectIcon() {
  return (
    <TestCaseActionIcon>
      <path d="m8 8 8 8" />
      <path d="m16 8-8 8" />
    </TestCaseActionIcon>
  );
}

export function TestCaseTileActionButton({
  children,
  className = "",
  disabled = false,
  onClick,
  title
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      aria-label={title}
      className={["test-case-tile-action-button", className].filter(Boolean).join(" ")}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}
