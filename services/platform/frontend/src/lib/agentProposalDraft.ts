import type { AgentStructuredArtifact } from '../types';

const PREFIX = 'hellotest.agent-proposal.';
type ProposalEnvelope = { projectId: string; appTypeId: string; createdAt: number; artifact: AgentStructuredArtifact };
// Keep sensitive proposal text out of URLs; this is an unsaved draft, never write authority.
export function stageAgentProposal(artifact: AgentStructuredArtifact, projectId: string, appTypeId: string) {
  if (!projectId) throw new Error('Select the proposal’s project before continuing.');
  const id = crypto.randomUUID();
  window.sessionStorage.setItem(PREFIX + id, JSON.stringify({ projectId, appTypeId, createdAt: Date.now(), artifact }));
  const destination = artifact.kind === 'story' ? '/stories' : artifact.kind === 'test_case' ? '/test-cases' : '/issues';
  return artifact.kind === "story" && artifact.target_id
    ? `${destination}?requirement=${encodeURIComponent(artifact.target_id)}&agent_proposal=${encodeURIComponent(id)}`
    : `${destination}?create=1&agent_proposal=${encodeURIComponent(id)}`;
}
export function takeAgentProposal(id: string | null, projectId: string, appTypeId: string, kind: AgentStructuredArtifact['kind']): AgentStructuredArtifact | null {
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return null;
  const raw = window.sessionStorage.getItem(PREFIX + id);
  if (!raw) return null;
  try {
    const item = JSON.parse(raw) as ProposalEnvelope;
    if (item.projectId !== projectId || item.appTypeId !== appTypeId) return null;
    window.sessionStorage.removeItem(PREFIX + id);
    if (Date.now() - item.createdAt > 30 * 60 * 1000 || item.artifact?.kind !== kind || !item.artifact.title?.trim() || !item.artifact.description?.trim()) return null;
    return item.artifact;
  } catch { window.sessionStorage.removeItem(PREFIX + id); return null; }
}
