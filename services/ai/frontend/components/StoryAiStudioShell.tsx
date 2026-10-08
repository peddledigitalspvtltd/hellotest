import { Children, cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import { IconAdjustmentsHorizontal, IconBraces, IconLayoutGrid, IconListDetails, IconRefresh, IconSearch, IconSparkles, IconX } from "@tabler/icons-react";
import { type AgenticFeatureProfileId, type AgenticProcessStageId, type AgenticProcessStatus, type AgenticProcessingSnapshot } from "@hellotest/agentic/frontend/components/AgenticExperience";
import { AiGenerationProgress } from "./AiGenerationProgress";
import { AiIntentCanvas } from "./AiIntentCanvas";
import { AiContextPeek } from "./AiContextPeek";
import { AiPromptContextPanel } from "./AiPromptContextPanel";
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
  onCancel?: () => void;
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
  onPrimaryGenerate, primaryGenerateDisabled = false, onClose, onCancel, closeDisabled = false,
  settingsPane, queuePane, inspectorContent, commandBar, titleId, descriptionId,
  studioTitle, studioDescription, entityLabel = "Story", settingsAriaLabel, inspectorAriaLabel,
  agentName = "Story Architect", agentStatus = "idle", contextLabel = "Review context", mission = "", onMissionChange, missionPlaceholder,
  integrationId = "", integrations = [], outputLabel, approvalLabel = "Explicit review before any saved change", stageEvidence = {}, processing,
  reviewStatus = "awaiting_review", hasProposal = true
}: StoryAiStudioShellProps) {
  const [contextOpen, setContextOpen] = useState(false);
  const [draftSearch, setDraftSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [outputFormat, setOutputFormat] = useState<"structured" | "gherkin">("structured");
  const title = studioTitle || (mode === "create" ? "Create Stories using AI" : "AI Complete Story");
  const closeLabel = mode === "create" ? `Close AI ${entityLabel} creation` : `Close AI ${entityLabel} improvement`;
  const queue = isValidElement(queuePane) ? queuePane as ReactElement<{ drafts?: Array<{ title: string; description: string }>; selectedDraftIds?: string[]; activeContent?: ReactNode; searchQuery?: string; viewMode?: string }> : null;
  const draftCount = queue?.props.drafts?.length || 0;
  const hasVisibleDraft = Boolean(queue?.props.drafts?.some(draft => `${draft.title} ${draft.description}`.toLowerCase().includes(draftSearch.toLowerCase().trim())));
  const selectedCount = mode === "create" ? queue?.props.selectedDraftIds?.length || 0 : 0;
  const statusContent = isValidElement(inspectorContent) ? (inspectorContent.props as { statusContent?: ReactNode }).statusContent : null;
  const generateAction = <button className="story-studio-primary-action" disabled={primaryGenerateDisabled} onClick={onPrimaryGenerate} type="button"><IconRefresh size={17} />{primaryGenerateLabel}</button>;
  const providerLabel = integrationId ? integrations.find(integration => integration.id === integrationId)?.name || `${integrationId} (unavailable)` : "Configured LLM";
  const inspector = isValidElement(inspectorContent)
    ? cloneElement(inspectorContent as ReactElement<{ outputFormat?: string; statusContent?: ReactNode; evidencePlacement?: string; emptyAction?: ReactNode }>, { outputFormat, statusContent: null, evidencePlacement: "inspector", emptyAction: generateAction }) : inspectorContent;
  const contextOnly = (content: ReactNode): ReactNode => Children.map(content, child => {
    if (!isValidElement(child)) return child;
    if (child.type === AiPromptContextPanel && onMissionChange) return cloneElement(child as ReactElement<{ showPromptEditor?: boolean }>, { showPromptEditor: false });
    const element = child as ReactElement<{ children?: ReactNode }>;
    return element.props.children ? cloneElement(element, { children: contextOnly(element.props.children) }) : child;
  });
  const stateLabel = agentStatus === "completed"
    ? !hasProposal ? "Processing complete · no proposal" : reviewStatus === "accepted" ? "Proposal accepted" : "Proposal ready · review required"
    : agentStatus === "running" ? "Generation in progress" : agentStatus === "failed" ? "Generation needs attention" : "Ready to generate";

  return (
    <section aria-describedby={descriptionId} aria-labelledby={titleId} className={`story-studio-shell ai-test-generator-modal ai-command-studio has-review-footer${hasProposal && draftCount ? " has-proposal" : ""}`} data-mode={mode}>
      <header className="ai-test-generator-header">
        <div><IconSparkles size={20} /><h1 id={titleId}>{title}</h1></div>
        {descriptionId ? <p className="sr-only" id={descriptionId}>{studioDescription || "Configure context, generate Story drafts, and review the selected changes before saving."}</p> : null}
        <div className="ai-test-generator-header__actions">
          <button aria-controls={`${titleId}-context`} aria-expanded={contextOpen} aria-label={`${contextOpen ? "Hide" : "Show"} context`} className="ai-test-generator-context-toggle" onClick={() => setContextOpen(current => !current)} type="button"><IconAdjustmentsHorizontal size={17} /><span>Context</span></button>
          <button aria-label={`Search ${entityLabel} drafts`} aria-expanded={searchOpen} aria-controls={`${titleId}-search`} className="ai-studio-search-toggle" onClick={() => { setSearchOpen(current => !current); window.requestAnimationFrame(() => document.getElementById(`${titleId}-search`)?.focus()); }} type="button"><IconSearch size={17} /></button>
          <label className={`ai-studio-search${searchOpen ? " is-open" : ""}`}><IconSearch size={17} /><input className="story-studio-search" id={`${titleId}-search`} aria-label={`Search ${entityLabel} drafts`} onChange={event => setDraftSearch(event.target.value)} placeholder="Search drafts…" value={draftSearch} /></label>
          <button aria-label={closeLabel} className="ai-test-generator-close" disabled={closeDisabled} onClick={onClose} type="button"><IconX size={20} /></button>
        </div>
      </header>
      <div className={`story-studio-workbench ai-test-generator-layout is-intelligence-collapsed${contextOpen ? "" : " is-context-collapsed"}`}>

        <main aria-label={inspectorAriaLabel || `${entityLabel} AI draft workspace`} className="story-studio-main-pane ai-test-generator-workspace">
          {onMissionChange ? <AiIntentCanvas value={mission} onChange={onMissionChange} onSubmit={onPrimaryGenerate} disabled={agentStatus === "running" || closeDisabled} submitDisabled={primaryGenerateDisabled} hasOutput={Boolean(draftCount)} label={`Instructions for ${agentName}`} title={entityLabel === "Defect" ? mode === "improve" ? "What should improve?" : "What happened?" : mode === "create" ? "What should we build?" : "What should improve?"} placeholder={missionPlaceholder}
            chips={[{ id: "context", label: contextLabel, onClick: () => setContextOpen(true) }, { id: "options", label: "Evidence & options", onClick: () => setContextOpen(true) }]}
            suggestions={entityLabel === "Defect" ? [{ label: "Reproduction", instruction: "Separate observed behavior, expected behavior, and steps to reproduce. Flag anything that needs verification." }] : mode === "create" ? [{ label: "Measurable criteria", instruction: "Include measurable acceptance criteria and explicit boundaries supported by the context." }, { label: "Edge cases", instruction: "Identify the exception paths and open questions supported by the evidence." }] : [{ label: "Clarify gaps", instruction: "Clarify missing acceptance boundaries while preserving the existing Story intent." }]} /> : <button className="ai-context-chip" onClick={() => setContextOpen(true)} type="button">Add instructions and evidence</button>}

          <div className="ai-test-generator-workspace__header">
            <div className="ai-test-generator-workspace__identity"><div><h2>{mode === "create" ? `${entityLabel} Drafts` : `${entityLabel} Completion`}</h2><p>{mode === "create" ? `Review, refine, and accept only the ${entityLabel === "Story" ? "Stories" : `${entityLabel}s`} you want.` : `Review the regenerated ${entityLabel} proposal and apply selected fields.`}</p></div><span>{mode === "create" ? `${draftCount} Generated` : hasProposal ? "Proposal ready" : "Ready to generate"}</span></div>
            <div className="ai-test-generator-view-controls">
              {showOutputFormat ? <div aria-label={`${entityLabel} output format`} className="ai-test-generator-authoring-tabs" role="radiogroup">
                <button aria-checked={outputFormat === "structured"} className={outputFormat === "structured" ? "is-active" : ""} onClick={() => setOutputFormat("structured")} role="radio" type="button"><IconListDetails size={15} />Structured</button>
                <button aria-checked={outputFormat === "gherkin"} className={outputFormat === "gherkin" ? "is-active" : ""} onClick={() => setOutputFormat("gherkin")} role="radio" type="button"><IconBraces size={15} />Gherkin</button>
              </div>
              : null}

            </div>
          </div>
          <div className={`ai-test-generator-toast${statusContent ? " has-message" : ""}`}>{statusContent}</div>
          <div className="story-studio-output-workspace" aria-busy={agentStatus === "running"}>
            {agentStatus === "running" ? <AiGenerationProgress modelLabel={providerLabel} onCancel={onCancel} processing={processing} /> : null}
            {queue ? cloneElement(queue, { activeContent: inspector, searchQuery: draftSearch, viewMode }) : inspector}
          </div>

        </main>

      </div>
      <AiContextPeek id={`${titleId}-context`} open={contextOpen} onClose={() => setContextOpen(false)} description={contextLabel}>

          {contextOnly(settingsPane)}
          {showIncludeGherkin ? <section className="ai-test-generator-section"><label className="story-studio-gherkin-control"><input checked={includeGherkin} disabled={includeGherkinDisabled || !onIncludeGherkinChange} onChange={event => onIncludeGherkinChange?.(event.target.checked)} type="checkbox" />{includeControlLabel}</label><p>Generate scenarios from the supplied acceptance criteria.</p></section> : null}
      </AiContextPeek>
          <footer className="story-studio-command-bar ai-test-generator-footer">
            <strong>{draftSearch && !hasVisibleDraft ? "Clear search to review drafts" : mode === "create" ? `${selectedCount} Selected` : "Review selected fields"}</strong>
            <div>{generateAction}<fieldset className="story-studio-review-actions" disabled={Boolean(draftSearch && !hasVisibleDraft)}>{commandBar}</fieldset></div>
          </footer>
      <footer className="ai-test-generator-status-footer"><span>Saved changes require your review</span><div><span>LLM: {providerLabel}</span><span aria-live="polite" role="status">{stateLabel}</span></div></footer>
    </section>
  );
}
