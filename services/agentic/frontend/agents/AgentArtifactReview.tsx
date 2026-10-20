import { GherkinEditor } from "@hellotest/testing/frontend/components/GherkinEditor";
import { agentArtifactDestination, agentArtifactIssues, agentArtifactSavedRoute } from '../lib/agentArtifactReview';
import { AiTestCaseDraftFields } from "@hellotest/ai/frontend/components/AiTestCaseDraftFields";
import { AiTestCaseStepTable } from "@hellotest/ai/frontend/components/AiTestCaseStepTable";
import '@hellotest/ai/frontend/components/AgenticAuthoringCanvas.css';
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
import { useDomainMetadata } from '@hellotest/platform/frontend/src/platform/hooks/useDomainMetadata';
import './AgentWorkspace.css';
const StoryAiDraftInspector = capabilityView<import('react').ComponentProps<typeof import('@hellotest/ai/frontend/components/StoryAiStudioContent')['StoryAiDraftInspector']>>('ai', 'StoryAiDraftInspector', () => import('@hellotest/ai/frontend/components/StoryAiStudioContent'), 'Story proposal');

type Decision = 'accepted' | 'declined';
export function AgentArtifactReview({ artifacts, chain, sessionId, findings = [], approvalBlocked }: { sessionId?: string; artifacts: AgentStructuredArtifact[]; chain: NonNullable<AgenticAssistantResult['agent_chain']>; findings?: NonNullable<AgenticAssistantResult['findings']>; approvalBlocked?: string }) {
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
  const domainMetadata = useDomainMetadata();
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Record<number, AgentProposalReceipt>>({});
  const receipts = useQuery({ queryKey: ['agent-proposals', sessionId], queryFn: () => agenticApi.agentProposals.list(sessionId!), enabled: Boolean(sessionId), retry: false });
  useEffect(() => { if (receipts.data) setSaved(Object.fromEntries(receipts.data.map(item => [item.proposal_index, item.receipt]))); }, [receipts.data]);
  const accept = async () => {
    if (!sessionId || savingRef.current || saved[selected] || approvalBlocked) return;
    const index = selected;
    savingRef.current = true; setSaving(true); setNotice('');
    try {
      const receipt = await agenticApi.agentProposals.accept(sessionId, { index, artifact: drafts[index], app_type_id: appTypeId || undefined });
      setSaved(current => ({ ...current, [index]: receipt }));
      setDecisions(current => ({ ...current, [index]: 'accepted' }));
      void queryClient.invalidateQueries({ queryKey: ['agent-proposals', sessionId] });
      void queryClient.invalidateQueries({ queryKey: [receipt.kind === 'story' ? 'requirements' : receipt.kind === 'test_case' || receipt.kind === 'automation' ? 'test-cases' : receipt.kind === 'run' ? 'executions' : 'issues'] });
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
  const issues = agentArtifactIssues(item);
  const valid = issues.length === 0;
  const locked = saving || Boolean(saved[selected]);
  const canAccept = can(item.kind === 'story' ? item.target_id ? 'requirement.update' : 'requirement.create' : item.kind === 'test_case' || item.kind === 'automation' ? 'testcase.create' : item.kind === 'run' ? 'run.create' : 'feedback.create') && (item.kind !== 'automation' || ['automation.view','automation.code.view','automation.build'].every(permission => can(permission)));
  const field = (label: string, value: string, update: (value: string) => void) => <label className="agent-proposal-field"><span>{label}</span><textarea aria-label={label} disabled={saving || Boolean(saved[selected])} value={value} onChange={event => update(event.target.value)} rows={3} /></label>;
  const listField = (label: string, values: string[] | undefined, update: (values: string[]) => void) => field(label, (values || []).join('\n'), value => update(value.split('\n')));
  const addressed = findings.filter((finding, index) => item.addressed_finding_ids?.includes(finding.id || `finding-${index + 1}`));
  return <section className="agent-structured-output" aria-label="Structured agent proposals">
    <header><div><h3>Proposals for review</h3><p>{chain.filter(a => a.status === 'completed').map(a => a.name).join(' → ')}</p></div><div className="agent-proposal-tools"><button className="ghost-button compact" aria-label={copied ? "Proposal copied" : "Copy proposal"} title="Copy proposal" type="button" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(item, null, 2)); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { setNotice('Clipboard access is unavailable.'); } }}>{copied ? 'Copied' : <IconCopy size={17} />}</button><button className="ghost-button compact" type="button" aria-label="Download proposal" title="Download proposal" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'agent-proposal.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><IconDownload size={17} /></button></div></header>
    {notice && <p className="agent-proposal-notice" role="status">{notice}</p>}
    {approvalBlocked && <p className="agent-proposal-notice" role="alert">{approvalBlocked}</p>}
    <div className={drafts.every(draft=>draft.kind === "test_case") ? "ai-artifact-workspace" : "agent-structured-layout ai-artifact-workspace"}><nav className="ai-artifact-outline" aria-label="Choose proposal">{drafts.map((a, index) => <article className="ai-artifact-item" key={index} aria-current={index===selected ? "true" : undefined}><input type="radio" name="agent-proposal" aria-label={`Review ${a.title}`} checked={index===selected} onChange={()=>{setSelected(index);setCaseEditing(false);}}/><button type="button" key={index} aria-pressed={index === selected} onClick={() => { setSelected(index); setCaseEditing(false); setNotice(''); }}><strong>{a.title}</strong><small>{a.kind.replace('_', ' ')} · {a.priority} · {saved[index] ? 'Saved' : decisions[index] || 'Review required'}{a.kind === 'test_case' ? ` · ${a.authoring_mode === 'gherkin' ? 'Gherkin' : `${a.steps?.length || 0} steps`}` : ''}</small></button></article>)}</nav>
      <article className="ai-artifact-detail">
        {addressed.length > 0 && <section className="agent-proposal-addressed"><h4>Findings addressed</h4><ul>{addressed.map((finding, index) => <li key={finding.id || index}><strong>{finding.title}</strong><p>{finding.proposed_action || finding.gap || finding.detail}</p>{finding.acceptance_check && <small>Acceptance check: {finding.acceptance_check}</small>}</li>)}</ul></section>}
        {item.kind === 'automation' && <p className="agent-proposal-notice">Accepting saves a draft Automation Plan. Use Automation Engineer in the saved case to inspect the app, generate instructions and verify the script.</p>}
        {(item.kind === 'test_case' || item.kind === 'automation') && <header><span><IconSparkles size={13}/> Proposal · review before saving</span><div className="ai-artifact-detail__tools"><button type="button" disabled={locked} aria-label={caseEditing ? "Finish editing draft" : "Edit draft"} onClick={()=>setCaseEditing(current=>!current)}>{caseEditing ? <IconCheck size={15}/> : <IconEdit size={15}/>} {caseEditing ? "Done" : "Edit"}</button></div></header>}
        {item.kind === 'story' ? <StoryAiDraftInspector draft={{ id: String(selected), generated: true, title: item.title, description: item.description, acceptanceCriteria: item.acceptance_criteria, priority: Number(item.priority.slice(1)), evidenceRefs: item.citation_ids }} editable={!saving && !saved[selected]} evidencePlacement="intelligence" showGherkin={false} showProperties={false} onTitleChange={value => edit({ title: value })} onDescriptionChange={value => edit({ description: value })} onAcceptanceCriteriaChange={value => edit({ acceptance_criteria: value })} /> : <>
          <span className="agent-eyebrow">{item.kind.replace('_', ' ')} · {item.priority}{item.severity ? ` · ${item.severity}` : ''}</span>
          {item.kind === 'test_case' || item.kind === 'automation' ? <>{(['title','fields'] as const).map(section => <AiTestCaseDraftFields key={section} section={section} title={item.title} description={item.description} priority={Number(item.priority.slice(1))} testCaseType={item.test_case_type} typeOptions={domainMetadata.data?.test_cases?.types || []} editing={caseEditing && !saved[selected]} disabled={saving} onChange={({priority,...patch}) => edit({...patch,...(priority ? {priority:`P${priority}`} : {})})} />)}</> : <>{field('Title', item.title, title => edit({ title }))}{field('Description', item.description, description => edit({ description }))}</>}
          {(item.kind === 'test_case' || item.kind === 'automation') && <details><summary>Setup, test data & cleanup</summary>{listField('Prerequisites (one per line)', item.prerequisites, prerequisites => edit({prerequisites}))}{listField('Test data (one per line)', item.test_data, test_data => edit({test_data}))}{listField('Cleanup (one per line)', item.cleanup, cleanup => edit({cleanup}))}</details>}
          {item.requirement_ids?.length ? <p className="ai-test-generator-traceability">Story traceability: {item.requirement_ids.join(', ')}</p> : null}
          {item.kind === 'test_case' && item.authoring_mode === 'gherkin' ? <GherkinEditor compact featureTitle={item.title} readOnly={!caseEditing || saving || Boolean(saved[selected])} value={item.gherkin_document || ''} onChange={document=>edit({gherkin_document:document})} /> : item.kind === 'test_case' || item.kind === 'automation' ? <AiTestCaseStepTable steps={item.steps || []} editing={caseEditing && !saved[selected]} disabled={saving} newStep={() => ({ action: '', expected_result: '', ...(item.steps?.[0]?.step_type ? {step_type:item.steps[0].step_type} : {}) })} onChange={steps => edit({ steps })} /> : null}
          {item.kind === 'run' && <><h4>Selected Test Cases</h4><table className="ai-test-generator-step-table"><thead><tr><th>Order</th><th>Test Case ID</th></tr></thead><tbody>{item.test_case_ids?.map((id,index) => <tr key={id}><td>{index + 1}</td><td>{id}</td></tr>)}</tbody></table>{listField('Exit criteria (one per line)', item.exit_criteria, exit_criteria => edit({exit_criteria}))}<p>Acceptance saves the name and selected cases as a manual Run draft. The rationale and exit criteria remain in this agent review; execution and its settings are managed in Runs.</p></>}
          {item.kind === 'defect' && <>{listField('Reproduction steps (one per line)', item.reproduction_steps, reproduction_steps => edit({reproduction_steps}))}{field('Expected behavior', item.expected_result || '', expected_result => edit({ expected_result }))}{field('Observed behavior', item.actual_result || '', actual_result => edit({ actual_result }))}</>}
        </>}
        {item.kind !== 'test_case' && item.kind !== 'automation' && <label className="agent-proposal-field"><span>Priority</span><select aria-label="Priority" disabled={locked} value={item.priority} onChange={event => edit({priority:event.target.value})}>{['P1','P2','P3','P4','P5'].map(value => <option key={value}>{value}</option>)}</select></label>}
        {item.kind === 'defect' && <label className="agent-proposal-field"><span>Severity</span><select aria-label="Severity" value={item.severity || ''} disabled={locked} onChange={event => edit({severity:event.target.value})}><option value="">Select severity</option>{['critical','high','medium','low'].map(value => <option key={value}>{value}</option>)}</select></label>}
        {item.kind === 'automation' && <>{field('Start URL', item.start_url || '', start_url => edit({start_url}))}{item.manual_test_case_ids?.length ? <p>Linked manual cases: {item.manual_test_case_ids.join(', ')}</p> : null}</>}
        {(item.kind === 'test_case' || item.kind === 'automation') && Object.keys(item.parameter_values || {}).length > 0 && <details open><summary>Test parameters</summary><p>Case-owned values carried into the saved draft. Empty values remain empty.</p>{Object.entries(item.parameter_values || {}).map(([name, value]) => <label className="agent-proposal-field" key={name}><span>{name}</span><input aria-label={`Test parameter ${name}`} disabled={locked} value={value} onChange={event => edit({parameter_values:{...item.parameter_values,[name]:event.target.value}})} /></label>)}</details>}
        {issues.length > 0 && <div className="agent-proposal-notice" role="status"><strong>Complete before accepting</strong><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
        <footer><span role="status">{saved[selected] ? `Proposal ${saved[selected].updated ? 'updated' : 'created'} in ${agentArtifactDestination(item.kind)}.` : decisions[selected] === 'declined' ? 'Proposal declined. No changes were saved.' : 'Accept saves the reviewed fields to the destination module.'}</span><div>
          <button className="ghost-button" type="button" onClick={() => setDecisions(current => ({ ...current, [selected]: 'declined' }))} disabled={locked || decisions[selected] === 'declined'}>Decline</button>
          <button className="primary-button" type="button" disabled={Boolean(approvalBlocked) || !canAccept || !valid || !sessionId || receipts.isLoading || receipts.isError || locked} onClick={() => void accept()}>{saving ? 'Saving…' : saved[selected] ? 'Saved' : item.target_id ? 'Accept and update Story' : 'Accept and create'}</button>
          {saved[selected] ? <button className="ghost-button" type="button" onClick={() => navigate(agentArtifactSavedRoute(item.kind, saved[selected].id))}>Open saved {item.kind === 'story' ? 'Story' : item.kind === 'test_case' ? 'Test Case' : item.kind === 'run' ? 'Run' : item.kind === 'automation' ? 'Automation Plan' : 'Defect'}</button> : item.kind !== 'run' && item.kind !== 'automation' && <button className="ghost-button" type="button" disabled={saving || Boolean(approvalBlocked)} onClick={() => { try { navigate(stageAgentProposal(item, projectId, appTypeId)); } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to open the draft.'); } }}>Edit in module</button>}
        </div></footer>
        {receipts.isError && <p role="alert">Saved proposal status is unavailable. <button type="button" onClick={() => void receipts.refetch()}>Retry status</button></p>}

      </article></div>
  </section>;
}
