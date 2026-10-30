export type WorkflowReviewScope = { ids: string[]; error?: string };

/** A malformed review link must never widen into an unrestricted Library query. */
export function parseWorkflowReviewScope(value: string | null): WorkflowReviewScope | null {
  if (value === null) return null;
  const ids = [...new Set(value.split(",").map(id => id.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 200 || ids.some(id => id.length > 255 || /[\u0000-\u001f\u007f]/.test(id))) {
    return {ids: [], error: "This review link is invalid. Open Review again from the workflow results."};
  }
  return {ids};
}
