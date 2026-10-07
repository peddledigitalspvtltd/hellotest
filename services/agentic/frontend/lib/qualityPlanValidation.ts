import type { QualityAgentPlan } from './qualityAgentContracts';
import { qualityTargetError } from './qualityAgentExperience';

export function qualityPlanIssues(plan: QualityAgentPlan): string[] {
  const issues: string[] = [];
  const targetIssue = qualityTargetError(plan.target_url);
  if (targetIssue) issues.push(targetIssue);
  if (plan.steps.length > 12) issues.push('Keep the browser journey to 12 steps.');
  if (plan.kind === 'web' && plan.goal.trim() && !plan.steps.length) issues.push('Add the browser steps that fulfil this goal before execution.');
  for (const [index, step] of plan.steps.entries()) {
    const prefix = `Step ${index + 1}`;
    if (['click', 'fill'].includes(step.action) && !step.selector?.trim()) issues.push(`${prefix}: add a selector.`);
    if (step.action === 'fill' && step.value === undefined) issues.push(`${prefix}: add the field value.`);
    if (step.action === 'assert_text' && !step.text?.trim()) issues.push(`${prefix}: add the expected text.`);
    if (step.action === 'assert_url') {
      if (!step.url || qualityTargetError(step.url)) issues.push(`${prefix}: use a complete expected URL.`);
      else if (!targetIssue && new URL(step.url).origin !== new URL(plan.target_url).origin) issues.push(`${prefix}: keep the expected URL on the target origin.`);
    }
  }
  return issues;
}
