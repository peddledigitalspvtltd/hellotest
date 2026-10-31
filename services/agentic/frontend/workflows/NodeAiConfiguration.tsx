import catalog from '@hellotest/platform/shared/aiExecutionDefaults.json';
import tasks from '../../shared/workflowNativeTasks.json';
import type { AgenticWorkflowNodeData } from '@hellotest/platform/frontend/src/types';
import './NodeAiConfiguration.css';

export type NodeAiConfiguration = {
  temperature?: number;
  top_p?: number | null;
  max_output_tokens?: number;
  context?: { mode: 'mcp' | 'none'; token_budget: number; max_items: number; required: boolean; focus: string };
  agent_execution?: { max_model_calls: number; max_revision_rounds: number; max_followups: number; timeout_ms: number };
  output_schema?: Record<string, unknown> | null | string;
};
type AgentLimits = {max_model_calls:number;max_output_tokens:number;timeout_ms:number};
export type NodeAiDefaults = NodeAiConfiguration & {definition_limits?:AgentLimits;native_contract?:string};
const evidenceDefaults = { mode: 'mcp' as const, token_budget: 3200, max_items: 10, required: false, focus: '' };
const executionDefaults = { max_model_calls: 4, max_revision_rounds: 1, max_followups: 2, timeout_ms: 150000 };
const featureDefaults = catalog as unknown as Array<{id:string;defaults:NodeAiConfiguration & {instruction_blocks?:Record<string,string>}}>;
export function nodeAiDefaults(data: AgenticWorkflowNodeData): NodeAiDefaults {
  const native = tasks[data.artifactTask as keyof typeof tasks];
  const id = data.kind === 'artifactTask' ? native?.featureKey : data.kind === 'repositoryAgent' ? `ai.agentic.repository.${data.repositoryAgentType}` : String(data.agentId || '').startsWith('agent-') ? 'ai.agentic.workflow' : `ai.agentic.${data.agentId || 'workflow'}`;
  const stock = featureDefaults.find(item => item.id === id)?.defaults || featureDefaults.find(item => item.id === 'ai.agentic.workflow')!.defaults;
  const saved = (data.agentSnapshot as {definition?:{ai_configuration?:NodeAiConfiguration;limits?:AgentLimits}} | undefined)?.definition;
  const effective = {...stock,...saved?.ai_configuration};
  if (saved?.limits) {
    const calls = saved.limits.max_model_calls;
    effective.max_output_tokens = saved.limits.max_output_tokens;
    effective.agent_execution = {max_model_calls:calls,max_revision_rounds:Math.min(1,calls-1),max_followups:Math.min(3,calls-1),timeout_ms:saved.limits.timeout_ms};
  }
  return {...effective,...(saved?.limits ? {definition_limits:saved.limits} : {}),native_contract:stock.instruction_blocks?.['application.artifactContract']};
}

export function NodeAiSettings({ value = {}, defaults = {}, onChange, reviewCriteria = '', onReviewCriteriaChange, agent = false, definition = false, run = false, outputConstraints = true }: {
  value?: NodeAiConfiguration; onChange: (value: NodeAiConfiguration) => void;
  defaults?: NodeAiDefaults;
  reviewCriteria?: string; onReviewCriteriaChange: (text: string) => void; agent?: boolean; definition?: boolean; run?:boolean; outputConstraints?:boolean;
}) {
  const context = value.context || defaults.context || evidenceDefaults;
  const configuredExecution = value.agent_execution || defaults.agent_execution || executionDefaults;
  const limits = defaults.definition_limits;
  const execution = limits ? {...configuredExecution,max_model_calls:Math.min(configuredExecution.max_model_calls,limits.max_model_calls),timeout_ms:Math.min(configuredExecution.timeout_ms,limits.timeout_ms)} : configuredExecution;
  const outputTokens = value.max_output_tokens === undefined ? '' : limits ? Math.min(value.max_output_tokens,limits.max_output_tokens) : value.max_output_tokens;
  const set = (patch: Partial<NodeAiConfiguration>) => onChange({ ...value, ...patch });
  const number = (key: 'temperature' | 'top_p' | 'max_output_tokens', text: string) => {
    const next = { ...value };
    if (!text) delete next[key]; else next[key] = Number(text);
    onChange(next);
  };
  return <details className="studio-parameter-group studio-node-ai-settings">
    <summary>Model, evidence and review settings</summary>
    <p className="studio-caption">Saved with this {definition ? 'agent version' : run ? 'reviewed run' : 'node'}. Empty model fields use task defaults. Admin AI Controls do not supply prompts or model preferences to agents and native tasks.</p>
    {limits && <p className="studio-caption">The saved agent version limits this node to {limits.max_model_calls} model calls, {limits.max_output_tokens.toLocaleString()} output tokens per response and {limits.timeout_ms / 1000} seconds. Node settings can reduce these limits; the agent version remains the upper bound.</p>}
    <label><span>Temperature</span><input aria-label="Node temperature" type="number" min={0} max={2} step={0.05} placeholder={String(defaults.temperature ?? 'Task default')} value={value.temperature ?? ''} onChange={event => number('temperature', event.target.value)} /><small>Models that require their default sampling omit this setting.</small></label>
    <label><span>Top P</span><input aria-label="Node top P" type="number" min={0.01} max={1} step={0.01} placeholder={String(defaults.top_p ?? 'Task default')} value={value.top_p ?? ''} onChange={event => number('top_p', event.target.value)} /></label>
    {!definition && <label><span>Maximum output tokens</span><input aria-label="Node maximum output tokens" type="number" min={256} max={limits?.max_output_tokens || 16384} step={1} placeholder={String(defaults.max_output_tokens ?? 'Task default')} value={outputTokens} onChange={event => number('max_output_tokens', event.target.value)} /><small>Per model response; provider and application spending bounds still apply.</small></label>}
    <label><span>Additional project evidence</span><select aria-label="Node evidence mode" value={context.mode} onChange={event => set({ context: { ...context, mode: event.target.value as 'mcp' | 'none', required: event.target.value === 'none' ? false : context.required } })}><option value="mcp">Retrieve permitted evidence</option><option value="none">Supplied task input only</option></select><small>Connected task records and native source checks remain available in both modes.</small></label>
    {context.mode === 'mcp' && <>
      <label><span>Evidence token budget</span><input aria-label="Node evidence token budget" type="number" min={256} max={8000} step={1} value={context.token_budget} onChange={event => set({ context: { ...context, token_budget: Number(event.target.value) } })} /></label>
      <label><span>Maximum evidence items</span><input aria-label="Node maximum evidence items" type="number" min={1} max={40} value={context.max_items} onChange={event => set({ context: { ...context, max_items: Number(event.target.value) } })} /></label>
      <label><span>Retrieval focus</span><textarea aria-label="Node retrieval focus" rows={3} maxLength={4000} value={context.focus} onChange={event => set({ context: { ...context, focus: event.target.value } })} /></label>
      <label className="studio-check-field"><input type="checkbox" checked={context.required} onChange={event => set({ context: { ...context, required: event.target.checked } })} /><span>Require retrieved evidence</span><small>Stop when the selected retrieval cannot supply authorized evidence.</small></label>
    </>}
    <label><span>Task-specific review criteria</span><textarea aria-label="Task-specific review criteria" rows={4} maxLength={4000} value={reviewCriteria} onChange={event => onReviewCriteriaChange(event.target.value)} /><small>Native scores and artifact checks remain calculated by the application. These criteria guide the review and cannot change a computed score.</small></label>
    {agent && !definition && <>
      <label><span>Total model calls</span><input aria-label="Node total model calls" type="number" min={1} max={limits?.max_model_calls || 8} value={execution.max_model_calls} onChange={event => { const max = Number(event.target.value); set({ agent_execution: { ...execution, max_model_calls: max, max_revision_rounds: Math.min(execution.max_revision_rounds, Math.max(0, max - 1)) } }); }} /></label>
      <label><span>Maximum corrections</span><input aria-label="Node maximum corrections" type="number" min={0} max={3} value={execution.max_revision_rounds} onChange={event => set({ agent_execution: { ...execution, max_revision_rounds: Number(event.target.value) } })} /></label>
      <label><span>Maximum specialist handoffs</span><input aria-label="Node maximum specialist handoffs" type="number" min={0} max={3} value={execution.max_followups} onChange={event => set({ agent_execution: { ...execution, max_followups: Number(event.target.value) } })} /><small>Corrections and handoffs share the total model-call budget and step timeout.</small></label>
    </>}
    {outputConstraints && <details><summary>Additional output constraints</summary>{defaults.native_contract && <p className="studio-caption"><strong>Required application contract:</strong> {defaults.native_contract}</p>}<label><span>Additional JSON Schema</span><textarea aria-label="Node additional output schema" rows={7} spellCheck={false} placeholder={'{"type":"object"}'} value={typeof value.output_schema === 'string' ? value.output_schema : value.output_schema ? JSON.stringify(value.output_schema, null, 2) : ''} onChange={event => { const text = event.target.value; let schema: NodeAiConfiguration['output_schema'] = null; if (text.trim()) { try { schema = JSON.parse(text); } catch { schema = text; } } set({ output_schema: schema }); }} /></label>{typeof value.output_schema === 'string' && <p role="alert">Complete valid JSON before saving or running.</p>}<p className="studio-caption">Optional additional constraints supplement this task's primary result. They cannot replace its native response contract. Application field names, allowed identifiers, source checks and native validators remain required. Supporting model phases keep their own contracts.</p></details>}
  </details>;
}
