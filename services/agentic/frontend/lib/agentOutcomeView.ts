import type { AgenticAssistantCitation, AgenticAssistantResult, AgentStructuredArtifact } from '@hellotest/platform/frontend/src/types';
import { agentOutputText } from './agentOutputValue';

type Finding = NonNullable<AgenticAssistantResult['findings']>[number];
type CallRecord = { name: string; trace_id?: string | null; status: string; attempt?: number };

export const agentArtifactLabel = (kind: AgentStructuredArtifact['kind']) => ({ story: 'Story', test_case: 'Test Case', defect: 'Defect', run: 'Run draft', automation: 'Automation Plan' })[kind];

export function agentOutcomeSources(ids: string[] = [], citations: AgenticAssistantCitation[] = []) {
  const unique = [...new Set(ids)];
  const available = [...new Map(citations.filter(source => unique.includes(source.id)).map(source => [source.id, source])).values()];
  const known = new Set(available.map(source => source.id));
  return { available, missing: unique.filter(id => !known.has(id)), ids: unique };
}

export function agentOutcomeCitationIds(result: AgenticAssistantResult): string[] {
  return [...new Set([...(result.citation_ids || []), ...(result.primary_review?.findings || []).flatMap(item => item.citation_ids || []), ...['findings', 'deliverables', 'artifacts', 'sections', 'tables', 'charts'].flatMap(key =>
    ((result[key as keyof AgenticAssistantResult] || []) as Array<{citation_ids?: string[]}>).flatMap(item => item.citation_ids || []))])];
}

/** A draft addresses a finding only when both the identity and evidence match. */
export function agentFindingProposals(finding: Finding, index: number, artifacts: AgentStructuredArtifact[] = []): AgentStructuredArtifact[] {
  const id = finding.id || `finding-${index + 1}`;
  return artifacts.filter(item => item.addressed_finding_ids?.includes(id)
    && (!finding.artifact_kind || item.kind === finding.artifact_kind)
    && item.citation_ids?.some(source => finding.citation_ids?.includes(source)));
}

/** Keep untraced attempts visible and avoid counting a chain link as a second call. */
export function agentOutcomeCalls(records: CallRecord[] = [], chain: CallRecord[] = []): CallRecord[] {
  const calls = [...records];
  const traces = new Set(records.map(call => call.trace_id).filter(Boolean));
  for (const call of chain) if (call.trace_id && !traces.has(call.trace_id)) { calls.push(call); traces.add(call.trace_id); }
  const seen = new Set<string>();
  return calls.filter(call => { if (!call.trace_id) return true; if (seen.has(call.trace_id)) return false; seen.add(call.trace_id); return true; });
}

export function agentOutcomeReviewState(result: AgenticAssistantResult, citations: AgenticAssistantCitation[] = []) {
  const artifacts = result.artifacts || [];
  const issues = result.outcome_issues || [];
  const missingSources = artifacts.some(item => !item.citation_ids?.length) || agentOutcomeSources(agentOutcomeCitationIds(result), citations).missing.length > 0;
  const blocked = Boolean(result.verification && result.verification.status !== 'passed'
    || result.readiness?.status === 'insufficient_evidence' || issues.length || missingSources);
  const clean = result.no_changes_required === true && result.verification?.status === 'passed' && !issues.length;
  const incomplete = !artifacts.length && (result.outcome_contract?.mode === 'author' && !clean || issues.length > 0);
  return {
    blocked,
    label: artifacts.length ? 'Review & approve' : result.automation_repair ? 'Review repair' : incomplete ? 'Complete outcome' : 'Review conclusions',
    title: artifacts.length ? 'Review proposed changes' : result.automation_repair ? 'Review the repair proposal' : incomplete ? 'Complete the requested outcome' : 'Review conclusions',
    description: artifacts.length
      ? 'Review each draft and its source evidence. Accepting a draft saves its reviewed fields in the destination module.'
      : result.automation_repair ? 'Inspect the repair proposal and its validation evidence. Validation and application are managed in the repair workflow below.'
        : incomplete ? 'No saveable draft was prepared. Resolve the missing evidence or completion requirements, then run the agent again.'
        : 'This outcome is an assessment. Use the findings and follow-up considerations to decide the next action.',
    blockedReason: blocked ? missingSources
      ? 'Proposal source references are missing from this review. Generate a fresh review before accepting proposals.'
      : 'This outcome has unresolved completion or evidence requirements. Generate a complete review before accepting proposals.' : undefined
  };
}

export function agentHandoffStatus(step: NonNullable<AgenticAssistantResult['agent_chain']>[number]): string {
  if (step.status !== 'completed' || step.verification?.status === 'needs_input') return 'Needs follow-up';
  if (typeof step.artifact_count === 'number') return step.artifact_count > 0
    ? `${step.artifact_count} draft${step.artifact_count === 1 ? '' : 's'} prepared for review` : 'Completed · no draft prepared';
  return 'Assessment completed';
}

/** One export contains the assessment, proposals, evidence and completion state. */
export function agentOutcomeBrief(result: AgenticAssistantResult, citations: AgenticAssistantCitation[] = [], selectedRecommendations = result.recommendations || []): string {
  const sourceText = (ids: string[] = []) => {
    const sources = agentOutcomeSources(ids, citations);
    return [...sources.available.map(source => `${source.label} (${source.id})`), ...sources.missing.map(id => `${id} · source unavailable`)].join(', ') || 'No source reference supplied';
  };
  const list = (title: string, values: string[] = []) => values.length ? `## ${title}\n${values.map(value => `- ${value}`).join('\n')}` : '';
  const sources = agentOutcomeSources(agentOutcomeCitationIds(result), citations);
  return [
    `# ${result.headline || 'Specialist review'}`,
    result.evidence_scope && Object.keys(result.evidence_scope).length ? `## Evidence scope\n${agentOutputText(result.evidence_scope)}` : '',
    result.executive_summary ? `## Overview\n${result.executive_summary}` : '',
    `## Full brief\n${result.response}`,
    result.findings?.length ? `## Findings\n${result.findings.map((item, index) => `### ${item.title}\nFinding: ${item.id || `finding-${index + 1}`}\n${item.detail}\n${[['Observation',item.observation],['Gap',item.gap],['Impact',item.impact],['Proposed action',item.proposed_action],['Acceptance check',item.acceptance_check]].filter(([,value])=>value).map(([label,value])=>`${label}: ${value}`).join('\n')}\nSources: ${sourceText(item.citation_ids)}`).join('\n\n')}` : '',
    result.deliverables?.length ? `## Supporting deliverables\n${result.deliverables.map(item => `### ${item.title}\n${item.detail}\nSources: ${sourceText(item.citation_ids)}`).join('\n\n')}` : '',
    ...(['sections','tables','charts'] as const).map(field => result[field]?.length ? `## ${field === 'sections' ? 'Report sections' : field === 'tables' ? 'Report tables' : 'Report measures'}\n${agentOutputText(result[field])}` : ''),
    result.artifacts?.length ? `## Proposed changes · review before saving\n\`\`\`json\n${JSON.stringify(result.artifacts, null, 2)}\n\`\`\`` : '',
    result.agent_chain?.length ? `## Agent sequence\n${result.agent_chain.map(step => `- ${step.name}: ${agentHandoffStatus(step)}${step.detail ? ` · ${step.detail}` : ''}${step.finding_ids?.length ? ` · findings: ${step.finding_ids.join(', ')}` : ''}`).join('\n')}` : '',
    result.primary_review ? `## Original specialist assessment\n${result.primary_review.summary || ''}\n${(result.primary_review.findings || []).map(finding => `### ${finding.title}\n${finding.detail}\nSources: ${sourceText(finding.citation_ids)}`).join('\n\n')}` : '',
    list('Selected follow-up considerations', selectedRecommendations),
    list('Assumptions to verify', result.assumptions), list('Evidence gaps', result.evidence_gaps),
    result.verification ? `## Completion checks · ${result.verification.status}\n${result.verification.checks.map(check => `- ${check.passed ? 'Passed' : 'Unmet'}: ${check.label}`).join('\n')}` : '',
    list('Open outcome requirements', (result.outcome_issues || []).map(issue => typeof issue === 'string' ? issue : issue.message)),
    list('Review limitations', [...new Set([...(result.readiness?.limitations || []), ...(result.verification?.limitations || [])])]),
    `## Sources\n${sources.ids.length ? sourceText(sources.ids) : 'No source references supplied.'}`,
    'Proposals and assessment require human review. Acceptance saves drafts; it does not establish successful execution or release approval.'
  ].filter(Boolean).join('\n\n');
}
