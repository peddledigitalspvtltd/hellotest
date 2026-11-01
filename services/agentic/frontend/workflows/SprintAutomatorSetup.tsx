import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconChevronDown, IconX } from "@tabler/icons-react";
import { agenticApi } from "../api.client";
import "./SprintAutomatorSetup.css";

type Props = {
  projectId: string;
  input: string;
  onInput: (input: string) => void;
  editable: boolean;
  canRun?: boolean;
  busy: boolean;
  canViewSprints: boolean;
  onConfigureAutomation?: () => void;
};
function configuration(input: string): { value: Record<string, unknown> | null; error: string } {
  try {
    const value: unknown = JSON.parse(input.trim() || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return { value: null, error: "Workflow input must be a JSON object. Correct the raw input before choosing a Sprint." };
    return { value: value as Record<string, unknown>, error: "" };
  } catch {
    return { value: null, error: "Workflow input contains invalid JSON. Correct the raw input before choosing a Sprint; your text has been preserved." };
  }
}

/** One searchable scope control; task and connection settings belong to their nodes. */
export function SprintAutomatorSetup(props: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [selection, setSelection] = useState({ id: "", label: "" });
  const parsed = configuration(props.input);
  const sprintId = typeof parsed.value?.sprint_id === "string" ? parsed.value.sprint_id : "";
  const disabled = (!props.editable && !props.canRun) || props.busy || !parsed.value || !props.projectId || !props.canViewSprints;
  useEffect(() => { setOpen(false); setSearch(""); setQuery(""); setSelection({ id: "", label: "" }); }, [props.projectId]);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [search]);
  const sprints = useQuery({
    queryKey: ["sprint-automator-sprints", props.projectId, query],
    queryFn: ({ signal }) => agenticApi.evidenceScope.options({ project_id: props.projectId, field: "sprint_id", limit: 10, search: query }, { signal }),
    enabled: Boolean(props.projectId && props.canViewSprints), retry: false, staleTime: 30000,
  });
  const waiting = sprints.isFetching || search.trim() !== query;
  const options = search.trim() === query ? (sprints.data?.items || []).slice(0, 10) : [];
  const selected = selection.id === sprintId ? selection.label : sprints.data?.items?.find(item => item.id === sprintId)?.label || sprintId;
  useEffect(() => {
    const option = sprints.data?.items?.find(item => item.id === sprintId);
    if (option) setSelection({ id: option.id, label: option.label });
  }, [sprintId, sprints.data]);
  useEffect(() => setActive(0), [query]);
  const choose = (value: string, label = "") => {
    if (disabled || !parsed.value) return;
    props.onInput(JSON.stringify({ ...parsed.value, sprint_id: value }, null, 2));
    setSelection({ id: value, label }); setOpen(false); setSearch("");
  };
  const show = () => { if (!disabled) { setSearch(""); setOpen(true); setActive(0); } };
  return <section className="sprint-automator-setup" aria-label="Sprint scope">
    <div className="sprint-scope-label"><strong>Sprint</strong><small>Configure each task in its node.</small></div>
    <div className="sprint-combobox" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setSearch(""); }
    }}>
      <div className="sprint-combobox-control">
        <input ref={inputRef} role="combobox" aria-label="Sprint" aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined}
          value={open ? search : selected} placeholder="Search and select a Sprint" maxLength={255} disabled={disabled}
          onFocus={show} onClick={() => { if (!open) show(); }}
          onChange={event => { setSearch(event.target.value); setOpen(true); setActive(0); }}
          onKeyDown={event => {
            if (event.key === "Escape") { event.preventDefault(); setOpen(false); setSearch(""); }
            if (["ArrowDown", "ArrowUp"].includes(event.key)) {
              event.preventDefault();
              if (!open) show();
              else setActive(index => options.length ? (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length : 0);
            }
            if (event.key === "Enter" && open) { event.preventDefault(); const option = options[active]; if (option) choose(option.id, option.label); }
          }} />
        {sprintId && <button type="button" aria-label="Clear Sprint" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => choose("")}><IconX size={14} /></button>}
        <button type="button" aria-label="Choose Sprint" aria-expanded={open} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => { if (open) setOpen(false); else { inputRef.current?.focus(); show(); } }}><IconChevronDown size={15} /></button>
      </div>
      {open && <div className="sprint-combobox-menu">
        <div id={`${id}-options`} role="listbox" aria-label="Available Sprints" aria-busy={waiting}>
          {options.map((option, index) => <div key={option.id} id={`${id}-option-${index}`} role="option" aria-selected={sprintId === option.id}
            className={active === index ? "is-active" : ""} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(option.id, option.label)}>
            <span>{option.label}</span><small>{option.id}</small>
          </div>)}
        </div>
        {waiting ? <p role="status">Searching Sprints…</p> : sprints.isError ? <p role="alert">Sprints could not be loaded. <button type="button" onClick={() => void sprints.refetch()}>Retry</button></p>
          : !options.length ? <p role="status">{query ? "No matching Sprints." : "No Sprints available."}</p>
          : sprints.data?.has_more ? <p>Showing 10 results. Type to narrow the list.</p> : null}
      </div>}
    </div>
    {parsed.error && <p className="sprint-setup-error" role="alert">{parsed.error}</p>}
    {!props.projectId ? <p role="status">Choose a project to load Sprints.</p> : !props.canViewSprints ? <p role="status">Sprint access is required to browse this project's Sprints.</p> : null}
    {props.onConfigureAutomation && <p className="sprint-automation-guidance">Browser automation needs your application's reviewed start URL. <button type="button" onClick={props.onConfigureAutomation}>Configure AI Automation Engineer</button>. API-only cases use their supplied API URLs.</p>}
  </section>;
}
