import { useState } from 'react';
import { IconBrain, IconCheck, IconShieldCheck } from '@tabler/icons-react';
import { AiEvidenceFlyout, HELLOTEST_AGENT_CATALOG } from '../components/AgenticExperience';
import { WorkflowSkills } from '../workflows/WorkflowSkills';
import { SmartContextWorkbench } from '@hellotest/ai/frontend/components/SmartContextWorkbench';
import { agentFromSpecialist, definitionNode, newAgentDefinition, type AgentDefinition, type ProjectAgent } from './agentDefinitions';
import type { AgenticWorkflowNodeData } from '@hellotest/platform/frontend/src/types';
import type { WorkflowSkill } from '../workflows/specialistProfiles';
import './AgentDefinitionEditor.css';
import { validateAgentDefinition } from './agentDefinitionValidation';
import { NodeAiSettings, nodeAiDefaults } from '../workflows/NodeAiConfiguration';

const scopes = [['stories', 'Stories'], ['test-cases', 'Test cases'], ['runs', 'Runs'], ['bugs', 'Defects'], ['automation', 'Automation'], ['knowledge', 'Knowledge']];
const resultTypes = [['review', 'Evidence review'], ['story', 'Story drafts'], ['test_case', 'Test case drafts'], ['defect', 'Defect drafts'], ['run', 'Run drafts'], ['automation', 'Automation Plan drafts']] as const;
const resultHelp = { review: 'Findings, recommendations and cited sections or tables. No library record is required.', story: 'Title, description, acceptance criteria and priority.', test_case: 'Title, description, actions with expected results, priority, test case type and relevant test parameters.', defect: 'Title, description, reproduction steps, expected and actual behavior, severity and priority.', run: 'Title, description, selected existing test cases and exit criteria.', automation: 'A reviewable Plan with ordered actions and expected outcomes. Generating or executing a script requires Automation Engineer.' };
export function AgentDefinitionEditor({ agent, initial, projectId, appTypeId, providers, busy, error, onClose, onSave }: {
  agent?: ProjectAgent; initial?: AgentDefinition; projectId: string; appTypeId: string;
  providers: Array<{ value: string; label: string }>; busy: boolean; error: string;
  onClose: () => void; onSave: (definition: AgentDefinition, activate: boolean) => void;
}) {
  const [draft, setDraft] = useState<AgentDefinition>(() => structuredClone(agent?.definition || initial || newAgentDefinition()));
  const [requiredInputText, setRequiredInputText] = useState(() => (agent?.definition || initial)?.required_inputs.join(', ') || '');
  const [tab, setTab] = useState('purpose');
  const change = (patch: Partial<AgentDefinition>) => setDraft(current => ({ ...current, ...patch }));
  const skillsChange = (patch: Partial<AgenticWorkflowNodeData>) => change({
    ...(patch.skills ? { skills: patch.skills as WorkflowSkill[] } : {}),
    ...(patch.allowedTools ? { allowed_tools: patch.allowedTools as string[] } : {}),
    ...(patch.guardrails !== undefined ? { guardrails: String(patch.guardrails) } : {}),
  });
  const issues = validateAgentDefinition(draft);
  const output = draft.output_contract || { kind: 'review' as const, minimum_artifacts: 0 };
  const valid = issues.length === 0;
  return <AiEvidenceFlyout open onClose={() => { if (!busy) onClose(); }} eyebrow="Agentic Studio / Agent builder"
    title={agent ? `Edit ${agent.definition.name}` : 'Create an AI agent'}
    description="Purpose, evidence and a clear completion contract."
    footer={<div className="agent-editor-footer">{issues.length ? <button type="button" className="agent-editor-validation" disabled={busy} onClick={() => setTab(issues[0].tab)}>{issues[0].message}{issues.length > 1 ? ` +${issues.length - 1} more` : ''}</button> : <span>{agent ? `Next version: ${agent.current_version + 1}` : 'Saved to this project'} · Activate to make available in workflows.</span>}<div><button type="button" className="ghost-button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="ghost-button" disabled={busy || !valid} onClick={() => onSave(draft, false)}>Save draft</button><button type="button" className="primary-button" disabled={busy || !valid} onClick={() => onSave(draft, true)}>{busy ? 'Saving…' : 'Save and activate'}</button></div></div>}>
    <div className="agent-definition-editor">
      <div className="agent-model-contract"><IconBrain size={21} /><div><strong>Model-backed, evidence-driven</strong><p>Runs use your configured LLM. Results include evidence and completion checks.</p></div></div>
      <nav aria-label="Agent configuration">{[['purpose', '1. Purpose'], ['skills', '2. Skills & evidence'], ['completion', '3. Completion & limits']].map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>
      {error && <div className="agent-editor-error" role="alert">{error}</div>}
      <fieldset disabled={busy}>
        {tab === 'purpose' && <>
          {!agent && <label><span>Start from</span><select defaultValue="" onChange={event => { const source = HELLOTEST_AGENT_CATALOG.find(item => item.id === event.target.value); setDraft(source ? agentFromSpecialist(source.id, source.name) : newAgentDefinition()); setRequiredInputText(""); }}><option value="">Blank agent</option>{HELLOTEST_AGENT_CATALOG.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Use a specialist's skills and context as a starting point.</small></label>}
          <label><span>Agent name <b>*</b></span><input autoFocus data-autofocus="true" required value={draft.name} maxLength={120} onChange={event => change({ name: event.target.value })} placeholder="Release evidence reviewer" /></label>
          <label><span>Objective <b>*</b></span><textarea value={draft.objective} maxLength={2000} rows={4} onChange={event => change({ objective: event.target.value })} placeholder="Describe the result this agent should produce and who will use it." /></label>
          <label><span>Description</span><input value={draft.description} maxLength={600} onChange={event => change({ description: event.target.value })} placeholder="A short description for the agent library" /></label>
          <label><span>Model connection</span><select value={draft.integration_id} onChange={event => change({ integration_id: event.target.value })}>{providers.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><small>Activation validates the connection configuration. Each run must receive a valid model response.</small></label>
          <label><span>Task instructions</span><textarea rows={4} maxLength={3000} value={draft.instructions} onChange={event => change({ instructions: event.target.value })} placeholder="Scope, exclusions, expected sections and important rules." /></label>
        </>}
        {tab === 'skills' && <>
          <WorkflowSkills editingAgent data={definitionNode(draft)} projectId={projectId} appTypeId={appTypeId} disabled={busy} onChange={skillsChange} />
          <section><h3>Evidence scope</h3><p>Only permitted records in this project can be retrieved.</p><div className="agent-scope-grid">{scopes.map(([id, label]) => <label key={id}><input type="checkbox" checked={draft.context_scopes.includes(id)} onChange={event => change({ context_scopes: event.target.checked ? [...draft.context_scopes, id] : draft.context_scopes.filter(value => value !== id) })} /><span>{label}</span></label>)}</div></section>
          {draft.allowed_tools.includes('knowledge_search') && draft.context_scopes.includes('knowledge') && <section><h3>Knowledge sources</h3><p>{draft.source_ids.length ? `${draft.source_ids.length} selected sources. Retrieval uses their current permitted content.` : 'Search all permitted project knowledge, or choose specific sources.'}</p><SmartContextWorkbench projectId={projectId} appTypeId={appTypeId} initialQuery={draft.objective} buttonLabel="Choose knowledge sources" disabled={busy} onApply={selection => change({ source_ids: selection.sourceIds, source_kinds: selection.sourceKinds })} />{draft.source_ids.length > 0 && <button type="button" className="ghost-button" onClick={() => change({ source_ids: [], source_kinds: [] })}>Clear source selection</button>}</section>}
          <label><span>Domain context and examples</span><textarea rows={5} maxLength={4000} value={draft.context} onChange={event => change({ context: event.target.value })} placeholder="Glossary, reviewed examples, assumptions and known limitations." /><small>Context is supplied data. It cannot override tool permissions or platform rules.</small></label>
          <label><span>Required run inputs</span><input value={requiredInputText} aria-describedby="agent-required-input-help" onChange={event => { setRequiredInputText(event.target.value); change({ required_inputs: [...new Set(event.target.value.split(',').map(item => item.trim()).filter(Boolean))] }); }} placeholder="release_id, environment" /><small id="agent-required-input-help">Comma-separated names. Supply values in the task inputs or workflow JSON.</small></label>
        </>}
        {tab === 'completion' && <>
          <NodeAiSettings definition agent value={draft.ai_configuration} defaults={nodeAiDefaults({agentId:'agent-definition'})} reviewCriteria={draft.review_criteria || ''}
            onChange={ai_configuration => change({ ai_configuration })} onReviewCriteriaChange={review_criteria => change({ review_criteria })} />
          <section className="agent-completion-contract"><h3><IconShieldCheck size={19} />Completion rules</h3><p>These checks run in application code. A model's claim of success cannot override them.</p>
            <label><span>Required result</span><select value={output.kind} onChange={event => { const kind = event.target.value as typeof output.kind; change({ output_contract: { kind, minimum_artifacts: kind === 'review' ? 0 : Math.max(1, output.minimum_artifacts) } }); }}>{resultTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>{resultHelp[output.kind]}</small></label>
            {output.kind !== 'review' && <label><span>Minimum reviewed drafts</span><input type="number" min={1} max={8} value={output.minimum_artifacts} onChange={event => change({ output_contract: { ...output, minimum_artifacts: Number(event.target.value) } })} /><small>The agent needs complete drafts of this type before its completion checks can pass. Saving remains a separate approval.</small></label>}
            <label><input type="checkbox" checked={draft.acceptance.require_evidence} onChange={event => change({ acceptance: { ...draft.acceptance, require_evidence: event.target.checked } })} /><span>Require evidence references</span></label>
            <label><input type="checkbox" checked={draft.acceptance.no_evidence_gaps} onChange={event => change({ acceptance: { ...draft.acceptance, no_evidence_gaps: event.target.checked } })} /><span>Stop for missing evidence</span></label>
            <label><span>Minimum findings</span><input type="number" min={0} max={8} value={draft.acceptance.minimum_findings} onChange={event => change({ acceptance: { ...draft.acceptance, minimum_findings: Number(event.target.value) } })} /></label>
            <p className="agent-contract-note"><IconCheck size={16} />Valid output and permitted references are always checked. Factual accuracy and business decisions still require human review.</p>
          </section>
          <div className="agent-limit-grid"><label><span>Time limit (seconds)</span><input type="number" min={10} max={150} value={draft.limits.timeout_ms / 1000} onChange={event => change({ limits: { ...draft.limits, timeout_ms: Number(event.target.value) * 1000 } })} /></label><label><span>Model calls per attempt</span><select value={draft.limits.max_model_calls} onChange={event => change({ limits: { ...draft.limits, max_model_calls: Number(event.target.value) } })}><option value={1}>1 · no repair</option><option value={2}>2 · one repair</option><option value={4}>4 · review and successor drafts</option></select></label><label><span>Maximum output tokens</span><input type="number" min={256} max={8000} step={256} value={draft.limits.max_output_tokens} onChange={event => change({ limits: { ...draft.limits, max_output_tokens: Number(event.target.value) } })} /></label></div>
          <p className="agent-contract-note">Agents produce a structured review with a response, findings, deliverables, evidence gaps and references. Memory is limited to supplied task history. Artifact changes remain separate reviewed actions.</p>
        </>}
      </fieldset>
    </div>
  </AiEvidenceFlyout>;
}
