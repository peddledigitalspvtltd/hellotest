import { useEffect, useRef } from 'react';
import { IconChevronDown, IconFilter } from '@tabler/icons-react';

import fields from '@hellotest/platform/shared/agentEvidenceScopeFields.json';

export function AgentEvidenceScope({ scopes, values, onChange, disabled, readOnlyFields = [] }: {
  readOnlyFields?: string[];
  scopes: string[]; values: Record<string, unknown>; onChange: (key: string, value: string) => void; disabled?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) ref.current?.removeAttribute('open'); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const visible = fields.filter(field => field.scopes.some(scope => scopes.includes(scope)));
  const selected = visible.filter(field => String(values[field.key] || '').trim()).length;
  return <details ref={ref} className="agent-command-evidence-scope" onKeyDown={event => {
    if (event.key === 'Escape') { ref.current?.removeAttribute('open'); ref.current?.querySelector('summary')?.focus(); }
  }} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) ref.current?.removeAttribute('open'); }}>
    <summary><IconFilter size={15} aria-hidden="true" /><span>Evidence scope{selected ? ` (${selected})` : ''}</span><IconChevronDown size={13} aria-hidden="true" /></summary>
    <div className="agent-command-evidence-scope__menu"><p>Narrow the selected context sources to exact records. Unavailable records remain evidence gaps.</p>
      {visible.map(field => <label key={field.key}><span>{field.label}</span><input readOnly={readOnlyFields.includes(field.key)} disabled={disabled} maxLength={255} value={String(values[field.key] ?? '')} onChange={event => onChange(field.key, event.target.value)} /></label>)}
      {!visible.length && <p>Select a project context source to narrow its evidence.</p>}
    </div>
  </details>;
}
