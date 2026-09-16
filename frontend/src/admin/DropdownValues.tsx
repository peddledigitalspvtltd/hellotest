import { LoadingState } from "../components/LoadingState";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconAlertCircle, IconArrowDown, IconArrowUp, IconCheck, IconChevronRight, IconExternalLink, IconListDetails,
  IconLock, IconPlus, IconSearch, IconX } from "@tabler/icons-react";
import { adminApi, workspaceUrl, type DropdownCatalog, type DropdownField, type DropdownOption } from "./api";
import "./dropdown-values.css";

type OptionDraft = DropdownOption & { id: string; added?: boolean; codeEdited?: boolean };
type Draft = { revision: number; options: OptionDraft[]; default_value: string | null };
const kindLabel = { configurable: "Configurable", suggestions: "Suggestions", system: "System defined", records: "Managed records" };
const draftFor = (field: DropdownField, revision: number): Draft => ({ revision, default_value: field.default_value,
  options: field.options.map(option => ({ ...option, description: option.description || "", id: `saved-${option.value}` })) });
const contents = (draft: Draft) => JSON.stringify({ default_value: draft.default_value,
  options: draft.options.map(({ value, label, description, active }) => ({ value, label, description: description || "", active })) });
const codeFromLabel = (label: string, format: DropdownField["value_format"]) => format === "slug"
  ? label.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^[^a-z]+|_+$/g, "").slice(0, 120)
  : format === "integer" ? /^\d+$/.test(label.trim()) ? String(Number(label.trim())) : "" : label.trim();
const validation = (draft: Draft, field: DropdownField) => {
  const errors: string[] = [], values = new Set<string>(), labels = new Set<string>();
  draft.options.forEach((option, index) => {
    const value = option.value.trim(), label = option.label.trim();
    if (!label || !value) errors.push(`Value ${index + 1} needs a display label and stored value.`);
    else if (value.length > 120 || label.length > 120 || option.description.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) errors.push(`Value ${index + 1} contains invalid or overly long text.`);
    else if (field.value_format === "slug" && !/^[a-z][a-z0-9_-]{0,119}$/.test(value)) errors.push(`Value ${index + 1} needs a code starting with a letter; use lowercase letters, numbers, underscores or hyphens.`);
    else if (field.value_format === "integer" && !/^[1-9]\d{0,2}$/.test(value)) errors.push(`Value ${index + 1} must be a whole number from 1 to 999.`);
    if (value && values.has(value.toLowerCase())) errors.push(`Stored value “${value}” is already used.`);
    if (label && labels.has(label.toLowerCase())) errors.push(`Display label “${label}” is already used.`);
    values.add(value.toLowerCase()); labels.add(label.toLowerCase());
  });
  if (field.required && !draft.options.some(option => option.active)) errors.push("Keep at least one value active for this required field.");
  if (field.supports_default && !draft.options.some(option => option.active && option.value === draft.default_value)) errors.push("Choose an active value as the default for new records.");
  return errors;
};

export function DropdownValues({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [catalog, setCatalog] = useState<DropdownCatalog | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState<{ key: string; text: string; conflict: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const request = useRef<AbortController | null>(null);
  const optionCounter = useRef(0);
  const newOptionInput = useRef<HTMLInputElement | null>(null);
  const focusOption = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const fields = catalog?.fields || [];
  const selected = fields.find(field => field.key === selectedKey) || fields[0];
  const draft = selected ? drafts[selected.key] || draftFor(selected, catalog!.revision) : null;
  const currentDirty = Boolean(selected && drafts[selected.key]);
  const dirtyCount = Object.keys(drafts).length;
  const load = useCallback(async (resetKey?: string) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setLoadError("");
    try {
      const next = await adminApi.dropdownCatalog({ signal: controller.signal });
      if (controller.signal.aborted) return;
      setCatalog(next); setSelectedKey(current => next.fields.some(field => field.key === current) ? current : next.fields[0]?.key || "");
      if (resetKey) {
        setDrafts(current => { const nextDrafts = { ...current }; delete nextDrafts[resetKey]; return nextDrafts; });
        setSaveError(null); setAnnouncement("Latest saved values loaded. Changes to this field were discarded.");
      }
    } catch (error) { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Dropdown values could not be loaded."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => request.current?.abort(); }, [load]);
  useEffect(() => { onDirtyChange?.(dirtyCount > 0); }, [dirtyCount, onDirtyChange]);
  useEffect(() => {
    if (!dirtyCount) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirtyCount]);
  useEffect(() => { if (focusOption.current && newOptionInput.current) { newOptionInput.current.focus(); focusOption.current = null; } }, [draft]);

  const change = (update: (current: Draft) => Draft) => {
    if (!selected || !draft || saving) return;
    setAnnouncement("");
    const next = update(draft);
    setDrafts(current => {
      const result = { ...current };
      if (contents(next) === contents(draftFor(selected, catalog!.revision))) delete result[selected.key];
      else result[selected.key] = next;
      return result;
    });
    if (!saveError?.conflict) setSaveError(null);
  };
  const updateOption = (id: string, update: Partial<OptionDraft>) => change(current => ({ ...current,
    options: current.options.map(option => option.id === id ? { ...option, ...update } : option) }));
  const move = (id: string, direction: -1 | 1) => {
    change(current => {
      const options = [...current.options], index = options.findIndex(option => option.id === id);
      if (index + direction < 0 || index + direction >= options.length) return current;
      [options[index], options[index + direction]] = [options[index + direction], options[index]];
      setAnnouncement(`${options[index + direction].label || "New value"} moved to position ${index + direction + 1}.`);
      return { ...current, options };
    });
  };
  const save = async () => {
    if (!selected || !draft || !currentDirty || validation(draft, selected).length) return;
    const key = selected.key;
    setSaving(true); setSaveError(null); setAnnouncement("");
    try {
      const next = await adminApi.updateDropdown(key, { expected_revision: draft.revision,
        options: draft.options.map(({ value, label, description, active }) => ({ value: value.trim(), label: label.trim(), description: description.trim(), active })),
        ...(selected.supports_default ? { default_value: draft.default_value } : {}) });
      setCatalog(next);
      setDrafts(current => Object.fromEntries(Object.entries(current).filter(([fieldKey]) => fieldKey !== key)
        .map(([fieldKey, fieldDraft]) => [fieldKey, fieldDraft.revision === draft.revision ? { ...fieldDraft, revision: next.revision } : fieldDraft])));
      setAnnouncement(`${selected.label} saved. Updated choices are available to the workspace.`);
    } catch (error) {
      const conflict = (error as { status?: number }).status === 409;
      setSaveError({ key, conflict, text: conflict ? "Another administrator updated dropdown values. Your draft is still here. Reload this field to review the latest saved values before editing again."
        : error instanceof Error ? error.message : "Changes could not be saved. Your draft is retained." });
    } finally { setSaving(false); }
  };
  const groups = [...new Set(fields.map(field => field.group))];
  const visible = useMemo(() => fields.filter(field => (group === "all" || field.group === group)
    && `${field.label} ${field.key} ${field.description} ${field.group} ${field.usage.map(item => item.label).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase())), [fields, group, search]);
  const errors = selected && draft && currentDirty ? validation(draft, selected) : [];
  const editable = Boolean(selected?.can_edit || selected?.can_add);

  if (!catalog) return <section className="surface dropdown-initial" aria-busy={loading}>
    {loading ? <LoadingState label="Loading dropdown fields" />
      : <><IconAlertCircle aria-hidden="true" /><h2>Dropdown values are unavailable</h2><p role="alert">{loadError}</p><button className="secondary-button" type="button" onClick={() => void load()}>Try again</button></>}
  </section>;
  return <div className="dropdown-workspace">
    <div className="dropdown-summary"><span><IconListDetails size={19} aria-hidden="true" /><strong>{fields.length}</strong> fields</span><span><strong>{fields.filter(field => field.can_edit || field.can_add).length}</strong> configurable here</span>
      <span className="dropdown-summary-meta">Revision {catalog.revision}{catalog.updated_at && Number.isFinite(Date.parse(catalog.updated_at)) ? ` · Saved ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(catalog.updated_at))}` : " · Built-in defaults"}</span></div>
    {loadError ? <div className="dropdown-notice is-error" role="alert"><IconAlertCircle size={19} aria-hidden="true" /><div><strong>Latest values could not be loaded</strong><p>{loadError} Your draft is retained.</p></div><button type="button" className="secondary-button" disabled={loading} onClick={() => void load(saveError?.conflict ? selected?.key : undefined)}>Try again</button></div> : null}
    <div className="dropdown-layout">
      <aside className="surface dropdown-fields" aria-label="Dropdown field catalog">
        <div className="dropdown-field-filters"><label className="dropdown-search"><IconSearch size={17} aria-hidden="true" /><input aria-label="Search dropdown fields" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a field or workflow" /></label>
          <label className="dropdown-group-filter">Product area<select aria-label="Filter fields by product area" value={group} onChange={event => setGroup(event.target.value)}><option value="all">All areas</option>{groups.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div>
        <nav className="dropdown-field-list" aria-label="Dropdown fields">{groups.filter(item => visible.some(field => field.group === item)).map(item => <div className="dropdown-field-group" key={item}><h2>{item}</h2>{visible.filter(field => field.group === item).map(field => <button type="button" key={field.key} className={selected?.key === field.key ? "dropdown-field active" : "dropdown-field"} aria-current={selected?.key === field.key ? "true" : undefined} disabled={saving} onClick={() => { setSelectedKey(field.key); setAnnouncement(""); if (window.innerWidth < 760) window.requestAnimationFrame(() => heading.current?.scrollIntoView({ block: "start", behavior: "auto" })); }}>
          <span><strong>{field.label}{drafts[field.key] ? <i className="dropdown-unsaved-dot" aria-label="Unsaved changes" /> : null}</strong><small>{kindLabel[field.kind]} · {field.kind === "records" ? "From workspace" : `${field.options.length} values`}</small></span><IconChevronRight size={16} aria-hidden="true" />
        </button>)}</div>)}</nav>
        {!visible.length ? <div className="dropdown-no-fields"><IconSearch size={22} aria-hidden="true" /><strong>No matching fields</strong><p>Try another name or product area.</p><button className="text-button" type="button" onClick={() => { setSearch(""); setGroup("all"); }}>Clear filters</button></div> : <div className="dropdown-field-count">{visible.length} of {fields.length} fields</div>}
      </aside>
      {selected && draft ? <section className="surface dropdown-editor" aria-labelledby="dropdown-field-heading" aria-busy={saving}>
        <header className="dropdown-editor-header"><div><span className={`dropdown-kind ${editable ? "is-editable" : ""}`}>{!editable ? <IconLock size={13} aria-hidden="true" /> : null}{kindLabel[selected.kind]}</span><h2 id="dropdown-field-heading" ref={heading}>{selected.label}</h2><p>{selected.description}</p></div>
          {selected.can_add ? <button className="secondary-button" type="button" disabled={saving || draft.options.length >= 200} onClick={() => {
            const id = `new-${++optionCounter.current}`; focusOption.current = id;
            change(current => ({ ...current, options: [...current.options, { id, value: "", label: "", description: "", active: true, builtin: false, added: true }] }));
          }}><IconPlus size={17} aria-hidden="true" />Add value</button> : null}</header>
        <div className="dropdown-usage"><span>Used in {selected.usage.length} {selected.usage.length === 1 ? "place" : "places"}</span>{selected.usage.map((usage, index) => <a key={`${usage.path}-${index}`} href={workspaceUrl(usage.path)} target="_blank" rel="noreferrer">{usage.label}<IconExternalLink size={12} aria-hidden="true" /></a>)}</div>
        {saveError?.key === selected.key ? <div className="dropdown-notice is-error" role="alert"><IconAlertCircle size={19} aria-hidden="true" /><div><strong>{saveError.conflict ? "Review the latest saved version" : "Changes were not saved"}</strong><p>{saveError.text}</p></div>{saveError.conflict ? <button type="button" className="secondary-button" disabled={loading || saving} onClick={() => void load(selected.key)}>{loading ? "Reloading…" : "Reload saved values"}</button> : null}</div> : null}
        {!editable ? <div className="dropdown-notice"><IconLock size={19} aria-hidden="true" /><div><strong>{selected.kind === "records" ? "Managed in the workspace" : "Part of the product workflow"}</strong><p>{selected.reason || "These choices are managed by their source and cannot be changed here."}</p>
          {selected.manage_path ? <a className="dropdown-manage-link" href={workspaceUrl(selected.manage_path)} target="_blank" rel="noreferrer">Open {selected.label.toLowerCase()}<IconExternalLink size={14} aria-hidden="true" /></a> : null}</div></div> : <p className="dropdown-edit-guidance">{selected.kind === "suggestions" ? "Suggestions help people choose consistent values. " : "Choose which values people can select. "}Deactivate saved values to retain existing records. Stored values stay unchanged after saving.</p>}
        {selected.supports_default ? <div className="dropdown-default"><label htmlFor="dropdown-default">Default for new records</label><select id="dropdown-default" required value={draft.default_value || ""} disabled={!selected.can_edit || saving} onChange={event => change(current => ({ ...current, default_value: event.target.value || null }))}><option value="" disabled>Select an active default</option>{draft.options.filter(option => option.active && option.value).map(option => <option key={option.id} value={option.value}>{option.label || option.value}</option>)}</select></div> : null}
        {draft.options.length ? <ol className="dropdown-options">{draft.options.map((option, index) => {
          const canEdit = !saving && (selected.can_edit || option.added);
          return <li key={option.id} className={`dropdown-option ${option.active ? "" : "is-inactive"}`}>
            <div className="dropdown-option-order"><span aria-label={`Position ${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>{selected.can_edit || option.added ? <div><button type="button" className="dropdown-icon-button" aria-label={`Move ${option.label || "new value"} up`} disabled={saving || index === 0} onClick={() => move(option.id, -1)}><IconArrowUp size={16} /></button><button type="button" className="dropdown-icon-button" aria-label={`Move ${option.label || "new value"} down`} disabled={saving || index === draft.options.length - 1} onClick={() => move(option.id, 1)}><IconArrowDown size={16} /></button></div> : null}</div>
            <div className="dropdown-option-main">{editable ? <label htmlFor={`option-label-${option.id}`}>Display label<input id={`option-label-${option.id}`} ref={element => { if (focusOption.current === option.id) newOptionInput.current = element; }} value={option.label} maxLength={120} disabled={!canEdit} placeholder="e.g. Performance" onChange={event => updateOption(option.id, { label: event.target.value, ...(option.added && !option.codeEdited ? { value: codeFromLabel(event.target.value, selected.value_format) } : {}) })} /></label> : <strong className="dropdown-readonly-label">{option.label}</strong>}
              {option.added ? <div className="dropdown-new-code"><label htmlFor={`option-code-${option.id}`}>Stored {selected.value_format === "slug" ? "code" : "value"}</label><input id={`option-code-${option.id}`} aria-describedby={`option-code-help-${option.id}`} value={option.value} disabled={saving} maxLength={120} inputMode={selected.value_format === "integer" ? "numeric" : "text"} onChange={event => updateOption(option.id, { value: event.target.value, codeEdited: true })} /><small id={`option-code-help-${option.id}`}>{selected.value_format === "integer" ? "Whole number from 1 to 999." : selected.value_format === "slug" ? "Lowercase letters, numbers, underscores or hyphens; start with a letter." : "Stored exactly as entered, without surrounding spaces."} Fixed after saving.</small></div> : <div className="dropdown-stored-value"><span>Stored value</span><code>{option.value}</code>{option.builtin ? <small>Built-in</small> : null}{draft.default_value === option.value ? <small className="is-default">Default</small> : null}</div>}
              {editable ? <label className="dropdown-option-description" htmlFor={`option-description-${option.id}`}>Description <span>optional</span><textarea id={`option-description-${option.id}`} rows={2} maxLength={500} value={option.description} disabled={!canEdit} placeholder="Help administrators understand this choice" onChange={event => updateOption(option.id, { description: event.target.value })} /></label> : option.description ? <p>{option.description}</p> : null}</div>
            <div className="dropdown-option-state">{editable ? <label className="dropdown-active-control"><input type="checkbox" checked={option.active} disabled={!canEdit} onChange={event => change(current => ({ ...current, default_value: !event.target.checked && current.default_value === option.value ? null : current.default_value,
                options: current.options.map(item => item.id === option.id ? { ...item, active: event.target.checked } : item) }))} /><span>{option.active ? "Active" : "Inactive"}</span></label> : <span className={`dropdown-state-badge ${option.active ? "active" : ""}`}>{option.active ? "Active" : "Inactive"}</span>}
              {option.added ? <button className="dropdown-remove-new" type="button" disabled={saving} aria-label={`Remove unsaved ${option.label || "value"}`} onClick={() => change(current => ({ ...current, default_value: current.default_value === option.value ? null : current.default_value, options: current.options.filter(item => item.id !== option.id) }))}><IconX size={14} aria-hidden="true" />Remove</button> : !option.active ? <small>Retained in history</small> : null}</div>
          </li>;
        })}</ol> : <div className="dropdown-empty-values"><IconListDetails size={27} aria-hidden="true" /><h3>{selected.kind === "records" ? "Choices come from existing records" : "No values yet"}</h3><p>{selected.kind === "records" ? "Use the workspace link above to manage the records behind this field." : selected.can_add ? "Add the first value to give this field a consistent set of choices." : "There are no choices to display for this field."}</p></div>}
        {errors.length ? <div className="dropdown-validation" role="alert"><strong>Review your changes</strong><ul>{errors.slice(0, 6).map((error, index) => <li key={index}>{error}</li>)}</ul></div> : null}
        {editable ? <footer className="dropdown-savebar"><div><span className={currentDirty ? "is-dirty" : "is-saved"}>{currentDirty ? <i /> : <IconCheck size={16} aria-hidden="true" />}{currentDirty ? "Unsaved changes" : "All changes saved"}</span><small>{dirtyCount > 1 ? `${dirtyCount} fields have drafts. Save each field separately.` : `${draft.options.filter(option => option.active).length} active · ${draft.options.length} total values`}</small></div><div><button type="button" className="secondary-button" disabled={!currentDirty || saving} onClick={() => { setDrafts(current => { const next = { ...current }; delete next[selected.key]; return next; }); setSaveError(null); setAnnouncement("Changes to this field discarded."); }}>Cancel changes</button><button type="button" className="primary-button" disabled={!currentDirty || saving || Boolean(errors.length) || (saveError?.key === selected.key && saveError.conflict)} onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</button></div></footer> : null}
      </section> : <section className="surface dropdown-initial"><IconListDetails size={30} aria-hidden="true" /><h2>No dropdown fields available</h2><p>The catalog does not contain any fields for this instance.</p><button type="button" className="secondary-button" onClick={() => void load()}>Reload catalog</button></section>}
    </div><div className="dropdown-announcement" aria-live="polite" role="status">{announcement}</div>
  </div>;
}
