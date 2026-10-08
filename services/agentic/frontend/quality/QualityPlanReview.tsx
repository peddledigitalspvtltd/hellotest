import { IconArrowRight, IconCheck, IconPlus, IconShieldCheck, IconTrash } from '@tabler/icons-react';
import type { QualityAgentPlan, QualityJourneyStep } from '../lib/qualityAgentContracts';
import { ContextSelect } from '@hellotest/platform/frontend/src/shared/components/ContextSelect';
import { QUALITY_AGENT_EXPERIENCES } from '../lib/qualityAgentExperience';

export { qualityPlanIssues } from '../lib/qualityPlanValidation';
import { qualityPlanIssues } from '../lib/qualityPlanValidation';

export function QualityPlanReview({ plan, checks, reviewed, busy, onReview, onChange, onExecute, onDismiss }: {
  plan: QualityAgentPlan; checks: string[]; reviewed: boolean; busy: boolean; onReview: (value: boolean) => void;
  onChange: (plan: QualityAgentPlan) => void; onExecute: () => void; onDismiss: () => void;
}) {
  const issues = qualityPlanIssues(plan);
  const changeStep = (index: number, patch: Partial<QualityJourneyStep>) => { onReview(false); onChange({ ...plan, steps: plan.steps.map((step, at) => at === index ? { ...step, ...patch } : step) }); };
  return <section className="quality-plan" aria-labelledby="quality-plan-title">
    <header><div><span className="quality-kicker">01 · Review the route</span><h2 id="quality-plan-title">{plan.goal || QUALITY_AGENT_EXPERIENCES[plan.kind].outcome}</h2></div><span className="quality-mode-tag">{plan.options.mission ? 'Autonomous mission' : plan.generation_mode === 'llm' ? 'Model drafted' : 'Preset plan'}</span></header>
    <div className="quality-plan-target"><code>{plan.target_url}</code><span>{plan.options.viewport?.width || 1280} × {plan.options.viewport?.height || 720} · {plan.options.max_pages || 1} page limit · {(plan.options.timeout_ms || 60000) / 1000}s</span></div>
    {plan.options.mission && <p className="quality-plan-target">Up to {plan.options.mission.max_actions} observed actions · Form submission {plan.options.mission.allow_form_submission ? "allowed for this task" : "disabled"} · Credential reference: {plan.options.credential_ref || "none"}</p>}
    <div className="quality-plan-checks" aria-label="Planned deterministic checks">{checks.map(check => <span key={check}><IconCheck size={14} />{check}</span>)}</div>
    {Boolean(plan.grounding?.length) && <details className="quality-locator-context"><summary>Saved locator context · {plan.grounding?.length}</summary><ul>{plan.grounding?.map(item => <li key={item.id}><strong>{item.name}</strong><span>{item.screen}</span><code>{item.selector}</code></li>)}</ul></details>}
    {plan.kind === 'web' && !plan.options.mission && <div className="quality-journey-editor"><div className="quality-section-heading"><h3>Browser journey</h3><button className="quality-text-button" type="button" disabled={busy || plan.steps.length >= 12} onClick={() => { onReview(false); onChange({ ...plan, steps: [...plan.steps, { action: 'assert_text', text: '' }] }); }}><IconPlus size={15} />Add step</button></div>
      {plan.steps.length ? <ol>{plan.steps.map((step, index) => <li key={index}>
        <span className="quality-journey-number">{String(index + 1).padStart(2, '0')}</span>
        <div className="quality-journey-fields"><ContextSelect label={`Step ${index + 1} action`} aria-label={`Step ${index + 1} action`} disabled={busy} value={step.action} onChange={event => changeStep(index, { action: event.target.value as QualityJourneyStep['action'] })}>{[['click', 'Click element'], ['fill', 'Fill field'], ['assert_text', 'Check text'], ['assert_url', 'Check URL']].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</ContextSelect>
          {['click', 'fill'].includes(step.action) || step.action === 'assert_text' ? <input aria-label={`Step ${index + 1} selector`} disabled={busy} maxLength={240} value={step.selector || ''} onChange={event => changeStep(index, { selector: event.target.value })} placeholder={step.action === 'assert_text' ? 'Selector · optional, defaults to body' : 'Element selector'} /> : null}
          {step.action === 'fill' ? <input aria-label={`Step ${index + 1} value`} disabled={busy} maxLength={500} value={step.value || ''} onChange={event => changeStep(index, { value: event.target.value })} placeholder="Field value · no credentials" /> : step.action === 'assert_text' ? <input aria-label={`Step ${index + 1} expected text`} disabled={busy} maxLength={500} value={step.text || ''} onChange={event => changeStep(index, { text: event.target.value })} placeholder="Expected visible text" /> : step.action === 'assert_url' ? <input aria-label={`Step ${index + 1} expected URL`} disabled={busy} maxLength={2000} value={step.url || ''} onChange={event => changeStep(index, { url: event.target.value })} placeholder="Expected URL on this origin" /> : null}
        </div><button type="button" className="quality-icon-button" disabled={busy} aria-label={`Remove step ${index + 1}`} onClick={() => { onReview(false); onChange({ ...plan, steps: plan.steps.filter((_, at) => at !== index) }); }}><IconTrash size={16} /></button>
      </li>)}</ol> : <p className="quality-journey-empty">Add explicit steps for this goal. The browser does not infer interactions at execution time.</p>}
    </div>}
    {plan.limitations.length > 0 && <details className="quality-limitations"><summary>Scope & limitations <span>{plan.limitations.length}</span></summary><ul>{plan.limitations.map(value => <li key={value}>{value}</li>)}</ul></details>}
    {issues.length > 0 && <p className="quality-plan-issue" role="status">{issues[0]}</p>}
    <footer className="quality-plan-actions"><label className="quality-approval-check"><input type="checkbox" disabled={busy || issues.length > 0} checked={reviewed} onChange={event => onReview(event.target.checked)} /><span><IconShieldCheck size={15} />I reviewed this plan and its scope.</span></label><div><button type="button" className="quality-text-button" disabled={busy} onClick={onDismiss}>Adjust goal</button><button type="button" className="quality-primary-button" disabled={busy || !reviewed || issues.length > 0} onClick={onExecute}>{busy ? 'Starting…' : 'Run reviewed plan'}<IconArrowRight size={19} /></button></div></footer>
  </section>;
}
