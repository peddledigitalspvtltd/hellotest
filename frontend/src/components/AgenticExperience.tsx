import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  IconActivity,
  IconArrowRight,
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconCircle,
  IconClock,
  IconDatabase,
  IconMessageCircle,
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
} from "../types";
import "./AgenticExperience.css";

export type HelloTestAgent = {
  id: string;
  name: string;
  shortName: string;
  description: string;
  capabilities: string[];
  prompt: string;
  icon: ReactNode;
};

export const HELLOTEST_AGENT_CATALOG: HelloTestAgent[] = [
  {
    id: "quality-orchestrator",
    name: "Quality Orchestrator",
    shortName: "Orchestrator",
    description: "Coordinates specialists, evidence, guardrails, handoffs, and the final review gate.",
    capabilities: ["Plan", "Coordinate", "Evaluate"],
    prompt: "Build a release quality plan, identify the highest-risk gaps, and show which specialist should handle each one.",
    icon: <IconRoute />
  },
  {
    id: "story-architect",
    name: "Story Architect",
    shortName: "Story",
    description: "Creates and completes testable Stories with acceptance boundaries, examples, and Gherkin.",
    capabilities: ["Create", "Complete", "Groom"],
    prompt: "Review the current Stories for ambiguity, missing acceptance boundaries, risks, and testability gaps.",
    icon: <IconSparkles />
  },
  {
    id: "test-designer",
    name: "Test Design Agent",
    shortName: "Test design",
    description: "Generates and improves traceable manual, Gherkin, and automation-ready Test Cases.",
    capabilities: ["Generate", "Improve", "Trace"],
    prompt: "Propose the smallest high-value Test Case set that covers current Story risks and missing boundaries.",
    icon: <IconTargetArrow />
  },
  {
    id: "automation-engineer",
    name: "Automation Engineer",
    shortName: "Automation",
    description: "Plans resilient automation, reusable groups, test data, repository bindings, and recorder follow-up.",
    capabilities: ["Build", "Review", "Repair"],
    prompt: "Review automation readiness, reuse opportunities, and fragile bindings, then propose a bounded build plan.",
    icon: <IconRobot />
  },
  {
    id: "run-planner",
    name: "Smart Run Planner",
    shortName: "Smart run",
    description: "Selects impacted tests using release scope, Story traceability, risk, and execution history.",
    capabilities: ["Impact", "Select", "Prioritize"],
    prompt: "Plan a Smart Run for the current delivery scope and explain why every selected Test Case matters.",
    icon: <IconPlayerPlay />
  },
  {
    id: "failure-analyst",
    name: "Failure Analyst",
    shortName: "Run analysis",
    description: "Explains failed and blocked evidence, clusters symptoms, and separates facts from hypotheses.",
    capabilities: ["Analyze", "Cluster", "Explain"],
    prompt: "Analyze recent failed and blocked runs, separate product risk from environment noise, and cite the evidence.",
    icon: <IconActivity />
  },
  {
    id: "bug-reporter",
    name: "Bug Reporter",
    shortName: "Bug draft",
    description: "Turns run, case, Story, and observed evidence into a concise review-ready Bug draft.",
    capabilities: ["Draft", "Link", "Evidence"],
    prompt: "Find the strongest recent failure evidence and prepare a review-ready Bug outline without creating it.",
    icon: <IconMessageCircle />
  },
  {
    id: "bug-triage",
    name: "Bug Triage Agent",
    shortName: "Bug triage",
    description: "Classifies, prioritizes, and sequences Bugs while leaving the final decision with a person.",
    capabilities: ["Classify", "Prioritize", "Sequence"],
    prompt: "Triage open Bugs using severity, execution evidence, release scope, and traceability; explain every recommendation.",
    icon: <IconUserCheck />
  },
  {
    id: "quality-evaluator",
    name: "Quality Evaluator",
    shortName: "Evaluator",
    description: "Scores grounding, completeness, traceability, risk control, and outcome maturity.",
    capabilities: ["Score", "Challenge", "Guard"],
    prompt: "Evaluate current AI-assisted artifacts for grounding, completeness, traceability, and review readiness.",
    icon: <IconShieldCheck />
  },
  {
    id: "repository-curator",
    name: "Object Repository Curator",
    shortName: "Repository",
    description: "Reviews locator intent, reuse, stability, healing evidence, and approval-ready repository changes.",
    capabilities: ["Inspect", "Reuse", "Heal"],
    prompt: "Review repository stability and duplication, then prioritize approval-ready locator improvements.",
    icon: <IconDatabase />
  }
];

export const AGENT_CONTEXT_OPTIONS = [
  { id: "stories", label: "Stories" },
  { id: "test-cases", label: "Test Cases" },
  { id: "automation", label: "Automation" },
  { id: "runs", label: "Runs" },
  { id: "bugs", label: "Bugs" },
  { id: "knowledge", label: "Knowledge" }
] as const;

type AgenticCommandComposerProps = {
  mode: AgenticAssistantMode;
  onModeChange: (mode: AgenticAssistantMode) => void;
  agents?: HelloTestAgent[];
  agentId: string;
  onAgentChange: (agentId: string) => void;
  contextScopes: string[];
  onContextScopesChange: (scopes: string[]) => void;
  integrationId?: string;
  integrations?: Array<{ id: string; name: string; model?: string | null }>;
  onIntegrationChange?: (integrationId: string) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  running?: boolean;
  scopeLabel?: string;
};

export function AgenticCommandComposer({
  mode,
  onModeChange,
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
  onSubmit,
  disabled = false,
  running = false,
  scopeLabel = "Current project"
}: AgenticCommandComposerProps) {
  const selectedAgent = agents.find((agent) => agent.id === agentId) || agents[0];
  const contextDetailsRef = useRef<HTMLDetailsElement>(null);
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
          <small>{mode === "chat" ? "Conversational review" : "Multi-step agent task with a review gate"}</small>
        </div>
        <span className="agent-command-composer__governed"><IconShieldCheck size={15} stroke={1.9} />Governed</span>
      </div>
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
        placeholder="Ask anything about quality, or type @ to describe the context the agent should consider"
        rows={4}
        value={prompt}
      />
      <div className="agent-command-composer__footer">
        <div className="agent-command-composer__controls">
          <div aria-label="AI interaction mode" className="agent-command-mode" role="group">
            <button aria-pressed={mode === "chat"} onClick={() => onModeChange("chat")} type="button">
              <IconMessageCircle size={16} stroke={1.9} />Chat
            </button>
            <button aria-pressed={mode === "agent"} onClick={() => onModeChange("agent")} type="button">
              <IconRobot size={16} stroke={1.9} />Agent
            </button>
          </div>
          <label className="agent-command-select">
            <IconSparkles aria-hidden="true" size={16} stroke={1.9} />
            <select aria-label="Specialist agent" disabled={disabled || running} onChange={(event) => onAgentChange(event.target.value)} value={agentId}>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.shortName}</option>)}
            </select>
            <IconChevronDown aria-hidden="true" size={14} stroke={1.9} />
          </label>
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
                  <input checked={contextScopes.includes(option.id)} onChange={() => toggleScope(option.id)} type="checkbox" />
                  <span>{option.label}</span>
                </label>
              ))}
              <button onClick={() => {
                onContextScopesChange(AGENT_CONTEXT_OPTIONS.map((option) => option.id));
                contextDetailsRef.current?.removeAttribute("open");
              }} type="button">Use all context</button>
            </div>
          </details>
          <button aria-label="Add context" className="agent-command-add" onClick={() => contextDetailsRef.current?.setAttribute("open", "")} title="Add workspace context" type="button"><IconPlus size={18} stroke={1.9} /></button>
        </div>
        <div className="agent-command-composer__submit-group">
          {onIntegrationChange ? (
            <label className="agent-command-provider">
              <span className="sr-only">AI provider</span>
              <select disabled={disabled || running} onChange={(event) => onIntegrationChange(event.target.value)} value={integrationId}>
                <option value="">Auto model</option>
                {integrations.map((integration) => (
                  <option key={integration.id} value={integration.id}>{integration.name}{integration.model ? ` · ${integration.model}` : ""}</option>
                ))}
              </select>
              <IconChevronDown size={14} stroke={1.9} />
            </label>
          ) : <span className="agent-command-auto"><IconRobot size={15} stroke={1.9} />Auto</span>}
          <span className="agent-command-divider" aria-hidden="true" />
          <button aria-label={running ? "Agent is working" : mode === "chat" ? "Send question" : "Delegate task"} className="agent-command-send" disabled={disabled || running || !prompt.trim()} type="submit">
            {running ? <IconActivity className="agent-command-spin" size={19} stroke={1.9} /> : <IconSend size={19} stroke={1.9} />}
          </button>
        </div>
      </div>
      <span className="agent-command-shortcut">⌘ Enter to send · Context is bounded and cited</span>
    </form>
  );
}

export type AiFeatureComposerProps = {
  agentName: string;
  mode: AgenticAssistantMode;
  onModeChange: (mode: AgenticAssistantMode) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  contextLabel: string;
  onContextClick?: () => void;
  integrationId?: string;
  integrations?: Array<{ id: string; name: string; model?: string | null }>;
  onIntegrationChange?: (integrationId: string) => void;
  placeholder?: string;
  running?: boolean;
  disabled?: boolean;
  submitDisabled?: boolean;
  allowEmptyPrompt?: boolean;
  submitLabel?: string;
  briefItems?: AiFeatureBriefItem[];
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

export function AiRunBrief({ items, className = "" }: { items: AiFeatureBriefItem[]; className?: string }) {
  if (!items.length) return null;
  return (
    <div aria-label="Agent run brief" className={className ? `ai-feature-composer__brief ${className}` : "ai-feature-composer__brief"}>
      {items.map((item) => {
        const content = (
          <>
            <span className="ai-feature-composer__brief-icon">{featureBriefIcon(item.kind)}</span>
            <span className="ai-feature-composer__brief-copy">
              <small>{item.label}</small>
              <strong title={item.value}>{item.value}</strong>
            </span>
            <span aria-hidden="true" className="ai-feature-composer__brief-state" />
          </>
        );
        return item.onClick ? (
          <button className="ai-feature-composer__brief-item" data-state={item.state || "neutral"} key={item.id} onClick={item.onClick} type="button">
            {content}
          </button>
        ) : (
          <div className="ai-feature-composer__brief-item" data-state={item.state || "neutral"} key={item.id}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

export function AiFeatureComposer({
  agentName,
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
  briefItems = []
}: AiFeatureComposerProps) {
  const canSubmit = allowEmptyPrompt || Boolean(prompt.trim());
  const effectiveSubmitLabel = submitLabel || (mode === "chat" ? "Ask" : "Delegate");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled && !submitDisabled && !running && canSubmit) onSubmit();
  };

  return (
    <form className="ai-feature-composer" onSubmit={submit}>
      <div className="ai-feature-composer__identity">
        <span><IconBrain aria-hidden="true" size={17} stroke={1.9} /></span>
        <div>
          <strong>{agentName}</strong>
          <small>{mode === "chat" ? "Explore and refine together" : "Delegate a bounded task for review"}</small>
        </div>
        <em><IconShieldCheck aria-hidden="true" size={14} stroke={1.9} />Governed</em>
      </div>
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
      <AiRunBrief items={briefItems} />
      <div className="ai-feature-composer__footer">
        <div className="ai-feature-composer__controls">
          <div aria-label="AI interaction mode" className="agent-command-mode" role="group">
            <button aria-pressed={mode === "chat"} disabled={disabled || running} onClick={() => onModeChange("chat")} type="button">
              <IconMessageCircle size={15} stroke={1.9} />Chat
            </button>
            <button aria-pressed={mode === "agent"} disabled={disabled || running} onClick={() => onModeChange("agent")} type="button">
              <IconRobot size={15} stroke={1.9} />Agent
            </button>
          </div>
          <button className="ai-feature-composer__context" disabled={!onContextClick || disabled || running} onClick={onContextClick} type="button">
            <IconDatabase aria-hidden="true" size={15} stroke={1.9} />
            <span>{contextLabel}</span>
          </button>
          <span className="ai-feature-composer__shortcut">⌘ Enter</span>
        </div>
        <div className="ai-feature-composer__submit">
          {onIntegrationChange ? (
            <label className="agent-command-provider">
              <span className="sr-only">AI provider</span>
              <select disabled={disabled || running} onChange={(event) => onIntegrationChange(event.target.value)} value={integrationId}>
                <option value="">Auto model</option>
                {integrations.map((integration) => (
                  <option key={integration.id} value={integration.id}>{integration.name}{integration.model ? ` · ${integration.model}` : ""}</option>
                ))}
              </select>
              <IconChevronDown size={14} stroke={1.9} />
            </label>
          ) : <span className="agent-command-auto"><IconRobot size={14} stroke={1.9} />Auto</span>}
          <span className="agent-command-divider" aria-hidden="true" />
          <button aria-label={running ? `${agentName} is working` : effectiveSubmitLabel} className="ai-feature-composer__send" disabled={disabled || submitDisabled || running || !canSubmit} type="submit">
            {running ? <IconActivity className="agent-command-spin" size={18} stroke={1.9} /> : <IconSend size={18} stroke={1.9} />}
            <span>{running ? "Working" : effectiveSubmitLabel}</span>
          </button>
        </div>
      </div>
    </form>
  );
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

export function AgenticProcessRail({ status = "idle", agentName = "HelloTest Agent", compact = false, stageEvidence = {}, activeStageId }: {
  status?: AgenticProcessStatus;
  agentName?: string;
  compact?: boolean;
  stageEvidence?: Partial<Record<AgenticProcessStageId, string>>;
  activeStageId?: AgenticProcessStageId;
}) {
  const [selectedStageId, setSelectedStageId] = useState<AgenticProcessStageId>(status === "completed" ? "review" : "intake");

  useEffect(() => {
    setSelectedStageId(activeStageId || (status === "completed" ? "review" : status === "running" || status === "failed" ? "specialist" : "intake"));
  }, [activeStageId, status]);

  const requestedActiveIndex = activeStageId ? PROCESS_STAGES.findIndex((stage) => stage.id === activeStageId) : -1;
  const activeIndex = requestedActiveIndex >= 0
    ? requestedActiveIndex
    : status === "idle" ? 0 : status === "running" || status === "failed" ? 3 : PROCESS_STAGES.length - 1;
  const selectedStage = PROCESS_STAGES.find((stage) => stage.id === selectedStageId) || PROCESS_STAGES[0];
  return (
    <section aria-label={`${agentName} process`} className={compact ? "agent-process-rail is-compact" : "agent-process-rail"} data-status={status}>
      <div className="agent-process-rail__head">
        <span><IconActivity size={16} stroke={1.9} /><strong>{agentName}</strong></span>
        <em>{status === "running" ? "Working now" : status === "completed" ? "Ready for review" : status === "failed" ? "Needs attention" : "Agent run plan"}</em>
      </div>
      <div className="agent-process-rail__stages">
        {PROCESS_STAGES.map((stage, index) => {
          const stageStatus = status === "failed" && index === activeIndex
            ? "failed"
            : index < activeIndex || status === "completed"
              ? "complete"
              : index === activeIndex
                ? status === "running" ? "running" : "current"
                : "queued";
          return (
            <button aria-pressed={selectedStageId === stage.id} className="agent-process-stage" data-stage-status={stageStatus} key={stage.id} onClick={() => setSelectedStageId(stage.id)} type="button">
              <span>{stageStatus === "complete" ? <IconCheck size={14} stroke={2.2} /> : stageStatus === "running" ? <IconActivity size={14} stroke={2} /> : <IconCircle size={11} stroke={2} />}</span>
              <div><strong>{stage.label}</strong><small>{stage.detail}</small></div>
            </button>
          );
        })}
      </div>
      <div className="agent-process-rail__trace" role="status">
        <span>{selectedStage.label}</span>
        <p>{stageEvidence[selectedStage.id] || selectedStage.evidence}</p>
        <em>Decision summary only · hidden model reasoning is never exposed</em>
      </div>
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
  { phase: "context", message: "Retrieving bounded Stories, Test Cases, Runs, Bugs, automation, and knowledge." },
  { phase: "guardrails", message: "Checking permissions, untrusted context, tool limits, and the human approval boundary." },
  { phase: "specialist", message: "The selected agent is analyzing evidence and preparing a decision summary." },
  { phase: "outcome", message: "A reviewable outcome will appear here." },
  { phase: "evaluation", message: "Grounding, completeness, traceability, and risk control will be scored." }
];

export function AgentActivityTimeline({ events = [], running = false, activeAgentName = "HelloTest Agent" }: { events?: WorkspaceTransactionEvent[]; running?: boolean; activeAgentName?: string }) {
  const [animatedIndex, setAnimatedIndex] = useState(0);

  useEffect(() => {
    if (!running) {
      setAnimatedIndex(events.length ? runningTrace.length : 0);
      return;
    }
    setAnimatedIndex(0);
    const timer = window.setInterval(() => setAnimatedIndex((current) => Math.min(runningTrace.length - 1, current + 1)), 900);
    return () => window.clearInterval(timer);
  }, [events.length, running]);

  const items = events.length ? events.map((event) => ({
    id: event.id,
    phase: event.phase || "activity",
    message: event.message,
    level: event.level,
    details: event.details,
    createdAt: event.created_at,
    status: event.level === "error" ? "failed" : "complete"
  })) : runningTrace.map((event, index) => ({
    id: `${event.phase}-${index}`,
    ...event,
    level: "info",
    details: {},
    createdAt: undefined,
    status: index < animatedIndex ? "complete" : index === animatedIndex && running ? "running" : "queued"
  }));

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
              <span className="agent-activity-event__marker">{item.status === "complete" ? <IconCheck size={14} stroke={2.2} /> : item.status === "running" ? <IconActivity size={14} stroke={2} /> : item.status === "failed" ? <IconCircle size={12} /> : <IconClock size={13} stroke={1.9} />}</span>
              <div>
                <header><strong>{phaseLabels[item.phase] || item.phase.replace(/_/g, " ")}</strong>{item.createdAt ? <time>{formatActivityTime(item.createdAt)}</time> : null}</header>
                <p>{item.message}</p>
                {details.length ? (
                  <details><summary>Inspect activity evidence</summary><dl>{details.map(([key, value]) => <div key={key}><dt>{key.replace(/_/g, " ")}</dt><dd>{value}</dd></div>)}</dl></details>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
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

const scoreTone = (score: number) => score >= 85 ? "strong" : score >= 70 ? "good" : score >= 55 ? "watch" : "weak";

export function AgenticOutcomePanel({ result, citations = [], guardrails = [], provenance, onAccept }: {
  result: AgenticAssistantResult;
  citations?: AgenticAssistantCitation[];
  guardrails?: string[];
  provenance?: { provider?: string; model?: string | null; generation_mode?: string; requires_human_review?: boolean };
  onAccept?: (proposal: { response: string; recommendations: string[] }) => void;
}) {
  const [draftResponse, setDraftResponse] = useState(result.response);
  const [draftRecommendations, setDraftRecommendations] = useState(result.recommendations);
  const [selectedRecommendationIndexes, setSelectedRecommendationIndexes] = useState(result.recommendations.map((_, index) => index));
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    setDraftResponse(result.response);
    setDraftRecommendations(result.recommendations);
    setSelectedRecommendationIndexes(result.recommendations.map((_, index) => index));
    setAccepted(false);
  }, [result.response, result.evaluation.maturity_score]);

  const metrics: Array<[keyof AgenticAssistantEvaluation, string]> = [
    ["grounding", "Grounding"],
    ["completeness", "Complete"],
    ["traceability", "Traceable"],
    ["risk_control", "Guarded"]
  ];
  return (
    <section className="agent-outcome-panel">
      <header>
        <div><span>Agent outcome</span><strong>Ready for human review</strong></div>
        <div className="agent-outcome-maturity" data-tone={scoreTone(result.evaluation.maturity_score)}><b>{result.evaluation.maturity_score}</b><span>maturity</span></div>
      </header>
      <div className="agent-outcome-response-editor">
        <label htmlFor="agent-outcome-response"><span>Editable response</span><em>{accepted ? "Accepted" : "Review required"}</em></label>
        <textarea id="agent-outcome-response" onChange={(event) => { setDraftResponse(event.target.value); setAccepted(false); }} rows={7} value={draftResponse} />
      </div>
      <div className="agent-outcome-scores">
        {metrics.map(([key, label]) => (
          <div key={key}><span>{label}</span><strong>{result.evaluation[key] as number}</strong><i><b style={{ width: `${result.evaluation[key]}%` }} /></i></div>
        ))}
      </div>
      <p className="agent-outcome-rationale"><IconShieldCheck size={17} stroke={1.9} />{result.evaluation.rationale}</p>
      {draftRecommendations.length ? (
        <div className="agent-outcome-section agent-outcome-recommendation-review">
          <strong>Selectable next actions</strong>
          <div>{draftRecommendations.map((item, index) => (
            <label data-selected={selectedRecommendationIndexes.includes(index) || undefined} key={`${index}:${result.recommendations[index]}`}>
              <input checked={selectedRecommendationIndexes.includes(index)} onChange={(event) => { setSelectedRecommendationIndexes((current) => event.target.checked ? [...new Set([...current, index])] : current.filter((itemIndex) => itemIndex !== index)); setAccepted(false); }} type="checkbox" />
              <textarea aria-label={`Edit next action ${index + 1}`} onChange={(event) => { setDraftRecommendations((current) => current.map((recommendation, itemIndex) => itemIndex === index ? event.target.value : recommendation)); setAccepted(false); }} rows={2} value={item} />
            </label>
          ))}</div>
        </div>
      ) : null}
      {result.assumptions.length ? <details className="agent-outcome-details"><summary>Assumptions to verify ({result.assumptions.length})</summary><ul>{result.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}
      <div className="agent-outcome-evidence">
        <span><IconDatabase size={16} stroke={1.9} /><strong>{citations.length}</strong> cited references</span>
        <span><IconShieldCheck size={16} stroke={1.9} /><strong>{guardrails.length}</strong> guardrails</span>
        <span><IconBrain size={16} stroke={1.9} />{provenance?.provider || "HelloTest evidence engine"}{provenance?.model ? ` · ${provenance.model}` : ""}</span>
        <span><IconUserCheck size={16} stroke={1.9} />Human decision</span>
      </div>
      <footer className="agent-outcome-review-actions">
        <span>{accepted ? "Proposal accepted for this session." : "Nothing is applied until you accept the edited selection."}</span>
        <button className="ghost-button" disabled={draftResponse === result.response && draftRecommendations.every((item, index) => item === result.recommendations[index])} onClick={() => {
          setDraftResponse(result.response);
          setDraftRecommendations(result.recommendations);
          setSelectedRecommendationIndexes(result.recommendations.map((_, index) => index));
          setAccepted(false);
        }} type="button">Reset</button>
        <button className="primary-button" disabled={!draftResponse.trim() || accepted} onClick={() => {
          const recommendations = selectedRecommendationIndexes.map((index) => draftRecommendations[index]?.trim()).filter(Boolean);
          onAccept?.({ response: draftResponse.trim(), recommendations });
          setAccepted(true);
        }} type="button">Accept agent output</button>
      </footer>
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
