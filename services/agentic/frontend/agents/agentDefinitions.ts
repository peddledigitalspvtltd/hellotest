import type { AgenticWorkflowNodeData } from '@hellotest/platform/frontend/src/types';
import { specialistDefaults, specialistProfiles, type WorkflowSkill } from '../workflows/specialistProfiles';
import outcomeContracts from '../../shared/agentOutcomeContracts.json';

export type AgentDefinition = {
  output_contract?: { kind: 'review' | 'story' | 'test_case' | 'defect' | 'run' | 'automation'; minimum_artifacts: number };
  feature_id?: string;
  name: string; description: string; objective: string; instructions: string;
  skills: WorkflowSkill[]; allowed_tools: string[]; context_scopes: string[];
  context: string; guardrails: string; integration_id: string; source_ids: string[]; source_kinds: string[];
  required_inputs: string[];
  acceptance: { require_evidence: boolean; no_evidence_gaps: boolean; minimum_findings: number };
  limits: { timeout_ms: number; max_model_calls: number; max_output_tokens: number };
};
export type ProjectAgent = {
  id: string; project_id: string; current_version: number; active_version: number | null; archived: boolean;
  definition: AgentDefinition; active_definition: AgentDefinition | null; definition_hash: string; updated_at: string;
};
export function agentResultLabel(definition?: AgentDefinition | null): string {
  const kind = definition?.output_contract?.kind || 'review';
  return {review:'Evidence review with cited findings',story:'Reviewable Story drafts',test_case:'Reviewable Test Case drafts',defect:'Reviewable Defect drafts',run:'Reviewable Run drafts',automation:'Reviewable Automation Plan drafts'}[kind];
}
export const newAgentDefinition = (): AgentDefinition => ({ name: '', description: '', objective: '', instructions: '', skills: [],
  allowed_tools: ['project_evidence', 'knowledge_search'], context_scopes: ['stories', 'test-cases', 'runs', 'bugs', 'knowledge'],
  context: '', guardrails: '', integration_id: '', source_ids: [], source_kinds: [], required_inputs: [],
  acceptance: { require_evidence: true, no_evidence_gaps: false, minimum_findings: 0 },
  output_contract: { kind: 'review', minimum_artifacts: 0 },
  limits: { timeout_ms: 150000, max_model_calls: 2, max_output_tokens: 4000 } });
export function definitionNode(definition: AgentDefinition): AgenticWorkflowNodeData {
  return { kind: 'agent', label: definition.name, summary: definition.description, prompt: definition.objective,
    instructions: definition.instructions, skills: definition.skills, allowedTools: definition.allowed_tools,
    knowledgeScope: definition.context_scopes.join(','), contextInstructions: definition.context, guardrails: definition.guardrails,
    knowledgeSourceIds: definition.source_ids, knowledgeSourceKinds: definition.source_kinds, llmIntegrationId: definition.integration_id,
    timeoutMs: definition.limits.timeout_ms, retryCount: 0 };
}
export function projectAgentNode(agent: ProjectAgent): AgenticWorkflowNodeData {
  return { ...definitionNode(agent.active_definition || agent.definition), agentId: agent.id, agentVersion: agent.active_version };
}
export function agentFromSpecialist(id: string, name: string): AgentDefinition {
  const data = specialistDefaults(id);
  const featureId = (specialistProfiles[id as keyof typeof specialistProfiles] as { featureId?: string } | undefined)?.featureId;
  const contract = (outcomeContracts.agents as Record<string, {mode:string;artifact_kinds?:string[];minimum_artifacts?:number}>)[id];
  const kind = contract?.mode === 'author' ? contract.artifact_kinds?.[0] as NonNullable<AgentDefinition['output_contract']>['kind'] : 'review';
  return { ...newAgentDefinition(), ...(featureId ? { feature_id: featureId } : {}), name: `${name} custom`, description: String(data.summary || ''), objective: String(data.prompt || ''),
    output_contract: {kind:kind || 'review',minimum_artifacts:kind && kind !== 'review' ? contract.minimum_artifacts || 1 : 0},
    instructions: String(data.instructions || ''), skills: data.skills as WorkflowSkill[], allowed_tools: data.allowedTools as string[],
    context_scopes: String(data.knowledgeScope || '').split(',').filter(Boolean) };
}
