import {
  IconAlertTriangle,
  IconArrowRight,
  IconBuildingStore,
  IconCode,
  IconExternalLink,
  IconFile,
  IconLink,
  IconMessageCircle,
  IconPaperclip,
  IconQuestionMark,
  IconRefresh,
  IconShieldCheck,
  IconSparkles
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useAiPromptRegistry } from "../hooks/useAiPromptRegistry";
import type { StoryGroomingEvidenceSource, StoryGroomingPreviewResponse } from "../types";
import { LoadingState } from "./LoadingState";
import { MetricMethodologyInfo } from "./MetricMethodologyInfo";
import "./StoryGroomingWorkspace.css";

type StoryGroomingWorkspaceProps = {
  response: StoryGroomingPreviewResponse | null;
  storyTitle: string;
  isLoading: boolean;
  error?: string | null;
  disabled?: boolean;
  onGenerate: () => void;
};

const SOURCE_LABELS: Record<string, string> = {
  story: "Story",
  comment: "Comment",
  attachment: "Attachment",
  "linked-ticket": "Linked ticket",
  "related-project-record": "Related record"
};

const SOURCE_ICONS: Record<string, ReactNode> = {
  story: <IconFile />,
  comment: <IconMessageCircle />,
  attachment: <IconPaperclip />,
  "linked-ticket": <IconLink />,
  "related-project-record": <IconLink />
};

const boundedPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value * 100)));

function EvidenceRefs({ refs, sources }: { refs: string[]; sources: Map<string, StoryGroomingEvidenceSource> }) {
  const visible = refs.map((ref) => sources.get(ref)).filter((source): source is StoryGroomingEvidenceSource => Boolean(source));
  if (!visible.length) return <span className="story-grooming-no-evidence">No additional Jira evidence</span>;

  return (
    <span aria-label="Evidence references" className="story-grooming-evidence-refs">
      {visible.slice(0, 5).map((source) => (
        <span key={source.ref} title={source.title}>
          {SOURCE_ICONS[source.type] || <IconLink />}
          {source.id}
        </span>
      ))}
      {visible.length > 5 ? <span>+{visible.length - 5}</span> : null}
    </span>
  );
}

function CompactList({ items, ordered = false }: { items: string[]; ordered?: boolean }) {
  const List = ordered ? "ol" : "ul";
  return (
    <List className={ordered ? "story-grooming-list ordered" : "story-grooming-list"}>
      {items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
    </List>
  );
}

function ReviewColumn({ icon, title, items, tone }: { icon: ReactNode; title: string; items: string[]; tone: string }) {
  return (
    <article className={`story-grooming-review-column ${tone}`}>
      <header>
        <span>{icon}</span>
        <h4>{title}</h4>
        <b>{items.length}</b>
      </header>
      <CompactList items={items} />
    </article>
  );
}

function SourceRow({ source }: { source: StoryGroomingEvidenceSource }) {
  const content = (
    <>
      <span className="story-grooming-source-icon">{SOURCE_ICONS[source.type] || <IconLink />}</span>
      <span className="story-grooming-source-copy">
        <span>
          <b>{source.title}</b>
          <small>{SOURCE_LABELS[source.type] || source.type} · {source.id}</small>
        </span>
        {source.excerpt ? <p>{source.excerpt}</p> : null}
      </span>
      {source.jira_url ? <IconExternalLink className="story-grooming-source-link-icon" /> : null}
    </>
  );

  return source.jira_url ? (
    <a className="story-grooming-source" href={source.jira_url} rel="noreferrer" target="_blank">{content}</a>
  ) : (
    <div className="story-grooming-source">{content}</div>
  );
}

export function StoryGroomingWorkspace({
  response,
  storyTitle,
  isLoading,
  error,
  disabled = false,
  onGenerate
}: StoryGroomingWorkspaceProps) {
  const { getMetricCriteria } = useAiPromptRegistry();
  if (isLoading) {
    return (
      <section aria-busy="true" className="story-grooming-workspace story-grooming-loading">
        <div className="story-grooming-loading-hero">
          <span><IconSparkles /></span>
          <div>
            <h2>Grooming this Story</h2>
            <p>Reviewing bounded Jira context, linked work, and available evidence. This does not change the Story.</p>
          </div>
        </div>
        <LoadingState label="Building evidence-backed grooming review" />
        <div aria-hidden="true" className="story-grooming-loading-grid">
          <i /><i /><i />
        </div>
      </section>
    );
  }

  if (!response) {
    return (
      <section className="story-grooming-workspace story-grooming-empty">
        <span className="story-grooming-empty-icon"><IconSparkles /></span>
        <div>
          <span className="story-grooming-eyebrow">AI Grooming · Preview only</span>
          <h2>Turn this Story into a shared review brief</h2>
          <p>
            HelloTest will explain “{storyTitle}” for business and technical reviewers, then surface assumptions,
            open questions, risks, and the Jira evidence behind them.
          </p>
          {error ? <p className="story-grooming-error" role="alert">Grooming could not be completed. {error}</p> : null}
          <button className="story-grooming-primary" disabled={disabled} onClick={onGenerate} type="button">
            <IconSparkles />
            <span>{error ? "Try again" : "Groom Story"}</span>
          </button>
        </div>
        <ul aria-label="Context reviewed">
          <li><IconMessageCircle /> Visible comments</li>
          <li><IconPaperclip /> Supported attachment text</li>
          <li><IconLink /> Project-scoped related work</li>
        </ul>
      </section>
    );
  }

  const { grooming, context } = response;
  const sourceMap = new Map(context.sources.map((source) => [source.ref, source]));
  const score = boundedPercent(response.confidence);
  const generatedAt = new Date(response.generated_at);
  const generatedLabel = Number.isNaN(generatedAt.getTime())
    ? "Generated now"
    : generatedAt.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const sourceMode = response.fallback_used ? "Deterministic fallback" : "AI-assisted";

  return (
    <section aria-labelledby="story-grooming-title" className="story-grooming-workspace">
      <header className="story-grooming-hero">
        <div className="story-grooming-confidence" aria-label={`${score}% analysis confidence`}>
          <strong>{score}</strong><span>%</span><small>confidence <MetricMethodologyInfo criteriaKey="metric.ai.evidence_grounding" evidence={`${context.sources.length} bounded Jira context source${context.sources.length === 1 ? "" : "s"}; ${sourceMode.toLowerCase()}.`} organizationCriteria={getMetricCriteria("metric.ai.evidence_grounding")} /></small>
        </div>
        <div className="story-grooming-hero-copy">
          <span className="story-grooming-eyebrow"><IconSparkles /> AI Grooming · Evidence-led review</span>
          <h2 id="story-grooming-title">Shared understanding before delivery</h2>
          <p>{grooming.layman.explanation}</p>
          <span className="story-grooming-meta">{sourceMode} · {generatedLabel} · Human review required</span>
        </div>
        <div className="story-grooming-hero-actions">
          <span className="story-grooming-preview-badge"><IconShieldCheck /> Preview only</span>
          <button className="story-grooming-refresh" disabled={disabled} onClick={onGenerate} type="button">
            <IconRefresh /> Refresh analysis
          </button>
        </div>
      </header>

      {error ? <p className="story-grooming-error" role="alert">The latest refresh failed; the previous review remains visible. {error}</p> : null}

      <section aria-label="Reviewed context" className="story-grooming-context-strip">
        <span><IconMessageCircle /><b>{context.included.comments}</b> comments</span>
        <span><IconPaperclip /><b>{context.included.attachments}</b> attachments</span>
        <span><IconLink /><b>{context.included.linked_tickets}</b> linked tickets</span>
        <span><IconFile /><b>{context.included.related_project_records}</b> related records</span>
        <small>Bounded to Jira project {context.scope.project_key}</small>
      </section>

      <div className="story-grooming-primary-grid">
        <article className="story-grooming-card story-grooming-layman-card">
          <header>
            <span className="story-grooming-section-icon"><IconSparkles /></span>
            <div><span>01 · Plain language</span><h3>What this Story means</h3></div>
          </header>
          <p className="story-grooming-lead">{grooming.layman.explanation}</p>
          <blockquote>
            <span>Analogy</span>
            {grooming.layman.analogy}
          </blockquote>
          <EvidenceRefs refs={grooming.layman.evidence_refs} sources={sourceMap} />
        </article>

        <article className="story-grooming-card story-grooming-business-card">
          <header>
            <span className="story-grooming-section-icon"><IconBuildingStore /></span>
            <div><span>02 · Business view</span><h3>Context, roles & value</h3></div>
          </header>
          <p>{grooming.business.context}</p>
          <div className="story-grooming-subsection">
            <h4>Roles and flow</h4>
            <CompactList items={grooming.business.roles_and_flow} ordered />
          </div>
          <div className="story-grooming-subsection">
            <h4>Use cases</h4>
            <CompactList items={grooming.business.use_cases} />
          </div>
          <EvidenceRefs refs={grooming.business.evidence_refs} sources={sourceMap} />
        </article>
      </div>

      <article className="story-grooming-card story-grooming-technical-card">
        <header>
          <span className="story-grooming-section-icon"><IconCode /></span>
          <div>
            <span>03 · Technical view · Review draft</span>
            <h3>Proposed technical specification</h3>
          </div>
          <span className="story-grooming-draft-badge">Confirm before implementation</span>
        </header>
        <p className="story-grooming-technical-overview">{grooming.technical.overview}</p>
        <div className="story-grooming-technical-grid">
          <section>
            <h4>Functional considerations</h4>
            <CompactList items={grooming.technical.functional_requirements} />
          </section>
          <section>
            <h4>Data & integrations</h4>
            <CompactList items={grooming.technical.data_and_integrations} />
          </section>
          <section>
            <h4>Quality attributes to confirm</h4>
            <CompactList items={grooming.technical.non_functional_requirements} />
          </section>
          <section>
            <h4>Testability notes</h4>
            <CompactList items={grooming.technical.testability_notes} />
          </section>
        </div>
        <EvidenceRefs refs={grooming.technical.evidence_refs} sources={sourceMap} />
      </article>

      <section aria-labelledby="story-grooming-review-title" className="story-grooming-review">
        <header>
          <div>
            <span>Resolve before planning</span>
            <h3 id="story-grooming-review-title">Review decisions</h3>
          </div>
          <EvidenceRefs refs={grooming.review_evidence_refs} sources={sourceMap} />
        </header>
        <div className="story-grooming-review-grid">
          <ReviewColumn icon={<IconShieldCheck />} items={grooming.assumptions} title="Assumptions" tone="assumption" />
          <ReviewColumn icon={<IconQuestionMark />} items={grooming.open_questions} title="Open questions" tone="question" />
          <ReviewColumn icon={<IconAlertTriangle />} items={grooming.risks} title="Risks" tone="risk" />
        </div>
      </section>

      <details className="story-grooming-provenance">
        <summary>
          <span><IconLink /> Evidence & provenance</span>
          <small>{context.sources.length} visible sources · bounded context</small>
          <IconArrowRight />
        </summary>
        <div className="story-grooming-provenance-body">
          <div className="story-grooming-method">
            <p>
              HelloTest used only the selected Story and bounded, project-scoped Jira evidence. It extracted short text
              excerpts from supported, size-limited attachments; binary, image, PDF, oversized, and inaccessible
              attachment content was not sent to the model. External-link content was not read. The result is advisory
              and did not update Jira.
            </p>
            <dl>
              <div><dt>Request</dt><dd>{response.request_id}</dd></div>
              <div><dt>Input fingerprint</dt><dd>{response.input_fingerprint}</dd></div>
              <div><dt>Mode</dt><dd>{sourceMode}</dd></div>
              <div><dt>Review</dt><dd>{response.requires_human_review ? "Required" : "Optional"}</dd></div>
            </dl>
            {context.unavailable_sources.length ? (
              <p className="story-grooming-unavailable">
                <IconAlertTriangle /> Unavailable context: {context.unavailable_sources.join(", ")}
              </p>
            ) : null}
            {context.partial_sources.length ? (
              <p className="story-grooming-unavailable">
                <IconAlertTriangle /> Partial context: {context.partial_sources.join(", ")}
              </p>
            ) : null}
          </div>
          <div className="story-grooming-sources">
            {context.sources.map((source) => <SourceRow key={source.ref} source={source} />)}
          </div>
        </div>
      </details>
    </section>
  );
}
