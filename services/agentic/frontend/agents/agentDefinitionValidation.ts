import type { AgentDefinition } from './agentDefinitions';

export type AgentDefinitionIssue = { tab: 'purpose' | 'skills' | 'completion'; message: string };
export function validateAgentDefinition(definition: AgentDefinition): AgentDefinitionIssue[] {
  const issues: AgentDefinitionIssue[] = [];
  if (!definition.name.trim()) issues.push({ tab: 'purpose', message: 'Add an agent name.' });
  if (!definition.objective.trim()) issues.push({ tab: 'purpose', message: 'Describe the result in Objective.' });
  if (definition.required_inputs.length > 20 || definition.required_inputs.some(key => !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key))) {
    issues.push({ tab: 'skills', message: 'Use up to 20 input names: letters, numbers and underscores, starting with a letter.' });
  }
  const activeSkills = definition.skills.filter(skill => skill.enabled !== false);
  const guidance = [definition.objective, definition.instructions, ...activeSkills.map(skill => `${skill.name}: ${skill.instructions}`), definition.guardrails].join('\n');
  if (guidance.length > 5000) issues.push({ tab: 'skills', message: `Trim task instructions and skills by ${guidance.length - 5000} characters to fit the 5,000-character guidance budget.` });
  if (definition.acceptance.require_evidence && !definition.allowed_tools.length && !definition.required_inputs.length) issues.push({ tab: 'skills', message: 'Enable an evidence tool or declare task inputs for evidence-based completion.' });
  const fields = [
    [definition.acceptance.minimum_findings, 0, 8, 'Minimum findings'],
    [definition.limits.timeout_ms, 10000, 70000, 'Time limit (10–70 seconds)'],
    [definition.limits.max_model_calls, 1, 2, 'Model calls (1–2)'],
    [definition.limits.max_output_tokens, 256, 8000, 'Output tokens (256–8,000)'],
  ] as const;
  for (const [value, min, max, label] of fields) {
    if (!Number.isInteger(value) || value < min || value > max) issues.push({ tab: 'completion', message: `Check ${label.toLowerCase()}.` });
  }
  return issues;
}
