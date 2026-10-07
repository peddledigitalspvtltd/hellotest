export const QUALITY_AGENT_EXPERIENCES = {
  web: { name: 'Web explorer', shortName: 'Web', verb: 'Explore', color: 'mint', headline: 'Follow the journey. Keep the evidence.', description: 'Observe links, console failures and a reviewed browser journey.', outcome: 'Journey traces & broken boundaries', icon: 'route' },
  security: { name: 'Security observer', shortName: 'Security', verb: 'Inspect', color: 'coral', headline: 'See the exposure behind the interface.', description: 'Inspect response headers, transport and visible security posture.', outcome: 'Passive security findings', icon: 'shield' },
  performance: { name: 'Performance analyst', shortName: 'Performance', verb: 'Measure', color: 'amber', headline: 'Find the moments that slow people down.', description: 'Measure one browser navigation against your performance budget.', outcome: 'Timing, layout & resource metrics', icon: 'bolt' },
  accessibility: { name: 'Accessibility reviewer', shortName: 'Accessibility', verb: 'Review', color: 'iris', headline: 'Make the experience easier to reach.', description: 'Check visible DOM semantics, labels and keyboard affordances.', outcome: 'Traceable accessibility findings', icon: 'accessible' },
  visual: { name: 'Visual regression', shortName: 'Visual', verb: 'Compare', color: 'sky', headline: 'Catch the change your eyes might miss.', description: 'Capture the page and compare it with an explicitly reviewed baseline.', outcome: 'Screenshots & pixel differences', icon: 'visual' },
} as const;
export type QualityExperienceKind = keyof typeof QUALITY_AGENT_EXPERIENCES;
export const QUALITY_AGENT_KINDS = Object.keys(QUALITY_AGENT_EXPERIENCES) as QualityExperienceKind[];
export function isQualityAgentKind(value: unknown): value is QualityExperienceKind { return typeof value === 'string' && QUALITY_AGENT_KINDS.includes(value as QualityExperienceKind); }
export function qualityTargetError(value: string): string {
  if (!value.trim()) return 'Add the URL you want to inspect.';
  if (value.trim().length > 2000) return 'Keep the target URL within 2,000 characters.';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return 'Use an HTTP or HTTPS URL without embedded credentials.';
    return '';
  } catch { return 'Enter a complete URL, for example https://your-app.example.'; }
}
export function qualityMetricLabel(key: string): string { return key.replace(/_/g, ' ').replace(/\b(?:lcp|fcp|cls|dom|tls|http|url)\b/gi, word => word.toUpperCase()); }
export function qualityMetricValue(key: string, value: unknown): string {
  if (value == null) return 'Not measured';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value !== 'number') return String(value);
  if (/bytes$/.test(key)) return value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;
  if (/_ms$/.test(key)) return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
  if (/ratio$/.test(key)) return `${(value * 100).toFixed(2)}%`;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
}
const qualityStatusLabels: Record<string, string> = { queued: 'Queued', running: 'Observing', completed: 'Complete', failed: 'Could not finish', cancelled: 'Stopped', needs_review: 'Review required', passed: 'Checks passed', findings: 'Findings to review', error: 'Execution error' };
export const qualityStatusLabel = (status?: string) => qualityStatusLabels[status || ''] || status || 'Ready';
