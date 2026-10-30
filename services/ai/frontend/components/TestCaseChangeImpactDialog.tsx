import { useEffect, useId, useState } from "react";
import { IconArrowFork, IconSearch, IconShieldCheck } from "@tabler/icons-react";
import type { TestCaseImpactPreviewResponse } from "@hellotest/platform/frontend/src/types";
import { testCaseImpactGroups } from "../lib/testCaseChangeImpact";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { ArtifactImpactReview } from "./ArtifactImpactReview";
import "./StoryChangeImpactDialog.css";

type Props = {
  open: boolean;
  response: TestCaseImpactPreviewResponse | null | undefined;
  testCaseTitle: string;
  showAutomation?: boolean;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onRetry: () => void;
};

export function TestCaseChangeImpactDialog({ open, response, testCaseTitle, showAutomation = true, loading, error, onClose, onRetry }: Props) {
  const ref = useDialogFocus<HTMLDivElement>({ active: open, onClose });
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  useEffect(() => { setQuery(""); setKind("all"); }, [open, response?.request_id]);
  if (!open) return null;

  const groups = response ? testCaseImpactGroups(response, showAutomation) : [];
  const unavailable = groups.filter(group => !group.available);
  const records = groups.flatMap(group => group.items.map(item => ({ ...item, group: group.key, kindLabel: group.label })));
  const visible = records.filter(item => (kind === "all" || item.group === kind)
    && [item.display_id, item.id, item.title, item.name, item.locator_intent, item.status].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  const missingStory = groups.some(group => group.key === "requirements" && group.available && group.total === 0);
  const actions = [...new Set(response?.recommended_actions || [])];
  const signals = [...new Set(response?.risk_signals || [])];

  return <div className="modal-backdrop story-impact-backdrop" onClick={onClose} role="presentation">
    <div className="story-impact-dialog test-case-impact-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1} onClick={event => event.stopPropagation()}>
      <header className="story-impact-header">
        <span className="story-impact-icon"><IconArrowFork size={24} aria-hidden="true" /></span>
        <div>
          <span className="story-impact-eyebrow">TEST CASE REVIEW</span>
          <h2 id={titleId}>Preview Test Case change impact</h2>
          <p>{response?.test_case.display_id ? `${response.test_case.display_id} · ` : ""}{testCaseTitle}</p>
        </div>
        <DialogCloseButton label="Close Test Case change impact" onClick={onClose} />
      </header>
      <div className="story-impact-body" aria-busy={Boolean(loading)}>
        {loading ? <>
          <LoadingState label="Reviewing Test Case change impact" />
          <p role="status">Checking the current Test Case draft and its connected delivery records…</p>
        </> : error ? <div className="story-impact-notice is-warning" role="alert">
          <h3>Impact preview unavailable</h3><p>{error}</p>
          <button className="primary-button" onClick={onRetry} type="button">Retry preview</button>
        </div> : response ? <>
          <section className="story-impact-summary" aria-label="Impact summary">
            <div>
              <span className={`story-impact-risk is-${response.impact.risk_level}`}>{response.impact.risk_level} impact{unavailable.length ? " · partial evidence" : ""}</span>
              <h3>Review what this change could affect</h3><p>{response.explanation}</p>
            </div>
            <p className="story-impact-summary-note"><IconShieldCheck aria-hidden="true" size={18} />Based on existing links and the current draft. Linked records need review; a link alone does not confirm a failure.</p>
          </section>
          <div className="story-impact-counts" aria-label="Connected record counts">
            {groups.map(group => <div key={group.key}><strong>{group.total ?? "—"}</strong><span>{group.label}</span>{!group.available ? <small>Unavailable</small> : null}</div>)}
          </div>
          {unavailable.length ? <p className="story-impact-notice" role="status">Evidence unavailable for {unavailable.map(group => group.label.toLowerCase()).join(", ")} under current permissions or feature settings. Their absence is not a coverage conclusion.</p> : null}
          {missingStory ? <p className="story-impact-notice is-warning"><strong>Traceability gap.</strong> No linked Story was found. Confirm the intended behavior and link the Story this Test Case covers.</p> : null}
          {response.fallback_used ? <p className="story-impact-notice">{response.fallback_reason || "AI refinement is unavailable. The connected records below remain available for review."}</p> : null}
          <section className="story-impact-evidence" aria-label="Connected evidence">
            <header><div><h3>Connected evidence</h3><p>All linked records in one place.</p></div><span role="status">{visible.length} of {records.length} records</span></header>
            <div className="story-impact-filters">
              <label><IconSearch size={18} aria-hidden="true" /><input aria-label="Search impact evidence" placeholder="Search ID, title, or status…" value={query} onChange={event => setQuery(event.target.value)} /></label>
              <select aria-label="Impact evidence type" value={kind} onChange={event => setKind(event.target.value)}><option value="all">All record types</option>{groups.map(group => <option value={group.key} key={group.key}>{group.label}</option>)}</select>
            </div>
            <ul className="story-impact-records">{visible.map(item => <li key={`${item.group}:${item.id}`}>
              <span className="story-impact-record-kind">{item.kindLabel}</span>
              <div><span className="story-impact-record-id">{item.display_id || item.id}</span><strong>{item.title || item.name || item.locator_intent || "Untitled record"}</strong>{item.release || item.build ? <small>{[item.release && `Release ${item.release}`, item.build && `Build ${item.build}`].filter(Boolean).join(" · ")}</small> : null}</div>
              {item.status ? <span className="story-impact-status">{item.status.replace(/_/g, " ")}</span> : null}
            </li>)}</ul>
            {!visible.length ? <p className="story-impact-empty">{records.length ? "No records match these filters." : unavailable.length ? "No accessible linked records are available for this review." : "No downstream records are linked to this Test Case."}</p> : null}
          </section>
          {signals.length ? <section className="story-impact-recommendations"><h3>Risk signals</h3><ol>{signals.map(signal => <li key={signal}>{signal}</li>)}</ol></section> : null}
          <ArtifactImpactReview review={response.assurance_review} />
          <section className="story-impact-recommendations"><h3>Recommended next steps</h3>{actions.length ? <ol>{actions.map(action => <li key={action}>{action}</li>)}</ol> : <p>No additional actions were returned.</p>}</section>
          <details className="story-impact-provenance">
            <summary>Review details and limitations</summary>
            <dl>
              <div><dt>Impact source</dt><dd>HelloTest relationships and run snapshots</dd></div>
              <div><dt>AI review</dt><dd>{response.provenance?.provider || response.integration?.name || "Unavailable"}{response.integration?.model ? ` · ${response.integration.model}` : ""}</dd></div>
              <div><dt>Generated</dt><dd>{response.generated_at ? new Date(response.generated_at).toLocaleString() : "Unavailable"}</dd></div>
              <div><dt>Reference</dt><dd>{response.request_id || "Unavailable"}</dd></div>
            </dl>
            <p>Impact level reflects priority, active runs, automation readiness, locator confidence, and Story traceability. It is a review signal, not a prediction of failure.</p>
            {response.assurance_review?.limitations?.length ? <ul>{response.assurance_review.limitations.map(limitation => <li key={limitation}>{limitation}</li>)}</ul> : null}
          </details>
        </> : <p role="status">The impact preview is not available yet.</p>}
      </div>
      <footer className="story-impact-footer"><span>Preview only · Your Test Case and linked records stay unchanged.</span><button className="primary-button" type="button" onClick={onClose}>Close preview</button></footer>
    </div>
  </div>;
}
