import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  IconAdjustmentsHorizontal,
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconEdit,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconX
} from "@tabler/icons-react";
import {
  AgenticProcessRail,
  AiFeatureComposer,
  type AgenticProcessStageId,
  type AgenticProcessStatus,
  type AgenticProcessingSnapshot
} from "./AgenticExperience";
import "./StoryAiStudioShell.css";

export type StoryAiStudioMode = "create" | "improve";
export type StoryAiStudioNavKey = "drafts" | "review" | "templates";

export type StoryAiStudioShellProps = {
  mode: StoryAiStudioMode;
  includeGherkin?: boolean;
  onIncludeGherkinChange?: (value: boolean) => void;
  includeGherkinDisabled?: boolean;
  showIncludeGherkin?: boolean;
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
  defaultOpen = false,
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
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <details className="story-studio-settings-group" onToggle={(event) => setIsOpen(event.currentTarget.open)} open={isOpen}>
      <summary>
        <span className="story-studio-settings-group__icon">{icon || <IconAdjustmentsHorizontal aria-hidden="true" size={16} stroke={1.9} />}</span>
        <span className="story-studio-settings-group__copy"><strong>{title}</strong><small>{description}</small></span>
        <IconChevronDown aria-hidden="true" className="story-studio-settings-group__chevron" size={15} stroke={1.9} />
      </summary>
      <div className="story-studio-settings-group__body">{children}</div>
    </details>
  );
}

export function StoryAiStudioShell({
  mode,
  includeGherkin = false,
  onIncludeGherkinChange,
  includeGherkinDisabled = false,
  showIncludeGherkin = true,
  includeControlLabel = "Include Gherkin",
  primaryGenerateLabel,
  onPrimaryGenerate,
  primaryGenerateDisabled = false,
  onClose,
  closeDisabled = false,
  onNavChange,
  settingsPane,
  queuePane,
  inspectorContent,
  commandBar,
  titleId,
  descriptionId,
  studioTitle = "Story Generator",
  studioDescription: studioDescriptionOverride,
  entityLabel = "Story",
  settingsAriaLabel,
  queueAriaLabel,
  inspectorAriaLabel,
  agentName = "HelloTest AI specialist",
  agentStatus = "idle",
  mission = "",
  onMissionChange,
  missionPlaceholder,
  contextLabel = "Review context",
  integrationId = "",
  integrations = [],
  onIntegrationChange,
  outputLabel,
  approvalLabel = "Explicit review before any saved change",
  stageEvidence = {},
  processing,
  contextState = "neutral",
  reviewStatus = "awaiting_review",
  hasProposal = true
}: StoryAiStudioShellProps) {
  const shellRef = useRef<HTMLElement>(null);
  const contextPaneRef = useRef<HTMLElement>(null);
  const contextToggleRef = useRef<HTMLButtonElement>(null);
  const mainPaneRef = useRef<HTMLElement>(null);
  const inspectorPaneRef = useRef<HTMLElement>(null);
  const flowPaneRef = useRef<HTMLElement>(null);
  const queuePaneRef = useRef<HTMLElement>(null);
  const queueToggleRef = useRef<HTMLButtonElement>(null);
  const [isContextPaneOpen, setIsContextPaneOpen] = useState(true);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isOverlayLayout, setIsOverlayLayout] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches);
  const [isFullWidthQueueLayout, setIsFullWidthQueueLayout] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 600px)").matches);
  const studioDescription = studioDescriptionOverride || (mode === "create"
    ? `Configure context, generate testable ${entityLabel} drafts, and approve only the candidates you want to keep.`
    : `Configure context, improve the selected ${entityLabel}, and review every suggested change before applying it.`);
  const closeLabel = mode === "create" ? `Close AI ${entityLabel} creation` : `Close AI ${entityLabel} improvement`;
  const effectiveOutputLabel = outputLabel || (mode === "create"
    ? `Editable ${entityLabel} drafts`
    : `Editable ${entityLabel} completion proposal`);

  useEffect(() => {
    const contextMedia = window.matchMedia("(max-width: 900px)");
    const queueMedia = window.matchMedia("(max-width: 600px)");
    const update = () => {
      setIsOverlayLayout(contextMedia.matches);
      setIsFullWidthQueueLayout(queueMedia.matches);
    };
    update();
    contextMedia.addEventListener("change", update);
    queueMedia.addEventListener("change", update);
    return () => {
      contextMedia.removeEventListener("change", update);
      queueMedia.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (mainPaneRef.current) mainPaneRef.current.inert = isOverlayLayout && isContextPaneOpen;
    if (flowPaneRef.current) flowPaneRef.current.inert = isOverlayLayout && isContextPaneOpen;
    if (inspectorPaneRef.current) inspectorPaneRef.current.inert = isFullWidthQueueLayout && isQueueOpen;
  }, [isContextPaneOpen, isFullWidthQueueLayout, isOverlayLayout, isQueueOpen]);

  const focusPersistentContextToggle = () => window.requestAnimationFrame(() => contextToggleRef.current?.focus());
  const closeContextPane = () => {
    setIsContextPaneOpen(false);
    focusPersistentContextToggle();
  };
  const revealContextPane = () => {
    setIsContextPaneOpen(true);
    window.requestAnimationFrame(() => {
      const pane = contextPaneRef.current;
      pane?.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      if (isOverlayLayout) pane?.focus();
    });
  };
  const toggleQueuePane = () => {
    setIsQueueOpen((current) => {
      const next = !current;
      onNavChange?.(next ? "drafts" : "review");
      window.requestAnimationFrame(() => (next ? queuePaneRef.current : queueToggleRef.current)?.focus());
      return next;
    });
  };

  return (
    <section
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="story-studio-shell"
      data-mode={mode}
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape" || !isOverlayLayout) return;
        if (isQueueOpen) {
          event.preventDefault();
          event.stopPropagation();
          toggleQueuePane();
        } else if (isContextPaneOpen) {
          event.preventDefault();
          event.stopPropagation();
          closeContextPane();
        }
      }}
      ref={shellRef}
    >
      <header className="story-studio-header">
        <div className="story-studio-header-start">
          <div className="story-studio-brand">
            <IconBrain aria-hidden="true" size={24} stroke={2} />
            <h2 id={titleId}>{studioTitle}</h2>
          </div>
        </div>

        <div className="story-studio-header-actions">
          <button
            aria-controls={`${titleId}-context-pane`}
            aria-expanded={isContextPaneOpen}
            className="story-studio-context-toggle"
            onClick={() => isContextPaneOpen ? closeContextPane() : revealContextPane()}
            ref={contextToggleRef}
            type="button"
          >
            {isContextPaneOpen ? <IconLayoutSidebarLeftCollapse aria-hidden="true" size={17} stroke={1.9} /> : <IconLayoutSidebarLeftExpand aria-hidden="true" size={17} stroke={1.9} />}
            <span>{isContextPaneOpen ? "Hide context" : "Show context"}</span>
          </button>

          {showIncludeGherkin ? (
            <details className="story-studio-output-options">
              <summary><IconAdjustmentsHorizontal aria-hidden="true" size={16} stroke={1.9} /><span>Output options</span><IconChevronDown aria-hidden="true" size={14} stroke={1.9} /></summary>
              <div className="story-studio-gherkin-control">
                <span id={`${titleId}-include-label`}>{includeControlLabel}</span>
                <button
                  aria-checked={includeGherkin}
                  aria-labelledby={`${titleId}-include-label`}
                  className="story-studio-switch"
                  disabled={includeGherkinDisabled || !onIncludeGherkinChange}
                  onClick={() => onIncludeGherkinChange?.(!includeGherkin)}
                  role="switch"
                  type="button"
                >
                  <span aria-hidden="true" className="story-studio-switch-thumb" />
                </button>
              </div>
            </details>
          ) : null}

          <button
            aria-label={closeLabel}
            className="story-studio-close"
            disabled={closeDisabled}
            onClick={onClose}
            title={closeLabel}
            type="button"
          >
            <IconX aria-hidden="true" size={18} stroke={2.2} />
          </button>
        </div>
      </header>

      {descriptionId ? <p className="story-studio-visually-hidden" id={descriptionId}>{studioDescription}</p> : null}

      <div className={isContextPaneOpen ? "story-studio-workbench" : "story-studio-workbench is-context-collapsed"}>
        <aside
          aria-hidden={!isContextPaneOpen || undefined}
          aria-label={settingsAriaLabel || `${entityLabel} generation settings`}
          className="story-studio-settings-pane"
          id={`${titleId}-context-pane`}
          ref={contextPaneRef}
          tabIndex={isOverlayLayout ? -1 : undefined}
        >
          <div className="story-studio-pane-header">
            <div><strong>Context</strong><span>{contextLabel}</span></div>
            <button aria-label="Hide context" onClick={closeContextPane} title="Hide context" type="button"><IconLayoutSidebarLeftCollapse aria-hidden="true" size={16} stroke={1.9} /></button>
          </div>
          <div className="story-studio-settings-scroll">{settingsPane}</div>
        </aside>

        <section
          aria-hidden={isOverlayLayout && isContextPaneOpen || undefined}
          aria-label={`${entityLabel} AI draft workspace`}
          className="story-studio-main-pane"
          ref={mainPaneRef}
        >
          <div className="story-studio-agent-composer">
            <AiFeatureComposer
              agentName={agentName}
              allowEmptyPrompt
              briefCollapsible
              briefItems={[
                {
                  id: "context",
                  kind: "context",
                  label: "Evidence context",
                  onClick: revealContextPane,
                  state: contextState,
                  value: contextLabel
                },
                {
                  id: "output",
                  kind: "output",
                  label: "Output contract",
                  state: "ready",
                  value: effectiveOutputLabel
                },
                {
                  id: "approval",
                  kind: "approval",
                  label: "Human gate",
                  state: "ready",
                  value: approvalLabel
                }
              ]}
              contextLabel={contextLabel}
              density="compact"
              disabled={primaryGenerateDisabled || !onMissionChange}
              integrationId={integrationId}
              integrations={integrations}
              mode="agent"
              onContextClick={revealContextPane}
              onIntegrationChange={onIntegrationChange}
              onPromptChange={(value) => onMissionChange?.(value)}
              onSubmit={onPrimaryGenerate}
              placeholder={missionPlaceholder || (mode === "create"
                ? `Describe the ${entityLabel} outcome, boundary, and quality bar. Attached context remains available.`
                : `Tell ${agentName} what to strengthen, preserve, or challenge in this ${entityLabel}.`)}
              prompt={mission}
              running={agentStatus === "running"}
              showIdentity={false}
              showModeSwitcher={false}
              showProviderSelector={false}
              submitLabel={primaryGenerateLabel}
            />
          </div>

          <div className="story-studio-canvas-bar">
            <button
              aria-controls={`${titleId}-draft-queue`}
              aria-expanded={isQueueOpen}
              className="story-studio-queue-toggle"
              onClick={toggleQueuePane}
              ref={queueToggleRef}
              type="button"
            >
              <IconLayoutSidebarLeftExpand aria-hidden="true" size={16} stroke={1.9} />
              <span>{isQueueOpen ? "Hide drafts" : `Browse ${entityLabel} drafts`}</span>
            </button>
            <div className="story-studio-proposal-state" data-ready={agentStatus === "completed" || undefined} role="status">
              <span>{agentStatus === "completed" ? <IconCheck size={15} stroke={2} /> : <IconEdit size={15} stroke={1.9} />}</span>
              <div>
                <strong>{agentStatus === "completed"
                  ? !hasProposal ? "Processing complete · no proposal" : reviewStatus === "accepted" ? "Proposal accepted" : "Proposal ready · review required"
                  : "Draft workspace"}</strong>
                <small>{agentStatus === "completed"
                  ? !hasProposal ? "Review the evidence limitations, add missing context, and run again." : reviewStatus === "accepted" ? "The reviewed proposal was accepted." : "Processing is complete; edit and accept only what you want to keep."
                  : "Saved content stays unchanged until acceptance."}</small>
              </div>
            </div>
          </div>

          <div className={isQueueOpen ? "story-studio-output-workspace is-queue-open" : "story-studio-output-workspace"}>
            {isQueueOpen ? (
              <section aria-label={queueAriaLabel || `${entityLabel} draft queue`} className="story-studio-queue-pane" id={`${titleId}-draft-queue`} ref={queuePaneRef} tabIndex={-1}>
                {queuePane}
              </section>
            ) : null}

            <section
              aria-hidden={isFullWidthQueueLayout && isQueueOpen || undefined}
              aria-label={inspectorAriaLabel || `${entityLabel} draft inspector`}
              className="story-studio-inspector-pane"
              ref={inspectorPaneRef}
            >
              <div className="story-studio-inspector-scroll">
                <div className="story-studio-inspector-content">
                  {inspectorContent}
                </div>
              </div>
              {commandBar ? <footer className="story-studio-command-bar">{commandBar}</footer> : null}
            </section>
          </div>
        </section>

        <aside
          aria-hidden={isOverlayLayout && isContextPaneOpen || undefined}
          aria-label={`${agentName} generation flow`}
          className="story-studio-flow-pane"
          ref={flowPaneRef}
        >
          <AgenticProcessRail
            agentName={agentName}
            compact
            orientation="vertical"
            presentation="focused"
            processing={processing}
            profile={mode === "create" ? "story-create" : "story-complete"}
            stageEvidence={stageEvidence}
            status={agentStatus}
          />
        </aside>
      </div>
    </section>
  );
}
