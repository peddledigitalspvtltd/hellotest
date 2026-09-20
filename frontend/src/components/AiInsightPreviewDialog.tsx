import { formatRecordKindLabel } from "../lib/defectTerminology";
import { LoadingState } from "./LoadingState";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import type { AiAssistedPreviewBase, AiEvidenceSource, AiProcessingSnapshot } from "../types";
import type { AiAssuranceSignal } from "../lib/aiAssurance";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { AiAssurancePanel } from "./AiAssurancePanel";
import {
  AgenticProcessRail,
  AiEvidenceButton,
  AiEvidenceFlyout,
  AiRunBrief,
  type AgenticFeatureProfileId
} from "./AgenticExperience";
import { DialogCloseButton } from "./DialogCloseButton";
import { SparkIcon } from "./AppIcons";
import "./AiInsightPreviewDialog.css";

export type AiPreviewFinding = {
  id: string;
  title: string;
  severity?: "info" | "low" | "medium" | "high" | string;
  description: string;
  action?: string | null;
  meta?: string | null;
  evidence?: string[];
};

export type AiPreviewBoundaryOmission = {
  source_ref?: string;
  issue_id?: string;
  field: string;
  unit?: string;
  omitted: number;
};

type AiInsightPreviewDialogProps = {
  open: boolean;
  eyebrow: string;
  title: string;
  subtitle: string;
  assuranceTitle: string;
  scoreLabel?: string;
  showScore?: boolean;
  response: AiAssistedPreviewBase | null | undefined;
  loading?: boolean;
  error?: string | null;
  summary?: string;
  signals?: AiAssuranceSignal[];
  gaps?: string[];
  findings?: AiPreviewFinding[];
  recommendedActions?: string[];
  limitations?: string[];
  emptyMessage?: string;
  acceptLabel?: string;
  evidenceSources?: AiEvidenceSource[];
  boundaryOmissions?: AiPreviewBoundaryOmission[];
  inputEvidenceCount?: number;
  processing?: AiProcessingSnapshot;
  profile?: AgenticFeatureProfileId;
  onAccept?: (selection: { findingIds: string[]; actions: string[] }) => void;
  onClose: () => void;
};

const normalizeSeverity = (value?: string) => {
  const normalized = String(value || "info").toLowerCase();
  return ["high", "medium", "low", "info"].includes(normalized) ? normalized : "info";
};

type ReviewView = "findings" | "actions" | "details";

const REVIEW_VIEWS: Array<{ id: ReviewView; label: string }> = [
  { id: "findings", label: "Findings" },
  { id: "actions", label: "Actions" },
  { id: "details", label: "Run details" }
];

export function AiInsightPreviewDialog({
  open,
  eyebrow,
  title,
  subtitle,
  assuranceTitle,
  scoreLabel = "Evidence grounding",
  showScore = true,
  response,
  loading = false,
  error,
  summary,
  signals = [],
  gaps = [],
  findings = [],
  recommendedActions = [],
  limitations = [],
  emptyMessage = "No deterministic signal was returned for this scope.",
  acceptLabel = "Accept review plan",
  evidenceSources = [],
  boundaryOmissions = [],
  inputEvidenceCount = 0,
  processing,
  profile = "default",
  onAccept,
  onClose
}: AiInsightPreviewDialogProps) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ active: open, onClose });
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>([]);
  const [selectedActionIndexes, setSelectedActionIndexes] = useState<number[]>([]);
  const [editedActions, setEditedActions] = useState<string[]>([]);
  const [accepted, setAccepted] = useState(false);
  const [activeReviewView, setActiveReviewView] = useState<ReviewView>("findings");
  const [evidenceFindingId, setEvidenceFindingId] = useState("");
  const [isRunEvidenceOpen, setIsRunEvidenceOpen] = useState(false);
  const [isFlowPaneCollapsed, setIsFlowPaneCollapsed] = useState(false);
  const reviewTabsId = useId();
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedFindingIds(findings.map((finding) => finding.id));
    setSelectedActionIndexes(recommendedActions.map((_, index) => index));
    setEditedActions(recommendedActions);
    setAccepted(false);
    setActiveReviewView("findings");
    setEvidenceFindingId("");
    setIsRunEvidenceOpen(false);
    setIsFlowPaneCollapsed(false);
  }, [open, response?.request_id]);

  if (!open) {
    return null;
  }

  const provenance = response?.provenance;
  const confidence = Math.round(Math.max(0, Math.min(1, provenance?.confidence ?? response?.confidence ?? 0)) * 100);
  const evidence = [...new Set(provenance?.evidence || [])];
  const visibleEvidenceCount = evidence.length || inputEvidenceCount;
  const evidenceByRef = new Map(evidenceSources.map((source) => [source.ref, source]));
  const evidenceFinding = findings.find((finding) => finding.id === evidenceFindingId) || null;
  const findingEvidenceSources = (evidenceFinding?.evidence || []).map((ref) => evidenceByRef.get(ref)).filter(Boolean) as AiEvidenceSource[];
  const generationMode = provenance?.generation_mode || response?.generation_mode || "deterministic";
  const provider = provenance?.provider || response?.integration?.name || "HelloTest workspace assist";
  const provenanceLabel = `${provider} · ${generationMode} mode · ${evidence.length} evidence reference${evidence.length === 1 ? "" : "s"}`;
  const effectiveSignals = signals.length ? signals : [
    { label: "Generation", value: generationMode === "deterministic" ? "Deterministic" : generationMode, tone: "neutral" },
    { label: "Evidence", value: `${evidence.length} reference${evidence.length === 1 ? "" : "s"}`, tone: evidence.length ? "positive" : "warning" },
    { label: "Decision", value: "Human owned", tone: "warning" }
  ] satisfies AiAssuranceSignal[];
  const effectiveGaps = [...new Set([
    ...gaps,
    ...(response?.requires_human_review ? ["A person must verify the evidence and own the final connected workspace or release decision."] : [])
  ])];
  const reviewedProcessing = accepted && processing ? {
    ...processing,
    active_stage_id: "review" as const,
    completed_stage_count: processing.total_stage_count || processing.stages?.length || 4,
    status_label: onAccept ? "Review plan accepted" : "Review acknowledged",
    stages: processing.stages?.map((stage) => stage.id === "review"
      ? { ...stage, status: "complete" as const, detail: onAccept ? "The selected review plan was accepted." : "The read-only recommendations were acknowledged." }
      : stage)
  } : processing;
  const effectiveAcceptLabel = onAccept ? acceptLabel : "Acknowledge review";
  const reviewViewCount: Record<ReviewView, number | null> = {
    findings: findings.length,
    actions: recommendedActions.length,
    details: null
  };
  const handleReviewTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentView: ReviewView) => {
    const currentIndex = REVIEW_VIEWS.findIndex((view) => view.id === currentView);
    const nextIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % REVIEW_VIEWS.length
      : event.key === "ArrowLeft"
        ? (currentIndex - 1 + REVIEW_VIEWS.length) % REVIEW_VIEWS.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? REVIEW_VIEWS.length - 1
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextView = REVIEW_VIEWS[nextIndex];
    setActiveReviewView(nextView.id);
    document.getElementById(`${reviewTabsId}-${nextView.id}-tab`)?.focus();
  };

  return (
    <div className="modal-backdrop modal-backdrop--scroll ai-insight-preview-backdrop" onClick={onClose} role="presentation">
      <div
        aria-labelledby="ai-insight-preview-title"
        aria-modal="true"
        className={`modal-card ai-insight-preview-dialog ai-feature-dialog${isFlowPaneCollapsed ? " is-flow-pane-collapsed" : ""}`}
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="ai-insight-preview-header">
          <div>
            <p className="dialog-context-label">{eyebrow}</p>
            <h2 className="dialog-title" id="ai-insight-preview-title">{title}</h2>
            <p>{subtitle}</p>
          </div>
          <DialogCloseButton label={`Close ${title}`} onClick={onClose} />
        </header>

        <div className="ai-insight-preview-workbench">
          <section aria-label={`${title} review workspace`} className="ai-insight-preview-main">
            <AiRunBrief
              className="ai-insight-preview-run-brief"
              collapsible
              items={[
                { id: "context", kind: "context", label: "Evidence context", state: visibleEvidenceCount ? "ready" : "attention", value: `${visibleEvidenceCount} cited or selected reference${visibleEvidenceCount === 1 ? "" : "s"} · ${findings.length} finding${findings.length === 1 ? "" : "s"}` },
                { id: "output", kind: "output", label: "Output contract", state: response ? "ready" : "neutral", value: onAccept ? `${selectedFindingIds.length} selected finding${selectedFindingIds.length === 1 ? "" : "s"} · ${selectedActionIndexes.length} selected action${selectedActionIndexes.length === 1 ? "" : "s"}` : `${findings.length} read-only recommendation${findings.length === 1 ? "" : "s"} · ${recommendedActions.length} review step${recommendedActions.length === 1 ? "" : "s"}` },
                { id: "approval", kind: "approval", label: "Human gate", state: "ready", value: onAccept ? "Accept a review plan; do not mutate source records" : "Acknowledge recommendations; source records remain unchanged" }
              ]}
            />

            <div className="ai-insight-preview-body">
          {loading ? (
            <LoadingState label="Reviewing connected workspace evidence" description="HelloTest is assessing bounded evidence. Nothing is being changed." />
          ) : error ? (
            <div className="ai-insight-preview-state is-error" role="alert">
              <div>
                <strong>Preview unavailable</strong>
                <span>{error}</span>
              </div>
            </div>
          ) : response ? (
            <>
              <div className="ai-insight-preview-boundary">
                <SparkIcon />
                <span><strong>Preview only.</strong> No work item, link, property, attachment, test, run, or quality gate was changed.</span>
              </div>

              <div aria-label="Review content" className="ai-insight-preview-tabs" role="tablist">
                {REVIEW_VIEWS.map((view) => (
                  <button
                    aria-controls={`${reviewTabsId}-${view.id}-panel`}
                    aria-selected={activeReviewView === view.id}
                    data-autofocus={view.id === "findings" ? "true" : undefined}
                    id={`${reviewTabsId}-${view.id}-tab`}
                    key={view.id}
                    onClick={() => setActiveReviewView(view.id)}
                    onKeyDown={(event) => handleReviewTabKeyDown(event, view.id)}
                    role="tab"
                    tabIndex={activeReviewView === view.id ? 0 : -1}
                    type="button"
                  >
                    <span>{view.label}</span>
                    {reviewViewCount[view.id] !== null ? <small>{reviewViewCount[view.id]}</small> : null}
                  </button>
                ))}
              </div>

              <section
                aria-labelledby={`${reviewTabsId}-findings-tab`}
                className="ai-insight-preview-section ai-insight-preview-tab-panel"
                hidden={activeReviewView !== "findings"}
                id={`${reviewTabsId}-findings-panel`}
                role="tabpanel"
                tabIndex={activeReviewView === "findings" ? 0 : -1}
              >
                  <div className="ai-insight-preview-section-head">
                    <strong>Explainable findings</strong>
                    <span>{onAccept ? `${selectedFindingIds.length} of ${findings.length} selected` : `${findings.length} for review`}</span>
                  </div>
                  {findings.length ? (
                    <div className="ai-insight-preview-findings">
                      {findings.map((finding) => (
                        <article className={`ai-insight-preview-finding severity-${normalizeSeverity(finding.severity)}`} data-selected={(onAccept && selectedFindingIds.includes(finding.id)) || undefined} key={finding.id}>
                          <div className="ai-insight-preview-finding-head">
                            {onAccept ? (
                              <label><input checked={selectedFindingIds.includes(finding.id)} onChange={(event) => setSelectedFindingIds((current) => event.target.checked ? [...new Set([...current, finding.id])] : current.filter((id) => id !== finding.id))} type="checkbox" /><strong>{finding.title}</strong></label>
                            ) : <strong>{finding.title}</strong>}
                            <span>{normalizeSeverity(finding.severity)}</span>
                          </div>
                          <p>{finding.description}</p>
                          {finding.meta ? <small>{finding.meta}</small> : null}
                          {finding.action ? <div className="ai-insight-preview-action"><b>Reviewer action</b><span>{finding.action}</span></div> : null}
                          {finding.evidence?.length ? (
                            <AiEvidenceButton count={finding.evidence.length} label="View finding evidence" onClick={() => setEvidenceFindingId(finding.id)} />
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : <div className="empty-state compact">{emptyMessage}</div>}
              </section>

              <section
                aria-labelledby={`${reviewTabsId}-actions-tab`}
                className="ai-insight-preview-section ai-insight-preview-tab-panel"
                hidden={activeReviewView !== "actions"}
                id={`${reviewTabsId}-actions-panel`}
                role="tabpanel"
                tabIndex={activeReviewView === "actions" ? 0 : -1}
              >
                  <div className="ai-insight-preview-section-head"><strong>{onAccept ? "Editable review sequence" : "Recommended review sequence"}</strong><span>{onAccept ? `${selectedActionIndexes.length} selected` : `${recommendedActions.length} steps`}</span></div>
                  {recommendedActions.length ? (
                    onAccept ? (
                      <div className="ai-insight-preview-editable-actions">
                        {editedActions.map((action, index) => (
                          <div data-selected={selectedActionIndexes.includes(index) || undefined} key={`${index}:${recommendedActions[index]}`}>
                            <input aria-label={`Include recommendation ${index + 1}: ${action}`} checked={selectedActionIndexes.includes(index)} onChange={(event) => setSelectedActionIndexes((current) => event.target.checked ? [...new Set([...current, index])] : current.filter((item) => item !== index))} type="checkbox" />
                            <span>{index + 1}</span>
                            <textarea aria-label={`Edit recommendation ${index + 1}`} onChange={(event) => setEditedActions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} rows={2} value={action} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <ol className="ai-insight-preview-review-actions">
                        {recommendedActions.map((action) => <li key={action}>{action}</li>)}
                      </ol>
                    )
                  ) : <div className="empty-state compact">No review actions were recommended for this preview.</div>}
              </section>

              <section
                aria-labelledby={`${reviewTabsId}-details-tab`}
                className="ai-insight-preview-run-details ai-insight-preview-tab-panel"
                hidden={activeReviewView !== "details"}
                id={`${reviewTabsId}-details-panel`}
                role="tabpanel"
                tabIndex={activeReviewView === "details" ? 0 : -1}
              >
                  <AiAssurancePanel
                    compact
                    gaps={effectiveGaps}
                    provenance={provenanceLabel}
                    reviewState="review-required"
                    showScore={showScore}
                    score={confidence}
                    scoreLabel={scoreLabel}
                    signals={effectiveSignals}
                    summary={summary || "This read-only preview explains signals found in current work items, links, properties, and result evidence."}
                    title={assuranceTitle}
                  />
                  <div className="ai-insight-preview-details ai-insight-preview-details--launch">
                    <div>
                      <h3>Run evidence and provenance</h3>
                      <p>{provider} · {generationMode} mode · {evidence.length} source reference{evidence.length === 1 ? "" : "s"} · {limitations.length} disclosed limitation{limitations.length === 1 ? "" : "s"}</p>
                    </div>
                    <AiEvidenceButton count={evidence.length} label="Open run evidence" onClick={() => setIsRunEvidenceOpen(true)} />
                  </div>
              </section>
            </>
          ) : (
            <div className="ai-insight-preview-state">
              <span>Run the preview to inspect current connected workspace evidence.</span>
            </div>
          )}
            </div>
          </section>

          <aside aria-label="AI run and review" className="ai-insight-preview-flow-pane">
            <button
              aria-expanded={!isFlowPaneCollapsed}
              aria-label={isFlowPaneCollapsed ? "Expand AI process and provenance" : "Collapse AI process and provenance"}
              className="ai-insight-preview-flow-toggle"
              onClick={() => setIsFlowPaneCollapsed((current) => !current)}
              title={isFlowPaneCollapsed ? "Expand process rail" : "Collapse process rail"}
              type="button"
            >
              {isFlowPaneCollapsed ? <IconChevronLeft aria-hidden="true" size={17} /> : <IconChevronRight aria-hidden="true" size={17} />}
              {isFlowPaneCollapsed ? <span>Process</span> : null}
            </button>
            {!isFlowPaneCollapsed ? <AgenticProcessRail
              agentName={eyebrow.toLowerCase().includes("bug") ? "Defect Triage Agent" : title.toLowerCase().includes("run") || title.toLowerCase().includes("execution") ? "Failure Analyst" : "Quality Evaluator"}
              compact
              orientation="vertical"
              presentation="focused"
              profile={profile}
              processing={reviewedProcessing}
              stageEvidence={{
                context: `${evidence.length} cited evidence reference${evidence.length === 1 ? "" : "s"} and ${findings.length} explainable finding${findings.length === 1 ? "" : "s"} are bounded to this preview.`,
                guardrails: "This preview cannot change work items, links, properties, tests, runs, or release decisions.",
                outcome: `${findings.length} finding${findings.length === 1 ? "" : "s"} and ${recommendedActions.length} review action${recommendedActions.length === 1 ? "" : "s"} are available.`,
                review: onAccept ? "A person selects the findings and action sequence, then explicitly accepts the review plan for this session." : "A person reviews and acknowledges the recommendations. No Defect field is changed from this preview."
              }}
              status={loading ? "running" : error ? "failed" : response ? "completed" : "idle"}
            /> : null}
          </aside>
        </div>

        <footer className="ai-insight-preview-footer">
          <span aria-live="polite">{accepted ? (onAccept ? "Review plan accepted for this session." : "Recommendations acknowledged for this session; no Defect fields were changed.") : (onAccept ? "Select and edit the output before accepting it. Human review remains authoritative." : "Review the recommendations, then acknowledge them. Apply any Defect changes from the Defect workspace.")}</span>
          <button className="ghost-button" onClick={onClose} ref={doneButtonRef} type="button">{accepted ? "Done" : "Discard"}</button>
          {!accepted && response ? (
            <button
              className="primary-button"
              disabled={Boolean(onAccept) && !selectedFindingIds.length && !selectedActionIndexes.length}
              onClick={() => {
                const actions = selectedActionIndexes.map((index) => editedActions[index]?.trim()).filter(Boolean);
                onAccept?.({ findingIds: selectedFindingIds, actions });
                setAccepted(true);
                window.requestAnimationFrame(() => doneButtonRef.current?.focus());
              }}
              type="button"
            >
              {effectiveAcceptLabel}{onAccept ? ` (${selectedFindingIds.length + selectedActionIndexes.length})` : ""}
            </button>
          ) : null}
        </footer>
        <AiEvidenceFlyout
          description={evidenceFinding?.description}
          eyebrow={`${eyebrow} · Finding evidence`}
          facts={evidenceFinding ? [
            { label: "Finding", value: evidenceFinding.title },
            { label: "Evidence refs", value: evidenceFinding.evidence?.length || 0 },
            { label: "Decision", value: "Human owned" }
          ] : []}
          onClose={() => setEvidenceFindingId("")}
          open={Boolean(evidenceFinding)}
          title="Evidence for this recommendation"
        >
          <div className="ai-insight-preview-flyout-sources">
            {findingEvidenceSources.length ? findingEvidenceSources.map((source) => (
              <article key={source.ref}>
                <span>{formatRecordKindLabel(source.type).replace(/-/g, " ")}</span>
                <strong>{source.title}</strong>
                {source.excerpt ? <p>{source.excerpt}</p> : null}
                <code>{source.ref}</code>
              </article>
            )) : (evidenceFinding?.evidence || []).map((ref) => <code key={ref}>{ref}</code>)}
          </div>
        </AiEvidenceFlyout>
        <AiEvidenceFlyout
          description="Recorded source references and provenance for this read-only review."
          eyebrow={`${eyebrow} · Run evidence`}
          facts={[
            { label: "Mode", value: generationMode },
            { label: "Provider", value: provider },
            { label: "Generated", value: provenance?.generated_at || response?.generated_at || "Unavailable" },
            { label: "Request", value: provenance?.request_id || response?.request_id || "Unavailable" },
            { label: "Input fingerprint", value: provenance?.input_fingerprint || response?.input_fingerprint || "Unavailable" },
            { label: "Boundary omissions", value: boundaryOmissions.length }
          ]}
          onClose={() => setIsRunEvidenceOpen(false)}
          open={isRunEvidenceOpen}
          title="Provenance and evidence"
        >
          <div className="ai-insight-preview-flyout-sources">
            {evidenceSources.length ? evidenceSources.map((source) => (
              <article key={source.ref}>
                <span>{formatRecordKindLabel(source.type).replace(/-/g, " ")}</span>
                <strong>{source.title}</strong>
                {source.excerpt ? <p>{source.excerpt}</p> : null}
                <code>{source.ref}</code>
              </article>
            )) : evidence.map((ref) => <code key={ref}>{ref}</code>)}
          </div>
          {boundaryOmissions.length ? (
            <section className="ai-evidence-flyout__section">
              <header><span>Processing boundary</span><strong>Truncated prompt fields and lists</strong></header>
              <dl className="ai-evidence-flyout__record-list">
                {boundaryOmissions.map((omission, index) => (
                  <div key={`${omission.issue_id || omission.source_ref || "source"}:${omission.field}:${index}`}>
                    <dt>{omission.field.replace(/_/g, " ")}</dt>
                    <dd>{omission.omitted} {omission.unit || "items"} omitted · <code>{omission.source_ref || omission.issue_id || "bounded source"}</code></dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
          {response?.fallback_reason ? <section className="ai-evidence-flyout__section"><header><span>Fallback disclosure</span><strong>Why the conservative path was used</strong></header><p>{response.fallback_reason}</p></section> : null}
          {limitations.length ? <section className="ai-evidence-flyout__section"><header><strong>Limitations</strong></header><ul>{limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></section> : null}
        </AiEvidenceFlyout>
      </div>
    </div>
  );
}
