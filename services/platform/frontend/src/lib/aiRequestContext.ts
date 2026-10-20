export type AiContextReduction = { context_reduced?: boolean; context_reduction_reason?: string | null };

// Called only for AI previews/queue submissions rejected before processing.
// IDs, selected model, output mode/count and existing item identity survive.
export function compactAiRequestBody(body: string): string | null {
  let input: Record<string, unknown>;
  try { input = JSON.parse(body) as Record<string, unknown>; } catch { return null; }
  if (!input || Array.isArray(input) || typeof input !== "object") return null;
  if ((Array.isArray(input.images) && input.images.length) || (Array.isArray(input.reference_photos) && input.reference_photos.length)) return null;
  const compact = { ...input };
  delete compact.external_links;
  // The existing authored artifact is mandatory evidence for improvement.
  // Dropping its steps, Examples or data declarations changes the task into
  // generation from a title and can cause a reviewed replacement to lose work.
  // Only optional supporting context is eligible for this inbound-size retry.
  const next = JSON.stringify(compact);
  return next.length < body.length ? next : null;
}

export async function requestAiWithShorterContext<T extends object>(
  send: (init: RequestInit) => Promise<T>, init: RequestInit
): Promise<T & AiContextReduction> {
  try { return await send(init); } catch (error) {
    if (!error || typeof error !== "object" || !("status" in error) || error.status !== 413 || typeof init.body !== "string") throw error;
    // Upstream size failures already received the server's one compact retry.
    // This client fallback is for the API/gateway rejecting the inbound body.
    if (error instanceof Error && /LLM request|LLM integration|provider/i.test(error.message)) throw error;
    const body = compactAiRequestBody(init.body);
    if (!body || init.signal?.aborted) throw error;
    const response = await send({ ...init, body });
    return {
      ...response,
      context_reduced: true,
      context_reduction_reason: "The request exceeded the size limit. Optional external URL pointers were omitted. Your instructions and original authored content were preserved. Review against the original context before accepting."
    };
  }
}
