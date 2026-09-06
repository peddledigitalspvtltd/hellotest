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
