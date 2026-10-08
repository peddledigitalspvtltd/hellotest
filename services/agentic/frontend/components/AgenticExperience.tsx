import { FormattedText } from "@hellotest/platform/frontend/src/shared/components/FormattedText";
import { AgentArtifactReview } from "../agents/AgentArtifactReview";
import { AiProposalCompare } from "@hellotest/ai/frontend/components/AiProposalCompare";
import { AutomationRepairReview } from "@hellotest/ai/frontend/components/AutomationRepairReview";
import { QualityEvidencePanel } from "@hellotest/ai/frontend/components/QualityEvidencePanel";
import specialistProfiles from "../../shared/workflowSpecialists.json";
import { useAiLlmAutoSelection, useAiLlmDefault } from "@hellotest/integration/frontend/hooks/useAiLlmDefault";
import { smartContextKindsForScopes } from "@hellotest/ai/frontend/lib/smartContext";
import { formatRecordKindLabel } from "@hellotest/testing/frontend/lib/defectTerminology";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  IconActivity,
  IconAdjustmentsHorizontal,
  IconArrowRight,
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconCircle,
  IconClock,
  IconCopy,
  IconDatabase,
  IconDownload,
  IconFileSearch,
  IconMessageCircle,
  IconLoader2,
  IconPlayerPlay,
  IconPlus,
  IconRobot,
  IconRoute,
  IconSend,
  IconShieldCheck,
  IconSparkles,
  IconTargetArrow,
  IconUserCheck
} from "@tabler/icons-react";
import type {
  AgenticAssistantCitation,
  AgenticAssistantEvaluation,
  AgenticAssistantMode,
  AgenticAssistantResult,
  WorkspaceTransactionEvent
} from "@hellotest/platform/frontend/src/types";
import { useCurrentAppType, useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { replaceSmartContextPack } from "@hellotest/ai/frontend/lib/aiDesignStudio";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { SmartContextWorkbench, type SmartContextSelection } from "@hellotest/ai/frontend/components/SmartContextWorkbench";
import "./AgenticExperience.css";

export type AiEvidenceFact = {
  label: string;
  value: ReactNode;
};

export type AiEvidenceFlyoutProps = {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: string;
  description?: string;
  facts?: AiEvidenceFact[];
  children?: ReactNode;
  footer?: ReactNode;
};

/**
 * Shared evidence surface for every AI experience. Evidence opens beside the
 * work instead of expanding the layout and pushing the decision controls away.
 */
export function AiEvidenceFlyout({
  open,
  onClose,
  eyebrow = "Decision evidence",
  title,
  description,
  facts = [],
  children,
  footer
}: AiEvidenceFlyoutProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useDialogFocus<HTMLElement>({ active: open, onClose });

  if (!open) return null;

  const flyout = (
    <div
      className="ai-evidence-flyout-backdrop"
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      role="presentation"
    >
      <aside
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="ai-evidence-flyout"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="ai-evidence-flyout__header">
          <div>
            <span><IconFileSearch aria-hidden="true" size={15} stroke={1.9} />{eyebrow}</span>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <DialogCloseButton label={`Close ${title}`} onClick={onClose} />
        </header>
        <div aria-label={`${title} details`} className="ai-evidence-flyout__body" role="region" tabIndex={0}>
          {facts.length ? (
            <dl aria-label="Evidence summary" className="ai-evidence-flyout__facts">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {children}
        </div>
        {footer ? <footer className="ai-evidence-flyout__footer">{footer}</footer> : null}
      </aside>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(flyout, document.body) : flyout;
}

export function AiEvidenceButton({
  label = "Inspect evidence",
  count,
  onClick,
  className = ""
}: {
  label?: string;
  count?: number;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      aria-haspopup="dialog"
      className={["ai-evidence-button", className].filter(Boolean).join(" ")}
      onClick={onClick}
      type="button"
    >
      <IconDatabase aria-hidden="true" size={15} stroke={1.9} />
      <span>{label}</span>
      {typeof count === "number" ? <strong>{count}</strong> : null}
      <IconArrowRight aria-hidden="true" size={14} stroke={1.9} />
    </button>
  );
}

export type HelloTestAgent = {
  id: string;
  agentVersion?: number;
  name: string;
  shortName: string;
  description: string;
  capabilities: string[];
  contextScopes: string[];
  prompt: string;
  icon: ReactNode;
};

export const HELLOTEST_AGENT_CATALOG: HelloTestAgent[] = Object.entries(specialistProfiles).map(([id, profile]) => ({
  id, name: profile.name, shortName: profile.name, description: profile.description,
  capabilities: profile.skills.map(skill => skill.name), contextScopes: profile.scopes, prompt: profile.prompt,
  icon: id.includes("story") ? <IconSparkles /> : id.includes("test") || id.includes("coverage") ? <IconTargetArrow /> : id.includes("bug") ? <IconUserCheck /> : id.includes("failure") || id.includes("flaky") ? <IconActivity /> : id.includes("automation") ? <IconRobot /> : id.includes("repository") || id === "quality-graph" ? <IconDatabase /> : id === "run-planner" ? <IconPlayerPlay /> : <IconShieldCheck />
}));

export const AGENT_CONTEXT_OPTIONS = [
  { id: "stories", label: "Stories" },
  { id: "test-cases", label: "Test Cases" },
  { id: "automation", label: "Automation" },
  { id: "runs", label: "Runs" },
  { id: "bugs", label: "Defects" },
  { id: "knowledge", label: "Knowledge" }
] as const;

type AgenticCommandComposerProps = {
  appTypeId?: string;
  agents?: HelloTestAgent[];
  agentId: string;
  onAgentChange: (agentId: string) => void;
  contextScopes: string[];
  onContextScopesChange: (scopes: string[]) => void;
  integrationId?: string;
  integrations?: Array<{ id: string; name: string; model?: string | null; is_active?: boolean; type?: string }>;
  onIntegrationChange?: (integrationId: string) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onSmartContextChange?: (selection: SmartContextSelection) => void;
  onSubmit: () => void;
  projectId?: string;
  disabled?: boolean;
  running?: boolean;
  scopeLabel?: string;
  smartContext?: SmartContextSelection | null;
};

export function AgenticCommandComposer({
  appTypeId,
  agents = HELLOTEST_AGENT_CATALOG,
  agentId,
  onAgentChange,
  contextScopes,
  onContextScopesChange,
  integrationId = "",
  integrations = [],
  onIntegrationChange,
  prompt,
  onPromptChange,
  onSmartContextChange,
  onSubmit,
  projectId,
  disabled = false,
  running = false,
  scopeLabel = "Current project",
  smartContext = null
}: AgenticCommandComposerProps) {
  const defaultIntegrationId = useAiLlmDefault({ usageKey: "ai.agentic.workflow", projectId, integrations, enabled: Boolean(onIntegrationChange) });
  const selectIntegration = useAiLlmAutoSelection({ integrations, value: integrationId, onChange: onIntegrationChange, defaultIntegrationId, scopeKey: projectId, disabled: disabled || running });
  const selectedAgent = agents.find((agent) => agent.id === agentId) || agents[0];
  const contextDetailsRef = useRef<HTMLDetailsElement>(null);
  const optionsDetailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      for (const element of [contextDetailsRef.current, optionsDetailsRef.current]) if (element?.open && !element.contains(event.target as Node)) element.open = false;
    };
    document.addEventListener("pointerdown", closeMenus);
    return () => document.removeEventListener("pointerdown", closeMenus);
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled && !running && prompt.trim()) onSubmit();
  };

  const toggleScope = (scope: string) => {
    onContextScopesChange(contextScopes.includes(scope)
      ? contextScopes.filter((item) => item !== scope)
      : [...contextScopes, scope]);
  };

  return (
    <form className="agent-command-composer" onSubmit={submit}>
      <div className="agent-command-composer__identity">
        <span><IconBrain aria-hidden="true" size={18} stroke={1.9} /></span>
        <div>
          <strong>{selectedAgent?.name || "HelloTest Agent"}</strong>
          <small>Structured evidence review</small>
        </div>
        <span className="agent-command-composer__governed"><IconShieldCheck size={15} stroke={1.9} />Review before apply</span>
      </div>
      {contextScopes.length ? <div className="agent-command-attached-context" aria-label="Included context sources">{contextScopes.map(scope => <button aria-label={`Remove ${AGENT_CONTEXT_OPTIONS.find(option => option.id === scope)?.label || scope} context`} disabled={disabled || running} key={scope} onClick={() => toggleScope(scope)} type="button"><IconDatabase size={12} aria-hidden="true" />{AGENT_CONTEXT_OPTIONS.find(option => option.id === scope)?.label || scope}<span aria-hidden="true">×</span></button>)}</div> : null}
      <textarea
        aria-label="Ask or delegate to HelloTest AI"
        disabled={disabled || running}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            if (!disabled && !running && prompt.trim()) onSubmit();
          }
        }}
        placeholder="What outcome do you want? Add the constraints that matter."
        rows={4}
        value={prompt}
      />
      <div className="agent-command-composer__footer">
        <div className="agent-command-composer__controls">
          <details className="agent-command-context" ref={contextDetailsRef}>
            <summary>
              <IconDatabase size={16} stroke={1.9} />
              <span>{contextScopes.length === AGENT_CONTEXT_OPTIONS.length ? "All workspace context" : `${contextScopes.length} context source${contextScopes.length === 1 ? "" : "s"}`}</span>
              <IconChevronDown size={14} stroke={1.9} />
            </summary>
            <div className="agent-command-context__menu">
              <header><strong>Context scope</strong><span>{scopeLabel}</span></header>
              {AGENT_CONTEXT_OPTIONS.map((option) => (
                <label key={option.id}>
                  <input disabled={disabled || running} checked={contextScopes.includes(option.id)} onChange={() => toggleScope(option.id)} type="checkbox" />
                  <span>{option.label}</span>
                </label>
              ))}
              <button disabled={disabled || running} onClick={() => {
                onContextScopesChange(AGENT_CONTEXT_OPTIONS.map((option) => option.id));
                contextDetailsRef.current?.removeAttribute("open");
              }} type="button">Use all context</button>
            </div>
          </details>
          {onSmartContextChange ? (
            <SmartContextWorkbench
              appTypeId={appTypeId}
              buttonClassName="agent-command-smart-context"
              buttonLabel={smartContext?.resultCount ? `Smart Context · ${smartContext.resultCount}` : "Smart Context"}
              disabled={disabled || running}
              initialQuery={prompt}
              onApply={onSmartContextChange}
              preferredSourceKinds={smartContextKindsForScopes(contextScopes)}
              projectId={projectId}
            />
          ) : null}
        </div>
        <div className="agent-command-composer__submit-group">
          <details className="agent-command-options" ref={optionsDetailsRef} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); optionsDetailsRef.current?.removeAttribute("open"); optionsDetailsRef.current?.querySelector<HTMLElement>("summary")?.focus(); } }}>
            <summary><IconAdjustmentsHorizontal size={16} aria-hidden="true" /><span>Options</span></summary>
            <div className="agent-command-options__menu"><strong>Specialist & model</strong>
          <label className="agent-command-select">
            <IconSparkles aria-hidden="true" size={16} stroke={1.9} />
            <select aria-label="Specialist agent" disabled={disabled || running} onChange={(event) => onAgentChange(event.target.value)} value={agentId}>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.shortName}</option>)}
            </select>
            <IconChevronDown aria-hidden="true" size={14} stroke={1.9} />
          </label>
          {onIntegrationChange ? (
            <label className="agent-command-provider">
              <span className="sr-only">AI provider</span>
              <select disabled={disabled || running} onChange={(event) => selectIntegration(event.target.value)} value={integrationId}>
                <option value="">Workspace default</option>
                {integrationId && !integrations.some((item) => item.id === integrationId && item.is_active !== false) ? <option disabled value={integrationId}>{integrationId} (unavailable)</option> : null}
                {integrations.filter((item) => item.is_active !== false).map((integration) => (
                  <option key={integration.id} value={integration.id}>{integration.name}{integration.model ? ` · ${integration.model}` : ""}</option>
                ))}
              </select>
              <IconChevronDown size={14} stroke={1.9} />
            </label>
          ) : <span className="agent-command-auto"><IconRobot size={15} stroke={1.9} />Auto</span>}

              <small>Applied to the next request.</small>
            </div>
          </details>
          <span className="agent-command-divider" aria-hidden="true" />
          <button aria-label={running ? "Review in progress" : "Start review"} className="agent-command-send" disabled={disabled || running || !prompt.trim()} type="submit">
            {running ? <IconLoader2 aria-hidden="true" className="agent-inline-spinner" size={18} /> : <IconSend size={19} stroke={1.9} />}
            <span>{running ? "Reviewing…" : "Start review"}</span>
          </button>
        </div>
      </div>
      <span className="agent-command-shortcut">Ctrl / ⌘ Enter to start · Uses evidence within your access scope</span>
    </form>
  );
}

export type AiFeatureComposerProps = {
  headerActions?: ReactNode;
  agentName: string;
  mode: AgenticAssistantMode;
  onModeChange?: (mode: AgenticAssistantMode) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  contextLabel: string;
  onContextClick?: () => void;
  integrationId?: string;
  integrations?: Array<{ id: string; name: string; model?: string | null; is_active?: boolean; type?: string }>;
  onIntegrationChange?: (integrationId: string) => void;
  placeholder?: string;
  running?: boolean;
  disabled?: boolean;
  submitDisabled?: boolean;
  allowEmptyPrompt?: boolean;
  submitLabel?: string;
  briefItems?: AiFeatureBriefItem[];
  briefCollapsible?: boolean;
  density?: "comfortable" | "compact";
  embedded?: boolean;
  showIdentity?: boolean;
  showModeSwitcher?: boolean;
  showProviderSelector?: boolean;
  enableSmartContext?: boolean;
  smartContextScopes?: string[];
};

export type AiFeatureBriefItem = {
  id: string;
  label: string;
  value: string;
  kind?: "intent" | "context" | "output" | "approval";
  state?: "ready" | "attention" | "neutral";
  onClick?: () => void;
};

const featureBriefIcon = (kind: AiFeatureBriefItem["kind"]) => {
  if (kind === "context") return <IconDatabase aria-hidden="true" size={15} stroke={1.9} />;
  if (kind === "output") return <IconSparkles aria-hidden="true" size={15} stroke={1.9} />;
  if (kind === "approval") return <IconShieldCheck aria-hidden="true" size={15} stroke={1.9} />;
  return <IconTargetArrow aria-hidden="true" size={15} stroke={1.9} />;
};

export function AiRunBrief({ items, className = "", collapsible = false }: { items: AiFeatureBriefItem[]; className?: string; collapsible?: boolean }) {
  if (!items.length) return null;
  const readyCount = items.filter((item) => item.state === "ready").length;
  const itemGrid = (
    <div aria-label="Agent run brief" className="ai-feature-composer__brief-grid" role="group">
      {items.map((item) => {
        const itemState = item.state || "neutral";
        const content = (
          <>
            <span className="ai-feature-composer__brief-icon">{featureBriefIcon(item.kind)}</span>
            <span className="ai-feature-composer__brief-copy">
              <small>{item.label}</small>
              <strong title={item.value}>{item.value}</strong>
            </span>
            <span aria-label={`${item.label}: ${itemState}`} className="ai-feature-composer__brief-state" role="img" title={itemState === "ready" ? "Ready" : itemState === "attention" ? "Needs attention" : "Not started"}>
              {itemState === "ready" ? <IconCheck aria-hidden="true" size={12} stroke={2.2} /> : itemState === "attention" ? <IconClock aria-hidden="true" size={12} stroke={2} /> : <IconCircle aria-hidden="true" size={9} stroke={2} />}
            </span>
          </>
        );
        return item.onClick ? (
          <button className="ai-feature-composer__brief-item" data-state={itemState} key={item.id} onClick={item.onClick} type="button">
            {content}
          </button>
        ) : (
          <div className="ai-feature-composer__brief-item" data-state={itemState} key={item.id}>
            {content}
          </div>
        );
      })}
    </div>
  );
  const baseClassName = className ? `ai-feature-composer__brief ${className}` : "ai-feature-composer__brief";
  if (collapsible) {
    return (
      <details className={`${baseClassName} is-collapsible`}>
        <summary>
          <span><IconShieldCheck aria-hidden="true" size={14} stroke={1.9} />Run setup</span>
          <em>{readyCount}/{items.length} ready</em>
          <IconChevronDown aria-hidden="true" size={14} stroke={1.9} />
        </summary>
        {itemGrid}
      </details>
    );
  }
  return <div aria-label="Agent run brief" className={baseClassName}>{itemGrid}</div>;
}

export function AiFeatureComposer({
  agentName,
  headerActions,
  mode,
  onModeChange,
  prompt,
  onPromptChange,
  onSubmit,
  contextLabel,
  onContextClick,
  integrationId = "",
  integrations = [],
  onIntegrationChange,
  placeholder = "Ask anything or describe the outcome you want",
  running = false,
  disabled = false,
  submitDisabled = false,
  allowEmptyPrompt = false,
  submitLabel,
  briefItems = [],
  briefCollapsible = false,
  density = "comfortable",
  embedded = false,
  showIdentity = true,
  showModeSwitcher = true,
  showProviderSelector = true,
  enableSmartContext = false,
  smartContextScopes = ["knowledge"]
}: AiFeatureComposerProps) {
  const [projectId] = useCurrentProject();
  const [appTypeId] = useCurrentAppType(projectId);
  const defaultIntegrationId = useAiLlmDefault({ usageKey: "", projectId, integrations, enabled: Boolean(onIntegrationChange) && showProviderSelector });
  const selectIntegration = useAiLlmAutoSelection({ integrations, value: integrationId, onChange: onIntegrationChange, defaultIntegrationId, scopeKey: projectId, disabled: disabled || running || !showProviderSelector });
  const canSubmit = allowEmptyPrompt || Boolean(prompt.trim());
  const effectiveSubmitLabel = submitLabel || (mode === "chat" ? "Ask" : "Delegate");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled && !submitDisabled && !running && canSubmit) onSubmit();
  };

  const content = (
    <>
      {showIdentity ? (
        <div className="ai-feature-composer__identity">
          <span><IconBrain aria-hidden="true" size={17} stroke={1.9} /></span>
          <div>
            <strong>{agentName}</strong>
            <small>{mode === "chat" ? "Explore and refine together" : "Draft for human review"}</small>
          </div>
          <em><IconShieldCheck aria-hidden="true" size={14} stroke={1.9} />Governed</em>
          {headerActions}
        </div>
      ) : null}
      <textarea
        aria-label={`Instructions for ${agentName}`}
        disabled={disabled || running}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            if (!disabled && !submitDisabled && !running && canSubmit) onSubmit();
          }
        }}
        placeholder={placeholder}
        rows={3}
        value={prompt}
      />
      <AiRunBrief collapsible={briefCollapsible} items={briefItems} />
      <div className="ai-feature-composer__footer">
        <div className="ai-feature-composer__controls">
          {showModeSwitcher && onModeChange ? (
            <div aria-label="AI interaction mode" className="agent-command-mode" role="group">
              <button aria-pressed={mode === "chat"} disabled={disabled || running} onClick={() => onModeChange("chat")} type="button">
                <IconMessageCircle size={15} stroke={1.9} />Chat
              </button>
              <button aria-pressed={mode === "agent"} disabled={disabled || running} onClick={() => onModeChange("agent")} type="button">
                <IconRobot size={15} stroke={1.9} />Agent
              </button>
            </div>
          ) : null}
          <button className="ai-feature-composer__context" disabled={!onContextClick || disabled || running} onClick={onContextClick} type="button">
            <IconDatabase aria-hidden="true" size={15} stroke={1.9} />
            <span>{contextLabel}</span>
          </button>
          {enableSmartContext ? (
            <SmartContextWorkbench
              appTypeId={appTypeId}
              buttonClassName="ai-feature-composer__context smart-context-trigger"
              disabled={disabled || running}
              initialQuery={[prompt, contextLabel].filter(Boolean).join(" ")}
              onApply={(selection: SmartContextSelection) => onPromptChange(replaceSmartContextPack(prompt, selection.contextText))}
              preferredSourceKinds={smartContextKindsForScopes(smartContextScopes)}
              projectId={projectId}
            />
          ) : null}
          <span className="ai-feature-composer__shortcut">⌘ Enter</span>
        </div>
        <div className="ai-feature-composer__submit">
          {showProviderSelector ? (
            onIntegrationChange ? (
              <label className="agent-command-provider">
                <span className="sr-only">AI provider</span>
                <select disabled={disabled || running} onChange={(event) => selectIntegration(event.target.value)} value={integrationId}>
                  <option value="">Auto model</option>
                  {integrationId && !integrations.some((item) => item.id === integrationId && item.is_active !== false) ? <option disabled value={integrationId}>{integrationId} (unavailable)</option> : null}
                {integrations.filter((item) => item.is_active !== false).map((integration) => (
                    <option key={integration.id} value={integration.id}>{integration.name}{integration.model ? ` · ${integration.model}` : ""}</option>
                  ))}
                </select>
                <IconChevronDown size={14} stroke={1.9} />
              </label>
            ) : <span className="agent-command-auto"><IconRobot size={14} stroke={1.9} />Auto</span>
          ) : null}
          {showProviderSelector ? <span className="agent-command-divider" aria-hidden="true" /> : null}
          <button
            aria-label={running ? `${agentName} is working` : effectiveSubmitLabel}
            className="ai-feature-composer__send"
            disabled={disabled || submitDisabled || running || !canSubmit}
            onClick={embedded ? () => onSubmit() : undefined}
            type={embedded ? "button" : "submit"}
          >
            {running ? <IconLoader2 aria-hidden="true" className="agent-inline-spinner" size={18} /> : <IconSend size={18} stroke={1.9} />}
            <span aria-live="polite">{running ? "Working" : effectiveSubmitLabel}</span>
          </button>
        </div>
      </div>
    </>
  );

  const className = density === "compact" ? "ai-feature-composer is-compact" : "ai-feature-composer";
  return embedded
    ? <div aria-busy={running} className={className}>{content}</div>
    : <form aria-busy={running} className={className} onSubmit={submit}>{content}</form>;
}

type AgentCatalogProps = {
  activeAgentId: string;
  onSelect: (agent: HelloTestAgent) => void;
};

export function AgentCatalog({ activeAgentId, onSelect }: AgentCatalogProps) {
  return (
    <div className="hello-agent-catalog">
      {HELLOTEST_AGENT_CATALOG.map((agent) => (
        <button aria-pressed={activeAgentId === agent.id} className="hello-agent-card" data-agent={agent.id} key={agent.id} onClick={() => onSelect(agent)} type="button">
          <span className="hello-agent-card__icon">{agent.icon}</span>
          <span className="hello-agent-card__copy"><strong>{agent.name}</strong><small>{agent.description}</small></span>
          <span className="hello-agent-card__capabilities">{agent.capabilities.map((capability) => <em key={capability}>{capability}</em>)}</span>
          <IconArrowRight className="hello-agent-card__arrow" size={17} stroke={1.9} />
        </button>
      ))}
    </div>
  );
}

export type AgenticProcessStatus = "idle" | "running" | "completed" | "failed";

const PROCESS_STAGES = [
  { id: "intake", label: "Intent", detail: "Request bounded", evidence: "Goal, constraints, and requested artifact were summarized." },
  { id: "context", label: "Context", detail: "Evidence retrieved", evidence: "Only selected workspace evidence and approved knowledge were retrieved." },
  { id: "guardrails", label: "Guardrails", detail: "Policies checked", evidence: "Permissions, unsafe instructions, scope limits, and human approval rules were checked." },
  { id: "specialist", label: "Specialist", detail: "Agent working", evidence: "The selected QA specialist produced a concise decision summary from grounded evidence." },
  { id: "outcome", label: "Output", detail: "Proposal prepared", evidence: "A reviewable proposal was produced without silently changing the saved artifact." },
  { id: "evaluation", label: "Evaluation", detail: "Output scored", evidence: "Grounding, completeness, traceability, and risk control were evaluated." },
  { id: "review", label: "Review", detail: "Human decision", evidence: "A person can edit, select, accept, or discard the proposed output." }
] as const;

export type AgenticProcessStageId = typeof PROCESS_STAGES[number]["id"];

export type AgenticFeatureProfileId =
  | "default"
  | "story-create"
  | "story-complete"
  | "bug-create"
  | "smart-run"
  | "bug-triage";

export type AgenticProcessingStage = {
  id: AgenticProcessStageId;
  status: "queued" | "running" | "complete" | "failed" | "current";
  detail?: string;
  evidence?: string;
  item_count?: number;
  duration_ms?: number;
};

export type AgenticProcessingSnapshot = {
  active_stage_id?: AgenticProcessStageId;
  completed_stage_count?: number;
  total_stage_count?: number;
  status_label?: string;
  progress_mode?: "determinate" | "indeterminate";
  stages?: AgenticProcessingStage[];
};

const FOCUSED_PROCESS_STAGES: Array<{
  id: AgenticProcessStageId;
  label: string;
  detail: string;
  evidence: string;
  evidenceKeys: AgenticProcessStageId[];
}> = [
  { id: "intake", label: "Brief", detail: "Goal configured", evidence: "The requested outcome and constraints define this run.", evidenceKeys: ["intake"] },
  { id: "context", label: "Context", detail: "Sources and safeguards", evidence: "Selected evidence and safeguards stay bounded to this draft.", evidenceKeys: ["context", "guardrails"] },
  { id: "specialist", label: "Generate", detail: "Draft and evaluate", evidence: "The specialist prepares and evaluates an editable proposal.", evidenceKeys: ["specialist", "outcome", "evaluation"] },
  { id: "review", label: "Review", detail: "Human decision", evidence: "A person reviews and explicitly accepts or discards the proposal.", evidenceKeys: ["review"] }
];

const FEATURE_PROCESS_PROFILES: Record<AgenticFeatureProfileId, {
  heading: string;
  stages: Partial<Record<AgenticProcessStageId, { label: string; detail: string }>>;
}> = {
  default: { heading: "Generation flow", stages: {} },
  "story-create": {
    heading: "Story creation",
    stages: {
      intake: { label: "Story brief", detail: "Outcome and boundaries" },
      context: { label: "Grounding", detail: "Project evidence bounded" },
      specialist: { label: "Compose", detail: "Story and acceptance draft" },
      review: { label: "Review", detail: "Edit before creation" }
    }
  },
  "story-complete": {
    heading: "Story completion",
    stages: {
      intake: { label: "Existing Story", detail: "Saved content preserved" },
      context: { label: "Gap scan", detail: "Missing detail identified" },
      specialist: { label: "Complete", detail: "Bounded improvements drafted" },
      review: { label: "Apply", detail: "Human-owned update" }
    }
  },
  "bug-create": {
    heading: "Defect creation",
    stages: {
      intake: { label: "Incident brief", detail: "Observed problem captured" },
      context: { label: "Evidence", detail: "Runs and records verified" },
      specialist: { label: "Draft Defect", detail: "Reproduction and impact" },
      review: { label: "Create", detail: "Human-owned submission" }
    }
  },
  "smart-run": {
    heading: "Smart Run planning",
    stages: {
      intake: { label: "Delivery scope", detail: "Change boundary configured" },
      context: { label: "Impact graph", detail: "Linked evidence retrieved" },
      specialist: { label: "Rank coverage", detail: "Risk-based cases selected" },
      review: { label: "Create run", detail: "Selection stays editable" }
    }
  },
  "bug-triage": {
    heading: "Defect triage",
    stages: {
      intake: { label: "Defect set", detail: "Review scope bounded" },
      context: { label: "Signals", detail: "Impact evidence assessed" },
      specialist: { label: "Recommend", detail: "Priority and actions drafted" },
      review: { label: "Acknowledge", detail: "Human decision required" }
    }
  }
};

export function AgenticProcessRail({ status = "idle", agentName = "HelloTest Agent", compact = false, orientation = "horizontal", presentation = "detailed", profile = "default", stageEvidence = {}, activeStageId, processing }: {
  status?: AgenticProcessStatus;
  agentName?: string;
  compact?: boolean;
  orientation?: "horizontal" | "vertical";
  presentation?: "detailed" | "focused";
  profile?: AgenticFeatureProfileId;
  stageEvidence?: Partial<Record<AgenticProcessStageId, string>>;
  activeStageId?: AgenticProcessStageId;
  processing?: AgenticProcessingSnapshot;
}) {
  const profileDefinition = FEATURE_PROCESS_PROFILES[profile];
  const baseDisplayStages: Array<{
    id: AgenticProcessStageId;
    label: string;
    detail: string;
    evidence: string;
    evidenceKeys: AgenticProcessStageId[];
  }> = presentation === "focused"
    ? FOCUSED_PROCESS_STAGES
    : PROCESS_STAGES.map((stage) => ({ ...stage, evidenceKeys: [stage.id] }));
  const displayStages = baseDisplayStages.map((stage) => ({
    ...stage,
    ...(profileDefinition.stages[stage.id] || {})
  }));
  const stageForId = (stageId: AgenticProcessStageId) => displayStages.find((stage) => stage.evidenceKeys.includes(stageId)) || displayStages[0];
  const [selectedStageId, setSelectedStageId] = useState<AgenticProcessStageId>(status === "completed" ? "review" : "intake");
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false);

  useEffect(() => {
    const nextStageId = processing?.active_stage_id || activeStageId || (status === "completed" ? "review" : status === "failed" ? "specialist" : "intake");
    setSelectedStageId(stageForId(nextStageId).id);
  }, [activeStageId, presentation, processing?.active_stage_id, profile, status]);

  const effectiveActiveStageId = processing?.active_stage_id || activeStageId;
  const requestedActiveIndex = effectiveActiveStageId ? displayStages.findIndex((stage) => stage.evidenceKeys.includes(effectiveActiveStageId)) : -1;
  const activeIndex = requestedActiveIndex >= 0
    ? requestedActiveIndex
    : status === "idle" || status === "running" ? 0 : status === "failed" ? presentation === "focused" ? 2 : 3 : displayStages.length - 1;
  const selectedStage = displayStages.find((stage) => stage.id === selectedStageId) || displayStages[0];
  const computedStages = displayStages.map((stage, index) => {
    const snapshots = processing?.stages?.filter((item) => stage.evidenceKeys.includes(item.id)) || [];
    const snapshot = snapshots.find((item) => item.status === "failed")
      || snapshots.find((item) => item.status === "running")
      || snapshots.find((item) => item.status === "current")
      || snapshots[snapshots.length - 1];
    const fallbackStatus = status === "failed" && index === activeIndex
      ? "failed"
      : index < activeIndex
        ? "complete"
        : index === activeIndex
          ? status === "running" ? "running" : "current"
          : status === "completed" ? "complete" : "queued";
    const groupedStatus = snapshots.some((item) => item.status === "failed")
      ? "failed"
      : snapshots.some((item) => item.status === "running")
        ? "running"
        : snapshots.some((item) => item.status === "current")
          ? "current"
          : snapshots.length && snapshots.every((item) => item.status === "complete")
            ? "complete"
            : snapshot?.status;
    const evidenceText = stage.evidenceKeys
      .map((stageId) => processing?.stages?.find((item) => item.id === stageId)?.evidence || stageEvidence[stageId])
      .filter(Boolean)
      .join(" ") || stage.evidence;
    const itemCount = snapshots.reduce((total, item) => total + (item.item_count || 0), 0);
    const durationMs = snapshots.reduce((total, item) => total + (item.duration_ms || 0), 0);
    return { ...stage, stageStatus: groupedStatus || fallbackStatus, snapshot, evidenceText, itemCount, durationMs };
  });
  const selectedComputedStage = computedStages.find((stage) => stage.id === selectedStage.id) || computedStages[0];
  const selectedSnapshot = selectedComputedStage?.snapshot;
  const selectedEvidence = selectedComputedStage?.evidenceText || selectedStage.evidence;
  const isIndeterminate = status === "running" && (processing?.progress_mode === "indeterminate" || !processing);
  const useDisplayedStageCounts = presentation === "focused";
  const completeCount = isIndeterminate ? 0 : useDisplayedStageCounts
    ? computedStages.filter((stage) => stage.stageStatus === "complete").length
    : processing?.completed_stage_count ?? computedStages.filter((stage) => stage.stageStatus === "complete").length;
  const totalCount = useDisplayedStageCounts ? computedStages.length : processing?.total_stage_count ?? computedStages.length;
  const progressValue = totalCount ? Math.round((completeCount / totalCount) * 100) : 0;
  const className = [
    "agent-process-rail",
    compact ? "is-compact" : "",
    orientation === "vertical" ? "is-vertical" : "",
    presentation === "focused" ? "is-focused" : ""
  ].filter(Boolean).join(" ");
  return (
    <section aria-busy={status === "running"} aria-label={`${agentName} process`} className={className} data-status={status}>
      <div className="agent-process-rail__head">
        <span><IconActivity size={16} stroke={1.9} /><strong>{orientation === "vertical" ? profileDefinition.heading : agentName}</strong></span>
        <em>{orientation === "vertical" ? `${agentName} · ` : ""}{processing?.status_label || (status === "running" ? "Request in progress" : status === "completed" ? "Ready for review" : status === "failed" ? "Needs attention" : "Run plan")}</em>
      </div>
      {isIndeterminate ? <p aria-live="polite" className="agent-process-rail__waiting" role="status"><IconLoader2 aria-hidden="true" className="agent-inline-spinner" size={16} />Waiting for reported stages</p> : (
        <div
          aria-label={`${completeCount} of ${totalCount} workflow phases complete`}
          className="agent-process-rail__progress"
          role="progressbar"
          aria-valuemax={totalCount}
          aria-valuemin={0}
          aria-valuenow={completeCount}
        >
          <span><b style={{ width: `${progressValue}%` }} /></span>
          <em>{`${completeCount}/${totalCount} complete`}</em>
        </div>
      )}
      <div className="agent-process-rail__stages">
        {computedStages.map((stage, index) => {
          const stageStatus = isIndeterminate ? "queued" : stage.stageStatus;
          return (
            <button
              aria-current={!isIndeterminate && index === activeIndex ? "step" : undefined}
              aria-haspopup="dialog"
              aria-label={`${stage.label}, ${stageStatus}`}
              aria-pressed={selectedStageId === stage.id}
              className="agent-process-stage"
              data-stage-status={stageStatus}
              key={stage.id}
              onClick={() => {
                setSelectedStageId(stage.id);
                setIsEvidenceOpen(true);
              }}
              type="button"
            >
              {stageStatus === "running" ? <span><IconLoader2 aria-hidden="true" className="agent-inline-spinner" size={14} /></span> : <span>{stageStatus === "complete" ? <IconCheck size={14} stroke={2.2} /> : <IconCircle size={11} stroke={2} />}</span>}
              <div><strong>{stage.label}</strong><small>{stage.detail}</small></div>
            </button>
          );
        })}
      </div>
      <div aria-live="polite" className="agent-process-rail__trace" role="status">
        <span>{isIndeterminate ? "Processing request" : selectedStage.label}</span>
        <p>{isIndeterminate ? "The request is active. Phase completion will appear only after the backend reports it." : selectedSnapshot?.detail || selectedStage.detail}</p>
        <AiEvidenceButton label="Inspect evidence" onClick={() => setIsEvidenceOpen(true)} />
      </div>
      <AiEvidenceButton className="agent-process-rail__all-evidence" label="View full run evidence" onClick={() => setIsEvidenceOpen(true)} />
      <AiEvidenceFlyout
        description={selectedEvidence}
        eyebrow={`${profileDefinition.heading} · ${agentName}`}
        facts={[
          { label: "Phase", value: isIndeterminate ? "Backend processing" : selectedStage.label },
          { label: "State", value: isIndeterminate ? "in progress" : selectedSnapshot?.status || computedStages.find((stage) => stage.id === selectedStage.id)?.stageStatus || "queued" },
          { label: "Progress", value: isIndeterminate ? "Awaiting observed phase updates" : `${completeCount} of ${totalCount} phases complete` }
        ]}
        onClose={() => setIsEvidenceOpen(false)}
        open={isEvidenceOpen}
        title={`${selectedStage.label} evidence`}
      >
        <section className="ai-evidence-flyout__section">
          <header><span>Run trace</span><strong>What each phase used and produced</strong></header>
          <ol className="ai-evidence-flyout__timeline">
            {computedStages.map((stage) => (
              <li data-status={isIndeterminate ? "queued" : stage.stageStatus} key={stage.id}>
                <span>{!isIndeterminate && stage.stageStatus === "complete" ? <IconCheck aria-hidden="true" size={13} stroke={2.2} /> : <IconCircle aria-hidden="true" size={10} stroke={2} />}</span>
                <div>
                  <strong>{stage.label}</strong>
                  <p>{stage.evidenceText}</p>
                  {stage.itemCount > 0 || stage.durationMs > 0 ? (
                    <small>{[
                      stage.itemCount > 0 ? `${stage.itemCount} item${stage.itemCount === 1 ? "" : "s"}` : null,
                      stage.durationMs > 0 ? `${stage.durationMs} ms` : null
                    ].filter(Boolean).join(" · ")}</small>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
        <p className="ai-evidence-flyout__boundary"><IconShieldCheck aria-hidden="true" size={16} stroke={1.9} />This shows decision evidence and recorded processing metadata, never hidden model reasoning.</p>
      </AiEvidenceFlyout>
    </section>
  );
}

const phaseLabels: Record<string, string> = {
  intake: "Intent understood",
  context: "Context built",
  guardrails: "Guardrails applied",
  specialist: "Specialist analysis",
  outcome: "Outcome produced",
  evaluation: "Output evaluated",
  failed: "Session stopped"
};

const runningTrace = [
  { phase: "intake", message: "Understanding the request and selecting the specialist contract." },
  { phase: "context", message: "Retrieving bounded Stories, Test Cases, Runs, Defects, automation, and knowledge." },
  { phase: "guardrails", message: "Checking permissions, untrusted context, tool limits, and the human approval boundary." },
  { phase: "specialist", message: "The selected agent is analyzing evidence and preparing a decision summary." },
  { phase: "outcome", message: "A reviewable outcome will appear here." },
  { phase: "evaluation", message: "Grounding, completeness, traceability, and risk control will be scored." }
];

export function AgentActivityTimeline({ events = [], running = false, activeAgentName = "HelloTest Agent" }: { events?: WorkspaceTransactionEvent[]; running?: boolean; activeAgentName?: string }) {
  const [evidenceEventId, setEvidenceEventId] = useState<string | null>(null);

  const items = events.length ? events.map((event, index) => ({
    id: event.id,
    phase: event.phase || "activity",
    message: event.message,
    level: event.level,
    details: event.details,
    createdAt: event.created_at,
    status: event.level === "error" ? "failed" : running && index === events.length - 1 ? "running" : "complete"
  })) : runningTrace.map((event, index) => ({
    id: `${event.phase}-${index}`,
    ...event,
    level: "info",
    details: {},
    createdAt: undefined,
    status: index === 0 && running ? "running" : "queued"
  }));
  const evidenceEvent = items.find((item) => item.id === evidenceEventId);
  const evidenceDetails = evidenceEvent ? toDetailsList(evidenceEvent.details) : [];

  return (
    <section className="agent-activity-timeline">
      <header>
        <div><span>Live activity</span><strong>{activeAgentName}</strong></div>
        <em data-running={running || undefined}>{running ? "Working" : events.length ? "Trace captured" : "Ready"}</em>
      </header>
      <div className="agent-activity-timeline__list">
        {items.map((item) => {
          const details = toDetailsList(item.details);
          return (
            <article className="agent-activity-event" data-status={item.status} key={item.id}>
              {item.status === "running" ? <span className="agent-activity-event__marker"><IconLoader2 aria-hidden="true" className="agent-inline-spinner" size={14} /></span> : <span className="agent-activity-event__marker">{item.status === "complete" ? <IconCheck size={14} stroke={2.2} /> : item.status === "failed" ? <IconCircle size={12} /> : <IconClock size={13} stroke={1.9} />}</span>}
              <div>
                <header><strong>{phaseLabels[item.phase] || item.phase.replace(/_/g, " ")}</strong>{item.createdAt ? <time>{formatActivityTime(item.createdAt)}</time> : null}</header>
                <p>{item.message}</p>
                {details.length ? (
                  <AiEvidenceButton label="Inspect activity evidence" onClick={() => setEvidenceEventId(item.id)} />
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      <AiEvidenceFlyout
        description={evidenceEvent?.message}
        eyebrow={`${activeAgentName} · Recorded activity`}
        facts={evidenceEvent ? [
          { label: "Phase", value: phaseLabels[evidenceEvent.phase] || evidenceEvent.phase.replace(/_/g, " ") },
          { label: "State", value: evidenceEvent.status },
          { label: "Recorded", value: evidenceEvent.createdAt ? formatActivityTime(evidenceEvent.createdAt) : "Current session" }
        ] : []}
        onClose={() => setEvidenceEventId(null)}
        open={Boolean(evidenceEvent)}
        title="Activity evidence"
      >
        <section className="ai-evidence-flyout__section">
          <header><span>Recorded metadata</span><strong>Inputs and outputs disclosed by this event</strong></header>
          {evidenceDetails.length ? (
            <dl className="ai-evidence-flyout__record-list">
              {evidenceDetails.map(([key, value]) => <div key={key}><dt>{key.replace(/_/g, " ")}</dt><dd>{value}</dd></div>)}
            </dl>
          ) : <p className="ai-evidence-flyout__empty">No additional event metadata was recorded.</p>}
        </section>
      </AiEvidenceFlyout>
    </section>
  );
}

const formatActivityTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(date);
};

const toDetailsList = (details: Record<string, unknown>) => Object.entries(details || {})
  .filter(([key]) => !["citations", "evaluation"].includes(key))
  .slice(0, 6)
  .map(([key, value]) => [key, typeof value === "string" ? value : Array.isArray(value) ? value.join(", ") : JSON.stringify(value)] as [string, string]);

export function AgenticOutcomePanel({ result, citations = [], guardrails = [], provenance, onAccept }: {
  result: AgenticAssistantResult;
  citations?: AgenticAssistantCitation[];
  guardrails?: string[];
  provenance?: {
    provider?: string;
    model?: string | null;
    generation_mode?: string;
    fallback_reason?: string | null;
    requires_human_review?: boolean;
    context_route?: {
      input_type?: string;
      priority_scopes?: string[];
      retrieval_focus?: string;
      resolved_query?: string;
      conversation_reference_used?: boolean;
      decision_question?: string;
      deliverable_contract?: string;
    } | null;
  };
  onAccept?: (proposal: { response: string; recommendations: string[] }) => void;
}) {
  const [draftResponse, setDraftResponse] = useState(result.response);
  const [draftRecommendations, setDraftRecommendations] = useState(result.recommendations);
  const [selectedRecommendationIndexes, setSelectedRecommendationIndexes] = useState(result.recommendations.map((_, index) => index));
  const [accepted, setAccepted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("summary");
  const [comparing, setComparing] = useState(false);
  const surfaceId = useId();
  const groundedCitations = result.citation_ids?.length
    ? citations.filter((citation) => result.citation_ids?.includes(citation.id))
    : [];
  const findings = result.findings || [];
  const deliverables = result.deliverables || [];
  const evidenceGaps = result.evidence_gaps || [];
  const contextRouteLabel = provenance?.context_route?.input_type?.replace(/_/g, " ") || "specialist task";

  useEffect(() => {
    setDraftResponse(result.response);
    setDraftRecommendations(result.recommendations);
    setSelectedRecommendationIndexes(result.recommendations.map((_, index) => index));
    setAccepted(false);
    setEditing(false);
    setActiveSection("summary");
    setComparing(false);
    setExportNotice("");
  }, [result]);

  const briefText = () => [
    `# ${result.headline || "Specialist review"}`,
    result.executive_summary,
    draftResponse,
    findings.length ? `## Findings\n${findings.map(item => `### ${item.title}\n${item.detail}${item.citation_ids?.length ? `\nSources: ${item.citation_ids.join(", ")}` : "\nEvidence requires verification."}`).join("\n\n")}` : "",
    deliverables.length ? `## Deliverables\n${deliverables.map(item => `### ${item.title}\n${item.detail}${item.citation_ids?.length ? `\nSources: ${item.citation_ids.join(", ")}` : ""}`).join("\n\n")}` : "",
    result.readiness?.limitations?.length ? `## Review limitations\n${result.readiness.limitations.map(item => `- ${item}`).join("\n")}` : "",
    selectedRecommendationIndexes.length ? `## Next actions\n${selectedRecommendationIndexes.map(index => `- ${draftRecommendations[index]}`).join("\n")}` : "",
    result.assumptions.length ? `## Assumptions\n${result.assumptions.map(item => `- ${item}`).join("\n")}` : "",
    evidenceGaps.length ? `## Evidence gaps\n${evidenceGaps.map(item => `- ${item}`).join("\n")}` : "",
    `## Sources\n${groundedCitations.length ? groundedCitations.map(item => `- ${item.label} (${item.scope}: ${item.id})`).join("\n") : "No verified references were returned."}`,
    `Generation: ${provenance?.generation_mode || "evidence review"}${provenance?.model ? ` · ${provenance.model}` : ""}. Review before applying changes.`
  ].filter(Boolean).join("\n\n");
  const readiness = result.readiness?.status;

  return (
    <section className="agent-outcome-panel">
      <header>
        <div><span>Agent outcome</span><strong>{result.headline || "Ready for human review"}</strong></div>
        <span className="agent-brief-readiness" data-readiness={readiness || "unverified"}>{readiness === "ready_for_review" ? "Ready for review" : readiness === "limited_evidence" ? "Limited evidence" : readiness === "insufficient_evidence" ? "More evidence needed" : "Review required"}</span>
      </header>
      <nav className="agent-artifact-navigation" aria-label="Output sections" role="tablist">{[
        { id: "summary", label: "Overview", count: undefined },
        ...(findings.length ? [{ id: "findings", label: "Findings", count: findings.length }] : []),
        ...(deliverables.length ? [{ id: "deliverables", label: "Artifacts", count: deliverables.length }] : []),
        { id: "details", label: "Full brief", count: undefined },
        ...(draftRecommendations.length ? [{ id: "actions", label: "Next actions", count: draftRecommendations.length }] : [])
      ].map((section, index, sections) => <button aria-controls={`${surfaceId}-${section.id}`} aria-selected={activeSection === section.id} id={`${surfaceId}-tab-${section.id}`} key={section.id} onClick={() => setActiveSection(section.id)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % sections.length : event.key === "ArrowLeft" ? (index + sections.length - 1) % sections.length : event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); setActiveSection(sections[next].id); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus(); }
      }} role="tab" tabIndex={activeSection === section.id ? 0 : -1} type="button">{section.label}{typeof section.count === "number" ? <span>{section.count}</span> : null}</button>)}</nav>


      {result.artifacts?.length ? <AgentArtifactReview artifacts={result.artifacts} chain={result.agent_chain || []} /> : null}
      {result.automation_repair&&<AutomationRepairReview summary={result.automation_repair}/>}
      {result.quality_assessment && <QualityEvidencePanel key={result.quality_assessment.snapshot_hash} report={result.quality_assessment} />}
      {result.verification && <details className="agent-brief-limitations" open={result.verification.status !== "passed"}><summary>Completion checks · {result.verification.status === "passed" ? "passed · human review required" : "more input needed"}</summary><ul>{result.verification.checks.map(check => <li key={check.id}>{check.passed ? "Passed" : "Unmet"}: {check.label}</li>)}</ul>{result.verification.limitations.map(item => <p key={item}>{item}</p>)}{result.model_execution && <p>Model: {result.model_execution.effective_model} · {result.model_execution.model_calls}/{result.model_execution.max_model_calls} calls · agent v{result.model_execution.agent_version}</p>}</details>}
      {exportNotice && <p className="agent-brief-export-notice" role="status">{exportNotice}</p>}
      {result.readiness?.limitations?.length ? <div className="agent-brief-limitations"><strong>Review limitations</strong><ul>{result.readiness.limitations.map(item => <li key={item}>{item}</li>)}</ul></div> : null}
      <section aria-labelledby={`${surfaceId}-tab-summary`} className="agent-outcome-executive-summary" hidden={activeSection !== "summary" && !editing} id={`${surfaceId}-summary`} role="tabpanel">
        <span>Decision summary</span><p>{result.executive_summary || draftResponse}</p>
      </section>
      {findings.length ? (
        <section aria-labelledby={`${surfaceId}-tab-findings`} className="agent-outcome-findings" aria-label="Agent findings" hidden={activeSection !== "findings" && !editing} id={`${surfaceId}-findings`} role="tabpanel">
          <header><span>Evidence-backed findings</span><strong>{findings.length} item{findings.length === 1 ? "" : "s"}</strong></header>
          <div>{findings.map((finding, index) => (
            <article data-priority={finding.priority || "info"} key={`${finding.title}:${index}`}>
              <header><strong>{finding.title}</strong><span>{finding.priority || "info"}</span></header>
              <p>{finding.detail}</p>
              {finding.citation_ids?.length ? <small>{finding.citation_ids.length} supporting reference{finding.citation_ids.length === 1 ? "" : "s"}</small> : <small>Evidence gap · verify before use</small>}
            </article>
          ))}</div>
        </section>
      ) : null}
      {deliverables.length ? (
        <section aria-labelledby={`${surfaceId}-tab-deliverables`} className="agent-outcome-deliverables" aria-label="Specialist deliverables" hidden={activeSection !== "deliverables" && !editing} id={`${surfaceId}-deliverables`} role="tabpanel">
          <header><span>Specialist deliverables</span><strong>Use as a reviewable starting point</strong></header>
          <div>{deliverables.map((deliverable, index) => (
            <article key={`${deliverable.title}:${index}`}>
              <span>{deliverable.type?.replace(/_/g, " ") || "deliverable"}</span>
              <strong>{deliverable.title}</strong>
              <FormattedText text={deliverable.detail} />
            </article>
          ))}</div>
        </section>
      ) : null}
      <div aria-labelledby={`${surfaceId}-tab-details`} className="agent-outcome-response-editor" hidden={activeSection !== "details" && !editing} id={`${surfaceId}-details`} role="tabpanel">
        <label htmlFor={editing ? `${surfaceId}-response` : undefined}><span>Detailed specialist output</span><em>{editing ? "Editing export copy" : "Review brief"}</em></label>
        {editing ? <textarea id={`${surfaceId}-response`} onChange={(event) => { setDraftResponse(event.target.value); setAccepted(false); }} rows={10} value={draftResponse} /> : <div aria-label="Complete specialist output" className="agent-brief-body" role="region" tabIndex={0}><FormattedText text={draftResponse} /></div>}
      </div>
      {draftRecommendations.length ? (
        <div aria-labelledby={`${surfaceId}-tab-actions`} className="agent-outcome-section agent-outcome-recommendation-review" hidden={activeSection !== "actions" && !editing} id={`${surfaceId}-actions`} role="tabpanel">
          <strong>Recommended next actions</strong>
          {editing ? <div>{draftRecommendations.map((item, index) => (
            <label data-selected={selectedRecommendationIndexes.includes(index) || undefined} key={`${index}:${result.recommendations[index]}`}>
              <input checked={selectedRecommendationIndexes.includes(index)} onChange={(event) => { setSelectedRecommendationIndexes((current) => event.target.checked ? [...new Set([...current, index])] : current.filter((itemIndex) => itemIndex !== index)); setAccepted(false); }} type="checkbox" />
              <textarea aria-label={`Edit next action ${index + 1}`} onChange={(event) => { setDraftRecommendations((current) => current.map((recommendation, itemIndex) => itemIndex === index ? event.target.value : recommendation)); setAccepted(false); }} rows={2} value={item} />
            </label>
          ))}</div> : <div className="agent-brief-action-selection">{draftRecommendations.map((item, index) => <label key={index}><input checked={selectedRecommendationIndexes.includes(index)} onChange={event => { setSelectedRecommendationIndexes(current => event.target.checked ? [...new Set([...current, index])] : current.filter(itemIndex => itemIndex !== index)); setAccepted(false); }} type="checkbox" /><span>{item}</span></label>)}</div>}
        </div>
      ) : null}
      {result.assumptions.length ? <details className="agent-outcome-details"><summary>Assumptions to verify ({result.assumptions.length})</summary><ul>{result.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}
      {evidenceGaps.length ? <details className="agent-outcome-details is-evidence-gap" open><summary>Evidence gaps ({evidenceGaps.length})</summary><ul>{evidenceGaps.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}
      <AiEvidenceButton label="Sources" onClick={() => setIsEvidenceOpen(true)} />
      <div className="agent-outcome-action-dock">
      <div className="agent-brief-tools">
        <span>{provenance?.generation_mode === "llm" ? "Model-assisted review" : "Evidence summary"}</span>
        <button className="ghost-button compact" type="button" aria-pressed={editing} onClick={() => { setEditing(value => !value); setActiveSection("details"); }}>{editing ? "Finish editing" : "Edit brief"}</button>
        <button className="ghost-button compact" type="button" onClick={async () => { try { await navigator.clipboard.writeText(briefText()); setExportNotice("Brief copied."); } catch { setExportNotice("Copy is unavailable. Download the brief instead."); } }}><IconCopy size={15} aria-hidden="true" />Copy</button>
        <button className="ghost-button compact" type="button" onClick={() => { const blob = new Blob([briefText()], { type: "text/markdown;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "specialist-review.md"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setExportNotice("Review brief downloaded."); }}><IconDownload size={15} aria-hidden="true" />Download brief</button>
      </div>
      {editing ? <button aria-pressed={comparing} className="ghost-button compact" onClick={() => setComparing(value => !value)} type="button">{comparing ? "Hide comparison" : "Compare edits"}</button> : null}
      <footer className="agent-outcome-review-actions">
        <span>{onAccept ? accepted ? "Reviewed proposal accepted." : "Review the edited selection before accepting." : "Edits apply to your copied or downloaded brief. Use the destination workspace to save application changes."}</span>
        <button className="ghost-button" disabled={draftResponse === result.response && draftRecommendations.every((item, index) => item === result.recommendations[index]) && selectedRecommendationIndexes.length === result.recommendations.length && selectedRecommendationIndexes.every((value, index) => value === index)} onClick={() => {
          setDraftResponse(result.response);
          setDraftRecommendations(result.recommendations);
          setSelectedRecommendationIndexes(result.recommendations.map((_, index) => index));
          setAccepted(false);
        }} type="button">Reset</button>
        {onAccept && <button className="primary-button" disabled={!draftResponse.trim() || accepted} onClick={() => {
          const recommendations = selectedRecommendationIndexes.map((index) => draftRecommendations[index]?.trim()).filter(Boolean);
          onAccept?.({ response: draftResponse.trim(), recommendations });
          setAccepted(true);
        }} type="button">Accept agent output</button>}
      </footer>
      </div>
      {comparing ? <AiProposalCompare fields={[{ label: "Brief", before: result.response, after: draftResponse }, { label: "Next actions", before: result.recommendations.join("\n"), after: selectedRecommendationIndexes.map(index => draftRecommendations[index]).join("\n") }]} /> : null}
      <AiEvidenceFlyout
        description="Review the sources, guardrails, provider, and approval boundary behind this editable outcome."
        eyebrow="Agent outcome · Evidence"
        facts={[
          { label: "References", value: groundedCitations.length },
          { label: "Guardrails", value: guardrails.length },
          { label: "Route", value: contextRouteLabel }
        ]}
        onClose={() => setIsEvidenceOpen(false)}
        open={isEvidenceOpen}
        title="Outcome evidence"
      >
        <section className="ai-evidence-flyout__section">
          <header><span>Context route</span><strong>Why this evidence was selected</strong></header>
          <dl className="ai-evidence-flyout__record-list">
            <div><dt>Input</dt><dd>{contextRouteLabel}</dd></div>
            <div><dt>Decision</dt><dd>{provenance?.context_route?.decision_question || "What conclusion is supported by the selected project evidence?"}</dd></div>
            <div><dt>Deliverable</dt><dd>{provenance?.context_route?.deliverable_contract || "A reviewable evidence-backed specialist outcome"}</dd></div>
            <div><dt>Priority scopes</dt><dd>{provenance?.context_route?.priority_scopes?.join(", ") || "Selected project context"}</dd></div>
            <div><dt>Retrieval focus</dt><dd>{provenance?.context_route?.retrieval_focus || "The submitted specialist task"}</dd></div>
            {provenance?.context_route?.conversation_reference_used ? <div><dt>Resolved follow-up</dt><dd>{provenance.context_route.resolved_query || "Previous conversation context was used to resolve this request."}</dd></div> : null}
          </dl>
        </section>
        <section className="ai-evidence-flyout__section">
          <header><span>Sources</span><strong>Citations used for this outcome</strong></header>
          {groundedCitations.length ? (
            <ul className="ai-evidence-flyout__source-list">
              {groundedCitations.map((citation) => <li key={`${citation.scope}:${citation.id}`}><span>{formatRecordKindLabel(citation.source_kind || citation.scope)}</span><strong>{citation.label}</strong><code>{citation.id}</code></li>)}
            </ul>
          ) : <p className="ai-evidence-flyout__empty">No citation was returned. Treat the outcome as ungrounded until a source is added.</p>}
        </section>
        <section className="ai-evidence-flyout__section">
          <header><span>Guardrails</span><strong>Boundaries applied to the run</strong></header>
          {guardrails.length ? <ul className="ai-evidence-flyout__bullet-list">{guardrails.map((guardrail) => <li key={guardrail}>{guardrail}</li>)}</ul> : <p className="ai-evidence-flyout__empty">No guardrail detail was returned.</p>}
        </section>
        <section className="ai-evidence-flyout__section">
          <header><span>Provenance</span><strong>Generation route</strong></header>
          <dl className="ai-evidence-flyout__record-list">
            <div><dt>Provider</dt><dd>{provenance?.provider || "HelloTest evidence engine"}</dd></div>
            <div><dt>Model</dt><dd>{provenance?.model || "Deterministic"}</dd></div>
            <div><dt>Mode</dt><dd>{provenance?.generation_mode || "Evidence assisted"}</dd></div>
            {provenance?.fallback_reason ? <div><dt>Model fallback</dt><dd>The configured model was unavailable or its output failed the citation contract, so HelloTest retained the deterministic evidence brief.</dd></div> : null}
          </dl>
        </section>
      </AiEvidenceFlyout>
    </section>
  );
}

export function AgentWorkflowJourney() {
  const stages = [
    ["Understand", "Intent + constraints", <IconMessageCircle />],
    ["Ground", "Scoped evidence", <IconDatabase />],
    ["Delegate", "Specialist + tools", <IconRobot />],
    ["Guard", "Policy + approvals", <IconShieldCheck />],
    ["Evaluate", "Quality scores", <IconActivity />],
    ["Review", "Human-owned action", <IconUserCheck />]
  ];
  return (
    <section className="agent-workflow-journey" aria-label="HelloTest agent lifecycle">
      <header><span>Agent lifecycle</span><strong>Every AI feature uses the same governed path</strong></header>
      <div>{stages.map(([title, detail, icon], index) => (
        <article key={String(title)}><span>{icon}</span><strong>{title}</strong><small>{detail}</small>{index < stages.length - 1 ? <IconArrowRight className="agent-workflow-journey__arrow" /> : null}</article>
      ))}</div>
    </section>
  );
}
