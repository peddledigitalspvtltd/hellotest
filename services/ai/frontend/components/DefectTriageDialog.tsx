import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconArrowRight, IconCheck, IconSearch, IconShieldCheck, IconSparkles } from "@tabler/icons-react";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { formatDefectFieldLabel } from "@hellotest/testing/frontend/lib/defectTerminology";
import { useAiPromptRegistry } from "@hellotest/integration/frontend/hooks/useAiPromptRegistry";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import type { AiBugTriageRecommendation, AiDesignImageInput, Issue } from "@hellotest/platform/frontend/src/types";
import { AiReferenceImages } from './AiReferenceImages';
import { AiReviewControls } from "./AiReviewControls";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import "./DefectTriageDialog.css";

type Props = {
  projectId: string;
  issues: Issue[];
  canViewIntegrations: boolean;
  correctionLockedIssueId?: string;
  onClose: () => void;
  onOpenIssue: (id: string) => void;
  onApplied?: () => void;
};
const highPriority = (item: AiBugTriageRecommendation) => ["Highest", "High"].includes(item.recommended_priority);
const fieldLabel = (field: string) => field === "linked_test_case_ids" ? "Linked Test Cases" : formatDefectFieldLabel(field, field.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()));
const correctionValue = (value: string | string[]) => (Array.isArray(value) ? value.join(", ") : richTextToPlainText(value)) || "Not recorded";

export function DefectTriageDialog({ projectId, issues, canViewIntegrations, correctionLockedIssueId, onClose, onOpenIssue, onApplied }: Props) {
  const titleId = useId();
  const queryClient = useQueryClient();
  const [postedTokens, setPostedTokens] = useState<string[]>([]);
  const [approvedCorrectionToken, setApprovedCorrectionToken] = useState("");
  const save = useMutation({
    mutationFn: ({ issueId, token, corrections }: { issueId: string; token: string; corrections: boolean }) =>
      api.issues.applyAiTriage(issueId, { project_id: projectId, token, apply_corrections: corrections }),
    onSuccess: ({ corrections_applied }, { issueId, token }) => {
      setPostedTokens((tokens) => [...tokens, token]);
      void queryClient.invalidateQueries({ queryKey: ["hellotest-comments", projectId, "issue", issueId] });
      if (corrections_applied) onApplied?.();
    }
  });
  const close = () => { if (!save.isPending) onClose(); };
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose: close });
  const { getPrompt, getLlmIntegrationId, query: promptQuery } = useAiPromptRegistry();
  const [integrationId, setIntegrationId] = useState("");
  const [promptGuidance, setPromptGuidance] = useState<string>();
  const [additionalContext, setAdditionalContext] = useState("");
  const [images, setImages] = useState<AiDesignImageInput[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [submittedSettings, setSubmittedSettings] = useState("");
  const integrationsQuery = useQuery({
    queryKey: ["integrations", "llm", "defect-triage"],
    queryFn: () => api.integrations.list({ type: "llm", is_active: true }),
    enabled: canViewIntegrations
  });
  const preview = useMutation({ mutationFn: api.issues.previewAiTriage });
  const guidance = promptGuidance ?? getPrompt("ai.bug.triage");
  const settings = JSON.stringify([integrationId, guidance, additionalContext, images.map(image=>image.url)]);
  const stale = Boolean(preview.data && submittedSettings !== settings);
  const selectedIds = useMemo(() => new Set(issues.map(issue => issue.id)), [issues]);
  const recommendations = asArray(preview.data?.triage).filter(item => selectedIds.has(item.issue_id));
  const visible = recommendations.filter(item =>
    (filter === "all" || (filter === "high" ? highPriority(item) : item.readiness.missing_fields.length > 0))
    && [item.display_id, item.title, item.category].join(" ").toLowerCase().includes(search.trim().toLowerCase())
  );
  const active = visible.find(item => item.issue_id === selectedId) || visible[0];
  const approval = active?.approval;
  const correctionsLocked = Boolean(correctionLockedIssueId && active?.issue_id === correctionLockedIssueId);
  const approved = Boolean(!correctionsLocked && approval && approvedCorrectionToken === approval.token);
  const posted = Boolean(approval && postedTokens.includes(approval.token));
  const corrections = asArray(active?.corrections);
  const evidence = asArray(preview.data?.evidence_sources).filter(source => active?.evidence_refs.includes(source.ref));
  const busy = preview.isPending || save.isPending || contextBusy || imageBusy;
  const analyze = () => {
    if (busy || !issues.length || issues.length > 10) return;
    setSubmittedSettings(settings);
    setSelectedId("");
    preview.mutate({
      project_id: projectId,
      issue_ids: issues.map(issue => issue.id),
      integration_id: integrationId || getLlmIntegrationId("ai.bug.triage") || undefined,
      prompt_guidance: guidance.slice(0, 4_000) || undefined,
      images,
      ...(additionalContext.trim() ? { smart_context: { reviewed_context: additionalContext.trim().slice(0, 8_000) } } : {})
    });
  };

  return <div className="modal-backdrop defect-triage-backdrop" role="presentation" onClick={close}>
    <div className="defect-triage-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1} onClick={event => event.stopPropagation()}>
      <header className="defect-triage-header">
        <span className="defect-triage-mark"><IconSparkles size={23} aria-hidden="true" /></span>
        <div><span className="defect-triage-eyebrow">DEFECT REVIEW</span><h2 id={titleId}>AI Defect Triage</h2><p>Review classification, priority signals, and missing evidence before editing a Defect.</p></div>
        <DialogCloseButton label="Close AI Defect Triage" onClick={close} />
      </header>
      <div className="defect-triage-body">
        <section className="defect-triage-setup" aria-label="Triage setup">
          <div className="defect-triage-scope"><h3>{issues.length} selected {issues.length === 1 ? "Defect" : "Defects"}</h3><p>Only these saved records and the context you review are sent for analysis.</p><ul>{issues.map(issue => <li key={issue.id}><span>{issue.display_id || issue.jira_bug_key || "Defect"}</span><span title={issue.title}>{issue.title}</span></li>)}</ul></div>
          <div className="defect-triage-controls">
            <AiReviewControls usageKey="ai.bug.triage" projectId={projectId} integrations={asArray(integrationsQuery.data)} integrationId={integrationId} onIntegrationIdChange={setIntegrationId} promptGuidance={promptGuidance} onPromptGuidanceChange={setPromptGuidance} promptMaxLength={4_000} contextMaxLength={8_000} additionalContext={additionalContext} onAdditionalContextChange={setAdditionalContext} artifactContext={issues.map(issue => `${issue.title}: ${issue.message || ""}`.slice(0, 600)).join("\n")} artifactIds={issues.map(issue => issue.id)} disabled={preview.isPending} onBusyChange={setContextBusy} />
            {integrationsQuery.isError ? <p className="defect-triage-note">Model choices could not be loaded. Your configured model is still available. <button className="text-button" onClick={() => void integrationsQuery.refetch()} type="button">Retry models</button></p> : null}
            <AiReferenceImages images={images} onChange={setImages} disabled={preview.isPending} onBusyChange={setImageBusy}/>
            <button className="primary-button defect-triage-run" disabled={busy || promptQuery.isFetching || integrationsQuery.isFetching || !issues.length || issues.length > 10} onClick={analyze} type="button"><IconSparkles size={17} aria-hidden="true" />{preview.isPending ? "Analyzing…" : preview.error ? "Retry analysis" : preview.data ? "Analyze again" : "Analyze selected Defects"}</button>
          </div>
        </section>
        {preview.isPending ? <div className="defect-triage-loading" role="status"><LoadingState label="Analyzing selected Defects" /><p>Checking recorded symptoms, priority signals, and evidence gaps…</p></div> : preview.error ? <div className="defect-triage-notice is-error" role="alert"><strong>Analysis could not be completed.</strong><p>{preview.error instanceof Error ? preview.error.message : "Try the analysis again."}</p></div> : preview.data ? <>
          {stale ? <p className="defect-triage-notice" role="status">Review settings changed. Analyze again to refresh these recommendations.</p> : null}
          <section className="defect-triage-summary" aria-label="Triage summary"><div><strong>{recommendations.length}</strong><span>Assessed</span></div><div><strong>{recommendations.filter(highPriority).length}</strong><span>High priority signals</span></div><div><strong>{recommendations.filter(item => item.readiness.missing_fields.length).length}</strong><span>Need evidence</span></div><p>{preview.data.summary}</p></section>
          {preview.data.fallback_used ? <div className="defect-triage-notice" role="status"><strong>Recorded-field analysis</strong><p>{preview.data.fallback_reason || "AI refinement is unavailable. Recommendations below use recorded fields."}</p></div> : null}
          <div className="defect-triage-filters"><label><IconSearch size={17} aria-hidden="true" /><input aria-label="Search triage results" placeholder="Search Defect or category…" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Filter triage results" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All recommendations</option><option value="high">High priority signals</option><option value="missing">Missing evidence</option></select></div>
          {visible.length ? <div className="defect-triage-results">
            <nav className="defect-triage-queue" aria-label="Defect recommendations">{visible.map(item => <button key={item.issue_id} aria-pressed={active?.issue_id === item.issue_id} onClick={() => setSelectedId(item.issue_id)} type="button"><span>{issues.find(issue => issue.id === item.issue_id)?.display_id || item.display_id}</span><strong>{item.title}</strong><small>{item.category}</small><span className={`defect-triage-priority${highPriority(item) ? " is-high" : ""}`}>{item.recommended_priority}</span></button>)}</nav>
            {active ? <section className="defect-triage-finding" aria-label="Selected recommendation">
              <header><div><span className="defect-triage-eyebrow">{active.category}</span><h3>{active.title}</h3></div><button className="ghost-button" disabled={stale || save.isPending} onClick={() => onOpenIssue(active.issue_id)} type="button">Review Defect<IconArrowRight size={16} aria-hidden="true" /></button></header>
              <div className="defect-triage-priority-change"><span>Current priority <strong>{active.current_priority}</strong></span><IconArrowRight size={18} aria-hidden="true" /><span>Suggested priority <strong className={highPriority(active) ? "is-high" : ""}>{active.recommended_priority}</strong></span></div>
              <p>{active.explanation}</p>
              {active.failure_context ? <section><h4>Failure evidence</h4>
                {active.failure_context.attempt ? <p><strong>{active.failure_context.attempt.test_case_title}</strong> · {active.failure_context.attempt.status}{active.failure_context.attempt.step_order ? ` · Step ${active.failure_context.attempt.step_order}` : ""}</p> : null}
                {active.failure_context.attempt?.step_action ? <p>{active.failure_context.attempt.step_action}</p> : null}
                <p>{active.failure_context.detail}</p>
              </section> : null}
              {corrections.length ? <section className="defect-triage-corrections"><h4>Evidence-backed corrections</h4>
                {[...new Set(corrections.map(item => item.rationale))].map((rationale) => <p key={rationale}>{rationale}</p>)}
                <dl>{corrections.map((item) => <div key={item.field}><dt>{fieldLabel(item.field)}</dt><dd><strong>Recorded</strong> {correctionValue(item.before)}</dd><dd><strong>Proposed</strong> {correctionValue(item.after)}</dd></div>)}</dl>
                {approval && !posted ? <label><input type="checkbox" checked={approved} disabled={correctionsLocked || stale || save.isPending} onChange={(event) => setApprovedCorrectionToken(event.target.checked ? approval.token : "")} /> Apply these corrections when posting</label> : null}
                {correctionsLocked && approval && !posted ? <p>Save your Defect edits before applying these corrections.</p> : null}
              </section> : null}
              <section className="defect-triage-evidence-gaps"><h4>{active.readiness.missing_fields.length ? "Evidence to complete" : "Required fields recorded"}</h4>{active.readiness.missing_fields.length ? <ul>{active.readiness.missing_fields.map(field => <li key={field}>{fieldLabel(field)}</li>)}</ul> : <p><IconCheck size={16} aria-hidden="true" />{active.readiness.completed_field_count} of {active.readiness.total_field_count} required fields recorded.</p>}</section>
              <section><h4>Recommended next steps</h4><ol>{asArray(active.review_actions).map(action => <li key={action}>{action}</li>)}</ol></section>
              <details className="defect-triage-evidence"><summary>Supporting evidence ({evidence.length})</summary>{evidence.length ? evidence.map(source => <article key={source.ref}><strong>{source.title}</strong><p>{source.excerpt || "Recorded relationship"}</p></article>) : <p>No specific field citation was returned. Verify the recommendation in the Defect.</p>}</details>
              {approval ? <section className="defect-triage-approval">
                <details className="defect-triage-evidence"><summary>Preview triage comment</summary><p>{approval.comment}</p></details>
                {posted ? <p role="status"><IconCheck size={16} aria-hidden="true" /> Triage comment posted.</p> : <button className="primary-button" disabled={stale || busy} onClick={() => save.mutate({ issueId: active.issue_id, token: approval.token, corrections: approved })} type="button">{save.isPending ? "Posting…" : approved ? "Apply corrections and post comment" : "Post triage comment"}</button>}
                {save.error && save.variables?.token === approval.token ? <p role="alert">{save.error instanceof Error ? save.error.message : "Could not post the triage comment."}</p> : null}
              </section> : null}
            </section> : null}
          </div> : <p className="defect-triage-empty">{recommendations.length ? "No recommendations match these filters." : "No recommendation was returned for the selected Defects. Try the analysis again."}</p>}
          <details className="defect-triage-provenance"><summary>Analysis details and limitations</summary><p><strong>Source:</strong> {preview.data.integration?.name || preview.data.provenance?.provider || "Recorded Defect fields"}{preview.data.integration?.model ? ` · ${preview.data.integration.model}` : ""}</p><p>Priority and evidence completeness use recorded-field rules. AI may refine a category only with valid field citations. Recommendations do not change your records.</p>{asArray(preview.data.limitations).map((item, index) => <p key={index}>{item}</p>)}{preview.data.partial_sources ? <p>Some fields exceeded the context limit. Review the full records before deciding.</p> : null}{asArray(preview.data.boundaries?.omissions).map((item, index) => <p key={index}>{issues.find(issue => issue.id === item.issue_id)?.display_id || "Selected Defect"}: {item.omitted} {item.unit} omitted from {formatDefectFieldLabel(item.field)}.</p>)}</details>
        </> : <div className="defect-triage-empty"><IconShieldCheck size={30} aria-hidden="true" /><h3>Start with the evidence</h3><p>Choose your review settings, then analyze the selected Defects. Each recommendation includes its priority signal and next steps.</p></div>}
      </div>
      <footer className="defect-triage-footer"><span>Review the evidence and confirm when ready to post.</span><button className="ghost-button" disabled={save.isPending} onClick={close} type="button">Close</button></footer>
    </div>
  </div>;
}
