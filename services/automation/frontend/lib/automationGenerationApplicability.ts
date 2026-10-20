/** Applicability comes from a fresh server comparison of scoped Plan records.
 * A retained artifact remains readable without claiming it is today's Plan. */
export function generationApplicabilityNotice(value: unknown): { historical: boolean; title: string; message: string } | null {
  const preview = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const candidate = preview.applicability;
  const applicability = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Record<string, unknown> : {};
  if (applicability.status === 'current') return null;
  if (applicability.status === 'historical') return { historical: true, title: 'Historical generation', message: 'Plan instructions or requirements changed after this generation. This preview retains the earlier version.' };
  return { historical: false, title: 'Generation version unavailable', message: 'The retained preview is available. Its match to the current Plan could not be established.' };
}
