import { FormattedText } from "@hellotest/platform/frontend/src/shared/components/FormattedText";
import specialistProfiles from "@hellotest/contracts/agents/workflowSpecialists.json";
import { useAiLlmAutoSelection, useAiLlmDefault } from "@hellotest/integration/frontend/hooks/useAiLlmDefault";
import { smartContextKindsForScopes } from "@hellotest/ai/frontend/lib/smartContext";
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
import "./AgentExperiencePrimitives.css";

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
  allowEmptyPrompt?: boolean;
  submitLabel?: string;
  promptLabel?: string;
  identityDescription?: string;
  optionsContent?: ReactNode;
  secondaryAction?: ReactNode;
  showReviewCue?: boolean;
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
  submitDisabled?: boolean;
  running?: boolean;
  scopeLabel?: string;
  smartContext?: SmartContextSelection | null;
  evidenceScopeControl?: ReactNode;
  evidenceScope?: Record<string, unknown>;
};

export function AgenticCommandComposer({
  allowEmptyPrompt = false, submitLabel = "Start review", promptLabel = "Ask or delegate to HelloTest AI", identityDescription = "Structured evidence review", optionsContent,
  secondaryAction, showReviewCue = true,
  evidenceScopeControl, evidenceScope,
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
  submitDisabled = false,
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
    if (!disabled && !submitDisabled && !running && (allowEmptyPrompt || prompt.trim())) onSubmit();
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
          <small>{identityDescription}</small>
        </div>
        {showReviewCue ? <span className="agent-command-composer__governed"><IconShieldCheck size={15} stroke={1.9} />Review before apply</span> : null}
      </div>
      {contextScopes.length ? <div className="agent-command-attached-context" aria-label="Included context sources">{contextScopes.map(scope => <button aria-label={`Remove ${AGENT_CONTEXT_OPTIONS.find(option => option.id === scope)?.label || scope} context`} disabled={disabled || running} key={scope} onClick={() => toggleScope(scope)} type="button"><IconDatabase size={12} aria-hidden="true" />{AGENT_CONTEXT_OPTIONS.find(option => option.id === scope)?.label || scope}<span aria-hidden="true">×</span></button>)}</div> : null}
      <textarea
        aria-label={promptLabel}
        disabled={disabled || running}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            if (!disabled && !submitDisabled && !running && (allowEmptyPrompt || prompt.trim())) onSubmit();
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
              key={JSON.stringify([projectId, appTypeId, agentId, contextScopes, evidenceScope])}
              appTypeId={appTypeId}
              buttonClassName="agent-command-smart-context"
              buttonLabel={smartContext?.resultCount ? `Smart Context · ${smartContext.resultCount}` : "Smart Context"}
              disabled={disabled || running || !contextScopes.length}
              agentId={agentId} contextScopes={contextScopes} evidenceScope={evidenceScope}
              initialQuery={prompt}
              onApply={onSmartContextChange}
              preferredSourceKinds={smartContextKindsForScopes(contextScopes)}
              projectId={projectId}
            />
          ) : null}
          {evidenceScopeControl}
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

              {optionsContent}
              <small>Applied to the next request.</small>
            </div>
          </details>
          <span className="agent-command-divider" aria-hidden="true" />
          {secondaryAction}
          <button aria-label={running ? "Review in progress" : submitLabel} className="agent-command-send" disabled={disabled || submitDisabled || running || (!allowEmptyPrompt && !prompt.trim())} type="submit">
            {running ? <IconLoader2 aria-hidden="true" className="agent-inline-spinner" size={18} /> : <IconSend size={19} stroke={1.9} />}
            <span>{running ? "Working…" : submitLabel}</span>
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

