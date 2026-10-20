import { useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconArrowRight, IconCheck, IconFileText, IconShieldCheck, IconX } from '@tabler/icons-react';
import { useDialogFocus } from '@hellotest/platform/frontend/src/shared/hooks/useDialogFocus';
import { testingApi } from '@hellotest/testing/frontend/api.client';
import { ContextSelect } from '@hellotest/platform/frontend/src/shared/components/ContextSelect';
import { agenticApi } from '../api.client';
import type { QualityAgentArtifact, QualityAgentFinding, QualityAgentRun } from '../lib/qualityAgentContracts';
import { QUALITY_AGENT_EXPERIENCES } from '../lib/qualityAgentExperience';
import { QualityArtifactImage } from './QualityArtifacts';
import { agentOutputText } from '../lib/agentOutputValue';

function ReviewDialog({ title, eyebrow, onClose, busy, children, footer }: { title: string; eyebrow: string; onClose: () => void; busy: boolean; children: ReactNode; footer: ReactNode }) {
  const id = useId();
  const root = useDialogFocus<HTMLElement>({ onClose, closeDisabled: busy });
  return createPortal(<div className="quality-dialog-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="quality-review-dialog" role="dialog" aria-modal="true" aria-labelledby={id} ref={root} tabIndex={-1}>
      <header><div><span className="quality-kicker">{eyebrow}</span><h2 id={id}>{title}</h2></div><button className="quality-icon-button" type="button" aria-label={`Close ${title}`} disabled={busy} onClick={onClose}><IconX size={20} /></button></header>
      <div className="quality-review-dialog-body">{children}</div><footer>{footer}</footer>
    </section>
  </div>, document.body);
}

export function QualityBaselineReview({ run, artifact, onClose, onApproved }: { run: QualityAgentRun; artifact: QualityAgentArtifact; onClose: () => void; onApproved: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  const [label, setLabel] = useState(() => `${new URL(run.target_url).hostname} · ${run.options.viewport?.width || 'desktop'}`);
  const mutation = useMutation({ mutationFn: () => agenticApi.qualityAgents.approveBaseline(run.id, { artifact_id: artifact.id, label: label.trim() }), onSuccess: onApproved });
  return <ReviewDialog title="Review the expected visual state" eyebrow="Human approval · visual baseline" busy={mutation.isPending} onClose={onClose}
    footer={<><span className="quality-review-gate"><IconShieldCheck size={16} />Applies to future comparisons in this scope.</span><button className="quality-primary-button" type="button" disabled={!reviewed || !label.trim() || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Approving…' : 'Approve baseline'}<IconCheck size={17} /></button></>}>
    <QualityArtifactImage runId={run.id} artifact={artifact} alt="Candidate screenshot to review before promoting it to a visual baseline" />
    <div className="quality-source-receipt"><code>{run.target_url}</code><small>SHA-256 · {artifact.sha256}</small></div>
    <label className="quality-field"><span>Baseline name</span><input data-autofocus="true" maxLength={120} value={label} onChange={event => setLabel(event.target.value)} /></label>
    <label className="quality-approval-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /><span>I reviewed this screenshot and want to use it as the expected visual state.</span></label>
    {mutation.error && <p className="quality-error" role="alert">{mutation.error instanceof Error ? mutation.error.message : 'The baseline could not be approved.'}</p>}
  </ReviewDialog>;
}

export function QualityDefectDraft({ run, finding, projectId, userId, onClose }: { run: QualityAgentRun; finding: QualityAgentFinding; projectId: string; userId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(finding.title);
  const [message, setMessage] = useState(`${agentOutputText(finding.description)}\n\nObserved evidence:\n${agentOutputText(finding.evidence)}\n\nSource: ${QUALITY_AGENT_EXPERIENCES[run.kind].name}\nTarget: ${run.target_url}\nAgent run: ${run.id}`);
  const [steps, setSteps] = useState(() => {
    const observed = run.mission_report?.actions.filter(action => ['completed','passed','succeeded'].includes(action.status)).map(action => action.summary) || [];
    const journey = observed.length ? observed : (run.reviewed_plan?.steps || []).map(step => step.label || `${step.action.replace(/_/g,' ')} ${step.selector || step.url || step.text || ''}`.trim());
    return [`Open ${run.target_url}`, ...journey, `Inspect ${finding.selector || finding.category} and compare the recorded finding.`].map((value,index) => `${index + 1}. ${value}`).join('\n');
  });
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState(agentOutputText(finding.evidence));
  const [severity, setSeverity] = useState(finding.severity === 'info' ? 'low' : finding.severity);
  const [priority, setPriority] = useState('Medium');
  const mutation = useMutation({ mutationFn: () => {
    const input = { project_id: projectId, user_id: userId, title: title.trim(), message: message.trim(), steps_to_reproduce: steps.trim(), expected_result: expected.trim(), actual_result: actual.trim(), severity, priority, labels: ['quality-agent', run.kind] };
    return testingApi.issues.create(input);
  }, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['issues', projectId] }); } });
  const valid = [title, message, steps, expected, actual].every(value => value.trim().length >= 2);
  return <ReviewDialog title={mutation.data ? 'Defect saved' : 'Review a defect draft'} eyebrow="Evidence → reviewed work item" busy={mutation.isPending} onClose={onClose}
    footer={mutation.data ? <><span className="quality-review-gate"><IconCheck size={16} />{mutation.data.display_id || mutation.data.id}</span><a className="quality-primary-button" href="/issues">Open Defects<IconArrowRight size={17} /></a></> : <><span className="quality-review-gate"><IconFileText size={16} />{valid ? 'Save only after reviewing the evidence.' : 'Add expected behavior before saving.'}</span><button type="button" className="quality-primary-button" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Saving…' : 'Save defect'}<IconArrowRight size={17} /></button></>}>
    {mutation.data ? <div className="quality-output-empty"><IconCheck size={32} /><h3>{title}</h3><p>The reviewed draft was saved through the existing Defects API.</p></div> : <>
      <div className="quality-source-receipt"><span>Observed finding</span><strong>{finding.title}</strong><code>{run.target_url}</code></div>
      <label className="quality-field"><span>Defect title</span><input data-autofocus="true" maxLength={255} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <div className="quality-field"><ContextSelect label="Severity" value={severity} onChange={event => setSeverity(event.target.value as typeof severity)}>{['critical', 'high', 'medium', 'low'].map(value => <option value={value} key={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</ContextSelect></div>
      <div className="quality-field"><ContextSelect label="Priority" value={priority} onChange={event => setPriority(event.target.value)}>{['Highest','High','Medium','Low','Lowest'].map(value => <option value={value} key={value}>{value}</option>)}</ContextSelect></div>
      <label className="quality-field"><span>Description & evidence</span><textarea rows={6} value={message} onChange={event => setMessage(event.target.value)} /></label>
      <label className="quality-field"><span>Steps to reproduce</span><textarea rows={3} value={steps} onChange={event => setSteps(event.target.value)} /></label>
      <label className="quality-field"><span>Expected behavior</span><textarea rows={3} value={expected} onChange={event => setExpected(event.target.value)} placeholder="State the expected application behavior or approved requirement." /></label>
      <label className="quality-field"><span>Observed behavior</span><textarea rows={3} value={actual} onChange={event => setActual(event.target.value)} /></label>
      {mutation.error && <p className="quality-error" role="alert">{mutation.error instanceof Error ? mutation.error.message : 'The defect could not be saved.'}</p>}
    </>}
  </ReviewDialog>;
}
