import type { AgentStructuredArtifact } from '@hellotest/platform/frontend/src/types';
import { draftReadinessIssues } from '@hellotest/ai/frontend/lib/draftReadiness';

export function agentArtifactIssues(item: AgentStructuredArtifact): string[] {
  const issues: string[] = [];
  if (!item.title?.trim() || item.title.length > 255) issues.push('Add a title within 255 characters.');
  if (!item.description?.trim()) issues.push('Add a description.');
  if (!/^P[1-5]$/.test(item.priority)) issues.push('Choose a priority from P1 to P5.');
  if (!Array.isArray(item.citation_ids) || !item.citation_ids.length || item.citation_ids.some(id => typeof id !== 'string' || !id.trim())) issues.push('Add recorded source references before accepting the proposal.');
  if (item.target_id && (item.kind !== 'story' || !Number.isInteger(item.target_revision) || (item.target_revision || 0) < 1)) issues.push('A Story update requires its recorded target revision.');
  const completeList = (values?: string[]) => Boolean(values?.length && values.every(value => typeof value === 'string' && value.trim()));
  if (item.kind === 'story' && !completeList(item.acceptance_criteria)) issues.push('Add acceptance criteria.');
  if (item.kind === 'test_case' || item.kind === 'automation') {
    issues.push(...draftReadinessIssues({ ...item, steps: item.steps || [] }));
    if (item.kind === 'automation' && (item.steps || []).some(step => !step.step_type || step.step_type === 'web')) {
      let valid = false;
      try { const url = new URL(item.start_url || ''); valid = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { /* Incomplete draft. */ }
      if (!valid) issues.push('Add an HTTP or HTTPS start URL without embedded credentials for the web Plan.');
    }
  }
  if (item.kind === 'run' && (!completeList(item.test_case_ids) || !completeList(item.exit_criteria))) issues.push('Select existing test cases and add exit criteria.');
  if (item.kind === 'defect') {
    if (!completeList(item.reproduction_steps) || !item.expected_result?.trim() || !item.actual_result?.trim()) issues.push('Complete reproduction steps, expected behavior and observed behavior.');
    if (!['critical', 'high', 'medium', 'low'].includes(item.severity || '')) issues.push('Choose a defect severity.');
  }
  if (item.parameter_values && Object.entries(item.parameter_values).some(([key, value]) => !/^@?t\.[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(key) || typeof value !== 'string')) issues.push('Use case-owned @t parameter names and text values.');
  return [...new Set(issues)];
}

export const agentArtifactDestination = (kind: AgentStructuredArtifact['kind']) => ({ story: 'Stories', test_case: 'Test Cases', defect: 'Defects', run: 'Runs', automation: 'Automation' })[kind];
export function agentArtifactSavedRoute(kind: AgentStructuredArtifact['kind'], id: string): string {
  const value = encodeURIComponent(id);
  return kind === 'story' ? `/stories?requirement=${value}` : kind === 'test_case' ? `/test-cases?case=${value}` : kind === 'run' ? `/executions?execution=${value}` : kind === 'automation' ? `/automation?case=${value}` : `/issues?issue=${value}`;
}
