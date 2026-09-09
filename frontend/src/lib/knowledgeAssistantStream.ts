import type { KnowledgeAssistantMessageResponse, KnowledgeRetrievalEvent } from "../types";

export class KnowledgeStreamError extends Error {
  code: string;
  retryable: boolean;
  constructor(message: string, code = "STREAM_INTERRUPTED", retryable = true) {
    super(message);
    this.name = "KnowledgeStreamError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function isKnowledgeRetrievalEvent(value: unknown): value is KnowledgeRetrievalEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return event.contract_type === "RetrievalEvent" && ["1.0", "RetrievalEvent.v1"].includes(String(event.contract_version)) && typeof event.stage === "string" && event.stage.length <= 100
    && (event.message === undefined || typeof event.message === "string") && (event.status === undefined || typeof event.status === "string")
    && (event.sequence === undefined || (typeof event.sequence === "number" && Number.isFinite(event.sequence)));
}

/** Parse authenticated fetch SSE, including split UTF-8 characters and CRLF boundaries. */
export async function consumeKnowledgeAssistantStream(response: Response, options: {
  signal?: AbortSignal;
  onProgress?: (event: KnowledgeRetrievalEvent) => void;
} = {}): Promise<KnowledgeAssistantMessageResponse> {
  if (!response.body) throw new KnowledgeStreamError("The answer stream is unavailable. Retry this turn.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let data: string[] = [];
  let result: KnowledgeAssistantMessageResponse | undefined;
  let eventSize = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  options.signal?.addEventListener("abort", abort, { once: true });
  const checkAborted = () => { if (options.signal?.aborted) throw new DOMException("Answer stopped", "AbortError"); };
  const dispatch = () => {
    if (!data.length) { eventName = "message"; return; }
    let value: unknown;
    try { value = JSON.parse(data.join("\n")); }
    catch { throw new KnowledgeStreamError("The answer stream contained an invalid event. Retry this turn.", "INVALID_STREAM_EVENT"); }
    if (eventName === "error") {
      const error = value && typeof value === "object" ? value as Record<string, unknown> : {};
      const message = typeof error.message === "string" ? error.message : "The answer could not be completed.";
      throw new KnowledgeStreamError(`${message}${typeof error.trace_id === "string" ? ` (reference: ${error.trace_id})` : ""}`, typeof error.code === "string" ? error.code : "STREAM_FAILED", error.retryable !== false);
    }
    if (["progress", "retrieval_progress"].includes(eventName)) {
      if (!isKnowledgeRetrievalEvent(value)) throw new KnowledgeStreamError("This answer stream uses an unsupported progress contract.", "UNSUPPORTED_CONTRACT", false);
      options.onProgress?.(value);
    } else if (eventName === "result") {
      if (!value || typeof value !== "object") throw new KnowledgeStreamError("The answer stream ended with an invalid result.", "INVALID_STREAM_RESULT");
      const response = value as Record<string, unknown>;
      const message = response.assistant_message || response.message;
      if (response.pending !== true && (!message || typeof message !== "object" || typeof (message as Record<string, unknown>).content !== "string")) throw new KnowledgeStreamError("The answer stream ended with an invalid result.", "INVALID_STREAM_RESULT");
      result = value as KnowledgeAssistantMessageResponse;
    }
    eventName = "message";
    data = [];
    eventSize = 0;
  };
  const line = (value: string) => {
    if (!value) { dispatch(); return; }
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":");
    const field = colon < 0 ? value : value.slice(0, colon);
    const content = colon < 0 ? "" : value.slice(colon + 1).replace(/^ /, "");
    if (field === "event") eventName = content;
    if (field === "data") {
      data.push(content);
      eventSize += content.length;
      if (eventSize > 2_000_000) throw new KnowledgeStreamError("The answer stream exceeded the supported event size.", "STREAM_TOO_LARGE", false);
    }
  };
  try {
    checkAborted();
    while (!result) {
      const { value, done } = await reader.read();
      checkAborted();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 2_000_000) throw new KnowledgeStreamError("The answer stream exceeded the supported event size.", "STREAM_TOO_LARGE", false);
      let match: RegExpExecArray | null;
      while ((match = /\r\n|\n|\r/.exec(buffer))) {
        if (!done && match[0] === "\r" && match.index === buffer.length - 1) break;
        line(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      if (done) {
        if (buffer) line(buffer);
        dispatch();
        break;
      }
    }
    checkAborted();
    if (!result) throw new KnowledgeStreamError("The connection ended before the answer was complete. Retry this turn to resume it.");
    return result;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}


export type KnowledgeTurnNotice = {
  kind: "pending" | "cancelled" | "error";
  title: string;
  message: string;
  retryable: boolean;
};

export function knowledgeTurnNotice(error: unknown, cancelled = false): KnowledgeTurnNotice {
  const code = error instanceof KnowledgeStreamError ? error.code : error instanceof Error ? error.name : "";
  if (cancelled) return { kind: "cancelled", title: "Answer stopped", message: "Your question is still here. Resume this turn whenever you are ready.", retryable: true };
  if (code === "TURN_PENDING") return { kind: "pending", title: "Your answer is still being prepared", message: "This turn is running on the server. Check again shortly to receive its answer without sending a duplicate question.", retryable: true };
  if (/TIMEOUT|DEADLINE/i.test(code)) return { kind: "error", title: "This answer took too long", message: "The service did not finish within its time limit. Retry this turn, or review the source evidence without using the answer model.", retryable: true };
  if (/NETWORK|STREAM_INTERRUPTED|TypeError/i.test(code)) return { kind: "error", title: "The connection was interrupted", message: "A complete answer did not reach this conversation. Retry to check the same turn; your question is preserved.", retryable: true };
  return { kind: "error", title: "We could not complete this answer", message: error instanceof Error ? error.message : "The assistant is unavailable right now. Your question is preserved.", retryable: !(error instanceof KnowledgeStreamError) || error.retryable };
}

export function knowledgeModelFailureMessage(code?: string) {
  if (code === "MODEL_AUTHENTICATION_FAILED") return "The selected model connection was not accepted. Check its credentials in Integrations, or choose another answer model. Your retrieved sources are still available.";
  if (code === "MODEL_NOT_FOUND") return "The configured model could not be found. Check the model name in Integrations, or choose another answer model. Your retrieved sources are still available.";
  if (code === "MODEL_QUOTA_EXCEEDED") return "The selected model has reached its provider quota. Check the provider account or choose another answer model. Your retrieved sources are still available.";
  if (code === "MODEL_RATE_LIMITED") return "The answer model is handling too many requests. Try again shortly or choose another model. Your retrieved sources are still available.";
  if (code === "MODEL_TIMEOUT") return "The answer model did not finish in time. Your retrieved sources are available below; you can also try another model.";
  if (["MODEL_EMPTY_RESPONSE", "MODEL_OUTPUT_TRUNCATED", "MODEL_INVALID_RESPONSE"].includes(code || "")) return "The model did not return a complete, usable answer. Review the available evidence below, then retry or choose another model.";
  if (code === "MODEL_REQUEST_REJECTED") return "The selected model rejected this request. Check its configuration or choose another model. Your retrieved sources are still available.";
  if (code === "MODEL_CONTEXT_LIMIT") return "The evidence exceeds this model connection's request limit. Narrow the selected sources or choose a model with a larger limit. Your retrieved sources are still available.";
  return "The search returned evidence, but the model could not finish an answer. Review the available sources below.";
}

const stageLabels: Record<string, string> = {
  QUERY_RECEIVED: "Starting your question",
  QUERY_UNDERSTANDING: "Understanding your question",
  RETRIEVAL_PLANNING: "Planning the evidence search",
  HYBRID_SEARCH: "Searching project records and documents",
  STRUCTURED_LOOKUP: "Checking current project records",
  PARENT_EXPANSION: "Reading the surrounding source context",
  RELATIONSHIP_SEARCH: "Following related project evidence",
  COMPLETED: "Completing your answer",
  REQUEST_ACCEPTED: "Starting your question",
  SCOPE_RESOLUTION: "Checking your project scope",
  AUTHORIZATION: "Checking source access",
  ANSWER_AUTHORIZATION: "Checking access to the answer's sources",
  HISTORY_LOOKUP: "Reading this conversation",
  QUERY_PLANNING: "Planning the evidence search",
  PLANNING: "Planning the evidence search",
  QUERY_EMBEDDING: "Matching related project context",
  EMBEDDING: "Matching related project context",
  LEXICAL_SEARCH: "Searching project records and documents",
  SEMANTIC_SEARCH: "Finding related evidence",
  VECTOR_SEARCH: "Finding related evidence",
  RETRIEVAL: "Finding project evidence",
  LIVE_CONTEXT: "Reading current project records",
  LIVE_PROJECT: "Reading current project records",
  EVIDENCE_FUSION: "Combining the relevant sources",
  RERANKING: "Selecting the strongest evidence",
  CONTEXT_ASSEMBLY: "Preparing the evidence",
  CONTEXT_PACKET: "Preparing the evidence",
  MODEL_GENERATION: "Writing an answer from the evidence",
  GENERATION: "Writing an answer from the evidence",
  ANSWER_GENERATION: "Writing an answer from the evidence",
  VALIDATION: "Checking the answer's citations",
  ANSWER_VALIDATION: "Checking the answer's citations",
  WAITING_FOR_TURN: "Waiting for this turn to finish",
  COMPLETE: "Completing your answer"
};

export function knowledgeProgressLabel(event?: KnowledgeRetrievalEvent, opening = false) {
  if (!event) return opening ? "Opening your conversation" : "Waiting for the evidence search";
  if (["FAILED", "UNAVAILABLE"].includes(String(event.status).toUpperCase()) && (/GENERATION/i.test(event.stage) || event.error_code?.startsWith("MODEL_"))) return "The answer model is unavailable";
  return stageLabels[event.stage.toUpperCase()] || event.stage.replace(/_/g, " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

export function knowledgeElapsedLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function waitForRetry(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Answer stopped", "AbortError")); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException("Answer stopped", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** A pending response belongs to the original turn; never create a second turn. */
export async function resumePendingKnowledgeTurn(request: () => Promise<KnowledgeAssistantMessageResponse>, options: {
  signal?: AbortSignal;
  onPending?: (response: KnowledgeAssistantMessageResponse) => void;
  maxPendingRetries?: number;
  retryDelayMs?: number;
} = {}): Promise<KnowledgeAssistantMessageResponse> {
  const maximum = options.maxPendingRetries ?? 5;
  for (let attempt = 0; ; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException("Answer stopped", "AbortError");
    const response = await request();
    if (!response.pending) return response;
    options.onPending?.(response);
    if (attempt >= maximum) throw new KnowledgeStreamError("This turn is still processing. Check for its answer shortly.", "TURN_PENDING");
    const delay = options.retryDelayMs ?? Math.min(10, Math.max(1, Number(response.retry_after_seconds) || 3)) * 1000;
    await waitForRetry(delay, options.signal);
  }
}
