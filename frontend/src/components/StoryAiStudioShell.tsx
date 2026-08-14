import { useRef, useState, type ReactNode } from "react";
import {
  IconBrain,
  IconCheck,
  IconEdit,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconX
} from "@tabler/icons-react";
import storyAiAssistantAvatar from "../assets/story-ai-assistant.jpg";
import {
  AgenticProcessRail,
  AiFeatureComposer,
  type AgenticProcessStageId,
  type AgenticProcessStatus
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
  headerControl?: ReactNode;
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
  commandBar: ReactNode;
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
};

const STORY_STUDIO_NAV_ITEMS: Array<{ id: StoryAiStudioNavKey; label: string }> = [
  { id: "drafts", label: "Drafts" },
  { id: "review", label: "Review" },
  { id: "templates", label: "Templates" }
];

export function StoryAiStudioShell({
  mode,
  includeGherkin = false,
  onIncludeGherkinChange,
  includeGherkinDisabled = false,
  showIncludeGherkin = true,
  includeControlLabel = "Include Gherkin",
  headerControl,
  primaryGenerateLabel,
  onPrimaryGenerate,
  primaryGenerateDisabled = false,
  onClose,
  closeDisabled = false,
  navActive = "drafts",
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
  stageEvidence = {}
}: StoryAiStudioShellProps) {
  const shellRef = useRef<HTMLElement>(null);
  const [assistantMode, setAssistantMode] = useState<"chat" | "agent">("agent");
  const [isContextPaneOpen, setIsContextPaneOpen] = useState(true);
  const studioDescription = studioDescriptionOverride || (mode === "create"
    ? `Configure context, generate testable ${entityLabel} drafts, and approve only the candidates you want to keep.`
    : `Configure context, improve the selected ${entityLabel}, and review every suggested change before applying it.`);
  const closeLabel = mode === "create" ? `Close AI ${entityLabel} creation` : `Close AI ${entityLabel} improvement`;
  const effectiveOutputLabel = outputLabel || (mode === "create"
    ? `Editable ${entityLabel} drafts`
    : `Editable ${entityLabel} completion proposal`);

  const revealContextPane = () => {
    setIsContextPaneOpen(true);
    window.requestAnimationFrame(() => shellRef.current?.querySelector<HTMLElement>(".story-studio-settings-pane")?.scrollTo({ top: 0, behavior: "smooth" }));
  };

  return (
    <section
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="story-studio-shell"
      data-mode={mode}
      ref={shellRef}
    >
      <header className="story-studio-header">
        <div className="story-studio-header-start">
          <div className="story-studio-brand">
            <IconBrain aria-hidden="true" size={28} stroke={2} />
            <h2 id={titleId}>{studioTitle}</h2>
          </div>

          <nav aria-label="Story studio views" className="story-studio-nav">
            {STORY_STUDIO_NAV_ITEMS.map((item) => {
              const isActive = navActive === item.id;
              const itemClassName = isActive
                ? "story-studio-nav-item story-studio-nav-item-active"
                : "story-studio-nav-item";

              return onNavChange ? (
                <button
                  aria-current={isActive ? "page" : undefined}
                  className={itemClassName}
                  key={item.id}
                  onClick={() => onNavChange(item.id)}
                  type="button"
                >
                  {item.label}
                </button>
              ) : (
                <span aria-current={isActive ? "page" : undefined} className={itemClassName} key={item.id}>
                  {item.label}
                </span>
              );
            })}
          </nav>
        </div>

        <div className="story-studio-header-actions">
          {headerControl}

          <button
            aria-expanded={isContextPaneOpen}
            className="story-studio-context-toggle"
            onClick={() => setIsContextPaneOpen((current) => !current)}
            type="button"
          >
            {isContextPaneOpen ? <IconLayoutSidebarLeftCollapse aria-hidden="true" size={17} stroke={1.9} /> : <IconLayoutSidebarLeftExpand aria-hidden="true" size={17} stroke={1.9} />}
            <span>{isContextPaneOpen ? "Hide context" : "Show context"}</span>
          </button>

          {showIncludeGherkin ? (
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
          ) : null}

          <button
            aria-label={closeLabel}
            className="story-studio-close"
            disabled={closeDisabled}
            onClick={onClose}
            title={closeLabel}
            type="button"
          >
            <img alt="" aria-hidden="true" className="story-studio-close-avatar" src={storyAiAssistantAvatar} />
            <span aria-hidden="true" className="story-studio-close-overlay">
              <IconX size={18} stroke={2.2} />
            </span>
          </button>
        </div>
      </header>

      {descriptionId ? <p className="story-studio-visually-hidden" id={descriptionId}>{studioDescription}</p> : null}

      <div className="story-studio-agent-composer">
        <AiFeatureComposer
          agentName={agentName}
          allowEmptyPrompt
          briefItems={[
            {
              id: "context",
              kind: "context",
              label: "Evidence context",
              onClick: revealContextPane,
              state: "ready",
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
          disabled={primaryGenerateDisabled || !onMissionChange}
          integrationId={integrationId}
          integrations={integrations}
          mode={assistantMode}
          onContextClick={revealContextPane}
          onIntegrationChange={onIntegrationChange}
          onModeChange={setAssistantMode}
          onPromptChange={(value) => onMissionChange?.(value)}
          onSubmit={onPrimaryGenerate}
          placeholder={missionPlaceholder || (mode === "create"
            ? `Describe the ${entityLabel} outcome, boundary, and quality bar. Attached context remains available.`
            : `Tell ${agentName} what to strengthen, preserve, or challenge in this ${entityLabel}.`)}
          prompt={mission}
          running={agentStatus === "running"}
          submitLabel={primaryGenerateLabel}
        />
      </div>

      <AgenticProcessRail agentName={agentName} compact stageEvidence={stageEvidence} status={agentStatus} />

      <div className={isContextPaneOpen ? "story-studio-workspace" : "story-studio-workspace is-context-collapsed"}>
        <aside aria-hidden={!isContextPaneOpen || undefined} aria-label={settingsAriaLabel || `${entityLabel} generation settings`} className="story-studio-settings-pane">
          {settingsPane}
        </aside>

        <section aria-label={queueAriaLabel || `${entityLabel} draft queue`} className="story-studio-queue-pane">
          {queuePane}
        </section>

        <section aria-label={inspectorAriaLabel || `${entityLabel} draft inspector`} className="story-studio-inspector-pane">
          <div className="story-studio-inspector-scroll">
            <div className="story-studio-inspector-content">
              <div className="story-studio-proposal-state" data-ready={agentStatus === "completed" || undefined}>
                <span>{agentStatus === "completed" ? <IconCheck size={16} stroke={2} /> : <IconEdit size={16} stroke={1.9} />}</span>
                <div>
                  <strong>{agentStatus === "completed" ? "Proposal ready for selection and editing" : "Editable proposal workspace"}</strong>
                  <small>{agentStatus === "completed" ? "Select the output you want, edit it in place, then use the explicit acceptance action below." : "Your saved artifact remains unchanged until you accept a generated proposal."}</small>
                </div>
              </div>
              {inspectorContent}
            </div>
          </div>
          <footer className="story-studio-command-bar">{commandBar}</footer>
        </section>
      </div>
    </section>
  );
}
