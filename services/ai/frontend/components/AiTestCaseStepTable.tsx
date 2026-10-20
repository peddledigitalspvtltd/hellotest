import { useRef, useState } from 'react';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react';
import './TestCaseAiStudioModal.css';

type Step = { action?: string | null; expected_result?: string | null; step_order?: number };
/** Shared by Test Case Generator and Agent Studio so drafts have the same editor. */
export function AiTestCaseStepTable<T extends Step>({ steps, editing, onChange, newStep, disabled = false }: {
  steps: T[]; editing: boolean; disabled?: boolean; onChange: (steps: T[]) => void; newStep: () => T;
}) {
  const tableRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const commit = (next: T[]) => onChange(next.map((step, index) => 'step_order' in step ? { ...step, step_order: index + 1 } : step));
  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (disabled || target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
    setAnnouncement(`Step ${index + 1} moved to position ${target + 1} of ${steps.length}.`);
    // Follow the moved instruction, including when its arrow reaches a boundary.
    window.requestAnimationFrame(() => tableRef.current?.querySelector<HTMLTextAreaElement>(`[data-step-index="${target}"] textarea`)?.focus());
  };
  return <div className={`ai-test-generator-step-table ai-test-case-step-editor${editing ? ' is-editing' : ''}`} ref={tableRef}>
    <div className="ai-test-generator-step-table__head" aria-hidden="true"><span>Step</span><span>Action</span><span>Expected result</span><span>{editing ? 'Order / remove' : ''}</span></div>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    {steps.map((step, index) => <div className="ai-test-generator-step-row" role="group" aria-label={`Step ${index + 1}`} data-step-index={index} key={index}><span className="ai-test-case-step-number" aria-hidden="true">{index + 1}</span>
      <label className="ai-test-case-step-field"><span>Action</span>{editing ? <textarea data-ai-auto-size disabled={disabled} aria-label={`Step ${index + 1} action`} rows={2} value={step.action || ''} onChange={event => commit(steps.map((item, i) => i === index ? { ...item, action: event.target.value } : item))} /> : <p>{step.action || 'Add an action'}</p>}</label>
      <label className="ai-test-case-step-field"><span>Expected result</span>{editing ? <textarea data-ai-auto-size disabled={disabled} aria-label={`Step ${index + 1} expected result`} rows={2} value={step.expected_result || ''} onChange={event => commit(steps.map((item, i) => i === index ? { ...item, expected_result: event.target.value } : item))} /> : <p>{step.expected_result || 'Add an expected result'}</p>}</label>
      {editing ? <div className="ai-test-case-step-actions" role="group" aria-label={`Step ${index + 1} actions`}>
        <button disabled={disabled || index === 0} aria-label={`Move step ${index + 1} up`} title="Move step up" type="button" onClick={() => moveStep(index, -1)}><IconArrowUp size={16} /></button>
        <button disabled={disabled || index === steps.length - 1} aria-label={`Move step ${index + 1} down`} title="Move step down" type="button" onClick={() => moveStep(index, 1)}><IconArrowDown size={16} /></button>
        <button disabled={disabled} aria-label={`Remove step ${index + 1}`} title="Remove step" type="button" onClick={() => { commit(steps.filter((_, i) => i !== index)); setAnnouncement(`Step ${index + 1} removed.`); }}><IconTrash size={15} /></button>
      </div> : <span />}
    </div>)}
    {editing ? <button disabled={disabled || steps.length >= 30} className="ai-test-generator-add-step" type="button" onClick={() => commit([...steps, newStep()])}><IconPlus size={16} />Add step</button> : null}
  </div>;
}
