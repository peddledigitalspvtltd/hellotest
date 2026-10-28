import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconChevronDown, IconFilter, IconSearch, IconX } from '@tabler/icons-react';

import fields from '@hellotest/platform/shared/agentEvidenceScopeFields.json';
import { agenticApi, type AgentEvidenceScopeOption } from '../api.client';

/** Record IDs are committed only after choosing a permitted, server-scoped result. */
export function AgentEvidenceScope({ projectId, appTypeId, scopes, values, onChange, disabled, readOnlyFields = [] }: {
  projectId: string; appTypeId?: string; readOnlyFields?: string[];
  scopes: string[]; values: Record<string, unknown>; onChange: (key: string, value: string) => void; disabled?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const triggerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fieldRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [open, setOpen] = useState(false);
  const [activeField, setActiveField] = useState('');
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<AgentEvidenceScopeOption[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 400, maxHeight: 500 });
  const visible = fields.filter(field => field.scopes.some(scope => scopes.includes(scope)) || String(values[field.key] || '').trim());
  const selected = visible.filter(field => String(values[field.key] || '').trim()).length;
  const selection = Object.fromEntries(fields.map(field => [field.key, String(values[field.key] || '').trim()]).filter(([, value]) => value));
  const selectionKey = JSON.stringify(selection);
  const active = visible.find(field => field.key === activeField);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false); setActiveField(''); setSearch('');
    if (restoreFocus) triggerRef.current?.focus();
  }, []);
  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(420, window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const useAbove = below < 320 && above > below;
    const maxHeight = Math.max(80, Math.min(580, window.innerHeight - 16, useAbove ? above : below));
    const height = Math.min(menuRef.current?.offsetHeight || maxHeight, maxHeight);
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: useAbove ? Math.max(8, rect.top - height - 6) : Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8)), width, maxHeight });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, activeField, options.length, loading, error, place]);
  useEffect(() => { close(); }, [projectId, appTypeId, disabled, close]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
    };
    const focusOutside = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
    };
    const scroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) place(); };
    const resize = new ResizeObserver(place);
    if (menuRef.current) resize.observe(menuRef.current);
    place();
    const frame = requestAnimationFrame(() => { place(); menuRef.current?.focus({ preventScroll: true }); });
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', focusOutside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    return () => {
      cancelAnimationFrame(frame); resize.disconnect();
      document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focusOutside);
      window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true);
    };
  }, [open, close, place]);
  useEffect(() => {
    if (!open || !active || readOnlyFields.includes(activeField) || !projectId) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setOptions([]); setHasMore(false); setActiveIndex(0);
    const timer = window.setTimeout(() => {
      void agenticApi.evidenceScope.options({ project_id: projectId, app_type_id: appTypeId || undefined, field: activeField, search: search.trim(), limit: 10, ...JSON.parse(selectionKey) }, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) { setOptions(result.items.slice(0, 10)); setHasMore(result.has_more); } })
        .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Available records could not be loaded.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, search ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, active?.key, activeField, projectId, appTypeId, search, selectionKey, retry]);
  useEffect(() => { if (activeField) searchRef.current?.focus({ preventScroll: true }); }, [activeField]);
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>(`[role="option"].is-active`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const choose = (option: AgentEvidenceScopeOption) => {
    if (!active || disabled || readOnlyFields.includes(activeField)) return;
    onChange(activeField, option.id); setActiveField(''); setSearch(''); fieldRefs.current[activeField]?.focus();
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
  };
  return <details className="agent-command-evidence-scope" open={open} onKeyDown={escape}>
    <summary ref={triggerRef} id={`evidence-trigger-${id}`} data-dialog-popover-owner={`evidence-trigger-${id}`} aria-controls={open ? `evidence-scope-${id}` : undefined} aria-expanded={open} aria-haspopup="dialog" aria-disabled={disabled} onClick={event => { event.preventDefault(); if (!disabled) { place(); setOpen(current => !current); setActiveField(''); setSearch(''); } }}><IconFilter size={15} aria-hidden="true" /><span>Evidence scope{selected ? ` (${selected})` : ''}</span><IconChevronDown size={13} aria-hidden="true" /></summary>
    {open && createPortal(<div className="agent-command-evidence-scope__menu" data-dialog-popover-owner={`evidence-trigger-${id}`} id={`evidence-scope-${id}`} ref={menuRef} role="dialog" aria-label="Evidence scope" tabIndex={-1} style={position} onKeyDown={escape}>
      <header className="agent-evidence-scope-heading"><strong>Evidence scope</strong><button type="button" onClick={() => close(true)} aria-label="Close evidence scope"><IconX size={16} /></button></header>
      <p>Select exact records. The agent will use only evidence and linked knowledge within every selected filter.</p>
      {!projectId && <p role="status">Select a project to browse available records.</p>}
      <div className="agent-evidence-scope-fields">{visible.map(field => {
        const value = String(values[field.key] ?? '');
        const readOnly = readOnlyFields.includes(field.key);
        const expanded = activeField === field.key;
        const listId = `evidence-${id}-${field.key}`;
        return <section className="agent-evidence-scope-field" key={field.key}>
          <div className="agent-evidence-scope-field-row">
            <button className="agent-evidence-scope-field-trigger" type="button" ref={element => { fieldRefs.current[field.key] = element; }} disabled={disabled || readOnly || !projectId} aria-label={`${field.label}: ${value || 'Any'}`} aria-expanded={expanded} aria-controls={expanded ? `${listId}-picker` : undefined} onClick={() => { setActiveField(expanded ? '' : field.key); setSearch(''); setOptions([]); setError(''); setActiveIndex(0); }}>
              <span>{field.label}{readOnly ? <small>Linked to this task</small> : null}</span><span className="agent-evidence-scope-value" title={value}>{value || 'Any'}</span>{!readOnly && <IconChevronDown aria-hidden="true" size={14} />}
            </button>
            {value && !readOnly && <button className="agent-evidence-scope-clear" type="button" disabled={disabled} aria-label={`Clear ${field.label}`} onClick={() => { onChange(field.key, ''); setSearch(''); }}><IconX aria-hidden="true" size={14} /></button>}
          </div>
          {expanded && <div className="agent-evidence-scope-picker" id={`${listId}-picker`}>
            <label className="agent-evidence-scope-search"><IconSearch size={16} aria-hidden="true" /><input ref={searchRef} aria-label={`Search ${field.label}`} placeholder="Search by ID or name…" value={search} maxLength={255} onChange={event => setSearch(event.target.value)} autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={!loading && options[activeIndex] ? `${listId}-${activeIndex}` : undefined} onKeyDown={event => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => options.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : 0); }
              if (event.key === 'Enter') { event.preventDefault(); if (!loading && options[activeIndex]) choose(options[activeIndex]); }
            }} /></label>
            {loading ? <p className="agent-evidence-scope-status" role="status">Loading available records…</p> : error ? <div className="agent-evidence-scope-status" role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : <>
              <div className="agent-evidence-scope-options" role="listbox" id={listId} aria-label={`Available ${field.label} records`}>{options.map((option, index) => <button type="button" role="option" id={`${listId}-${index}`} key={option.id} aria-selected={value === option.id} className={activeIndex === index ? 'is-active' : ''} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)}><span><strong>{option.label}</strong>{option.label !== option.id && <code>{option.id}</code>}{option.description && <small>{option.description}</small>}</span>{value === option.id && <IconCheck aria-hidden="true" size={16} />}</button>)}</div>
              {!options.length && <p className="agent-evidence-scope-status" role="status">{search ? 'No matching records in this scope. Try another ID or name.' : 'No available records match the selected scope.'}</p>}
              {hasMore && <p className="agent-evidence-scope-status">Showing the first 10 records. Search by ID or name to narrow the list.</p>}
            </>}
          </div>}
        </section>;
      })}</div>
      {!visible.length && <p>Select a project context source to narrow its evidence.</p>}
    </div>, document.body)}
  </details>;
}
