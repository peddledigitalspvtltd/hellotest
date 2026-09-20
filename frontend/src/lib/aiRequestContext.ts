export type AiContextReduction = { context_reduced?: boolean; context_reduction_reason?: string | null };

// Called only for AI previews/queue submissions rejected before processing.
// IDs, selected model, output mode/count and existing item identity survive.
export function compactAiRequestBody(body: string): string | null {
  let input: Record<string, unknown>;
  try { input = JSON.parse(body) as Record<string, unknown>; } catch { return null; }
  if (!input || Array.isArray(input) || typeof input !== "object") return null;
  const compact = { ...input };
  delete compact.images;
  delete compact.external_links;
  delete compact.requirement_context;
  if (typeof compact.additional_context === "string") compact.additional_context = compact.additional_context.slice(0, 2000);
  if (compact.test_case && typeof compact.test_case === "object") {
    const draft = compact.test_case as Record<string, unknown>;
    compact.test_case = { title: typeof draft.title === "string" ? draft.title.slice(0, 500) : "", authoring_mode: draft.authoring_mode };
  }
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
      context_reduction_reason: "The request exceeded the size limit. Images, linked context and long draft text were omitted for this preview. Review against the original Story before accepting."
    };
  }
}
