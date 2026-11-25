import { AgentModelCalls, ModelCallDetails } from '../agents/AgentModelCalls';
import { FormattedText } from "@hellotest/platform/frontend/src/shared/components/FormattedText";
import { AgentArtifactReview } from "../agents/AgentArtifactReview";
import { AgentReportVisuals, AgentStructuredValue } from './AgentStructuredValue';
import { agentOutputText } from '../lib/agentOutputValue';
import { agentFindingProposals, agentHandoffStatus, agentOutcomeBrief, agentOutcomeCalls, agentOutcomeCitationIds, agentOutcomeCoverage, agentOutcomeResult, agentOutcomeReviewState, agentOutcomeSources } from '../lib/agentOutcomeView';
import { AutomationRepairReview } from "@hellotest/automation/frontend/components/AutomationRepairReview";
import { QualityEvidencePanel } from "@hellotest/ai/frontend/components/QualityEvidencePanel";
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
  AgenticAssistantSessionResponse,
  AgenticAssistantResult,
  WorkspaceTransactionEvent
} from "@hellotest/platform/frontend/src/types";
import { useCurrentAppType, useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { replaceSmartContextPack } from "@hellotest/ai/frontend/lib/aiDesignStudio";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { SmartContextWorkbench, type SmartContextSelection } from "@hellotest/ai/frontend/components/SmartContextWorkbench";
import "./AgenticExperience.css";

import { AiEvidenceFlyout, AiEvidenceButton } from "@hellotest/ai/agent-experience";
export * from "@hellotest/ai/agent-experience";

const phaseLabels: Record<string, string> = {
  intake: "Intent understood",
  context: "Context built",
  guardrails: "Guardrails applied",
  specialist: "Specialist analysis",
  outcome: "Outcome produced",
  evaluation: "Output evaluated",
  failed: "Session stopped"
};
const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

const runningTrace = [
  { phase: "intake", message: "Understanding the request and selecting the specialist contract." },
  { phase: "context", message: "Retrieving bounded Stories, Test Cases, Runs, Defects, automation, and knowledge." },
  { phase: "guardrails", message: "Checking permissions, untrusted context, tool limits, and the human approval boundary." },
  { phase: "specialist", message: "The selected agent is analyzing evidence and preparing a decision summary." },
  { phase: "outcome", message: "A reviewable outcome will appear here." },
  { phase: "evaluation", message: "Grounding, completeness, traceability, and risk control will be scored." }
];

export function AgentActivityTimeline({ events = [], running = false, activeAgentName = "HelloTest Agent", projectId }: { events?: WorkspaceTransactionEvent[]; running?: boolean; activeAgentName?: string; projectId?: string }) {
  const { can } = useCapabilityAccess(projectId);
  const [evidenceEventId, setEvidenceEventId] = useState<string | null>(null);
  const [traceEventId, setTraceEventId] = useState<string | null>(null);

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
    details: {} as Record<string, unknown>,
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
                <header><strong>{phaseLabels[item.phase] || item.phase.replace(/[._-]/g, " ")}</strong>{item.createdAt ? <time>{formatActivityTime(item.createdAt)}</time> : null}</header>
                <p>{item.message}</p>
                {projectId && can("ops.view") && typeof item.details?.trace_id === 'string' && <details open={traceEventId === item.id} onToggle={event => {
                  if (event.currentTarget.open) setTraceEventId(item.id);
                  else setTraceEventId(current => current === item.id ? null : current);
                }}><summary>Model call details</summary>{traceEventId === item.id && <ModelCallDetails projectId={projectId} traceId={item.details.trace_id} />}</details>}
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
  .map(([key, value]) => [key, agentOutputText(value)] as [string, string]);

export function AgenticOutcomePanel({ result, citations = [], guardrails = [], guardrailRules = [], provenance, sessionId, durationMs }: {
  sessionId?: string;
  result: AgenticAssistantResult;
  citations?: AgenticAssistantCitation[];
  guardrails?: string[];
  guardrailRules?: NonNullable<AgenticAssistantSessionResponse["guardrail_rules"]>;
  durationMs?: number;
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
}) {
  const [projectId] = useCurrentProject();
  const { can } = useCapabilityAccess(projectId);
  const draftRecommendations = result.recommendations || [];
  const [selectedRecommendationIndexes, setSelectedRecommendationIndexes] = useState(draftRecommendations.map((_, index) => index));
  const [exportNotice, setExportNotice] = useState("");
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false);
  const [evidenceCitationIds, setEvidenceCitationIds] = useState<string[] | null>(null);
  const [activeSection, setActiveSection] = useState("summary");
  const [proposalIndex, setProposalIndex] = useState(0);
  const surfaceId = useId();
  const findings = result.findings || [];
  const deliverables = result.deliverables || [];
  const artifacts = result.artifacts || [];
  const assumptions = result.assumptions || [];
  const evidenceGaps = result.evidence_gaps || [];
  const review = agentOutcomeReviewState(result, citations);
  const outcome = agentOutcomeResult(result);
  const allSources = agentOutcomeSources(agentOutcomeCitationIds(result), citations);
  const displayedSources = evidenceCitationIds ? agentOutcomeSources(evidenceCitationIds, citations) : allSources;
  const reportCount = deliverables.length + (result.sections?.length || 0) + (result.tables?.length || 0) + (result.charts?.length || 0);
  const calls = agentOutcomeCalls(result.model_call_records, result.agent_chain);
  const contextRouteLabel = provenance?.context_route?.input_type?.replace(/_/g, " ") || "specialist task";
  const readiness = result.readiness?.status;
  const reviewLimitations = [...new Set([...(result.readiness?.limitations || []), ...(result.verification?.limitations || [])])];
  const coverage = agentOutcomeCoverage(result, citations);
  const showActions = Boolean(artifacts.length || result.automation_repair);
  const showAnalysis = Boolean(reportCount || result.quality_assessment);
  const tokens = result.model_execution?.usage?.total_tokens;
  const modelDetails = [result.model_execution?.effective_model, typeof tokens === "number" ? `${tokens.toLocaleString()} tokens` : "", typeof durationMs === "number" ? `${Math.round(durationMs / 1000)}s` : ""].filter(Boolean).join(" · ");

  useEffect(() => {
    setSelectedRecommendationIndexes((result.recommendations || []).map((_, index) => index));
    setActiveSection("summary");
    setProposalIndex(0);
    setExportNotice("");
    setIsEvidenceOpen(false);
  }, [result]);

  const openSources = (ids: string[] | null = null) => { setEvidenceCitationIds(ids); setIsEvidenceOpen(true); };
  const sourceButton = (ids: string[] = []) => {
    const sources = agentOutcomeSources(ids, citations);
    return sources.ids.length ? <button className="agent-outcome-source-link" type="button" onClick={() => openSources(ids)}>{sources.available.length} referenced source{sources.available.length === 1 ? "" : "s"}{sources.missing.length ? ` · ${sources.missing.length} unavailable` : ""}</button> : <small>Source evidence not supplied · verify before use</small>;
  };
  const briefText = () => agentOutcomeBrief(result, citations, selectedRecommendationIndexes.map(index => draftRecommendations[index]).filter(Boolean));
  const sections = [
    { id: "summary", label: "Overview", count: undefined },
    ...(findings.length ? [{ id: "findings", label: "Findings", count: findings.length }] : []),
    ...(showActions ? [{ id: "actions", label: "Drafts & actions", count: artifacts.length || undefined }] : []),
    ...(showAnalysis ? [{ id: "deliverables", label: "Analysis", count: reportCount || undefined }] : []),
    ...(can("ops.view") && (sessionId || calls.length) ? [{ id: "calls", label: "Run details", count: calls.length || undefined }] : [])
  ];

  return (
    <section className="agent-outcome-panel">
      <header>
        <div><span>Agent outcome</span><strong>{agentOutputText(result.headline || "Specialist review")}</strong></div>
        <span className="agent-brief-readiness" data-readiness={review.blocked ? "insufficient_evidence" : readiness || "unverified"}>{review.blocked ? "Follow-up required" : readiness === "ready_for_review" ? "Ready for review" : readiness === "limited_evidence" ? "Limited evidence" : readiness === "insufficient_evidence" ? "More evidence needed" : "Human review required"}</span>
      </header>
      <div className="agent-outcome-toolbar">
        <span>{modelDetails || (artifacts.length ? `${artifacts.length} proposed change${artifacts.length === 1 ? "" : "s"}` : "Assessment prepared for human review")}</span>
        <div className="agent-brief-icon-actions"><AiEvidenceButton label="Sources" onClick={() => openSources()} /><button className="ghost-button compact" type="button" aria-label="Copy brief" title="Copy brief" onClick={async () => { try { await navigator.clipboard.writeText(briefText()); setExportNotice("Brief copied."); } catch { setExportNotice("Copy is unavailable. Download the brief instead."); } }}><IconCopy size={17} /></button><button className="ghost-button compact" type="button" aria-label="Download brief" title="Download brief" onClick={() => { const url = URL.createObjectURL(new Blob([briefText()], { type: "text/markdown;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "specialist-review.md"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setExportNotice("Review brief downloaded."); }}><IconDownload size={17} /></button></div>
      </div>
      {exportNotice && <p className="agent-brief-export-notice" role="status">{exportNotice}</p>}
      <nav className="agent-artifact-navigation" aria-label="Output sections" role="tablist">{sections.map((section, index) => <button aria-controls={`${surfaceId}-${section.id}`} aria-selected={activeSection === section.id} id={`${surfaceId}-tab-${section.id}`} key={section.id} onClick={() => setActiveSection(section.id)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % sections.length : event.key === "ArrowLeft" ? (index + sections.length - 1) % sections.length : event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); setActiveSection(sections[next].id); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus(); }
      }} role="tab" tabIndex={activeSection === section.id ? 0 : -1} type="button">{section.label}{typeof section.count === "number" ? <span>{section.count}</span> : null}</button>)}</nav>

      <section aria-labelledby={`${surfaceId}-tab-summary`} hidden={activeSection !== "summary"} id={`${surfaceId}-summary`} role="tabpanel">
        <div className="agent-outcome-executive-summary"><span>Outcome summary</span><AgentStructuredValue value={result.executive_summary || result.response} /></div>
        <dl className="agent-outcome-facts" aria-label="Outcome coverage"><div><dt>Items with a source reference</dt><dd>{coverage.citedItems} of {coverage.items}</dd></div>{(showActions || findings.some(finding => finding.requires_proposal)) && <div><dt>Findings linked to drafts</dt><dd>{coverage.findingsWithDrafts} of {coverage.findings}</dd></div>}<div><dt>Available cited sources</dt><dd>{allSources.available.length} of {allSources.ids.length}</dd></div></dl>
        {findings.length > 0 && <div className="agent-brief-limitations"><strong>Key findings</strong><ul>{[...findings].sort((a, b) => (priorityOrder[a.priority || "info"] ?? 4) - (priorityOrder[b.priority || "info"] ?? 4)).slice(0, 3).map((finding, index) => <li key={finding.id || index}>{agentOutputText(finding.title)}</li>)}</ul></div>}
        {showActions && <button className="primary-button compact" type="button" onClick={() => setActiveSection("actions")}>{result.automation_repair ? "Review repair" : "Review drafts"}</button>}
        {result.evidence_scope && Object.keys(result.evidence_scope).length > 0 && <details className="agent-brief-limitations"><summary>Selected evidence scope</summary><AgentStructuredValue value={result.evidence_scope} /></details>}
        {result.executive_summary && result.response && result.response.trim() !== result.executive_summary.trim() && <details className="agent-outcome-details"><summary>Detailed assessment</summary><div className="agent-brief-body" role="region" aria-label="Detailed specialist assessment" tabIndex={0}><AgentStructuredValue value={result.response} /></div></details>}
        {result.outcome_issues?.length ? <div className="agent-brief-limitations" role="status"><strong>Completion requirements remain open</strong><ul>{result.outcome_issues.map((issue,index) => <li key={index}>{typeof issue === 'string' ? issue : agentOutputText(issue.message)}</li>)}</ul></div> : null}
        {result.verification && <details className="agent-brief-limitations" open={result.verification.status !== "passed"}><summary>Completion checks · {result.verification.status === "passed" ? "passed · human review required" : "more input needed"}</summary><ul>{result.verification.checks.map(check => <li key={check.id}>{check.passed ? "Passed" : "Unmet"}: {check.label}</li>)}</ul></details>}
        {reviewLimitations.length > 0 && <details className="agent-brief-limitations"><summary>Review limitations</summary><ul>{reviewLimitations.map(item => <li key={item}>{item}</li>)}</ul></details>}
        {assumptions.length > 0 && <details className="agent-outcome-details"><summary>Assumptions to verify ({assumptions.length})</summary><ul>{assumptions.map(item => <li key={item}>{item}</li>)}</ul></details>}
        {evidenceGaps.length > 0 && <details className="agent-outcome-details is-evidence-gap" open><summary>Evidence gaps ({evidenceGaps.length})</summary><ul>{evidenceGaps.map(item => <li key={item}>{item}</li>)}</ul></details>}
        {draftRecommendations.length > 0 && <details className="agent-outcome-details"><summary>Follow-up considerations ({draftRecommendations.length})</summary><p className="agent-outcome-selection-hint">Select items to include in the copied or downloaded brief.</p>
          <div className="agent-brief-action-selection">{draftRecommendations.map((item, index) => <label key={index}><input checked={selectedRecommendationIndexes.includes(index)} onChange={event => { setSelectedRecommendationIndexes(current => event.target.checked ? [...new Set([...current, index])] : current.filter(itemIndex => itemIndex !== index)); }} type="checkbox" /><div className="agent-next-action-copy"><FormattedText text={item} /></div></label>)}</div>
        </details>}
        {result.evaluation?.method === "model_assessment" && <details className="agent-outcome-details"><summary>Model-estimated grounding (unverified)</summary><p>{result.evaluation.grounding} / 100</p><AgentStructuredValue value={result.evaluation.rationale} /></details>}
      </section>

      {findings.length > 0 && <section aria-labelledby={`${surfaceId}-tab-findings`} className="agent-outcome-findings" hidden={activeSection !== "findings"} id={`${surfaceId}-findings`} role="tabpanel">
        <header><span>Findings and supporting evidence</span><strong>{findings.length} item{findings.length === 1 ? "" : "s"}</strong></header>
        <div>{findings.map((finding, index) => {
          const proposals = agentFindingProposals(finding, index, artifacts);
          return <article data-priority={finding.priority || "info"} key={finding.id || index}>
            <header><strong>{agentOutputText(finding.title)}</strong><span>{finding.priority || "info"}</span></header>
            <AgentStructuredValue value={finding.detail} />
            {[finding.observation, finding.gap, finding.impact, finding.proposed_action, finding.acceptance_check].some(Boolean) && <dl className="agent-finding-facts">{[
              ['Observed evidence', finding.observation], ['Gap', finding.gap], ['Impact', finding.impact], ['Proposed change', finding.proposed_action], ['Acceptance check', finding.acceptance_check]
            ].filter(([,value]) => value).map(([label,value]) => <div key={label}><dt>{label}</dt><dd><AgentStructuredValue value={value} /></dd></div>)}</dl>}
            {sourceButton(finding.citation_ids)}
            {proposals.length ? <button className="agent-outcome-source-link" type="button" onClick={() => { setProposalIndex(artifacts.indexOf(proposals[0])); setActiveSection("actions"); }}>{proposals.length} matching draft{proposals.length === 1 ? "" : "s"} prepared · review changes</button> : finding.requires_proposal === true ? <small>Requested change has no matching draft</small> : null}
          </article>;
        })}</div>
      </section>}

      {showAnalysis && <section aria-labelledby={`${surfaceId}-tab-deliverables`} className="agent-outcome-deliverables" hidden={activeSection !== "deliverables"} id={`${surfaceId}-deliverables`} role="tabpanel">
        {result.quality_assessment && <QualityEvidencePanel key={result.quality_assessment.snapshot_hash} report={result.quality_assessment} />}
        <div>{deliverables.map((deliverable, index) => <article key={index}><span>{deliverable.type?.replace(/_/g, " ") || "Report"}</span><strong>{agentOutputText(deliverable.title)}</strong><AgentStructuredValue value={deliverable.detail} />{sourceButton(deliverable.citation_ids)}</article>)}</div>
        <AgentReportVisuals sections={result.sections} tables={result.tables} charts={result.charts} />
      </section>}

      {showActions && <section aria-labelledby={`${surfaceId}-tab-actions`} className="agent-outcome-section agent-outcome-recommendation-review" hidden={activeSection !== "actions"} id={`${surfaceId}-actions`} role="tabpanel">
        <header className="agent-next-actions-heading"><div><h3>{outcome.title}</h3><p>{outcome.description}</p></div></header>
        {result.automation_repair && <AutomationRepairReview summary={result.automation_repair}/>}
        {artifacts.length > 0 && <AgentArtifactReview artifacts={artifacts} chain={result.agent_chain || []} sessionId={sessionId} findings={findings} citations={citations} onReviewSources={ids => { setEvidenceCitationIds(ids); setIsEvidenceOpen(true); }} approvalBlocked={review.blockedReason} proposalIndex={proposalIndex} />}
        {(result.agent_chain?.length || 0) > 1 && <details className="agent-outcome-details"><summary>How this outcome was produced</summary><div className="agent-outcome-sequence"><ol className="agent-handoff-list" aria-label="Agent handoffs">{result.agent_chain!.map((step, index) => <li key={`${step.agent_id}-${index}`} data-status={step.status}><div><strong>{step.name}</strong><span>{agentHandoffStatus(step)}</span></div>{step.reason && <p>{step.reason}</p>}{step.detail && <p>{step.detail}</p>}{step.finding_ids?.length ? <p>Requested findings: {step.finding_ids.join(', ')}</p> : null}{step.addressed_finding_ids?.length ? <p>Draft finding links: {step.addressed_finding_ids.join(', ')}</p> : null}{step.verification && <details><summary>Draft completion checks · {step.verification.status === 'passed' ? 'passed' : 'needs input'}</summary><ul>{step.verification.checks.map(check => <li key={check.id}>{check.passed ? 'Passed' : 'Unmet'}: {check.label}</li>)}</ul></details>}</li>)}</ol></div>{result.primary_review && <section><h4>Original specialist assessment</h4>{result.primary_review.summary && <AgentStructuredValue value={result.primary_review.summary} />}{result.primary_review.findings?.map((finding,index) => <div key={finding.id || index}><h4>{finding.title}</h4><AgentStructuredValue value={finding.detail} />{sourceButton(finding.citation_ids)}</div>)}</section>}</details>}
      </section>}

      {sections.some(section => section.id === "calls") && <section role="tabpanel" aria-labelledby={`${surfaceId}-tab-calls`} id={`${surfaceId}-calls`} hidden={activeSection !== "calls"}>{activeSection === "calls" && <AgentModelCalls projectId={projectId} chain={result.agent_chain} records={result.model_call_records} sessionId={sessionId} execution={result.model_execution} />}</section>}
      <AiEvidenceFlyout
        description="Inspect the recorded references and boundaries used for this assessment. A source reference does not establish that a proposed change has been executed."
        eyebrow="Agent outcome · Evidence"
        facts={[{ label: "References", value: displayedSources.available.length }, { label: "Unavailable", value: displayedSources.missing.length }, { label: "Guardrails", value: guardrailRules.length || guardrails.length }]}
        onClose={() => setIsEvidenceOpen(false)} open={isEvidenceOpen} title="Outcome evidence"
      >
        <section className="ai-evidence-flyout__section"><header><span>Sources</span><strong>{evidenceCitationIds ? 'References for the selected item' : 'References used across this outcome'}</strong></header>
          {displayedSources.available.length ? <ul className="ai-evidence-flyout__source-list">{displayedSources.available.map(citation => <li key={`${citation.scope}:${citation.id}`}><span>{formatRecordKindLabel(citation.source_kind || citation.scope)}</span><strong>{citation.label}</strong><code>{citation.id}</code>{citation.source_id && <small>Record: {citation.source_id}</small>}</li>)}</ul> : <p className="ai-evidence-flyout__empty">No source reference was supplied for this item. Verify the assessment before use.</p>}
          {displayedSources.missing.length > 0 && <p className="ai-evidence-flyout__empty">Unavailable references: {displayedSources.missing.join(', ')}. These references cannot be inspected in this saved review.</p>}
        </section>
        <section className="ai-evidence-flyout__section"><header><span>Context route</span><strong>Why this evidence was selected</strong></header><dl className="ai-evidence-flyout__record-list">
          {result.evidence_scope && Object.entries(result.evidence_scope).map(([key,value]) => <div key={key}><dt>{key.replace(/_/g,' ')}</dt><dd>{value}</dd></div>)}
          <div><dt>Input</dt><dd>{contextRouteLabel}</dd></div><div><dt>Decision</dt><dd>{provenance?.context_route?.decision_question || "What conclusion is supported by the selected project evidence?"}</dd></div><div><dt>Deliverable</dt><dd>{provenance?.context_route?.deliverable_contract || "A reviewable specialist outcome"}</dd></div><div><dt>Priority scopes</dt><dd>{provenance?.context_route?.priority_scopes?.join(", ") || "Selected project context"}</dd></div><div><dt>Retrieval focus</dt><dd>{provenance?.context_route?.retrieval_focus || "The submitted specialist task"}</dd></div>
          {provenance?.context_route?.conversation_reference_used && <div><dt>Resolved follow-up</dt><dd>{provenance.context_route.resolved_query || "Previous conversation context was used to resolve this request."}</dd></div>}
        </dl></section>
        <section className="ai-evidence-flyout__section"><header><span>Guardrails</span><strong>Boundaries recorded for the run</strong></header>{guardrailRules.length ? <ul className="ai-evidence-flyout__bullet-list">{guardrailRules.map(rule => <li key={rule.id}><strong>{rule.enforcement === "code" ? "Code-enforced" : "Prompt instruction"}</strong> · {rule.text}</li>)}</ul> : guardrails.length ? <ul className="ai-evidence-flyout__bullet-list">{guardrails.map(guardrail => <li key={guardrail}>{guardrail}</li>)}</ul> : <p className="ai-evidence-flyout__empty">No guardrail detail was returned.</p>}</section>
        <section className="ai-evidence-flyout__section"><header><span>Provenance</span><strong>Generation route</strong></header><dl className="ai-evidence-flyout__record-list"><div><dt>Provider</dt><dd>{provenance?.provider || "Not recorded"}</dd></div><div><dt>Model</dt><dd>{provenance?.model || "Not recorded"}</dd></div><div><dt>Mode</dt><dd>{provenance?.generation_mode || "Not recorded"}</dd></div>{provenance?.fallback_reason && <div><dt>Fallback</dt><dd>A fallback was recorded. Review the evidence and completion checks for this outcome.</dd></div>}</dl></section>
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
