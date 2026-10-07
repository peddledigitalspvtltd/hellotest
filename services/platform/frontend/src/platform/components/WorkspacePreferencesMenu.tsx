import { useLayoutEffect, useRef, useState } from "react";
import { IconDots, IconLanguage, IconMoon, IconRefresh, IconSun } from "@tabler/icons-react";
import { useLocalization } from "../../context/LocalizationContext";

/** Low-frequency controls share one keyboard-accessible disclosure in the app bar. */
export function WorkspacePreferencesMenu({ theme, onThemeChange, onRegionalPreferences, onRefresh, refreshing }: {
  theme: "light" | "dark";
  onThemeChange: () => void;
  onRegionalPreferences: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); triggerRef.current?.focus(); };

  useLayoutEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("pointerdown", outside); };
  }, [open]);

  return <div className="workspace-preferences-menu" ref={ref} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={triggerRef} className="workspace-header-icon workspace-preferences-trigger" type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? "workspace-preferences-menu" : undefined} aria-label={t("shell.workspaceOptions", "Workspace options")} title={t("shell.workspaceOptions", "Workspace options")} onClick={() => setOpen(value => !value)}><IconDots size={19} aria-hidden="true" /></button>
    {open && <div className="workspace-preferences-popover" id="workspace-preferences-menu" role="menu" aria-label={t("shell.workspaceOptions", "Workspace options")} onKeyDown={event => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not([disabled])"));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
      <button type="button" role="menuitem" onClick={() => { close(); onRegionalPreferences(); }}><IconLanguage size={17} aria-hidden="true" />{t("shell.preferences", "Language & region")}</button>
      <button type="button" role="menuitem" onClick={() => { close(); onThemeChange(); }}>{theme === "light" ? <IconMoon size={17} aria-hidden="true" /> : <IconSun size={17} aria-hidden="true" />}{t(theme === "light" ? "shell.darkTheme" : "shell.lightTheme", `Switch to ${theme === "light" ? "dark" : "light"} theme`)}</button>
      <div className="workspace-menu-divider" role="separator" />
      <button type="button" role="menuitem" disabled={refreshing} onClick={() => { close(); onRefresh(); }}><IconRefresh size={17} aria-hidden="true" />{t("shell.refresh", "Refresh current screen")}</button>
    </div>}
  </div>;
}
