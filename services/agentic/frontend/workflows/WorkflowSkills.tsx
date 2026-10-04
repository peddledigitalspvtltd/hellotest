import { AiPromptTemplatePicker } from "@hellotest/integration/frontend/components/AiPromptTemplatePicker";
import { IconArrowUp, IconArrowDown, IconBook2, IconChevronDown, IconShieldCheck, IconTrash } from "@tabler/icons-react";
import type { AgenticWorkflowNodeData } from "@hellotest/platform/frontend/src/types";
import { nodeSkills, requiredGuardrails, workflowTools, specialistDefaults } from "./specialistProfiles";

export function WorkflowSkills({ data, projectId, appTypeId, disabled, onChange, editingAgent = false }: {
  data: AgenticWorkflowNodeData; projectId: string; appTypeId: string; disabled: boolean;
  onChange: (patch: Partial<AgenticWorkflowNodeData>) => void;
  editingAgent?: boolean;
}) {
  const skills = nodeSkills(data);
  const active = skills.filter(skill => skill.enabled !== false);
  const selectedTools = (Array.isArray(data.allowedTools) ? data.allowedTools : specialistDefaults(String(data.agentId || "quality-evaluator")).allowedTools || []) as string[];
  const guidanceSize = [data.prompt || data.intent || "", data.instructions || "", ...active.map(skill => `${skill.name}: ${skill.instructions}`), data.guardrails || ""].join("\n").length;
  const move = (index: number, offset: number) => {
    const reordered = [...skills];
    [reordered[index], reordered[index + offset]] = [reordered[index + offset], reordered[index]];
    onChange({ skills: reordered });
  };
  return <>
    <section className="studio-skills" aria-label="Node skills">
      <header className="studio-skills-heading"><span className="studio-skills-icon"><IconBook2 size={19} /></span><div><h4>Skills</h4><p>{active.length} active · {skills.length}/8 selected</p></div></header>
      <p className="studio-caption">Add reusable guidance, then tailor it to this task. Instructions are applied in the order below; edits stay in this {editingAgent ? "agent version" : "workflow"}.</p>
      <AiPromptTemplatePicker projectId={projectId} appTypeId={appTypeId} scope="workflow_skill" disabled={disabled || skills.length >= 8}
        onApply={(instructions, template) => onChange({ skills: [...skills.filter(skill => skill.id !== template.id), { id: template.id, name: template.name, instructions, enabled: true }] })} />
      {!skills.length && <div className="studio-skill-empty"><IconBook2 size={24} /><strong>No skills selected</strong><span>Choose a library skill or create guidance your team can reuse.</span></div>}
      <div className="studio-skill-list">
        {skills.map((skill, index) => <details className={`studio-skill ${skill.enabled === false ? "is-paused" : ""}`} key={skill.id}>
          <summary><span className="studio-skill-order">{index + 1}</span><span className="studio-skill-copy"><strong>{skill.name || "Untitled skill"}</strong><small>{skill.instructions || "Add instructions for this skill"}</small></span><span className="studio-skill-state">{skill.enabled === false ? "Paused" : "Active"}</span><IconChevronDown size={14} /></summary>
          <fieldset className="studio-skill-editor" disabled={disabled}>
            <label className="studio-check-field"><input type="checkbox" checked={skill.enabled !== false} onChange={event => onChange({ skills: skills.map((item, i) => i === index ? { ...item, enabled: event.target.checked } : item) })} /><span>Use this skill in the task</span></label>
            <label><span>Skill name</span><input value={skill.name} maxLength={160} onChange={event => onChange({ skills: skills.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} /></label>
            <label><span>Skill instructions</span><textarea rows={6} value={skill.instructions} maxLength={5000} onChange={event => onChange({ skills: skills.map((item, i) => i === index ? { ...item, instructions: event.target.value } : item) })} /></label>
            <div className="studio-skill-actions"><span>{skill.instructions.length.toLocaleString()} characters</span><button type="button" className="studio-icon-button" aria-label={`Move ${skill.name} up`} disabled={index === 0} onClick={() => move(index, -1)}><IconArrowUp size={15} /></button><button type="button" className="studio-icon-button" aria-label={`Move ${skill.name} down`} disabled={index === skills.length - 1} onClick={() => move(index, 1)}><IconArrowDown size={15} /></button><button type="button" className="studio-icon-button" aria-label={`Remove ${skill.name}`} onClick={() => onChange({ skills: skills.filter((_, i) => i !== index) })}><IconTrash size={15} /></button></div>
          </fieldset>
        </details>)}
      </div>
      <div className={`studio-guidance-budget ${guidanceSize > 5000 ? "is-over-limit" : ""}`}>
        <div><span>Task guidance</span><strong>{guidanceSize.toLocaleString()} / 5,000</strong></div>
        <progress aria-label="Task guidance characters" value={Math.min(guidanceSize, 5000)} max={5000} />
        <small>{guidanceSize > 5000 ? "Shorten the task, instructions, active skills or additional guardrails before running." : "Shared by the task, instructions, active skills and additional guardrails."}</small>
      </div>
    </section>
    <details className="studio-tool-policy"><summary><IconShieldCheck size={16} /><span>Tools and guardrails</span><small>{selectedTools.length} tools</small></summary>
      <p className="studio-caption">Choose the evidence this node may retrieve. Connect HTTP or MCP nodes for external operations.</p>
      {workflowTools.map(tool => <label className={`studio-check-field studio-tool-choice ${selectedTools.includes(tool.id) ? "is-selected" : ""}`} key={tool.id}>
        <input type="checkbox" disabled={disabled} checked={selectedTools.includes(tool.id)} onChange={event => onChange({ allowedTools: event.target.checked ? [...selectedTools, tool.id] : selectedTools.filter(id => id !== tool.id) })} />
        <span><strong>{tool.name}</strong><small>{tool.description}</small></span>
      </label>)}
      <div className="studio-required-guardrails"><strong><IconShieldCheck size={15} />Always enforced</strong><ul className="studio-guardrails">{requiredGuardrails.map(item => <li key={item}>{item}</li>)}</ul></div>
      <label><span>Additional guardrails</span><textarea disabled={disabled} rows={3} value={String(data.guardrails || "")} maxLength={5000} placeholder="For example: flag missing acceptance criteria before recommending tests." onChange={event => onChange({ guardrails: event.target.value })} /></label>
    </details>
  </>;
}
