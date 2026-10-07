import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconChevronDown, IconSearch } from "@tabler/icons-react";
import "./ContextSelect.css";

type Choice = { value: string; label: string; disabled: boolean; group?: string };

function choicesFrom(children: ReactNode, group?: string): Choice[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; value?: string | number; label?: string; disabled?: boolean }>(child)) return [];
    if (child.type === "optgroup") return choicesFrom(child.props.children, child.props.label).map(item => ({ ...item, disabled: Boolean(child.props.disabled || item.disabled) }));
    if (child.type !== "option") return [];
    const label = Children.toArray(child.props.children).join("");
    return [{ value: String(child.props.value ?? label), label, disabled: Boolean(child.props.disabled), group }];
  });
}

/** Compact property control. The original select remains authoritative for forms and validation. */
export function ContextSelect({ label, icon, children, className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; icon?: ReactNode }) {
  const generatedId = useId().replace(/:/g, "");
  const triggerId = `context-trigger-${generatedId}`;
  const listId = `context-options-${generatedId}`;
  const selectRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 280, maxHeight: 360 });
  const choices = choicesFrom(children);
  const value = String(props.value ?? props.defaultValue ?? "");
  const selected = choices.find(item => item.value === value);
  const filtered = choices.filter(item => `${item.label} ${item.group || ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const enabled = filtered.filter(item => !item.disabled);
  const disabled = props.disabled || Boolean(selectRef.current?.closest("fieldset:disabled"));
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) triggerRef.current?.focus(); };
  const place = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(320, Math.max(260, rect.width), window.innerWidth - 16);
    const height = Math.min(360, window.innerHeight - 24);
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const useAbove = below < Math.min(height, 200) && above > below;
    const maxHeight = Math.max(100, Math.min(height, useAbove ? above : below));
    const actualHeight = Math.min(popoverRef.current?.offsetHeight || maxHeight, maxHeight);
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: useAbove ? Math.max(8, rect.top - actualHeight - 6) : rect.bottom + 6, width, maxHeight });
  };

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { setActiveIndex(0); }, [search]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) close(); };
    let scrollFrame = 0;
    const scrolled = (event: Event) => { if (!popoverRef.current?.contains(event.target as Node) && !scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; place(); }); };
    place();
    const frame = requestAnimationFrame(() => { place(); searchRef.current?.focus({ preventScroll: true }); });
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scrolled, true);
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(scrollFrame); document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", place); window.removeEventListener("scroll", scrolled, true); };
  }, [open]);

  const choose = (choice: Choice) => {
    if (choice.disabled || disabled || !selectRef.current || selectRef.current.matches(":disabled") || selectRef.current.closest("[inert]")) return;
    // Dispatch the native select change so existing controlled handlers, IDs,
    // backend values and form semantics survive this presentation layer.
    selectRef.current.value = choice.value;
    selectRef.current.dispatchEvent(new Event("change", { bubbles: true }));
    close(true);
  };
  const show = () => { if (disabled || selectRef.current?.matches(":disabled") || selectRef.current?.closest("[inert]")) return; triggerRef.current?.focus({ preventScroll: true }); place(); setSearch(""); setActiveIndex(0); setOpen(true); };

  return <span className={["context-select", open ? "is-open" : "", className].filter(Boolean).join(" ")}>
    <select {...props} aria-hidden="true" className="context-select-native" ref={selectRef} tabIndex={-1} onFocus={show} onInvalid={event => { props.onInvalid?.(event); event.preventDefault(); show(); }}>
      {children}
    </select>
    <button aria-controls={open ? listId : undefined} aria-expanded={open} aria-haspopup="listbox" aria-label={`${label}: ${selected?.label || "Not set"}`} aria-describedby={props["aria-describedby"]} aria-invalid={props["aria-invalid"]} className="context-select-trigger" data-dialog-popover-owner={triggerId} disabled={disabled} id={triggerId} onClick={() => open ? close() : show()} onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); } else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); } }} ref={triggerRef} type="button">
      {icon ? <span aria-hidden="true" className="context-select-icon">{icon}</span> : null}
      <span className="context-select-label">{label}</span><span className="context-select-value">{selected?.label || "Not set"}</span><IconChevronDown aria-hidden="true" size={13} />
    </button>
    {open && typeof document !== "undefined" ? createPortal(<div className="context-select-popover" data-dialog-popover-owner={triggerId} ref={popoverRef} style={position} onKeyDown={event => {
      if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); close(true); return; }
      if (!enabled.length) return;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); setActiveIndex(current => event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + enabled.length) % enabled.length);
      } else if (event.key === "Enter") { event.preventDefault(); const item = enabled[activeIndex]; if (item) choose(item); }
    }}>
      <div className="context-select-search"><IconSearch aria-hidden="true" size={16} /><input aria-activedescendant={enabled[activeIndex] ? `${listId}-${choices.indexOf(enabled[activeIndex])}` : undefined} aria-controls={listId} aria-label={`Search ${label}`} autoComplete="off" onChange={event => setSearch(event.target.value)} placeholder={`Find ${label.toLowerCase()}…`} ref={searchRef} role="combobox" aria-expanded="true" aria-autocomplete="list" type="text" value={search} /></div>
      <div aria-label={label} className="context-select-options" id={listId} role="listbox">
        {filtered.map((choice, index) => <button aria-selected={choice.value === value} className={enabled[activeIndex] === choice ? "is-active" : ""} disabled={choice.disabled} id={`${listId}-${choices.indexOf(choice)}`} key={`${choice.value}-${index}`} onClick={() => choose(choice)} onMouseEnter={() => { const next = enabled.indexOf(choice); if (next >= 0) setActiveIndex(next); }} role="option" tabIndex={-1} type="button">
          <span>{choice.group && filtered[index - 1]?.group !== choice.group ? <small>{choice.group}</small> : null}{choice.label}</span>{choice.value === value ? <IconCheck aria-hidden="true" size={15} /> : null}
        </button>)}
        {!filtered.length ? <p className="context-select-empty">No matching {label.toLowerCase()}</p> : null}
      </div>
    </div>, document.body) : null}
  </span>;
}
