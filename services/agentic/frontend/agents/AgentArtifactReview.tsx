import { useCapabilityAccess } from '@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { agenticApi, type AgentProposalReceipt } from '../api.client';
import { IconCopy, IconDownload } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AgentStructuredArtifact, AgenticAssistantResult } from '@hellotest/platform/frontend/src/types';
import { useCurrentProject, useCurrentAppType } from '@hellotest/platform/frontend/src/platform/hooks/useCurrentProject';
import { stageAgentProposal } from '@hellotest/platform/frontend/src/lib/agentProposalDraft';
import { capabilityView } from '@hellotest/platform/frontend/src/platform/capabilities/CapabilityView';
import './AgentWorkspace.css';
const StoryAiDraftInspector = capabilityView<import('react').ComponentProps<typeof import('@hellotest/ai/frontend/components/StoryAiStudioContent')['StoryAiDraftInspector']>>('ai', 'StoryAiDraftInspector', () => import('@hellotest/ai/frontend/components/StoryAiStudioContent'), 'Story proposal');

type Decision = 'accepted' | 'declined';
export function AgentArtifactReview({ artifacts, chain, sessionId }: { sessionId?: string; artifacts: AgentStructuredArtifact[]; chain: NonNullable<AgenticAssistantResult['agent_chain']> }) {
  const [selected, setSelected] = useState(0);
  const [drafts, setDrafts] = useState(artifacts);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const [projectId] = useCurrentProject();
  const [appTypeId] = useCurrentAppType(projectId);
  const { can } = useCapabilityAccess(projectId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Record<number, AgentProposalReceipt>>({});
  const receipts = useQuery({ queryKey: ['agent-proposals', sessionId], queryFn: () => agenticApi.agentProposals.list(sessionId!), enabled: Boolean(sessionId), retry: false });
  useEffect(() => { if (receipts.data) setSaved(Object.fromEntries(receipts.data.map(item => [item.proposal_index, item.receipt]))); }, [receipts.data]);
  const accept = async () => {
    if (!sessionId || savingRef.current || saved[selected]) return;
    const index = selected;
    savingRef.current = true; setSaving(true); setNotice('');
    try {
      const receipt = await agenticApi.agentProposals.accept(sessionId, { index, artifact: drafts[index], app_type_id: appTypeId || undefined });
      setSaved(current => ({ ...current, [index]: receipt }));
      setDecisions(current => ({ ...current, [index]: 'accepted' }));
      void queryClient.invalidateQueries({ queryKey: ['agent-proposals', sessionId] });
      void queryClient.invalidateQueries({ queryKey: [receipt.kind === 'story' ? 'requirements' : receipt.kind === 'test_case' ? 'test-cases' : 'issues'] });
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to save. Check the destination before retrying.'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  useEffect(() => { setDrafts(artifacts); setSelected(0); setDecisions({}); setSaved({}); setNotice(''); }, [artifacts]);
  const item = drafts[selected] || drafts[0];
  if (!item) return null;
  const edit = (patch: Partial<AgentStructuredArtifact>) => {
    if (savingRef.current || saved[selected]) return;
    setDrafts(current => current.map((draft, index) => index === selected ? { ...draft, ...patch } : draft));
    setDecisions(current => { const next = { ...current }; delete next[selected]; return next; });
  };
  const valid = Boolean(item.title.trim() && item.title.length <= 255 && item.description.trim() && (item.kind === 'story' ? item.acceptance_criteria?.length && item.acceptance_criteria.every(s => s.trim()) : item.kind === 'test_case' ? item.steps?.length && item.steps.every(s => s.action.trim() && s.expected_result.trim()) : item.reproduction_steps?.length && item.reproduction_steps.every(s => s.trim()) && item.expected_result?.trim() && item.actual_result?.trim()));
  const field = (label: string, value: string, update: (value: string) => void) => <label className="agent-proposal-field"><span>{label}</span><textarea aria-label={label} disabled={saving || Boolean(saved[selected])} value={value} onChange={event => update(event.target.value)} rows={3} /></label>;
  return <section className="agent-structured-output" aria-label="Structured agent proposals">
    <header><div><h3>Proposals for review</h3><p>{chain.filter(a => a.status === 'completed').map(a => a.name).join(' → ')}</p></div><div className="agent-proposal-tools"><button className="ghost-button compact" aria-label={copied ? "Proposal copied" : "Copy proposal"} title="Copy proposal" type="button" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(item, null, 2)); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { setNotice('Clipboard access is unavailable.'); } }}>{copied ? 'Copied' : <IconCopy size={17} />}</button><button className="ghost-button compact" type="button" aria-label="Download proposal" title="Download proposal" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'agent-proposal.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><IconDownload size={17} /></button></div></header>
    {notice && <p className="agent-proposal-notice" role="status">{notice}</p>}
    <div className="agent-structured-layout"><nav aria-label="Choose proposal">{drafts.map((a, index) => <button type="button" key={index} aria-pressed={index === selected} onClick={() => { setSelected(index); setNotice(''); }}><strong>{a.title}</strong><small>{a.kind.replace('_', ' ')} · {a.priority} · {saved[index] ? 'Saved' : decisions[index] || 'Review required'}</small></button>)}</nav>
      <article>
        {item.kind === 'story' ? <StoryAiDraftInspector draft={{ id: String(selected), generated: true, title: item.title, description: item.description, acceptanceCriteria: item.acceptance_criteria, priority: Number(item.priority.slice(1)), evidenceRefs: item.citation_ids }} editable={!saving && !saved[selected]} evidencePlacement="intelligence" showGherkin={false} showProperties={false} onTitleChange={value => edit({ title: value })} onDescriptionChange={value => edit({ description: value })} onAcceptanceCriteriaChange={value => edit({ acceptance_criteria: value })} /> : <>
          <span className="agent-eyebrow">{item.kind.replace('_', ' ')} · {item.priority}{item.severity ? ` · ${item.severity}` : ''}</span>
          {field('Title', item.title, title => edit({ title }))}{field('Description', item.description, description => edit({ description }))}
          {item.prerequisites?.length ? <><h4>Prerequisites</h4><ul>{item.prerequisites.map((s, i) => <li key={i}>{s}</li>)}</ul></> : null}
          {item.steps?.length ? <><h4>Test steps</h4><ol className="agent-structured-steps">{item.steps.map((step, index) => <li key={index}>{field(`Step ${index + 1}`, step.action, value => edit({ steps: item.steps!.map((s, i) => i === index ? { ...s, action: value } : s) }))}{field(`Expected result ${index + 1}`, step.expected_result, value => edit({ steps: item.steps!.map((s, i) => i === index ? { ...s, expected_result: value } : s) }))}</li>)}</ol></> : null}
          {item.reproduction_steps?.length ? <><h4>Reproduction steps</h4><ol>{item.reproduction_steps.map((s, index) => <li key={index}>{field(`Reproduction step ${index + 1}`, s, value => edit({ reproduction_steps: item.reproduction_steps!.map((s, i) => i === index ? value : s) }))}</li>)}</ol>{field('Expected behavior', item.expected_result || '', expected_result => edit({ expected_result }))}{field('Observed behavior', item.actual_result || '', actual_result => edit({ actual_result }))}</> : null}
        </>}
        <footer><span role="status">{saved[selected] ? `Proposal ${saved[selected].updated ? 'updated' : 'created'} in ${item.kind === 'story' ? 'Stories' : item.kind === 'test_case' ? 'Test Cases' : 'Defects'}.` : decisions[selected] === 'declined' ? 'Proposal declined. No changes were saved.' : 'Accept saves the reviewed fields to the destination module.'}</span><div><button className="ghost-button" type="button" onClick={() => setDecisions(current => ({ ...current, [selected]: 'declined' }))} disabled={saving || Boolean(saved[selected]) || decisions[selected] === 'declined'}>Decline</button><button className="primary-button" type="button" disabled={!can(item.kind === "story" ? item.target_id ? "requirement.update" : "requirement.create" : item.kind === "test_case" ? "testcase.create" : "feedback.create") || !valid || !sessionId || receipts.isLoading || receipts.isError || saving || Boolean(saved[selected])} onClick={() => void accept()}>{saving ? 'Saving…' : saved[selected] ? 'Saved' : item.target_id ? 'Accept and update Story' : 'Accept and create'}</button>{saved[selected] ? <button className="ghost-button" type="button" onClick={() => navigate(item.kind === 'story' ? `/stories?requirement=${encodeURIComponent(saved[selected].id)}` : item.kind === 'test_case' ? `/test-cases?case=${encodeURIComponent(saved[selected].id)}` : `/issues?issue=${encodeURIComponent(saved[selected].id)}`)}>Open saved {item.kind === 'story' ? 'Story' : item.kind === 'test_case' ? 'Test Case' : 'Defect'}</button> : <button className="ghost-button" type="button" disabled={saving} onClick={() => { try { navigate(stageAgentProposal(item, projectId, appTypeId)); } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to open the draft.'); } }}>Edit in module</button>}</div></footer>
        {receipts.isError && <p role="alert">Saved proposal status is unavailable. <button type="button" onClick={() => void receipts.refetch()}>Retry status</button></p>}

      </article></div>
  </section>;
}
