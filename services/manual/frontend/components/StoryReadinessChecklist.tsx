import { useState } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconChecklist, IconCircleDashed, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { Requirement } from '@hellotest/platform/frontend/src/types';
import { manualApi } from "../api.client";
import { platformApi } from "@hellotest/platform/frontend/api.client";
import { deriveStoryReadiness, storyReadinessMethodology, type StoryReadinessCheck } from '../lib/storyReadiness';
import { useDialogFocus } from '@hellotest/platform/frontend/src/shared/hooks/useDialogFocus';
import { DialogCloseButton } from '@hellotest/platform/frontend/src/shared/components/DialogCloseButton';
import { useAiPromptRegistry } from '@hellotest/integration/frontend/hooks/useAiPromptRegistry';
import { MetricMethodologyInfo } from '@hellotest/ai/frontend/components/MetricMethodologyInfo';
import './StoryReadinessChecklist.css';

type StoryReadinessChecklistProps = {
  story:Requirement; canEdit:boolean; canViewAttachments:boolean; onSaved:() => Promise<unknown>;
};

export function StoryReadinessChecklist({ story, canEdit, canViewAttachments, onSaved, expanded = false, onPendingChange }: StoryReadinessChecklistProps & {
  expanded?:boolean; onPendingChange?:(pending:boolean) => void;
}) {
  const readiness = deriveStoryReadiness(story);
  const { getMetricCriteria } = useAiPromptRegistry();
  const metricKey = `metric.story.${readiness.mode}_readiness`;
  const [editing, setEditing] = useState<StoryReadinessCheck|null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const attachments = useQuery({
    queryKey:['story-readiness-attachments',story.project_id,story.id],
    queryFn:() => platformApi.attachments.list({ project_id:story.project_id,entity_type:'requirement',entity_id:story.id }),
    enabled:Boolean(editing?.key === 'wireframe' && canViewAttachments)
  });
  const save = async () => {
    if (!editing || pending) return;
    setPending(true); onPendingChange?.(true); setError('');
    try {
      await manualApi.requirements.updateReadiness(story.id, {
        expected_revision:story.revision || 1,
        checks:{ [editing.key]:{ status:editing.status,evidence:editing.evidence, ...(editing.attachment_id ? { attachment_id:editing.attachment_id } : {}) } }
      });
      await onSaved(); setEditing(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Readiness review could not be saved.'); }
    finally { setPending(false); onPendingChange?.(false); }
  };
  const content = <>
    <p>{storyReadinessMethodology} <MetricMethodologyInfo criteriaKey={metricKey} organizationCriteria={getMetricCriteria(metricKey)} /></p>
    <ul>
      {readiness.checks.map(check => <li className={`is-${check.status}`} key={check.key}>
        <div className="story-readiness-check-heading"><span aria-hidden="true" className="story-readiness-check-icon">{check.status === 'met' ? <IconCheck size={17} /> : check.status === 'not_met' ? <IconX size={17} /> : <IconCircleDashed size={17} />}</span><strong>{check.label}</strong><span className={`story-readiness-status is-${check.status}`}>{check.status === 'met' ? 'Met' : check.status === 'not_met' ? 'Not Met' : 'Unverified'}</span></div>
        <p>{check.evidence}</p>
        {check.verified_at ? <small>Reviewed by {check.verified_by} · {new Date(check.verified_at).toLocaleString()}</small> : null}
        {check.key === 'critical_defects' ? <small>Calculated from linked Defects in the saved Story.</small> : canEdit ? <button className="ghost-button compact" disabled={pending} onClick={() => { setEditing({ ...check,evidence:check.source === 'review' ? check.evidence : '' }); setError(''); }} type="button">Review {check.label}</button> : null}
      </li>)}
    </ul>
    {editing ? <form className="form-grid" onSubmit={event => { event.preventDefault(); void save(); }}>
      <h3>Review {editing.label}</h3>
      <p>Record the actual evidence or reviewer confirmation. These checks are not automatically verified by a source-control or CI provider.</p>
      <label>Review Status<select autoFocus aria-label="Review Status" disabled={pending} value={editing.status} onChange={event => setEditing({ ...editing,status:event.target.value as StoryReadinessCheck['status'] })}>
        <option value="unverified">Unverified</option><option value="met">Met</option><option value="not_met">Not Met</option>
      </select></label>
      <label>Evidence Note<textarea aria-label="Evidence Note" disabled={pending} maxLength={2000} required={editing.status !== 'unverified'} value={editing.evidence} onChange={event => setEditing({ ...editing,evidence:event.target.value })} placeholder={editing.key === 'story_points' ? 'Story points and team agreement, including the refinement decision.' : editing.key === 'product_owner' ? 'Product Owner name and the sign-off reference or decision.' : 'Describe the verified evidence and include the relevant reference.'} /></label>
      {editing.key === 'wireframe' ? <label>Attached Wireframe<select aria-label="Attached Wireframe" disabled={pending || !canViewAttachments || attachments.isPending} required={editing.status === 'met'} value={editing.attachment_id || ''} onChange={event => setEditing({ ...editing,attachment_id:event.target.value })}>
        <option value="">Select a Story attachment</option>
        {(attachments.data || []).map(attachment => <option key={attachment.id} value={attachment.id}>{attachment.filename}</option>)}
      </select>{!canViewAttachments ? <small>Attachment access is required to select the saved wireframe.</small> : <small>Upload a wireframe in Attachments first, then select it here.</small>}</label> : null}
      {attachments.isError && editing.key === 'wireframe' ? <p role="alert">Story attachments could not be loaded.</p> : null}
      {error ? <p role="alert" className="error-message">{error}</p> : null}
      <div className="action-row"><button className="primary-button" disabled={pending || (editing.key === 'wireframe' && editing.status === 'met' && (!canViewAttachments || !editing.attachment_id))} type="submit">{pending ? 'Saving Review…' : 'Save Review'}</button><button className="ghost-button" disabled={pending} onClick={() => setEditing(null)} type="button">Cancel</button></div>
    </form> : null}
  </>;
  return expanded ? <section className="story-readiness-checklist is-expanded" aria-label={`${readiness.label} checks`}>{content}</section> : <details className="story-readiness-checklist" key={`${story.id}:${readiness.mode}`}><summary>{readiness.label}: {readiness.met} of {readiness.total} Checks Met · {readiness.total - readiness.known} Unverified</summary>{content}</details>;
}

export function StoryReadinessReviewDialog({ story, canEdit, canViewAttachments, onSaved, onClose }: StoryReadinessChecklistProps & { onClose:() => void }) {
  const readiness = deriveStoryReadiness(story);
  const [pending, setPending] = useState(false);
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose, closeDisabled:pending });
  const unmet = readiness.known - readiness.met;
  const dialog = <div className="modal-backdrop story-readiness-review-backdrop" onClick={() => { if (!pending) onClose(); }} role="presentation">
    <div aria-labelledby="story-readiness-review-title" aria-describedby="story-readiness-review-summary" aria-modal="true" className="modal-card story-readiness-review-dialog" onClick={event => event.stopPropagation()} ref={dialogRef} role="dialog" tabIndex={-1}>
      <header className="story-readiness-review-header"><span className="story-readiness-review-icon" aria-hidden="true"><IconChecklist size={23} /></span><div><h2 id="story-readiness-review-title">{readiness.label}</h2><p>{story.display_id ? `${story.display_id} · ` : ''}{story.title}</p></div><DialogCloseButton disabled={pending} label="Close Story readiness review" onClick={onClose} /></header>
      <div className="story-readiness-review-content">
        <section className="story-readiness-review-summary" aria-label="Readiness summary"><strong id="story-readiness-review-summary">{readiness.label}: {readiness.met} of {readiness.total} Checks Met · {readiness.total - readiness.known} Unverified</strong><div className="story-readiness-review-progress" role="progressbar" aria-label="Checks met" aria-valuemin={0} aria-valuemax={readiness.total} aria-valuenow={readiness.met}>{readiness.checks.map(check => <span key={check.key} className={`is-${check.status}`} />)}</div><span>{readiness.score === null ? 'Evidence is unavailable.' : `${readiness.score}% Ready`}{unmet ? ` · ${unmet} Check${unmet === 1 ? '' : 's'} Not Met` : ''}{!canEdit ? ' · View Only' : ''}</span></section>
        <StoryReadinessChecklist story={story} canEdit={canEdit} canViewAttachments={canViewAttachments} onSaved={onSaved} expanded onPendingChange={setPending} />
      </div>
      <footer className="story-readiness-review-footer"><span>Based on the saved Story and linked evidence.</span><button className="ghost-button" disabled={pending} onClick={onClose} type="button">Close</button></footer>
    </div>
  </div>;
  return typeof document !== 'undefined' ? createPortal(dialog, document.body) : dialog;
}
