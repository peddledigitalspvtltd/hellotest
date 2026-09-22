import { cloneElement, isValidElement, useRef, useState, type ReactElement, type ReactNode } from "react";
import { IconAdjustmentsHorizontal, IconBraces, IconChartDonut, IconLayoutGrid, IconListDetails, IconRefresh, IconSearch, IconSparkles, IconX } from "@tabler/icons-react";
import { AgenticProcessRail, type AgenticFeatureProfileId, type AgenticProcessStageId, type AgenticProcessStatus, type AgenticProcessingSnapshot } from "./AgenticExperience";
import { StoryAiEvidenceReview, type StoryAiStudioDraft } from "./StoryAiStudioContent";
import "./TestCaseAiStudioModal.css";
import "./StoryAiStudioShell.css";

export type StoryAiStudioMode = "create" | "improve";
export type StoryAiStudioNavKey = "drafts" | "review" | "templates";

export type StoryAiStudioShellProps = {
  mode: StoryAiStudioMode;
  includeGherkin?: boolean;
  onIncludeGherkinChange?: (value: boolean) => void;
  includeGherkinDisabled?: boolean;
  showIncludeGherkin?: boolean;
  showOutputFormat?: boolean;
  processProfile?: AgenticFeatureProfileId;
  includeControlLabel?: string;
  primaryGenerateLabel: string;
  onPrimaryGenerate: () => void;
  primaryGenerateDisabled?: boolean;
  onClose: () => void;
  closeDisabled?: boolean;
  navActive?: StoryAiStudioNavKey;
  onNavChange?: (next: StoryAiStudioNavKey) => void;
  settingsPane: ReactNode;
  queuePane: ReactNode;
  inspectorContent: ReactNode;
  commandBar?: ReactNode;
  titleId: string;
  descriptionId?: string;
  studioTitle?: string;
  studioDescription?: string;
  entityLabel?: string;
  settingsAriaLabel?: string;
  queueAriaLabel?: string;
  inspectorAriaLabel?: string;
  agentName?: string;
  agentStatus?: AgenticProcessStatus;
  mission?: string;
  onMissionChange?: (value: string) => void;
  missionPlaceholder?: string;
  contextLabel?: string;
  integrationId?: string;
  integrations?: Array<{ id: string; name: string; model?: string | null }>;
  onIntegrationChange?: (integrationId: string) => void;
  outputLabel?: string;
  approvalLabel?: string;
  stageEvidence?: Partial<Record<AgenticProcessStageId, string>>;
  processing?: AgenticProcessingSnapshot;
  contextState?: "ready" | "attention" | "neutral";
  reviewStatus?: "awaiting_review" | "accepted" | "discarded" | string;
  hasProposal?: boolean;
};

export function StoryAiSettingsGroup({
  children,
  description,
  icon,
  title
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  description: string;
  icon?: ReactNode;
  title: string;
}) {
  return (
    <section className={`story-studio-settings-group ai-test-generator-section${title === "Generation Context" ? " ai-test-generator-context-engine" : ""}`}>
      <div className="ai-test-generator-section__heading"><span>{icon}{title}</span><small>{description}</small></div>
      <div className="story-studio-settings-group__body">{children}</div>
    </section>
  );
}

export function StoryAiStudioShell({
  mode, includeGherkin = false, onIncludeGherkinChange, includeGherkinDisabled = false,
  showOutputFormat = true, processProfile, showIncludeGherkin = true, includeControlLabel = "Include Gherkin", primaryGenerateLabel,
  onPrimaryGenerate, primaryGenerateDisabled = false, onClose, closeDisabled = false,
  settingsPane, queuePane, inspectorContent, commandBar, titleId, descriptionId,
  studioTitle, studioDescription, entityLabel = "Story", settingsAriaLabel, inspectorAriaLabel,
  agentName = "Story Architect", agentStatus = "idle", contextLabel = "Review context",
  integrationId = "", integrations = [], outputLabel, approvalLabel = "Explicit review before any saved change", stageEvidence = {}, processing,
  reviewStatus = "awaiting_review", hasProposal = true
}: StoryAiStudioShellProps) {
  const [intelligenceOpen, setIntelligenceOpen] = useState(false);
  const [draftSearch, setDraftSearch] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [outputFormat, setOutputFormat] = useState<"structured" | "gherkin">("structured");
  const intelligenceToggle = useRef<HTMLButtonElement>(null);
  const title = studioTitle || (mode === "create" ? "Create Stories using AI" : "AI Complete Story");
  const closeLabel = mode === "create" ? `Close AI ${entityLabel} creation` : `Close AI ${entityLabel} improvement`;
  const queue = isValidElement(queuePane) ? queuePane as ReactElement<{ drafts?: Array<{ title: string; description: string }>; selectedDraftIds?: string[]; activeContent?: ReactNode; searchQuery?: string; viewMode?: string }> : null;
  const draftCount = queue?.props.drafts?.length || 0;
  const hasVisibleDraft = Boolean(queue?.props.drafts?.some(draft => `${draft.title} ${draft.description}`.toLowerCase().includes(draftSearch.toLowerCase().trim())));
  const selectedCount = mode === "create" ? queue?.props.selectedDraftIds?.length || 0 : 0;
  const statusContent = isValidElement(inspectorContent) ? (inspectorContent.props as { statusContent?: ReactNode }).statusContent : null;
  const evidenceDraft = isValidElement(inspectorContent) ? (inspectorContent.props as { draft?: StoryAiStudioDraft | null }).draft : null;
  const generateAction = <button className="story-studio-primary-action" disabled={primaryGenerateDisabled} onClick={onPrimaryGenerate} type="button"><IconRefresh size={17} />{primaryGenerateLabel}</button>;
  const providerLabel = integrationId ? integrations.find(integration => integration.id === integrationId)?.name || `${integrationId} (unavailable)` : "Configured LLM";
  const inspector = isValidElement(inspectorContent)
    ? cloneElement(inspectorContent as ReactElement<{ outputFormat?: string; statusContent?: ReactNode; evidencePlacement?: string; emptyAction?: ReactNode }>, { outputFormat, statusContent: null, evidencePlacement: "intelligence", emptyAction: generateAction }) : inspectorContent;
  const stateLabel = agentStatus === "completed"
    ? !hasProposal ? "Processing complete · no proposal" : reviewStatus === "accepted" ? "Proposal accepted" : "Proposal ready · review required"
    : agentStatus === "running" ? "Generation in progress" : agentStatus === "failed" ? "Generation needs attention" : "Ready to generate";

  return (
    <section aria-describedby={descriptionId} aria-labelledby={titleId} className="story-studio-shell ai-test-generator-modal" data-mode={mode}>
      <header className="ai-test-generator-header">
        <div><IconSparkles size={20} /><h1 id={titleId}>{title}</h1></div>
        {descriptionId ? <p className="sr-only" id={descriptionId}>{studioDescription || "Configure context, generate Story drafts, and review the selected changes before saving."}</p> : null}
        <div className="ai-test-generator-header__actions">
          <label><IconSearch size={17} /><input className="story-studio-search" aria-label={`Search ${entityLabel} drafts`} onChange={event => setDraftSearch(event.target.value)} placeholder="Search drafts…" value={draftSearch} /></label>
          <button aria-controls={`${titleId}-intelligence`} aria-expanded={intelligenceOpen} aria-label={`${intelligenceOpen ? "Hide" : "Show"} intelligence status`} className={`ai-test-generator-insight-toggle${intelligenceOpen ? " is-active" : ""}`} onClick={() => setIntelligenceOpen(current => !current)} ref={intelligenceToggle} type="button"><IconChartDonut size={17} /><span>Intelligence</span></button>
          <button aria-label={closeLabel} className="ai-test-generator-close" disabled={closeDisabled} onClick={onClose} type="button"><IconX size={20} /></button>
        </div>
      </header>
      <div className={`story-studio-workbench ai-test-generator-layout${intelligenceOpen ? " is-intelligence-open" : " is-intelligence-collapsed"}`}>
        <aside aria-label={settingsAriaLabel || `${entityLabel} generation context`} className="story-studio-settings-pane ai-test-generator-context">
          <div className="ai-test-generator-pane-title"><IconAdjustmentsHorizontal size={19} /><div><strong>Context Setup</strong><span>Define the scope for AI generation.</span></div></div>
          {settingsPane}
          {showIncludeGherkin ? <section className="ai-test-generator-section"><label className="story-studio-gherkin-control"><input checked={includeGherkin} disabled={includeGherkinDisabled || !onIncludeGherkinChange} onChange={event => onIncludeGherkinChange?.(event.target.checked)} type="checkbox" />{includeControlLabel}</label><p>Generate scenarios from the supplied acceptance criteria.</p></section> : null}
        </aside>
        <main aria-label={inspectorAriaLabel || `${entityLabel} AI draft workspace`} className="story-studio-main-pane ai-test-generator-workspace">
          <div className="ai-test-generator-workspace__header">
            <div className="ai-test-generator-workspace__identity"><div><h2>{mode === "create" ? `${entityLabel} Drafts` : `${entityLabel} Completion`}</h2><p>{mode === "create" ? `Review, refine, and accept only the ${entityLabel === "Story" ? "Stories" : `${entityLabel}s`} you want.` : `Review the regenerated ${entityLabel} proposal and apply selected fields.`}</p></div><span>{mode === "create" ? `${draftCount} Generated` : hasProposal ? "Proposal ready" : "Ready to generate"}</span></div>
            <div className="ai-test-generator-view-controls">
              {showOutputFormat ? <div aria-label={`${entityLabel} output format`} className="ai-test-generator-authoring-tabs" role="radiogroup">
                <button aria-checked={outputFormat === "structured"} className={outputFormat === "structured" ? "is-active" : ""} onClick={() => setOutputFormat("structured")} role="radio" type="button"><IconListDetails size={15} />Structured</button>
                <button aria-checked={outputFormat === "gherkin"} className={outputFormat === "gherkin" ? "is-active" : ""} onClick={() => setOutputFormat("gherkin")} role="radio" type="button"><IconBraces size={15} />Gherkin</button>
              </div>
              : null}
              <div className="ai-test-generator-view-toggle" role="group" aria-label="Draft layout"><button aria-label="List view" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")} type="button"><IconListDetails size={18} /></button><button aria-label="Grid view" aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")} type="button"><IconLayoutGrid size={18} /></button></div>
            </div>
          </div>
          <div className={`ai-test-generator-toast${statusContent ? " has-message" : ""}`}>{statusContent}</div>
          <div className="story-studio-output-workspace">
            {queue ? cloneElement(queue, { activeContent: inspector, searchQuery: draftSearch, viewMode }) : inspector}
          </div>
          <footer className="story-studio-command-bar ai-test-generator-footer">
            <strong>{draftSearch && !hasVisibleDraft ? "Clear search to review drafts" : mode === "create" ? `${selectedCount} Selected` : "Review selected fields"}</strong>
            <div>{draftCount ? generateAction : null}<fieldset className="story-studio-review-actions" disabled={Boolean(draftSearch && !hasVisibleDraft)}>{commandBar}</fieldset></div>
          </footer>
        </main>
        {intelligenceOpen ? <aside aria-label={`${agentName} generation flow`} className="story-studio-flow-pane ai-test-generator-intelligence" id={`${titleId}-intelligence`} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setIntelligenceOpen(false); intelligenceToggle.current?.focus(); } }}>
          <div className="ai-test-generator-pane-title"><IconChartDonut size={19} /><div><strong>Intelligence Status</strong><span>Live progress and review boundaries.</span></div></div>
          <AgenticProcessRail agentName={agentName} compact orientation="vertical" presentation="focused" processing={processing} profile={processProfile || (mode === "create" ? "story-create" : "story-complete")} stageEvidence={stageEvidence} status={agentStatus} />
          {entityLabel === "Story" ? <StoryAiEvidenceReview draft={evidenceDraft} inline /> : null}
          <section className="ai-test-generator-session"><h3>Review summary</h3><p>{agentStatus === "completed" ? "Processing is complete; edit and accept only what you want to keep." : "Saved content stays unchanged until acceptance."}</p><dl><dt>Evidence context</dt><dd>{contextLabel}</dd><dt>Output contract</dt><dd>{outputLabel || "Editable Story drafts"}</dd><dt>Human gate</dt><dd>{approvalLabel}</dd></dl></section>
        </aside> : null}
      </div>
      <footer className="ai-test-generator-status-footer"><span>© {new Date().getFullYear()} HelloTest QA Intelligence</span><div><span>LLM: {providerLabel}</span><span aria-live="polite" role="status">{stateLabel}</span></div></footer>
    </section>
  );
}
