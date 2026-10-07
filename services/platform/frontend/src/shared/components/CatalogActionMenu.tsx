import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../auth/AuthContext";
import { useFeatureFlags } from "../../platform/hooks/useFeatureFlags";
import { useCurrentProject } from "../../platform/hooks/useCurrentProject";
import { areFeatureFlagsEnabled } from "../../platform/lib/featureFlags";
import { hasAnyPermission, hasPermission } from "../../platform/lib/permissions";
import { MoreIcon } from "../../platform/components/AppIcons";
import "./CatalogActionMenu.css";

export type CatalogActionMenuItem = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  description?: string;
  disabled?: boolean;
  featureKeys?: string[];
  permissionMode?: "all" | "any";
  requiredPermissions?: string[];
  tone?: "default" | "danger" | "primary";
};

export function CatalogActionMenu({
  label,
  actions,
  projectId,
  className = "",
  disabled = false,
  triggerContent
}: {
  label: string;
  actions: CatalogActionMenuItem[];
  projectId?: string | null;
  className?: string;
  disabled?: boolean;
  triggerContent?: ReactNode;
}) {
  const { session } = useAuth();
  const [activeProjectId] = useCurrentProject();
  const permissionProjectId = projectId || activeProjectId;
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const menuId = `catalog-menu-${useId().replace(/:/g, "")}`;
  const triggerId = `${menuId}-trigger`;
  const initialFocusRef = useRef<"first" | "last">("first");
  const typeaheadRef = useRef({ text: "", timestamp: 0 });
  const [isOpen, setIsOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) {
      setMenuStyle(null);
      return;
    }

    const updateMenuPosition = () => {
      const trigger = triggerRef.current;

      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const menuWidth = Math.max(menuRef.current?.offsetWidth || 256, 256);
      const menuHeight = menuRef.current?.offsetHeight || 260;
      const viewportPadding = 8;
      const left = Math.min(
        Math.max(viewportPadding, rect.right - menuWidth),
        window.innerWidth - menuWidth - viewportPadding
      );
      const bottomTop = rect.bottom + viewportPadding;
      const top = bottomTop + menuHeight > window.innerHeight - viewportPadding
        ? Math.max(viewportPadding, rect.top - menuHeight - viewportPadding)
        : bottomTop;

      setMenuStyle({
        left,
        top,
        minWidth: "16rem",
        maxWidth: "min(calc(100vw - 1rem), 22rem)",
        maxHeight: `calc(100vh - ${viewportPadding * 2}px)`,
        opacity: 1
      });
    };

    let scrollFrame = 0;
    const handleScroll = (event: Event) => {
      const target = event.target as Node | null;

      if (target && menuRef.current?.contains(target)) {
        return;
      }

      if (!scrollFrame) scrollFrame = window.requestAnimationFrame(() => { scrollFrame = 0; updateMenuPosition(); });
    };

    updateMenuPosition();
    const frameId = window.requestAnimationFrame(updateMenuPosition);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.cancelAnimationFrame(scrollFrame);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

	  const visibleActions = actions.filter((action) => {
	    const permissions = action.requiredPermissions || [];
	    const features = action.featureKeys || [];
	    const hasRequiredPermissions = !permissions.length
	      || (action.permissionMode === "all"
	        ? permissions.every((permission) => hasPermission(session, permission, permissionProjectId))
	        : hasAnyPermission(session, permissions, permissionProjectId));

	    return hasRequiredPermissions
	      && areFeatureFlagsEnabled(featureFlagsQuery.data, features);
	  });

  const closeAndReturnFocus = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)");
    if (items?.length) items[initialFocusRef.current === "last" ? items.length - 1 : 0].focus({ preventScroll: true });
    else menuRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") || []);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      closeAndReturnFocus();
      return;
    }
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
      const now = Date.now();
      const previous = now - typeaheadRef.current.timestamp < 700 ? typeaheadRef.current.text : "";
      const text = previous + event.key.toLocaleLowerCase();
      typeaheadRef.current = { text, timestamp: now };
      next = items.findIndex(item => item.textContent?.trim().toLocaleLowerCase().startsWith(text));
    }
    if (next >= 0 && items[next]) {
      event.preventDefault();
      event.stopPropagation();
      items[next].focus({ preventScroll: true });
    }
  };

  const menu = isOpen ? (
    <div
      className="step-card-menu-panel catalog-action-menu-panel"
      data-dialog-popover-owner={triggerId}
      id={menuId}
      aria-labelledby={triggerId}
      onKeyDown={handleMenuKeyDown}
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      style={menuStyle || { opacity: 0, pointerEvents: "none" }}
    >
      {visibleActions.map((action) => (
        <button
          className={["step-card-menu-item", action.tone ? `is-${action.tone}` : ""].filter(Boolean).join(" ")}
          disabled={action.disabled}
          key={action.label}
          onClick={(event) => {
            event.stopPropagation();
            closeAndReturnFocus();
            action.onClick();
          }}
          role="menuitem"
          tabIndex={-1}
          title={action.label}
          type="button"
        >
          {action.icon}
          <span className="step-card-menu-item-content">
            <span className="step-card-menu-item-label-row">
              <span className="step-card-menu-item-label">{action.label}</span>
              {action.description ? <small className="catalog-action-description">{action.description}</small> : null}
            </span>
          </span>
        </button>
      ))}
      {!visibleActions.length ? <div className="step-card-menu-item is-empty">No actions available</div> : null}
    </div>
  ) : null;

  return (
    <div className={["step-card-menu", "step-card-menu--flat", "catalog-action-menu", className].filter(Boolean).join(" ")}>
      <button
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen}
        id={triggerId}
        aria-haspopup="menu"
        aria-label={label}
        className={triggerContent ? "step-card-menu-trigger catalog-action-menu-custom-trigger" : "step-card-menu-trigger"}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          initialFocusRef.current = "first";
          setIsOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          event.stopPropagation();
          initialFocusRef.current = event.key === "ArrowUp" ? "last" : "first";
          setIsOpen(true);
        }}
        ref={triggerRef}
        title={label}
        type="button"
      >
        {triggerContent || <MoreIcon />}
      </button>
      {menu && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
    </div>
  );
}
