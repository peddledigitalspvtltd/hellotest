import { IconPlus, IconTrash } from '@tabler/icons-react';
import './TestCaseAiStudioModal.css';

type Step = { action?: string | null; expected_result?: string | null };
/** Shared by Test Case Generator and Agent Studio so drafts have the same editor. */
export function AiTestCaseStepTable<T extends Step>({ steps, editing, onChange, newStep, disabled = false }: {
  steps: T[]; editing: boolean; disabled?: boolean; onChange: (steps: T[]) => void; newStep: () => T;
}) {
  return <div className="ai-test-generator-step-table"><div className="ai-test-generator-step-table__head"><span>Step</span><span>Action</span><span>Expected Result</span><span /></div>
    {steps.map((step, index) => <div className="ai-test-generator-step-row" key={index}><span>{index + 1}</span>
      {editing ? <textarea data-ai-auto-size disabled={disabled} aria-label={`Step ${index + 1} action`} rows={2} value={step.action || ''} onChange={event => onChange(steps.map((item, i) => i === index ? { ...item, action: event.target.value } : item))} /> : <p>{step.action || 'Add an action'}</p>}
      {editing ? <textarea data-ai-auto-size disabled={disabled} aria-label={`Step ${index + 1} expected result`} rows={2} value={step.expected_result || ''} onChange={event => onChange(steps.map((item, i) => i === index ? { ...item, expected_result: event.target.value } : item))} /> : <p>{step.expected_result || 'Add an expected result'}</p>}
      {editing ? <button disabled={disabled} aria-label={`Remove step ${index + 1}`} type="button" onClick={() => onChange(steps.filter((_, i) => i !== index))}><IconTrash size={15} /></button> : <span />}
    </div>)}
    {editing ? <button disabled={disabled || steps.length >= 30} className="ai-test-generator-add-step" type="button" onClick={() => onChange([...steps, newStep()])}><IconPlus size={16} />Add step</button> : null}
  </div>;
}
