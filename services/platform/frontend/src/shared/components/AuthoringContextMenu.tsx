import { IconPlus } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { CatalogActionMenu } from "./CatalogActionMenu";
import "./AuthoringContextMenu.css";

type ContextSection = { id: string; label: string; icon: ReactNode; summary?: string; disabled?: boolean };

/** Opens the requested optional section and takes the author straight to its first control. */
export function AuthoringContextMenu({ sections, disabled = false }: { sections: ContextSection[]; disabled?: boolean }) {
  return <CatalogActionMenu className="authoring-context-menu" disabled={disabled} label="Add context" triggerContent={<><IconPlus aria-hidden="true" size={15} /><span>Add context</span></>} actions={sections.map(section => ({
    label: section.label, icon: section.icon, description: section.summary, disabled: section.disabled,
    onClick: () => {
      const target = document.getElementById(section.id);
      if (!target) return;
      if (target instanceof HTMLDetailsElement) target.open = true;
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const control = Array.from(target.querySelectorAll<HTMLElement>("input:not([type=hidden]),textarea,select,[contenteditable=true],button"))
        .find(item => item.getClientRects().length && !item.matches(":disabled") && !item.closest("[hidden],[inert],[aria-hidden=true]"));
      (control || target.querySelector<HTMLElement>("summary"))?.focus({ preventScroll: true });
    }
  }))} />;
}
