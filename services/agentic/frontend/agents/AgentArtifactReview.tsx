import { GherkinEditor } from "@hellotest/testing/frontend/components/GherkinEditor";
import { draftReadinessIssues } from "@hellotest/ai/frontend/lib/draftReadiness";
import { AiTestCaseDraftFields } from "@hellotest/ai/frontend/components/AiTestCaseDraftFields";
import { AiTestCaseStepTable } from "@hellotest/ai/frontend/components/AiTestCaseStepTable";
import { useCapabilityAccess } from '@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { agenticApi, type AgentProposalReceipt } from '../api.client';
import { IconCopy, IconDownload, IconEdit, IconCheck, IconSparkles } from '@tabler/icons-react';
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
  const [caseEditing,setCaseEditing] = useState(false);
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
  useEffect(() => { setDrafts(artifacts); setCaseEditing(false); setSelected(0); setDecisions({}); setSaved({}); setNotice(''); }, [artifacts]);
  const item = drafts[selected] || drafts[0];
  if (!item) return null;
  const edit = (patch: Partial<AgentStructuredArtifact>) => {
    if (savingRef.current || saved[selected]) return;
    setDrafts(current => current.map((draft, index) => index === selected ? { ...draft, ...patch } : draft));
    setDecisions(current => { const next = { ...current }; delete next[selected]; return next; });
  };
  const valid = Boolean(item.title.trim() && item.title.length <= 255 && item.description.trim() && (item.kind === 'story' ? item.acceptance_criteria?.length && item.acceptance_criteria.every(s => s.trim()) : item.kind === 'test_case' ? !draftReadinessIssues({...item,steps:item.steps || []}).length : item.kind === 'run' ? item.test_case_ids?.length && item.exit_criteria?.length : item.reproduction_steps?.length && item.reproduction_steps.every(s => s.trim()) && item.expected_result?.trim() && item.actual_result?.trim()));
  const field = (label: string, value: string, update: (value: string) => void) => <label className="agent-proposal-field"><span>{label}</span><textarea aria-label={label} disabled={saving || Boolean(saved[selected])} value={value} onChange={event => update(event.target.value)} rows={3} /></label>;
  return <section className="agent-structured-output" aria-label="Structured agent proposals">
    <header><div><h3>Proposals for review</h3><p>{chain.filter(a => a.status === 'completed').map(a => a.name).join(' → ')}</p></div><div className="agent-proposal-tools"><button className="ghost-button compact" aria-label={copied ? "Proposal copied" : "Copy proposal"} title="Copy proposal" type="button" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(item, null, 2)); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { setNotice('Clipboard access is unavailable.'); } }}>{copied ? 'Copied' : <IconCopy size={17} />}</button><button className="ghost-button compact" type="button" aria-label="Download proposal" title="Download proposal" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'agent-proposal.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><IconDownload size={17} /></button></div></header>
    {notice && <p className="agent-proposal-notice" role="status">{notice}</p>}
    <div className={drafts.every(draft=>draft.kind === "test_case") ? "ai-artifact-workspace" : "agent-structured-layout ai-artifact-workspace"}><nav className="ai-artifact-outline" aria-label="Choose proposal">{drafts.map((a, index) => <article className="ai-artifact-item" key={index} aria-current={index===selected ? "true" : undefined}><input type="radio" name="agent-proposal" aria-label={`Review ${a.title}`} checked={index===selected} onChange={()=>{setSelected(index);setCaseEditing(false);}}/><button type="button" key={index} aria-pressed={index === selected} onClick={() => { setSelected(index); setCaseEditing(false); setNotice(''); }}><strong>{a.title}</strong><small>{a.kind.replace('_', ' ')} · {a.priority} · {saved[index] ? 'Saved' : decisions[index] || 'Review required'}{a.kind === 'test_case' ? ` · ${a.authoring_mode === 'gherkin' ? 'Gherkin' : `${a.steps?.length || 0} steps`}` : ''}</small></button></article>)}</nav>
      <article className="ai-artifact-detail">
        {item.kind === 'test_case' && <header><span><IconSparkles size={13}/> Proposal · review before saving</span><div className="ai-artifact-detail__tools"><button type="button" disabled={saving || Boolean(saved[selected])} aria-label={caseEditing ? "Finish editing draft" : "Edit draft"} onClick={()=>setCaseEditing(current=>!current)}>{caseEditing ? <IconCheck size={15}/> : <IconEdit size={15}/>} {caseEditing ? "Done" : "Edit"}</button></div></header>}
        {item.kind === 'story' ? <StoryAiDraftInspector draft={{ id: String(selected), generated: true, title: item.title, description: item.description, acceptanceCriteria: item.acceptance_criteria, priority: Number(item.priority.slice(1)), evidenceRefs: item.citation_ids }} editable={!saving && !saved[selected]} evidencePlacement="intelligence" showGherkin={false} showProperties={false} onTitleChange={value => edit({ title: value })} onDescriptionChange={value => edit({ description: value })} onAcceptanceCriteriaChange={value => edit({ acceptance_criteria: value })} /> : <>
          <span className="agent-eyebrow">{item.kind.replace('_', ' ')} · {item.priority}{item.severity ? ` · ${item.severity}` : ''}</span>
          {item.kind === 'test_case' ? <>{(['title','fields'] as const).map(section => <AiTestCaseDraftFields key={section} section={section} title={item.title} description={item.description} priority={Number(item.priority.slice(1))} editing={caseEditing && !saved[selected]} disabled={saving} onChange={({priority,...patch}) => edit({...patch,...(priority ? {priority:`P${priority}`} : {})})} />)}</> : <>{field('Title', item.title, title => edit({ title }))}{field('Description', item.description, description => edit({ description }))}</>}
          {item.prerequisites?.length ? <><h4>Prerequisites</h4><ul>{item.prerequisites.map((s, i) => <li key={i}>{s}</li>)}</ul></> : null}
          {item.test_data?.length ? <><h4>Test data</h4><ul>{item.test_data.map((value, index) => <li key={index}>{value}</li>)}</ul></> : null}
          {item.cleanup?.length ? <><h4>Cleanup</h4><ul>{item.cleanup.map((value, index) => <li key={index}>{value}</li>)}</ul></> : null}
          {item.requirement_ids?.length ? <p className="ai-test-generator-traceability">Story traceability: {item.requirement_ids.join(', ')}</p> : null}
          {item.kind === 'test_case' && item.authoring_mode === 'gherkin' ? <GherkinEditor compact featureTitle={item.title} readOnly={!caseEditing || saving || Boolean(saved[selected])} value={item.gherkin_document || ''} onChange={document=>edit({gherkin_document:document})} /> : item.kind === 'test_case' ? <AiTestCaseStepTable steps={item.steps || []} editing={caseEditing && !saved[selected]} disabled={saving} newStep={() => ({ action: '', expected_result: '', ...(item.steps?.[0]?.step_type ? {step_type:item.steps[0].step_type} : {}) })} onChange={steps => edit({ steps })} /> : null}
          {item.kind === 'run' && <><h4>Selected Test Cases</h4><table className="ai-test-generator-step-table"><thead><tr><th>Order</th><th>Test Case ID</th></tr></thead><tbody>{item.test_case_ids?.map((id,index) => <tr key={id}><td>{index + 1}</td><td>{id}</td></tr>)}</tbody></table><h4>Exit criteria</h4><ul>{item.exit_criteria?.map((criterion,index) => <li key={index}>{criterion}</li>)}</ul><p>This creates a manual Run draft. Execution requires the Run module.</p></>}
          {item.reproduction_steps?.length ? <><h4>Reproduction steps</h4><ol>{item.reproduction_steps.map((s, index) => <li key={index}>{field(`Reproduction step ${index + 1}`, s, value => edit({ reproduction_steps: item.reproduction_steps!.map((s, i) => i === index ? value : s) }))}</li>)}</ol>{field('Expected behavior', item.expected_result || '', expected_result => edit({ expected_result }))}{field('Observed behavior', item.actual_result || '', actual_result => edit({ actual_result }))}</> : null}
        </>}
        <footer><span role="status">{saved[selected] ? `Proposal ${saved[selected].updated ? 'updated' : 'created'} in ${item.kind === 'story' ? 'Stories' : item.kind === 'test_case' ? 'Test Cases' : item.kind === 'run' ? 'Runs' : 'Defects'}.` : decisions[selected] === 'declined' ? 'Proposal declined. No changes were saved.' : 'Accept saves the reviewed fields to the destination module.'}</span><div><button className="ghost-button" type="button" onClick={() => setDecisions(current => ({ ...current, [selected]: 'declined' }))} disabled={saving || Boolean(saved[selected]) || decisions[selected] === 'declined'}>Decline</button><button className="primary-button" type="button" disabled={!can(item.kind === "story" ? item.target_id ? "requirement.update" : "requirement.create" : item.kind === "test_case" ? "testcase.create" : item.kind === "run" ? "run.create" : "feedback.create") || !valid || !sessionId || receipts.isLoading || receipts.isError || saving || Boolean(saved[selected])} onClick={() => void accept()}>{saving ? 'Saving…' : saved[selected] ? 'Saved' : item.target_id ? 'Accept and update Story' : 'Accept and create'}</button>{saved[selected] ? <button className="ghost-button" type="button" onClick={() => navigate(item.kind === 'story' ? `/stories?requirement=${encodeURIComponent(saved[selected].id)}` : item.kind === 'test_case' ? `/test-cases?case=${encodeURIComponent(saved[selected].id)}` : item.kind === 'run' ? `/executions?execution=${encodeURIComponent(saved[selected].id)}` : `/issues?issue=${encodeURIComponent(saved[selected].id)}`)}>Open saved {item.kind === 'story' ? 'Story' : item.kind === 'test_case' ? 'Test Case' : item.kind === 'run' ? 'Run' : 'Defect'}</button> : <button className="ghost-button" type="button" disabled={saving || item.kind === 'run'} onClick={() => { try { navigate(stageAgentProposal(item, projectId, appTypeId)); } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to open the draft.'); } }}>Edit in module</button>}</div></footer>
        {receipts.isError && <p role="alert">Saved proposal status is unavailable. <button type="button" onClick={() => void receipts.refetch()}>Retry status</button></p>}

      </article></div>
  </section>;
}
