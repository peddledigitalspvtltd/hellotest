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
import { useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type {
  StoryGroomingEvidenceSource,
  StoryGroomingPreviewResponse,
  StoryGroomingReadiness,
  StoryGroomingReadinessCheck
} from "../types";
import { LoadingState } from "./LoadingState";
import "./StoryGroomingWorkspace.css";

type StoryGroomingWorkspaceProps = {
  response: StoryGroomingPreviewResponse | null;
  storyTitle: string;
  storyUpdatedAt?: string | null;
  supportingContextChanged?: boolean;
  isLoading: boolean;
  error?: string | null;
  disabled?: boolean;
  onGenerate: () => void;
  providerControl?: ReactNode;
};

type GroomingTab = "story" | "business" | "solution" | "validation" | "remaining" | "evidence";

type ContentGroup = {
  title: string;
  items: string[];
  ordered?: boolean;
};

const SOURCE_LABELS: Record<string, string> = {
  story: "Story",
  comment: "Comment",
  attachment: "Attachment metadata",
  "external-reference": "External reference",
  "linked-ticket": "Linked Defect",
  "related-project-record": "Linked Test Case"
};

const SOURCE_ICONS: Record<string, ReactNode> = {
  story: <IconFile />,
  comment: <IconMessageCircle />,
  attachment: <IconPaperclip />,
  "external-reference": <IconLink />,
  "linked-ticket": <IconLink />,
  "related-project-record": <IconLink />
};

const EVIDENCE_GROUPS: Array<{ key: string; label: string; helper: string; types: Set<string> }> = [
  {
    key: "story",
    label: "Story evidence",
    helper: "The selected Story and bounded comments",
    types: new Set(["story", "comment"])
  },
  {
    key: "linked",
    label: "Linked work",
    helper: "Traceable Test Cases and Defects",
    types: new Set(["related-project-record", "linked-ticket"])
  },
  {
    key: "pointers",
    label: "Pointers and metadata",
    helper: "Unread attachments and external references",
    types: new Set(["attachment", "external-reference"])
  }
];

const LEGACY_FILLER = [
  /^identify the primary user, trigger, expected outcome, and failure recovery path\.?$/i,
  /^document the primary success path\.?$/i,
  /^document validation, permission, and recovery paths\.?$/i,
  /^define observable inputs, state changes, and outputs\.?$/i,
  /^define validation and permission boundaries\.?$/i,
  /^confirm security, accessibility, reliability, and performance expectations appropriate to the flow\.?$/i,
  /^no external integration reference is currently recorded\.?$/i
];

const LEGACY_EMPTY_TEXT = /^(?:business context is not (?:yet |explicitly )?documented|technical behavior is not (?:yet )?(?:specified|explicitly documented))\.?$/i;
const LEGACY_ANALOGY = /^treat this story as a shared contract:/i;

const cleanItems = (items?: string[]) => {
  const seen = new Set<string>();
  return (items || [])
    .map((item) => String(item || "").trim())
    .filter((item) => {
      const key = item.toLocaleLowerCase();
      if (!item || seen.has(key) || LEGACY_FILLER.some((pattern) => pattern.test(item))) return false;
      seen.add(key);
      return true;
    });
};

const meaningfulText = (value?: string | null) => {
  const text = String(value || "").trim();
  return text && !LEGACY_EMPTY_TEXT.test(text) ? text : "";
};

const READINESS_META: Record<string, { label: string; helper: string; tone: string; icon: ReactNode }> = {
  "ready-for-planning": {
    label: "Ready for planning review",
    helper: "Core evidence is present; team approval is still required.",
    tone: "ready",
    icon: <IconShieldCheck />
  },
  "needs-clarification": {
    label: "Needs alignment",
    helper: "Resolve the highlighted decisions before planning.",
    tone: "clarify",
    icon: <IconQuestionMark />
  },
  "not-ready": {
    label: "Not ready for planning",
    helper: "Core intent or acceptance evidence is missing.",
    tone: "blocked",
    icon: <IconAlertTriangle />
  }
};

const TABS: Array<{ key: GroomingTab; shortLabel: string; icon: ReactNode }> = [
  { key: "story", shortLabel: "Story", icon: <IconSparkles /> },
  { key: "business", shortLabel: "Business", icon: <IconBuildingStore /> },
  { key: "solution", shortLabel: "Solution", icon: <IconCode /> },
  { key: "validation", shortLabel: "Validation", icon: <IconShieldCheck /> },
  { key: "remaining", shortLabel: "Remaining", icon: <IconQuestionMark /> },
  { key: "evidence", shortLabel: "Evidence", icon: <IconLink /> }
];

function GroomingContainer({ children }: { children: ReactNode }) {
  return <div className="story-grooming-container">{children}</div>;
}

function EvidenceRefs({ refs, sources }: { refs?: string[]; sources: Map<string, StoryGroomingEvidenceSource> }) {
  const visible = (refs || []).map((ref) => sources.get(ref)).filter((source): source is StoryGroomingEvidenceSource => Boolean(source));
  if (!visible.length) return <span className="story-grooming-no-evidence"><IconAlertTriangle /> Needs source confirmation</span>;

  return (
    <span aria-label="Evidence references" className="story-grooming-evidence-refs">
      {visible.slice(0, 4).map((source) => (
        <span key={source.ref} title={source.title}>
          {SOURCE_ICONS[source.type] || <IconLink />}
          {source.id}
        </span>
      ))}
      {visible.length > 4 ? <span>+{visible.length - 4}</span> : null}
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

function MissingState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="story-grooming-missing">
      <IconQuestionMark />
      <span><b>{title}</b><small>{detail}</small></span>
    </div>
  );
}

function ContentGroups({ groups }: { groups: ContentGroup[] }) {
  const visible = groups.filter((group) => group.items.length);
  if (!visible.length) return null;
  return (
    <div className="story-grooming-content-groups">
      {visible.map((group) => (
        <section key={group.title}>
          <h4>{group.title}</h4>
          <CompactList items={group.items} ordered={group.ordered} />
        </section>
      ))}
    </div>
  );
}

function ReadinessCheckRow({
  item,
  sources
}: {
  item: StoryGroomingReadinessCheck;
  sources: Map<string, StoryGroomingEvidenceSource>;
}) {
  const status = item.status === "met" ? "met" : item.status === "partial" ? "partial" : "missing";
  const icon = status === "met" ? <IconShieldCheck /> : status === "partial" ? <IconQuestionMark /> : <IconAlertTriangle />;
  return (
    <li className={`story-grooming-check ${status}`}>
      <span>{icon}</span>
      <span>
        <b>{item.label}</b>
        {item.detail ? <small>{item.detail}</small> : null}
        {status !== "missing" ? <EvidenceRefs refs={item.evidence_refs} sources={sources} /> : null}
      </span>
      <em>{status === "met" ? "Covered" : status === "partial" ? "Confirm" : "Missing"}</em>
    </li>
  );
}

function ReviewColumn({ icon, title, items, tone, emptyText }: { icon: ReactNode; title: string; items: string[]; tone: string; emptyText: string }) {
  return (
    <article className={`story-grooming-review-column ${tone}`}>
      <header>
        <span>{icon}</span>
        <h3>{title}</h3>
        <b>{items.length}</b>
      </header>
      {items.length ? <CompactList items={items} /> : <p>{emptyText}</p>}
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
  storyUpdatedAt,
  supportingContextChanged = false,
  isLoading,
  error,
  disabled = false,
  onGenerate,
  providerControl
}: StoryGroomingWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<GroomingTab>("story");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (isLoading) {
    return (
      <GroomingContainer>
        <LoadingState label="Building an evidence-backed readiness brief" description="Reviewing the Story, comments, linked work, Defects, and available attachment metadata. No Story fields are changed." />
      </GroomingContainer>
    );
  }

  if (!response) {
    return (
      <GroomingContainer>
        <section className="story-grooming-workspace story-grooming-empty">
          <span className="story-grooming-empty-icon"><IconSparkles /></span>
          <div>
            <span className="story-grooming-eyebrow">AI Grooming · Preview only</span>
            <h2>Build a decision-ready refinement brief</h2>
            <p>
              Review “{storyTitle}” across plain-language intent, business value, delivery behavior, acceptance,
              dependencies, risks, and planning readiness—using only bounded Story evidence.
            </p>
            {error ? <p className="story-grooming-error" role="alert">Grooming could not be completed. {error}</p> : null}
            {providerControl}
            <button className="story-grooming-primary" disabled={disabled} onClick={onGenerate} type="button">
              <IconSparkles />
              <span>{error ? "Try again" : "Generate refinement"}</span>
            </button>
          </div>
          <ul aria-label="Context reviewed">
            <li><IconMessageCircle /> Visible comments</li>
            <li><IconPaperclip /> Attachment names and metadata</li>
            <li><IconLink /> Project-scoped linked work</li>
          </ul>
        </section>
      </GroomingContainer>
    );
  }

  const { grooming, context } = response;
  const sourceMap = new Map(context.sources.map((source) => [source.ref, source]));
  const groupedSourceRefs = new Set(EVIDENCE_GROUPS.flatMap((group) => [...group.types]));
  const evidenceGroups = [
    ...EVIDENCE_GROUPS.map((group) => ({
      ...group,
      sources: context.sources.filter((source) => group.types.has(source.type))
    })),
    {
      key: "other",
      label: "Other supporting records",
      helper: "Additional bounded project evidence",
      types: new Set<string>(),
      sources: context.sources.filter((source) => !groupedSourceRefs.has(source.type))
    }
  ].filter((group) => group.sources.length);
  const generatedAt = new Date(response.generated_at);
  const updatedAt = storyUpdatedAt ? new Date(storyUpdatedAt) : null;
  const isStale = Boolean(
    supportingContextChanged
    || (updatedAt && !Number.isNaN(updatedAt.getTime()) && !Number.isNaN(generatedAt.getTime()) && updatedAt > generatedAt)
  );
  const generatedLabel = Number.isNaN(generatedAt.getTime())
    ? "Generated now"
    : generatedAt.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const sourceMode = response.generation_mode === "hybrid"
    ? "AI-assisted · evidence fallback"
    : response.fallback_used
      ? "Evidence-only fallback"
      : "AI-assisted";
  const fallbackReason = meaningfulText(response.fallback_reason);
  const fallbackSections = cleanItems(response.fallback_sections);
  const readiness: StoryGroomingReadiness = grooming.readiness || {
    status: "needs-clarification",
    summary: "Review the available evidence and resolve open decisions before planning.",
    checks: [],
    gaps: cleanItems(grooming.open_questions),
    next_actions: []
  };
  const readinessMeta = READINESS_META[readiness.status] || READINESS_META["needs-clarification"];
  const checks = readiness.checks || [];
  const walkthrough = grooming.walkthrough;
  const hasWalkthrough = Boolean(walkthrough);
  const purposeSummary = meaningfulText(walkthrough?.purpose?.summary)
    || (!hasWalkthrough ? meaningfulText(grooming.layman.explanation) : "");
  const whyNeeded = meaningfulText(walkthrough?.purpose?.why_needed)
    || (!hasWalkthrough ? meaningfulText(grooming.business.context) : "");
  const expectedOutcomes = cleanItems(hasWalkthrough ? walkthrough?.purpose?.expected_outcomes : []);
  const analogy = !hasWalkthrough && meaningfulText(grooming.layman.analogy) && !LEGACY_ANALOGY.test(grooming.layman.analogy)
    ? grooming.layman.analogy.trim()
    : "";

  const journeySummary = meaningfulText(walkthrough?.user_journey?.summary);
  const journeyActors = cleanItems(hasWalkthrough ? walkthrough?.user_journey?.actors : grooming.business.stakeholders);
  const journeyTrigger = meaningfulText(walkthrough?.user_journey?.trigger);
  const journeySteps = cleanItems(hasWalkthrough ? walkthrough?.user_journey?.steps : grooming.business.roles_and_flow);
  const journeyUseCases = cleanItems(hasWalkthrough ? walkthrough?.user_journey?.use_cases : grooming.business.use_cases);
  const alternatePaths = cleanItems(hasWalkthrough ? walkthrough?.user_journey?.alternate_paths : []);

  const businessSummary = meaningfulText(walkthrough?.business_impact?.summary);
  const businessStakeholdersRaw = cleanItems(hasWalkthrough ? walkthrough?.business_impact?.stakeholders : []);
  const actorKeys = new Set(journeyActors.map((item) => item.toLocaleLowerCase()));
  const businessStakeholders = businessStakeholdersRaw.filter((item) => !actorKeys.has(item.toLocaleLowerCase()));
  const expectedOutcomeKeys = new Set(expectedOutcomes.map((item) => item.toLocaleLowerCase()));
  const valueOutcomesRaw = cleanItems(hasWalkthrough ? walkthrough?.business_impact?.value_outcomes : grooming.business.outcomes);
  const valueOutcomes = valueOutcomesRaw
    .filter((item) => !expectedOutcomeKeys.has(item.toLocaleLowerCase()));
  const successMeasures = cleanItems(hasWalkthrough ? walkthrough?.business_impact?.success_measures : grooming.business.success_measures);
  const businessItemsCoveredInStory = businessStakeholdersRaw.length > businessStakeholders.length
    || valueOutcomesRaw.length > valueOutcomes.length;

  const designOverview = meaningfulText(walkthrough?.solution_design?.overview)
    || (!hasWalkthrough ? meaningfulText(grooming.technical.overview) : "");
  const solutionBehaviors = cleanItems(hasWalkthrough ? walkthrough?.solution_design?.behaviors : grooming.technical.functional_requirements);
  const solutionRules = cleanItems(hasWalkthrough ? walkthrough?.solution_design?.rules : []);
  const dependencies = cleanItems(hasWalkthrough ? walkthrough?.solution_design?.dependencies : grooming.technical.dependencies);
  const constraints = cleanItems(hasWalkthrough ? walkthrough?.solution_design?.constraints : grooming.technical.constraints);
  const implementationOverview = meaningfulText(walkthrough?.implementation?.overview);
  const components = cleanItems(hasWalkthrough ? walkthrough?.implementation?.components : []);
  const implementationData = cleanItems(hasWalkthrough ? walkthrough?.implementation?.data : []);
  const integrations = cleanItems(hasWalkthrough ? walkthrough?.implementation?.integrations : grooming.technical.data_and_integrations);
  const legacyQuality = cleanItems([
    ...cleanItems(grooming.technical.non_functional_requirements),
    ...cleanItems(grooming.technical.security_and_privacy),
    ...cleanItems(grooming.technical.observability)
  ]);
  const qualityRequirements = cleanItems(hasWalkthrough ? walkthrough?.implementation?.quality_requirements : legacyQuality);
  const inScope = cleanItems(grooming.scope?.in_scope);
  const outOfScope = cleanItems(grooming.scope?.out_of_scope);

  const validationSummary = meaningfulText(walkthrough?.validation?.summary);
  const acceptanceCriteria = cleanItems(hasWalkthrough ? walkthrough?.validation?.acceptance_criteria : grooming.technical.acceptance_criteria);
  const testScenarios = cleanItems(hasWalkthrough ? walkthrough?.validation?.test_scenarios : []);
  const validationEdgeCases = cleanItems(hasWalkthrough ? walkthrough?.validation?.edge_cases : grooming.technical.edge_cases);
  const linkedTestCoverage = cleanItems(hasWalkthrough ? walkthrough?.validation?.linked_test_coverage : grooming.technical.testability_notes);

  const assumptions = cleanItems(grooming.assumptions);
  const remainingSummary = meaningfulText(walkthrough?.remaining?.summary);
  const questions = cleanItems(hasWalkthrough ? walkthrough?.remaining?.questions : grooming.open_questions);
  const risks = cleanItems(hasWalkthrough ? walkthrough?.remaining?.risks : grooming.risks);
  const decisions = cleanItems(walkthrough?.remaining?.decisions);
  const actions = cleanItems(hasWalkthrough ? walkthrough?.remaining?.actions : readiness.next_actions);
  const resolvedDecisionKeys = new Set([...questions, ...risks, ...decisions, ...assumptions].map((item) => item.toLocaleLowerCase()));
  const remainingGaps = cleanItems(hasWalkthrough ? walkthrough?.remaining?.gaps : readiness.gaps)
    .filter((item) => !resolvedDecisionKeys.has(item.toLocaleLowerCase()));
  const purposeEvidenceRefs = hasWalkthrough ? walkthrough?.purpose?.evidence_refs : grooming.layman.evidence_refs;
  const journeyEvidenceRefs = hasWalkthrough ? walkthrough?.user_journey?.evidence_refs : grooming.business.evidence_refs;
  const businessEvidenceRefs = hasWalkthrough ? walkthrough?.business_impact?.evidence_refs : grooming.business.evidence_refs;
  const designEvidenceRefs = cleanItems([
    ...(hasWalkthrough ? walkthrough?.solution_design?.evidence_refs || [] : grooming.technical.evidence_refs),
    ...(grooming.scope?.evidence_refs || [])
  ]);
  const implementationEvidenceRefs = hasWalkthrough ? walkthrough?.implementation?.evidence_refs : grooming.technical.evidence_refs;
  const validationEvidenceRefs = hasWalkthrough ? walkthrough?.validation?.evidence_refs : grooming.technical.evidence_refs;
  const remainingEvidenceRefs = hasWalkthrough ? walkthrough?.remaining?.evidence_refs : grooming.review_evidence_refs;
  const hasJourneyEvidence = Boolean(journeySummary || journeyTrigger || journeyActors.length || journeySteps.length || journeyUseCases.length || alternatePaths.length);
  const hasBusinessEvidence = Boolean(businessSummary || businessStakeholdersRaw.length || valueOutcomesRaw.length || successMeasures.length);
  const hasValidationEvidence = Boolean(validationSummary || acceptanceCriteria.length || testScenarios.length || validationEdgeCases.length || linkedTestCoverage.length);

  const storyCount = expectedOutcomes.length + journeyActors.length + journeySteps.length + journeyUseCases.length + alternatePaths.length
    + (purposeSummary ? 1 : 0) + (whyNeeded ? 1 : 0) + (journeySummary ? 1 : 0) + (journeyTrigger ? 1 : 0);
  const businessCount = businessStakeholders.length + valueOutcomes.length + successMeasures.length + (businessSummary ? 1 : 0);
  const solutionCount = [
    ...solutionBehaviors,
    ...solutionRules,
    ...dependencies,
    ...constraints,
    ...components,
    ...implementationData,
    ...integrations,
    ...qualityRequirements,
    ...inScope,
    ...outOfScope
  ].length + (designOverview ? 1 : 0) + (implementationOverview ? 1 : 0);
  const validationCount = acceptanceCriteria.length + testScenarios.length + validationEdgeCases.length + linkedTestCoverage.length + (validationSummary ? 1 : 0);
  const remainingCount = cleanItems([...questions, ...risks, ...decisions, ...assumptions, ...remainingGaps, ...actions]).length
    + (remainingSummary ? 1 : 0);
  const tabCounts: Partial<Record<GroomingTab, number>> = {
    story: storyCount,
    business: businessCount,
    solution: solutionCount,
    validation: validationCount,
    remaining: remainingCount,
    evidence: context.sources.length
  };

  const selectTab = (index: number) => {
    const normalizedIndex = (index + TABS.length) % TABS.length;
    setActiveTab(TABS[normalizedIndex].key);
    tabRefs.current[normalizedIndex]?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectTab(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectTab(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectTab(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectTab(TABS.length - 1);
    }
  };

  return (
    <GroomingContainer>
      <section aria-labelledby="story-grooming-title" className="story-grooming-workspace">
      <header className="story-grooming-hero">
        <div className={`story-grooming-readiness-mark ${readinessMeta.tone}`}>
          <span>{readinessMeta.icon}</span>
          <div><small>Planning readiness</small><strong>{readinessMeta.label}</strong></div>
        </div>
        <div className="story-grooming-hero-copy">
          <span className="story-grooming-eyebrow"><IconSparkles /> AI Grooming · Evidence-led review</span>
          <h2 id="story-grooming-title">Story refinement brief</h2>
          <p>A cross-functional walkthrough of “{storyTitle}” from user intent through build, validation, and remaining decisions.</p>
          <span className="story-grooming-meta">
            {sourceMode} · {generatedLabel} · Status {response.requirement.status || "not recorded"}
            {response.requirement.priority != null ? ` · Priority ${response.requirement.priority}` : ""}
          </span>
        </div>
        <div className="story-grooming-hero-actions">
          {providerControl}
          <span className="story-grooming-preview-badge"><IconShieldCheck /> Preview · Human review</span>
          <button className="story-grooming-refresh" disabled={disabled} onClick={onGenerate} type="button">
            <IconRefresh /> Refresh brief
          </button>
        </div>
      </header>

      {isStale ? (
        <p className="story-grooming-warning" role="status">
          <IconAlertTriangle /> This Story or its supporting evidence changed after the brief was generated. Refresh before using the readiness outcome.
        </p>
      ) : null}
      {error ? <p className="story-grooming-error" role="alert">The latest refresh failed; the previous brief remains visible. {error}</p> : null}
      {fallbackReason ? <p className="story-grooming-fallback-note" role="status"><IconAlertTriangle /> {fallbackReason}</p> : null}

      <section aria-label="Reviewed context" className="story-grooming-context-strip">
        <span><IconFile /><b>{context.sources.length}</b> sources</span>
        {context.included.comments ? <span><IconMessageCircle /><b>{context.included.comments}</b> comments</span> : null}
        {context.included.attachments ? <span><IconPaperclip /><b>{context.included.attachments}</b> attachment records</span> : null}
        {context.included.linked_tickets + context.included.related_project_records ? (
          <span><IconLink /><b>{context.included.linked_tickets + context.included.related_project_records}</b> linked items</span>
        ) : null}
        <small>Bounded to project {context.scope.project_key}</small>
      </section>

      <nav aria-label="Grooming brief sections" className="story-grooming-tabs" role="tablist">
        {TABS.map((tab, index) => (
          <button
            aria-controls={`story-grooming-panel-${tab.key}`}
            aria-selected={activeTab === tab.key}
            className={activeTab === tab.key ? "active" : ""}
            id={`story-grooming-tab-${tab.key}`}
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            ref={(node) => { tabRefs.current[index] = node; }}
            role="tab"
            tabIndex={activeTab === tab.key ? 0 : -1}
            type="button"
          >
            <span>{tab.icon}<b>{tab.shortLabel}</b></span>
            {tabCounts[tab.key] ? <small aria-label={`${tabCounts[tab.key]} items`}>{tabCounts[tab.key]}</small> : null}
          </button>
        ))}
      </nav>

      <section
        aria-labelledby="story-grooming-tab-story"
        className="story-grooming-panel story-grooming-story"
        hidden={activeTab !== "story"}
        id="story-grooming-panel-story"
        role="tabpanel"
        tabIndex={0}
      >
        <div className="story-grooming-story-summary">
          <article className="story-grooming-card story-grooming-section-card">
            <header>
              <span className="story-grooming-section-icon"><IconSparkles /></span>
              <div><span>Purpose and why</span><h3>Agree on the intended outcome</h3></div>
              <EvidenceRefs refs={purposeEvidenceRefs} sources={sourceMap} />
            </header>
            {purposeSummary ? <p className="story-grooming-lead">{purposeSummary}</p> : (
              <MissingState title="Purpose needs confirmation" detail="The available Story evidence is not specific enough to explain the intended change without guessing." />
            )}
            {whyNeeded ? <div className="story-grooming-callout"><b>Why it is needed</b><p>{whyNeeded}</p></div> : (
              <MissingState title="Why this matters is missing" detail="State the user, operational, or business problem this Story needs to solve." />
            )}
            {expectedOutcomes.length ? <ContentGroups groups={[{ title: "Expected outcomes", items: expectedOutcomes }]} /> : null}
            {analogy ? <blockquote className="story-grooming-analogy"><span>Plain-language aid</span>{analogy}</blockquote> : null}
          </article>

          <article className={`story-grooming-card story-grooming-readiness-card ${readinessMeta.tone}`}>
            <header>
              <span className="story-grooming-section-icon">{readinessMeta.icon}</span>
              <div><span>Planning readiness</span><h3>{readinessMeta.label}</h3></div>
            </header>
            <p className="story-grooming-lead">{readiness.summary || readinessMeta.helper}</p>
            {checks.length ? (
              <details className="story-grooming-readiness-details">
                <summary>Review {checks.length} readiness checks <IconArrowRight /></summary>
                <ul aria-label="Readiness checks" className="story-grooming-checks">
                  {checks.map((item, index) => <ReadinessCheckRow item={item} key={item.id || `${item.label}-${index}`} sources={sourceMap} />)}
                </ul>
              </details>
            ) : <MissingState title="Readiness checks unavailable" detail="Refresh the brief, then review readiness with the team." />}
          </article>
        </div>

        <article className="story-grooming-card story-grooming-section-card story-grooming-journey-card">
          <header>
            <span className="story-grooming-section-icon"><IconMessageCircle /></span>
            <div><span>User and operational journey</span><h3>Confirm actors, trigger, ordered steps, and alternate paths</h3></div>
            <EvidenceRefs refs={journeyEvidenceRefs} sources={sourceMap} />
          </header>
          {hasJourneyEvidence ? (
            <>
              {journeySummary ? <p className="story-grooming-lead">{journeySummary}</p> : null}
              {journeyTrigger ? <div className="story-grooming-trigger"><b>Trigger</b><span>{journeyTrigger}</span></div> : (
                <MissingState title="Trigger needs confirmation" detail="Record the event or condition that starts this journey." />
              )}
              <ContentGroups groups={[
                { title: "Actors", items: journeyActors },
                { title: "Ordered journey", items: journeySteps, ordered: true },
                { title: "Use cases", items: journeyUseCases },
                { title: "Alternate and recovery paths", items: alternatePaths }
              ]} />
              {!journeyActors.length ? (
                <MissingState title="Actors need confirmation" detail="Name who initiates, participates in, and receives the outcome of this Story." />
              ) : null}
              {!journeySteps.length ? (
                <MissingState title="Journey needs confirmation" detail="Record the primary steps, handoffs, outcome, and recovery path in sequence." />
              ) : null}
            </>
          ) : (
            <MissingState title="The user journey is not evidenced" detail="Confirm actors, trigger, ordered steps, handoffs, and alternate or recovery paths." />
          )}
        </article>
      </section>

      <section
        aria-labelledby="story-grooming-tab-business"
        className="story-grooming-panel story-grooming-business"
        hidden={activeTab !== "business"}
        id="story-grooming-panel-business"
        role="tabpanel"
        tabIndex={0}
      >
        <article className="story-grooming-card story-grooming-section-card">
          <header>
            <span className="story-grooming-section-icon"><IconBuildingStore /></span>
            <div><span>Business view</span><h3>Connect the change to measurable value</h3></div>
            <EvidenceRefs refs={businessEvidenceRefs} sources={sourceMap} />
          </header>
          {hasBusinessEvidence ? (
            <>
              {businessSummary ? <p className="story-grooming-lead">{businessSummary}</p> : null}
              <ContentGroups groups={[
                { title: "Affected stakeholders", items: businessStakeholders },
                { title: "Value outcomes", items: valueOutcomes },
                { title: "Success measures", items: successMeasures }
              ]} />
              {businessItemsCoveredInStory ? (
                <p className="story-grooming-dedup-note"><IconShieldCheck /> Shared actors or outcomes are already shown in Story and are not repeated here.</p>
              ) : null}
              {!valueOutcomesRaw.length && !successMeasures.length ? (
                <MissingState title="Value is not measurable yet" detail="Add an observable business outcome or success signal before planning." />
              ) : null}
            </>
          ) : (
            <MissingState title="Business impact is not evidenced" detail="Confirm affected stakeholders, expected value, and how success will be observed." />
          )}
        </article>
      </section>

      <section
        aria-labelledby="story-grooming-tab-solution"
        className="story-grooming-panel story-grooming-solution"
        hidden={activeTab !== "solution"}
        id="story-grooming-panel-solution"
        role="tabpanel"
        tabIndex={0}
      >
        <div className="story-grooming-solution-grid">
          <article className="story-grooming-card story-grooming-section-card">
            <header>
              <span className="story-grooming-section-icon"><IconSparkles /></span>
              <div><span>01 · Solution design</span><h3>Define behavior, rules, and boundaries</h3></div>
              <EvidenceRefs refs={designEvidenceRefs} sources={sourceMap} />
            </header>
            {designOverview ? <p className="story-grooming-lead">{designOverview}</p> : null}
            <ContentGroups groups={[
              { title: "Behaviors", items: solutionBehaviors },
              { title: "Rules", items: solutionRules },
              { title: "Dependencies", items: dependencies },
              { title: "Constraints", items: constraints },
              { title: "In scope", items: inScope },
              { title: "Out of scope", items: outOfScope }
            ]} />
            {!designOverview && !solutionBehaviors.length && !solutionRules.length && !dependencies.length && !constraints.length && !inScope.length && !outOfScope.length ? (
              <MissingState title="Solution design needs confirmation" detail="Document observable behavior, governing rules, dependencies, constraints, and scope boundaries." />
            ) : null}
          </article>

          <article className="story-grooming-card story-grooming-section-card">
            <header>
              <span className="story-grooming-section-icon"><IconCode /></span>
              <div><span>02 · Implementation</span><h3>Identify components, data, integrations, and quality needs</h3></div>
              <EvidenceRefs refs={implementationEvidenceRefs} sources={sourceMap} />
            </header>
            {implementationOverview ? <p className="story-grooming-lead">{implementationOverview}</p> : null}
            <ContentGroups groups={[
              { title: "Components", items: components },
              { title: "Data", items: implementationData },
              { title: "Integrations", items: integrations },
              { title: "Quality requirements", items: qualityRequirements }
            ]} />
            {!implementationOverview && !components.length && !implementationData.length && !integrations.length && !qualityRequirements.length ? (
              <MissingState title="Implementation evidence is missing" detail="Confirm affected components, data, integrations, and applicable quality expectations." />
            ) : null}
          </article>
        </div>
      </section>

      <section
        aria-labelledby="story-grooming-tab-validation"
        className="story-grooming-panel story-grooming-validation"
        hidden={activeTab !== "validation"}
        id="story-grooming-panel-validation"
        role="tabpanel"
        tabIndex={0}
      >
        <article className="story-grooming-card story-grooming-section-card">
          <header>
            <span className="story-grooming-section-icon"><IconShieldCheck /></span>
            <div><span>Validation view</span><h3>Define observable proof before delivery starts</h3></div>
            <EvidenceRefs refs={validationEvidenceRefs} sources={sourceMap} />
          </header>
          {hasValidationEvidence ? (
            <>
              {validationSummary ? <p className="story-grooming-lead">{validationSummary}</p> : null}
              <ContentGroups groups={[
                { title: "Acceptance criteria", items: acceptanceCriteria },
                { title: "Test scenarios", items: testScenarios },
                { title: "Edge and failure cases", items: validationEdgeCases },
                { title: "Linked test coverage", items: linkedTestCoverage }
              ]} />
              {!acceptanceCriteria.length ? (
                <MissingState title="Acceptance is not observable yet" detail="Add outcome-focused criteria that a reviewer or test can verify." />
              ) : null}
              {!testScenarios.length && !validationEdgeCases.length ? (
                <MissingState title="Test scenarios need confirmation" detail="Cover the primary outcome plus relevant validation, permission, failure, and recovery paths." />
              ) : null}
              {!linkedTestCoverage.length ? (
                <MissingState title="Coverage evidence is missing" detail="Link or define traceable test coverage before readiness approval." />
              ) : null}
            </>
          ) : (
            <MissingState title="Validation evidence is missing" detail="Define observable acceptance, relevant scenarios, and traceable test coverage." />
          )}
        </article>
      </section>

      <section
        aria-labelledby="story-grooming-tab-remaining"
        className="story-grooming-panel story-grooming-remaining"
        hidden={activeTab !== "remaining"}
        id="story-grooming-panel-remaining"
        role="tabpanel"
        tabIndex={0}
      >
        <header className="story-grooming-panel-heading">
          <div><span>Resolve and align</span><h2>Close the remaining decisions before planning</h2></div>
          <EvidenceRefs refs={remainingEvidenceRefs} sources={sourceMap} />
        </header>
        {remainingSummary ? <p className="story-grooming-panel-summary">{remainingSummary}</p> : null}
        {questions.length || risks.length || decisions.length || assumptions.length ? (
          <div className="story-grooming-review-grid">
            {questions.length ? <ReviewColumn icon={<IconQuestionMark />} items={questions} title="Open questions" tone="question" emptyText="" /> : null}
            {decisions.length ? <ReviewColumn icon={<IconArrowRight />} items={decisions} title="Decisions needed" tone="decision" emptyText="" /> : null}
            {risks.length ? <ReviewColumn icon={<IconAlertTriangle />} items={risks} title="Observed risks" tone="risk" emptyText="" /> : null}
            {assumptions.length ? <ReviewColumn icon={<IconShieldCheck />} items={assumptions} title="Documented assumptions" tone="assumption" emptyText="" /> : null}
          </div>
        ) : (
          <article className="story-grooming-card">
            <MissingState title="No unresolved item was derived" detail="Confirm the Story with product, engineering, and QA; absence of a detected issue is not approval." />
          </article>
        )}
        {remainingGaps.length || actions.length ? (
          <article className="story-grooming-card story-grooming-follow-up-card">
            <header>
              <span className="story-grooming-section-icon"><IconArrowRight /></span>
              <div><span>Follow-through</span><h3>Gaps and next grooming actions</h3></div>
            </header>
            <ContentGroups groups={[
              { title: "Readiness gaps", items: remainingGaps },
              { title: "Next actions", items: actions, ordered: true }
            ]} />
          </article>
        ) : null}
      </section>

      <section
        aria-labelledby="story-grooming-tab-evidence"
        className="story-grooming-panel story-grooming-evidence"
        hidden={activeTab !== "evidence"}
        id="story-grooming-panel-evidence"
        role="tabpanel"
        tabIndex={0}
      >
        <article className="story-grooming-card story-grooming-method">
          <header><div><span>Run details</span><h3>Boundaries and provenance</h3></div></header>
          <p>
            The brief used the selected Story and project-scoped records listed here. Attachment names, MIME types,
            and sizes were available, but attachment bodies and external-link contents were not read. The result is
            advisory and did not update the Story. Refresh after changing Story details, comments, attachments, or linked work.
          </p>
          <dl>
            <div><dt>Request</dt><dd>{response.request_id}</dd></div>
            <div><dt>Input fingerprint</dt><dd>{response.input_fingerprint}</dd></div>
            <div><dt>Mode</dt><dd>{sourceMode}</dd></div>
            {fallbackReason ? <div className="story-grooming-method-reason"><dt>Fallback detail</dt><dd>{fallbackReason}</dd></div> : null}
            <div><dt>Human review</dt><dd>{response.requires_human_review ? "Required" : "Optional"}</dd></div>
          </dl>
          {fallbackSections.length ? (
            <p className="story-grooming-fallback-sections"><b>Evidence fallback sections:</b> {fallbackSections.join(", ")}</p>
          ) : null}
          {context.unavailable_sources.length ? (
            <p className="story-grooming-unavailable"><IconAlertTriangle /> Unavailable: {context.unavailable_sources.join(", ")}</p>
          ) : null}
          {context.partial_sources.length ? (
            <p className="story-grooming-unavailable"><IconAlertTriangle /> Partial: {context.partial_sources.join(", ")}</p>
          ) : null}
        </article>
        {evidenceGroups.length ? (
          <div className="story-grooming-source-groups">
            {evidenceGroups.map((group) => (
              <details className="story-grooming-source-group" key={group.key}>
                <summary>
                  <span><b>{group.label}</b><small>{group.helper}</small></span>
                  <em>{group.sources.length}</em>
                  <IconArrowRight />
                </summary>
                <div aria-label={`${group.label} sources`} className="story-grooming-sources" role="region" tabIndex={0}>
                  {group.sources.map((source) => <SourceRow key={source.ref} source={source} />)}
                </div>
              </details>
            ))}
          </div>
        ) : <MissingState title="No evidence sources are available" detail="Refresh after adding Story details or project-scoped supporting records." />}
      </section>
      </section>
    </GroomingContainer>
  );
}
