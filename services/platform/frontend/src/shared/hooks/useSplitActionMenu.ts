import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";
import "../../platform/components/split-action-menu.css";

type MenuStyle = CSSProperties & Record<`--${string}`, string | number>;
type MenuState = { menuStyle: CSSProperties; menuPlacement: "above" | "below" };
const HIDDEN_STYLE: CSSProperties = { opacity: 0, pointerEvents: "none" };
const colorAlpha = (color: string) => {
  if (!color || color === "transparent") return 0;
  const alpha = color.match(/\/\s*([\d.]+)(%)?\s*\)$/)
    || color.match(/^(?:rgba|hsla)\(.*?,\s*([\d.]+)(%)?\s*\)$/);
  return alpha ? Number(alpha[1]) / (alpha[2] ? 100 : 1) : 1;
};
const transparent = (color: string) => colorAlpha(color) === 0;
const hasPaint = (style: CSSStyleDeclaration) => style.backgroundImage !== "none" || !transparent(style.backgroundColor);

/** Carry the trigger's appearance across the body portal, then measure the menu. */
export function useSplitActionMenu(
  isOpen: boolean,
  triggerRef: RefObject<HTMLElement>,
  menuRef: RefObject<HTMLDivElement>
): MenuState {
  const [state, setState] = useState<MenuState>({ menuStyle: HIDDEN_STYLE, menuPlacement: "below" });

  useLayoutEffect(() => {
    if (!isOpen) {
      setState(current => current.menuStyle === HIDDEN_STYLE ? current : { menuStyle: HIDDEN_STYLE, menuPlacement: "below" });
      return;
    }
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    let frame = 0;
    let disposed = false;

    const update = () => {
      if (disposed || !trigger.isConnected || !menu.isConnected) return;
      const main = trigger.querySelector<HTMLElement>(".run-action-main, .report-bug-split-main, .issue-report-split-main, button") || trigger;
      const label = Array.from(main.children).reverse().find(child => child instanceof HTMLElement && child.textContent?.trim()) as HTMLElement | undefined;
      const rootStyle = getComputedStyle(trigger);
      const mainStyle = getComputedStyle(main);
      const labelStyle = getComputedStyle(label || main);
      // A translucent main-button hover is an overlay over the wrapper's paint,
      // not a standalone action color for the detached menu.
      const mainIsOverlay = mainStyle.backgroundImage === "none"
        && colorAlpha(mainStyle.backgroundColor) < 1 && hasPaint(rootStyle);
      const paint = hasPaint(mainStyle) && !mainIsOverlay ? mainStyle : rootStyle;
      const rect = trigger.getBoundingClientRect();
      const icon = main.querySelector<SVGElement | HTMLImageElement>("svg, img");
      const iconRect = icon?.getBoundingClientRect();
      const radius = rootStyle.borderTopLeftRadius || mainStyle.borderTopLeftRadius || "6px";
      const border = Number.parseFloat(rootStyle.borderTopWidth) > 0 && !transparent(rootStyle.borderTopColor)
        ? rootStyle.borderTopColor : Number.parseFloat(mainStyle.borderTopWidth) > 0 && !transparent(mainStyle.borderTopColor)
          ? mainStyle.borderTopColor : paint.backgroundColor;
      const variables: Record<`--${string}`, string> = {
        "--split-action-background": paint.background,
        "--split-action-foreground": labelStyle.color,
        "--split-action-border": border,
        "--split-action-height": `${Math.max(1, rect.height)}px`,
        "--split-action-radius": radius,
        "--split-action-panel-radius": `${Math.min(12, Number.parseFloat(radius) || 0) + 4}px`,
        "--split-action-font-family": labelStyle.fontFamily,
        "--split-action-font-size": labelStyle.fontSize,
        "--split-action-font-weight": labelStyle.fontWeight,
        "--split-action-line-height": labelStyle.lineHeight,
        "--split-action-letter-spacing": labelStyle.letterSpacing,
        "--split-action-text-transform": labelStyle.textTransform,
        "--split-action-gap": mainStyle.columnGap === "normal" || (!label && !Number.parseFloat(mainStyle.columnGap)) ? "8px" : mainStyle.columnGap,
        "--split-action-padding-inline": !label && !Number.parseFloat(mainStyle.paddingInlineStart) ? "8px" : mainStyle.paddingInlineStart,
        "--split-action-padding-top": mainStyle.paddingTop,
        "--split-action-padding-bottom": mainStyle.paddingBottom,
        "--split-action-icon-width": `${iconRect?.width || 16}px`,
        "--split-action-icon-height": `${iconRect?.height || 16}px`,
        "--split-action-panel-background": rootStyle.getPropertyValue("--panel-strong").trim() || "#ffffff",
        "--split-action-panel-border": rootStyle.getPropertyValue("--border").trim() || "#d8dee9"
      };
      // CSS variables must be applied before the natural-width read. Reset old
      // constraints so a previous mobile size cannot pin a later desktop menu.
      Object.entries(variables).forEach(([key, value]) => menu.style.setProperty(key, value));
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportWidth = viewport?.width || window.innerWidth;
      const viewportHeight = viewport?.height || window.innerHeight;
      const padding = 12;
      const gap = 8;
      const availableWidth = Math.max(1, viewportWidth - padding * 2);
      const availableHeight = Math.max(1, viewportHeight - padding * 2);
      menu.style.setProperty("--split-action-menu-max-width", `${availableWidth}px`);
      menu.style.setProperty("--split-action-menu-width", "max-content");
      menu.style.setProperty("--split-action-menu-max-height", "none");
      const naturalWidth = menu.getBoundingClientRect().width;
      const width = Math.min(availableWidth, Math.max(rect.width, naturalWidth));
      menu.style.setProperty("--split-action-menu-width", `${width}px`);
      const naturalHeight = menu.getBoundingClientRect().height;
      const spaceBelow = viewportTop + viewportHeight - padding - rect.bottom - gap;
      const spaceAbove = rect.top - gap - viewportTop - padding;
      const above = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
      const maxHeight = Math.min(availableHeight, Math.max(1, above ? spaceAbove : spaceBelow));
      menu.style.setProperty("--split-action-menu-max-height", `${maxHeight}px`);
      const height = menu.getBoundingClientRect().height;
      const left = Math.max(viewportLeft + padding, Math.min(rect.right - width, viewportLeft + viewportWidth - padding - width));
      const top = Math.max(viewportTop + padding, Math.min(above ? rect.top - gap - height : rect.bottom + gap,
        viewportTop + viewportHeight - padding - height));
      const menuStyle: MenuStyle = {
        ...variables,
        "--split-action-menu-width": `${width}px`,
        "--split-action-menu-max-width": `${availableWidth}px`,
        "--split-action-menu-max-height": `${maxHeight}px`,
        left, top, opacity: 1, pointerEvents: "auto"
      };
      // Position immediately as well, before this layout effect's state render.
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.style.opacity = "1";
      menu.style.pointerEvents = "auto";
      const menuPlacement = above ? "above" : "below";
      setState(current => current.menuPlacement === menuPlacement
        && Object.keys(menuStyle).length === Object.keys(current.menuStyle).length
        && Object.entries(menuStyle).every(([key, value]) => current.menuStyle[key as keyof CSSProperties] === value)
        ? current : { menuStyle, menuPlacement });
    };
    const schedule = () => {
      if (frame || disposed) return;
      frame = window.requestAnimationFrame(() => { frame = 0; update(); });
    };
    update();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(trigger);
    resize?.observe(menu);
    const mutation = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
    // Theme and density may be set on any ancestor of the trigger.
    let ancestor: HTMLElement | null = trigger;
    while (ancestor) {
      mutation?.observe(ancestor, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-color-mode"] });
      ancestor = ancestor.parentElement;
    }
    mutation?.observe(menu, { childList: true, characterData: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    for (const event of ["pointerenter", "pointerleave", "focusin", "focusout", "transitionend", "transitioncancel"]) trigger.addEventListener(event, schedule);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      resize?.disconnect();
      mutation?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      for (const event of ["pointerenter", "pointerleave", "focusin", "focusout", "transitionend", "transitioncancel"]) trigger.removeEventListener(event, schedule);
    };
  }, [isOpen, triggerRef, menuRef]);

  return state;
}
