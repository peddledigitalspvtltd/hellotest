export function parseStoryAcceptanceCriteria(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
}

export function storyAcceptanceCriteria(story: {acceptance_criteria?: string[]; additional_fields?: Record<string, unknown> | null}): string[] {
  const value = story.acceptance_criteria ?? story.additional_fields?.acceptance_criteria;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean) : [];
}
